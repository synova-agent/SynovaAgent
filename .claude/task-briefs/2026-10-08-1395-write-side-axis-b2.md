# Task Brief: #1395 写入侧类型对齐本体轴 —— B2（收尾批，8/8）

> 卡: **#1395**（K3 · W1-时序 · p1）｜CTO 2026-10-08 批 B2（机械重复 + 作用域切 B2 + 就地修悬空引用）
> 声明载体: `.claude/claims/1395.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
写入侧对齐本体轴的**收尾批**：余 4 个 mapping ⇒ **8/8 全清**（B1 已合 `ee4b2b60f`）。

### b) 文件审计（实跑，ref=origin/main@ee4b2b60f）
- 余 4 个 mapping 的 `targetNodeType` 仍为遗留名：`Financial`｜`Person`｜`Innovation`｜`Risk`
- 对应本体轴（已核，40 类型内）：`outcome/financial`｜`resource/person`｜`outcome/innovation`(主目标)｜`outcome/risk`
- 读侧字典：4 条**均已存在**（B1 已补 Person/Innovation；Financial/Risk 原本已在）⇒ 本批**无需再补字典条目**
- 🔴 **就地修**：字典 `Financial.ruleTestedBy` 指向 `tests/ontology/node-type-mapping.test.ts`（**该文件不存在**）⇒ 改指 `tests/sentinel/node-type-resolver.test.ts`

### c) 决策
同 B1 形态（CTO 已裁 (a)）：写入侧写主目标；standardKey 段派生保守化（键字节不变）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **新教训（CTO 命名）**：**"判据的作用域泄漏"** —— 判据/测试文件里混入下一批的期望 ⇒ "本批绿"变成不可能
  ⇒ 防御：**判据的批次边界要显式声明**（本批已把 B1 的 4 个标为"已合"、本批 4 个为"本批"，禁止交叉）
- R192：形态扫描标注"只证明形态"｜R178：短路显式声明

## Q2: 范围 — 正确的最简方案
做什么（逐文件显式列全；本批 = **B2 4 个 + 收尾声明**）：
- extensions/ontology/field-mappings/erp-standard.json — targetNodeType → outcome/financial
- extensions/ontology/field-mappings/hr-standard.json — targetNodeType → resource/person
- extensions/ontology/field-mappings/innovation-pipeline.json — targetNodeType → outcome/innovation
- extensions/ontology/field-mappings/risk-register.json — targetNodeType → outcome/risk
- extensions/ontology/node-type-mapping.json — **仅**修 Financial 条目的 ruleTestedBy 悬空引用（不新增条目）
- tests/agent/write-side-axis-alignment.test.ts — 作用域切 B2（覆盖 8/8；V2 用 hr-standard；V2-b 用 erp-standard）
- tests/agent/data-ingest-service.test.ts — 必要连带（hr/erp-standard 期望切本体轴名）
- .claude/claims/1395.yaml + .claude/task-briefs/2026-10-08-1395-write-side-axis-b2.md

不做什么（逐条含具体文件名）：
- 不改 extensions/ontology/field-mappings/crm-standard.json（B1 已改，已合）
- 不改 extensions/ontology/field-mappings/competitive-intel.json（B1 已改）
- 不改 src/agent/data-ingest-service.ts（B1 已改：限定名 + 候选路径告警 + standardKey 派生）
- 不改 src/l4/graph-bridge.ts（standardKey 冲突检测属既有路径；本卡只登记其缺口）
- 不建 resource/tool 写入者（无上游 ⇒ 硬造 = 造数据）

范围外约束（非文件级）：ingest 绕过冲突检测 ⇒ **另立卡（p1，草案已报 CTO）**。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`POST /api/data/ingest`（经 `loadFieldMapping` + `ingestBatch`）。
处理：映射字段 → schema 白名单（限定名）→ `createNode(本体轴类型)` → standardKey（段=遗留形态）。
结果：节点类型 = 本体轴；**经收口点的读者（读遗留名）能读到**；键字节不变。

## Q4 契约与测试:
- 契约：同 B1（`loadNodeTypeSchema` 双形态输入；缺失告警含 candidates）
- 测试：V1（形态：8/8 覆盖，本批逐个点名 + B1 已合逐个点名）｜V3（形态：两侧同步）｜
  🔴 V2（行为：hr-standard ⇒ resource/person ⇒ 读 `Person` 命中）｜🔴 V2-b（行为：erp-standard ⇒ 键段 `:Financial:`）｜
  🔴 M4（行为+形态：缺失 ⇒ null + 告警含 candidates）｜【登记】tool 无上游
- 反例（实测）：M1 只改写入侧（删 4 条字典条目）⇒ **2 红**（V3+V2）｜M2 只补字典（还原 hr 目标）⇒ **3 红**（V1+V3+V2）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: L2（`src/agent` 消费面）+ 扩展数据（`extensions/ontology/**`）

## Done 标准
- [ ] verify: npx vitest run tests/agent/write-side-axis-alignment.test.ts tests/agent/data-ingest-service.test.ts
- [ ] verify: npx vitest run tests/agent/ tests/sentinel/ tests/l3/ tests/ontology/
- [ ] verify: test "$(git grep -c "outcome/financial" HEAD -- extensions/ontology/field-mappings/erp-standard.json | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
