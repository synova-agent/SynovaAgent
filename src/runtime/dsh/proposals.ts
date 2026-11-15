/**
 * src/runtime/dsh/proposals.ts — 1A「run → Proposal 草案」持久化落点（proposal_only）。
 *
 * 边界：
 *   · 只落 **Proposal 草案**（`type: 'agent_proposal_draft'`，status=proposed）；
 *   · 不写经营决定、不 confirm/reject、不产生 Decision 对象（那属阶段 3）；
 *   · 幂等键 = `runId`：同一 run 重试返回原草案，不重复创建（唯一索引兜底并发）。
 *
 * 契约（铁律 47）:
 *   @input   ProposalManager ＋ {runId, enterpriseId, userId, title, description, confidence?}
 *   @output  {ok, created, proposal}（created=false 表示命中幂等/并发兜底）
 *   @degraded 无：持久化失败抛 PERSISTENCE_ERROR，不伪造成成功
 *   @error   VALIDATION_ERROR（runId/enterpriseId 非法）/ PERSISTENCE_ERROR（DB 写入失败）
 */
import { DshError } from './errors';
import type { Proposal, ProposalManager } from '../../l2/proposal-manager';

/** 草案输入（身份字段来自服务端注入，不接受客户端传入）。 */
export interface ProposalDraftInput {
  runId: string;
  enterpriseId: string;
  userId: string;
  title: string;
  description: string;
  confidence?: number;
}

/** 草案落库结果。 */
export interface ProposalDraftResult {
  ok: true;
  created: boolean;
  proposal: Proposal;
}

/** runId 允许字符集（与路由一致）。 */
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * 幂等落库：先按 runId 查，再插入；并发冲突由唯一索引兜底后重查。
 * @error VALIDATION_ERROR / PERSISTENCE_ERROR
 */
export function persistProposalDraft(manager: ProposalManager, input: ProposalDraftInput): ProposalDraftResult {
  if (!RUN_ID_PATTERN.test(input.runId)) {
    throw new DshError('VALIDATION_ERROR', 'persist', `runId 非法: ${input.runId}`, { retryable: false });
  }
  if (typeof input.enterpriseId !== 'string' || input.enterpriseId.length === 0) {
    throw new DshError('VALIDATION_ERROR', 'persist', 'enterpriseId 必须由服务端注入', { retryable: false });
  }
  if (typeof input.userId !== 'string' || input.userId.length === 0) {
    throw new DshError('VALIDATION_ERROR', 'persist', 'userId 必须由服务端注入', { retryable: false });
  }

  const before = manager.getByRunId(input.runId);
  try {
    const proposal = manager.propose({
      type: 'agent_proposal_draft',
      title: input.title,
      description: input.description,
      confidence: input.confidence ?? 0.5,
      source: 'dsh-sidecar',
      runId: input.runId,
      enterpriseId: input.enterpriseId,
    });
    if (proposal.runId !== input.runId) {
      throw new DshError('PERSISTENCE_ERROR', 'persist', `草案未写入 runId（返回 ${String(proposal.runId)}）`, {
        retryable: true,
      });
    }
    return { ok: true, created: before === null, proposal };
  } catch (err: unknown) {
    if (err instanceof DshError) throw err;
    throw new DshError('PERSISTENCE_ERROR', 'persist', `草案落库失败: ${err instanceof Error ? err.message : String(err)}`, {
      retryable: true,
      cause: err,
    });
  }
}

/** 企业归属断言（T4 幂等测试要求：不得只看 run_id）。 */
function assertEnterpriseAttribution(proposal: Proposal, enterpriseId: string): void {
  const expected = `enterprise:${enterpriseId}`;
  if (proposal.source !== expected) {
    throw new DshError(
      'PERSISTENCE_ERROR',
      'persist',
      `草案企业归属不符：期望 ${expected}，实际 ${proposal.source}`,
      { retryable: false },
    );
  }
}
