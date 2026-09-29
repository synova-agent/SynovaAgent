# Task Brief: D1050 B2-task-briefs-outbound

> 生成: 2026-09-28 | 任务: D1050 | 认领: squad-a-b2
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理域 · 仓库卫生线：把 `.claude/task-briefs/` 非 archive 存量中**已完成且零活引用**的 brief
承接（保形复制）到过程档案仓 `~/Synova-过程档案/出库-主仓/`，再从主仓移出，使主仓 brief
目录只保留在飞卡与活引用件。**不是**产品代码任务：不触 L1–L5 任何运行时代码。

### b) 文件审计
- 对象集：`.claude/task-briefs/` 非 archive 已跟踪 `*.md`，实测 **424** 件
  （命令 `git ls-files '.claude/task-briefs/*.md' | wc -l`；`find` 得 425 = 424 + 本批自身未跟踪新件）。
- archive 子目录实测 **0** 件（B1/D1044 已清），本卡不触 archive。
- 依赖登记：`task-state/D#.json` 实测 **377** 个已跟踪（+1 未跟踪 D1050）；status 词表实测
  `audited 124 / impl_done 107 / claimed 104 / spec_done 22 / closed 15 / rejected 2 /
  in_progress 2 / audit_done 1 / None 1`，注册表 D# 区间实测 **356–1044**。
- 消费者审计（双法，见证据 A-01）：法1 精确路径 `git grep -F -f` 命中 637 行/356 文件；
  法2 目录级消费者扫描（`scripts/` 77 行、`tests/` 104 行、`.github/` 1 行、
  `.claude/settings.json` 5 行）。活候选隔离为 5 个文件，其中 2 件为 fail-closed 测试夹具。

### c) 决策
复用 D1044-B1 的「承接后移出」范式与 D1028 的出库路径级豁免；不新建机制、不改门禁。
排除判据用**实测词表重建**（卡面 `done/merged/superseded` 实测零命中）并按 fail-closed 落。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **铁律 0-3/0-5**：不可逆删除前必须有等价副本；审计红线（不改 `scripts/audit/**`）。
- **memory 教训 D1047-R**：`find` 型目录消费者命中 282 件而精确路径 grep 不可见
  ⇒ **单用「grep 0 命中」不足为据，必须双法并用**（本卡照做）。
- **memory 教训 D1044-B1**：不回退演练即移出必踩坑；回退演练用 `git rm -r -f`。
- **Anthropic 基线**：先定义可判别验收（本卡＝删前后 Δ 精确闭合 + 引用面归零），再执行。
- 参考：第一性原理（不可逆动作须有等价副本）+ Anthropic（判别性演练）+ 开源实证
  （先承接后移出）+ 收敛（复用 B1 范式）→ 结论：承接逐件 sha256 对账后逐件 `git rm`。

## Q2: 范围 — 正确的最简方案
做什么：
- 按排除后清单（N=275）逐件 `git rm` `.claude/task-briefs/*.md`（**逐个文件，禁 `-r` 整目录**）
- 落 4 个证据 `.json` 到 `docs/synova/product-lines/evidence/D1050-B2/`
- 补记 `task-state/D1050.json` 与 `memory/notes/proposed/2026-09-28-D1050-b2-task-briefs-outbound.md`

不做什么：
- 不改 scripts/audit/（K3 红线）
- 不改 `.github/CODEOWNERS`（目录级 owner，与出库无关）
- 不改 `scripts/pre-commit-check.sh`（门禁脚本，红线）
- 不改 `scripts/control-tower/check-pr-budget.sh`（门禁脚本，红线）
- 不改 `.github/workflows/ci.yml`（CI 配置，红线）
- 不改 `scripts/control-tower/synova-commit`（自带 push，误用会绕过队长统一推送）
- 不改 `docs/synova/audit-reports/2026-09-25-K3-批次5.md`（审计报告，红线）
- 不改 `tests/control-tower/brief-parseable.test.sh`（fail-closed 夹具所在，已登记交 CTO 立卡）
- 不删 `.claude/task-briefs/D312-baseline-tools.md`（被测夹具点名）
- 不删 `.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md`（被测夹具点名）
- 不删 `.claude/task-briefs/2026-09-24-D943-cto-a-items.md`（current-brief 指向件，在飞）
- 不删 `.claude/task-briefs/D311-multi-session-coordination.md`（`.claude/settings.json` 点名）
- 不删 `.claude/task-briefs/D313-D314-control-tower-finalize.md`（`.claude/settings.json` 点名）
- 不删 `.claude/task-briefs/D320-dashboard-gitify.md`（`commit-msg-consistency.test.sh` 点名）
- 不删 `.claude/task-briefs/brief.md`（`generate-task-brief.py` 默认输出目标）
- 不碰 `.claude/task-briefs/archive/**`（已空）
- 不 push（队长统一一次推）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash /tmp/b2-archive.sh`（队长执行承接）→ 本卡逐件 `git rm` → 四闸回执 → commit。
处理：① 双法引用复核 → ② fail-closed 活跃过滤（X1/X3/X4/X5/X6）→ ③ 保形承接 + sha256 对账
→ ④ 逐件移出 + 门禁。
结果：主仓 `.claude/task-briefs/` 保留 149 件（排除集）+ 本批新增 1 件；4 个证据 `.json` 落
`docs/synova/product-lines/evidence/D1050-B2/`；四闸回执原文入 A-03。

## 架构层:
scripts（控制塔）

## Done 标准
- [ ] verify: `shasum -a 256` 逐件对账承接件 → 275/275 全等
- [ ] verify: `comm -12 <出库清单> <非历史层引用命中>` → 空（出库集零活引用）
- [ ] verify: `DOC_TRUTH_ROOT=. bash scripts/doc-system/doc-registry-gate.sh` → exit 0 / 0 未登记
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` → exit 0（13 组全过）
- [ ] verify: `bash scripts/control-tower/check-pr-budget.sh` → exit 0（出库豁免 PASS）
- [ ] verify: `git ls-files '*.md' | wc -l` → 1904 − 275 + 本批新增 = 闭合值
