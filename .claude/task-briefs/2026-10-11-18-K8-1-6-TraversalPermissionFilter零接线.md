# Task Brief: #18 → K8/1-6 — TraversalPermissionFilter 零接线

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#18` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K8 块 · `1-6`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：把 `TraversalPermissionFilter` **接上线**（当前零接线）。
**② 解决什么问题**：⚠️ **本项判据实测全绿 —— 问题已不复现**（详见文末「状态」）。登记件 `status` 与卡片 state 不一致，本卡转为**回归/收口**用途；执行方不得按"未完成"照单重做。
**③ 做完对项目的推动**：② 本体层的遍历面是"知识一致（分层权限）"（K12-05 #188）的**数据面执行点**。
**④ 🔴 不做行不行**：**不行**（禁令级）：遍历不过滤 = 越权可见（安全底线）。
**⑤ 现在有什么基础（**判据实测 @ 68bf57598 ＋ 路径实测**）**：✅ **判据全绿 —— 本项已完成**（见下「状态」）；已存在落点：`src/l4/traversal-permission-filter.ts`、`src/agent/diagnosis-launcher.ts`、`src/sentinel/sentinel-loader.ts`、`tests/l4/traversal-permission-filter.test.ts`；**待新建**：（无）。
**⑥ 还需要做什么**：接进诊断启动器 + 哨兵装载器两条遍历路径 + 判据绿。
**⑦ DSH 借鉴方式**：**参考自研**：借 DSH「**分层作用域链**」—— `dsh-scope/lib/index.js:357` `export { AnonymousEntries, NamedEntries, ScopedLayers, bindScopeParent, scopeChainOf, scopeOf, scopeTarget }`。
**⑧ 涉及代码文件**：src/l4/traversal-permission-filter.ts｜src/agent/diagnosis-launcher.ts｜src/sentinel/sentinel-loader.ts｜tests/l4/traversal-permission-filter.test.ts

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K8**（知识与图谱权限（L4）），架构位置 = ② 本体层 ＋ 横切（遍历权限）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在（本卡可直接复用/修改）
- src/l4/traversal-permission-filter.ts
- src/agent/diagnosis-launcher.ts
- src/sentinel/sentinel-loader.ts
- tests/l4/traversal-permission-filter.test.ts
### 待新建（写集，尚未存在）
- （无）
结论：ALL-PASS。

## Q1: 调研
a) 业界：对外可见/安全相关的动作必须有**独立于执行者的判据**（Anthropic 工程基线）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ file:line）。
c) memory 教训：**铁律 0-2**（接线失败 4 次：组件过单测但从未被生产调用）；**铁律 24/31**（禁静默降级）；**铁律 37**（dead code 入仓库即违规）；**判例 V-01/V-02/V-07**。

## Q2: 范围
做什么：
- src/l4/traversal-permission-filter.ts
- src/agent/diagnosis-launcher.ts
- src/sentinel/sentinel-loader.ts
- tests/l4/traversal-permission-filter.test.ts
- .claude/task-briefs/2026-10-11-18-K8-1-6-TraversalPermissionFilter零接线.md
不做什么：
- 不改 src/loops/middle-evolution-engine.ts
- 不改 tests/growth/evolution-writeback.test.ts
- 不改 src/growth/goal-sentinel.ts
- 不改 tests/growth/goal-sentinel.test.ts
- 不改 src/l4/sog-schema-validator.ts
- 不改 scripts/control-tower/probe-diagnosis.ts
- 不改 src/l4/graph-bridge.ts
- 不改 tests/routes/chat-feedback.test.ts
- 不改 tests/growth/goal-lifecycle.test.ts
- 不改 tests/integration/goal-lifecycle.integration.test.ts
- 不改 tests/growth/effect-verification.test.ts
- 不改 tests/growth/e2e-navigation-loop.integration.test.ts
- 不改 src/agent/skill-lazy-loader.ts
- 不改 scripts/control-tower/probe-skills.ts
- 不改 src/agent/report-assembler.ts
- 不改 src/l3/report-templates.ts
- 不改 tests/l3/report-contract-versioned.test.ts
- 不改 src/l3/report-template-loader.ts
- 不改 tests/l3/report-template-client.test.ts
- 不改 src/growth/goal-types.ts
- 不改 src/growth/goal-store.ts
- 不改 tests/growth/goal-propagation.test.ts
- 不改 src/routes/diagnosis.ts
- 不改 tests/routes/customer-config-consumed.test.ts
- 不改 src/growth/feedback-collector.ts
- 不改 tests/growth/feedback-channel-unification.test.ts
- 不改 scripts/control-tower/probe-compute-registry.ts
- 不改 src/l4/knowledge-store.ts
- 不改 tests/l4/knowledge-scope.test.ts
- 不改 skills/org/agent-readiness.md
- 不改 scripts/control-tower/probe-agent-readiness.ts
- 不改 tests/agent/agent-matrix-trigger.test.ts
- 不改 extensions/llm-providers/manifest.json
- 不改 scripts/control-tower/probe-eco-fields.ts
- 不改 docs/synova/coordination/tools/probe-three-layer-contract.ts
- 不改 packages/evolution/src/global-analyzer.ts
- 不改 tests/evolution/global-analyzer.test.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx vitest run tests/l4/traversal-permission-filter.test.ts`
处理：按 §〇 ⑥ 缺口清单逐条落地。
结果：Done 标准逐条（判据**逐字抄自登记件**）。

## 架构层: ② 本体层 ＋ 横切（遍历权限）
#CRITERIA: C

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号（格式依据：brief-compose D1231））
- src/l4/traversal-permission-filter.ts
- src/agent/diagnosis-launcher.ts
- src/sentinel/sentinel-loader.ts
- tests/l4/traversal-permission-filter.test.ts
- .claude/task-briefs/2026-10-11-18-K8-1-6-TraversalPermissionFilter零接线.md

## Done 标准
（**逐条抄自登记件 `acceptance` 原文，未改写**）
- [ ] verify: `npx vitest run tests/l4/traversal-permission-filter.test.ts`（expectExit 0）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）

---
## 状态（判据实测 · 独立复核回写 · 2026-10-11）

基线：`68bf5759878a458b5e5ceb324a32878660155517`（**本分支 base**，非旧 as_of）
判定：**ALL-PASS**（判据逐条：PASS）
登记件 status：`todo` ｜ 来源卡：#18

✅ 判据全绿 —— 本项**已完成**；卡应 closed（本卡作回归/收口）。

### 独立复核结论（fresh context · 三批各自复核）
本批经独立复核，判定：本项已完成（见上）。
修订项：as_of 重钉 ／ ⑤ 与 Q0 分「已存在 / 待新建」两栏 ／ Done 逐条抄登记件原文 ／ 去 #1308 引用。
真源（`施工项登记.ts`）缺陷另由 CTO 处置（判据语法坏 / 假绿判据 / status 与 issue state 分歧）。
