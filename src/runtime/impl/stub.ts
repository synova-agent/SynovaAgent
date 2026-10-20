/**
 * src/runtime/impl/stub.ts — 替身 Provider（假宿主：只支持 `sentinel_list`）
 *
 * 用途：证明宪章 P11「换掉宿主，领域层一行不改」——同一套领域断言在假宿主下仍成立（M5 卡2 / #703）。
 *
 * 契约（铁律 47）:
 *   @input    — `createStubPort({ ask? })`：ask 是宿主应答端口（缺省 = 无人应答）
 *   @output   — `RuntimePort`：`providerId==='stub'`；
 *               `callTool('sentinel_list')` ⇒ `JSON.stringify(await listSentinels())`（**复用 L2 出口**，
 *               不做第二套领域逻辑）；其它工具 ⇒ 结构化 `{ok:false,error:'RUNTIME_TOOL_UNSUPPORTED',tool,degraded:true}`
 *   @degraded — 假宿主**不造假**：未支持工具以 typed 错误码诚实返回（不静默吞、不装作成功）
 *   @error    — `requestApproval` 不抛；语义完全委托 `approval-seam`（默认无人应答 ⇒ 确定的拒）
 *   @authority — 只允许 `tests/runtime/**`（直接构造）与 MCP 全链路测试（env 显式
 *               `SYNOVA_RUNTIME_PROVIDER=stub`）构造；**生产默认 real**
 *
 * 副作用（如实声明）：不写文件、不落库、不引随机数 ⇒ 同一输入同一结论（可复跑）。
 */
import { requestApproval } from '../approval-seam';
import type { ApprovalAskPort, ApprovalOutcome, ApprovalRequest } from '../approval-seam';
import type { RuntimePort } from '../port';
import { listSentinels } from '../../agent/sentinel-service';

/**
 * 缺省宿主应答端口 —— **无人应答**。
 *
 * 为什么要显式注入而不是省略：`approval-seam` 对"应答端口缺失"与"端口返回 undefined"都按
 * fail-closed 判「确定的拒」；显式注入让"替身宿主没有人"成为可读事实，而不是隐式缺省。
 */
const NO_ANSWER: ApprovalAskPort = () => undefined;

/** stub Provider 的构造参数 */
export interface StubPortOptions {
  /** 宿主应答端口（缺省 ⇒ 无人应答 ⇒ 拒）；注入 `() => 'approved'` 可验证"有答即准" */
  ask?: ApprovalAskPort;
}

/**
 * createStubPort — 构造假宿主端口。
 *
 * @param options - 可选应答端口注入
 * @returns 假宿主 `RuntimePort`
 */
export function createStubPort(options?: StubPortOptions): RuntimePort {
  const ask: ApprovalAskPort = options?.ask ?? NO_ANSWER;
  return {
    providerId: 'stub',
    async callTool(name: string, _args: Record<string, unknown>): Promise<string> {
      // 唯一被真支持的领域出口：与 real 走同一 L2 函数（不是"按 manifest 造清单"）
      if (name === 'sentinel_list') {
        return JSON.stringify(await listSentinels());
      }
      // 假宿主不造假：未支持 ⇒ typed 结构化错误（不是 JSON-RPC 崩溃，也不是空成功）
      return JSON.stringify({
        ok: false,
        error: 'RUNTIME_TOOL_UNSUPPORTED',
        tool: name,
        degraded: true,
      });
    },
    requestApproval: (req?: ApprovalRequest): Promise<ApprovalOutcome> =>
      requestApproval({ ...(req ?? {}), ask }),
  };
}
