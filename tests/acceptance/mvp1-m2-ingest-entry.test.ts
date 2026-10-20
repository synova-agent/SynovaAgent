/**
 * tests/acceptance/mvp1-m2-ingest-entry.test.ts — M2 · 入口面验收（批 P1-656-M2-入口面 / Issue #656）
 *
 * 设计哲学一句：**资料只认落点，不认回执** —— HTTP 回执只证明"接口收下了"；唯一锚点必须从
 * `GET /api/ontology/graph/:orgId` 读回的 `Document.props.name` 里取，否则"贴了资料"可以是假绿
 * （回执自说自话 ＋ 历史节点冒充）。
 *
 * 判据（批规格 §4.1 逐字抄；反例见 §4.2）：
 *   ① 对话输入框贴一段真资料 ⇒ 该资料出现在落点（真 HTTP）
 *   ② ingest 调用点在 conversation 链上 ≥1
 *   ③ 软件侧三维（API 可达率／数据格式／MCP 支持）各一条
 *   ④ 反例：摘掉 ingest 接线 ⇒ 必红
 *
 * 判据 ↔ 用例表（全机器可判；跑法：`npx vitest run tests/acceptance/mvp1-m2-ingest-entry.test.ts`）：
 *   | 判据 | 用例 | 断言点 |
 *   |---|---|---|
 *   | ①-a | POST /api/conversations `{message:'/ingest <资料>', orgId}` | 200 ∧ ok/ingested/nodesCreated≥1/degraded=false ∧ 回执**无** anchor 字段 |
 *   | ①-b | GET /api/ontology/graph/:orgId | type='Document' ∧ props.name=/^inge-/ ∧ props.content 含资料原文 |
 *   | ①-c | 同进程两次不同资料 POST | 两 anchor **不同**；name 含当天 YYYY-MM-DD 与 String(process.pid) |
 *   | ①-d | 另一 orgId 读回 | 不出现该 anchor（同 orgId 读回必须出现——防负例空转） |
 *   | ①-e | `/ingest` 无资料 ／ 非 `/ingest` 普通消息 | 400 `INGEST_EMPTY`；普通消息不创建 Document |
 *   | ②   | fs 读两个源文件 ＋ 非注释扫描 | 存在 `ingestDocumentText(` 与 `ingestConversationExcerpt(` 调用（打印行号） |
 *   | ③-a | integrationHealthSentinel.check（3 系统） | finding evidence 含 `API可达: 1` / `总系统: 3` |
 *   | ③-b | 同上（1 native ＋ 3 none） | `MCP原生: 1` / `总系统: 4`（见已知限制 ②：3 系统 1/3=0.333 ≥ 0.3 阈值不触发） |
 *   | ③-c | JSON 字符串 props 被解析 ／ 坏 JSON | finding description 含 JSON 里的系统名；坏 JSON ⇒ `degraded:true` |
 *   | ④   | 判别力自检（谓词） | 摘接线型回执 ⇒ ① 判否；固定锚点形态 ⇒ ①-c 判否 |
 *
 * 契约（铁律 47）：
 *   @input  — env `SYNOVA_DB_PATH` = mkdtemp 临时目录（真 better-sqlite3 **文件**库）｜
 *             `SYNOVA_DATA_DIR` = 同目录（隔离 LLM 凭证文件）｜LLM_* 环境变量清空（保证离线）；
 *             无网络、无外部服务、不碰 `data/synova.db`
 *   @output — vitest 断言结果 ＋ stdout 证据行（`[M2][HTTP]` / `[M2][READBACK]` / `[M2][WIRE]` / `[M2][3D]`）
 *   @degraded — 测试自身**不降级**：ENV 自检（库可写／graph_nodes 在场／路由已挂载／离线可保证）
 *               不满足 ⇒ `throw new Error('[M2][ENV] …')`（三态语义：环境失败 ≠ 绿 ≠ 业务红）
 *   @authority — 仅验收件自身可执行；**不改产品代码、不改哨兵、不 mock 被测系统**（写集纪律）
 *   @not-here — 不做变异（摘接线／固定锚点由独立自验员在副本上执行，见批规格 §4.2 与 task-3）；
 *               不跑全量测试；不新增公开 HTTP 字段断言（anchor 禁出现在回执）
 *
 * 三态：`0` 绿 ／ `1` 真红（业务断言失败）／ `2` 环境或检查自身失败（本件以 `[M2][ENV]` throw 表达
 *   exit≠0；**空跑 = 没有 expect 的用例 ⇒ 不合规**，铁律 48）。
 * 判别力自检（DSH D4）：④ 用谓词反例证明"摘接线型回执"与"固定锚点"确实判否，防假绿。
 *
 * 已知限制（Known Limitations）：
 *   1. 本件只覆盖 **dev/source 形态**（批规格 §7.3）；客户形态（bundle／桌面／容器）不在本批。
 *   2. ③-b 实测阈值：`integration-health-sentinel.ts:62` 为 `mcpRate < 0.3 && systems.length >= 3`，
 *      3 系统下 1 native = 0.333 **不触发** ⇒ 改用 1 native ＋ 3 none（总系统 4，0.25）取得
 *      `MCP原生: 1` 证据；任务书示例"1 native＋2 none（总系统 3）"在该阈值下物理不可触发。
 *   3. ①-e 普通消息负例走真实 store（orchestration.db 在场）＋不存在的 sessionId ⇒ 404 `NOT_FOUND`，
 *      在 LLM 配置检查之前短路；真 `loadConfig()` 在无凭证时不抛错（`providers/base.ts:132` 直到请求时
 *      才抛 AUTH_FAILED），故"400 LLM_NOT_CONFIGURED"不是无凭证环境的可达路径——负例改用确定性的
 *      前置短路，避免真网络调用（本件离线可跑）。
 *   4. 落点证明用 Document 节点（`name`=锚点 ＋ `content` 原文）；`ingestDocumentText` 的启发式实体抽取
 *      （Person/Team）**不作判据**（批规格 §7.3）。
 *   5. ② 是轻量源码扫描（剔行首 `//`、JSDoc `*` 与块注释），不是完整 TS 解析器：能证明"非注释调用点
 *      存在"，不能证明执行顺序（顺序由 ①-a 的真跑覆盖）。
 *   6. `vitest.config.ts` 全局 env 设 `SYNOVA_DB_PATH=':memory:'`——本件在 beforeAll 覆盖为临时文件库、
 *      afterAll 恢复并整目录删除（不触碰 `data/synova.db`）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { integrationHealthSentinel } from '../../src/sentinel/adapters/integration-health-sentinel';
import type { SentinelCheckResult } from '../../src/sentinel/types';

// ═══════════════════════════════════════════════════════════════════════════
// 常量与夹具
// ═══════════════════════════════════════════════════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = join(HERE, '..', '..');
const ENGINE_FILE = join(WORKTREE_ROOT, 'src', 'agent', 'conversation-engine.ts');
const ROUTE_FILE = join(WORKTREE_ROOT, 'src', 'routes', 'conversations.ts');

/** 组织（租户）夹具 —— orgId 须匹配 ontology 路由的 ORG_ID_PATTERN */
const ORG_A = 'm2-org-a';
const ORG_B = 'm2-org-b';
const ORG_E = 'm2-org-e';
const ORG_U = 'm2-org-u';

/** 本次运行标签：资料串与锚点唯一性都以它为熵源（防历史节点冒充） */
const RUN_TAG = `${Date.now()}-${process.pid}`;

const MATERIAL_A = `M2-A 资料：客户成功部反馈续费率由 82% 降到 61%，负责人 王磊 认为交付周期是主因（run ${RUN_TAG}）`;
const MATERIAL_U1 = `M2-U1 资料：财务部本月回款 1200 万，逾期率 7%（run ${RUN_TAG}）`;
const MATERIAL_U2 = `M2-U2 资料：产品部新增 3 个付费客户，流失 1 个（run ${RUN_TAG}）`;
const MATERIAL_B = `M2-B 资料：另一租户的经营周报，营收环比 +12%（run ${RUN_TAG}）`;

/** 会被清空的 LLM 环境变量（保证本件离线；afterAll 原样恢复） */
const LLM_ENV_KEYS = [
  'LLM_API_KEY', 'DEEPSEEK_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY',
  'GLM_API_KEY', 'ZHIPU_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY',
  'YI_API_KEY', 'LINGYI_API_KEY', 'MINIMAX_API_KEY', 'STEP_API_KEY',
  'ERNIE_API_KEY', 'ERNIE_SECRET_KEY', 'OPENAI_API_KEY',
  'OPENCLAW_GATEWAY_HOST', 'LLM_BASE_URL', 'DEEPSEEK_BASE_URL', 'LLM_MODEL',
] as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 环境失败 = 三态里的 `2`（不是业务红）：显式前缀，禁把空跑当绿 */
function envFail(detail: string): never {
  throw new Error(`[M2][ENV] ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 类型窄化（铁律 38：any 断言家族零容忍 ⇒ 一律用类型守卫 + 窄化）
// ═══════════════════════════════════════════════════════════════════════════

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface GraphNodeView {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/** `GET /api/ontology/graph/:orgId` 的 nodes[] 窄化（响应形状见 src/routes/ontology.ts:158-162） */
function parseNodes(body: unknown): GraphNodeView[] {
  if (!isRecord(body) || !Array.isArray(body.nodes)) return [];
  const out: GraphNodeView[] = [];
  for (const raw of body.nodes) {
    if (!isRecord(raw)) continue;
    out.push({
      id: typeof raw.id === 'string' ? raw.id : '',
      type: typeof raw.type === 'string' ? raw.type : '',
      props: isRecord(raw.props) ? raw.props : {},
    });
  }
  return out;
}

function documentsOf(nodes: GraphNodeView[]): GraphNodeView[] {
  return nodes.filter(n => n.type === 'Document');
}

/** 节点 props.name（Document 的锚点载体；缺省 null） */
function nameOf(node: GraphNodeView): string | null {
  const name = node.props.name;
  return typeof name === 'string' ? name : null;
}

/**
 * 唯一锚点形态判据（与 M2-A 冻结契约同形）：`inge-<ISO8601>-<pid>-<seq>`。
 * 反例抓手：固定锚点（如 `inge-fixed-anchor`）不含当天日期 ⇒ 本函数判否 ⇒ ①-c 红。
 */
function isUniqueAnchorShape(anchor: unknown, today: string, pid: number): boolean {
  return (
    typeof anchor === 'string' &&
    /^inge-\d{4}-\d{2}-\d{2}T/.test(anchor) &&
    anchor.includes(today) &&
    anchor.includes(String(pid))
  );
}

/**
 * ①-a 回执判据：200 且 ok/ingested/nodesCreated/degraded 全合。
 * 反例抓手：落普通路径（SSE 文本 / LLM 未配置 / 摄取失败回执）⇒ 本函数判否 ⇒ ①-a 红。
 */
function isIngestSuccessReceipt(body: unknown): boolean {
  return (
    isRecord(body) &&
    body.ok === true &&
    body.ingested === true &&
    typeof body.nodesCreated === 'number' && body.nodesCreated >= 1 &&
    typeof body.edgesCreated === 'number' &&
    body.degraded === false
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP 夹具（真 express + listen(0) + fetch）
// ═══════════════════════════════════════════════════════════════════════════

interface HttpResult {
  status: number;
  contentType: string;
  body: unknown;
  rawText: string;
}

async function toResult(res: Response): Promise<HttpResult> {
  const rawText = await res.text();
  let body: unknown = rawText;
  try {
    const parsed: unknown = JSON.parse(rawText);
    body = parsed;
  } catch {
    body = rawText; // SSE / 非 JSON：保留原文（①-e 负例据 content-type 断言）
  }
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body,
    rawText,
  };
}

async function postJson(baseUrl: string, path: string, payload: Record<string, unknown>): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

async function getJson(baseUrl: string, path: string): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`);
  return toResult(res);
}

/** 读回某租户的全量节点（真 GET /api/ontology/graph/:orgId） */
async function readGraph(baseUrl: string, orgId: string): Promise<HttpResult> {
  return getJson(baseUrl, `/api/ontology/graph/${orgId}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 源码扫描：非注释命中行号
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 返回 `pattern` 在**非注释**行上的 1-based 行号。
 * 规则（对齐任务书）：剔除 `/* … *\/` 块注释、行首 `//`、JSDoc 行首 `*`；行尾 `//` 之后不参与匹配。
 */
function findNonCommentLines(source: string, pattern: RegExp): number[] {
  const hits: number[] = [];
  let inBlockComment = false;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let code = '';
    let cursor = 0;
    while (cursor < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', cursor);
        if (end === -1) {
          cursor = line.length;
        } else {
          inBlockComment = false;
          cursor = end + 2;
        }
      } else {
        const start = line.indexOf('/*', cursor);
        if (start === -1) {
          code += line.slice(cursor);
          break;
        }
        code += line.slice(cursor, start);
        inBlockComment = true;
        cursor = start + 2;
      }
    }
    const lineComment = code.indexOf('//');
    const codeOnly = lineComment === -1 ? code : code.slice(0, lineComment);
    if (codeOnly.trim().length === 0) continue;
    if (pattern.test(codeOnly)) hits.push(i + 1);
  }
  return hits;
}

// ═══════════════════════════════════════════════════════════════════════════
// ③ 哨兵夹具（真 better-sqlite3 临时库 + graph_nodes 行）
// ═══════════════════════════════════════════════════════════════════════════

interface SentinelSystemRow {
  id: string;
  type: 'TOOL' | 'APP' | 'SOFTWARE';
  props: Record<string, unknown>;
}

/** 开一个独立临时库并建 graph_nodes（复用真适配器建表，不手写 DDL） */
function openSentinelDb(filePath: string): { db: Database.Database; store: SqliteGraphStore } {
  const db = new Database(filePath);
  const store = new SqliteGraphStore(db);
  return { db, store };
}

/** 插入一行系统节点（props 以 JSON **字符串**落库——正是哨兵要解析的格式契约） */
function insertSystemRow(db: Database.Database, row: SentinelSystemRow): void {
  db.prepare(
    'INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)',
  ).run(row.id, 'default', row.type, row.id, JSON.stringify(row.props));
}

/** 插入坏 JSON props（③-c：证明格式契约不静默） */
function insertBadJsonRow(db: Database.Database, id: string, type: 'TOOL' | 'APP' | 'SOFTWARE'): void {
  db.prepare(
    'INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?, ?, ?, ?, ?)',
  ).run(id, 'default', type, id, '{not-json');
}

/** 跑一次哨兵（复用生产真身，禁改该文件） */
async function runIntegrationHealth(db: Database.Database): Promise<SentinelCheckResult> {
  return integrationHealthSentinel.check({ db: null, rawDb: db, now: new Date() });
}

function allEvidence(result: SentinelCheckResult): string[] {
  return result.findings.flatMap(f => f.evidence);
}

// ═══════════════════════════════════════════════════════════════════════════
// 生命周期
// ═══════════════════════════════════════════════════════════════════════════

describe('M2 入口面验收（真 HTTP ＋ 真库 ＋ 唯一锚点 ＋ 软件侧三维）', () => {
  let tmpRoot = '';
  let dbFile = '';
  let db: Database.Database;
  let store: SqliteGraphStore;
  let server: Server | undefined;
  let baseUrl = '';
  let sockets: Socket[] = [];
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // ── ① 真库落临时目录（禁 data/synova.db）──
    tmpRoot = mkdtempSync(join(tmpdir(), 'synova-m2-'));
    dbFile = join(tmpRoot, 'm2.db');
    previousEnv.SYNOVA_DB_PATH = process.env.SYNOVA_DB_PATH;
    previousEnv.SYNOVA_DATA_DIR = process.env.SYNOVA_DATA_DIR;
    previousEnv.DEV_MODE = process.env.DEV_MODE;
    process.env.SYNOVA_DB_PATH = dbFile;
    process.env.SYNOVA_DATA_DIR = tmpRoot; // 凭证文件隔离缝（llm-credential-store:74）
    process.env.DEV_MODE = 'true';
    for (const key of LLM_ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }

    // ── ② 生产同源建库（initEngineContext 建表）──
    const { initEngineContext, getDatabase } = await import('../../src/init/engine-context');
    initEngineContext();
    db = getDatabase();
    store = new SqliteGraphStore(db); // graph_nodes/graph_triples 建表（真适配器，不手写 DDL）

    // ── ③ 真路由装配（conversations ＋ ontology 两个真 router）──
    const conversationsRouter = (await import('../../src/routes/conversations')).default;
    const ontologyRouter = (await import('../../src/routes/ontology')).default;

    const app = express();
    app.use(express.json());
    app.locals.orchestration = { db };
    app.locals.graphStore = store;
    app.use(conversationsRouter);
    app.use(ontologyRouter);
    server = app.listen(0);
    server.on('connection', (socket: Socket) => {
      sockets.push(socket);
      socket.on('close', () => { sockets = sockets.filter(s => s !== socket); });
    });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') envFail('server.address() 未返回端口对象');
    baseUrl = `http://127.0.0.1:${address.port}`;

    // ── ④ ENV 自检（不满足 ⇒ [M2][ENV]，禁空跑当绿）──
    await envSelfCheck();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    if (server) {
      await new Promise<void>(resolve => { server?.close(() => resolve()); });
    }
    try {
      const { closeEngineContext } = await import('../../src/init/engine-context');
      closeEngineContext();
    } catch {
      // 关库失败不掩盖断言结果：临时目录整体删除，进程结束即释放
    }
    for (const key of Object.keys(previousEnv)) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tmpRoot.length > 0 && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** setup 自检：库可写 ＋ graph_nodes 表存在 ＋ 两条真路由已挂载 ＋ 离线可保证 */
  async function envSelfCheck(): Promise<void> {
    // 库是真文件（不是 :memory:，也不是 data/synova.db）
    if (db.name === ':memory:') envFail('DB 落成内存库（本件要求真文件库）');
    if (db.name.includes('data/synova.db')) envFail(`DB 落在产品库上：${db.name}`);
    if (!db.name.startsWith(tmpRoot)) envFail(`DB 不在临时目录：${db.name}`);

    // graph_nodes 表在场（读回端点与 ③ 都依赖它）
    const tableRow: unknown = db.prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='graph_nodes'",
    ).get();
    if (!isRecord(tableRow) || tableRow.c !== 1) envFail('graph_nodes 表不存在（建表失败）');

    // 库可写
    db.exec('CREATE TEMP TABLE IF NOT EXISTS m2_write_probe (x INTEGER)');
    db.prepare('INSERT INTO m2_write_probe (x) VALUES (1)').run();

    // 路由已挂载：空 body ⇒ 400 VALIDATION_ERROR（未挂载会是 404）
    const probe = await postJson(baseUrl, '/api/conversations', {});
    if (probe.status !== 400) {
      envFail(`conversations 路由未正确挂载：POST /api/conversations {} ⇒ ${probe.status}`);
    }
    if (!isRecord(probe.body) || probe.body.code !== 'VALIDATION_ERROR') {
      envFail(`conversations 路由校验语义异常：${probe.rawText.slice(0, 120)}`);
    }

    // 读回端点已挂载 + graphStore 注入生效
    const graphProbe = await readGraph(baseUrl, 'm2-env-probe');
    if (graphProbe.status !== 200 || !isRecord(graphProbe.body) || graphProbe.body.ok !== true) {
      envFail(`ontology 路由未正确挂载/graphStore 未注入：${graphProbe.status} ${graphProbe.rawText.slice(0, 120)}`);
    }

    // 离线可保证（否则普通消息负例可能真调模型）
    const { loadConfig } = await import('../../src/config');
    const config = loadConfig();
    if (config.llmApiKey !== '' || config.gatewayHost !== '') {
      envFail('LLM 凭证在场（env 或凭证文件）—— 本件要求离线可跑，先清空凭证再跑');
    }
    if (config.dbPath !== dbFile) envFail(`initEngineContext 未使用临时库：${config.dbPath}`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ① 真 HTTP＋真落点
  // ═════════════════════════════════════════════════════════════════════════

  it('①-a 真 HTTP：POST /api/conversations `{message:"/ingest <资料>"}` ⇒ 200 ＋ ingested ＋ nodesCreated≥1', async () => {
    const res = await postJson(baseUrl, '/api/conversations', {
      message: `/ingest ${MATERIAL_A}`,
      orgId: ORG_A,
    });

    // 回执一律 JSON（非 SSE）——反例抓手：落普通路径会拿到 text/event-stream
    expect(res.contentType).toContain('application/json');
    expect(res.status).toBe(200);

    // 冻结回执形状（批规格 §4.3 / task-2 契约）
    expect(isIngestSuccessReceipt(res.body)).toBe(true);
    const body: Record<string, unknown> = isRecord(res.body) ? res.body : {};
    expect(body.degraded).toBe(false);
    expect(body.ingested).toBe(true);
    expect(body.ok).toBe(true);
    expect(typeof body.nodesCreated).toBe('number');
    expect(typeof body.edgesCreated).toBe('number');

    // 不新增公开 API 字段：锚点**只**从读回 props.name 取
    expect('anchor' in body).toBe(false);

    console.log(
      `[M2][HTTP] POST /api/conversations /ingest ⇒ ${res.status} ok=${String(body.ok)} ` +
      `ingested=${String(body.ingested)} nodesCreated=${String(body.nodesCreated)} ` +
      `edgesCreated=${String(body.edgesCreated)} degraded=${String(body.degraded)} anchor字段=${'anchor' in body}`,
    );
  });

  it('①-b 落点读回：GET /api/ontology/graph/:orgId ⇒ Document.props.name=/^inge-/ ∧ props.content 含资料原文', async () => {
    const res = await readGraph(baseUrl, ORG_A);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = isRecord(res.body) ? res.body : {};
    expect(body.ok).toBe(true);
    expect(typeof body.nodeCount).toBe('number');

    const nodes = parseNodes(res.body);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const docs = documentsOf(nodes);
    expect(docs.length).toBeGreaterThanOrEqual(1);

    const landed = docs.find(d => String(d.props.content ?? '').includes(MATERIAL_A));
    expect(landed).toBeDefined();
    const anchor = landed === undefined ? null : nameOf(landed);
    expect(typeof anchor).toBe('string');
    expect(String(anchor)).toMatch(/^inge-/);
    expect(String(landed?.props.content)).toContain(MATERIAL_A);

    console.log(
      `[M2][READBACK] GET /api/ontology/graph/${ORG_A} ⇒ Document 锚点=${String(anchor)} ` +
      `content含资料=${String(landed?.props.content ?? '').includes(MATERIAL_A)} nodeCount=${String(body.nodeCount)}`,
    );
  });

  it('①-c 唯一锚点：name 含当天日期＋pid；同进程两次不同资料 ⇒ 两锚点不同且各自 content 对应', async () => {
    const first = await postJson(baseUrl, '/api/conversations', {
      message: `/ingest ${MATERIAL_U1}`,
      orgId: ORG_U,
    });
    const second = await postJson(baseUrl, '/api/conversations', {
      message: `/ingest ${MATERIAL_U2}`,
      orgId: ORG_U,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(isIngestSuccessReceipt(first.body)).toBe(true);
    expect(isIngestSuccessReceipt(second.body)).toBe(true);

    const res = await readGraph(baseUrl, ORG_U);
    expect(res.status).toBe(200);
    const docs = documentsOf(parseNodes(res.body));

    const doc1 = docs.find(d => String(d.props.content ?? '').includes(MATERIAL_U1));
    const doc2 = docs.find(d => String(d.props.content ?? '').includes(MATERIAL_U2));
    expect(doc1).toBeDefined();
    expect(doc2).toBeDefined();

    const anchor1 = doc1 === undefined ? null : nameOf(doc1);
    const anchor2 = doc2 === undefined ? null : nameOf(doc2);
    const today = todayIsoDate();

    // 形态判据：inge-<ISO8601>-<pid>-<seq> ⇒ 含当天日期与进程 pid（固定锚点必红）
    expect(isUniqueAnchorShape(anchor1, today, process.pid)).toBe(true);
    expect(isUniqueAnchorShape(anchor2, today, process.pid)).toBe(true);

    // 唯一性：同进程两次不同资料不得复用锚点（历史节点冒充的反例抓手）
    expect(anchor1).not.toBe(anchor2);
    expect(String(anchor1)).not.toBe('');
    expect(String(anchor2)).not.toBe('');

    // 各自 content 对应各自资料（防"回执对但落点错位"）
    expect(String(doc1?.props.content)).toContain(MATERIAL_U1);
    expect(String(doc1?.props.content)).not.toContain(MATERIAL_U2);
    expect(String(doc2?.props.content)).toContain(MATERIAL_U2);
    expect(String(doc2?.props.content)).not.toContain(MATERIAL_U1);

    console.log(
      `[M2][READBACK] 唯一锚点 today=${today} pid=${String(process.pid)} ` +
      `anchor1=${String(anchor1)} anchor2=${String(anchor2)} 不同=${String(anchor1 !== anchor2)}`,
    );
  });

  it('①-d 跨租户：org-B 的锚点在 org-A 读回不存在（同租户读回必须存在——防负例空转）', async () => {
    const posted = await postJson(baseUrl, '/api/conversations', {
      message: `/ingest ${MATERIAL_B}`,
      orgId: ORG_B,
    });
    expect(posted.status).toBe(200);
    expect(isIngestSuccessReceipt(posted.body)).toBe(true);

    const ownReadback = await readGraph(baseUrl, ORG_B);
    expect(ownReadback.status).toBe(200);
    const ownDocs = documentsOf(parseNodes(ownReadback.body));
    const ownDoc = ownDocs.find(d => String(d.props.content ?? '').includes(MATERIAL_B));
    expect(ownDoc).toBeDefined();
    const anchorB = ownDoc === undefined ? null : nameOf(ownDoc);
    expect(isUniqueAnchorShape(anchorB, todayIsoDate(), process.pid)).toBe(true);

    const foreignReadback = await readGraph(baseUrl, ORG_A);
    expect(foreignReadback.status).toBe(200);
    const foreignBody: Record<string, unknown> = isRecord(foreignReadback.body) ? foreignReadback.body : {};
    expect(typeof foreignBody.nodeCount).toBe('number');
    expect(Number(foreignBody.nodeCount)).toBeGreaterThan(0); // 非空租户才不是空转负例
    const foreignNodes = parseNodes(foreignReadback.body);
    expect(foreignNodes.some(n => nameOf(n) === anchorB)).toBe(false);
    expect(foreignNodes.some(n => String(n.props.content ?? '').includes(MATERIAL_B))).toBe(false);

    console.log(
      `[M2][READBACK] 跨租户 anchorB=${String(anchorB)} ∈ ${ORG_B}=true ∈ ${ORG_A}=false ` +
      `${ORG_A}.nodeCount=${String(foreignBody.nodeCount)}`,
    );
  });

  it('①-e 边界："/ingest" 无资料 ⇒ 400 INGEST_EMPTY；非 /ingest 普通消息不创建 Document', async () => {
    const bare = await postJson(baseUrl, '/api/conversations', { message: '/ingest', orgId: ORG_E });
    expect(bare.contentType).toContain('application/json');
    expect(bare.status).toBe(400);
    const bareBody: Record<string, unknown> = isRecord(bare.body) ? bare.body : {};
    expect(bareBody.ok).toBe(false);
    expect(bareBody.code).toBe('INGEST_EMPTY');
    expect(bareBody.ingested).toBe(false);
    expect(bareBody.degraded).toBe(false);

    // 纯空白资料同样不得静默摄取（`/ingest` + 空白 ⇒ trim 后为空）
    const blank = await postJson(baseUrl, '/api/conversations', { message: '/ingest    ', orgId: ORG_E });
    expect(blank.status).toBe(400);
    const blankBody: Record<string, unknown> = isRecord(blank.body) ? blank.body : {};
    expect(blankBody.code).toBe('INGEST_EMPTY');

    // 普通消息（非 /ingest 前缀）：走普通对话路径（真 store 在场 ＋ 不存在的 sessionId ⇒ 前置 404），
    // 不是 ingest 回执，且**不得**在图上落 Document（已知限制 3：真 loadConfig 无凭证不抛错，
    // 故不在本件触发真模型调用——用确定性前置短路证明"非 /ingest 不摄取"）。
    const ordinary = await postJson(baseUrl, '/api/conversations', {
      message: '我们是一家 30 人的 SaaS 公司，想请教增长诊断。',
      orgId: ORG_E,
      sessionId: 'm2-absent-session',
    });
    expect(ordinary.status).toBe(404);
    const ordinaryBody: Record<string, unknown> = isRecord(ordinary.body) ? ordinary.body : {};
    expect(ordinaryBody.code).toBe('NOT_FOUND');
    expect(ordinaryBody.ingested).toBeUndefined();
    expect(isIngestSuccessReceipt(ordinary.body)).toBe(false);

    const readback = await readGraph(baseUrl, ORG_E);
    expect(readback.status).toBe(200);
    const readbackBody: Record<string, unknown> = isRecord(readback.body) ? readback.body : {};
    expect(readbackBody.nodeCount).toBe(0);
    expect(documentsOf(parseNodes(readback.body)).length).toBe(0);

    console.log(
      `[M2][HTTP] 边界 '/ingest'=${bare.status}/${String(bareBody.code)} ` +
      `'/ingest   '=${blank.status}/${String(blankBody.code)} ` +
      `普通消息=${ordinary.status}（非 ingest）org=${ORG_E} nodeCount=${String(readbackBody.nodeCount)}`,
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ② 接线静态证
  // ═════════════════════════════════════════════════════════════════════════

  it('② 接线静态证：两个源文件存在**非注释**的 ingestDocumentText(/ingestConversationExcerpt( 调用', () => {
    const engineSource = readFileSync(ENGINE_FILE, 'utf8');
    const routeSource = readFileSync(ROUTE_FILE, 'utf8');

    const engineIngestDoc = findNonCommentLines(engineSource, /ingestDocumentText\s*\(/);
    const engineHook = findNonCommentLines(engineSource, /ingestConversationExcerpt\s*\(/);
    const routeHook = findNonCommentLines(routeSource, /ingestConversationExcerpt\s*\(/);
    const routePrefix = findNonCommentLines(routeSource, /INGEST_COMMAND_PREFIX/);

    // 判据②：conversation 链上 ingest 调用点 ≥1（引擎侧真调 ingestDocumentText）
    expect(engineIngestDoc.length).toBeGreaterThanOrEqual(1);
    // 钩子本体在引擎（模块级函数），调用侧在路由 —— 两处都必须非注释可见
    expect(engineHook.length).toBeGreaterThanOrEqual(1);
    expect(routeHook.length).toBeGreaterThanOrEqual(1);
    // 触发判据（方案 A）在路由分支处可见
    expect(routePrefix.length).toBeGreaterThanOrEqual(1);

    console.log(
      `[M2][WIRE] conversation-engine.ts: ingestDocumentText@${engineIngestDoc.join(',')} ` +
      `ingestConversationExcerpt@${engineHook.join(',')} ｜ conversations.ts: ` +
      `ingestConversationExcerpt@${routeHook.join(',')} INGEST_COMMAND_PREFIX@${routePrefix.join(',')}`,
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ③ 软件侧三维（复用真哨兵，禁改 src/sentinel/**）
  // ═════════════════════════════════════════════════════════════════════════

  it('③-a API 可达率：3 系统（1 full ＋ 2 none）⇒ evidence 含 "API可达: 1"／"总系统: 3"', async () => {
    const { db: apiDb } = openSentinelDb(join(tmpRoot, 'sentinel-api.db'));
    try {
      insertSystemRow(apiDb, {
        id: 'sys-a1', type: 'TOOL',
        props: { name: '金蝶云星空ERP', mcpSupport: 'none', apiAccess: 'full', connector: false },
      });
      insertSystemRow(apiDb, {
        id: 'sys-a2', type: 'APP',
        props: { name: '用友U8', mcpSupport: 'none', apiAccess: 'none', connector: false },
      });
      insertSystemRow(apiDb, {
        id: 'sys-a3', type: 'SOFTWARE',
        props: { name: '钉钉', mcpSupport: 'none', apiAccess: 'unknown', connector: true },
      });

      const result = await runIntegrationHealth(apiDb);
      expect(result.degraded).toBe(false);
      expect(result.ok).toBe(true);

      const apiFinding = result.findings.find(f => f.evidence.includes('API可达: 1'));
      expect(apiFinding).toBeDefined();
      expect(apiFinding?.evidence).toContain('总系统: 3');
      expect(apiFinding?.title).toContain('API 可达率低');
      expect(allEvidence(result)).toContain('API可达: 1');

      console.log(
        `[M2][3D] API可达率 = API可达: 1 / 总系统: 3 (33%) ` +
        `finding="${String(apiFinding?.title)}" evidence=[${String(apiFinding?.evidence.join(' | '))}]`,
      );
    } finally {
      apiDb.close();
    }
  });

  it('③-b MCP 支持：1 native ＋ 3 none（4 系统）⇒ evidence 含 "MCP原生: 1"／"总系统: 4"', async () => {
    const { db: mcpDb } = openSentinelDb(join(tmpRoot, 'sentinel-mcp.db'));
    try {
      insertSystemRow(mcpDb, {
        id: 'sys-b1', type: 'TOOL',
        props: { name: '飞书', mcpSupport: 'native', apiAccess: 'full', connector: true },
      });
      for (const [id, name] of [['sys-b2', '金蝶'], ['sys-b3', '用友'], ['sys-b4', '北森']] as const) {
        insertSystemRow(mcpDb, {
          id, type: 'APP',
          props: { name, mcpSupport: 'none', apiAccess: 'none', connector: false },
        });
      }

      const result = await runIntegrationHealth(mcpDb);
      expect(result.degraded).toBe(false);
      expect(result.ok).toBe(true);

      const mcpFinding = result.findings.find(f => f.evidence.includes('MCP原生: 1'));
      expect(mcpFinding).toBeDefined();
      expect(mcpFinding?.evidence).toContain('总系统: 4');
      expect(mcpFinding?.title).toContain('MCP 支持度低');

      console.log(
        `[M2][3D] MCP支持 = MCP原生: 1 / 总系统: 4 (25% < 0.3 阈值；见已知限制 2) ` +
        `finding="${String(mcpFinding?.title)}" evidence=[${String(mcpFinding?.evidence.join(' | '))}]`,
      );
    } finally {
      mcpDb.close();
    }
  });

  it('③-c 数据格式：JSON 字符串 props 被解析（description 含 JSON 系统名）；坏 JSON ⇒ degraded:true', async () => {
    const { db: fmtDb } = openSentinelDb(join(tmpRoot, 'sentinel-format.db'));
    try {
      insertSystemRow(fmtDb, {
        id: 'sys-c1', type: 'TOOL',
        props: { name: '金蝶云星空ERP', mcpSupport: 'none', apiAccess: 'full', connector: false },
      });
      insertSystemRow(fmtDb, {
        id: 'sys-c2', type: 'APP',
        props: { name: '用友U8', mcpSupport: 'none', apiAccess: 'none', connector: false },
      });
      insertSystemRow(fmtDb, {
        id: 'sys-c3', type: 'SOFTWARE',
        props: { name: '钉钉', mcpSupport: 'none', apiAccess: 'none', connector: false },
      });

      const parsed = await runIntegrationHealth(fmtDb);
      const apiFinding = parsed.findings.find(f => f.evidence.includes('API可达: 1'));
      expect(apiFinding).toBeDefined();
      // description 里的系统名**只能**来自 props JSON（行 id 是 sys-c2/sys-c3，不是中文名）
      expect(apiFinding?.description).toContain('用友U8');
      expect(apiFinding?.description).toContain('钉钉');
      expect(apiFinding?.description).not.toContain('sys-c2');

      // 坏 JSON props ⇒ 格式契约不静默：顶层 degraded:true（results 置空，不编假值）
      insertBadJsonRow(fmtDb, 'sys-c-bad', 'APP');
      const broken = await runIntegrationHealth(fmtDb);
      expect(broken.degraded).toBe(true);
      expect(broken.ok).toBe(true);

      console.log(
        `[M2][3D] 数据格式 = JSON props 解析命中 用友U8/钉钉（description）` +
        ` ｜ 坏 JSON ⇒ degraded=${String(broken.degraded)} findings=${String(broken.findings.length)}`,
      );
    } finally {
      fmtDb.close();
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ④ 反例可跑（判别力自检；真变异由独立自验员执行）
  // ═════════════════════════════════════════════════════════════════════════

  it('④ 判别力自检：摘接线型回执 ⇒ ① 判否；固定锚点形态 ⇒ ①-c 判否', () => {
    const today = todayIsoDate();

    // 「摘掉接线 ⇒ 落普通路径」的三种真实形态，① 判据必须判否
    expect(isIngestSuccessReceipt({ ok: false, code: 'LLM_NOT_CONFIGURED', message: '请先完成 LLM 配置' })).toBe(false);
    expect(isIngestSuccessReceipt({ ok: false, code: 'STORE_UNAVAILABLE', degraded: true })).toBe(false);
    expect(isIngestSuccessReceipt({ ok: true, ingested: false, nodesCreated: 0, edgesCreated: 0, degraded: true, code: 'INGEST_FAILED' })).toBe(false);
    expect(isIngestSuccessReceipt('event: open\ndata: {"type":"open","sessionId":"sess_x"}')).toBe(false);

    // 正例必须判真（防"谓词恒 false"的假判别力）
    expect(isIngestSuccessReceipt({ ok: true, ingested: true, nodesCreated: 2, edgesCreated: 0, degraded: false })).toBe(true);

    // 「把锚点改成固定值」⇒ ①-c 判据必须判否
    expect(isUniqueAnchorShape('inge-fixed-anchor', today, process.pid)).toBe(false);
    expect(isUniqueAnchorShape(`inge-2020-01-01T00:00:00.000Z-${process.pid}-1`, today, process.pid)).toBe(false);
    // 真锚点形态必须判真
    expect(isUniqueAnchorShape(`inge-${new Date().toISOString()}-${process.pid}-1`, today, process.pid)).toBe(true);

    console.log(
      `[M2][DISCRIM] 摘接线型回执判否=true 固定锚点判否=true 真锚点判真=true today=${today} pid=${String(process.pid)}`,
    );
  });
});
