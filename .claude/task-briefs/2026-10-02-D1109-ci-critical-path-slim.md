# Task Brief: D1109 CI 关键路径瘦身（simulate-ci smoke 缩量 + 清单保值断言）

> 生成: 2026-10-02 | 任务: D1109 | 认领: win-codex-cto
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔自检工具层（`scripts/control-tower/`），不在 L1–L5 产品层。本卡只碰「push 前 CI 等价模拟」这一件工具及其夹具，**零产品码**。

### b) 文件审计（file:line 实测）
| 位置 | 现状 |
|---|---|
| `scripts/control-tower/simulate-ci.sh:39-41` | ① 真跑 `scripts/pre-commit-check.sh`（SYNO_CI=1 严格） |
| `scripts/control-tower/simulate-ci.sh:49` | ② 从 `ci.yml` **单源提取**密封清单（排除自身，防递归） |
| `scripts/control-tower/simulate-ci.sh:53-64` | ② **逐条真跑**清单里每一条测试 |
| `tests/control-tower/simulate-ci.test.sh:37,47,52` | 三次调用 simulate-ci.sh（绿桩 / 红桩 / 降级） |
| `.github/workflows/ci.yml:476` | `simulate-ci.test.sh` **自身就在 CT job 密封清单里** |
| `.github/workflows/ci.yml:428-430` | 该 step Windows 上限 `timeout-minutes: 60` |

清单条数实测 = **45 条**（`grep -oE 'tests/control-tower/[a-z0-9-]+\.test\.sh' .github/workflows/ci.yml | grep -v 'simulate-ci\.test\.sh' | sort -u`）。

**病根（CI 实测，非推断）**：run 36520361276，windows CT 腿
```
04:10:10 -> 04:12:23  前面 13 条测试合计 133s
04:12:23 -> 05:10:17  simulate-ci.test.sh 独占 3474s
##[error]The action 'Run hermetic control-tower gate tests' has timed out after 60 minutes.
```
即：一条测试吃掉该 step **96%** 墙钟，撞 60min 上限 → CT(windows) 恒红 → **全仓 120 个 open PR 同时被这条必需检查堵住**。

### c) 决策
**复用**现有 `SYNO_SIM_PRECOMMIT` 注入缝范式，新增并列缝 `SYNO_SIM_SCOPE`；不新建文件、不改调用方协议、不改 ① 段与三态退出语义。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **第一性原理**：② 的验证力 = ①清单单源 ②条目存在 ③条目可执行。嵌套场景（夹具自身就在 CT job 清单内）下第③项已由 CT job 本体真跑一遍；再跑是纯重复，**边际信息量为零**。
- **memory 教训**：`memory/notes/implemented/2026-08-24-d521-submit-chain.md:21`「凡『从清单跑测试』的工具，自排除是标配（否则递归挂死 600s）」。本卡同族：凡「缩量」，必须配**保值断言**，否则等于偷偷拆门禁。
- **既有独立复核（先例）**：`docs/synova/product-lines/evidence/D1039-A4v-独立复核-墙钟比对.md:667-670` 已实测 `simulate-ci.test.sh` = **1524s**，判定为「for 清单里最重的测试」。
- 参考：D521（单源清单）+ D956（失败断言行入窗，本卡不动）⇒ 结论：**只缩「真跑条数」，不缩「清单完整性与存在性校验」**。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/simulate-ci.sh
- tests/control-tower/simulate-ci.test.sh
- .claude/task-briefs/2026-10-02-D1109-ci-critical-path-slim.md
- task-state/D1109.json
- memory/notes/implemented/2026-10-02-d1109-ci-simulate-smoke.md
- .claude/bypass.log

（做什么的说明：① simulate-ci.sh 新增 `SYNO_SIM_SCOPE` 注入缝——默认 `full` = 历史行为逐字节不变，`smoke` = 只真跑 `SYNO_SIM_SMOKE_TESTS` 两条代表样本；清单仍从 ci.yml 单源提取 + 每条存在性校验 + 打印 `SIM_MANIFEST_TOTAL / SIM_RUN / SIM_SCOPE`。② 夹具三次调用置 `SYNO_SIM_SCOPE=smoke`，并加三条保值断言（scope 生效 / 清单未被改小 / 确实缩量）。③ brief 与 task-state 卡为流程伴生件。④ `.claude/bypass.log` 由 post-commit hook 自动追加，非人工内容。）

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/control-tower/synova-submit.sh
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/simulate-ci.test.sh` / `bash scripts/control-tower/simulate-ci.sh`
处理：夹具三次调用 simulate-ci.sh（绿桩 / 红桩 / 缺失桩）→ ② 只真跑 2 条代表样本，其余 43 条只校验存在性
结果：夹具 **10/10 绿 · EXIT 0 · 36s**（改动前本机同平台 1524s）；`SIM_MANIFEST_TOTAL=45` 与夹具独立重算一致

## 架构层:
scripts（控制塔）

## Done 标准
- [ ] verify: `bash tests/control-tower/simulate-ci.test.sh` → `结果: 10 通过, 0 失败` + EXIT 0
- [ ] verify: 默认（不设 scope）路径与改动前**逐字节等价** —— `SYNO_SIM_SCOPE=full bash scripts/control-tower/simulate-ci.sh` 走全量清单
- [ ] verify: `SIM_MANIFEST_TOTAL` == 独立重算条数（45），`SIM_RUN < SIM_MANIFEST_TOTAL`
- [ ] verify: push 后 CT(windows) 新 run 耗时 <= 900s（CI 侧取证）
