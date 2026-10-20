# Task Brief: P4 · #665b 注入夹具 hermetic（CI 与本地同结果）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 夹具继承外层环境：外层带 CI 环境跑 ⇒ BASELINE_FAIL（D782 D2 登记门禁／D734 PR 预算等）；干净环境 ⇒ EXIT=0 ⇒ 不可复现。
- 相关件：`tests/control-tower/precommit-groups-injection.test.sh:483`（及 D1148/探针共 6 处调用）。

## Q1: 调研（决策链 / 既有基础）
- 黑名单 `env -u` 列不全（GITHUB_* 300+ 消费点）⇒ 白名单 `env -i`（CTO 定）。
- 不动 `pre-commit-check.sh` 判据；D1193/#598 不回退（判据⑤回归锁）。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- tests/control-tower/precommit-groups-injection.test.sh
- gate-exemptions/2026-10-20-injection-fixture-hermetic-665b.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-injection-fixture-hermetic-665b.md
- .claude/task-briefs/2026-10-20-665b-injection-fixture-hermetic.md
不做什么：
- scripts/pre-commit-check.sh
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/precommit-groups-injection.test.sh`（干净/外层 CI 两跑）
- 交互：判据⑥ 两环境逐字一致；反例 M1 去 env -i ⇒ EXIT=1；M2 去 marker ⇒ EXIT=1；M3 去 SYNO_CI ⇒ 说明
- 结果：两跑同 summary（EXIT=0/red_confirmed=4/not_red=0/baseline=ok）；摘标记仍 not_red=4。

## Q4: 契约与测试
- `_run_gate_env`：`env -i PATH HOME LANG TMPDIR "$@" bash scripts/pre-commit-check.sh`。
- 白名单外变量不继承；6 处调用统一。

## 本任务在哪一层
- 治理线 / 门禁（注入夹具 hermetic）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 干净环境 EXIT=0 red_confirmed=4 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh`
- [ ] 外层 CI 环境 EXIT=0 且 summary 逐字一致 → `verify: GITHUB_ACTIONS=true SYNO_CI=1 CI=true GITHUB_EVENT_NAME=push bash tests/control-tower/precommit-groups-injection.test.sh`
- [ ] 摘标记仍 not_red=4 → `verify: grep no_marker_notred=4 夹具输出`
