<!--
  SYNOVA-IMPL-D470: 契约错位修复 — crm/hr field-mapping + ingest 目标 schema 校验（GS-02/04 转绿前置）
  状态: dev doc | 2026-08-22 | 优先级 P0
  权威文档: docs/synova/coordination/DSH-迁移分工规划-20260821.md（Track A：Win 契约错位修复 🔴 最高）; scripts/golden-scenarios/GS-02-customer-cycle/expect.json + GS-04-talent-cycle/expect.json; D355 dev doc（同型 field-mapping 收敛）; extensions/ontology/manifest.json（本体类型定义）
  依赖: D357 MVP 上传路径（src/routes/data.ts → data-ingest-service，已交付）
  并行: 写集=extensions/ontology/ + src/agent/data-ingest-service.ts + tests/agent/，与 DSH 线（src/sentinel/、scripts/golden-scenarios/、scripts/control-tower/）零文件交集；⚠️ GS-02/04 场景脚本（scripts/golden-scenarios/，DSH 地盘）依赖本任务交付的映射，DSH 在交付后重跑——**禁止并行改 extensions/ontology/field-mappings/**；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D470 契约错位修复（crm/hr field-mapping + ingest 目标 schema 校验）

## 1. 权威文档引用

* **DSH-迁移分工规划-20260821.md**（docs/synova/coordination/DSH-迁移分工规划-20260821.md §四）：「**Win | 契约错位修复**（crm-standard 补 revenue/churn、hr-standard 补 name/domains/role，D355 同型 field-mapping 收敛）| 🔴 最高」——本任务即该指令。归属核对（TASK-ROUTING v4）：`extensions/ontology/`（业务相关领域资产）+ `src/agent/`（诊断体系 L1-L5，data-ingest-service 非哨兵）均属 **Win Claude 线** ✓。
* **GS-02 expect**（scripts/golden-scenarios/GS-02-customer-cycle/expect.json）：`crm-upload-ok`（nodeType=Client）+ `demand-shift-critical-triggered`（customer-demand-shift critical）。
* **GS-04 expect**（scripts/golden-scenarios/GS-04-talent-cycle/expect.json）：`hr-upload-ok`（nodeType=Person）+ `key-person-risk-triggered`（key-person-risk critical）。
* **本体 manifest**（extensions/ontology/manifest.json）：节点类型 JSON Schema 是运行时权威（nodeTypes 29 / edgeTypes 16）。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A（根因）：ingest 字段校验用 financial.json，而非目标节点类型 schema
* `src/agent/data-ingest-service.ts` `ingestBatch()`：L189-190 `const schema = loadFinancialSchema(); const validPropNames = new Set([...Object.keys(schema.optionalProps), ...schema.requiredProps])` —— 无论 targetNodeType 是 Client/Person/Team，一律用 `extensions/ontology/outcome/financial.json` 做字段白名单。
* `ingestRow()` L129-131：`if (validProps && !validProps.has(m.prop)) { log.warn('字段不在financial Schema中→跳过'); continue; }` —— crm/hr 映射的全部 prop（market_share/nps/churn_rate/headcount/...）都不在 financial.json optionalProps（实测：financial.json 只有 total_revenue/gross_profit/... 等财务字段）→ **全部静默跳过** → Client/Person 节点仅写入 financialType/standardKey/period，业务字段全空。L196 把 validPropNames 传给 ingestRow。
* 结论：GS-02/04 的 `upload-ok` 断言能过（节点创建成功），但哨兵读到的 props 全空 → critical 永不触发（与 K3 全链路审计「L4 类型契约断裂」同根）。

### 缺陷 B：crm-standard.json 缺 revenue + churn/status 语义
* `extensions/ontology/field-mappings/crm-standard.json`：7 个映射（market_share/nps/customer_satisfaction/brand_awareness/client_concentration_hhi/churn_rate/period），**无 revenue、无 status**。
* 消费方 `extensions/sentinels/customer-demand-shift/aggregate.ts`：L34 `revenue: Number(n.props.revenue) || 0`、L35 `status: (n.props.status as string) || 'active'`、L36 `churn: n.props.churn === true || n.props.status === 'churned'` —— revenue 恒 0（revenueChurnRate=0、highValueAtRisk 空）、churn 恒 false（churnRate=0）→ 永不 critical。
* 注：`churn_rate`（number）≠ 消费方期望的 `churn`（boolean）/`status`（string）——纯数字流失率不被识别。

### 缺陷 C：hr-standard.json 缺 per-person 字段
* `extensions/ontology/field-mappings/hr-standard.json`：7 个映射全是团队聚合指标（headcount/turnover_rate/internal_promotion_rate/talent_density/e_nps/avg_tenure_months/period），**无 name/skills/role/teamId**。
* 消费方 `src/l3/key-person-risk.ts`：`parseDomains()` L39-42 读 `props.knowledge`（数组）| `props.domains`（数组）| `props.skills`（逗号分隔串）；`extractPersons()` L46-50 读 `props.name`（L48）/ `props.teamId`（L49）/ `props.role`（L50）。Person 节点无这些 props → `persons.length===0` → 空 findings → GS-04 critical 永不触发。

### 缺陷 D：本体 schema 缺可选属性
* `extensions/ontology/resource/client.json`：optionalProps 有 churn_risk/status/lifetime_value/... **无 revenue**。
* `extensions/ontology/resource/person.json`：optionalProps 有 email/role/competency_vector/tenure_months/is_key_person，**无 skills/domains/teamId**（name 为 required ✓）。
* 若缺陷 A 修复为「按目标类型 schema 校验」，映射新增的 revenue/skills/teamId 会被目标 schema 拒 → 必须同步补本体可选属性（本体=extensions/ontology，Win 线 ✓）。

### 缺陷 E（验证过的边界）：ingest 类型支持
* `ingestRow()` L139-149：仅支持 `number`（L139 Number 转换）与其余（字符串 + PII scrub L143-148）；无 boolean/数组类型。规避：hr 知识领域用 `skills`（逗号分隔字符串，parseDomains L42 `split(',')` 直接消费）；crm 流失语义用 `status: 'churned'`（字符串，aggregate L36 直接消费）——**不改 ingest 类型系统、不改哨兵 compute**（哨兵=DSH 地盘，本任务零触碰）。

## 3. 实现方案

### 3.1 写集 (6 修改 + 1 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/agent/data-ingest-service.ts | 修改 | 新增 `loadNodeTypeSchema(targetNodeType)`：按 `mapping.targetNodeType` 加载 `extensions/ontology/resource/{type}.json`（optionalProps+requiredProps 并集）；`ingestBatch` 校验改用之，targetNodeType=Financial 时回退 financial.json（向后兼容）；目标 schema 缺失 → warn + 跳过校验（fail-open，不静默） |
| extensions/ontology/field-mappings/crm-standard.json | 修改 | 增 `{ "externalField": "收入", "prop": "revenue", "type": "number" }` + `{ "externalField": "客户状态", "prop": "status", "type": "string" }` |
| extensions/ontology/field-mappings/hr-standard.json | 修改 | 增 `{ "externalField": "姓名", "prop": "name", "type": "string" }` + `{ "externalField": "知识领域", "prop": "skills", "type": "string" }` + `{ "externalField": "角色", "prop": "role", "type": "string" }` + `{ "externalField": "所属团队", "prop": "teamId", "type": "string" }` |
| extensions/ontology/resource/client.json | 修改 | optionalProps 增 `"revenue": "number"`（status/churn_risk 已有） |
| extensions/ontology/resource/person.json | 修改 | optionalProps 增 `"skills": "string"` + `"domains": "array"` + `"teamId": "string"` |
| extensions/ontology/tags.json | 修改 | 同步注册 resource 族缺失标签 8 个（resource/market/intangible/distribution/legal/physical/supply_chain/ai，D32 a128df7a 同场景先例——pre-commit 组 8 tags 门禁硬阻断的修复，详见 §3.2 回填） |
| tests/agent/data-ingest-service.test.ts | 新建 | 单元测试：目标 schema 校验 red→green（缺陷 A 场景）+ crm/hr 契约断言 + 边界 |

> 共享资源标注（S-8）：本写集不含 VERSION.md（数据契约修复，非门禁/工具行为变化，不 bump）；current-brief / 暂存区本身为共享资源，串行触碰；`extensions/ontology/` 与 DSH 哨兵线（extensions/sentinels/）同父目录但零文件交集——**field-mappings + resource/ + tags.json 只有 Win 改，DSH 不碰**。

### 3.2 最终实现同 commit 回填
若实现偏离方案（如最终改用 knowledge 数组而非 skills 逗号串、或目标 schema 校验改在 adapter-scanner 层），必须在本节同 commit 回填最终形态（S-6），不留方案 vs 代码漂移。

**2026-08-22 回填（Win，最终实现 vs §3.1 方案对照）:**

| 项 | §3.1 方案 | 最终实现 | 偏离理由（决策参考系） |
|----|----------|---------|----------------------|
| schema 搜索范围 | `resource/{type}.json` 单目录 | `resource/` → `outcome/` 双目录顺序搜索（loadNodeTypeSchema 内循环） | 实测 8 个既有映射的 targetNodeType 中 5 个（Operational/External/Innovation/Competitive/Risk）schema 在 `outcome/` 目录；只搜 resource/ 会误判"缺失"→ fail-open 失去字段校验，L4 类型契约断裂仍在。第一性原理: 校验语义对齐目标类型，物理目录是实现细节。两目录文件名零重名（已核实），双目录搜索无歧义 |
| schema 缺失 | warn + 跳过校验（fail-open） | 按方案实现 + fail-open 消息进入 IngestResult.warnings（API 响应可查） | 无偏离（铁律 24/31 信号非静默） |
| 跳过字段通道 | 非静默 | `IngestResult` 新增必选 `warnings: string[]`；被白名单跳过的每个 prop 一条 warning（上限 20） | 无偏离（铁律 31 信号沿返回链传播，测试直接断言） |
| Financial 回退 | targetNodeType=Financial 时回退 financial.json | 显式 `if (targetNodeType === 'Financial') return loadFinancialSchema()`（双目录搜索之前，L131-134） | 无偏离（legacy 空白名单语义逐位保留） |
| **tags.json（新增写集）** | 不在方案写集内 | domain.values 同步注册 8 个缺失标签（resource/market/intangible/distribution/legal/physical/supply_chain/ai） | **pre-commit 组 8 门禁在提交时暴露**: 触碰 client/person.json 触发 tags 引用完整性检查——13 个 resource schema 全部使用未注册标签（tags.json 三层体系从未迁移覆盖）。决策: 第一性原理（门禁意图=registry 唯一真相；schema 是既定生产语义，getTypesByTags 唯一消费者查 'human'，re-tag 无合法等价物且 'resource' 对应 ENTITY_DIRS 目录族语义）+ 开源实证（D32 a128df7a 同场景先例 "同步修复: tags.json 注册 outcome 标签"，同 commit）→ 注册 registry 吸收语义，零运行时变化，只补本 commit 触碰的 resource 族 |
| 其余写集 | — | crm/hr 映射补字段、client/person.json 补 optionalProps、5 测试用例均按方案 | 无偏离 |

### 3.3 不做的事
* 不改 `extensions/sentinels/customer-demand-shift/` + `key-person-risk/`（哨兵=DSH 地盘，本任务通过映射对齐契约，不碰 compute）。
* 不改 `scripts/golden-scenarios/GS-02/GS-04` fixture 与 run.sh（DSH 地盘——DSH 在本任务交付后按新字段更新 fixture 并重跑转绿）。
* 不改 ingest 类型系统（不新增 boolean/array 类型支持，用 status/skills 字符串规避）。
* 不做 CRM/ERP/HR 直连连接器（D357 后续，等创始人裁决先做哪个系统）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L2 | 单元 tests/agent/data-ingest-service.test.ts | 5 | 缺陷 A 场景（financial-only 校验跳过 crm 字段 → 目标 schema 校验后字段写入）+ crm 契约（revenue/status）+ hr 契约（name/skills/role/teamId）+ 未知 prop 边界（跳过 + 非静默）+ Financial 回归（仍走 financial.json） |
| L2 | 集成（既有）tests/data-pipeline.ingest.integration.test.ts | 回归 | 不破既有上传链路 |

**RED 必须覆盖失败模式（S-5）**：用例 1 先以现状跑（crm-standard 映射 + Client 目标）→ 断言 `node.props.revenue` 存在 → **修复前失败（字段被 financial 白名单跳过）** → 修复后通过；用例 3 断言未知 prop 不静默（errors 或 log.warn 可查，非只 log.warn continue 无痕）。

## 4.5 决策参考（S-12）
* 决策点 1：hr 知识领域用 `skills`（逗号串）还是 `knowledge/domains`（数组）？
  * 参考系：第一性原理——最小机制；ingest 现仅支持 number/string，而消费方 parseDomains 已原生支持 `skills.split(',')` → 零新增类型系统。
  * 结论：`skills` 逗号串（映射 + schema 均 string），不改 ingest 类型系统。
* 决策点 2：crm 流失语义用 `churn`（boolean）还是 `status`（string 'churned'）？
  * 参考系：Anthropic——契约以消费方为准；aggregate L36 已支持 `status === 'churned'` 且 client.json 已有 status。
  * 结论：`status: 'churned'`（映射 + fixture 语义对齐），不新增 boolean 类型。
* 决策点 3：目标 schema 缺失时？
  * 参考系：DeepSeek——fail-open 不静默；铁律 24/31。
  * 结论：warn + 跳过校验（不阻断上传），degraded 可追溯。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| `ingestBatch`（修改后） | `src/routes/data.ts`（生产入口，L1 路由 → L2 服务） | `grep -rn "ingestBatch" src/routes/data.ts` 命中 |
| `loadFieldMapping`（不变） | `src/routes/data.ts` | `grep -rn "loadFieldMapping" src/routes/data.ts` 命中 |
| 目标 schema 加载函数（新，如 `loadNodeTypeSchema`） | `data-ingest-service.ts` 内部 `ingestBatch` | `grep -rn "loadNodeTypeSchema" src/agent/data-ingest-service.ts` 命中 + 被调用 |

> 生产调用点（S-3）：`src/routes/data.ts` 是真实上传 API 入口（D357 MVP 上传路径），测试调用不计入。

## 6. 完成标准

* **DS1 目标 schema 校验**：`grep -n "loadNodeTypeSchema" src/agent/data-ingest-service.ts` 命中（新函数存在且被 ingestBatch 调用），且 `grep -n "financial" src/agent/data-ingest-service.ts` 命中 Financial 回退分支。
* **DS2 crm 契约**：`grep -n "revenue\|\"status\"" extensions/ontology/field-mappings/crm-standard.json extensions/ontology/resource/client.json` 命中（收入→revenue、客户状态→status）。
* **DS3 hr 契约**：`grep -n "name\|skills\|role\|teamId" extensions/ontology/field-mappings/hr-standard.json extensions/ontology/resource/person.json` 命中。
* **DS4 测试全绿**：`vitest run tests/agent/data-ingest-service.test.ts` 全 pass（red 先行已证：修复前用例 1 失败）。
* **DS5 零回归**：`vitest run tests/data-pipeline.ingest.integration.test.ts` 绿 + `tsc --noEmit` 零新增（28=28）。
* **DS6 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（尤其不碰 extensions/sentinels/、scripts/golden-scenarios/）。
* **DS7 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS8 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（缺陷 A financial 白名单跳过 → 目标 schema 写入）
* [ ] 接线要求 ≥1 生产调用点（src/routes/data.ts，测试调用不计）
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：数据契约修复，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 目标 schema 校验 | grep -n "loadNodeTypeSchema" src/agent/data-ingest-service.ts | 命中（被 ingestBatch 调用） |
| DS2 crm 契约补 revenue/status | grep -n "revenue\|status" extensions/ontology/field-mappings/crm-standard.json extensions/ontology/resource/client.json | 命中 |
| DS3 hr 契约补 name/skills/role/teamId | grep -n "name\|skills\|role\|teamId" extensions/ontology/field-mappings/hr-standard.json extensions/ontology/resource/person.json | 命中 |
| DS4 测试全绿 | vitest run tests/agent/data-ingest-service.test.ts | 全 pass |
| DS5 零回归 | vitest run tests/data-pipeline.ingest.integration.test.ts + tsc --noEmit | 集成绿 + 零新增 |
| DS6 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS7 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS8 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS8 一一对应（S-10）；派发说明：**不得与 DSH 的 GS-02/04 场景重跑并行**（DSH 需在本任务合并后按新字段更新 fixture），若必须并行先 worktree 隔离；写集与 DSH 线零重叠（S-7）；**暂存前先查 session-registry**（S-9）：发现活跃外来 session 且共享 worktree 时先协调或串行。
