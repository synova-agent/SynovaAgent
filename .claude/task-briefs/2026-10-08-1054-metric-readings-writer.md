# Task Brief: #1054（2-1b）· 测量值时序 · 写入侧（承重件 W1 的 writer 侧）

> 卡: **#1054**（施工项 2-1b，模块 K3 哨兵装载与时序落盘）｜CTO 2026-10-08 放行，**裁 C**
> 声明载体: `.claude/claims/1054.yaml`（issue 号卡 ⇒ D708 的 S0 源）+ 本 brief（pre-commit 组 6 载体）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
`src/sentinel/`（L3 洞察层）。承重件 **W1-时序**的 **writer 侧**：把哨兵判定用的输入取值落到 `metric_readings`（#1053 已建表）。
目的（宪章 §4.3 硬顺序「指标时序存储必须先于参数标定」）：**给参数标定供数** ⇒ 只有"指标级"行对标定有意义。

### b) 文件审计（实跑，origin/main@8258e6b8d）
- `metric_readings` 现有写入方 = **0** 处（2-1a 只建表）⇒ 本卡 = 第一个写入方
- `SentinelContext`（`src/sentinel/types.ts:161`）已有 `db`/`now`/`teamId` ⇒ sink 可经 context 注入（**可选** ⇒ 既有 45 哨兵零行为变化）
- 轮边界：`registry.runAll`（`:69-81`）与 `SentinelRunner`（`runner.ts:1399` ctx 构造 + `:1405` 直调 `check`）
- **样板选型**：`src/sentinel/adapters/cash-flow-sentinel.ts` —— **有真实内联 compute**（`:105 computeCashFlowMetrics` ⇒ `netMargin/revenueYoYGrowth/grossMargin` + `:110 runwayMonths`），且**在本卡写集内**（CTO 硬要求①：样板必须有真实 compute 数值）
- 在飞冲突：逐 PR `--json files` 查 ⇒ **0 命中 `src/sentinel/`**（开工前复核过；CTO 要求开工前再核）

### c) 决策
**裁 C**：通用 sink + 轮次级接线（其余 44 哨兵）+ **1 个指标级样板**。
不逐哨兵展开（`extensions/sentinels/**` 不在写集；45 目录 O(N) 风险）；其余 44 的指标级接线 = **后续卡**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 设计正本 `archive/25` §三 写点①（「这次判定用的输入取值」）+ 权威文档 15 §2.7（环比/同比/Mann-Kendall 需要本表）
- 表级不变量（#1053 裁定）：R4 三列缺省 ⇒ `degraded` 必须为 1 ⇒ 写侧**强制纠正**（不静默，铁律 24/31）
- 2-4（#1052 已合 `441c3004b`）写入门禁 = **文件写**面 ⇒ 本卡 SQLite 写入**不适用**；但**不得另造门禁**
- 铁律 47/48：sink 契约（@input/@output/@degraded/@invariant/@not-here）；测试非空壳
- 参考：第一性原理（承重件必须承重 = 指标级）+ DSH「domain/changed」可观测范式 ⇒ 返回值 + 行双证据

## Q2: 范围 — 正确的最简方案
做什么：
- src/sentinel/metric-readings-writer.ts — 新建：`recordMetricReading` / `createMetricSink` / `writeRoundReadings` / `writeMetricReadings`（契约 + 幂等 + 降级显式 + 永不抛）
- src/sentinel/types.ts — `SentinelContext` 增可选 `metricSink`（缺省 = 零行为变化）
- src/sentinel/sentinel-runner.ts — **teamId 接进 ctx**（A2）+ 可选/引擎回退 sink（诊断主链路径由此落行）
- src/sentinel/registry.ts — `runAll` 轮边界写轮次级（2 行/哨兵/轮；teamId 来自 ctx）
- src/sentinel/adapters/cash-flow-sentinel.ts — **指标级样板**：4 个 compute 指标落表（null 不写）
- tests/sentinel/metric-readings-writer.test.ts — 新建：10 例（正常/幂等/降级/边界/失败面/轮次级/样板指标级/V7 数据可用性/决策锁定夹具/只追加）
- .claude/claims/1054.yaml — 新建（S0，含 done）
- .claude/task-briefs/2026-10-08-1054-metric-readings-writer.md — 本 brief

不做什么（逐条含具体文件名）：
- 不改 src/store/migrations/001-graph-nodes-props.ts（迁移内容，2-1a 已交付）
- 不改 src/store/migrations/002-metric-readings.ts（表定义，属 #1053 写集）
- 不改 src/security/file-guard.ts（文件写门禁，2-4 已合；本卡无文件写入面）
- 不改 src/sentinel/runner.ts（**无 org 维度 ⇒ fail-closed 不写**；该文件净变更 = 0）
- 不改 src/tools/tool-registry.ts（其执行/权限面已在 0-11 拆除）

范围外约束（非文件级，不列入排除清单）：其余 44 哨兵的**指标级**接线 = 后续卡（本卡在覆盖面声明里列为**未覆盖面**）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：哨兵轮次（`SentinelRunner` cron/runOnce；或 `registry.runAll` 按需诊断）。
处理：sink 在轮边界写轮次级行；样板哨兵在判定点写指标级行（`metric_id` = compute 指标名、`value` = 本次取值）。
结果：`metric_readings` 出现**指标级**行（样板 1 个哨兵）⇒ 可供 before/after 差值（标定前提）。
**覆盖面**：指标级写入已接（覆盖面 = 样板哨兵 1 个；其余 44 个哨兵暂只有轮次级；写入点②/③ 未接）。
**轮次级只在 `runSentinelForTeam`（诊断主链）路径落行**；以下 **3 条路径零写入**（点名，不许沉默）：
① `runSentinelOnce` 降级直连（`src/agent/sentinel-service.ts`；经 HTTP/MCP 暴露）② `SentinelRunner` cron/`runOnce`（无 org 维度 ⇒ fail-closed）③ 周报 boss-mailbox（`server.ts` 的 `runAll({db,now,registry})`）。
**标定供数口径（写死）**：`metric_id NOT LIKE 'SENTINEL-%'`。

## Q4 契约与测试:
- 契约：`recordMetricReading` 五段 JSDoc（@input/@output/@degraded/@invariant/@not-here）；**永不抛**（失败 ⇒ `{written:false,degraded:true,reason}` + log.warn）
- 测试：10 例全含 `expect()`；覆盖正常/幂等/降级/边界/失败面/样板集成/V7 + 决策锁定夹具（R4 NOT NULL 变体）
- 反例：M1 禁用写入点 ⇒ 2/8 红（连带）；M2 = 夹具变体（常驻用例）；M3 去 `ON CONFLICT` ⇒ 幂等 1/9 红
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
L3（`src/sentinel/` 洞察层）→ 经 sink 类型依赖 L5 语义（不 import 存储实现）；测试面 `tests/sentinel/`

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/metric-readings-writer.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/
- [ ] verify: npx tsc --noEmit
- [ ] verify: test "$(git grep -nE '^[^*/]*DELETE[[:space:]]+FROM[[:space:]]+metric_readings' HEAD -- src/ | wc -l)" -eq 0
