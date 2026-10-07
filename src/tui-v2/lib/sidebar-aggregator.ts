/**
 * tui-v2/lib/sidebar-aggregator.ts — 右边栏数据聚合器
 *
 * 收拢 4 路数据源 → 生成不可变 SidebarSnapshot → SidePanel 纯渲染。
 *
 * 数据源:
 *   goals:     BriefingGenerator → GraphStore.queryNodes('GOAL')
 *   obstacles: DiagnosisEvent.findings → 去重合并
 *   experts:   DiagnosisEvent + ExpertRouter 状态
 *   legacy:    DiagnosisEvent.alerts → 历史追踪
 *
 * 铁律: 不做状态变更, 只做数据聚合。所有 setState 走 Snapshot 单一路径。
 */

export interface GoalItem {
  id: string;
  text: string;
  progressPct: number;
  elapsedDays: number;
  totalDays: number;
  phase: number;
}

export interface ObstacleItem {
  id: string;
  text: string;
  status: 'pending' | 'active' | 'resolved';
  confidence?: number;
  updatedAt: string;
}

export interface ExpertItem {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  elapsed?: string;
  result?: string;
}

export interface LegacyItem {
  id: string;
  title: string;
  foundDate: string;
  status: 'unresolved' | 'in_progress';
}

export type SidebarSectionId = 'goals' | 'obstacles' | 'experts' | 'legacy';

export interface SidebarSection {
  id: SidebarSectionId;
  title: string;
  items: ReadonlyArray<GoalItem | ObstacleItem | ExpertItem | LegacyItem>;
  /** 面板优先级 1-4, 数字越大越优先保留 (auto-collapse 时低优先级先折叠) */
  priority: 1 | 2 | 3 | 4;
}

export interface SidebarSnapshot {
  sections: ReadonlyArray<SidebarSection>;
  phase: number;
  /** 诊断是否活跃 (有 running 中的专家 = 正在诊断) */
  isActive: boolean;
}

// ═══ Aggregator ═══

export class SidebarAggregator {
  private goals = new Map<string, GoalItem>();
  private obstacles = new Map<string, ObstacleItem>();
  private experts = new Map<string, ExpertItem>();
  private legacy = new Map<string, LegacyItem>();
  private currentPhase = 0;
  private active = false;

  // ── Goal 操作 ──

  upsertGoal(goal: GoalItem): void {
    this.goals.set(goal.id, goal);
  }

  removeGoal(id: string): void {
    this.goals.delete(id);
  }

  /** 从 GraphStore 查询结果批量加载目标 */
  loadGoals(graphGoals: Array<{ id: string; text: string; progressPct: number; elapsedDays: number; totalDays: number; phase: number }>): void {
    for (const g of graphGoals) {
      this.goals.set(g.id, {
        id: g.id,
        text: g.text,
        progressPct: g.progressPct,
        elapsedDays: g.elapsedDays,
        totalDays: g.totalDays,
        phase: g.phase,
      });
    }
  }

  // ── Obstacle 操作 ──

  /** 从 diagnosis event findings 合并障碍 (去重: 同名覆盖) */
  mergeObstacles(findings: Array<{ moduleId: string; summary: string; confidence?: number }>): void {
    for (const f of findings) {
      const existing = [...this.obstacles.values()].find(o => o.text === f.summary);
      if (existing) {
        this.obstacles.set(existing.id, {
          ...existing,
          confidence: f.confidence ?? existing.confidence,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const id = `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.obstacles.set(id, {
          id,
          text: f.summary,
          status: 'active',
          confidence: f.confidence,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  resolveObstacle(id: string): void {
    const obs = this.obstacles.get(id);
    if (obs) {
      obs.status = 'resolved';
      obs.updatedAt = new Date().toISOString();
    }
  }

  // ── Expert 操作 ──

  setExperts(experts: Array<{ id: string; name: string; status: ExpertItem['status']; elapsed?: string }>): void {
    for (const e of experts) {
      this.experts.set(e.id, {
        id: e.id,
        name: e.name,
        status: e.status,
        elapsed: e.elapsed,
      });
    }
    this.active = experts.some(e => e.status === 'running' || e.status === 'queued');
  }

  updateExpert(id: string, patch: Partial<Pick<ExpertItem, 'status' | 'elapsed' | 'result'>>): void {
    const expert = this.experts.get(id);
    if (!expert) return;
    if (patch.status !== undefined) expert.status = patch.status;
    if (patch.elapsed !== undefined) expert.elapsed = patch.elapsed;
    if (patch.result !== undefined) expert.result = patch.result;
    // Recalculate isActive
    this.active = [...this.experts.values()].some(e => e.status === 'running' || e.status === 'queued');
  }

  clearExperts(): void {
    this.experts.clear();
    this.active = false;
  }

  // ── Legacy 操作 ──

  addLegacy(issue: { title: string; foundDate?: string; status?: 'unresolved' | 'in_progress' }): void {
    const id = `leg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.legacy.set(id, {
      id,
      title: issue.title,
      foundDate: issue.foundDate || new Date().toISOString().slice(0, 10),
      status: issue.status || 'unresolved',
    });
  }

  resolveLegacy(id: string): void {
    const leg = this.legacy.get(id);
    if (leg) leg.status = 'in_progress';
  }

  // ── Phase ──

  setPhase(phase: number): void {
    this.currentPhase = phase;
    if (phase >= 5) this.active = false;
  }

  // ── Snapshot 生成 ──

  getSnapshot(): SidebarSnapshot {
    const sections: SidebarSection[] = [];

    const goalItems = [...this.goals.values()];
    if (goalItems.length > 0) {
      sections.push({ id: 'goals', title: '增长目标', items: goalItems, priority: 4 });
    }

    const obstacleItems = [...this.obstacles.values()].filter(o => o.status !== 'resolved');
    if (obstacleItems.length > 0) {
      sections.push({ id: 'obstacles', title: `增长障碍 (${obstacleItems.length}项)`, items: obstacleItems, priority: 3 });
    }

    const expertItems = [...this.experts.values()];
    if (expertItems.length > 0) {
      sections.push({ id: 'experts', title: '专家分析', items: expertItems, priority: 2 });
    }

    const legacyItems = [...this.legacy.values()].filter(l => l.status === 'unresolved');
    if (legacyItems.length > 0) {
      sections.push({ id: 'legacy', title: `遗留问题 (${legacyItems.length}项)`, items: legacyItems, priority: 1 });
    }

    return {
      sections,
      phase: this.currentPhase,
      isActive: this.active,
    };
  }

  /** 消费诊断事件 — 批量更新 */
  consumeDiagnosisEvent(event: {
    type: string;
    phase?: number;
    label?: string;
    findings?: Array<{ moduleId: string; summary: string; confidence?: number }>;
    rightColumn?: {
      goals?: Array<{ id: string; name: string; progress: number; status: string }>;
      obstacles?: Array<{ id: string; description: string; status: 'tracking' | 'resolved' | 'stale'; updatedAt: string }>;
    };
  }): void {
    switch (event.type) {
      case 'phase_started':
        if (event.phase !== undefined) this.setPhase(event.phase);
        break;
      case 'phase_completed':
        if (event.phase !== undefined) this.setPhase(event.phase + 1);
        break;
      case 'module_completed':
        if (event.findings) this.mergeObstacles(event.findings);
        break;
      case 'complete':
        this.clearExperts();
        break;
    }

    // 消费 rightColumn 更新 (来自 BriefingGenerator 或 diagnosis 报告)
    if (event.rightColumn) {
      if (event.rightColumn.goals) {
        for (const g of event.rightColumn.goals) {
          this.upsertGoal({
            id: g.id,
            text: g.name,
            progressPct: g.progress,
            elapsedDays: 0,
            totalDays: 0,
            phase: this.currentPhase,
          });
        }
      }
      if (event.rightColumn.obstacles) {
        this.mergeObstacles(
          event.rightColumn.obstacles.map(o => ({
            moduleId: o.id,
            summary: o.description,
          }))
        );
      }
    }
  }

  /** 重置所有数据 */
  reset(): void {
    this.goals.clear();
    this.obstacles.clear();
    this.experts.clear();
    this.legacy.clear();
    this.currentPhase = 0;
    this.active = false;
  }
}
