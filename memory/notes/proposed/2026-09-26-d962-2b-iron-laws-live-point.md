---
状态: proposed
日期: 2026-09-26
决策: D962 2b「接手」落地为 **`iron-laws` 独立 CI job（无 needs）+ 判定面按文件路径排除自伤面**；不做「只在 quality 里加 step」的软接手。
理由: (1) `quality` 一红 ⇒ `needs: quality` 的下游整块 skip ⇒ 接手面永不回报（#802/#803/#804/#805 mergeState=blocked 实测）⇒ 活点必须独立于上游红；(2) 字面量判定扫本 PR 全 diff 时，检查自身正则/标签、测试夹具的故意注入、文档引用都会命中（CI job 108143405913 实测 9+3 处 100% 自伤，B 类生产真红 0 处）⇒ 按 hunk 级 `+++ b/<path>` 排除（$0/tests/docs/memory/.claude/task-state/*.md），禁行内字面量白名单。
---

# D962 2b：iron-laws 活点 + 判定面自伤排除

## 触发场景（实测）
- `quality`（显示名 "TypeScript + Lint + Iron Laws"）= failure ⇒ `Vitest (${{ matrix.shard }})` 渲染为**字面量**且 skipped（job 108144406652）⇒ 必需检查 `Vitest (1/2)/(2/2)` 永不回报。
- `quality` 失败的 2 组全部是自伤：`as any/never/unknown as` 9 处 + `DiagnosticModule` 3 处，命中行全是脚本自身注释/标签、测试标签、文档引用。

## 决策内容
1. `.github/workflows/ci.yml` 新增 `iron-laws` job：**无 `needs`**、`bash scripts/pre-commit-check.sh`、`SYNO_CI=1`、`SYNO_DIFF_BASE=origin/main`。职责边界：与 `quality` 内的 Iron laws step **同脚本同口径**（有意保留 quality 内 step，避免削弱既有必需检查）；本 job 是「上游红也照样跑」的活点，不是替换。
2. `scripts/pre-commit-check.sh`：新增 `code_added_lines()`（hunk 级路径排除）并用于两条字面量判定；新增 `_emit_matches()`（CI 下不截断 + `::error` 带失败断言原文，替换 `head -8`）。
3. 接线断言：新增 `tests/control-tower/iron-laws-live-point.test.sh`（⒜ 行号 + 无 needs 判据 + ⒝ 删掉即红夹具）；既有 4 处「归 2b」注释改指该测试。

## 未清项
- `quality` job 的 Iron laws step 与本 job 重复执行同一脚本（CI 时长 +~30s）；是否收敛为单点由 CTO 裁。
- D721（main push 上 `BASE=merge-base(origin/main,HEAD)` 恒 = HEAD ⇒ CHANGED 恒空 ⇒ 存量红放行分支不可达）独立登记为 FIX 条目（见回执 §D721）。
