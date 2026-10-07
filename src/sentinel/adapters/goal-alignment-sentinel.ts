// @deprecated — 能力被S1覆盖，Phase 5上线时删除
/**
 * sentinel/adapters/goal-alignment-sentinel.ts — 目标对齐度哨兵 (D2)
 * @state: real
 *
 * 检测组织-团队-个人目标之间的对齐偏差。从 SOG 图 GOAL 节点 + TEAM 节点分析。
 * 每周一9:00巡检。
 */

import type { Sentinel, SentinelCheckResult, SentinelConfig, SentinelContext, SentinelFinding } from '../types';
import { discoverTeams } from './helpers';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/goal-alignment');

const config: SentinelConfig = {
  id: 'sentinel-goal-alignment', name: '目标对齐度', description: '检测组织/团队/个人目标之间的对齐偏差。数据源:SOG GOAL+TEAM节点。', category: 'capability', priority: 'P2', mode: 'cron', cron: '0 9 * * 1', requiredDataSources: ['sog_graph'], confidenceModel: 'deterministic', version: '2.0.0',
};

export const goalalignmentSentinel: Sentinel = {
  config,
  async check(context: SentinelContext): Promise<SentinelCheckResult> {
    const { now } = context; const checkedAt = now.toISOString(); const startTime = Date.now();
    try {
      const teams = discoverTeams(context);
      // #1376: **显式取用** raw 能力；缺席 ⇒ 显式降级（warn + degraded）
      const rawDb = context.rawDb ?? null;
      if (!rawDb) log.warn({ sentinelId: config.id }, 'rawDb 能力缺席 ⇒ 降级：跳过 GOAL/TEAM 读取');
      const db = rawDb as { prepare(sql: string): { all(): Array<Record<string, unknown>> } } | null;
      const allFindings: SentinelFinding[] = [];
      const goals: Array<{ id: string; name: string; level: string; parentId?: string }> = [];
      const teams_list: Array<{ id: string; name: string }> = [];
      if (db) {
        try {
          const goalRows = db.prepare("SELECT id, props FROM graph_nodes WHERE type = 'GOAL' AND props IS NOT NULL").all();
          for (const r of goalRows) {
            const p = typeof r.props === 'string' ? JSON.parse(r.props as string) : (r.props || {});
            goals.push({ id: r.id as string, name: (p.name || r.id) as string, level: (p.level || p.scope || 'unknown') as string, parentId: p.parentGoalId as string | undefined });
          }
          const teamRows = db.prepare("SELECT id, props FROM graph_nodes WHERE type = 'TEAM' AND props IS NOT NULL").all();
          for (const r of teamRows) { const p = typeof r.props === 'string' ? JSON.parse(r.props as string) : (r.props || {}); teams_list.push({ id: r.id as string, name: (p.name || r.id) as string }); }
        } catch (err) { log.warn({ err }, '目标/团队数据读取失败 — degraded'); }
      }
      if (goals.length === 0 && teams_list.length === 0) return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: true };
      // 检查：团队级目标是否有父目标（对齐到组织目标）
      const orgGoals = goals.filter(g => g.level === 'org' || g.level === 'organization');
      const teamGoals = goals.filter(g => g.level === 'team');
      const orphanGoals = teamGoals.filter(g => !g.parentId);
      const teamId = teams[0] || 'default';
      if (orgGoals.length > 0 && orphanGoals.length > 0) {
        allFindings.push({ id: `ga-orphan-${teamId}-${now.getTime()}`, severity: 'warning', title: `${orphanGoals.length} 个团队目标未对齐到组织目标`, description: `${teams_list.length}个团队中，${orphanGoals.length}个团队目标(${orphanGoals.map(g => g.name).join(', ')})无父目标`, evidence: [`组织目标: ${orgGoals.length}`, `团队目标: ${teamGoals.length}`, `未对齐: ${orphanGoals.length}`], suggestion: '检查团队目标是否与组织战略方向一致。未对齐可能意味着团队在错误的方向上投入资源。', detectedAt: checkedAt });
      }
      if (teams_list.length > 0 && goals.length < teams_list.length) {
        allFindings.push({ id: `ga-count-${teamId}-${now.getTime()}`, severity: 'info', title: `${teams_list.length - goals.length} 个团队无目标`, description: `${teams_list.length}个团队但只有${goals.length}个目标节点。`, evidence: [`团队: ${teams_list.length}`, `目标: ${goals.length}`], suggestion: '为无目标的团队建立OKR或季度目标。', detectedAt: checkedAt });
      }
      return { sentinelId: config.id, ok: true, findings: allFindings, durationMs: Date.now() - startTime, checkedAt, degraded: false };
    } catch (err: unknown) { return { sentinelId: config.id, ok: false, findings: [], durationMs: Date.now() - startTime, checkedAt, error: (err as Error)?.message || String(err), degraded: true }; }
  },
};
