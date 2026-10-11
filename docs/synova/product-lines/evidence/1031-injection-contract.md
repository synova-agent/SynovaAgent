# #1031 注入契约 · 参数从类型层到实例层的桥（**先定契约，后写码**）

- 卡：ISSUE #1031（W2 前置 · ontology-loader 只取 3 字段 ⇒ `transfer_function` 进不了 `edge.props`）
- 执行人：`@k4-coder-f`｜队长：lead｜裁定：**CTO 乙案**（判据②改落点 + 写集剔除 `src/loops/direction-monitor.ts`）
- 基准：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`
- 唯一写点：`.synova-wt-1031`｜本契约**不写代码**，只冻结接口与降级语义
- 依据（**全部本机实测**，命令与原始输出见 `read-card-confirm.md` §5）：类型层真实形态 55/55 逐件统计

---

## 0. 问题陈述（一句话）

`src/l4/ontology-loader.ts` 读全 55 个边类型 JSON，但**只取 `label` / `allowedFrom` / `allowedTo` 三个字段**
（实测 `:101-106`），`transfer_function` / `causal_strength` / `action_effect_lag` **到不了边实例的 `props`** ——
声明层与实例层之间**没有桥**。本契约定义这座桥的**读取面**与**注入面**。

---

## 1. 类型层真实形态（**实测冻结，非文档转述**）

命令：`python3 analyze.py extensions/ontology/edge-types`（全 55 件逐件 JSON 解析）

| 字段 | 归属位置 | 55 件实测分布 | 备注 |
|---|---|---|---|
| `transfer_function` | **顶层**（55/55） | 占位串 `"TBD — to be defined in compute phase"` × **52**；散文公式 × **3**（`brand_builds` / `couples` / `cumulative_learning`） | 卡面「42/45」为旧 as_of，**已漂移** |
| `causal_strength` | **`optionalProps` 内**（55/55） | 描述串 `"number (0-1) — 因果强度（0=无因果传导，1=完全传导）"` × **55**（完全相同） | ⇒ **类型层无任何数值**（#1430 只补了声明，没补值） |
| `action_effect_lag` | **顶层**（55/55） | `"unknown"` × 50、`"3-6_months"` × 2、`"immediate"` × 1、`"1_month"` × 1、`"1-3_months"` × 1 | 值域收口属 **#1134**，本卡不裁定 |

🔴 **三个字段的归属位置不同** ⇒ 桥必须**分别取源**（`transfer_function`/`action_effect_lag` 读顶层，`causal_strength` 读 `optionalProps`），
不可用一条「顶层取值」的通用逻辑糊过去。

---

## 2. 卡面 §步骤1 四问 —— 逐条回答

### a) 注入点在哪？

**取卡面给的第 3 个选项：读取时按 label 查类型层（option c）。**

| 选项 | 为何不选 |
|---|---|
| loadOntology 后统一注入 | 注入目标（边实例）在 `loadOntology` 时不存在的；且会把 55 条边类型的参数常驻内存，与「按需」语义相悖 |
| 边实例创建时注入 | 落点在 `createEdge`（`src/adapters/sqlite-graph-store.ts`）⇒ **在飞 PR #1424 占用，越界** |
| **✅ 读取时按 label 查类型层** | **唯一不越界的落点**：全部实现在 `src/l4/ontology-loader.ts` 内；对既有 3 字段消费者零影响；对边实例是**纯附加**（不存在的键不写） |

**落点必须同时满足乙案的两条硬约束**：① 在写集内 ② 不依赖未合入 main 的 D1143 产物。

### b) 谁注入？

**`src/l4/ontology-loader.ts` 自己**（桥 = loader 的读取面 + 一个纯注入函数），**不是** `EdgeStoreReader` 的实现、**不是** graph-store 建边时。

- 卡面事实：`EdgeStoreReader` 的**唯一实现就是 `direction-monitor.ts` 自身** ⇒ 让「读方」去「给」自己是循环依赖，不可取。
- 乙案剔除该文件 ⇒ 「读取方负责注入」这条路**已被 CTO 关闭**。

### c) 注入的形状

**同形透传（identity），不做任何包装 / 改名 / 单位换算。**

| 类型层形态 | 实例层 `props.<键>` 形态 | 说明 |
|---|---|---|
| `number` | `number` | 已标定的常量参数 |
| `{ "param": <number> }` | `{ param: <number> }` | 形参占位（标定回环写回数值） |
| `{ "ref": <string> }` | `{ ref: <string> }` | 指向 compute 函数的引用 |
| 非空字符串（**仅** `action_effect_lag`） | 同串 | 时滞枚举，值域收口属 #1134 |

**判据等级：`transfer_function` / `causal_strength` 的合法值域 = 「数字 / `{param:number}` / `{ref:string}`」**
（下称 **P-3 值域**）—— 若值不是这三者，定义为**不可注入**（见 d）。

> ⚠️ **出处声明（不自冒权威）**：派单件引证的 `docs/synova/coordination/CTO-固化-II-研究院权威结论-20260924.md:93` **G-3**
> 经实测**文件不存在**（该目录下同名家族只有 `CTO-固化-最终方向与在制任务-20260924.md`）。
> 该近邻件**实测 91 行 / 67 非空行**（`wc -l` = 91；`grep -cve '^[[:space:]]*$'` = 67）⇒ `:93` **物理不可能存在**；
> 且该近邻件**命中 1 处** —— `:5` 把那份不存在的件列为「**配套件（必读）**」（即近邻件自己在引用一个不存在的文件）；
> 其正文对 `transfer_function` / `G-3` / `占位` 三模式 **0 命中**。
>
> 📌 **更正留痕（L1，2026-10-09）**：本节初版写作「全文 **67** 行，**零**命中」——**两处均不实**，由**独立自验员实测更正**。
> 错因：① 我用 PowerShell `Measure-Object -Line` 并把它当「总行数」读，该 cmdlet 实测只计**非空行**
> （同一文件：`Measure-Object -Line` = 67，`wc -l` = 91）；② 我把「三模式 grep 的 0」压缩成无限定的「零命中」，抹掉了限定语。
> **结论（引证路径不存在）不变**，但支持性事实必须独立成立 —— **结论对 ≠ 证据可错**。
>
> ⇒ 本契约的 P-3 值域**署名为「本卡提出 + 待治理线/K3 确认」**，**不冒用 G-3 出处**。语义参照 `docs/synova/GLOSSARY.md:32-33`（`transfer_function` 是"因果边的参数化定量函数"，硬度 = `edge.transfer_function.params.hardness`）。

### d) 缺失 / 占位时的行为

**六态穷举，非「resolved」一律不写入 `props` + `degraded:true` + 显式 log（禁静默）。**

| 状态 | 触发条件（对 P-3 值域字段） | 写 props？ | degraded | log |
|---|---|---|---|---|
| `resolved` | 值是 `number` / `{param:number}` / `{ref:string}`；或 `action_effect_lag` 是非空字符串 | ✅ 写 | ❌ | 无告警（正常态不打 log —— 55 件全量读取时不制造噪声） |
| `placeholder` | 字符串命中占位族（`tbd` / `to be defined` / `todo` / `pending` / `n/a`，大小写与空白归一） | ❌ | ✅ | `warn` |
| `declaration_only` | 字符串描述的是**类型/值域**而非值（以 `number`/`string`/`boolean`/`integer`/`object`/`array` 开头）—— 实测 55/55 的 `causal_strength` 即此态 | ❌ | ✅ | `warn` |
| `prose_formula` | 其余字符串（散文公式，实测 3 条） | ❌ | ✅ | `warn` |
| `absent` | 键不存在 | ❌ | ✅ | `warn` |
| `malformed` | 出现但既非 P-3 值域、又非上述字符串类（如 `null` / 数组 / `{}` / 缺 `param`/`ref` 的对象 / 空串） | ❌ | ✅ | `warn` |

**关键的「不动 D1143」约束**：占位 / 无值时 **不伪造值、不写 `null`、不写结构化空对象**
⇒ 键**保持不存在** ⇒ D1143 既有的 `edge.props ? edge.props["transfer_function"] : undefined` **行为不变**（仍走它自己的降级）。
即：本桥**只增不减、只写真值**。

> **「结构化的空」落在哪**：不落在 `props`，落在**读取面的返回值**（`status` + `declaredAs` + `reason`）。
> 这样「落点形状」有了（标定与审计可读到"这里有个槽、它声明是 number(0-1)、当前不可注入"），
> 但**没有**用假值污染实例层。契约件在此显式记录该取舍。

---

## 3. 接口契约（铁律 47：@input / @output / @degrade 先冻结）

```ts
/** P-3 值域（本卡提出；出处待治理线确认） */
export type ParamValue = number | { param: number } | { ref: string };

export const EDGE_PARAM_KEYS = ['transfer_function', 'causal_strength', 'action_effect_lag'] as const;
export type EdgeParamKey = typeof EDGE_PARAM_KEYS[number];

export type EdgeParamStatus =
  | 'resolved' | 'placeholder' | 'declaration_only'
  | 'prose_formula' | 'absent' | 'malformed';

export interface EdgeParamResolution {
  key: EdgeParamKey;
  status: EdgeParamStatus;
  injectable: boolean;        // 仅 status==='resolved' 时为 true
  value?: ParamValue | string;// 仅 injectable 时存在 —— 进 props 的值（同形透传）
  raw?: unknown;              // 类型层原值，原样保留（永不丢失）
  declaredAs?: string;        // 声明串 / 占位串 / 散文原文（供标定与诊断）
  reason: string;             // 人可读判定理由（审计用）
}

export interface EdgeTypeParams {
  label: string;
  params: EdgeParamResolution[];      // 恒 3 条，顺序 = EDGE_PARAM_KEYS
  props: Record<string, unknown>;     // 仅 resolved 的键值对 —— 可直接并入 edge.props
  degraded: boolean;                  // = issues.length > 0
  issues: string[];                   // 未解析项逐条点名
}

/**
 * @input  def — 单个边类型定义（来自 edge-types JSON，或测试构造的 mock）
 * @output 上述 EdgeTypeParams；纯函数，无 IO、无时钟、无随机
 * @degrade 任一字段非 resolved ⇒ degraded:true + issues[] + 一条聚合 log.warn（不静默）
 */
export function readEdgeTypeParams(def: EdgeTypeDef): EdgeTypeParams;

/**
 * @input  label — 边类型 label（如 'CONSTRAINS'）
 * @output 同一 label 的 EdgeTypeParams；label 不存在 ⇒ null
 * @degrade 同 readEdgeTypeParams；结果按 label 记忆化，clearOntologyCache() 一并失效
 */
export function getEdgeTypeParams(label: string): EdgeTypeParams | null;

/**
 * @input  props — 既有边实例 props；def — 边类型定义
 * @output { props: 新对象（不改入参）, injected: string[], degraded, issues }
 * @degrade 同 readEdgeTypeParams；未解析字段**不写入**（键保持不存在）
 */
export function applyEdgeTypeParams(
  props: Record<string, unknown>,
  def: EdgeTypeDef,
): { props: Record<string, unknown>; injected: string[]; degraded: boolean; issues: string[] };
```

### 3.1 六条不变式（自验可逐条判）

1. **纯函数**：`readEdgeTypeParams` / `applyEdgeTypeParams` 不读全局、不取时钟、不用随机。
2. **不改入参**：`applyEdgeTypeParams` 返回新对象，入参 `props` 引用与内容均不变。
3. **只写真值**：未解析字段**不产生键**（`'key' in props === false`）。
4. **同形透传**：写入值 `===` 类型层原值（对象为深相等，不做包装/换算）。
5. **恒 3 条**：`params.length === 3`，顺序固定，缺字段也报 `absent`（不漏项）。
6. **零影响既有面**：`loadOntology()` 返回结构不变；`getTypesByTags` / `validateEdgeEndpoints` 行为不变。

---

## 4. 判据映射（乙案改后口径 ↔ 本契约）

| 判据 | 落在契约哪一条 |
|---|---|
| **V1** 注入存在且可判 | §3.1-4 同形透传 + §2c 形状表；mock 定义取值 → 实例 `props.transfer_function` **断言值相等** |
| **V2** 注入前 vs 注入后值必须不同且正确，差值只来自参数 | §3.1-1 纯函数（无时钟/无顺序 ⇒ 无噪声）+ §3.1-2 不改入参 + §3.1-3 其余键原样 |
| **V3** 降级可见且有 log | §2d 六态表（`warn` 非静默）+ §3 `degraded` / `issues` 字段 |
| **V4** 改坏即红 | §3.1-5 恒 3 条 + 同形断言：拆掉注入 ⇒ V1/V2 必红 |
| **V5** L1≠L2 | 判据在**真跑**（`import` 后执行）而非 grep；log 断言用 `vi.mock('@synova/logger')` 运行时捕获 |

### 4.1 🔴 乙案对判据②的覆盖力降档（**显式记录，不许当成原判据②已满足**）

- 原判据②要求「参数改变 → **DirectionMonitor 输出改变**」；乙案改为「参数改变 → **`props` 落点改变**」。
- **降档**：本卡覆盖「参数**落到哪**」，**不覆盖**「参数**改变下游计算**」。下游输出的改变需第三卡
  （DirectionMonitor 接入调度；卡面自述"真正的用户可见效果需第三卡"）。
- **降档根因（实测）**：`src/loops/direction-monitor.ts` 在 main **仅 291 行**，卡面 `:546` 物理不存在；
  `feat/D1143-param-consumer-w2`（PR #1029）**未合入 main**。⇒ 原判据②在 main 上**不可执行**。
- ⇒ 本卡交付件**不得**宣称"参数能改变下游输出"。

---

## 5. 未决项（**本卡不做，转治理线**）

| # | 未决项 | 为什么不本卡做 |
|---|---|---|
| U-1 | **schema 门禁**（P-3 值域断言 + 存量占位串计数 + 新增占位串阻断） | 卡面自述「若动 `scripts/**` 的 schema 门禁 ⇒ 拆给治理线」；且禁改 `scripts/**` |
| U-2 | 🔴 **与既有门禁语义互斥**（新发现） | `scripts/control-tower/check-ontology-fields.sh:80` **硬要求 `transfer_function` 是「非空字符串」**（`:33` 冻结字段集）。⇒ 一旦按 P-3 标定成 `number`，**既有门禁立刻 exit 1**；且 G-3 的「新增占位串阻断」按脚本 `:16` 自述「新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO」。**二者必须一并改，不是单纯"搬走一条断言"** |
| U-3 | **真值标定**（把 52 条占位串换成数字/`{param}`/`{ref}`） | 卡面明示属①，**另卡** |
| U-4 | **散文公式 3 条**（`brand_builds`/`couples`/`cumulative_learning`）的规范化 | 是否包成 `{ref:<公式原文>}` 属**语义发明**，本卡不擅作主张 |
| U-5 | **G-3 引证不可核** | 派单件引证文件不存在（见 §2c 出处声明）；请 CTO 复核该引证的权威文本出处 |
| U-6 | `action_effect_lag` 值域收口 | 属 **#1134**；本卡只做原样透传 |
| U-7 | `causal_strength` **真值** | 55/55 仅描述串（§1）⇒ 本卡只能让「声明」可读，**值**须待 U-3 |

---

## 6. 自检 5 问（契约阶段回答）

1. **接线检查**：新 export（`readEdgeTypeParams` / `getEdgeTypeParams` / `applyEdgeTypeParams`）在 main **无生产调用方** —— **这是卡面明示的预期状态**（卡面原话：「本卡【不要求】本卡内出现生产可见效果」）。调用方 = 本卡测试 + **第三卡**（DirectionMonitor 接入调度）。
2. **异常处理**：无 `catch` 新增；降级走返回值（`degraded`/`issues`）+ `log.warn`，非静默。
3. **类型安全**：`as any` = 0；`EdgeTypeDef` 新字段用 `unknown` 而非 `any`，运行时做类型守卫。
4. **测试质量**：见判据映射；覆盖 正常 / 降级 / 边界 三路径，全部 `expect()` 断言。
5. **残留清理**：不删既有代码；`clearOntologyCache()` 新增记忆化清理（同一函数内）。

---

**签署：执行人@k4-coder-f｜契约冻结，进入步骤 2（实现）**
