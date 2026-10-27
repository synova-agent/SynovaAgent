/**
 * components/MeasurementTrendContainer.tsx — M4「测量值＋趋势」薄取数容器
 *
 * 设计哲学：一个分离 ＋ 两条承诺 —— 容器只做「一次取数 ＋ 状态映射」（状态映射收在 deriveState 一处），
 *   渲染全权交给纯展示组件；承诺 ① 未选客户即提示且**零请求**（不拿聚合数冒充客户数，
 *   在调用 loader 之前先判 return）；承诺 ② 降级显式（loader 契约不抛；万一抛错也转 degraded
 *   + console.error，不留未处理 rejection）。
 *
 * 契约（铁律 47）:
 *   @input   orgId: string | null —— 企业作用域（必填）：null ／ '' ⇒ 提示态「未选客户」且**不发请求**；
 *            非空 ⇒ 透传 loader 作为 &orgId=（URL 编码）。
 *            onOpenOnePager?: () => void —— 一页纸入口回调；由 RightPanel 仅在 view==='ws_ga' 时传入
 *            （其余视图不传 ⇒ 无死按钮）。
 *            base?: string —— API 源，缺省 loader 取 getApiBase()（测试注入真 express）。
 *   @output  orgId 空 ⇒ 提示态：section（data-testid="measurement-trend-section"）＋
 *            提示条 data-testid="measurement-trend-select-org"（中文提示「请先选择客户」，零请求、零假数据）；
 *            orgId 非空 ⇒ <MeasurementTrendSection view state onOpenOnePager />：首渲染 loading；取回后
 *            !ok||degraded ⇒ degraded；ok 且 summary 空 ⇒ empty；否则 ready。
 *   @degraded loader 返回 ok=false（本容器不再重试/轮询）；loader 契约外抛错 ⇒ console.error +
 *            显式 degraded view（UNEXPECTED_LOADER_REJECTION），不白屏、不写假数据（铁律 11/31）。
 *   @authority 只被 `RightPanel body` 单点挂载（activeOrgId 门控）；本文件不写任何业务数据，不读全局 store。
 *   @not-here 不做写侧/标定/报告链；不做刷新按钮、轮询、缓存（M4 只要求取一次并可见）；
 *            未选客户时**不**退化为「不带 orgId 的聚合查询」（缺省不过滤是服务端语义，非本容器语义）。
 *   @error   不抛（catch 内转 degraded view）；orgId 形态非法由服务端 400 → loader 降级路径承载。
 *
 * 已知限制（DSH 代码标准 C）:
 *   · 无手动刷新/定时刷新（orgId/base 变化才重新取数；轮询/缓存另批）。
 *   · 无「重试」按钮：降级态只展示原因，用户可切 tab 或重启后重试（避免新增交互面）。
 *   · onOpenOnePager 变化不触发取数（回调不参与取数语义）；base ／ orgId 变化才重新取。
 *   · 未选客户零请求：跨客户聚合数不经本容器展示（避免跨租户混示）。
 *   · 容器不在 render 桥覆盖范围内（含 hook）——其行为由 wiring 源码断言 + 真机/容器测试兜底。
 */
import React, { useEffect, useState } from 'react';
import { loadMeasurementTrends } from '../lib/measurement-trends';
import type { MeasurementTrendsView } from '../lib/measurement-trends';
import { MeasurementTrendSection } from './MeasurementTrendSection';
import type { MeasurementTrendState } from './MeasurementTrendSection';

/** view → 展示状态（唯一映射点；空是合法业务态） */
function deriveState(view: MeasurementTrendsView | null): MeasurementTrendState {
  if (view === null) return 'loading';
  if (!view.ok || view.degraded) return 'degraded';
  return view.summary.length === 0 ? 'empty' : 'ready';
}

/** 容器 props（orgId 必填：未选客户是显式状态，不用可选参数冒充「不带作用域」） */
export interface MeasurementTrendContainerProps {
  orgId: string | null;
  onOpenOnePager?: () => void;
  base?: string;
}

/**
 * MeasurementTrendContainer — 取数容器（挂载点：RightPanel body，activeOrgId 门控）。
 * @input  — props（见 MeasurementTrendContainerProps；orgId 必填，回调与 base 由上级注入）
 * @output — orgId 空 ⇒ 「未选客户」提示态（零请求）；否则 MeasurementTrendSection 的四态渲染树
 * @degraded — loader 失败 ⇒ degraded 态；loader 契约外抛错 ⇒ 显式 degraded view（留痕）
 * @error  — 不抛（catch 内转 degraded）
 */
export const MeasurementTrendContainer: React.FC<MeasurementTrendContainerProps> = ({
  orgId,
  onOpenOnePager,
  base,
}) => {
  const [view, setView] = useState<MeasurementTrendsView | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 未选客户：**先判 return**（在调用 loader 之前）⇒ 零请求（规格 §5.4／A8）
    if (orgId === null || orgId === '') {
      setView(null);
      return () => {
        cancelled = true;
      };
    }
    setView(null);
    loadMeasurementTrends(base, orgId)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch((err: unknown) => {
        // loader 契约「永不抛」；此分支只在实现回归时可见（留痕，不静默）
        const message = err instanceof Error ? err.message : String(err);
        console.error('[measurement-trends] loader 契约外抛错（应为 degraded）:', message);
        if (!cancelled) {
          setView({
            ok: false,
            degraded: true,
            summary: [],
            errors: [`UNEXPECTED_LOADER_REJECTION: ${message}`],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [base, orgId]);

  // 未选客户：显式提示态（无请求、无降级条、无假数据）
  if (orgId === null || orgId === '') {
    return (
      <section className="sb-section measurement-trend-section" data-testid="measurement-trend-section">
        <div className="sb-section-title">📈 测量值＋趋势</div>
        <div className="ga-block-note" data-testid="measurement-trend-select-org">
          请先选择一个客户 —— 未选客户时不请求测量值（零请求，不展示跨客户聚合数）
        </div>
      </section>
    );
  }

  return <MeasurementTrendSection view={view} state={deriveState(view)} onOpenOnePager={onOpenOnePager} />;
};
