# Task Brief: D1167 govl-w6-gate-restore

> 生成: 2026-10-06 | 任务: D1167 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=进行中 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等K3
> 派单源: CTO 2026-10-06《开发计划 v2》A 槽 **W6**（门禁语义变更 ⇒ 提案→K3→CTO 裁）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`scripts/pre-commit-check.sh`），非产品五层。治的是「**写着阻断、实际旁路**」。
### b) 文件审计
- `scripts/pre-commit-check.sh:182` `bypass_run()` — 运行命令、失败**只打印**、`return 0`，**不进 gate-hits、CI strict 也不转硬**
- 同文件 `:192` `v5_soft()` — 本地软提示 / `SYNO_CI=1` 时 `HARD_FAIL++`（**真阻断**）
- 同文件 `:145` `soft_check()` — 第 2 参数是**匹配串**不是命令 ⇒ **不能**直接替换 `bypass_run`（这是本卡的实现要点）
- 三个调用点（origin/main）：`:1673` D782 D1 文档真相 / `:1680` D782 D2 登记门禁 / `:1715` D734 PR 预算
- `:1664` / `:1712` 自带回滚说明（「把 bypass_run 改回 soft_check 即恢复」）
### c) 决策
新增 `_run_gate`（带 `W6-RUN-GATE-BEGIN/END` 标记，供夹具**单一真值源**提取），语义 = `par_collect … || v5_soft …`。
三处 `bypass_run` → `_run_gate`；同步三处会变假的注释。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）；判例 **V-08**（改坏即红 ⇒ 必须给反例夹具）；**V-02**（禁 grep 作验收 ⇒ 行为断言）；
  **M-02**（三态）；**P-03**（断言不变性）。
- 判例 **P-01**（派单配方也要核）：CTO 原文写「`bypass_run` → `v5_soft`」，但 `v5_soft` **只收名称、不执行命令**
  ⇒ 直接照写会**丢掉门禁脚本的执行**。本卡按目的（恢复阻断力）实现为 `_run_gate` 包装，并在 PR 正文点名该更正。
- 决策参考：**第一性原理**（"旁路"的本质是"失败无后果"）+ **Anthropic 工程基线**（失败必须可见且可阻断）
  ⇒ 结论 = 恢复 `par_collect || v5_soft` 同款语义，不改任何判据脚本。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/pre-commit-check.sh — 新增 `_run_gate`（带 BEGIN/END 标记）+ 三处 `bypass_run` → `_run_gate` + 三处注释同步
- .github/workflows/ci.yml — 登记 `tests/control-tower/w6-gate-restore.test.sh` 进**两处**密封清单
- tests/control-tower/w6-gate-restore.test.sh — 新建（判别夹具，含反例）
- .claude/task-briefs/2026-10-06-D1167-govl-w6-gate-restore.md
- memory/notes/proposed/2026-10-06-d1167-w6-gate-restore.md
- task-state/D1167.json
不做什么：
- 不改 docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh（不改夹具迁就实现）
- 不改 scripts/control-tower/check-pr-budget.sh（阈值归 #1017，另卡）
- 不改 scripts/pre-commit-check.sh 的 13 组编号与横幅（打破 AGENTS.md / CLAUDE.md 的「13 组」声明链）
- 不改 tests/control-tower/fastlane-bypass-only.test.sh（依赖上述横幅）
- 不改 scripts/pre-push-check.sh（W11 另笔）
- 不改 scripts/audit/check-audit-consistency.sh（K3 红线）
- 不碰 scripts/audit/check-audit-consistency.sh（K3 红线）
- 不改 .github/workflows/ci.yml 里任何既有 job 的 `name:`

## Q3: 验收 — 入口 → 交互 → 结果
入口：`git commit`（本地）或 CI 的 Iron Laws job（`SYNO_CI=1`）
处理：三处门禁脚本执行 ⇒ 失败时经 `_run_gate` → `v5_soft`
结果：
- `bash tests/control-tower/w6-gate-restore.test.sh` ⇒ `RESULT: 10 PASS / 0 FAIL`
- 其中 A（CI strict + 失败）⇒ `HARD=1`（**提交被拒**）；B（本地 + 失败）⇒ `HARD=0 SOFT=1`（不阻断，符合 D515）
- D（反例：旧 `bypass_run` 形态）⇒ `HARD=0 SOFT=0`（证明阻断力由本卡引入）
- `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ 18 通过 / 0 失败（接线断言未破）
- `bash tests/control-tower/check-pr-budget.test.sh` ⇒ 见例外（与 PR 文件数耦合）
例外：D734 恢复阻断后，**任何 >12 文件的 PR 会在 CI 被拒** —— 含本卡自己的姊妹 PR。见 note 与 PR 正文。

## 架构层:
scripts（控制塔/门禁治理线）+ `.github/workflows/`（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/w6-gate-restore.test.sh` ⇒ 含 `RESULT: 10 PASS / 0 FAIL`
- [ ] verify: `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ 含 `0 失败`
- [ ] verify: `bash -n scripts/pre-commit-check.sh` ⇒ exit 0
- [ ] verify: `grep -c '_run_gate' scripts/pre-commit-check.sh` ⇒ ≥4
- [ ] verify: `grep -c 'w6-gate-restore.test.sh' .github/workflows/ci.yml` ⇒ 2
