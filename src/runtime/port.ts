/**
 * src/runtime/port.ts — 运行时端口（宪章 §0.4 的「−1 运行时」）
 *
 * 本文件**只放契约**，不放实现：Provider 在 `impl/real.ts`（真宿主）与 `impl/stub.ts`（假宿主）。
 *
 * 一个分离：**宿主能力**（工具派发 ＋ 审批）与**领域实现**的分离；
 *   三条承诺（逐条可判，见 `src/runtime/README.md`）:
 *   ① 换宿主不改领域 ② 假宿主不造假 ③ 审批语义不随 Provider 变。
 *
 * 契约（铁律 47）:
 *   @input    — `resolveRuntimeProvider(raw)`：env 原值（`string | undefined`）
 *   @output   — `RuntimePort`：`callTool(name,args)` ⇒ JSON 文本（与 MCP `tools/call` 同形）；
 *               `requestApproval(req)` ⇒ `ApprovalOutcome`（复用 `./approval-seam`，不新增审批语义）
 *   @degraded — 无：端口是契约层，不吞错、不降级；非法 Provider 值 **fail loud**（不降级 real ——
 *               否则「以为在跑 stub」的测试会静默变真 ⇒ 假绿）
 *   @error    — `RuntimePortError`（`code='RUNTIME_PROVIDER_INVALID'`／`phase='runtime-port'`／
 *               `retryable=false`）**只在启动期**由 `resolveRuntimeProvider` 抛；
 *               由 `src/mcp/index.ts` 的 `catch + instanceof` 消费（组 4a 判据）
 *   @authority — `RuntimePort` 只允许 **MCP 装配层**（`src/mcp/index.ts`）与 tests 构造；
 *               stub Provider 的装配点只有两处：`tests/runtime/**`（直接构造）与 MCP 全链路测试
 *               （env 显式指定 `SYNOVA_RUNTIME_PROVIDER=stub`）。生产默认 `real`。
 */
import type { ApprovalOutcome, ApprovalRequest } from './approval-seam';

/** Provider 标识（两个真实存在的宿主实现；不存在"第三种"） */
export type RuntimeProviderId = 'real' | 'stub';

/**
 * 工具派发 —— 与 MCP `tools/call` 同形：`name + args → JSON 文本`。
 *
 * real Provider 把它透传为既有 `handleToolCall`（`src/mcp/tool-definitions.ts`）；
 * 替身可在 tests 里注入，无需子进程。
 */
export type ToolDispatcher = (name: string, args: Record<string, unknown>) => Promise<string>;

/** 审批端口 —— 只暴露「请人点头」一件事（实现原样委托 `approval-seam`） */
export interface RuntimeApprovalPort {
  /**
   * 请求一次人在环审批。
   * @param req - 审批请求（外部输入；缺 `ask` ⇒ 无人应答 ⇒ 拒）。`undefined` 由实现按非法请求处理。
   * @returns 审批结论；`allowed === true` 当且仅当有人显式批准（该不变量由 approval-seam 保证）
   */
  requestApproval(req: ApprovalRequest | undefined): Promise<ApprovalOutcome>;
}

/** 运行时端口 —— Consumer（`src/mcp/index.ts`）只依赖本接口，不 import 任何 L3 实现 */
export interface RuntimePort extends RuntimeApprovalPort {
  /** Provider 标识（可观测；用于测试与启动日志） */
  readonly providerId: RuntimeProviderId;

  /**
   * 派发一次工具调用。
   * @param name - 工具名（`assertToolAllowed` 已放行）
   * @param args - 工具参数（外部输入）
   * @returns JSON 文本（MCP `content[0].text` 载荷）
   * @error real Provider **不吞错**：dispatch 抛 ⇒ 原样 reject（交既有 SDK 错误映射）；
   *        stub Provider 对未支持工具返回**结构化** `ok:false`（不抛）
   */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * 端口配置错误 —— typed error（铁律 32：`.code` ＋ `.phase` ＋ `.retryable`）。
 *
 * 为什么单独成类而不是 `throw new Error`：`src/mcp/index.ts` 必须能 **`instanceof` 区分**
 * 「provider 配置错」与其它启动期异常（后者继续走进程级 fatal 路径）。
 */
export class RuntimePortError extends Error {
  readonly code = 'RUNTIME_PROVIDER_INVALID' as const;
  readonly phase = 'runtime-port' as const;
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
    this.name = 'RuntimePortError';
  }
}

/**
 * resolveRuntimeProvider — 解析 `SYNOVA_RUNTIME_PROVIDER`。
 *
 * 契约:
 *   @input  raw — env 原值
 *   @output `'real'`（未设置时的缺省）或 `'stub'`
 *   @error  非法值 ⇒ `RuntimePortError`（**fail loud**，进程启动期 exit 1；不降级 real）
 *
 * 边界（刻意不做归一化）：
 *   · `undefined` ⇒ `'real'`（缺省真宿主）
 *   · `'real'` / `'stub'` **精确匹配**（区分大小写、**不 trim**）
 *   · 其余（含 `''`、`' smoke'`、`'REAL'`、`'Stub'`）⇒ 抛错
 */
export function resolveRuntimeProvider(raw: string | undefined): RuntimeProviderId {
  if (raw === undefined) return 'real';
  if (raw === 'real') return 'real';
  if (raw === 'stub') return 'stub';
  throw new RuntimePortError(
    `SYNOVA_RUNTIME_PROVIDER 非法值 ${JSON.stringify(raw)}（合法值: real | stub；未设置 ⇒ real）—— 不降级 real`,
  );
}
