/**
 * routes/im.ts — IM Webhook 路由 (M1-Slice2)
 *
 * POST /api/im/feishu/webhook — 飞书消息推送
 * POST /api/im/wecom/webhook  — 企业微信消息推送
 *
 * 铁律 31: 降级模式 — 消息处理失败仍返回 200 (避免 IM 平台重试风暴)
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { handleInboundMessage } from '../l1/im-inbound';
import { runWithContext } from '../services/request-context';
import { allowedSensitivities } from '../middleware/auth';

const log = createLogger('routes/im');
const router = Router();

// ═══ 飞书 Webhook ═══

router.post('/api/im/feishu/webhook', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const challenge = payload?.challenge || payload?.header?.challenge;

    // URL 验证 (飞书首次配置时发送)
    if (challenge) {
      log.info('飞书 Webhook URL 验证');
      res.status(200).json({ challenge });
      return;
    }

    // 提取消息内容
    const event = payload?.event || payload;
    const content = typeof event?.message?.content === 'string'
      ? event.message.content
      : typeof event?.message === 'string'
        ? event.message
        : event?.text || JSON.stringify(event?.message || {});
    const senderId = event?.sender?.open_id || event?.sender_id || payload?.event?.sender?.open_id || 'unknown';

    // 获取依赖
    const { getDatabase } = await import('../init/engine-context');
    const { SessionStore: SS } = await import('../store/session-store');
    const store = new SS(getDatabase());

    const container = req.app.locals.container || req.app.locals;
    const piiScrubber = container.piiScrubber;
    if (!piiScrubber) {
      res.status(500).json({ ok: false, error: 'PIIScrubber not initialized' });
      return;
    }

    // M2: 建立请求级用户上下文 (KnowledgeAgent 工具执行时自动获取权限过滤)
    // #984: 必须**同时**注入 authProvider。只传 user 时 `getCurrentFilterClause` 会落回
    //   deny-all 兜底（services/request-context.ts:75-85）⇒ **已认证的飞书用户也拿 0 行**
    //   （实测：装配前 results=0 / 装配后 results=10 / 未认证 results=0）。
    //   白名单规则单一真源 = middleware/auth.ts 的 allowedSensitivities（此处不复制第二份）。
    const imUser = { userId: senderId, identity: { openId: senderId, email: '', name: senderId, source: 'feishu' }, auth: { roles: ['employee'], teamId: 'default', tenantId: 'default', sensitivity: 'normal' }, permissions: { version: 1, expiresAt: Date.now() + 3600000 } };
    const result = await runWithContext({
      user: imUser,
      authProvider: {
        getPermissionFilter: async (ctx) => ({
          conditions: [{
            field: 'access.sensitivity',
            operator: 'IN' as const,
            value: allowedSensitivities(ctx.auth.roles[0], ctx.auth.sensitivity),
          }],
        }),
      },
    }, async () => {
      return handleInboundMessage(store as unknown as Parameters<typeof handleInboundMessage>[0], piiScrubber, {
        platform: 'feishu',
        senderId,
        content: String(content),
        timestamp: new Date().toISOString(),
        rawPayload: payload,
      });
    });

    // 发送回复 (异步, fire-and-forget)
    if (result.ok) {
      try {
        const { getIMRegistry } = await import('../l1/im-channel');
        const imReg = getIMRegistry();
        const active = imReg.getActive();
        if (active) {
          await active.sendMessage(senderId, {
            text: `已收到 (会话 ${(result.sessionId || '').slice(-6)})`,
          });
        }
      } catch (err: unknown) { log.warn({ err }, 'IM 回复发送失败'); }
    }

    // 始终返回 200 — 避免飞书重试风暴
    res.status(200).json({ ok: true, sessionId: result.sessionId, degraded: result.degraded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'IM Webhook 异常');
    res.status(200).json({ ok: false, error: msg, degraded: true });
  }
});

// ═══ 企业微信 (stub) ═══

router.post('/api/im/wecom/webhook', async (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, note: '企业微信适配待实现' });
});

// ═══ 员工知识问答 (QA Router) ═══

router.post('/api/qa/ask', async (req: Request, res: Response) => {
  try {
    const { question, userId, teamId, knowledgeLevel } = req.body as { question?: string; userId?: string; teamId?: string; knowledgeLevel?: number };
    if (!question) return res.status(400).json({ ok: false, error: '缺少 question 参数' });

    const { answerQuestion } = await import('../l1/qa-router');
    const result = await answerQuestion({
      question,
      userId: userId || 'web-user',
      teamId,
      knowledgeLevel: knowledgeLevel as 1 | 2 | 3 | undefined,
    });

    res.json(result);
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "IM 消息处理失败");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ 健康检查 ═══

router.get('/api/im/health', async (_req: Request, res: Response) => {
  try {
    const { getIMRegistry } = await import('../l1/im-channel');
    const imReg = getIMRegistry();
    const active = imReg.getActive();
    res.json({
      ok: true,
      activeChannel: active?.platform || null,
      registeredChannels: imReg.list().map((c: { platform: string }) => c.platform),
    });
  } catch { log.debug('IM 健康检查 — 无活跃通道'); res.json({ ok: true, activeChannel: null, registeredChannels: [] });
  }
});

export default router;
