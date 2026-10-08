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
 * 日志断言手法：`vi.mock('@synova/logger')` **运行时捕获调用**（非 grep 静态判据）。
 * 同仓库既有手法参照 tests/l4/delivery-queue.test.ts:10-13。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('#1031 V5(L2-真跑) 真实 55 件 edge-types 过桥实测', () => {
  it('55 件全部过桥；分类计数与 as_of 5a6591c4a 逐件实测一致', () => {
    const { ontology } = loadOntology();
    expect(ontology.edgeTypes).toHaveLength(55);

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

    // ── 逐件实测原始计数（python3 全量统计，见交付件 §V5）──
    expect(tally).toEqual({
      tf_resolved: 0,
      tf_placeholder: 52,   // 「TBD — to be defined in compute phase」× 52
      tf_prose: 3,          // brand_builds / couples / cumulative_learning
      tf_other: 0,
      cs_declaration: 55,   // optionalProps 内描述串 × 55（类型层无数值）
      cs_resolved: 0,
      cs_other: 0,
      lag_resolved: 55,     // 非空字符串 × 55（unknown × 50 + 4 种真值 × 5）
      lag_other: 0,
    });
  });

  it('真实 label 取源位置正确：CONSTRAINS 三字段各归其位', () => {
    clearOntologyCache();
    const r = getEdgeTypeParams('CONSTRAINS');
    expect(r).not.toBeNull();

    const byKey = Object.fromEntries(r!.params.map(p => [p.key, p]));

    // transfer_function：顶层，实测为占位串 ⇒ 降级
    expect(byKey.transfer_function.status).toBe('placeholder');
    expect(String(byKey.transfer_function.declaredAs)).toContain('TBD');

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
