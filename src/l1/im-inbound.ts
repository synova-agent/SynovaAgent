/**
 * l1/im-inbound.ts — IM 入站消息处理 (M1-Slice2)
 *
 * 接收飞书/企微 webhook 推送 → 解析用户身份 → 存储消息到 Session
 *
 * 流程:
 *   Webhook POST → 提取 sender_id → 身份缓存查找
 *     → 新用户: 创建 Session → 存储消息
 *     → 老用户: 恢复 Session → 存储消息
 *     → 回复通过 IMSender 异步发回
 *
 * 铁律 31: 降级信号传播 — 任何环节失败返回 degraded
 */
import { createLogger } from '@synova/logger';
import type { PIIScrubber } from '../security/pii-scrubber';

// L1 本地类型镜像 — 避免静态跨层依赖 (铁律 39, 审计 2026-06-18)
interface SessionStoreLike {
  listSessions(limit: number): Array<{ id: string; updatedAt: string }>;
  createSession(teamId: string, userId: string): { id: string };
  deleteSession(id: string): void;
  addMessage(sessionId: string, role: string, content: string): void;
  getMessages(sessionId: string): Array<{ role: string; content: string }>;
  db?: unknown;
}

const log = createLogger('l1/im-inbound');

// ═══ 身份缓存 ═══

interface CachedIdentity {
  userId: string;
  openId: string;
  name: string;
  email: string;
  teamId: string;
  roles: string[];
  lastSeen: number;
}

const identityCache = new Map<string, CachedIdentity>();
const TTL_MS = 3_600_000; // 1 hour

// ═══ 消息类型 ═══

export interface InboundMessage {
  platform: 'feishu' | 'wecom';
  senderId: string;
  content: string;
  timestamp: string;
  rawPayload: Record<string, unknown>;
}

export interface InboundResult {
  ok: boolean;
  degraded: boolean;
  sessionId?: string;
  error?: string;
}

// ═══ 用户识别 ═══

function resolveSender(payload: Record<string, unknown>): CachedIdentity | null {
  const event = (payload.event || payload) as Record<string, unknown>;
  const sender: Record<string, unknown> | string | undefined =
    (event.sender || event.sender_id) as Record<string, unknown> | string | undefined;

  if (!sender) { log.warn({ payload: JSON.stringify(payload).slice(0, 200) }, 'Webhook 缺少 sender'); return null; }

  if (typeof sender === 'string') {
    const cached = identityCache.get(sender);
    if (cached && (Date.now() - cached.lastSeen < TTL_MS)) { return cached; }
    return createIdentity(sender, { name: `用户_${sender.slice(0, 8)}`, email: '', teamId: 'default', roles: ['employee'] });
  }

  const openId = (sender.open_id || sender.user_id || '') as string;
  if (!openId) return null;

  const cached = identityCache.get(openId);
  if (cached && (Date.now() - cached.lastSeen < TTL_MS)) { return cached; }

  return createIdentity(openId, {
    name: (sender.name || sender.user_name || `用户_${openId.slice(0, 8)}`) as string,
    email: (sender.email || '') as string,
    teamId: (sender.team_id || 'default') as string,
    roles: (sender.roles || ['employee']) as string[],
  });
}

function createIdentity(openId: string, extra: { name: string; email: string; teamId: string; roles: string[] }): CachedIdentity {
  const entry: CachedIdentity = {
    userId: `feishu:${openId}`,
    openId,
    name: extra.name,
    email: extra.email || `${openId.slice(0, 8)}@placeholder.local`,
    teamId: extra.teamId,
    roles: extra.roles,
    lastSeen: Date.now(),
  };
  identityCache.set(openId, entry);
  log.info({ userId: entry.userId }, '新用户已缓存');
  return entry;
}

// ═══ 消息处理 ═══

/**
 * 处理入站 IM 消息。
 * 当前只存储消息到 Session，AI 回复在 Slice 3 (L4 权限过滤) 之后接入。
 */
export function handleInboundMessage(
  store: SessionStoreLike,
  piiScrubber: PIIScrubber,
  msg: InboundMessage,
): InboundResult {
  try {
    // Step 1: 用户识别
    const identity = resolveSender(msg.rawPayload);
    if (!identity) {
      return { ok: false, degraded: false, error: '无法解析发送者身份' };
    }

    // Step 2: 查找已有 Session (按 userId 匹配最近一次会话)
    const sessions = store.listSessions(50);
    const existing = sessions.find(s =>
      (s as unknown as Record<string, unknown>).userId === identity.userId ||
      (s as unknown as Record<string, unknown>).userId === identity.openId
    );

    let sessionId: string;
    if (existing) {
      sessionId = existing.id;
    } else {
      const newSession = store.createSession(identity.teamId, identity.userId);
      sessionId = newSession.id;
      log.info({ sessionId, userId: identity.userId }, '新 IM 会话已创建');
    }

    // Step 3: PII 脱敏输入
    const scrubbed = piiScrubber.scrub(msg.content, 'S2');
    const userInput = scrubbed.cleaned || msg.content;

    // Step 4: 存储用户消息
    store.addMessage(sessionId, 'user', userInput);

    // Step 5: AI 回复 — 异步生成，不阻塞 Webhook 响应
    generateAIReply(store, sessionId, identity, userInput).catch(err => {
      log.warn({ err: err instanceof Error ? err.message : String(err), sessionId }, 'AI 回复生成失败');
    });

    // 先返回 200 确认收到（飞书要求 3s 内响应，AI 回复异步发送）
    return { ok: true, degraded: false, sessionId };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn({ err: error, senderId: msg.senderId }, 'IM 消息处理失败 — degraded');
    return { ok: false, degraded: true, error };
  }
}

// ═══ AI 回复生成 ═══

async function generateAIReply(
  store: SessionStoreLike,
  sessionId: string,
  identity: CachedIdentity,
  userInput: string,
): Promise<void> {
  const { createProvider } = await import('../providers');
  const { detectProvider } = await import('../providers/detect');
  const { ConversationEngine } = await import('../agent/conversation-engine');
  const { createSessionStoreFrom } = await import('../agent/session-storage-service'); // #4: L1→L5 收敛
  const { registerBuiltinTools } = await import('../agent/builtin-tools');

  const provider = createProvider(detectProvider(), {
    apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
    gatewayHost: process.env.OPENCLAW_GATEWAY_HOST,
    baseUrl: process.env.LLM_BASE_URL,
  });

  // D487: 会话事件装配 — builtinStore 先建，sessionManager+sessionStore 注入引擎
  // （诊断事件落 session_events；SessionManager 与 store 同源，消息事件持久化生效）
  const { SessionManager } = await import('../orchestrator/session-manager');
  const builtinStore = createSessionStoreFrom(store.db);
  const conv = new ConversationEngine(provider, {
    sessionId,
    sessionManager: new SessionManager({}, builtinStore),
    sessionStore: builtinStore,
  });
  registerBuiltinTools(conv.getToolRegistry(), store as unknown as Parameters<typeof registerBuiltinTools>[1], sessionId, () => conv.getPhase(), () => identity.teamId);

  // 恢复会话历史
  const msgs = store.getMessages(sessionId);
  for (const m of msgs) {
    if (m.role === 'user' || m.role === 'assistant') {
      (conv as unknown as { addToHistory?: (r: string, c: string) => void }).addToHistory?.(m.role, m.content);
    }
  }

  const result = await conv.processMessage(userInput);
  const reply = result.reply || '抱歉，我暂时无法回答。';

  // 存储 AI 回复
  store.addMessage(sessionId, 'assistant', reply);

  // 通过 IM 通道发送
  const { getIMRegistry } = await import('./im-channel');
  const imReg = getIMRegistry();
  const active = imReg.getActive();
  if (active) {
    await active.sendMessage(identity.openId, {
      text: reply.slice(0, 2000), // 飞书单条消息限制
    });
  }
}

// ═══ 会话清理 ═══

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(
  store: SessionStoreLike,
  timeoutMs = 1_800_000,
  intervalMs = 300_000,
): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const allSessions = store.listSessions(200);
    let cleaned = 0;
    for (const s of allSessions) {
      if (now - new Date(s.updatedAt).getTime() > timeoutMs) {
        store.deleteSession(s.id);
        cleaned++;
      }
    }
    if (cleaned > 0) log.info({ cleaned }, '会话超时清理完成');
  }, intervalMs);
  log.info('会话超时清理器已启动 (30min)');
}

export function stopSessionCleanup(): void {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}
