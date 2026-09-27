# D1027 · 前提冻结 + 断裂探针（2026-09-27）

> **本件是 D1027（哨兵读侧「根身份」硬门禁）的开工第 0 步证据**，不是交付结论。
> 用途：① 冻结派单件的事实性前提（实测，不转述）② 给 Win 侧配套卡（D10xx）提供断裂位置与复现方式。
> 生成方式与校验清单在本目录内齐备（probe 源码 + 原始输出 + 复现命令），不依赖 `.tmp`（沿 `CTO-固化-II` §五 时效教训）。

## 一、前提冻结表（逐条实测，命令 + 原始输出）

| # | 派单件前提 | 实测命令 | 实测结果 | 判定 |
|---|---|---|---|---|
| 1 | 骨架「29 节点 + 55 边」 | `ls extensions/ontology/{activity,outcome,resource}/*.json \| wc -l`；`ls extensions/ontology/edge-types/*.json \| wc -l` | 节点 **29**（activity 8 + outcome 8 + resource 13）；边 **55** | ✅ 成立 |
| 2 | 「202 compute 只装载 42%（94 个从未执行）」 | `find extensions/sentinels -path '*/computes/*' -name '*.ts' \| wc -l`；manifest 声明数；aggregate 实际 import 数 | 文件数 **202** ✅（shared/computes 89 + `<哨兵>/computes` 81 + `_extinct/*/computes` 33）；**但「装载率」口径未声明**：manifest 声明 69 → **34%**；aggregate 实际 static import **64** → **32%**；「42% / 94」**未复现** | ⚠️ 部分成立 + 口径不明 |
| 3 | 「42 因果边 transfer_function 全 TBD」 | `grep -l "TBD" extensions/ontology/edge-types/*.json \| wc -l` | **42 / 55** 为占位串 `TBD — to be defined in compute phase`；另 13 条为**自由文本公式**（非 `number\|{param}\|{ref}` 值域，即 `CTO-固化-II` G-3 待管存量） | ✅ 成立 |
| 4 | 「三循环 `.cycle.json` = 0」 | `git ls-files cycles/ \| wc -l`；`ls cycles/*/` | **不成立**：git 跟踪 **6** 个 `.cycle.json`（builtin 4：cash/customer/product/talent + industry 2：retail-ecommerce/saas-tech）；仅 `cycles/custom/` = **0** | ❌ **不成立**（需更正口径） |
| 5 | 「computeFlywheelSpeeds 生产调用点 = 0」 | `grep -rn "computeFlywheelSpeeds" src/ tests/ extensions/` | 真实运行期调用 **0**；但 `src/sentinel/types.ts:289` 存在 `import type { computeFlywheelSpeeds as _fwCheck }`（**编译期擦除**，只为通过 grep 型接线门禁）；同类装饰性 import 共 **95** 条 | ✅ 成立，且**比描述更严重**（假接线） |

**更正建议（依 `CTO-固化-II` §三.1/§三.5）**：前提 2 必须带口径；前提 4 应改为「`cycles/custom/` 空（0 个自定义循环），builtin/industry 6 个在库」。

## 二、最关键的新发现：神经断在「读侧身份握手」，不是「数据太少」

派单件把断线描述为「装载/执行不足」。实测显示更根本的一条**机制级断裂**：

```
生产 ingest（POST /api/data/upload → L2 ingestBatch → L4 createNode）
  写入 props = { financialType, <映射的 props>, period?, standardKey? }   ← 无 teamId
哨兵读侧（src/sentinel/sentinel-loader.ts check 包装）
  teamId = ctx.teamId || 'default'
  aggregate → store.queryNodes('Financial', { teamId })
SQL（src/adapters/sqlite-graph-store.ts:202-207）
  AND json_extract(props, '$.teamId') = ?      ← 永不匹配
```

`erp-standard.json` 的 14 条映射里**没有 teamId**；`outcome/financial.json` 的 optionalProps 里**也没有 teamId**（只有 `resource/person.json` 与 `hr-standard.json` 有）⇒ 即使给映射补 teamId，`ingestRow` 也会以「字段不在 Schema 中→跳过」丢弃它。

**结论：任何经生产 ingest 入图的数据，对经 `queryNodes(type,{teamId})` 读数的哨兵永久不可见。** 上传返回 `nodesCreated: 1`，图里确有行，哨兵却只看得到「空库基线」。

### probe-1 原始输出（`probe-output.txt` 第 1-19 行，节选）

```
[A] ingestBatch → {"ok":true,"nodeType":"Financial","nodesCreated":1,...}
[B] queryNodes("Financial") 无过滤 → 1
[C] queryNodes("Financial", {teamId}) → 0
[D] 节点 props keys → ["financialType","total_revenue","gross_margin","operating_expense","period","standardKey"]
    ... margin-health: "无 Financial 节点 — 空库基线"
[E] 哨兵 findings（现状）→ []
[F] 补 teamId 后 queryNodes(...,{teamId}) → 1
[G] finding profit_bench_critical | critical | 利润率严重低于行业基准 | ev=["行业基准: 25%"]
```

## 三、反事实：把神经接上以后，哨兵到底会说什么（probe-2）

用 `data/golden/wani-baby-v1.json`（冻结真实客户数据，哇呢宝贝；`data/golden` 有 checksum）经同一套派生公式入图，`teamId` 补上：

| 哨兵 | 输出 |
|---|---|
| `margin-health` | **2 条**：① `cost_fixed_ratio_warning`（warning，固定成本占比 **72.0%** > 60%，evidence 可核）✅ **真** ② `profit_bench_critical`（critical，利润率 7.0% vs **「行业基准 25%」**）❌ **假** |
| `cash-runway` | **0 条**（273.6 / 15.2 = **18.0 个月** > warning 12 → 真无告警） |
| `revenue-health` | **1 条降级**（`rev_growth_degraded`「无收入数据」）—— compute 内两处读侧 bug 致其**不会说话** |

### 两条必须分清的性质

- **真业务问题（1 条）**：`固定成本占比 72.0%`。来源 = 冻结数据**直接字段** `financial.fixedCostRatio = 0.72`；阈值 `fixed_ratio.warning = 0.6`（**水平阈值**，语义正确）。
- **假 finding（1 条）**：`profit_bench_critical` 的「行业基准 25%」是 `compute-margin-vs-benchmark.ts:35` 的 `input.benchmark ?? 0.25` **编造默认值**——`extensions/sentinels/margin-health/aggregate.ts` 传的是 `{}`。真实基准 8% 在 `golden.externalBaseline.industryAvgProfitMargin` 里，但**无任何入图路径**。按真值 8%，gap = 0.07 − 0.08 = **−1pp**，`-0.01 <= -0.05` 为假 ⇒ **本就不该告警**。

⇒ **验收锚点「1 个哨兵对真实数据说出一个真业务问题」今天差一步**：`margin-health` 已能说出 1 条真问题，但同时会吐出 1 条编造的 critical。**只接 teamId 不修基准，等于把假 finding 一起放出来。**

## 四、跨侧两张卡（CTO 2026-09-27 裁定 A）

| 卡 | 侧 | 内容 | 域 |
|---|---|---|---|
| **D1027（本卡）** | Mac | **哨兵读侧「根身份」硬门禁**：图里该类型节点存在、但按本次 teamId 过滤为 0 ⇒ 判「根身份不匹配」，`log.error` + 显式 finding + `degraded:true`；**禁止再静默 `return []`**。对应 X27「把『缺失』翻译成『通过』」三条修复之一 | `src/sentinel/**` + `tests/sentinel/**` ✅ mac |
| **D10xx（Win 卡，待 CTO 发）** | Win | ① ingest 写框架级 `teamId`（唯一收口点，惠及全部按 teamId 读数的哨兵）② `fixed_cost` 进 `erp-standard` 映射 + `outcome/financial.json` 白名单 ③ `margin-health` 基准**缺失即降级**（禁编造 0.25）；能拿到 `externalBaseline` 时接真值 | `extensions/**` + `src/agent/**` + `src/routes/**`（win 兜底） |

**两卡合起来**才达成验收锚点；**单卡均不达成**——此为本卡交付语义的诚实边界，不得在回执里含混。

## 五、复现（可复制）

```bash
cd /Users/wane/SynovaAgent
NODE_PATH=$PWD/node_modules npx tsx --tsconfig $PWD/tsconfig.json \
  docs/synova/product-lines/evidence/D1027-前提冻结与断裂探针-20260927/probe-1-teamid-handshake.ts
NODE_PATH=$PWD/node_modules npx tsx --tsconfig $PWD/tsconfig.json \
  docs/synova/product-lines/evidence/D1027-前提冻结与断裂探针-20260927/probe-2-what-it-says.ts
```

两探针**只读仓库**（不写任何产品文件），用 `:memory:` SQLite，无副作用。预期输出见 `probe-output.txt`。

## 六、未核实清单（沿 `CTO-固化-II` §三.5）

| 项 | 状态 |
|---|---|
| 「94 个从未执行」的原始口径与测量方法 | **未复现**；未找到定义该口径的文件 |
| M3-1 原始读数源文件 | **未逐字**；本件全部数字为**自测**，不引用 M3-1 |
| `margin-health` 在**完整 12 期**入图后的行为 | **未测**（本件只测单期节点）；`computeProfitMarginChange` 多期语义待核 |
| 其余 44 个哨兵的 teamId 可见性 | **推断**（同一读写契约同构），未逐哨兵实测 |
