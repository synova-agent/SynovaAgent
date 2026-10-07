# Task Brief: D751 新增生效硬断言——文件驱动哨兵端到端三环

> 生成: 2026-09-14 18:07:53 | 分支: main | as any: 0
> 派单: docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md §一（D751，P1 · 根）
> 依据: docs/synova/coordination/质询-可插件化-欠账登记-20260914.md §二 D751
> 前置: D750 已合入 main（5c4ae8a7）——聚合路由已用 manifest 权威 expert

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
Sentinel Finding[] → 信号聚合 → 专家路由 → 工单/报告

五层架构 (只能向下依赖相邻层):
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/
  L4 本体: l4/ evidence/
  L5 存储: store/ cron/
文件化扩展: extensions/sentinels/*/manifest.json — 新增哨兵 = 加目录（loader 扫描发现）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属「纵向」L3 洞察层哨兵体系（- [x] 纵向）。宣称「文件驱动：加哨兵目录即生效」，
但无任何断言证明「新增 → 被发现 → 被路由 → 进派发」。8/45 漏登记无人发现、
D750 错路由长期在产，根因同源：新增生效不可验证 = 静默失效。
现有模块：sentinel-loader（扫描）/ signal-aggregator（聚合+manifest expert 路由）/
runner（派发）。本任务 = 扩展测试覆盖 + 最小注入缝，不改机制。

### b) 文件审计
grep `loadSentinels|aggregateSignals|dispatchSignalsToExperts|SENTINELS_DIR`：
- src/sentinel/sentinel-loader.ts:48 SENTINELS_DIR 硬编码 cwd，无测试注入缝 → 夹具哨兵无法被真实 loader 发现；
- tests/sentinel/d750-expert-routing.test.ts 只测存量哨兵路由，无「新增哨兵生效」端到端断言；
- src/sentinel/runner.ts findSignalRoute/dispatchSignalsToExperts 无新增生效覆盖。
关系：复用（真实管线）+ 扩展（注入缝 ≤5 行/处）。

### c) 决策
已有覆盖 → 复用真实管线（loadSentinels 真扫描 + aggregateSignals 真聚合 +
SentinelRunner 真派发，仅 mock LLM 侧 ExpertDispatcher/expert-registry 边界）。
不新建机制。夹具层选 technology、expert 选 fundamental-efficiency（不同域），
消解「layer 默认映射巧合命中」的假绿。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC/Done 标准 = 三环断言全绿 + 反向验证必红。
② 测试先行：先写断言跑红（注入缝缺失 → 环 1 夹具不可发现 → 红）→ 加缝 → 绿。
③ 实现 = 注入缝（每处 ≤5 行，生产路径不变）+ 夹具 manifest/aggregate 对齐真实哨兵契约。
④ 接线 = 断言走真实 loadSentinels/aggregateSignals/dispatchSignalsToExperts 代码路径。
⑤ 验证 = 自检 5 问 + 反向验证两次输出。

引用依据：
- 铁律 0-2: spec → test → impl → wire（先红后绿）
- 铁律 12: 集成测试 cover 真实路由，不 mock 聚合/加载管线
- 铁律 38: as any / as unknown as 零容忍——私有方法访问用内联类型 as { 方法签名 }
- 铁律 48: expect() 断言覆盖正常路径（三环）+ 降级路径（fixture check 失败 → degraded）

### b) 本任务执行约束
- rule: "注入缝只经 SENTINELS_FIXTURE_DIR env，生产路径（无 env）行为不变"
  verify: "grep -c SENTINELS_FIXTURE_DIR src/sentinel/sentinel-loader.ts"
- rule: "夹具 manifest 契约对齐真实哨兵（id/name/expert/entryPoint/exportKey/layer）"
  verify: "npx vitest run tests/sentinel/d751-new-sentinel-e2e.test.ts"
- rule: "删夹具 manifest.expert → 断言必红（证明断言在读声明，非空跑）"
  verify: "npx vitest run tests/sentinel/d751-new-sentinel-e2e.test.ts（反向验证，exit 非零）"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论——「新增生效」断言必须跑在真实管线上
（Anthropic：机器可验契约；第一性原理：断言已存在行为的可观测输出 = 最少机制；
开源实证：真实 DI 缝用 env 覆盖资源根目录是标准做法）。收敛 → 直接执行。

### d) 相关 Note 引用
- 派单 + 质询欠账登记已在本单链路（docs/synova/coordination/），无新决策需沉淀 Note。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- tests/sentinel/d751-new-sentinel-e2e.test.ts（端到端三环断言：发现/路由/派发）
- tests/sentinel/fixtures/d751-sentinel-root/sentinel-e2e-fixture-01/manifest.json（夹具哨兵声明）
- tests/sentinel/fixtures/d751-sentinel-root/sentinel-e2e-fixture-01/aggregate.ts（夹具入口，exportKey 对齐 loader）
- src/sentinel/sentinel-loader.ts（注入缝：SENTINELS_FIXTURE_DIR 覆盖扫描根，每处 ≤5 行）

不做什么：
- 不改 src/sentinel/runner.ts（路由实现 D750 已定；注释漂移属 D754）
- 不改 src/sentinel/signal-aggregator.ts（聚合实现 D750 已定）
- 不改 extensions/sentinels/cash-runway/manifest.json（extensions/sentinels/** 属 Win 数据侧，派单红区）
- 不改 scripts/audit/check-bridge-files.sh（审计脚本，红线）
- 不改 .github/workflows/ci.yml（CI 属控制塔，派单红区）
- 不改 tests/sentinel/d750-expert-routing.test.ts（D750 已交付，独立认领）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：npx vitest run tests/sentinel/d751-new-sentinel-e2e.test.ts（并入 tests/sentinel 全量）
处理（中间经过哪些步骤）：夹具哨兵（= 新增的一个哨兵）经真实 loadSentinels 扫描发现 →
registerLoadedSentinels 动态 import 注册 → aggregateSignals 聚合（manifest expert →
recommendedExperts）→ SentinelRunner.dispatchSignalsToExperts（critical 交叉验证 →
targetExperts 并集 → runExpert 调用；仅 mock LLM dispatcher/registry 边界）。
结果（最终展示在哪）：三环断言全绿；删夹具 manifest.expert → 断言必红（反向验证）。

## 架构层: L3（洞察层：哨兵加载/聚合/派发均在 L3；测试在 tests/sentinel/）
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: npx vitest run tests/sentinel/d751-new-sentinel-e2e.test.ts → 全绿（三环断言：发现/路由/派发）
- [ ] 链路走通: verify: 反向验证——删夹具 manifest.json 的 expert 字段 → 同命令必红（exit 非零）；恢复后绿（两次原始输出入回报）
- [ ] 结果可见: verify: grep -c "SENTINELS_FIXTURE_DIR" src/sentinel/sentinel-loader.ts → ≥1（注入缝存在且被读）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-14-D751-new-sentinel-e2e-assertion.md | task |
| src/sentinel/sentinel-loader.ts | task |
| task-state/D751.json | task |
| tests/sentinel/d751-new-sentinel-e2e.test.ts | task |
| tests/sentinel/fixtures/d751-sentinel-root/sentinel-e2e-fixture-01/aggregate.ts | task |
| tests/sentinel/fixtures/d751-sentinel-root/sentinel-e2e-fixture-01/manifest.json | task |

