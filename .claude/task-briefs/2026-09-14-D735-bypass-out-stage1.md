# D735 Stage 1: bypass 证据账本出库（per-session 落点，兼容并存）

> 派单: docs/synova/coordination/派单-第四批-D733-D736-20260913.md §三 · D735
> **本 PR = 派单硬要求「至少 2 个 PR，不许一个 PR 切完」的第 1 个**：只做「兼容并存」，不做切换与清理。
> 前置: 批 A 已入 main（D733 c711a18f / D734 3f0a43b5）。

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔证据链基建（非五层运行时）。现状：`.claude/bypass.log` 是 **git 跟踪文件**，post-commit hook 每次提交追加一行证据 → 每个分支必带 bypass.log 变更，多 PR 并发合并靠 `.gitattributes` 的 `merge=union` 兜冲突。本任务把它迁到 **per-session 落点** `.sessions/<sid>/bypass.log`（`.gitignore:83` 已忽略 → 写入零 git status 变更）。本 PR 只建**新链路 + 双写**，旧路径仍是权威。
### b) 文件审计
实测 `grep -rln "bypass.log" scripts/` = **17**（CTO 口径复现；其中 `pre-audit-summary.sh` 是「未转义 `.` 命中 `check-bypass-log` 文件名」的误配，真正含 `bypass\.log` 的是 **16** 个）。本 PR 触及其中 2 个（写入方 `hooks/post-commit.sh` + 对账方 `control-tower/check-bypass-log.sh`），新增 1 个解析器。其余 13 个（仪表盘/健康度/子提交器/worktree-manager 等）**本 PR 不动** —— 它们读旧路径的行为不变，切换留给 Stage 2。
### c) 决策
已有覆盖→复用 `check-bypass-log.sh`（D331 在跑的实测结论，派单要求复用）。无覆盖→新建解析器 `bypass-ledger.sh`。冲突→无。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
业界: append-only 审计日志的通行做法是「进程/会话级落点 + 集中采集」，而不是「所有人写同一个被 git 跟踪的文件」——后者必然产生写冲突，只能用 union merge 打补丁（本项目 `.gitattributes:14` 正是这个补丁）。Anthropic 工程基线: ① 隔离 —— 每会话独立落点，写者之间零竞争；② fail-closed —— 落点不可写必须 exit 2，**不许静默回退写旧路径**（否则迁移期证据静默分裂）；③ 机器可验契约。memory 历史教训: D457（bypass union 合并）、D451（纯补记豁免）、D513（tracking ref 陈旧致补记循环）、**D370 bash+全角变量边界**（本 PR 开测即踩，见 §四）、铁律 11 静默降级禁止。
Q1c 决策参考系: 参考 Anthropic（会话级隔离 + fail-closed 三态）+ 第一性原理（写冲突的根因是「多写者同一文件」，换落点即可消除，不需要更聪明的合并）+ 开源实证（append-only 审计日志的会话级落点惯例）。结论: 收敛 —— 解析器 + 双写 + 联合读，三步分两 PR。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/bypass-ledger.sh（新建：path/append/sources/read 四个子命令，含两个测试注入缝）
- scripts/hooks/post-commit.sh（改：5 处证据写入点收敛到一个 `_bypass_append` helper，**双写**旧路径 + 新落点）
- scripts/control-tower/check-bypass-log.sh（改：对账来源由单一旧路径改为 **union**（旧 + per-session），D331 语义与 exit code 不变）
- tests/control-tower/bypass-ledger.test.sh（新建，22 项）
- .claude/task-briefs/2026-09-14-D735-bypass-out-stage1.md（本 brief 自身）
- memory/notes/proposed/2026-09-14-bypass-ledger-out-of-git.md（铁律 49/D534 强制 Note）
不做什么：
- 不改 scripts/pre-push-check.sh（D331 门禁调用方；切换期它读的 checker 已 union 化，无需动）
- 不改 scripts/control-tower/gen-cto-health.py（仪表盘读旧路径；切换留给 Stage 2）
- 不改 scripts/control-tower/merge_writeset_gate.py（写集对账的内置豁免项，Stage 2 再评估）
- 不改 scripts/install-hooks.sh（union driver 注册；Stage 1 仍需要，Stage 2 才撤）
- 不改 .github/workflows/ci.yml（红区）
- 不改 scripts/audit/audit-rules.sh（K3 审计红线，禁碰）
- 不改 tests/control-tower/tag-bypass-wiring.test.sh（**该测试在 origin/main 上已是红**：3 条同样失败，实测基线确认，非本 PR 引入，见 §四）

## Q3: 验收 — 入口 → 交互 → 结果
入口: `bash scripts/control-tower/bypass-ledger.sh {path|append <行>|sources|read}`；post-commit hook 在每次提交后自动双写。
处理: 解析会话标识（env > 分支 > 目录名）→ 归一为路径安全 id → 落 `.sessions/<sid>/bypass.log`；对账时 union 读旧路径 + 全部 per-session。
结果: 新落点写入成功且 `git status` 零 bypass 相关变更；旧路径行为完全不变；D331 对账仍通过。

## 架构层: 基础设施
控制塔证据链基建（scripts/control-tower/ + scripts/hooks/），与五层运行时（L1-L5）无关：不 import src/、不 import packages/、零跨层。

## Done 标准: 物理命令断言（每条可直接跑，exit 0 = 达标）
- [ ] DS1: `bash tests/control-tower/bypass-ledger.test.sh` 全绿（22 项：正常/降级/边界/接线/Stage 1 不变量）
- [ ] DS2: 回归零新增失败: `bash tests/control-tower/check-bypass-log.test.sh` + `bash tests/control-tower/post-commit.test.sh` + `bash tests/control-tower/bypass-union-merge.test.sh` 均 exit 0
- [ ] DS3: 落点被 git 忽略: `git check-ignore -v .sessions/x/bypass.log` 命中 `.gitignore:83`
- [ ] DS4: 端到端双写: 一次真实提交后，旧路径与新落点**各新增 1 行同一证据**
- [ ] DS5: 兼容并存不变量: `grep -c '| _bypass_append' scripts/hooks/post-commit.sh` = 5 且旧路径仍被写
- [ ] DS6: D331 对账仍通过: `bash scripts/pre-push-check.sh` 的 bypass.log 对账段 exit 0（贴原始输出）
- [ ] DS7: `SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh` + `bash scripts/control-tower/simulate-ci.sh` 均 exit 0
