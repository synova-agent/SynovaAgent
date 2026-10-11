/**
 * tests/routes/reload.test.ts — `POST /api/reload` 内容面重扫接线判据（卡 198 / K12-15）
 *
 * 被测件: `src/routes/reload.ts` 的**第 4 步**（`reloadContentTypes()` 调用）
 *         ＋ `src/deploy/content-reload.ts`
 *
 * 判据形态（红线：**不许词法扫描**）：真 express ＋ 真 router ＋ **真 HTTP** ＋ 真 `initContentTypes`
 *   ⇒ 断言响应体里出现**真绑定内容项的身份**（`type@version`）——这是"路由确实调用了重扫"的**执行证据**，
 *      不是"import 到了"或 grep 命中。
 *
 * 契约（铁律 47）:
 *   @input  — 真 HTTP POST /api/reload；`app.locals.fileScanner` 注入最小可用桩（本文件只判**内容面**那一步）
 *   @output — 200 + `content.{reloaded,retained,statePath,persisted,degraded}`
 *   @degraded — 内容面重扫带降级时 `content.degraded=true`，且**路由仍 200**（失败隔离：不阻断端点）
 *
 * 🔴 前置实测（诚实登记）：真实 `server.ts` 未把 `fileScanner` 注入 `app.locals`
 *   ⇒ 本端点在**真服务**里会在第 1 步就 `500 SCANNER_NOT_READY`（内容面那步根本到不了）。
 *   故本文件**注入桩**以触达第 4 步；"真服务里不可达"这一事实写进 PR 例外清单。
 *
 * 铁律 48: 每例真 expect()；覆盖正常路径 / 降级外传 / 边界（结构完整性）。
 * 铁律 38: 零 `as any` / `as never` / `as unknown as`。
 * 铁律 12: 不 mock 内容面管线（真 `initContentTypes`、真 loader、真 extensions/）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import reloadRouter from '../../src/routes/reload';

/** 一次真实 HTTP 往返 */
interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

let server: Server | null = null;
let baseUrl = '';
let tmpDataDir = '';
/** 本用例保存/还原的环境（判据不得污染其它文件） */
const ORIGINAL_DATA_DIR = process.env['SYNOVA_DATA_DIR'];
const ORIGINAL_LOG_LEVEL = process.env['LOG_LEVEL'];

/** 最小可用 FileScanner 桩 —— 只为让路由走到第 4 步（内容面重扫） */
const scannerStub = {
  scan: () => ({ experts: [], measurers: [], knowledge: [], errors: [], scannedAt: new Date().toISOString() }),
};

async function postReload(): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}/api/reload`, { method: 'POST' });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeAll(async () => {
  process.env['LOG_LEVEL'] = 'silent';
  // 🔴 状态文件落点必须显式给临时目录：平台真数据目录（~/Library/Application Support/Synova/data）
  //    在本机沙箱下**不可写**（实测 `touch` ⇒ Operation not permitted）⇒ 不显式指定的话
  //    `persisted` 恒 false、`degraded` 恒 true，那是**环境红**、不是代码红（不得混为一谈）。
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-route-test-'));
  process.env['SYNOVA_DATA_DIR'] = tmpDataDir;
  const app = express();
  app.use(express.json());
  // 生产挂载顺序同型：中间件 → 路由
  app.locals['fileScanner'] = scannerStub;
  app.use(reloadRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server !== null) await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (ORIGINAL_DATA_DIR === undefined) delete process.env['SYNOVA_DATA_DIR'];
  else process.env['SYNOVA_DATA_DIR'] = ORIGINAL_DATA_DIR;
  if (ORIGINAL_LOG_LEVEL === undefined) delete process.env['LOG_LEVEL'];
  else process.env['LOG_LEVEL'] = ORIGINAL_LOG_LEVEL;
  try {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响判据 */
  }
});

describe('POST /api/reload · 内容面重扫接线（#198）', () => {
  it('V1 真跑：端点返回**真绑定**的内容项身份（type@version）⇒ 证明确实调用了重扫', async () => {
    const r = await postReload();
    expect(r.status).toBe(200);
    expect(r.body['ok']).toBe(true);

    const content = r.body['content'] as {
      reloaded: string[];
      retained: { type: string }[];
      statePath: string;
      persisted: boolean;
      degraded: boolean;
    };
    // 不是"字段存在"就算过 —— 必须是**本次真绑定**的若干项
    expect(Array.isArray(content.reloaded)).toBe(true);
    expect(content.reloaded.length).toBeGreaterThan(0);
    for (const identity of content.reloaded) {
      expect(identity).toMatch(/^[a-z0-9-]+@[^@]+$/);
    }
    // 已知内容面 type 必在其内（防"空集合也算绿"）
    const types = content.reloaded.map((s) => s.split('@')[0]);
    expect(types).toContain('locale');
    expect(types).toContain('sentinel');
    // 边界：健康树下不得有拒绝项
    expect(content.retained).toEqual([]);
    expect(content.degraded).toBe(false);
    // 标识持久化：状态文件确实写下（persisted 为真 ⇒ 真写了）
    expect(content.persisted).toBe(true);
    expect(typeof content.statePath).toBe('string');
    expect(content.statePath.endsWith('content-binding-state.json')).toBe(true);
  }, 120_000);

  it('V2 报告面口径：`report[]` 里有人读的内容面摘要行（失败隔离信息可见）', async () => {
    const r = await postReload();
    const report = r.body['report'] as string[];
    expect(Array.isArray(report)).toBe(true);
    expect(report.some((line) => line.includes('内容面重扫'))).toBe(true);
  }, 120_000);

  it('V3 边界：连续两次 reload 均为绿（缓存清理不得把第二次变成假绿/假红）', async () => {
    const first = await postReload();
    const second = await postReload();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const c1 = first.body['content'] as { reloaded: string[] };
    const c2 = second.body['content'] as { reloaded: string[] };
    // 第二次必须仍绑定同一批项（同一棵树、同一内容面）——不得变成空集
    expect(c2.reloaded.length).toBe(c1.reloaded.length);
    expect([...c2.reloaded].sort()).toEqual([...c1.reloaded].sort());
  }, 120_000);
});
