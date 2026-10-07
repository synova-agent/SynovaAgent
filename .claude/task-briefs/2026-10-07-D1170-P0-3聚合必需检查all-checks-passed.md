# Task Brief — P0-3 聚合必需检查 all-checks-passed（CTO 派单 Lane A，2026-10-07）

## Q0: 定位 — 项目拼图 + 文件审计
- 本任务在治理面（非五层业务层）：`.github/workflows/ci.yml`，路径所有权 = 治理线（ownership.yaml:151）。
- 文件审计：ci.yml 现有 13 个 job 键（枚举 `grep -nE "^  [A-Za-z0-9_-]+:$" .github/workflows/ci.yml`），
  其中 checker-review 是唯一带事件过滤 `if: github.event_name == 'pull_request' || feat/*` 的必需 job。
  无既有聚合 job ⇒ 新建，蓝本 = DSH 上游 ci.yml:700-723（dsh-v0.2.0-rc.2，逐字照抄，唯一差异去掉 PR 事件限定）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 最佳实践：GitHub required checks 无法区分 skipped 与 success ⇒ 业界标准做法 = 聚合 job 把 skipped 判 FAIL（DSH 上游真身即此形态）。
- 历史教训：#905 假绿（docs-only 误判 ⇒ 重步骤 skip 但 job 报 success ⇒ 假绿合入 ⇒ main ERESOLVE 11 小时）。
- 铁律引用：0-2（先红后绿夹具）、35（自动化优先：规则进 CI 不靠 review）。
- 决策参考：Anthropic/DSH 上游实证 + CTO 派单详细件逐字蓝本。

## Q2: 范围 — 正确的最简方案
做什么：
- `.github/workflows/ci.yml`（本卡唯一代码写面，两处改动）：
  1. 新增 `all-checks-passed` 聚合 job（needs=8 job 键覆盖 9 条必需 context；skipped/failure/cancelled 均判红；`if: !cancelled()`）。
  2. P0-2：checker-review 的 job 级 `if:` 扩为（同理由见下） `pull_request || merge_group || refs/heads/main || feat/*`
     （原条件在 main push / merge_group 下整个 job 被 skip ⇒ ① main push「看不见坏」；② 聚合 job 判 skipped=FAIL ⇒ main push 恒红；
      ③ merge_group 下必需 context 永不报告 ⇒ merge queue 卡死，D515 同族）。
- `tests/control-tower/ci-signal-classify.test.sh`（D1112 冻结表达式登记表同步：checker-review 基线换 D1170 扩集版逐字串；all-checks-passed 登记 DOWNSTREAM_NEEDS_JOBS ⇒ !cancelled() 冻结式获得改坏即红防线——本地 79/0）
- `memory/notes/proposed/2026-10-07-d1170-all-checks-passed-aggregate.md`：决策 Note（铁律 49）。
- `.claude/task-briefs/2026-10-07-D1170-P0-3聚合必需检查all-checks-passed.md`：本 brief。

不做什么（含文件路径）：
- 不修改 scripts/**（如 pre-commit-check.sh、check-required-contexts.py）——含 scripts/audit/** K3 域
- 不修改 .github/workflows/ 下其余 workflow（如 dashboard-auto.yml、progress-freshness-watchdog.yml 均不动）

冻结约束（非排除项）：ci.yml 内 13 个既有 job 的 job-name 与 needs 字段一字不改（Done 标准 git diff 核对）；branch protection 与 required contexts 归 CTO 裁权，本卡零触碰。

解释口径（按 X 解释，代价 Y）：派单判据第 4 条写「git diff 除新增段外零改动」，与第 ② 项「main push 真跑」物理不可兼得——若保留 checker-review 原事件过滤，main push 必恒红。故按「③ 只冻结 name 与 needs」解释执行，代价是 diff 多出 checker-review 的 if 一处加 5 行注释。

## Q3: 验收 — 入口 → 交互 → 结果
- 入口：PR / main push / merge_group 触发 CI。
- 交互：任一 needs job 出现 failure/cancelled/skipped ⇒ 聚合 job 红，annotation `::error::Needed job results: ...` 点名。
- 结果：`All Checks Passed` check-run 在所有事件语境存在且判定真实（CTO 后续将其加为 required context）。

## 架构层: 治理面（.github/workflows，非 L1-L5）

## 写集
| 文件 | 类型 |
|---|---|
| .github/workflows/ci.yml | task |
| tests/control-tower/ci-signal-classify.test.sh | task |
| .claude/task-briefs/2026-10-07-D1170-P0-3聚合必需检查all-checks-passed.md | task |
| memory/notes/proposed/2026-10-07-d1170-all-checks-passed-aggregate.md | task |

#CRITERIA: D

## Done 标准:
- [ ] 夹具①: quality 临时加 if:false ⇒ All Checks Passed 必红，annotation 点名 skipped（贴原始输出）
- [ ] 夹具②: 判定改坏为 needs.quality 单判 ⇒ 构造 skipped ⇒ 必绿（贴原始输出）
- [ ] 夹具③: 去掉 !cancelled() ⇒ 上游红时本 job 消失（无 check-run）⇒ 夹具抓到
- [ ] 基线: 既有 13 个 job 的 name 与 needs 字段一字不改（git diff 核对）
- [ ] 本地: check-required-contexts.test.sh 全过、check-gate-integrity.sh 通过、check-required-contexts.py 9/9 命中
