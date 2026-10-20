# Task Brief: P4 · #665 注入夹具 baseline 恒红（D1193 fail-closed × 夹具模拟）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 夹具 `precommit-groups-injection.test.sh` 故意造 `SYNO_CI=1 ∧ GITHUB_ACTIONS=true ∧ 无 SYNO_DIFF_BASE`；`pre-commit-check.sh:431`（#598 立）判该组合必红 ⇒ baseline 恒红 ⇒ 4 变异场景 not_red。
- 实测：EXIT=1 / baseline=FAIL / 首个 ❌ = `D1193 … CI 无 base（fail-closed，禁空跑）`。

## Q1: 调研（决策链 / 既有基础）
- 方案 A（CTO 倾向）：显式 `SYNO_FIXTURE_MODE=1`，判据加排除条件；不靠环境变量猜（第 7 个「判据对象错位」）。
- 红线：#598 闸 3 空跑成果不许回退；不许只改夹具不改判据。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/pre-commit-check.sh
- tests/control-tower/precommit-groups-injection.test.sh
- gate-exemptions/2026-10-20-injection-fixture-mode-665.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-injection-fixture-mode-665.md
- .claude/task-briefs/2026-10-20-665-injection-fixture-mode.md
不做什么：
- scripts/control-tower/check-doc-contract.sh
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/precommit-groups-injection.test.sh`
- 交互：判据① 显式标记；② 设/不设 SYNO_DIFF_BASE 都出结论；③ red_confirmed=4；④ 摘标记仍 exit 1（D1193 不回退）；⑤ 摘标记重现 not_red=4
- 结果：EXIT=0 / red_confirmed=4 / not_red=0 / fixture_mode=OK / d1193_regression=OK / no_marker_notred=4。

## Q4: 契约与测试
- `SYNO_FIXTURE_MODE=1` 仅夹具使用（Note 明写）；D1193 原判据仅加一个排除条件。
- 夹具探针：双模式基线（带 base）、摘标记 4 场景 not_red=4、有标记不再报 D1193。

## 本任务在哪一层
- 治理线 / 门禁（pre-commit D1193 ＋ 注入夹具）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 夹具 EXIT=0 且 red_confirmed=4 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh`
- [ ] 本地 12 组通过 → `verify: bash scripts/pre-commit-check.sh`
- [ ] 摘标记重现 not_red=4（夹具内探针）→ `verify: grep no_marker_notred=4 夹具输出`
