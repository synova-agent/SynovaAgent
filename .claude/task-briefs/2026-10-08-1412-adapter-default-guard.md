# Task Brief: #1412 守卫收口补全 —— 适配器默认带守卫（(C) 案）

> 卡: **#1412**（K4 · W1-时序 · p1）｜CTO 2026-10-08 裁 **(C)**（前置复核后）
> 声明载体: `.claude/claims/1412.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
#1403 已把"标准键写入守卫"抽成共享模块并在一处收口；本卡解决**收口不完整**（其它构造点绕过）。

### b) 文件审计（实跑，ref=origin/main@6be291cd2）
- 🔴 **卡面前提更正**：`src/init/engine-context.ts` **只建 `db`**（`:50,66`）**不构造 store** ⇒ **不是收口点**（CTO 原裁定被实测推翻）
- **真面 = 所有 `new SqliteGraphStore(` 构造点**：**13 处 / 11 文件**（bootstrap 2｜graph-store-service｜loop-handlers｜synova-agent｜conversation-engine｜sentinel-service｜tool-registration｜sentinel/runner｜l3/knowledge-agent｜ingest/index｜routes/chat）
- `src/ingest/index.ts` **可达**（`src/tui-v2/lib/commands.ts:151` 动态 import `ingestFile`）⇒ **真实绕过通道**（非死代码）
- **影响面核**：生产侧仅 `data-ingest-service.ts:219` 写 `standardKey`（**无裸语义依赖**）；测试侧 **2 个**依赖裸语义 ⇒ 显式 opt-out

### c) 决策
**把守卫放进适配器**：**默认开** + 显式 opt-out ⇒ **不枚举构造点**（新增构造点自动覆盖）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **"不手写清单"的极致形态 = 改默认行为**（清单会漂；默认不会）
- **显式优于隐式**：opt-out 必须显式（且可 grep ⇒ 可审计"谁关了守卫"）
- 🔴 精度纪律第 4 次应用：V4-new 首版被**我自己的注释**里的字面串击穿 ⇒ 已改（注释改写 + 判据排除注释行）

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- src/adapters/sqlite-graph-store.ts — 默认守卫（复用 `wrapStandardKeyGuard`）+ `SqliteGraphStoreOptions.standardKeyGuard`（默认 true）+ 原实现抽为 `_insertNodeRaw`
- tests/adapters/standard-key-guard.test.ts — 裸语义对照改显式 opt-out；新增 V1/V2/V3/**V4-new**
- tests/agent/write-side-axis-alignment.test.ts — 2 处显式 opt-out（该用例需记录"不经守卫"的行为）
- .claude/claims/1412.yaml + .claude/task-briefs/2026-10-08-1412-adapter-default-guard.md

不做什么（逐条含具体文件名）：
- 不改 src/init/engine-context.ts（**它不构造 store** ⇒ 非收口点，实测）
- 不改 src/agent/graph-store-service.ts（L1 访问器；默认守卫已在**适配器**层生效 ⇒ 无需改）
- 不改 src/deploy/bootstrap.ts（其 2 处构造点被"默认行为"自动覆盖 ⇒ **不枚举**）
- 不改 src/agent/loop-handlers.ts（同上）
- 不改 src/mcp/tool-registration.ts（同上）
- 不改 src/sentinel/runner.ts（同上）
- 不改 extensions/ontology/**（与写入守卫无关）

范围外约束（非文件级）：若发现**生产路径依赖裸语义** ⇒ 退回 (B)（单工厂 + 枚举改造）—— 实测**未发现**。

## Q3: 验收 — 入口 → 交互 → 结果
入口：任意 `new SqliteGraphStore(db)`（**不传选项**）。
处理：`createNode` 见 `props.standardKey` ⇒ 先查后写（追加 `data_versions` + `has_conflict`）。
结果：同键 2 次 ⇒ **1 行**；显式 opt-out ⇒ 2 行（测试可控）；不同键 ⇒ 2 行。

## Q4 契约与测试:
- 契约：`SqliteGraphStoreOptions.standardKeyGuard?: boolean`（**默认 true**；`false` 仅测试用）
- 测试：V1 默认覆盖（**不枚举构造点**）｜V2 opt-out ⇒ 裸语义｜V3 不同键 ⇒ 2 行｜V4-new **生产路径零 opt-out**（排除注释行）
- 反例：M1 默认守卫失效 ⇒ **V1 红**｜M2 opt-out 失效 ⇒ **V2 红**（均已实测）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: adapters（L4 侧适配器）+ 其判据

## Done 标准
- [ ] verify: npx vitest run tests/adapters/standard-key-guard.test.ts tests/agent/write-side-axis-alignment.test.ts
- [ ] verify: npx vitest run tests/adapters/ tests/l4/ tests/agent/ tests/sentinel/ tests/sentinels/ tests/contract/
- [ ] verify: bash -c 'grep -rn "standardKeyGuard: false" src/ --include="*.ts" | wc -l'
- [ ] verify: npx tsc --noEmit
