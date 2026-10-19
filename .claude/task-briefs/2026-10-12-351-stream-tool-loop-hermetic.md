# Task Brief: #351 → tests 面 — `tests/stream-tool-loop.test.ts` 离线确定性（非 hermetic 根治）

> 卡面来源：Gitea #351 ｜ 裁决：**CTO 裁定 5 = 甲**｜ 分支：`fix/351-stream-tool-loop-hermetic`
> 机器真源：`.claude/claims/351.yaml`（claim 是声明载体，故 Q0–Q3 散文检查按设计不适用）
> 证据件：`docs/synova/product-lines/evidence/351-stream-tool-loop-hermetic.md`

## Q0: 定位
tests 面（非五层产品代码）。本件 = **测试 hermeticity**修复：`tests/stream-tool-loop.test.ts` 在 CI 上打真实 LLM。
根因**不在测试夹具**，在 `src/agent/conversation-engine.ts` 构造函数对注入 fake 的**自动接线**（详见证据件 §一）。
本卡**只修红**（写集内）；机制侧另立系统卡。

## Q1: 调研
- 铁律 0-2（测试先行 + 接线验收）、铁律 12（集成测试 cover 真实路由、不 mock 管线）、铁律 48（测试不可空壳）。
- 同族先例：仓库已有 `{ fallbackProvider: null }` 惯例 —— `tests/agent/context-compaction.integration.test.ts`（3 处）、
  `tests/l4/decision-capture-single-entry.test.ts`（5 处）、`tests/contract/llm-failover.test.ts`（契约测试显式传）；
  且 `tests/agent/tool-loop-tool-pairing.integration.test.ts` 有原注释：「环境隔离：逐个 delete 会让 detectProvider /
  buildFallbackProvider **落到真实 provider**」⇒ **本卡是把该既有约定补到本文件**，不是新发明。
- 决策参考系：第一性原理（单元测试不得依赖外部服务）+ 仓库既有惯例 ⇒ 结论 = 显式禁用 failover。

## Q2: 范围
做什么：`tests/stream-tool-loop.test.ts` 7 处 `new AgentConversation(...)` 构造补 `{ fallbackProvider: null }` + 头部说明块。
- tests/stream-tool-loop.test.ts
不做什么（含文件路径）：
- **不改** `src/agent/conversation-engine.ts`（机制点，不在写集；等 CTO 裁系统卡）
- **不改** `package.json` / lock（#347 react 对齐占用）
- **不改**夹具 `fakeProviderWithTools`（它本来就是 fake —— 措辞不得写成"注入 fake provider"）
- **不改**其它 e2e 文件（同族风险，另案）
- 禁 `.skip` / `--exclude` / `--no-verify`

## Q3: 验收
入口：`npx vitest run tests/stream-tool-loop.test.ts`
处理：7 处构造显式 `{ fallbackProvider: null }` ⇒ 构造函数不调 `buildFallbackProvider` ⇒ 链上只有 fake
结果：**无凭据**与**有 dummy 凭据**两态均 `6 passed` / `exit 0`；反例 = 去 null 时链上出现真实 deepseek provider（探针读链名，零网络请求）

## 架构层
非产品层（tests）。被测对象 = `src/agent/conversation-engine.ts`（L2 编排）—— 本卡**不改它**。
#CRITERIA: D
<!-- #CRITERIA 补记：历史件无单一归属证据，按 criteria-code-map 兜底 D（L1 #645，2026-10-20） -->

## Done 标准
- [x] verify: `npx vitest run tests/stream-tool-loop.test.ts` ⇒ exit 0（无凭据态，原始输出见证据件 §三①）
- [x] verify: `$env:LLM_API_KEY='<dummy>'; npx vitest run tests/stream-tool-loop.test.ts` ⇒ exit 0（敌意态，见 §三②）
- [x] verify: 反例（去 null）⇒ 链名 `chain(fake-primary-throws→deepseek)`（真 provider 在链上）+ fallback 可解析时断言必红（见 §三③）
- [ ] 🔴 未决：机制侧（是否让 failover opt-in / 非真实 provider 时跳过 env 派生）—— **本卡不碰**，等 CTO 裁系统卡
