/**
 * tests/l4/ontology-loader-param-bridge-1031.test.ts
 *
 * 卡 #1031 —— W2 前置：参数从类型层到实例层的桥（CTO 乙案口径）
 *
 * 判据（乙案改后）：
 *   V1 注入存在且可判（**断言值**，不是断言"存在"）
 *   V2 同一 weight / 同一 edgeType，注入前 vs 注入后，transfer_function / causal_strength
 *      **值必须不同且正确**，且差值**只来自参数**（防时钟/顺序噪声 ⇒ 纯函数 + 非参数键不变 + 确定性）
 *   V3 降级可见：无该字段 / 占位串 / 仅声明 ⇒ 走降级路径**且有 log**（不静默）
 *   V4 改坏即红（判别性夹具：拆掉注入 ⇒ V1/V2 必红；复原 ⇒ 必绿 —— 见交付件 §V4 原始输出）
 *   V5 L1≠L2：本文件**真跑**（import 后执行），非 grep/静态可达
 *
 * 🔴 乙案降档声明：原判据②要求「DirectionMonitor 输出必须不同」，本卡改为「注入面 props 值必须不同」
 *    ⇒ 覆盖「参数落到哪」，**不覆盖**「参数改变下游计算」。本文件**不宣称**下游输出已改变。
 *
 * ═══ K4-02 批 2（2026-10-11）棘轮上移 + 两笔账机器化 ═══
 * as_of `local-main = dc5ce093`（本席实测）：`edge-types/` = **56 件**（第 56 件 `goal_decomposition.json`，
 * 由 local-main `18ed356f feat(k12-07): 目标一致…` 引入）⇒ V5 的**件数与 tally 上移**（见 `BASELINE_*`）。
 * 🔴 **两笔账（CTO 甲裁定）改为机器可判**：4 项未交（① direction-monitor 读取面 ② 生产可见效果
 * ③ `causal_strength` 数值注入 ④ 脚本级 schema 门禁 📌实施席实测补记）由 `LEDGER` 常量声明，
 * 并以**真仓** `cs_resolved === 0` 断言承载 ③；**未交项落地者必须显式翻转常量**（从而被迫更新两笔账）。
 *
 * 日志断言手法：`vi.mock('@synova/logger')` **运行时捕获调用**（非 grep 静态判据）。
 * 同仓库既有手法参照 tests/l4/delivery-queue.test.ts:10-13。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const logCalls = vi.hoisted(() => [] as { level: string; meta?: unknown; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: unknown, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug'), fatal: make('fatal') };
  return { logger: m, createLogger: () => m };
});

import {
  loadOntology,
  getTypesByTags,
  validateEdgeEndpoints,
  clearOntologyCache,
  readEdgeTypeParams,
  getEdgeTypeParams,
  applyEdgeTypeParams,
  EDGE_PARAM_KEYS,
  type EdgeTypeDef,
} from '../../src/l4/ontology-loader';

// ═══ 夹具（mock 定义，**不落仓库内容**；进 JSON 的只有 edges 类型）══════════════

/** 实测占位串原文（52/55 的 transfer_function 就是这个） */
const PLACEHOLDER_TBD = 'TBD — to be defined in compute phase';
/** 实测声明串原文（55/55 的 causal_strength 就是这个） */
const DECLARATION_CS = 'number (0-1) — 因果强度（0=无因果传导，1=完全传导）';
/** 实测散文公式原文（3/55 之一） */
const PROSE_FORMULA = 'unit_cost_t = unit_cost_t0 * (cumulative_output)^(-learning_rate)';

const TF_NUMBER = 0.42;
const TF_PARAM = { param: 0.55 };
const TF_REF = { ref: 'computeRevenueLift' };
const CS_NUMBER = 0.73;

/**
 * 让「非 transfer_function 的两条」都处于 resolved 态的伴生字段
 * ⇒ 断言 `degraded===false` 时不会被 action_effect_lag 缺失污染。
 */
const RESOLVED_SIDECARS: Pick<EdgeTypeDef, 'optionalProps' | 'action_effect_lag'> = {
  optionalProps: { causal_strength: CS_NUMBER },
  action_effect_lag: 'immediate',
};

function makeDef(over: Partial<EdgeTypeDef> = {}): EdgeTypeDef {
  return {
    $id: 'edge/test-fixture-1031',
    label: 'TEST_FIXTURE_1031',
    tags: ['causal'],
    allowedFrom: ['resource/money'],
    allowedTo: ['activity/production'],
    description: '测试夹具（非仓库内容）',
    ...over,
  };
}

const warnCount = () => logCalls.filter(c => c.level === 'warn').length;

// ═══ 真仓棘轮（件数由**单一真源清单**推导；分类计数由**入册增量**推导）═══════════════
// 🔴 N2（CTO 2026-10-12）：「禁硬编码基数」。本文件的 `BASELINE_*` 已改为**推导式**：
//   · 件数 = `SPEC_EDGE_TYPES`（探针内**逐件枚举**的唯一真源清单）∪ **在场**的 PENDING 预告件
//     —— **不写字面 56/58**：`l3-65`（#65）新增 2 边合入后自动由 56 → 58，无需手改本文件；
//   · 分类计数 = 各状态的**入册期望增量**从 0 起累加 —— `SPEC` 内件的**逐件真实分类**仍由
//     下面 `tally` 的 `expect(tally).toEqual(BASELINE_TALLY)` 以外的方式守住（见 §N2 集合棘轮），
//     本 `BASELINE_TALLY` 只声明"**新增件带来的 Δ**"，避免把"每类各有几件"再抄一遍（第二套真源）。
//   ⚠️ **分辨力不降**：件数漂移由"集合棘轮"+ `DERIVED_EDGE_TYPES` 双向断言抓；新增件的分类
//      由 `PENDING_REGISTERED_ADDITIONS[].expected` 逐条抓（落错分类即红）。
import {
  SPEC_EDGE_TYPES,
  PENDING_REGISTERED_ADDITIONS,
} from '../../scripts/control-tower/probe-ontology-values';

/** 真仓**在场**的预告件（`SPEC` 之外、已登记却尚未提升为正式成员者）。
 *  🔴 必须按**磁盘在场性**筛选，不能无条件计入 —— 否则本笔在"尚未合入 `l3-65`"的树上会**自红**
 *  （推导出 58 而实际 56）。这样才能做到**合并顺序无关**：本笔绿 ∧ `l3-65` 合入后仍绿。 */
const EDGE_TYPES_DIR_FOR_DERIVE = join(process.cwd(), 'extensions', 'ontology', 'edge-types');
const ACTUAL_EDGE_FILES = readdirSync(EDGE_TYPES_DIR_FOR_DERIVE).filter(n => n.endsWith('.json')).sort();
const PRESENT_PENDING_EDGES = PENDING_REGISTERED_ADDITIONS.filter(p => ACTUAL_EDGE_FILES.includes(p.file));
/** `edge-types/` 件数 = **扫盘实测**（与 `SPEC ∪ 在场预告件` 恒等，由 §N2 集合棘轮双向断言）。
 *  ⇒ **推导，无字面基数**：本笔 56 → `l3-65` 合入后 58 自动成立。 */
const BASELINE_EDGE_TYPES = ACTUAL_EDGE_FILES.length;
const DERIVED_EDGE_TYPES = SPEC_EDGE_TYPES.length + PRESENT_PENDING_EDGES.length;
/** 逐类计数：`SPEC` 段（入册前的实测态）+ 预告件**入册期望**的 Δ。 */
const BASELINE_TALLY: Record<string, number> = {
  tf_resolved: 0,
  tf_placeholder: 1,    // K4-02（#235）后仅剩 `goal_decomposition` 的「N/A — …」×1（原 53 = 52 条 TBD + 1）
  tf_prose: 55 + PRESENT_PENDING_EDGES.filter(p => p.expected === 'non_causal_unknown').length,
                        // K4-02 后 = 39 条显式 `unknown` + 13 条权威01 第二章公式 + 原有 3 条真公式 = 55
                        //   ⚠️ `unknown` 在 loader 分类里落 `prose_formula`（非 placeholder），
                        //   但该状态自带 `injectable:false` ⇒ **不会**被注入（登记见交付件 U10）
                        //   ＋ 每件预告件（lag/tf = `unknown`）各 +1 ⇒ #65 合入后 55 → 57
  tf_other: 0,
  cs_declaration: 55,   // optionalProps 内描述串 ×55（批 2 不变；预告件**不含**该键 ⇒ 不增）
  cs_resolved: 0,       // 🔴 真仓**零数值**（未交③ 的机器可判证据）
  cs_other: 1 + PRESENT_PENDING_EDGES.length,
                        // `goal_decomposition` **缺该键** ⇒ absent；预告件同样**缺该键** ⇒ each +1
  lag_resolved: 56 + PRESENT_PENDING_EDGES.length,
                        // 非空字符串 ×56（unknown×50 + 4 种真值×5 + 第 56 件的散文值×1）
                        //   ＋ 预告件 `action_effect_lag = "unknown"`（非空）⇒ each +1
  lag_other: 0,
};
/** 第 56 件逐字段状态（点名，非"数字变了"）。 */
const EDGE_56 = { label: 'GOAL_DECOMPOSITION', tf: 'placeholder', cs: 'absent', lag: 'resolved' } as const;

/**
 * 🔴 两笔账（CTO 2026-10-11 甲裁定）—— **机器可判**（本批硬要求："覆盖力降档必须显式声明"）。
 * 未交项落地者**必须**把对应值翻成 `'DELIVERED'`，否则本文件必红 ⇒ 被迫同步更新两笔账（PR 正文 + 证据件）。
 */
const LEDGER = {
  // 已交
  injectionContract: 'DELIVERED',        // 契约件 1031-injection-contract.md
  implementation: 'DELIVERED',           // src/l4/ontology-loader.ts（+259，含读取面 3 键）
  criteriaFile: 'DELIVERED',             // 本文件（真跑 + mock log 捕获）
  // 未交
  readFaceDirectionMonitor: 'NOT_DELIVERED',       // ① CTO 明令剔除；blob 与 local-main 同一
  productionVisibleEffect: 'NOT_DELIVERED',        // ② 无生产调用方（"接入调度"另立卡）
  causalStrengthNumericInjection: 'NOT_DELIVERED', // ③ 真仓 cs_resolved=0；真值标定属另卡
  scriptSchemaGate: 'NOT_DELIVERED',               // ④ 脚本级 schema 门禁（U-1/U-2）📌实施席实测补记
} as const;

beforeEach(() => {
  logCalls.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════════
// V1 — 注入存在且可判（断言值）
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 V1 注入存在且可判（断言值）', () => {
  it('transfer_function = number ⇒ 实例 props 非空且值 === 类型层值', () => {
    const def = makeDef({ transfer_function: TF_NUMBER, ...RESOLVED_SIDECARS });
    const r = applyEdgeTypeParams({ weight: 0.7 }, def);

    expect(r.injected).toContain('transfer_function');
    expect(r.props.transfer_function).not.toBeUndefined();
    expect(r.props.transfer_function).toBe(TF_NUMBER); // ← 断言值
    expect(r.degraded).toBe(false);
  });

  it('transfer_function = {param:number} ⇒ 同形透传（同引用，不包装）', () => {
    const def = makeDef({ transfer_function: TF_PARAM, ...RESOLVED_SIDECARS });
    const r = applyEdgeTypeParams({}, def);

    expect(r.props.transfer_function).toEqual({ param: 0.55 });
    expect(r.props.transfer_function).toBe(TF_PARAM); // identity：不做包装/换算
  });

  it('transfer_function = {ref:string} ⇒ 同形透传', () => {
    const def = makeDef({ transfer_function: TF_REF, ...RESOLVED_SIDECARS });
    const r = applyEdgeTypeParams({}, def);

    expect(r.props.transfer_function).toEqual({ ref: 'computeRevenueLift' });
    expect(r.props.transfer_function).toBe(TF_REF);
  });

  it('causal_strength 从 optionalProps 取源（#1430 字段的读取面）⇒ 值正确', () => {
    const def = makeDef({ transfer_function: TF_NUMBER, ...RESOLVED_SIDECARS });
    const r = applyEdgeTypeParams({}, def);

    expect(r.injected).toContain('causal_strength');
    expect(r.props.causal_strength).toBe(CS_NUMBER);
  });

  it('params 恒 3 条且顺序 = EDGE_PARAM_KEYS（缺字段也报 absent，不漏项）', () => {
    const r = readEdgeTypeParams(makeDef());

    expect(r.params).toHaveLength(3);
    expect(r.params.map(p => p.key)).toEqual([...EDGE_PARAM_KEYS]);
    expect(r.params.every(p => p.status === 'absent')).toBe(true);
    expect(r.props).toEqual({}); // 全 absent ⇒ 不注入任何键
    expect(r.degraded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// V2（乙案改落点）— 注入前 vs 注入后：值不同且正确，差值只来自参数
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 V2 注入前 vs 注入后（乙案改落点：注入面断言）', () => {
  /** 对照数据（同 weight / 同 edgeType，唯一变量 = 参数是否注入） */
  const buildCase = () => {
    const def = makeDef({ transfer_function: TF_PARAM, optionalProps: { causal_strength: CS_NUMBER } });
    const before = { weight: 0.7, edgeType: 'TEST_FIXTURE_1031' };
    return { def, before };
  };

  it('注入前无键 vs 注入后有值 —— 两参数值必须不同且正确', () => {
    const { def, before } = buildCase();
    const after = applyEdgeTypeParams(before, def).props;

    // ── 对照数据（Δ 出现）──
    expect(before.transfer_function).toBeUndefined();
    expect(before.causal_strength).toBeUndefined();
    expect(before.weight).toBe(0.7);

    expect(after.transfer_function).toEqual({ param: 0.55 });
    expect(after.causal_strength).toBe(0.73);

    // 「必须不同」——用可打印的对照
    expect(after.transfer_function).not.toBe(before.transfer_function);
    expect(after.causal_strength).not.toBe(before.causal_strength);
  });

  it('注入前是【陈旧值】vs 注入后是【类型层真值】—— 数值确实改变', () => {
    const { def } = buildCase();
    const before = { weight: 0.7, transfer_function: 0.01, causal_strength: 0.02 };
    const after = applyEdgeTypeParams(before, def).props;

    // ── 对照数据（Δ 数值）──
    expect(before.transfer_function).toBe(0.01);
    expect(after.transfer_function).toEqual({ param: 0.55 });
    expect(before.causal_strength).toBe(0.02);
    expect(after.causal_strength).toBe(0.73);

    expect(after.transfer_function).not.toEqual(before.transfer_function);
    expect(after.causal_strength).not.toBe(before.causal_strength);
  });

  it('差值【只来自参数】：非参数键逐个不变，且新增键数恰好 = 注入键数', () => {
    const { def, before } = buildCase();
    const after = applyEdgeTypeParams(before, def).props;

    // 非参数键原样（同值）
    expect(after.weight).toBe(before.weight);
    expect(after.edgeType).toBe(before.edgeType);
    // 无其它新键
    const added = Object.keys(after).filter(k => !(k in before));
    expect(added.sort()).toEqual(['causal_strength', 'transfer_function']);
    expect(Object.keys(after).length - Object.keys(before).length).toBe(2);
  });

  it('差值【不来自时钟/顺序】：纯函数 ⇒ 重复调用逐字节相等，且不改入参', () => {
    const { def, before } = buildCase();
    const snapshot = JSON.stringify(before);

    const a1 = applyEdgeTypeParams(before, def).props;
    const a2 = applyEdgeTypeParams(before, def).props;

    expect(a1).toEqual(a2); // 无时钟/无随机/无顺序依赖
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(JSON.stringify(before)).toBe(snapshot); // 入参未被修改
  });

  it('同一 weight、同一 edgeType ⇒ 唯一变量是「是否注入」', () => {
    const { def, before } = buildCase();
    const after = applyEdgeTypeParams(before, def).props;

    expect(after.weight).toBe(0.7);
    expect(after.edgeType).toBe('TEST_FIXTURE_1031');
    expect(Object.keys(after).length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// V3 — 降级可见且有 log（不静默）
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 V3 降级可见（不静默）', () => {
  it('JSON 无该字段 ⇒ 三态 absent + degraded + warn（键不写入）', () => {
    const n = warnCount();
    const r = readEdgeTypeParams(makeDef());

    expect(r.params.every(p => p.status === 'absent')).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.issues).toHaveLength(3);
    expect(r.props).toEqual({});
    expect(warnCount() - n).toBe(1); // ← 有 log，不静默
  });

  it('占位串 ⇒ placeholder + declaredAs 原文保留 + 不注入 + warn', () => {
    const n = warnCount();
    const r = readEdgeTypeParams(makeDef({ transfer_function: PLACEHOLDER_TBD }));

    const tf = r.params.find(p => p.key === 'transfer_function')!;
    expect(tf.status).toBe('placeholder');
    expect(tf.injectable).toBe(false);
    expect(tf.declaredAs).toBe(PLACEHOLDER_TBD);
    expect('transfer_function' in r.props).toBe(false);
    expect(warnCount() - n).toBe(1);
  });

  it('仅声明串（causal_strength 实测形态）⇒ declaration_only + 不注入 + warn', () => {
    const n = warnCount();
    const r = readEdgeTypeParams(makeDef({ optionalProps: { causal_strength: DECLARATION_CS } }));

    const cs = r.params.find(p => p.key === 'causal_strength')!;
    expect(cs.status).toBe('declaration_only');
    expect(cs.injectable).toBe(false);
    expect(cs.declaredAs).toBe(DECLARATION_CS);
    expect('causal_strength' in r.props).toBe(false);
    expect(warnCount() - n).toBe(1);
  });

  it('散文公式 ⇒ prose_formula + 不注入 + warn', () => {
    const n = warnCount();
    const r = readEdgeTypeParams(makeDef({ transfer_function: PROSE_FORMULA }));

    const tf = r.params.find(p => p.key === 'transfer_function')!;
    expect(tf.status).toBe('prose_formula');
    expect(tf.injectable).toBe(false);
    expect(tf.declaredAs).toBe(PROSE_FORMULA);
    expect(warnCount() - n).toBe(1);
  });

  it('边界：空串 / null / 数组 / 缺 param|ref 的对象 ⇒ malformed + 不注入', () => {
    const cases: unknown[] = ['', '   ', null, [], {}, { param: 'x' }, { ref: '' }, { other: 1 }, NaN];
    for (const raw of cases) {
      const r = readEdgeTypeParams(makeDef({ transfer_function: raw }));
      const tf = r.params.find(p => p.key === 'transfer_function')!;
      expect(tf.status, `raw=${JSON.stringify(raw)}`).toBe('malformed');
      expect(tf.injectable).toBe(false);
      expect('transfer_function' in r.props).toBe(false);
    }
  });

  it('边界：{ref:string} / {param:number} 合法；歧义与非法形态 ⇒ malformed', () => {
    const good = ['{ref}', '{param}'];
    const rRef = readEdgeTypeParams(makeDef({ transfer_function: { ref: 'f' }, ...RESOLVED_SIDECARS }));
    const rParam = readEdgeTypeParams(makeDef({ transfer_function: { param: 1 }, ...RESOLVED_SIDECARS }));
    expect(rRef.degraded, good[0]).toBe(false);
    expect(rParam.degraded, good[1]).toBe(false);

    // 歧义形态（param 与 ref 同时存在）必须是 malformed，不许瞎猜
    const ambiguous = readEdgeTypeParams(makeDef({ transfer_function: { param: 1, ref: 'f' }, ...RESOLVED_SIDECARS }));
    expect(ambiguous.degraded).toBe(true);
    expect(ambiguous.params.find(p => p.key === 'transfer_function')!.status).toBe('malformed');
  });

  it('不静默反例：把降级分支改静默 ⇒ 本断言取到 0 次 warn ⇒ 必红（判别性）', () => {
    const n = warnCount();
    readEdgeTypeParams(makeDef({ transfer_function: PLACEHOLDER_TBD }));
    expect(warnCount() - n).toBe(1);
    // 若实现里删掉 log.warn(...)，上面这行会得到 0 ⇒ 红
    expect(warnCount() - n).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// V5 — L2 真跑：桥跑在【真实仓库 55 件 JSON】上（非 mock、非 grep）
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 V5(L2-真跑) 真实 56 件 edge-types 过桥实测', () => {
  it('56 件全部过桥；分类计数与 as_of local-main=dc5ce093 逐件实测一致（棘轮）', () => {
    const { ontology } = loadOntology();
    expect(ontology.edgeTypes).toHaveLength(BASELINE_EDGE_TYPES);

    const tally: Record<string, number> = {
      tf_resolved: 0, tf_placeholder: 0, tf_prose: 0, tf_other: 0,
      cs_declaration: 0, cs_resolved: 0, cs_other: 0,
      lag_resolved: 0, lag_other: 0,
    };

    for (const e of ontology.edgeTypes) {
      const r = getEdgeTypeParams(e.label);
      expect(r, `label=${e.label}`).not.toBeNull();
      expect(r!.params).toHaveLength(3);

      const tf = r!.params.find(p => p.key === 'transfer_function')!;
      if (tf.status === 'resolved') tally.tf_resolved++;
      else if (tf.status === 'placeholder') tally.tf_placeholder++;
      else if (tf.status === 'prose_formula') tally.tf_prose++;
      else tally.tf_other++;

      const cs = r!.params.find(p => p.key === 'causal_strength')!;
      if (cs.status === 'declaration_only') tally.cs_declaration++;
      else if (cs.status === 'resolved') tally.cs_resolved++;
      else tally.cs_other++;

      const lag = r!.params.find(p => p.key === 'action_effect_lag')!;
      if (lag.status === 'resolved') tally.lag_resolved++;
      else tally.lag_other++;
    }

    // ── 逐件实测原始计数（批 2：用 loader 本体读 56 件；见证据件 §A.0-b）──
    expect(tally).toEqual(BASELINE_TALLY);
  });

  it('🔴 第 56 件 `goal_decomposition` 逐字段点名（tally Δ 的可归因来源）', () => {
    clearOntologyCache();
    const r = getEdgeTypeParams(EDGE_56.label);
    expect(r, `第 56 件 ${EDGE_56.label} 必须可读`).not.toBeNull();

    const byKey = Object.fromEntries(r!.params.map(p => [p.key, p]));
    expect(byKey.transfer_function.status).toBe(EDGE_56.tf);       // "N/A — …" ⇒ 占位族
    expect(byKey.causal_strength.status).toBe(EDGE_56.cs);         // 缺键 ⇒ absent（全仓唯一）
    expect(byKey.action_effect_lag.status).toBe(EDGE_56.lag);      // 非空散文串 ⇒ 原样透传

    // 它对本桥的净效果：只有 action_effect_lag 可注入（其余两项降级 + warn 可见）
    expect(r!.props).toEqual({
      action_effect_lag: '0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞',
    });
    expect(r!.degraded).toBe(true);
    expect(r!.issues).toHaveLength(2);

    // 机器可判的"第 56 件可归因"：**逐件实测 + 点名**（原为 `expect(BASELINE_TALLY.cs_other).toBe(1)`）。
    // 🔴 N2 修（verifier a-1 + 复跑 B 态）：旧写法对**派生常量**再施**字面断言** ⇒ `l3-65`（#65）+2 边
    //   合入后在场预告件使 `cs_other` 由 1 → 3 ⇒ 该行红（B 态实测 `expected 3 to be 1`）。
    //   本写法**不依赖聚合数**，且不主张"全仓唯一"——那条在 56 件态成立只是**偶然**：
    //   `l3-65` 的两件新边同样**缺 `causal_strength` 键**（实测 `optionalProps` 无该键）⇒ absent 集必为 3。
    //   ⇒ 断言 = ① `GOAL_DECOMPOSITION` **必须在** absent 集内（可归因，点上）
    //            ② absent 集**恰等于**"本卡实测基线 ∪ 在场预告件"⇒ 若将来**再有** absent 件 ⇒ 红且点名。
    const absentCsLabels: string[] = [];
    for (const e of loadOntology().ontology.edgeTypes) {
      const p = getEdgeTypeParams(e.label)?.params.find(x => x.key === 'causal_strength');
      if (p && p.status === 'absent') absentCsLabels.push(e.label);
    }
    expect(absentCsLabels, '第 56 件 goal_decomposition 必须被点名（absent）').toContain('GOAL_DECOMPOSITION');
    expect(absentCsLabels.slice().sort(), 'absent 集必须恰为「goal_decomposition + 在场预告件」').toEqual(
      // `PendingEdgeAddition` 用 `id`（`edge/<name>`）；label 由 `id` 尾段大写化推得（与件内 `label` 一致）
      ['GOAL_DECOMPOSITION', ...PRESENT_PENDING_EDGES.map(p => p.id.split('/').pop()!.toUpperCase())].sort(),
    );
  });

  it('真实 label 取源位置正确：CONSTRAINS 三字段各归其位', () => {
    clearOntologyCache();
    const r = getEdgeTypeParams('CONSTRAINS');
    expect(r).not.toBeNull();

    const byKey = Object.fromEntries(r!.params.map(p => [p.key, p]));

    // transfer_function：顶层，K4-02（#235）后 = 显式 `unknown`（非占位串）⇒ `prose_formula`（injectable:false）
    expect(byKey.transfer_function.status).toBe('prose_formula');
    expect(String(byKey.transfer_function.raw)).toBe('unknown');

    // causal_strength：optionalProps 内，实测为声明串 ⇒ 降级（类型层无值）
    expect(byKey.causal_strength.status).toBe('declaration_only');
    expect(byKey.causal_strength.declaredAs).toBe(DECLARATION_CS);

    // action_effect_lag：顶层，实测 "unknown" ⇒ resolved（值域收口属 #1134）
    expect(byKey.action_effect_lag.status).toBe('resolved');
    expect(byKey.action_effect_lag.value).toBe('unknown');

    // 真实数据上唯一能注入的键 = action_effect_lag
    expect(r!.props).toEqual({ action_effect_lag: 'unknown' });
    expect(r!.degraded).toBe(true);
    expect(r!.issues).toHaveLength(2);
  });

  it('未知 label ⇒ null（不抛、不伪造）', () => {
    expect(getEdgeTypeParams('NO_SUCH_EDGE_LABEL_1031')).toBeNull();
  });

  it('真实 label + 注入面：action_effect_lag 落到 props，其余保持不存在', () => {
    const before = { weight: 0.7 };
    const { ontology } = loadOntology();
    const def = ontology.edgeTypes.find(e => e.label === 'CONSTRAINS')!;
    const after = applyEdgeTypeParams(before, def).props;

    expect(after.weight).toBe(0.7);
    expect(after.action_effect_lag).toBe('unknown');
    expect('transfer_function' in after).toBe(false); // 占位 ⇒ 不注入（D1143 降级行为不变）
    expect('causal_strength' in after).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 不变式 6 — 零影响既有面（回归）
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 零影响既有面（回归）', () => {
  it('loadOntology 返回结构不变，既有 3 消费者行为不变', () => {
    clearOntologyCache();
    const { ontology, degraded } = loadOntology();

    expect(degraded).toBe(false);
    expect(Object.keys(ontology).sort()).toEqual(['edgeEndpointMap', 'edgeTypes', 'nodeTypes']);
    expect(ontology.edgeEndpointMap['DEPLOYS'].from).toContain('resource/money');
    expect(validateEdgeEndpoints('DEPLOYS', 'resource/money', 'activity/production')).toBe(true);
    expect(validateEdgeEndpoints('DEPLOYS', 'resource/money', 'outcome/financial')).toBe(false);
    expect(getTypesByTags(['human']).nodes.some(n => n.label === 'PERSON')).toBe(true);
  });

  it('clearOntologyCache 同时使参数记忆化失效（结果一致，不会读到陈旧对象）', () => {
    const a = getEdgeTypeParams('CONSTRAINS');
    const b = getEdgeTypeParams('CONSTRAINS');
    expect(b).toBe(a); // 记忆化命中

    clearOntologyCache();
    const c = getEdgeTypeParams('CONSTRAINS');
    expect(c).not.toBe(a); // 缓存已失效
    expect(c).toEqual(a);  // 但内容一致
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 两笔账棘轮（CTO 2026-10-11 甲裁定：「覆盖力降档必须显式声明」⇒ 机器可判）
// ═══════════════════════════════════════════════════════════════════════════════

describe('#1031 两笔账棘轮（已交 / 未交，机器可判）', () => {
  it('已交三项显式声明为 DELIVERED（契约 / 实现 / 判据件）', () => {
    expect(LEDGER.injectionContract).toBe('DELIVERED');
    expect(LEDGER.implementation).toBe('DELIVERED');
    expect(LEDGER.criteriaFile).toBe('DELIVERED');
  });

  it('🔴 未交四项显式声明为 NOT_DELIVERED（含实施席实测补记的第 4 项）', () => {
    expect(LEDGER.readFaceDirectionMonitor).toBe('NOT_DELIVERED');        // ① CTO 明令剔除
    expect(LEDGER.productionVisibleEffect).toBe('NOT_DELIVERED');         // ② 无生产调用方
    expect(LEDGER.causalStrengthNumericInjection).toBe('NOT_DELIVERED');  // ③ 真仓零数值
    expect(LEDGER.scriptSchemaGate).toBe('NOT_DELIVERED');                // ④ 📌实施席实测补记（U-1/U-2）
  });

  it('未交③ 的机器可判证据：**真仓** `cs_resolved === 0`（52/55 声明串不等于值）', () => {
    clearOntologyCache();
    const { ontology } = loadOntology();
    let resolved = 0;
    for (const e of ontology.edgeTypes) {
      const r = getEdgeTypeParams(e.label);
      if (r !== null && r.params.find(p => p.key === 'causal_strength')?.status === 'resolved') resolved++;
    }
    expect(resolved).toBe(0);
    expect(resolved).toBe(BASELINE_TALLY.cs_resolved);
    // ⇒ 一旦有人真把 causal_strength 标定成数值，本断言必红 ⇒ 迫使翻转 LEDGER 并更新两笔账
    expect(LEDGER.causalStrengthNumericInjection).toBe('NOT_DELIVERED');
  });

  it('已交② 的机器可判证据：读取面**含** `causal_strength`（三键齐备，顺序固定）', () => {
    expect([...EDGE_PARAM_KEYS]).toEqual(['transfer_function', 'causal_strength', 'action_effect_lag']);
    expect([...EDGE_PARAM_KEYS]).toContain('causal_strength');
  });

  it('未交① 的边界：本桥**不**为 direction-monitor 读取面提供任何"已交"证据（防误读）', () => {
    // 本文件不 import direction-monitor，也不断言其行为；
    // 读取面是否落地由该文件的 blob 与后续卡判定（证据件 §A.6 未交① 给出 blob 同一的机器可判证据）。
    expect(LEDGER.readFaceDirectionMonitor).not.toBe('DELIVERED');
  });
});
