<!--
  SYNOVA-IMPL-D338: 多租户数据隔离（单实例内 orgId 逻辑隔离）— 逐表全覆盖审计 + 缺口修复 + GA 中国墙
  状态: dev doc | 2026-08-22 | 优先级 P1
  权威文档: docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md（P1-A5）; docs/synova/research/跨文档一致性审计-20260727/SYNOVA-CROSS-AUDIT-最终审计报告-v3-20260727.md（P0-7 定案 + P1-22 GA 中国墙）; docs/synova/coordination/编码session派单-20260821.md（D448/GS-07 依赖 "D338 orgId + security/"）; AGENTS.md 铁律 39（架构边界）
  依赖: 无（物理隔离 P0-7 已定案——跨客户由本地部署拓扑保证，本任务只做单实例内逻辑隔离）
  并行: 写集=src/growth/（action-store、feedback-collector）+ src/l4/（graph-traversal、data-purger）+ src/cycles/overflow-graph-bridge.ts + src/routes/（ga-annotations、ga-corrections）+ src/agent/synova-agent.ts + tests/security/，与 D470（src/agent/data-ingest + extensions/ontology）、D471（packages/）、D472（src/agent/loop-handlers + main-agent + tests/agent/）**文件级零交集**；⚠️ **共享消费者协调点：D472 的 defaultEvolutionHandler 只读 getFeedbackCollector()（src/growth/feedback-collector.ts），D338 修改该文件——D338 不得改 getAggregatedSignals 签名/全局聚合语义，GA 中国墙只硬化 enterprise_id 过滤路径；另 src/l4/graph-traversal.ts 被 DSH 的 key-person-risk（哨兵）消费，traverse() 加可选 graph 参数须向后兼容（默认 'default'）**；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D338 多租户数据隔离（单实例内 orgId 逻辑隔离）

## 1. 权威文档引用

* **P1-A5**（docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md L131）：「单实例内 orgId 逐表覆盖未验证（跨客户物理隔离已由本地部署保证，P0-7 已定案）。修复：专项审计 + 补 GA 中国墙」。
* **P0-7 定案**（SYNOVA-CROSS-AUDIT-最终审计报告-v3-20260727.md）：「本地部署 = 物理隔离（各自独立 SQLite 实例）……ENT 的 orgId 是**单实例内部的应用层隔离**，属另一层级」。残留跟踪：P1-21~24 实例内安全纵深、A-G1 orgId DB 层过滤未全量验证、**P1-22 GA 中国墙**。
* **P1-22**（同报告）：「ENT 缺 GA 中国墙隔离 — **ga 角色无跨企业隔离机制**」。
* **GS-07 依赖**（docs/synova/coordination/编码session派单-20260821.md L29）：「D448 | GS-07 数据安全（敏感数据 → PII 脱敏 + 越权拒绝）| D338 orgId + security/」——mac 在等本任务交付。
* **D# 说明**：历史 D338（08-14 abf62f61）为"L4 数据契约收敛方案"（已被 D355 吸收）；当前 D338 按仪表盘口径 = orgId 逐表审计，本 doc 沿用当前口径。

## 2. 代码审计——现状（全部实测 file:line，2026-08-22）

### 隔离模型（先理解，再审计）
单实例内租户维度有两种：①关系表用 `org_id`/`enterprise_id` 列；②图存储用 `graph` 列（graph store 强制 `WHERE graph = ?`）。**泄漏面 = 调用方省略 graph 参数或硬编码全局命名空间**。

### ✅ 已隔离（抽样验证通过）
| 表/存储 | 租户维度 | 证据 |
|---------|---------|------|
| agent_memory | org_id 列 + status | src/l4/agent-memory-store.ts L312（schema）+ 查询条件 org_id=? |
| agent_sessions/agent_messages | org_id | src/store/session-store.ts（INSERT/SELECT 均带 org_id） |
| audit_log | orgId（24 处提及/5 SQL） | src/l4/audit-store.ts |
| delivery_queue | orgId（9/7） | src/l4/delivery-queue-store.ts |
| expert_contributions/outcomes | orgId（4/5） | src/expert-platform/store.ts |
| evidence | orgId（10/4） | src/evidence/evidence-store.ts |
| alert_cooldowns | orgId（2/2） | src/l5/alert-rules.ts |
| feedback_log | enterprise_id 列 + 索引 | src/growth/feedback-collector.ts L106/L116（⚠️ 查询过滤是可选，见缺陷 D） |
| knowledge_chunks | org_id 列 | src/l4/knowledge-store.ts L70 |
| graph store 核心 | graph 列强制 | src/adapters/sqlite-graph-store.ts L198（queryNodes `WHERE graph = ?`）、L238/269（queryEdges）、L301/327/340（getNode/updateNode） |
| 好范式：computeCanvas | graph = orgId | src/l3/business-model-canvas.ts L94 `const graph = orgId || 'default'` |
| 好范式：agent-observer | graph = teamId | src/agent-observer/collector.ts L40 `const graph = activity.teamId || 'default'` |

### ⚠️ 缺陷 A（P1 主缺口）：action-store 硬编码 'growth' 图，ACTION 跨 org 混存
* `src/growth/action-store.ts`：L78 `createNode('ACTION', ..., 'growth')`、L102 `getNode(..., 'growth')`、L122 `updateNode(..., 'growth')`、L138/152/168 `queryNodes('ACTION', ..., 'growth')` —— **6 处硬编码全局命名空间 'growth'**。单实例多 org 时，A 组织的 Action 可被 B 组织 queryNodes 读到（隔离依赖调用方自觉，图存储无法区分）。

### ⚠️ 缺陷 B（P1）：src/l4 查询省略 graph 参数（check-architecture 告警实证）
* `src/l4/graph-traversal.ts`：`store.queryEdges(undefined, current.nodeId, undefined)`（第 4 参 graph 省略）+ `store.queryNodes(resourcePoolType, undefined)`（第 3 参 graph 省略）——省略即落 'default' 全局图。
* `src/l4/data-purger.ts`：`this.graphStore.queryEdges(type)` + `this.graphStore.queryNodes(type, {}, undefined)` —— 同样省略 graph。
* 源头：scripts/check-architecture.sh L120-130「多租户安全: N 处 queryNodes/queryEdges 调用待审查 graph 参数」。

### ⚠️ 缺陷 C（P1）：overflow 快照 enterpriseId 只在 nodeId 前缀，graph 参数需 org 作用域
* `src/cycles/overflow-graph-bridge.ts` L58-60 `writeOverflowSnapshot(enterpriseId, cycleId, ...)`：`nodeId = ${enterpriseId}:${cycleId}:${month}`（enterpriseId 内嵌 nodeId 前缀）——但 createNode/queryNodes 的 graph 参数若省略/全局，跨 org 仍可列出全部快照（nodeId 前缀可查但非强制）。需核 createNode/queryNodes 的 graph 实参并补 org 作用域。

### ⚠️ 缺陷 D（P1，GA 中国墙主体）：GA 路由层 orgId 回退 'default' + feedback_log 过滤可选
* `src/growth/feedback-collector.ts` L209 `let sql = 'SELECT * FROM feedback_log WHERE 1=1'` + L213 `sql += ' AND enterprise_id = @enterpriseId'`（**仅当调用方传 enterpriseId 才过滤**）——调用方漏传即全企业返回，正是 P1-22「ga 角色无跨企业隔离机制」的物理形态。统计查询 L272 同源。
* **GA 路由面（5 个入口，实测）**：`src/routes/ga-annotations.ts` L101/111/162/196/223 共 **5 处 `orgId: auth.orgId || 'default'`**、`src/routes/ga-corrections.ts` 同款回退——auth 无 orgId 时落 **'default' 共享命名空间**（跨企业写同一区域）；`ga-admin.ts` orgId 19 处 ✓（管理面已作用域）；`ga-diagnosis.ts` / `ga-evolution.ts` **orgId 0 提及**（外部 GA 调用——内容作用域进审计报告核验，本轮不进写集）。
* GA 数据入口链：interactive-card gaFeedbackHandler（src/agent/interactive-card.ts）→ feedback-collector；agent-memory ga_correction 类型（org_id 已有 ✓）；ga-annotations/ga-corrections 路由。中国墙 = GA 反馈读写必须强制 enterprise_id/orgId（缺 auth.orgId → fail-closed 而非 'default' 回退）。

### ⚠️ 缺陷 F（P1，ActionStore 隔离的接线缺口）：Action/finding 均无 orgId
* `src/growth/action-types.ts` L44-66 `Action` 接口 16 字段**无 orgId**；`src/agent/proactive-push.ts` L31 `SentinelFinding` 无 orgId（L253 硬编码 `orgId: 'synova'`）——ActionStore 无法从输入推导租户，隔离必须**构造器注入**：`new ActionStore()` 在 `src/agent/synova-agent.ts` 构造，需传 orgId/org 上下文（该文件进入写集）。

### ⚠️ 缺陷 E（P2/观察项，随审计报告记录，不阻断）
* `storage_kv`（src/store/storage-backend.ts L72-73 `makeKey = ${namespace}:${key}`）：隔离靠调用方 namespace 自律，无 org_id 列——审计调用方 namespace 是否 org 作用域。
* `mode_library`（src/tools/pattern-engine.ts）：无 orgId——全局方法论模板库（若为共享资产属设计使然，需在审计报告标注）。
* engine-context 五表（collaboration_events/routing_events/agent_metrics/agent_contracts/team_changes，src/init/engine-context.ts）：建表但**全仓零查询方**（死表）——无数据流即无泄漏面，记录观察项，不修。

## 3. 实现方案

### 3.1 写集 (8 修改 + 2 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/growth/action-store.ts | 修改 | 构造器加 `orgId` 参数；6 处 'growth' → `${orgId}:growth`（L78/102/122/138/152/168）；缺 orgId 时 fail-closed（拒绝写入/查询 + degraded）而非回落全局 |
| src/agent/synova-agent.ts | 修改 | `new ActionStore()` 构造点传 orgId/org 上下文（缺陷 F 接线；与 D472 的 main-agent 不同文件，零重叠） |
| src/l4/graph-traversal.ts | 修改 | `traverse()` 加可选 `graph` 参数（默认 'default' 向后兼容）；L80 queryEdges / L139 queryNodes 传 graph（不再省略）；l3/graph-traversal-adapter.ts 纯透传零改；消费方 diagnosis-launcher 传 orgId，key-person-risk（DSH）保持 'default' 并知会 DSH |
| src/l4/data-purger.ts | 修改 | queryEdges/queryNodes 补 graph 参数 |
| src/cycles/overflow-graph-bridge.ts | 修改 | createNode/queryNodes 的 graph 用 org 作用域（如 `${enterpriseId}:cycles`）；enterpriseId 参数已有 |
| src/growth/feedback-collector.ts | 修改 | GA 中国墙：query()/统计查询的 enterprise_id 过滤改 **fail-closed**（缺 enterpriseId → 拒绝 + degraded，不再 WHERE 1=1 全量）；**不改 getAggregatedSignals 签名与全局聚合语义（D472 消费方兼容，见并行字段）** |
| src/routes/ga-annotations.ts | 修改 | 5 处 `orgId: auth.orgId || 'default'` → fail-closed（缺 auth.orgId 拒绝而非回退 'default'） |
| src/routes/ga-corrections.ts | 修改 | 同款 'default' 回退 → fail-closed |
| tests/security/org-isolation-audit.test.ts | 新建 | 逐表/逐调用点审计断言：①Win 线表查询必须带 org_id/enterprise_id 过滤（feedback 缺 enterpriseId 拒绝）；②src/l4 调用点 graph 参数非省略；③action-store graph 为 org 作用域 |
| docs/synova/audit-reports/2026-08-22-D338-org-audit.md | 新建 | 逐表全覆盖审计报告（含 P2 观察项：storage_kv/mode_library/engine-context 五表、ga-admin ✓、ga-diagnosis/ga-evolution 外部 GA 内容作用域待核结论） |

> 共享资源标注（S-8）：本写集不含 VERSION.md（隔离强化，非门禁/工具行为变化，不 bump）；current-brief / 暂存区共享，串行触碰；**src/growth/feedback-collector.ts 与 D472 有共享消费者关系（D472 只读 getAggregatedSignals）——D338 改动必须向后兼容该函数，改动前先与 D472 实现方对口径**。

### 3.2 写集回填（18 修改 + 2 新建 + 3 流程产物，与 commit 一致）

| 文件 | 操作 | 说明 |
|------|------|------|
| src/growth/action-store.ts | 修改 | 构造器 `(store?, orgId?)` + 私有 getGraph() 派生 `${orgId}:growth`；6 处 'growth' → graph；缺 orgId 分方法 fail-closed（createAction 内存降级 / updateLifecycle 抛错 / 查询返 []，均 log.warn） |
| src/agent/synova-agent.ts | 修改 | L139 `new ActionStore(undefined, config.orgId)`（缺陷 F 接线） |
| src/config.ts | 修改 | `SynovaConfig.orgId: string` + loadConfig 读 `SYNOVA_ORG_ID \|\| 'default'`（决策 A：orgId 来源集中化） |
| src/l4/graph-traversal.ts | 修改 | 绑定式 createGraphTraversal(store, graph='default') + traverse 第 4 参 graphOverride；L80/L91/L139 传 graph（L91 空串 bug 修） |
| src/agent/diagnosis-launcher.ts | 修改 | L145 `createGraphTraversal(store, teamId)`（决策 C 接线） |
| src/l4/data-purger.ts | 修改 | 构造器第 4 参 graph='default'；L186/255/266/269/411 五处改 this.graph（空串 bug 修） |
| src/l3/data-lifecycle-service.ts | 修改 | L75 `new DataPurger(gs, sessionStore, memoryStore, tenantId)`（决策 D 接线） |
| src/cycles/overflow-graph-bridge.ts | 修改 | snapshotGraph(enterpriseId) 私有派生 `${enterpriseId}:cycles`，替换 3 处 SNAPSHOT_GRAPH 全局常量 |
| src/growth/feedback-collector.ts | 修改 | queryFeedback → FeedbackQueryResult{entries,degraded}；缺 enterpriseId → log.warn + {entries:[],degraded:true}；getAggregatedSignals 一字不动（D472 只读兼容） |
| src/routes/ga-annotations.ts | 修改 | requireGa 加 ORG_REQUIRED 400 分支；4 处 `\|\| 'default'` → auth.orgId |
| src/routes/ga-corrections.ts | 修改 | 同款；3 处回退清零 |
| src/l4/entity-resolver.ts | 修改 | 缺口 E（缺陷 B 同型第三文件）: GraphStoreRO 接口补 graph + L51/204/205 转发（check-architecture 多租户告警 5 处全在此，修复后清零） |
| src/cycles/investment-advisor.ts | 修改 | 缺陷 C 消费侧: simulateInvestment 加 enterpriseId 首参，4 处硬编码 'default' 清除 |
| src/routes/overflow.ts | 修改 | POST /api/overflow/simulate 从 body 取 enterpriseId（缺省 'default' = 实例默认 org，与既有 GET snapshots 语义一致） |
| tests/growth/action-store.test.ts | 修改 | 9 处构造点补 'test-org'（fail-closed 后兼容） |
| tests/growth/feedback-collector.test.ts | 修改 | 4 处调用点适配 .entries 新形态 |
| tests/routes/ga-enterprise.test.ts | 修改 | D109 两条静态断言钉死旧回退模式 → 适配 fail-closed 断言（not.toContain `\|\| 'default'` + toContain ORG_REQUIRED） |
| tests/cycles/investment-advisor.test.ts | 修改 | 3 处调用点补 enterpriseId 首参 |
| tests/security/org-isolation-audit.test.ts | 新建 | 12 用例 red→green（含用例 11 缺口 E + 用例 12 缺陷 C 消费侧；记录式 mock 断言 graph 实参） |
| docs/synova/audit-reports/2026-08-22-D338-org-audit.md | 新建 | 逐表审计报告（DS1，O1-O8 观察项 + 手动迁移 SQL） |

流程产物（随 commit 提交，非代码文件）: .claude/task-briefs/2026-08-22-D338-org-isolation.md、.claude/reference-map.md、本文档 §3.2。

**§3.1 方案的偏离点（+6 文件，均为缺陷同型延伸，非范围扩张）**：

| 文件 | 操作 | 偏离说明 |
|------|------|---------|
| src/config.ts | 修改 | 决策 A 接线: `SynovaConfig.orgId: string` + `loadConfig()` 读 `SYNOVA_ORG_ID \|\| 'default'`（orgId 来源集中化） |
| src/agent/diagnosis-launcher.ts | 修改 | 决策 C 接线: L145 `createGraphTraversal(store, teamId)` |
| src/l3/data-lifecycle-service.ts | 修改 | 决策 D 接线: L75 `new DataPurger(gs, sessionStore, memoryStore, tenantId)` |
| src/l4/entity-resolver.ts | 修改 | **缺口 E**（缺陷 B 同型第三文件，dev doc 未列名）: `resolveEntitiesL3(store, graph)` 收到 graph 但本地 GraphStoreRO 接口丢弃 → L51/204/205 回落默认命名空间；check-architecture 多租户告警 5 处全在此。修复=接口补 graph + 三处转发（对齐 community-reports.ts 同型接口） |
| src/cycles/investment-advisor.ts | 修改 | **缺陷 C 消费侧**（dev doc 未列名）: simulateInvestment 内部 4 处硬编码 `getLatestSnapshot('default', ...)`。修复=签名加 enterpriseId 首参（对齐 writeOverflowSnapshot 惯例）+ 4 处透传 |
| src/routes/overflow.ts | 修改 | 缺陷 C 消费侧接线: POST /api/overflow/simulate 从 body 取 enterpriseId（缺省 'default' = 实例默认 org，与既有 snapshots GET 一致） |
| tests/routes/ga-enterprise.test.ts | 修改 | D109 两条静态断言将旧回退 `orgId: auth.orgId \|\| 'default'` 钉为"正确"——该断言编码了本任务移除的漏洞（DS6 要求该模式消失）。适配为 fail-closed 断言（not.toContain + ORG_REQUIRED） |
| tests/cycles/investment-advisor.test.ts | 修改 | 3 处调用点补 enterpriseId 首参（签名变更的机械适配） |

**决策参考记录（Q1c，K3 可核）**：
- 缺口 E（entity-resolver）: 参考：第一性原理（审计本职=堵此类缺口）+ 代码库实证（community-reports.ts L101/123、quality-firewall.ts L54 同型接口均带 graph）+ 收敛检查（调用方零改、mock 向后兼容）。结论：修复。
- 缺陷 C 消费侧（investment-advisor）: 参考：铁律 9（改核心定义 grep 全仓传播——此缺陷即 grep 收获）+ 第一性原理（'default:cycles' 在真实租户下恒空=模拟静默失效）。结论：修复。
- 测试断言适配（ga-enterprise）: 参考：dev doc DS6（该回退模式必须消失）优先于 D109 旧断言；断言钉死漏洞=测试债务。结论：适配断言而非保留回退。

**实测证据摘要**（详见 docs/synova/audit-reports/2026-08-22-D338-org-audit.md §四）：
- 审计测试 12 用例 red→green（RED 阶段: 7红3绿 → +用例11 1f/10p → +用例12 1f/11p → GREEN 12/12）
- 全量套件基线 diff: 失败文件集合与 origin/main@69be07c8 完全一致（62=62），唯一 1 个用例级差异 = zero-code-industry 的 `git diff --name-only` 树状态断言（未提交 .ts 修改所致工件，非行为回归，CI 干净检出通过）
- tsc 28=28（全部 pre-existing）；check-architecture 多租户告警 5→0 清零；DS2-DS7/DS11 grep 全部命中

### 3.3 不做的事
* 不改跨客户物理隔离（P0-7 已定案，本地部署拓扑保证）。
* 不改 src/store/ 冻结区（session-store/storage-backend 若需修复 orgId → 记录 deferred 与 DSH 协调，不擅动）。
* 不改 src/sentinel/、scripts/（DSH 地盘）与 D470/D471/D472 写集。
* 不实现审计 UI/管理界面（GA 中国墙管理入口另行排期）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L1 | 单元 tests/security/org-isolation-audit.test.ts | ≥7 | ①feedback query 缺 enterpriseId → 拒绝（red=现状 WHERE 1=1 全量返回 → green=fail-closed）；②feedback query 带 enterpriseId → 只返该企业；③action-store graph 含 orgId（red=当前 'growth'）；④graph-traversal/data-purger 调用点 graph 非省略（静态断言）；⑤overflow 快照 graph org 作用域；⑥GA 路由缺 auth.orgId → 拒绝（red=现状 'default' 回退）；⑦knowledge/audit 等已隔离表回归（不误报） |
| L1 | 回归 既有 feedback/action/graph 测试 | 全量 | feedback-collector、action-store、graph 相关既有测试绿（D472 兼容） |

**RED 必须覆盖失败模式（S-5）**：用例 1 先以现状跑（feedback query 缺 enterpriseId）→ 断言拒绝 → **修复前失败（全量返回）** → 修复后通过；用例 3 断言 action-store graph 含 orgId → 修复前失败（'growth'）。

## 4.5 决策参考（S-12）
* 决策点 1：action-store 隔离用 graph 前缀还是 props 内嵌 orgId？
  * 参考系：第一性原理——图存储已有 graph 列强制（sqlite-graph-store L198），graph 前缀是现成隔离机制零新增；props 过滤需每查询补条件易漏。
  * 结论：`${orgId}:growth` graph 前缀 + 构造器注入 orgId。
* 决策点 2：feedback enterprise_id 过滤 fail-closed 还是保持可选？
  * 参考系：Anthropic——fail-closed 是隔离正确姿态（缺租户上下文宁可拒绝不可全量）；P1-22 原文"ga 角色无跨企业隔离机制"要求强制。
  * 结论：fail-closed（缺 enterpriseId 拒绝 + degraded），全局聚合路径 getAggregatedSignals 显式保留（设计语义，D472 依赖）。
* 决策点 3：engine-context 五表/死表怎么处理？
  * 参考系：DeepSeek——无数据流即无泄漏面，最小改动。
  * 结论：审计报告记录观察项，不修（避免给死表加 orgId 的无价值改动）。
* 决策点 4：GA 路由 'default' 回退怎么改？
  * 参考系：Anthropic——隔离正确姿态是 fail-closed；'default' 回退 = 静默共享命名空间（与缺陷 D 同根）。
  * 结论：ga-annotations/ga-corrections 缺 auth.orgId → 拒绝 + degraded（不写 'default'）；ga-diagnosis/ga-evolution 外部调用进审计报告核验（本轮不修，避免范围膨胀）。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| ActionStore（orgId 参数化） | `src/agent/synova-agent.ts` 构造点（new ActionStore()） | `grep -rn "new ActionStore" src/agent/synova-agent.ts` 命中且传 orgId |
| feedback-collector query（fail-closed） | interactive-card gaFeedbackHandler / D472 getAggregatedSignals（只读，签名不变） | `grep -rn "getFeedbackCollector\|getAggregatedSignals" src/` 命中 |
| 审计测试 | vitest 自动收集 | `grep -rn "org-isolation-audit" tests/security/` 命中 |

> 生产调用点（S-3）：ActionStore 由哨兵→动作链路创建（proactive-push），feedback 由 GA 反馈链路消费；测试调用不计入。

## 6. 完成标准

* **DS1 逐表审计完成**：`docs/synova/audit-reports/2026-08-22-D338-org-audit.md` 存在，含全部 Win 线表/存储的 orgId 覆盖结论（✅/⚠️/观察项分类）。
* **DS2 action-store 隔离**：`grep -n "orgId.*growth\|growth.*orgId\|graphPrefix" src/growth/action-store.ts` 命中（'growth' 不再裸用）。
* **DS3 l4 graph 参数补齐**：`grep -rn "queryNodes\|queryEdges" src/l4/graph-traversal.ts src/l4/data-purger.ts` 命中且无省略模式（审计测试断言）。
* **DS4 overflow 快照隔离**：`grep -n "enterpriseId\|orgId" src/cycles/overflow-graph-bridge.ts` 命中 graph 作用域。
* **DS5 GA 中国墙 fail-closed**：`grep -n "enterprise_id = @enterpriseId\|enterpriseId" src/growth/feedback-collector.ts` 命中且缺参拒绝（审计测试断言）。
* **DS6 GA 路由 fail-closed**：`grep -n "orgId" src/routes/ga-annotations.ts src/routes/ga-corrections.ts` 命中且无 `|| 'default'` 回退（审计测试断言）。
* **DS7 ActionStore 接线**：`grep -n "new ActionStore" src/agent/synova-agent.ts` 命中且传 orgId。
* **DS8 审计测试全绿**：`vitest run tests/security/org-isolation-audit.test.ts` 全 pass（red 先行已证）。
* **DS9 零回归**：`vitest run tests/growth tests/l4 tests/routes`（或受影响相关文件）绿 + `tsc --noEmit` 零新增（28=28）；**D472 兼容**：loop-handlers 相关测试绿。
* **DS10 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（不碰 D470/D471/D472/DSH 写集、不碰 src/store 冻结区）。
* **DS11 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS12 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）；GS-07（D448）前置依赖本任务合并。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（feedback 全量返回 → fail-closed；'growth' 裸用 → org 作用域）
* [ ] 接线要求 ≥1 生产调用点（ActionStore/feedback 生产链路，测试调用不计）
* [ ] D472 兼容：getAggregatedSignals 签名与全局聚合语义不变（并行协调点）
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：隔离强化，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 逐表审计报告 | ls docs/synova/audit-reports/2026-08-22-D338-org-audit.md | 存在 |
| DS2 action-store org 作用域 | grep -n "orgId\|graphPrefix" src/growth/action-store.ts | 命中且 'growth' 非裸用 |
| DS3 l4 graph 参数补齐 | grep -rn "queryNodes\|queryEdges" src/l4/graph-traversal.ts src/l4/data-purger.ts | 无省略模式（审计测试） |
| DS4 overflow 快照隔离 | grep -n "enterpriseId\|orgId" src/cycles/overflow-graph-bridge.ts | 命中 |
| DS5 GA 中国墙 fail-closed | grep -n "enterpriseId" src/growth/feedback-collector.ts | 命中缺参拒绝 |
| DS6 GA 路由 fail-closed | grep -n "orgId" src/routes/ga-annotations.ts src/routes/ga-corrections.ts | 命中且无 'default' 回退 |
| DS7 ActionStore 接线 | grep -n "new ActionStore" src/agent/synova-agent.ts | 命中且传 orgId |
| DS8 审计测试全绿 | vitest run tests/security/org-isolation-audit.test.ts | 全 pass |
| DS9 零回归 + D472 兼容 | vitest run 相关 + tsc --noEmit | 全绿 + 零新增 |
| DS10 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS11 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS12 推送 + CI + GS-07 前置 | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS10 一一对应（S-10）；派发说明：与 D470/D471/D472 **文件级零交集**可并行，但 **src/growth/feedback-collector.ts 与 D472 是共享消费者**（D472 只读 getAggregatedSignals）——**必须先与 D472 实现方对口径再动该文件，或改在 D472 合并后落地该文件**；必须 worktree 隔离（D307）；src/store 冻结区发现缺口 → deferred 记录不修；暂存前查 session-registry（S-9）。
