# Task Brief: D1064 post-commit 软失败记账 CI 必红/本机必绿（环境依赖根治）

> 生成: 2026-09-29 | 任务: D1064 | 认领: synova-squad-lead → D1064 编码执行者（专职小队）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔 git hook 层（基础设施，非产品五层）。post-commit.sh 的 CT-2 逻辑（D1023 批次引入）：
pre-commit 软失败被放行 ⇒ 账本 bypass.log 记 `DEGRADED-PASS (soft-fail allowed ts=… exit=…)`。
该逻辑在 macOS（BSD stat）必绿、ubuntu CI 必红（job 109245598170：`13 通过, 2 失败`），
判据文本一字不改，只消除环境依赖。

### b) 文件审计
- `scripts/hooks/post-commit.sh:49 _mtime_sec()`（改前行号）— 回退链 BSD `stat -f %m` 在前。
- `scripts/hooks/post-commit.sh:55 _softfail_state()` — mtime 窗口 `$((mm - lm))` 纯算术，无输入消毒。
- `tests/control-tower/post-commit.test.sh:129` SB2 CT-2 段 — 夹具只在 BSD 语义下验证，无 CI 等价面。
- 根因（coreutils v9.4 `src/stat.c` 实证 + 改前红证）：GNU `stat` 的 `-f` = `--file-system`，
  不吃格式参数；`stat -f %m FILE` 的操作数 = `(%m, FILE)` ⇒ `%m` 报错（stderr，exit 1 被
  `|| true` 吞），FILE 的**文件系统信息走 stdout** ⇒ `v` 捕获到非空垃圾 ⇒ 回退链不触发 ⇒
  `$((mm - lm))` 算术爆炸 ⇒ `|| return 0` ⇒ 状态空 ⇒ 账本记纯 PASS。BSD/macOS `stat -f %m`
  恰好是合法 mtime 语法 ⇒ 本机必绿（假阳性）。

### c) 决策
复用既有函数与既有测试文件（不新建机制）。修法 = 回退链反转为 GNU 权威在前（`stat -c %Y`）
+ 两级结果纯数字校验（非数字/空一律丢弃 ⇒ 下一级/显式空）。CI 等价夹具 = 测试内自建 GNU 语义
stat shim 前置 PATH（D1030 GIT_CONFIG_GLOBAL 造异环境同源手法），本机即可强制走 GNU 面。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 0-2：改前必红（CI 等价环境复现 `13 通过, 2 失败`，与 CI job 输出逐字一致）后才改码。
- 铁律 11/31：stat 全链失败 ⇒ 显式空（退回原纯 PASS 行为 + wrapper 双留痕仍在），不臆造降级。
- 铁律 47/48：`_mtime_sec` 契约注释同步更新；夹具有判别性断言（还原回退链顺序即红）。
- ctrl-tower-change 模式 5：变异缝 + 沙箱证明「接线了 ≠ 被执行」的反面（删掉即红）。
- windows-compat：UTF-8 头块不动；无新增裸 `2>/dev/null`（原有 `|| true` 结构保持）。
- memory 教训：D1030（异环境手法）、D1023（CT-2 判据冻结——文本一字不改）。
参考：第一性原理（跨方言的输入必须消毒到单一规范型再进算术）+ coreutils 源码实证
（stat.c print_statfs/操作数处理）→ 结论：GNU 权威 + 纯数字校验，零方言依赖。

## 写集（机器块 = 单一事实源，D749）

| 文件 | 类型 |
|---|---|
| scripts/hooks/post-commit.sh | task |
| tests/control-tower/post-commit.test.sh | task |
| .claude/task-briefs/2026-09-29-D1064-softfail-ledger-CI-parity.md | task |
| task-state/D1064.json | task |
| .claude/bypass.log | builtin（post-commit hook 证据账本，运行期产物） |

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/hooks/post-commit.sh — `_mtime_sec()`：回退链反转为 GNU `stat -c %Y` 权威在前、
  BSD `stat -f %m` 兜底；两级结果纯数字校验，非数字/空一律不进 mtime 窗口算术。
- tests/control-tower/post-commit.test.sh — 新增 CT-2b CI 等价夹具（GNU stat shim 注入 PATH，
  复刻 coreutils v9.4 两种调用形态语义），断言 GNU 环境下账本仍记 DEGRADED-PASS。
- .claude/task-briefs/2026-09-29-D1064-softfail-ledger-CI-parity.md — 本 brief（治理产物）。
- task-state/D1064.json — D# 登记件（治理产物）。

不做什么（含文件路径）：
- 不改 scripts/control-tower/check-pr-budget.sh（派单禁区）
- 不改 scripts/hooks/pre-commit-check.sh（派单禁区）
- 不改 tests/control-tower/simulate-ci.test.sh（派单禁区）
- 不改 scripts/audit/ 全目录（K3 审计专属，红线）
- 不改 scripts/control-tower/gate-integrity-baseline.txt（派单禁区）
- 不改判据文本 `DEGRADED-PASS (soft-fail allowed ts=… exit=…)`（D1023 冻结）

## Q3: 验收 — 入口 → 交互 → 结果
入口：ubuntu CI post-commit 测试 job；本机 `bash tests/control-tower/post-commit.test.sh`。
处理：GNU stat 方言下 `_softfail_state` 仍返回 DEGRADED-PASS 证据（shim 夹具强制走 GNU 面）。
结果：本机原生 17 通过 0 失败；GNU shim PATH 注入 17 通过 0 失败；改前（d718820f 原版代码 +
shim）复现 `13 通过, 2 失败`；变异（注释 _softfail_state 调用）→ 4 失败（判别性成立）。

## 架构层: 基础设施

## Done 标准
- [ ] verify: `bash -n scripts/hooks/post-commit.sh` exit 0
- [ ] verify: `bash tests/control-tower/post-commit.test.sh` exit 0（0 失败）
- [ ] verify: `PATH=<GNU shim> bash tests/control-tower/post-commit.test.sh` exit 0（CI 等价绿）
- [ ] verify: `SYNO_HOOK_UNDER_TEST=<变异副本> bash tests/control-tower/post-commit.test.sh` 非 0
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh --root .` → GATE-INTEGRITY: OK
