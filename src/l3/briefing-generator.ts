/**
 * l3/briefing-generator.ts — GNS v2.0 每日简报生成器 (M2-3)
 *
 * 每天 19:00 触发，收集 L4 中所有活跃目标/告警/遗留问题，
 * 格式化为 Markdown，通过 IM 发送。
 *
 * 简报结构:
 *   1. 执行摘要 (一句话)
 *   2. 目标进度 (进度条 + 趋势)
 *   3. 活跃告警 (高→低优先级)
 *   4. 遗留问题
 *   5. 推荐动作
 */
import { getReportTemplateRegistry } from './report-templates';
import { createLogger } from '@synova/logger';
import {
  listDecomposedGoals,
  traceGoalToCompany,
  type GoalAlignmentStore,
} from '../l4/goal-alignment';

const log = createLogger('l3/briefing-generator');

// ═══ Types ═══

/**
 * 目标一致（#190 / K12-07）—— 简报口径：岗位目标能否沿分解边追到公司目标。
 *
 * 为什么进简报: 宪章 §2.7 第④层「目标一致」此前**零载体**（目标之间是孤岛）。
 * 简报是每日触达面 ⇒ 把"哪些目标未接入公司目标链路"变成**每天看得见**的事实，
 * 而不是等目标打架了才发现。
 */
export interface GoalAlignmentSummary {
  /** 可沿 GOAL_DECOMPOSITION 边**逐跳**追到公司目标的岗位目标数 */
  traceable: number;
  /** 追不到公司目标的岗位目标数（链顶未标记公司级 ⇒ 未接入链路） */
  orphan: number;
  /** 未接入链路的标题（最多 5 个，防简报刷屏；全量计数见 orphan） */
  orphanTitles: string[];
  /** 公司级目标 → 分解出的岗位目标数 */
  companyGoals: Array<{ goalId: string; title: string; roleGoals: number }>;
  /** 能力/环境失败（store 无 queryEdges / 读图抛错 / 本体端点矩阵不可用）—— 链路不完整（orphan）不算降级 */
  degraded: boolean;
  errors: string[];
}

export interface DailyBriefing {
  date: string;
  summary: string;
  goals: Array<{ name: string; progress: number; trend: 'up' | 'down' | 'stable' }>;
  alerts: Array<{ description: string; priority: 'high' | 'medium' | 'low'; confidence: number }>;
  obstacles: Array<{ description: string; status: string }>;
  recommendations: string[];
  /** 目标一致口径（#190 / K12-07；见 GoalAlignmentSummary 契约） */
  goalAlignment: GoalAlignmentSummary;
  generatedAt: string;
}

// ═══ BriefingGenerator ═══

export class BriefingGenerator {
  private graphStore: {
    queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; props: Record<string, unknown> }>;
    queryEdges(type?: string, from?: string, to?: string, graph?: string): Array<{ from: string; to: string; type: string; props: Record<string, unknown> }>;
  } | null = null;

  constructor(store?: { queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; props: Record<string, unknown> }>; queryEdges(type?: string, from?: string, to?: string, graph?: string): Array<{ from: string; to: string; type: string; props: Record<string, unknown> }> }) {
    this.graphStore = store || null;
  }

  /** Generate today's briefing from L4 graph data */
  async generate(orgId: string): Promise<DailyBriefing> {
    const briefing: DailyBriefing = {
      date: new Date().toISOString().slice(0, 10),
      summary: '',
      goals: [],
      alerts: [],
      obstacles: [],
      recommendations: [],
      goalAlignment: {
        traceable: 0,
        orphan: 0,
        orphanTitles: [],
        companyGoals: [],
        degraded: false,
        errors: [],
      },
      generatedAt: new Date().toISOString(),
    };

    if (!this.graphStore) {
      briefing.summary = '简报数据不可用——GraphStore 未连接';
      return briefing;
    }

    try {
      // Goals
      const goals = this.graphStore.queryNodes('GOAL', { status: 'active' }, orgId);
      for (const g of goals) {
        const progress = Number(g.props?.progress || 0) * 100;
        briefing.goals.push({
          name: String(g.props?.name || '未命名目标'),
          progress: Math.round(progress),
          trend: progress > 50 ? 'up' : progress > 20 ? 'stable' : 'down',
        });
      }

      // Alerts (RISK nodes with active status)
      const risks = this.graphStore.queryNodes('Risk', { status: 'active' }, orgId);
      for (const r of risks) {
        briefing.alerts.push({
          description: String(r.props?.riskType || r.props?.name || '未命名风险'),
          priority: (['high', 'critical'].includes(String(r.props?.severity || '')) ? 'high' : 'medium') as 'high' | 'medium' | 'low',
          confidence: Number(r.props?.confidence || 0.5),
        });
      }
      // Sort by priority: high first
      briefing.alerts.sort((a, b) => (b.priority === 'high' ? 3 : b.priority === 'medium' ? 2 : 1) - (a.priority === 'high' ? 3 : a.priority === 'medium' ? 2 : 1));

      // Obstacles (PROCESS nodes with tracking/resolved/stale status)
      const processes = this.graphStore.queryNodes('Process', undefined, orgId);
      for (const p of processes) {
        const status = String(p.props?.processType || 'tracking');
        if (status === 'tracking' || status === 'stale') {
          briefing.obstacles.push({
            description: String(p.props?.name || '未命名问题'),
            status,
          });
        }
      }

      // Recommendations
      briefing.goalAlignment = this.summarizeGoalAlignment(this.graphStore, goals, orgId);
      if (briefing.alerts.length > 0) {
        briefing.recommendations.push(`${briefing.alerts.length} 个活跃告警需关注`);
      }
      if (briefing.goals.some(g => g.trend === 'down')) {
        briefing.recommendations.push('部分目标进度下降，建议复盘调整');
      }
      if (briefing.goalAlignment.orphan > 0) {
        briefing.recommendations.push(
          `${briefing.goalAlignment.orphan} 个目标未接入公司目标链路（目标一致 · K12-07）`,
        );
      }
      if (briefing.obstacles.length > 0) {
        briefing.recommendations.push(`${briefing.obstacles.length} 个遗留问题待解决`);
      }
      if (briefing.recommendations.length === 0) {
        briefing.recommendations.push('今日无异常——组织运行平稳 ✅');
      }

      // Summary
      briefing.summary = `${orgId} · ${briefing.goals.length} 目标 · ${briefing.alerts.length} 告警 · ${briefing.obstacles.length} 问题`;

      log.info({ orgId, goals: briefing.goals.length, alerts: briefing.alerts.length },
        '每日简报已生成');
    } catch (err: any) {
      log.warn({ err }, '简报生成失败');
      briefing.summary = '简报生成异常——请检查数据连接';
    }

    return briefing;
  }

  /**
   * 目标一致汇总（#190 / K12-07）—— 逐目标沿分解边追到公司目标；公司级目标反向取分解集合。
   *
   * 契约（铁律 47）:
   *   @input  — store（`GoalAlignmentStore`）/ goals（活跃 GOAL 图节点）/ orgId（图名）
   *   @output — `GoalAlignmentSummary`；`orphan` = 追不到公司目标的岗位目标数（**事实**，非故障）
   *   @degraded — 能力/环境失败 ⇒ `degraded:true` ＋ `log.warn` ＋ 原因进 `errors[]`（铁律 11/24/31）：
   *               store 无 queryEdges / 读图抛错。**orphan 不置 degraded**（数据不完整 ≠ 模块坏了）。
   */
  private summarizeGoalAlignment(
    store: GoalAlignmentStore,
    goals: ReadonlyArray<{ id: string; props: Record<string, unknown> }>,
    orgId: string,
  ): GoalAlignmentSummary {
    const errors: string[] = [];
    const orphanTitles: string[] = [];
    const companyGoals: GoalAlignmentSummary['companyGoals'] = [];
    let traceable = 0;
    let degraded = false;

    try {
      for (const node of goals) {
        const entityId = node.props['goalId'];
        const ref = typeof entityId === 'string' && entityId.length > 0 ? entityId : node.id;
        const title = String(node.props['title'] ?? node.props['name'] ?? node.id);

        const trace = traceGoalToCompany(store, ref, orgId);
        if (trace.degraded) {
          degraded = true;
          errors.push(...trace.errors);
          break; // 能力缺失 ⇒ 后续每个目标都会同因失败，不刷屏
        }
        if (trace.satisfied && trace.hops.length === 0) {
          // 该目标自身即公司级 ⇒ 反查分解出的岗位目标集合
          const children = listDecomposedGoals(store, ref, orgId);
          if (children.degraded) {
            degraded = true;
            errors.push(...children.errors);
            break;
          }
          companyGoals.push({
            goalId: trace.companyGoalId ?? ref,
            title,
            roleGoals: children.roleGoals.length,
          });
          continue;
        }
        if (trace.satisfied) {
          traceable += 1;
        } else {
          orphanTitles.push(title);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`目标一致汇总失败: ${msg}`);
      log.warn({ err: msg, orgId }, '目标一致汇总异常 — degraded（简报其余部分不受影响）');
      degraded = true;
    }

    if (degraded) {
      log.warn({ orgId, errors: errors.length }, '目标一致不可用 — degraded（不静默：原因随简报返回）');
    }
    return {
      traceable,
      orphan: orphanTitles.length,
      orphanTitles: orphanTitles.slice(0, 5),
      companyGoals,
      degraded,
      errors,
    };
  }

  /** Format briefing using registered report template */
  formatMarkdown(briefing: DailyBriefing, template = 'daily_briefing'): string {
    const registry = getReportTemplateRegistry();
    const reportData: import('./report-templates').ReportData = {
      orgId: 'unknown',
      date: briefing.date,
      goals: briefing.goals.map(g => ({ name: g.name, progress: g.progress, status: g.trend, trend: g.trend })),
      alerts: briefing.alerts.map(a => ({ description: a.description, priority: a.priority, confidence: a.confidence })),
      obstacles: briefing.obstacles,
      recommendations: briefing.recommendations,
    };
    return registry.render(template, reportData);
  }
}

// ═══ Singleton ═══

let _instance: BriefingGenerator | null = null;
export function getBriefingGenerator(store?: any, inject?: BriefingGenerator): BriefingGenerator {
  if (inject) { _instance = inject; return inject; }
  if (!_instance) _instance = new BriefingGenerator(store);
  return _instance;
}
