/**
 * tests/fixtures/sentinel-determinism/determinism-demo/aggregate.ts
 * 确定性契约夹具的 aggregate 入口（**夹具输入，不是产品代码**）。
 *
 * 契约（对齐 src/sentinel/sentinel-loader.ts 的动态加载约定）：
 *   - exportKey = determinismDemoSentinel（manifest.exportKey 声明）
 *   - check(store, teamId) → { findings, metrics, degraded }（对象形态：loader 会传播 degraded）
 *   - 读固定图（Agent ×2 一监控一未监控；Tool ×1 无错误）⇒ autonomy=0.5、monitored=1
 *   - 分值 = computes/score.ts 的确定性函数 ⇒ 基线 0.75；改权重常量 ⇒ 0.7
 *   - 读空 ⇒ { findings: [], metrics: [], degraded: true }（显式降级，不静默、不编分值）
 *
 * 为什么带 detectedAt：真实哨兵都带该字段且逐跑不同，契约测试必须证明
 * 稳定投影把它剔除（否则「两次一致」只是把时钟一起比）。
 */
import { computeDeterminismScore, describeDeterminismScore } from './computes/score';

interface GraphNodeRow {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

interface GraphStoreLike {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): GraphNodeRow[];
}

export const determinismDemoSentinel = {
  async check(store: unknown, _teamId: string) {
    const graph = store as GraphStoreLike;
    const canQuery = typeof graph?.queryNodes === 'function';
    const agents = canQuery ? graph.queryNodes('Agent') : [];
    const tools = canQuery ? graph.queryNodes('Tool') : [];

    if (agents.length === 0) {
      return { findings: [], metrics: [], degraded: true };
    }

    const autonomy = agents.filter((a) => a.props.monitored === true).length / agents.length;
    const monitored = tools.length === 0 ? 0 : tools.filter((t) => t.props.error !== true).length / tools.length;
    const score = computeDeterminismScore({ autonomy, monitored });

    return {
      findings: [
        {
          id: 'f-determinism-demo-score',
          severity: 'warning',
          polarity: 'negative',
          title: '确定性契约夹具: 评分样本',
          description: describeDeterminismScore(score),
          evidence: [`score=${score}`, `autonomy=${autonomy}`, `monitored=${monitored}`],
          suggestion: 'n/a（确定性契约夹具，不是业务告警）',
          detectedAt: new Date().toISOString(),
        },
      ],
      metrics: [
        {
          metricId: 'DETERMINISM-DEMO-SCORE',
          value: score,
          unit: 'ratio',
          sourceId: 'determinism-demo',
        },
      ],
      degraded: false,
    };
  },
};
