/**
 * tests/l4/decision-capture-single-entry.test.ts — K12-08 / #191 决策台账**单一入口**判据
 *
 * 判据来源（卡面 = 唯一判据源，逐字取）:
 *   `.claude/task-briefs/2026-10-11-...-191-...md` §Q3
 *   · V2 单一入口：全仓写台账路径**只有一条**（结构性反证：其它写入点 = 0）
 *   · V3 落账：一次产出＋复核 ⇒ 台账**一行**，含**五要素**（谁/岗位/什么上下文/产出什么/哪版预设）
 *   · V4 禁静默修改：人工修正**必须结构化落账**（反例：静默改正 ⇒ **必红**）
 *   · V5 回流：不合格记录 ⇒ 成为预设包**再生成输入**（跑一轮后预设包版本 **+1**）
 *   · V6 反例：摘掉 `conversation-engine` 的调用 ⇒ V3 **必红**
 *
 * 级别说明（判例 V-01 禁把 L1 报成 L2）:
 *   · V2 的 grep 反证 = [L1-静态可达]（只证"物理上只有一处写台账的字样"）
 *   · V3/V4/V5/V6 = [L2-真跑通]（真调用生产入口，读真实写入事件）
 * 判例 V-08（改坏即红）：V4/V6 各给一条**构造得出来**的反例，见文件末 §反例。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  captureDecision,
  DECISION_LEDGER_SCHEMA,
  type DecisionLedgerRow,
  type DecisionLedgerOptions,
  type DecisionResult,
} from '../../src/l4/decision-capture';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import type { LLMProvider, ChatResult, StreamCallback } from '../../src/providers/types';

// ══════════════════════════════════════════════════════════════════════════════
// 测试夹具（注入式：与生产件同一注入面，不 mock 管线 —— 铁律 12）
// ══════════════════════════════════════════════════════════════════════════════

interface Edge {
  type: string;
  from: string;
  to: string;
  weight?: number;
  props?: Record<string, unknown>;
  graph?: string;
}

/** 最小图存储：只实现生产件要用的两个原语，并把真实写入事件记下来 */
function makeStore(edges: Edge[], nodeExists = true) {
  return {
    queryNodes() {
      return nodeExists ? [{ id: 'rc-1' }] : [];
    },
    createEdge(
      type: string, from: string, to: string, weight?: number,
      props?: Record<string, unknown>, graph?: string,
    ) {
      edges.push({ type, from, to, weight, props, graph });
      return `edge-${edges.length}`;
    },
  };
}

/** 从真实写入事件里取出**台账行**（生产件把它放在 props.ledger，JSON 串） */
function rowOf(edge: Edge): DecisionLedgerRow {
  const raw = edge.props?.['ledger'];
  expect(typeof raw).toBe('string');
  return JSON.parse(String(raw)) as DecisionLedgerRow;
}

/** 假 provider —— 只为能在测试里构造真实 ConversationEngine（不 mock 引擎本身） */
function fakeProvider(): LLMProvider {
  return {
    name: 'fake-decision-ledger',
    baseUrl: 'fake://test',
    async chat(_msgs, _opts): Promise<ChatResult> {
      return { content: 'ok', model: 'fake' };
    },
    async stream(_msgs, cb: StreamCallback): Promise<void> {
      cb.onComplete?.({ content: 'ok', model: 'fake' });
    },
    async healthCheck() {
      return { healthy: true, latencyMs: 1 };
    },
    listModels() {
      return ['fake'];
    },
  };
}

/** 预设包端口（宿主注入面）：真值型实现 —— 跑一轮 ⇒ 版本 +1 */
function makePresetPack(initialVersion: number) {
  let version = initialVersion;
  const rounds: Array<readonly DecisionLedgerRow[]> = [];
  return {
    rounds,
    version: () => version,
    regenerateRound(inputs: readonly DecisionLedgerRow[]) {
      rounds.push(inputs);
      version += 1;
      return { version, consumed: inputs.map((r) => r.rowId) };
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// V2 · 单一入口（结构性反证：其它写入点 = 0）
// ══════════════════════════════════════════════════════════════════════════════

describe('V2 单一入口 — 全仓写台账路径只有一条', () => {
  it('Given 台账模块, When 枚举它的可调用导出, Then 只有 captureDecision 一个（模块内不存在第二条写路径）', async () => {
    const mod: Record<string, unknown> = await import('../../src/l4/decision-capture');
    const callables = Object.entries(mod)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);
    expect(callables).toEqual(['captureDecision']);
  });

  it('Given 全仓含根 src/scripts/extensions, When 扫台账 schema 锚点, Then 单一入口文件之外零命中（其它写入点 = 0）', () => {
    const repoRoot = process.cwd();
    const singleEntry = 'src/l4/decision-capture.ts';
    const hits: string[] = [];

    const walk = (relDir: string): void => {
      let entries: Array<{ name: string; isDirectory(): boolean }>;
      try {
        entries = readdirSync(join(repoRoot, relDir), { withFileTypes: true });
      } catch {
        return; // 目录不存在（如 extensions/ 缺失）⇒ 该根无命中，不是失败
      }
      for (const entry of entries) {
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          walk(rel);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|sh)$/.test(entry.name)) continue;
        const body = readFileSync(join(repoRoot, rel), 'utf8');
        if (body.includes(DECISION_LEDGER_SCHEMA)) hits.push(rel);
      }
    };

    for (const root of ['src', 'scripts', 'extensions']) walk(root);

    expect(hits).toEqual([singleEntry]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V3 · 落账（一次产出＋复核 ⇒ 一行，含五要素）
// ══════════════════════════════════════════════════════════════════════════════

describe('V3 落账 — 一次产出＋复核 ⇒ 台账一行含五要素', () => {
  it('Given 一次产出＋复核, When captureDecision, Then 恰好一行且五要素齐备', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1',
      userId: 'u-huang',
      action: 'confirmed',
      role: 'role-finance-lead',
      context: { cycleId: 'cyc-2026Q4', goalId: 'goal-margin', summary: 'Q4 毛利复盘' },
      output: { kind: 'report', ref: 'report-042', digest: 'digest-v1' },
      presetVersion: 7,
      review: { verdict: 'pass', by: 'u-ga', reason: '数字可回溯' },
    });

    expect(result.recorded).toBe(true);
    expect(edges).toHaveLength(1); // ← 「一行」（不是两行）

    const row = rowOf(edges[0]);
    expect(row.schema).toBe(DECISION_LEDGER_SCHEMA);
    expect(row.who).toBe('u-huang');                       // ① 谁
    expect(row.role).toBe('role-finance-lead');            // ② 岗位
    expect(row.context.cycleId).toBe('cyc-2026Q4');        // ③ 什么上下文
    expect(row.output.ref).toBe('report-042');             // ④ 产出什么
    expect(row.presetVersion).toBe(7);                     // ⑤ 哪版预设
    expect(row.review.verdict).toBe('pass');
    expect(row.gaps).toBeUndefined();                      // 五要素 + 复核齐 ⇒ 无缺口
    expect(result.row?.rowId).toBe(row.rowId);
  });

  it('Given 五要素缺项（旧调用形状）, When captureDecision, Then 不静默补齐 —— 缺口逐项进 row.gaps', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-legacy', action: 'confirmed', reason: '沿旧调用',
    });
    expect(result.recorded).toBe(true);
    const row = rowOf(edges[0]);
    expect(row.gaps).toEqual(['role', 'context', 'output', 'presetVersion', 'review']);
    expect(row.role).toBe('unknown');
  });

  it('Given 节点不存在, When captureDecision, Then 零写入且失败由返回值显式表达（不静默）', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges, false), 'org-9', {
      nodeId: 'rc-missing', userId: 'u-1', action: 'confirmed', reason: 'x',
    });
    expect(edges).toHaveLength(0);
    expect(result.recorded).toBe(false);
    expect(result.error).toContain('不存在');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V4 · 禁静默修改（反例：静默改正 ⇒ 必红）
// ══════════════════════════════════════════════════════════════════════════════

describe('V4 禁静默修改 — 人工修正必须结构化落账', () => {
  it('Given 结构化修正（correction ＋ reason）, When captureDecision, Then 落账一行并指回被修正行（只追加不覆盖）', () => {
    const edges: Edge[] = [];
    const store = makeStore(edges);
    const first = captureDecision(store, 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'confirmed',
      output: { kind: 'report', ref: 'report-7', digest: 'd1' },
      presetVersion: 3,
      review: { verdict: 'pass' },
    });
    expect(first.recorded).toBe(true);

    const second = captureDecision(store, 'org-9', {
      nodeId: 'rc-1', userId: 'u-boss', action: 'modified',
      output: { kind: 'report', ref: 'report-7', digest: 'd2' },
      presetVersion: 3,
      reason: '金额口径与财务口径不符',
      correction: { field: 'digest', from: 'd1', to: 'd2', reason: '金额口径对齐' },
      review: { verdict: 'pass', by: 'u-ga' },
    });

    expect(second.recorded).toBe(true);
    expect(edges).toHaveLength(2);                       // 只追加：旧行不覆盖
    const rows = edges.map(rowOf);
    expect(rows[1].kind).toBe('correction');
    expect(rows[1].correctsRowId).toBe(rows[0].rowId);   // 修正留痕可回放
    expect(rows[1].correction?.field).toBe('digest');
  });

  // ── 反例①（判例 V-08 改坏即红）：以"修正"名义落账却无结构化声明 ⇒ 必红 ──
  it('反例①：Given action=modified 但无 correction/modifiedProps, When captureDecision, Then 拒绝落账（SILENT_MODIFICATION）', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-boss', action: 'modified',
      output: { kind: 'report', ref: 'report-8', digest: 'd9' },
      presetVersion: 3,
    });
    expect(result.recorded).toBe(false);                 // ← 必红
    expect(result.silentModification).toBe(true);
    expect(result.error).toContain('SILENT_MODIFICATION');
    expect(edges).toHaveLength(0);                       // 静默改不动台账
  });

  // ── 反例②（判例 V-08 改坏即红）：同一产出换内容指纹却没声明修正 ⇒ 必红 ──
  it('反例②：Given 同一产出的 digest 变了但没声明修正, When captureDecision, Then 拒绝落账（禁静默改写）', () => {
    const edges: Edge[] = [];
    const store = makeStore(edges);
    const first = captureDecision(store, 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'confirmed',
      output: { kind: 'report', ref: 'report-9', digest: 'd1' },
      presetVersion: 3, review: { verdict: 'pass' },
    });
    expect(first.recorded).toBe(true);

    const silent = captureDecision(store, 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'confirmed',   // ← 没声明是修正
      output: { kind: 'report', ref: 'report-9', digest: 'd2' },  // ← 内容变了
      presetVersion: 3, review: { verdict: 'pass' },
    });

    expect(silent.recorded).toBe(false);                 // ← 必红
    expect(silent.silentModification).toBe(true);
    expect(edges).toHaveLength(1);                       // 只有第一次那一行
  });

  it('Given 台账回读面注入（跨进程视图）, When 同一产出换指纹, Then 判静默修改且 priorSource=store', () => {
    const edges: Edge[] = [];
    const priorRows: DecisionLedgerRow[] = [{
      schema: DECISION_LEDGER_SCHEMA, rowId: 'row-prior', who: 'u-1', role: 'r1',
      context: { orgId: 'org-9', summary: 's' },
      output: { kind: 'report', ref: 'report-x', digest: 'd1' },
      presetVersion: 3, review: { verdict: 'pass', by: 'u-1', reason: '', at: '2026-10-11T00:00:00.000Z' },
      kind: 'production', fingerprint: 'report::report-x::d1', at: '2026-10-11T00:00:00.000Z',
    }];
    const options: DecisionLedgerOptions = { readPriorRows: (ref) => (ref === 'report-x' ? priorRows : []) };
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-2', action: 'confirmed',
      output: { kind: 'report', ref: 'report-x', digest: 'd2' },
      presetVersion: 3, review: { verdict: 'pass' },
    }, options);

    expect(result.recorded).toBe(false);
    expect(result.priorSource).toBe('store');
    expect(edges).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V5 · 回流（不合格 ⇒ 预设包再生成输入；跑一轮 ⇒ 版本 +1）
// ══════════════════════════════════════════════════════════════════════════════

describe('V5 回流 — 不合格记录 ⇒ 预设包再生成输入', () => {
  it('Given 预设包 v3 且注入再生成端口, When 记一条不合格, Then 跑一轮 ⇒ 版本 3→4 且该行成为输入', () => {
    const edges: Edge[] = [];
    const pack = makePresetPack(3);
    const before = pack.version();

    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', role: 'role-ops', action: 'confirmed',
      output: { kind: 'report', ref: 'report-fail', digest: 'd1' },
      presetVersion: before,
      review: { verdict: 'fail', by: 'u-ga', reason: '口语化程度不达标' },
    }, { presetPack: pack });

    const after = pack.version();
    expect(before).toBe(3);
    expect(after).toBe(before + 1);                      // ← 版本 +1
    expect(result.reflowed).toBe(true);
    expect(result.presetVersion).toBe(after);

    const row = rowOf(edges[0]);
    expect(row.reflow?.input).toBe(true);                // ← 该行 = 再生成输入
    expect(row.reflow?.nextPresetVersion).toBe(after);
    expect(pack.rounds).toHaveLength(1);
    expect(pack.rounds[0][0].rowId).toBe(row.rowId);     // 输入就是这一行（真喂进去了）
  });

  it('Given 合格记录, When captureDecision, Then 不触发回流（版本不变、无 reflow 留痕）', () => {
    const edges: Edge[] = [];
    const pack = makePresetPack(5);
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'confirmed',
      output: { kind: 'report', ref: 'report-pass', digest: 'd1' },
      presetVersion: 5,
      review: { verdict: 'pass' },
    }, { presetPack: pack });

    expect(result.reflowed).toBeUndefined();
    expect(pack.version()).toBe(5);
    expect(pack.rounds).toHaveLength(0);
    expect(rowOf(edges[0]).reflow).toBeUndefined();
  });

  it('Given 未注入再生成端口, When 记不合格, Then 只标记"回流输入"且不假称跑过轮（显式降级）', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'rejected',
      output: { kind: 'report', ref: 'report-fail-2', digest: 'd1' },
      presetVersion: 2, reason: '不是主因',
    });
    expect(result.recorded).toBe(true);
    expect(result.reflowed).toBeUndefined();             // 不假称跑过轮
    expect(rowOf(edges[0]).reflow?.input).toBe(true);    // 但它是再生成输入
    expect(rowOf(edges[0]).reflow?.nextPresetVersion).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V6 · 反例（硬要求）：摘掉 conversation-engine 的调用 ⇒ V3 必红
// ══════════════════════════════════════════════════════════════════════════════

describe('V6 conversation-engine 接缝 — 摘掉调用 ⇒ V3 必红', () => {
  const decision = {
    nodeId: 'rc-1', userId: 'u-1', action: 'confirmed' as const,
    output: { kind: 'report', ref: 'report-engine', digest: 'd1' },
    presetVersion: 4, review: { verdict: 'pass' as const },
  };

  it('Given 接缝已装配（onDecision → 单一入口）, When engine.recordDecision, Then 台账真被写一行（V3 经生产接缝成立）', async () => {
    const edges: Edge[] = [];
    const store = makeStore(edges);
    const engine = new ConversationEngine(fakeProvider(), {
      orgId: 'org-9',
      fallbackProvider: null,
      onDecision: async (d): Promise<DecisionResult> => captureDecision(store, 'org-9', d),
    });

    const result = await engine.recordDecision(decision);

    expect(result.recorded).toBe(true);
    expect(edges).toHaveLength(1);
    expect(rowOf(edges[0]).output.ref).toBe('report-engine');
  });

  it('反例③（摘掉调用 ⇒ V3 必红）：Given 接缝未装配, When engine.recordDecision, Then 零写入且显式失败', async () => {
    const edges: Edge[] = [];
    const engine = new ConversationEngine(fakeProvider(), { orgId: 'org-9', fallbackProvider: null });

    const result = await engine.recordDecision(decision);

    expect(edges).toHaveLength(0);                       // ← 台账一行也没有（V3 必红）
    expect(result.recorded).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 降级路径（铁律 24/31：catch 必须 log ＋ degraded ＋ 错误进数组）
// ══════════════════════════════════════════════════════════════════════════════

describe('降级不静默（铁律 24/31）', () => {
  it('Given 图存储写边抛错, When captureDecision, Then degraded=true ＋ 错误进 errors[] ＋ 不抛', () => {
    const boom = {
      queryNodes() { return [{ id: 'rc-1' }]; },
      createEdge() { throw new Error('sqlite busy'); },
    };
    const result = captureDecision(boom, 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'confirmed', reason: 'x',
    });
    expect(result.recorded).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.errors).toEqual(['sqlite busy']);
  });

  it('Given 再生成端口抛错, When captureDecision, Then 显式降级（degraded ＋ 错误进数组，不静默吞）', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: 'rc-1', userId: 'u-1', action: 'rejected',
      output: { kind: 'report', ref: 'report-boom', digest: 'd1' },
      presetVersion: 1,
    }, {
      presetPack: {
        version: () => 1,
        regenerateRound() { throw new Error('preset pack write failed'); },
      },
    });
    expect(result.recorded).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.errors?.some((e) => e.includes('preset pack write failed'))).toBe(true);
  });

  it('Given 非法输入形状（空 nodeId）, When captureDecision, Then 显式失败不抛（探针多形状驱动面）', () => {
    const edges: Edge[] = [];
    const result = captureDecision(makeStore(edges), 'org-9', {
      nodeId: '', userId: 'u-1', action: 'confirmed',
    });
    expect(result.recorded).toBe(false);
    expect(result.error).toContain('INVALID_INPUT');
    expect(edges).toHaveLength(0);
  });
});
