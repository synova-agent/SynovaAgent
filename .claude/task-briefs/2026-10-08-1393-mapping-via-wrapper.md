# Task Brief: #1393（映射经收口点覆盖 extensions 哨兵）

> 卡: **#1393**（K3 · W1-时序 · p1）｜CTO 2026-10-08 放行（§六(A) + (c) + ⑧ + ⑨）
> 声明载体: `.claude/claims/1393.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
把"类型映射"接进**既有收口点**（`withOrgScope`），使 **46 个 extensions 哨兵**也走映射（此前走映射者 = 0）。
⇒ 三件事共用一个包装点：① 租户过滤（#1374）② 键归一化（#1375 B1）③ **类型映射（本卡）**。

### b) 文件审计（实跑，ref=origin/main@aaee6b53c）
- 收口点：`src/sentinel/org-scope.ts`（`withOrgScope`，`Object.create` + 遮蔽 `queryNodes`）
- 唯一交接点：`src/sentinel/sentinel-loader.ts`（把 store 交给 aggregate）⇒ 一处改动覆盖 46 个哨兵
- 解析源：`src/sentinel/node-type-resolver.ts`（本卡新增 `resolveReadTargets`）+ `mapped-read.ts`（**私有实现已删**）
- 🔴 遍历路径也走 `store.queryNodes`（`graph-traversal.ts:148`）⇒ §六(A) 下**自动一并映射**（无需额外改动）

### c) 决策
(c) 落地：有映射 ⇒ **并集读（字面量 ∪ 映射目标）**；映射 = null ⇒ **保留字面量 + warn**（读空归 #1379 V3）。
⑧ 去重：**按 `id` 去重（防御性）** + 判据断言"结果 id 不重复"。
⑨ 不变量：`warn === true ⟺ targets 为空`（写入 `resolveReadTargets` 契约 JSDoc）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 否掉"为避免 export 而本地重写解析"：**不导出不是收敛，只有一份解析逻辑才是收敛**
- ⑧/⑨ 两条追问：**让"不会重复/不会丢警告"变成可验证/可读的**
- 覆盖面须写"**并集读只为**不丢语义**（不代表字面量读可退役）**"（防误读）

## Q2: 范围 — 正确的最简方案
做什么：
- src/sentinel/node-type-resolver.ts — 新增 `resolveReadTargets`（唯一解析源；含 ⑨ 不变量契约）
- src/sentinel/mapped-read.ts — 删私有解析 ⇒ import（杜绝两份）
- src/sentinel/org-scope.ts — 收口点插入类型映射（(c) + 并集含字面量 + 按 id 去重；**映射与租户解耦**）
- tests/sentinel/mapping-via-wrapper.test.ts — 新建（V1/V2a/V2b/V3 + M2 行为锚点）
- tests/sentinel/org-scope.test.ts — **必要连带**（并集读 ⇒ 调用数不再为 1；区分"有映射/无映射"）
- tests/sentinel/tenant-filter-keys.test.ts — **必要连带**（V-d1 改为"每次调用都归一化"）
- .claude/claims/1393.yaml + 本 brief

不做什么（逐条含具体文件名）：
- 不改 src/sentinel/sentinel-loader.ts（唯一交接点不变）
- 不改 src/l4/graph-traversal.ts（遍历实现不变；映射经包装 store 生效）
- 不改 extensions/ontology/node-type-mapping.json（映射真源不变）
- 不改 src/store/migrations/002-metric-readings.ts（表定义）
- 不改 extensions/sentinels/_extinct/**（归档）

范围外约束（非文件级）：补本体轴写入者（resource/tool、resource/client）⇒ (iii)，待本卡结论定范围；不引入缓存（避免状态）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册哨兵经 `check(context)`（store 已被收口点包装）。
处理：`queryNodes(type, …)` ⇒ 类型映射（并集含字面量）+ 租户过滤 + 键归一化。
结果：extensions 哨兵可读到**本体轴节点**（真 csv-import 写 `resource/money` ⇒ 读 `Financial` 能读到）。

## Q4 契约与测试:
- 契约：`resolveReadTargets` 的 `@invariant warn === true ⟺ targets 为空`（⑨）
- 测试：V1 结构 / V2a 真路径端到端（含去重断言 + 租户维度独立）/ V2b 哨兵级 / V3 null 分支
- 反例（实测）：M1 只改映射表不加包装 ⇒ 2 红｜M2 替换读 ⇒ **2 红**（结构 + **行为锚点：字面量数据丢失**）｜M3 null 静默 ⇒ 1 红
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
L3 哨兵面（收口点扩展；不改 L4/存储层）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/mapping-via-wrapper.test.ts tests/sentinel/org-scope.test.ts tests/sentinel/tenant-filter-keys.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "resolveReadTargets" HEAD -- src/sentinel/org-scope.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
