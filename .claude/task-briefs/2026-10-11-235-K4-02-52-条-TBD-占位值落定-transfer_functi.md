<!-- 卡面来源: 库外档案仓 K4-本体与循环-审计定稿与卡面全套.md（CTO 亲撰）
     架构基准: 院方 产品宪章.md v8.1（§0.4 ＋ §4.1 ＋ §5.2）
     机器真源: docs/synova/coordination/施工项登记.ts（K4 块）
     审计 as_of: 6ff6b4719 ｜ 已过独立复核（15 条声称全跑，6 处不一致已修正）
     纪律: 执行 session 只从本文件取施工信息；缺字段 ⇒ 问 CTO，不许猜 -->

# Task Brief: #235 → K4-02 — 52 条 `TBD` 占位值落定（`transfer_function` 真实公式）

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把 52 条边类型的 `transfer_function` 从**占位符**变成**真公式**。

**② 解决什么问题**：现在 55 条里 **52 条写的是 `TBD — to be defined in compute phase`**（字面占位），
而块判据 `check-ontology-fields.sh` **只判"键存在＋值非空串"** ⇒ **`TBD` 合法通过** ⇒ **判据绿但内容是空的**。

**③ 做完对项目的推动**：`transfer_function` 是**因果边"怎么传导"的唯一定义**；
不填 ⇒ 溢出公式与跨循环传导**没有数学基础**。

**④ 不做行不行**：**不行** —— 但**优先级低于 K4-05/06**（先有编号权威与时滞，再补传导公式）。

**⑤ 现在有什么基础**：✅ 3 条有真公式（`brand_builds` / `couples` / `cumulative_learning`）；
❌ 52 条 `TBD`；❌ 生产侧 0 消费（与 K4-06 是**同一根因的两面**）。

**⑥ 还需要做什么**：逐条给出公式 **或** 显式标 `unknown`（**禁止 `TBD` 残留**）。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无因果传导语义；借方向：**判据自带 ＋ 不生效即报错**（`dsh-invariants/lib/index.js:6-13`）。

**⑧ 涉及代码文件**：`extensions/ontology/edge-types/*.json`｜新探针 `probe-ontology-values.ts`（与 K4-01 共用）

---

## Q0: 定位
**a)** ② 本体层（K4-a）；**b)** 52/55 条 `TBD`（as_of `6ff6b4719`）；**c)** **扩展**。
## Q1: 调研
**a)** 传导函数（transfer function）是系统动力学标准字段，不允许占位。
**b)** 顶级团队：公式要么有依据、要么显式 `unknown`。
**c)** 我们的错：**铁律 8** 同型（TODO 占位进了交付物）；且**判据只判存在性**导致占位合法 —— 本卡要顺带把判据口径报给 CTO。
## Q2: 范围
**做什么**：52 条逐条落公式或标 `unknown`；探针加"**禁 `TBD`**"断言。
**不做什么**：`不改 extensions/ontology/edge-types/ 以外目录`；`不改 check-ontology-fields.sh`；`不改 packages/ontology/**`。
## Q3: 验收
**入口**：`npx tsx scripts/control-tower/probe-ontology-values.ts`
**交互**：扫全 55 件，统计 `TBD` 残留数
**结果**：`TBD=0`；公式 或 `unknown` 二元
## 架构层: ② 本体层
## 写集
```
extensions/ontology/edge-types/*.json
scripts/control-tower/probe-ontology-values.ts   （与 K4-01 共写 ⇒ 串行：K4-01 先）
tests/ontology/edge-transfer-functions.test.ts
```
## Done 标准
```
① 探针 ⇒ exit 0，且末行含 `TBD=0`
② 反例：把任一条改回 `TBD` ⇒ 探针必 exit 1
③ 52 条逐条有结论（公式 或 `unknown`），无第三条出路
```

---
