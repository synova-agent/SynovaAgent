# Task Brief: D756 dispatch-sentinel-debts-d751-d752-d754

> 生成: 2026-09-14 | 任务: D756 | 认领: 主 CTO（synova-cto）
> 参考: 创始人「写派单，Win 侧先记台账（近期无 Win 机器，只有 Mac 侧工作）」

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
派单登记（非五层）。把院长质询欠账 D751/D752/D754（Mac 域）写成可执行派单；Win 侧（D753 + D754 Win 半）只记台账。
### b) 文件审计
- D750 已修并合入 main（5c4ae8a7）→ 三条欠账的前置满足
- D751/D752/D754 的 task-state 已在 main（欠账登记 PR #556）
- 派单前复核实跑：**机械十项全通过**（含计划锚定 v1.0@0b5c396a、内部一致性自检段）
- 复核过程发现并修正检查器缺陷：路径正则在 `packages/ontology/src/x.ts` 里误匹配内层 `src/x.ts`（边界未锚定 + 路径根不全）
### c) 决策
出派单文档（Mac 三件串行）+ Win 侧台账段落；修检查器误报并加回归断言。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35：检查器误报会产生噪音 → 噪音会导致门禁链被绕过 → 必须修误报而不是绕过
- 本日教训：我连续三次测量失效（管道吃退出码 / bash 跑 .py / 中文名转义）→ 检查器本身也要被验证
### 参考：铁律 35 + 本日测量教训 → 修检查器边界 + 加回归断言

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md — 派单（三件 + Win 台账 + 复核节 + 复制块）
- scripts/control-tower/pre-dispatch-check.sh — 路径正则边界锚定 + 路径根补全（packages/extensions/.github）
- tests/control-tower/pre-dispatch-check.test.sh — 边界回归断言
- .claude/task-briefs/2026-09-14-D756-dispatch-sentinel-debts.md、task-state/D756.json — 本单
不做什么：
- 不实现 D751/D752/D754（执行方各自开工，Mac 域串行）
- 不派 Win 侧（D753 + D754-Win半）——创始人近期无 Win 机器，只记台账
- 不改 scripts/audit/

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人转发派单复制块给 Mac 编码 session
处理：三件串行（D751 根 → D752 → D754-Mac）
结果：新增生效有断言 / 类型网登记硬门禁 / runner 注释去漂移

## 架构层: 基础设施（派单与检查器）
## 主线贡献: infra:派单登记（支撑，指向产品正确性与机制可验证性）
## 域: mac

## Done 标准:
- [ ] 派单前复核机械项全通过（实跑输出贴 PR）
- [ ] 边界回归断言在位：grep -c 'packages/ontology' tests/control-tower/pre-dispatch-check.test.sh → ≥1
- [ ] Win 台账段在位：grep -c 'Win 侧台账' docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md → ≥1

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-14-D756-dispatch-sentinel-debts.md | task |
| docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md | task |
| scripts/control-tower/pre-dispatch-check.sh | task |
| task-state/D756.json | task |
| tests/control-tower/pre-dispatch-check.test.sh | task |
