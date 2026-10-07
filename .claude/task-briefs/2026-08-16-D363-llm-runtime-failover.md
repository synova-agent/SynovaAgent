# Task Brief: D363 LLM 运行时 failover 接线 — createProviderChain 注入 ConversationEngine 生产路径

> 生成: 2026-08-16 | 分支: feat/win-d363-llm-failover | worktree: synova-wt-d363 | as any: 0
> dev doc: docs/plans/codex/implementation/SYNOVA-IMPL-D363-LLM运行时failover接线-20260816.md

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统（组织数字孪生诊断 + 持续增长导航系统）。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

五层架构: L1 交互(routes/tui/mcp) → L2 编排(agent/orchestrator) → L3 洞察(l3/sentinel/expert) → L4 本体(l4/evidence) → L5 存储(store/cron)。只能向下依赖相邻层。
LLM: providers/（DeepSeek, OpenAI, Gateway）— 跨层基础设施，各层均可消费。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务是 **LLM 基础设施接线（M3 缺陷修复）**——failover 机制已建成（registry.ts:26 createProviderChain 运行时 try-catch 切换），但生产路径零消费。
本任务改 **L2 编排层** src/agent/conversation-engine.ts（provider 注入处 :299），使 tool-loop-executor 消费的 ctx.provider 变为 failover chain。
现有模块: src/providers/registry.ts（ProviderChain/ProviderRegistry，本任务只 import 不修改）；src/providers/base.ts（CircuitBreaker 已接线 :81，不动）；src/agent/tool-loop-executor.ts（provider.chat 调用点，经 ctx 注入自动获得 chain，不动）。
新增/替换/扩展: **接线**（机制已有→生产消费），非新建机制。

### b) 文件审计
grep "createProviderChain|buildChain|getHealthyProvider" src/ 实测：registry.ts:26/135/122 三处定义，**全仓零生产调用方**（仅 registry.ts:144 内部自调 createProviderChain）。
grep "provider.chat" src/agent/tool-loop-executor.ts 实测：:42/:158/:137/:261 四处单 provider 直调，provider 来自 EngineContext（engine-context.ts:19，由 conversation-engine.ts:339 注入）。
grep "new ConversationEngine(" src/ 实测 6 处生产构造（cli.ts:118、tui-v2/index.ts:41、chat.tsx:169、mcp/index.ts:222、im-inbound.ts:180、fromState :699）——注入点集中在 constructor，改一处全链路生效。
healthCheck 消费方实测：orchestrator/context-engine.ts:274 `result.healthy` 单值契约 + tui-v2/lib/bootstrap.ts:105（构造前调用，不受影响）——chain 的 healthCheck 返回数组，**直接裸传会破坏 ContextEngine 契约**，必须适配聚合。
结论: 复用 createProviderChain + detectProviderFromUrl + createProvider（均已有）；无冲突；无需新建 providers 文件。

### c) 决策
接线点选 conversation-engine constructor（最小改动单点注入，6 个生产构造点全链路生效）；备用 provider 从环境变量派生（主 deepseek→备 openai；主非 deepseek→备 deepseek），EngineConfig 新增 fallbackProvider 供测试注入与显式禁用。
已有覆盖→复用。无覆盖→接线。冲突→无。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC/Done 标准 → ② 测试先行（red→green）→ ③ 实现 → ④ 接线（grep 物理证明）→ ⑤ 验证（自检 6 问）。
引用依据:
  - 铁律 0-2（AGENTS.md）: Step 5 WIRE CHECK 硬门禁，`grep -rn "新函数名" src/` 零结果=未完成
  - 铁律 5（AGENTS.md）: 后端能力 ≠ 用户可用功能——机制建成未接线 = M3 缺陷（本任务 K3 P1-1 修正结论）
  - 铁律 24+31: 每个 catch 有 log + degraded；降级显式传播（chain 全失败必须显式抛错，绝不静默）
  - 铁律 38: as any = 0（chain healthCheck 契约适配用显式聚合，不用 as unknown as 掩盖）
  - memory/2026-08-12-D330-kimi-k3-audit-fix.md: fail-open 吞信号=隐藏失效——备用 provider 凭据缺失必须 log 显式说明，不静默单飞
  - memory/2026-08-13-d333-decision-reference-framework: 决策参考系记录（Q1c）
  - 测试契约: tests/contract/contract-gate.test.ts 已有惯例（vitest describe/it/expect，真实断言非空壳）

### b) 本任务执行约束
  - rule: "备用 provider 凭据缺失 → log.info 显式记录 'failover 未启用'，保持单 provider 行为不变，绝不静默"
    verify: "grep -n 'failover 未启用' src/agent/conversation-engine.ts"
  - rule: "chain 的 healthCheck 数组返回必须聚合为单值 HealthCheckResult（LLMProvider 契约），ContextEngine.isLLMAvailable 依赖 result.healthy"
    verify: "grep -n 'healthCheck' tests/contract/llm-failover.test.ts"
  - rule: "所有 Provider 均失败 → 抛错（不静默），错误信息含全部失败 provider 名"
    verify: "grep -n '所有 Provider 均失败' tests/contract/llm-failover.test.ts"

### c) 决策参考系（D333）
决策点 1（dev doc §4.5）: 接线方式 = 直接 createProviderChain 注入 vs ProviderRegistry.buildChain 健康排序。
参考：第一性原理（buildChain 零调用且需 await healthCheck 网络请求，构造时阻塞；直接 chain 最小机制即可接线）+ Anthropic 工程基线（生产调用点真实传递，机器可验）+ DeepSeek（最少机制）。
结论：直接 createProviderChain 注入（dev doc §4.5 结论一致），健康排序留待后续升级。
决策点 2（实现新增）: 备用 provider 来源 = 环境变量派生 vs 生产调用方显式传入。
参考：第一性原理（6 个生产构造点逐一改 = 6 倍改动面；单点 constructor 派生最小机制）+ Anthropic 工程基线（显式可验证优于隐藏常量——派生逻辑 log 显式记录）。
结论：constructor 内 buildFallbackProvider 从 env 派生 + EngineConfig.fallbackProvider 显式注入通道（测试/未来调用方用）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/conversation-engine.ts: provider 注入处（constructor :299-300）单 provider → wrapProviderWithFailover(provider, fallbackProvider ?? env派生备用)；新增 wrapProviderWithFailover 导出（chain 包装 + healthCheck 数组→单值聚合适配）+ buildFallbackProvider（主 deepseek→备 openai，主非 deepseek→备 deepseek，凭据缺失返回 null + log）+ EngineConfig.fallbackProvider 可选字段
- tests/contract/llm-failover.test.ts: 新建。≥6 断言：主成功不切/主失败切备用/全失败抛错/chain 名称含顺序/stream 路径 failover/healthCheck 聚合契约/无备用返回原实例/生产路径故障注入（mock 主抛错→engine 回复来自备用，red 阶段证修复前直接抛错）

不做什么：
- 不重写 src/providers/registry.ts（createProviderChain 运行时 failover 已实现，只接线）
- 不修改 src/providers/base.ts（CircuitBreaker 已接线 :81）
- 不修改 src/providers/detect.ts（启动检测与运行时 failover 是两层，本任务只做运行时 failover）
- 不接线 src/l3/synova-diagnosis-engine-impl.ts（this.llm 是 LLMClient 接口，与 LLMProvider 不兼容，适配层属独立任务，dev doc §3.3 已排除）
- 不做 CredentialPool 凭据轮换（src/providers/registry.ts，独立能力）
- 不改 tool-loop-executor.ts 的 provider.chat 调用点（chain 满足 LLMProvider 接口，经 ctx 注入自动生效）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：任何生产入口（cli/TUI/MCP/IM）构造 ConversationEngine → constructor 将注入的单 provider 包装为 failover chain；用户对话触发 tool-loop-executor 的 provider.chat()。
处理（中间经过哪些步骤）：provider.chat 经 chain 分发 → 主 provider 成功直接返回；主 provider 抛错 → chain 捕获（log.warn 记录）→ 自动切换备用 provider 重试 → 备用成功返回；全部失败 → 抛"所有 Provider 均失败"（tool-loop 捕获 → 用户看到"抱歉，调用失败"）；备用凭据缺失 → 保持单 provider 行为不变（log.info 显式记录）。
结果（最终展示在哪）：用户对话在 DeepSeek 挂掉时自动由 OpenAI 兜底完成（无感知切换）；日志可见 "Provider 失败，尝试下一个" + 切换成功记录；测试 llm-failover.test.ts 全绿证明故障注入切换。

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D363-LLM运行时failover接线-20260816.md — dev doc §2 缺陷实测/§3 写集/§4 测试要求/§4.5 决策/§6 DS1-DS6
- AGENTS.md 铁律 0-2（接线验收）/铁律 5（后端能力≠可用功能）
- docs/synova/coordination/DECISION-REFERENCE.md — 决策参考四步框架
- docs/synova/coordination/MULTI-MACHINE-PR-WORKFLOW.md — 铁律 0-3 PR 工作流

## 接口审计（从代码 grep，非凭记忆）
- src/providers/registry.ts:createProviderChain
- src/providers/registry.ts:detectProviderFromUrl
- src/providers/index.ts:createProvider
- src/agent/conversation-engine.ts:ConversationEngine.processMessage

## 架构层: L2
src/agent/conversation-engine.ts 属 L2 编排层；providers/ 为跨层基础设施（架构检查无 L2→providers 限制，check-architecture.sh 实测仅查 L2→L4/L1→L3/L1→L4/L1→L5）。
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] DS1 `grep -n "createProviderChain" src/agent/conversation-engine.ts` ≥1 处生产调用
- [ ] DS2 `npx vitest run tests/contract/llm-failover.test.ts` 全绿（≥6 断言，red 阶段已证：主失败→修复前抛错→修复后切换）
- [ ] DS3 `grep -rn "provider.chat" src/agent/tool-loop-executor.ts` 确认 ctx.provider 是 chain（经 conversation-engine 注入），不再直接单 provider
- [ ] DS4 `python scripts/audit/audit-check.py --full | tail -2` FAIL/WARN 数与 HEAD 基线一致（纯接线无新增）
- [ ] DS5 `git diff --name-only HEAD~1..HEAD` 恰为写集 1 修改 + 1 新建（无越界）
- [ ] DS6 真实 push 验证：`git log @{upstream}..HEAD` 为空（已推送）+ CI task-relevant jobs 绿（vitest/tsc）
