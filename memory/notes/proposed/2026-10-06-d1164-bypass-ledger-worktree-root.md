# D1164 bypass 账本根 = 主仓仓根（git-common-dir 派生）+ sources fail-closed

- 状态: proposed（随本卡 PR 落地后 git mv 至 implemented/）
- 日期: 2026-10-06 ｜ 线: 治理线 ｜ 来源: CTO 派单 2026-10-06（P0，卡 #1009 与全部 worktree 推送）
- 判据变更级别: 门禁语义（路径解析 + 三态退出码）⇒ 提案 → K3 过审 → CTO 裁（不自裁）

## 决策
1. `bypass-ledger.sh` 账本根从 `--show-toplevel`（worktree 下=worktree 根）改为
   `dirname(--git-common-dir)`（=主仓仓根）。per-session 权威账本 `.sessions/` 只在主仓，
   worktree 态与主仓态必须同源（P1==P2）。
2. `sources` 解析不到账本根 ⇒ exit 2 + stderr 具名原因（fail-closed），禁止 exit 0 空输出。
3. 调用方 `check-bypass-log.sh` 对 exit 2 透传具名上报（「账本根不可解析」≠「提交无记录」），
   不再静默降级为「回退旧路径 → 来源皆空 → 拒推」假红。

## 备选与代价
- 备选 A（被否）: 调用方加「空则跳过对账」—— fail-open，红线。
- 备选 B（被否）: 恢复 `.claude/bypass.log` 跟踪 —— 违 D1073/M-05。
- 已知残留代价: 修前已在 **worktree 本地** `.sessions/` 留下的历史登记（如本工位 4 条）不再进入
  sources 并集——若该 worktree 有「只登记在本地」的未推提交，合并本修后首推会被要求补记
  （一次性补记即可，D451 豁免纯补记提交）。不静默并入是为保 P1==P2 字面判据；是否并入由 K3/CTO 裁。

## 回滚
单 commit revert 即可（无 schema/接口变更；SYNO_* 注入缝语义未动）。
