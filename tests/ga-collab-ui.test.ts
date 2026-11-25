/**
 * tests/ga-collab-ui.test.ts — D556 GaDetailSections 五场景 UI 断言（renderToStaticMarkup 桥接）
 *
 * 契约来源: SYNOVA-IMPL-DSH-D556-ga-collab-e2e-20260829.md §8 断言矩阵（五场景全字符串断言）:
 *   1. 占位零残留 — 输出不含「后端校准接口待接入」（L635 占位删除的回归证明，S-5 ②）
 *   2. 三块渲染 — loaded（空数据）含三标题 + 三端点区块结构（data-ga-block/data-endpoint）
 *   3. 计数变化 — stats {5/2/3} 计数渲染 + note 字段文本透传（诚实降级显性化）
 *   4. 降级 UI（503）— cap-degraded-banner + 降级文案 + 重试按钮 + 零计数假数据（S-5 防线）
 *   5. role 防御 — blocked 含「仅 GA 可见」空态 + 零列表/零表单结构（S-5 ①: 漏 role 防御 → 本场景红）
 *   + 分块独立降级（spec §5.3: 列表 ok、stats 失败 → 块内联降级条，不整面板连坐）
 *
 * 渲染桥接: electron-renderer/src/test-support/render.ts（零依赖元素树序列化器——react-dom
 * 不在 root lockfile 且 CI vitest 仅 root npm ci，见该文件头 WHY；API 与断言形态同 spec §8）。
 * 铁律 48: 每个用例 expect 断言。
 */
import { describe, it, expect } from 'vitest';
import { GaDetailSections, type GaDetailSectionsProps } from '../electron-renderer/src/components/ga-detail-sections';
import { renderToStaticMarkup } from '../electron-renderer/src/test-support/render';
import type { GaCalibrationItem } from '../electron-renderer/src/stores/ga-collab';

const PLACEHOLDER_TEXT = '后端校准接口待接入';

function baseProps(overrides?: Partial<GaDetailSectionsProps>): GaDetailSectionsProps {
  return {
    phase: 'loaded',
    role: 'ga',
    calibrationState: 'loaded',
    statsState: 'loaded',
    calibrations: [],
    stats: null,
    calibrationFormError: null,
    signalFormError: null,
    lastCalibrationId: null,
    lastSignal: null,
    injectedHistory: [],
    submitting: false,
    onRetry: () => {},
    onCalibrationSubmit: () => {},
    onSignalSubmit: () => {},
    ...overrides,
  };
}

function render(props: GaDetailSectionsProps): string {
  return renderToStaticMarkup(GaDetailSections(props));
}

const SAMPLE_CALIBRATION: GaCalibrationItem = {
  calibrationId: 'mem_1',
  targetType: 'diagnosis_conclusion',
  targetId: 'c-1',
  action: 'mark_error',
  errorType: '事实错误',
  correctedContent: '现金流实际为正',
  gaId: 'ga-seed-1',
  calibratedAt: '2026-08-29T01:00:00.000Z',
};

// ═════════════════════════════════════════════════════════════════════════════
// 场景 1: 占位零残留（S-5 ②: 占位未删 → 本场景红）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI 场景 1: 占位零残留', () => {
  it('任意合法 props（五场景全集）输出不含「后端校准接口待接入」', () => {
    const outputs = [
      render(baseProps()),
      render(baseProps({ phase: 'blocked', role: 'admin' })),
      render(baseProps({ phase: 'degraded', calibrationState: 'degraded', statsState: 'degraded' })),
      render(baseProps({ phase: 'loading', calibrationState: 'loading', statsState: 'loading' })),
      render(baseProps({ phase: 'idle', calibrationState: 'idle', statsState: 'idle' })),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(PLACEHOLDER_TEXT);
    }
  });

  it('生产源码级回归: RightPanel.tsx 不再包含占位组件定义（grep 断言的测试侧镜像）', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(
      new URL('../electron-renderer/src/components/RightPanel.tsx', import.meta.url),
      'utf-8',
    );
    expect(source).not.toContain(PLACEHOLDER_TEXT);
    // 容器必须真接线纯展示组件（非占位替换——铁律 0-2 语义）
    expect(source).toContain('GaDetailSections');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 场景 2: 三块渲染（loaded + 空数据）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI 场景 2: 三块渲染（loaded 空数据）', () => {
  const output = render(baseProps());

  it('含三块标题（诊断校准面板/手动补充经营异动/反馈效果统计）', () => {
    expect(output).toContain('🧬 诊断校准面板');
    expect(output).toContain('📥 手动补充经营异动');
    expect(output).toContain('📊 反馈效果统计');
  });

  it('含三端点区块结构（data-ga-block × 3 + data-endpoint 与 D551 四端点三块映射一致）', () => {
    expect(output).toContain('data-ga-block="calibration"');
    expect(output).toContain('data-ga-block="injection"');
    expect(output).toContain('data-ga-block="stats"');
    expect(output).toContain('data-endpoint="/api/ga/calibration"');
    expect(output).toContain('data-endpoint="/api/ga/calibration/signals"');
    expect(output).toContain('data-endpoint="/api/ga/calibration/stats"');
  });

  it('空数据 → 两块空态文案，零假计数（铁律 8）', () => {
    expect(output).toContain('暂无校准记录');
    expect(output).not.toContain('校准累计');
  });

  it('含两个表单结构（校准四动作 + 信号五要素）与提交按钮', () => {
    expect(output).toContain('data-ga-form="calibration"');
    expect(output).toContain('data-ga-form="signal"');
    expect(output).toContain('提交修正');
    expect(output).toContain('补充经营异动');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 场景 3: 计数变化 + note 透传
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI 场景 3: 计数变化（stats {5/2/3}）', () => {
  const output = render(baseProps({
    stats: {
      calibration: { total: 5, byAction: {} },
      injection: { total: 2, byType: {} },
      reflux: { feedbackCount: 3, byDecision: {} },
      note: '回流计数 ≠ 采纳率——采纳判定数据源不存在（spec §3.3 排除），指标诚实降级',
    },
  }));

  it('三计数渲染为元素文本（校准 5 / 补充 2 / 采纳反馈 3）', () => {
    expect(output).toContain('>5<');
    expect(output).toContain('>2<');
    expect(output).toContain('>3<');
    expect(output).toContain('校准累计');
    expect(output).toContain('累计补充条数');
    expect(output).toContain('已被采纳的反馈数');
  });

  it('note 字段原文透传（不加工不丢弃——采纳率不可得显性化）', () => {
    expect(output).toContain('回流计数 ≠ 采纳率——采纳判定数据源不存在（spec §3.3 排除），指标诚实降级');
    expect(output).toContain('data-honesty="note"');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 场景 4: 降级 UI（503 → 全块 degraded）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI 场景 4: 降级 UI（整体 degraded）', () => {
  const output = render(baseProps({
    phase: 'degraded',
    calibrationState: 'degraded',
    statsState: 'degraded',
  }));

  it('含 cap-degraded-banner 类名 + 降级文案 + 重试按钮（spec §5.3）', () => {
    expect(output).toContain('cap-degraded-banner');
    expect(output).toContain('⚠ 顾问协同暂时读不到，请稍后重试');
    expect(output).toContain('ga-retry-btn');
    expect(output).toContain('重试');
  });

  it('零计数假数据（无校准/补充/采纳反馈计数渲染，铁律 8）', () => {
    expect(output).not.toContain('校准累计');
    expect(output).not.toContain('累计补充条数');
    expect(output).not.toContain('已被采纳的反馈数');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 场景 5: role 防御（blocked — S-5 ①: 漏 role 防御 → 本场景红）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI 场景 5: role 防御空态（blocked）', () => {
  const output = render(baseProps({ phase: 'blocked', role: 'admin' }));

  it('含「仅顾问可见」空态 + 当前角色提示（角色原文进技术详情）', () => {
    expect(output).toContain('仅顾问可见');
    expect(output).toContain('当前角色（管理员）');
    expect(output).toContain('admin');
  });

  it('零列表/零表单结构（fail-closed: blocked 态不渲染任何可交互块）', () => {
    expect(output).not.toContain('<form');
    expect(output).not.toContain('data-ga-block="calibration"');
    expect(output).not.toContain('data-ga-block="injection"');
    expect(output).not.toContain('data-ga-block="stats"');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 分块独立降级（spec §5.3: 列表 ok、stats 失败 → 不连坐）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI: 分块独立降级（§5.3）', () => {
  const output = render(baseProps({
    phase: 'loaded',
    calibrationState: 'degraded',
    statsState: 'loaded',
    stats: {
      calibration: { total: 1, byAction: {} },
      injection: { total: 0, byType: {} },
      reflux: { feedbackCount: 0, byDecision: {} },
    },
    calibrations: [SAMPLE_CALIBRATION],
  }));

  it('降级块内联降级条 + 成功块照常渲染计数', () => {
    expect(output).toContain('⚠ 修正记录暂时读不到，请稍后重试');
    expect(output).toContain('校准累计');
    expect(output).toContain('>1<');
  });

  it('整面板降级条不出现（loaded 总态——分块独立，不连坐）', () => {
    expect(output).not.toContain('⚠ 顾问协同暂时读不到，请稍后重试');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 回显结构（POST 201 后容器注入的 calibrationId/findingId 可见性）
// ═════════════════════════════════════════════════════════════════════════════

describe('D556 UI: 提交回显结构（spec §3.4 结果环节）', () => {
  const output = render(baseProps({
    lastCalibrationId: 'mem_42',
    lastSignal: { signalId: 'mem_43', findingId: 'f-77' },
    injectedHistory: [{
      signalType: '竞品动态', title: 'A 轮融资', signalId: 'mem_43', findingId: 'f-77',
      at: '2026-08-29T01:30:00.000Z',
    }],
    calibrations: [SAMPLE_CALIBRATION],
  }));

  it('校准回显编号 + 信号回显编号（主文案不印字段名，原值进技术详情）', () => {
    expect(output).toContain('修正已提交（编号见技术详情）');
    expect(output).toContain('mem_42');
    expect(output).toContain('data-calibration-id="mem_42"');
    expect(output).toContain('已补充经营异动（编号见技术详情）');
    expect(output).toContain('mem_43');
    expect(output).toContain('f-77');
    expect(output).toContain('data-finding-id="f-77"');
  });

  it('会话内已补充记录渲染', () => {
    expect(output).toContain('已补充记录（本次分析）');
    expect(output).toContain('A 轮融资');
  });

  it('校准列表渲染条目（客户说法 + 原始枚举进技术详情）', () => {
    expect(output).toContain('标记错误');
    expect(output).toContain('诊断结论');
    expect(output).toContain('mark_error');
    expect(output).toContain('diagnosis_conclusion');
  });
});
