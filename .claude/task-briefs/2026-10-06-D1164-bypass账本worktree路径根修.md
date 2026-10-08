# Task Brief: D1164 bypass 账本对账 worktree 路径根修（P0，卡全部 worktree 推送）

> 生成: 2026-10-06 | 任务: D1164 | 认领: 治理线（govl）| 来源: CTO 派单 2026-10-06
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔治理域（`scripts/control-tower/**`）。病灶：`bypass-ledger.sh:35` 用
`git rev-parse --show-toplevel` 解析账本根 ⇒ 在**链接 worktree** 里得到 worktree
自己的路径，而 per-session 权威账本 `.sessions/<sid>/bypass.log` 在**主仓** ⇒
worktree 态 sources 找不到权威账本（全新 worktree 更是空输出 + exit 0 静默）⇒
`check-bypass-log.sh` 回退到已停跟踪的 `.claude/bypass.log` ⇒ 假红拒推（D331）。
本卡 = 路径解析修，**不是**政策变更（对账判据 D1157 零改动）。

### b) 文件审计
- `scripts/control-tower/bypass-ledger.sh:35` ROOT 解析（唯一根因点）
- `scripts/control-tower/bypass-ledger.sh:62,74` `.sessions` 派生点（2 处）
- `scripts/control-tower/check-bypass-log.sh:52-55` 调用方：sources exit≠0 时
  `|| _SRC_OUT="$LOG"` 把「账本根不可解析」静默吞成「回退旧路径」
- 既有测试：`tests/control-tower/bypass-ledger.test.sh`（沙箱主仓态，本卡须保持绿）
- 判据自证命令：`git rev-parse --path-format=absolute --git-common-dir`
  ⇒ 主仓根 = dirname（CTO 派单 §三.①）
### c) 决策
复用（三态退出码/fail-closed 既有约定 + SYNO_BYPASS_SESSIONS_ROOT 注入缝语义不变）；
新建（主仓根派生 + sources fail-closed exit 2 + 调用方具名上报）；取消（不动
对账判据 / 不改 .gitignore / 不恢复 .claude/bypass.log 跟踪）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- git 官方语义：worktree 下 `--show-toplevel` = 本 worktree 根；`--git-common-dir`
  = 主仓 .git（链接态绝对路径；主仓态相对 `.git` ⇒ 须绝对化，旧 git 无
  `--path-format=absolute` 需回退分支）。
- ctrl-tower-change 模式 1（三态退出码）：「检查自身失败」必须 exit 2 显式阻断，
  禁止静默 exit 0 —— 本卡 sources 空输出正是该模式违例。
- 铁律 11（静默降级禁止）：调用方把 exit≠0 吞成「全部来源皆空 ⇒ 拒推」= 假红 +
  语义混淆（「账本根不可解析」≠「提交无记录」），必须具名分开报。
- D515/D516：本地软提示 CI 权威；本卡改门禁语义 ⇒ 提案 → K3 过审 → CTO 裁，
  不自裁（派单 §五）。
参考：Anthropic（fail-closed + 先红后绿夹具）/ git 官方（worktree 语义）/ 第一性原理（根解析唯一权威源）

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/bypass-ledger.sh — 账本根改为 dirname(--git-common-dir)（主仓仓根）；SYNO_BYPASS_SESSIONS_ROOT 注入缝语义不变；sources 解析不到 ⇒ exit 2 + stderr 具名
- scripts/control-tower/check-bypass-log.sh — sources exit 2 时透传具名原因 + exit 2，不再静默降级为「来源皆空拒推」；顺带补齐 D313 UTF-8 头块（本卡触碰文件须达标）
- tests/control-tower/bypass-ledger-worktree.test.sh — 新增夹具（CTO 派单 §四完成标准 1-4，改坏即红）
- tests/control-tower/bypass-ledger.test.sh — 存量断言更新为「主仓根」口径（worktree 态下旧断言恰是病灶口径）
- memory/notes/proposed/2026-10-06-d1164-bypass-ledger-worktree-root.md — 决策 Note（铁律 49）
不做什么：
- 不修改对账判据 scripts/control-tower/check-bypass-log.sh 的 D1157 记录判定块
- 不修改 .gitignore（.claude/bypass.log 停跟踪是 D1073/M-05 政策，正确）
- 不涉及 scripts/audit/**（K3 域，零触碰）
- 不修改 .github/workflows/ci.yml（12 必需 context 的 job name 不动）
- 不包括「空则跳过对账」逃生（fail-open，派单红线）

## Q3: 验收 — 入口 → 交互 → 结果
入口：worktree 内 `git push`（pre-push 门禁 5 调 check-bypass-log.sh → bypass-ledger.sh sources）。
处理：sources 列出主仓 `.sessions/<sid>/bypass.log` 绝对路径；解析失败 exit 2 具名。
结果（CTO 派单 §四完成标准，全部改坏即红）：
1. 临时 worktree 提交后 check-bypass-log 走通：修前红（贴原始输出）/ 修后绿
2. 把修法改回 --show-toplevel ⇒ 夹具必红（判据有分辨力）
3. sources 解析不到 ⇒ exit 2 + 具名（非 exit 0 空输出）
4. 主仓态回归：主仓里 sources/append/read 结果与修前一致（P1 不变，且 P1==P2）
5. 真实 worktree `git push --dry-run` 通过（附原始输出）

## 架构层: 控制塔治理域（非产品五层；scripts/control-tower/**）
## Done 标准:
- [x] worktree 夹具全绿（含回退必红反例） verify: bash tests/control-tower/bypass-ledger-worktree.test.sh
- [x] 存量账本测试回归全绿 verify: bash tests/control-tower/bypass-ledger.test.sh
- [x] 本 worktree 对账不再「账本不存在」假红 verify: bash scripts/control-tower/check-bypass-log.sh origin/main
- [x] 真实 worktree 推送通过 verify: git push --dry-run origin fix/D1164-bypass-ledger-worktree-root
