# Task Brief: D819 — 工具接线三修（出站带 tools + 响应侧 tool_calls 映射 + assistant 不重复）

> 生成: 2026-09-19 | 分支: feat/d819-tool-wiring-pilot | 基线: origin/main 00c784fc（含 D817 验证基建） | as any: 0
> 派单: docs/synova/coordination/派单-批十一-P0-1-P0-2-20260918.md §A/D819
> 规格: docs/plans/2026-09-19-D819-改动清单.md（spec-d819 交付，684 行，行号当场 grep 核过）
> 验收口径: docs/synova/coordination/验收标准-穿真实入口-v1-20260918.md（五态 / 三问自查 / 四条禁止）
> 卡: task-state/D819.json ｜ 前置: D817（假上游 + 生产入口 harness，已合入 main）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位

### a) 项目拼图
- 本任务在 **L2 编排（src/agent/tool-loop-executor.ts）↔ LLM 适配层（src/providers/）** 的接缝上：修的是"工具 schema 出不去、工具结果回不来、配对 id 是假的"三处断点。
- 已有覆盖：无。工具循环组件、`ChatResult.toolCalls` 字段、`ChatOptions.tools` 类型**都在**，但生产路径上三处断开（D817 出站抓包实证 `body_keys_union` 无 `tools`；角色序 `[system,user,assistant,assistant,user]`）。
- 结论：**接线修复**（不改架构、不加依赖、不加测试开关），并复用 D817 的验证基建作判据来源。

### b) 文件审计（开工当场核过，行号基于 origin/main 00c784fc）
```
src/providers/base.ts                 ❌ body 组装无 tools；chat() 只取 choices[0].message.content（响应侧 tool_calls 丢弃）
src/providers/types.ts                ❌ ToolCall 无 id/type（响应类型 ChatCompletionResponse.choices[].message.tool_calls 有 id）
src/agent/tool-loop-executor.ts       ❌ assistant 丢 tool_calls（:131-134）、8 处 tool_call_id=crypto.randomUUID()、流式终态 assistant 双推
src/agent/conversation-engine.ts      ✅ 终态 assistant 唯一 owner（:720/:726 非流式、:785/:790 流式）→ 本卡零改动
src/llm/retry-middleware.ts           ✅ pickChatOptions 已透传 tools（:256）→ 丢弃点确在 provider 边界
src/routes/conversations.ts           ✅ :242 registerBuiltinTools 生产注册点（:252 processMessageStream 生产入口）
tests/helpers/fake-llm-upstream.ts   ✅ D817 交付的假上游（只读复用，不修改）
tests/agent/tool-loop-tool-pairing.integration.test.ts ❌ 新建
```

### c) 决策（D333 四步）
参考：第一性原理（配对合法性由**模型给的 id** 决定，不是本地唯一即可）+ Anthropic 工程基线（穿真实入口、禁 grep 当完成）+ DSH 纪律（机制要在生产入口可验证）→ **收敛**：透传 + 映射 + 同源配对，全部走既有类型与既有缝，零新依赖零新分支。
- 响应映射放 provider 边界（`base.ts chat()`）：它是"协议翻译层"，最清楚上游形状；工具循环只消费 `ChatResult.toolCalls`。
- 缺 id 兜底放 provider 边界（`call_resp_<n>`）+ 工具循环再加一层（`call_loop_<n>`）：保证替身/非规范上游也**结构合法**，且**确定性**（禁 crypto 随机）。
- 去重修在工具循环侧而非引擎侧：引擎 push 是非流式路径的唯一终态写入，删它需回填 4 个 return 分支（改动面更大、更易漏）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC（派单 §B + 规格 §2）→ ② 测试先行（先写穿真实入口的三路径用例，再改 src）→ ③ 实现（types → base → tool-loop 对称修）→ ④ 接线（D817 的 it.fails 翻转 + 新用例进 vitest include）→ ⑤ 验证（命令 + 原始输出 + 证据落盘）。
引用: 铁律 0-2（测试先行+接线验收）、铁律 11/24/31（静默降级禁止 / catch 有 log / degraded 传播）、铁律 12（集成测试走真实路由不 mock 管线）、铁律 33/34（命名 / feature branch）、铁律 37（死代码）、铁律 38（as any 零容忍）、铁律 47/48（契约 + 非空壳断言）、铁律 49（决策沉淀 Note）。

### b) 执行约束
- rule: "出站体透传 tools（无 tools 时不加 key）" verify: grep -n "body.tools = opts.tools" src/providers/base.ts
- rule: "响应侧 tool_calls 映射进 ChatResult.toolCalls" verify: grep -n "toolCalls" src/providers/base.ts
- rule: "8 处随机 UUID 归零" verify: bash -c '! grep -q "crypto.randomUUID" src/agent/tool-loop-executor.ts'
- rule: "工具循环只推中间态 assistant（终态由引擎）" verify: bash -c 'test "$(grep -c "role: .assistant" src/agent/tool-loop-executor.ts)" = "2"'
- rule: "D817 三条证词已翻正（无 it.fails 残留）" verify: bash -c '! grep -q "it.fails" tests/integration/production-entry-conversation.integration.test.ts'
- rule: "穿真实入口三路径全绿" verify: CI=1 npx vitest run tests/integration/production-entry-conversation.integration.test.ts tests/agent/tool-loop-tool-pairing.integration.test.ts

## Q2: 范围

做什么：
- src/providers/types.ts（ToolCall 加可选 id/type，纯增量）
- src/providers/base.ts（body 透传 tools；chat() 映射 tool_calls + 空 content 判定修正 + 缺 id 确定性兜底）
- src/agent/tool-loop-executor.ts（normalizeToolCalls 归一化；assistant 带 tool_calls；8 处 tool_call_id 用同源 id；删两处终态 push；删 crypto 死 import）
- tests/agent/tool-loop-tool-pairing.integration.test.ts（新建：真实 createServer + 真路由 + 假上游；正常/降级/边界三路径）
- tests/integration/production-entry-conversation.integration.test.ts（D819 裁决①：3 条 it.fails 翻正向 + 头注释/testimonies 文案同步 + ⑤ 补捕获变量）
- tests/stream-tool-loop.test.ts（D819 裁决②：把"tool_call_id 必须是 UUID 形态"改成"等于模型给的 id / 非随机 UUID / 非函数名"）
- docs/synova/product-lines/evidence/D819-capture-20260919.json（新建：测试运行时机器生成、确定性）
- task-state/D819.json（impl 段 + status=impl_done）
- .claude/task-briefs/2026-09-18-D819-tools-in-body.md（本文件）
- memory/notes/proposed/2026-09-18-D819-tools-and-tool-call-pairing.md（D472 生命周期来源侧）
- memory/notes/implemented/2026-09-18-D819-tools-and-tool-call-pairing.md（同一次 git mv 的目标侧 —— rename 的 from 侧同样进变更集，D708 merge-writeset-gate 要求显式声明）

不做什么：
- 不改 src/agent/conversation-engine.ts — 终态 assistant 唯一 owner，零改动（报告给代码级理由）
- 不改 tests/helpers/fake-llm-upstream.ts — D817 假上游只读复用
- 不改 docs/synova/product-lines/evidence/D817-capture-20260918.json — 跑完 D817 用例后 git checkout 还原，不提交重写（#644 未合，避免冲突）
- 不改 vitest.config.ts — 不放宽/收紧 CI 排除清单（验收标准红线）
- 不改 package.json — 零新依赖
- 不改 src/l3/synova-diagnosis-engine-impl.ts — 诊断 consult 路径内部形状 tools 当前不可达，另开卡
- 不改 src/store/session-store.ts — D820 域
- 不改 scripts/audit/audit-rules.sh — K3 审计域（红线）
- 不改 scripts/control-tower/alloc-task-id.sh — 控制塔域（红线）

## Q3: 验收

入口: POST /api/conversations（真实 createServer + PORT=0 + 真实 fetch）→ ConversationEngine.processMessageStream → ToolLoopExecutor → callWithResilience → provider.chat → base.ts fetch（唯一替身 = 127.0.0.1 假上游，管线全真）
处理: 假上游脚本化返回 tool_calls → provider 映射进 ChatResult.toolCalls → 工具循环执行真实内置工具 → assistant(tool_calls) + tool(配对 id) 入上下文 → 第二轮出站请求
结果: ① 出站体含 tools 且长度 == 进程内同源复算的注册工具数（36）② 第二轮出现 role='tool' 且 tool_call_id === assistant.tool_calls[].id ③ 第二轮角色序**精确等于** [system,user,assistant,tool] ④ D817 三条 it.fails 翻正并删除 ⑤ 证据落盘 D819-capture-20260919.json（确定性：两次运行 sha256 一致）

## 架构层: L2 编排（src/agent）↔ LLM 适配（src/providers）；被验证链路 = L1 src/routes/conversations.ts → L2 → src/providers/base.ts
#CRITERIA: B

## Done 标准
- [ ] 两条集成用例 CI=1 全绿（无 it.fails 残留）：verify: CI=1 npx vitest run tests/integration/production-entry-conversation.integration.test.ts tests/agent/tool-loop-tool-pairing.integration.test.ts
- [ ] 出站体工具数严格等于同源复算的注册工具数：verify: python3 -c "import json;d=json.load(open('docs/synova/product-lines/evidence/D819-capture-20260919.json'));s=d['scenarios'];print(all(all(r['tools_len']==d['registered_tool_count'] or r['tools_len']==0 for r in x['requests']) for x in s), d['registered_tool_count'])"
- [ ] 全部子场景配对合法且 SSE 收束：verify: python3 -c "import json;d=json.load(open('docs/synova/product-lines/evidence/D819-capture-20260919.json'));print(all(r['pairing_ok'] and x['sse_converged'] and not x['sse_error_frames'] for x in d['scenarios'] for r in x['requests']))"
- [ ] 随机 UUID 配对归零：verify: bash -c '! grep -q "crypto.randomUUID" src/agent/tool-loop-executor.ts'
- [ ] 排除面零改动：verify: bash -c 'test "$(git diff --name-only origin/main...HEAD -- vitest.config.ts package.json src/agent/conversation-engine.ts tests/helpers/fake-llm-upstream.ts | wc -l | tr -d " ")" = "0"'

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-18-D819-tools-in-body.md | task |
| docs/synova/product-lines/evidence/D819-capture-20260919.json | task |
| memory/notes/implemented/2026-09-18-D819-tools-and-tool-call-pairing.md | task |
| memory/notes/proposed/2026-09-18-D819-tools-and-tool-call-pairing.md | task |
| src/agent/tool-loop-executor.ts | task |
| src/providers/base.ts | task |
| src/providers/types.ts | task |
| task-state/D819.json | task |
| tests/agent/tool-loop-tool-pairing.integration.test.ts | task |
| tests/integration/production-entry-conversation.integration.test.ts | task |
| tests/stream-tool-loop.test.ts | task |
