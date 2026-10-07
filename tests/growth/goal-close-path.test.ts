/**
 * tests/growth/goal-close-path.test.ts — #1010 Goal 关闭路径接线（生产入口闭环）
 *
 * 判据（卡 #1010）：断言 closeGoal 的副作用**可观测** ——
 *   ① goal 状态转 completed  ② 知识写入 PKB（knowledge_chunks.source_type='goal_execution'）
 *   ③ verifyEffect 产出（EffectReport 落 agent_memory，tags 含 effect_verification）
 *
 * 三路径：
 *   正常 —— 成功条件全部 verified ⇒ 经 **生产入口** `defaultDiagnosisHandler`（loop-1）走关闭路径
 *   降级 —— 审计存储不可用 ⇒ fail-closed 不闭环 + 计数进 output（不静默，铁律 24/31）
 *   边界 —— 成功条件未验证 / 无成功条件 ⇒ 不闭环，仍走既有再诊断
 *
 * 夹具用真实 `SqliteGraphStore`（临时库）—— 这同时验证 #1010 的核心修复：
 * 真实 store 节点 id 为 `node-<uuid>`、goalId 只在 props 里，关闭路径必须按 props.goalId 解析。
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 🔴 必须先于 initEngineContext() 落 env（仓库既有惯例：tests/security/knowledge-audit-attribution.test.ts）
const TMP_DIR = mkdtempSync(join(tmpdir(), 'k6-d1193-'));
process.env.SYNOVA_DB_PATH = join(TMP_DIR, 'goal-close.db');
process.env.JWT_SECRET = 'd1193-goal-close-secret-0123';
process.env.DEV_MODE = 'false';

import { initEngineContext, getDatabase, closeEngineContext } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { createGoal } from '../../src/growth/goal-store';
import { setDiagnosisDeps, defaultDiagnosisHandler } from '../../src/agent/loop-handlers';
import { getAgentMemoryStore } from '../../src/l4/agent-memory-store';
import { KnowledgeStore } from '../../src/l4/knowledge-store';
import type { AuditStoreLike, Goal, GraphBridgeLike } from '../../src/growth/goal-types';

const VERIFIED = { criterion: '月度营收 ≥ 500 万', verificationMethod: 'metric_threshold' as const, verified: true };
const UNVERIFIED = { criterion: '月度营收 ≥ 500 万', verificationMethod: 'metric_threshold' as const, verified: false };

function baseGoal(overrides: Partial<Goal>): Goal {
  return {
    goalId: '', orgId: 'org-d1193', proposalId: '', diagnosisId: '',
    title: 'D1193 闭环判据目标', description: '', priority: 'P1',
    status: 'active', ownerDeptId: 'dept-growth',
    createdAt: new Date().toISOString(), deadline: new Date(Date.now() + 86400000).toISOString(),
    metrics: [{ metricName: '营收', currentValue: 15, targetValue: 15, unit: '%', computeContractId: 'C1' }],
    successCriteria: [VERIFIED], dependsOn: [], conflictsWith: [], reDiagnosisCount: 0,
    createdBy: { role: 'system' }, lastModifiedAt: new Date().toISOString(), plannedDurationDays: 90,
    ...overrides,
  };
}

/** 审计 spy：记录写入条目，供"闭环审计可观测"断言 */
function auditSpy(): { audit: AuditStoreLike; rows: Array<{ action: string; targetId?: string }> } {
  const rows: Array<{ action: string; targetId?: string }> = [];
  return {
    rows,
    audit: { write: async (e) => { rows.push({ action: e.action, targetId: e.targetId }); return `audit-${rows.length}`; } },
  };
}

function knowledgeCount(): number {
  const r = getDatabase().prepare(
    `SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_type = 'goal_execution'`,
  ).get() as { c: number };
  return r.c;
}

function effectReportCount(): number {
  const r = getDatabase().prepare(
    `SELECT COUNT(*) AS c FROM agent_memory WHERE tags LIKE '%effect_verification%'`,
  ).get() as { c: number };
  return r.c;
}

function goalStatus(store: GraphBridgeLike, goalId: string): string {
  const rows = store.queryNodes('GOAL', { goalId }, 'growth');
  const hit = rows.find((n) => String((n.props as { goalId?: string }).goalId) === goalId);
  return String((hit?.props as { status?: string } | undefined)?.status ?? '(missing)');
}

let store: SqliteGraphStore;

beforeAll(() => {
  initEngineContext();
  const db = getDatabase();
  getAgentMemoryStore(db);              // closeGoal → writeEffectReport 用单例
  void new KnowledgeStore(db);          // 建 knowledge_chunks 表（查询前必须先建）
  store = new SqliteGraphStore(db);
});

// 用例隔离：loop-1 每轮只处理 scale 档内的 active 目标（fast=1），残留 GOAL 会互相干扰
beforeEach(() => {
  getDatabase().prepare(`DELETE FROM graph_nodes WHERE type = 'GOAL'`).run();
});

afterAll(() => {
  setDiagnosisDeps(null);
  // 先关引擎上下文（释放 SQLite 句柄）再删临时目录 —— 否则 Windows 上 rmSync 报 EPERM
  closeEngineContext();
  rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('#1010 Goal 关闭路径接线（loop-1 生产入口）', () => {
  it('正常路径: 成功条件已验证 ⇒ 状态转 completed + 知识写入 PKB + EffectReport 产出 + 审计留痕', async () => {
    const goalId = createGoal(baseGoal({}), store, auditSpy().audit, 'growth');
    const knowledgeBefore = knowledgeCount();
    const effectBefore = effectReportCount();
    const { audit, rows } = auditSpy();

    setDiagnosisDeps({
      getStore: () => store,
      getGoal: () => null,   // 闭环路径不再诊断 ⇒ 不应被调用
      callExpert: async () => { throw new Error('不应走到再诊断'); },
      getAudit: () => audit,
    });

    const result = await defaultDiagnosisHandler('fast');

    expect(goalStatus(store, goalId)).toBe('completed');
    expect(knowledgeCount()).toBeGreaterThan(knowledgeBefore);   // ② 知识写入 PKB
    expect(effectReportCount()).toBeGreaterThan(effectBefore);   // ③ verifyEffect 产出
    expect(rows.some((r) => String(r.action).includes('goal.status.active'))).toBe(true); // 审计留痕
    expect(result.output ?? '').toContain('达成闭环 1 个目标');
  });

  it('边界路径: 成功条件未验证 ⇒ 不闭环，仍走再诊断（状态保持 active）', async () => {
    const goalId = createGoal(baseGoal({ successCriteria: [UNVERIFIED] }), store, auditSpy().audit, 'growth');
    setDiagnosisDeps({
      getStore: () => store,
      getGoal: () => ({
        goalId, title: 't', description: '', priority: 'P1', status: 'active',
        ownerDeptId: 'dept-growth', deadline: new Date().toISOString(),
        metrics: [{ metricName: '营收', currentValue: 15, targetValue: 15, unit: '%' }],
        reDiagnosisCount: 0,
      }),
      callExpert: async () => {
        return { suggestedAdjustment: 'adjust_target', description: '未达成 ⇒ 保持目标', degraded: false };
      },
      getAudit: () => auditSpy().audit,
    });

    const result = await defaultDiagnosisHandler('fast');

    expect(goalStatus(store, goalId)).toBe('active');
    expect(result.output ?? '').toContain('达成闭环 0 个目标');
    expect(result.output ?? '').toContain('再诊断 1 个目标');   // 未达成 ⇒ 仍走既有再诊断
  });

  it('边界路径: 无成功条件 ⇒ 不机械判定达成（不误关）', async () => {
    const goalId = createGoal(baseGoal({ successCriteria: [] }), store, auditSpy().audit, 'growth');
    setDiagnosisDeps({
      getStore: () => store,
      getGoal: () => ({
        goalId, title: 't', description: '', priority: 'P1', status: 'active',
        ownerDeptId: 'dept-growth', deadline: new Date().toISOString(),
        metrics: [{ metricName: '营收', currentValue: 15, targetValue: 15, unit: '%' }],
        reDiagnosisCount: 0,
      }),
      callExpert: async () => ({ suggestedAdjustment: 'adjust_target', description: '无成功条件', degraded: false }),
      getAudit: () => auditSpy().audit,
    });

    await defaultDiagnosisHandler('fast');
    expect(goalStatus(store, goalId)).toBe('active');
  });

  it('降级路径: 审计存储取用失败 ⇒ fail-closed 不闭环 + 计数进 output（不静默）', async () => {
    const goalId = createGoal(baseGoal({}), store, auditSpy().audit, 'growth');
    setDiagnosisDeps({
      getStore: () => store,
      getGoal: () => null,
      callExpert: async () => ({ suggestedAdjustment: 'adjust_target', description: 'x', degraded: false }),
      getAudit: () => { throw new Error('audit store unavailable'); },
    });

    const result = await defaultDiagnosisHandler('fast');

    expect(goalStatus(store, goalId)).toBe('active');            // 未闭环（审计缺失 ⇒ 不予静默闭环）
    expect(result.output ?? '').toContain('闭环失败 1 个');
  });
});
