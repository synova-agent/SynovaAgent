# Task Brief — D921 K3 独立审计派单（D919 引用门禁 + D920 合并队列推进器）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

控制塔线（审计派单面），不动 src/** 产品代码。

- 触发：D919/D920 为 CTO 自产机制（新门禁 + 合并通道工具），按铁律 0-5「开发者改过的门禁同样受 K3 审」必须独立审计。
- 文件审计：`docs/synova/coordination/派单-K3审计-D919D920-20260923.md`（新建）；`docs/synova/audit-reports/`（K3 报告落点，已存在目录）；`task-state/D919.json`/`D920.json`（待审对象卡）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/第一性原理 + 结论=**审计派单的引用必须逐条可核验**（新门禁自证：本件已用 D919 核验器自检，22 条引用 0 违规）。

- Anthropic 基线（DECISION-REFERENCE.md:19）：门禁/fail-closed 属适用域 → 派单件自身先过引用核验。
- memory/ 历史：D732（派单未复核技术声称 + 写集路径凭记忆写错）→ 本件现状材料逐条 grep/实测后写入。
- 铁律 49：本件不涉治理脚本改动，无 Note 需求。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- docs/synova/coordination/派单-K3审计-D919D920-20260923.md — K3 审计派单件（八项必答题 + 写集 + 验收 + 引用豁免段）
- .claude/task-briefs/2026-09-23-D921-K3-audit-dispatch.md — 本文档
- task-state/D921.json — 卡

不做什么（含文件路径）：
- 不改 scripts/control-tower/check-citations.py（待审对象，改它=污染审计对象）
- 不改 scripts/control-tower/merge-pr-queue.py（同上）
- 不碰 scripts/audit/**（审计红线）、不写审计标准

## 写集

| 文件 | 类别 |
|---|---|
| `docs/synova/coordination/派单-K3审计-D919D920-20260923.md` | task |
| `.claude/task-briefs/2026-09-23-D921-K3-audit-dispatch.md` | task |
| `task-state/D921.json` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本，与写集无关） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/派单-K3审计-D919D920-20260923.md`
处理：①任务号真实性 ④写集路径 ⑥引用可核验（D919 新门禁）⑨内部一致性 ⑩主线计划锚定
结果：⑥ 步 22 条引用 0 违规（原始输出贴 PR）；其余机械项按基线与在途 PR 状态判定

## 架构层

治理/CI（`docs/synova/coordination` + `docs/synova/audit-reports`；不触五层依赖图）

## Done 标准

- [ ] `bash scripts/control-tower/check-citations.py docs/synova/coordination/派单-K3审计-D919D920-20260923.md --repo . --owner pre-dispatch` → 违规 0（原始输出贴 PR）
- [ ] 派单件含「派单内部一致性自检」段与「引用豁免」段（机制要求，缺一即不完整）
- [ ] 依据计划哈希 = 主线计划当前值（实测 4e46603f）
