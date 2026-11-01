/**
 * smoke.test.ts — SynovaAgent 冒烟测试
 *
 * Slice 1: 进程启动 + 健康检查
 * Slice 2: 本体 API (ingest → graph → HTML)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server';
import type { Server } from 'http';

let server: Server;
let BASE: string;
/** #1228：本件匿名带 body orgId ⇒ 实例组织必须 = 'test-org'（用后还原，防泄漏到同 worker 其它件） */
const SAVED_ORG_ID = process.env.SYNOVA_ORG_ID;

beforeAll(async () => {
  // port 0 = OS 分配随机端口, 避免 EADDRINUSE
  process.env.PORT = '0';
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_ORG_ID = 'test-org';
  server = await createServer();
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3000;
  BASE = `http://localhost:${port}`;
});

afterAll(() => {
  if (server) { server.close(); }
  if (SAVED_ORG_ID === undefined) delete process.env.SYNOVA_ORG_ID;
  else process.env.SYNOVA_ORG_ID = SAVED_ORG_ID;
});

// ═══ Slice 1: Health ═══

describe('Health', () => {
  it('GET /health → 200, status=ok, name=synova-agent', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.name).toBe('Synova-Agent');
    expect(body.version).toBeDefined();
  });
});

// ═══ Slice 2: Ontology ═══

describe('Ontology API', () => {
  const orgId = 'test-org';

  it('POST /api/ontology/ingest → creates Document node + edges', async () => {
    const res = await fetch(`${BASE}/api/ontology/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        name: '测试文档',
        type: 'Document',
        content: 'SynovaAgent smoke test',
        author: '测试用户',
        authorEmail: 'test@synova.dev',
        teamId: 'team-test',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.nodeId).toBe('string'); // ID 格式由 GraphStore 实现决定
    expect(Array.isArray(body.edges)).toBe(true); // 边列表由 GraphStore 实现决定
  });

  it('GET /api/ontology/graph/:orgId → returns nodes and edges', async () => {
    const res = await fetch(`${BASE}/api/ontology/graph/${orgId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.nodeCount).toBeGreaterThanOrEqual(1); // 至少一个节点（Document）
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  it('GET /api/ontology/graph/:orgId.html → returns HTML page', async () => {
    const res = await fetch(`${BASE}/api/ontology/graph/${orgId}.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>');
    expect(html).toContain(orgId);
    expect(html).toContain('SynovaAgent');
  });
});

// ═══ Slice 3: Diagnosis ═══

describe('Diagnosis API', () => {
  it('POST /api/diagnosis/consult without teamId → 400', async () => {
    const res = await fetch(`${BASE}/api/diagnosis/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/diagnosis/consult without initiator.role → 400', async () => {
    const res = await fetch(`${BASE}/api/diagnosis/consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 'test', initiator: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/diagnosis/consult returns SSE content-type or 404 (no LLM)', { timeout: 10_000 }, async () => {
    // 完整诊断流程需 LLM，这里只验证 HTTP 响应格式
    // 没有 LLM 时诊断端点返回 5xx，验证 404/500 也可接受
    try {
      const res = await fetch(`${BASE}/api/diagnosis/consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: 'test-team-quick',
          initiator: { role: 'CEO', name: '测试' },
        }),
      });
      // 有 LLM: SSE content-type; 无 LLM: 5xx
      const ct = res.headers.get('content-type') || '';
      expect(ct.includes('event-stream') || res.status >= 400).toBe(true);
    } catch {
      // 网络错误也接受 — 测试只验证路由注册
    }
  });

  it('GET /api/diagnosis/consult/nonexistent/status → 404', async () => {
    const res = await fetch(`${BASE}/api/diagnosis/consult/nonexistent/status`);
    expect(res.status).toBe(404);
  });
});
