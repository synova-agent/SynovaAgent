# 卡面 · [K4-B] loader 的 prose_formula 测不出「已标定 vs 未标定」（13 公式与 39 unknown 同分类）

> **卡面来源**：K4 批 3 #235 实测（impl-b U10）＋ verifier 第十轮**运行时实证**（真实 loader 模块 + 最小 logger 桩，桩已披露）｜
> **架构基准**：产品宪章 v8.1｜**机器真源**：`docs/synova/product-lines/evidence/K4-b3-235-transfer-function-20261012.md` §6.1
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配
> **挂称**：里程碑 = K4 · 本体/因果边/循环编号｜执行态 = **未开工**｜阻塞源 = 无

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：让 loader 能分清「**这条边的传导公式已经标定了**」和「**还标的是 unknown**」——现在两者在分类上**长得一模一样**。

**② 解决什么问题**（实测，verifier 用真实 loader 复现）：
```
unknown（未标定）        → status = prose_formula  injectable = false
真公式（brand_builds）   → status = prose_formula  injectable = false   ← 与 unknown 同 status
TBD 占位                 → status = placeholder    injectable = false
P-3 对象                 → status = resolved       injectable = true
```
⇒ **13 条权威公式与 39 条 `unknown` 在 loader 层同落 `prose_formula`** ⇒
任何**只看 loader 分类**的判据（例如 `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的 `tf_prose` 计数）
**会说"55 条都有公式"** —— 而真值是 **13 条公式 + 39 条 unknown + 3 条既有真公式**。
⇒ 批 3 已实测该风险：`-1031` 棘轮从 `tf_prose: 3` 变 `55`（#235 后）。

**③ 做完对项目的推动**：它是宪章 **§2.7 一致性** 的直接支撑 ——
"参数层（④）是护城河"，而**未标定 vs 已标定无法区分** ⇒ ④ 参数层的**完成度无法度量**。

**④ 🔴 不做行不行**：**不行**（结构缺口，非欠账）——
理由：`transfer_function` 是"因果边怎么传导"的**唯一定义**；若"已标定/未标定"不可分辨，
则 ④ 参数层**永远无法回答"还差多少条标定"** ⇒ 无法排期、无法验收。
（区别于 [K4-A] 那种"欠账级"：这条是**度量能力缺失**。）

**⑤ 现在有什么基础**（实测，as_of `ba1b22a8b5` + `a7437498c`）：
- ✅ 字段存在：58 件 `edge-types/*.json` **全部**有 `transfer_function`（`check-ontology-fields.sh` exit 0）
- ✅ 分类器存在：`src/l4/ontology-loader.ts:239` `PLACEHOLDER_RE = /\b(tbd|to be defined|todo|pending|n\/a)\b/i`
- ✅ 三种状态已存在：`resolved` / `placeholder` / `prose_formula`
- ❌ **无"已标定"状态**：真公式与 `unknown` 都落 `prose_formula`
- ❌ 无判据：没有任何 check 断言"`tf_prose` 里哪些是公式、哪些是 unknown"

**⑥ 还需要做什么**：
① 定新状态（或新字段）：建议 **`declared_unknown`**（显式降级标记）与 **`formula`**（真公式）分开；
② 改 `src/l4/ontology-loader.ts` 的分类逻辑（**属读路径，见 Q2 排除项**）；
③ 同步 `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的 `BASELINE_TALLY`（改**由逐件表推导**，见 [K2-D]）；
④ 加判据：`tf_formula` / `tf_declared_unknown` / `tf_other` **三类各自可数**。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无"因果传导标定度"这种领域语义；
唯一可借方向 = 「**按名声明、宿主满足**」（`packages/compaction/compaction-basic/src/index.ts:114` `static inject=[...]`）：
即"标定状态"应由**边文件自己声明**，而非由 loader 猜。

**⑧ 涉及代码文件**：
`src/l4/ontology-loader.ts`（分类逻辑）｜`extensions/ontology/edge-types/**`（标定状态载体）｜
`tests/l4/ontology-loader-param-bridge-1031.test.ts`（棘轮）｜判据源：`scripts/control-tower/probe-ontology-values.ts`

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**② 本体层 → ④ 参数层**的**接缝**（宪章 §0.4 硬规则「③ 是唯一允许写 ④ 的角色」）。
**b) 文件审计**：`src/l4/ontology-loader.ts` 有 3 值分类（resolved/placeholder/prose_formula）；`-1031` 测试有 `BASELINE_TALLY` 逐类计数；**无"公式 vs unknown"判据**。
**c) 结论**：**扩展**（在现有分类器上加状态，不新建模块）。

## Q1: 调研
**a) 业界**：数据血缘/参数标定系统里，**"未标定"必须是一等状态**（否则无法度量覆盖率）。
**b) 顶级团队**：把"未知"与"已知但非结构化"分开（`null` ≠ `prose`）。
**c) 我们的错**：**铁律 11/31**（静默降级禁止 / 降级信号传播）—— 本卡的病是**降级信号不可分辨**（两类都叫 `prose_formula`）；
批 3 **U10** 即此。<br>另：本批 **F1 同族**（同一事实两处取值不同）在分类层复现。

## Q2: 范围
**做什么**：分辨"已标定 vs 未标定"；`tf_formula` / `tf_declared_unknown` / `tf_other` **三类可数**；同步 `-1031` 棘轮。
**不做什么**（**必须带路径**）：
```
不改 src/cycles/**                      （循环层，属 #239 已交付域）
不改 scripts/control-tower/probe-ontology-values.ts  （K4-01 探针；改它属另卡的写集）
不改 extensions/ontology/tags.json      （属 [K4-A]）
不改 packages/ontology/**               （两套词表合属 [K4-D]）
```
## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`npx tsx scripts/control-tower/probe-<新>.ts` **或** 扩 `-1031` 测试的 count 面（择一，CTO 定）。
**交互**：逐件读 `transfer_function` → 分 `formula` / `declared_unknown` / `placeholder` / `other` 四类。
**结果**：末行 `tf_formula=13 tf_declared_unknown=39 tf_placeholder=1 tf_other=3`（数字以当刻实测为准）＋ exit 0；
**并须给反例**：把某件公式改成 `unknown` ⇒ `tf_formula` 必须 -1（证明可分辨，非恒真）。

## 架构层: ② 本体层 ↹ ④ 参数层（宪章 §0.4 / §4.1）

## 写集
```
src/l4/ontology-loader.ts
tests/l4/ontology-loader-param-bridge-1031.test.ts
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-loader-calibration-state-<日期>.md
（逐条裸路径；若新增探针另加其路径）
```

## Done 标准
```
① 「已标定 vs 未标定」在 loader 层**可分辨**（贴四类计数原始输出 + exit code）
② 反例（脚本化 + 核"替换确实发生"）：真公式 → unknown ⇒ 对应计数 -1 / +1
③ 反例 2：unknown → 真公式 ⇒ 反向变化
④ 复原（口径 W）逐字节一致
⑤ `-1031` 棘轮**由逐件表推导**（禁字面基数；见 [K2-D]）
⑥ 四元组：值 + 口径 + 时点 + 探针版本
```
⚠️ PR 正文须写 `Closes #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
