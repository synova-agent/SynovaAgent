# Task Brief: D470 契约错位修复 — crm/hr field-mapping + ingest 目标 schema 校验（GS-02/04 转绿前置）

> 生成: 2026-08-22 01:15:29 | 分支: feat/win-d470-field-mapping-contract | as any: 0
> 追踪入库副本（2026-08-22 02:55 Win 补）: `*-auto.md` 被 .gitignore 忽略 → CI (G12) 不可见；按 D240/FEISHU-BRIDGE 追踪先例入库。CI runner 为 UTC，本 brief 在 2026-08-22 08:00 (+08:00) 后对 CI 可见（跨午夜日期）。
> 权威任务文档: docs/plans/codex/implementation/SYNOVA-IMPL-D470-field-mapping-contract-20260822.md（DSH Track A 🔴 最高）

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
- [x] 扩展（文件驱动，不改 TypeScript）

本任务属于哪个系统（GA诊断/哨兵/基础设施）？触及哪层？该层现有模块？新增/替换/扩展？

- 系统: 数据接入（D357 MVP 上传路径: POST /api/data/upload → src/routes/data.ts → src/agent/data-ingest-service.ts → GraphStore）
- 触及层: L2 编排（src/agent/data-ingest-service.ts，修改）+ L4 本体资产（extensions/ontology/field-mappings/ + resource/，文件驱动扩展）
- 现有模块: data-ingest-service.ts 已有 loadFieldMapping/loadFinancialSchema/ingestRow/ingestBatch（D357 交付）；本体资源 schema 已存在于 resource/（13 文件）与 outcome/（8 文件）
- 操作: 修改（ingest 校验源从 financial.json 改为目标节点类型 schema）+ 扩展（crm/hr 映射补字段、client/person schema 补 optionalProps）+ 新建（单元测试）

### b) 文件审计
grep 关键词（field-mapping/revenue/status/skills/teamId/loadNodeTypeSchema）在 extensions/ 中：

- extensions/ontology/field-mappings/ 8 个映射: crm-standard（targetNodeType=Client, 7 映射无 revenue/status）、hr-standard（Person, 7 映射无 name/skills/role/teamId）、erp-standard（Financial）、erp-operational（Operational）、competitive-intel、external-intel、innovation-pipeline、risk-register —— **扩展 crm/hr 两个文件，其余 6 个零触碰**
- extensions/ontology/resource/client.json（optionalProps 8 个无 revenue）、person.json（optionalProps 5 个无 skills/domains/teamId）—— **扩展 2 个文件**
- extensions/sentinels/customer-demand-shift/ 与 key-person-risk/（消费方哨兵，读取 revenue/status/churn/name/skills/role/teamId）—— **只读对齐契约，禁止修改（DSH 地盘）**
- 关系: 复用（loadFieldMapping/loadFinancialSchema 既有函数）；扩展（映射+本体 schema 文件驱动）；新建（tests/agent/data-ingest-service.test.ts，该服务当前零测试覆盖）；无冲突（与 DSH 写集零文件交集，已核实）

### c) 决策
- 字段校验白名单错误地绑定 financial.json（缺陷 A 根因）→ 无既有覆盖，按目标节点类型加载 schema 修复；映射/本体字段扩展走文件驱动（不改 TypeScript 类型系统，铁律 46 无关）。
- 难决策点（skills vs domains 数组 / status vs boolean churn / schema 缺失行为 / schema 搜索范围）→ DECISION-REFERENCE 四步已执行，结论记录于 Q1c。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — DS1-DS8（任务文档 §6，全部 grep/verify 可验证）
  ② 测试 — tests/agent/data-ingest-service.test.ts 先写，red 先行（用例 1 修复前失败于 financial 白名单跳过）
  ③ 实现 — 4 个 JSON + data-ingest-service.ts（loadNodeTypeSchema + warnings 信号）
  ④ 接线 — 新函数被 ingestBatch 调用（生产入口 src/routes/data.ts 已有链路，零改动）
  ⑤ 验证 — 自检 6 问 + vitest 全绿 + tsc 基线 28=28

引用依据:
  - 铁律 0-2: spec → test → impl → wire → review → merge（dev doc 已是 spec，测试先行）
  - 铁律 7: 入口可触达（POST /api/data/upload 既有）+ 链路完整 + 结果可见（节点 props 含业务字段）
  - 铁律 24+31: 目标 schema 缺失 → warn + warnings 信号（fail-open 非静默）；未知 prop 跳过 → warnings 数组（非只 log.warn 无痕）
  - 铁律 33: tests/agent/data-ingest-service.test.ts（单元）
  - 铁律 38: 新代码仅 JSON.parse 单断言 as，零 as any
  - 铁律 47/48: loadNodeTypeSchema 有 JSDoc 契约；5 用例全部真实 expect 断言
  - memory: 2026-08-16-d355-l4-contract（D355 同型 field-mapping 收敛先例）、2026-08-06-D316-dev-doc-verification（dev doc 声称须独立核验——本任务 §2 审计已 3 agent + 人工复核）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: "新函数 loadNodeTypeSchema 必须被 ingestBatch 调用（接线）"
  verify: "grep -n 'loadNodeTypeSchema' src/agent/data-ingest-service.ts"
- rule: "crm/hr 映射新增 prop 必须出现在目标 schema 白名单（契约闭环）"
  verify: "grep -n 'revenue\|\"status\"' extensions/ontology/field-mappings/crm-standard.json extensions/ontology/resource/client.json"
- rule: "不触碰 DSH 地盘文件（extensions/sentinels/、scripts/golden-scenarios/、src/l3/key-person-risk.ts）"
  verify: "git diff --name-only HEAD | grep -E 'extensions/sentinels/|scripts/golden-scenarios/|src/l3/key-person-risk' ; test $? -ne 0"

### c) 决策参考系（S-12 决策点 1-3 原案 + 本任务新增决策）
- 决策点 1（hr 知识领域 skills 逗号串 vs knowledge/domains 数组）: 参考：第一性原理（最少机制，ingest 现仅支持 number/string，parseDomains 已原生消费 skills.split(',')，零新增类型系统）+ 结论：skills 逗号串
- 决策点 2（crm 流失语义 churn boolean vs status string）: 参考：Anthropic（契约以消费方为准，aggregate L36 已支持 status==='churned' 且 client.json 已有 status）+ 结论：status:'churned'
- 决策点 3（目标 schema 缺失行为）: 参考：Anthropic（失败即关闭）+ DeepSeek（最少机制）+ 铁律 24/31 → 结论：warn + 跳过校验（fail-open）+ warnings 信号可追溯，不阻断上传
- 决策点 4（schema 搜索范围 resource/ vs resource/+outcome/）: 参考：第一性原理（校验语义=对齐目标节点类型，物理目录是实现细节；5 个既有映射 schema 在 outcome/，只搜 resource/ 会误判缺失失去校验）+ 收敛检查（双参考系同指）→ 结论：resource/ → outcome/ 双目录搜索（对 dev doc §3.1 字面的偏离，按 §3.2 S-6 同 commit 回填）
- 决策点 5（Financial 回退）: 参考：Anthropic（向后兼容逐位保留 legacy 空白名单语义，loadFinancialSchema 不产生 dead code）→ 结论：显式 if (targetNodeType==='Financial') return loadFinancialSchema()
- 决策点 6（未知 prop 非静默通道）: 参考：铁律 31（信号传播优于纯 log）+ 已核实 IngestResult 唯一构造点 → 结论：IngestResult 新增必选 warnings: string[]
- 决策点 7（period/聚合指标不补 Client/Person schema）: 参考：Anthropic（机器可验契约，消费方只读 revenue/status/name/skills/role/teamId）+ 第一性原理（聚合指标不是 Person 属性）→ 结论：不补，行为等价（financial 白名单跳过 → 目标 schema 跳过），通道从静默变 warnings，测试固化
- 决策点 8（pre-commit 组 8 tags 门禁硬阻断: 触碰 client/person.json 暴露遗留漂移——13 个 resource schema 全部使用未注册标签，tags.json 三层体系从未迁移覆盖）: 参考：第一性原理（门禁意图=registry 唯一真相；schema 是既定生产语义——ontology-loader 运行时按原始 tags 匹配、getTypesByTags 唯一消费者查询 'human'，re-tag 无合法等价物且 'resource' 对应 ENTITY_DIRS 目录族语义）+ 开源实证（本仓库 D32 a128df7a 同场景先例: "同步修复 tags.json 注册 outcome 标签（8个outcome JSON均使用但缺失注册）"，同 commit）+ 收敛检查（re-tag=扭曲语义/改 registry=吸收语义，双参考系同指 registry）→ 结论：tags.json domain.values 同步注册 resource 族缺失 8 标签（resource/market/intangible/distribution/legal/physical/supply_chain/ai），同 commit + 提交信息注明

### d) 相关 Note 引用
- [ ] memory/notes/<四态>/YYYY-MM-DD-<主题>.md（本任务决策沉淀到哪条 Note；无则新建 proposed）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/data-ingest-service.ts — 新增 loadNodeTypeSchema（Financial 回退 + resource/outcome 双目录搜索）；ingestBatch 按 mapping.targetNodeType 校验；IngestResult/ingestRow 增加 warnings 必选字段（跳过/降级信号非静默）；不扩展 ingest 类型系统（不新增 boolean/array 支持，用 status/skills 字符串规避，见 Q1c 决策点 1/2）
- extensions/ontology/field-mappings/crm-standard.json — 增 收入→revenue(number) + 客户状态→status(string)
- extensions/ontology/field-mappings/hr-standard.json — 增 姓名→name/知识领域→skills/角色→role/所属团队→teamId（均 string）
- extensions/ontology/resource/client.json — optionalProps 增 "revenue":"number"
- extensions/ontology/resource/person.json — optionalProps 增 "skills":"string"+"domains":"array"+"teamId":"string"
- tests/agent/data-ingest-service.test.ts — 新建 5 用例（red→green）
- extensions/ontology/tags.json — 同步注册 resource 族缺失标签 8 个（D32 先例，门禁组 8 硬阻断修复，见 Q1c 决策点 8）

不做什么（含文件路径）：
- 不修改 extensions/sentinels/customer-demand-shift/、extensions/sentinels/key-person-risk/（哨兵 compute=DSH 地盘，通过映射对齐契约）
- 不修改 src/l3/key-person-risk.ts（消费方，只读对齐）
- 不修改 src/routes/data.ts（生产入口已有链路，零改动）
- 不修改 scripts/golden-scenarios/GS-02-customer-cycle/、scripts/golden-scenarios/GS-04-talent-cycle/（fixture=DSH 地盘）
- 不修改 extensions/ontology/field-mappings/ 其余 6 个映射、resource/ 其余 11 个 schema、outcome/financial.json
- 不修改 VERSION.md（数据契约修复，非门禁/工具行为变化）
- 不修改 packages/engine-core/（铁律 46）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：POST /api/data/upload（body: { mapping: "crm-standard"|"hr-standard", rows: [{中文外部字段: 值}], graph }）——D357 MVP 上传路径，本任务零改动

处理（中间经过哪些步骤）：loadFieldMapping → ingestBatch → loadNodeTypeSchema(mapping.targetNodeType) 加载目标 schema 白名单 → 逐行 ingestRow（白名单校验/类型转换/PII scrub/standardKey）→ createNode 写入 Client/Person 节点

结果（最终展示在哪）：Client 节点写入 revenue/status（aggregate 可算 churn/revenueChurnRate）；Person 节点写入 name/skills/role/teamId（key-person-risk 可算 busFactor）；未知 prop 与 schema 缺失在响应 warnings 中可见（非静默）；GS-02/04 在 DSH 更新 fixture 后重跑转绿

## 架构层: L2 编排（src/agent/data-ingest-service.ts）+ L4 本体资产（extensions/ontology/）
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: grep -n "ingestBatch" src/routes/data.ts 命中（生产入口已有，回归确认）
- [ ] 链路走通: vitest run tests/agent/data-ingest-service.test.ts 5 用例全 pass（red 先行已证: 修复前用例 1 失败于 revenue 被 financial 白名单跳过）
- [ ] 结果可见: crm 行 → Client 节点 props.revenue/status 写入；hr 行 → Person 节点 props.name/skills/role/teamId 写入；未知 prop/schema 缺失 → IngestResult.warnings 可见
- [ ] 契约 grep: DS1-DS3（loadNodeTypeSchema 被调用 + financial 回退 + crm/hr 映射与 schema 字段命中）
- [ ] 零回归: vitest run tests/data-pipeline.ingest.integration.test.ts 绿 + tsc --noEmit 基线 28=28
- [ ] 范围一致: git diff 与写集一致（7 文件 + dev doc §3.1/§3.2 回填，含 tags.json 同步注册），不碰 DSH 地盘
