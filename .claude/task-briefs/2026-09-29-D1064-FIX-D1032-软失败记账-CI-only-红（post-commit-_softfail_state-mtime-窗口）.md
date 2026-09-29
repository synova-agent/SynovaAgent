# Task Brief: D1064 FIX-D1032 软失败记账 CI-only 红（post-commit `_softfail_state`）

> 生成: 2026-09-29 | 任务: D1064 | 认领: <开工时填> | 来源: D1032(#868) CI 红归因 —— Mac-CTO 2026-09-29 裁定「立卡」
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
基础设施层（git hook + 控制塔夹具），**不涉产品五层 L1–L5**。
所属防线 = post-commit hook 的「软失败记账」（D1032 / CT-2 交付物）：门禁被 wrapper 软化放行时，
账本必须记 `DEGRADED-PASS (soft-fail allowed ts=… exit=…)`，不得记成纯 `PASS`。
### b) 文件审计（实测，非记忆）
- `scripts/hooks/post-commit.sh`：`_mtime_sec()` + `_softfail_state()`
  （两道 mtime 窗口 `[ "$((mm - lm))" -le "$win" ]` / `[ "$((lm - mm))" -le "$win" ]` + 「已消费」判定）
- `tests/control-tower/post-commit.test.sh`：`SB2` 沙箱 CT-2 段（复刻 wrapper 写序）
- `tests/control-tower/simulate-ci.test.sh`：把内层红**透传**为红（不是病根，别改它）
### c) 决策
在既有两文件内修（不新增脚本、**不放宽判据**）：只消除「本机绿 / CI 红」的环境依赖。

## Q1: 调研 — 业界最佳实践 / 历史教训
**CI 原始输出**（Control Tower Gate Tests (ubuntu)，job 109245598170）:
```
FAIL: tests/control-tower/post-commit.test.sh
  ❌ 账本未记真实状态: 2026-09-29T03:44:00+00:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=54bba078…
  ❌ 软失败被记成纯 PASS（判据未满足）
结果: 13 通过, 2 失败
```
**本地同分支同命令**：`结果: 15 通过, 0 失败`（exit 0）
⇒ 同一份代码**本机绿 / CI 红** ⇒ 判定为**环境依赖型真缺陷**（M5b 族），不是判据太严。
**同型先例（同一天刚发生）**：D1030 的 `merge_writeset_gate.test.sh` 用裸 `git init`，本机默认分支 `main`、
GitHub runner 默认 `master`（CI 日志 `hint: Using 'master' as the name for the initial branch`）
⇒ 本机 60/60、CI 58/2。**判据：夹具必须 hermetic —— 不得依赖宿主 stat / 文件系统语义。**
参考系：第一性原理（写序判定优于时间戳判定）+ M5b/M13 历史教训 + `windows-compat` 模式库。

## 写集（机器块 = 单一事实源，D749；D708 合并级对账读此表）

| 文件 | 类型 |
|---|---|
| scripts/hooks/post-commit.sh | task |
| tests/control-tower/post-commit.test.sh | task |
| .claude/task-briefs/2026-09-29-D1064-FIX-D1032-软失败记账-CI-only-红（post-commit-_softfail_state-mtime-窗口）.md | task |
| task-state/D1064.json | task |
| .claude/task-briefs/2026-09-29-D1065-FIX-bypass.log-跨-PR-弄脏（合并吞吐瓶颈）.md | task（同批登记的第二张卡；D708 按分支名只解析一个 D# ⇒ 由本卡代声明） |
| task-state/D1065.json | task（同上） |
| .claude/bypass.log | builtin（post-commit hook 证据账本，运行期产物） |

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/hooks/post-commit.sh — 消除 `_softfail_state()` 的环境依赖（候选面：stat 方言回退链 / mtime 粒度 / 写序判定）；**先出复现再改**
- tests/control-tower/post-commit.test.sh — 补「CI 等价」夹具：在本机即可复现 CI 红的那一面
不做什么（含文件路径）：
- 不改 scripts/control-tower/check-pr-budget.sh（Mac-CTO 2026-09-29 裁定：该文件归其独占）
- 不改 scripts/pre-commit-check.sh（本地软提示 + CI 权威语义不动）
- 不放宽 CT-2 判据：`DEGRADED-PASS (soft-fail allowed ts=… exit=…)` 文本一字不改
- 不改 tests/control-tower/simulate-ci.test.sh（它只透传内层红，非病根）
- 不动 tests/control-tower/gate-integrity-baseline.txt（D1032 已收口，勿重开）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/post-commit.test.sh`
处理：`SB2` 沙箱复刻「wrapper 先 append 软失败行 → 再写 marker → 提交」→ hook 判定软失败状态
结果：本机与 CI **同源同结论**（双绿），且「改坏即红」可证

## 架构层
基础设施（git hooks + tests/control-tower 夹具）；**非 L1–L5**

## Done 标准
- [ ] verify: 交付「CI 等价」复现命令，**改前必红** —— 贴改前原始输出（无此复现即不算定位）
- [ ] verify: `bash tests/control-tower/post-commit.test.sh` → `0 失败`（本机）
- [ ] verify: 同命令在 CI 等价环境（CI 运行 / 容器 / 强制方言）→ `0 失败`
- [ ] verify: 改坏即红 —— 注释 `_softfail_state` 调用 → CT-2 断言变红（贴原始输出）
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh --root .` → `GATE-INTEGRITY: OK`
