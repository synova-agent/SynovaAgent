# Task Brief: #1395（写入侧类型对齐本体轴）

> 卡: **#1395**（K3 · W1-时序 · p1）｜CTO 2026-10-08 裁：改动面 **8×3** + 裁 (a) + 加 M4
> 声明载体: `.claude/claims/1395.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
**写入侧对齐本体轴**（与 #1393 读侧**镜像**）：读侧已统一到本体轴（并集读），写侧 8/9 仍写**遗留字面量**。

### b) 文件审计（实跑，ref=origin/main@9403c3737）
- 8 个 field-mappings 的 `targetNodeType` 全为遗留 PascalCase；**8/8 有同名本体轴类型**（本体轴 40 类型）
- 读侧字典登记状态：**3 已登记**（Client/Financial/Risk）｜**5 未登记**（Competitive/Operational/External/Person/Innovation）
- 🔴 `loadNodeTypeSchema` 假定**单词 PascalCase**（`resource/{lower}.json` → `outcome/` 同名）⇒ 改限定名 ⇒ 查不到 ⇒ 校验 fail-open
- `data-ingest-service.ts:213`：`standardKey = ${graph}:${targetNodeType}:…` ⇒ 改目标会改键 ⇒ **幂等/去重语义受威胁**
- `resource/tool`：**无上游**（9 个 mapping 无一 target 是 Tool）⇒ 不建写入者（登记）

### c) 决策（CTO 已裁）
(a) 写入侧写**主目标** = 读侧字典 `targets[0]`；多目标由读侧承担（**不写两份 = 不复制数据**）
**保守解法（本卡自定，已在 PR 显式标注）**：`standardKey` 段由限定名**末段派生**遗留形态 ⇒ **键字节不变**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **硬约束（CTO 立）**：读依赖字典 + 写改了被字典描述的对象 ⇒ **两侧必须同步**（否则"写进去了，读的人不知道"）
- **R192**：判据默认**行为断言**；形态扫描须写明"**只证明形态**"
- **R178**：短路显式声明（本卡 M3 为**登记**性质）
- 母题：**"两套"**（读侧接了本体轴、写侧没接 ⇒ 读写不对称）

## Q2: 范围 — 正确的最简方案
做什么：
- 8 × `extensions/ontology/field-mappings/*.json` — `targetNodeType` → 同名本体轴（Innovation/Financial 用主目标）
- `extensions/ontology/node-type-mapping.json` — 补 5 条（targets[0] = 主目标；Innovation 双目标）
- `src/agent/data-ingest-service.ts` — ① `loadNodeTypeSchema` 支持限定名 ② 缺失告警含**候选路径** ③ `standardKey` 段派生保守化
- `tests/agent/write-side-axis-alignment.test.ts`（新）— V1/V2/V2-b/V3/M4/M3
- `tests/agent/data-ingest-service.test.ts`（**必要连带**）— 期望对齐本体轴名（6 处）
- claim + brief

不做什么（逐条含具体文件名）：
- 不改 `extensions/ontology/field-mappings/csv-money.json`（已是本体轴 `resource/money`，无需动）
- 不改 `src/l4/graph-bridge.ts`（standardKey 冲突检测属既有路径；本卡**暴露**其缺口但不修）
- 不改 `extensions/ontology/node-type-mapping.json` 中既有 3 条（Client/Financial/Risk 已正确）
- 不改 `src/sentinel/org-scope.ts`（#1393 已合）
- **不**为 `resource/tool` 建写入者（无上游 ⇒ 硬造 = 造数据）

范围外约束（非文件级）：三层字段不统一 ⇒ #1398；ingest 绕过冲突检测 ⇒ 另议（本卡只登记）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`POST /api/data/ingest`（经 `loadFieldMapping` + `ingestBatch`）。
处理：按 mapping 映射字段 → schema 白名单（**限定名**）→ `createNode(本体轴类型)` → standardKey（段=遗留形态）。
结果：节点类型 = 本体轴；**经收口点的读者（读遗留名）能读到**；键字节不变。

## Q4 契约与测试:
- 契约：`loadNodeTypeSchema` 输入支持限定名/遗留名双形态；缺失 ⇒ **不静默**（warn 含 candidates）
- 测试：V1（形态：8 个 ∈ 本体轴）｜V3（形态：两侧同步）｜🔴 V2（行为：真 ingest ⇒ 类型=本体轴 ⇒ 读者读到）｜
  🔴 V2-b（行为：键段=遗留形态；并**登记**预存在的无冲突检测）｜🔴 M4（行为：缺失 ⇒ null + 形态：告警含 candidates）｜M3（登记：tool 无上游）
- 反例（实测）：M1 只改写入侧（删字典条目）⇒ **2 红**（V3 + V2）｜M2 只补字典（还原目标）⇒ **3 红**（V1 + V3 + V2）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: L2（`src/agent`）+ 扩展数据（`extensions/ontology/**`）

## Done 标准
- [ ] verify: npx vitest run tests/agent/write-side-axis-alignment.test.ts tests/agent/data-ingest-service.test.ts
- [ ] verify: npx vitest run tests/agent/ tests/sentinel/ tests/l3/ tests/ontology/
- [ ] verify: test "$(git grep -c "loadNodeTypeSchema" HEAD -- src/agent/data-ingest-service.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
