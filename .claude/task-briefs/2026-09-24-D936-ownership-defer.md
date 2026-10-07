# Task Brief — D936 模块归属改为服从 ownership.yaml（删四组冲突清单）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
治理/域映射面，不动 src/**。触发：Win 侧 Codex 用可复现命令打回我的《模块归属》基线四组与现行表冲突。
文件审计：`docs/synova/coordination/ownership.yaml`（200 行/42 条 glob，机器可读唯一源）+ `scripts/control-tower/check-ownership.py`（唯一消费者）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：Anthropic/第一性原理 + 结论=**一类机制只能有一个事实源**。
历史：D733/D806/D914（域映射与 CODEOWNERS drift）；本次为"未读唯一源即另写一份表"的实例。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- docs/synova/coordination/模块归属-MacWin-20260923.md — 改为「三条原则 + 服从 ownership.yaml」，删四组冲突清单，补现行表人读摘要与变更规则
- docs/synova/coordination/审计发现台账-DSH-CTO.md — 追加 2026-09-24 三处（造第二事实源/注释文件名漂移/域判定口径澄清）

不做什么（含文件路径）：
- 不改 docs/synova/coordination/ownership.yaml（唯一待改的 presets→mac 由 M1 单执行）
- 不改 scripts/control-tower/check-ownership.py、scripts/control-tower/check-pr-budget.sh
- 不碰 scripts/audit/**、不改 src/ 产品代码

## 写集
| 文件 | 类别 |
|---|---|
| `docs/synova/coordination/模块归属-MacWin-20260923.md` | task |
| `docs/synova/coordination/审计发现台账-DSH-CTO.md` | task |
| `.claude/task-briefs/2026-09-24-D936-ownership-defer.md` | task |
| `.claude/bypass.log` | builtin |

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-citations.py docs/synova/coordination/模块归属-MacWin-20260923.md --repo .`
处理：引用门禁（8 条）
结果：违规 0；文档内不再出现与表冲突的路径清单

## 架构层
治理/域映射（docs/synova/coordination；不触五层依赖图）

## Done 标准
- [ ] `check-citations.py <本件>` → 违规 0
- [ ] 文内不含 `src/mcp/**`/`electron/**`/`VERSION.md`/`packages/**` 的冲突归属主张
- [ ] 台账含 2026-09-24 新行
