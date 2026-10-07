# Task Brief: D810 LLM 韧性层三入口接线（retry-middleware / context-compaction / timeout）

> 生成: 2026-09-18 | 任务: D810 | 认领: DeepSeek Harness（编码 session B）
> 编号说明: 首次 alloc 返回 D809，但另一 session 已在 `.synova-wt-d809`（分支 `fix/d809-pending-wiring`）
> 占用同号——alloc-task-id.sh 只扫本工作树 `task-state/`，看不到其他 worktree 的登记。
> 本任务改取 D810（重跑 alloc 得到），D809 归 pending_wiring 标记任务。缺陷已登记控制塔队列。

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图

Synova = AI 诊断 Agent（L1 交互 → L2 编排 → L3 洞察 → L4 本体 → L5 存储）。

本任务**跨 L1/L2/L3 的 LLM 调用缝**：不改能力本身，只把已落代码但**零生产调用**的韧性层
（重试 / 超时 / 上下文压缩溢出恢复）接到真实调用链上。属"机制建成未接线"（M3）修复。

被审事实链（K3 `2026-09-18-K3-DSH借鉴合规专项.md` §四 P0-1，origin/main @ 9af013e4）：
- `src/llm/retry-middleware.ts` 零 import（`grep -rn "from.*retry-middleware" src/` 空）
- `src/llm/timeout.ts` 唯一消费者是未接线的 retry-middleware → 链式死码
- `src/store/retry-projection.ts` 唯一 import 是自家测试 → `appendRetryEvent` 零生产调用
- 生产 LLM 调用点直连 `provider.chat`（routes/diagnosis.ts:283、routes/conversations.ts:124 等）
- B-05（context-compaction）K3 判 **已接线**（conversation-engine.ts:48/394/401/596），本任务做接线证据现验 + 缺口补齐

### b) 文件审计（全部 read + grep 现查，file:line 实证）

现有能力（作为被接线对象）：
- `src/llm/retry-middleware.ts:205` `callWithResilience`（协作式 outcome，永不抛）、
  `:278` `streamWithRetry`（idleWatchdog 包流）、`:365` `callWithRetry`（语义冻结，测试锁定）
- `src/llm/timeout.ts:46` `clampTimeout` / `:65` `deadline` / `:106` `idleWatchdog`；`:24` `TOOL_TIMEOUT_CODE`
- `src/agent/context-compaction.ts:228` `ContextCompaction` / `:181` `wrapProviderWithOverflowRecovery`
- `src/store/retry-projection.ts:87` `appendRetryEvent`（签名收 `SessionStore` 具体类 → 见 Q2 改造）

生产直连 `provider.chat` 调用点（13 处代码行，另有 2 处为注释）：
`src/agent/tool-loop-executor.ts:61/164/185/296`、`src/routes/conversations.ts:124`、
`src/routes/diagnosis.ts:283`、`src/orchestrator/context-engine.ts:308`、
`src/services/background-review.ts:130/146`、`src/expert-platform/extractor.ts:67/119/170`、
`src/l3/synova-diagnosis-engine-impl.ts:300`（后者经 `this.llm.chat` 适配器——由 L1 装配点覆盖）

### c) 决策

复用既有三模块，**不新建能力**；新增 1 个装配缝文件（`resilient-chat-adapter.ts`）收敛
两处 routes 重复的适配器字面量 + 提供可测缝。冲突检查：`grep -rn "callWithResilience" src/`
零命中 → 无重复实现，不取消。

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

**业界（Anthropic 决策链）**：LLM 调用的重试/超时必须落在**调用边界**且以**可路由的结果码**
暴露给调用方（fail-closed 不是 fail-crash）；超时是"调用方耐心预算"而非传输故障——
二者归类不同，不可混用一个 catch。

**开源实证（DeepSeek / DSH 现行安装 0.1.6-alpha.1，源码现读）**：
`@deepseek-ai/dsh-tool-call-timeout-policy/lib/index.js:115-133` — 武装
`deadline(exec.signal, timeoutMs, 'TOOL_TIMEOUT')` → 委派 → **本层定时器命中时替换为结构化结果**
（`isError:true` + `error.info.code='TOOL_TIMEOUT'`），**不抛异常、不放弃 promise**；
消费方按 `error.code` 路由（注释原文：`so a retry/sandbox plugin (and replay) can route on it`）。
`dsh-llm-retry` 以 provider 级 retryPolicy 注册 + 退避执行，策略解析一次冻结。

**memory / 铁律教训**：铁律 4/5（写了代码没接线）/ 铁律 37（dead code 入仓库即违规）/
铁律 0-2（WIRE CHECK 硬门禁）/ D593 交付时"CI 绿 ≠ 接线"（M3 第 N 次实证）。

**参考：Anthropic（结果码可路由 + 降级不静默）+ DeepSeek DSH 协作式超时实证 + 第一性原理
（最少机制：一个 outcome 缝 + 各调用点按 code 降级）→ 收敛。** 结论：调用点消费
`callWithResilience` 的 outcome，按 `code` 走各自既有降级路径；不得抛裸异常中断主循环。

## Q2: 范围 — 正确的最简方案

做什么（PR-1 写集 = 本表，≤12 文件，D734 PR 预算）：
- src/llm/retry-middleware.ts — 新增重试事件落盘缝（`RETRY_EVENT_KIND` / `RetryEventSink` /
  `appendRetryEvent`，共享基础设施层）+ `pickChatOptions` 白名单补齐 tools/cacheConfig
  （原实现静默丢弃 tools——接线后会让工具循环退化为无工具调用）
- src/agent/tool-loop-executor.ts — 4 处 `provider.chat` → `callWithResilience`（协作式 outcome，
  失败按 code 降级返回文案，**不抛**）；`onRetry` → 重试事件落 D500 事件流
- src/agent/engine-context.ts — 补 `sessionStore?` 结构缝（L2 不 import L5 具体类，铁律 39）
- src/store/retry-projection.ts — 只保留投影定义与注册（写入缝按铁律 39 上移 src/llm）；
  读同一 `RETRY_EVENT_KIND` 常量（防 M7 双源漂移）
- src/deploy/bootstrap.ts — 副作用导入 `store/retry-projection`（投影单元注册，同 session-projection 范式）
- tests/agent/tool-loop-executor-resilience.integration.test.ts — 新建：驱动**真实生产类**
  （ToolLoopExecutor），断言重试生效（attempt≥2）/超时不抛+TOOL_TIMEOUT 降级文案/重试事件落盘
- tests/store/retry-projection.test.ts — 落盘缝迁移后 import 路径同步（行为零变）
- memory/notes/implemented/2026-09-18-d810-llm-resilience-wiring.md — 决策 Note（铁律 49）
- .claude/task-briefs/2026-09-18-D810-llm-resilience-wiring.md — 本 brief
- task-state/D810.json — impl 段回填

后续 PR（PR-2，本 PR 不含；D734 预算 12 文件上限，拆 PR 是门禁指定处置）：
- src/llm/resilient-chat-adapter.ts（新建装配缝）+ src/routes/diagnosis.ts + src/routes/conversations.ts
  （L1 装配点 → L3 诊断引擎 LLM 调用全链）
- src/l2-interfaces/diagnosis-engine.ts + src/l3/synova-diagnosis-engine-impl.ts（分类码透传到 SSE）
- src/orchestrator/context-engine.ts + src/services/background-review.ts + src/expert-platform/extractor.ts
  （其余 5 处 LLM 调用点）
- docs/synova/product-lines/evidence/test-2026-09-18.json（20-3/20-5/22-1 绑定证据）

不做什么：
- 不改 scripts/audit/ 下任何文件（K3 红线，永不修改审计脚本）
- 不改 src/providers/registry.ts（failover chain 内部 chat 直连是传输层，非调用点）
- 不改 src/providers/deepseek.ts（provider 实现层）
- 不改 docs/synova/product-lines/product-lines.yaml（判据源：yaml 点条文改动需线主/CTO 裁决）
- 不改 docs/synova/product-lines/evidence/D806-borrow-cards-20260918.json（D806 已落库证据，只增不改）
- 不改 src/agent/context-compaction.ts（B-05 能力已接线，零改动即零回归风险）
- 不改 src/llm/tool-result-pruner.ts（D587 已接线，非本任务范围）

## Q3: 验收 — 入口 → 交互 → 结果

入口：用户在桌面端/CLI/MCP 发起一轮对话或 `POST /api/diagnosis/consult` 六阶段诊断。

处理：LLM 调用经 `callWithResilience` 武装 deadline + 重试策略；可重试失败指数退避重试，
截止超时归类 `TOOL_TIMEOUT` **以 outcome 形式返回**（`ok:false, kind:'timeout', degraded:true`）；
重试事件经 `onRetry` → `appendRetryEvent` 落 D500 会话事件流（`kind:'llm_retry'`）。

结果：
- 对话路径（tool-loop）失败 → 用户看到降级文案（不崩溃），日志含稳定 code + degraded:true
- 诊断路径（consult 适配器）失败 → `LlmResilienceError` 带 code → 引擎既有降级分支
  （`degradedModules=['phase2_llm']` + error 事件），报告按降级产出而非 500
- `grep -rn "callWithResilience\|streamWithRetry" src/` 命中生产调用点（非测试文件）

## 架构层: L1(交互) + L2(编排) + L3(洞察) 调用缝；src/llm 为共享基础设施层

## Done 标准

- [ ] verify: `grep -rn "callWithResilience" src/ --include="*.ts" | grep -v "^src/llm/retry-middleware.ts" | wc -l` ≥ 6（生产调用点 grep 命中）
- [ ] verify: `bash scripts/workflow/verify-incremental.sh` L1-L4 全绿
- [ ] verify: `npx vitest run tests/llm/resilient-chat-adapter.test.ts tests/agent/tool-loop-executor-resilience.integration.test.ts` 全绿且含 expect 断言
- [ ] verify: 断开反证——把 tool-loop-executor 的 callWithResilience 换回直连 provider.chat 后，重试计数断言必红（sed 注入 → vitest 必 fail → 还原）
- [ ] verify: `bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh` exit 0（8/8 契约断言；LLM 组按环境如实 RED）
- [ ] verify: `python3 scripts/product-lines/evidence-writer.py --type test --verdict pass --points 20-3,20-5,22-1` 产出证据文件且 verdicts[].acceptance_point 命中
- [ ] verify: `SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh` exit 0
- [ ] verify: `bash scripts/control-tower/simulate-ci.sh` exit 0
