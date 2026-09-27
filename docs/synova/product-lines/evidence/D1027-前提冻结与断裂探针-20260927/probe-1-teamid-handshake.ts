/**
 * D1027 前提冻结探针 1 — 只读仓库，不改任何产品文件。
 *
 * 目的：物理验证「生产 ingest 写入的节点不含 teamId ⇒ 哨兵 queryNodes(type,{teamId}) 恒读不到」
 *       是否为真断裂。
 *
 * 运行（必须在仓库根或任务树根执行；probe 从 cwd 解析仓库根）:
 *   cd <repo-root-or-worktree> && npx tsx --tsconfig tsconfig.json \
 *     docs/synova/product-lines/evidence/D1027-前提冻结与断裂探针-20260927/probe-1-teamid-handshake.ts
 *
 * 说明（修订记录，2026-09-27 由独立自验员实测发现后修）:
 *   v1 把 `require('fs')` 与绝对路径 `/Users/wane/SynovaAgent/...` 硬编码进归档件，导致
 *   ① 仓库 `"type":"module"` 下本文件按 ESM 解析 ⇒ `require is not defined`；
 *   ② 从任务树运行时 import 落到主工作区代码（不是被测代码）。
 *   现改为：import 相对本文件解析（随所在工作树走）+ 数据路径由 cwd 解析。
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SqliteGraphStore } from '../../../../../src/adapters/sqlite-graph-store';
import { ingestBatch, loadFieldMapping } from '../../../../../src/agent/data-ingest-service';
import { marginHealthSentinel } from '../../../../../extensions/sentinels/margin-health/aggregate';

const REPO = process.cwd();

async function main(): Promise<void> {
  const TEAM = 'wani-baby';

  /** 真实冻结数据（data/golden/wani-baby-v1.json）推导；公式见 README §三 */
  const golden = JSON.parse(
    fs.readFileSync(path.join(REPO, 'data/golden/wani-baby-v1.json'), 'utf-8'),
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
    fs.readFileSync(path.join(REPO, 'extensions/sentinels/margin-health/manifest.json'), 'utf-8'),
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

main().catch((e: unknown) => { console.error('PROBE FAILED:', e); process.exit(1); });
