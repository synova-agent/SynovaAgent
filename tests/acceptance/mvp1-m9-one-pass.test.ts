/**
 * tests/acceptance/mvp1-m9-one-pass.test.ts — #656（批 4 / M9）六段一次贯通验收（MVP-1 最终判据）
 *
 * 设计哲学一句：**一份真数据、一次运行、一段接一段** —— 只有「同一进程 / 同一临时库 / 同一次运行」
 * 里按顺序走完六段的证据才算贯通；分段各起一个库＝伪贯通（裁 149 裁3）。
 *
 * 判据（批规格 v2 §1.3 / §4.1；反例见 §4.2，反例由独立自验员在 verify 树执行）：
 *   #718 ① 六段一次贯通（L2） ② #719 §4.4 写④链 ③ #720 ⑥冻结对照 ④ #721 每段摘一处必红
 *
 * 判据 ↔ 用例表（全机器可判；跑法：`npx vitest run tests/acceptance/mvp1-m9-one-pass.test.ts`）：
 *   | 判据 | 用例 | 断言点 |
 *   |---|---|---|
 *   | ① 输入 | `① 输入 [SEG-1]` | `POST /api/conversations` `/ingest` ⇒ 200 ∧ ok/ingested/degraded=false ∧ nodes≥3/edges≥1；`GET /api/ontology/graph/:org` 读回唯一 Document（`type='Document'`、`props.name`=`inge-<ISO>-<pid>-<seq>` 且含当天与 pid） |
 *   | ② ingest | `② ingest [SEG-2]` | Document `props.content` 含本次资料原文；`MENTIONS` 边 `to`=真实 Document id ∧ DB `object_type='Document'`（#667：不再是 `doc_<fileName>`） |
 *   | ③ 本体/哨兵/计算 | `③ 本体/哨兵/计算 [SEG-3]` | **真入口** `POST /api/data/upload`（出厂映射 `erp-standard` ⇒ `outcome/financial`，合计 rev300/opex30/cash180）→ cash-flow 哨兵经唯一 sink 写 4 个 metric_id；`computeOverflow` = 30（独立常量）；`resource/money` 白名单接受 `operating_expenses`（#837 E-1） |
 *   | ④ 参数/决策 | `④ 参数/决策 [SEG-4]` | 真 HTTP `view=trends` 的 latest/previous/changeRatio 逐值可算（单次观测 ⇒ null）；④b 决策台账写→读逐字段匹配；④c 三导出＋文件头 `@deprecated`/#1010＋`src/` 零调用；④d `{calibrated:0,status:'not_implemented'}` |
 *   | ⑤ 出口 | `⑤ 出口 [SEG-5]` | 真 fetch（同一 full server）→ M4 loader → render 桥渲染「测量值＋趋势」＋`data-testid="measurement-to-onepager"` |
 *   | ⑥ 冻结 | `⑥ 冻结对照 [SEG-6]` | 只读源码扫描：六段链 15 个模块零 import 进化引擎/`applyEvolutionActions`/`processFeedbackSignals`/`loop-handlers`（**清单含 `src/cycles/overflow-compute.ts`**）；全 `src/` 调用点仅 loop-handlers；链运行期间进化写面零变化 |
 *   | #719 §4.4 | `§4.4 [SEG-4.4]` | 本 run 的 metric 行 `source_id` 全等 `SENTINEL-CASH-FLOW-v1`（`source_type` 只辅助）；sink 写入行数=查询行数；R7 测试内直插 `source_type='compute'`+`source_id='M9-DIRECT-WRITE'` ⇒ 守卫必红（断言后清理） |
 *
 * 契约（铁律 47；规格 §2.1）:
 *   @input   — env `SYNOVA_DB_PATH`=mkdtemp 临时目录下的 `synova.db`（真文件库，禁碰 `data/synova.db`）｜
 *              `SYNOVA_DATA_DIR`=同目录（隔离 LLM 凭证文件）｜`PORT=0`（内核分配）｜删除 `JWT_SECRET`（dev 通道）｜
 *              清空 LLM/provider 键（离线）｜**保留** vitest 全局 `SYNOVA_SKIP_MCP=1`（M9 不验证 M5，也不宣称真实 MCP）
 *   @output  — vitest 断言结果 ＋ stdout 证据行（`[BOOT]` / `[SEG-1 PASS]`…`[SEG-6 PASS]` / `[SEG-4.4 PASS]` /
 *              `[M9][PASS|FAIL|ERROR]` / 终行 `MVP1-L2: PASS|FAIL|ERROR`）
 *   @exit    — vitest 语义：`0` 通过 ｜ `1` 真红（业务断言失败） ｜ `2` 环境/检查自身失败（本件以
 *              `M9EnvError`（`[M9][ENV] …`，带 `code='M9_ENV_UNAVAILABLE'`）throw 表达；**禁 skip**）
 *   @degraded — 测试自身**不降级**：环境不满足 ⇒ throw；空跑/跳过一律不算绿（铁律 48）
 *   @authority — 仅验收件自身可执行；**不改产品代码/哨兵/schema/field-mapping**；不 mock 被测系统
 *              （零模拟框架／零网络打桩）；不直插 `graph_nodes`/`metric_readings` 冒充输入（R7 反例除外）
 *   @not-here — 不做六段反例 R1–R8（§4.2：由独立自验员在独立 verify 树执行，本文件不含变异）；
 *              不验证 M5（证据在 #703/#704/#705）、不关闭/不替代 M3/M4 卡；不宣称 M9/MVP-1 完成；
 *              不做 Electron/浏览器像素级断言（render 桥只证渲染树）
 *
 * 三态：`0` 绿 ／ `1` 真红 ／ `2` 环境或检查自身失败（`[M9][ENV]`）。判别力自检（DSH D4）：
 *   每条断言都有对应「摘一处 ⇒ 必红」的消费缝（§4.2 R1–R8）；R7 在正跑内自带「守卫必红」反证。
 *
 * 已知限制（Known Limitations）:
 *   1. **③ 已改真链（#837 E-1 落地后）**：原「schema 无 `operating_expenses` ⇒ 经 ingest 送不进 opex」的缺口
 *      已由两处产品改动闭合 —— ① `extensions/ontology/resource/money.json` 增 `operating_expenses`；
 *      ② `src/sentinel/adapters/cash-flow-sentinel.ts` 加 `operating_expense`（单数，`outcome/financial` schema 名
 *      与 `erp-standard` 映射目标）**显式别名回退**。本段因此改回**真入口**（`POST /api/data/upload`），
 *      **不再用 `createNode` 绕行**，也不再声明「另开卡」。
 *      ⚠️ 夹具代价（真实语义，不是缺陷）：`erp-standard` 映射**无** `total_cost` ⇒ 本段 cost 恒 0，
 *      net=(rev-opex)/rev、gross=1；cost 维度由 **M3 领域链**守卫（`mvp1-m3-domain-chain.test.ts`）。
 *   2. ④b 决策台账夹具节点用生产 `createNode('outcome/risk', {id:…})` 建（`captureDecision` 按 props 过滤，
 *      同 `tests/acceptance/mvp1-m3-domain-chain.test.ts` 语义；M3 已合件用 raw SQL 直插，本件**不用**该形态）；
 *      只证接口存在（写→读各一次），**不作 §4.4 的 ③→④ 证据**，也不作六段链数据证据。
 *   3. ⑥ 冻结 = 产品**无**进化开关 ⇒ 只读源码扫描 ＋ 链运行期间不调用（运行期以「进化动作文件写面零变化」为
 *      基线观察）；不新增开关、不冒充「产品开关已实现」（C1 CTO 待签）。
 *   4. render 桥不执行 hook/事件 ⇒ 出口段只证渲染树含测量值/趋势/一页纸入口，不证像素与点击行为。
 *   5. full server 会起 cron/SentinelRunner/MCP；`afterAll` 必须 `agent.stop()`＋`stopSynovaAgentProcess()`＋
 *      `server.close()`＋删临时目录；清理失败 ⇒ `[M9][ENV]`（不得 skip）。MCP boot 结果为 fire-and-forget 降级，
 *      不作本件判据（`SYNOVA_SKIP_MCP=1` 为 vitest 全局配置，本件保留不改）。
 *   6. 终行计数（numTotalTests/numPassed/numFailed/numSkipped）取自 vitest 自身 task 结果（`afterEach` 的
 *      `context.task.result.state`），非手写数字。
 *   7. CI `--changed` 可能跳过新 acceptance 件（裁 223）⇒ 以本地全量输出＋PR 为准。
 *
 * Source map（区块 → 职责）:
 *   | 区块 | 职责 |
 *   |---|---|
 *   | 常量与环境 | RUN_TAG/ORG/临时库/env 隔离/独立期望常量（不从被测函数反推） |
 *   | boot / teardown | `startSynovaAgentProcess`→`getServer`→listening(15s)→实端口；afterAll 清理＋终行 |
 *   | 类型窄化与 HTTP | `isRecord`/`parseGraphView`/`parseTrendItems`；真 fetch 包装 |
 *   | DB 只读 helper | `selectMetricRows`/`sourceViolations`（SQL 写死 `source_id`）/`selectMentionsEdges` |
 *   | 源码扫描 | `findNonCommentLines`/`walkFiles`（复用 M2 判据口径；M9 自包含不共享库） |
 *   | ①–⑥ + §4.4 | 六段顺序用例 ＋ §4.4 专项（每段断言通过后才 `[SEG-n PASS]`） |
 *   | 计数与终行 | `afterEach` 计数 ＋ `afterAll` 条件打印 `MVP1-L2: PASS|FAIL|ERROR` |
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import type { SynovaAgent } from '../../src/agent/synova-agent';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';
import type { MetricSink } from '../../src/sentinel/metric-readings-writer';
import { computeOverflow } from '../../src/cycles/overflow-compute';
import type { CycleConfig, EnterpriseTimeSeries } from '../../src/cycles/overflow-compute';
import { captureDecision } from '../../src/l4/decision-capture';
import type { DecisionInput } from '../../src/l4/decision-capture';
import { listDecisionRows } from '../../src/l4/decision-ledger-readback';
import { closeGoal, verifyEffect, transitionGoal } from '../../src/growth/goal-lifecycle';
import { calibrateThresholds } from '../../src/l3/pkb-lifecycle';
import { deriveTrendDirection, loadMeasurementTrends } from '../../electron-renderer/src/lib/measurement-trends';
import type { MeasurementTrendsView } from '../../electron-renderer/src/lib/measurement-trends';
import { MeasurementTrendSection } from '../../electron-renderer/src/components/MeasurementTrendSection';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';

// ═══════════════════════════════════════════════════════════════════════════
// 常量与环境（唯一锚点：RUN_TAG 防历史数据冒充；临时库禁碰 data/synova.db）
// ═══════════════════════════════════════════════════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = resolve(HERE, '..', '..');

/** 本次运行标签：org / 锚点 / 决策夹具 / 输出断言的唯一熵源（同一次运行内唯一） */
const RUN_TAG = `${Date.now()}-${process.pid}`;
/** 组织（租户）—— 须匹配 `src/routes/ontology.ts:27` 的 ORG_ID_PATTERN（1..64，字母数字/下划线/连字符） */
const ORG = `m9-org-${RUN_TAG}`;
const TODAY = new Date().toISOString().slice(0, 10);

/** 真文件库：mkdtemp 临时目录（afterAll 整目录删除；禁写 data/synova.db） */
const DB_DIR = mkdtempSync(join(tmpdir(), 'synova-m9-656-'));
const DB_FILE = join(DB_DIR, 'synova.db');

/** 本次资料：ASCII 引号 `"王磊"` 供 `ingestDocumentText` 的 Person 启发式提取（否则无 MENTIONS 边） */
const INGEST_MESSAGE = `/ingest M9 验收资料（run ${RUN_TAG}）：客户成功部"王磊"反馈续费率由 82% 降到 61%，部门：客户成功部，本月回款 1200 万`;

/** 环境隔离键（26 键；`SYNOVA_SKIP_MCP` **不在**此列——vitest 全局配置保留，M9 不验证 M5） */
const LLM_ENV_KEYS = [
  'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY',
  'QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'GLM_API_KEY', 'ZHIPU_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_API_KEY',
  'YI_API_KEY', 'LINGYI_API_KEY', 'MINIMAX_API_KEY', 'STEP_API_KEY', 'ERNIE_API_KEY', 'ERNIE_SECRET_KEY',
  'OPENCLAW_GATEWAY_HOST',
] as const;

const ENV_KEYS = [
  'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'SYNOVA_ORG_ID', 'PORT', 'JWT_SECRET', 'DEV_MODE', 'ENGINE_TOKENS',
  ...LLM_ENV_KEYS,
] as const;

/**
 * 财务夹具（#837 E-1）：**出厂映射** `erp-standard`（target `outcome/financial`）的 14 个外部字段。
 * 两期（合计 revenue 300 / cost 0 / opex 30 / cash 180）—— 走**真入口** `POST /api/data/upload`。
 *   · opex：erp 映射写 `operating_expense`（单数，financial schema 名）⇒ 哨兵经**显式别名**读到（#837 ②）
 *   · cost：erp-standard 无 `total_cost` 映射 ⇒ 恒 0（该导出不含营业成本；cost 维度由 M3 守卫）
 * 14 个外部字段**全量提供**：缺一个 `ingestRow` 就记一条 `缺少字段` error（真实行为，不做半套夹具）。
 */
function erpRow(v: { revenue: number; opex: number; cash: number; period: string }): Record<string, string | number> {
  return {
    营业收入: v.revenue,
    经营现金流: Math.round(v.revenue * 0.12),
    固定资产净值: 30,
    总负债: 40,
    所有者权益: 60,
    现金余额: v.cash,
    毛利润: Math.round(v.revenue * 0.6),
    营业费用: v.opex,
    总资产: v.revenue,
    流动资产: Math.round(v.revenue / 2),
    流动负债: 20,
    应收账款: 15,
    存货: 5,
    期间: v.period,
  };
}

// opex 两期**取同值 20** 的原因：cost 维度恒 0（erp 无 total_cost），若 opex 也随收入等比放大，
// 两期净利率会**完全相等** ⇒ ⑤「趋势 up」与 ④「changeRatio≠0」失去判别力（实测撞到过：flat vs up）。
// 固定 opex ⇒ net 0.8 → 13/15（上升），runway 3 → 9（提升），趋势可判。
const ERP_ROWS: ReadonlyArray<Record<string, string | number>> = [
  erpRow({ revenue: 100, opex: 20, cash: 60, period: '2026-01' }),
  erpRow({ revenue: 200, opex: 20, cash: 120, period: '2026-02' }),
];

const MONEY_TOTAL = { revenue: 300, cost: 0, opex: 40, cash: 180 } as const;

// 🔴 独立期望常量（手工从夹具算；**不从被测函数反推**；变异 compute ⇒ 必红）
//    第一期（仅 2026-01）：net=(100-0-20)/100=4/5；gross=(100-0)/100=1；runway=60/(20/1)=3；YoY=null（不足两期）
//    两期合计：net=(300-0-40)/300=13/15；gross=300/300=1；YoY=(200-100)/100=1；runway=180/(40/2)=9
//    （cost=0 是 `erp-standard` 映射的真实语义；runway 分母 = ΣoperatingExpenses/期数 —— 只含 opex，不含 cost）
//    🔴 哨兵若不认 `operating_expense` ⇒ opex 恒 0 ⇒ net 变 1、runway 变 ∞ ⇒ 本组常量必红（#837 ③ 判别力）
const PREV_NET_MARGIN = 4 / 5;
const PREV_GROSS_MARGIN = 1;
const PREV_RUNWAY = 3;
const NET_MARGIN = 13 / 15;
const GROSS_MARGIN = 1;
const YOY = 1;
const RUNWAY = 9;
const OVERFLOW = 30;

const METRIC_IDS = [
  'CASH-FLOW-NET-MARGIN',
  'CASH-FLOW-GROSS-MARGIN',
  'CASH-FLOW-REVENUE-YOY-GROWTH',
  'CASH-FLOW-RUNWAY-MONTHS',
] as const;

const SENTINEL_SOURCE_ID = 'SENTINEL-CASH-FLOW-v1';
const DIRECT_WRITE_SOURCE_ID = 'M9-DIRECT-WRITE';
const DECISION_FIXTURE_ID = `m9-decision-${RUN_TAG}`;

/** 六段链只读扫描清单（R6 作用点必须含 `src/cycles/overflow-compute.ts`） */
const CHAIN_MODULES = [
  'src/routes/conversations.ts',
  'src/agent/conversation-engine.ts',
  'src/ingest/knowledge-ingest-bridge.ts',
  'src/agent/data-ingest-service.ts',
  'src/sentinel/adapters/cash-flow-sentinel.ts',
  'src/sentinel/metric-readings-writer.ts',
  'src/sentinel/metric-readings-reader.ts',
  'src/routes/sentinel.ts',
  'src/cycles/overflow-compute.ts',
  'src/l4/decision-capture.ts',
  'src/l4/decision-ledger-readback.ts',
  'src/growth/goal-lifecycle.ts',
  'src/l3/pkb-lifecycle.ts',
  'electron-renderer/src/lib/measurement-trends.ts',
  'electron-renderer/src/components/MeasurementTrendSection.tsx',
] as const;

/** ⑥ 冻结：六段链模块不得出现的进化面符号（R6 变异加 import ⇒ 必红） */
const EVOLUTION_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'middle-evolution-engine', pattern: /middle-evolution-engine/ },
  { label: 'applyEvolutionActions', pattern: /\bapplyEvolutionActions\b/ },
  { label: 'processFeedbackSignals', pattern: /\bprocessFeedbackSignals\b/ },
  { label: 'loop-handlers', pattern: /loop-handlers/ },
];

/** ⑥ 运行期基线：进化动作的**文件写面**（`applyThresholdAdjust` 等会改这些 JSON） */
const EVOLUTION_WRITE_FACE_DIRS = ['extensions/industries', 'extensions/evolution', 'cycles'] as const;

/** 六段顺序（`[SEG-n PASS]` 入列顺序；§4.4 是专项组，排在六段之后） */
const SEGMENT_ORDER = ['1', '2', '3', '4', '5', '6', '4.4'] as const;

// ═══════════════════════════════════════════════════════════════════════════
// 环境失败 = 三态里的 `2`（typed error 带 code；禁把空跑/跳过当绿）
// ═══════════════════════════════════════════════════════════════════════════

class M9EnvError extends Error {
  readonly code = 'M9_ENV_UNAVAILABLE';

  constructor(detail: string) {
    super(`[M9][ENV] ${detail}`);
    this.name = 'M9EnvError';
  }
}

let envFailed = false;

/** 环境/检查自身失败：打标（终行 ERROR）＋ throw（vitest 真红，不 skip） */
function envFail(detail: string): never {
  envFailed = true;
  throw new M9EnvError(detail);
}

// ═══════════════════════════════════════════════════════════════════════════
// 类型窄化（铁律 38：零 any 断言家族 ⇒ 一律类型守卫 + 窄化）
// ═══════════════════════════════════════════════════════════════════════════

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 前置段产出的句柄（未就绪 ⇒ 环境/顺序失败，不静默继续） */
function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) envFail(`${what} 未就绪（前置段未完成或已清理）`);
  return value;
}

interface GraphNodeView {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

interface GraphEdgeView {
  id: string;
  type: string;
  from: string;
  to: string;
}

interface GraphView {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

/** `GET /api/ontology/graph/:orgId` 响应窄化（形状见 `src/routes/ontology.ts:165-171`） */
function parseGraphView(body: unknown): GraphView {
  if (!isRecord(body)) envFail('图读回响应不是对象');
  const nodesRaw = Array.isArray(body.nodes) ? body.nodes : [];
  const edgesRaw = Array.isArray(body.edges) ? body.edges : [];
  const nodes: GraphNodeView[] = [];
  for (const raw of nodesRaw) {
    if (!isRecord(raw)) continue;
    nodes.push({
      id: typeof raw.id === 'string' ? raw.id : '',
      type: typeof raw.type === 'string' ? raw.type : '',
      props: isRecord(raw.props) ? raw.props : {},
    });
  }
  const edges: GraphEdgeView[] = [];
  for (const raw of edgesRaw) {
    if (!isRecord(raw)) continue;
    edges.push({
      id: typeof raw.id === 'string' ? raw.id : '',
      type: typeof raw.type === 'string' ? raw.type : '',
      from: typeof raw.from === 'string' ? raw.from : '',
      to: typeof raw.to === 'string' ? raw.to : '',
    });
  }
  return { nodes, edges };
}

interface TrendItemView {
  metricId: string;
  entityId: string;
  unit: string | null;
  count: number;
  latestAt: string;
  latestValue: number | null;
  previousValue: number | null;
  changeRatio: number | null;
}

/** `view=trends` 的 `summary[]` 窄化（形状见 `src/sentinel/metric-readings-reader.ts:59-69`） */
function parseTrendItems(body: Record<string, unknown>): TrendItemView[] {
  const raw = Array.isArray(body.summary) ? body.summary : [];
  const items: TrendItemView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const metricId = entry.metricId;
    const entityId = entry.entityId;
    const count = entry.count;
    const latestAt = entry.latestAt;
    if (typeof metricId !== 'string' || typeof entityId !== 'string') continue;
    if (typeof count !== 'number' || typeof latestAt !== 'string') continue;
    items.push({
      metricId,
      entityId,
      count,
      latestAt,
      unit: typeof entry.unit === 'string' ? entry.unit : null,
      latestValue: typeof entry.latestValue === 'number' ? entry.latestValue : null,
      previousValue: typeof entry.previousValue === 'number' ? entry.previousValue : null,
      changeRatio: typeof entry.changeRatio === 'number' ? entry.changeRatio : null,
    });
  }
  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP（真 fetch 打真 full server；禁 mock）
// ═══════════════════════════════════════════════════════════════════════════

interface HttpResult {
  status: number;
  body: unknown;
  raw: string;
}

async function toResult(res: Response): Promise<HttpResult> {
  const raw = await res.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = raw; // 非 JSON ⇒ 保留原文（断言会因形状不符而红，不伪造成功）
  }
  return { status: res.status, body, raw };
}

async function postJson(path: string, payload: Record<string, unknown>): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

async function getJson(path: string): Promise<HttpResult> {
  return toResult(await fetch(`${baseUrl}${path}`));
}

// ═══════════════════════════════════════════════════════════════════════════
// DB 只读 helper（SQL 写死 `source_id` —— #719 守卫的唯一判据）
// ═══════════════════════════════════════════════════════════════════════════

interface MetricDbRow {
  metric_id: string;
  value: number;
  unit: string | null;
  source_id: string | null;
  source_type: string;
  observed_at: string;
}

interface MetricSourceViolation {
  metric_id: string;
  source_id: string | null;
}

interface MentionEdgeRow {
  subject_id: string;
  object_id: string;
  object_type: string;
  predicate: string;
}

interface MoneyNodeRow {
  id: string;
  props: Record<string, unknown>;
}

function readCount(row: unknown): number {
  if (!isRecord(row)) envFail('SQL COUNT 查询返回非对象');
  const count = row.c;
  if (typeof count !== 'number') envFail('SQL COUNT 查询缺 c 数值');
  return count;
}

function selectMentionsEdges(db: Database.Database, orgId: string): MentionEdgeRow[] {
  return db.prepare(
    "SELECT subject_id, object_id, object_type, predicate FROM graph_triples WHERE graph = ? AND predicate = 'MENTIONS' AND valid_to IS NULL",
  ).all(orgId) as MentionEdgeRow[];
}

/**
 * 读回本 run 的财务节点（#837 E-1 后 = `outcome/financial`；旧的 `resource/money` 仅由 3-6 白名单夹具写入）。
 * 用**直 SQL 固定 type**（不经被测读口）⇒ 真实落库类型被咬住。
 */
function selectFinancialNodes(db: Database.Database, orgId: string): MoneyNodeRow[] {
  const rows = db.prepare(
    "SELECT id, props FROM graph_nodes WHERE graph = ? AND type = 'outcome/financial' AND valid_to IS NULL ORDER BY id",
  ).all(orgId) as Array<{ id: string; props: string }>;
  return rows.map(row => ({ id: row.id, props: JSON.parse(row.props) as Record<string, unknown> }));
}

function numberProp(props: Record<string, unknown>, key: string): number {
  const value = props[key];
  if (typeof value !== 'number') envFail(`money 节点属性 ${key} 不是数值（实得 ${String(value)}）`);
  return value;
}

function selectMetricRows(db: Database.Database, orgId: string, metricIds: readonly string[]): MetricDbRow[] {
  const placeholders = metricIds.map(() => '?').join(', ');
  return db.prepare(
    `SELECT metric_id, value, unit, source_id, source_type, observed_at
       FROM metric_readings WHERE org_id = ? AND metric_id IN (${placeholders})
      ORDER BY observed_at ASC`,
  ).all(orgId, ...metricIds) as MetricDbRow[];
}

/**
 * #719 守卫（测试内只读 helper，**SQL 写死 `source_id='SENTINEL-CASH-FLOW-v1'`**）：
 * 返回本 run 4 个 metric_id 中 source_id 不等于哨兵来源的行 ⇒ 非空即判否。
 * `source_type` 只作辅助，**不作替代**（直插 compute 会被本函数抓住 —— R7）。
 */
function sourceViolations(db: Database.Database, orgId: string, metricIds: readonly string[]): MetricSourceViolation[] {
  const placeholders = metricIds.map(() => '?').join(', ');
  return db.prepare(
    `SELECT metric_id, source_id FROM metric_readings
      WHERE org_id = ? AND metric_id IN (${placeholders})
        AND (source_id IS NULL OR source_id <> '${SENTINEL_SOURCE_ID}')`,
  ).all(orgId, ...metricIds) as MetricSourceViolation[];
}

function latestByMetric(rows: readonly MetricDbRow[]): Map<string, MetricDbRow> {
  const out = new Map<string, MetricDbRow>();
  for (const row of rows) {
    const previous = out.get(row.metric_id);
    if (previous === undefined || previous.observed_at <= row.observed_at) out.set(row.metric_id, row);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 源码扫描（复用 M2 判据口径：剔块注释 / 行首 `//` / 行尾注释；M9 自包含不共享库）
// ═══════════════════════════════════════════════════════════════════════════

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

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  return out;
}

function readSource(relPath: string): string {
  return readFileSync(join(WORKTREE_ROOT, relPath), 'utf-8');
}

/** 进化动作写面快照（path → mtimeMs:size）；链运行前后必须逐项相等（⑥ 运行期基线） */
function snapshotWriteFaces(): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const relDir of EVOLUTION_WRITE_FACE_DIRS) {
    for (const file of walkFiles(join(WORKTREE_ROOT, relDir))) {
      if (!file.endsWith('.json')) continue;
      const stat = statSync(file);
      snapshot.set(relative(WORKTREE_ROOT, file), `${stat.mtimeMs}:${stat.size}`);
    }
  }
  return snapshot;
}

function snapshotPairs(snapshot: Map<string, string>): string[] {
  return [...snapshot.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 生命周期与运行期状态（六段共享同一进程 / 同一临时库 / 同一次运行）
// ═══════════════════════════════════════════════════════════════════════════

let agent: SynovaAgent | null = null;
let server: Server | null = null;
let baseUrl = '';
let db: Database.Database | null = null;
let store: SqliteGraphStore | null = null;
let sink: MetricSink | null = null;
let sinkWriteCount = 0;
let documentId = '';
let documentAnchor = '';
let extWriteFaceBaseline = new Map<string, string>();
const savedEnv = new Map<string, string | undefined>();
const segmentMarks: string[] = [];

const counters = { total: 0, passed: 0, failed: 0, skipped: 0 };

/** 段号入列（**仅该段断言全部通过后**调用；禁提前打印） */
function markSegment(id: string, detail: string): void {
  segmentMarks.push(id);
  console.log(`[SEG-${id} PASS] ${detail}`);
}

/** 等 listening（15s 超时）并解析**实端口**（PORT=0 ⇒ 内核分配） */
async function waitListening(target: Server, timeoutMs: number): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const timer = setTimeout(() => rejectListen(new M9EnvError(`HTTP 服务 ${timeoutMs}ms 内未进入 listening`)), timeoutMs);
    if (target.listening) {
      clearTimeout(timer);
      resolveListen();
      return;
    }
    target.once('error', (err: Error) => {
      clearTimeout(timer);
      rejectListen(new M9EnvError(`HTTP 服务启动失败：${err.message}`));
    });
    target.once('listening', () => {
      clearTimeout(timer);
      resolveListen();
    });
  });
  const address = target.address();
  if (address === null || typeof address === 'string') envFail('server.address() 未返回端口对象');
  return address.port;
}

beforeAll(async () => {
  // ── ① 环境隔离（先于任何 engine-context 初始化）──
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.SYNOVA_DB_PATH = DB_FILE;
  process.env.SYNOVA_DATA_DIR = DB_DIR; // 凭证文件隔离缝（同 M2 先例）
  process.env.PORT = '0';
  process.env.DEV_MODE = 'true';

  // M5 已收口；M9 不验证 M5 ⇒ **保留** vitest 全局 `SYNOVA_SKIP_MCP=1`（不删、不改、不宣称真实 MCP）
  if (process.env.SYNOVA_SKIP_MCP !== '1') {
    envFail(`vitest 全局 SYNOVA_SKIP_MCP 应为 '1'（实得 ${String(process.env.SYNOVA_SKIP_MCP)}）；M9 保留该全局配置`);
  }

  // ── ② 真 full server（生产入口组合根；禁自建第二套装配）──
  const entry = await import('../../src/init/agent-entry');
  agent = await entry.startSynovaAgentProcess();
  const httpServer = agent.getServer();
  if (httpServer === null) envFail('SynovaAgent.getServer() 返回 null（full server 未启动）');
  server = httpServer;
  const port = await waitListening(httpServer, 15_000);
  baseUrl = `http://127.0.0.1:${port}`;

  // ── ③ 同库句柄（同一临时库文件的**第二条连接**：夹具写入与只读断言都走它）──
  db = new Database(DB_FILE);
  db.pragma('busy_timeout = 5000');
  store = new SqliteGraphStore(db);

  if (db.name === ':memory:') envFail('DB 落成内存库（本件要求真文件库，证真实落盘路径）');
  if (db.name.includes('data/synova.db')) envFail(`DB 落在产品库上：${db.name}`);
  if (!resolve(db.name).startsWith(resolve(DB_DIR))) envFail(`DB 不在临时目录：${db.name}`);
  const tableCount = readCount(db.prepare(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('graph_nodes','graph_triples','metric_readings')",
  ).get());
  if (tableCount !== 3) envFail(`临时库缺表（graph_nodes/graph_triples/metric_readings 命中 ${tableCount}/3）`);

  // 唯一写入口 sink（生产 `createMetricSink`；外层只**计数**，不改语义、不伪造结果）
  const baseSink = createMetricSink(db);
  sink = (row) => {
    const result = baseSink(row);
    if (result.written) sinkWriteCount += 1;
    return result;
  };

  // ⑥ 运行期基线：boot 完成后取一次（链运行前）
  extWriteFaceBaseline = snapshotWriteFaces();

  console.log(`[BOOT] port=${port} db=${DB_FILE} org=${ORG} node=${process.version} base=${baseUrl}`);
}, 60_000);

afterEach((context) => {
  // 终行计数取自 vitest 自身 task 结果（非手写）
  counters.total += 1;
  const state = String(context.task.result?.state ?? 'fail');
  if (state === 'pass') counters.passed += 1;
  else if (state === 'skip' || state === 'todo') counters.skipped += 1;
  else counters.failed += 1;
});

afterAll(async () => {
  const cleanupErrors: string[] = [];

  // Win 先关 DB 句柄再删目录；本进程第二条连接先关，再停 agent（其 cleanup 会关 HTTP 服务）
  if (db !== null) {
    try {
      db.close();
      db = null;
    } catch (err: unknown) {
      cleanupErrors.push(`关闭临时库连接失败：${errorMessage(err)}`);
    }
  }
  if (agent !== null) {
    try {
      await agent.stop();
    } catch (err: unknown) {
      cleanupErrors.push(`agent.stop() 失败：${errorMessage(err)}`);
    }
  }
  try {
    const entry = await import('../../src/init/agent-entry');
    entry.stopSynovaAgentProcess();
  } catch (err: unknown) {
    cleanupErrors.push(`stopSynovaAgentProcess() 失败：${errorMessage(err)}`);
  }
  if (server !== null && server.listening) {
    try {
      await new Promise<void>((resolveClose) => { server?.close(() => resolveClose()); });
    } catch (err: unknown) {
      cleanupErrors.push(`server.close() 失败：${errorMessage(err)}`);
    }
  }
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    rmSync(DB_DIR, { recursive: true, force: true });
  } catch (err: unknown) {
    cleanupErrors.push(`删除临时目录失败：${errorMessage(err)}`);
  }

  const segmentsOk = segmentMarks.join(',') === SEGMENT_ORDER.join(',');
  const verdict = envFailed || cleanupErrors.length > 0
    ? 'ERROR'
    : counters.failed === 0 && counters.skipped === 0 && segmentsOk ? 'PASS' : 'FAIL';

  console.log(
    `[M9][${verdict}] numTotalTests=${counters.total} numPassed=${counters.passed}`
    + ` numFailed=${counters.failed} numSkipped=${counters.skipped} segments=${segmentMarks.length}/${SEGMENT_ORDER.length}`,
  );
  console.log(`MVP1-L2: ${verdict}`);

  if (cleanupErrors.length > 0) throw new M9EnvError(`afterAll 清理失败：${cleanupErrors.join('; ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// ① 输入（#718）：/ingest ⇒ HTTP 200 ＋ Document 落点（唯一锚点从图读回，不信回执）
// ═══════════════════════════════════════════════════════════════════════════

describe('#656 M9 · 六段一次贯通（真 full server ＋ 同临时库 ＋ 同一次运行）', () => {
  it('① 输入 [SEG-1]：POST /api/conversations /ingest ⇒ 200 ∧ ingested ∧ Document 节点（type=Document、props.name=本次 anchor）', async () => {
    expect(segmentMarks).toEqual([]);

    const res = await postJson('/api/conversations', { message: INGEST_MESSAGE, orgId: ORG });
    expect(res.status).toBe(200);
    if (!isRecord(res.body)) envFail(`/ingest 回执不是 JSON 对象：${res.raw.slice(0, 200)}`);
    expect(res.body.ok).toBe(true);
    expect(res.body.ingested).toBe(true);
    expect(res.body.degraded).toBe(false);
    const nodesCreated = res.body.nodesCreated;
    if (typeof nodesCreated !== 'number') envFail('回执缺 nodesCreated 数值');
    expect(nodesCreated).toBeGreaterThanOrEqual(3); // Person（"王磊"）＋ Team（部门：…）＋ Document
    const edgesCreated = res.body.edgesCreated;
    if (typeof edgesCreated !== 'number') envFail('回执缺 edgesCreated 数值');
    expect(edgesCreated).toBeGreaterThanOrEqual(1); // Person → Document 的 MENTIONS 边

    // 落点证明（M2 口径：从图读回取唯一锚点，回执自说自话不算）
    const graphRes = await getJson(`/api/ontology/graph/${ORG}`);
    expect(graphRes.status).toBe(200);
    const view = parseGraphView(graphRes.body);
    const documents = view.nodes.filter(
      node => node.type === 'Document' && typeof node.props.content === 'string' && node.props.content.includes(RUN_TAG),
    );
    expect(documents.length).toBe(1); // 本次运行唯一：临时库无历史节点，仍按 content 过滤防「已存在即绿」
    const document = documents[0];
    if (document === undefined) envFail('本次资料的 Document 节点读回为空');
    documentId = document.id;
    const anchor = typeof document.props.name === 'string' ? document.props.name : '';
    documentAnchor = anchor;
    expect(anchor).toMatch(/^inge-\d{4}-\d{2}-\d{2}T/); // 唯一锚点形态（同 M2 冻结契约）
    expect(anchor).toContain(TODAY);
    expect(anchor).toContain(String(process.pid));

    console.log(
      `[SEG-1] status=${res.status} ok=${String(res.body.ok)} ingested=${String(res.body.ingested)}`
      + ` nodes=${nodesCreated} edges=${edgesCreated} document=${documentId} anchor=${anchor}`,
    );
    markSegment('1', `document=${documentId} anchor=${anchor} nodes=${nodesCreated}`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ② ingest（#718）：Document content 落地 ＋ MENTIONS target=真实 Document id 且 object_type='Document'（#667）
  // ═════════════════════════════════════════════════════════════════════════

  it('② ingest [SEG-2]：Document content 落地 ∧ MENTIONS object_id=真实 Document id ∧ object_type=Document（#667）', async () => {
    expect(segmentMarks).toEqual(['1']);
    const database = need(db, 'db');

    const graphRes = await getJson(`/api/ontology/graph/${ORG}`);
    expect(graphRes.status).toBe(200);
    const view = parseGraphView(graphRes.body);
    const document = view.nodes.find(node => node.id === documentId);
    if (document === undefined) envFail(`图读回缺本次 Document 节点：${documentId}`);
    const content = typeof document.props.content === 'string' ? document.props.content : '';
    expect(content).toContain('王磊'); // 资料原文（ASCII 引号人名由启发式提取）
    expect(content).toContain(RUN_TAG);

    const mentions = view.edges.filter(edge => edge.type === 'MENTIONS');
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    const personIds = new Set(view.nodes.filter(node => node.type === 'Person').map(node => node.id));
    expect(personIds.size).toBeGreaterThanOrEqual(1);
    for (const edge of mentions) {
      expect(edge.to).toBe(documentId); // #667：target = 真实 Document id（不再是 doc_<fileName> 悬挂边）
      expect(personIds.has(edge.from)).toBe(true);
    }

    // DB 侧：object_type 必须是 'Document'（不是 'unknown'）——HTTP 读回不带 object_type，故用同库只读 SQL 佐证
    const edgeRows = selectMentionsEdges(database, ORG);
    expect(edgeRows.length).toBe(mentions.length);
    for (const row of edgeRows) {
      expect(row.predicate).toBe('MENTIONS');
      expect(row.object_id).toBe(documentId);
      expect(row.object_type).toBe('Document');
      expect(row.object_type).not.toBe('unknown');
    }
    const documentNodeCount = readCount(database.prepare(
      "SELECT COUNT(*) AS c FROM graph_nodes WHERE id = ? AND graph = ? AND type = 'Document' AND valid_to IS NULL",
    ).get(documentId, ORG));
    expect(documentNodeCount).toBe(1); // 悬挂边反证：target 是真节点

    console.log(
      `[SEG-2] contentChars=${content.length} mentions=${mentions.length}`
      + ` objectType=Document target=${documentId} personNodes=${personIds.size}`,
    );
    markSegment('2', `mentions=${mentions.length} target=${documentId} object_type=Document`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ③ 本体/哨兵/计算（#718）：money 节点 → cash-flow 哨兵 → sink → 4 指标；overflow=30
  // ═════════════════════════════════════════════════════════════════════════

  it('③ 本体/哨兵/计算 [SEG-3]：真 ingest（POST /api/data/upload · erp-standard ⇒ outcome/financial）＋ cash-flow 4 指标 ＋ overflow=30 ＋ money 白名单（#837）', async () => {
    expect(segmentMarks).toEqual(['1', '2']);
    const database = need(db, 'db');
    const graphStore = need(store, 'store');
    const metricSink = need(sink, 'sink');

    // 3-1 第一期：**真入口**（HTTP 上传 ＋ 出厂映射 `erp-standard` → `outcome/financial`）
    //     #837 ②：opex 落 `operating_expense`（单数）⇒ 哨兵经显式别名读到；**不再是 createNode 绕行**
    const firstUpload = await postJson('/api/data/upload', { mapping: 'erp-standard', rows: [ERP_ROWS[0]], graph: ORG });
    expect(firstUpload.status).toBe(200);
    if (!isRecord(firstUpload.body)) envFail(`上传响应不是对象：${firstUpload.raw.slice(0, 200)}`);
    expect(firstUpload.body.ok).toBe(true);
    expect(firstUpload.body.nodeType).toBe('outcome/financial');
    expect(firstUpload.body.nodesCreated).toBe(1);
    expect(firstUpload.body.warnings).toEqual([]); // 14 字段全给 ⇒ 无白名单跳过
    const firstRun = await cashFlowSentinel.check({ db: graphStore, rawDb: database, metricSink, teamId: ORG, now: new Date() });
    expect(firstRun.ok).toBe(true);
    expect(firstRun.degraded).toBe(false);
    expect(sinkWriteCount).toBe(3); // 仅 1 期 ⇒ YoY=null 被过滤；net/gross/runway 三行

    // 3-2 第二期（同一次运行内追加 ⇒ 趋势出现 previousValue）
    const secondUpload = await postJson('/api/data/upload', { mapping: 'erp-standard', rows: [ERP_ROWS[1]], graph: ORG });
    expect(secondUpload.status).toBe(200);
    if (!isRecord(secondUpload.body)) envFail(`上传响应不是对象：${secondUpload.raw.slice(0, 200)}`);
    expect(secondUpload.body.ok).toBe(true);
    expect(secondUpload.body.nodesCreated).toBe(1);
    const secondRun = await cashFlowSentinel.check({ db: graphStore, rawDb: database, metricSink, teamId: ORG, now: new Date() });
    expect(secondRun.ok).toBe(true);
    expect(secondRun.degraded).toBe(false);
    expect(sinkWriteCount).toBe(7); // 3（首期）＋ 4（两期，含 YoY）

    // 3-3 本体：ingest 真落库（`outcome/financial`），合计 = 独立常量（变异夹具/公式 ⇒ 必红）
    //     🔴 opex 断言打在**单数名** `operating_expense` 上（真链写入名）：哨兵若不认它 ⇒ 3-4 的 net 必红
    const moneyNodes = selectFinancialNodes(database, ORG);
    expect(moneyNodes.length).toBe(2);
    const sums = { revenue: 0, cost: 0, opex: 0, cash: 0 };
    for (const node of moneyNodes) {
      sums.revenue += numberProp(node.props, 'total_revenue');
      sums.opex += numberProp(node.props, 'operating_expense');
      sums.cash += numberProp(node.props, 'cash');
    }
    // erp-standard 无 `total_cost` 映射 ⇒ cost 维度恒 0（真实语义，非夹具缺陷；cost 由 M3 守卫）
    expect(sums.cost).toBe(0);
    expect(sums.revenue).toBe(MONEY_TOTAL.revenue);
    expect(sums.cost).toBe(MONEY_TOTAL.cost);
    expect(sums.opex).toBe(MONEY_TOTAL.opex);
    expect(sums.cash).toBe(MONEY_TOTAL.cash);

    // 3-4 哨兵/时序：4 个 metric_id 在，且最新值 = 手算常量（R3/R4 变异 ⇒ 必红）
    const metricRows = selectMetricRows(database, ORG, METRIC_IDS);
    expect(metricRows.length).toBe(7);
    expect([...new Set(metricRows.map(row => row.metric_id))].sort()).toEqual([...METRIC_IDS].sort());
    const latest = latestByMetric(metricRows);
    const netRow = latest.get('CASH-FLOW-NET-MARGIN');
    const grossRow = latest.get('CASH-FLOW-GROSS-MARGIN');
    const yoyRow = latest.get('CASH-FLOW-REVENUE-YOY-GROWTH');
    const runwayRow = latest.get('CASH-FLOW-RUNWAY-MONTHS');
    if (netRow === undefined || grossRow === undefined || yoyRow === undefined || runwayRow === undefined) {
      envFail('metric_readings 缺 4 个 cash-flow 指标之一');
    }
    expect(netRow.value).toBeCloseTo(NET_MARGIN, 9);
    expect(grossRow.value).toBeCloseTo(GROSS_MARGIN, 9);
    expect(yoyRow.value).toBeCloseTo(YOY, 9);
    expect(runwayRow.value).toBeCloseTo(RUNWAY, 9);
    expect(netRow.unit).toBe('ratio');
    expect(runwayRow.unit).toBe('months');

    // 3-5 计算：同一份 money 数据上的溢出公式（独立常量 OVERFLOW=30）
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const cycle: CycleConfig = {
      cycleId: 'm9-overflow',
      name: 'M9 溢出',
      description: '',
      version: '1.0.0',
      applicableIndustries: [],
      nodes: [
        { id: 'revenue', label: '营收', type: 'stock', initialValue: MONEY_TOTAL.revenue, unit: '万' },
        { id: 'reinvest', label: '再投资', type: 'flow', initialValue: MONEY_TOTAL.opex, unit: '万' },
      ],
      edges: [{ from: 'revenue', to: 'reinvest', polarity: '+', weight: 0.1 }],
      overflowFormula: {
        condition: 'revenue > reinvest * 3',
        targetNode: 'reinvest',
        formula: '{{revenue}} * 0.1',
        minDataMaturity: 'medium',
      },
      dataMaturity: 'medium',
      mapping: [],
      crossCyclePropagation: [],
    };
    const series: EnterpriseTimeSeries = {
      dataPoints: months.map((month, index) => ({ month, value: 80 + index * 4 })), // 80..100 上升 ⇒ rising
      currentNodeValues: { revenue: MONEY_TOTAL.revenue, reinvest: MONEY_TOTAL.opex },
      enterpriseId: `m9-ent-${RUN_TAG}`,
    };
    const snapshot = computeOverflow(cycle, series);
    expect(snapshot.overflowValue).toBe(OVERFLOW); // 300 * 0.1，精确匹配（变异 computeOverflow ⇒ 必红）
    expect(snapshot.trendDirection).toBe('rising');
    expect(snapshot.cycleId).toBe('m9-overflow');
    expect(snapshot.degraded).toBe(false);
    expect(Number.isFinite(snapshot.momChangePercent)).toBe(true);

    // 3-6 本体 schema 白名单（#837 ①）：`resource/money` 必须接受 `operating_expenses`
    //     判别力：money.json 若缺该键 ⇒ ingestRow 按 validProps 跳过（warnings 非空 + 节点无该属性）⇒ 下面必红
    //     （跑在 3-5 之后：多一条 money 节点不得影响上面已取的指标快照）
    const { ingestBatch } = await import('../../src/agent/data-ingest-service');
    const moneyIngest = await ingestBatch(
      graphStore,
      {
        name: 'm9-e1-money',
        label: 'M9 E-1 money 白名单夹具',
        targetNodeType: 'resource/money',
        mappings: [{ externalField: '营业费用', prop: 'operating_expenses', type: 'number' }],
      },
      [{ 营业费用: 7 }],
      ORG,
    );
    expect(moneyIngest.warnings).toEqual([]);
    expect(moneyIngest.nodesCreated).toBe(1);
    const moneyRow = database.prepare(
      "SELECT props FROM graph_nodes WHERE graph = ? AND type = 'resource/money' AND valid_to IS NULL",
    ).all(ORG) as Array<{ props: string }>;
    if (moneyRow.length !== 1) envFail(`money 节点数应为 1（实得 ${moneyRow.length}）`);
    expect((JSON.parse(moneyRow[0].props) as Record<string, unknown>)['operating_expenses']).toBe(7);

    console.log(
      `[SEG-3] money=${moneyNodes.length} revenue=${sums.revenue} cost=${sums.cost} opex=${sums.opex} cash=${sums.cash}`
      + ` metricRows=${metricRows.length} net=${netRow.value} gross=${grossRow.value} yoy=${yoyRow.value} runway=${runwayRow.value}`
      + ` overflow=${snapshot.overflowValue} trend=${snapshot.trendDirection}`,
    );
    markSegment('3', `metrics=4 rows=${metricRows.length} overflow=${snapshot.overflowValue}`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ④ 参数/决策（#718）：trends ＋ ④b 写读 ＋ ④c 三导出/标记 ＋ ④d not_implemented
  // ═════════════════════════════════════════════════════════════════════════

  it('④ 参数/决策 [SEG-4]：trends（latest/previous/changeRatio）＋ ④b 写→读字段匹配 ＋ ④c 三导出＋@deprecated/#1010 ＋ ④d not_implemented', async () => {
    expect(segmentMarks).toEqual(['1', '2', '3']);
    const database = need(db, 'db');
    const graphStore = need(store, 'store');

    // ── ④a trends（真 HTTP；不经被测读口自证，直接打真路由）──
    const res = await getJson('/api/sentinel/metrics/readings?view=trends');
    expect(res.status).toBe(200);
    if (!isRecord(res.body)) envFail(`trends 响应不是对象：${res.raw.slice(0, 200)}`);
    expect(res.body.ok).toBe(true);
    const items = parseTrendItems(res.body);
    expect(items.length).toBeGreaterThanOrEqual(4);

    const netTrend = items.find(item => item.metricId === 'CASH-FLOW-NET-MARGIN');
    if (netTrend === undefined) envFail('trends 缺 CASH-FLOW-NET-MARGIN');
    expect(netTrend.count).toBe(2); // 本次运行两次哨兵观测
    expect(netTrend.unit).toBe('ratio');
    expect(netTrend.latestValue).toBeCloseTo(NET_MARGIN, 9);
    expect(netTrend.previousValue).toBeCloseTo(PREV_NET_MARGIN, 9);
    expect(netTrend.changeRatio).toBeCloseTo((NET_MARGIN - PREV_NET_MARGIN) / PREV_NET_MARGIN, 9);

    const grossTrend = items.find(item => item.metricId === 'CASH-FLOW-GROSS-MARGIN');
    if (grossTrend === undefined) envFail('trends 缺 CASH-FLOW-GROSS-MARGIN');
    expect(grossTrend.latestValue).toBeCloseTo(GROSS_MARGIN, 9);
    expect(grossTrend.previousValue).toBeCloseTo(PREV_GROSS_MARGIN, 9);
    expect(grossTrend.changeRatio).toBeCloseTo((GROSS_MARGIN - PREV_GROSS_MARGIN) / PREV_GROSS_MARGIN, 9);

    const runwayTrend = items.find(item => item.metricId === 'CASH-FLOW-RUNWAY-MONTHS');
    if (runwayTrend === undefined) envFail('trends 缺 CASH-FLOW-RUNWAY-MONTHS');
    expect(runwayTrend.latestValue).toBeCloseTo(RUNWAY, 9);
    expect(runwayTrend.previousValue).toBeCloseTo(PREV_RUNWAY, 9);
    expect(runwayTrend.changeRatio).toBeCloseTo((RUNWAY - PREV_RUNWAY) / PREV_RUNWAY, 9);
    expect(runwayTrend.unit).toBe('months');

    // YoY 只有一次观测 ⇒ previousValue/changeRatio **必须 null**（不假装可算）
    const yoyTrend = items.find(item => item.metricId === 'CASH-FLOW-REVENUE-YOY-GROWTH');
    if (yoyTrend === undefined) envFail('trends 缺 CASH-FLOW-REVENUE-YOY-GROWTH');
    expect(yoyTrend.count).toBe(1);
    expect(yoyTrend.latestValue).toBeCloseTo(YOY, 9);
    expect(yoyTrend.previousValue).toBeNull();
    expect(yoyTrend.changeRatio).toBeNull();

    // ── ④b 决策台账：写 → 读回逐字段匹配（生产 createDecision/listDecisionRows；只证接口存在）──
    const fixtureNodeId = graphStore.createNode('outcome/risk', {
      id: DECISION_FIXTURE_ID,
      name: `m9-decision-fixture-${RUN_TAG}`,
      source: 'm9-acceptance-fixture',
    }, ORG);
    expect(fixtureNodeId.length).toBeGreaterThan(0);
    const decisionInput: DecisionInput = {
      nodeId: DECISION_FIXTURE_ID,
      userId: 'm9-user',
      action: 'confirmed',
      role: 'm9-role',
      reason: 'm9-reason',
      context: { orgId: ORG, cycleId: 'm9-overflow', summary: `m9-summary-${RUN_TAG}` },
      output: { kind: 'm9-artifact', ref: `ref-${RUN_TAG}`, digest: `digest-${RUN_TAG}` },
      presetVersion: 7,
      review: { verdict: 'pass', by: 'm9-reviewer', reason: 'm9-review' },
    };
    const wrote = captureDecision(graphStore, ORG, decisionInput);
    expect(wrote.recorded).toBe(true);
    const writtenRow = need(wrote.row, 'captureDecision.row');

    const read = listDecisionRows(graphStore, { nodeId: DECISION_FIXTURE_ID }, ORG);
    expect(read.ok).toBe(true);
    expect(read.errors ?? []).toEqual([]);
    expect(read.entries.length).toBe(1);
    const entry = read.entries[0];
    expect(entry.edgeType).toBe('DECISION_CONFIRMED');
    expect(entry.nodeId).toBe(DECISION_FIXTURE_ID); // 台账边 to 端 = decision.nodeId（props.id；captureDecision 按 props 过滤）
    expect(entry.row.schema).toBe('decision-ledger/v1');
    expect(entry.row.who).toBe('m9-user');
    expect(entry.row.role).toBe('m9-role');
    expect(entry.row.output.kind).toBe('m9-artifact');
    expect(entry.row.output.ref).toBe(`ref-${RUN_TAG}`);
    expect(entry.row.output.digest).toBe(`digest-${RUN_TAG}`);
    expect(entry.row.presetVersion).toBe(7);
    expect(entry.row.review.verdict).toBe('pass');
    expect(entry.row.review.by).toBe('m9-reviewer');
    expect(entry.row.context.summary).toBe(`m9-summary-${RUN_TAG}`);
    expect(entry.row.at).toBe(writtenRow.at);

    // ── ④c goal-lifecycle：三导出存在 ＋ 文件头 @deprecated/#1010 标记 ＋ src/ 零调用点（存在 ≠ 实现）──
    expect(typeof closeGoal).toBe('function');
    expect(typeof verifyEffect).toBe('function');
    expect(typeof transitionGoal).toBe('function');
    const goalHeader = readSource('src/growth/goal-lifecycle.ts').split('\n').slice(0, 20).join('\n');
    expect(goalHeader.match(/^\s*\*\s+@deprecated/m), '@deprecated 应为文件头 JSDoc 标注（去掉 ⇒ 必红）').not.toBeNull();
    expect(goalHeader, '#1010 接入点指针应在文件头（去掉 ⇒ 必红）').toContain('#1010');
    const goalCallers = walkFiles(join(WORKTREE_ROOT, 'src'))
      .filter(file => file.endsWith('.ts'))
      .map(file => ({ file: relative(WORKTREE_ROOT, file), source: readFileSync(file, 'utf-8') }))
      .filter(entryFile => entryFile.file !== 'src/growth/goal-lifecycle.ts'
        && findNonCommentLines(entryFile.source, /from\s+['"][^'"]*goal-lifecycle['"]/).length > 0)
      .map(entryFile => entryFile.file);
    expect(goalCallers, `src/ 内不得有 goal-lifecycle 调用点（命中：${goalCallers.join(',')}）`).toEqual([]);

    // ── ④d pkb-lifecycle：阈值校准占位接口 = 合法通过态（裁 153：存在 ≠ 实现）──
    expect(calibrateThresholds('m9-industry')).toEqual({ calibrated: 0, status: 'not_implemented' });

    // 决策台账与 metric 表确实落在同一临时库（六段同一库的同一次运行证据）
    const decisionEdgeCount = readCount(database.prepare(
      "SELECT COUNT(*) AS c FROM graph_triples WHERE graph = ? AND object_id = ? AND valid_to IS NULL",
    ).get(ORG, DECISION_FIXTURE_ID));
    expect(decisionEdgeCount).toBeGreaterThanOrEqual(1);

    console.log(
      `[SEG-4] trends=${items.length} netPrev=${String(netTrend.previousValue)} netChange=${String(netTrend.changeRatio)}`
      + ` decisionEdge=${entry.edgeType} decisionRows=${read.entries.length} goalCallers=${goalCallers.length}`
      + ` calibrate=${JSON.stringify(calibrateThresholds('m9-industry'))}`,
    );
    markSegment('4', `trends=${items.length} decision=${entry.edgeType} goalCallers=0 ④d=not_implemented`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ⑤ 出口（#718）：真 fetch trends → M4 loader → render 桥（测量值＋趋势＋一页纸入口）
  // ═════════════════════════════════════════════════════════════════════════

  it('⑤ 出口 [SEG-5]：真 fetch trends → M4 loader → render 桥渲染「测量值＋趋势」＋ data-testid="measurement-to-onepager"', async () => {
    expect(segmentMarks).toEqual(['1', '2', '3', '4']);

    // 真 fetch（同一 full server）→ 生产 loader（永不抛；失败即 degraded）
    const view = await loadMeasurementTrends(baseUrl);
    expect(view.ok).toBe(true);
    expect(view.degraded).toBe(false);
    expect(view.errors ?? []).toEqual([]);
    expect(view.summary.length).toBeGreaterThanOrEqual(4);

    const net = view.summary.find(item => item.metricId === 'CASH-FLOW-NET-MARGIN');
    if (net === undefined) envFail('loader 结果缺 CASH-FLOW-NET-MARGIN');
    expect(net.latestValue).toBeCloseTo(NET_MARGIN, 9);
    expect(net.previousValue).toBeCloseTo(PREV_NET_MARGIN, 9);
    expect(deriveTrendDirection(net.changeRatio)).toBe('up'); // 13/15 > 4/5 ⇒ up

    // render 桥（test-support/render.ts：纯函数组件树，不执行 hook/事件）
    const html = renderToStaticMarkup(MeasurementTrendSection({ view, state: 'ready', onOpenOnePager: () => undefined }));
    expect(html).toContain('测量值＋趋势');
    expect(html).toContain('data-testid="measurement-trend-section"');
    expect(html).toContain('data-testid="measurement-to-onepager"'); // R8：改 :138 渲染处 testid ⇒ 本行必红
    expect(html).toContain('CASH-FLOW-NET-MARGIN');
    expect(html).toContain(String(NET_MARGIN)); // 渲染的是本 run 真值（不是别处的常量回填）
    expect(html).toContain(String(RUNWAY));
    expect(html).toContain('ratio');
    expect(html).toContain('months');
    expect(html).toContain('data-trend="up"');
    expect((html.match(/data-testid="measurement-trend-item"/g) ?? []).length).toBeGreaterThanOrEqual(4);

    console.log(
      `[SEG-5] loader ok=${String(view.ok)} degraded=${String(view.degraded)} summary=${view.summary.length}`
      + ` htmlChars=${html.length} testid=measurement-to-onepager`,
    );
    markSegment('5', `loader=${view.summary.length} render=${html.length}chars`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ⑥ 冻结对照（#720）：只读源码扫描（零 import 进化）＋ 链运行期间不调用
  // ═════════════════════════════════════════════════════════════════════════

  it('⑥ 冻结对照 [SEG-6]：六段链 15 模块零 import 进化引擎/applyEvolutionActions/processFeedbackSignals ＋ 链运行期间不调用', () => {
    expect(segmentMarks).toEqual(['1', '2', '3', '4', '5']);
    expect(CHAIN_MODULES).toContain('src/cycles/overflow-compute.ts'); // R6 作用点必须在清单内
    expect(CHAIN_MODULES.length).toBeGreaterThanOrEqual(15);

    const hits: string[] = [];
    for (const relPath of CHAIN_MODULES) {
      const source = readSource(relPath);
      for (const { label, pattern } of EVOLUTION_PATTERNS) {
        for (const line of findNonCommentLines(source, pattern)) {
          hits.push(`${relPath}:${line} (${label})`);
        }
      }
    }
    expect(hits, `六段链模块不得 import/引用进化面（命中：${hits.join(' | ')}）`).toEqual([]);

    // 全 src/ 调用点：只允许进化引擎自身与唯一生产调用点 loop-handlers（loop-handlers.ts:23/426/437）
    const callSites: string[] = [];
    for (const file of walkFiles(join(WORKTREE_ROOT, 'src'))) {
      if (!file.endsWith('.ts')) continue;
      const relPath = relative(WORKTREE_ROOT, file);
      if (relPath === 'src/loops/middle-evolution-engine.ts' || relPath === 'src/agent/loop-handlers.ts') continue;
      const source = readFileSync(file, 'utf-8');
      if (findNonCommentLines(source, /\b(applyEvolutionActions|processFeedbackSignals)\b/).length > 0) {
        callSites.push(relPath);
      }
    }
    expect(callSites, `src/ 内不得有链外进化调用点（命中：${callSites.join(',')}）`).toEqual([]);

    // 链运行期间不调用：进化动作的**文件写面**零变化（运行期基线，非静态推断）
    const afterRun = snapshotPairs(snapshotWriteFaces());
    const beforeRun = snapshotPairs(extWriteFaceBaseline);
    expect(afterRun.length).toBeGreaterThan(0); // 基线非空（禁「看不见当没问题」）
    expect(afterRun).toEqual(beforeRun);

    console.log(
      `[SEG-6] scanned=${CHAIN_MODULES.length} importHits=${hits.length} srcCallSites=${callSites.length}`
      + ` writeFaceFiles=${afterRun.length} unchanged=${afterRun.length === beforeRun.length}`,
    );
    markSegment('6', `scanned=${CHAIN_MODULES.length} importHits=0 callSites=0 writeFace=${afterRun.length}`);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // §4.4（#719）：写④链只认 source_id；sink 行数=查询行数；R7 直写必红
  // ═════════════════════════════════════════════════════════════════════════

  it('§4.4 [SEG-4.4]：metric 行只认 source_id=SENTINEL-CASH-FLOW-v1（source_type 只辅助）＋ sink 行数=查询行数 ＋ R7 compute 直写必红', () => {
    expect(segmentMarks).toEqual(['1', '2', '3', '4', '5', '6']);
    const database = need(db, 'db');

    const rows = selectMetricRows(database, ORG, METRIC_IDS);
    expect(rows.length).toBe(sinkWriteCount); // 链内 sink 写入行数 = 查询行数（禁 SEED/漏写）
    expect(rows.length).toBe(7);
    expect(rows.every(row => row.source_id === SENTINEL_SOURCE_ID)).toBe(true);
    expect(sourceViolations(database, ORG, METRIC_IDS)).toEqual([]); // 只认 source_id（非 source_type）

    // ── R7：测试内直插 `source_type='compute'` ＋ `source_id='M9-DIRECT-WRITE'` ⇒ 守卫必须红 ──
    database.prepare(
      `INSERT INTO metric_readings
         (org_id, metric_id, entity_id, value, unit, observed_at, source_type, source_id, degraded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(ORG, 'CASH-FLOW-NET-MARGIN', '*', 1, 'ratio', '2000-01-01 00:00:00', 'compute', DIRECT_WRITE_SOURCE_ID);
    try {
      const violations = sourceViolations(database, ORG, METRIC_IDS);
      expect(violations.length).toBeGreaterThanOrEqual(1); // 守卫有牙：compute 直写不能冒充哨兵
      expect(violations.map(row => row.source_id)).toContain(DIRECT_WRITE_SOURCE_ID);
    } finally {
      // 断言后清理（本行只服务 R7；不参与任何其它判据）
      database.prepare('DELETE FROM metric_readings WHERE source_id = ?').run(DIRECT_WRITE_SOURCE_ID);
    }
    expect(sourceViolations(database, ORG, METRIC_IDS)).toEqual([]); // 清理后守卫复绿
    expect(selectMetricRows(database, ORG, METRIC_IDS).length).toBe(7);

    console.log(
      `[SEG-4.4] rows=${rows.length} sinkWrites=${sinkWriteCount} sourceId=${SENTINEL_SOURCE_ID}`
      + ` sourceTypes=${[...new Set(rows.map(row => row.source_type))].join(',')} r7=red-then-clean`,
    );
    markSegment('4.4', `rows=${rows.length} source_id=${SENTINEL_SOURCE_ID} r7=red`);
  });
});
