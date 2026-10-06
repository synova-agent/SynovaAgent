# 标准：deps 接口与 setter 注入（D925）

> 卡号: D925 | 域: mac（控制塔 / 标准） | 生效: 2026-09-23
> 检查器: `scripts/control-tower/check-deps-injection.sh` | 夹具: `tests/control-tower/check-deps-injection.test.sh`
> 存量清单: `scripts/control-tower/deps-injection-baseline.txt`（ratchet，每行带理由）
> 豁免清单: `scripts/control-tower/deps-injection-exempt.txt`（每行带理由，无理由不生效）

---

## 1. 问题

编排入口模块（`*Handler` / `*Runner` / `*Coordinator` / `*Dispatcher`）在**调用点**直接向
**生产活单例**取协作者（`getFeedbackCollector()` 等），导致：

1. **不可测替换**：测试无法把协作者换成假件，只能启动真实单例（或改环境靠全局状态）。
2. **耦合点隐式扩散**：依赖关系不体现在签名/接口上，读代码看不出这个入口依赖什么。
3. **降级不可控**：单例不可用时无统一缝可插桩，只能各自 `try/catch`。

标准做法：**经 deps 接口 + setter 注入**取依赖；生产默认在模块内**惰性构造**，显式覆盖走注入缝。

---

## 2. 适用范围（**声明式** —— 与检查器常量同源，不是脚本里的静默过滤器）

| 维度 | 取值 |
|------|------|
| 目录 | `src/**`（`packages/**` **未纳入**，见 §6 失效条件 F2） |
| 扩展名 | `.ts` / `.tsx` |
| 排除面 | 测试面：路径含 `tests/` 或 `test/`，或文件名匹配 `*.test.ts(x)` / `*.integration.test.ts` / `*.e2e.test.ts` |
| 判定单位 | **文件**（已知边界，见 §6 F1） |
| 触发条件 | ① 含生产单例 getter 调用（闭集见 §3）**且** ② 导出**编排入口函数**（命名清单见下）**且** ③ **未导出**任何 `setXxxDeps` 注入缝 |

**编排入口函数命名清单**（具名常量 `ENTRY_FN_RE`，检查器内为**单一常量**，非内联散落）：

```
export (async )?function [A-Za-z_]*(Handler|Runner|Coordinator|Dispatcher)\(
```
> 命中数（命令 + 口径）：`git grep -lE 'export (async )?function [A-Za-z_]*(Handler|Runner|Coordinator|Dispatcher)\(' -- src`
> → **3 文件**（截至 2026-09-23 实测）：`src/agent/loop-handlers.ts`、`src/l3/expert-dispatcher.ts`、`src/sentinel/runner.ts`

**经该命名清单窄化是刻意的**：若不加此条件（变体 A 宽口径），
`git grep -lE '(getFeedbackCollector|…)(' -- src` 的 **18 文件**中会把 `src/routes/backup.ts`、
`src/tui-v2/chat.tsx`、`src/deploy/bootstrap.ts`、`src/cron/scheduler.ts` 等**基础设施消费者**一并算违规
（17 条 baseline 会稀释 ratchet，且与"编排入口注入范式"的语义不符）。队长 2026-09-23 核准取**窄口径**。

---

## 3. 生产单例 getter 闭集（具名常量 `SINGLETON_GETTERS_RE`）

| getter | `src/` 命中文件数（命令：`git grep -l "<getter>(" -- src \| wc -l`，截至 2026-09-23） |
|--------|------|
| `getFeedbackCollector(` | 4 |
| `getExpertRegistry(` | 8 |
| `getGlobalScheduler(` | 7 |
| `getRegistry(` | 1 |
| `getScheduler(` | 3 |

**为何排除 `getDatabase(` / `getDb(`（实测口径，非估计）**：

- **纳入后全仓新增命中 = `0`**：把 `getDatabase` 并入闭集后，空 baseline 下全仓 `HIT` **仍为 2**，与正规判据完全相同；
  再把真实 `src/agent/loop-handlers.ts` 复制进沙箱单独跑：正规判据 `hits=0`、含 `getDatabase` 的变异体同样 `hits=0`
  （该文件导出 **5 条** `setXxxDeps` ⇒ R1 条件③不成立，**天然免疫**）。**故排除的理由不是"噪声"。**
- **真实理由是语义范围**：本标准的对象是 **5 个编排单例**（collector / registry / scheduler）的**活单例耦合**；
  而 DB 访问在本仓有既成的**合规写法** ——
  `src/agent/loop-handlers.ts:471` 的
  `const getDb = deps?.getDatabase ?? (await import('../init/engine-context')).getDatabase;`
  （惰性生产默认 fallback），属**另一关注点，不在本标准的适用面内**。
- 原始面参考（**口径 = "含该调用的文件数"，不是噪声量、也不是命中量**）：
  `git grep -l 'getDatabase(' -- src | wc -l` → **34 文件**。

> **修订留痕**（2026-09-23，独立自验 verify-d922 指出）：本条初版把上述 34 文件面写成"纳入即 34 处噪声"，
> 属**未实测的推断**；实测反证新增命中为 0。**排除结论不变，理由已按实测口径重写。**

---

## 4. 标准形态

```ts
// ① deps 接口：本入口需要的协作者
export type DemoDeps = { getStore(): Store };

// ② 模块内持有可覆盖引用 + 惰性生产默认
let _deps: DemoDeps | null = null;
async function prodStore(): Promise<Store> { return new SqliteStore(getDatabase()); }

// ③ 注入缝：签名固定为 (deps: <Type> | null): void，传 null 恢复生产默认
export function setDemoDeps(deps: DemoDeps | null): void { _deps = deps; }

// ④ 调用点只经缝取值
export async function defaultDemoHandler(): Promise<Result> {
  const store = _deps?.getStore() ?? (await prodStore());
  …
}
```

**已达标样板（5 组，实测）** —— `src/agent/loop-handlers.ts`：

| 行 | 注入缝 |
|----|--------|
| `:105` | `setDiagnosisDeps(deps: DiagnosisDeps \| null): void` |
| `:294` | `setNavigationDeps(deps: NavigationDeps \| null): void` |
| `:444` | `setSelfCheckDeps(deps: SelfCheckDeps \| null): void` |
| `:560` | `setKnowledgeDeps(deps: KnowledgeDeps \| null): void` |
| `:617` | `setOverflowDeps(deps: OverflowDeps \| null): void` |

> 命令：`grep -nE 'set[A-Za-z]+Deps' src/agent/loop-handlers.ts` → **5 组**（截至 2026-09-23）。
> **文档一律写「5 组」**（CTO 裁定 5：以实测为准，非早期清单所写的 6）。

### 反例样板（**登记为后续卡，本卡不改 `src/**`**）

```ts
// src/agent/loop-handlers.ts:374
export async function defaultEvolutionHandler(scale: ScaleName): Promise<LoopExecutionResult> {
  …
  const signals = getFeedbackCollector().getAggregatedSignals();   // :377 直连活单例，无注入缝
```

**为何是反例**：它是编排入口（`*Handler`），在调用点直接向活单例取值，测试无法替换 `FeedbackCollector`。
**为何本卡不修**：CTO 裁定 5 —— 登记为后续卡，**不许扩本卡写集**（本卡 `src/**` 零改动）。
**为何检查器当前不报它**：该文件已导出 5 条注入缝，R1 的③条件（未导出注入缝）不成立 ⇒ 文件级判定放行（见 §6 F1）。

---

## 5. 降级只允许显式（CTO 裁定 5）

**仅两条缝**：

| 缝 | 载体 | 硬约束 |
|----|------|--------|
| ① 测试注入缝 | `setXxxDeps(deps \| null)` | 传 `null` 恢复生产默认；签名固定 |
| ② 显式豁免文件 | `scripts/control-tower/deps-injection-exempt.txt` | 每行 `<路径> — <理由>`；**无理由不生效**；**文件缺失/格式坏 → 0 条豁免**（绝不"全豁免"） |

**禁止**：静默 bypass；环境变量一键全豁免；在检查器里加 `SYNO_DEPS_SKIP_ALL` 之类开关。

### 退出码三态（契约，铁律 47）

```
@exit 0 = 通过；report 模式（默认）**恒 0** —— 命中只打 ::warning（可见），不阻断
@exit 1 = --strict 且存在新增违规（∉baseline 且 ∉exempt）
@exit 2 = 检查执行失败/降级（fail-closed，**绝不等同通过**）
```

### 两种运行模式

| 模式 | 命令 | 语义 |
|------|------|------|
| **diff**（对新增生效） | `--base <ref> --head <ref>` | 只判 `--diff-filter=AM` 的 `src/**` 新增/改动文件（**只对新模块生效**） |
| **full**（盘点/报告） | `--dir <路径>` | 全扫 `src/**` + baseline 盘点 |

---

## 6. 失效条件（本规则何时可撤 / 必须改）

| # | 条件 | 动作 |
|---|------|------|
| **F1** | **R1 是文件级判定** ⇒ 抓不到"**有注入缝文件内部**的直连"（典型：§4 反例样板 `defaultEvolutionHandler`）。 | 已知边界，**不在夹具里断言其存在**（不把缺陷固化成契约）。**触发收紧**：出现第一例"有缝文件内部新增直连且逃过评审"的实际漏拦时 → 收紧为**函数级**（需 TS AST，走 `tsx` 脚本而非 .sh），并补函数级夹具。 |
| **F2** | **`packages/**` 未纳入**（monorepo 包目录）。 | **不是遗漏**，是显式范围决定（当前 `packages/engine-core` 为历史遗产，见铁律 46 清理路线）。触发纳入：`packages/**` 出现编排入口且开始接收产品依赖注入 → 扩 §2 目录范围并补 baseline。 |
| **F3** | **闭集排除 `getDatabase`/`getDb`**。 | 若日后要求 DB 访问也走注入 → 扩 `SINGLETON_GETTERS_RE` 并补 baseline（届时 34 文件面必须一次性登记，禁止"只加不记"）。 |
| **F4** | **入口函数命名清单**可能漏掉新命名（如 `*Orchestrator`、`*Pipeline`）。 | 出现第一例"新命名的编排入口直连活单例" → 扩 `ENTRY_FN_RE` 并补夹具用例。 |
| **F5** | **何时从 report 翻转为拦（--strict 进 CI）** | 门槛：**baseline 缩短至 0**（2 个存量补缝完成）**且** 连续 N 个 PR（建议 N≥5）在 report 模式下**零新增命中**。翻转须随一次显式记录的行为变更卡（含 K3 复审）落地，并同步更新本表。 |
| **F6** | **何时放宽为变体 A（宽口径，不限入口命名）** | 若"编排入口"这一概念在代码库中被新模式取代（如统一 `defineEntry()`），窄化条件失去语义 → 放宽为 A 或改用新概念的等价判据。 |
| **F7** | 本规则整体 | 若依赖注入框架（如 tsyringe / NestJS DI）被正式引入，setter 注入成为次要范式 → 本规范按控制塔流程归档（`archived`），检查器与 CI 登记**同步移除，不得只删其一**。 |

---

## 7. 边界值清单

| 参数/集合 | 空 | 单元素 | 恰临界 | 超限/异常 |
|-----------|----|--------|--------|-----------|
| 扫描文件集 | 0 文件 → 输出 `files=0`，exit 0（report）/ 0（strict，无违规） | 1 文件正常判定 | 入口命名恰为 `*Handler` → 命中 | 目录不存在/无 `src/` → **exit 2** |
| `baseline` | 空文件 → 0 条存量（全部命中都报） | 1 条带理由 → 吸收该文件 | 路径精确匹配（`-Fx` 全行） | **显式指定但不存在 → exit 2**；缺理由 → 该行不生效 |
| `exempt` | 空文件 → 0 条豁免 | 1 条带理由 → 吸收 | 同上 | **文件缺失 → 0 条豁免**（绝不"全豁免"）；缺理由 → 不生效 |
| `--strict` | 未给 → report（恒 exit 0） | — | 命中数 0 → exit 0；命中数 ≥1 → exit 1 | — |
| 扫描器 | `SYNO_DEPS_GREP` 指向不存在 → **exit 2** | — | 存在但试运行失败（损坏 shim）→ exit 2 | — |
| `--base`/`--head` | 任一缺失 → exit 2 | — | 相同 ref → 空变更集 → exit 0 | ref 无法解析 → exit 2 |

---

## 8. 归属与维护

- 标准 / 检查器 / 夹具 / 清单：控制塔域。
- **本卡不触任何产品代码**（`src/**` 零改动）；§4 反例样板的改造属**后续卡**（CTO 裁定 5）。
- **自验不得由编码兼任**；本卡交付结论只到"可提请独立审计"，通过与否归 CTO 收件闸 + K3 终审。
- 修改本规范 = 治理产物 → 走 PR；**改标准者不得自判通过**。
