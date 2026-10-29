/**
 * tests/routes/role-packs-page.test.ts — #1075 P3 说明书页壳配对判据（真 HTTP）
 *
 * 断言对象 = **真实路由**（`src/routes/role-packs-page.ts` 的具名导出 `rolePacksPageRoutes`）：
 *   真 `express()` ＋ `listen(0)` ＋ `fetch`；**只挂页面 router、不挂 `jwtAuthMiddleware`** ——
 *   精确模拟生产挂载位置（`src/server.ts`：页面先于 JWT，规格 §2.2-D7）。
 *
 * 为什么本文件存在（整改 R1 · CTO 硬阻断 2）：`src/routes/role-packs-page.ts` 是新增实现件，
 *   门禁要求同批有配对测试；且 J8 的「壳不含数据」判据需要**独立**断言面（原 J8 断言在
 *   `tests/routes/role-approvals.test.ts`，本文件把页面壳的证据集中到它自己的配对件）。
 *
 * 判据（逐条）:
 *   P1 `GET /role-packs` ⇒ 200 ＋ `text/html; charset=utf-8`
 *   P2 `GET /role-packs/:roleId` ⇒ 200 ＋ 同 content-type（任意 roleId 都返回同一壳）
 *   P3 壳含三个锚点：`id="role-packs-app"`／`data-testid="token-gate"`／`sessionStorage.getItem('synova.token')`
 *   P4 壳**不含任何岗位数据**：把夹具 roleId 传进 URL，HTML 里不得出现该 roleId
 *   P5 服务端**零插值**证据：两条路径返回的 HTML **逐字节相同**（长度相同且字符串相等），
 *      且 HTML 内无 `${` 模板插值残留
 *
 * 隔离：本文件不触文件系统、不触 DB、不读源码文本（纯 HTTP 断言）；夹具 roleId 只是 URL 输入，
 *   不需要真实岗位包存在（页面壳不查数据）。
 *
 * 已知限制：
 *   ① 不证浏览器端行为（token 存取/DOM 渲染）—— 本文件只判服务端发出的壳（J8 口径）；
 *   ② 不证 CSS/脚本语法正确性（浏览器执行面归 E2E，本批非目标）；
 *   ③ 不证生产 `createServer()` 的挂载顺序 —— 该顺序由 `tests/routes/role-approvals.test.ts` J8-3 断言。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { Socket } from 'net';
import { rolePacksPageRoutes } from '../../src/routes/role-packs-page';

/** 夹具 roleId（只作 URL 输入；壳不得把它写进 HTML） */
const FIXTURE_ROLE_ID = 'fixture-role-qa';

let server: Server;
let baseUrl = '';
let sockets: Socket[] = [];

function waitListening(srv: Server): Promise<string> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        clearInterval(timer);
        resolve(`http://localhost:${addr.port}`);
      }
    }, 10);
  });
}

function trackConnections(srv: Server): void {
  srv.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => {
      sockets = sockets.filter((item) => item !== socket);
    });
  });
}

beforeAll(async () => {
  // 生产挂载形态的最小复刻：**只挂页面**（不挂 JWT）⇒ 无 token 也应 200（页面先于 auth）
  const app = express();
  app.use(rolePacksPageRoutes);
  server = app.listen(0);
  trackConnections(server);
  baseUrl = await waitListening(server);
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('P1/P2 两条路由都返回 HTML 壳（无认证即可达）', () => {
  it('P1 GET /role-packs ⇒ 200 ＋ text/html; charset=utf-8', async () => {
    const res = await fetch(`${baseUrl}/role-packs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('P2 GET /role-packs/:roleId ⇒ 200 ＋ 同 content-type', async () => {
    const res = await fetch(`${baseUrl}/role-packs/${FIXTURE_ROLE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('P3 壳含三个必备锚点', () => {
  it('P3-1 挂载点 / token 输入位 / token 唯一来源常量', async () => {
    const res = await fetch(`${baseUrl}/role-packs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="role-packs-app"');
    expect(html).toContain('data-testid="token-gate"');
    expect(html).toContain("sessionStorage.getItem('synova.token')");
  });
});

describe('P4 壳不含任何岗位数据', () => {
  it('P4-1 把夹具 roleId 传进 URL，HTML 仍不含该 roleId', async () => {
    for (const path of ['/role-packs', `/role-packs/${FIXTURE_ROLE_ID}`]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain(FIXTURE_ROLE_ID);
      // 壳是静态常量：不含“岗位数据面”的字段名式内联（状态/指纹/记录）
      expect(html).not.toMatch(/>\s*(approved|pending|unverified)\s*</);
    }
  });
});

describe('P5 服务端零插值（同一壳逐字节相同）', () => {
  it('P5-1 两条路径返回的 HTML 长度与内容完全一致', async () => {
    const listRes = await fetch(`${baseUrl}/role-packs`);
    const detailRes = await fetch(`${baseUrl}/role-packs/${FIXTURE_ROLE_ID}`);
    expect(listRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    const listHtml = await listRes.text();
    const detailHtml = await detailRes.text();
    expect(listHtml.length).toBeGreaterThan(1000);
    expect(detailHtml.length).toBe(listHtml.length);
    expect(detailHtml).toBe(listHtml);
  });

  it('P5-2 HTML 内无 `${...}` 模板插值残留（纯静态常量模板）', async () => {
    const res = await fetch(`${baseUrl}/role-packs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(/\$\{/.test(html)).toBe(false);
  });

  it('P5-3 响应头声明无需缓存的静态壳（no-store）＋ nosniff', async () => {
    const res = await fetch(`${baseUrl}/role-packs`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
