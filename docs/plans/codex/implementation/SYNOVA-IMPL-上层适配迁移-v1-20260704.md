# Task B: Synova 上层适配 — 专家提示词替换 + 92个compute函数并行重写 + 一次性切换

> 版本: v1.0 | 日期: 2026-07-04 | 状态: 实施中
> 关联方案: ../strategy/SYNOVA-DESIGN-本体层最终规范-v2.4-20260704.html
> 关联实施: 与 SYNOVA-IMPL-本体层重建-v1-20260704.md 并行执行。依赖后者产出的新本体JSON Schema + graph-traversal + migration-validator
> 前置依赖: 开始前必须确认Task A产出已就位

## 0. 执行前必读

铁律: 铁律24/31/38, 禁止写兼容层, B模式禁止。

## 1. 专家系统提示词一次性替换（1天）

9位专家THEORY.md/RULES.md全部替换为新内容。核心注入：16条因果边、产业时钟、GPI、三阶推理引擎。替换后做A/B测试。

## 2. 92个compute函数并行重写（6天）

三个Claude Code实例并行。实例A(资本层+边际经济学~30个)、实例B(界面层+技术层~32个)、实例C(内部层+环境层~30个)。文件互不相交。

### 五种数据访问模式

| 模式 | 旧写法 | 新写法 | 覆盖 |
|------|-------|--------|------|
| 模式1：单池快照 | queryNodes + .props | .context + getTemporalParams | ~20 |
| 模式2：单边汇聚 | queryNodes + 手动分类 | 沿一条边汇聚 | ~25 |
| 模式3：路径遍历 | 多次queryNodes+手动关联 | 沿2-3条边连续遍历 | ~25 |
| 模式4：边扫描 | queryNodes+queryEdges分离 | evaluateEdges/scanOutliers | ~15 |
| 模式5：外部基准对比 | 内部数据+手动对比 | 内部+ExternalBaseline | ~7 |

### 旧Financial.props → 新MONEY.context 字段映射

operatingCashFlow→CashPosition.operating_cashflow, netPPE→CashPosition.net_ppe, totalDebt→DebtStructure.total_debt, interestExpense→DebtStructure.interest_expense, equity→EquityBase.total_equity, cash→CashPosition.cash_balance, revenue→RevenueStream.total_revenue

### 函数遍历路径（精选30个高频函数）

kz-index(MONEY→FUNDS→Activity→PRODUCES→FINANCIAL_OUTCOME→REPLENISHES), cash-runway(CashPosition), roic(Activity→PRODUCES汇聚), marginal-contribution(Activity→PRODUCES.marginal_contribution), hhi-index(COMPETITIVE_OUTCOME vs ExternalBaseline), problem-action-cycle(OPERATIONAL_OUTCOME→INFORMS), finkelstein-power(DEPLOYS(PERSON→GOVERNANCE).is_bottleneck), saas-usage(TOOL→DEPLOYS边扫描), cognitive-friction(COGNITIVE_FRICTION边读参数)

（其余约60个函数按同模式处理）

## 补充章节：aggregate.ts 和 sentinel-loader 修改

### aggregate.ts
所有check()签名从 check(store, teamId) 改为 check(store, traversal, teamId)。

### sentinel-loader.ts
registerLoadedSentinels()中的check() wrapper注入GraphTraversal实例。从context.traversal获取。

### SentinelContext
src/sentinel/types.ts增加 traversal?: GraphTraversal 和 teamId?: string。

## 3. 合并 + 验证 + 一次性切换

三个实例合并到 feat/ontology-phase3。运行 migration-validator。全部通过后删除 extensions/ontology/node-types/、删除 migration-validator.ts、更新manifest.json。

## 4. 端到端验证

用客户A数据运行全部46个哨兵。预期触发5条核心诊断。

## 5. 旧代码删除清单

| 删除项 | 路径 |
|--------|------|
| 旧节点JSON | extensions/ontology/node-types/ |
| 旧边JSON | edge-types/中不在新16条列表的文件 |
| migration-validator | src/l4/migration-validator.ts |
