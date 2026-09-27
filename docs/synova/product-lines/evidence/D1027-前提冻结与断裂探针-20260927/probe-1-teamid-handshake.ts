/**
 * 前提冻结探针（只读仓库，不改任何产品文件）
 * 目的：物理验证「生产 ingest → 哨兵 queryNodes(teamId) 读不到」是否为真断裂。
 * 运行：npx tsx --tsconfig <repo>/tsconfig.json /tmp/synova-probe-teamid.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SqliteGraphStore } from '/Users/wane/SynovaAgent/src/adapters/sqlite-graph-store';
import { ingestBatch, loadFieldMapping } from '/Users/wane/SynovaAgent/src/agent/data-ingest-service';
import { marginHealthSentinel } from '/Users/wane/SynovaAgent/extensions/sentinels/margin-health/aggregate';

async function main() {
  const TEAM = 'wani-baby';
  
  /** 真实冻结数据（data/golden/wani-baby-v1.json）推导：见 evidence 说明 */
  const golden = JSON.parse(
    require('fs').readFileSync('/Users/wane/SynovaAgent/data/golden/wani-baby-v1.json', 'utf-8'),
  );
  const revenue = golden.financial.revenue.reduce((a: number, b: number) => a + b, 0);
  const totalCost = golden.financial.cost.reduce((a: number, b: number) => a + b, 0);
  const grossProfit = golden.financial.grossMargin * revenue; // ratio → 金额制
  const cogs = revenue - grossProfit;
  const operatingExpense = totalCost - cogs;
  const fixedCost = golden.financial.fixedCostRatio * totalCost;
  
  const row: Record<string, unknown> = {
    营业收入: revenue,
    毛利润: grossProfit,
    营业费用: operatingExpense,
    总成本: totalCost,
    固定成本: fixedCost,
    期间: '2025-Q4',
  };
  
  const mapping = loadFieldMapping('erp-standard');
  if (!mapping) throw new Error('erp-standard 映射未加载');
  
  const db = new Database(':memory:');
  const store = new SqliteGraphStore(db);
  
  const r = await ingestBatch(
    store as unknown as { createNode(t: string, p: Record<string, unknown>, g: string): string },
    mapping,
    [row],
    'default',
  );
  console.log('[A] ingestBatch →', JSON.stringify(r));
  
  console.log('[B] queryNodes("Financial") 无过滤 →', store.queryNodes('Financial').length);
  console.log('[C] queryNodes("Financial", {teamId}) →', store.queryNodes('Financial', { teamId: TEAM }).length);
  console.log('[D] 节点 props keys →', JSON.stringify(Object.keys(JSON.parse(
    (db.prepare('SELECT props FROM graph_nodes LIMIT 1').get() as { props: string }).props,
  ))));
  
  marginHealthSentinel.manifest = JSON.parse(
    require('fs').readFileSync('/Users/wane/SynovaAgent/extensions/sentinels/margin-health/manifest.json', 'utf-8'),
  );
  const blind = await marginHealthSentinel.check(store as never, TEAM);
  console.log('[E] 哨兵 findings（现状）→', JSON.stringify(blind.map((f) => [f.id, f.severity])));
  
  // 反事实：把 teamId 写进 props（模拟"接线补上"）
  const nid = (db.prepare('SELECT id FROM graph_nodes LIMIT 1').get() as { id: string }).id;
  const p = JSON.parse((db.prepare('SELECT props FROM graph_nodes WHERE id=?').get(nid) as { props: string }).props);
  p.teamId = TEAM;
  db.prepare('UPDATE graph_nodes SET props=? WHERE id=?').run(JSON.stringify(p), nid);
  console.log('[F] 补 teamId 后 queryNodes(...,{teamId}) →', store.queryNodes('Financial', { teamId: TEAM }).length);
  const seen = await marginHealthSentinel.check(store as never, TEAM);
  for (const f of seen) console.log(`[G] finding ${f.id} | ${f.severity} | ${f.title} | ev=${JSON.stringify(f.evidence)}`);
  
}
main().catch(e => { console.error('PROBE FAILED:', e); process.exit(1); });
