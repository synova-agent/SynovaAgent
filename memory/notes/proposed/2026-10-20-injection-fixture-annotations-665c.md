---
状态: proposed
日期: 2026-10-20
决策: 注入夹具失败时（RC=1 且 GITHUB_ACTIONS=true）把日志里的 ❌ 行以 `::error title=injection-fixture::<❌行>` 发成 GitHub annotation（≤10 条，剥 ANSI 色码与嵌套 workflow command）。
理由: GitHub job log 端点匿名 404/403（CTO 取不回）⇒ 失败原因不可观测；check-runs annotations 是公开可读的观测面（同 ci.yml Publish gate-integrity summary 的先例）。
---

# 决策 Note — #665c 夹具失败时发 GitHub annotation

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：GitHub step 5 红但本机复现不出；job log 取不回（404）⇒ CTO 不知道是哪一组 ❌。
2. **现状证据**：CTO 实测 `gh api .../logs` 404/重定向；#665b 已证本机双环境逐字一致。
3. **有没有现成**：`ci.yml` 的 Publish gate-integrity summary 步已用 `::notice` 发证据（先例）；annotations API 公开可读。
4. **最小改动**：夹具**失败分支**加一段（仅 GITHUB_ACTIONS=true）——不动 ⑥ 的 env -i 隔离、不动任何断言。
5. **最危险假设**：annotation 里塞进带色码/嵌套 `::error` 的行 ⇒ GitHub 显示乱码/破坏命令。已剥（ANSI + 前缀 `::error|warning|notice ...::`）。
6. **失败路径**：无 ❌ 可摘（如 rc=127/not_red）⇒ 发一条 fallback（not_red/baseline/probe 摘要）；本地跑（无 GITHUB_ACTIONS）⇒ 不发。
7. **边界**：≤10 条（GitHub 每 step 注解上限）；只在失败分支；退出码与断言零改动。
8. **可观测**：`GET /repos/synova-agent/SynovaAgent/check-runs/<id>/annotations` 应出现 ❌ 行。
9. **拆步**：① 失败分支加块 ② 剥色码/嵌套 ③ 本地变异验证 ④ 绿跑回归（0 条）。

## 决定
- 失败分支内：`grep -hE '❌|BASELINE_FAIL' "$TMP"/out.*.log | 剥前缀/色码 | sort -u | head -10` → `::error title=injection-fixture::<line>`；空则 fallback 一条。
- 仅 `${GITHUB_ACTIONS:-}` = true 时发。

## 依据
- 卡 #665c（判据⑦ + 改坏必红）。
- 本机实测：必失败变异（baseline 注入 g1）⇒ 10 条 `::error`，第 6 条含真实 ❌ 行；改回 echo ⇒ 0 条；绿跑/本地跑 ⇒ 0 条。

## 影响面
- 只动夹具失败分支（1 文件）；⑥ 隔离/断言零改动。
