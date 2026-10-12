# 卡面 · [K4-D] 两套本体词表合并（`extensions/ontology` 58 JSON ↔ `packages/ontology/src` 常量）

> **卡面来源**：K4 审计定稿 §五「横向查重」＋ 批 3 #65 落地实测（`ALL_EDGE_TYPES` 52→54 行为变化）｜
> **架构基准**：产品宪章 v8.1｜**机器真源**：`docs/synova/coordination/K4-审计定稿与卡面全套.md` §五
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配
> **挂称**：里程碑 = K4 · 本体/因果边/循环编号｜执行态 = **未开工**｜阻塞源 = 无

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：仓库里**有两份"本体边清单"**，靠人手工同步——合掉它，改成一份。

**② 解决什么问题**（实测，as_of `a7437498c`）：
```
真相源 A：extensions/ontology/edge-types/*.json            = 58 件（文件驱动，loader 按目录扫）
真相源 B：packages/ontology/src/edge-types.ts 的常量        = 54 条（批 3 由 52 → 54）
```
- `packages/ontology/src/` 的常量被 **9 个 `src/` 文件 import**（`connectors/feishu.ts`、`connectors/nemoclaw.ts`、`connectors/types.ts`、`l4/entity-resolver.ts`、`l4/goal-alignment.ts`、`l4/graph-bridge.ts`、`l4/report-graph-adapter.ts`、`tools/org-expert-tools.ts`、`tools/tech-expert-tools.ts`）；
  `ALL_EDGE_TYPES` 被 **3 个 `src/` 文件**消费（`l4/data-exporter.ts:183`、`l4/data-purger.ts:267`、`l4/entity-resolver.ts:215`）。
- 🔴 **批 3 实测的行为变化**：`entity-resolver.ts:215` `ALL_EDGE_TYPES.map(et => typeCounts.get(et) || 0)` 是**邻居类型余弦相似度向量的维度来源**
  ⇒ **52 → 54 改变了向量长度** ⇒ 相似度值随之改变（**无测试钉该长度**）。批 3 已作 **W-8** 登记。
- 🔴 **两源漂移无门禁**：没有任何 check 断言"A 的件数 == B 的条目数" ⇒ 批 3 之前就已漂移（56 vs 52），**无人发现**。

**③ 做完对项目的推动**：消除**双真源**——这是宪章 **§2.7 一致性** 的结构前提；
并让"新增一条边"从**改两个地方**变成**改一个地方**（宪章 §4.7 的文件化扩展原则）。

**④ 🔴 不做行不行**：**可以做，但代价明确** ——
不是安全底线；代价 = **每次新增边都要手工同步两处**，且**漂移无门禁**（批 3 已实证一次）。
⇒ **欠账级**，但**漂移会直接改向量维度**（隐性行为变化）⇒ 优先级**高于**一般文档欠账。

**⑤ 现在有什么基础**（实测）：
- ✅ 文件驱动源已完备：58 件 JSON + loader 目录扫描（`readdirSync(dir).filter(f => f.endsWith('.json'))`）
- ✅ 常量源存在：`packages/ontology/src/edge-types.ts`（54 条，头注自陈"= 52 条目 / 56 JSON 文件"——**批 3 后应为 54 / 58，头注已过期**）
- ✅ 桥接面清楚：`ALL_EDGE_TYPES` 只有 3 个消费者（列全）
- ❌ 无"两源一致"判据；❌ 头注已漂移；❌ 无 `derived` 标记

**⑥ 还需要做什么**：
① 定**单一真源**（建议：**文件驱动源为准**，常量改为**从 JSON 生成**或**运行时时由 loader 提供**）；
② 若保留常量 ⇒ 加**生成脚本 + 判据**（`ALL_EDGE_TYPES.length === ls-tree 件数`），取消手工同步；
③ 处置**向量维度隐性变化**：给 `entity-resolver.ts` 的向量加**显式维度声明**或**钉长度测试**（W-8）；
④ 修 `edge-types.ts` 头注（"52 条目 / 56 JSON 文件" → 当刻实数）；
⑤ 处置 `packages/sog-core/**` 的**第三处**同名物（`sog-schema-registry.ts` 自己的 `Map`）——**声明与它的关系**。

**⑦ DSH 借鉴方式**：**参考自研** —— 借方向的**可借**：
- 借「**包自带判据、宿主只保证不生效就报错**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）⇒ 两源一致应**自带判据**；
- 借「**按名声明、宿主满足**」（`packages/compaction/compaction-basic/src/index.ts:114` `static inject=[...]`）⇒ 常量可作"按名声明"的一方。
❌ **不借** DSH 的包级隔离/版本化（我们这是**同仓两源**，不是外部依赖）。

**⑧ 涉及代码文件**：
`packages/ontology/src/edge-types.ts`（常量源）｜`packages/ontology/src/index.ts`（导出）｜
`src/l4/entity-resolver.ts:215`（向量维度）｜`src/l4/data-exporter.ts:183`、`src/l4/data-purger.ts:267`（消费者）｜
`extensions/ontology/edge-types/**`（文件源，**只读**）｜`scripts/check-file-driven.sh`（**只读**）

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**② 本体层**（宪章 §0.4/§4.1），横跨 `extensions/`（内容面）与 `packages/`（常量面）。
**b) 文件审计**：A 源 58 件 JSON（loader 目录扫）；B 源 54 条常量（9 个 src/ 文件 import）；`sog-core` 另有自己的 `Map`；**无两源一致判据**。
**c) 结论**：**合并/去重**（B 源改为派生或删；并处置第三处同名物）。

## Q1: 调研
**a) 业界**：单一真源（SSOT）；代码生成 > 手工同步（漂移是人类本性）。
**b) 顶级团队**：protobuf/gRPC 式"一个定义生成多语言"；或运行时发现 + 无静态清单。
**c) 我们的错**：**铁律 46**（禁止桥接代理文件——迁移必须真搬）＋ **铁律 47**（"拆完了"必须由 grep 物理证明）；
批 3 实证：**两个数 56/52 长期并存且无人发现**（= 本批 **F1 族**，同一事实两处取值不同）。

## Q2: 范围
**做什么**：定单一真源；去手工同步；加"两源一致"判据；处置向量维度隐性变化；修头注；声明与 `sog-core` 的关系。
**不做什么**（**必须带路径**）：
```
不改 extensions/ontology/edge-types/** 下任何 JSON 的内容与件数   （内容面归 K4 各内容卡）
不改 src/cycles/**                       （循环层归 #239 域）
不改 scripts/audit/**                    （K3 域，红线）
不改 extensions/ontology/tags.json       （归 [K4-A]）
```
## Q3: 验收 — 入口 → 交互 → 结果
**入口**：新增/扩一条 check（如 `bash scripts/check-ontology-fields.sh` 同层）＋ `npx tsc --noEmit`。
**交互**：读 JSON 件数 → 读常量条目数 → 断言相等（或断言常量由生成脚本产出且与 JSON 同步）。
**结果**：末行 `edge_types_json=58 package_consts=58 CONSISTENT`；exit 0。
**反例**：/tmp 沙箱里给 JSON 加 1 件（不同步常量）⇒ 判据必红且 exit 1。

## 架构层: ② 本体层（宪章 §0.4 / §4.1；横跨 extensions/ 与 packages/）

## 写集
```
packages/ontology/src/edge-types.ts
packages/ontology/src/index.ts
src/l4/entity-resolver.ts
tests/l4/entity-resolver-vector-dim.test.ts          （新建：钉向量维度）
（若新增生成脚本/check 则另有：scripts/control-tower/<新脚本>.ts）
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-vocabulary-merge-<日期>.md
```

## Done 标准
```
① 两源一致判据存在且实跑 exit 0，末行含两源各自实数（贴原始输出）
② 反例（脚本化 + 核"替换确实发生"）：JSON 加 1 件不同步 ⇒ 判据红 + exit 1
③ 向量维度不再隐性变化：新测试钉长度（或显式维度声明）
④ `edge-types.ts` 头注与实数一致
⑤ 与 `packages/sog-core/**` 的关系**书面声明**（合/不合 + 理由）
⑥ 复原（口径 W）逐字节一致；四元组：值 + 口径 + 时点 + 探针版本
```
⚠️ PR 正文须写 `Closes #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
