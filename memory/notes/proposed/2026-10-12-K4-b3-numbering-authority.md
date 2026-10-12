# 2026-10-12 · K4 批 3 · 编号权威表与循环五阀（#238/#239）

- **状态**: proposed
- **日期**: 2026-10-12
- **决策**: K4 批 3 的 `#238`（编号权威表 ＋ 引用对齐判据）与 `#239`（循环层五阀映射 ＋ `action_effect_lag`）按 CTO 2026-10-12 开工令执行；本 Note 为该批**治理脚本区**变更（`scripts/control-tower/probe-cycle-edges.ts`、`scripts/control-tower/probe-cycle-valves.ts`、`scripts/control-tower/probe-ontology-values.ts`）的决策引用源。
- **理由**: 按 `commit-msg-check.sh` 的 D395-a/D534 Note 引用门禁，命中 `scripts/control-tower/**` 的非平凡变更必须在 commit message 中引用一件真实存在的 Note。本批三张卡各有一个 `scripts/control-tower/` 下的判据探针，故统一由本件承载。

## 一、本批已裁决的口径（供交付件引用）

1. **`#238` 判据① 口径 = `occurrences=45 distinct=15 hit=15 miss=0`**。
   - 仓内可引原件 = `docs/synova/coordination/K4-审计定稿与卡面全套.md`（blob `59c9a838ce202d18bff4c1b444e3d33d7f1b2b71`）§三 第 1 行「**一律用 15**」。
   - 🔴 **CTO 工作令 §二①「三口径全为 17」已由 CTO 2026-10-12 当面撤销**（队长实测三口径 15/15/15，与裁定件一致）。
   - `occurrences` 的**跨口径求和**语义 = `nodes[].edgeRefs` occ(22) ＋ `mapping[].edgeId` occ(23)；`distinct` = 并集去重 = 15。
   - 差异唯一来源：`cycles/industry/saas-tech/arr-growth.cycle.json`（edgeRefs 3 / edgeId 4）。

2. **`#239` 五阀字段名与平台**：新增 `valves` 字段，**不覆盖**既有 `edges[]`（同名不同物）。
   - 权威形态源 = `docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md` §3.4（`edges` — 五阀映射）。
   - 五阀键名逐字 = `acquisitionValve` / `allocationValve` / `conversionValve` / `deliveryValve` / `recycleValve`；元素形态 = `{ edgeId, actionEffectLag }`。
   - 桶标签 = **6 个**（`immediate` / `1_month` / `1-3_months` / `3-6_months` / `6-12_months` / `>12_months`）；派单件仅列 5 个，**漏 `>12_months`**，已登记。

3. **`#234` 值域迁移面 = 5 条桶标签**（实测）：`capital_acquisition` `immediate`、`capital_allocation` `1_month`、`talent_acquisition` `1-3_months`、`cross_functional_synergy` `3-6_months`、`operational_execution` `3-6_months`。
   - 换算：`immediate ⇒ [0,0.5]`（CTO 明文）；`1_month ⇒ [0.5,1]`（**推导**，理由 = 保「区间→桶」换算唯一性：`[0,1]` 会使 `immediate[0,0.5] ⊂ 1_month[0,1]` 重叠）；`1-3_months ⇒ [1,3]`；`3-6_months ⇒ [3,6]`。
   - §3.5.1 与 §3.4/附录A **跨源互斥 3 条**（E-23 / E-25 / E-37）⇒ 按 CTO 裁定 `§3.5.1` 优先。

4. **测量口径纪律（本批强制）**：`core.autocrlf=true` 且 `.gitattributes` **无规则覆盖本批路径** ⇒ 工作树为 CRLF；`git hash-object` 经 clean 过滤器只证**规范化一致**，**不等于**工作树字节一致。
   - 口径 W = `Get-FileHash`/`sha256sum`（原始字节）｜口径 B = `git hash-object` 且**必须标注**经 autocrlf clean。二者二选一，须写明。

## 二、本批暴露并修复的存量缺陷（留痕）

1. **两件畸形 claim 曾使 claim 库整体 fail-closed**：`.claude/claims/201.yaml` / `345.yaml` 的 `note:` block 续行缩进为 2 空格（与其父键同级）⇒ `claim_store.parse_claim` 见非 `  - ` 行即抛错 ⇒ `--resolve` 返回 `degraded: true` ⇒ 所有卡走 declaration 分支时 claim-first 失效。
   - 修复 = 折叠 `note` 为**内联单标量 ＋ 对称双引号**（仓内 25 件 claim 中 20 件本为内联 note，最长 485 字符 ⇒ 属 house convention）。仅结构改动，`writeset`/`done` 逐条不变，`parse_claim` 往返 note 保真（935/935、539/539 字符），原件已备份。
2. **分支名影响 claim-first 可达性**：`claim_store.py` `BRANCH_ISSUE_RE = r"(?:^|[/#])(\d{1,7})(?=[-_/]|$)"` 要求数字段紧跟 `/` 或 `#`。
   - `k4b3/l1-238-239` ⇒ **提不出 issue**（`238` 前是 `-`）⇒ `resolve-commit-brief.sh` 的 claim-first 分支**不进入** ⇒ 回落到 legacy brief 链 ⇒ 组 12 判「不在 Q2 范围」。
   - 对策 = 分支命名 `k4b3/<issue>[-后缀]`（如 `k4b3/238-239`），与本仓既有 `feat/<issue>-x` 惯例一致。

## 三、遗留（归 CTO）

- 权威文档01 **3 源 2 值**分歧 4 条（E-08/E-10/E-11/E-12）；其中 **E-10/E-12 两版候选均 ∉ 词表**。
- `§3.5.1` 主张 `{minMonths,maxMonths}` 对象形态 vs 既有门禁要求非空字符串。
- doc15 内 `actionEffectLag` 三源互斥 3 条（E-23/E-25/E-37）。
- 上述三项的完整登记见 `docs/synova/product-lines/evidence/K4-b3-lead-closeout-20261012.md` §六。
