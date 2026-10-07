# Task Brief: D477 standardKey 块读收敛 + outcome 族 4 标签注册（D470 审计遗留 #2/#3）

> 生成: 2026-08-23 | 分支: feat/win-d477-standardkey-tags | as any: 0
> 权威任务文档: docs/plans/codex/implementation/SYNOVA-IMPL-D477-standardkey-tags-cleanup-20260823.md（dev doc，§1-§8 全部 file:line 实测）
> 依赖: D470（目标 schema 校验已合并——本任务收其审计遗留 #2/#3）；并行: D476（写集零交集，session-registry 已核实无重叠认领）

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

流程约束: V4.5.1 — task brief 6 字段 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查 + Q2 排除项验证 + verify 执行 + 全仓库 engine-core 扫描 + 壳包检测 + vitest --changed 增量回归 + grep 物理门禁 + 决策参考四步框架。

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
- [x] 扩展（文件驱动，不改 TypeScript）

本任务属于哪个系统（GA诊断/哨兵/基础设施）？触及哪层？该层现有模块？新增/替换/扩展？

- 系统: 数据接入（SynovaAgent 持续增长导航系统中 D357 MVP 上传路径: POST /api/data/upload → src/routes/data.ts → src/agent/data-ingest-service.ts → GraphStore）
- 触及层: L2 编排（src/agent/data-ingest-service.ts，修改）+ 扩展层（extensions/ontology/tags.json，修改——组 8 门禁数据源）
- 现有模块: data-ingest-service.ts 已有 loadFieldMapping/loadFinancialSchema/loadNodeTypeSchema/ingestRow/ingestBatch（D470 交付）；tags.json 三层标签契约（domain/object/industry，pre-commit 组 8 硬阻断数据源）
- 操作: 修改（standardKey 块 period 来源从行级英文键收敛到白名单映射值）+ 修改（domain.values 注册 4 标签）+ 修改（单元测试新增用例 6）；零新建文件、零新增 export（纯逻辑收敛）

### b) 文件审计
grep 关键词（standardKey/row['period']/props.period/tags/environment/external/growth/control）实测：

- src/agent/data-ingest-service.ts L201-209: standardKey 块 L203 `const period = row['period']` 直读输入行英文键，绕过 L168-199 映射白名单（缺陷 A，D470 审计 #2）
- src/l4/graph-bridge.ts L77-94: 消费方——props.standardKey 触发 D29 冲突检测、props.period 触发 D33 时间字段推导（只读消费，零改动）
- extensions/ontology/outcome/external.json tags ["outcome","environment","external"]、innovation.json tags ["outcome","strategic","growth"]、risk.json tags ["outcome","risk","control"] —— environment/external/growth/control 4 值不在 tags.json domain.values（缺陷 B，D470 审计 #3）
- extensions/ontology/tags.json L7: domain.values 23 值实测，缺上述 4 值；D470 同先例已注册 resource 族 8 标签（a128df7a 后合并）
- extensions/ontology/field-mappings/erp-standard.json: 期间→period(string)（Financial 白名单内 → 修复后生成 standardKey）；crm/hr-standard.json: 期间→period（Client/Person 白名单外 → 修复后仍跳过）
- tests/agent/data-ingest-service.test.ts: D470 5 用例（用例 5 Financial 回归 props.period 断言存在、无 standardKey 断言——修复后新增 standardKey 不影响既有断言）
- 关系: 修改 data-ingest-service.ts（复用既有函数，无新 export）+ 注册 4 标签（复用 D470 先例）+ 扩展测试（新增用例 6）；无冲突（与 D476 写集 src/l3/ga-collaboration.ts+src/agent/interactive-card.ts+src/routes/overflow.ts+tests/l3+tests/routes 零交集；与 DSH 线 scripts/、src/sentinel/ 零重叠；session-registry 已核实无重叠认领）

### c) 决策
- 缺陷 A（standardKey 块读行级英文键）→ 无既有覆盖，修复：period 取映射白名单校验后的 props.period，删除英文键直读。
- 缺陷 B（outcome 族 4 未注册标签）→ 无既有覆盖，注册：tags.json domain.values 补 4 值（D470 resource 族 8 标签同先例）。
- 难决策点 2 个（standardKey 的 period 取哪 / 注册标签 vs 改 Schema tags）→ DECISION-REFERENCE 四步已执行（dev doc §4.5），结论记录于 Q1c。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — dev doc §6 DS1-DS8（全部 grep/verify 可验证，映射到本 brief Done 标准）
  ② 测试 — tests/agent/data-ingest-service.test.ts 先写用例 6，red 先行（英文 period 键注入 → 修复前失败；中文键 standardKey 缺失 → 修复前失败）
  ③ 实现 — data-ingest-service.ts standardKey 块收敛 + tags.json 注册 4 值
  ④ 接线 — 无新增 export（接线 = 白名单语义 + 门禁数据源）；标准消费方 src/l4/graph-bridge.ts 只读不变
  ⑤ 验证 — 自检 6 问 + vitest 全绿 + tsc 基线 28=28 + check-file-driven.sh 组 8 通过

引用依据:
  - 铁律 0-2: spec → test → impl → wire → review → merge（dev doc 已是 spec，测试先行）
  - 铁律 7: 入口可触达（POST /api/data/upload 既有链路零改动）+ 结果可见（standardKey 按 D29/D33 契约生成 / 旁路关闭）
  - 铁律 24+31: 本任务改动块无新增 catch（标准键块为纯推导，无 I/O）；既有降级语义保留
  - 铁律 33: tests/agent/data-ingest-service.test.ts（单元）
  - 铁律 38: 零新增 as any
  - 铁律 47/48: 无新增 compute 函数；用例 6 全部真实 expect 断言
  - memory/2026-08-22-d470-ci-brief-visibility.md（brief 须追踪名入库 + CI UTC 日期）、memory/2026-08-16-d355-l4-contract.md（L4 数据契约收敛同型先例）、memory/2026-08-06-D316-dev-doc-verification.md（dev doc 声称须独立核验——本任务 §2 审计已逐条 file:line 实测复核）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: "standardKey 块不得再直读行级英文键 row['period']（白名单旁路关闭）"
  verify: "grep -n \"row\['period'\]\" src/agent/data-ingest-service.ts ; test $? -ne 0"
- rule: "standardKey 生成必须消费映射白名单校验后的 props.period"
  verify: "grep -n 'props.period\\|standardKey' src/agent/data-ingest-service.ts"
- rule: "outcome 族 4 标签必须注册进 tags.json domain.values（组 8 数据源）"
  verify: "grep -n 'environment\\|external\\|growth\\|control' extensions/ontology/tags.json"

### c) 决策参考系（dev doc §4.5 原案，S-12）
- 决策点 1（standardKey 的 period 取哪）: 参考：第一性原理（白名单是 D470 建立的权威边界，standardKey 不应成为旁路）+ Anthropic（一个通道一个规则）+ 结论：props.period（映射后值），删除 row['period'] 直读
- 决策点 2（outcome 标签注册还是改 Schema tags）: 参考：DeepSeek（最小改动；4 个标签语义有效——environment/external/growth/control 是合法领域维度，注册成本最低；改 Schema 会触碰 outcome 族 3 文件扩大爆炸面）+ 结论：注册 4 标签（与 D470 resource 族 8 标签先例一致）

### d) 相关 Note 引用
- [ ] memory/notes/<四态>/YYYY-MM-DD-<主题>.md（本任务决策沉淀到哪条 Note；无则新建 proposed）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/data-ingest-service.ts — standardKey 块 L203 `const period = row['period']` → `const period = props.period`（取映射白名单校验后的值）；删除英文键直读回退；props.period 缺失则跳过 standardKey 生成（与现状"无 period 不生成"语义一致）
- extensions/ontology/tags.json — domain.values 注册 environment/external/growth/control 4 值（outcome 族合法化，D470 resource 族 8 标签同先例）
- tests/agent/data-ingest-service.test.ts — 新增用例 6（①中文键「期间」行 standardKey 按 D29/D33 契约生成；②行级英文 period 键不再注入 props.period/standardKey；red→green）

不做什么（含文件路径）：
- 不改 extensions/ontology/outcome/external.json
- 不改 extensions/ontology/outcome/innovation.json
- 不改 extensions/ontology/outcome/risk.json
- 不改 src/routes/overflow.ts
- 不改 src/l3/ga-collaboration.ts
- 不改 src/agent/interactive-card.ts
- 不改 scripts/check-file-driven.sh
- 不改 VERSION.md

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：POST /api/data/upload（body: { mapping: "erp-standard"|"crm-standard", rows: [...] }）——D357 MVP 上传路径，本任务零改动

处理（中间经过哪些步骤）：loadFieldMapping → ingestBatch → loadNodeTypeSchema(mapping.targetNodeType) 白名单 → 逐行 ingestRow（白名单校验/类型转换/PII scrub → standardKey 块取 props.period）→ createNode；tags.json 注册 4 值供组 8 门禁校验全仓 Schema 标签

结果（最终展示在哪）：erp-standard 中文键「期间」行 → 节点 props.standardKey = `default:Financial:2026-Q2:2026-04-01`（D29/D33 契约）；crm-standard 行级英文 period 键 → 节点无 props.period/standardKey（旁路关闭）；outcome 族 tags 全部合法（check-file-driven.sh 组 8 通过）

## 文档引用
- CLAUDE.md §V4.5.1 铁律速览（0-2/7/24/31/33/38/46/47/48）+ §L4 本体层设计哲学 + §门禁系统
- docs/plans/codex/implementation/SYNOVA-IMPL-D477-standardkey-tags-cleanup-20260823.md（权威 dev doc §1-§8）
- docs/synova/coordination/DECISION-REFERENCE.md（D333 四步框架，已全文注入）

## 接口审计
- src/agent/data-ingest-service.ts:ingestRow(store, mapping, row, graph, validProps) — L201-209 standardKey 块（缺陷 A 现场）
- src/agent/data-ingest-service.ts:ingestBatch(store, mapping, rows, graph) — L231 loadNodeTypeSchema 白名单构建
- src/l4/graph-bridge.ts:createNode — 消费 props.standardKey（D29 冲突检测）+ props.period（D33 时间推导），只读不变
- extensions/ontology/tags.json:layers.domain.values — 组 8 门禁合法值集合（缺陷 B 现场）
- src/l3/period-utils.ts:deriveValidFrom(period) — standardKey validFrom 推导

## 架构层: L2 编排（src/agent/data-ingest-service.ts）+ 扩展层（extensions/ontology/tags.json）
#CRITERIA: A

## Done 标准
- [ ] DS1 standardKey 收敛: grep -n "row['period']" src/agent/data-ingest-service.ts 零命中（英文键直读已删）
- [ ] DS2 标签注册: grep -n "environment|external|growth|control" extensions/ontology/tags.json 命中（domain.values 四值）
- [ ] DS3 测试全绿: vitest run tests/agent/data-ingest-service.test.ts 全 pass（red 先行已证：英文键用例修复前失败）
- [ ] DS4 门禁回归: bash scripts/check-file-driven.sh 通过（outcome 族标签合法）
- [ ] DS5 零回归: D470 五用例 + Financial 回归绿 + tsc --noEmit 零新增（28=28）
- [ ] DS6 范围一致: git diff --name-only HEAD 与 Q2 写集一致（3 文件 + brief），无越界
- [ ] DS7 无绕过: grep -n "no-verify" .claude/bypass.log 零命中
- [ ] DS8 推送 + CI: git push 后 git log origin/main..HEAD --oneline 空 + CI 相关 job 绿
