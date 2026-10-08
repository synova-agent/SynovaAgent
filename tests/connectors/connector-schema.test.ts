/**
 * tests/connectors/connector-schema.test.ts — #1384 单元判据（映射拆分 + 写入侧 schema 校验）
 * 硬要求（CTO）：词表/requiredProps **只在文件里**（禁代码硬编码）；未识别 ⇒ null + warn（不猜）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { CsvImportConnector } from '../../src/connectors/csv-import';
import { splitAmountByCategory, resolveEntityType, checkRequiredProps } from '../../src/connectors/connector-schema';
import { cashFlowSentinel } from '../../src/sentinel/adapters/cash-flow-sentinel';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

describe('#1384 amount 语义拆分（文件化词表）', () => {
  it('V1a 收入族 ⇒ total_revenue；成本族 ⇒ total_cost', () => {
    expect(splitAmountByCategory('revenue').field).toBe('total_revenue');
    expect(splitAmountByCategory('收入').field).toBe('total_revenue');
    expect(splitAmountByCategory('cogs').field).toBe('total_cost');
    expect(splitAmountByCategory('成本').field).toBe('total_cost');
  });

  it('V1b 未识别 / 缺省 ⇒ null + warn（不猜）', () => {
    for (const c of ['uncategorized', 'misc', '', undefined]) {
      const r = splitAmountByCategory(c as string | undefined);
      expect(r.field, `category=${String(c)} 应不落字段`).toBeNull();
      expect(r.warn).toBe(true);
    }
  });

  it('V1c 词表在【文件】里（实现代码零硬编码词表）', () => {
    const src = readFileSync('src/connectors/connector-schema.ts', 'utf-8');
    expect(src).not.toMatch(/'revenue'|'cogs'|'成本'/);
    const file = JSON.parse(readFileSync('extensions/ontology/field-mappings/csv-money.json', 'utf-8')) as { rules: Array<{ categories: string[] }> };
    const all = file.rules.flatMap(r => r.categories);
    expect(all).toContain('revenue');
    expect(all).toContain('cogs');
  });

  it('V1d entity_type：本体 requiredProps 但仓内无定义 ⇒ null + warn（CTO 裁 b）', () => {
    const e = resolveEntityType();
    expect(e.value).toBeNull();
    expect(e.warn).toBe(true);
  });
});

describe('#1384 写入侧 schema 校验', () => {
  it('V3a 缺失 requiredProps ⇒ ok=false + missing 点名（resource/money 需 entity_type）', () => {
    const r = checkRequiredProps('resource/money', { amount: 100, date: '2026-09-01' });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('entity_type');
    expect(r.required).toContain('entity_type');
  });

  it('V3b 满足 requiredProps ⇒ ok=true', () => {
    expect(checkRequiredProps('resource/person', { name: '张三' }).ok).toBe(true);
  });

  it('V3c 空串/undefined/null 视为缺失', () => {
    expect(checkRequiredProps('resource/person', { name: '' }).ok).toBe(false);
    expect(checkRequiredProps('resource/person', {}).ok).toBe(false);
    expect(checkRequiredProps('resource/person', { name: null }).ok).toBe(false);
  });

  it('V3d schema 不可读 ⇒ fail-open（ok=true）+ 不抛（显式降级）', () => {
    const r = checkRequiredProps('not/a-real-type', { x: 1 });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe('#1384 V2 主链路端到端（真实导入 ⇒ 哨兵产出）', () => {
  it('🔴 真实 importData ⇒ 节点落本体轴 + 本体字段名 ⇒ cash-flow 写出 metric 行（org 正确）', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const connector = new CsvImportConnector(
      { createNode: (type, props, graph) => store.createNode(type, props, graph) }, 'enterprise');
    const res = connector.importData('date,amount,category\n2026-09-01,1000,revenue\n2026-09-02,300,cogs\n');
    expect(res.imported).toBe(2);

    const nodes = store.queryNodes('resource/money', {}, 'enterprise') as Array<{ props: Record<string, unknown> }>;
    const propsArr = nodes.map(n => (typeof n.props === 'string' ? JSON.parse(n.props as string) : n.props) as Record<string, unknown>);
    expect(propsArr.some(p => Number(p.total_revenue) === 1000)).toBe(true);
    expect(propsArr.some(p => Number(p.total_cost) === 300)).toBe(true);

    const sink = createMetricSink(db);
    const r = await cashFlowSentinel.check({ db: {}, rawDb: db, teamId: 'org-e2e', metricSink: sink, now: new Date('2026-10-08T00:00:00Z') });
    expect(r.degraded).toBe(false);
    const rows = db.prepare('SELECT metric_id, value, org_id FROM metric_readings').all() as Array<{ metric_id: string; value: number; org_id: string }>;
    expect(rows.length).toBeGreaterThan(0);                          // 🔴 哨兵产出（修前 = 0）
    expect(rows.every(x => x.org_id === 'org-e2e')).toBe(true);
    expect(rows.find(x => x.metric_id === 'CASH-FLOW-GROSS-MARGIN')?.value).toBeCloseTo(0.7, 5);
  });

  it('V2-b 未识别 category ⇒ 不落字段（不猜）+ 导入 warnings 点名', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const connector = new CsvImportConnector(
      { createNode: (type, props, graph) => store.createNode(type, props, graph) }, 'enterprise');
    const res = connector.importData('date,amount,category\n2026-09-01,500,misc\n');
    expect(res.imported).toBe(1);
    const props = (store.queryNodes('resource/money', {}, 'enterprise') as Array<{ props: Record<string, unknown> }>)
      .map(n => (typeof n.props === 'string' ? JSON.parse(n.props as string) : n.props) as Record<string, unknown>);
    expect(props[0].total_revenue).toBeUndefined();
    expect(props[0].total_cost).toBeUndefined();
    expect(res.warnings.some(w => w.includes('unmatched category'))).toBe(true);
  });
});
