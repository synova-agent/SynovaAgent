import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createStreamingController } from '../../electron-renderer/src/hooks/useStreaming';
import { useConversationStore } from '../../electron-renderer/src/stores/conversation-store';
import { restoreLastSession } from '../../electron-renderer/src/components/CenterPanel';
import { fetchLatestReportId } from '../../electron-renderer/src/components/RightPanel';
import { isRecord, listen, parseSse, request, type RunningHttpServer } from './support/http';
import { startModelEndpoint, UV04_REPLY, UV06_SUMMARY, type ModelEndpoint } from './support/model-endpoint';
import { createStreamingHost, installRendererWindow, LLM_ENV_KEYS, saveEnvironment } from './support/environment';

const ORG = 'uv-conversation-org';
const OTHER_ORG = 'uv-other-org';
const RUN_TAG = `uv-${process.pid}-${Date.now()}`;
const restoreEnv = saveEnvironment([
  'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'SYNOVA_ORG_ID', 'DEV_MODE', ...LLM_ENV_KEYS,
]);
let tempDir = '';
let db: Database.Database;
let graphStore: SqliteGraphStore;
let running: RunningHttpServer;
let model: ModelEndpoint;

beforeAll(async () => {
  model = await startModelEndpoint();
  tempDir = mkdtempSync(join(tmpdir(), 'synova-uv-conversations-'));
  process.env.SYNOVA_DB_PATH = join(tempDir, 'synova.db');
  process.env.SYNOVA_DATA_DIR = tempDir;
  process.env.SYNOVA_ORG_ID = ORG;
  process.env.DEV_MODE = 'true';
  for (const key of LLM_ENV_KEYS) delete process.env[key];
  process.env.LLM_API_KEY = 'uv-local-transport-key';
  process.env.LLM_BASE_URL = model.baseUrl;
  process.env.LLM_MODEL = 'uv-local-model';

  const { initEngineContext, getDatabase } = await import('../../src/init/engine-context');
  initEngineContext();
  db = getDatabase();
  const { SqliteGraphStore: Store } = await import('../../src/adapters/sqlite-graph-store');
  graphStore = new Store(db);
  const conversations = (await import('../../src/routes/conversations')).default;
  const ontology = (await import('../../src/routes/ontology')).default;
  const sessions = (await import('../../src/routes/sessions')).default;
  const diagnosis = (await import('../../src/routes/diagnosis')).default;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.locals.orchestration = { db };
  app.locals.graphStore = graphStore;
  app.use(conversations);
  app.use(ontology);
  app.use(sessions);
  app.use(diagnosis);
  running = await listen(app);
  installRendererWindow(running.baseUrl);
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await running.close();
  await model.close();
  const { closeEngineContext } = await import('../../src/init/engine-context');
  closeEngineContext();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('UV-03 对话资料真实落图', () => {
  it('POST /ingest 后经图路由读回本次原文，其他组织不可读', async () => {
    const material = `UV03 ${RUN_TAG}：客户成功部反馈续费率由 82% 降到 61%。`;
    const ingested = await request(running.baseUrl, 'POST', '/api/conversations', {
      body: { message: `/ingest ${material}`, orgId: ORG },
    });
    expect(ingested.status).toBe(200);
    expect(isRecord(ingested.body) && ingested.body.ingested).toBe(true);
    expect(isRecord(ingested.body) && ingested.body.degraded).toBe(false);

    const graph = await request(running.baseUrl, 'GET', `/api/ontology/graph/${ORG}`);
    expect(graph.status).toBe(200);
    const nodes = isRecord(graph.body) && Array.isArray(graph.body.nodes) ? graph.body.nodes : [];
    const documents = nodes.filter((node) => (
      isRecord(node) && node.type === 'Document' && isRecord(node.props)
      && typeof node.props.content === 'string' && node.props.content.includes(material)
    ));
    expect(documents).toHaveLength(1);
    const document = documents[0];
    expect(isRecord(document) && isRecord(document.props) && typeof document.props.name === 'string'
      ? document.props.name : '').toMatch(/^inge-.+/);

    const foreign = await request(running.baseUrl, 'GET', `/api/ontology/graph/${OTHER_ORG}`);
    expect(foreign.status).toBe(403);
    expect(isRecord(foreign.body) && foreign.body.code).toBe('CROSS_ORG_DENIED');
  });
});

describe('UV-04 普通对话与恢复', () => {
  it('桌面 controller 消费真实 SSE、续轮携带 sessionId，并从真实会话路由恢复', async () => {
    useConversationStore.setState({
      messages: [], phase: 'idle', welcomeState: 'ready', errorMessage: null,
      phaseIndex: -1, phaseLabel: '', currentSessionId: null,
    });
    const { state, host } = createStreamingHost();
    const controller = createStreamingController(host);
    await controller.sendMessage('UV04 第一轮：现金流怎么看？');
    const sessionId = useConversationStore.getState().currentSessionId;
    expect(sessionId).toMatch(/^sess_/);
    expect(useConversationStore.getState().phase).toBe('done');
    expect(useConversationStore.getState().messages.some(
      (message) => message.type === 'assistant' && message.content === UV04_REPLY,
    )).toBe(true);
    expect(state.streaming).toBe(false);

    await controller.sendMessage('UV04 第二轮：先做什么？');
    expect(useConversationStore.getState().currentSessionId).toBe(sessionId);
    const ordinaryRequests = model.requests.filter((entry) => !JSON.stringify(entry).includes('按 JSON 格式输出诊断结果'));
    expect(ordinaryRequests.length).toBeGreaterThanOrEqual(2);
    const secondMessages = ordinaryRequests[1]?.messages;
    expect(Array.isArray(secondMessages)).toBe(true);
    expect(JSON.stringify(secondMessages)).toContain('UV04 第二轮');

    useConversationStore.getState().clearMessages();
    const restored = await restoreLastSession();
    expect(restored).toBe('restored');
    const messages = useConversationStore.getState().messages;
    expect(messages.filter((message) => message.type === 'user')).toHaveLength(2);
    expect(messages.filter((message) => message.type === 'assistant' && message.content === UV04_REPLY)).toHaveLength(2);
    expect(useConversationStore.getState().currentSessionId).toBe(sessionId);
  });
});

describe('UV-06 诊断报告与冷读恢复', () => {
  it('真实 consult 完成后列表、Markdown 与桌面恢复入口指向同一报告', async () => {
    const consult = await request(running.baseUrl, 'POST', '/api/diagnosis/consult', {
      body: { teamId: ORG, initiator: { role: '管理者', name: 'UV06 用户', concerns: ['现金流恶化'] } },
    });
    expect(consult.status).toBe(200);
    const frames = parseSse(consult.raw);
    const complete = frames.find((frame) => frame.data.type === 'complete');
    const report = complete && isRecord(complete.data.report) ? complete.data.report : null;
    const reportId = report?.reportId;
    expect(typeof reportId).toBe('string');
    expect(report?.summary).toBe(UV06_SUMMARY);
    expect(model.requests.some((entry) => JSON.stringify(entry).includes('按 JSON 格式输出诊断结果'))).toBe(true);

    const list = await request(running.baseUrl, 'GET', '/api/diagnosis/reports?limit=1');
    expect(list.status).toBe(200);
    expect(isRecord(list.body) && Array.isArray(list.body.reports) && isRecord(list.body.reports[0])
      ? list.body.reports[0].reportId : null).toBe(reportId);
    expect(await fetchLatestReportId()).toBe(reportId);

    const coldRead = await request(running.baseUrl, 'GET', `/api/diagnosis/consult/${String(reportId)}/report?format=markdown`);
    expect(coldRead.status).toBe(200);
    expect(coldRead.headers.get('content-type')).toContain('text/markdown');
    expect(coldRead.raw).toContain('回款周期拉长导致现金缺口');
    expect(coldRead.raw).toContain('建立每周回款催收清单');

    const checkpoint = db.prepare('SELECT phase, partial_report FROM diagnosis_checkpoints WHERE session_id = ?').get(reportId);
    expect(isRecord(checkpoint) && checkpoint.phase).toBe(5);
    expect(isRecord(checkpoint) && typeof checkpoint.partial_report === 'string'
      ? checkpoint.partial_report : '').toContain(String(reportId));
  });
});
