# Task Brief: D286: GraphStore 统一 — packages/graph-store 废弃 + 16 处引用迁移到原生 SqliteGraphStore

> 生成: 2026-08-02 01:48:08 | 分支: main | as any: 0

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
- 系统：**L4 本体层统一** — 消除 GraphStore 双轨（packages/graph-store 包 vs src/adapters/sqlite-graph-store.ts），实现 DASHBOARD §VII 架构债 #1 的"GraphStore 3 轨统一"目标
- 层级：L4 本体（adapters + 消费方横跨 L1 routes / L2 agent / L3 sentinel+knowledge / L4 adapters / L5 bootstrap）
- 现有模块：packages/graph-store（旧包，17 文件引用）→ 迁移目标 src/adapters/sqlite-graph-store.ts（原生，现有 4 方法）→ 需扩展
- 新增/替换/扩展：扩展 SqliteGraphStore 至完整 GraphStore 方法面 → 替换 17 处引用 → 归档旧包

### b) 文件审计
grep 本任务关键词（@synova/graph-store / createSynovaGraphStore / setGraphStoreDeletePermissionChecker / graph_nodes / _graph_nodes）实测（2026-08-02）：
- **17 个文件引用 @synova/graph-store**（任务文档列 16，实测多 1：src/tui-v2/chat.tsx L40-41 被文档遗漏）：
  - 配置 2：tsconfig.json L27 (paths)、vitest.config.ts L16 (alias)
  - src 14：adapters/engine-core-adapter.ts L76-79 / agent/conversation-engine.ts L40+L350 / deploy/bootstrap.ts L742+L750+L1119 / ingest/index.ts L34 / l3/knowledge-agent.ts L236 / mcp/index.ts L138 / mcp/tool-registration.ts L104 / routes/agent-observer.ts L11+L95 / routes/chat.ts L32 / routes/diagnosis-upload-v2.ts L931 / routes/ontology.ts L10-19 / sentinel/runner.ts L629-630 / tui-v2/chat.tsx L40-41
  - 测试 2：tests/l4/synova-graph-store.test.ts L2 / synova-graph-store-permission.test.ts L13
- **调用点方法面（超集 7 方法）**：createNode / createEdge（ingest L45、diagnosis-upload-v2 L832/850/865/900、ontology-event-bus consume）/ queryNodes / queryEdges（ontology L88/155/183、briefing-generator、sentinel-runner）/ queryTriples（tool-registration L127）/ getNode / updateNode
- **⚠️ 关键差异：SqliteGraphStore 仅 4 方法（createNode/queryNodes/getNode/updateNode），缺 createEdge/queryEdges/queryTriples → 直接替换 = 运行时 TypeError。必须先扩展**
- **表结构双轨**：旧包 graph_nodes+graph_triples（graph 默认 'default'、软删除 valid_to、WAL）；SqliteGraphStore _graph_nodes（graph 默认 'enterprise'）。生产库 data/synova.db 三表全 0 行 → 无数据迁移负担
- 现有 SqliteGraphStore 使用者：routes/auth.ts L16 + agent/synova-agent.ts L141（UserStore，graph='enterprise'，0 行）→ 表结构统一后仍工作
- tests/adapters/sqlite-graph-store.test.ts 不检查表名 → 改表无碍
- tests/packages/graph-store-wal.test.ts 纯 mock 测 WAL 降级逻辑，不 import 包 → 归档后仍可跑

### c) 决策
- 复用：src/adapters/sqlite-graph-store.ts（迁移目标，扩展而非重写表语义）
- 扩展：SqliteGraphStore 补齐 createEdge/queryEdges/queryTriples（+deleteNode/deleteEdge 保持接口完整），表结构对齐旧包 graph_nodes+graph_triples、graph 默认 'default'、启用 WAL（与旧包行为等价）
- 归档：packages/graph-store → packages/_archived/graph-store/（任务文档 §3.1）
- 冲突：无（与 D292/D300 零共享文件）；不做 engine-core 内部 graph-store（归 D288）

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — 任务文档 §6 DS1-DS8
  ② 测试 — 先写 tests/architecture/graphstore-unify.test.ts（red→green）+ 扩展现有 sqlite-graph-store.test.ts
  ③ 实现 — 刚好满足以下全部条件：
     - 扩展 SqliteGraphStore（createEdge/queryEdges/queryTriples + 表结构对齐 + WAL）— 有 JSDoc 契约（铁律 47）
     - 迁移 14 src + 2 测试引用 → SqliteGraphStore；删除 tsconfig paths + vitest alias
     - 删除 bootstrap L750-753 权限调用（行为等价，铁律：删除总是允许）
     - 归档 packages/graph-store → packages/_archived/graph-store/ + ARCHIVED.md
     - 错误路径有 log + 降级（铁律 24+31，SqliteGraphStore 现有模式：log.warn + 返回空）
     - tsc + vitest 零失败
  ④ 接线 — grep @synova/graph-store 全树零引用（DS1）
  ⑤ 验证 — 自检 6 问 + npm run dev 冒烟（DS7）

引用依据：
  - 铁律 0-2: spec → test → impl → wire → review → merge（先写 graphstore-unify.test.ts）
  - 铁律 7: 入口可触达（14 调用点全部换 import）+ 链路走通（哨兵/诊断/简报/本体全消费方）+ 结果可见（冒烟无 degraded graphstore）
  - 铁律 24+31: SqliteGraphStore 每个 catch log.warn + 返回空/抛出（沿用现有模式）
  - 铁律 38: as any=0，类型用 Database.Database / 明确接口
  - 铁律 46: 归档 ≠ 桥接 — 迁移必须是代码真换，grep 物理证明（DS1）
  - memory/grep-semantic-overreach.md 教训: v1 用路径字符串 grep 漏掉包名 → 必须 grep @synova/graph-store 包名
  - memory/engine-core-bridge-files.md 教训: 声称完成必须有 grep 物理证明

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "迁移后主树不得再引用 @synova/graph-store"
    verify: "grep -rn '@synova/graph-store' src/ tests/ tsconfig.json vitest.config.ts | wc -l"
  - rule: "SqliteGraphStore 必须提供调用点全部方法（createEdge/queryEdges/queryTriples）"
    verify: "grep -rn 'createEdge\\|queryEdges\\|queryTriples' src/adapters/sqlite-graph-store.ts"
  - rule: "权限检查器调用已删除（行为等价）"
    verify: "grep -rn 'setGraphStoreDeletePermissionChecker' src/ | wc -l"
  - rule: "归档包不得留在 packages/ 收集路径（无 npm workspaces，_archived 不被收集）"
    verify: "ls packages/graph-store 2>/dev/null | wc -l"

## Q2: 范围 — 正确的最简方案是什么？

做什么（严格按任务文档 §3.1 修订）：
- src/adapters/sqlite-graph-store.ts: 扩展为完整 GraphStore（createEdge/queryEdges/queryTriples/deleteNode/deleteEdge），表结构对齐旧包 graph_nodes+graph_triples（软删除 valid_to、graph 默认 'default'、WAL），保留 createNode/queryNodes/getNode/updateNode 现有签名
- src/adapters/engine-core-adapter.ts: createSynovaGraphStore → new SqliteGraphStore（+ Database 类型 import）
- src/agent/conversation-engine.ts: import + createGraphStore 回调迁移
- src/deploy/bootstrap.ts: 3 处（1c GraphStore 初始化 + L1119 简报）迁移 + 删除 setGraphStoreDeletePermissionChecker 调用（行为等价：原生无权限门）
- src/ingest/index.ts: 迁移
- src/l3/knowledge-agent.ts: 迁移
- src/mcp/index.ts: 迁移
- src/mcp/tool-registration.ts: 迁移
- src/routes/agent-observer.ts: import + 构造迁移
- src/agent-observer/collector.ts: 参数类型 GraphStore(14方法) → 最小接口(3方法: queryNodes/updateNode/createNode)，适配 SqliteGraphStore（接口隔离，非兼容层）
- src/routes/chat.ts: 迁移
- src/routes/diagnosis-upload-v2.ts: 迁移
- src/routes/ontology.ts: import + getStoreFromLocals 类型迁移
- src/sentinel/runner.ts: 迁移
- src/tui-v2/chat.tsx: 迁移（任务文档遗漏的调用点）
- tests/l4/synova-graph-store.test.ts: import 改为原生 SqliteGraphStore
- tests/l4/synova-graph-store-permission.test.ts: 改写为原生 SqliteGraphStore 删除语义测试（权限机制已废弃）
- tests/architecture/graphstore-unify.test.ts: 新建（先写，red→green）
- tests/adapters/sqlite-graph-store.test.ts: 扩展覆盖新方法（createEdge/queryEdges/queryTriples/deleteNode）
- tests/packages/graph-store-wal.test.ts: 改写为 SqliteGraphStore WAL 行为测试（任务文档误判：实测该测试 L57 import 包路径，归档后套件失败；enableWAL 已非导出 API → 改为真实 db 验证 WAL 启用 + :memory: 降级）
- tsconfig.json: 删除 L27 paths 条目
- vitest.config.ts: 删除 L16 alias
- packages/graph-store/: 移动 → packages/_archived/graph-store/ + ARCHIVED.md（废弃说明 + 替代方案）
- packages/_archived/graph-store/package.json: 归档包清单
- packages/_archived/graph-store/tsconfig.json: 归档包编译配置
- packages/_archived/graph-store/ARCHIVED.md: 废弃说明
- packages/_archived/graph-store/src/graph-store.ts: 归档实现
- packages/_archived/graph-store/src/index.ts: 归档入口
- packages/_archived/graph-store/src/types.ts: 归档类型

不做什么：
- 不改 packages/engine-core 内部 graph-store（D288 范围）
- 不改 src/l4/graph-bridge.ts 的 engine-core 引用（D292/D288 范围）
- 不删 src/adapters/sqlite-graph-store.ts（是迁移目标）
- 不改 src/l4/traversal-permission-filter.ts（D293 范围）
- 不写兼容层/桥接文件（铁律 46）
- 不做数据迁移（生产库 graph 三表 0 行）
- 不新增 createNodes/createEdges/traverse/findPaths/queryByTags/getNodeAtTime（无生产调用点 = dead code，铁律 37）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：14 个 src 调用点（诊断/哨兵/本体/简报/MCP/TUI/ingest/bootstrap）+ 2 测试
处理（中间经过哪些步骤）：
  1. graphstore-unify.test.ts 先写 → red（grep @synova/graph-store > 0）
  2. 扩展 SqliteGraphStore → 迁移 14+2 调用点 → 删配置 → 归档
  3. graphstore-unify.test.ts green；synova-graph-store*.test.ts 用原生实现全过
结果（最终展示在哪）：
  - `grep -rn "@synova/graph-store" src/ tests/ tsconfig.json vitest.config.ts` → 0（DS1）
  - packages/_archived/graph-store/ARCHIVED.md 存在（DS2）
  - tsc --noEmit 零新增错误（DS4）；vitest 4 套件全绿（DS5）
  - npm run dev 启动无 graph-store 相关报错（DS7）；pre-commit 8 组全过（DS8）

## 架构层: L4
L4 本体（adapters）+ 消费方 L1/L2/L3/L5 调用点

## Done 标准
- [ ] 入口可触达: 14 个 src 调用点全部使用 SqliteGraphStore，`grep -rn "@synova/graph-store" src/ tests/ tsconfig.json vitest.config.ts` → 0
- [ ] 链路走通: graphstore-unify.test.ts（≥8 expect，先 red 后 green）+ synova-graph-store 2 测试 + sqlite-graph-store 扩展测试 + graphstore-compatibility 全绿；tsc --noEmit 零新增错误
- [ ] 结果可见: packages/graph-store → _archived + ARCHIVED.md；npm run dev 冒烟无 graphstore 报错；pre-commit 全过；推送后 CI 通过
