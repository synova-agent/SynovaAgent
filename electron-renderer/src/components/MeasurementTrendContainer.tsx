/**
 * components/MeasurementTrendContainer.tsx — M4「测量值＋趋势」薄取数容器
 *
 * 设计哲学：一个分离 ＋ 两条承诺 —— 容器只做「一次取数 ＋ 状态映射」（状态映射收在 deriveState 一处），
 *   渲染全权交给纯展示组件；承诺 ① 渲染路径无阻塞（首渲染即 loading，不白屏）；
 *   承诺 ② 降级显式（loader 契约不抛；万一抛错也转 degraded + console.error，不留未处理 rejection）。
 *
 * 契约（铁律 47）:
 *   @input   onOpenOnePager?: () => void —— 一页纸入口回调，由 RightPanel 传入 `() => setTab('report')`；
 *            base?: string —— API 源，缺省 loader 取 getApiBase()（测试注入真 express）。
 *   @output  <MeasurementTrendSection view state onOpenOnePager />：首渲染 loading；取回后
 *            !ok||degraded ⇒ degraded；ok 且 summary 空 ⇒ empty；否则 ready。
 *   @degraded loader 返回 ok=false（本容器不再重试/轮询）；loader 契约外抛错 ⇒ console.error +
 *            显式 degraded view（UNEXPECTED_LOADER_REJECTION），不白屏、不写假数据（铁律 11/31）。
 *   @authority 只被 RightPanel 的 GAWorkspaceTabs 挂载一次；本文件不写任何业务数据，不读全局 store。
 *   @not-here 不做写侧/标定/报告链；不做刷新按钮、轮询、缓存（M4 只要求取一次并可见）。
 *
 * 已知限制（DSH 代码标准 C）:
 *   · 无手动刷新/定时刷新（切 tab 重新挂载才会再取；轮询/缓存另批）。
 *   · 无「重试」按钮：降级态只展示原因，用户可切 tab 或重启后重试（避免新增交互面）。
 *   · base 变化才重新取数；onOpenOnePager 变化不触发取数（回调不参与取数语义）。
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

/**
 * MeasurementTrendContainer — 取数容器（挂载点：RightPanel GAWorkspaceTabs）。
 * @input  — props（见函数签名；回调与 base 均由上级注入）
 * @output — MeasurementTrendSection 的四态渲染树
 * @degraded — loader 失败 ⇒ degraded 态；loader 契约外抛错 ⇒ 显式 degraded view（留痕）
 * @error  — 不抛（catch 内转 degraded）
 */
export const MeasurementTrendContainer: React.FC<{ onOpenOnePager?: () => void; base?: string }> = ({
  onOpenOnePager,
  base,
}) => {
  const [view, setView] = useState<MeasurementTrendsView | null>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    loadMeasurementTrends(base)
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
  }, [base]);

  return <MeasurementTrendSection view={view} state={deriveState(view)} onOpenOnePager={onOpenOnePager} />;
};
