/**
 * routes/knowledge.ts — 知识库 API (M1-Slice3)
 *
 * POST /api/knowledge/search — 全文搜索 + 权限过滤
 * POST /api/knowledge/ingest — 写入知识片段
 * GET  /api/knowledge/stats — 存储统计
 *
 * 铁律 39: L1 交互层，委托 L4 KnowledgeStore 执行查询
 */
import { Router, type Request, type Response } from 'express';
// D603 跨层修复（簇3）: KnowledgeStore 构造下沉 L2 桥接服务——不直触 init/engine-context（铁律 39）
import { createSystemKnowledgeStore, type KnowledgeStore } from '../agent/knowledge-bridge-service';
import { getCurrentFilterClause } from '../services/request-context';
import { createLogger } from '@synova/logger';
import { getPreUploadValidator } from '../security/pre-upload-validator';
import type { KnowledgeChunk, FilterClause } from '../agent/knowledge-bridge-service';

const log = createLogger('routes/knowledge');
const router = Router();

function getStore(): KnowledgeStore {
  return createSystemKnowledgeStore();
}

// ════════════════════════════════════════════════════════════════
// D1155 / 0-9bis — 审计归属：消费 req.rbac（L-4），不重算身份
// ════════════════════════════════════════════════════════════════

/**
 * 取当前请求的验签 RBAC 上下文。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: express Request。`req.rbac` 由 `middleware/rbac.rbacMiddleware` 注入
 *   （挂载点 `server.ts:366`，**早于**本路由的 `server.ts:402`）；
 *   其唯一可信来源是 `req.auth`（`jwtAuthMiddleware` 验签后写入）。
 * - 输出: 含 `userId` 的上下文对象，或 `undefined`（中间件未执行 / 未挂载）。
 * - 降级: 无。**不重算** `extractRbacContext(req)` —— 依 L-4，路由必须消费 `req.rbac`，
 *   取不到时由调用方回退 `'anonymous'`（保持本路由既有「无身份也放行」姿态不变：
 *   本卡只修**归属**，不新增任何拒绝门槛）。
 *
 * 形态说明: 此处刻意**不 import** `middleware/rbac` 的类型（卡 §架构层「零新增 import」），
 *   仅声明本路由**实际消费**的最小结构（`userId`）。代价：字段改名无编译期保护
 *   （会退化为 `undefined` ⇒ 回落 `'anonymous'`，不静默放行）。
 */
function readRbac(req: Request): { userId?: string } | undefined {
  return (req as Request & { rbac?: { userId?: string } }).rbac;
}

// ═══ 搜索 ═══

router.post('/api/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body as { query?: string; limit?: number };
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ ok: false, error: '缺少 query 参数' });
    }

    const store = getStore();
    const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;

    const { results, stats } = store.search(query, filter, limit || 10);

    // 审计日志 — D1155/0-9bis: 归属取**验签身份**（req.rbac ← req.auth）。
    //   原实现读的是请求对象上一个**全仓无人写入**的 `userId` 属性（判据：全仓搜「给该属性
    //   赋值」的语句 ⇒ 零命中）⇒ 该值恒 undefined ⇒ 审计表 `user_id` 恒 `'anonymous'`
    //   （审计不可归属）。取不到身份时回退 `'anonymous'`（姿态不变：不新增拒绝门槛）。
    const userId = readRbac(req)?.userId ?? 'anonymous';
    store.auditLog('knowledge_query', userId, query, stats);

    res.json({
      ok: true,
      query,
      results: results.map(r => ({
        id: r.id,
        snippet: r.snippet,
        sourceType: r.sourceType,
        authorityLevel: r.authorityLevel,
        createdAt: r.createdAt,
      })),
      stats,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, '知识库搜索失败');
    res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ 写入 ═══

router.post('/api/knowledge/ingest', (req: Request, res: Response) => {
  try {
    const { text, sourceType, sourceId, authorityLevel, accessLevel, accessTeamId, accessSensitivity } = req.body as Record<string, string>;
    if (!text || !sourceType || !sourceId) {
      return res.status(400).json({ ok: false, error: '缺少必填字段: text, sourceType, sourceId' });
    }

    // D42: 隐私预检
    const tenantId = (req as unknown as Record<string, string>).tenantId || sourceId;
    const validator = getPreUploadValidator();
    const check = validator.validate(text, tenantId);
    if (check.blocked) {
      log.warn({ tenantId, warnings: check.warnings }, '知识上传被隐私预检阻止');
      return res.status(422).json({ ok: false, error: '隐私预检未通过', warnings: check.warnings });
    }
    if (check.warnings.length > 0) {
      log.warn({ tenantId, warnings: check.warnings }, '知识上传含PII警告');
    }

    const store = getStore();
    const id = store.insert({
      text,
      sourceType,
      sourceId,
      authorityLevel: (authorityLevel as KnowledgeChunk['authorityLevel']) || 'reference',
      accessLevel: (accessLevel as KnowledgeChunk['accessLevel']) || 'private',
      accessTeamId,
      accessSensitivity: (accessSensitivity as KnowledgeChunk['accessSensitivity']) || 'normal',
    });

    res.json({ ok: true, id, warned: check.warnings.length > 0 ? true : undefined });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "知识写入失败");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ 统计 ═══

router.get('/api/knowledge/stats', (_req: Request, res: Response) => {
  try {
    const store = getStore();
    res.json({ ok: true, ...store.stats() });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "知识存储获取");
    res.json({ ok: true, totalChunks: 0, totalSizeBytes: 0 });
  }
});

export default router;
