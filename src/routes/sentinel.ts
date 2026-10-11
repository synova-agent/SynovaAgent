/**
 * routes/sentinel.ts — Sentinel 哨兵 API (L1)
 * @state: real
 *
 * GET  /api/sentinel/findings   — 哨兵发现列表 (可按 sentinelId/severity 过滤)
 * GET  /api/sentinel/signals    — 信号聚合结果 (交叉关联 + 专家建议)
 * POST /api/sentinel/run/:id    — 手动触发一次哨兵检查
 * GET  /api/sentinel/reports    — 专家报告列表
 * GET  /api/sentinel/tickets    — 工单列表 (D580 8-2: 表读同源, 表空/读失败 → 内存兜底 + degraded; ?status= 过滤)
 * POST /api/sentinel/tickets/:id/transition — 工单状态机迁移 (D580 8-4: open→acknowledged→resolved / open→dismissed, 非法迁移 409)
 *
 * 铁律 39: L1 通过 L2 sentinel-service 获取数据，不直接访问 L3。
 */

import { Router, type Request, type Response } from 'express';
import {
  getSentinelFindings,
  getAggregatedSignals,
  runSentinelOnce,
  getSentinelExpertReports,
  getSentinelTickets,
  transitionSentinelTicket,
} from '../agent/sentinel-service';
import type { TicketStatus, SentinelTicketTransitionResult } from '../agent/sentinel-service'; // 铁律 39: L1 类型经 L2 出口（L1→L3 直触已被 CI 拦截, 2026-09-06 修复）
import type { TicketRow } from '../sentinel/runner'; // 类型经 L3 出口（值经 L2；L1→L3 类型引用不违铁律 39 的运行时边界）
import { getDecisionRecordingSeam, getDecisionLedgerReader } from '../agent/conversation-engine';
import type { DecisionInput, DecisionResult } from '../l4/decision-capture';
import { createLogger } from '@synova/logger';

const log = createLogger('routes/sentinel');
const router = Router();

/** sentinel_tickets.status 四态（DDL CHECK 枚举; ?status= 白名单 — 非法值按缺省处理, 对齐 findings 路由 idiom） */
const TICKET_STATUSES: readonly string[] = ['open', 'acknowledged', 'resolved', 'dismissed'];

/** 从 `diagnosis`（JSON 串）取工单标题 —— 解析失败按 signal_id 兜底并 log.warn（对齐 L2 `rowToTicketView` 先例，铁律 24） */
function ticketTitleOf(row: TicketRow): string {
  if (!row.diagnosis) return row.signal_id;
  try {
    const parsed = JSON.parse(row.diagnosis) as { title?: unknown; summary?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title : undefined;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined;
    return title ?? (summary !== undefined ? summary.slice(0, 80) : row.signal_id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, ticketId: row.id }, '[sentinel] 工单 diagnosis JSON 损坏 — signal_id 兜底（不静默）');
    return row.signal_id;
  }
}

/**
 * K12-08 C3 触发点：把「工单关闭时的人工裁决」落进决策台账 ④（宪章 §4.4：③ 是唯一允许写 ④ 的角色）。
 *
 * 契约（铁律 47）:
 *   @input  input.ticket     — 迁移后**以表为准重读**的工单行（L3 权威行，不是内存拼装副本）
 *           input.operatorId — 做出裁决的人（POST body `operatorId`）；缺省 → `'unknown-operator'`（入 gaps 可见）
 *           input.role       — 该人岗位 / 角色包 id（POST body `role`）；缺省 → `'ga-operator'`
 *           input.orgId      — 图名（组织/租户）；缺省 → `'default'`
 *   @output `{recorded, error?, reason?}` —— `recorded=false` 时 `error` 必在场（禁静默）；
 *           `reason='SEAM_NOT_WIRED'` 表示装配链未就绪（进程级接缝未注册）
 *   @degraded 接缝缺席 / `captureDecision` 落账失败 ⇒ **不抛**，返回 `recorded:false` ＋ 原因；
 *           调用方（路由）据此 log.warn ＋ `X-Ledger-Recorded: false`（降级显式传播，铁律 24/31）
 *   @sideEffect 经 L2 接缝 `recordDecision` → L4 `captureDecision` → 图存储 `createEdge`（台账一行）
 *
 * 为什么经引擎接缝而不是直调 `captureDecision`：宪章 §4.4 硬规则 —— L1 **不许直写 ④**，
 * 落账必须经 ③ 的职责路径；`recordDecision` 即该路径在代码里的接缝（#312 已合）。
 */
async function recordTicketResolution(input: {
  ticket: TicketRow;
  operatorId?: string;
  role?: string;
  orgId?: string;
}): Promise<{ recorded: boolean; error?: string; reason?: string }> {
  const seam = getDecisionRecordingSeam();
  if (!seam) {
    return {
      recorded: false,
      reason: 'SEAM_NOT_WIRED',
      error: 'DecisionCapture 装配链未就绪（进程级接缝未注册）— 台账不落账',
    };
  }

  const { ticket, operatorId, role, orgId } = input;
  const graph = orgId ?? 'default';
  // 决策节点 = 触发本工单的哨兵信号（③ 的观测对象；台账行落在该节点上）
  const nodeId = ticket.signal_id !== '' ? ticket.signal_id : ticket.id;
  const resolvedAt = ticket.resolved_at ?? '';

  const decision: DecisionInput = {
    nodeId,
    userId: operatorId ?? 'unknown-operator',
    action: 'confirmed',
    role: role ?? 'ga-operator',
    reason: `工单关闭裁决：${ticketTitleOf(ticket)}（${ticket.id}）`,
    context: {
      orgId: graph,
      taskRef: ticket.id,
      summary: `哨兵工单 ${ticket.id} 由 ${ticket.status} 关闭为 resolved（signal=${nodeId}，severity=${ticket.severity}）`,
    },
    output: { kind: 'ticket-resolution', ref: ticket.id, digest: `${ticket.id}@${resolvedAt}` },
    presetVersion: DEFAULT_LEDGER_PRESET_VERSION,
    review: {
      verdict: 'pass',
      by: operatorId ?? 'system-default',
      reason: `工单 ${ticket.id} 关闭（状态机 acknowledged→resolved，人工裁决）`,
    },
  };

  const result: DecisionResult = await seam.recordDecision(decision);
  if (!result.recorded) {
    return { recorded: false, error: result.error ?? '未落账（原因未给出）' };
  }
  return { recorded: true };
}

/**
 * 台账行的预设包版本基线（预设层内容面未接入时的出厂缺省）。
 *
 * 与 `decision-capture.ts` 的 `DEFAULT_PRESET_VERSION` 同值 —— 此处**显式传入**而非依赖缺省，
 * 让「哪版预设」这一要素在台账行里是**本触发点声明的事实**（预设层接入后改这一个常量即可）。
 */
const DEFAULT_LEDGER_PRESET_VERSION = 1;

// ═══ GET /api/sentinel/findings ═══

router.get('/findings', (req: Request, res: Response) => {
  try {
    const sentinelId = typeof req.query.sentinelId === 'string' ? req.query.sentinelId : undefined;
    const severity = ['critical', 'warning', 'info'].includes(req.query.severity as string)
      ? (req.query.severity as 'critical' | 'warning' | 'info')
      : undefined;
    const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 50), 200) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10) || 0) : 0;

    const result = getSentinelFindings({ sentinelId, severity, limit, offset });
    res.json(result);
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] findings 查询失败');
    res.status(500).json({ ok: false, total: 0, findings: [] });
  }
});

// ═══ GET /api/sentinel/signals ═══

router.get('/signals', (_req: Request, res: Response) => {
  try {
    const result = getAggregatedSignals();
    res.json(result);
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] signals 聚合失败');
    res.status(500).json({ ok: false, total: 0, criticalCount: 0, warningCount: 0, signals: [] });
  }
});

// ═══ POST /api/sentinel/run/:id ═══

router.post('/run/:id', async (req: Request, res: Response) => {
  try {
    const sentinelId = String(req.params.id);
    if (!sentinelId) {
      res.status(400).json({ ok: false, sentinelId: '', result: null, error: '缺少 sentinelId' });
      return;
    }
    const result = await runSentinelOnce(sentinelId);
    const status = result.ok ? 200 : result.error === 'SentinelRunner 未启动' ? 503 : 404;
    res.status(status).json(result);
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] runOnce 失败');
    res.status(500).json({ ok: false, sentinelId: req.params.id, result: null, error: (err as Error)?.message || '未知错误' });
  }
});

// ═══ GET /api/sentinel/reports ═══

router.get('/reports', (_req: Request, res: Response) => {
  try {
    const result = getSentinelExpertReports();
    res.json(result);
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] reports 查询失败');
    res.status(500).json({ ok: false, total: 0, reports: [] });
  }
});

// ═══ GET /api/sentinel/tickets — D580 8-2: 表读同源（死变量修复: status 过滤接通） ═══

router.get('/tickets', (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = raw !== undefined && TICKET_STATUSES.includes(raw) ? (raw as TicketStatus) : undefined;
    const result = getSentinelTickets(status);
    res.json(result);
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] tickets 查询失败');
    res.status(500).json({ ok: false, source: 'memory-fallback', degraded: true, tickets: [] });
  }
});

// ═══ GET /api/sentinel/tickets/:id/decisions — J5 / #405：④ 台账读回（工单的决策历史） ═══
//   200 { ok: true, ticketId, nodeId, count, decisions } — 读回成功（count=0 是合法业务态：还没人裁过）
//   404 { ok: false, error: 'TICKET_NOT_FOUND' }          — 无此工单行
//   503 { ok: false, code: 'LEDGER_READER_NOT_WIRED' }    — 读口未装配（bootstrap 降级传播）
//   200 { ok: false, degraded: true, errors }             — 读回部分失败（行损坏/查询异常；不静默）
//
// 业务语义（⑤ 的最小形态）：处理人看"这个工单（及其哨兵信号节点）此前谁裁过什么"——
// ④ 台账第一次有了业务消费者（此前只写不读：研究院 03 号件 J5 / G1）。

router.get('/tickets/:id/decisions', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const tickets = getSentinelTickets().tickets;
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) {
      res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
      return;
    }
    // nodeId 口径与写侧 recordTicketResolution 完全一致（signal_id 优先，工单 id 兜底）
    const nodeId = ticket.signalId !== undefined && ticket.signalId !== '' ? ticket.signalId : ticket.id;
    const orgId = typeof req.query.orgId === 'string' && req.query.orgId !== '' ? req.query.orgId : undefined;
    const reader = getDecisionLedgerReader();
    if (!reader) {
      log.warn({ ticketId: id }, '[sentinel] 台账读回未装配（LEDGER_READER_NOT_WIRED）— 503 显式降级');
      res.status(503).json({ ok: false, code: 'LEDGER_READER_NOT_WIRED', error: '决策台账读回端口未装配（bootstrap 未注册）' });
      return;
    }
    const result = reader(orgId)({ nodeId });
    if (!result.ok) {
      res.json({ ok: false, degraded: true, ticketId: id, nodeId, count: result.entries.length, decisions: result.entries, errors: result.errors });
      return;
    }
    res.json({ ok: true, ticketId: id, nodeId, count: result.entries.length, decisions: result.entries });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, '[sentinel] 台账读回失败');
    res.json({ ok: false, degraded: true, ticketId: (req.params as { id?: string }).id, decisions: [], errors: [msg] });
  }
});

// ═══ POST /api/sentinel/tickets/:id/transition — D580 8-4: 工单状态机迁移 ═══
//   200 { ok: true, ticket }                          — 迁移成功
//   400 { ok: false, error }                          — body 缺 to / to 非法枚举（INVALID_TARGET）
//   404 { ok: false, error: 'TICKET_NOT_FOUND' }      — 无此工单行
//   409 { ok: false, error: 'ILLEGAL_TRANSITION', from, to } — 白名单外迁移（含终态/同态）
//   503 { ok: false, degraded: true, error }          — db 不可用（degraded 传播链终点）
//
// 🔴 K12-08 C3（创始人 2026-10-11 裁）：`to === 'resolved'` = 「哨兵发现 → 工单关闭时的人工裁决」
//   ⇒ 它是**唯一**允许写决策台账 ④ 的用户动作（宪章 §4.4「③ 是唯一允许写 ④ 的角色」）。
//   落账经 L2 接缝 `recordDecision`（**不在这里直写 ④**）；落账失败**不阻断**工单迁移
//   （迁移已成功，台账是旁路资产）——但必 log.warn ＋ `X-Ledger-Recorded: false` 响应头，
//   降级显式可见（铁律 24/31），不静默吞。

router.post('/tickets/:id/transition', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const body = req.body as { to?: unknown; operatorId?: unknown; role?: unknown; orgId?: unknown } | undefined;
    if (!body || typeof body.to !== 'string' || body.to === '') {
      res.status(400).json({ ok: false, error: '缺少 to 字段（可选值: acknowledged | resolved | dismissed）' });
      return;
    }
    const result: SentinelTicketTransitionResult = transitionSentinelTicket(id, body.to);
    if (result.ok) {
      // 人工裁决落账（仅关闭动作；acknowledged/dismissed 不是「关单裁决」，不落账）
      let ledgerRecorded: boolean | undefined;
      if (body.to === 'resolved') {
        const outcome = await recordTicketResolution({
          ticket: result.ticket,
          operatorId: typeof body.operatorId === 'string' && body.operatorId !== '' ? body.operatorId : undefined,
          role: typeof body.role === 'string' && body.role !== '' ? body.role : undefined,
          orgId: typeof body.orgId === 'string' && body.orgId !== '' ? body.orgId : undefined,
        });
        ledgerRecorded = outcome.recorded;
        if (!outcome.recorded) {
          log.warn(
            { ticketId: id, error: outcome.error, reason: outcome.reason },
            '[sentinel] 工单关闭裁决**未**落决策台账（迁移照常生效）— 降级显式可见',
          );
        }
        res.setHeader('X-Ledger-Recorded', String(outcome.recorded));
      }
      res.status(200).json(ledgerRecorded === undefined ? result : { ...result, ledgerRecorded });
      return;
    }
    switch (result.error) {
      case 'INVALID_TARGET':
        res.status(400).json(result);
        break;
      case 'TICKET_NOT_FOUND':
        res.status(404).json(result);
        break;
      case 'ILLEGAL_TRANSITION':
        res.status(409).json(result);
        break;
      default:
        // degraded: db 不可用 / runner 未初始化
        res.status(503).json({ ok: false, degraded: true, error: result.error });
    }
  } catch (err: unknown) {
    log.error({ err }, '[sentinel] 工单迁移失败');
    res.status(500).json({ ok: false, degraded: true, error: (err as Error)?.message || '未知错误' });
  }
});

// ═══ POST /api/sentinel/alerts/:id/action — 交互式卡片回复 (D18) ═══

router.post('/alerts/:id/action', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { action, userId, enterpriseId } = req.body as {
      action: 'confirm' | 'dismiss' | 'details';
      userId: string;
      enterpriseId?: string;
    };

    if (!action || !userId) {
      res.status(400).json({ ok: false, error: 'Missing required fields: action, userId' });
      return;
    }

    const { InteractiveCardHandler } = await import('../agent/interactive-card');
    const handler = new InteractiveCardHandler();

    const result = await handler.handleAction(
      { findingId: id, action, userId, enterpriseId: enterpriseId || 'synova' },
    );

    res.json({ ok: result.status === 'success', cardUpdate: result.cardUpdate });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg, alertId: req.params.id }, '卡片操作处理失败');
    res.status(500).json({
      ok: false,
      cardUpdate: {
        title: '操作失败',
        body: '处理卡片操作时出错，请重试。',
        color: 'grey',
        interactive: false,
      },
    });
  }
});

export default router;
