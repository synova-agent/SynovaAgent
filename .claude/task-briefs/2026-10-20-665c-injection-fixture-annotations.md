# Task Brief: P4 · #665 判据⑦ 夹具失败发 GitHub annotation

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- GitHub step 5 红但本机复现不出；job log 404 ⇒ 需要在 check-runs annotations 里看到 ❌ 行。
- 相关件：`tests/control-tower/precommit-groups-injection.test.sh` 失败分支（尾部 `❌ 注入自测未达期望`）。

## Q1: 调研（决策链 / 既有基础）
- 先例：ci.yml Publish gate-integrity summary 用 `::notice` 发证据；annotations API 公开可读。
- 约束：不动 ⑥ 的 env -i 隔离；不放宽判据；不删断言。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- tests/control-tower/precommit-groups-injection.test.sh
- gate-exemptions/2026-10-20-injection-fixture-annotations-665c.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-injection-fixture-annotations-665c.md
- .claude/task-briefs/2026-10-20-665c-injection-fixture-annotations.md
不做什么：
- scripts/pre-commit-check.sh
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：夹具失败分支（本机变异造失败）
- 交互：判据⑦ annotation 含 ❌ 行；改回 echo ⇒ 0 条；本地（无 GITHUB_ACTIONS）⇒ 0 条
- 结果：必失败变异 ⇒ 10 条 `::error title=injection-fixture::`；绿跑/本地 ⇒ 0 条。

## Q4: 契约与测试
- 只在 RC=1 且 GITHUB_ACTIONS=true 时发；≤10 条；剥 ANSI 与嵌套 `::error` 前缀。
- 来源 `$TMP/out.*.log`；无 ❌ 则 fallback 一条摘要。

## 本任务在哪一层
- 治理线 / 门禁（GitHub 观测面）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 必失败变异 ⇒ annotation 含 ❌ 行 → `verify: GITHUB_ACTIONS=true bash /tmp/ann665c4/forced.sh | grep '::error title=injection-fixture::'`
- [ ] 绿跑 ⇒ 0 条 → `verify: GITHUB_ACTIONS=true bash tests/control-tower/precommit-groups-injection.test.sh | grep -c '::error'`
- [ ] 本地 ⇒ 0 条 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh | grep -c '::error'`
