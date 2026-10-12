# 卡面 · [K4-C] 权威表 7 个 E 号无 `$id` 落点 —— 卡住 6 件循环 7 个阀位的运行时后果

> **卡面来源**：K4 批 3 #238/#239 实测（impl-a T1–T5 五类切分）＋ 队长裁定（E-25 排除迁移域）｜
> **架构基准**：产品宪章 v8.1｜**机器真源**：`docs/synova/coordination/numbering-authority.md` §九 + `docs/synova/product-lines/evidence/K4-b3-239-valve-mapping.md`
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配
> **挂称**：里程碑 = K4 · 本体/因果边/循环编号｜执行态 = **未开工**｜阻塞源 = 无

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把**编号对不上**的那些边，一条条判清楚"到底对应哪个边"——因为现在有 **7 个循环阀门**卡在这上面，**算不了**。

**② 解决什么问题**（实测，`a7437498c`）：
```
6 件 cycle 的 valve 边里，出现的 distinct E 号 = 21
T1 字符串同义·可直接落库          n=9
T2 语义同义·交叉件·效力待追认      n=3（E-15 / E-19 / E-31，已降为「候选·非落点」）
T3 章间分歧·待裁                  n=1（E-08：第二章 RESOURCE_ACQUISITION vs 第一章∩第四章 TALENT_FILTER）
T4 无 $id 落点·待裁               n=7（E-01 / E-04 / E-06 / E-30 / E-34 / E-35 / E-37）
T5 落点两依据相冲·不可判           n=1（E-25）
自检 9+3+1+7+1 = 21 ✅
```
🔴 **关键因果**（impl-a 原话，队长逐字采纳）：
> **「`7` = 19 条待裁清单的运行时后果 —— 待裁不是纸面问题，它已卡住 6 件循环里的 7 个阀位。」**
⇒ 权威文档01 的两位式 E 号与仓内词表是**两套编号**：**字符串同义仅 13/42**；
**19 条无仓内依据**（其中 7 条**正好是五阀要用的**）。

**③ 做完对项目的推动**：① 循环层的**阀门映射**才能真正算（`overflow-compute` 的关键路径下界依赖 `valves[].edgeId` 能被解释）；
它是宪章 **§2.7 一致性** 的前提：**编号不一致 ⇒ 动力学算不准**。

**④ 🔴 不做行不行**：**不行**（结构缺口）——
理由：#239 已把 `valves[].edgeId` 落成 **`E-NN`** 形态（**刻意不建 E号→`$id` 运行时映射**）⇒
**7 个阀位在运行时无法解析到具体边** ⇒ 循环层"能画但不能算"。
（批 3 已把这条写成 #239 的**已知边界**，但**修的活属本卡**。）

**⑤ 现在有什么基础**（实测，as_of `ba1b22a8b5`）：
- ✅ 编号权威表已建：`docs/synova/coordination/numbering-authority.md`（表 A 42 行 + T1–T5 切分 + 交叉件锚点 24 处）
- ✅ 探针已建：`scripts/control-tower/probe-cycle-valves.ts`（`TOTAL_valve_edges = 43`、`valve_files=6 compliant=6`）
- ✅ 值域权威已定：doc15 第一章 §3.4 桶图例（6 桶）+ 第三章 §3.5.1（数值区间 8 条）
- ❌ **7 条无落点**（E-01/E-04/E-06/E-30/E-34/E-35/E-37）
- ❌ **E-25 两依据相冲**（`brand_building` vs `brand_builds`；队长已裁"排除迁移域=无落点"，**落点本身仍未裁**）
- ❌ **E-08 章间分歧**（第二章自身对 E-12 亦不自洽）

**⑥ 还需要做什么**：逐条裁定 7+1+1 = **9 个 E 号的落点**（本体层 vs 循环层的对应关系）——
① 7 条无落点：**新增边文件** 或 **判定"本体层确无此边、循环层应改引他边"**（二者必有其一，**禁悬空**）；
② E-25：在两依据间裁定（队长已给反证：词表内「品牌建设」四字**只出现在 `brand_builds.json` 的 description**）；
③ E-08：裁"第二章 vs 第一章∩第四章"以何为准（**同族问题见 [K4-E]** 的 4 条章间分歧总数）。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无"编号权威 ↔ 实例映射"这种语义；
可借方向 = 「**声明必须与实际消费者一致；不生效就报错**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）。
❌ 不借 DSH 的包级隔离（我们这是**两套已有词表的映射**，不是新包）。

**⑧ 涉及代码文件**：
`docs/synova/coordination/numbering-authority.md`（权威表，改它=订正落点）｜
`scripts/control-tower/probe-cycle-valves.ts`（判据）｜
`cycles/**/*.cycle.json`（`valves[].edgeId` 的使用者）｜
（若新增边文件则）`extensions/ontology/edge-types/**`

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**① 循环层 ↔ ② 本体层**的**编号中轴**（宪章 §0.4）。
**b) 文件审计**：权威表存在（42 行）；探针存在（exit 0）；`valves` 已落 6 件（43 条边、21 个 distinct E 号）；**7+1+1 条无干净落点**。
**c) 结论**：**扩展 + 裁定**（在既有权威表上逐条补落点；**可能新增边文件**）。

## Q1: 调研
**a) 业界**：标识符治理 = **单一真源 + 别名映射**；未映射的引用是**构建错误**，不是运行时警告。
**b) 顶级团队**：`enum` 与实体表**双向可校验**；映射缺口**阻断**而非降级。
**c) 我们的错**：**铁律 9**（关键变更 grep 全仓库传播）＋ **批 3 F1 第 4 例**（同一 E 号两处取值不同：队长底稿判 `MISS` vs L1 件判可落）。

## Q2: 范围
**做什么**：9 个 E 号（T4×7 + T5×1 + T3×1）**逐条给落点**（`$id` 或"本体层确无"）；更新权威表 + 探针判据；若新增边文件则登记 +1。
**不做什么**（**必须带路径**）：
```
不改 extensions/ontology/edge-types/ 下既有 58 件 的 action_effect_lag / transfer_function 值  （值域归 #234/#235 域）
不改 src/cycles/**                    （循环层代码归 #239 域）
不改 scripts/control-tower/probe-cycle-edges.ts  （#238 判据物）
不改 scripts/audit/**                 （K3 域，红线）
```
## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`npx tsx scripts/control-tower/probe-cycle-valves.ts`（扩展后）＋ 权威表探针。
**交互**：读 `valves[].edgeId` 的 21 个 distinct E 号 → 对权威表逐条解析 → 断言**全部有落点或有登记理由**。
**结果**：`T4 = 0`（无落点条数）；末行 `valve_eids=21 resolved=N registered_gap=0`；exit 0。
**反例**：把任一 T4 条目的落点从权威表删掉 ⇒ 探针必报"无落点且未登记" ⇒ exit 1。

## 架构层: ① 循环层 ↔ ② 本体层（编号为中轴；宪章 §0.4 / §4.1）

## 写集
```
docs/synova/coordination/numbering-authority.md
scripts/control-tower/probe-cycle-valves.ts
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-eid-landing-<日期>.md
（若新增边文件：extensions/ontology/edge-types/ 下逐条裸路径 + extensions/ontology/manifest.json + packages/ontology/src/edge-types.ts，三者成对）
```

## Done 标准
```
① T4（无落点）= 0；每条 T4/T5/T3 条目**要么有 $id 落点、要么有"本体层确无"的书面裁定**（禁悬空）
② 探针末行 `resolved=N registered_gap=0` + exit 0（贴原始输出）
③ 反例（脚本化 + 核"替换确实发生"）：删任一落点 ⇒ 必红 + exit 1
④ 若新增边文件：`check-ontology-fields.sh` 件数 +N / exit 0；且 `manifest.edgeTypes` 与 `packages/ontology/src` 常量**成对更新**
⑤ 复原（口径 W）逐字节一致
⑥ 四元组：值 + 口径 + 时点 + 探针版本
```
⚠️ PR 正文须写 `Refs #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
