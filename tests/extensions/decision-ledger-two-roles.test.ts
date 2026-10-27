/**
 * tests/extensions/decision-ledger-two-roles.test.ts — #734 反馈一致：两岗位同一 ledger 两条 ＋ 旁路必红
 *
 * 依据锚（read 过，禁凭记忆）:
 *   · dev doc《2026-10-27-devdoc-825-M7生产消费链接线》§4.1 #734 行
 *     （`captureDecision` :326，唯一写入点 :429；读回经 `decision-ledger-readback`）／§7 第 6 条（Q-15 诊断义务）
 *   · 规格《2026-10-27-规格-825-M7前置缺口补齐》§4.1 #734 行 ／ E16（两断面：成功断面只证"装配口在"，**
 *     不证落账** ⇒ 落账与否以判据真跑为准）
 *   · 域守则 `tests/control-tower/AGENTS.md`（测试必须有 expect 断言／命名铁律 33／WIRE CHECK）
 *
 * 判据三路径（全部穿生产链，不造替身）:
 *   正常 —— 两岗位各一次决策留痕：
 *     生产装配口 `createDecisionCapturePort`（src/deploy/bootstrap.ts，全仓唯一 `captureDecision(` 装配点）
 *     → L2 进程级接缝 `getDecisionRecordingSeam()`（`src/server.ts:417` 同款注册形态）
 *     → L4 唯一写入点 `captureDecision` → 真 `SqliteGraphStore`（临时库，mkdtemp）。
 *     读回：`getDecisionLedgerReader()`（`bootstrap.ts:759` 注册的读回端口 = `routes/sentinel.ts:257` 的同一消费符号）
 *     ⇒ **同一** ledger 读到**两条**，来源（role／org／source）可区分。
 *   反向 —— 未装配（写口/读口两侧）⇒ 明确可见（`undefined`／`ok:false`＋`errors`），不静默；
 *     非法输入 ⇒ `recorded:false`＋`INVALID_INPUT`，且台账零行。
 *   反例 —— 旁路写**第二个**账本 ⇒ "回同一处"断言 `assertSingleLedger` **必红**（本文件以 `toThrow` 固化；
 *     另有"只该有一条时不该红"的反证，防断言恒红）。
 *
 * 「来源（source）」口径（本文件显式定义，避免含糊）：台账行的**写入来源** = schema 锚
 *   `DECISION_LEDGER_SCHEMA`（`'decision-ledger/v1'`，单一写入口的反证锚点）＋ 边类型（∈ `DECISION_EDGE_TYPES`）。
 *   ⇒ 「回同一处」= 两条行 schema／边类型同源 ＋ 同 org（graph）；「可区分」= role／who／output.ref／
 *   rowId／edgeId 逐条不同。
 *
 * 设计哲学（一句）：一致性 ≠ 两条记录长得一样，而是**两条记录能被对到同一处** —— 所以判据落在
 *   「同一处」（同库同表同 schema 锚）与「来源可区分」两个面，而不是要求两条内容相同。
 *
 * 已知限制:
 *   ① 未在本测试内跑 HTTP 段（不经 `createServer()`＋JWT 打 `/api/sentinel/tickets/:id/transition`）：
 *      写侧用 L1→L2 接缝 `getDecisionRecordingSeam()`、读侧用 L2→L4 出口 `getDecisionLedgerReader()`
 *      —— 与路由**同一消费符号**，其下实现即生产实现；HTTP 段需 jwt 中间件＋`sentinel_tickets` 种子
 *      （属 #712／#731 卡面），本卡写集只有本文件。
 *   ② 决策台账写/读面**没有 dryRun 开关**（`grep -rn dryRun src/l4/decision-capture.ts
 *      src/l4/decision-ledger-readback.ts` ⇒ 0 命中）⇒ "反向"面以「未装配 ＋ 非法输入」表达"明确可见"，
 *      不假装存在 dry-run 形态。
 *   ③ 图节点存在性判据走 `queryNodes(type,{id})` = `json_extract(props,'$.id')`
 *      （`src/adapters/sqlite-graph-store.ts:queryNodes`）⇒ 种子节点必须带 **props.id**；本测试用
 *      生产写 API（`createNode` ＋ `updateNode`）显式种出（不直插表）。
 *   ④ 文件命名按派单钉死为 `*.test.ts`；铁律 33 严格口径（真 SQLite ⇒ `*.integration.test.ts`）未擅改
 *      （改名＝扩写集／改判据 ⇒ 须回 L1）。
 *   ⑤ 进程级读回接缝**无注销 API**（`setDecisionLedgerReader` 只有注册方向）⇒ 本文件"未注册"断言
 *      放在首个用例（此前无任何注册），不伪造复位能力。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { NodeType } from '@synova/ontology';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createDecisionCapturePort, createDecisionLedgerReaderPort } from '../../src/deploy/bootstrap';
import { setDecisionRecordingSeam, getDecisionRecordingSeam } from '../../src/agent/conversation-engine';
import {
  setDecisionLedgerReader,
  getDecisionLedgerReader,
  listDecisionRows,
  type DecisionLedgerEntry,
} from '../../src/l4/decision-ledger-readback';
import {
  captureDecision,
  DECISION_EDGE_TYPES,
  DECISION_LEDGER_SCHEMA,
  type DecisionInput,
  type DecisionResult,
} from '../../src/l4/decision-capture';

/** 组织（= 图名 graph）—— 两岗位的决策必须落在同一台账、同一 org */
const ORG = 'org-pr7-acme';
/** 两岗位：取内容面**实物**角色包 id（extensions/presets/roles/<id>/ 在库） */
const ROLES = ['finance', 'hr'] as const;
/** 决策边类型（唯一写入点写的就是它；取自 L4 契约，不在本文件另立口径） */
const DECISION_CONFIRMED = 'DECISION_CONFIRMED';
const EDGE_TYPES: readonly string[] = DECISION_EDGE_TYPES;

interface LedgerHandle {
  dir: string;
  path: string;
  db: Database.Database;
  store: SqliteGraphStore;
}

/** 开一本**临时**台账（mkdtemp；禁写主树 data/） */
function openLedger(label: string): LedgerHandle {
  const dir = mkdtempSync(join(tmpdir(), `pr7-ledger-${label}-`));
  const path = join(dir, 'ledger.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  const store = new SqliteGraphStore(db);
  return { dir, path, db, store };
}

function closeLedger(handle: LedgerHandle): void {
  try {
    handle.db.close();
  } finally {
    rmSync(handle.dir, { recursive: true, force: true });
  }
}

/**
 * 用**生产写 API**种一个哨兵信号节点，返回节点 id（= 决策对象）。
 * props.id 必须写回：`captureDecision` 的节点存在性判据是 `queryNodes(type,{id})`
 * （`json_extract(props,'$.id')`），只写行 id 列是查不到的（实测，见文件头已知限制 ③）。
 */
function seedSignalNode(store: SqliteGraphStore, org: string, name: string): string {
  const nodeId = store.createNode(NodeType.OUTCOME_RISK, { name }, org);
  store.updateNode(nodeId, { id: nodeId }, org);
  const found = store.queryNodes(NodeType.OUTCOME_RISK, { id: nodeId }, org);
  if (found.length !== 1) {
    throw new Error(`SEED_FAILED: 节点 ${nodeId} 在 ${org} 上按 props.id 查得 ${found.length} 条（期望 1）`);
  }
  return nodeId;
}

/**
 * 生产装配（与 `src/deploy/bootstrap.ts:757-761` ＋ `src/server.ts:417-420` 同款）：
 * 写口 = `createDecisionCapturePort`（唯一 captureDecision 装配点）＋ 进程级接缝注册；
 * 读口 = `createDecisionLedgerReaderPort` ＋ 注册进程级读回接缝。
 */
function wireProductionAssembly(store: unknown, org: string): {
  capture: ReturnType<typeof createDecisionCapturePort>;
  reader: ReturnType<typeof createDecisionLedgerReaderPort>;
} {
  const capture = createDecisionCapturePort(store, org);
  const reader = createDecisionLedgerReaderPort(store, org);
  if (reader !== undefined) setDecisionLedgerReader(reader);
  if (capture !== undefined) {
    // server.ts:417 同款适配器：只转发到同一回调工厂，不新建引擎
    setDecisionRecordingSeam({ recordDecision: (decision) => capture(org)(decision) });
  }
  return { capture, reader };
}

/** 一次决策留痕的入参（两岗位除 role／who／产出引用外同形 —— 差异只由岗位决定） */
function decisionFor(role: string, nodeId: string, org: string): DecisionInput {
  return {
    nodeId,
    userId: `user-${role}`,
    action: 'confirmed',
    role,
    reason: `#734 两岗位一致性判据：${role} 岗位裁决`,
    context: {
      orgId: org,
      taskRef: `ticket-${role}`,
      summary: `工单 ${role} 关闭为 resolved（哨兵信号 ${nodeId}，人工裁决）`,
    },
    output: { kind: 'ticket-resolution', ref: `ticket-${role}`, digest: `ticket-${role}@pr7` },
    presetVersion: 1,
    review: { verdict: 'pass', by: `user-${role}`, reason: '人工裁决' },
  };
}

/** 经 L1→L2 生产接缝落账（未装配 ⇒ 抛，不静默跳过） */
async function recordViaSeam(decision: DecisionInput): Promise<DecisionResult> {
  const seam = getDecisionRecordingSeam();
  if (seam === null) {
    throw new Error('SEAM_NOT_WIRED: 进程级决策落账接缝未注册（routes/sentinel.ts 同款消费符号拿到 null）');
  }
  return seam.recordDecision(decision);
}

/** 经生产读回端口读回（未装配 ⇒ 抛，不静默返回空） */
function readBack(org: string): DecisionLedgerEntry[] {
  const reader = getDecisionLedgerReader();
  if (reader === null) {
    throw new Error('LEDGER_READER_NOT_WIRED: 决策台账读回端口未装配（路由侧 503 的同一分支）');
  }
  const result = reader(org)({});
  expect(result.ok).toBe(true);
  expect(result.errors).toBeUndefined();
  return result.entries;
}

/** 物理旁证（**不是读回替代**）：同一张 `graph_triples` 表里本 org 的决策边条数 */
function ledgerEdgeCount(handle: LedgerHandle, org: string): number {
  const row = handle.db
    .prepare(
      `SELECT COUNT(*) AS c FROM graph_triples
        WHERE graph = ? AND predicate = ? AND valid_to IS NULL`,
    )
    .get(org, DECISION_CONFIRMED) as { c: number };
  return row.c;
}

/**
 * 「回同一处」断言 —— 本卡的判据本体。
 * @input entries 生产读回端口返回的行；roles 期望的岗位集合；org 期望的台账归属（graph）
 * @throws BACK-LEDGER/COUNT|ROLE|SOURCE|ORG|DUP —— 任一条不成立即抛（旁路第二账本 ⇒ COUNT 必抛）
 */
function assertSingleLedger(
  entries: readonly DecisionLedgerEntry[],
  roles: readonly string[],
  org: string,
): void {
  if (entries.length !== roles.length) {
    throw new Error(
      `BACK-LEDGER/COUNT: 期望同一台账 ${roles.length} 条（${roles.join(',')}），实得 ${entries.length} 条 ⇒ 不是"回同一处"`,
    );
  }
  const roleSet = new Set(entries.map((e) => e.row.role));
  for (const role of roles) {
    if (!roleSet.has(role)) {
      throw new Error(`BACK-LEDGER/ROLE: 读回缺岗位 ${role}（实得 ${[...roleSet].join(',')}）`);
    }
  }
  for (const entry of entries) {
    if (entry.row.schema !== DECISION_LEDGER_SCHEMA) {
      throw new Error(
        `BACK-LEDGER/SOURCE: 行 ${entry.edgeId} 的 schema=${entry.row.schema} ≠ ${DECISION_LEDGER_SCHEMA}`
          + ' ⇒ 该行不来自唯一写入口',
      );
    }
    if (!EDGE_TYPES.includes(entry.edgeType)) {
      throw new Error(`BACK-LEDGER/SOURCE: 边类型 ${entry.edgeType} 不在决策边全集 [${EDGE_TYPES.join(',')}]`);
    }
    if (entry.row.context.orgId !== org) {
      throw new Error(
        `BACK-LEDGER/ORG: 行 ${entry.edgeId} 的 orgId=${String(entry.row.context.orgId)} ≠ ${org} ⇒ 不属同一台账`,
      );
    }
  }
  // 可区分：五条身份维度两两不同（同一条被读回两次也算不成立）
  const identities: Array<[string, (e: DecisionLedgerEntry) => string]> = [
    ['rowId', (e) => e.row.rowId],
    ['edgeId', (e) => e.edgeId],
    ['who', (e) => e.row.who],
    ['role', (e) => e.row.role],
    ['output.ref', (e) => e.row.output.ref],
  ];
  for (const [label, pick] of identities) {
    const seen = entries.map(pick);
    if (new Set(seen).size !== seen.length) {
      throw new Error(`BACK-LEDGER/DUP: 维度 ${label} 在两条读回行上重复（${seen.join(' | ')}）`);
    }
  }
}

describe('#734 两岗位反馈一致（同一 ledger 两条 ＋ 旁路必红）', () => {
  let ledger: LedgerHandle;
  let nodeId: string;

  beforeEach(() => {
    ledger = openLedger('main');
    nodeId = seedSignalNode(ledger.store, ORG, '信号-738-甲');
  });

  afterEach(() => {
    setDecisionRecordingSeam(null);
    closeLedger(ledger);
  });

  it('反向：未装配 ⇒ 明确可见（不静默）', () => {
    // ① 读口注册态：本文件此前从未注册 ⇒ 消费方拿到 null（routes/sentinel.ts:258-262 的 503 分支）
    expect(getDecisionLedgerReader()).toBeNull();
    // ② 读口工厂：store 无 queryEdges ⇒ 拒绝构造（bootstrap.ts:193-200）⇒ 不注册接缝
    expect(createDecisionLedgerReaderPort({ queryNodes: () => [] }, ORG)).toBeUndefined();
    // ③ 写口工厂：store 缺 queryNodes/createEdge ⇒ 拒绝构造（bootstrap.ts:150-166）⇒ 引擎回落既有失败
    expect(createDecisionCapturePort({}, ORG)).toBeUndefined();
    // ④ 未注册接缝 ⇒ 消费符号拿到 null（不静默假装落账）
    setDecisionRecordingSeam(null);
    expect(getDecisionRecordingSeam()).toBeNull();
    // ⑤ 读回模块自身：坏 store ⇒ ok:false ＋ errors 在场（禁"静默返回空数组"冒充"没人裁过"）
    const degraded = listDecisionRows({ queryNodes: () => [] }, {}, ORG);
    expect(degraded.ok).toBe(false);
    expect(degraded.entries).toHaveLength(0);
    expect(degraded.errors?.[0] ?? '').toContain('READ_PRIMITIVE_MISSING');
  });

  it('正常：两岗位各一次决策留痕 ⇒ 同一 ledger 读到两条，来源（role／org／source）可区分', async () => {
    const { capture } = wireProductionAssembly(ledger.store, ORG);
    expect(capture).not.toBeUndefined();

    const [roleA, roleB] = ROLES;
    const resA = await recordViaSeam(decisionFor(roleA, nodeId, ORG));
    const resB = await recordViaSeam(decisionFor(roleB, nodeId, ORG));
    // Q-15：真落账 —— 只认"写进去了"，不认"装配口存在"
    expect(resA.recorded).toBe(true);
    expect(resB.recorded).toBe(true);
    expect(resA.edgeType).toBe(DECISION_CONFIRMED);
    expect(resB.edgeType).toBe(DECISION_CONFIRMED);

    const entries = readBack(ORG);
    assertSingleLedger(entries, ROLES, ORG); // 判据本体：同一处 ＋ 可区分（不成立即抛）

    const entryA = entries.find((e) => e.row.role === roleA);
    const entryB = entries.find((e) => e.row.role === roleB);
    if (entryA === undefined || entryB === undefined) {
      throw new Error(`READBACK_ROLE_MISSING: 读回缺 ${roleA} 或 ${roleB}（实得 ${entries.map((e) => e.row.role).join(',')}）`);
    }
    // 来源维度逐条对账（role／org／source）
    expect(entryA.row.context.orgId).toBe(ORG);
    expect(entryB.row.context.orgId).toBe(ORG);
    expect(entryA.row.schema).toBe(DECISION_LEDGER_SCHEMA); // source 锚：两条同源（同一唯一写入点）
    expect(entryB.row.schema).toBe(DECISION_LEDGER_SCHEMA);
    expect(entryA.edgeType).toBe(entryB.edgeType); // 同一来源 ⇒ 同类决策边
    expect(entryA.row.output.ref).toBe(`ticket-${roleA}`);
    expect(entryB.row.output.ref).toBe(`ticket-${roleB}`);
    expect(entryA.row.who).toBe(`user-${roleA}`);
    expect(entryB.row.who).toBe(`user-${roleB}`);
    // 三来源维度拼起来的身份：两条不等（role 区分；org／source 同源）
    const dims = entries.map((e) => `${e.row.role}|${String(e.row.context.orgId)}|${e.row.schema}`);
    expect(new Set(dims).size).toBe(ROLES.length);
    // 物理旁证（非读回替代）：**同一张** graph_triples 表里两条决策边
    expect(ledgerEdgeCount(ledger, ORG)).toBe(ROLES.length);
  });

  it('反例：旁路写第二个账本 ⇒ "回同一处"断言必红', async () => {
    wireProductionAssembly(ledger.store, ORG);
    const [roleA, roleB] = ROLES;
    const main = await recordViaSeam(decisionFor(roleA, nodeId, ORG));
    expect(main.recorded).toBe(true);

    // 旁路：另开一本台账（第二个库），**不经生产装配**，直接调唯一写入口写进去
    const bypass = openLedger('bypass');
    try {
      const bypassNode = seedSignalNode(bypass.store, ORG, '信号-738-乙');
      const bypassed = captureDecision(bypass.store, ORG, decisionFor(roleB, bypassNode, ORG));
      expect(bypassed.recorded).toBe(true); // 旁路能写成功 —— 所以必须靠"回同一处"抓它

      const entries = readBack(ORG);
      // 生产读回只见到 1 条（第二账本对它不可见）⇒ "两条同一处"不成立
      expect(entries).toHaveLength(1);
      expect(entries[0].row.role).toBe(roleA);
      // ① 判据本体必红
      expect(() => assertSingleLedger(entries, ROLES, ORG)).toThrow(/BACK-LEDGER\/COUNT/);
      // ② 反证：断言不是"恒红"—— 只该有一条且预期一条时不抛
      expect(() => assertSingleLedger(entries, [roleA], ORG)).not.toThrow();
      // ③ 物理上分处两库：主账本 1 条、旁路账本 1 条
      expect(ledgerEdgeCount(ledger, ORG)).toBe(1);
      expect(ledgerEdgeCount(bypass, ORG)).toBe(1);
    } finally {
      closeLedger(bypass);
    }
  });

  it('来源维度 org 可分辨：同库不同 org ⇒ 本 org 读回只见本 org 的行（不串台）', async () => {
    const otherOrg = 'org-pr7-globex';
    const otherNode = seedSignalNode(ledger.store, otherOrg, '信号-738-丙');
    const { capture } = wireProductionAssembly(ledger.store, ORG);
    if (capture === undefined) throw new Error('CAPTURE_PORT_NOT_WIRED: 装配口未构造');

    const [roleA, roleB] = ROLES;
    expect((await recordViaSeam(decisionFor(roleA, nodeId, ORG))).recorded).toBe(true);
    // 同库另一 org：经装配回调显式传 graph（`createDecisionCapturePort(store, defaultGraph)` 的 graph 形参）
    const other = await capture(otherOrg)(decisionFor(roleB, otherNode, otherOrg));
    expect(other.recorded).toBe(true);

    const mine = readBack(ORG);
    expect(mine).toHaveLength(1);
    expect(mine[0].row.role).toBe(roleA);
    expect(mine[0].row.context.orgId).toBe(ORG);
    expect(() => assertSingleLedger(mine, ROLES, ORG)).toThrow(/BACK-LEDGER\/COUNT/);

    const theirs = readBack(otherOrg);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].row.role).toBe(roleB);
    expect(theirs[0].row.context.orgId).toBe(otherOrg);
    // 两本 org 视图合起来才是同库两条
    expect(ledgerEdgeCount(ledger, ORG) + ledgerEdgeCount(ledger, otherOrg)).toBe(ROLES.length);
  });

  it('反向：非法输入／不存在的节点 ⇒ recorded:false 显式（不静默落账）', async () => {
    wireProductionAssembly(ledger.store, ORG);
    const seam = getDecisionRecordingSeam();
    if (seam === null) throw new Error('SEAM_NOT_WIRED: 未注册');

    // ① 形状不合法（缺 userId）
    const bad = await seam.recordDecision({ nodeId, userId: '', action: 'confirmed' });
    expect(bad.recorded).toBe(false);
    expect(bad.error ?? '').toContain('INVALID_INPUT');
    expect(bad.degraded).toBe(true);
    expect(bad.errors ?? []).not.toHaveLength(0);

    // ② 决策对象不存在（存在性闸：不落账，原因点名）
    const ghost = await seam.recordDecision(decisionFor(ROLES[0], 'node-does-not-exist', ORG));
    expect(ghost.recorded).toBe(false);
    expect(ghost.error ?? '').toContain('不存在');

    // 两次失败都不得留下台账行（"没落账"必须真的没落，而不是抛了却写了半条）
    expect(ledgerEdgeCount(ledger, ORG)).toBe(0);
    expect(readBack(ORG)).toHaveLength(0);
  });
});
