/**
 * sentinel/runner.ts — SentinelRunner 调度框架 (P1-4)
 *
 * 桥接 Sentinel 接口与 CronScheduler:
 *   1. 从 SentinelRegistry 读取所有 cron-mode 哨兵
 *   2. 为每个哨兵注册 Cron 任务
 *   3. 执行 check() → 收集发现 → 记录日志
 *   4. 单个哨兵失败不影响其他 (degraded 传播)
 *
 * @state: real — 生产可用, 与现有 CronScheduler 集成
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CronScheduler } from '../cron/scheduler';
import type { Sentinel, SentinelCheckResult, SentinelFinding } from './types';
import type { Evidence } from '../evidence/types';
import { getSentinelRegistry } from './registry';
import { getBaselineStore } from './baseline-store';
import { HEALTH_REGISTRY_RATIO_WARNING, HEALTH_FAILURES_WARNING, HEALTH_FAILURES_CRITICAL, HEALTH_UPTIME_IDLE_MS, HEALTH_STALENESS_MULTIPLIER, evaluateSentinelHealth,
  estimateCronIntervalMs,
  SELF_CHECK_SENTINEL_ID,
  SELF_CHECK_SENTINEL_NAME,
  CRON_INTERVAL_FALLBACK_MS,
  type SentinelHealthState, } from './self-check';
import {
  createSentinelEventsTable,
  appendSentinelEvent,
  replaySentinelEvents,
} from './sentinel-events';
import { EscalationEngine, type EscalationRule } from '../services/escalation-engine';
import { createLogger } from '@synova/logger';
import { ProactivePush } from "../agent/proactive-push";
import { dispatchNotification, registerNotificationAdapter } from '../notifications/registry';
import { ElectronNotificationAdapter } from '../notifications/electron-adapter';

const log = createLogger('sentinel/runner');

// ═══ 信号路由表 (手册 §19.1) ═══
// 哨兵 → 专家 预定义映射。规则驱动，只有模糊场景丢给 LLM。
// 信号级别: Low(只记录) / Medium(通知专家) / High(交叉验证) / Emergency(告警GA)

interface SignalRoute {
  sentinelId: string;
  /** 匹配模式: exact(精确ID) | prefix(ID前缀) */
  match: 'exact' | 'prefix';
  /** 路由到哪些专家 */
  experts: string[];
  /** 触发交叉验证的最低信号级别 (medium=通知不交叉, high/emergency=交叉验证) */
  crossValidateAt: 'medium' | 'high' | 'emergency';
}

interface SignalRouteResult {
  experts: string[];
  crossValidateAt: string;
  auxiliaryExperts?: string[];
}

/**
 * 根据哨兵 ID 查找路由规则。真实优先级链（D754 事实校准，2026-09-15 实测）:
 *   1. sentinel.config.route.experts 非空 → 优先。但当前**恒未命中**——manifest.json 无 route
 *      字段（0/45 声明），loader（sentinel-loader.ts registerLoadedSentinels 的 config 组装）
 *      也不透传该字段。若要启用声明式路由需先接线 manifest→config，另有其单（Win 侧台账
 *      D754-Win 半）；本函数保留该分支以兼容手动 register 的哨兵。
 *   2. 实际生效路径 = layer 默认映射: manifest.layer（loader 透传）→ 下方 LAYER_EXPERTS；
 *      layer 缺省时 fallback 旧 category；interface 层再按哨兵 ID 子串细化（value-capture/moat/…）。
 *   3. 层未命中 → ['host'] 兜底。
 *
 * 真正的失效模式（D754 校准，取代旧注释「过滤成空路由」的不实描述）:
 *   本函数**不做**专家合法性校验。失效专家 ID 会流到 dispatchSignalsToExperts，
 *   在其 VALID_EXPERTS 过滤处被逐个 `continue` **静默跳过（无日志）**——若 targetExperts
 *   全部失效，该信号零派发且无任何告警（静默失效点；加日志/修复属路由实现变更，另有其单）。
 */
function findSignalRoute(sentinelId: string): SignalRouteResult | undefined {
  const registry = getSentinelRegistry();
  const sentinel = registry.get(sentinelId);
  if (!sentinel) return undefined;

  // 1. config 显式 route（当前 0/45 哨兵走此路径——manifest 无此字段且 loader 不透传，见上 JSDoc）
  const route = (sentinel.config as { route?: { experts?: string[]; crossValidateAt?: string } }).route;
  if (route?.experts?.length) return { experts: route.experts, crossValidateAt: route.crossValidateAt || 'high' };

  // 2. 从 layer + priority 推导默认路由（技术方案 §7）
  // 优先使用 manifest 中的 layer 字段，fallback 到旧 category
  const layer: string = sentinel.config.layer || sentinel.config.category;

  // D567/D651: 路由目标专家 ID 全部对齐 expert-registry.yaml v3.0 的 6 位问题域专家
  // （旧 strategy/org/finance 与 cycle 命名值在注册表中已失效——D754 校准: 实际行为不是
  //   「过滤成空路由」，而是流到 dispatchSignalsToExperts 的 VALID_EXPERTS 处被逐个
  //   continue 静默跳过、无日志；全部失效时该信号零派发且无告警，见 findSignalRoute JSDoc）；
  // 层→专家为路由语义映射（非封闭枚举），最终派发仍经注册表校验（VALID_EXPERTS）
  const LAYER_EXPERTS: Record<string, string[]> = {
    environment: ['competitive-strategy'],
    capital: ['fundamental-efficiency'],
    interface: ['competitive-strategy'],
    technology: ['technology-foundation'],
    alignment: ['organizational-capability'],
    internal: ['organizational-capability'],
    // layer fallback: 旧 category 兼容
    risk: ['organizational-capability', 'fundamental-efficiency'],
    capability: ['organizational-capability'],
    collaboration: ['organizational-capability', 'technology-foundation'],
    health: ['technology-foundation'],
    'data-quality': ['technology-foundation'],
    strategy: ['competitive-strategy'],
  };
  const experts = LAYER_EXPERTS[layer] || ['host'];

  // 根据哨兵 ID 细化 interface 层路由
  if (layer === 'interface') {
    const sid = sentinel.config.id.toLowerCase();
    if (sid.includes('value-capture') || sid.includes('unit-economics') || sid.includes('ltv')) {
      return { experts: ['fundamental-efficiency'], crossValidateAt: 'high' };
    }
    if (sid.includes('niche') || sid.includes('moat') || sid.includes('competitive')) {
      return { experts: ['competitive-strategy'], crossValidateAt: 'high' };
    }
    if (sid.includes('network') || sid.includes('transaction-cost') || sid.includes('power')) {
      return { experts: ['organizational-capability', 'fundamental-efficiency'], crossValidateAt: 'high' };
    }
    if (sid.includes('business') || sid.includes('make-or-buy') || sid.includes('time')) {
      return { experts: ['competitive-strategy'], crossValidateAt: 'high' };
    }
  }

  const crossValidateAt = sentinel.config.priority === 'P0' ? 'emergency' : sentinel.config.priority === 'P1' ? 'high' : 'medium';
  // 读取 auxiliaryExperts（manifest 声明的辅助专家）
  const auxiliaryExperts = sentinel.config.auxiliaryExperts || undefined;
  return { experts, crossValidateAt, auxiliaryExperts };
}

// ═══ Types ═══

export interface SentinelRunRecord {
  sentinelId: string;
  sentinelName: string;
  result: SentinelCheckResult;
  /** Cron job ID (from scheduler) */
  cronJobId: string;
}

export interface SentinelRunnerStats {
  totalSentinels: number;
  totalRuns: number;
  totalFindings: number;
  criticalFindings: number;
  warningFindings: number;
  lastRunAt: string | null;
}

// ═══ D551: GA 手动信号注入（Module-3 蓝图 §3.3，spec SYNOVA-IMPL-DSH-D551 §6.2） ═══

/** GA 手动信号注入落点的哨兵 ID（findings API 按 sentinelId='ga-manual' 可查） */
export const GA_MANUAL_SENTINEL_ID = 'ga-manual';
/** GA 手动信号注入落点的哨兵显示名 */
export const GA_MANUAL_SENTINEL_NAME = 'GA 手动信号注入';

/** GA 手动信号注入输入（蓝图 §3.3.1 五要素 + 关联载荷；越界校验在路由层完成） */
export interface GaManualSignalInput {
  /** 信号类型（蓝图 10 枚举: 人员变动/战略转向/…/其他） */
  signalType: string;
  title: string;
  description: string;
  /** 严重度 1-10（映射: ≥9 emergency / ≥7 critical / ≥4 warning / ≤3 info） */
  severity: number;
  /** 置信度 0-100 */
  confidence: number;
  /** 蓝图"关联42边"多选（载荷承载，不写 L4 本体节点 — spec §7.3 诚实分层） */
  relatedEdges?: string[];
  /** 蓝图"关联节点"多选（同上） */
  relatedNodes?: string[];
  gaId: string;
  orgId: string;
}

/** 合成 finding（含 GA_MANUAL 元数据 — spec §6.2"source 字段载 GA_MANUAL 元数据"） */
export interface GaManualFinding extends SentinelFinding {
  source: 'GA_MANUAL';
  signalType: string;
  confidence: number;
}

/** severity 1-10 → SentinelFinding 四级映射（契约边界，测试锚定） */
function mapManualSeverity(severity: number): SentinelFinding['severity'] {
  if (severity >= 9) return 'emergency';
  if (severity >= 7) return 'critical';
  if (severity >= 4) return 'warning';
  return 'info';
}

// ═══ D580 8-2/8-4: 工单类型（sentinel_tickets DDL 对齐） ═══

/** sentinel_tickets.status 四态（DDL CHECK 枚举） */
export type TicketStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

/** 工单状态机迁移目标（open 是初始态, 不作为迁移目标; 终态 resolved/dismissed 不可再迁移） */
export type TicketTransitionTarget = 'acknowledged' | 'resolved' | 'dismissed';

/** sentinel_tickets 行（listSentinelTickets/transitionTicket 返回, 字段对齐 DDL） */
export interface TicketRow {
  id: string;
  signal_id: string;
  severity: 'emergency' | 'critical' | 'warning' | 'info';
  expert_type: string;
  diagnosis: string | null;
  suggested_actions: string | null;
  status: TicketStatus;
  created_at: string;
  resolved_at: string | null;
}

/** transitionTicket 分类返回（不抛, HTTP 映射在 L1 routes — spec §5.4） */
export type TransitionResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; error: 'TICKET_NOT_FOUND' }
  | { ok: false; error: 'ILLEGAL_TRANSITION'; from: TicketStatus; to: TicketTransitionTarget }
  | { ok: false; degraded: true; error: string };

// ═══ SentinelRunner ═══

export class SentinelRunner {
  private scheduler: CronScheduler;
  private db: unknown;
  private records = new Map<string, SentinelRunRecord[]>();
  private cronJobIds = new Map<string, string>();
  private totalRuns = 0;
  /** G3: 升级链引擎 — 对接人忽略告警后自动升级到上级 */
  readonly escalationEngine = new EscalationEngine();
  /** D6: 哨兵通知去重 — 记录每个 sentinelId 的最后推送时间戳（内存缓存, 持久化权威为 dedup 表） */
  private notificationSentTimestamps = new Map<string, number>();
  /** D580 8-3: 通知去重窗口 — 缺省 5min（D339 裁决 A 落地）, env SENTINEL_NOTIFICATION_DEDUP_MS 覆盖 */
  private readonly NOTIFICATION_DEDUP_MS: number;
  /** D17: P0 主动推送实例 (注入) */
  private proactivePush: ProactivePush | null = null;

  constructor(scheduler: CronScheduler, db: unknown) {
    this.scheduler = scheduler;
    this.db = db;
    this.NOTIFICATION_DEDUP_MS = SentinelRunner.resolveNotificationDedupMs();
  }

  /**
   * resolveNotificationDedupMs — D580 8-3: 去重窗口解析（缺省 5min = D339 裁决 A）。
   * 契约:
   *   @input  — env SENTINEL_NOTIFICATION_DEDUP_MS（可缺省）
   *   @output — 窗口毫秒数（正整数）
   *   @degraded — env 非法（非正整数）→ log.warn + 回退缺省（不静默, 不抛）
   *   @error  — 无
   */
  private static resolveNotificationDedupMs(): number {
    const DEFAULT_MS = 5 * 60 * 1000; // D339 裁决 A: 5 分钟（2026-08-13 创始人裁决, 台账 L106）
    const raw = process.env.SENTINEL_NOTIFICATION_DEDUP_MS;
    if (raw === undefined || raw === '') return DEFAULT_MS;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      log.warn({ env: raw, fallbackMs: DEFAULT_MS }, '[runner] SENTINEL_NOTIFICATION_DEDUP_MS 非法（需正整数）— 回退缺省 5min');
      return DEFAULT_MS;
    }
    return parsed;
  }

  /** 注入 ProactivePush 实例 (D17) */
  setProactivePush(push: ProactivePush): void {
    this.proactivePush = push;
  }

  /**
   * 启动所有 cron-mode 哨兵。
   * 从 SentinelRegistry 读取, 为每个 cron 哨兵注册定时任务。
   */
  start(): void {
    // 哨兵工单表 (L3 闭环)
    try {
      (this.db as { exec(sql: string): void }).exec(`
        CREATE TABLE IF NOT EXISTS sentinel_tickets (
          id TEXT PRIMARY KEY,
          signal_id TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('emergency','critical','warning','info')),
          expert_type TEXT NOT NULL,
          diagnosis TEXT,
          suggested_actions TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved','dismissed')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT
        );
      `);
    } catch { log.debug('哨兵工单表初始化失败 — 可能已存在或 db 不可用'); }

    // D580 8-3: 通知去重持久化表（B-19 裁决 2: 独立 KV 表, 同库同事务域 = 单一权威;
    //   key = sources[0].sentinelId（键粒度与内存 Map 一致）; INTEGER epoch ms 便于窗口精确比较）
    try {
      (this.db as { exec(sql: string): void }).exec(`
        CREATE TABLE IF NOT EXISTS sentinel_notification_dedup (
          key TEXT PRIMARY KEY,
          last_sent_ms INTEGER NOT NULL
        );
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '[runner] 通知去重表初始化失败 — degraded, 运行期回退内存 Map');
    }

    // D580 8-3: 去重表启动 TTL 清理（过期记录惰性无害 — 窗口判断天然返回 false;
    //   启动清一次防表膨胀, 不建定时任务 — 最少机制, spec §5.3-②）
    try {
      (this.db as { prepare(sql: string): { run(...args: unknown[]): unknown } })
        .prepare('DELETE FROM sentinel_notification_dedup WHERE last_sent_ms < ?')
        .run(Date.now() - this.NOTIFICATION_DEDUP_MS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '[runner] 通知去重表 TTL 清理失败 — 非阻断');
    }

    // sentinel_events 事件表 (L5 append-only) + 启动重放重建投影 (I1 可重建)
    try {
      createSentinelEventsTable(this.db as Database.Database);
      this.rebuildFromEvents();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, '[runner] 哨兵事件表初始化/重放失败 — degraded, 内存态从空开始');
    }

    const registry = getSentinelRegistry();
    const cronSentinels = registry.listCronSentinels();

    // D505: 哨兵自诊断 — 必须在空 registry 早退之前注册（loader 全挂 → registry 空
    // 正是 H1/H3 要捕获的故障，自检不能随早退静默消失）
    this.scheduler.schedule('SentinelSelfCheck', '0 * * * *', async () => {
      await this.runSelfCheck();
    });

    if (cronSentinels.length === 0) {
      log.info('[runner] 无 cron-mode 哨兵 — 跳过启动');
      return;
    }

    for (const { sentinel, cron } of cronSentinels) {
      this.scheduleSentinel(sentinel, cron);
    }

    // D6: 注册桌面推送通知适配器
    const electronAdapter = new ElectronNotificationAdapter();
    registerNotificationAdapter(electronAdapter);
    log.info('[runner] Electron 桌面推送适配器已注册');

    // 信号聚合 — 每小时整点过 5 分运行 (在所有哨兵之后)
    this.scheduler.schedule('SignalAggregator', '5 * * * *', async () => {
      await this.aggregateAndDispatch();
    });

    log.info({ count: cronSentinels.length }, '[runner] 所有 cron 哨兵 + 信号聚合已启动');
  }

  /**
   * 停止所有哨兵。
   */
  stop(): void {
    for (const [sentinelId, cronJobId] of this.cronJobIds) {
      try {
        this.scheduler.remove(cronJobId);
      } catch { log.warn({ sentinelId }, '[runner] cron 取消失败 (可能已停止)'); }
    }
    this.cronJobIds.clear();
    log.info('[runner] 所有哨兵已停止');
  }

  /**
   * 手动运行指定哨兵 (不等待 cron)。
   */
  async runOnce(sentinelId: string): Promise<SentinelCheckResult | null> {
    const registry = getSentinelRegistry();
    const sentinel = registry.get(sentinelId);
    if (!sentinel) {
      log.warn({ sentinelId }, '[runner] 哨兵未找到');
      return null;
    }
    return this.executeSentinel(sentinel);
  }

  /** 获取运行统计 */
  getStats(): SentinelRunnerStats {
    const allFindings = [...this.records.values()].flatMap(rs => rs.flatMap(r => r.result.findings));
    const lastRecord = [...this.records.values()].flatMap(rs => rs).sort((a, b) =>
      b.result.checkedAt.localeCompare(a.result.checkedAt)
    )[0];

    return {
      totalSentinels: this.cronJobIds.size,
      totalRuns: this.totalRuns,
      totalFindings: allFindings.length,
      criticalFindings: allFindings.filter(f => f.severity === 'critical').length,
      warningFindings: allFindings.filter(f => f.severity === 'warning').length,
      lastRunAt: lastRecord?.result.checkedAt ?? null,
    };
  }

  // ═══ D505: 哨兵自诊断（S3-5 自诊断可信度） ═══

  /** 进程启动时刻（uptimeMs 计算） */
  private readonly startedAtMs = Date.now();

  /**
   * 收集哨兵体系健康指标（H1/H2/H3 数据源）。
   * 每个指标独立 try/catch（铁律 24/31）：单项失败 → log.warn + 保守默认值，
   * 由 evaluateSentinelHealth 的 fail-closed 语义兜底（检查没跑 ≠ 检查通过）。
   */
  private async collectHealthState(): Promise<SentinelHealthState> {
    const state: SentinelHealthState = {
      registryCount: 0,
      expectedCount: 0,
      cronJobs: [],
      lastRunAt: null,
      maxScheduleMs: CRON_INTERVAL_FALLBACK_MS,
      uptimeMs: Date.now() - this.startedAtMs,
    };

    try {
      state.registryCount = getSentinelRegistry().count();
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] registry.count() 收集失败 — 保守取 0');
    }

    try {
      const { loadSentinels, clearSentinelCache } = await import('./sentinel-loader');
      clearSentinelCache(); // 运行期重扫（cache 含启动期快照，每次自检取最新 manifest 面）
      state.expectedCount = loadSentinels().sentinels.length;
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] loadSentinels() 收集失败 — 保守取 0（fail-closed：expectedCount=0 不误报 H1）');
    }

    try {
      state.cronJobs = this.scheduler.listJobs().map((j) => ({
        id: j.id, failures: j.failures, lastRunAt: j.lastRunAt, lastError: j.lastError,
      }));
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] scheduler.listJobs() 收集失败 — 适配器健康未知（fail-closed 见 runSelfCheck）');
      state.cronJobs = [{ id: 'SentinelSelfCheck-collection', failures: Number.MAX_SAFE_INTEGER, lastRunAt: null, lastError: '指标收集失败：listJobs 不可用' }];
    }

    try {
      state.lastRunAt = this.getStats().lastRunAt;
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] getStats() 收集失败 — 保守取 null');
    }

    try {
      const crons = getSentinelRegistry().listCronSentinels().map((e) => e.cron);
      if (crons.length > 0) {
        state.maxScheduleMs = Math.max(...crons.map((c) => estimateCronIntervalMs(c)));
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] cron 间隔估算失败 — 兜底 24h');
    }

    return state;
  }

  /**
   * D505 哨兵自诊断 — 评估哨兵体系自身健康（loader/适配器/调度三维）。
   *
   * 契约:
   *   @input  explicitState — 显式健康快照（测试/工具注入用）；省略时内部收集（collectHealthState）
   *   @output 无返回；健康时零副作用（零噪音，宁缺毋滥），异常时 findings 流入:
   *           ① records（sentinel-self-check，GET /api/sentinel/findings 可见，零 routes 改动）
   *           ② sentinel_events（I2 单源，persistRunEvents 唯一写入口）
   *           ③ critical → createAutoTicket（D463 工单闭环）
   *           ④ warning/critical → dispatchNotification（D6 桌面通知，10min 去重）
   *   @degraded — 指标收集单项失败 → log.warn + 保守 fail-closed（不静默，铁律 24/31）
   *   @error    — 不抛（内部全捕获；评估/写事件/工单/通知各自独立降级）
   *   不进 dispatchSignalsToExperts — 企业专家诊断企业，不诊断哨兵自身（D505 §5.3 决策）。
   */
  async runSelfCheck(explicitState?: SentinelHealthState): Promise<void> {
    const startTime = Date.now();
    let state: SentinelHealthState;
    try {
      state = explicitState ?? await this.collectHealthState();
    } catch (err: unknown) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, '[self-check] 健康指标收集失败 — fail-closed：保守产出降级 finding');
      state = {
        registryCount: 0, expectedCount: 1, cronJobs: [],
        lastRunAt: null, maxScheduleMs: CRON_INTERVAL_FALLBACK_MS,
        uptimeMs: Date.now() - this.startedAtMs,
      };
    }

    const { healthy, findings } = evaluateSentinelHealth(state);
    if (healthy) return; // 健康零噪音（宁缺毋滥）

    const checkedAt = new Date().toISOString();
    const record: SentinelRunRecord = {
      sentinelId: SELF_CHECK_SENTINEL_ID,
      sentinelName: SELF_CHECK_SENTINEL_NAME,
      cronJobId: 'SentinelSelfCheck',
      result: {
        sentinelId: SELF_CHECK_SENTINEL_ID,
        ok: true,
        findings,
        durationMs: Date.now() - startTime,
        checkedAt,
        degraded: true, // 自诊断出 finding = 哨兵体系处于 degraded 态（铁律 31 显式标记）
      },
    };

    // I2 单源: 先落事件流（唯一写入口），再物化投影
    try {
      this.persistRunEvents(record);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, '[self-check] 事件持久化失败 — 降级为纯内存态（重启即丢）');
    }
    this.projectRunRecord(record);
    this.totalRuns++;

    log.warn({ findings: findings.length, h: findings.map((f) => f.id) }, '[self-check] 哨兵体系自诊断发现异常 — degraded 信号已产出');

    // D463 工单闭环: 最高严重度 critical → 自动工单（稳定去重键 = 小时窗口，INSERT OR REPLACE 幂等）
    const worst = findings.some((f) => f.severity === 'critical') ? 'critical' : 'warning';
    if (worst === 'critical') {
      this.createAutoTicket({
        id: `self-check-${checkedAt.slice(0, 13)}`, // 小时级稳定 id（同窗口幂等）
        severity: worst,
        title: '哨兵体系自诊断异常（D505）',
        sources: findings.map((f) => ({
          sentinelId: SELF_CHECK_SENTINEL_ID,
          sentinelName: SELF_CHECK_SENTINEL_NAME,
          finding: f,
        })),
      });
    }

    // D6 桌面通知: warning/critical → dispatchNotification（10min 去重窗口）
    const notifSignal = { sources: [{ sentinelId: SELF_CHECK_SENTINEL_ID }] };
    if (!this.isNotificationDuplicate(notifSignal)) {
      try {
        await dispatchNotification({
          id: `notif-self-check-${checkedAt.slice(0, 13)}`,
          orgId: 'default',
          title: `[${worst.toUpperCase()}] 哨兵体系自诊断`,
          description: findings.map((f) => f.title).join('；'),
          priority: worst === 'critical' ? 'P0' : 'P1',
          targetSystem: 'electron',
          metadata: { severity: worst, sentinelId: SELF_CHECK_SENTINEL_ID },
          createdAt: checkedAt,
        });
        this.markNotificationSent(notifSignal);
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, '[self-check] 桌面通知派发失败 — 非阻断');
      }
    }
  }

  /**
   * 信号聚合 — 收集所有哨兵最新结果，交叉关联，输出聚合信号。
   * 每小时调用一次 (在所有哨兵 cron tick 之后)。
   */
  async aggregateAndDispatch(): Promise<void> {
    try {
      const results: SentinelCheckResult[] = [];
      for (const [sentinelId, history] of this.records) {
        // D505 DS8: 自诊断 finding 不进企业信号聚合（企业专家诊断企业，不诊断哨兵自身）
        if (sentinelId === SELF_CHECK_SENTINEL_ID) continue;
        if (history.length > 0) {
          results.push(history[history.length - 1].result);
        }
      }
      if (results.length === 0) return;

      const { aggregateSignals } = await import('./signal-aggregator');
      const { signals, stats } = aggregateSignals(results);

      // I3 审计: 写 signal 事件（信号按需重算，事件流仅作审计追踪，不建投影）
      try {
        for (const signal of signals) {
          appendSentinelEvent(this.db as Database.Database, {
            event_type: 'signal',
            sentinel_id: signal.sources[0]?.sentinelId || signal.id,
            aggregate_id: signal.id,
            payload: { signal: { ...signal } },
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg }, '[runner] signal 事件写入失败 — 非阻断');
      }

      if (stats.criticalSignals > 0) {
        log.warn({
          totalFindings: stats.totalFindings,
          aggregatedSignals: stats.aggregatedSignals,
          criticalSignals: stats.criticalSignals,
        }, '[runner] 聚合信号 — 发现 critical 信号，准备路由专家');
      } else if (signals.length > 0) {
        log.info({ signals: signals.length, critical: 0 }, '[runner] 聚合完成 — 无 critical 信号');
      }

      // ═══ 接线: 信号 → 专家 (复用 Track A 的 ExpertDispatcher) ═══
      const criticalOrWarning = signals.filter(s => s.severity === 'critical' || s.severity === 'warning');
      if (criticalOrWarning.length > 0) {
        await this.dispatchSignalsToExperts(criticalOrWarning);
      }

      // ═══ D6: 信号 → 桌面推送通知 (critical/warning 推送到 Electron) ═══
      for (const signal of criticalOrWarning) {
        if (this.isNotificationDuplicate(signal)) continue;
        const sentinelId = signal.sources[0]?.sentinelId || signal.id;
        await dispatchNotification({
          id: `notif-${signal.id}`, // D354: 稳定 id — 同 signal 跨轮同 id (N14 去重键)
          orgId: signal.entities[0] || 'default',
          title: `[${signal.severity.toUpperCase()}] ${sentinelId}`,
          description: signal.title || signal.sources[0]?.finding?.description || '',
          priority: signal.severity === 'critical' ? 'P0' : 'P1',
          targetSystem: 'electron',
          metadata: { severity: signal.severity, sentinelId, signalId: signal.id },
          createdAt: new Date().toISOString(),
        });
        this.markNotificationSent(signal);
      }

      // ═══ D17: P0 主动推送 (critical → Feishu/email/webhook, 含3次重试)
      const proactivePush = this.proactivePush;
      if (proactivePush) {
        for (const signal of criticalOrWarning) {
          if (signal.severity === "critical") {
            const src = signal.sources[0]?.finding;
            const finding = {
              id: signal.id,
              sentinelId: signal.sources[0]?.sentinelId || signal.id,
              sentinelName: signal.sources[0]?.sentinelName || signal.id,
              severity: "critical" as const,
              title: signal.title || src?.title || "",
              description: src?.description,
              suggestion: src?.suggestion,
              detectedAt: src?.detectedAt || signal.aggregatedAt || new Date().toISOString(),
            };
            proactivePush.onP0Finding(finding).catch((err: Error) => {
              log.warn({ err, signalId: signal.id }, "P0 主动推送异常 — 不阻断主流程");
            });
          }
        }
      }

      // G3: 升级链评估 — 对每个聚合信号检查是否需升级
      for (const signal of signals) {
        try {
          // 查找该 signal 的忽略记录（简化: 首次评估无历史，后续由外部触发 recordIgnore）
          const decision = this.escalationEngine.evaluate({
            alertId: signal.id,
            sentinelId: signal.sources?.[0]?.sentinelId ?? signal.id,
            severity: signal.severity === 'critical' ? 'critical' as const
              : signal.severity === 'warning' ? 'warning' as const
              : 'info' as const,
            firstIgnoredAt: null,
            cumulativeIgnores: 0,
            dataImproved: false,
          });
          if (decision?.shouldEscalate) {
            log.warn({
              signalId: signal.id,
              escalateTo: decision.escalateTo,
              reason: decision.reason,
            }, '[runner] 升级链触发 — 需升级到上级');
          }
        } catch (err: unknown) {
          log.warn({ err, signalId: signal.id }, '[runner] 升级链评估失败 — 非阻断');
        }
      }
    } catch (err: unknown) {
      log.error({ err }, '[runner] 信号聚合失败');
    }
  }

  /**
   * 将聚合信号转换为 Evidence，调用 ExpertDispatcher 启动专家推理。
   * 铁律 31: 专家不可用时降级 (log.error + degraded)，不阻断哨兵调度。
   */
  private async dispatchSignalsToExperts(
    signals: Array<{ id: string; severity: string; title: string; sources: Array<any>; entities: string[]; recommendedExperts: string[] }>,
  ): Promise<void> {
    // D463 告警闭环（选项 A，创始人 2026-08-21 批准）: critical/emergency 信号按严重度
    // **自动建工单**（不依赖专家——专家是增强，不是门控）。同信号重复触发 → INSERT OR REPLACE
    // 幂等（去重键稳定，配合 D354 去时间戳）。诊断 = finding 摘要；专家可用时走下方 enrich 路径。
    for (const signal of signals) {
      if (signal.severity === 'critical' || signal.severity === 'emergency') {
        this.createAutoTicket(signal);
      }
    }

    const { getGlobalExpertDispatcher } = await import('../l3/expert-dispatcher');
    const dispatcher = getGlobalExpertDispatcher();

    if (!dispatcher) {
      log.warn({ autoTickets: signals.filter(s => s.severity === 'critical' || s.severity === 'emergency').length }, '[runner] ExpertDispatcher 未初始化 — 自动工单已建，专家增强跳过（非阻断）');
      return;
    }

    const { getExpertRegistry } = await import('../l3/expert-registry');
    const VALID_EXPERTS = new Set(getExpertRegistry().listTypes());

    for (const signal of signals) {
      // 手册 §19.1: 优先用预定义路由表，fallback 到信号自带的 recommendedExperts
      const evidenceItems = signal.sources.map((src: any, i: number) => ({
        id: 'sentinel-' + signal.id + '-' + i,
        source: 'diagnosis' as const,
        sourceId: src.sentinelId,
        type: 'sentinel-' + src.sentinelId,
        content: '[' + src.finding.severity + '] ' + src.finding.title + ': ' + src.finding.description,
        confidence: 0.7,
        collectedAt: src.finding.detectedAt,
        orgId: signal.entities[0] || 'default',
        sessionId: 'sentinel-' + signal.id,
      }));

      // 查找路由表匹配的专家
      const sourceSentinelId = signal.sources[0]?.sentinelId || '';
      const route = findSignalRoute(sourceSentinelId);
      const routedExperts = route?.experts || signal.recommendedExperts;

      // 交叉验证: 信号严重度 >= 路由阈值时，激活相关专家并行推理
      const severityRank = { info: 0, warning: 1, critical: 2, emergency: 3 };
      const thresholdRank = { medium: 1, high: 2, emergency: 3 };
      const shouldCrossValidate = (severityRank[signal.severity as keyof typeof severityRank] || 0)
        >= (thresholdRank[route?.crossValidateAt as keyof typeof thresholdRank] || 2);
      // 合并 auxiliaryExperts（manifest 声明的辅助专家）到目标专家列表
      const auxExperts = route?.auxiliaryExperts || [];
      const targetExperts = shouldCrossValidate
        ? [...new Set([...routedExperts, ...auxExperts, ...signal.recommendedExperts])]
        : [...new Set([...routedExperts, ...auxExperts])];

      for (const rec of targetExperts) {
        const expertType = VALID_EXPERTS.has(rec) ? rec : null;
        if (!expertType) continue;

        try {
          log.info({ signal: signal.id, expert: expertType, evidenceCount: evidenceItems.length, crossValidate: shouldCrossValidate },
            '[runner] 信号路由专家 → 启动推理');
          // D567: 删除旧 6 位类型 union cast — ExpertType 自 v3.3 起即 string
          // （subagent-coordinator.ts:19），此处硬编码 union 是枚举复制残留；
          // 运行时合法性已由上方 VALID_EXPERTS（registry.listTypes()）过滤保证
          const report = await dispatcher.runExpert(
            expertType,
            evidenceItems as unknown as Evidence[],
          );
          if (report) {
            log.info({ signalId: signal.id, expert: expertType }, '[runner] 专家诊断完成');
            this.storeExpertReport(signal.id, expertType, report, signal.severity);
          }
        } catch (expertErr: unknown) {
          log.error({ signalId: signal.id, expert: expertType, err: (expertErr as Error)?.message },
            '[runner] 专家调用失败 — 降级继续（不阻断其他信号）');
        }
      }
    }
  }

  /** 存储专家报告（内存，供 API 查询） */
  private expertReports: Array<{ signalId: string; expertType: string; report: unknown; storedAt: string }> = [];

  private storeExpertReport(signalId: string, expertType: string, report: unknown, severity?: string): void {
    this.expertReports.push({ signalId, expertType, report, storedAt: new Date().toISOString() });
    if (this.expertReports.length > 50) this.expertReports.shift();

    // L3 闭环: emergency/critical 信号自动创建工单
    if (severity === 'emergency' || severity === 'critical') {
      try {
        const ticketId = `ticket-${signalId}-${expertType}`;
        const r = report as { suggestedActions?: string[] };
        (this.db as { prepare(sql: string): { run(...args: unknown[]): void } }).prepare(
          `INSERT OR REPLACE INTO sentinel_tickets (id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', datetime('now'))`
        ).run(
          ticketId, signalId, severity, expertType,
          JSON.stringify(r),
          Array.isArray(r?.suggestedActions) ? (r.suggestedActions as string[]).join('; ') : null
        );
        log.info({ ticketId, signalId, expertType }, '[runner] 工单已创建');
        // I3 审计: 写 ticket_transition 事件（工单创建）
        try {
          appendSentinelEvent(this.db as Database.Database, {
            event_type: 'ticket_transition',
            sentinel_id: signalId,
            aggregate_id: ticketId,
            payload: { ticketId, signalId, severity, expertType, to: 'open', at: new Date().toISOString() },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg, ticketId }, '[runner] ticket_transition 事件写入失败 — 非阻断');
        }
      } catch (err) { log.warn({ err }, '[runner] 工单创建失败 (非阻断)'); }
    }
  }

  /**
   * D463 告警闭环（选项 A）: critical/emergency 信号按严重度自动建工单——不依赖专家。
   * 诊断 = finding 摘要（title + description + evidence）；同信号重复触发 → INSERT OR REPLACE 幂等
   * （信号 id 已由 D354 去时间戳 → 去重键稳定）。
   * 降级（铁律 24/31）: DB 写入失败 → log.warn + 返回（不静默、不阻断信号管线）。
   */
  private createAutoTicket(signal: {
    id: string; severity: string; title: string;
    sources: Array<{ sentinelId: string; sentinelName: string; finding: SentinelFinding }>;
  }): void {
    try {
      const ticketId = `ticket-${signal.id}-auto`;
      const findings = signal.sources.map((src) => src.finding);
      const summary = findings.map((f) => `[${f.severity}] ${f.title}: ${f.description}`).join(' | ') || signal.title;
      const evidence = findings.flatMap((f) => f.evidence ?? []).slice(0, 5);
      const suggested = findings.map((f) => f.suggestion).filter(Boolean).slice(0, 3).join('; ');
      const diagnosis = { title: signal.title, summary, evidence, auto: true };

      (this.db as { prepare(sql: string): { run(...args: unknown[]): void } }).prepare(
        `INSERT OR REPLACE INTO sentinel_tickets (id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at)
         VALUES (?, ?, ?, 'auto', ?, ?, 'open', datetime('now'))`
      ).run(
        ticketId, signal.id, signal.severity,
        JSON.stringify(diagnosis),
        suggested || null
      );
      log.info({ ticketId, signalId: signal.id, severity: signal.severity }, '[runner] 自动工单已创建（告警闭环，无专家依赖）');
      try {
        appendSentinelEvent(this.db as Database.Database, {
          event_type: 'ticket_transition',
          sentinel_id: signal.id,
          aggregate_id: ticketId,
          payload: { ticketId, signalId: signal.id, severity: signal.severity, expertType: 'auto', to: 'open', at: new Date().toISOString() },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, ticketId }, '[runner] auto ticket_transition 事件写入失败 — 非阻断');
      }
    } catch (err) {
      log.warn({ err }, '[runner] 自动工单创建失败 (非阻断)');
    }
  }

  /** 获取专家报告 (供 API 查询) */
  getExpertReports(): Array<{ signalId: string; expertType: string; report: unknown; storedAt: string }> {
    return this.expertReports;
  }

  /** 获取最近哨兵运行记录 (供外部 API 查询) */
  getRecentResults(): Map<string, SentinelRunRecord[]> {
    return this.records;
  }

  /**
   * D551: GA 手动信号注入（L3 公开方法 — sentinel-service.injectManualSignal 经 L2 调用，L1 路由不绕层）。
   *
   * 蓝图 §3.3.2 反应链落地: ①写入系统 = 本方法（合成 SentinelRunRecord → persistRunEvents
   * I2 单源落 sentinel_events → projectRunRecord 投影，GET /api/sentinel/findings 立即可见）；
   * ③下轮 aggregateAndDispatch 自然消费（本方法不改聚合白名单 — SELF_CHECK 除外既有逻辑）。
   * 第②步"定向触发哨兵重新评估"诚实 descope（spec §7.3——注入 finding 经常规 cron/聚合管线流动）。
   *
   * 契约:
   *   @input  — GaManualSignalInput（severity 1-10 / confidence 0-100；越界校验在路由层）
   *   @output — { ok:true, findingId } 成功（degraded:true 表示事件持久化失败、投影为纯内存态）；
   *             本方法不返回 ok:false（不抛、内部降级，铁律 24/31）
   *   @degraded — persistRunEvents 失败 → log.error + 保留投影（重启即丢）+ degraded:true 传播
   *   @error  — 不抛
   */
  injectManualFinding(input: GaManualSignalInput): { ok: boolean; findingId: string; degraded?: boolean; error?: string } {
    const checkedAt = new Date().toISOString();
    const findingId = `ga-manual-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const finding: GaManualFinding = {
      id: findingId,
      severity: mapManualSeverity(input.severity),
      title: input.title,
      description: `[GA 手动信号|${input.signalType}|置信度 ${input.confidence}%] ${input.description}`,
      evidence: [
        'source=GA_MANUAL',
        `signalType=${input.signalType}`,
        `confidence=${input.confidence}`,
        `gaId=${input.gaId}`,
        `orgId=${input.orgId}`,
        ...(input.relatedEdges ?? []).map((e) => `edge=${e}`),
        ...(input.relatedNodes ?? []).map((n) => `node=${n}`),
      ],
      suggestion: 'GA 手动注入信号 — 请人工研判并跟踪',
      detectedAt: checkedAt,
      ...(input.relatedNodes && input.relatedNodes.length > 0 ? { relatedNodeId: input.relatedNodes[0] } : {}),
      status: 'open',
      source: 'GA_MANUAL',
      signalType: input.signalType,
      confidence: input.confidence,
    };
    const record: SentinelRunRecord = {
      sentinelId: GA_MANUAL_SENTINEL_ID,
      sentinelName: GA_MANUAL_SENTINEL_NAME,
      cronJobId: 'ga-manual-injection',
      result: {
        sentinelId: GA_MANUAL_SENTINEL_ID,
        ok: true,
        findings: [finding],
        durationMs: 0,
        checkedAt,
      },
    };

    // I2 单源: 先落事件流（唯一写入口），再物化投影（对齐 runSelfCheck L369-377 既有次序）
    let degraded = false;
    try {
      this.persistRunEvents(record);
    } catch (err: unknown) {
      degraded = true;
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg, findingId }, '[runner] GA 手动信号事件持久化失败 — 降级为纯内存投影（重启即丢）');
    }
    this.projectRunRecord(record);
    this.totalRuns++;

    log.info({ findingId, signalType: input.signalType, severity: input.severity, gaId: input.gaId }, '[runner] GA 手动信号已注入哨兵事件流');
    return degraded
      ? { ok: true, findingId, degraded: true, error: '事件持久化失败 — 内存投影可见，重启即丢' }
      : { ok: true, findingId };
  }

  // ═══ 事件溯源 (I1 可重建 / I2 单源 / I3 可审计) ═══

  /**
   * 将一次 run 的 run_completed + finding 事件写入事件流（I2 单源唯一写入口）。
   * run_completed 作聚合锚点（不含 findings）；每条 finding 一条 finding 事件（I3 可审计）。
   */
  private persistRunEvents(record: SentinelRunRecord): void {
    const db = this.db as Database.Database;
    const runKey = `${record.sentinelId}@${record.result.checkedAt}`;
    appendSentinelEvent(db, {
      event_type: 'run_completed',
      sentinel_id: record.sentinelId,
      aggregate_id: runKey,
      payload: {
        sentinelId: record.sentinelId,
        sentinelName: record.sentinelName,
        checkedAt: record.result.checkedAt,
        durationMs: record.result.durationMs,
        ok: record.result.ok,
        error: record.result.error ?? null,
        degraded: record.result.degraded ?? false,
        cronJobId: record.cronJobId,
      },
    });
    for (const finding of record.result.findings) {
      appendSentinelEvent(db, {
        event_type: 'finding',
        sentinel_id: record.sentinelId,
        aggregate_id: runKey,
        payload: { finding: { ...finding, status: finding.status ?? 'open' } },
      });
    }
  }

  /** 物化投影: 把 run record 追加进 records Map（保留最近 50 条） */
  private projectRunRecord(record: SentinelRunRecord): void {
    const history = this.records.get(record.sentinelId) || [];
    history.push(record);
    if (history.length > 50) history.shift();
    this.records.set(record.sentinelId, history);
  }

  /**
   * 启动重放: 从 sentinel_events 事件流重建 records 投影 (I1 可重建)。
   * 运行期新事件由 persistRunEvents/projectRunRecord 边写边投影；本方法仅在 start() 调用一次。
   */
  rebuildFromEvents(): void {
    const events = replaySentinelEvents(this.db as Database.Database);
    this.records.clear();
    this.totalRuns = 0;

    const runByAggregate = new Map<string, SentinelRunRecord>();
    const findingById = new Map<string, SentinelFinding>();

    for (const ev of events) {
      switch (ev.event_type) {
        case 'run_completed': {
          const p = ev.payload;
          const record: SentinelRunRecord = {
            sentinelId: String(p.sentinelId),
            sentinelName: String(p.sentinelName ?? p.sentinelId),
            cronJobId: String(p.cronJobId ?? ''),
            result: {
              sentinelId: String(p.sentinelId),
              ok: Boolean(p.ok),
              findings: [],
              durationMs: Number(p.durationMs ?? 0),
              checkedAt: String(p.checkedAt ?? ''),
              ...(p.error != null ? { error: String(p.error) } : {}),
              ...(p.degraded != null ? { degraded: Boolean(p.degraded) } : {}),
            },
          };
          this.projectRunRecord(record);
          this.totalRuns++;
          if (ev.aggregate_id) runByAggregate.set(ev.aggregate_id, record);
          break;
        }
        case 'finding': {
          const p = ev.payload;
          const finding = p.finding as SentinelFinding;
          if (ev.aggregate_id) {
            const run = runByAggregate.get(ev.aggregate_id);
            if (run) {
              run.result.findings.push(finding);
              findingById.set(finding.id, finding);
            } else {
              log.warn({ aggregateId: ev.aggregate_id, findingId: finding.id },
                '[runner] 重放 finding 事件 — 未找到对应 run（跳过）');
            }
          }
          break;
        }
        case 'finding_transition': {
          const p = ev.payload;
          const findingId = String(p.findingId);
          const to = String(p.to) as SentinelFinding['status'];
          const finding = findingById.get(findingId);
          if (finding) {
            finding.status = to;
          } else {
            log.warn({ findingId }, '[runner] 重放 finding_transition — 未找到对应 finding（跳过）');
          }
          break;
        }
        case 'signal':
        case 'ticket_transition':
          // I3 审计: 信号按需重算（aggregateSignals）、工单状态在 sentinel_tickets 表——
          // 事件流仅作审计追踪，不投影到内存态。
          break;
      }
    }
  }

  /**
   * 迁移 finding 生命周期状态 (K3 §4.6 findings 正名)。
   * 契约:
   *   @input  — findingId: string, to: 'acknowledged' | 'resolved'
   *   @output — 命中并迁移的 finding 数量（0 = 未找到）
   *   @degraded — 事件写入失败 → log.warn + 仍更新内存投影（degraded）
   *   @error  — 无（纯内存搜索 + 幂等写事件，不抛）
   */
  transitionFindingStatus(findingId: string, to: 'acknowledged' | 'resolved'): number {
    let changed = 0;
    for (const runs of this.records.values()) {
      for (const run of runs) {
        for (const f of run.result.findings) {
          if (f.id !== findingId) continue;
          const from = f.status ?? 'open';
          f.status = to;
          changed++;
          try {
            appendSentinelEvent(this.db as Database.Database, {
              event_type: 'finding_transition',
              sentinel_id: run.sentinelId,
              aggregate_id: findingId,
              payload: { findingId, from, to, at: new Date().toISOString() },
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn({ err: msg, findingId }, '[runner] finding_transition 事件写入失败 — degraded');
          }
        }
      }
    }
    return changed;
  }

  // ═══ D580 8-2/8-4: 工单读路径 + 状态机（写读同源, 紧邻 closeTicket 放置） ═══

  /**
   * listSentinelTickets — 工单读路径（写读同源, D580 8-2 修复 K3 P2-3）
   * 契约:
   *   @input  — status?: 'open' | 'acknowledged' | 'resolved' | 'dismissed'（缺省返回全部）
   *   @output — 工单行数组（created_at DESC, LIMIT 200），字段对齐 sentinel_tickets DDL
   *   @degraded — 本方法不吞错: db 失败/表不存在 → 抛出，由 L2 调用方统一降级
   *               （降级决策单点在 sentinel-service，铁律 31 传播链清晰）
   *   @error  — 表不存在（start() 未调用）→ 同上抛出
   */
  listSentinelTickets(status?: TicketStatus): TicketRow[] {
    const db = this.db as {
      prepare(sql: string): { all(...args: unknown[]): unknown[] };
    };
    if (status !== undefined) {
      return db.prepare(
        `SELECT id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at, resolved_at
         FROM sentinel_tickets WHERE status = ? ORDER BY created_at DESC LIMIT 200`,
      ).all(status) as TicketRow[];
    }
    return db.prepare(
      `SELECT id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at, resolved_at
       FROM sentinel_tickets ORDER BY created_at DESC LIMIT 200`,
    ).all() as TicketRow[];
  }

  /**
   * transitionTicket — 工单状态机迁移（D580 8-4）
   * 契约:
   *   @input  — ticketId: string; to: 'acknowledged' | 'resolved' | 'dismissed'
   *   @output — { ok: true, ticket: TicketRow }（迁移后行）
   *             { ok: false, error: 'TICKET_NOT_FOUND' }            （无此行）
   *             { ok: false, error: 'ILLEGAL_TRANSITION', from, to } （白名单外迁移）
   *   @degraded — db 失败 → { ok: false, degraded: true, error } + log.warn（铁律 24/31）
   *   @error  — 不抛（全捕获分类返回, HTTP 映射在 L1）
   * 状态机（白名单, 其余一律 ILLEGAL_TRANSITION, 含终态再迁移与同态迁移 — 无后门）:
   *   open → acknowledged | open → dismissed | acknowledged → resolved
   *   resolved / dismissed = 终态（任何再迁移 → ILLEGAL_TRANSITION; 同态迁移亦 409）
   * resolved_at 语义: 仅 'resolved' 写 datetime('now')（列名语义纯度; dismissed 保持 NULL——
   *   不为它新增 closed_at 列, 最少机制, spec §5.5 决策表）
   * 审计: 迁移成功 → appendSentinelEvent({ event_type: 'ticket_transition', aggregate_id: ticketId,
   *   sentinel_id: row.signal_id || ticketId, payload: { ticketId, from, to, at } })——
   *   事件写入失败 → log.warn 不阻断（对齐 L687-696 既有降级先例）
   */
  transitionTicket(ticketId: string, to: TicketTransitionTarget): TransitionResult {
    const LEGAL_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketTransitionTarget[]>> = {
      open: ['acknowledged', 'dismissed'],
      acknowledged: ['resolved'],
      resolved: [],
      dismissed: [],
    };
    try {
      const db = this.db as {
        prepare(sql: string): {
          get(...args: unknown[]): unknown;
          run(...args: unknown[]): { changes: number };
        };
      };
      const row = db.prepare(
        `SELECT id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at, resolved_at
         FROM sentinel_tickets WHERE id = ?`,
      ).get(ticketId) as TicketRow | undefined;
      if (!row) return { ok: false, error: 'TICKET_NOT_FOUND' };

      const from = row.status;
      if (!LEGAL_TRANSITIONS[from].includes(to)) {
        return { ok: false, error: 'ILLEGAL_TRANSITION', from, to };
      }

      // resolved_at 语义: 仅 'resolved' 写（datetime('now') = DDL 既有时钟口径）
      if (to === 'resolved') {
        db.prepare(
          `UPDATE sentinel_tickets SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`,
        ).run(ticketId);
      } else {
        db.prepare('UPDATE sentinel_tickets SET status = ? WHERE id = ?').run(to, ticketId);
      }

      // 迁移后行以表为准重读（原样传播权威行, 不拼装内存副本）
      const updated = db.prepare(
        `SELECT id, signal_id, severity, expert_type, diagnosis, suggested_actions, status, created_at, resolved_at
         FROM sentinel_tickets WHERE id = ?`,
      ).get(ticketId) as TicketRow | undefined;
      if (!updated) return { ok: false, degraded: true, error: '迁移后行重读失败（并发删除?）' };

      // I3 审计: 迁移成功 → ticket_transition 事件（写入失败 log.warn 不阻断, 对齐既有先例）
      try {
        appendSentinelEvent(this.db as Database.Database, {
          event_type: 'ticket_transition',
          sentinel_id: row.signal_id || ticketId,
          aggregate_id: ticketId,
          payload: { ticketId, from, to, at: new Date().toISOString() },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, ticketId }, '[runner] ticket_transition 事件写入失败 — 非阻断');
      }

      return { ok: true, ticket: updated };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, ticketId, to }, '[runner] transitionTicket db 失败 — degraded');
      return { ok: false, degraded: true, error: msg };
    }
  }

  // ═══ Phase P1-1: L3WriteAPI (L0 进化层接口) ═══

  /**
   * 返回 L3WriteAPI 实现，供 L0 进化层调用。
   * 每个方法独立 try/catch，降级安全。
   */
  getL0API(): import('@synova/evolution').L3WriteAPI {
    const self = this;
    return {
      async closeTicket(orgId: string, sentinelId: string): Promise<number> {
        try {
          const db = self.db as {
            prepare(sql: string): {
              run(...args: unknown[]): { changes: number };
              all(...args: unknown[]): Array<{ id: string }>;
            };
          };
          const affected = db.prepare(
            `SELECT id FROM sentinel_tickets WHERE signal_id LIKE ? AND status = 'open'`
          ).all(`%${sentinelId}%`);
          const result = db.prepare(
            `UPDATE sentinel_tickets SET status = 'resolved', resolved_at = datetime('now')
             WHERE signal_id LIKE ? AND status = 'open'`
          ).run(`%${sentinelId}%`);
          if (result.changes > 0) {
            log.info({ orgId, sentinelId, closed: result.changes }, '[L3WriteAPI] 工单已关闭');
            // I3 审计: 写 ticket_transition 事件（工单 resolved）
            for (const row of affected) {
              try {
                appendSentinelEvent(self.db as Database.Database, {
                  event_type: 'ticket_transition',
                  sentinel_id: sentinelId,
                  aggregate_id: row.id,
                  payload: { ticketId: row.id, signalId: sentinelId, to: 'resolved', at: new Date().toISOString() },
                });
              } catch (evErr: unknown) {
                const evMsg = evErr instanceof Error ? evErr.message : String(evErr);
                log.warn({ err: evMsg, ticketId: row.id }, '[L3WriteAPI] ticket_transition 事件写入失败 — 非阻断');
              }
            }
          }
          return result.changes;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg, orgId, sentinelId }, '[L3WriteAPI] closeTicket 失败 — degraded');
          return 0;
        }
      },

      async getThreshold(orgId: string, sentinelId: string): Promise<{ warning: number; critical: number } | null> {
        // D577 DS7: 委托 resolveThresholds（manifest 基线 + memStore 覆写合并，单一解析点）。
        // 行为等价: memStore 命中 → 覆写主指标对；未命中 → manifest 首个 key；两者皆缺 → { 0.5, 1.0 }。
        // 兼容双键: threshold_${name} 与 threshold_sentinel-${name}（org-adapter 传 config.id 的存量写入）。
        try {
          const { resolveThresholds } = await import('./sentinel-loader');
          const bareId = sentinelId.replace(/^sentinel-/, '');
          const { thresholds, overrideMetric } = await resolveThresholds(bareId, orgId);
          const primary = overrideMetric ?? Object.keys(thresholds)[0];
          if (primary && thresholds[primary]) {
            return { ...thresholds[primary] };
          }
        } catch (err: unknown) {
          log.warn({
            err: err instanceof Error ? err.message : String(err),
            sentinelId,
          }, 'getThreshold 阈值解析失败 — 使用默认值');
        }

        // 3. 通用默认值
        return { warning: 0.5, critical: 1.0 };
      },

      async updateThreshold(orgId: string, sentinelId: string, threshold: { warning?: number; critical?: number }): Promise<void> {
        try {
          const existing = await this.getThreshold(orgId, sentinelId);
          const { getAgentMemoryStore } = await import('../l4/agent-memory-store');
          const { getDatabase } = await import('../init/engine-context');
          const db = getDatabase();
          const memStore = getAgentMemoryStore(db);
          memStore.remember({
            orgId,
            key: `threshold_${sentinelId}`,
            value: JSON.stringify({
              sentinelId,
              newThreshold: {
                warning: threshold.warning ?? existing?.warning ?? 0.5,
                critical: threshold.critical ?? existing?.critical ?? 1.0,
              },
              adjustedAt: new Date().toISOString(),
            }),
            type: 'enterprise_fact',
            confidence: 0.8,
            source: 'l3_write_api',
            tags: ['threshold_adjustment', sentinelId],
            expiresAt: null,
          });
          log.info({ orgId, sentinelId, threshold }, '[L3WriteAPI] 阈值已更新');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg, orgId, sentinelId }, '[L3WriteAPI] updateThreshold 失败 — degraded');
        }
      },

      async getSentinelStats(industry: string): Promise<import('@synova/evolution').PerSentinelStats[]> {
        try {
          const { getAgentMemoryStore } = await import('../l4/agent-memory-store');
          const { getDatabase } = await import('../init/engine-context');
          const db = getDatabase();
          const memStore = getAgentMemoryStore(db);

          // 按 industry:{name} 标签查询所有组织的哨兵得分
          const memories = memStore.list({
            orgId: 'global',
            tags: [`industry:${industry}`],
            limit: 200,
          });

          // 聚合: 按 sentinelId 分组统计
          const sentinelMap = new Map<string, number[]>();
          for (const mem of memories) {
            try {
              const data = JSON.parse(mem.value) as { sentinelId?: string; score?: number };
              if (data.sentinelId && typeof data.score === 'number') {
                const list = sentinelMap.get(data.sentinelId) || [];
                list.push(data.score);
                sentinelMap.set(data.sentinelId, list);
              }
            } catch {
              log.debug({ sentinelId: (mem?.value ? 'parse_failed' : 'no_value') }, '跳过损坏的哨兵分数数据');
            }
          }

          const stats: import('@synova/evolution').PerSentinelStats[] = [];
          for (const [sentinelId, values] of sentinelMap) {
            const sorted = [...values].sort((a, b) => a - b);
            const n = sorted.length;
            stats.push({
              sentinelId,
              name: sentinelId,
              orgCount: n,
              values: sorted,
              median: n > 0 ? sorted[Math.floor(n / 2)] : 0,
              p25: n > 0 ? sorted[Math.floor(n * 0.25)] : 0,
              p75: n > 0 ? sorted[Math.floor(n * 0.75)] : 0,
            });
          }

          return stats;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg, industry }, '[L3WriteAPI] getSentinelStats 失败 — degraded');
          return [];
        }
      },
    };
  }

  // ═══ D6: 通知去重（D580 8-3: 持久化优先, 内存兜底 — B-19 裁决 2） ═══

  private isNotificationDuplicate(signal: { sources: Array<{ sentinelId: string }> }): boolean {
    const sentinelId = signal.sources[0]?.sentinelId;
    if (!sentinelId) return false;
    // D580 8-3: 优先读持久化表（重启复活; 命中即回填内存缓存）; db 失败 → 回退内存 Map + log.warn（不静默）
    try {
      const db = this.db as {
        prepare(sql: string): { get(key: string): { last_sent_ms: number } | undefined };
      };
      const row = db.prepare('SELECT last_sent_ms FROM sentinel_notification_dedup WHERE key = ?').get(sentinelId);
      if (row && typeof row.last_sent_ms === 'number') {
        this.notificationSentTimestamps.set(sentinelId, row.last_sent_ms);
        return Date.now() - row.last_sent_ms < this.NOTIFICATION_DEDUP_MS;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, sentinelId }, '[runner] 去重表读取失败 — 回退内存 Map（degraded）');
    }
    const lastSent = this.notificationSentTimestamps.get(sentinelId);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.NOTIFICATION_DEDUP_MS;
  }

  private markNotificationSent(signal: { sources: Array<{ sentinelId: string }> }): void {
    const sentinelId = signal.sources[0]?.sentinelId;
    if (!sentinelId) return;
    const now = Date.now();
    // 内存缓存写穿 + 持久化表 UPSERT（失败 → log.warn 内存兜底 — 行为与改造前一致, 不静默）
    this.notificationSentTimestamps.set(sentinelId, now);
    try {
      (this.db as {
        prepare(sql: string): { run(...args: unknown[]): unknown };
      }).prepare('INSERT OR REPLACE INTO sentinel_notification_dedup (key, last_sent_ms) VALUES (?, ?)')
        .run(sentinelId, now);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, sentinelId }, '[runner] 去重表写入失败 — 内存兜底（degraded）');
    }
  }

  // ═══ Private ═══

  private scheduleSentinel(sentinel: Sentinel, cron: string): void {
    const cronJobId = this.scheduler.schedule(
      `Sentinel: ${sentinel.config.name}`,
      cron,
      async () => {
        await this.executeSentinel(sentinel);
      },
    );
    this.cronJobIds.set(sentinel.config.id, cronJobId);

    log.info({ sentinelId: sentinel.config.id, cron }, '[runner] 哨兵已调度');
  }

  private async executeSentinel(sentinel: Sentinel): Promise<SentinelCheckResult> {
    const startTime = Date.now();
    try {
      // V4.2.9: 构造上下文 — 包装 raw SQLite 为 GraphStore 供哨兵 queryNodes()
      let graphCtx: unknown;
      if (typeof this.db === 'object' && this.db !== null && 'queryNodes' in this.db) {
        graphCtx = this.db;
      } else {
        try {
          const { SqliteGraphStore } = await import('../adapters/sqlite-graph-store');
          graphCtx = new SqliteGraphStore(this.db as Database.Database);
        } catch {
          log.warn({ sentinelId: sentinel?.config?.id }, 'GraphStore 创建失败 — 降级至原始 db');
          graphCtx = this.db;
        }
      }
      const ctx = {
        db: graphCtx,
        now: new Date(),
        registry: getSentinelRegistry(),
      };

      const result = await sentinel.check(ctx);

      // D37: 冲突检测注入 — 旁路增强（不阻断，不改变现有 aggregate 行为）
      this.injectConflictFindings(result, graphCtx);

      const duration = Date.now() - startTime;
      result.durationMs = duration;
      // I1 可重建: 确保 checkedAt 恒为有效 ISO 时间戳（重放需确定性 run key）
      if (!result.checkedAt) result.checkedAt = new Date().toISOString();
      // K3 §4.6 findings 生命周期正名: 新 finding 默认 status='open'
      for (const f of result.findings) {
        if (!f.status) f.status = 'open';
      }

      // 记录运行
      const record: SentinelRunRecord = {
        sentinelId: sentinel.config.id,
        sentinelName: sentinel.config.name,
        result,
        cronJobId: this.cronJobIds.get(sentinel.config.id) || '',
      };

      // I2 单源: 先落事件流（唯一写入口，fail-closed），再物化投影
      try {
        this.persistRunEvents(record);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, sentinelId: sentinel.config.id },
          '[runner] 哨兵事件持久化失败 — 降级为纯内存态（重启即丢）');
      }
      this.projectRunRecord(record);
      this.totalRuns++;

      // 记录发现
      // 基线记录 + 对比 (B2)
      try {
        const baselineStore = getBaselineStore();
        baselineStore.record(sentinel.config.id, result.findings);
        const comparison = baselineStore.compare(sentinel.config.id, result.findings);
        if (comparison.deviation.findingCountRatio > 2 && comparison.baseline.baselineReady) {
          log.warn({
            sentinelId: sentinel.config.id,
            ratio: comparison.deviation.findingCountRatio.toFixed(1),
            baseline: comparison.baseline.avgFindingCount.toFixed(1),
            current: comparison.current.findingCount,
          }, '[runner] 基线偏离 — finding 数量异常');
        }
      } catch (baselineErr: any) {
        log.debug({ err: baselineErr.message }, '[runner] 基线记录失败 (非阻断)');
      }

      if (result.findings.length > 0) {
        const critical = result.findings.filter(f => f.severity === 'critical').length;
        const warning = result.findings.filter(f => f.severity === 'warning').length;
        log.warn({
          sentinelId: sentinel.config.id,
          total: result.findings.length,
          critical,
          warning,
          durationMs: duration,
        }, `[runner] 哨兵发现: ${result.findings.length} 条 (${critical} critical, ${warning} warning)`);
      }

      if (!result.ok) {
        log.error({
          sentinelId: sentinel.config.id,
          error: result.error,
          durationMs: duration,
        }, '[runner] 哨兵执行失败');
      }

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      log.error({ sentinelId: sentinel.config.id, err, durationMs: duration }, '[runner] 哨兵异常 (未捕获)');

      return {
        sentinelId: sentinel.config.id,
        ok: false,
        findings: [],
        durationMs: duration,
        checkedAt: new Date().toISOString(),
        error: (err as Error).message || '未知错误',
        degraded: true,
      };
    }
  }

  /**
   * D37: 冲突检测注入 — 旁路增强。
   * 对哨兵发现中关联的节点检测数据冲突，有冲突则追加 warning 发现。
   * 不阻断执行，不修改现有 aggregate 行为。
   */
  private injectConflictFindings(result: SentinelCheckResult, graphCtx: unknown): void {
    for (const finding of result.findings) {
      if (!finding.relatedNodeId) continue;
      try {
        if (typeof graphCtx !== 'object' || graphCtx === null) continue;
        const store = graphCtx as Record<string, unknown>;
        if (typeof store.getNode !== 'function') continue;
        const node = (store.getNode as (id: string, graph?: string) => unknown)(finding.relatedNodeId);
        if (!node) continue;
        const nodeObj = node as Record<string, unknown>;
        const props = (nodeObj.props || {}) as Record<string, unknown>;
        if (props.has_conflict === true) {
          const versions = Array.isArray(props.data_versions)
            ? (props.data_versions as unknown[]).length
            : 0;
          result.findings.push({
            id: `conflict-${finding.relatedNodeId}`, // D354: 稳定 id — 同节点跨轮同 id (N14 去重键)
            severity: 'warning',
            title: `数据冲突: 节点 ${finding.relatedNodeId} 存在 ${versions} 个版本`,
            description: '节点数据存在冲突版本，可能影响分析准确性',
            evidence: [],
            suggestion: '审查冲突数据版本并决定保留哪个',
            detectedAt: new Date().toISOString(),
            relatedNodeId: finding.relatedNodeId,
          });
          log.warn({ relatedNodeId: finding.relatedNodeId, versions },
            '冲突检测: 节点存在数据冲突');
        }
      } catch {
        log.debug({ relatedNodeId: finding.relatedNodeId }, '冲突检测失败 — 非阻断');
      }
    }
  }
}

// ═══ Global Singleton ═══

let _globalRunner: SentinelRunner | null = null;

export function getGlobalSentinelRunner(): SentinelRunner | null {
  return _globalRunner;
}

export function setGlobalSentinelRunner(runner: SentinelRunner | null): void {
  _globalRunner = runner;
}
