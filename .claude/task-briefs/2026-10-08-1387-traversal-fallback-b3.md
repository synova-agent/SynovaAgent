# Task Brief: #1387（traversal 早退守卫 · 机制③）B3

> 卡: **#1387**（K3 · W1-时序 · p1）｜依 **B1/B2 已验模板**（CTO 放宽停等；三条停下条件不松）
> 声明载体: `.claude/claims/1387.yaml`（S0，随批次更新）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
机制③（代码路径主动返回空）**第三批**：照已验模板（try 包 traverse ⇒ 失败 warn 退回；未命中 **不早退** + 留痕）。

### b) 文件审计（实跑，ref=origin/main@e3a06bac4）
- 余下静默早退 **9 个**；**形态核验**：9 个**全部为"纯预检门"**（守卫后即 `queryNodes` 读；`usedTraversal=0`）⇒ **未触发停下条件 ①**
- 边名：全部 `['DEPLOYS']`（8 个 `[teamId]` 起始｜1 个 `[tid]` 起始）
- 本批 5 个：`moat-dependency`｜`niche-breadth`｜`niche-squeeze`｜`opportunity-window`｜`process-ai-readiness`（`[tid]`）

### c) 决策
逐文件替换守卫（含边界注释）；**按 CTO 新规**：判据短路必须显式声明。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **CTO 新规（本轮立）**：凡判据"因对象不具备而短路" ⇒ **显式声明 + 说明何时有效**；沉默的短路 = R61，声明的短路 = 合格判据
- 行为探针优先（"不早退 = 它继续读了"）＞ 看源码字符串（B1 M2 教训）
- 三条停下条件（形态不同 / 全红 / 无覆盖面）不可松

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/moat-dependency/aggregate.ts — 守卫替换
- extensions/sentinels/niche-breadth/aggregate.ts — 同
- extensions/sentinels/niche-squeeze/aggregate.ts — 同
- extensions/sentinels/opportunity-window/aggregate.ts — 同
- extensions/sentinels/process-ai-readiness/aggregate.ts — 同
- tests/sentinel/traversal-fallback-b3.test.ts — 新建（V1/V2①/V2①-b/V2②，**含短路声明**）
- .claude/claims/1387.yaml（更新）+ brief（新增）

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/api-coverage/aggregate.ts（B2 已改）
- 不改 extensions/sentinels/agent-deployment-maturity/aggregate.ts（B1 已改）
- 不改 extensions/sentinels/business-model-coherence/aggregate.ts（参照实现）
- 不改 src/sentinel/sentinel-loader.ts（loader 行为不变）
- 不改 src/l4/graph-traversal.ts（遍历实现不变）

范围外约束（非文件级）：余 4 个静默早退 ⇒ B4；指标级接线归 #1375 批次。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册哨兵经 `check(context)`（真路径，loader 总传 traversal）。
处理：traverse 未命中 ⇒ warn(reason='traversal-no-edge') + **继续读**。
结果：无匹配边不再空转。

## Q4 契约与测试:
- 契约：留痕粒度边界入实现注释
- 测试：4 例（V1 零残留 regex / V2① 5 个不抛 / **V2② 计数读探针** / V2①-b 不编造【**短路已声明**】）
- 反例（实测）：M1 还原静默早退 ⇒ 2 红（V1+V2②）｜M2 删 warn（最小注入）⇒ 1 红（V1）
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（读路径行为与留痕）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/traversal-fallback-b3.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -c "traversal-no-edge" HEAD -- extensions/sentinels/niche-breadth/aggregate.ts | tr -d '\n')" -ge 1
- [ ] verify: npx tsc --noEmit
