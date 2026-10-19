---
状态: proposed
日期: 2026-10-20
决策: 闸 3（doc-contract）在 Gitea CI 补 base：① 步注入 SYNO_DIFF_BASE ＋ GITHUB_ACTIONS=true（base 由共享 helper resolve-ci-base.sh 解析）；pre-commit 在"真实 CI 无 base"时 fail-loud（exit 1），禁静默退回 --staged 空跑。
理由: Gitea CI 的 ① 步从不注入 SYNO_DIFF_BASE ⇒ 闸 3 走 --staged（空暂存）⇒ 核 0 件 ⇒ 恒绿（10 月新增 5 件 dev doc 全部漏网）。仅改文档无意义，必须让 CI 真拿到 base。
---

# 决策 Note — #598 闸 3 CI 空跑

## 现状（2026-10-20 实测）
- `pre-commit-check.sh` 的闸 3：`GITHUB_ACTIONS=true && SYNO_DIFF_BASE` 才 `--base`，否则 `--staged`；`local-gates.yml` ① 步不注入 ⇒ `--staged` ⇒ 0 件 ⇒ PASS。
- 对照：`check-doc-contract.sh --files <dev doc>` ⇒ 闸 3 FAIL（命中 §3 阻断清单 `docs/plans/**`）。

## 决定
1. 新 `scripts/control-tower/resolve-ci-base.sh`：链 `SYNO_BASE_REF → GITHUB_BASE_REF → gitea/local-main`；裸名规范化；CI 单远端每次刷新；exit 2 fail-closed；**① 与 ①d 共用**（禁两处漂移）。
2. ① 步：`BASE=$(resolve-ci-base.sh)` ⇒ `SYNO_CI=1 GITHUB_ACTIONS=true SYNO_DIFF_BASE="$BASE"` 跑 pre-commit。
3. pre-commit：真实 CI（`SYNO_CI=1 ∧ GITHUB_ACTIONS=true`）无 `SYNO_DIFF_BASE` ⇒ fail-loud exit 1。
4. ①d：内联解析删除，改用 helper（#610 语义不变）。

## 依据
- 规格 `SYNOVA-IMPL-598`（§2/§4/§7）；#614 的 ①d 刷新经验；`E_BAD_BASE` 三态。

## 已知限制
1. 新鲜度断言在真实 CI 里恒等（fetch canonical 会同时刷新 `origin/local-main`，实测）——真正的保证是"每次 CI 都 fetch"本身。
2. 旧 PR（base 早于 S1）修后 ①d 会 2 直到 rebase（P5 窗口）。
3. push 腿 base==HEAD ⇒ diff 空 ⇒ 只做清单完整性（不变）。
