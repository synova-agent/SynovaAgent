/**
 * agent/sentinel-service.ts — Sentinel 数据服务 (L2)
 * @state: real
 *
 * L2 编排层对 L1 暴露的哨兵发现 + 信号 + 手动触发接口。
 * L1 (routes/) 通过此服务获取哨兵运行结果，不直接访问 L3 (sentinel/runner)。
 *
 * 铁律 39: L1→L2 ✅ | L2→L3 ✅
 */

import type { SentinelFinding, SentinelCheckResult } from '../sentinel/types';
import type { AggregatedSignal } from '../sentinel/signal-aggregator';
import {
  getGlobalSentinelRunner,
  type GaManualSignalInput,
  type TicketRow,
  type TicketStatus,
  type TicketTransitionTarget,
  type TransitionResult,
} from '../sentinel/runner';
import { aggregateSignals } from '../sentinel/signal-aggregator';
import { createLogger } from '@synova/logger';

const log = createLogger('agent/sentinel-service');

// ═══ Types ═══

export interface FindingsQuery {
  sentinelId?: string;
  severity?: 'critical' | 'warning' | 'info';
  limit?: number;
  offset?: number;
}

export interface FindingsResponse {
  ok: boolean;
  total: number;
  findings: Array<{
    sentinelId: string;
    sentinelName: string;
    finding: SentinelFinding;
    checkedAt: string;
  }>;
}

export interface SignalsResponse {
  ok: boolean;
  total: number;
  criticalCount: number;
  warningCount: number;
  signals: AggregatedSignal[];
}

export interface RunOnceResponse {
  ok: boolean;
  sentinelId: string;
  result: SentinelCheckResult | null;
  error?: string;
}

/** 哨兵清单项（D595 MCP sentinel_list 消费形状） */
export interface SentinelListItem {
  id: string;
  name: string;
  layer: string;
  priority: string;
  mode: string;
}

/** 哨兵清单响应（D595 L2 出口 listSentinels 契约形状） */
export interface SentinelListResponse {
  ok: boolean;
  total: number;
  sentinels: SentinelListItem[];
}

export interface ExpertReportsResponse {
  ok: boolean;
  reports: Array<{
    sentinelId: string;
    expert: string;
    summary: string;
    confidence: number;
    checkedAt: string;
  }>;
}

/**
 * 工单视图（D580 8-2 扩展）: 旧字段 id/title/severity/createdAt 保持（向后兼容, spec §5.2）;
 * 新增 status 与 resolvedAt?（表行权威字段）。
 */
export interface SentinelTicketView {
  id: string;
  title: string;
  /** J5 / #405：触发工单的哨兵信号 id（台账读回的 nodeId 同口径：signalId 优先，工单 id 兜底） */
  signalId?: string;
  severity: 'critical' | 'warning' | 'info';
  createdAt: string;
  status: TicketStatus;
  resolvedAt?: string;
}

/**
 * 工单查询响应（D580 8-2: source + degraded 双标记 — 裁决 3, 结构化字段优先于约定字符串）:
 *   source: 'table'           — 表有行（权威路径, 写读同源）
 *   source: 'memory-fallback' — 表空/db 失败 → 内存派生兜底（+ degraded: true）
 */
export interface TicketsResponse {
  ok: boolean;
  source: 'table' | 'memory-fallback';
  degraded?: boolean;
  tickets: SentinelTicketView[];
}

/** 工单状态机迁移目标枚举（L1 body.to 校验依据） */
export const TRANSITION_TARGETS = ['acknowledged', 'resolved', 'dismissed'] as const;

/**
 * L1 类型出口（铁律 39 修复）: TicketStatus 重导出自 L3 runner——L1 routes 只经 L2 消费类型,
 * 禁止直触 '../sentinel/runner'（CI check-architecture L1→L3 拦截实证 2026-09-06, type-only import 同拦）。
 */
export type { TicketStatus };

// ═══ D603 L1 出口扩展（扫描报告 §三 簇2 哨兵簇）: GA 标注准确率经 L2 消费 ═══
// routes/ga-annotations 不再直触 '../sentinel/sentinel-accuracy'（L1→L3，基线存量已清）。
export { computeSentinelAccuracy } from '../sentinel/sentinel-accuracy';
export type { AnnotationRecord as SentinelAccuracyAnnotation } from '../sentinel/sentinel-accuracy';

/**
 * transitionSentinelTicket 返回（D580 8-4）: runner TransitionResult 原样传播 + L2 专属分类:
 *   INVALID_TARGET（to 非法枚举 → 路由 400）/ SENTINEL_RUNNER_UNAVAILABLE（runner 未初始化 → 503）。
 */
export type SentinelTicketTransitionResult =
  | TransitionResult
  | { ok: false; error: 'INVALID_TARGET' }
  | { ok: false; degraded: true; error: 'SENTINEL_RUNNER_UNAVAILABLE' };

/** D551: GA 手动信号注入结果（degraded 显式传播，铁律 31） */
export interface ManualSignalInjectionResult {
  ok: boolean;
  /** 注入的 finding id（可在 GET /api/sentinel/findings 按 sentinelId='ga-manual' 查） */
  findingId: string | null;
  degraded?: boolean;
  error?: string;
}

// ═══ Service ═══

/** 查询哨兵发现列表 */
export function getSentinelFindings(query: FindingsQuery = {}): FindingsResponse {
  const runner = getGlobalSentinelRunner();
  if (!runner) {
    return { ok: false, total: 0, findings: [] };
  }

  try {
    const records = runner.getRecentResults();
    const all: Array<{ sentinelId: string; sentinelName: string; finding: SentinelFinding; checkedAt: string }> = [];

    for (const [sentinelId, runs] of records) {
      for (const run of runs) {
        if (!run.result.findings) continue;
        for (const finding of run.result.findings) {
          if (query.severity && finding.severity !== query.severity) continue;
          all.push({
            sentinelId,
            sentinelName: run.sentinelName,
            finding,
            checkedAt: run.result.checkedAt,
          });
        }
      }
    }

    // 排序: critical 优先, 按 detectedAt
    all.sort((a, b) => {
      const sev: Record<string, number> = { emergency: 0, critical: 0, warning: 1, info: 2 };
      const sa = sev[a.finding.severity] ?? 3;
      const sb = sev[b.finding.severity] ?? 3;
      if (sa !== sb) return sa - sb;
      return b.finding.detectedAt.localeCompare(a.finding.detectedAt);
    });

    const total = all.length;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const findings = all.slice(offset, offset + limit);

    return { ok: true, total, findings };
  } catch (err: unknown) {
    log.warn({ err }, 'getSentinelFindings 失败 — degraded');
    return { ok: false, total: 0, findings: [] };
  }
}

/** 获取聚合信号 */
export function getAggregatedSignals(): SignalsResponse {
  const runner = getGlobalSentinelRunner();
  if (!runner) return { ok: false, total: 0, criticalCount: 0, warningCount: 0, signals: [] };

  try {
    const allFindings: SentinelFinding[] = [];
    for (const runs of runner.getRecentResults().values()) {
      for (const run of runs) {
        if (run.result.findings) allFindings.push(...run.result.findings);
      }
    }
    if (allFindings.length === 0) return { ok: true, total: 0, criticalCount: 0, warningCount: 0, signals: [] };

    // 包装为 SentinelCheckResult 供 aggregateSignals 消费
    const checkResults: import('../sentinel/types').SentinelCheckResult[] = [{
      sentinelId: 'sentinel-service',
      ok: true,
      findings: allFindings,
      durationMs: 0,
      checkedAt: new Date().toISOString(),
    }];
    const aggregated = aggregateSignals(checkResults);
    return {
      ok: true,
      total: aggregated.signals.length,
      criticalCount: aggregated.stats.criticalSignals,
      warningCount: aggregated.signals.filter(s => s.severity === 'warning').length,
      signals: aggregated.signals,
    };
  } catch (err: unknown) {
    log.warn({ err }, 'getAggregatedSignals 失败 — degraded');
    return { ok: false, total: 0, criticalCount: 0, warningCount: 0, signals: [] };
  }
}

/**
 * listSentinels — 哨兵清单查询（D595 新增 L2 出口，供 MCP sentinel_list 消费）
 * 契约:
 *   @input  — 无参
 *   @output — { ok: true, total, sentinels: Array<{id,name,layer,priority,mode}> }
 *             （layer 直读 config.layer——SentinelConfig 已含该字段（sentinel-loader.ts:247
 *              字面量赋值证据），缺失时回退 category；禁断言直读，CT-46）
 *   @degraded — registry 访问失败 → log.warn + { ok: false, total: 0, sentinels: [] }
 *               （铁律 24 不静默）
 *   @error  — 不抛（分类返回，模式对齐 getSentinelFindings 降级路径）
 */
export async function listSentinels(): Promise<SentinelListResponse> {
  try {
    const { getSentinelRegistry } = await import('../sentinel/registry');
    const sentinels = getSentinelRegistry().list().map(s => ({
      id: s.config.id,
      name: s.config.name,
      layer: s.config.layer || s.config.category,
      priority: s.config.priority,
      mode: s.config.mode,
    }));
    return { ok: true, total: sentinels.length, sentinels };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, '[listSentinels] registry 访问失败 — degraded 空清单');
    return { ok: false, total: 0, sentinels: [] };
  }
}

/** 手动触发单个哨兵运行 (ID 兼容: 同时接受 'sentinel-xxx' 和 'xxx' 格式) */
export async function runSentinelOnce(sentinelId: string): Promise<RunOnceResponse> {
  try {
    const { getSentinelRegistry } = await import('../sentinel/registry');
    const registry = getSentinelRegistry();
    // 先尝试原始 ID, 再尝试带 sentinel- 前缀的完整 ID
    let sentinel = registry.get(sentinelId);
    if (!sentinel && !sentinelId.startsWith('sentinel-')) {
      sentinel = registry.get(`sentinel-${sentinelId}`);
      if (sentinel) sentinelId = `sentinel-${sentinelId}`;
    }
    if (!sentinel) return { ok: false, sentinelId, result: null, error: `哨兵不存在: ${sentinelId}` };

    // GS-05 告警闭环（D356 缺口修复）: runner 可用时走 runner 管线——runOnce（记录运行
    // → recentResults）+ aggregateAndDispatch（信号聚合 → 专家 → sentinel_tickets 工单闭环）。
    // 复用现有管线（I2 单源），不重复工单逻辑。降级（铁律 24/31）: runner 不可用/管线失败
    // → 回退直连 check（保持 D453 行为，log.warn 不静默）。
    const { getGlobalSentinelRunner } = await import('../sentinel/runner');
    const runner = getGlobalSentinelRunner();
    if (runner) {
      try {
        const runResult = await runner.runOnce(sentinelId);
        if (runResult) {
          // 告警闭环: 记录已落 → 聚合信号 → 专家诊断 → 工单（critical/emergency 自动 INSERT OR REPLACE）
          await runner.aggregateAndDispatch();
          return { ok: true, sentinelId, result: runResult };
        }
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId }, '[runSentinelOnce] runner 管线失败 — 降级直连 check');
      }
    }

    // D453: 修复 db:undefined → 哨兵空 store。构造 GraphStore 上下文（对齐 runner.ts:835-852）。
    // 降级: GraphStore 构造失败 → 回退原始 db（log.warn，不静默，铁律 24/31）。
    const { getDatabase } = await import('../init/engine-context');
    const rawDb = getDatabase();
    let graphCtx: unknown = rawDb;
    if (typeof rawDb === 'object' && rawDb !== null && !('queryNodes' in rawDb)) {
      try {
        const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
        graphCtx = new SqliteGraphStore(rawDb);
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, '[runSentinelOnce] GraphStore 创建失败 — 降级至原始 db');
        graphCtx = rawDb;
      }
    }
    const context = { db: graphCtx, now: new Date(), registry };
    const result = await sentinel.check(context);
    return { ok: true, sentinelId, result };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, sentinelId, result: null, error: msg };
  }
}

/** 获取专家报告 (从最近哨兵运行结果提取) */
export function getSentinelExpertReports(): ExpertReportsResponse {
  const runner = getGlobalSentinelRunner();
  if (!runner) return { ok: true, reports: [] };
  try {
    const reports: ExpertReportsResponse['reports'] = [];
    for (const [sentinelId, runs] of runner.getRecentResults()) {
      for (const run of runs) {
        if (!run.result.findings) continue;
        for (const f of run.result.findings) {
          reports.push({
            sentinelId,
            expert: f.relatedNodeId || '专家',
            summary: f.description.slice(0, 200),
            confidence: 0.7,
            checkedAt: f.detectedAt,
          });
        }
      }
    }
    return { ok: true, reports: reports.slice(0, 50) };
  } catch (err: unknown) {
    log.warn({ err }, 'getSentinelExpertReports 失败 — degraded');
    return { ok: true, reports: [] };
  }
}

/** 表行 → 视图映射（severity emergency→critical 对齐内存派生先例; title 按 spec §5.2 派生） */
function rowToTicketView(row: TicketRow): SentinelTicketView {
  let title = row.signal_id; // 兜底: 无 diagnosis 或解析失败 → signal_id
  if (row.diagnosis) {
    try {
      const parsed = JSON.parse(row.diagnosis) as { title?: unknown; summary?: unknown };
      const parsedTitle = typeof parsed.title === 'string' ? parsed.title : undefined;
      const parsedSummary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
      title = parsedTitle ?? (parsedSummary !== undefined ? parsedSummary.slice(0, 80) : row.signal_id);
    } catch (err: unknown) {
      // JSON 损坏（区别于 diagnosis 缺失）: log.warn + signal_id 兜底 — 铁律 24 不静默
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, ticketId: row.id }, '[getSentinelTickets] diagnosis JSON 损坏 — signal_id 兜底');
    }
  }
  const view: SentinelTicketView = {
    id: row.id,
    title,
    // J5 / #405：暴露 signalId —— 台账读回需与写侧 nodeId 同口径（signal_id 优先，工单 id 兜底）
    signalId: row.signal_id,
    severity: row.severity === 'warning' ? 'warning' : row.severity === 'info' ? 'info' : 'critical',
    createdAt: row.created_at,
    status: row.status,
  };
  if (row.resolved_at) view.resolvedAt = row.resolved_at;
  return view;
}

/** 内存派生兜底（降级专用）: 从 runner 内存 findings 派生伪工单（旧 getSentinelTickets 派生逻辑, 唯一引用点） */
function deriveTicketsFromMemory(runner: NonNullable<ReturnType<typeof getGlobalSentinelRunner>>, status?: TicketStatus): SentinelTicketView[] {
  const tickets: SentinelTicketView[] = [];
  for (const [sentinelId, runs] of runner.getRecentResults()) {
    for (const run of runs) {
      if (!run.result.findings) continue;
      for (const f of run.result.findings) {
        if (f.severity !== 'critical' && f.severity !== 'warning') continue;
        // 内存派生项 = 未处理的 finding 投影 → open 语义（status 过滤在兜底路径同样真实生效）
        if (status && status !== 'open') continue;
        tickets.push({
          id: `${sentinelId}_${f.id}`,
          title: f.title,
          severity: f.severity === 'critical' ? 'critical' : 'warning',
          createdAt: f.detectedAt,
          status: 'open',
        });
      }
    }
  }
  return tickets.slice(0, 20); // 保持旧派生 20 条上限（向后兼容）
}

/**
 * getSentinelTickets — 工单查询（D580 8-2: 表为准, 内存只兜底）
 * 契约:
 *   @input  — status?: TicketStatus（透传; 表路径 SQL WHERE, fallback 路径内存过滤 — 双路径真实生效）
 *   @output — { ok: true, source: 'table', tickets } — 表有行（权威路径）
 *             { ok: true, source: 'memory-fallback', degraded: true, tickets } — 表空或读失败
 *   @degraded — 表空（0 行）或 db 异常 → 内存派生 fallback + degraded: true + log
 *               （铁律 24: 区分 db 失败[warn] 与表空[info 级 fallback]；两者都显式标注）
 *   @error  — 不抛（内部全捕获，降级形状完整）
 */
export function getSentinelTickets(status?: TicketStatus): TicketsResponse {
  const runner = getGlobalSentinelRunner();
  if (!runner) {
    log.warn('[getSentinelTickets] runner 未初始化 — 无数据源, degraded 空列表');
    return { ok: true, source: 'memory-fallback', degraded: true, tickets: [] };
  }

  // ① 表读优先（写读同源 — K3 P2-3 修复）
  try {
    const rows = runner.listSentinelTickets(status);
    if (rows.length > 0) {
      return { ok: true, source: 'table', tickets: rows.map(rowToTicketView) };
    }
    // ② 表空即降级（裁决 3: 健康系统 critical 历史应为表行, 0 行通常意味着写路径故障或冷启动
    //    — 降级标注比静默空列表诚实; info 级, 非错误）
    log.info({ status: status ?? 'all' }, '[getSentinelTickets] 工单表空 — 内存派生兜底（degraded）');
    return { ok: true, source: 'memory-fallback', degraded: true, tickets: deriveTicketsFromMemory(runner, status) };
  } catch (err: unknown) {
    // ③ db 失败 → 内存派生兜底（warn 级 — 区分于表空 info, 铁律 24/31）
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, '[getSentinelTickets] 工单表读取失败 — 内存派生兜底（degraded）');
    try {
      return { ok: true, source: 'memory-fallback', degraded: true, tickets: deriveTicketsFromMemory(runner, status) };
    } catch (memErr: unknown) {
      const memMsg = memErr instanceof Error ? memErr.message : String(memErr);
      log.warn({ err: memMsg }, '[getSentinelTickets] 内存派生兜底失败 — 返回 degraded 空列表');
      return { ok: true, source: 'memory-fallback', degraded: true, tickets: [] };
    }
  }
}

/**
 * transitionSentinelTicket — 工单状态机迁移（D580 8-4 L2 入口, 模式对齐 getSentinelTickets 的
 * 全局单例 runner 访问, 不绕层直触 L3, 铁律 39）。
 *
 * 契约:
 *   @input  — ticketId: string; to: string（原始 body 值, 枚举校验在此）
 *   @output — runner TransitionResult 原样传播（含 degraded）; to 非法 → { ok:false, error:'INVALID_TARGET' };
 *             runner 未初始化 → { ok:false, degraded:true, error:'SENTINEL_RUNNER_UNAVAILABLE' }
 *   @degraded — runner 不可用/runner db 失败 → degraded 标注传播（铁律 31 全链）
 *   @error  — 不抛（分类返回, HTTP 映射在 L1）
 */
export function transitionSentinelTicket(ticketId: string, to: string): SentinelTicketTransitionResult {
  if (!(TRANSITION_TARGETS as readonly string[]).includes(to)) {
    return { ok: false, error: 'INVALID_TARGET' };
  }
  const runner = getGlobalSentinelRunner();
  if (!runner) {
    log.warn({ ticketId }, '[transitionSentinelTicket] runner 未初始化 — 迁移降级（503）');
    return { ok: false, degraded: true, error: 'SENTINEL_RUNNER_UNAVAILABLE' };
  }
  return runner.transitionTicket(ticketId, to as TicketTransitionTarget);
}

/**
 * D551: GA 手动信号注入（L2 编排入口 — L1 路由专用，模式对齐 getSentinelFindings 的
 * 全局单例 runner 访问，不绕层直触 L3，铁律 39）。
 *
 * 契约:
 *   @input  — GaManualSignalInput（severity 1-10 / confidence 0-100；越界校验在路由层）
 *   @output — ManualSignalInjectionResult；ok=true 时 findingId 可在 /api/sentinel/findings 查
 *   @degraded — runner 未初始化 → log.warn + {ok:false, findingId:null, degraded:true}
 *               （对齐 getSentinelFindings L79-84 模式，不静默，铁律 24/31）
 *   @error  — 不抛（runner 注入异常 → log.error + degraded 返回）
 */
export function injectManualSignal(input: GaManualSignalInput): ManualSignalInjectionResult {
  const runner = getGlobalSentinelRunner();
  if (!runner) {
    log.warn({ signalType: input.signalType, gaId: input.gaId }, '[injectManualSignal] runner 未初始化 — 注入降级');
    return { ok: false, findingId: null, degraded: true, error: 'SENTINEL_RUNNER_UNAVAILABLE' };
  }
  try {
    return runner.injectManualFinding(input);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, signalType: input.signalType }, '[injectManualSignal] 注入异常 — degraded');
    return { ok: false, findingId: null, degraded: true, error: msg };
  }
}
