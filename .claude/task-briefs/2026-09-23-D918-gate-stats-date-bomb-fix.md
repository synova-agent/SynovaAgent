# Task Brief — D918 控制塔日期边界定时炸弹修复（gate-stats 夹具相对时间化）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

控制塔线（门禁/CI 基建面），**不动 src/** 产品代码**（产品代码归编码 session）。

- 故障物：`tests/control-tower/gate-stats.test.sh` —— CI 密封测试清单（`.github/workflows/ci.yml` control-tower-tests job 的 `for t in` 列表）成员。
- 症状（实测）：`bash tests/control-tower/gate-stats.test.sh` 输出 `as any 行计数错误` + `误报代理计算错误`，exit 1。
- 影响面（实测）：**main 与全部分支同红** → `Control Tower Gate Tests (ubuntu-latest)` 对所有 PR 恒红 → **整条合并队列无法转绿**（PR #712/#713/#706/#704 全部堵在这里）。
- 文件审计：`scripts/control-tower/gate-stats.sh`（被测脚本，窗口语义正确，**不改**）；`tests/control-tower/gate-stats.test.sh`（夹具，**改**）；同型候选 `tests/control-tower/parallel-main-tree-occupancy.test.sh`（用写死 OLD_TS 但语义为「恒旧」，非滚动窗口，本次不动）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/DeepSeek/第一性原理 + 结论=**测试夹具不得依赖绝对日历时间与滚动窗口的组合**（等价于把测试的可复现性交给运行日期）。

- 第一性原理：测试的价值 = 任意时刻执行结果确定。`time(now) - time(fixture) < window` 是一个会随日历漂移的判据，夹具写死绝对时间即埋雷——**到期日必然变红，且红得与代码改动无关**。
- Anthropic 工程基线（DECISION-REFERENCE.md §适用域「脚本化验证 + 机器可验契约」）：修复应落在「夹具生成方式」而非「放宽断言」——断言强度不减反增（本次新增窗口过滤显式断言）。
- memory/ 历史同型：CTO backlog A1「日期粒度 bug」（`calc-progress.py --since=<日期>T00:00:00` 天粒度 → 当天证据立即 stale，修法=次日 00:00）；铁律 48（测试不可为空壳）。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- tests/control-tower/gate-stats.test.sh — 夹具由写死绝对时间（2026-08-24T01:00:00Z）改为相对 now 生成（10 天前 hit/miss 对、9 天前另一检查点、40 天前应被窗口排除）；新增「窗口外数据被排除」显式断言；覆盖矩阵登记该回归防线
- task-state/D918.json — 卡片（状态/写集/验收/证据）
- .claude/task-briefs/2026-09-23-D918-gate-stats-date-bomb-fix.md — 本文档

不做什么（含文件路径）：
- 不改 scripts/control-tower/gate-stats.sh（窗口语义本身正确：`cutoff = now - timedelta(days=N)`；错的是夹具基准）
- 不改 .github/workflows/ci.yml（密封清单无需变更；本测试已在列）
- 不改 tests/control-tower/parallel-main-tree-occupancy.test.sh（其写死时间为「恒旧」语义，不受滚动窗口漂移影响；留观察）
- 不碰 scripts/audit/**（审计红线）、不写审计标准、禁止自我审计

## 写集

> D749 单一事实源（机器块）。格式对齐 `scripts/control-tower/brief_parser.py`。

| 文件 | 类别 |
|---|---|
| `tests/control-tower/gate-stats.test.sh` | task |
| `task-state/D918.json` | task |
| `.claude/task-briefs/2026-09-23-D918-gate-stats-date-bomb-fix.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本，与写集无关） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash tests/control-tower/gate-stats.test.sh`（CI 密封清单同款命令）
处理：脚本生成相对时间夹具 → `gate-stats.sh` 按 30 天窗口统计 → 断言计数/误报代理/窗口过滤
结果：**9 通过 0 失败**（修复前 6 通过 2 失败，同一命令同一环境）；`bash tests/control-tower/simulate-ci.test.sh` exit 0（修复前红）
反例证据（证明根因是日期边界而非断言放宽）：同一夹具下窗口 30 天红、31 天绿；main 与本分支同红。

## 架构层

治理/CI（`tests/control-tower` + `.github/workflows`；不触五层依赖图）

## Done 标准

- [ ] `bash tests/control-tower/gate-stats.test.sh` 退出 0（9 通过 0 失败）——原始输出贴 PR
- [ ] `bash tests/control-tower/simulate-ci.test.sh` 退出 0（原红 → 绿）——原始输出贴 PR
- [ ] 反例留证：`SYNO_GATE_HITS_LOG=<固定日期夹具> bash scripts/control-tower/gate-stats.sh 30` 与 `31` 的对照输出（30 红/31 绿），证明根因是日期边界而非断言放宽
