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
import { initEngineContext } from '../../src/init/engine-context';
import { runWithContext, getCurrentFilterClause } from '../../src/services/request-context';

let server: Server;
let baseUrl = '';

function post(pathname: string, body: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${pathname}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
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

/** 飞书入站最小可达载荷（契约见 src/routes/im.ts:33-39 与 src/l1/im-inbound.ts:63-84） */
const FEISHU_BODY = {
  event: {
    sender: { open_id: 'ou_test_984_sender' },
    message: { content: '这家企业的增长卡在哪里？' },
  },
};

beforeAll(async () => {
  initEngineContext();
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
});

afterAll(() => {
  server?.close();
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
    // 🔴 接线判据本体：改造前此处为 undefined（route 只传 user）
    expect(ctx?.authProvider).toBeTruthy();
    if (!ctx?.user || !ctx?.authProvider) throw new Error('ctx 缺 user/authProvider —— 接线缺失');

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
