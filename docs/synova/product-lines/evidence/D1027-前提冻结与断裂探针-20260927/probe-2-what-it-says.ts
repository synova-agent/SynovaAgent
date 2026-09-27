/**
 * D1027 前提冻结探针 2 — 只读仓库，不改任何产品文件。
 *
 * 目的：反事实——把 teamId + fixed_cost 补进 props 后，各哨兵对 wani-baby 冻结真实数据
 *       到底会说出什么（用于定验收判据：哪条是真业务问题、哪条是编造的假 finding）。
 *
 * 运行（必须在仓库根或任务树根执行；probe 从 cwd 解析仓库根）:
 *   cd <repo-root-or-worktree> && npx tsx --tsconfig tsconfig.json \
 *     docs/synova/product-lines/evidence/D1027-前提冻结与断裂探针-20260927/probe-2-what-it-says.ts
 *
 * 说明（修订记录，2026-09-27）: 同 probe-1 —— 绝对 import 改为相对本文件解析，
 * 数据路径由 cwd 解析，避免"从任务树跑却测到主工作区代码"。
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SqliteGraphStore } from '../../../../../src/adapters/sqlite-graph-store';
import { marginHealthSentinel } from '../../../../../extensions/sentinels/margin-health/aggregate';
import { cashRunwaySentinel } from '../../../../../extensions/sentinels/cash-runway/aggregate';
import { revenueHealthSentinel } from '../../../../../extensions/sentinels/revenue-health/aggregate';

const REPO = process.cwd();
const TEAM = 'wani-baby';

interface Findings {
  id: string; severity: string; title: string; description: string; evidence: string[];
}
interface SentinelUnderTest {
  manifest: unknown;
  check(s: never, t: string): Promise<Findings[]>;
}

async function main(): Promise<void> {
  const golden = JSON.parse(fs.readFileSync(path.join(REPO, 'data/golden/wani-baby-v1.json'), 'utf-8'));
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

  const targets: Array<[string, SentinelUnderTest, string]> = [
    ['margin-health', marginHealthSentinel, 'extensions/sentinels/margin-health/manifest.json'],
    ['cash-runway', cashRunwaySentinel, 'extensions/sentinels/cash-runway/manifest.json'],
    ['revenue-health', revenueHealthSentinel, 'extensions/sentinels/revenue-health/manifest.json'],
  ];

  for (const [name, obj, mpath] of targets) {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const props: Record<string, unknown> = {
      teamId: TEAM, financialType: 'erp-standard', period: '2025-Q4',
      total_revenue: revenue, gross_margin: grossProfit, operating_expense: operatingExpense,
      fixed_cost: fixedCost, cash: f.currentCashReserve, monthly_burn: f.monthlyBurnRate,
    };
    (store as unknown as { createNode(t: string, p: Record<string, unknown>, g: string): string })
      .createNode('Financial', props, 'default');
    obj.manifest = JSON.parse(fs.readFileSync(path.join(REPO, mpath), 'utf-8'));

    const findings = await obj.check(store as never, TEAM);
    console.log(`\n=== ${name} → ${findings.length} findings ===`);
    for (const x of findings) {
      console.log(` • [${x.severity}] ${x.id} :: ${x.title}`);
      console.log(`   ${x.description}`);
      console.log(`   evidence=${JSON.stringify(x.evidence)}`);
    }
  }
}

main().catch((e: unknown) => { console.error('PROBE FAILED:', e); process.exit(1); });
