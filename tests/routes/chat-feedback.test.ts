/**
 * tests/routes/chat-feedback.test.ts — #981（0-7）提议反馈持久化 + 降级留痕
 *
 * 判据（卡面 Done）: `persisted` 可为 true；失败时有 warn。
 * 观测面（行为后果，非 grep）:
 *   - 成功路径: 响应 `feedback.persisted === true` **且** 真库里出现 `correction_*` 企业事实行（真落库，不看布尔）
 *   - 降级路径: memoryStore 不可用 → 响应 `feedback.degraded === true` + 捕获到 log.warn（铁律 24+31）
 *   - 两条路径下「提议确认」主流程都不被阻断（ok:true）
 *
 * ⚠️ 判别性: 把 `collectFeedback(...)` 的第二参 memoryStore 去掉（= 修复前）→ 用例 ① 必红（persisted 恒 false）。
 * ⚠️ 真路由: 挂 `src/routes/chat` 真实 router 到 express + 真实 HTTP 请求（铁律 12，不 mock 管线；
 *    仅 mock 两个外部协作者: engine-context 的 DB 句柄 / proposal-manager）。
 */
import express from 'express';
import type { Server } from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ═══ 捕获 logger.warn（断言"失败时有 warn"） ═══
const logCapture = vi.hoisted(() => ({ warns: [] as Array<{ msg?: unknown }> }));

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const rec = (level: string) => (meta?: { code?: string }, msg?: unknown) => {
    if (level === 'warn') logCapture.warns.push({ msg: msg ?? meta });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug'),
    }),
  };
});

// ═══ 注入 DB 句柄（引擎上下文隔离）+ 提议管理器替身 ═══
const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../../src/init/engine-context', () => ({
  getDatabase: () => state.db,
}));

vi.mock('../../src/l2/proposal-manager', () => ({
  getProposalManager: () => ({
    resolve: () => ({ ok: true, proposal: { id: 'prop-1', status: 'confirmed' } }),
  }),
}));

import chatRouter from '../../src/routes/chat';

describe('#981 — POST /api/proposal/:id/resolve 反馈持久化', () => {
  let server: Server;
  let base: string;
  let db: Database.Database;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(chatRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    db = new Database(':memory:');
    state.db = db;
    logCapture.warns.length = 0;
  });

  it('正常路径: persisted=true 且真落库 agent_memory（correction_*），主流程 ok', async () => {
    const res = await fetch(`${base}/api/proposal/prop-1/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', feedback: '同意该提议', orgId: 'org-1' }),
    });
    const body = await res.json() as { ok: boolean; feedback?: { persisted: boolean; degraded: boolean } };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // 判别性核心: 去掉 memoryStore 参数 → persisted 恒 false → 此断言必红
    expect(body.feedback?.persisted).toBe(true);
    expect(body.feedback?.degraded).toBe(false);

    // 真落库证据（不看布尔自证）
    const rows = db.prepare(
      "SELECT COUNT(*) AS n FROM agent_memory WHERE key LIKE 'correction_%' AND org_id = 'org-1'",
    ).get() as { n: number };
    expect(rows.n).toBe(1);

    db.close();
  });

  it('降级路径: memoryStore 不可用 → degraded=true + log.warn 留痕 + 仍 ok:true', async () => {
    state.db = {
      exec: () => { throw new Error('agent_memory schema unavailable'); },
    } as unknown;

    const res = await fetch(`${base}/api/proposal/prop-1/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject', feedback: '不采纳', orgId: 'org-1' }),
    });
    const body = await res.json() as { ok: boolean; feedback?: { persisted: boolean; degraded: boolean } };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);                    // 不阻断主流程
    expect(body.feedback?.persisted).toBe(false);
    expect(body.feedback?.degraded).toBe(true);
    // 铁律 24: 失败必须留痕（不得空吞）——L2 接缝与路由各自留痕，任一即可（改坏为静默 ⇒ 必红）
    expect(logCapture.warns.length).toBeGreaterThanOrEqual(1);
    expect(logCapture.warns.some((w) => {
      const m = String(w.msg);
      return m.includes('记忆写入视图不可用') || m.includes('反馈未持久化') || m.includes('反馈收集失败');
    })).toBe(true);

    db.close();
  });
});
