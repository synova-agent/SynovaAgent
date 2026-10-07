# Task Brief: D755 inquiry-pluginability-debt-registration

> 生成: 2026-09-14 | 任务: D755 | 认领: 主 CTO（synova-cto）
> 参考: `~/山河研究院/99-综合/质询-可插件化是否物理事实.md`（院长质询·终版）+ 创始人指令「这里有很多欠账没搞清楚的，你要记下来，任务看板也要记下来」

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
欠账登记（非五层）。把院长的质询结论**逐条落成任务号**（task-state → 看板可显示），而非只写备忘。
### b) 文件审计（质询原文实测证据）
- `src/sentinel/signal-aggregator.ts:191` inferCategory 只产 3 类；`:53` SIGNAL_TO_EXPERT 定义 10 类 → **7 类不可达**（活缺陷）
- `:154` recommendedExperts → `runner.ts:734` 合并进派发列表 → revenue 信号派给 technology-foundation
- `src/sentinel/types.ts` 引用 38 目录；45 哨兵中 **8 个未进类型网**
- `packages/ontology/src/edge-types.ts:4`「42」vs `:6`「51」（实测 51）；manifest nodeTypes 29 vs 代码 45
- `runner.ts:77` 注释描述的失效模式与实际不符
### c) 决策
登记 D750-D754 五项（含 P0 活缺陷），并在计划表登记 → 生成器统一盯住。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）：漏声明不报错 = M3 家族（本院同族已有 8 条）
- 铁律 35（自动化优先）：把「新增生效」做成硬断言，而不是靠文档宣称
### 参考：铁律 11/35 + 质询 §六 该做/不该做 → 先修正确性（D750），再建断言，禁止在错分类法上扩规模

## Q2: 范围 — 正确的最简方案
做什么：
- task-state/D750.json — inferCategory 7/10 不可达（P0 活缺陷）
- task-state/D751.json — 「新增生效」硬断言
- task-state/D752.json — 哨兵类型网硬门禁
- task-state/D753.json — 计数一致性债
- task-state/D754.json — 声明/注释漂移
- docs/synova/coordination/质询-可插件化-欠账登记-20260914.md — 仓内登记文档
- docs/synova/coordination/整体推进计划-主线-20260913.md — 计划表登记 D750-D754
- .claude/task-briefs/2026-09-14-D755-inquiry-pluginability-debt-registration.md、task-state/D755.json — 本单
不做什么：
- 不修 D750-D754 的实现（各自派工；D750 属 sentinel 域=Mac）
- 不在 D750 修好前调整本体规模（质询 §六 不该做 1）
- 不改 scripts/audit/（审计红线）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人/CTO 查看计划表与看板
处理：任务号登记 + 计划表生成器盯住
结果：5 条欠账在 task-state 可查、在看板可显示（verdict 维度已修）

## 架构层: 基础设施（欠账登记）
## 主线贡献: infra:记录院长质询欠账（含 1 个 P0 活缺陷，指向产品正确性）
## 域: mac

## Done 标准:
- [ ] 五项登记在位：`for d in 750 751 752 753 754; do python3 -c "import json;d=json.load(open('task-state/D$d.json'));assert d.get('note'),'$d 无 note'"; done` → 零断言失败
- [ ] 计划表含五项：grep -cE 'D75[0-4]' docs/synova/coordination/整体推进计划-主线-20260913.md → ≥5
- [ ] P0 标注在位：grep -c '活缺陷' task-state/D750.json → ≥1

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-14-D755-inquiry-pluginability-debt-registration.md | task |
| docs/synova/coordination/整体推进计划-主线-20260913.md | task |
| docs/synova/coordination/质询-可插件化-欠账登记-20260914.md | task |
| task-state/D750.json | task |
| task-state/D751.json | task |
| task-state/D752.json | task |
| task-state/D753.json | task |
| task-state/D754.json | task |
| task-state/D755.json | task |
