/**
 * tests/routes/im-authprovider.test.ts — #984 **接线面** L2（真 express + 真 HTTP + 真路由）
 *
 * 为什么需要这个文件（产品线判例 10：「判据必须同时钉死【入口】」）：
 *   #984 的**全部目的就是接线** —— 让 `src/routes/im.ts` 把 `authProvider` 传进 `runWithContext`。
 *   只测「传了 provider 的语义产出 10 行」证的是**语义**，不是**接线**。
 *   本文件用仓内既有范式（`express()` + `listen(0)` + `http.request`，参
 *   `tests/middleware/auth.integration.test.ts`）打**真实 HTTP 入口**，断言路由**实际**传给
 *   `runWithContext` 的 ctx 里带着**可用的** `authProvider`。
 *
 * 口径（产品线要求：不许合并成一句「L2」）：
 *   接线面 = L2 ← 本文件（真路由 / 真 HTTP）
 *   语义面 = L2 ← 证据件 `docs/synova/product-lines/evidence/issue984-im-authprovider-20261004.md` §2
 *              （真实语料 1443 行：装配前 0 行 / 装配后 10 行 / 未认证 0 行）
 *
 * 隔离：临时库（`SYNOVA_DB_PATH` 指向 mkdtemp），**不触碰仓库 `data/synova.db`**。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { RequestContext } from '../../src/services/request-context';

// 🔴 必须在 initEngineContext() 之前把 DB 指向临时文件，避免初始化/写入仓库库
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'synova-984-'));
process.env.SYNOVA_DB_PATH = path.join(TMP_DIR, 'test.db');

// D1154：已认证面用**真签 JWT**。必须先设 ≥16 字符 `JWT_SECRET`，否则
//   `jwtAuthMiddleware` 会走「DevMode 且无密钥 ⇒ 自动 admin」分支（auth.ts:350-365）
//   ⇒ 「未认证 ⇒ deny-all」用例会被当成已认证而**假绿**。此为该分支的唯一物理开关
//   （`!secret && DEV_MODE === 'true'`），与 D1153 判据件同因。
process.env.JWT_SECRET = 'd1154-qa-ask-secret-0123456789';
process.env.DEV_MODE = 'false';

// 透明包装：保留 `runWithContext` **真实现**，只记录路由实际传入的 ctx。
// 这是「观察接线」的必要手段 —— 不是替身、不改语义、不 mock 业务管线（铁律 12）。
const H = vi.hoisted(() => ({ seen: [] as RequestContext[] }));
vi.mock('../../src/services/request-context', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/request-context')>();
  return {
    ...mod,
    runWithContext: <T,>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> => {
      H.seen.push(ctx);
      return mod.runWithContext(ctx, fn);
    },
  };
});

import imRouter from '../../src/routes/im';
import { PIIScrubber } from '../../src/security/pii-scrubber';
import { initEngineContext, getDatabase } from '../../src/init/engine-context';
import { runWithContext, getCurrentFilterClause } from '../../src/services/request-context';
import { createSystemKnowledgeStore } from '../../src/agent/knowledge-bridge-service';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';

let server: Server;
let baseUrl = '';
/** D1154：带真 `jwtAuthMiddleware` 的第二实例（已认证面）。原实例保持无 jwt 层
 *  —— ① 飞书入站本就无 token ② `/api/qa/ask` 的「未认证 ⇒ deny-all 且不新增 401/403」
 *  不变式只能在无 jwt 层的真入口上验（有 jwt 层时无 token 会先得 401，验不到该不变式）。 */
let serverJwt: Server;
let baseUrlJwt = '';

function postTo(
  base: string,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${base}${pathname}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          let json: unknown = raw;
          try { json = JSON.parse(raw); } catch { /* 非 JSON 响应保留原文，不视为失败 */ }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function post(pathname: string, body: unknown): Promise<{ status: number; json: unknown }> {
  return postTo(baseUrl, pathname, body);
}

/** 飞书入站最小可达载荷（契约见 src/routes/im.ts:33-39 与 src/l1/im-inbound.ts:63-84） */
const FEISHU_BODY = {
  event: {
    sender: { open_id: 'ou_test_984_sender' },
    message: { content: '这家企业的增长卡在哪里？' },
  },
};

// ═══ D1154 / #984 可观测面：/api/qa/ask 的真语料与真身份 ═══

/** 查询词（CJK ⇒ `knowledge-store.ts:172-181` 走 LIKE 分支；5 条语料文本均含此词） */
const Q1154 = '现金流';
/** 4 条 normal（应全部命中并通过权限过滤） */
const NORMAL_IDS = ['kc_d1154_1', 'kc_d1154_2', 'kc_d1154_3', 'kc_d1154_4'];
/** 1 条 restricted（应被 `access.sensitivity IN ['normal']` 过滤掉 —— 证明过滤器真生效） */
const RESTRICTED_ID = 'kc_d1154_restricted';

beforeAll(async () => {
  initEngineContext();

  // D1154 语料：**单条 `db.exec()` 批量 INSERT**。
  //   ⚠️ 不用 `KnowledgeStore.insert()` 造夹具 —— node v24 + better-sqlite3 下会留下
  //   Statement 垃圾，GC 撞上动态 import 链会 **abort（exit 134）**（复核员实测）。
  //   先 `createSystemKnowledgeStore()` 让 schema + FTS 触发器就位（与生产构造同路径），
  //   再由 `kc_fts_insert` 触发器同步 `knowledge_chunks_fts`。
  createSystemKnowledgeStore();
  getDatabase().exec(`
    INSERT INTO knowledge_chunks (id, text, source_type, source_id, access_sensitivity, access_level) VALUES
      ('kc_d1154_1', '现金流管理要点一：经营现金流与净利润的差异需逐项对账。', 'document', 'd1154-1', 'normal', 'private'),
      ('kc_d1154_2', '现金流管理要点二：应收账款周转天数直接决定现金回收速度。', 'document', 'd1154-2', 'normal', 'private'),
      ('kc_d1154_3', '现金流管理要点三：经营性支出应设置月度预算上限。', 'document', 'd1154-3', 'normal', 'private'),
      ('kc_d1154_4', '现金流管理要点四：短期借款到期结构影响偿付压力。', 'document', 'd1154-4', 'normal', 'private'),
      ('kc_d1154_restricted', '现金流管理（受限）：本条目仅更高敏感度上限可见。', 'document', 'd1154-r', 'restricted', 'private');
  `);

  const app = express();
  app.use(express.json());
  // 路由读 req.app.locals.container.piiScrubber（src/routes/im.ts:46-50）
  app.locals.container = { piiScrubber: new PIIScrubber() };
  app.use(imRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  // 已认证面：真 jwtAuthMiddleware（`/api/qa/ask` 不在白名单 ⇒ 必须带真签 JWT）
  const appJwt = express();
  appJwt.use(express.json());
  appJwt.locals.container = { piiScrubber: new PIIScrubber() };
  appJwt.use(jwtAuthMiddleware);
  appJwt.use(imRouter);
  await new Promise<void>((resolve) => {
    serverJwt = appJwt.listen(0, () => {
      const addr = serverJwt.address();
      baseUrlJwt = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  serverJwt?.close();
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
});

describe('#984 接线面（真 HTTP 入口 → 真 runWithContext）', () => {
  it('已认证飞书入站：路由实际传入的 ctx 带**可用的** authProvider', async () => {
    H.seen.length = 0;
    const r = await post('/api/im/feishu/webhook', FEISHU_BODY);
    expect(r.status).toBe(200);
    expect(H.seen.length).toBeGreaterThan(0);

    const ctx = H.seen[H.seen.length - 1];
    expect(ctx?.user).toBeTruthy();
    // 🔴 接线判据本体：改造前此处为 undefined（handler 无 runWithContext 包裹）
    expect(ctx?.authProvider).toBeTruthy();
    if (!ctx?.user || !ctx?.authProvider) throw new Error('ctx 缺 user/authProvider —— 接线缺失');

    // 注: 本实例**不挂** jwtAuthMiddleware（飞书入站无 token）⇒ ctx 计数恒为 1，
    //   故此处不设计数判据。计数判据见下方 D1154「合法 JWT」条（那里中间件也会建一次）。
    expect(ctx.user.userId).toBe('ou_test_984_sender');

    const filter = await ctx.authProvider.getPermissionFilter(ctx.user, 'KnowledgeChunk', 'read');
    expect(filter.conditions.length).toBeGreaterThan(0);            // 非空 ⇒ 不会被"空条件集跳过过滤"
    expect(filter.conditions[0].field).toBe('access.sensitivity');
    expect(filter.conditions[0].operator).toBe('IN');
    expect(filter.conditions[0].value).toEqual(['normal']);         // 单一真源 allowedSensitivities 的产出
  });

  it('把路由用过的 ctx 重进真漏斗：得到 sensitivity 条件，而非 deny-all', async () => {
    const ctx = H.seen[H.seen.length - 1];
    if (!ctx) throw new Error('无 ctx —— 前置用例未记录');
    const filter = await runWithContext(ctx, () => getCurrentFilterClause('KnowledgeChunk'));
    expect(filter.conditions.length).toBeGreaterThan(0);
    expect(filter.conditions[0].field).toBe('access.sensitivity');
    expect(filter.conditions[0].value).toEqual(['normal']);
  });

  it('未认证（无请求上下文）：真实漏斗返回 deny-all 非空条件集（安全不回归）', async () => {
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    expect(filter.conditions.length).toBeGreaterThan(0);
    expect(filter.conditions[0].field).toBe('__d947_no_authenticated_context');
    expect(filter.conditions[0].value).toBe('__d947_deny_all__');
  });
});

// ════════════════════════════════════════════════════════════════
// D1154 / #984 **可观测面** —— `POST /api/qa/ask`
//
// 为什么这一段才是 #984 的用户可见面：飞书入站链路**不消费知识漏斗**（静态可达性实测：
//   `src/l1/im-inbound.ts` 及其链上 4 个模块对 knowledge-agent / KnowledgeStore /
//   getCurrentFilterClause 均 **0 命中**）⇒ §2 的飞书接线是「为将来消费方就绪的接线」。
//   而 `qa-router.ts:84` 是**真调用** `getCurrentFilterClause` 的消费点，且此前**没有**
//   `runWithContext` 包裹 ⇒ 已认证调用方恒落 deny-all ⇒ 0 条知识（过度拒绝，用户可见）。
// ════════════════════════════════════════════════════════════════

interface QaAnswer {
  ok: boolean;
  answer?: string;
  domain: string;
  knowledgeSources: Array<{ id: string; type: string; confidence: number; snippet: string }>;
  degraded: boolean;
  error?: string;
}

/** 收窄 `unknown` 响应体（零 as any） */
function asQaAnswer(json: unknown): QaAnswer {
  if (typeof json !== 'object' || json === null) throw new Error('qa/ask 响应不是对象');
  const o = json as Record<string, unknown>;
  return {
    ok: o.ok === true,
    answer: typeof o.answer === 'string' ? o.answer : undefined,
    domain: typeof o.domain === 'string' ? o.domain : '',
    knowledgeSources: Array.isArray(o.knowledgeSources)
      ? o.knowledgeSources as QaAnswer['knowledgeSources']
      : [],
    degraded: o.degraded === true,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

describe('D1154 · #984 可观测面（POST /api/qa/ask，真 HTTP + 真 JWT + 真语料）', () => {
  it('已认证：路由实际传入的 ctx 带**可用的** authProvider（非 deny-all）', async () => {
    const token = signJwtToken({ sub: 'u1154-qa', role: 'staff', orgId: 'org-d1154' });
    expect(token).not.toBeNull();

    H.seen.length = 0;
    const r = await postTo(baseUrlJwt, '/api/qa/ask', { question: Q1154 }, {
      authorization: `Bearer ${token}`,
    });
    expect(r.status).toBe(200);

    expect(H.seen.length).toBe(2);
    const ctx = H.seen[H.seen.length - 1];
    expect(ctx?.user).toBeTruthy();
    // 🔴 接线判据本体：改造前此处为 undefined（handler 无 runWithContext 包裹）
    expect(ctx?.authProvider).toBeTruthy();
    if (!ctx?.user || !ctx?.authProvider) throw new Error('ctx 缺 user/authProvider —— 接线缺失');

    // 身份取自**验签**结果（JWT sub），非 body 的自报 userId
    expect(ctx.user.userId).toBe('u1154-qa');

    const filter = await ctx.authProvider.getPermissionFilter(ctx.user, 'KnowledgeChunk', 'read');
    expect(filter.conditions.length).toBeGreaterThan(0);
    expect(filter.conditions[0].field).toBe('access.sensitivity');
    expect(filter.conditions[0].operator).toBe('IN');
    expect(filter.conditions[0].value).toEqual(['normal']);   // 单一真源 allowedSensitivities 的产出
  });

  it('已认证：把路由用过的 ctx 重进真漏斗 ⇒ 得到 sensitivity 条件，而非 deny-all', async () => {
    H.seen.length = 0;
    const token = signJwtToken({ sub: 'u1154-qa2', role: 'manager', orgId: 'org-d1154' });
    expect(token).not.toBeNull();
    const r = await postTo(baseUrlJwt, '/api/qa/ask', { question: Q1154 }, {
      authorization: `Bearer ${token}`,
    });
    expect(r.status).toBe(200);

    const ctx = H.seen[H.seen.length - 1];
    if (!ctx) throw new Error('无 ctx —— 前置用例未记录');
    const filter = await runWithContext(ctx, () => getCurrentFilterClause('KnowledgeChunk'));
    expect(filter.conditions.length).toBeGreaterThan(0);
    expect(filter.conditions[0].field).toBe('access.sensitivity');
    expect(filter.conditions[0].value).toEqual(['normal']);
    expect(filter.conditions[0].field).not.toBe('__d947_no_authenticated_context');
  });

  it('已认证：用户可见产出 —— knowledgeSources > 0 且 degraded=false，受限条目被过滤', async () => {
    const token = signJwtToken({ sub: 'u1154-qa3', role: 'staff', orgId: 'org-d1154' });
    expect(token).not.toBeNull();
    const r = await postTo(baseUrlJwt, '/api/qa/ask', { question: Q1154 }, {
      authorization: `Bearer ${token}`,
    });
    expect(r.status).toBe(200);
    const body = asQaAnswer(r.json);

    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);                                    // 改造前为 true
    expect(body.knowledgeSources.length).toBeGreaterThan(0);              // 改造前为 0
    expect(body.knowledgeSources.length).toBe(NORMAL_IDS.length);         // 恰 4 条 normal
    expect(body.knowledgeSources.map(s => s.id).sort()).toEqual([...NORMAL_IDS].sort());
    // 权限过滤**真生效**（不是"全都放行"）：restricted 那条不得出现
    expect(body.knowledgeSources.some(s => s.id === RESTRICTED_ID)).toBe(false);
    // 不再落「未找到相关信息」兜底话术
    expect(body.answer ?? '').not.toContain('未找到相关信息');
    expect(body.domain).toBe('finance');
  });

  it('未认证：不新增 401/403 门槛，行为不变式 —— 200 + deny-all（0 条 + degraded=true）', async () => {
    H.seen.length = 0;
    // 无 jwt 层的真入口 + 不带任何凭据（= tests/l1/qa-router.test.ts 的直连形态）
    const r = await post('/api/qa/ask', { question: Q1154 });
    expect(r.status).toBe(200);                    // 🔴 不得为 401/403
    const body = asQaAnswer(r.json);
    expect(body.ok).toBe(true);
    expect(body.knowledgeSources).toHaveLength(0); // deny-all ⇒ 恒 0
    expect(body.degraded).toBe(true);
    // 且**没有**建立请求级上下文（等价「不传 authProvider」）
    expect(H.seen.length).toBe(0);
  });

  it('未认证：真漏斗仍是 deny-all（非空拒绝型条件集，安全不回归）', async () => {
    const filter = await getCurrentFilterClause('KnowledgeChunk');
    expect(filter.conditions.length).toBeGreaterThan(0);
    expect(filter.conditions[0].field).toBe('__d947_no_authenticated_context');
    expect(filter.conditions[0].value).toBe('__d947_deny_all__');
  });

  it('补偿判据 · 已认证 + 语料无匹配 ⇒ 仍 0 条 + degraded=true（= qa-router.test.ts:96-106 的语义，在本环境可跑）', async () => {
    // 为什么需要这条：`tests/l1/qa-router.test.ts` 锁的正是「无匹配知识 ⇒ degraded=true /
    //   knowledgeSources 空」。但该文件在本环境**预存崩溃**（见交付回执：node v24 + better-sqlite3
    //   的 `Statement::~Statement()` GC 终结器触发 `Assertion failed: (env) != nullptr`，
    //   exit 134；已用「撤我方改动后仍复现 2/2」证明与本卡无关）⇒ 该断言当前跑不到。
    //   此处以**真 HTTP + 真 JWT + 同一查询语义**复现其行为不变式，作为可执行的补偿。
    const token = signJwtToken({ sub: 'u1154-nomatch', role: 'staff', orgId: 'org-d1154' });
    expect(token).not.toBeNull();
    const r = await postTo(baseUrlJwt, '/api/qa/ask', { question: '量子计算机的原理是什么？' }, {
      authorization: `Bearer ${token}`,
    });
    expect(r.status).toBe(200);
    const body = asQaAnswer(r.json);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.knowledgeSources).toHaveLength(0);
  });

  it('🔴 判别性本体 · req.auth 存在但**中间件未建上下文**时，路由必须自建（DevMode 分支形态）', async () => {
    // 为什么这是本件最有分辨力的一条：
    //   `jwtAuthMiddleware` 有 **三条** 注入 req.auth 的路径，其中只有「验签成功」与
    //   「白名单带 Bearer」那条会调 `runWithContext`（auth.ts:424）；
    //   **DevMode 自动 admin 分支**（auth.ts:350-365）直接 `return next()` —— 于是出现
    //   「req.auth 有值、但请求级上下文不存在」的形态 ⇒ 漏斗落 deny-all ⇒ **已认证却拿 0 条知识**。
    //   这正是「已认证调用方被误拒」的真实成因，也是路由自建上下文**不可替代**的场景
    //   （上面「合法 JWT」那条做不到：中间件已经替它把上下文建好了）。
    const savedSecret = process.env.JWT_SECRET;
    const savedDev = process.env.DEV_MODE;
    process.env.JWT_SECRET = '';      // 关掉验签分支（getSecret 走 DEV_MODE 兜底，auth.ts:48-53）
    process.env.DEV_MODE = 'true';    // 打开 DevMode 自动 admin（注入 req.auth，但**不**建上下文）
    H.seen.length = 0;
    try {
      const r = await postTo(baseUrlJwt, '/api/qa/ask', { question: Q1154 });
      expect(r.status).toBe(200);
      const body = asQaAnswer(r.json);

      // 恰好 1 次 ⇒ 上下文**只能**来自本路由（中间件在该分支不建）⇒ 撤掉路由包裹即为 0 次
      expect(H.seen.length).toBe(1);
      const ctx = H.seen[0];
      expect(ctx?.authProvider).toBeTruthy();
      if (!ctx?.user || !ctx?.authProvider) throw new Error('ctx 缺 user/authProvider —— 接线缺失');

      const filter = await ctx.authProvider.getPermissionFilter(ctx.user, 'KnowledgeChunk', 'read');
      expect(filter.conditions[0].field).toBe('access.sensitivity');

      // 用户可见结果：有上下文 ⇒ **全部 5 条**（此时身份是 dev-admin，
      //   `allowedSensitivities('admin', …)` 覆盖全部敏感度级别 ⇒ 连 restricted 那条也可见）。
      //   改造前：上下文缺失 ⇒ deny-all ⇒ 0 条 + degraded=true。
      expect(body.knowledgeSources.length).toBe(NORMAL_IDS.length + 1);
      expect(body.degraded).toBe(false);
      // 与上一条（staff ⇒ 4 条、restricted 被过滤）**成对** ⇒ 证明 provider 是按**角色派生**的，
      //   不是「恒放行全部」也不是「恒 deny-all」。
      expect(body.knowledgeSources.some(s => s.id === RESTRICTED_ID)).toBe(true);
    } finally {
      process.env.JWT_SECRET = savedSecret;
      process.env.DEV_MODE = savedDev;
    }
  });
});
