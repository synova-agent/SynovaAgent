# D701 Task Brief — 决策驱动来源落地（DecisionRecord + Goal.decisionRecordId）

> 生成: 2026-09-10 | 任务: D701 | 认领: Win/Codex（导航 P1 第一件）
> 来源: 导航权威《增长导航目标管理闭环-20260906》第二章 §2.2/§2.3/§2.8 + 第六章 §6.5 P1

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
导航（增长导航）= 企业目标全生命周期管理（设定→分解→对齐→执行→跟踪→纠偏→验证→回流）。
目标三类来源：诊断驱动（`diagnosisId` 已有）/ 决策驱动（`decisionRecordId` 本卡新增）/ 外部驱动（`externalEventId` 待排）。
决策驱动 = 老板凭直觉/经验定新方向 → 记 DecisionRecord → 分解为 Goal，把直觉纳入验证闭环。

### b) 文件审计（2026-09-10 实读）
- `src/growth/goal-types.ts:89` `interface Goal` 仅 `proposalId`+`diagnosisId`，无 `decisionRecordId`（缺陷 A）
- `src/growth/goal-store.ts:94` `createGoal` 用 `...goal` spread 持久化（decisionRecordId 可自动透传）
- `src/l4/decision-capture.ts` 是**同名词不同义**（用户确认/驳回根因节点记决策边），非老板直觉决策记录（缺陷 B）
- `grep -rn "DecisionRecord\|decisionRecordId" src/` 仅命中 l4/decision-capture.ts → 导航 DecisionRecord 不存在（缺陷 C）

### c) 决策
新增 `src/growth/decision-record.ts`（DecisionRecord 结构原样采用 §2.3 + DecisionRecordStore）；Goal 加 `decisionRecordId?` 可选字段（三来源并列，向后兼容）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- 铁律 47/48：契约优先（DecisionRecordStore 先写 JSDoc 契约 + red→green 测试）
- 铁律 24/31：降级——store 失败 → `{ ok:false, error }` 不抛，读失败返回 null/[] + log.warn
- 铁律 38/CT-46：`as any`/`as never`/`as unknown as` 零容忍（fromProps 逐字段收窄替代类型逃逸断言）
- 权威 §2.8：决策记录事后可补充/可修正 → `updateRationale`
- 参考系：第一性原理（三来源 = 目标来源的完备表达）+ 第二章 §2.3 已给数据结构（直接采用，不自造）

## Q2: 范围 — 正确的最简方案

做什么：
- 新建 src/growth/decision-record.ts — DecisionRecord 接口（§2.3 原样字段）+ DecisionRecordStore（create/get/list/updateRationale/linkGoal）
- 修改 src/growth/goal-types.ts — Goal 加 decisionRecordId 可选字段（三来源）
- 修改 src/growth/goal-store.ts — createGoal 决策→Goal 关联（DecisionRecordStore 真实接线）
- 新建 tests/growth/decision-record.test.ts — 9 用例

不做什么：
- 对话式 LLM 捕获（§2.8 路径①）/ 约束注入（第三章）/ 决策→Goal 分解（第三章）/ externalEventId（外部驱动）→ 后续卡
- 不改 compute 注册 / 不引 @deepseek-ai / 不用 --no-verify

## Q3: 验收 — 入口 → 交互 → 结果

- 入口：`DecisionRecordStore.create(input)` / `createGoal({ ..., decisionRecordId })`
- 交互：校验（direction/rationale/relationToDiagnosis 三值）→ 持久化 → 读回 / 事后 updateRationale
- 结果：`DecisionRecordResult { ok, record?, error? }`；Goal 节点带 `decisionRecordId`（缺省 undefined 兼容诊断驱动）

## 架构层: L2

L2 编排（src/growth/ 目标与决策编排层；DecisionRecordStore/Goal 经 GraphBridgeLike 接口访问 L4 本体，不跨层直触 L5，符合铁律 39 五层边界）。

## Done 标准:

- DS1 `interface DecisionRecord` 在 `src/growth/decision-record.ts` 存在
- DS2 `decisionRecordId` 在 goal-types.ts + goal-store.ts 命中
- DS3 `npx vitest run tests/growth/decision-record.test.ts` 8/8 绿
- DS4 零回归：`tests/growth/` 181/181 + `tsc --noEmit` 33=基线零新增
- DS5 as any/never/unknown as = 0
- DS6 写集一致（4 文件 + 簿记，无越界）
- DS7 无 no-verify
- DS8 push + CI 绿
