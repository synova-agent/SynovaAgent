/**
 * tests/ga-collab-logic.test.ts — D556 GA 协同数据层单测（node env，零 react/zustand）
 *
 * 契约来源: SYNOVA-IMPL-DSH-D556-ga-collab-e2e-20260829.md §8 逻辑层断言矩阵:
 *   - 状态机迁移（idle→loading→loaded/degraded/blocked）
 *   - 降级决策（503→degraded、403→blocked、部分失败分块独立）
 *   - buildCalibrationRequest 四动作校验规则（镜像 D551 服务端校验）
 *   - buildSignalRequest 五要素校验（severity 1-10 / confidence 0-100）
 *   - getSeedIdentity/getSeedToken（localStorage mock；无 seed → null → DS4 原语义）
 *
 * 铁律 48: 每个用例 expect 断言，覆盖 正常路径 + 降级路径 + 边界条件。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GA_TARGET_TYPES,
  GA_CALIBRATION_ACTIONS,
  GA_ERROR_TYPES,
  GA_SIGNAL_TYPES,
  getSeedIdentity,
  getSeedToken,
  decideBlockState,
  deriveOverallPhase,
  mapStatsResponse,
  mapCalibrationsResponse,
  buildCalibrationRequest,
  buildSignalRequest,
  parseNumberInput,
  type GaCalibrationItem,
} from '../electron-renderer/src/stores/ga-collab';

// ═══ localStorage mock 夹具 ═══

let seedStore: Record<string, string>;

beforeEach(() => {
  seedStore = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key in seedStore ? seedStore[key] : null),
    setItem: (key: string, value: string) => { seedStore[key] = value; },
    removeItem: (key: string) => { delete seedStore[key]; },
    clear: () => { seedStore = {}; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setSeed(identity: unknown): void {
  seedStore['synova.dev-identity'] = JSON.stringify(identity);
}

// ═════════════════════════════════════════════════════════════════════════════
// getSeedIdentity / getSeedToken — seed 身份（spec §7.2）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 getSeedIdentity/getSeedToken: seed 身份读取', () => {
  it('正常路径: ga seed → 身份 + token 格式 ga:orgId:userId（auth.ts L366-376 同源）', () => {
    setSeed({ role: 'ga', orgId: 'default', userId: 'ga-seed-1' });
    const identity = getSeedIdentity();
    expect(identity).toEqual({ role: 'ga', orgId: 'default', userId: 'ga-seed-1' });
    expect(getSeedToken()).toBe('ga:default:ga-seed-1');
  });

  it('无 seed（key 缺失）→ null + token null（DS4: 无 seed 行为与现状一致）', () => {
    expect(getSeedIdentity()).toBeNull();
    expect(getSeedToken()).toBeNull();
  });

  it('降级路径: JSON.parse 失败 → console.warn + null（铁律 24: 解析失败不静默）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedStore['synova.dev-identity'] = '{not-valid-json';
    expect(getSeedIdentity()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(getSeedToken()).toBeNull();
    warnSpy.mockRestore();
  });

  it('边界: role 非 ga（admin seed）→ null（fail-closed，seed 仅 GA 语义）', () => {
    setSeed({ role: 'admin', orgId: 'default', userId: 'x' });
    expect(getSeedIdentity()).toBeNull();
  });

  it('边界: role=ga 但 orgId/userId 缺失或空 → null（字段不全不生效）', () => {
    setSeed({ role: 'ga', userId: 'ga-seed-1' });
    expect(getSeedIdentity()).toBeNull();
    setSeed({ role: 'ga', orgId: '', userId: 'ga-seed-1' });
    expect(getSeedIdentity()).toBeNull();
    setSeed({ role: 'ga', orgId: 'default' });
    expect(getSeedIdentity()).toBeNull();
  });

  it('边界: 值为 JSON 原始类型（非对象）→ null 不抛', () => {
    seedStore['synova.dev-identity'] = '"ga"';
    expect(getSeedIdentity()).toBeNull();
    seedStore['synova.dev-identity'] = 'null';
    expect(getSeedIdentity()).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// decideBlockState / deriveOverallPhase — 状态机 + 降级决策（spec §8）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 decideBlockState: HTTP 状态 → 块状态', () => {
  it('正常路径: 200/201 → loaded', () => {
    expect(decideBlockState(200)).toBe('loaded');
    expect(decideBlockState(201)).toBe('loaded');
  });

  it('降级决策: 503 → degraded（spec §8 降级决策矩阵）', () => {
    expect(decideBlockState(503)).toBe('degraded');
  });

  it('降级决策: 403 → blocked（服务端 requireGa 拒绝，fail-closed）', () => {
    expect(decideBlockState(403)).toBe('blocked');
  });

  it('边界: null（apiFetch 网络异常 collapse）/400/未知 → degraded', () => {
    expect(decideBlockState(null)).toBe('degraded');
    expect(decideBlockState(400)).toBe('degraded');
    expect(decideBlockState(500)).toBe('degraded');
  });
});

describe('D556 deriveOverallPhase: 容器总状态（分块独立——spec §5.3）', () => {
  it('role 不允许 → blocked（零 fetch 语义由容器保证）', () => {
    expect(deriveOverallPhase(false, 'idle', 'idle')).toBe('blocked');
    expect(deriveOverallPhase(false, 'degraded', 'degraded')).toBe('blocked');
  });

  it('状态机迁移: idle → loading → loaded', () => {
    expect(deriveOverallPhase(true, 'idle', 'idle')).toBe('idle');
    expect(deriveOverallPhase(true, 'loading', 'loading')).toBe('loading');
    expect(deriveOverallPhase(true, 'loaded', 'loaded')).toBe('loaded');
  });

  it('部分失败分块独立: loaded + degraded → loaded（降级块内联呈现，不整面板连坐）', () => {
    expect(deriveOverallPhase(true, 'loaded', 'degraded')).toBe('loaded');
    expect(deriveOverallPhase(true, 'degraded', 'loaded')).toBe('loaded');
  });

  it('全失败 → degraded（整面板降级条 + 重试）', () => {
    expect(deriveOverallPhase(true, 'degraded', 'degraded')).toBe('degraded');
    expect(deriveOverallPhase(true, 'blocked', 'degraded')).toBe('degraded');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// mapStatsResponse / mapCalibrationsResponse — 响应映射（诚实 note 透传）
// ═════════════════════════════════════════════════════════════════════════════

const VALID_STATS = {
  ok: true,
  calibration: { total: 5, byAction: { mark_error: 3, add_context: 1, rewrite_logic: 1, demote_signal: 0 } },
  injection: { total: 2, byType: { 人员变动: 2 } },
  reflux: { feedbackCount: 3, byDecision: { reject: 2, modify: 1, ineffective: 0 } },
  note: '回流计数 ≠ 采纳率——采纳判定数据源不存在（spec §3.3 排除），指标诚实降级',
};

describe('D556 mapStatsResponse: stats 响应映射', () => {
  it('正常路径: 完整响应 → ok + 计数映射 + note 原文透传（不加工）', () => {
    const result = mapStatsResponse(VALID_STATS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.calibration.total).toBe(5);
    expect(result.data.injection.total).toBe(2);
    expect(result.data.reflux.feedbackCount).toBe(3);
    expect(result.data.note).toBe('回流计数 ≠ 采纳率——采纳判定数据源不存在（spec §3.3 排除），指标诚实降级');
  });

  it('透传 degraded 标记（铁律 31: 降级信号传播到 UI）', () => {
    const result = mapStatsResponse({ ...VALID_STATS, degraded: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.degraded).toBe(true);
  });

  it('降级路径: 非 ok / null / 结构缺失 → { ok: false }（禁假数据，铁律 8）', () => {
    expect(mapStatsResponse(null).ok).toBe(false);
    expect(mapStatsResponse({ ok: false }).ok).toBe(false);
    expect(mapStatsResponse({ ok: true, calibration: null }).ok).toBe(false);
    expect(mapStatsResponse({ ok: true, calibration: {}, injection: {}, reflux: {} }).ok).toBe(false);
    expect(mapStatsResponse({ ok: true, calibration: { total: 'x' }, injection: { total: 1 }, reflux: { feedbackCount: 1 } }).ok).toBe(false);
  });

  it('边界: note 缺失 → data.note 为 undefined 不崩', () => {
    const result = mapStatsResponse({ ...VALID_STATS, note: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.note).toBeUndefined();
  });
});

const VALID_CAL: GaCalibrationItem = {
  calibrationId: 'mem_1',
  targetType: 'diagnosis_conclusion',
  targetId: 'c-1',
  action: 'mark_error',
  errorType: '事实错误',
  correctedContent: '正确内容',
  gaId: 'ga-seed-1',
  calibratedAt: '2026-08-29T00:00:00.000Z',
};

describe('D556 mapCalibrationsResponse: 校准列表映射', () => {
  it('正常路径: 列表映射 + 链头字段（supersedes/supersededBy）保留', () => {
    const result = mapCalibrationsResponse({ ok: true, calibrations: [VALID_CAL, { ...VALID_CAL, calibrationId: 'mem_2', supersedes: 'mem_1', supersededBy: undefined }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[1].supersedes).toBe('mem_1');
  });

  it('边界: 单条畸形（缺 calibrationId）→ 跳过不整表拒绝（对齐 D551 路由语义）', () => {
    const result = mapCalibrationsResponse({ ok: true, calibrations: [{ foo: 'bar' }, VALID_CAL] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].calibrationId).toBe('mem_1');
  });

  it('降级路径: 非 ok / calibrations 非数组 / null → { ok: false }', () => {
    expect(mapCalibrationsResponse(null).ok).toBe(false);
    expect(mapCalibrationsResponse({ ok: false }).ok).toBe(false);
    expect(mapCalibrationsResponse({ ok: true, calibrations: 'nope' }).ok).toBe(false);
  });

  it('边界: 空数组 → { ok: true, data: [] }（合法空态）', () => {
    const result = mapCalibrationsResponse({ ok: true, calibrations: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildCalibrationRequest — 四动作校验（镜像 D551 L146-178）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 buildCalibrationRequest: 四动作校验规则', () => {
  it('正常路径: mark_error 全字段 → body 组装（errorType 4 值域之一）', () => {
    const result = buildCalibrationRequest({
      targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error',
      errorType: GA_ERROR_TYPES[0], correctedContent: '现金流实际为正',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error',
      errorType: '事实错误', correctedContent: '现金流实际为正',
    });
  });

  it('mark_error: 缺 correctedContent → 校验失败，不发请求', () => {
    const result = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error', errorType: '事实错误' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('正确信息');
  });

  it('mark_error: errorType 越界（非 4 值域）→ 校验失败', () => {
    const result = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error', errorType: '乱写的', correctedContent: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('错误类型');
  });

  it('add_context: 缺 contextCard → 校验失败；齐全 → body.contextCard', () => {
    const bad = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'add_context' });
    expect(bad.ok).toBe(false);
    const good = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'add_context', contextCard: '客户为制造业' });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.body.contextCard).toBe('客户为制造业');
  });

  it('rewrite_logic: 缺 rewrittenVersion → 校验失败（并列存储二者缺一不可）', () => {
    const result = buildCalibrationRequest({ targetType: 'diagnosis_logic', targetId: 'l-1', action: 'rewrite_logic', originalVersion: 'v1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('原版本与新版本');
  });

  it('demote_signal: 缺 sentinelId → 校验失败', () => {
    const result = buildCalibrationRequest({ targetType: 'signal_relevance', targetId: 's-1', action: 'demote_signal' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('预警项');
  });

  it('边界: action/targetType 越界 / targetId 空 → 校验失败（枚举值域与 D551 一致）', () => {
    expect(buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'delete_all' }).ok).toBe(false);
    expect(buildCalibrationRequest({ targetType: 'hacked', targetId: 'c-1', action: 'mark_error' }).ok).toBe(false);
    expect(buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: '  ', action: 'mark_error' }).ok).toBe(false);
    expect(GA_TARGET_TYPES).toEqual(['diagnosis_conclusion', 'diagnosis_logic', 'signal_relevance']);
    expect(GA_CALIBRATION_ACTIONS).toEqual(['mark_error', 'add_context', 'rewrite_logic', 'demote_signal']);
  });

  it('supersedes: 可选透传（版本链）', () => {
    const withChain = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error', errorType: '事实错误', correctedContent: 'x', supersedes: 'mem_9' });
    expect(withChain.ok).toBe(true);
    if (withChain.ok) expect(withChain.body.supersedes).toBe('mem_9');
    const withoutChain = buildCalibrationRequest({ targetType: 'diagnosis_conclusion', targetId: 'c-1', action: 'mark_error', errorType: '事实错误', correctedContent: 'x' });
    if (withoutChain.ok) expect(withoutChain.body.supersedes).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildSignalRequest — 五要素校验（镜像 D551 L320-341）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 buildSignalRequest: 五要素校验', () => {
  it('正常路径: 字符串数值表单 → 数值 body（severity 1-10 / confidence 0-100）', () => {
    const result = buildSignalRequest({
      signalType: '竞品动态', title: 'A 轮融资', description: '竞对完成 B 轮',
      severity: '7', confidence: '80', relatedEdges: 'e1, e2', relatedNodes: '',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({ signalType: '竞品动态', title: 'A 轮融资', severity: 7, confidence: 80 });
    expect(result.body.relatedEdges).toEqual(['e1', 'e2']);
    expect(result.body.relatedNodes).toBeUndefined();
  });

  it('降级路径: severity 越界（0/11）→ 校验失败', () => {
    const low = buildSignalRequest({ signalType: '其他', title: 't', description: 'd', severity: '0', confidence: '50' });
    const high = buildSignalRequest({ signalType: '其他', title: 't', description: 'd', severity: '11', confidence: '50' });
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
  });

  it('降级路径: confidence 越界（-1/101）/ 非数值 → 校验失败', () => {
    expect(buildSignalRequest({ signalType: '其他', title: 't', description: 'd', severity: '5', confidence: '101' }).ok).toBe(false);
    expect(buildSignalRequest({ signalType: '其他', title: 't', description: 'd', severity: '5', confidence: '-1' }).ok).toBe(false);
    expect(buildSignalRequest({ signalType: '其他', title: 't', description: 'd', severity: '5', confidence: 'abc' }).ok).toBe(false);
  });

  it('降级路径: signalType 越界 / title/description 空 → 校验失败', () => {
    expect(buildSignalRequest({ signalType: '不存在', title: 't', description: 'd', severity: '5', confidence: '50' }).ok).toBe(false);
    expect(buildSignalRequest({ signalType: '其他', title: '  ', description: 'd', severity: '5', confidence: '50' }).ok).toBe(false);
    expect(buildSignalRequest({ signalType: '其他', title: 't', description: '', severity: '5', confidence: '50' }).ok).toBe(false);
  });

  it('边界: GA_SIGNAL_TYPES 恰为蓝图 10 枚举（§3.3.1）', () => {
    expect(GA_SIGNAL_TYPES).toHaveLength(10);
  });
});

describe('D556 parseNumberInput: 表单数值解析', () => {
  it('正常: number 原值 / 数值字符串 → number', () => {
    expect(parseNumberInput(5)).toBe(5);
    expect(parseNumberInput('5')).toBe(5);
    expect(parseNumberInput(' 5.5 ')).toBe(5.5);
  });
  it('降级: 非数值/空/NaN → null', () => {
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
    expect(parseNumberInput(NaN)).toBeNull();
  });
});
