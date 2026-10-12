# K4-b3-239 证据件 —— K4-06 循环层五阀映射 ＋ `action_effect_lag`

> 卡号：**#239**（K4-06）｜ 分支：`k4b3/238-239` ｜ base：`ba1b22a8b5`
> 执行：impl-a（K4 批 3 · L1 小队）｜ 生成：2026-10-12
> 读数时点 × diff 左端：**`as_of ba1b22a8b5 × git diff --name-only ba1b22a8b5..HEAD`**
> 配套交付件：6 件 `cycles/**/*.cycle.json`、`src/cycles/{cycle-types,cycle-loader,overflow-compute}.ts`、
> `scripts/control-tower/probe-cycle-valves.ts`、`tests/cycles/valve-mapping.test.ts`
> 前置件（#238）：`docs/synova/coordination/numbering-authority.md`

---

## 〇、形态权威源（B4：仓内可引原件）

| 项 | 值 |
|---|---|
| 路径 | `docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md` |
| 节锚点 | ``### 3.4 `edges` -- 五阀映射（含action_effect_lag）`` |
| ⚠️ 同名不同物 | **第三章**另有 `### 3.4 执行约束因子模型` —— **不是本卡依据** |
| 逐字键名 | `acquisitionValve` / `allocationValve` / `conversionValve` / `deliveryValve` / `recycleValve` |
| 逐字元素 | `{ "edgeId": "E-05", "actionEffectLag": "immediate" }` |
| 逐字桶图例 | `immediate` / `1_month` / `1-3_months` / `3-6_months` / `6-12_months` / `>12_months`（**6 个**） |
| 模板来源 | 同章 **§5.1 基础模板 4 个**（`cash-flow` / `customer` / `talent` / `product`）＋ **§5.2 行业模板 2 个**（`store-replication` / `arr-growth`） |
| 原件身份证明 | `git ls-files --full-name -- <上述路径>` 命中（git 追踪）；`git cat-file -e ba1b22a8b5:<路径>` exit 0 |

---

## 一、前提实测（开工前自测）

```
$ git grep -nE "Valve|valves|actionEffectLag" -- src/cycles/     （开工前）
（0 命中 —— 铁律 0-2 接线门禁为真缺口，与 CTO 开工令一致）
```
本卡落地后：
```
$ git grep -n "Valve" -- src/cycles/ | wc -l
24            （全部非注释；逐条见 §五）
```

**6 件 cycle 的 `valves` 逐字取自权威模板**（非自造）：
```
cash-flow          → cycles/builtin/cash-cycle.cycle.json                           6 条
customer           → cycles/builtin/customer-cycle.cycle.json                       6 条
talent             → cycles/builtin/talent-cycle.cycle.json                         6 条
product            → cycles/builtin/product-cycle.cycle.json                        7 条
store-replication  → cycles/industry/retail-ecommerce/store-replication.cycle.json  9 条
arr-growth         → cycles/industry/saas-tech/arr-growth.cycle.json                9 条
                     TOTAL_valve_edges = 43
```
⚠️ 权威模板的 `cycleId` 为 `cash-flow`/`customer`/`talent`/`product`，仓内为 `cash-cycle`/`customer-cycle`/`talent-cycle`/`product-cycle`
（`store-replication`/`arr-growth` 两件同名）。**配对键 = 循环语义名，禁按位置配对**（见 §六）。

---

## 二、探针正常路径（原始输出全文，不截断）

```
$ node scripts/control-tower/probe-cycle-valves.ts
══════ 判据① valves 存在 + 五阀键齐备（口径：5 键逐字对齐 doc15 第一章 §3.4）
cycle_files = 6

══════ 逐文件明细
file | valve_keys(≤5) | valve_edges | edges[]_kept | violations
cycles/builtin/cash-cycle.cycle.json | 5 | 6 | yes | 0
cycles/builtin/customer-cycle.cycle.json | 5 | 6 | yes | 0
cycles/builtin/product-cycle.cycle.json | 5 | 7 | yes | 0
cycles/builtin/talent-cycle.cycle.json | 5 | 6 | yes | 0
cycles/industry/retail-ecommerce/store-replication.cycle.json | 5 | 9 | yes | 0
cycles/industry/saas-tech/arr-growth.cycle.json | 5 | 9 | yes | 0
TOTAL_valve_edges = 43

══════ 判据③ actionEffectLag ⊂ 6 桶
lag_buckets = immediate 1_month 1-3_months 3-6_months 6-12_months >12_months
lag_buckets_count = 6   （规范 6 桶）
bucket_histogram（逐桶实用条数）:
  immediate = 3
  1_month = 10
  1-3_months = 14
  3-6_months = 11
  6-12_months = 5
  >12_months = 0
lag_buckets_used = 5   （实用桶数；规范 6 / 实用 5）
lag_unused_buckets = >12_months

✅ 结论：6/6 件含完整五阀映射（5 键齐备 + 桶合法 + edges[] 未被覆盖）；exit 0
valve_files=6 compliant=6 violations=0
===EXIT=0===
```

**口径（防漂移）**：**规范 6 桶 / 实用 5 桶** —— `>12_months` **纳入合法值域但本轮 0 次使用**
（CTO 派单件 §四曾只列 5 桶，**漏 `>12_months`**，本件已登记并把它纳入校验值域）。

---

## 三、测试件（`tests/cycles/valve-mapping.test.ts`）

```
$ node node_modules/vitest/vitest.mjs run tests/cycles/valve-mapping.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
===EXIT=0===
```
覆盖：正常路径（6 件结构 + 剖面值 + 43 条合计）｜降级路径（`valves` 缺失 ⇒ 空剖面；非法桶 ⇒ `invalidEdgeCount`）｜
边界（桶集合 6/实用 5、窗口 = 关键路径时不降级）｜**真消费 4 组对照**（见 §四c）。

---

## 四、反例（判别性夹具）—— 全程 /tmp 镜像，未动源仓

### 4.a 反例1：删掉 `cash-cycle` 的 `acquisitionValve` ⇒ 探针 exit 1
```
TOTAL_valve_edges = 41
❌ 结论：1 项违规 — exit 1
valve_files=6 compliant=5 violations=1
probe_rc=1
```

### 4.b 反例3：任一条 `actionEffectLag` 改成非法桶 `"soon"` ⇒ 探针 exit 1
```
TOTAL_valve_edges = 43
❌ 结论：1 项违规 — exit 1
valve_files=6 compliant=5 violations=1
probe_rc=1
```

### 4.c 反例2（**最要紧**）：把 `overflow-compute` 的消费改回硬编码 ⇒ 测试必红
篡改（镜像内，唯一子串命中 1 次）：
```
needle: dataWindowMonths < valveLag.criticalPathMinMonths;   →   false;
PATCHED_HARDCODE (needle seen 1 time)
```
结果：
```
 × 有 valves + 短窗口 ⇒ 被消费：valveLagExceedsWindow=true、degraded=true 21ms
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```
⇒ **「删掉即报红」成立**：消费一旦被硬编码，判别性用例立刻红。
另 4 组对照（测试内）各自可分辨：有/无 `valves` × 长/短时滞 ⇒ `valveLagExceedsWindow` 与 `degraded` 四态互异。

### 4.d 源仓零改动
```
diff vs base: [（/tmp 镜像脚本对源仓只在 (e) 段做只读核对；源仓改动均为本卡写集内的有意改动）]
```
本卡写集内的改动**全部为有意改动**：6 件 cycle（加 `valves`）+ 3 件 `src/cycles`。

---

## 五、接线证据（铁律 0-2：`grep -rn "Valve" src/cycles/` ≥1 处**非注释**真消费）

```
$ git grep -n "Valve" -- src/cycles/   → 24 处（全部非注释）
src/cycles/cycle-loader.ts:40   function validateValves(raw: unknown): string[] {
src/cycles/cycle-loader.ts:174      const valveViolations = validateValves(cycle);
src/cycles/cycle-types.ts:110-114   'acquisitionValve' … 'recycleValve'
src/cycles/cycle-types.ts:117       export type ValveKey = (typeof VALVE_KEYS)[number];
src/cycles/cycle-types.ts:127       export interface ValveEdge {
src/cycles/cycle-types.ts:135       export type CycleValves = Record<ValveKey, ValveEdge[]>;
src/cycles/cycle-types.ts:162       valves?: CycleValves;
src/cycles/overflow-compute.ts:13   import type { CycleConfig, ValveKey } from './cycle-types';
src/cycles/overflow-compute.ts:21   export interface ValveLagProfile {
src/cycles/overflow-compute.ts:45   export function computeValveLagProfile(cycle: CycleConfig): ValveLagProfile {
src/cycles/overflow-compute.ts:224  const valveLag = cycle.valves ? computeValveLagProfile(cycle) : null;   ← **真消费入口**
```

**真消费语义（写清，非装饰字段）**：`computeOverflow` 由 `valves` 算出**关键路径下界**
（逐阀取该阀各边 `minMonths` 的最小值，再取全阀最大 = 关键路径下界）；当
**数据窗口（月）< 关键路径下界** ⇒ `valveLagExceedsWindow = true` + `log.warn(...)` + `degraded = true`。
⇒ 删掉该消费（改硬编码）⇒ §4.c 报红。

**loader 校验（缺字段即报错）**：`validateValves` 逐条返回违规串，`loadCycleFile` 把违规计入 `errors` 并 `return`
⇒ `loadCycles` 返回 `degraded: true`（不静默放行；铁律 11）。判据：`valves` 存在 + **5 键齐备** + 每阀 ≥1 条 +
每条 `{edgeId: string, actionEffectLag ∈ 6 桶}`。

---

## 六、口径声明 ＋ B2「测不出什么」

**口径（照 CTO/队长锁定，不许漂）**：
1. 键名 5 个（doc15 第一章 §3.4 逐字）。
2. 元素形态 `{ edgeId, actionEffectLag }`。
3. 新增 **`valves`** 字段，**不覆盖**既有 `edges[]`（同名不同物 —— 前者是"阀映射"，后者是"图结构"）。
4. **`valves[].edgeId` = `E-NN`**（§3.4 原样形态）。**本卡不建立「E 号 → `$id`」的运行时映射**
   （该映射表本身仍是 `numbering-authority.md` §九 的 R1 待裁项，归 CTO）。
   ⚠️ 与 `edgeRefs`/`mapping.edgeId` 的 `$id`（`edge/<snake>`）**是两套编号，禁互换**；副作用已核：
   #238 判据① 的正则 `E-[0-9]+\.[0-9]+`（**带小数点**）**不匹配** `E-NN` ⇒ 写入 `E-NN` 不会打红 `legacy_occurrences`。
5. 桶 **规范 6 / 实用 5**（`>12_months` 已定义未使用），**必须带口径**。

**B2·本卡测不出什么**：
1. **测不出** `valves[].edgeId` 的 `E-NN` 与词表 `$id` 是否**语义等价**（§3.4 用到的 21 个 distinct E 号里，
   **7 个在 `numbering-authority.md` §三 无 `$id` 落点**、`1` 个落点不可判）⇒ 本卡的**编号面**正确性**不等于内容面正确性**。
2. **测不出**「五阀映射是否**语义完备**」—— 本卡只测**形态合规**（5 键 + 桶合法 + 不覆盖 `edges[]` + 探针 exit 0）。
3. **测不出**时滞桶的**真值**（`actionEffectLag` 是**预期**生效延迟，本卡不验证它是否与现实相符）。
4. **测不出**与 `extensions/ontology/edge-types/**` 里 `action_effect_lag`（**数值区间**口径，走 doc15 §3.5.1）的一致 —— 二者**不同物**。

**并入 verifier 的教训（口径声明）**：**跨文档比对必须先钉配对键，禁按位置**。
本卡的配对键 = **循环语义名**（`cash-flow` ↔ `cash-cycle`），不靠文件顺序；
#238 的配对键 = **label / E 号字面**，不靠形态归一（`E-1.1` ≡ `E-11` 形似而所指不同）。

---

## 七、交付时刻读数（#239 commit 后实测）

> 读数时点 × diff 左端 = **`as_of ba1b22a8b5 × git diff --name-only ba1b22a8b5..HEAD`**

```
$ git log --oneline -1
559fb6b0e feat(239): K4-06 循环层补五阀映射 + action_effect_lag（valves 新键，不覆盖 edges[]）
$ git rev-parse HEAD                 → 559fb6b0e59b0459798f6d94489925f235294190
$ git diff --stat ba1b22a8b5..HEAD   → 20 files changed, 2449 insertions(+), 19 deletions(-)

$ git diff --name-only ba1b22a8b5..HEAD
.claude/claims/238.yaml
.claude/claims/239.yaml
cycles/builtin/cash-cycle.cycle.json
cycles/builtin/customer-cycle.cycle.json
cycles/builtin/product-cycle.cycle.json
cycles/builtin/talent-cycle.cycle.json
cycles/industry/retail-ecommerce/store-replication.cycle.json
cycles/industry/saas-tech/arr-growth.cycle.json
docs/synova/GLOSSARY.md
docs/synova/coordination/numbering-authority.md
docs/synova/product-lines/evidence/K4-b3-238-numbering-authority.md
docs/synova/product-lines/evidence/K4-b3-239-valve-mapping.md
memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
scripts/control-tower/probe-cycle-edges.ts
scripts/control-tower/probe-cycle-valves.ts
src/cycles/cycle-loader.ts
src/cycles/cycle-types.ts
src/cycles/overflow-compute.ts
tests/coordination/numbering-authority.test.ts
tests/cycles/valve-mapping.test.ts

$ git ls-remote --heads origin | grep 238-239
559fb6b0e59b0459798f6d94489925f235294190	refs/heads/k4b3/238-239

$ node scripts/control-tower/probe-cycle-valves.ts | tail -2
✅ 结论：6/6 件含完整五阀映射（5 键齐备 + 桶合法 + edges[] 未被覆盖）；exit 0
valve_files=6 compliant=6 violations=0

$ node scripts/control-tower/probe-cycle-edges.ts | tail -1
occurrences=45 distinct=15 hit=15 miss=0      （#238 判据④ 未被本卡打红 —— E-NN 不匹配带小数点的旧编号正则）

$ git hash-object memory/notes/proposed/2026-10-12-K4-b3-numbering-authority.md
b7fd9e1a0ab7536b46ae4129d4ec53439f6079f1      （= 队长分支同 blob；同路径纪律已满足）

$ git status --porcelain=v1
 M .claude/claims/201.yaml
 M .claude/claims/345.yaml
（仅此两件 —— 均为**队长**的存量 claim 修复，**未 stage、未提交、不在本卡 diff 内**）
```

**推送方式**：`synova-commit` **自带 auto-push**（M4）—— `aa04c9377..559fb6b0e  k4b3/238-239 -> k4b3/238-239`，**未手工再推**。

**写集对账（多出/缺失说明）**：
| 项 | 说明 |
|---|---|
| `git diff` 集 vs `239.yaml` 的 `writeset` | **20 = 20，逐条一致，无多出、无缺失** ✅ |
| 卡面写集（13 条） | 全部命中；本卡的 diff 另含 **#238 的 7 条**（同分支同 PR 的既有变更） |
| 任务板原写集里的 `docs/synova/GLOSSARY.md` / `numbering-authority.md` / `probe-cycle-edges.ts` / `numbering-authority.test.ts` / `238.yaml` | 属 **#238 域**，已在前 4 笔提交内；本卡**未再改** |
| 工作区未提交残留 | `201.yaml` / `345.yaml`（` M`，归属 = **队长**，不进本 PR） |

---

## 八、未决项 ＋ 归属

| # | 未决项 | 归属 |
|---|---|---|
| 1 | `valves[].edgeId` 的 21 个 E 号里 **7 个无 `$id` 落点**（`E-01/E-04/E-06/E-30/E-34/E-35/E-37`） | 🔴 CTO（= #238 §3.5 的 19 条待裁的**运行时后果**） |
| 2 | **`E-25`** 落点**不可判**（两依据相冲） | 🔴 CTO（#238 §九.2.1 已登记） |
| 3 | `E-08`（章间分歧）作为 `valves` 落点 | 🔴 CTO |
| 4 | 四条交叉件候选（`E-15`/`E-19`/`E-31`，原含 `E-25`）效力是否追认 | 🟡 队长已裁定「降级可采信」；追认请 CTO |

> **一句话**：「7」= 19 条待裁清单的运行时后果 —— **待裁不是纸面问题，它已卡住 6 件循环里的 7 个阀位**。

## 九、一句话自验结论

探针 `exit 0`（`valve_files=6 compliant=6 violations=0`，`TOTAL_valve_edges = 43`，桶规范 6/实用 5），
测试 `13/13` 绿；三条判别性反例各自报红（删阀字段 ⇒ 探针 exit 1｜非法桶 ⇒ 探针 exit 1｜**消费改硬编码 ⇒ 测试红**）；
6 件 `valves` 逐字取自权威15 第一章 §5 模板、`edges[]` 未被覆盖。
**本件可提请独立复核** —— `通过` 与否归 CTO 收件闸 + K3 终审。
