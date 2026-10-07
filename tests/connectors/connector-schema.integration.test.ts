/**
 * tests/connectors/connector-schema.integration.test.ts — #1384 跨模块集成（真本体文件 + 真导入链路）
 * 覆盖：本体 schema 真值（requiredProps 从 extensions/ontology/*.json 读）+ 真实 CSV 导入 ⇒ 哨兵产出 全链。
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { CsvImportConnector } from '../../src/connectors/csv-import';
import { checkRequiredProps, resolveEntityType } from '../../src/connectors/connector-schema';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

describe('#1384 集成：本体 schema 真值 + 真实导入 ⇒ 哨兵产出', () => {
  it('真本体文件：resource/money 需 entity_type；activity/learning 需 name', () => {
    expect(checkRequiredProps('resource/money', {}).required).toContain('entity_type');
    expect(checkRequiredProps('activity/learning', {}).required).toContain('name');
    expect(resolveEntityType().value).toBeNull();   // 无定义 ⇒ null + warn（CTO 裁 b）
  });

  it('🔴 真实 CSv 导入（含收入+成本）⇒ 哨兵写出 metric 行且数值正确', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const connector = new CsvImportConnector(
      { createNode: (type, props, graph) => store.createNode(type, props, graph) }, 'enterprise');
    const res = connector.importData('date,amount,category\n2026-09-01,1000,revenue\n2026-09-02,300,cogs\n');
    expect(res.imported).toBe(2);

    const rows = await runSentinel(db);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find(r => r.metric_id === 'CASH-FLOW-GROSS-MARGIN')?.value).toBeCloseTo(0.7, 5);
  });
});

async function runSentinel(db: InstanceType<typeof Database>): Promise<Array<{ metric_id: string; value: number; org_id: string }>> {
  const sink = createMetricSink(db);
  const r = await cashFlowSentinel.check({ db: {}, rawDb: db, teamId: 'org-int', metricSink: sink, now: new Date('2026-10-08T00:00:00Z') });
  expect(r.degraded).toBe(false);
  return db.prepare('SELECT metric_id, value, org_id FROM metric_readings').all() as Array<{ metric_id: string; value: number; org_id: string }>;
}
