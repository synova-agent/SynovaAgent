# Task Brief: D475 loop 执行体真实化: diagnosis/navigation/overflow 三 placeholder 真实化 + selfCheck/knowledge 专属处理器 + selectHandler 路由修正

> 生成: 2026-08-22 09:58:04 | 分支: main | as any: 0

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

### 三层解耦体系

**纵向解耦：五层物理隔离**
代码按 L1-L5 架构分层，每层只与相邻层通信。L1 交互层不知道 L4 用什么数据库，L3 洞察层不知道 L5 数据存在哪。换底层存储，上层零改动。pre-commit 物理阻断跨层 import——L2→L4 的代码提交不进去。

**横向解耦：11 个独立 Monorepo 包**
五层内部拆为独立包：@synova/sog-core（本体图类型）、@synova/sentinel-engine（哨兵调度）、@synova/expert-platform（专家加载）、@synova/connector-registry（数据连接器）。每个包接口边界明确，拆卸一个不影响其余 19 个。核心包已落地运行；已存在的功能规划从 src/ 迁移到独立包；未来新增须遵循此结构。

**扩展解耦：文件驱动，不改代码**
新增能力靠文件，不靠改代码：
- 新 AI 专家 = 新建目录 + 10 个 Markdown 文件 → 自动注册到 ExpertDispatcher
- 新诊断哨兵 = 加 xxx-sentinel.ts → builtins 自动扫描加载
- 新行业 = 加行业目录（基准数据+阈值+案例库）→ 1-2 天上线，零 TypeScript 改动
- 新本体实体类型 = 加 JSON Schema 文件

流程约束: V4.5.0 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查。

数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
        反馈闭环: GA评审/客户反馈 → 记忆层 → 数据层
        Sentinel Finding[] → 诊断引擎 Phase 2 → 8 位文件驱动专家解读

L1 入口: POST /api/diagnosis/consult (GA诊断) / Cron→Sentinel.check() (哨兵) / GET /chat (Web) / MCP
五层架构 (只能向下依赖相邻层):
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/ expert/ (8位文件驱动专家: strategy org finance tech marketing action business_model knowledge)
  L4 本体: l4/ evidence/ 企业事实层: AgentMemoryStore (enterprise_fact, 版本化+superseded_by链)
  L5 存储: store/ cron/
三层粒度: 专家→哨兵→计算。哨兵=可独立告警的最小子领域。compute=纯数学函数。
L0 进化: evolution/ 两路反馈→候选池→确认/执行验证→写入知识库
文件化扩展: expert/ knowledge/shared/ theory/ skills/ — 新增=加文件,不改代码
数据安全: L0公开摘要→L1聚合信号→L2脱敏证据→L3原始数据(仅客户内Agent可见,GA不可见)
引擎: packages/engine-core/ (Novis遗产,逐步迁移)。禁止src/新增engine-core引用(铁律46)。
安全: security/ (PIIScrubber, DataBoundary)
LLM: providers/ (DeepSeek, OpenAI, Gateway)

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属于三层解耦的哪一层？
- [x] 纵向（改 L1-L5 代码/架构）
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于哪个系统（GA诊断/哨兵/基础设施）？触及哪层？该层现有模块？新增/替换/扩展？
- 系统：L2 编排 loop 调度链（main-agent.executeLoopScale → selectHandler → loop-handlers，loop-scheduler 消费）。K3 P0：diagnosis/navigation/overflow 三 placeholder 假成功每次 cron 写伪造 'completed' 审计；K3 P1：loop-4 无专属处理器落 diagnosis、loop-5 错挂 evolution。
- 层：L2 src/agent/（loop-handlers.ts + main-agent.ts）+ L4 src/l4/knowledge-store.ts（+recentStats 时间窗口统计，经 src/agent/knowledge-bridge-service.ts 合法桥接入）。
- 现有模块：D333 范本 defaultEvolutionHandler（loop-handlers.ts L79-133，success ⟺ applied>0）；lightweightReDiagnosis（src/growth/lightweight-diagnosis.ts:337）；computeOverflow/writeOverflowSnapshot/getOverflowHeatmap（src/cycles/）；SqliteGraphStore（src/adapters/）。关系：复用 + 真实化替换 placeholder。

### b) 文件审计
grep 本任务关键词在 expert/ sentinel/ extensions/ knowledge/ theory/ skills/ 中。列出已有文件驱动模块。关系: 复用 / 扩展 / 新建 / 冲突
- expert/：8 位文件驱动专家，本任务只读消费（selfCheck 查 registry 非空）。复用。
- sentinel/ extensions/：零交集（DSH 地盘，不碰）。无冲突。
- knowledge/shared、theory/：零交集。无冲突。
- cycles/builtin/*.cycle.json：loop-6 数据源（registerLoadedCycles 加载）。复用。

### c) 决策
已有覆盖→复用，不准新建硬编码。无覆盖→新建走文件驱动（属扩展解耦）。冲突→取消任务，复用已有。
- 复用：lightweightReDiagnosis / computeOverflow+overflow-graph-bridge / SqliteGraphStore / KnowledgeStore / engine-context.getDatabase / expert-registry / cron-scheduler。
- 新建：KnowledgeStore.recentStats（既有 store 无时间范围查询 API，属补能力非硬编码新类型）；defaultSelfCheckHandler / defaultKnowledgeAccumulationHandler（loop-4/5 专属，K3 要求）。
- 冲突取舍/多选项/架构选择 → 走 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md），结论写入 Q1c 决策参考系。



## 注入上下文
### DECISION-REFERENCE

> D333 决策参考框架全文（创始人 2026-08-13 定）:

# 决策参考框架（双参考系）

> 2026-08-13 创始人定 | 用途：遇到难决策/多选项/最佳实践选择时，强制走四步参考，并记录所用参考系
> 触发条件：①多选项需取舍 ②设计/架构方案选择 ③优先级排序 ④"最佳实践是什么"类问题 ⑤实现与文档声称冲突时

## 四步框架

```
① 第一性原理（DeepSeek/梁文峰）：这个问题的最简本质是什么？最少机制能解决吗？
② Anthropic 工程基线：隔离/失败即关闭/脚本验证/机器可验契约——哪条适用？
③ 开源实证（DeepSeek）：有可克隆的代码/架构参考吗？clone 下来看实际做法（成本/效率/结构）
④ 收敛检查：两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
```

## 双参考系边界

| 参考系 | 适用 | 不适用 |
|--------|------|--------|
| **Anthropic 工程实践** | agent 隔离、门禁/fail-closed、脚本化验证、机器可验契约、并行协作 | 成本/产品定位/模型选择 |
| **DeepSeek 第一性原理 + 开源实证** | 产品哲学、成本/效率/架构取舍、反内卷、开源参考（clone 仓库） | 工程流程细节（其仓库是模型/推理代码，非 agent 协作） |

## 梁文峰原则摘要（DeepSeek 参考时使用）

- **第一性原理**：不做无意义的炫技，回到问题本质
- **极致成本**：能用最少机制解决就不用多的（这正好支持"worktree 隔离 = 最少机制"而非 N 个门禁）
- **开源开放**：能参考开源实证就不闭门造车
- **反内卷**：机制是为了减少摩擦，不是为了增加流程

## 记录要求（可验证，不靠记忆）

- Codex 决策：在 dev doc / 本会话回复中**明确写"参考：Anthropic/DeepSeek/第一性原理 + 结论"**
- Claude Code 决策：dev doc 要求完成报告含**决策记录**（决策点 + 参考系 + 理由），K3 审计可核

## 已用案例

| 日期 | 决策 | 参考系 | 结论 |
|------|------|--------|------|
| 2026-08-13 | 并行 agent 冲突（串行 vs 并行） | Anthropic（隔离基线）+ DeepSeek（最少机制） | 收敛：worktree 隔离（D307）优先解锁并行 |


## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — 定义「怎么算做完」
  ② 测试 — 先写测试，测试 = 产品的一部分
  ③ 实现 — 刚好满足以下全部条件：
     - Done 标准中列出的所有完成项
     - 测试全部通过
     - 接线完整（新 export 有引用）
     - 错误路径有 log + degraded
     - tsc + vitest 零失败
  ④ 接线 — 端到端走通（入口可触达 + 链路完整 + 结果可见）
  ⑤ 验证 — 自检 6 问（接线/异常/类型/测试/残留/文件驱动）

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge（dev doc = spec，red 先行）
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见（selectHandler → handler → LoopExecutionResult → 审计记录）
  - 铁律 24+31: 错误处理 + 降级信号（每 handler 依赖不可用 → success:false + degraded:true）
  - 铁律 33: 测试命名约定（*.test.ts）
  - memory/ 中的历史教训文件：2026-08-17-d333-n13-loop-delivery.md（D333 真实化不变量范本）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
根据决策链和本任务特点，提炼 2-3 条必须遵守的规则。每条 rule 必须包含 verify 命令。
  - rule: "success:true ⟺ 实际发生执行/回写；无数据/零动作/失败 → success:false + degraded:true + 显式输出"
    verify: "grep -n 'degraded' src/agent/loop-handlers.ts"
  - rule: "loop-4/loop-5 必须路由到专属处理器，不得落 diagnosis/evolution"
    verify: "grep -n 'defaultSelfCheckHandler\\|defaultKnowledgeAccumulationHandler' src/agent/main-agent.ts"
  - rule: "新增 L2 能力不得跨层直接 import l4/，必须经 knowledge-bridge-service 桥"
    verify: "grep -n 'l4/knowledge-store' src/agent/loop-handlers.ts | grep -v knowledge-bridge || true"（零命中）

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
按 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md）执行，并将结论记录在本字段：
  ① 第一性原理 — 问题的最简本质是什么？最少机制能解决吗？
  ② Anthropic 工程基线 — 隔离/失败即关闭/脚本验证/机器可验契约，哪条适用？
  ③ 开源实证 — 有可克隆的代码/架构参考吗？clone 下来看实际做法
  ④ 收敛检查 — 两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
决策记录格式（K3 审计可核）: 参考：Anthropic/DeepSeek/第一性原理 + 结论
- 决策点 1（callExpert 实现方式）：最小机制 = 确定性差距分析（metric gap → adjust_target 中点），不接 LLM——cron 内 LLM 成本/失败面与 loop-1 轻量诊断定位不符。参考：第一性原理（最少机制）+ Anthropic（机器可验契约：确定性输出可断言）+ 结论：确定性差距分析。
- 决策点 2（goalId≠图节点 id，生产 getGoal 死路）：图节点 id 是 SqliteGraphStore 自动生成 node-<uuid>（sqlite-graph-store.ts:144），props.goalId 只是属性 → 生产 getGoal 必须 queryNodes('GOAL',{goalId},'growth')[0].props 映射。参考：Anthropic（机器可验：压测实测恒 null）+ 结论：queryNodes props 映射。
- 决策点 3（loop-6 企业发现）：OVERFLOW_SNAPSHOT/FINANCIAL 节点无任何生产写方（死查询），改 queryNodes('GOAL') distinct orgId + 'default' 回退（routes/overflow.ts:88 同款惯例）。参考：第一性原理（不查死数据）+ 结论：GOAL.orgId 发现。
- 决策点 4（loop-6 写后复读验证）：writeOverflowSnapshot 静默吞写失败（overflow-graph-bridge.ts:64-76）→ written++ 前必须 getCycleSnapshots limit:1 复读。参考：Anthropic（fail-closed 验证实际回写）+ 结论：复读验证。

### d) 相关 Note 引用
- [x] memory/notes/（本任务决策沉淀到 D475 完成报告 dev doc §3.2 回填 + 会话收尾写 memory；K3 审计以 dev doc 为准）

## Q2: 范围 — 正确的最简方案是什么？

做什么（认领写集，共 5 修改 + 3 新建）：
- src/agent/loop-handlers.ts — 修改：5 deps interface + 5 setter(null-reset) + diagnosis/navigation/overflow 真实化 + selfCheck/knowledge 新增，全 D333 不变量
- src/agent/main-agent.ts — 修改：selectHandler +loop-4/loop-5 专属路由、删 loop-5 错挂 evolution、默认分支注释
- tests/agent/loop-handlers.test.ts — 修改：+15 单元（5 handler × 正常/降级/边界）+ 2 集成（loop-4/5 路由）
- tests/agent/main-agent.test.ts — 修改：6 个既有用例 beforeEach 注入 fake deps（断言不变）
- src/l4/knowledge-store.ts — 修改：+recentStats(sinceIso)（时间窗口统计，双格式归一 SQL）
- tests/l4/knowledge-store.test.ts — 新建：recentStats ≥3 expect
- docs/plans/codex/implementation/SYNOVA-IMPL-D475-loop-handlers-realization-20260822.md — 新建（worktree 内）：S-6 回填最终形态
- .claude/task-briefs/2026-08-22-D475-loop-handlers-realization.md — 新建：本 brief

不做什么：
- 不改 src/monitoring/（分工规划 🔵 冻结，self-check 用 engine-context 内联实现）
- 不改 src/deploy/bootstrap.ts（🔵 冻结）
- 不改 src/sentinel/ 与 scripts/（DSH 地盘）
- 不改 src/loops/middle-evolution-engine.ts、feedback-collector（D333 已交付，只读消费）
- 不改 src/loops/loop-trigger-config.ts、src/loops/loop-scheduler.ts（deferred 记录 O3/O4/O5 不修）
- 不碰 D470（data-ingest-service.ts + tests/agent/data-ingest-service.test.ts + extensions/ontology/）与 D471（packages/）写集
- 不碰 客户A客户数据
- 不改 src/cycles/overflow-compute.ts、src/cycles/overflow-graph-bridge.ts、src/cycles/cycle-registry.ts（D338 并行改 overflow-graph-bridge.ts，本任务只经公开函数读写）
- 不改 src/growth/lightweight-diagnosis.ts（其吞 increment 异常 L423-428 由 handler 闭包侧验证，不修本体）
- 不 bump VERSION.md（运行时行为修复，非门禁/工具行为变化）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：Cron/事件调度 → LoopScheduler → main-agent.executeLoopScale(loopId, scale) → selectHandler（loop-1~loop-6 六循环，真实生产调用链）
处理（中间经过哪些步骤）：
- loop-1 diagnosis：queryNodes('GOAL') 取 active 目标（scale 定数量档）→ lightweightReDiagnosis 确定性差距分析 → 提案回写 + reDiagnosisCount 计数（复读验证）
- loop-2 navigation：queryNodes GOAL/PROPOSAL → 状态分布/完成率/近期提案/告警代理计数摘要
- loop-4 selfCheck：DB SELECT 1 + expert registry 非空 + scheduler 可达（初始化竞态重试一次）三查逐项报告
- loop-5 knowledge：KnowledgeStore.recentStats(scale 窗口 1/7/30 天) → 总量/分域/分源统计
- loop-6 overflow：registerLoadedCycles 自加载 → GOAL.orgId 企业发现 → 每企业×每循环 computeOverflow → writeOverflowSnapshot → 复读验证 written++ → 热力图摘要
结果（最终展示在哪）：LoopExecutionResult → executeLoopScale L189 status 映射（success→completed / degraded→degraded / 失败→failed）→ 审计记录真实状态（不再伪造 completed）→ 仪表盘/审计可见

## 架构层: L2 编排（+L4 knowledge-store 小扩展）
L1/L2/L3/L4/L5
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] 入口可触达: executeLoopScale → selectHandler 六循环各有专属 handler（grep defaultSelfCheckHandler/defaultKnowledgeAccumulationHandler 在 main-agent.ts 命中）
- [ ] 链路走通: vitest run tests/agent/loop-handlers.test.ts tests/agent/main-agent.test.ts tests/l4/knowledge-store.test.ts 全 pass（red 先行已证）；tsc --noEmit 零新增（基线 28）
- [ ] 结果可见: DS1-DS10 全过（grep lightweightReDiagnosis/computeOverflow 命中、git diff --name-only HEAD^ == 8 文件写集、bypass.log 无 no-verify、推送后 origin/main..HEAD 空 + CI 绿）
