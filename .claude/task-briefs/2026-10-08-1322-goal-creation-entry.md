# Task Brief: #1322 目标创建链接入生产入口（提方向 → 三选一 → GOAL 落图 → HTTP 读回）

> 生成: 2026-10-08 | 工作树: `.synova-wt-1322` | 分支: `feat/1322-goal-creation-entry` | 基线: `origin/main 9ddd55f28`
> 角色: planner-1（CTO 放行后转实现）｜ 结论口径: 执行方自验，**不称审计**；判据原始输出入 PR 正文
> 卡: `gh issue 1322`（冻结裁定 R20 (a) / R21 (a) / R22 `extractAuthFromRequest` / R23 串行首位；CTO 2026-10-08 放行并批准 7 项待裁）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
增长导航「第 3 环」（宪章 §8.1 自陈「③ 之后基本断链」，产品宪章.md:389）：诊断方向 → 目标候选（三选一）
→ 选定 → **GOAL 落企业图谱** → 可被真实 HTTP 读回。
- 纵向解耦：**L1** `src/routes/workspace-data.ts` + **L2 领域** `src/growth/**`；图实例经
  `app.locals.graphStore`（`src/server.ts:331`）DI 取得，**不 import `better-sqlite3`、不直引 L4**（铁律 39）。
- 横向解耦：不新增包、不动 `packages/`。
- 扩展解耦：不新增表、不新增引擎、不新增租户真源。

现状定性（实测，as_of origin/main@15e480051；`git rev-list --left-right --count HEAD...origin/main` = `8 760`）：
1. ① 断头：`growth/proposal-engine` 零生产消费者（`git grep -n "proposal-engine" origin/main -- src` 3 处全在该文件内）；
2. 假受理：`PUT /api/workspace/goals/:goalId/target` 返回 `ok:true` 但零写入（`:219-247`）；
3. 读侧恒空：`getDefaultDeps` 的 `queryNodes: () => []` + `getGoalsByDept` 零装配（`:105-112`）；
4. 隔离不成立：`orgId = proposal.department`（`proposal-engine.ts:184`）+ `enterpriseId:"default"` ×3；
5. 🔴 **真库 id 语义断裂（本卡新证，P0）**：`createGoal`/`createProposal` 丢弃 `createNode` 返回值自造 uuid，
   而真库主键恒为 `node-<uuid>`（`src/adapters/sqlite-graph-store.ts:139,144`），`getNode/updateNode` 按主键定位
   ⇒ `getGoal/getProposal/updateXStatus` 对真库**全部失效**。探针原始输出：
   `1g getGoal(goalId) >>> "null（落空）"`、`1h updateGoalStatus >>> "抛错: Goal … 不存在"`、
   `2d selectPath >>> "抛错: Proposal … 不存在"`（探针脚本 `/tmp/p1322/probe-1322.ts`）。

### b) 文件审计（实测行号，as_of origin/main@15e480051）
| 目标 | 实测 | 结论 |
|---|---|---|
| `goal-store.ts` createGoal / getGoal / listGoalsByOrg / updateGoalStatus | :99 / :155 / :184 / :454 | 复用；getGoal/updateGoalStatus 补解析器 |
| `goal-store.ts` `resolveGoalForPropagation`（props 反查先例） | :239-255，生产消费者 `agent/loop-handlers.ts:274` | 抽共用件，语义逐字保留 |
| `proposal-store.ts` getProposal / updateProposalStatus / selectPath / confirmByGa | :122 / :170 / :232 / :258 | 复用 + 补解析器 |
| `proposal-engine.ts` 三选一 / Goal 生成 | :57 / :153 / :184 / :196-202 | 复用；:184 orgId 与 :199 targetValue:100 为改动点 |
| `workspace-types.ts` ActiveGoal | :40-64（无 metrics） | 扩可选 `metrics?` |
| `workspace-builder.ts` Step 2 getGoalsByDept | :50 / :136-146（零装配） | 新增 `getGoalsByOrg`（R21） |
| `workspace-data.ts` getDefaultDeps / `enterpriseId:"default"` ×3 / proposals 组 | :105-112 / :231,:259,:287 / :251 | 真装配 + orgId + 同组扩端点 |
| `middleware/auth.ts` extractAuthFromRequest | :492-503（返 orgId） | 取数点（R22）；**不碰 rbac.ts** |
| `services/audit-service.ts` `AuditService.log` + `bootstrap.ts:684` init | 生产唯一审计写通道 | 薄适配器（不造第二通道） |
| `server.ts` app.locals.graphStore / 路由挂载 | :331 / :429 | **已具备 ⇒ 本卡不改 server.ts** |
| 冲突 = `l2/proposal-manager`（第二套 proposal） | `propose()` 零生产调用（`chat.ts:66` 只驱动 resolve） | **不复用、不改造**（R20） |

### c) 决策
已有覆盖 → **复用**（`growth/proposal-engine` = 唯一候选引擎；`createGoal` = 唯一落图口；
`listGoalsByOrg` = 既有读侧）；无覆盖 → **新增**（2 个 HTTP 端点 + 1 个解析器 + `ActiveGoal.metrics`）；
冲突 → 不新增第三套目标入口/表/引擎；`l2/proposal-manager` 不碰。
**重写还是复用**：**复用为主**，新增仅补「接线缺口」与「真库 id 解析缺口」。
**决策参考系**：参考 Anthropic 工程基线（契约先行/测试先行）+ 第一性原理（零消费者=未完成）+ 本仓先例
（`resolveGoalForPropagation` + `graph-store-service.ts` 的 L1→L2 装配范式）+ DSH 五元组写入纪律
（`dsh-goal` 的 `GoalRef{id,revision}` / `GOAL_STALE_REVISION`：**只借写入纪律，不借领域模型**）。

## Q1: 调研 — 权威件 / 先例 / 历史教训
- 权威件：库外 `产品宪章.md:193 / :226 / :382 / :383 / :389`；`AGENTS.md:63/64`（铁律 47/48）、
  `:73/74`（铁律 4/5）、`:108`（铁律 39）；`docs/plans/codex/implementation/SYNOVA-IMPL-D224-wiring-integration-v1-20260726.md:56-66`；卡 #1322 尾部 M3–M7 + R20–R24。
- 先例（本仓已接线）：`resolveGoalForPropagation`（`agent/loop-handlers.ts:274` 消费，真库测试 10/10 绿）；
  `tests/routes/middleware-order.test.ts:90-110` 的真 `createServer()` 夹具范式；
  `services/audit-service.ts:46-58` 的 `AuditService.log` + `routes/audit.ts:12` 的路由消费先例。
- 历史教训：铁律 4/5（4 次接线失败）、D603 跨层簇、**mock 与真库语义漂移**（本卡新证：四处 mock 用
  `props.goalId` 当节点 id ⇒ 结构上不可能发现 B1）、`verifyJwtToken` 不校验 orgId（`auth.ts:216-218`）。

## Q2: 范围 — 正确的最简方案
做什么：
改动内容（逐项理由）：B1 共用解析器 `resolveEntityNode`（`goal-store.ts`）+ `getGoal`/`updateGoalStatus`/`getProposal`/`updateProposalStatus` 改走它 + `resolveGoalForPropagation` 改调共用件（语义逐字不变）。
· `proposal-types.ts`：`Proposal.orgId?`；`proposal-engine.ts`：`DiagnosisReportLike.orgId?` 透传 + `GoalCreationOverrides`（targetValue/unit/metricName，默认与原值一致）+ Goal.orgId 来源修正。
· `workspace-types.ts`：`ActiveGoal.metrics?`；`workspace-builder.ts`：`getGoalsByOrg?` + 可选第 4 参 `opts.orgId`。
· `workspace-data.ts`：真装配 graphStore/orgId、`enterpriseId:"default"`×3 修、`PUT …/target` 假受理修、新增 2 个 proposals 端点、空 orgId fail-closed 403、审计薄适配器、文件头「未做」段同步。
· 三个新测试件：`tests/growth/goal-store-real-graph.integration.test.ts`、`tests/growth/proposal-store-real-graph.integration.test.ts`、`tests/routes/workspace-goal-creation.integration.test.ts`。
· `tests/security/rbac-all-routes.test.ts` 枚举表同步（**经 CTO 批准的写集越界**，`:175`/`:219-232`）。
（上列即本卡最终写集，逐条供 pre-commit 组 12 解析）
- src/growth/goal-store.ts
- src/growth/proposal-store.ts
- src/growth/proposal-types.ts
- src/growth/proposal-engine.ts
- src/growth/workspace-types.ts
- src/growth/workspace-builder.ts
- src/routes/workspace-data.ts
- tests/growth/goal-store-real-graph.integration.test.ts
- tests/growth/proposal-store-real-graph.integration.test.ts
- tests/routes/workspace-goal-creation.integration.test.ts
- tests/security/rbac-all-routes.test.ts
- .claude/claims/1322.yaml
- .claude/task-briefs/2026-10-08-1322-goal-creation-entry.md

不做什么（含文件路径）：
- 不改 `src/l2/proposal-manager.ts`（R20 禁第二入口）｜不改 `src/middleware/rbac.ts`（R22；不扩 `RbacContext`）
- 不改 `src/adapters/sqlite-graph-store.ts`（隔离载体走 (a) `props.orgId`，不动 schema）
- 不改 `src/growth/goal-sentinel.ts`（#979 语义锁定）｜不改 `src/growth/goal-types.ts`（#1290/#1316 同写集）
- 不改 `src/loops/**`、`extensions/ontology/**`、`scripts/audit/**`（红线）｜不改 `src/server.ts`（已具备挂载与 DI）
- 不做：⑤ 计划节点/版本（#1316）、层级边（#1290）、个人派发（#1058）、Goal 关闭（#1010）、时序比较（#1053/#1054）
- 不做：多租户 graph 命名空间迁移（(b) 登记为收敛目标，另立卡）｜不做 B1 的**扩大重构**（CTO 明令只修 V1 所需面）

## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`POST /api/workspace/proposals`（提方向 → 3 候选）→ `POST /api/workspace/proposals/:proposalId/select`
（选定 → 落 GOAL）。两者均需真 JWT（`Authorization: Bearer`，`orgId` 由验签写入，**空 orgId fail-closed 403**）。
**交互**：系统给出 3 条候选路径（稳健/均衡/积极，含 riskLevel/tradeoffs/expectedImpact/isDefault），调用者选 1 条
并可带 `targetValue`；服务端按既有链序（`tests/growth/e2e-navigation-loop.integration.test.ts:87-103`）
推进 proposal 状态并 `createGoal` 落图。
**结果**：`GET /api/workspace/<orgId>/goals` 返回该 GOAL，含 `metrics[].targetValue`（= 提交值）；
另一 org 的同名查询**读不到**该 GOAL；`PUT …/target` 的返回值与图库真实一致。

## 架构层: L1（`src/routes/workspace-data.ts`）+ L2（`src/growth/**`）；L1 经 app.locals DI 取 L4 图实例，不直引 L4

## Done 标准
- [x] V1 真 HTTP 提方向→选定后 `graph_nodes` 新增 GOAL（`type='GOAL'` 且 `props.goalId`=新 id）
      verify: `sqlite3 "$TMPDB" "SELECT COUNT(*) FROM graph_nodes WHERE type='GOAL' AND json_extract(props,'\$.goalId')='$GOALID';"`
- [x] V2 真 HTTP GET 读回 `metrics[0].targetValue` = 提交值（非常量 100）
      verify: `curl -s "$BASE/api/workspace/org-a/goals" -H "authorization: Bearer $TOKA" | grep -F '"targetValue":15'`
- [x] V3 两 org 互不可见，且两条 `props.orgId` 互不相同、都不等于 'default'
      verify: `sqlite3 "$TMPDB" "SELECT COUNT(DISTINCT json_extract(props,'\$.orgId')) FROM graph_nodes WHERE type='GOAL';"`
- [x] V4 三条反例逐条实测（变异 → 红 → 还原 → 绿），前后原始输出入 PR 正文
      verify: `git diff --stat -- src/growth src/routes | wc -l`   # 变异已还原（非空 = 正常改动仍在）
- [x] V5 store 不可用 ⇒ `degraded:true` + `log.warn/error`（不静默、不假成功）
      verify: `npx vitest run tests/routes/workspace-goal-creation.integration.test.ts -t "降级"`
- [x] 回归：既有相关测试全绿 + `tsc --noEmit` 0 error + 架构门禁通过
      verify: `npx vitest run tests/routes tests/growth tests/integration/wiring-integration.test.ts && npx tsc --noEmit && bash scripts/check-architecture.sh`
