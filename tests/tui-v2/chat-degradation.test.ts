/**
 * tests/tui-v2/chat-degradation.test.ts — #1348 V2 判据（注入式补充证据）
 *
 * 目的：证明 src/tui-v2/chat.tsx 4 处原静默空吞的 catch 体**降级语义在位**：
 *   ① `:237` checkForUpdates 失败 → log.warn + 界面提示
 *   ② `:242` fetchDeepseekBalance 失败 → log.warn + 界面提示
 *   ③ `:260` db.pragma 抛错 → log.warn + 关闭流程继续（降级不阻断）
 *   ④ `:418` startDiagnosis 两种失败形态（reject / resolve 为 null）→ log.warn|error + 界面提示 + 复位假进度
 *
 * 手段：`vi.mock` 让被调方 reject / 让 db.pragma 抛错；`vi.spyOn` 断言 log.warn/error **真被调用**；
 *      渲染走**真实 ink render**（假 TTY 由 tests/tui-v2/ink-fakes.ts 提供）⇒ 真实组件、真实 catch 块被执行。
 *
 * 边界声明（V-09，必读）：
 * - 本文件是 **V2 的补充证据，不替代 V3**（真实生产入口 `npm run tui` + PTY 的原始输出留档见 .synova-out/证据/）；
 * - 注入物（mock 与假流）**只存在于 tests/**，不改任何被调方源码语义；
 * - 未证明部分：「自然（非注入）失败下界面降级可见」**未核** —— 见 .synova-out/交付-1348.md 例外清单。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';

// ═══ CI 环境屏蔽（必须在 ink / is-in-ci 首次加载之前执行；V-09 边界声明） ═══
//
// 为什么必须屏蔽：`is-in-ci@1.x` 在**模块加载期**读一次环境变量并冻结为常量
//   （node_modules/is-in-ci/index.js: `const isInCi = env.CI !== '0' && env.CI !== 'false' && …`），
// ink 据此在每帧 flush 时走**静态输出分支**、**根本不 write 动态帧**
//   （node_modules/ink/build/ink.js:111 `if (isInCi) { …; return; }`）。
// 而本文件被测的场景是**交互式 TTY**（FakeStdin/FakeStdout 的 isTTY 均为 true），
// `CI` 是**测试运行器所在环境**的变量、**不是被测场景的属性** ⇒ 二者不相容。
// CI 下不屏蔽的后果：`stdout.raw` 恒空 ⇒ 5 条依赖帧文本的断言恒红（Gitea Actions 必然注入 CI=true）。
//
// 边界（不改被测语义，只改跑测环境）：
// - 只置 `process.env.CI = '0'`（is-in-ci 判 false 的取值之一），**不触碰** chat.tsx 与任何被调方；
// - 不改变降级语义断言（log.warn/error 真被调用 + 界面提示可见），只让 ink 走**交互式输出路径**；
// - 不影响 ink 的其它行为：`stdout.isTTY` 仍由 fakes 如实提供，帧累积/`finalFrame()` 语义不变。
// vi.hoisted 由 vitest 提升到所有静态 import **之前**执行 ⇒ 早于 ./ink-fakes 触达 ink。
vi.hoisted(() => {
  process.env.CI = '0';
});

import { FakeStdin, FakeStdout, finalFrame, flush } from './ink-fakes';

// ═══ 注入面（hoisted：vi.mock 工厂只能引用 hoisted 值）═══
const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const db = {
    pragma: vi.fn(() => {
      throw new Error('injected: wal_checkpoint failure');
    }),
    close: vi.fn(),
    prepare: vi.fn(),
    exec: vi.fn(),
  };
  const store = {
    addMessage: vi.fn(),
    updateSession: vi.fn(),
    saveState: vi.fn(),
    createSession: vi.fn(() => ({ id: 's1' })),
    queryNodes: vi.fn(() => []),
  };
  const eventBus = { emit: vi.fn() };
  const wiring = {
    emitPhaseCompleted: vi.fn(),
    advancePhase: vi.fn(),
    checkCompaction: vi.fn(() => null),
  };
  const sessionManager = { addMessage: vi.fn() };
  const scheduler = { schedule: vi.fn(), stop: vi.fn() };
  const engine = {
    startDiagnosis: vi.fn(),
    processMessageStream: vi.fn(),
    getPhase: vi.fn(() => 1),
    getOrgId: vi.fn(() => 'test-org'),
    getMessages: vi.fn(() => []),
    getToolRegistry: vi.fn(() => ({ register: vi.fn() })),
    serialize: vi.fn(() => ({})),
  };
  const state = {
    element: null as unknown,
    renderCalls: 0,
    sigterm: null as unknown,
    sigint: null as unknown,
  };
  return { logger, db, store, eventBus, wiring, sessionManager, scheduler, engine, state };
});

// ═══ 生产入口模块的注入（只 mock 外边界；chat.tsx 本体是真身）═══

// 1) ink：只截获 main() 里的 render()，其余（Box/Text/hooks）用真身 —— 稍后用真 render 重新渲染该元素
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    render: vi.fn((element: unknown) => {
      h.state.element = element;
      h.state.renderCalls += 1;
      return { unmount: vi.fn(), waitUntilExit: async () => undefined, rerender: vi.fn(), cleanup: vi.fn() };
    }),
  };
});

// 2) logger：createLogger 返回可断言的 spy（chat.tsx 用的是 createLogger('tui-v2')）
vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  return { ...actual, createLogger: vi.fn(() => h.logger) };
});

// 3) bootstrap：提供可控 bctx（db.pragma 抛错、wiring/store 为 spy）
vi.mock('../../src/tui-v2/lib/bootstrap', () => ({
  bootstrap: vi.fn(async () => ({
    provider: { name: 'stub-provider' },
    llmHealthy: true,
    db: h.db,
    store: h.store,
    eventBus: h.eventBus,
    hookRunner: {},
    sessionManager: h.sessionManager,
    stateMachine: {},
    wiring: h.wiring,
    sessionId: 's1',
  })),
}));

// 4) 终端 stdin 代理：测试环境不装（避免与 vitest 的 stdin 抢 fd）
vi.mock('../../src/tui-v2/lib/mouse-input', () => ({
  installStdinProxy: vi.fn(),
  setScrollHandlers: vi.fn(),
}));

// 5) 被调方服务：注入 reject（`:237` / `:242`）
vi.mock('../../src/services/update-checker', () => ({
  checkForUpdates: vi.fn(async () => {
    throw new Error('injected: update-check failure');
  }),
  formatUpdateMessage: vi.fn(() => ''),
}));

vi.mock('../../src/services/deepseek-balance', () => ({
  fetchDeepseekBalance: vi.fn(async () => {
    throw new Error('injected: balance failure');
  }),
  formatBalance: vi.fn(() => ''),
}));

// 6) 侧边界：调度器 / 专家清单 / L3 knowledge-agent 隔离，避免测试进程起 cron 与读盘
vi.mock('../../src/agent/scheduler-service', () => ({
  getGlobalScheduler: vi.fn(() => h.scheduler),
}));
vi.mock('../../src/agent/expert-config-loader', () => ({
  getAllExpertIds: vi.fn(() => ['host']),
}));
vi.mock('../../src/l3/knowledge-agent', () => ({
  createKnowledgeAgent: vi.fn(() => ({ registerTo: vi.fn() })),
}));

// 7) ConversationEngine：测试替身（生产入口由 initConversationEngine 动态 import）
vi.mock('../../src/agent/conversation-engine', () => ({
  ConversationEngine: class {
    constructor() {
      Object.assign(this, h.engine);
    }
  },
}));

// ═══ 渲染夹具（真实 ink）═══
type InkInstanceLoose = {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  rerender: (node: ReactElement) => void;
  cleanup: () => void;
};
type InkRenderLoose = (
  node: ReactElement,
  options?: { stdin?: unknown; stdout?: unknown; stderr?: unknown; exitOnCtrlC?: boolean; patchConsole?: boolean },
) => InkInstanceLoose;

let entryCaptured = false;
let mountedInstance: InkInstanceLoose | null = null;

async function ensureEntryCaptured(): Promise<void> {
  if (entryCaptured) return;
  // chat.tsx 末尾的 main() 会在 import 时执行：bootstrap(mock) → installStdinProxy(mock) → render(被截获)
  await import('../../src/tui-v2/chat.tsx');
  for (let i = 0; i < 60 && !h.state.element; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  entryCaptured = true;
  expect(h.state.element).toBeTruthy();
}

async function renderEntry(): Promise<{ stdin: FakeStdin; stdout: FakeStdout }> {
  await ensureEntryCaptured();
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const stderr = new FakeStdout();
  const onSpy = vi.spyOn(process, 'on');
  const looseRender = (await vi.importActual<typeof import('ink')>('ink')).render as InkRenderLoose;
  mountedInstance = looseRender(h.state.element as ReactElement, {
    stdin,
    stdout,
    stderr,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await flush();
  const sigterm = onSpy.mock.calls.find(([event]) => event === 'SIGTERM');
  const sigint = onSpy.mock.calls.find(([event]) => event === 'SIGINT');
  onSpy.mockRestore();
  h.state.sigterm = sigterm?.[1];
  h.state.sigint = sigint?.[1];
  return { stdin, stdout };
}

/** 只取日志第二参（消息），便于逐条断言 */
function loggedMessages(spy: typeof h.logger.warn): string[] {
  return spy.mock.calls.map((call) => String(call[1]));
}

/**
 * 输入一行并回车。必须在文本与回车之间让出一次 flush：
 * ink-text-input 的 onSubmit 闭包取当前 `value` prop，React 重渲染后 handler 才重新注册
 * （node_modules/ink-text-input/build/index.js:48-60），同一 tick 内连发文本+回车会提交空串。
 */
async function typeAndSubmit(stdin: FakeStdin, text: string): Promise<void> {
  stdin.type(text);
  await flush(8);
  stdin.type('\r');
  await flush(24);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认注入：`:418`（无 event handler 的调用点）失败；`:438`（带 handler 的主调用）挂起（模拟诊断长跑）
  h.engine.processMessageStream.mockImplementation(async () => ({ reply: '已收集到足够信息', phaseComplete: true }));
  h.engine.startDiagnosis.mockImplementation(async (_role: string, _name: string, onEvent?: unknown) => {
    if (typeof onEvent === 'function') return new Promise(() => undefined);
    throw new Error('injected: diagnosis launch reject (:418)');
  });
});

afterEach(() => {
  mountedInstance?.unmount();
  mountedInstance = null;
});

describe('#1348 V2 — 4 处空吞降级语义在位（注入式补充证据）', () => {
  it('① :237 检查更新 reject → log.warn 真被调用 + 界面提示可见', async () => {
    const { stdout } = await renderEntry();

    expect(loggedMessages(h.logger.warn)).toContain('检查更新失败 — 跳过更新提示（降级不阻断）');
    expect(stdout.text).toContain('⚠️ 检查更新失败');
  });

  it('② :242 余额查询 reject → log.warn 真被调用 + 界面提示可见', async () => {
    const { stdout } = await renderEntry();

    expect(loggedMessages(h.logger.warn)).toContain('获取 DeepSeek 余额失败 — 余额暂不显示（降级不阻断）');
    expect(stdout.text).toContain('⚠️ 获取账户余额失败');
  });

  it('③ :260 WAL checkpoint 抛错 → log.warn 真被调用 + 关闭流程不阻断（db.close 仍被调用）', async () => {
    await renderEntry();

    expect(typeof h.state.sigterm).toBe('function');
    const shutdown = h.state.sigterm as (signal: string) => void;
    expect(() => shutdown('SIGTERM')).not.toThrow();

    expect(loggedMessages(h.logger.warn)).toContain('WAL checkpoint 失败 — 继续关闭（降级不阻断）');
    expect(h.db.close).toHaveBeenCalledTimes(1);
  });

  it('④a :418 诊断为 reject → log.error 真被调用 + 界面提示 + 假进度被复位', async () => {
    const { stdin, stdout } = await renderEntry();

    await typeAndSubmit(stdin, '开始');

    expect(loggedMessages(h.logger.error)).toContain('增长导航启动异常');
    expect(stdout.text).toContain('⚠️ 增长导航启动失败');
    // 最终帧不得停留在假进度。
    // ⚠️ 判别力边界（V-07 自证，2026-10-09 实测）：该「终态」属性由**两个机制共同保证**
    //    —— 本处新增的复位 + handleSubmit 的 finally（chat.tsx 收尾处无条件 setState('准备就绪')）。
    //    实测：**删掉本处复位，这 6 条测试仍全绿**（假绿形态）；且假进度文案在任一帧里都没出现过
    //    （正向断言 `toContain('Phase 1: 数据采集中...')` 实测失败）⇒ 本断言只锁「终态正确」，
    //    **不单独判别**本次改动。判别本次 :418 改动的证据 = 上面的 log.error/warn + 界面告警断言。
    expect(finalFrame(stdout.raw)).not.toContain('Phase 1: 数据采集中...');
    expect(finalFrame(stdout.raw)).toContain('准备就绪');
  });

  it('④b :418 诊断为 resolve(null) → log.warn 真被调用 + 界面提示 + 假进度被复位', async () => {
    h.engine.startDiagnosis.mockImplementation(async (_role: string, _name: string, onEvent?: unknown) => {
      if (typeof onEvent === 'function') return new Promise(() => undefined);
      return null;
    });
    const { stdin, stdout } = await renderEntry();

    await typeAndSubmit(stdin, '开始');

    expect(loggedMessages(h.logger.warn)).toContain('增长导航未返回结果（诊断引擎降级）— 复位采集状态');
    expect(stdout.text).toContain('⚠️ 增长导航未启动');
    // 判别力边界同 ④a（终态由两机制共同保证；判别本次改动的证据是上面的 log.warn + 界面告警）
    expect(finalFrame(stdout.raw)).not.toContain('Phase 1: 数据采集中...');
    expect(finalFrame(stdout.raw)).toContain('准备就绪');
  });

  it('⑤ V5 降级不阻断：:418 失败后 TUI 仍能响应一次交互（/help）', async () => {
    const { stdin, stdout } = await renderEntry();

    await typeAndSubmit(stdin, '开始');
    expect(stdout.text).toContain('⚠️ 增长导航启动失败');

    await typeAndSubmit(stdin, '/help');

    expect(stdout.text).toContain('命令: /setup 配置 LLM');
  });
});
