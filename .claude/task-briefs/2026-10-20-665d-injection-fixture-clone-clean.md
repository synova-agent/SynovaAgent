# Task Brief: P4 · #665 判据⑧ 探针文件不许泄漏

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- GitHub annotations 显示夹具克隆残留探针 brief（`2026-10-20-d1148-decl-probe.md`）⇒ 自造文件泄漏、被后续门禁抓到。
- 相关件：`tests/control-tower/precommit-groups-injection.test.sh`（reset_clone/cleanup/D1148 探针段/#665 探针段/末尾）。

## Q1: 调研（决策链 / 既有基础）
- 既有 `reset_clone`（reset --hard+clean -fdx）与 `trap cleanup`；缺口＝#665 探针段前无 reset、末尾无 status 断言、异常退出未清 clone。
- 红线：不动 ⑥/⑦ 与既有断言。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- tests/control-tower/precommit-groups-injection.test.sh
- gate-exemptions/2026-10-20-injection-fixture-clone-clean-665d.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-injection-fixture-clone-clean-665d.md
- .claude/task-briefs/2026-10-20-665d-injection-fixture-clone-clean.md
不做什么：
- scripts/pre-commit-check.sh
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/precommit-groups-injection.test.sh`
- 交互：判据⑧ status --porcelain 为空；变异删清理 ⇒ 残留/红；变异去 trap+中途 exit ⇒ 残留非空
- 结果：正常 EXIT=0 + `✅ 判据⑧: status --porcelain 为空` + `clone_status=clean`。

## Q4: 契约与测试
- 预期产物：无（显式声明为空）。
- cleanup 兜底 reset+clean；段前/段末 reset；status 断言并入 RC。

## 本任务在哪一层
- 治理线 / 门禁（夹具 hermetic 清理）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 正常跑完 status 为空 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh | grep '判据⑧'`
- [ ] 变异删清理 ⇒ 残留 10 行 → `verify: bash /tmp/mut665d/noclean.sh | grep -c '判据⑧: 夹具克隆残留'`
- [ ] 变异去 trap+中途 exit ⇒ status 非空 → `verify: 见 R2 原始输出`
