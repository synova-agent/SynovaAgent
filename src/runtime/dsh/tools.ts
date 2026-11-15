/**
 * src/runtime/dsh/tools.ts — 1A 的**合成只读领域工具**数据面与调用上下文。
 *
 * 边界（很重要）：
 *   · 这里的数据是**合成基线**（`synthetic: true`），只用于 1A 离线验收，
 *     不得进入生产路径，也不代表客户真值；
 *   · 身份/权限由服务端注入（一次性 token 绑定 runId/enterpriseId/userId/scope），
 *     工具入参 schema **不接受任何身份字段**；
 *   · 真实的 Kimi Code 领域 API 接入属 T4 停点（本批只保留 fail-closed 的 real 模式壳）。
 *
 * 契约（铁律 47）:
 *   @input   problemId（工具参数）＋ 服务端注入的 ToolCallContext
 *   @output  ContextSnapshot JSON（带 layer/$id/version/period/evidenceId/status/visibility/source）
 *   @degraded 无：未知 problemId 返回显式 DOMAIN_EMPTY（不伪造空成功）
 *   @error   FORGED_IDENTITY / FORGED_PATH / VALIDATION_ERROR / REAL_ADAPTER_NOT_CONFIGURED
 */
import { randomBytes } from 'node:crypto';
import { systemClock } from '../../services/clock';
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

/** 合成 ContextSnapshot（独立 golden 见 tests/runtime/dsh/fixtures/synova-context-get.json）。 */
export interface ContextSnapshotItem {
  layer: '②' | '③' | '④';
  $id: string;
  cycleVersion: string;
  sentinelRun: string;
  period: string;
  defVersion: string;
  evidenceId: string;
  status: 'observed' | 'partial' | 'stale';
  visibility: 'enterprise';
  source: { kind: 'synova.domain'; api: 'synthetic-context-v1' };
}

export interface ContextSnapshot {
  synthetic: true;
  problemId: string;
  count: number;
  items: ContextSnapshotItem[];
}

const SYNTHETIC_PROBLEM_ID = 'problem-revenue-health-2026q3';

/** 合成基线（3 条：② 结构 / ③ 观测 / ④ 依据），不随运行变化。 */
const SYNTHETIC_ITEMS: ContextSnapshotItem[] = [
  {
    layer: '②',
    $id: 'ontology.entity.sales_revenue',
    cycleVersion: 'cycle-sales@v3',
    sentinelRun: 'sr-2026-11-14T02:00:00Z',
    period: '2026-07',
    defVersion: 'def-2026.10',
    evidenceId: 'ev-2026-11-13-001',
    status: 'observed',
    visibility: 'enterprise',
    source: { kind: 'synova.domain', api: 'synthetic-context-v1' },
  },
  {
    layer: '③',
    $id: 'sentinel.sales_four_totals',
    cycleVersion: 'cycle-sales@v3',
    sentinelRun: 'sr-2026-11-14T02:00:00Z',
    period: '2026-07',
    defVersion: 'def-2026.10',
    evidenceId: 'ev-2026-11-13-002',
    status: 'partial',
    visibility: 'enterprise',
    source: { kind: 'synova.domain', api: 'synthetic-context-v1' },
  },
  {
    layer: '④',
    $id: 'param.sales_gross_margin',
    cycleVersion: 'cycle-sales@v3',
    sentinelRun: 'sr-2026-11-14T02:00:00Z',
    period: '2026-07',
    defVersion: 'def-2026.10',
    evidenceId: 'ev-2026-11-13-003',
    status: 'observed',
    visibility: 'enterprise',
    source: { kind: 'synova.domain', api: 'synthetic-context-v1' },
  },
];

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
 * 直接领域调用（T3 的「与直接领域调用一致」基线）：返回合成 ContextSnapshot。
 * 未知 problemId ⇒ 显式空（`ok:false`/DOMAIN_EMPTY），不返回零对象成功。
 */
function getSyntheticContext(problemId: string): ContextSnapshot {
  if (!/^[a-z0-9-]{3,64}$/.test(problemId)) {
    throw new DshError('VALIDATION_ERROR', 'tool', `problemId 非法: ${problemId}`, { retryable: false });
  }
  if (problemId !== SYNTHETIC_PROBLEM_ID) {
    throw new DshError('DOMAIN_EMPTY', 'tool', `problemId ${problemId} 无合成基线（显式空，不伪造数据）`, { retryable: false });
  }
  return {
    synthetic: true,
    problemId,
    count: SYNTHETIC_ITEMS.length,
    items: SYNTHETIC_ITEMS.map(item => ({ ...item })),
  };
}

/** 工具处理：校验参数 → 返回 JSON 文本（MCP content[0].text）。 */
export function handleDomainToolCall(toolName: string, args: Record<string, unknown>): string {
  validateToolArguments(toolName, args);
  if (toolName === 'synova_context_get') {
    const problemId = args.problemId;
    if (typeof problemId !== 'string') {
      throw new DshError('VALIDATION_ERROR', 'tool', '缺少 problemId', { retryable: false });
    }
    return JSON.stringify(getSyntheticContext(problemId));
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
