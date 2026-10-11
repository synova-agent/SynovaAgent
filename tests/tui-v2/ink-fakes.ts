/**
 * tests/tui-v2/ink-fakes.ts — ink 假终端（测试侧）
 *
 * 用途：#1348 V2 注入式证据 —— 在无 TTY 的 vitest 进程内驱动**真实 ink 渲染**，
 * 从而让 src/tui-v2/chat.tsx 的真实 catch 块被真实执行（而非静态 grep 断言）。
 *
 * 边界声明（V-09 纪律）：
 * - 本文件只存在于 tests/；**不改任何生产模块语义**；
 * - 假流（stdin/stdout）在结构上等价于 ink 需要的流：`FakeStdin extends Readable`（ink 经
 *   'readable' → `stdin.read()` 消费），`FakeStdout extends Writable`（ink 逐个 `write()` 落帧）。
 */
import { Readable, Writable } from 'node:stream';

/** 假 stdin：可判为 TTY（ink 的 `isRawModeSupported()` 取 `stdin.isTTY`），并支持 `type()` 送键 */
export class FakeStdin extends Readable {
  isTTY = true;
  readonly rawModeCalls: boolean[] = [];

  constructor() {
    super({ read() { /* 由 push() 驱动 */ } });
  }

  setRawMode(mode: boolean): boolean {
    this.rawModeCalls.push(mode);
    return true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  /** 模拟一次按键/粘贴（ink 通过 'readable' 事件消费） */
  type(data: string): void {
    this.push(data);
  }
}

/** 假 stdout：累积 ink 落下的每一帧原始字节 */
export class FakeStdout extends Writable {
  columns: number;
  rows: number;
  isTTY = true;
  readonly chunks: string[] = [];

  constructor(columns = 120, rows = 40) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  /** 原始输出（含 ANSI 控制序列） */
  get raw(): string {
    return this.chunks.join('');
  }

  /** 去 ANSI 后的全文（跨帧拼接；判「最终状态」请用 finalFrame()） */
  get text(): string {
    return stripAnsi(this.raw);
  }
}

export function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;?]*[a-zA-Z]/g, '');
}

/**
 * 取「最终帧」文本快照。
 *
 * ink 每次输出整帧时以 `\x1b[?2026h`（同步输出开始）为界（node_modules/ink/build/ink.js:124/158）⇒
 * 最后一个该标记之后的片段即最后一次整帧写入。无该标记时退化为全文（已去 ANSI）。
 */
export function finalFrame(raw: string): string {
  const marker = '\u001B[?2026h';
  const segments = raw.split(marker);
  const last = segments.length > 1 ? segments[segments.length - 1] : raw;
  return stripAnsi(last).replace(/\u001B\[[0-9;?]*[a-zA-Z]/g, '');
}

/** 等 React/ink 把状态更新刷进帧（无 act 环境的实用等待） */
export async function flush(times = 14): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
