# Task Brief: #1403 标准键写入守卫（一处收口 + 两路径共用）

> 卡: **#1403**（K4 · W1-时序 · p1）｜CTO 2026-10-08 裁 (A)（前置复核后）
> 声明载体: `.claude/claims/1403.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
标准键冲突检测只有一条路径走 ⇒ `ingest` 直接 `createNode` **绕过** ⇒ 同事实重复导入产生**重复行**（污染标定）。

### b) 文件审计（实跑，ref=origin/main@f1cf6589d）
- **复现**：`erp-standard` 同事实导入 2 次 ⇒ **rows = 2**，两条**相同 standardKey**（`default:Financial:2026-Q2:2026-04-01`）
- **检测位置**：`src/l4/graph-bridge.ts:79-100` = **monkey-patch `store.createNode`**（D29/D33 分支）
- **绕过点**：`src/agent/data-ingest-service.ts:212` 直接 `store.createNode(...)`
- **架构约束**：`scripts/check-architecture.sh:41-44` ⇒ **L2（agent/orchestrator）不得直接 import L4（l4/）**（硬阻断）
  ⇒ "ingest 直调 graph-bridge"**违法** ✓（CTO 裁定有门禁依据）
- **composition root**：`src/server.ts:331` 注入 `app.locals.graphStore`（**这是唯一该包一次的地方**）

### c) 决策（CTO 裁 (A)）
抽 **纯 store 装饰器** ⇒ `src/adapters/standard-key-guard.ts`；**两路径共用**：L4 委托 + composition root 注入前包一次。
⇒ **ingest 无需改一行**（拿到的 store 已是包装后的）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **"一处收口"**：同 #1374 租户过滤 / #1375 B1 键归一化 / #1393 类型映射 —— **在 store 交给消费者之前包一次**
- **不越层**：L2↛L4（门禁依据）；不用动态 import 绕（那是门禁发现第 13 条的形态）
- **判据**：行为优先；**V2「不同键 ⇒ 2 行」= 不误合**（防"检测过严"）；V5 形态扫描**只证明形态**

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- src/adapters/standard-key-guard.ts — **新建**：共享守卫（从 graph-bridge **逐字平移** standardKey 分支）
- src/l4/graph-bridge.ts — 内联分支 ⇒ 委托共享守卫（**保留** `validateAndLog` + D33 时间字段）
- src/server.ts — **只改"注入前包一次"这一处**（`app.locals.graphStore = wrapStandardKeyGuard(graphStore)`）+ 其 import
- tests/adapters/standard-key-guard.test.ts — **新建**：V1/V2/V3/V5
- .claude/claims/1403.yaml + .claude/task-briefs/2026-10-08-1403-standard-key-guard.md

不做什么（逐条含具体文件名）：
- 不改 src/agent/data-ingest-service.ts（**无需改**：守卫在 store 层已生效）
- 不改 src/store/schema-migration.ts（标准键与迁移无关）
- 不改 extensions/ontology/node-type-mapping.json（读侧字典，与写入守卫无关）
- 不改 scripts/control-tower/check-pr-budget.sh（治理线路径）
- 不改 src/agent/post-diagnosis-processor.ts（其动态 import 绕过 L2→L4 检查 ⇒ **门禁发现第 13 条**，只报不动）

范围外约束（非文件级）：门禁发现第 12/13 条 ⇒ 交门禁治理线。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`POST /api/data/ingest`（store 来自 `app.locals.graphStore` ⇒ 已被守卫包装）。
处理：写前按 `standardKey` 查重 ⇒ 命中则追加 `data_versions` + `has_conflict: true`；未命中则正常创建。
结果：**同事实重复导入 ⇒ 1 行**；不同键 ⇒ 2 行。

## Q4 契约与测试:
- 契约：`wrapStandardKeyGuard(store) => store'`；**不 import L4/L5**；无 `updateNode` 时按能力降级（直通创建）
- 测试：V1（行为：同键 ⇒ 1 行 + has_conflict/data_versions）｜🔴 V2（行为：不同键 ⇒ 2 行）｜V3（键格式）｜V5（形态）
- 反例：M1 绕过守卫 ⇒ V1 红｜M2 直接 createNode ⇒ V1 红｜M3 检测过严（忽略 period）⇒ V2 红
- 零 `as any` / `as never` / `as unknown as`

## 架构层: `src/adapters/**`（纯装饰器）+ L4 委托 + composition root 包一次

## Done 标准
- [ ] verify: npx vitest run tests/adapters/standard-key-guard.test.ts
- [ ] verify: npx vitest run tests/l4/ tests/agent/ tests/contract/
- [ ] verify: bash -c 'grep -c "wrapStandardKeyGuard" src/server.ts src/l4/graph-bridge.ts'
- [ ] verify: npx tsc --noEmit
