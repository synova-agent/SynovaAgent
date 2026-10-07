# Task Brief: 0-6 本体 Schema 校验器静默放行改可见降级（#980）

> 生成: 2026-10-08 01:16:22 | 分支: feat/win-0-6-schema-degraded | as any: 0
> 工作树: D:\novis-backup-20260526\Novis\.synova-wt-980（独立工作树） | 基线 origin/main@9e9e4bd9d3c5844c51de48e2c42f25d2d2e904ea

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

### 三层解耦体系

**纵向解耦：五层物理隔离** — 代码按 L1-L5 分层，每层只与相邻层通信；pre-commit 物理阻断跨层 import。
**横向解耦：独立 Monorepo 包** — 五层内部拆为独立包（@synova/sog-core / @synova/ontology 等），接口边界明确。
**扩展解耦：文件驱动，不改代码** — 新本体实体类型 = 加 JSON Schema 文件（**本卡正服务这条**：JSON Schema 是本体类型键的权威源）。

流程约束: V4.5.1 — task brief 6 字段 + 免疫系统 + 13 组物理阻断 + Plan-Actual 闭合。

数据流: L5 存储 → L4 本体 → L3 洞察（哨兵定时+诊断按需）→ L2 编排 → L1 交互

L1 入口: POST /api/diagnosis/consult / Cron→Sentinel.check() / GET /chat / MCP
五层架构:
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/ expert/
  L4 本体: l4/ evidence/（本卡所在层：`src/l4/sog-schema-validator.ts`）
  L5 存储: store/ cron/

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
- 纵向（改 L1-L5 代码/架构）✅ —— 改 L4 本体层 1 个文件 `src/l4/sog-schema-validator.ts`（`if (!schema) return []` 静默放行 → 显式降级 + 聚合可见）
- 系统：基础设施（本体层数据入库校验），非 GA 诊断/哨兵业务面。
- 该层现有模块：`src/l4/` 26 文件；本卡对象 = SOG 数据入库 Schema 校验（v3.3 20.5）。
- 新增/替换/扩展：**扩展**（不替换、不新建模块）。新增判据交付物探针 1 个 + 测试 2 个。

### b) 文件审计
- `git grep -n "sog-schema-validator" origin/main` ⇒ 仅 `src/l4/graph-bridge.ts:20`（import）+ 本文件 `:2/:10` ⇒ **单消费方，无并行实现**（不存在第二套校验器）。
- `git ls-tree -r --name-only origin/main -- scripts/control-tower/ | grep probe` ⇒ **空**（92 文件中零 probe）⇒ 判据交付物须本卡新建，无同名冲突。
- `grep -rn validateNodeProps|validateAndLog`（61 处引用全文见 `.claude/reference-map.md`）⇒ `validateNodeProps` 仅 1 个**文件内**调用方（`:169`）⇒ 改动爆炸半径小。
- 关系：**复用**现有模块与现有真 GraphStore（`src/adapters/sqlite-graph-store.ts` + `src/agent/graph-store-service.ts`），**新建**仅探针与测试。无冲突。

### c) 决策
- 已有覆盖 → 复用（不新建校验器、不新建 store）。
- 冲突取舍 → 见 Q1c 决策参考系（(a)/(b) 选型已用四步框架裁为 (b')）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC / Done 标准 — 见 Q3 + 计划 §6（逐条带 verify 命令）
② 测试 — 先写 `tests/l4/sog-schema-validator.test.ts` + `.integration.test.ts`（先确认红）
③ 实现 — 只改 `:141` 路径 + 聚合器 + 2 个导出；错误路径有 `log.warn` + 降级可见
④ 接线 — 消费者 = `scripts/control-tower/probe-diagnosis.ts`（同 PR），生产写入链 = `graph-bridge.ts:82`（不改，验其行为不变）
⑤ 验证 — 自检 6 问 + 反例必红（V5/V6）

引用依据：
  - 铁律 0-2: spec → test → impl → wire → review → merge
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见
  - 铁律 24+31: 错误处理 + 降级信号传播（本卡核心）
  - 铁律 33: 测试命名约定（`*.test.ts` / `*.integration.test.ts`）
  - 裁定 #1317 R26（凡真库路径必须至少一条 integration 覆盖）+ R28（探针地雷）+ R29（必需检查现查）

### b) 本任务执行约束（写入 plan.json principles）
- rule: "未覆盖类型必须产生聚合可见信号，且 count 为去重聚合而非逐条"
  verify: `npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -n "未覆盖类型"`
- rule: "不得阻断写入 — 命中未覆盖类型时 store.createNode 仍返回 nodeId"
  verify: `npx vitest run tests/l4/sog-schema-validator.integration.test.ts`
- rule: "改动不得触碰 graph-bridge.ts（签名与调用点不变）"
  verify: `git diff --name-only origin/main...HEAD -- src/l4/graph-bridge.ts` ⇒ 必须空

### c) 决策参考系（四步框架结论）
- ① 第一性原理：问题本质 = "无 schema"这一状态必须**可见**；最少机制 = 在**已存在的返回载体**（`ValidationError[]` 元素）上挂标记 + 一个模块级聚合器，而非新增返回通道。
- ② Anthropic 工程基线：机器可验契约 + 失败可见（不 fail-open 静默）；不阻断是卡面硬约束（40 类型一次全红会打断生产写图）。
- ③ 开源实证：无对应物（DSH 无本体层）；不引代码，仅借"清单声明"范式。
- ④ 收敛检查：两参考系**收敛** ⇒ 选 (b')（元素携带 `degraded` + 聚合边沿告警 + 显式清单导出），**不改签名、不扩写集**。
- 决策记录：参考：第一性原理（最少机制）+ Anthropic（机器可验/失败可见）+ 铁律 31 ⇒ 结论 (b')。

### d) 相关 Note 引用
- [ ] memory/notes/proposed/ 建 `2026-10-08-0-6-schema-degraded-visibility.md`（本卡决策沉淀；放行后随 PR 落）

## Q2: 范围 — 正确的最简方案是什么？

做什么（本次暂不实施，先交计划等放行）：
- `src/l4/sog-schema-validator.ts`：`:141` 静默放行 → 显式降级（元素 `degraded` 标记 + 去重聚合计数 + 边沿触发 `log.warn`）；新增 `getUncoveredTypeStats` / `resetUncoveredTypeStats`
- `tests/l4/sog-schema-validator.test.ts`（新建，单元：正常/降级/边界 + 聚合去重 + 文案）
- `tests/l4/sog-schema-validator.integration.test.ts`（新建，真 SQLite `/tmp`）
- `scripts/control-tower/probe-diagnosis.ts`（新建，判据交付物；**待治理线窗时隙**）
- `docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md`（本卡计划件）
- `.claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md`（本 brief 自身）
- `memory/notes/proposed/2026-10-08-0-6-schema-degraded-visibility.md`（决策 Note，D534 纪律）

不做什么（含文件路径）：
- 不改 `src/l4/graph-bridge.ts`（§3.1 裁定后无需；verify: `git diff --name-only` 对该路径为空）
- 不改 `packages/ontology/src/node-types.ts`（卡面 §③ 约束 7；自述 29 vs 实际 40 记录在案，属命名收敛另卡）
- 不补 `extensions/ontology/**` 的 Schema（卡面 §③ 约束 5；`pool/*`15 + `external/*`16 无源 → 另卡）
- 不碰 `scripts/audit/**`、`.github/workflows/**`、`src/growth/**`、`src/routes/workspace-data.ts`（#1322 写集）
- 不做改名（`ValidationError` 同名异义属 N4 收敛，登记不改）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：`npx tsx scripts/control-tower/probe-diagnosis.ts`（判据命令，登记件 V1 原文）
处理（中间步骤）：探针在 `/tmp` 建真 SQLite → `SqliteGraphStore` → `createGraphBridge` 包装 → 逐类型写节点（40 斜杠 + 8 大写）→ `validateAndLog` 命中未覆盖类型 → 聚合计数 + 边沿告警 → 读 `getUncoveredTypeStats()`
结果（最终展示在哪）：stdout 出现 `未覆盖类型 N 个`（N = 去重聚合数）+ 类型清单；`store.createNode` 仍返回 nodeId（不阻断）；日志行含 `nodeType` 可定位

## 架构层: L4

## Done 标准
- [ ] 入口可触达: `bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q '未覆盖类型'"` ⇒ exit 0
- [ ] 链路走通: 真库路径下 40 个斜杠类型全部被记为未覆盖（去重聚合 = 40）；`'GOAL'` 不在清单
- [ ] 结果可见: 日志含 `未覆盖类型 N 个` + `nodeType`；`store.createNode` 返回值仍非空（不阻断，改动前后对照原文）
- [ ] 反例必红: 还原 `:141` 为 `return []` ⇒ V1 红；去掉元素 `degraded` ⇒ U3 红（前后原文都留档）
- [ ] 真库覆盖: `npx vitest run tests/l4/sog-schema-validator.integration.test.ts`（R26 强制）

#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->
