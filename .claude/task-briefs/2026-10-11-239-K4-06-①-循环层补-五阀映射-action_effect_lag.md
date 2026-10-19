> **卡面来源**：库外档案仓同名片（CTO 亲撰）｜架构基准：产品宪章 v8.1｜纪律：缺字段问 CTO，不许猜


# Task Brief: #239 → K4-06 — ① 循环层补**五阀映射 ＋ action_effect_lag ＋ 池节点四分类**（原 0-4 重立）

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把宪章要求的循环层**五个阀门、时滞、四种池节点**真做出来 —— 现在**一个都没有**。

**② 解决什么问题**：宪章 §0.4 明文 ① 循环层 = 「**池节点四分类 · 五阀映射 · action_effect_lag** · 溢出公式 · 跨循环传导」。
实测：溢出公式 ✅ 6/6 ｜ 跨循环传导 🟡（写法非边 `$id`）｜ 池节点四分类 🟡（声明 4 类，实用 3 类，`goal` 0 次）｜
**五阀映射 ❌（`cycles/` 内 `*Valve` 0 命中）** ｜ **`action_effect_lag` ❌（0 命中）**。
而且权威文档15 §3.4 规定的形态（`edges: { acquisitionValve:[{edgeId, actionEffectLag}], … }`）
与仓内 `edges[]`（`from/to/polarity/delay/weight`）**同名不同物**。

**③ 做完对项目的推动**：① 循环层从"画了个循环图"变成"**能算的企业动力学**"；
它是 ④ 参数层标定的**数据面前提**（宪章硬顺序：指标时序存储必须先于参数标定）。

**④ 不做行不行**：**不行** —— 这是宪章对 ① 循环层的**成文要求**，不是可选项。

**⑤ 现在有什么基础**：✅ 6 件 `.cycle.json`（cash/customer/product/talent/store-replication/arr-growth）；
✅ loader 完整（`cycle-loader.ts:26-28/44/151` → `cycle-registry.ts:46`）；✅ 溢出公式 6/6；
❌ 五阀 ❌ 时滞 ❌ `edgeRefs`/`mapping` **零运行时消费者**。

**⑥ 还需要做什么**：按权威15 §3.4 的形态补五阀 ＋ `actionEffectLag` ＋ 池节点四分类；
🔴 **CTO 裁定（2026-10-11）**：**新增 `valves` 字段**，**不覆盖**既有 `edges[]`
   —— 理由：既有 `edges[]` 是**图结构**（有消费者，形态 from/to/polarity/delay/weight）；
     权威15 §3.4 的 `edges{*Valve}` 是**阀映射**（新语义）⇒ **同名不同物** ⇒ 用新 key 避免歧义；
   —— 连带：**`src/cycles/cycle-types.ts` 必须加进写集**（否则类型读不了新字段）；
**并把它们接到消费端**（否则又是"死数据"）。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无循环/动力学语义；借方向：**按名声明、宿主满足**（`compaction-basic/src/index.ts:114`）。

**⑧ 涉及代码文件**：`（下方 6 条已逐条列出，不用 glob）`（6 件）｜`src/cycles/cycle-loader.ts`（校验新增字段）｜
`src/cycles/overflow-compute.ts`（消费）｜新探针 `probe-cycle-valves.ts`

---

## Q0: 定位
**a)** ① 循环层（K4-b）；**b)** 6 件 cycle 文件、loader 完整、五阀/时滞 0 命中；**c)** **扩展 ＋ 接线**。
## Q1: 调研
**a)** 系统动力学：阀门（valve）＝ 政策杠杆点，是建模核心，不是可选装饰。
**b)** 顶级团队：**字段必须有消费者**，否则是死数据。
**c)** 我们的错：**铁律 0-2**（Step 5 WIRE CHECK 是硬门禁：新字段必须 `grep` 到调用方）；本次三路采集的**共同结论就是"零消费"**。
## Q2: 范围
做什么：
- cycles/builtin/cash-cycle.cycle.json
- cycles/builtin/customer-cycle.cycle.json
- cycles/builtin/product-cycle.cycle.json
- cycles/builtin/talent-cycle.cycle.json
- cycles/industry/retail-ecommerce/store-replication.cycle.json
- cycles/industry/saas-tech/arr-growth.cycle.json
- src/cycles/cycle-loader.ts
- src/cycles/overflow-compute.ts
- src/cycles/cycle-types.ts
- scripts/control-tower/probe-cycle-valves.ts
- tests/cycles/valve-mapping.test.ts
**做什么**：补五阀映射 ＋ `actionEffectLag` ＋ 池节点四分类；**并在 `overflow-compute.ts` 真消费**；loader 加校验（缺字段即报错）。
**不做什么**：`不改 extensions/ontology/**`（K4-01~03 域）；`不改 docs/**`（除本卡 brief）；`不改 scripts/control-tower/check-ontology-fields.sh`。
## Q3: 验收
**入口**：`npx tsx scripts/control-tower/probe-cycle-valves.ts`
**交互**：读 6 件 cycle → 断言五阀字段存在且结构合规 → 断言 `overflow-compute` 真读了它们
**结果**：逐条 ✅/❌；**接线检查有 grep 证据**
## 架构层: ① 循环层（宪章 §0.4/§4.1；载体 `cycles/*.cycle.json`）
#CRITERIA: D
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL）｜A 诊断 / B 导航 / C 接入与权限 / D 基建兜底 -->

## 写集
```
cycles/builtin/cash-cycle.cycle.json
cycles/builtin/customer-cycle.cycle.json
cycles/builtin/product-cycle.cycle.json
cycles/builtin/talent-cycle.cycle.json
cycles/industry/retail-ecommerce/store-replication.cycle.json
cycles/industry/saas-tech/arr-growth.cycle.json
src/cycles/cycle-loader.ts
src/cycles/overflow-compute.ts
src/cycles/cycle-types.ts
scripts/control-tower/probe-cycle-valves.ts
tests/cycles/valve-mapping.test.ts
```
## Done 标准
- [ ] `npx tsx scripts/control-tower/probe-cycle-valves.ts` ⇒ exit 0（六件全部含五阀映射与 actionEffectLag，形态对齐权威15 §3.4）；verify: bash scripts/pre-commit-check.sh
<!-- Done 补记：历史件原验收无法复跑，verify 取全量门禁 -->
```
① 探针 ⇒ exit 0；六件全部含五阀映射与 actionEffectLag，形态对齐权威15 §3.4
② 接线（铁律 0-2）：`grep -rn "Valve" src/cycles/` 至少 1 处**非注释**真消费
③ 反例：删掉任一 cycle 的五阀字段 ⇒ 探针必 exit 1（loader 校验拦住）
④ 反例：把 `overflow-compute` 的消费改回硬编码 ⇒ 测试必红
```

---
