/**
 * routes/sessions.ts — 会话 REST API (Era 3.1)
 *
 * GET    /api/sessions              → 列表
 * POST   /api/sessions              → 创建
 * GET    /api/sessions/:id          → 详情 + 消息
 * GET    /api/sessions/search?q=    → FTS5 搜索
 * DELETE /api/sessions/:id          → 删除
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { loadConfig } from '../config';
import { resolveRequestOrgId, type JwtPayload } from '../middleware/auth';
// D603 跨层修复（簇4）: SessionStore 构造/句柄直取下沉 L2——注入优先（server.ts
// app.locals.sessionStore ← Bootstrap Phase 0 单例），未注入环境兜底装配（行为同前）。
import { createSystemSessionStore, type SessionStore } from '../agent/session-storage-service';

const router = Router();
const log = createLogger('routes/sessions');

function getStore(req: Request): SessionStore {
  const injected = (req.app.locals as Record<string, unknown>).sessionStore as SessionStore | undefined;
  if (injected) return injected;
  return createSystemSessionStore();
}

// ═══ List ═══
router.get('/api/sessions', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const store = getStore(req);
    const sessions = store.listSessions(limit);
    res.json({ ok: true, sessions, count: sessions.length });
  } catch (err: any) {
    log.error({ err }, '列出会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_LIST_ERROR' });
  }
});

// ═══ Create ═══
router.post('/api/sessions', (req: Request, res: Response) => {
  try {
    const { orgId } = req.body;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: 'orgId 必填', code: 'VALIDATION_ERROR' });
    }
    // #1228 S0-2b 点 5：必填 400（形状）之后才做归属闸；请求值只作声明，落库用来源
    const requestOrg = resolveRequestOrgId(
      req as Request & { auth?: JwtPayload },
      orgId,
      loadConfig().orgId,
    );
    if (!requestOrg.ok) {
      log.warn(
        { code: requestOrg.code, reason: requestOrg.reason, path: req.path },
        '安全判据: 被拒绝 — 声明 orgId 与组织来源不一致（HTTP 403 fail-closed）',
      );
      return res.status(403).json({ ok: false, code: requestOrg.code, reason: requestOrg.reason });
    }
    const store = getStore(req);
    const session = store.createSession(requestOrg.orgId);
    res.status(201).json({ ok: true, session });
  } catch (err: any) {
    log.error({ err }, '创建会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_CREATE_ERROR' });
  }
});

// ═══ Search (MUST be before /:id to avoid route conflict) ═══
router.get('/api/sessions/search', (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    if (!q) {
      return res.status(400).json({ ok: false, error: 'q 参数必填', code: 'VALIDATION_ERROR' });
    }
    const store = getStore(req);
    const results = store.search(q, 10);
    res.json({ ok: true, results, count: results.length });
  } catch (err: any) {
    log.error({ err }, '搜索会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_SEARCH_ERROR' });
  }
});

// ═══ Get ═══
router.get('/api/sessions/:id', (req: Request, res: Response) => {
  try {
    const store = getStore(req);
    const session = store.getSession(req.params.id as string);
    if (!session) {
      return res.status(404).json({ ok: false, error: '会话不存在', code: 'NOT_FOUND' });
    }
    const messages = store.getMessages(req.params.id as string);
    res.json({ ok: true, session, messages });
  } catch (err: any) {
    log.error({ err }, '获取会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_GET_ERROR' });
  }
});

// ═══ Rename (D251) ═══
router.patch('/api/sessions/:id/title', (req: Request, res: Response) => {
  try {
    const { title } = req.body as { title?: string };
    if (!title || !title.trim()) {
      return res.status(400).json({ ok: false, error: 'title 必填', code: 'VALIDATION_ERROR' });
    }
    const store = getStore(req);
    const session = store.getSession(req.params.id as string);
    if (!session) {
      return res.status(404).json({ ok: false, error: '会话不存在', code: 'NOT_FOUND' });
    }
    const ok = store.renameSession(req.params.id as string, title.trim());
    if (!ok) {
      return res.status(500).json({ ok: false, error: '重命名失败', code: 'RENAME_ERROR', degraded: true });
    }
    res.json({ ok: true, id: req.params.id, title: title.trim() });
  } catch (err: any) {
    log.error({ err }, '重命名会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_RENAME_ERROR', degraded: true });
  }
});

// ═══ Delete ═══
router.delete('/api/sessions/:id', (req: Request, res: Response) => {
  try {
    const store = getStore(req);
    const session = store.getSession(req.params.id as string);
    if (!session) {
      return res.status(404).json({ ok: false, error: '会话不存在', code: 'NOT_FOUND' });
    }
    store.deleteSession(req.params.id as string);
    res.json({ ok: true, deleted: req.params.id });
  } catch (err: any) {
    log.error({ err }, '删除会话失败');
    res.status(500).json({ ok: false, error: err.message, code: 'SESSION_DELETE_ERROR' });
  }
});

export default router;
