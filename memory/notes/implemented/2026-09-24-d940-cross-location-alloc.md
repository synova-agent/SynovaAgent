# 2026-09-24 — D940 取号器跨位置拒绝重号（分配器 + 三元组校验器）

> 状态: implemented | 任务: D940 | 写者: d940-c1 | 分支: fix/d940-name-allocation
> 归位说明: 原落 `proposed/`，被 D472 迁移门禁判为僵尸条目（`task-state/D940.json` status=`spec_done`）
> → 依 README「决策被采纳执行」迁移 `proposed → implemented`（`git mv` + 头字段同步）。
> 参考：第一性原理 + Anthropic 基线（决策点 fail-closed 优于事后补偿）

## 决策
1. `alloc-task-id.sh` 号确定后**跨位置二次校验**（task-state ∪ origin/main ∪ 远端分支 ∪ 本地分支 ∪ worktree 名），任一位置已占 → **拒绝并点名冲突位置**，不自动跳号（fail-closed）。
2. `git ls-remote --heads origin` **只喂决策点校验，不喂「下一个号」计算表**。
3. `--prefix <P>` 命名前缀参数化；新增 `--check-id` 只读模式供 `check-name-allocation.sh` 复用（单一实现，杜绝第二副本漂移）。
4. 卡面范围外的必要前提修复：`basename` 子进程 → `"${f##*/}"` 纯参数展开（lead 2026-09-24 授权 A）。

## 理由（第一性原理）
- 分工：计算表答"下一个空闲号"（快、本地、best-effort）；校验答"我即将发放的号真的空闲吗"（权威、决策点、含最新远端视图）。
- **互斥性**：若 ls-remote 同喂计算表 → NEXT 直接跳过远端已占号 → "拒绝并点名"永不触发（与卡面验收 1 互斥）。二者择一，选**决策点 fail-closed**：发行时刻的权威校验才是"绝不发放"的实质，并天然覆盖 TOCTOU。
- `branch -r` 依赖本地 tracking ref → 未 fetch 即漏号（D736 撞号现场复现；D730 登记项）。
- 性能前提：成本表扫描 50,788 次 `basename` fork = 258s ≫ LOCK_WAIT_SEC=30 → 不修则验收不可跑，且取号入口 4.3 分钟。

## 影响
- 收益：远端在途号不再被本机发放（D730 缺口收口）；取号入口端到端 200s → 107s（×1.87）。
- 代价：远端不可达时按卡面口径 `degraded:` + 仍可用 ⇒ 该次发号无法证明远端未占（未清项 N8，若 CTO 要更严需另立卡）。
- 未清项：N5（骨架 `"spec": null` 生产者，另立卡）、N6（`WORKTREE_USED` O(n²) 展开）、N7（缺 D313 M5 UTF-8 头块，存量）、N8（降级口径）。
- 证据：`docs/synova/product-lines/evidence/D940-改动清单.md`。
