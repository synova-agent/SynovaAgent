---
状态: proposed
日期: 2026-10-07
决策: 逐处把「变量紧跟全角标点」(`$VAR（`) 修为 `${VAR}（`（13 文件 26 处），只动变量边界、不动断言语义；并登记「扫描面未覆盖 tests/**」为待裁提案
理由: 该形态在 set -u 下崩 unbound variable、在无 set -u 下静默吞值——且全部落在 `|| no "…$VAR（…）"` 失败文案位 ⇒ 断言失败时用崩溃/空值掩盖真实失败信息（掩盖失败的失败）
---

# D1223 — 全角括号变量边界清理（卡 #1288）

## 一、缺陷机制
`$VAR（` 在 bash 3.2/5 下都按**多字节变量名**解析（`VAR（`）⇒
- `set -u`：`bash: VAR?: unbound variable` ⇒ 失败文案构造**崩**；
- 无 `set -u`：扩展为**空值** ⇒ 静默吞值（本批 1 个文件属此类：`tests/doc-system/doc-contract-property.test.sh`）。

真阳性全部落在 `|| no "…$VAR（…）"` / `|| fail "…"` 类**失败文案位** ⇒ 断言失败时把真实失败信息换成误导信息。

## 二、为什么漏网这么久（结构原因）
既有探测器 `scripts/control-tower/scan-fullwidth-vars.sh`（D938）的**扫描面是 `scripts/**`，不含 `tests/**`** ⇒ 测试面长期无网。
**提案（未落地，属判据变更须 K3）**：把 `tests/**`（至少 `*.test.sh`）纳入该扫描面，或改为在 CI 里对 `tests/**` 跑一次 `--paths` 模式并**先登记棘轮基线**（避免一次引入 18 处红）。

## 三、本卡执行（13 文件 / 26 处）
`check-citations`(5) · `check-ownership`(1) · `check-pr-budget`(1) · `check-preset-bundles`(2) · `daily-cto-board`(2) ·
`external-auditor`(2) · `g12-day-window`(1) · `incident-loop-hygiene`(2) · `parallel-main-tree-occupancy`(3) ·
`redeem-task-redeem`(1) · `session-worktree-isolation`(3) · `alloc-task-id`(2) · `doc-contract-property`(1)

**逐处证据（26/26）**：对每处取 origin/main 版与修复版**同一段文案**，在 `set -u` 下构造：
旧形态 → 24/26 崩（另 2 处同为 `${…}` 形态，本就安全，修复后仍正常）；新形态 → **26/26 正常打印断言失败文案**。

## 四、台账（修了 N / 待 N + owner）
- 已修：**13 文件 / 26 处**（本卡）
- 待修（**未动**，避免跨在飞写集）：
  | 文件 | 处数 | owner / 前置 |
  |---|---|---|
  | `tests/control-tower/post-commit.test.sh` | 3 | CI 面邻区 —— 等 Lead 确认释放（我可接） |
  | `tests/control-tower/check-gate-integrity.test.sh` | 1 | 同上 |
  | `tests/control-tower/ci-signal-classify.test.sh` | 1 | 同上 |
  | `tests/control-tower/staging_guard.test.sh` | 1 | D-C 余项 / line F 在飞 |
  | `tests/control-tower/synova-commit.test.sh` | 1 | 同上 |
- 剔除（verifier 已核）：`tests/deploy.test.ts`（TS 不适用）+ 仅注释命中 3 文件（不执行）。

## 五、回滚
单文件回滚即恢复原状（纯字符串边界修改，无状态/无迁移；修复前后测试语义与期望值逐字相同）。
