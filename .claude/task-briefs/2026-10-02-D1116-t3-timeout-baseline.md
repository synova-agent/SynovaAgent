# Task Brief: D1116 T3 timeout 基线重取（ci.yml，n=12 实采样）

> 生成: 2026-10-02 | 任务: D1116 | 认领: win-codex-cto
> 派单源: `docs/synova/dispatch/2026-10-02-T3-timeout基线重取-派单.md`（PR #942）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CI 配置层（`.github/workflows/`）。本卡只把 `ci.yml` 的 **T3 timeout 基线**按已载口径重取并同批更新注释，**零产品码、零脚本改动**。

### b) 文件审计（file:line 实测）

| 位置 | 现状 |
|---|---|
| `ci.yml:36-39`（等 9 处同款注释块） | `as_of=2026-09-26T04:47:47+08:00` 已过期；注释表与 value 脱节 |
| `ci.yml:40` `quality` | `timeout-minutes: 6`；实测公式值 **378s ⇒ 7min** |
| `ci.yml:281` `test-kit-architecture` | `&& 2 || 1`；实测 windows **158s ⇒ 3min** |
| `ci.yml:660` `golden-case` | `timeout-minutes: 1`；实测 **81s ⇒ 2min** |
| `ci.yml:705` `gate-integrity` | `timeout-minutes: 1`；实测 **69s ⇒ 2min** |
| `ci.yml:428-430` CT 关键词 step | **现值 60min < 同口径公式值 96min**（n=10 重活样本）⇒ 正是 run 36520361276 被砍死的原因 |

**采样方法（两个过滤器缺一不可）**：60 个 success run → 剔除 docs-only（判据：`TypeScript + Lint + Iron Laws` < 60s）→
CT 腿再按 D1039「碰/不碰」分层（windows `< 300s` 视为未跑重活）⇒ 14 轮真实执行，CT 重活样本 n=10。

### c) 决策
**只改数值与注释，不改结构**：不动 job/step 的 `name`（12 项必需检查靠名字逐字匹配）、不动 `if:`、不动密封清单。
CT 的 job 与 step **本卡明确不重取**（口径要 n=12 同分布样本，D1109 后 n=1），只在注释里写明「未重取」。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **口径就是判据**：`ci.yml` 自载「只取 success；n=12；公式 = max(P95×1.5, 中位数×3)」——本卡不发明新口径，只把数据换成实测。
- **为什么必须先过滤**：`gh run list --status success` 里有大量 **docs-only 轮次**，其 job 只跑 10~30s；
  直接混算会把中位数压到 11s，公式值失真。CT 腿另有 D1039「碰/不碰」双峰（18~30s vs 1336~2413s），同理。
- **历史教训**：run 36520361276 —— CT(windows) 不是测试红，是 **step 超时**：
  `##[error]The action 'Run hermetic control-tower gate tests' has timed out after 60 minutes.`
  即「基线注释与 value 脱节」不是格式问题，**会直接把全仓 PR 堵死**。
- 参考：D1109（#939，已把 CT windows 从 3607s+ 降到 758s）⇒ 本卡是它的同批收尾。

## Q2: 范围 — 正确的最简方案
做什么：
- .github/workflows/ci.yml
- .claude/task-briefs/2026-10-02-D1116-t3-timeout-baseline.md
- task-state/D1116.json
- .claude/bypass.log

不做什么：
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/control-tower/simulate-ci.sh
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：读 `ci.yml` 的 T3 注释块与 value
处理：把 4 个 job 的值按公式取整；把 10 处注释的 `as_of` 与数值表换成本次实测
结果：`as_of` 全部为 2026-10-02；4 个 value 与公式值一致；CT 处明确标注「未重取」

## 架构层:
scripts（CI 配置层）

## Done 标准
- [ ] verify: `git grep -c "as_of=2026-09-26" .github/workflows/ci.yml` ⇒ **0**
- [ ] verify: `git grep -n "as_of=2026-10-02" .github/workflows/ci.yml` ⇒ 10 处
- [ ] verify: `bash scripts/pre-commit-check.sh`（SYNO_CI=1 同款参数）⇒ 无本卡引入的红
- [ ] verify: 合并后新 run 的 Control Tower(windows) 与各 job 均 success
