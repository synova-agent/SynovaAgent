# Task Brief: #1387（traversal 早退守卫 · 机制③）**B4 = 收尾批**

> 卡: **#1387**（K3 · W1-时序 · p1）｜依 B1/B2/B3 已验模板｜CTO 同意"先 B4 收尾"
> 声明载体: `.claude/claims/1387.yaml`（S0，随批次更新）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
机制③（代码路径主动返回空）**收尾**：余下 4 个哨兵 ⇒ **17/17 全清**（前 13 个见 B1–B3）。

### b) 文件审计（实跑，ref=origin/main@5c70aa4f9）
- 余下静默早退 **4 个**（`resource-misallocation`｜`routine-mutation`｜`strategy-capability-fit`｜`value-capture`），
  **形态核验**：全部"纯预检门"（`['DEPLOYS']`，`[teamId]` 起始）⇒ 未触发停下条件 ①
- 全局旧形态残留 = **4 文件**（即本批 4 个）⇒ 收尾后应为 **0**（收尾证据 ③）

### c) 决策
照已验模板替换；**收尾证据三项入判据**（CTO 要求）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 新规：判据短路须**显式声明 + 说明何时有效**（本批 V2①-b 已声明）
- R109：判据要能证明"它有对象可测" ⇒ 全局扫描加断言 `files.length > 40`（防扫空目录假过）
- 行为探针优先（计数读 > 看源码字符串）

## Q2: 范围 — 正确的最简方案
做什么：
- extensions/sentinels/resource-misallocation/aggregate.ts — 守卫替换
- extensions/sentinels/routine-mutation/aggregate.ts — 同
- extensions/sentinels/strategy-capability-fit/aggregate.ts — 同
- extensions/sentinels/value-capture/aggregate.ts — 同
- tests/sentinel/traversal-fallback-b4.test.ts — 新建（①17/17 ②批次指针 ③全局零残留 + V2② 行为探针）
- .claude/claims/1387.yaml（更新）+ brief（新增）

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/niche-breadth/aggregate.ts（B3 已改）
- 不改 extensions/sentinels/api-coverage/aggregate.ts（B2 已改）
- 不改 extensions/sentinels/agent-deployment-maturity/aggregate.ts（B1 已改）
- 不改 extensions/sentinels/business-model-coherence/aggregate.ts（参照实现）
- 不改 src/sentinel/sentinel-loader.ts（loader 行为不变）

范围外约束（非文件级）：机制③ 收尾后，后续为 #1375 批次与 #1373+#1380 合并卡。

## Q3: 验收 — 入口 → 交互 → 结果
入口：loader 注册哨兵经 `check(context)`（真路径，loader 总传 traversal）。
处理：traverse 未命中 ⇒ warn(reason='traversal-no-edge') + **继续读**。
结果：**机制③ 全清**（17/17，全局零残留）。

## Q4 契约与测试:
- 契约：留痕粒度边界入实现注释
- 测试：4 例（①17/17 点名 / ②批次指针 / ③全局零残留 + 扫描量下限 / V2② 行为探针）
- 反例（实测）：M1 还原静默早退 ⇒ **3 红**（① + ③ + V2②）
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
扩展哨兵（读路径行为与留痕）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/traversal-fallback-b4.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/ tests/connectors/
- [ ] verify: test "$(git grep -rlE "if \(!r\.nodes\[0\]\) return \[\]" HEAD -- extensions/sentinels/ | grep -v _extinct | wc -l | tr -d '\n')" -eq 0
- [ ] verify: npx tsc --noEmit
