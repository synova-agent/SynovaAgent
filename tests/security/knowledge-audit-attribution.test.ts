/**
 * tests/security/knowledge-audit-attribution.test.ts — D1155 / 0-9bis 审计归属 **回归锁**
 *
 * 🔴 性质声明（必读，防误读 —— CTO 红线④ + 本线判例「判据分辨不出改前/改后」）
 *   本文件是**回归锁（invariant regression lock）**，**不是**「本项已完成」的证明。
 *   完成证明只认 **L3 真跑**：对**真库** `data/synova.db` 跑真 HTTP + 真 JWT 的
 *   `POST /api/knowledge/search`，再取 `knowledge_audit` 原始行（见交付回执）。
 *   本文件的作用是：把「审计归属必须来自**验签身份**」变成**可执行**的判据，
 *   将来任何把它退回 `anonymous` 的改动都会在这里红。
 *
 * 为什么必须真跑（判据纪律 B 的承重项）:
 *   `knowledge_audit` 基线时**统计上可能是空表**（0 行）⇒ 单看「有没有 anonymous 行」
 *   在改前也是绿的。故分辨力全部压在**「先真跑一次再数行」**这个动作上，
 *   本文件每格都先发真 HTTP 请求、再查库计数，不看静态代码。
 *
 * 形态（铁律 12：不 mock 管线）:
 *   真 `express()` + `app.listen(0)` + 真 `jwtAuthMiddleware` + 真签 JWT（`signJwtToken`）
 *   + 真 `node:http` 请求。
 *   ⚠️ **禁用 `createServer()`**（本仓实测：vitest worker 内调它会 abort，exit 134）——
 *   本文件全程裸 express + `initEngineContext()`。
 *
 * DB 隔离：`SYNOVA_DB_PATH` → `mkdtemp` 临时库（**不触碰仓库 `data/synova.db`**）。
 *
 * 铁律 48: 每格均有 expect() 断言；覆盖 归属正确 / 未认证无审计 / 无上下文回落 三路径。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';

// 🔴 必须先于 initEngineContext() 落 env
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'synova-d1155-'));
const DB_FILE = path.join(TMP_DIR, 'audit-attribution.db');
process.env.SYNOVA_DB_PATH = DB_FILE;
process.env.JWT_SECRET = 'd1155-audit-attribution-secret-0123';
process.env.DEV_MODE = 'false';

import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import { initEngineContext } from '../../src/init/engine-context';
import { createSystemKnowledgeStore } from '../../src/agent/knowledge-bridge-service';
import knowledgeRoutes from '../../src/routes/knowledge';

/** 验签身份（判据② 期望落库的值） */
const VERIFIED_SUB = 'audit-owner-1155';
const QUERY = '现金流';

interface HttpResult { status: number; body: Record<string, unknown> }

function post(base: string, token: string | null): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const payload = JSON.stringify({ query: QUERY });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const url = new URL(`${base}/api/knowledge/search`);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => { chunks.push(c); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
          } catch {
            // 非 JSON 响应（如 500 文本/空体）⇒ 保留原文供判据报错
            body = { __unparsed: raw };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** 只读查审计表（真库同源同表；此处是临时库） */
function auditRows(): Array<{ user_id: string; query: string; total_hits: number }> {
  const db = new Database(DB_FILE, { readonly: true });
  try {
    return db
      .prepare('SELECT user_id, query, total_hits FROM knowledge_audit ORDER BY id')
      .all() as Array<{ user_id: string; query: string; total_hits: number }>;
  } finally {
    db.close();
  }
}

function anonCount(): number {
  const db = new Database(DB_FILE, { readonly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM knowledge_audit WHERE user_id='anonymous'")
      .get() as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

/** 完整链路 app（jwt + rbac + 路由） */
let fullApp: Server;
let fullBase = '';
/** 裸 app（**不挂** jwt/rbac ⇒ `req.rbac` 不存在，用于锁「姿态不变」回落） */
let bareApp: Server;
let bareBase = '';

beforeAll(async () => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');

  initEngineContext();
  // 让 `knowledge_audit` 表就位（KnowledgeStore.initSchema 与生产构造同路径）。
  // 否则「请求前先查表」会撞 `no such table` —— 该表是**懒创建**的（首次构造 store 时）。
  createSystemKnowledgeStore();

  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.use(knowledgeRoutes);
  await new Promise<void>((resolve) => {
    fullApp = app.listen(0, () => {
      const addr = fullApp.address();
      fullBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  const app2 = express();
  app2.use(express.json());
  app2.use(knowledgeRoutes);
  await new Promise<void>((resolve) => {
    bareApp = app2.listen(0, () => {
      const addr = bareApp.address();
      bareBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => {
  fullApp?.close();
  bareApp?.close();
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
});

describe('D1155 · 知识审计归属（回归锁 —— 完成证明见交付回执的 L3 真跑）', () => {
  it('已认证真跑：审计行落**验签身份**，且不落 anonymous', async () => {
    const token = signJwtToken({ sub: VERIFIED_SUB, role: 'staff', orgId: 'org-d1155' });
    expect(token).not.toBeNull();

    const before = auditRows().length;
    const res = await post(fullBase, token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const rows = auditRows();
    expect(rows.length).toBe(before + 1);                    // 真跑确实落了一行
    const latest = rows[rows.length - 1];
    // 🔴 判据本体：归属必须是验签身份（改造前恒 'anonymous'）
    expect(latest.user_id).toBe(VERIFIED_SUB);
    expect(latest.user_id).not.toBe('anonymous');
    expect(latest.query).toBe(QUERY);
  });

  it('已认证真跑：本次请求**未新增** anonymous 行（逐行可归属）', async () => {
    const token = signJwtToken({ sub: 'audit-owner-1155-b', role: 'manager', orgId: 'org-d1155' });
    expect(token).not.toBeNull();
    const anonBefore = anonCount();
    const res = await post(fullBase, token);
    expect(res.status).toBe(200);
    // 改用「增量」而非绝对值：末格（无中间件回落）会**故意**落一行 anonymous，
    //   故绝对值断言会与用例顺序耦合。增量断言等价且顺序无关。
    expect(anonCount()).toBe(anonBefore);                    // 改造前此断言必红（+1）
    const rows = auditRows();
    expect(rows[rows.length - 1].user_id).toBe('audit-owner-1155-b');
  });

  it('对照：无凭据 ⇒ 401 且**零**新增审计行（身份只能来自验签链路）', async () => {
    const before = auditRows().length;
    const res = await post(fullBase, null);
    expect(res.status).toBe(401);                            // /api/knowledge/search 不在白名单
    expect(str(res.body, 'code')).toBe('UNAUTHORIZED');
    expect(auditRows().length).toBe(before);                 // 未进路由 ⇒ 不落审计
  });

  it('姿态不变：无 `req.rbac`（未挂中间件）⇒ 仍 200 且回落 anonymous（本项只修归属、不新增门槛）', async () => {
    const before = auditRows().length;
    const res = await post(bareBase, null);
    expect(res.status).toBe(200);                            // 🔴 不得新增 401/403
    const rows = auditRows();
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1].user_id).toBe('anonymous'); // 取不到身份 ⇒ 显式回落（可诊断）
  });
});

/** 收窄 unknown 响应体（零 as any） */
function str(obj: unknown, key: string): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}
