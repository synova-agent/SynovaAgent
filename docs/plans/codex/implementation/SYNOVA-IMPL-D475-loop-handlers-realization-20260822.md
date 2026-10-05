<!--
  SYNOVA-IMPL-D475: loop 执行体真实化 — diagnosis/navigation/overflow 三 placeholder + loop-4/5 专属处理器（K3 P0 遗留 + P1 loop-4）
  任务号变更: 本任务原编号 D472，2026-08-22 提交前创始人指令改为 D475（brief/dev doc/代码注释/commit 全部以 D475 为准）
  状态: dev doc | 2026-08-22 | 优先级 P1
  权威文档: docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（K3 权威偏差 P1「loop-4 无专属处理器」+ K3 第三批验证 P0「4/4 默认 handler 全是 placeholder，每次 cron 写伪造 completed」）; SYNOVA-IMPL-D333-进化闭环N13接线-loop真实化-20260817.md（真实化范本：success ⟺ 实际发生，禁假 completed）; src/loops/loop-trigger-config.ts（6 循环定义）
  依赖: D333（defaultEvolutionHandler 真实化已交付——本任务照同一范本）
  并行: 写集=src/agent/loop-handlers.ts + main-agent.ts + tests/agent/loop-handlers.test.ts，与 D470（data-ingest-service.ts + tests/agent/data-ingest-service.test.ts + extensions/ontology/）**文件级零交集但同目录（src/agent、tests/agent）**——必须 worktree 隔离（D307）；与 D471（packages/）零交集；与 DSH 线（src/sentinel/、scripts/、src/loops/ 方向？——src/loops 属 🟢 Win，middle-evolution-engine 只读不改）零重叠；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D475 loop 执行体真实化（五处理器）

## 1. 权威文档引用

* **AUDIT-FINDINGS-LEDGER.md**（docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md L24）：「K3 权威偏差审计 P1×5：…**loop-4 无专属处理器**…」；K3 第三批验证（AUTHORITY-DEVIATION-REGISTRY-v2）：「4/4 默认 handler 全是 placeholder，6 循环只有 loop-1 有真实执行体，每次 cron 触发都写入**伪造的 'completed' 审计记录**，断裂在仪表盘上不可见」。
* **D333 dev doc**（docs/plans/codex/implementation/SYNOVA-IMPL-D333-进化闭环N13接线-loop真实化-20260817.md）：真实化不变量「success:true ⟺ 实际发生回写；无数据/零动作/失败 → success:false + degraded:true + 显式输出，禁静默 success」——本任务五个 handler 沿用同一不变量。
* **loop-trigger-config**（src/loops/loop-trigger-config.ts）：loop-1 Enterprise Diagnosis / loop-2 Department Navigation / loop-3 GA Evolution（已真实）/ loop-4 System Self-Check / loop-5 Knowledge Accumulation / loop-6 Overflow Monitor，各 3 尺度。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A：defaultDiagnosisHandler / defaultNavigationHandler / defaultOverflowHandler 是假成功
* `src/agent/loop-handlers.ts`：L31-44 `defaultDiagnosisHandler` 只 `log.info` + 返回 `output: '诊断循环 [scale] 执行完成'`（无任何诊断执行）；L49-62 `defaultNavigationHandler` 同型；L138-151 `defaultOverflowHandler` 同型。三者均 **success:true 无真实工作**——每次 cron 触发写伪造 completed（K3 P0 原话）。
* 对照真实化范本 L79-133 `defaultEvolutionHandler`（D333）：聚合信号 → 动作 → 回写，success ⟺ applied>0。

### 缺陷 B：selectHandler 映射缺失 loop-4/loop-5 专属处理器（K3 P1）
* `src/agent/main-agent.ts` L276-294 `selectHandler()`：loop-1→diagnosis、loop-2→navigation、loop-3/loop-5→**evolution**（loop-5 知识积累错挂进化处理器）、loop-6→overflow、**loop-4 与默认分支落入 diagnosis**（System Self-Check 跑诊断——语义错位，K3 P1「loop-4 无专属处理器」实证）。

### 缺陷 C：真实执行路径已存在但未被 handler 使用
* 诊断：`src/growth/lightweight-diagnosis.ts:337` `lightweightReDiagnosis(input, deps)`（真实再诊断，无需 EngineContext——loop-1 可直接用）。
* 溢出：`src/cycles/overflow-compute.ts:78` `computeOverflow(cycle, data)` + `src/cycles/overflow-graph-bridge.ts:58` `writeOverflowSnapshot(...)` + `:146` `getOverflowHeatmap(...)`（loop-6 可直接用）。
* 图/知识：`src/adapters/sqlite-graph-store.ts:103` `SqliteGraphStore`（getDatabase() 可构造，data-ingest/admin-knowledge 同款模式）；`src/agent/knowledge-bridge-service.ts` KnowledgeStore（admin-knowledge getStore 同款）。
* 自检：`src/init/engine-context.ts:50` `getDatabase()`（DB 可达性即核心健康信号）。

### 缺陷 D：测试只有 evolution 覆盖
* `tests/agent/loop-handlers.test.ts`：D333 后只有 evolution 7 用例 + MainAgent 集成 2 用例（L72-166），diagnosis/navigation/overflow 无任何断言（placeholder 假成功从未被测试拦截）。

## 3. 实现方案

### 3.1 写集 (6 修改 + 3 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/agent/loop-handlers.ts | 修改 | ①`defaultDiagnosisHandler`（loop-1）真实化：`lightweightReDiagnosis`（graph store 自 getDatabase() 惰性构造，模块级 `setDiagnosisDeps` 供测试注入）；scale 映射 fast/medium/slow → 每轮再诊断目标上限（1/2/10，priority 降序 + createdAt 升序取 active）；无 active 目标/计数回写失败 → degraded + 显式输出。②`defaultNavigationHandler`（loop-2）真实化：graph store `queryNodes('GOAL'/'PROPOSAL')` → JS 侧聚合（状态/优先级分布 + 完成率 + 近期提案 5 条 + 告警关联计数）；零目标 → degraded。③新增 `defaultSelfCheckHandler`（loop-4）：DB SELECT 1 + expert registry 非空 + scheduler 可达三查；fast 只查前二、medium/slow 加 scheduler（初始化竞态重试一次）；任一 fail → degraded + 逐项报告。④新增 `defaultKnowledgeAccumulationHandler`（loop-5）：KnowledgeStore.recentStats(scale 窗口 fast=1/medium=7/slow=30 天) → 总量/分域/分源统计；窗口内零新增 → degraded。⑤`defaultOverflowHandler`（loop-6）真实化：registerLoadedCycles 自加载 → GOAL.orgId 企业发现 → 每企业×每循环 `computeOverflow` → `writeOverflowSnapshot` → 复读验证 → 热力图摘要；written=0 → degraded。⑥全部沿用 D333 不变量（success ⟺ 真实执行，禁假 completed） |
| src/agent/main-agent.ts | 修改 | `selectHandler` 补 loop-4 → defaultSelfCheckHandler、loop-5 → defaultKnowledgeAccumulationHandler；删 loop-5 错挂 evolution；loop-1/2/6 保持（handler 内部真实化） |
| src/l4/knowledge-store.ts | 修改 | +`recentStats(sinceIso)`（loop-5 时间窗口统计 API：total/byDomain/bySourceType，datetime() 双格式归一 SQL） |
| tests/agent/loop-handlers.test.ts | 修改 | 补五 handler red→green（缺陷 D）：red=现 placeholder 断言「输出含真实标记（诊断结论/目标数/热力图/自检项）」失败 → green=真实化后通过；每 handler 正常/降级/边界（30 用例） |
| tests/agent/main-agent.test.ts | 修改 | 6 个既有用例 beforeEach 注入最小 fake deps（断言不变，保「正常路径→completed」语义） |
| tests/l4/knowledge-store.test.ts | 新建 | recentStats 4 用例（窗口计数/分域分源/双格式归一/空库） |
| docs/plans/codex/implementation/SYNOVA-IMPL-D475-loop-handlers-realization-20260822.md | 新建 | 本 dev doc（S-6 回填） |
| .claude/task-briefs/2026-08-22-D475-loop-handlers-realization.md | 新建 | task brief |
| .claude/reference-map.md | 修改 | grep-refs 物理门禁产物，随交付入库（D333/D358 同款惯例，G12 豁免口径内） |

> 共享资源标注（S-8）：本写集不含 VERSION.md（运行时行为修复，非门禁/工具行为变化，不 bump）；current-brief / 暂存区共享，串行触碰；**src/agent/ 与 D470 同目录**——文件级零交集但物理同目录，双 session 必须 worktree 隔离（D307）。

### 3.2 最终实现同 commit 回填（S-6 — 实际形态，含 6 处偏离）

1. **写集扩展（偏离原 3 文件）**：loop-5 需时间窗口统计，KnowledgeStore 无此 API → +`src/l4/knowledge-store.ts` recentStats + `tests/l4/knowledge-store.test.ts`；loop-1/2 真实化后 main-agent 既有用例需 fake deps → +`tests/agent/main-agent.test.ts`。最终 6 修改 + 3 新建（§3.1）。
2. **diagnosis callExpert（偏离「直接调 light」）**：生产默认 = `deterministicGapAnalysis`（确定性差距分析，不接 LLM）——paused → abandon_goal；deadline 已过未完成 → abandon_goal；指标落后 ≥10% → adjust_target 建议中点；无显著偏差 → adjust_target 保持原目标。Q1c 决策点 1：参考第一性原理（最少机制）+ Anthropic（机器可验契约：确定性输出可断言）。契约空隙：`ExpertRediagnosisResult.suggestedAdjustment` union 无 'no_change' → 保持目标复用 adjust_target（注释已记）。
3. **diagnosis scale 映射（偏离「近 1/2 期/全量」）**：改为每轮再诊断目标数量档——fast=1 / medium=2 / slow=10。GOAL 全量取回 → JS 侧过滤 active（queryNodes 数字属性过滤不可靠，值被 String 化）→ priority 降序（P0 先）→ createdAt 升序 → slice(cap)。
4. **goalId ≠ 图节点 id（偏离「getGoal 直接按 id」）**：图节点 id 是 SqliteGraphStore 自动生成 `node-<uuid>`，props.goalId 只是属性 → 生产默认 getGoal = `queryNodes('GOAL', { goalId }, 'growth')`[0].props 映射（Q1c 决策点 2，压测实测恒 null 后定）。计数回写：`incrementReDiagnosisCount` 闭包 updateNode 后**复读验证**（lightweight-diagnosis 吞 increment 异常 L423-428，闭包侧捕获记 degraded；updateNode 对 0 行 UPDATE 静默不 throw，必须复读）。
5. **loop-6 企业发现（偏离「OVERFLOW_SNAPSHOT/FINANCIAL 发现」）**：FINANCIAL 全 src 无生产写方（死查询）→ 改 `queryNodes('GOAL')` distinct `props.orgId` + 空回退 `['default']`（routes/overflow.ts:88 同款惯例，Q1c 决策点 3）。写后复读：`getCycleSnapshots(limit:1)` 验证 `latest[0].month === snapshot.month` 才 written++（writeOverflowSnapshot 静默吞写失败 overflow-graph-bridge.ts:64-76，Q1c 决策点 4，Anthropic fail-closed）。不硬编码快照图名/cycleId，读写全走 bridge 公开函数（D338 并行改图名不影响）。
6. **selfCheck 分档（偏离「三查全量」）**：fast=DB+registry、medium=+scheduler、slow=三查全+计数明细（对应 loop-trigger-config 三档 coverage）；scheduler 初始化竞态（scheduler.ts:406-419 同步 throw 'CronScheduler 初始化未完成'）→ await 一个 tick 重试一次。生产调度器探针走动态 import（builtin-tools.ts 同款惯例）。
7. **knowledge 窗口（偏离「固定 30 天」）**：scale → fast=1 / medium=7 / slow=30 天；窗口内零新增 → degraded（不搞「绿灯零积累」）。recentStats 双格式归一：insert() 写 ISO（L147）与 schema DEFAULT 写 datetime('now')（L80）都用 `datetime()` 归一后比较。
8. **engine-context 全部动态 import（提交前修复）**：静态 `from '../init/` 会被 pre-commit 5a 判 L2→L5 硬阻断 → prodGraphStore/prodKnowledgeStore/prodScheduler/selfCheck getDb 默认四路全改 `await import('../init/engine-context')`（builtin-tools.ts:209 同款惯例）。

> 测试实绩：loop-handlers.test.ts 30 用例 + knowledge-store.test.ts 4 + main-agent.test.ts 10 = 44 全绿（§4 计划 ≥15+2 超额）；tsc 28=基线零新增。

### 3.3 不做的事
* 不改 `src/loops/middle-evolution-engine.ts`、`feedback-collector`（D333 已交付，本任务只读消费）。
* 不改 `src/monitoring/`（分工规划 🔵 冻结——self-check 用 engine-context 内联实现，不碰 system-health 模块）。
* 不改 `src/deploy/bootstrap.ts`（🔵 冻结——接线在 server.ts 之外完成，见 §5）。
* 不改哨兵（src/sentinel/，DSH 地盘）与 scripts/（DSH 地盘）。
* 不碰 D470（data-ingest/field-mappings）与 D471（packages/）写集。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L2 | 单元 tests/agent/loop-handlers.test.ts | ≥15（5 handler × ≥3） | 每 handler：正常路径（真实执行 + 真实输出标记）+ 降级（依赖未注入/无数据/DB 不可用）+ 边界（空目标/空知识/零溢出）；沿用 D333 断言范式 |
| L2 | 集成（MainAgent selectHandler）tests/agent/loop-handlers.test.ts | 2+ | loop-4/loop-5 路由到专属处理器（不再落 diagnosis/evolution） |

**RED 必须覆盖失败模式（S-5）**：用例 1 先以现状跑 diagnosis handler → 断言输出含 `结论|建议|finding` 真实标记 → **修复前失败（placeholder 只有"执行完成"）** → 修复后通过；用例 2 断言 loop-4 `selectHandler` 返回 selfCheck 处理器（修复前返回 diagnosis）。

## 4.5 决策参考（S-12）
* 决策点 1：diagnosis 用 lightweightReDiagnosis 还是 DiagnosisLauncher 注入？
  * 参考系：第一性原理——最小接线；DiagnosisLauncher 需 EngineContext+DiagnosisEngine（conversation-engine 私有构造），handler 复用需大改 DI；lightweightReDiagnosis 已导出且无需 EngineContext（graph store 即可）。
  * 结论：`lightweightReDiagnosis`（模块级 setDiagnosisDeps 注入测试），生产自 getDatabase() 构造。
* 决策点 2：loop-5 知识积累语义？
  * 参考系：Anthropic——行为契约以循环定义为准（loop-trigger-config loopName=Knowledge Accumulation）；当前错挂 evolution 是语义错位。
  * 结论：专属 knowledge handler（近 30 天新增统计），修正 selectHandler 映射。
* 决策点 3：self-check 不碰冻结的 monitoring？
  * 参考系：DeepSeek——最小侵入；src/monitoring 🔵 冻结，self-check 用 engine-context 内联三查。
  * 结论：内联自检（DB/registry/scheduler），不 import system-health。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| defaultSelfCheckHandler / defaultKnowledgeAccumulationHandler | main-agent.ts `selectHandler`（loop-4/loop-5 路由） | `grep -rn "defaultSelfCheckHandler\|defaultKnowledgeAccumulationHandler" src/agent/main-agent.ts` 命中 |
| 真实化的 diagnosis/navigation/overflow handler | main-agent.ts `selectHandler`（loop-1/2/6 路由，既有）+ loop-scheduler 生产调用链 | `grep -rn "defaultDiagnosisHandler\|defaultOverflowHandler" src/agent/main-agent.ts` 命中 |
| setDiagnosisDeps / setNavigationDeps / setSelfCheckDeps / setKnowledgeDeps / setOverflowDeps | loop-handlers.ts 内部 + tests（各传 null 恢复生产默认） | `grep -rn "setDiagnosisDeps" src/agent/loop-handlers.ts` 命中 |

> 生产调用点（S-3）：main-agent.executeLoopScale → selectHandler → handler（loop-scheduler 消费），是真实 cron/event 调度链；测试调用不计入。

## 6. 完成标准

* **DS1 loop-1 真实化**：`grep -n "lightweightReDiagnosis" src/agent/loop-handlers.ts` 命中（真实诊断执行）。
* **DS2 loop-2 真实化**：`grep -n "queryNodes('Goal'\|queryNodes(\"Goal\"" src/agent/loop-handlers.ts` 命中（导航摘要）。
* **DS3 loop-4 专属处理器**：`grep -n "defaultSelfCheckHandler" src/agent/loop-handlers.ts src/agent/main-agent.ts` 双命中（定义 + selectHandler 路由）。
* **DS4 loop-5 专属处理器**：`grep -n "defaultKnowledgeAccumulationHandler" src/agent/loop-handlers.ts src/agent/main-agent.ts` 双命中。
* **DS5 loop-6 真实化**：`grep -n "computeOverflow" src/agent/loop-handlers.ts` 命中（真实溢出计算）。
* **DS6 测试全绿**：`vitest run tests/agent/loop-handlers.test.ts` 全 pass（red 先行已证：placeholder 断言失败）。
* **DS7 零回归**：`tsc --noEmit` 零新增（28=28）+ 相关既有测试（main-agent/loop-scheduler）绿。
* **DS8 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（不碰 D470/D471/DSH 写集）。
* **DS9 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS10 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（placeholder 假成功 → 真实标记；loop-4 落错处理器 → 专属路由）
* [ ] 接线要求 ≥1 生产调用点（selectHandler → loop-scheduler 链，测试调用不计）
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：运行时行为修复，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 loop-1 真实诊断 | grep -n "lightweightReDiagnosis" src/agent/loop-handlers.ts | 命中 |
| DS2 loop-2 真实导航 | grep -n "queryNodes" src/agent/loop-handlers.ts | 命中（Goal/Proposal） |
| DS3 loop-4 专属处理器 | grep -n "defaultSelfCheckHandler" src/agent/loop-handlers.ts src/agent/main-agent.ts | 双命中 |
| DS4 loop-5 专属处理器 | grep -n "defaultKnowledgeAccumulationHandler" src/agent/loop-handlers.ts src/agent/main-agent.ts | 双命中 |
| DS5 loop-6 真实溢出 | grep -n "computeOverflow" src/agent/loop-handlers.ts | 命中 |
| DS6 测试全绿 | vitest run tests/agent/loop-handlers.test.ts | 全 pass |
| DS7 零回归 | tsc --noEmit + 相关既有测试 | 零新增 + 绿 |
| DS8 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS9 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS10 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS10 一一对应（S-10）；派发说明：与 D470 **同目录不同文件**（src/agent/、tests/agent/）——**必须独立 worktree（D307），禁止同 worktree 并行**；与 D471 零交集；不得与 DSH 的 src/sentinel/、scripts/ 改动并行；暂存前先查 session-registry（S-9）；G12c 写集校验会物理核对本写集与 D470/D471 无重叠。
