# Task Brief: FIX-013 + FIX-015 — iron-laws 活点接线（移出与接手同批）+ 判定面自伤排除
> 认领: 🧭 fix-coder-a（synova-squad-lead 小队）｜ 分支: fix/d962-2a-iron-laws-wiring ｜ 基线: feat/d962-2a-merge @ 31971419（stacked，PR base 显式）
#CRITERIA: A

## Q0: 定位
### a) 拼图
控制塔提交链路 + CI 权威门禁。D962 2a① 把 34 项判定从本地 pre-commit 移出，交给 CI 权威区（SYNO_CI=1）；接手方此前只存在于 `quality` job 的一个 step 内，而 `quality` 一红，`needs: quality` 的下游整块 skip ⇒ 必需检查永不回报（#802/#803/#804/#805 mergeState=blocked）。本卡把接手落成**无 needs 的独立活点**并按路径修掉自伤。
### b) 文件审计
- `.github/workflows/ci.yml`：`quality` job（含 Iron laws step，`if: docs_only != true`）+ `test`（`needs: quality`，矩阵 `shard: [1/2, 2/2]`）。无独立 iron-laws job（实测 0 命中）。
- `scripts/pre-commit-check.sh`（#803 版 399 行）：两条字面量判定扫 `$GIT_CACHED_DIFF` ⇒ 自伤（CI job 108143405913 实测 9+3 处，全部来自脚本自身/测试标签/文档）。
- 接线断言现状：`g5-architecture.test.sh:12`、`g8-file-driven.test.sh:85`、`precommit-groups-injection.test.sh:207/430`、`sync-dsh-skills.test.sh:109-110` 均写「CI 挂载归 2b」⇒ 无活点断言。
### c) 决策
复用既有实现（同一脚本 CI 权威区），只加**活点 job** + **按路径排除**；不新建门禁、不改判定语义、不动 `quality`（避免削弱既有必需检查）。

## Q1: 调研
铁律 35（能变 check 的不靠 review）、48（正常/降级/边界 + 真断言）、11（降级显式不静默）、D516（CI strict）、D542（CI 下 ❌ 必显）、D526（失败经 ::error 可定位）、D501（as-any 检查排除测试文件——既有已批准口径）、D962 2a/2b（移出→接手）。
历史教训：D549（声称入列实为零代码 = M2）、D555（沙箱测试污染宿主 index）、D922（grep 型静态判据当验收，实测 3/5=60%）。
参考：第一性原理（保护真空的判据必须是「活点存在且可达」而非「配置写了」）+ Anthropic 基线（job 独立可绿可红，不被无关失败污染）+ 开源实证（CI job 粒度独立于上游 job）+ 收敛检查（成对反例 + 删掉即红夹具）＋ 结论：独立 job + 按路径排除 + 两个判别性测试。

## Q2: 范围 — 最简方案
做什么：
- scripts/pre-commit-check.sh
- .github/workflows/ci.yml
- tests/control-tower/iron-laws-live-point.test.sh
- tests/control-tower/iron-laws-selfdiff.test.sh
不做什么（含文件路径）：
- 不改 scripts/audit/check-gates-v2.py （审计红线域）
- 不改 docs/synova/audit-reports/INDEX.md （K3 审计报告域）
- 不改 scripts/control-tower/bypass-ledger.sh （D970/#799 写面）
- 不改 tests/control-tower/precommit-groups-injection.test.sh （既有夹具本体：仅注释指针更新，行为不改）

## Q3: 验收
入口: `.github/workflows/ci.yml` 的 `iron-laws` job（无 needs）与 `bash scripts/pre-commit-check.sh`（SYNO_CI=1）。
处理: 活点跑 CI 权威区全部判定面；字面量判定只看「源面代码文件」的 added 行。
结果: 活点 job 真 run 绿（URL 见回执）；源面注入仍红、自伤面转绿（成对反例）；删掉 job/断言 → 测试红。

## 架构层: 基础设施（CI 门禁 + scripts/control-tower 控制塔）
## Done 标准
- [ ] verify: `bash tests/control-tower/iron-laws-live-point.test.sh`（exit 0；含 ⒜ 行号 + ⒝ 删掉即红夹具）
- [ ] verify: `bash tests/control-tower/iron-laws-selfdiff.test.sh`（exit 0；Arm-A src 注入仍红 / Arm-B 自伤面转绿 / Arm-C 12 行不截断）
- [ ] verify: `GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh`（exit 0）
