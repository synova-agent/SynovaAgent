/**
 * knowledge-ask.ts — 知识问答全局入口 (PRD v1.6 Slice 6)
 *
 * GET  /api/knowledge/ask?q=... → 返回答案+来源+可选操作
 * POST /api/knowledge/ask → { question } → 返回答案+来源+可选操作
 *
 * #1075 P2-4b-A（K12-11 权限项）: 本入口是**免认证公共路由**（`src/middleware/auth.ts:168-176`
 * 白名单；带 Bearer 时白名单分支会验签并注入身份，`auth.ts:725-757`）。
 *   · 改前: 恒定两条 `access_level EQ`（public、team）——`matchFilter` 是**严格 AND**
 *     且 `access_level` 单值（`src/l4/knowledge-store.ts:701-724`）⇒ **恒 0 行**。
 *   · 本批: **只给带身份的认证分支**接上权限项（grants）唯一漏斗 ——
 *     `access_level IN (public,team)` ＋ `access.sensitivity IN allowedSensitivitiesByGrants(...)`。
 *   · **匿名分支逐字保持两条 EQ**（CTO 2026-10-29 裁定: 不借机放宽匿名读取；J2 逐字断言）。
 *
 * 设计哲学（一句）: **身份决定检索面，无身份保持原状** —— 一个分离（认证/匿名两支）
 *   ＋ 三条承诺（认证只收窄不放宽、匿名逐字不动、开关一关即回滚）。
 *
 * Known Limitations / 已知限制（不把现状说成已解决）:
 *   · 匿名入口**仍恒 0 行** —— 这是现状（两条 EQ ＋ AND 语义），本批不修（要修另卡并重定 J2）。
 *   · JWT 路径敏感度固定 `'normal'`（与 `src/middleware/auth.ts:936` 同值），**不读**自报 clearance 头。
 *   · 只做 sensitivity 维；scope 维（finance/people/market）待数据打标（#1149 一侧）。
 *   · 不宣称"不可绕过": 能改代码/配置者仍可绕；本批是工作流边界。
 *
 * 契约（铁律 47）:
 *   @input    — `buildKnowledgeAskFilter(auth?: KnowledgeAskAuth)`：auth 只来自**验签后**上下文
 *               （`extractAuthFromRequest`，`src/middleware/auth.ts:1007`）。
 *               🔴 禁裸 `req.auth` 取 role/orgId —— Express 的 `Request` 无该字段声明
 *               ⇒ `tsc --noEmit` 必红。
 *   @output   — `KnowledgeAskFilter`：`conditions`（**可变** `Array` —— l4 的
 *               `FilterClause.conditions` 是可变数组，`readonly` 不可赋 ⇒ tsc 红）
 *               ＋ `authApplied`（真值: 本次是否真按身份收窄）。
 *   @degraded — **本函数不抛**。`allowedSensitivitiesByGrants` 内部降级（坏包/未知项）
 *               仍返回**出厂交集**（不放宽）且自带 `log.warn`；回滚开关
 *               `SYNOVA_GRANTS_BRIDGE=off` ⇒ 走匿名分支 ＋ `log.warn`（非静默）。
 *   @authority — **只读**: 检索面由验签身份决定；本模块不签发身份、不改 grants 合成规则。
 *   @not-here  — grants 解析/合成（`packages/engine-auth/src/permission-grants.ts`）、
 *               JWT 验签与身份注入（`src/middleware/auth.ts`）、过滤执行（`src/l4/knowledge-store.ts`）。
 *   @error     — 无自定义错误类型: 检索不可用沿用既有 catch（降级到模板答案，不阻断请求）；
 *               入参过短由 handler 以 400 拒绝（沿用既有行为，不改语义）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
// #1075 P2-4b-A: 权限项（grants）**唯一漏斗**（`src/middleware/auth.ts:373`）—— 复用，禁复制规则。
// 🔴 身份只取既有导出 `extractAuthFromRequest(req)`（`auth.ts:1007`），不新增身份头、不读自报凭据。
import { extractAuthFromRequest, allowedSensitivitiesByGrants } from '../middleware/auth';
// 类型面 only（单行 —— check-architecture.sh 的 `import type` 编译期耦合豁免按行判定）:
// 运行期不 import l4（`better-sqlite3` 仍是函数内动态 import，保持既有降级姿态）。
import type { FilterClause } from '../l4/knowledge-store';

const log = createLogger('routes/knowledge-ask');
const router = Router();

/** 认证分支的身份（来自验签后的 `extractAuthFromRequest`；**不读自报头**） */
export interface KnowledgeAskAuth {
  readonly role: string;
  readonly orgId: string;
}

/** 知识检索过滤面 ＋ 是否真按身份收窄（响应字段 `authApplied` 为 **additive**） */
export interface KnowledgeAskFilter {
  /**
   * 🔴 必须是**可变** `Array`: `src/l4/knowledge-store.ts:9-11` 的 `FilterClause.conditions`
   * 是 `Array<...>`，`readonly`/`ReadonlyArray` 不可赋给它 ⇒ `tsc --noEmit` 必红。
   */
  readonly conditions: Array<{ field: string; operator: 'EQ' | 'IN'; value: string | string[] }>;
  /** 本次是否按验签身份收窄（匿名 / 回滚态恒 `false`，不假装生效） */
  readonly authApplied: boolean;
}

/**
 * 匿名过滤面 —— **逐字**保留 #1075 改前的两条 EQ（public、team）。
 *
 * 🔴 独立成函数的唯一理由是给 J2 的"逐字断言"一个单一出处；**语义与改前完全一致**，
 *    不得改写成 `IN`（那会放宽匿名读取 —— CTO 2026-10-29 明令禁止）。
 *
 * @returns `authApplied:false` 的匿名过滤面（两条 `access_level EQ`）
 */
function anonymousFilter(): KnowledgeAskFilter {
  return {
    conditions: [
      { field: 'access_level', operator: 'EQ', value: 'public' },
      { field: 'access_level', operator: 'EQ', value: 'team' },
    ],
    authApplied: false,
  };
}

/**
 * 构造知识检索过滤面：**有身份**按权限项收窄，**无身份**逐字保持现状。
 *
 * @input `auth` — 验签后的 `{role, orgId}`（缺省 = 无身份 ⇒ 匿名分支）。
 * @output `{ conditions, authApplied }`（`authApplied` 为响应 additive 字段的来源）。
 * @degraded 不抛: grants 解析失败/未知项由 `allowedSensitivitiesByGrants` 内部 `log.warn`
 *           并回落**出厂交集**（只收窄不放宽）；`SYNOVA_GRANTS_BRIDGE=off` ⇒ 匿名分支 ＋ `log.warn`。
 */
export function buildKnowledgeAskFilter(auth?: KnowledgeAskAuth): KnowledgeAskFilter {
  // D8 回滚开关: **函数内**读环境变量（模块级常量会让"改 env 即生效"失效；J5-3 覆盖）。
  if (process.env['SYNOVA_GRANTS_BRIDGE'] === 'off') {
    log.warn(
      {
        code: 'GRANTS_BRIDGE_DISABLED',
        switch: 'SYNOVA_GRANTS_BRIDGE',
        authSupplied: auth !== undefined,
      },
      '权限项桥接已被回滚开关关闭 — 本次按匿名分支过滤（两条 EQ，authApplied:false）',
    );
    return anonymousFilter();
  }

  if (auth === undefined) {
    // 可见性（不假装生效）: 匿名分支保持改前行为，响应里 authApplied:false。
    log.info({ code: 'KNOWLEDGE_ASK_ANONYMOUS' }, '无验签身份 — 保持既有匿名过滤面（两条 EQ，authApplied:false）');
    return anonymousFilter();
  }

  // 认证分支（D4）: access_level 必须修为 `IN` —— 否则 `access_level` 单值 ＋ AND 语义下
  // 认证用户同样恒 0 行（本批等于零效果）。D5: sensitivity 条件**追加**在 access_level 之后。
  return {
    conditions: [
      { field: 'access_level', operator: 'IN', value: ['public', 'team'] },
      {
        field: 'access.sensitivity',
        operator: 'IN',
        value: allowedSensitivitiesByGrants(auth.role, 'normal', auth.orgId),
      },
    ],
    authApplied: true,
  };
}

router.get('/api/knowledge/ask', async (req: Request, res: Response) => {
  const q = String(req.query.q || '');
  if (!q || q.length < 2) {
    return res.status(400).json({ ok: false, error: 'question too short (min 2 chars)' });
  }
  const ctx = extractAuthFromRequest(req);
  const filter = buildKnowledgeAskFilter(ctx ? { role: ctx.role, orgId: ctx.orgId } : undefined);
  const result = await answerQuestion(q, filter.conditions);
  res.json({ ...result, authApplied: filter.authApplied });
});

router.post('/api/knowledge/ask', async (req: Request, res: Response) => {
  const { question } = req.body as { question?: string };
  if (!question || question.length < 2) {
    return res.status(400).json({ ok: false, error: 'question too short (min 2 chars)' });
  }
  const ctx = extractAuthFromRequest(req);
  const filter = buildKnowledgeAskFilter(ctx ? { role: ctx.role, orgId: ctx.orgId } : undefined);
  const result = await answerQuestion(question, filter.conditions);
  res.json({ ...result, authApplied: filter.authApplied });
});

/**
 * 检索 PKB 并回答；检索不可用时降级到模板答案（既有行为，不改）。
 *
 * @input `q` — 问题原文；`conditions` — 由 {@link buildKnowledgeAskFilter} 产出（L4 只执行、不感知身份）。
 * @output 答案体（`ok/answer/sources/confidence`）；`authApplied` 由 handler 追加。
 * @degraded 存储不可用 ⇒ catch 到模板答案（既有 `catch`，不阻断请求、不改状态码）。
 */
async function answerQuestion(
  q: string,
  conditions: FilterClause['conditions'],
): Promise<Record<string, unknown>> {
  // v3.3: 接入 PKB 检索 + 专家知识目录
  let sources: string[] = [];
  let bestAnswer = '';

  try {
    // 尝试从 KnowledgeStore 搜索
    const { getDatabase } = await import('../init/engine-context');
    const { KnowledgeStore } = await import('../l4/knowledge-store');
    const db = getDatabase();
    if (db) {
      const store = new KnowledgeStore(db);
      const results = store.search(q, { conditions }, 5);

      if (results.results.length > 0) {
        bestAnswer = results.results.map(r => r.text).join('\n\n---\n\n');
        sources = results.results.map(r => `pkb:${r.id}`).slice(0, 5);
      }
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
