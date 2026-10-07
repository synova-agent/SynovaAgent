# Task Brief — D920 合并队列推进器入库（两根因机器化）+ CTO 台账登记

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

控制塔线（合并通道/CI 基建面），不动 src/** 产品代码。

- 触发：2026-09-22 串行合并流水线在 PR #712 卡死 22 轮（`/tmp/serial5.log`），队列积压。
- 文件审计（实测）：
  - `scripts/control-tower/` 下**无**合并队列工具（`ls | grep -i merge` 只有 `merge_writeset_gate.py` = 写集门禁，非合并执行器）→ 需新建。
  - 原型在 `/tmp/serialmerge.py`（一次性、无测试、两根因）→ 本任务收编入库。
  - 台账：`docs/synova/coordination/审计发现台账-DSH-CTO.md` §五 演进记录（本任务追加一行）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/DeepSeek/第一性原理 + 结论=**合并执行器的判据必须落在本地 git 事实，平台缓存状态不可作为「等待」的理由**。

- Anthropic 基线（DECISION-REFERENCE.md:19「门禁/fail-closed、脚本化验证」）：不可复现的判据 = 无判据；「等」不是处置。
- DeepSeek 第一性原理：机制为减少摩擦而存在 → 本任务**删掉**「等」这个动作（DIRTY 二义各有确定处置），不加"多等几轮"。
- DSH 范式（原会话结论沿用）：异常可归因 → 状态词汇显式（`DIRTY_CONFLICT` / `DIRTY_STALE`），不再是模糊 DIRTY。
- memory/ 历史：M1（检查未执行==通过）→ 本工具对 UNKNOWN/BAD 显式点名；A1/日期粒度类为另一机制（D918）。
- 决策沉淀：`memory/notes/proposed/2026-09-23-d920-merge-queue-tool.md`（铁律 49）。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- scripts/control-tower/merge-pr-queue.py — 新建：纯函数 `classify` / `dir_dirty_kind` / `conflict_files_from_mergetree` / `resolve_worktree` + 副作用层（rerun-failed-jobs / re-merge 强制重算 / merge / 主工作区同步）；`--dry-run`；`--fixture-*` 测试注入缝
- tests/control-tower/merge-pr-queue.test.sh — 新建密封测试（11 断言：契约 / 根因1 三态 / 根因2 二义分流 / 正常 / 降级）
- docs/synova/coordination/审计发现台账-DSH-CTO.md — 追加本批发现登记（日期炸弹 / 跨工作区账本缺口 / G12 merge 误拦 / alloc 中文名崩溃 / golden-case 误归因 / 看板滞后）
- memory/notes/proposed/2026-09-23-d920-merge-queue-tool.md — 决策 Note（铁律 49）
- task-state/D920.json — 卡
- .claude/task-briefs/2026-09-23-D920-merge-queue-tool.md — 本文档

不做什么（含文件路径）：
- 不改 scripts/control-tower/pre-dispatch-check.sh（D919 已交付并单独 PR #716，避免写集交叉）
- 不改 tests/control-tower/gate-stats.test.sh（D918 已交付并合并）
- 不碰 scripts/audit/**（审计红线）、不写审计标准、禁止自我审计
- 不改 src/ 下任何产品代码

## 写集

> D749 单一事实源（机器块）。格式对齐 `scripts/control-tower/brief_parser.py`。

| 文件 | 类别 |
|---|---|
| `scripts/control-tower/merge-pr-queue.py` | task |
| `tests/control-tower/merge-pr-queue.test.sh` | task |
| `docs/synova/coordination/审计发现台账-DSH-CTO.md` | task |
| `memory/notes/proposed/2026-09-23-d920-merge-queue-tool.md` | task |
| `task-state/D920.json` | task |
| `.claude/task-briefs/2026-09-23-D920-merge-queue-tool.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本，与写集无关） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash tests/control-tower/merge-pr-queue.test.sh`；实跑 `python3 scripts/control-tower/merge-pr-queue.py --prs <n> [--dry-run]`
处理：夹具 JSON 注入 classify（零网络）→ 根因1/根因2 各有具名断言；实跑走 GitHub API + 本地 worktree
结果：测试 11 通过 0 失败；实战场次 = #715 合并、#704 re-merge 重算（dirty→clean）、#712 re-merge 换 head

## 架构层

治理/CI（`scripts/control-tower` + `.github/workflows`；不触五层依赖图）

## Done 标准

- [ ] `bash tests/control-tower/merge-pr-queue.test.sh` 退出 0（11 通过 0 失败）——原始输出贴 PR
- [ ] 反例留证：空分支名 → error（根因1 防线）；`mergeable=false` + merge-tree 有冲突 → `DIRTY_CONFLICT` 点名文件、无冲突 → `DIRTY_STALE`（根因2 二义分流）
- [ ] 台账追加行含 6 项本批实测发现（日期炸弹 / 跨工作区账本 / G12 merge 误拦 / alloc 中文名 / golden-case 误归因 / 看板滞后）
