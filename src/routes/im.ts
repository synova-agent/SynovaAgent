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
import { allowedSensitivities, extractAuthFromRequest } from '../middleware/auth';

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

    /**
     * D1154 / #984（**可观测面**）— 本端点是知识漏斗的**真消费点**。
     *
     * 契约（铁律 47 — 输入/输出/降级）:
     * - 输入: `req.auth`（jwtAuthMiddleware 验签后注入）；**不读 body 的 userId 作身份**
     *   （自报字段不可作身份来源，D947 同一姿态）。
     * - 输出: 已验签 ⇒ 建立请求级上下文（user + authProvider）⇒
     *   `qa-router.ts:84` 的 `getCurrentFilterClause` 得到 `access.sensitivity IN
     *   allowedSensitivities(role, clearance)`（**非 deny-all**）⇒ 已认证用户能检索到知识。
     * - 降级: `req.auth` 不存在 ⇒ **不建立**请求级上下文（等价于「不传 authProvider」）⇒
     *   漏斗落 deny-all 兜底（`services/request-context.ts:75-85`），**不新增 401/403 门槛**
     *   —— `tests/l1/qa-router.test.ts` 直连本端点不带 JWT，行为不变式必须保持。
     *
     * 白名单规则单一真源 = `middleware/auth.ts` 的 `allowedSensitivities`（不复制第二份）。
     */
    const auth = extractAuthFromRequest(req);
    const ask = () => answerQuestion({
      question,
      // 身份优先取**验签**结果；无验签身份时保持改造前的 body 回退（行为不变式）
      userId: auth?.userId ?? (userId || 'web-user'),
      teamId,
      knowledgeLevel: knowledgeLevel as 1 | 2 | 3 | undefined,
    });

    const result = auth
      ? await runWithContext({
          user: {
            userId: auth.userId,
            identity: { openId: auth.userId, email: `${auth.userId}@${auth.orgId}`, name: auth.userId, source: 'jwt' },
            auth: { roles: [auth.role], teamId: auth.orgId, tenantId: auth.orgId, sensitivity: 'normal' },
            permissions: { version: 1, expiresAt: Date.now() + 3600000 },
          },
          authProvider: {
            getPermissionFilter: async (ctx) => ({
              conditions: [{
                field: 'access.sensitivity',
                operator: 'IN' as const,
                value: allowedSensitivities(ctx.auth.roles[0], ctx.auth.sensitivity),
              }],
            }),
          },
        }, ask)
      : await ask();

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
