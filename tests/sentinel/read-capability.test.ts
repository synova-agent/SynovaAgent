/**
 * tests/sentinel/read-capability.test.ts — #1376 runner 侧读能力（graphStore / rawDb）判据载体
 *
 * 覆盖面（逐字）：**raw prepare 依赖 = 4 个调用点（3 哨兵 + 1 helper），全部在 `src/sentinel/adapters/`；
 *   `extensions/sentinels/**` 侧 0 个（43 走 queryNodes、2 无图读）；其余哨兵不依赖 raw。**
 * 判据身份：`V2`（**经 runner 真路径写出 ≥1 行** = R61 防护）、`V3`（逐条点名）\+ 边界（缺席即降级，不静默）。
 * 库口径：`:memory:`（禁 `data/synova.db`）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import type { SentinelContext, SentinelCheckResult } from '../../src/sentinel/types';

const RAW_PREPARE_SITES = [
  'src/sentinel/adapters/cash-flow-sentinel.ts',
  'src/sentinel/adapters/goal-alignment-sentinel.ts',
  'src/sentinel/adapters/integration-health-sentinel.ts',
  'src/sentinel/adapters/helpers.ts',
] as const;

describe('#1376 runner 侧读能力', () => {
  it('V3 静态点名：4 个 raw prepare 调用点均已改为【显式取用 context.rawDb】（旧隐式形状断言零残留）', () => {
    for (const rel of RAW_PREPARE_SITES) {
      const src = readFileSync(join(process.cwd(), rel), 'utf-8');
      expect(src, `${rel} 应显式取用 context.rawDb`).toContain('context.rawDb');
      expect(src, `${rel} 不应再有 context.db as { prepare 的隐式形状断言`).not.toContain('context.db as { prepare');
    }
  });

  it('V2 🔴 经 runner 真路径写出 ≥1 行（R61 防护）：runOrgWriteRound ⇒ 每 org 落 metric 行', async () => {
    const raw = new Database(':memory:');
    const store = new SqliteGraphStore(raw);                  // 建 schema + 迁移（含 orgs）
    // 财务数据（cash-flow 经**映射**读本体轴；租户载体 = props.orgId）
    //   ⚠️ #1381 必要连带：类型由 'FINANCIAL'（**生产中无写入者**）改为本体轴 'resource/money'
    store.createNode('resource/money', { orgId: 'org-A', revenue: 1000, cost: 200, operating_expenses: 300, cash_balance: 5000, period: '2026-09' });
    store.createNode('resource/money', { orgId: 'org-B', revenue: 2000, cost: 500, operating_expenses: 300, cash_balance: 8000, period: '2026-09' });
    const { CronScheduler } = await import('../../src/cron/scheduler');
    const { SentinelRunner } = await import('../../src/sentinel/runner');
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');
    const { cashFlowSentinel } = await import('../../src/sentinel/adapters/cash-flow-sentinel');
    const scheduler = new CronScheduler(raw);
    const runner = new SentinelRunner(scheduler, raw);

    // ⚠️ 顺序同 #1371 的通过用例：orgs 在**构造 runner 之后**插入（构造期似乎会重置/另建 in-memory 句柄）
    const ins = raw.prepare('INSERT INTO orgs (org_id, status, source) VALUES (?, ?, ?)');
    ins.run('org-A', 'active', 'manual'); ins.run('org-B', 'active', 'manual');
    try {
      getSentinelRegistry().register(cashFlowSentinel);
      // 诊断：插入后行数 + 函数读数（区分"行没了" vs "函数读数失败"）
      const orgRowsNow = raw.prepare('SELECT org_id, status FROM orgs ORDER BY org_id').all() as Array<{ org_id: string; status: string }>;
      const { listActiveOrgs } = await import('../../src/sentinel/org-registry');
      const viaFn = listActiveOrgs(raw);
      expect({ rows: orgRowsNow, viaFn }).toEqual({ rows: [{ org_id: 'org-A', status: 'active' }, { org_id: 'org-B', status: 'active' }], viaFn: ['org-A', 'org-B'] });
      // 🔴 决定性对照：同夹具内跑"探针哨兵"（#1371 ⑤ 通过形态）与"真实哨兵"
      const PROBE = { config: { id: 'sentinel-probe-a', name: 'probe', description: '', category: 'growth' as const, priority: 'P1' as const, mode: 'manual' as const, version: '1', requiredDataSources: [], confidenceModel: 'deterministic' as const }, async check(): Promise<SentinelCheckResult> { return { sentinelId: 'sentinel-probe-a', ok: true, findings: [], durationMs: 0, checkedAt: new Date().toISOString() }; } };
      getSentinelRegistry().register(PROBE);
      const ranProbe = await runner.runOrgWriteRound('sentinel-probe-a');
      getSentinelRegistry().unregister('sentinel-probe-a');
      console.log('[DIAG] ranProbe =', JSON.stringify(ranProbe));
      const orgsAfterProbe = (raw.prepare('SELECT org_id FROM orgs ORDER BY org_id').all() as Array<{ org_id: string }>).map(r => r.org_id);
      console.log('[DIAG] orgs after probe round =', JSON.stringify(orgsAfterProbe));

      const ran = await runner.runOrgWriteRound(cashFlowSentinel.config.id);
      const orgsAfterCf = (raw.prepare('SELECT org_id FROM orgs ORDER BY org_id').all() as Array<{ org_id: string }>).map(r => r.org_id);
      console.log('[DIAG] ranCf =', JSON.stringify(ran), '｜ orgs after cash-flow round =', JSON.stringify(orgsAfterCf));
      expect(ran).toEqual(['org-A', 'org-B']);

      // 调用后诊断：orgs 行是否仍在（若消失 ⇒ 有删除者）
      const orgRowsAfter = raw.prepare('SELECT org_id FROM orgs ORDER BY org_id').all() as Array<{ org_id: string }>;
      expect(orgRowsAfter.map(r => r.org_id)).toEqual(['org-A', 'org-B']);

      const rows = raw.prepare('SELECT org_id, COUNT(*) AS n FROM metric_readings GROUP BY org_id ORDER BY org_id').all() as Array<{ org_id: string; n: number }>;
      expect(rows.map(r => r.org_id)).toEqual(['org-A', 'org-B']);   // 行级租户正确
      expect(rows.every(r => r.n >= 1)).toBe(true);                   // 🔴 **≥1 行/org**（修前 = 0 行）
      expect(rows.some(r => r.org_id === 'default')).toBe(false);

      // 对照（断言之后）：绕过 runner 直调哨兵 ⇒ 同样能写（证明能力契约本身可用，不依赖 runner）
      const { createMetricSink } = await import('../../src/sentinel/metric-readings-writer');
      const direct = await cashFlowSentinel.check({ db: {}, rawDb: raw, teamId: 'org-Z', metricSink: createMetricSink(raw), now: new Date('2026-10-08T00:00:00Z') });
      expect(direct.degraded).toBe(false);
    } finally {
      getSentinelRegistry().unregister(cashFlowSentinel.config.id);
      scheduler.stop();
      raw.close();
    }
  });

  it('边界：rawDb 缺席 ⇒ **显式降级**（warn + degraded），不静默、不假装成功', async () => {
    const { cashFlowSentinel } = await import('../../src/sentinel/adapters/cash-flow-sentinel');
    const ctx: SentinelContext = { db: {}, now: new Date('2026-10-08T00:00:00Z'), teamId: 'org-X' };
    const r = (await cashFlowSentinel.check(ctx)) as SentinelCheckResult;
    expect(r.degraded).toBe(true);      // 无 rawDb ⇒ 降级路径（而非静默空结果）
    expect(r.findings).toHaveLength(0);
  });
});
