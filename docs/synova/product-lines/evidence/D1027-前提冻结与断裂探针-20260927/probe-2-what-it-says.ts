/**
 * 探针 2：反事实（把 teamId + fixed_cost 补进 props）后，margin-health 对 wani-baby
 * 冻结真实数据会说出的全部 finding —— 用于定验收判据。
 * 只读仓库；不改任何产品文件。
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import { SqliteGraphStore } from '/Users/wane/SynovaAgent/src/adapters/sqlite-graph-store';
import { marginHealthSentinel } from '/Users/wane/SynovaAgent/extensions/sentinels/margin-health/aggregate';
import { cashRunwaySentinel } from '/Users/wane/SynovaAgent/extensions/sentinels/cash-runway/aggregate';
import { revenueHealthSentinel } from '/Users/wane/SynovaAgent/extensions/sentinels/revenue-health/aggregate';

const TEAM = 'wani-baby';
const golden = JSON.parse(fs.readFileSync('/Users/wane/SynovaAgent/data/golden/wani-baby-v1.json', 'utf-8'));
const f = golden.financial;
const revenue = f.revenue.reduce((a: number, b: number) => a + b, 0);
const totalCost = f.cost.reduce((a: number, b: number) => a + b, 0);
const grossProfit = f.grossMargin * revenue;
const cogs = revenue - grossProfit;
const operatingExpense = totalCost - cogs;
const fixedCost = f.fixedCostRatio * totalCost;

console.log('=== 派生量（全部由冻结数据直接计算，公式在 evidence 可核） ===');
console.log({ revenue, totalCost, grossProfit, cogs, operatingExpense, fixedCost,
  fixedRatio: fixedCost / (cogs + operatingExpense), runway: f.currentCashReserve / f.monthlyBurnRate });

async function main() {
  for (const s of [
    ['margin-health', marginHealthSentinel, '/Users/wane/SynovaAgent/extensions/sentinels/margin-health/manifest.json'],
    ['cash-runway', cashRunwaySentinel, '/Users/wane/SynovaAgent/extensions/sentinels/cash-runway/manifest.json'],
    ['revenue-health', revenueHealthSentinel, '/Users/wane/SynovaAgent/extensions/sentinels/revenue-health/manifest.json'],
  ] as Array<[string, { manifest: unknown; check(s: never, t: string): Promise<Array<{ id: string; severity: string; title: string; description: string; evidence: string[] }>> }, string]>) {
    const [name, obj, mpath] = s;
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const props: Record<string, unknown> = {
      teamId: TEAM, financialType: 'erp-standard', period: '2025-Q4',
      total_revenue: revenue, gross_margin: grossProfit, operating_expense: operatingExpense,
      fixed_cost: fixedCost, cash: f.currentCashReserve, monthly_burn: f.monthlyBurnRate,
    };
    (store as unknown as { createNode(t: string, p: Record<string, unknown>, g: string): string })
      .createNode('Financial', props, 'default');
    (obj as { manifest: unknown }).manifest = JSON.parse(fs.readFileSync(mpath, 'utf-8'));

    const findings = await obj.check(store as never, TEAM);
    console.log(`\n=== ${name} → ${findings.length} findings ===`);
    for (const x of findings) {
      console.log(` • [${x.severity}] ${x.id} :: ${x.title}`);
      console.log(`   ${x.description}`);
      console.log(`   evidence=${JSON.stringify(x.evidence)}`);
    }
  }

}
main().catch(e => { console.error('PROBE FAILED:', e); process.exit(1); });
