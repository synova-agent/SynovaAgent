/**
 * routes/im.ts — IM Webhook 路由 (M1-Slice2)
 *
 * POST /api/im/feishu/webhook — 飞书消息推送
 * POST /api/im/wecom/webhook  — 企业微信消息推送
 *
 * 铁律 31: 降级模式 — 消息处理失败仍返回 200 (避免 IM 平台重试风暴)
 *   ⚠️ 该降级只覆盖**已通过签名闸门**的入站消息；闸门本身（K1-WH 段1a）一律 fail-closed。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { handleInboundMessage } from '../l1/im-inbound';
import { runWithContext } from '../services/request-context';
import { allowedSensitivities, extractAuthFromRequest } from '../middleware/auth';
import { computeFeishuSignature, DEFAULT_SIGNATURE_WINDOW_MS, isWithinTimeWindow, verifyFeishuSignature } from '../l1/im-webhook-signature';

const log = createLogger('routes/im');
const router = Router();

// ═══ 飞书回调签名闸门（K1-WH 段1a；父卡 #1126）══════════════════════════════════
//
// 断面：本闸门只在**路由层**成立。真入口 `src/server.ts:329` 的
//   `express.json({ limit: '10mb' })` 已**先缓冲**请求体 ⇒ 下方 64KB / 1MB 是
//   **判定级**闸门（按 `content-length` 判决），**不是内存级预闸**；
//   内存级前置闸门需段2 在全局 parser **之前**早挂载（段1b，与在飞 #1009 串行）。
//
// 配置态（`FEISHU_ENCRYPT_KEY`）:
//   - **未配置** ⇒ 无密钥可校验签名 ⇒ 保持改造前行为（放行）+ 每次请求 `log.warn`
//     （**不静默**，铁律 11）。若此处一律 401，会把仓内既存消费者
//     `tests/routes/im-authprovider.test.ts`（#984 接线面，非本卡写集）由 200 打成 401
//     —— 那是写集外的破坏性变更，且属段2 的配置面决定。
//   - **已配置** ⇒ 全程 **fail-closed**：缺签名头 / 缺 `rawBody` / 验签失败 / 时间窗外
//     一律 401；分层尺寸闸（未认证通道 64KB / 已认证通道 1MB）一律 413。
//
// `challenge`（`type: 'url_verification'`）姿态 = **不默认豁免验签**：
//   官方原文把 URL 验证排除在验签之外（"excluding request URL verification"）；
//   本卡**选**「encryptKey 已配置时 challenge 也验签」，**代价** = 若飞书首发 challenge
//   不带签名头，首次配置需临时开关 `FEISHU_CHALLENGE_SKIP_SIGNATURE=true`（默认关，
//   每次命中落 `log.warn`）；**移除条件** = 飞书控制台回调地址配置完成后必须删除该变量
//   （它只豁免 challenge，不豁免事件消息，也不放开其余 fail-closed 分支）。
const FEISHU_UNAUTHENTICATED_MAX_BYTES = 64 * 1024;
const FEISHU_AUTHENTICATED_MAX_BYTES = 1024 * 1024;

type FeishuGuardResult = { ok: true } | { ok: false; status: 401 | 413; code: string };

function feishuHeader(req: Request, name: string): string {
  const v = req.headers[name];
  return typeof v === 'string' ? v : '';
}

/** 判定级体量：优先 `content-length` 头；缺失/非法时回退已捕获的 rawBody 字节数 */
function feishuContentLength(req: Request): number {
  const declared = feishuHeader(req, 'content-length');
  if (declared !== '') {
    const n = Number(declared);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return Buffer.isBuffer(raw) ? raw.length : 0;
}

function guardFeishuWebhook(req: Request, isChallenge: boolean): FeishuGuardResult {
  const path = req.path;
  const encryptKey = process.env.FEISHU_ENCRYPT_KEY || '';
  const timestamp = feishuHeader(req, 'x-lark-request-timestamp');
  const nonce = feishuHeader(req, 'x-lark-request-nonce');
  const signature = feishuHeader(req, 'x-lark-signature');
  const hasSignatureHeaders = timestamp !== '' && nonce !== '' && signature !== '';
  const contentLength = feishuContentLength(req);

  if (encryptKey === '') {
    log.warn({ code: 'FEISHU_ENCRYPT_KEY_UNCONFIGURED', path },
      '飞书回调未配置 FEISHU_ENCRYPT_KEY — 无密钥可校验签名，按改造前行为放行');
    return { ok: true };
  }

  if (isChallenge && process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE === 'true') {
    log.warn({ code: 'FEISHU_CHALLENGE_SIGNATURE_SKIPPED', path },
      'challenge 豁免验签开关生效 — 完成回调地址配置后必须删除 FEISHU_CHALLENGE_SKIP_SIGNATURE');
    return { ok: true };
  }

  // ① 未认证通道（未带签名头）的判定级尺寸闸 —— 先于任何验签工作
  if (!hasSignatureHeaders && contentLength > FEISHU_UNAUTHENTICATED_MAX_BYTES) {
    return { ok: false, status: 413, code: 'FEISHU_UNAUTHENTICATED_BODY_TOO_LARGE' };
  }
  if (!hasSignatureHeaders) {
    return { ok: false, status: 401, code: 'FEISHU_SIGNATURE_HEADERS_MISSING' };
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  // 🔴 单一判决点：签名 + 时间窗 + `rawBody` 形态**全部**由 `verifyFeishuSignature` 判
  //   （不在此处短路 —— 卡 F4-⑧ 要求「单行改坏 ⇒ ②③④⑤ 一起变绿」，
  //    任何前置短路都会让改坏即红失效）。`rawBody` 缺席时**仍调用** verify，
  //    其 `missing_params` 分支即 fail-closed 拒绝；不得「拿不到就放行」。
  const verdict = verifyFeishuSignature(
    timestamp, nonce, encryptKey, rawBody as Buffer, signature, Date.now(),
  );
  if (!verdict.ok) {
    // `rawBody` 缺席是**两段之间的接缝**（该字段由段2 的早挂载提供，本卡不替段2 预设形态），
    // 单独给专用 code 便于运维区分「早挂载缺席」与「签名不对」。
    const code = !Buffer.isBuffer(rawBody) && verdict.reason === 'missing_params'
      ? 'FEISHU_RAW_BODY_MISSING'
      : `FEISHU_SIGNATURE_${verdict.reason ?? 'rejected'}`;
    return { ok: false, status: 401, code };
  }

  // ② 已认证通道的判定级尺寸闸（验签通过后放宽到 1MB）
  if (contentLength > FEISHU_AUTHENTICATED_MAX_BYTES) {
    return { ok: false, status: 413, code: 'FEISHU_AUTHENTICATED_BODY_TOO_LARGE' };
  }

  return { ok: true };
}

// ═══ 飞书 Webhook ═══

router.post('/api/im/feishu/webhook', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    const challenge = payload?.challenge || payload?.header?.challenge;

    // 🔴 签名闸门（先于 challenge 分支 —— challenge 不默认豁免，见上方姿态说明）
    const guard = guardFeishuWebhook(req, Boolean(challenge));
    if (!guard.ok) {
      log.warn({ code: guard.code, path: req.path, status: guard.status }, '飞书回调被签名闸门拒绝');
      res.status(guard.status).json({ ok: false, error: guard.code });
      return;
    }

    // URL 验证 (飞书首次配置时发送) —— 已过上方闸门（encryptKey 已配置时须带合法签名）
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

/**
 * 飞书签名闸门自检（供 `GET /api/im/health` 报告闸门是否**真的可用**，而非仅「配置了」）。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: **无**。探针为固定字面量，**不接受任何请求输入** ⇒ 不构成验签旁路。
 * - 输出: `{ armed, roundTrip, window }` 三个布尔 ——
 *   `armed` = `FEISHU_ENCRYPT_KEY` 是否非空；`roundTrip` = 按当前密钥「算签名→验签名」是否自洽
 *   （密钥为空串时 `verifyFeishuSignature` 判 `missing_params` ⇒ false，正是要暴露的配置错）；
 *   `window` = 同一固定时刻能否通过 ±1h 窗（应为 true）。
 * - **只回布尔，不回摘要**：摘要由密钥参与哈希，不进日志、不进响应（防离线比对材料外泄）。
 * - 降级: 密钥未配置 ⇒ `armed=false, roundTrip=false`；**不抛**、不返回任何密钥材料。
 *
 * 为什么放在路由层（而不是纯函数模块内）：本函数是 `computeFeishuSignature` /
 * `isWithinTimeWindow` / `verifyFeishuSignature` 的**真实运行时消费者**，
 * 让「闸门已武装」这件事可被运维直接观测（部署后一次 `GET /api/im/health` 即可判定）。
 */
function feishuSignatureGuardSelfCheck(): { armed: boolean; roundTrip: boolean; window: boolean } {
  const encryptKey = process.env.FEISHU_ENCRYPT_KEY || '';
  const nowMs = Date.now();
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = 'guard-self-check';
  const probeBody = Buffer.from('{"guard_self_check":true}', 'utf8');
  const expected = computeFeishuSignature(timestamp, nonce, encryptKey, probeBody);
  return {
    armed: encryptKey !== '',
    roundTrip: verifyFeishuSignature(timestamp, nonce, encryptKey, probeBody, expected, nowMs).ok,
    window: isWithinTimeWindow(timestamp, nowMs, DEFAULT_SIGNATURE_WINDOW_MS),
  };
}

router.get('/api/im/health', async (_req: Request, res: Response) => {
  try {
    const { getIMRegistry } = await import('../l1/im-channel');
    const imReg = getIMRegistry();
    const active = imReg.getActive();
    res.json({
      ok: true,
      activeChannel: active?.platform || null,
      registeredChannels: imReg.list().map((c: { platform: string }) => c.platform),
      // K1-WH 段1a: 入站验签闸门姿态（只回布尔 + 窗宽，不含任何密钥材料）
      feishuSignatureGuard: feishuSignatureGuardSelfCheck(),
    });
  } catch { log.debug('IM 健康检查 — 无活跃通道'); res.json({ ok: true, activeChannel: null, registeredChannels: [], feishuSignatureGuard: feishuSignatureGuardSelfCheck() });
  }
});

export default router;
