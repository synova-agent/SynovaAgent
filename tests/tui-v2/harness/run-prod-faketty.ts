/**
 * tests/tui-v2/harness/run-prod-faketty.ts — #1348 V3 生产入口取证（假 TTY，独立子进程）
 *
 * 环境事实（原始输出留档）：本机沙箱**禁止 openpty** ——
 *   `script: openpty: Operation not permitted`；`python3 -c "import pty; pty.openpty()"` → `OSError: out of pty devices`
 * ⇒ 无法用真 PTY 跑 `script -q`。本 runner 是等价替代：
 *   ① 在**独立子进程**中把假 TTY 装到 process.stdin/stdout/stderr（`isTTY=true` + `setRawMode/ref/unref`）；
 *   ② 再 **import 真实生产入口** `src/tui-v2/chat.tsx`（main()/bootstrap()/installStdinProxy()/ink render 全走真身）；
 *   ③ 经假 stdin 按真实节奏喂键（文本与回车间隔 600ms，与真人输入同序）。
 * 差异（已列为例外）：终端层是进程内仿真而非内核 PTY；其余（引导、DB、provider→stub LLM、会话、handlePhaseComplete、
 *   ink 渲染与 TTY 判定路径）均为生产代码原样执行。
 *
 * 产物：TUI_1348_OUT 写 ink 帧原始流；子进程 fd1/fd2（console.log + pino warn/error）由 shell 重定向另行留档。
 */
import { Readable, Writable } from 'node:stream';
import { appendFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.TUI_1348_OUT;
if (!OUT) throw new Error('缺少 TUI_1348_OUT');

writeFileSync(OUT, '');
const note = (line: string): void => {
  appendFileSync(OUT, `${line}\n`);
};

class TeeOut extends Writable {
  columns = Number(process.env.TUI_COLUMNS || 120);
  rows = Number(process.env.TUI_ROWS || 40);
  isTTY = true;

  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    appendFileSync(OUT as string, Buffer.from(String(chunk), 'utf8'));
    callback();
  }
}

const fakeStdin = new Readable({ read() { /* 由 push 驱动 */ } }) as Readable & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => boolean;
  ref: () => void;
  unref: () => void;
};
fakeStdin.isTTY = true;
fakeStdin.setRawMode = () => true;
fakeStdin.ref = () => undefined;
fakeStdin.unref = () => undefined;

const fakeStdout = new TeeOut();
const fakeStderr = new TeeOut();

function defineProcessStream(name: 'stdin' | 'stdout' | 'stderr', value: unknown): void {
  Object.defineProperty(process, name, { value, writable: true, configurable: true });
}
defineProcessStream('stdin', fakeStdin);
defineProcessStream('stdout', fakeStdout);
defineProcessStream('stderr', fakeStderr);

note(`[harness] fake TTY installed (isTTY=true, ${fakeStdout.columns}x${fakeStdout.rows}) | fault=${process.env.TUI_1348_FAULT ?? 'none'}`);

// ═══ 受控注入（仅本进程内，src/ 零改动）═══
const fault = process.env.TUI_1348_FAULT ?? 'none';
if (fault === 'reject' || fault === 'null') {
  const { ConversationEngine } = await import('../../../src/agent/conversation-engine');
  const patched = async function patchedStartDiagnosis(
    _initiatorRole: string,
    _initiatorName: string,
    onEvent?: (event: unknown) => void,
  ): Promise<unknown> {
    if (typeof onEvent === 'function') {
      return new Promise(() => undefined); // :438 主调用（带 handler）保持挂起
    }
    if (fault === 'reject') throw new Error('injected: diagnosis launch reject (:418)');
    return null;
  };
  ConversationEngine.prototype.startDiagnosis =
    patched as unknown as typeof ConversationEngine.prototype.startDiagnosis;
  note(`[harness] fault injected into startDiagnosis: ${fault}（:418 无 handler 调用点）`);
}

if (process.env.TUI_1348_LOG_VISIBLE === '1') {
  // bootstrap 在 loadEnvFile() 末尾强制 LOG_LEVEL=silent（TUI 独占 stdout 的设计）；
  // boot 之后恢复可见性，使 warn/error 落进 fd2（不改任何源码）
  setTimeout(() => {
    process.env.LOG_LEVEL = 'info';
    note('[harness] LOG_LEVEL restored to info');
  }, 4000);
}

// ═══ 喂键（真人节奏：文本与回车分开）═══
const STEP = Number(process.env.STEP || 6);
const say = (text: string): void => {
  note(`[harness] >>> ${text}`);
  fakeStdin.push(text);
  setTimeout(() => fakeStdin.push('\r'), 600);
};

const t0 = 10_000;
setTimeout(() => say('你好'), t0);
setTimeout(() => say('我们是一家 20 人的公司'), t0 + STEP * 1000);
setTimeout(() => say('好的'), t0 + STEP * 2000); // 命中 detectPhaseComplete ⇒ phaseComplete
setTimeout(() => say('/help'), t0 + STEP * 3000); // 降级后仍能响应交互（V5）
setTimeout(() => say('/quit'), t0 + STEP * 4000);
setTimeout(() => {
  note('[harness] <<< run finished');
  process.exit(0);
}, t0 + STEP * 4000 + 8000);

note('[harness] driving real production entry: src/tui-v2/chat.tsx');
await import('../../../src/tui-v2/chat.tsx');
