# D791 PR-A（win）：线3 报告体系——一页纸四槽位 + 各维度循环结论 + 结论可溯源

> 派单: docs/synova/coordination/派单-批六首批三卡-20260916.md 卡 2（域: win）
> spec（唯一契约）: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D791-line3-report-onepager-20260917.md
> **D734 拆单（CTO 2026-09-17 裁决）**: 本 PR = **A 组（win，产品代码）**；B 组（mac，GS-08 场景 + 证据 + 编码指令）在 PR-B 落盘，A 合入后开。
> worktree: `.synova-wt-d791a` / 分支 `feat/d791a-onepager-win`

#CRITERIA: A

## 域
win（产品代码 L1/L2/L3）。A 组写集 = spec §5.1 写集表机器提取（devdoc_writeset.py --extract 得 7 条）+ spec 自身 = 8 文件；`check-ownership.py` 实测 `✅ PASS 8 个文件同域: win`。

## 主线贡献: line-3/3-1,3-7
支柱②「报告可溯源」：一条诊断报告能溯源到 ≥1 条报告之外的物理记录（循环快照）。

## Q0: 定位 — 项目拼图 + 文件审计
三层「报告最后一公里」：L1 src/routes/diagnosis.ts（报告读取端点，2 处 renderOnePager 调用点）→ L2 src/agent/report-assembler.ts（装配 + 一页纸）+ 新建 src/agent/cycle-conclusion-service.ts（循环结论派生）+ src/agent/report-onepager-trace.ts（指针纯函数）→ L3 src/l3/report-templates.ts（executive_summary 版式）。
文件审计实测：`buildCycleConclusions` / `report-onepager-trace` 改前全仓零命中（本任务新建）；`renderOnePager` 生产调用点 2；`generateOverflowDashboard` 报告侧改前零消费（本任务新增消费点）；`getSentinelExpertReports` 既有生产调用方 1（routes/sentinel.ts:84，本任务新增第 2 消费点）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
业界：BLUF/金字塔四件套（结论/证据/分维度状态/行动），管理报告的证据必须是**可回查的指针**而非形容词。Anthropic：fail-closed + 机器可验契约（`resolvePointers` 三态 resolved/unresolved/unknown——「判不了」≠「判过了」）。memory：接线失败 4 次（铁律 0-2）· D286 写集漂移 · D480 既有 5 用例 = 回归红线（`not.toContain('降级')` → 新降级标记必须 ASCII `[degraded]`）· D749/D750 假绿 · D734 单域预算（本 PR 即其产物）。
参考: Anthropic（fail-closed + 机器可验）/ DeepSeek（最少机制、复用既有）/ 第一性原理（结论必须能回查）+ 结论: 四槽位 + ASCII 指针 + 零新指标。

## Q2: 范围 — 正确的最简方案
做什么（= spec §5.1 A 组，8 文件；写集表机器提取 + spec 自身）：
- src/l3/report-templates.ts
- src/agent/report-assembler.ts
- src/routes/diagnosis.ts
- src/agent/cycle-conclusion-service.ts
- src/agent/report-onepager-trace.ts
- tests/agent/report-onepager-trace.test.ts
- tests/agent/cycle-conclusion-service.test.ts
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D791-line3-report-onepager-20260917.md

不做什么：
- 不改 tests/agent/report-assembler.test.ts（D480 既有 5 用例 = 回归红线，本 PR 零改动实测仍 5/5 绿）
- 不改 src/cycles/overflow-dashboard.ts（纯复用；改了 3-7 的「既有」变「新造」）
- 不改 src/cycles/overflow-compute.ts（同上，纯复用）
- 不改 src/l3/report-template-loader.ts（.hbs HTML 轨保持现状）
- 不改 scripts/product-lines/calc-progress.py（D790 在飞同目录；本 PR 只调用不改口径）
- 不改 scripts/golden-scenarios/GS-08-report-readable/run.sh（B 组，PR-B 落盘）
- 不改 docs/synova/product-lines/product-lines.yaml（locked 字段属创始人确认）
- 不改 scripts/audit/audit-check.py（K3 专属红线，一字不碰）
- 不改 .github/workflows/ci.yml（CI 冻结）

## Q3: 验收 — 入口 → 交互 → 结果
入口: `GET /api/diagnosis/consult/:reportId/report?format=markdown`（生产路由；SSE 完成路径 POST /api/diagnosis/consult 同源）。
处理: 路由取 `req.app.locals.graphStore` + `getSentinelExpertReports()` → `buildCycleConclusions(orgId, store)` → `assembleOnePagerInputs` → `renderOnePager(report, depth, inputs)` 渲染四槽位 markdown（条目带 `[src:...]` 指针）→ 覆盖审计 + 解析审计。
结果: ① 单测 18 用例绿（指针/派生/四槽位/降级/边界）+ D480 5 用例零回归；② 架构门禁零新增；③ pre-commit 13 组过；④ 生产端到端验收（GS-08 24 断言）在 **PR-B** 落盘。

## 架构层: L1 + L2 + L3
L1 src/routes/diagnosis.ts（装配与传递；store 经 `req.app.locals` + `type X = import(...)` 类型位置豁免）· L2 src/agent/*（编排与派生；循环服务用 `type GraphStoreLike = import('../l4/graph-bridge').GraphStore` 类型位置形态，不写 l4 相对路径的静态 import 语句——先例 src/agent/loop-handlers.ts:670）· L3 src/l3/report-templates.ts（版式；只描述槽位与裁剪，不取数据）。

## Done 标准: 物理命令可验（非自述）
- [ ] DS-A1: `npx vitest run tests/agent/report-onepager-trace.test.ts tests/agent/cycle-conclusion-service.test.ts` 全绿（18 用例）→ exit 0
- [ ] DS-A2: `npx vitest run tests/agent/report-assembler.test.ts` D480 既有 5 用例仍全绿 → exit 0
- [ ] DS-A3: `bash scripts/check-architecture.sh` → 全部通过（零新增 L2→L4 命中）
- [ ] DS-A4: `bash scripts/workflow/check-dev-doc-write-set.sh docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D791-line3-report-onepager-20260917.md` → 漂移 0
- [ ] DS-A5: `npx vitest run` 无新增失败（与 main 基线差值 0）
- [ ] DS-A6: `bash scripts/pre-commit-check.sh` 13 组过（禁 --no-verify）+ `check-pr-budget.sh` 通过

## 写集豁免
- .claude/task-briefs/2026-09-17-D791a-line3-onepager-win.md — 本任务 brief 自身：pre-commit 组 6 要求的流程工件（Q0-Q3/架构层/Done 6 核心字段），非产品写集；D708 声明级豁免
