# 0-1 循环点火（MainAgent 绑定）

#CRITERIA: A

## Q0:
定位：0-1 总闸 —— LoopScheduler 的 6 个内置 cron 循环从不点火。
现状（实测 2026-10-07）：全仓 `.setMainAgent(` 零调用 ⇒ 每次触发输出
`[D9] MainAgent 未注入 — 跳过 loop-N (degraded)` 后直接返回。
证据：`git grep -c bindMainAgent origin/main -- src/server.ts` = 0。

## Q1:
调研：权威施工单 0-1 原文（「让 setMainAgent 被真注入；或统一两处同名函数」）
+ #975 判据（`filenameToExportKey` 教训：把「必须记住的规矩」变成「结构上不可能错」）
+ 仓内既有全局单例惯例（getGlobalScheduler / setGlobalSentinelRunner）。
结论：用进程级惰性绑定 ⇒ 与 Bootstrap Phase 2e/2f 装配先后顺序无关。

## Q2:
做什么：
- src/loops/main-agent-binding.ts
- src/loops/loop-scheduler.ts
- src/server.ts
- tests/loops/main-agent-binding.test.ts
- tests/loops/loop-execution-wiring.test.ts
- tests/loops/probes/batch0a-probes.ts

不做什么：
- 不改 scripts/pre-commit-check.sh（本任务不碰门禁语义）
- 不改 .github/workflows/ci.yml（门禁语义唯一裁权在 CTO，非本任务）
- 不改 src/routes/loops.ts（其 MainAgentLike 单参签名为 main 存量问题，另开小卡）

## Q3:
入口：src/server.ts 的 createServer() → wireLoopExecution()
处理：new MainAgent() → registerLoop(LOOP_TRIGGER_MATRIX) → setMainAgent() + bindMainAgent()
结果：loop-1..6 的 cron 触发时经 getBoundMainAgent() 取到执行器并真执行（不再"未注入跳过"）

## 架构层:
L2 编排（agent/ + orchestrator/；本件改 src/loops/ 与 src/server.ts 装配层）

## Done 标准
- [x] 两条测试件全绿 verify: npx vitest run tests/loops/main-agent-binding.test.ts tests/loops/loop-execution-wiring.test.ts
- [x] loops 目录无连带回归 verify: npx vitest run tests/loops/
- [x] 改坏即红（拆掉 bindMainAgent 调用 ⇒ 必红） verify: grep -c 'bindMainAgent(mainAgent)' src/server.ts
- [x] tsc 零新增（基线 28） verify: npx tsc --noEmit 2>&1 | grep -c 'error TS'
