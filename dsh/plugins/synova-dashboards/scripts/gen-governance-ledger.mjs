#!/usr/bin/env node
// scripts/gen-governance-ledger.mjs — 治理线数据落库生成器（D1066 §一.4）
//
// 为什么要有它（CTO 判据 C4）：治理面板的数据源原先在**库外档案仓 + 运行时扫 390 张卡**，
//   结果「读不到 / 每次都靠现场扫」。D1066 要求把治理线数据**落进仓库**成两个机读件：
//     ① docs/synova/coordination/governance-tasks.json   —— 治理卡台账（域/卡号/状态/服务的阻塞/等待天数）
//     ② docs/synova/coordination/pending-decisions.json  —— 待裁清单
//   面板改读这两份（带 generated_at，陈旧变灰），不再“现场扫一遍再说”。
//
// 契约（铁律 47）：
//   @input  --repo-root <dir>（默认：本脚本上溯三级）｜--now <ISO>（可注入，测试用）｜--check（只校验不写）
//   @output 成功 → 写两份 JSON；stdout 打印摘要（条数 + generated_at + 路径）
//           降级 → 单源不可读时**仍写出**该件并带 degraded/degraded_sources（禁静默略过）
//   @exit   0 = 写出（可含 degraded 源）；1 = 参数/环境错；2 = 两源都不可用（拒写空台账冒充）
//   @write  只写上述两个文件（幂等：同输入 → 逐字节稳定，除 generated_at）
//
// 用法：node dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs --repo-root /Users/wane/SynovaAgent

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectGovernance } from "../lib/governance.js";
import { collectWorkbench } from "../lib/workbench.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { repoRoot: null, now: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo-root") out.repoRoot = argv[++i];
    else if (a.startsWith("--repo-root=")) out.repoRoot = a.slice("--repo-root=".length);
    else if (a === "--now") out.now = argv[++i];
    else if (a.startsWith("--now=")) out.now = a.slice("--now=".length);
    else if (a === "--check") out.check = true;
    else {
      console.error(`❌ 未知参数: ${a}（支持 --repo-root / --now / --check）`);
      process.exit(1);
    }
  }
  if (!out.repoRoot) out.repoRoot = join(HERE, "..", "..", "..", "..");
  return out;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = args.repoRoot;
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`❌ --now 不是合法时间：${args.now}`);
  process.exit(1);
}
const generatedAt = now.toISOString();

const GOV_REL = "docs/synova/coordination/governance-tasks.json";
const DEC_REL = "docs/synova/coordination/pending-decisions.json";

const [gov, wb] = await Promise.all([
  collectGovernance(repoRoot, { now }),
  collectWorkbench(repoRoot, { now, fetchImpl: async () => { throw new Error("gen-governance-ledger 不取 PR（离线生成）"); } })
]);

// ── ① 治理卡台账 ─────────────────────────────────────────────────────────────
const govDoc = {
  schema: "governance-tasks/1",
  generated_by: "dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs",
  generated_at: generatedAt,
  source: {
    primary: "task-state/D###.json",
    secondary: "docs/synova/coordination/board-backlog.json",
    rule: gov.scope?.rule ?? null,
    signals: gov.scope?.signals ?? {}
  },
  degraded: gov.degraded === true,
  degraded_sources: gov.degraded_sources ?? [],
  counts: {
    total: gov.cards?.count ?? 0,
    active: gov.cards?.active_count ?? 0,
    resting: gov.cards?.resting_count ?? 0,
    debt: gov.debt?.count ?? 0,
    by_domain: gov.cards?.by_domain ?? {}
  },
  // 面板直接用这两列（活卡在前、各自按等待天数降序）
  cards: [...(gov.cards?.active ?? []), ...(gov.cards?.resting ?? [])],
  debt: gov.debt?.items ?? []
};

// ── ② 待裁清单 ──────────────────────────────────────────────────────────────
const dec = wb.decisions ?? {};
const decDoc = {
  schema: "pending-decisions/1",
  generated_by: "dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs",
  generated_at: generatedAt,
  source: {
    upstream: dec.upstream_source ?? "docs/synova/product-lines/cockpit-override.yaml#pending_decisions",
    primary: dec.source ?? "docs/synova/product-lines/product-progress.json#decisions",
    card_scan: "task-state/D###.json（卡面文本扫描「需创始人」，非结构化）"
  },
  degraded: dec.ok !== true,
  degraded_sources: dec.ok === true ? [] : [dec.error ?? "待裁源不可读"],
  counts: {
    pending: dec.pending_count ?? 0,
    resolved: dec.resolved_count ?? 0,
    card_scan: dec.card_scan_count ?? 0
  },
  pending: dec.pending ?? [],
  resolved: dec.resolved ?? [],
  card_scan: dec.card_scan ?? []
};

// 两源都空 ⇒ 拒写（防用空台账冒充「没有待办」，M1 教训：绝不写空覆盖旧数据）
const govEmpty = govDoc.counts.total === 0 && govDoc.counts.debt === 0;
const decEmpty = decDoc.counts.pending === 0 && decDoc.counts.resolved === 0 && decDoc.counts.card_scan === 0;
if (govEmpty && decEmpty) {
  console.error("❌ 两源皆空 —— 拒绝写出空台账冒充数据（fail-closed）");
  console.error(`   治理卡 ${govDoc.counts.total} 条 / 欠账 ${govDoc.counts.debt} 条 / 待裁 ${decDoc.counts.pending} 条`);
  process.exit(2);
}

if (args.check) {
  console.log(JSON.stringify({ repoRoot, generated_at: generatedAt, gov: govDoc.counts, dec: decDoc.counts }, null, 1));
  process.exit(0);
}

for (const [rel, doc] of [[GOV_REL, govDoc], [DEC_REL, decDoc]]) {
  const abs = join(repoRoot, rel);
  writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`✅ 写出 ${rel}`);
}

console.log(
  `   治理卡 ${govDoc.counts.total}（活卡 ${govDoc.counts.active} / 终态 ${govDoc.counts.resting}）· 欠账 ${govDoc.counts.debt}` +
  ` · 待裁 ${decDoc.counts.pending} · 已裁 ${decDoc.counts.resolved} · 卡面扫描 ${decDoc.counts.card_scan}`
);
console.log(`   generated_at ${generatedAt}`);
if (govDoc.degraded || decDoc.degraded) {
  console.log(`   ⚠ 降级源：${[...govDoc.degraded_sources, ...decDoc.degraded_sources].join("；")}`);
}
