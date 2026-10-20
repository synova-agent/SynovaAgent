# Task Brief: P4 · #665 夹具 tsx 依赖（CI 真红根因）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- CI 日志实证：夹具跑完整 pre-commit 时组 13（块级 paths 快照对账）需要 tsx；克隆无 node_modules、job 无依赖安装 ⇒ exit 2 ⇒ baseline 恒红。
- 相关件：`.github/workflows/ci.yml`（gate-integrity job）｜`tests/control-tower/precommit-groups-injection.test.sh`（_run_gate_env）。

## Q1: 调研（决策链 / 既有基础）
- 门禁自带 `SYNO_TSX` 注入缝；ci.yml 其它 job 装依赖、gate-integrity 未装。
- 红线：不放宽判据；⑥/⑦/⑧ 不动。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- .github/workflows/ci.yml
- tests/control-tower/precommit-groups-injection.test.sh
- gate-exemptions/2026-10-20-injection-fixture-tsx-665e.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-injection-fixture-tsx-665e.md
- .claude/task-briefs/2026-10-20-665e-injection-fixture-tsx.md
不做什么：
- scripts/control-tower/check-*.sh
- scripts/audit/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：本地夹具（绿）＋ GitHub 重跑 gate-integrity
- 交互：CI 安装 tsx ⇒ 组 13 可跑 ⇒ baseline=ok
- 结果：GitHub gate-integrity job 绿（step 5 绿）；本地 12 组/夹具仍绿。

## Q4: 契约与测试
- ci.yml：装 tsx step（docs-only 跳过）＋ timeout 10；夹具：SYNO_TSX 注入。
- 不改门禁判据。

## 本任务在哪一层
- 治理线 / 门禁（CI 依赖）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] 本地夹具绿 → `verify: bash tests/control-tower/precommit-groups-injection.test.sh`
- [ ] YAML 合法 → `verify: ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'`
- [ ] GitHub gate-integrity 绿（镜像重跑）→ `verify: gh api repos/synova-agent/SynovaAgent/actions/runs/<run>/jobs`
