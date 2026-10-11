/**
 * routes/self-ops.ts ? ????? API ?? (D52-FIX)
 *
 * ?? system-self-ops.ts ?????????
 * ???????????? GA ??????????
 *
 * ??:
 *   @input  ? POST body: { op: string, params?: Record<string,unknown> }
 *   @output ? SelfOpResult { success, approved, result?, approvalTicketId?, warnings?: string[] }
 *   @degraded ? ??????????????
 *
 * ?? 24+31: catch + log.warn + degraded ??
 * ?? 38: ? as any
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import {
  executeSelfOp,
  collectHealthSnapshot,
  listAvailableOps,
} from '../deploy/system-self-ops';
import {
  HIGH_RISK_ACTIONS,
  requestApproval,
  resolveApprovalPolicy,
} from '../runtime/approval-seam';

const log = createLogger('routes/self-ops');
const router = Router();

/**
 * 宿主按名满足审批策略（DSH 借鉴: 按名声明 + 宿主满足）。
 *
 * 🔴 这一行是**启动期**的声明校验点（卡面 V4「声明缺失即报错」）:
 *   本模块加载时即调用 resolveApprovalPolicy —— 声明缺失 / 形态非法 / 缺省裁决非 reject
 *   ⇒ **抛错 ⇒ 进程起不来**，而不是等某次危险操作再悄悄放行。
 */
const APPROVAL_POLICY = resolveApprovalPolicy({
  version: 1,
  highRiskActions: HIGH_RISK_ACTIONS,
  defaultDecision: 'reject',
});

/**
 * 宿主应答端口 —— 「请人点头」的通道（按名注入；审批缝不 import 具体实现）。
 *
 * 🔴 现状如实披露: 本仓**尚未接入**人类应答通道（GA 审批卡片 / IM 回调未接线）
 *   ⇒ 端口恒为「无应答」⇒ 审批缝按 fail-closed 判 **拒**（不是"排队等放行"）。
 *   这**不是**降级: 卡面语义里「无人应答」是**确定结论**（拒 > 放行）。
 *   接入真实通道时只替换本函数体，审批缝与判定语义不变。
 */
const approvalAskPort = (): undefined => undefined;

/**
 * GET /api/self-ops/health
 * ????????????
 */
router.get('/api/self-ops/health', (_req: Request, res: Response) => {
  try {
    const snapshot = collectHealthSnapshot();
    res.json({ ok: true, data: snapshot });
  } catch (err) {
    log.error({ err }, '????????');
    res.status(500).json({ ok: false, error: '????', degraded: true });
  }
});

/**
 * GET /api/self-ops
 * ??????????
 */
router.get('/api/self-ops', (_req: Request, res: Response) => {
  try {
    const ops = listAvailableOps();
    res.json({ ok: true, data: ops });
  } catch (err) {
    log.error({ err }, '????????');
    res.status(500).json({ ok: false, error: '????', degraded: true });
  }
});

/**
 * POST /api/self-ops/execute
 * ???????????????????????????
 */
router.post('/api/self-ops/execute', async (req: Request, res: Response) => {
  try {
    const { op, params, requestedBy } = req.body || {};

    if (!op || !requestedBy) {
      res.status(400).json({
        ok: false,
        error: '?????? op ? requestedBy',
      });
      return;
    }

    // 🔴 人在环审批（K12-19 / #202）: 高风险动作先请人点头；无人应答 ⇒ 拒（fail-closed）
    if (HIGH_RISK_ACTIONS.includes(op)) {
      const outcome = await requestApproval({
        action: op,
        actor: String(requestedBy),
        ask: approvalAskPort,
        policy: APPROVAL_POLICY,
      });
      if (!outcome.allowed) {
        log.warn(
          { code: outcome.audit.code, op, requestedBy, degraded: outcome.degraded },
          '高风险动作被人在环审批缝拦下（无人应答/被拒 ⇒ 不执行）',
        );
        res.status(403).json({
          ok: false,
          code: 'APPROVAL_DENIED',
          message: '高风险动作需人在环审批；未获批准（无人应答视为拒）',
          approval: outcome.audit,
          errors: outcome.errors,
          degraded: outcome.degraded,
        });
        return;
      }
      log.info({ code: outcome.audit.code, op, requestedBy }, '高风险动作已获人类批准');
    }

    const result = executeSelfOp({ op, params, requestedBy });

    if (!result.success && !result.requiresApproval) {
      res.status(500).json({ ok: false, ...result });
      return;
    }

    if (result.requiresApproval) {
      res.status(202).json({ ok: true, ...result });
      return;
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    log.error({ err }, '????????');
    res.status(500).json({ ok: false, error: '????', degraded: true });
  }
});

export default router;
