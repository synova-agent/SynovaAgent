# Task Brief: P4 · #662 Gate Integrity 自指死锁修复

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- GitHub `Gate Integrity` check 红（check-run 118477514050）：`CI-RED-CHECK` 把**自身红**算成「未登记 CI 失败」⇒ `VIOLATION(1)`；本地用 `/tmp/cr.json` 复现 exit 1，剔除自身（`/tmp/cr_noself.json`）⇒ exit 0。
- 相关件：`scripts/control-tower/check-gate-integrity.sh:838`（fail_all）、`:1048`（参数）、`.github/workflows/ci.yml:1121/1255`（job name 与调用）。

## Q1: 调研（决策链 / 既有基础）
- CTO 卡 #662 两条评论：根因实测＋施工单（行号已定位）；同族问题：今天 5 个「判据对象错位」。
- 既有 `--ci-reds`/`--base-ref` 与 python 对账块 ⇒ 扩展，不新建脚本（禁重复建设）。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/control-tower/check-gate-integrity.sh
- .github/workflows/ci.yml
- tests/control-tower/check-gate-integrity-selfexclude.test.sh
- gate-exemptions/2026-10-20-gate-integrity-selfexclude-662.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-gate-integrity-selfexclude-662.md
- .claude/task-briefs/2026-10-20-662-gate-integrity-selfexclude.md
不做什么：
- scripts/control-tower/ci-red-baseline.txt（❌ 禁止把 Gate Integrity 塞进基线了事）
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/check-gate-integrity-selfexclude.test.sh`
- 交互：正（排除自身⇒0）＋反1（不排除⇒1）＋反2（错名⇒1）＋反3（别家红⇒1）＋反4（ci.yml 两处逐字相等＋改名变异）＋重复
- 结果：12 通过 / 0 失败；既有 949 行夹具 73/0；本地 12 组 exit 0。

## Q4: 契约与测试
- `--exclude-check <name>` 可重复；`fail_all` 先减排除；三态 0/1/2 不变；三段（PATTERN/SENTINEL/CI-REGISTRY）行为不变。
- 夹具 hermetic：注入 SYNO_GATE_SCAN_SCRIPTS/SYNO_TESTS_DIR/SYNO_CI_YML/SYNO_GATE_BASELINE/SYNO_CI_RED_BASELINE。

## 本任务在哪一层
- 治理线 / 门禁（GitHub CI Gate Integrity）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 自指排除夹具 12/0 → `verify: bash tests/control-tower/check-gate-integrity-selfexclude.test.sh`
- [ ] 既有夹具回归 73/0 → `verify: bash tests/control-tower/check-gate-integrity.test.sh`
- [ ] 本地 12 组通过 → `verify: bash scripts/pre-commit-check.sh`
