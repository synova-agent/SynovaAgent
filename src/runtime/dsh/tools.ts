/**
 * src/runtime/dsh/tools.ts — 1A 的**只读领域工具**数据面与调用上下文。
 *
 * 边界（很重要）：
 *   · 数据来自**真实领域结构**（#1426 I-1）：`domain-context.ts` 只读 `graph_nodes`/`graph_triples`，
 *     本切片只产 ② 层（③ 观测／④ 依据 NOT DONE，条目恒 0）；不再有合成基线；
 *   · 身份/权限由服务端注入（一次性 token 绑定 runId/enterpriseId/userId/scope），
 *     工具入参 schema **不接受任何身份字段**；缺 ctx ⇒ fail-closed（UNAUTHORIZED）；
 *   · 真实模型外发／真实客户数据／生产部署仍是停点（本文件不触模型、不外发）。
 *
 * 契约（铁律 47）:
 *   @input   problemId（工具参数）＋ 服务端注入的 ToolCallContext（缺 ⇒ UNAUTHORIZED）
 *   @output  ContextSnapshot JSON（真实 ② 条目：$id/period/defVersion/status/visibility/source，
 *            #1459 T-A 增 relation/evidence 与 evidenceId 语义；count===0 ⇒ 返回字段 insufficient，不抛 error）
 *   @degraded 无：未知 problemId 返回显式 DOMAIN_EMPTY（不伪造空成功）；根可解析但 0 条目 ⇒ insufficient
 *            （`INSUFFICIENT_CONTEXT` 字段，不是 error）；DB 异常 ⇒ PERSISTENCE_ERROR
 *   @error   FORGED_IDENTITY / FORGED_PATH / UNAUTHORIZED / VALIDATION_ERROR / FORBIDDEN /
 *            DOMAIN_EMPTY / PERSISTENCE_ERROR
 */
import { randomBytes } from 'node:crypto';
import { systemClock } from '../../services/clock';
import { buildContextSnapshot } from './domain-context';
import { DshError } from './errors';

/** 服务端注入的调用上下文（只来自 token 解析，不接受工具入参）。 */
export interface ToolCallContext {
  enterpriseId: string;
  userId: string;
  scope: string;
  runId: string;
}

/** 工具入参允许的键（白名单；其余一律拒绝）。 */
const ALLOWED_ARG_KEYS: Record<string, readonly string[]> = {
  synova_context_get: ['problemId'],
};

/** 身份类越权参数（出现即 FORGED_IDENTITY）。 */
const FORBIDDEN_IDENTITY_KEYS = ['enterpriseId', 'userId', 'orgId', 'scope', 'tenantId', 'principal', 'evidenceId'];

/** 路径类越权参数（出现即 FORGED_PATH）。 */
const FORBIDDEN_PATH_KEYS = ['path', 'filePath', 'absPath', 'cwd', 'dir', 'directory', 'root'];

/** 1 跳关系：`type`←`graph_triples.predicate`；`direction`＝遍历方向（out＝根为 subject／in＝根为 object）。 */
export interface ContextRelation {
  type: string;
  direction: 'out' | 'in';
  edgeId: string;
}

/** 证据来源（行号级 `source_ref`，可回到扫描来源）。 */
export interface ContextEvidenceSource {
  ref: string;
}

/** 该对象自身最新扫描断言版本的依据：evidence_status／instance_state ＋ 逐条来源。 */
export interface ContextEvidence {
  evidenceStatus: string;
  instanceState: string;
  sources: ContextEvidenceSource[];
}

/** `count===0` 时的显式不足说明（返回字段，不是 error；桌面据此显示「不足以形成瓶颈假设」）。 */
export interface InsufficientContext {
  code: 'INSUFFICIENT_CONTEXT';
  reason: string;
  /** 机器可读缺项：neighbors／period／defVersion（兜底 items）。 */
  missing: string[];
}

/**
 * 真实领域 ContextSnapshot 条目（逐字段来源表见 `domain-context.ts` 文件头）。
 * 类型联合保留 '②'|'③'|'④'：本切片只产 ②，③④ 恒 0（NOT DONE）。
 */
export interface ContextSnapshotItem {
  layer: '②' | '③' | '④';
  $id: string;
  /** 恒 null：全仓零生产者（没有写路径给 ② 节点落 cycle 版本），不作为可证字段。 */
  cycleVersion: string | null;
  /** 恒 null：③ 观测本切片 NOT DONE（sentinel_events 无企业列/period/defVersion/status）。 */
  sentinelRun: string | null;
  period: string;
  defVersion: string;
  /**
   * 该条目自身的扫描证据 id（`scan_evidence_versions.evidence_id`，经断言版本连接）。
   * #1459 T-A 语义变更：由恒 null → 有证据行时非空；无证据行仍为 null（不补零）。
   */
  evidenceId: string | null;
  status: 'observed' | 'partial';
  visibility: 'enterprise';
  source: { kind: 'synova.domain'; api: 'synova.domain/v1' };
  /** 1 跳关系（`graph_triples`）；每个条目恒有，类型保留可选以兼容旧消费方。 */
  relation?: ContextRelation;
  /** 该对象自身的最新扫描断言依据；无断言版本 ⇒ 字段缺失（不是空对象）。 */
  evidence?: ContextEvidence;
}

export interface ContextSnapshot {
  /** 生产路径恒 false（合成基线已移除；任何合成兜底 = 停点级错误）。 */
  synthetic: false;
  problemId: string;
  /** 命中总数（截断前）；items 最多 200 条。 */
  count: number;
  /** count > items.length。 */
  truncated: boolean;
  items: ContextSnapshotItem[];
  /** 仅 `count===0` 时出现（根解析不到仍是 DOMAIN_EMPTY error，不是本字段）。 */
  insufficient?: InsufficientContext;
}

/**
 * 校验工具入参（身份/路径/白名单）。
 * @error FORBIDDEN 类参数或未知键 ⇒ typed error（调用方原样映射成 MCP 错误，不静默忽略）
 */
function validateToolArguments(toolName: string, args: Record<string, unknown>): void {
  for (const key of FORBIDDEN_IDENTITY_KEYS) {
    if (key in args) {
      throw new DshError('FORGED_IDENTITY', 'tool', `工具 ${toolName} 不接受身份参数 ${key}（身份由服务端注入）`, { retryable: false });
    }
  }
  for (const key of FORBIDDEN_PATH_KEYS) {
    if (key in args) {
      throw new DshError('FORGED_PATH', 'tool', `工具 ${toolName} 不接受路径参数 ${key}（只读授权目录由服务端决定）`, { retryable: false });
    }
  }
  const allowed = ALLOWED_ARG_KEYS[toolName];
  if (allowed === undefined) {
    throw new DshError('VALIDATION_ERROR', 'tool', `未登记的工具: ${toolName}`, { retryable: false });
  }
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw new DshError('VALIDATION_ERROR', 'tool', `工具 ${toolName} 不接受参数 ${key}`, { retryable: false });
    }
  }
}

/**
 * 工具处理：校验参数（**必须先于 ctx 检查**）→ 检查服务端注入的 ctx → 返回真实领域快照 JSON。
 *
 * 顺序契约（DEV DOC v3 §3.2 ＋ `tests/runtime/dsh/security-cases.test.ts` 顺序守护）：
 *   1. `validateToolArguments`（伪造身份/路径键、白名单）先 —— 2 实参直调也先抛 FORGED_*；
 *   2. ctx 检查后 —— 缺 ctx／token 未绑定 ⇒ `UNAUTHORIZED`（401，与 `src/mcp/http.ts` 事实一致，
 *      **不得**写成 FORGED_IDENTITY，身份不是工具入参的问题）。
 * @error FORGED_IDENTITY / FORGED_PATH / UNAUTHORIZED / VALIDATION_ERROR / FORBIDDEN /
 *        DOMAIN_EMPTY / PERSISTENCE_ERROR（后三者由 `buildContextSnapshot` 抛）
 */
export function handleDomainToolCall(toolName: string, args: Record<string, unknown>, ctx: ToolCallContext): string {
  validateToolArguments(toolName, args);
  if (!ctx) {
    throw new DshError('UNAUTHORIZED', 'tool', '缺少服务端注入的调用上下文（token 未绑定）：工具身份不接受入参', { retryable: false });
  }
  if (toolName === 'synova_context_get') {
    const problemId = args.problemId;
    if (typeof problemId !== 'string' || problemId.length === 0) {
      throw new DshError('VALIDATION_ERROR', 'tool', '缺少 problemId', { retryable: false });
    }
    return JSON.stringify(buildContextSnapshot(ctx, problemId));
  }
  throw new DshError('VALIDATION_ERROR', 'tool', `未登记的工具: ${toolName}`, { retryable: false });
}

// ═══ 一次性 token（绑定 run 上下文；服务端身份注入的唯一载体）══════════════

interface TokenEntry {
  context: ToolCallContext;
  expiresAt: number;
}

/** 默认 TTL：10 分钟（一次 run 足够；过期即拒，不静默延长）。 */
const DEFAULT_TOKEN_TTL_MS = 10 * 60_000;

/**
 * 回环 MCP 的 bearer token 存储。
 * 一次 run 一个 token；revoke 后立即失效（token ≠ 长期凭证，也绝不写日志）。
 */
export class ToolTokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TOKEN_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** 签发（32 hex，仅回环使用）。 */
  issue(context: ToolCallContext): string {
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, { context, expiresAt: systemClock.now() + this.ttlMs });
    return token;
  }

  /** 解析；无效/过期/已撤销 ⇒ null（调用方统一 401）。 */
  resolve(token: string): ToolCallContext | null {
    const entry = this.tokens.get(token);
    if (entry === undefined) return null;
    if (entry.expiresAt <= systemClock.now()) {
      this.tokens.delete(token);
      return null;
    }
    return entry.context;
  }

  /** 撤销（run 终态后由路由调用）。 */
  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /** 当前有效 token 数（诊断/测试用；不暴露 token 值）。 */
  get size(): number {
    return this.tokens.size;
  }
}

// ═══ 真实领域 API 模式（T4 停点：本批只保留 fail-closed 壳）══════════════════
