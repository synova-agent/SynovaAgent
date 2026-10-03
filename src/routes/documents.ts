/**
 * routes/documents.ts — 文档管理 API (KnowledgeAgent ④ 文档规范化)
 *
 * POST /api/documents/upload — 上传文档 → 规范化 → 分块 → FTS5索引
 * GET  /api/documents/list   — 列出已索引文档
 * GET  /api/documents/:id    — 获取文档详情和分块
 */
import { Router, type Request, type Response } from 'express';
// D603 跨层修复（簇3）: KnowledgeStore 构造下沉 L2 桥接服务——不直触 init/engine-context（铁律 39）
import { createSystemKnowledgeStore, type KnowledgeStore } from '../agent/knowledge-bridge-service';
// D947 P2 收口: 权限过滤条件统一走**唯一漏斗**（services/request-context）——
//   修复前本文件两处读端点写死空条件集字面量；实测 `l4/knowledge-store.ts:195/:335`
//   在 `filter.conditions.length === 0` 时**完全跳过过滤** ⇒ 空条件集 = 不过滤 = fail-open。
//   （注释措辞按 L-15 改写：不逐字复制该判据的正则字面量，原文见 git 历史。）
import { getCurrentFilterClause } from '../services/request-context';
import { createLogger } from '@synova/logger';

const log = createLogger('routes/documents');
const router = Router();

function getStore(): KnowledgeStore {
  return createSystemKnowledgeStore();
}

// ═══ POST /api/documents/upload ═══

router.post('/api/documents/upload', (req: Request, res: Response) => {
  try {
    const { text, title, sourceType, accessLevel, accessTeamId, tags } = req.body as {
      text?: string; title?: string; sourceType?: string; accessLevel?: string; accessTeamId?: string; tags?: string[];
    };

    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return res.status(400).json({ ok: false, error: 'text 字段必须且不少于10个字符' });
    }

    const store = getStore();
    const docId = `doc_${Date.now().toString(36)}`;

    // 规范化: 按段落分块，每块不超过 2000 字
    const chunks = chunkText(text, 2000);
    const chunkIds: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = store.insert({
        text: chunks[i],
        sourceType: sourceType || 'document',
        sourceId: `${docId}#${i}`,
        authorityLevel: 'reference',
        accessLevel: (accessLevel as 'public' | 'team' | 'private') || 'team',
        accessTeamId: accessTeamId || 'default',
        accessSensitivity: 'normal',
      });

      // 添加标签作为 PKB 元数据
      if (tags && tags.length > 0) {
        store.update(chunkId, {
          pkb_domain: tags[0],
          pkb_type: 'reference',
          pkb_confidence: 0.8,
          pkb_status: 'active',
          knowledge_level: 1,
        });
      }

      chunkIds.push(chunkId);
    }

    log.info({ docId, title, chunks: chunks.length, bytes: text.length }, '文档已分块索引');
    res.json({
      ok: true,
      docId,
      title: title || docId,
      chunkCount: chunks.length,
      totalBytes: text.length,
      chunkIds,
    });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文档检索失败");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ GET /api/documents/list ═══

router.get('/api/documents/list', async (_req: Request, res: Response) => {
  try {
    const store = getStore();
    // D947 P2: 过滤条件来自唯一漏斗（无验签上下文 ⇒ 漏斗返回拒绝型非空条件集，结果为空）
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    const { results } = store.search('', filter, 100);
    // 按 source_id 去重，每个文档只返回一条
    const seen = new Set<string>();
    const docs = results.filter(r => {
      const docId = r.sourceId.split('#')[0];
      if (seen.has(docId)) return false;
      seen.add(docId);
      return true;
    }).map(r => ({
      docId: r.sourceId.split('#')[0],
      sourceType: r.sourceType,
      createdAt: r.createdAt,
    }));

    res.json({ ok: true, documents: docs, count: docs.length });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文档存储获取");
    res.json({ ok: true, documents: [], count: 0 });
  }
});

// ═══ GET /api/documents/:id ═══

router.get('/api/documents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const store = getStore();
    // D947 P2: 过滤条件来自唯一漏斗（同上，不得写死空条件集）
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    const { results } = store.search(id, filter, 50);
    const chunks = results
      .filter(r => r.sourceId.startsWith(id))
      .map(r => ({
        chunkId: r.id,
        index: parseInt(r.sourceId.split('#')[1] || '0', 10),
        text: r.text.slice(0, 500),
        createdAt: r.createdAt,
      }))
      .sort((a, b) => a.index - b.index);

    if (chunks.length === 0) return res.status(404).json({ ok: false, error: '文档未找到' });

    res.json({
      ok: true,
      docId: id,
      chunkCount: chunks.length,
      totalBytes: chunks.reduce((s, c) => s + c.text.length, 0),
      chunks,
    });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文档检索失败");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// ═══ 辅助 ═══

function chunkText(text: string, maxLen: number): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      chunks.push(para.trim());
    } else {
      // 长段落按句子边界拆分
      const sentences = para.split(/(?<=[。！？\.\!\?])\s*/);
      let current = '';
      for (const s of sentences) {
        if (current.length + s.length > maxLen && current.length > 0) {
          chunks.push(current.trim());
          current = s;
        } else {
          current += s;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

export default router;
