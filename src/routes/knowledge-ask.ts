/**
 * knowledge-ask.ts — 知识问答全局入口 (PRD v1.6 Slice 6)
 *
 * GET  /api/knowledge/ask?q=... → 返回答案+来源+可选操作
 * POST /api/knowledge/ask → { question } → 返回答案+来源+可选操作
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';

const log = createLogger('routes/knowledge-ask');
const router = Router();

router.get('/api/knowledge/ask', async (req: Request, res: Response) => {
  const q = String(req.query.q || '');
  if (!q || q.length < 2) {
    return res.status(400).json({ ok: false, error: 'question too short (min 2 chars)' });
  }
  const result = await answerQuestion(q);
  res.json(result);
});

router.post('/api/knowledge/ask', async (req: Request, res: Response) => {
  const { question } = req.body as { question?: string };
  if (!question || question.length < 2) {
    return res.status(400).json({ ok: false, error: 'question too short (min 2 chars)' });
  }
  const result = await answerQuestion(question);
  res.json(result);
});

async function answerQuestion(q: string): Promise<Record<string, unknown>> {
  // v3.3: 接入 PKB 检索 + 专家知识目录
  let sources: string[] = [];
  let bestAnswer = '';

  try {
    // 尝试从 KnowledgeStore 搜索
    // 铁律 39（#4 基线收紧）: 装配经 L2 出口（agent/knowledge-bridge-service）——
    // 与修复前 `new KnowledgeStore(getDatabase())` 行为逐字节一致（该 L2 服务头注自述）；
    // getDatabase() 未初始化时同样抛出 ⇒ 由本层 catch 降级（语义不变）
    const { createSystemKnowledgeStore } = await import('../agent/knowledge-bridge-service');
    const store = createSystemKnowledgeStore();
    const results = store.search(q, {
      conditions: [
        { field: 'access_level', operator: 'EQ', value: 'public' },
        { field: 'access_level', operator: 'EQ', value: 'team' },
      ],
    }, 5);

    if (results.results.length > 0) {
      bestAnswer = results.results.map(r => r.text).join('\n\n---\n\n');
      sources = results.results.map(r => `pkb:${r.id}`).slice(0, 5);
    }
  } catch { /* KnowledgeStore unavailable — degraded to templates */ }

  // PKB 有结果 → 直接返回
  if (bestAnswer) {
    return { ok: true, answer: bestAnswer, sources, confidence: 'medium' };
  }

  // PKB 无结果 → 返回模板提示（比硬编码关键词更诚实）
  return {
    ok: true,
    answer: `关于"${q.slice(0, 60)}"，知识库中暂无直接匹配的信息。建议：1)在诊断工作区中上传相关数据 2)换一种方式描述你的问题 3)尝试以下方向：现金流分析、组织健康、客户集中度、增长瓶颈。`,
    sources: [],
    confidence: 'low',
  };
}

export default router;
