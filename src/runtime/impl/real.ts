/**
 * src/runtime/impl/real.ts — 真实现 Provider（宿主＝本进程真实工具派发 ＋ 真实审批缝）
 *
 * 契约（铁律 47）:
 *   @input    — `createRealPort({ dispatch })`：dispatch 由 MCP 装配层注入（生产＝`handleToolCall`）
 *   @output   — `RuntimePort`：`providerId==='real'`
 *   @degraded — 无：真宿主**不吞错、不降级**（dispatch 抛错原样 reject，由既有 MCP SDK 映射为 JSON-RPC error）
 *   @error    — 不新增错误类型；审批错误语义完全是 `src/runtime/approval-seam.ts` 的既有语义
 *   @authority — 只允许 `src/mcp/index.ts`（装配）与 tests 构造；本文件不改任何领域逻辑
 */
import { requestApproval } from '../approval-seam';
import type { ApprovalOutcome, ApprovalRequest } from '../approval-seam';
import type { RuntimePort, ToolDispatcher } from '../port';

/** real Provider 的构造参数 */
export interface RealPortOptions {
  /** 工具派发目标（生产＝`handleToolCall`；测试可注入探针） */
  dispatch: ToolDispatcher;
}

/**
 * createRealPort — 构造真宿主端口。
 *
 * 两条不可让渡的性质（判据在 `tests/runtime/impl/real.test.ts`）:
 *   ① `callTool` **就是** `dispatch`（同一函数引用）⇒ 不包一层 try/catch，不吞错、不改写返回值；
 *   ② `requestApproval` **原样委托** `approval-seam.requestApproval`（不注入 ask、不改策略、不新增语义）。
 *
 * @param options - 注入的派发目标
 * @returns 真宿主 `RuntimePort`
 */
export function createRealPort(options: RealPortOptions): RuntimePort {
  const { dispatch } = options;
  return {
    providerId: 'real',
    callTool: dispatch,
    requestApproval: (req?: ApprovalRequest): Promise<ApprovalOutcome> => requestApproval(req),
  };
}
