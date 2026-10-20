/**
 * components/MeasurementTrendSection.tsx — M4「测量值＋趋势」纯展示组件（props 驱动，零 hook/零 effect/零 fetch）
 *
 * 设计哲学：一个分离 ＋ 两条承诺 —— 取数（lib/measurement-trends.ts ＋ 容器）与展示彻底分离；
 *   承诺 ① **零副作用**（无 hook/effect/fetch/store，renderToStaticMarkup 桥可直接断言）；
 *   承诺 ② **四态穷举**（loading/ready/empty/degraded 各一条显式分支，无隐式兜底、无假数据）。
 *
 * 契约（铁律 47）:
 *   @input   view: MeasurementTrendsView | null —— 容器注入的取数结果；state 由容器按
 *            「!ok||degraded ⇒ degraded；ok 且 summary 空 ⇒ empty；否则 ready」派生；
 *            onOpenOnePager?: () => void —— 一页纸入口回调（缺省时不崩，按钮保留可点占位）。
 *   @output  单一区块：标题含字面量「测量值＋趋势」；ready 每指标一条 measurement-trend-item
 *            （metricId＋latestValue＋unit＋方向 data-trend↑/↓/→/未知＋latestAt）；empty 空态；
 *            degraded 降级条＋errors 原文；loading 占位；任何 state 都渲染一页纸入口
 *            data-testid="measurement-to-onepager"（规格 §3.2b：接回既有 report tab，不重建报告链）。
 *   @degraded state='degraded' ⇒ 降级条 + errors 逐条文案，零推测数据、不白屏（铁律 8/11）。
 *   @authority 只被容器（MeasurementTrendContainer）或测试桥渲染；本文件不请求网络、不读全局 store。
 *   @not-here 不做通用 BI/图表/仪表盘；不新增路由或页面；不把测量值写进报告内容。
 *
 * 已知限制（DSH 代码标准 C）:
 *   · 渲染桥不执行事件 ⇒ 本组件只能证明「入口在渲染树中且绑定同一回调」，点击行为由容器/真机验证。
 *   · 数值按月/ratio 等 unit 原样展示，不做千分位/位数归一（未知口径不格式化）。
 *   · latestAt 原样输出 ISO 字符串（不本地化，避免测试/显示口径不一致）。
 *   · 变化率以百分数展示（由 changeRatio 推导），previous 不可得时显示「未知」，不伪造 0。
 */
import React from 'react';
import type { MetricTrendItem, MeasurementTrendsView, TrendDirection } from '../lib/measurement-trends';
import { deriveTrendDirection } from '../lib/measurement-trends';

/** 展示状态（容器按 view 派生；空是合法业务态） */
export type MeasurementTrendState = 'loading' | 'ready' | 'empty' | 'degraded';

export interface MeasurementTrendSectionProps {
  view: MeasurementTrendsView | null;
  state: MeasurementTrendState;
  onOpenOnePager?: () => void;
}

/** 方向 → 可见符号/文案（unknown 显式写「未知」，禁把 null 画成持平） */
const DIRECTION_META: Record<TrendDirection, { symbol: string; label: string }> = {
  up: { symbol: '↑', label: '上升' },
  down: { symbol: '↓', label: '下降' },
  flat: { symbol: '→', label: '持平' },
  unknown: { symbol: '未知', label: '变化不可算' },
};

function formatValue(value: number | null): string {
  return value === null ? '未知' : String(value);
}

/** changeRatio → 带符号百分数；null（previous 缺失/为 0）⇒ null（不显示） */
function formatChangeRatio(changeRatio: number | null): string | null {
  if (changeRatio === null || !Number.isFinite(changeRatio)) return null;
  const percent = (changeRatio * 100).toFixed(1);
  return changeRatio > 0 ? `+${percent}%` : `${percent}%`;
}

const TrendItem: React.FC<{ item: MetricTrendItem; index: number }> = ({ item, index }) => {
  const direction = deriveTrendDirection(item.changeRatio);
  const meta = DIRECTION_META[direction];
  const change = formatChangeRatio(item.changeRatio);
  return (
    <div
      className="measurement-trend-item"
      data-testid="measurement-trend-item"
      data-metric-id={item.metricId}
      key={`${item.metricId}::${item.entityId}::${index}`}
    >
      <div className="measurement-trend-head">
        <span className="measurement-trend-metric">{item.metricId}</span>
        <span className="measurement-trend-value">
          {formatValue(item.latestValue)}
          {item.unit === null ? '' : ` ${item.unit}`}
        </span>
        <span className="measurement-trend-direction" data-trend={direction}>
          {meta.symbol} {meta.label}
        </span>
        {change === null ? null : <span className="measurement-trend-change">（变化 {change}）</span>}
      </div>
      <div className="measurement-trend-at">{item.latestAt}</div>
    </div>
  );
};

/**
 * MeasurementTrendSection — 测量值＋趋势纯展示区块（容器: MeasurementTrendContainer）。
 * @input  — props（见 MeasurementTrendSectionProps）
 * @output — 四态分支结构 + 恒在的一页纸入口（data-testid="measurement-to-onepager"）
 * @degraded — 降级条 + errors 原文，零假数据
 * @error  — 不抛（view 缺失/回调缺失均按显式分支渲染）
 */
export const MeasurementTrendSection: React.FC<MeasurementTrendSectionProps> = ({ view, state, onOpenOnePager }) => {
  const items = view === null ? [] : view.summary;
  const errors = view?.errors ?? [];
  const showEmpty = state === 'empty' || (state === 'ready' && items.length === 0);

  return (
    <section className="sb-section measurement-trend-section" data-testid="measurement-trend-section">
      <div className="sb-section-title">📈 测量值＋趋势</div>

      {state === 'loading' && (
        <div className="ga-block-note" data-testid="measurement-trend-loading">
          正在加载测量值＋趋势…
        </div>
      )}

      {state === 'degraded' && (
        <div className="cap-degraded-banner" data-testid="measurement-trend-degraded">
          ⚠ 测量值/趋势服务降级，暂不可用（不展示任何推测数据）
          {errors.length > 0 && (
            <div className="measurement-trend-errors" style={{ fontSize: 10 }}>
              {errors.map((message, index) => (
                <div key={`error-${index}`}>{message}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="measurement-trend-list">
          {items.map((item, index) => (
            <TrendItem key={`${item.metricId}::${item.entityId}::${index}`} item={item} index={index} />
          ))}
        </div>
      )}

      {showEmpty && (
        <div className="empty-state" data-testid="measurement-trend-empty" style={{ padding: '16px 8px' }}>
          <div className="empty-state-text" style={{ fontSize: 11 }}>
            暂无测量值 — 尚无指标读数（空态为合法业务态，未编造数据）
          </div>
        </div>
      )}

      <button
        className="ga-refresh-btn measurement-to-onepager"
        data-testid="measurement-to-onepager"
        type="button"
        onClick={onOpenOnePager}
      >
        查看诊断报告（一页纸）
      </button>
    </section>
  );
};
