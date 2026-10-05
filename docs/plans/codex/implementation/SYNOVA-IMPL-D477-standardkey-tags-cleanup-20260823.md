<!--
  SYNOVA-IMPL-D477: standardKey 块读收敛 + outcome 族标签注册（D470 审计遗留 #2/#3）
  状态: dev doc | 2026-08-23 | 优先级 P2
  权威文档: docs/synova/audit-reports/2026-08-22-D338-org-audit.md（无）; D470 交付审计报告「三个非阻塞发现」#2（standardKey 块读英文键）+ #3（outcome 族标签漂移）; extensions/ontology/tags.json（标签契约：所有 Schema tags 值必须来自本文件，pre-commit 硬阻断）; D29/D33 standardKey 契约（src/agent/data-ingest-service.ts 注释）
  依赖: D470（目标 schema 校验已合并——本任务收其审计遗留）
  并行: 写集=src/agent/data-ingest-service.ts + extensions/ontology/tags.json + tests/agent/data-ingest-service.test.ts，与 D476（l3/routes/agent 的 GA 链）**文件级零交集**，可 worktree 隔离并行；与 DSH 线（scripts/、src/sentinel/）零重叠；若必须并行先 worktree 隔离
-->

# SYNOVA-IMPL-D477 standardKey 块读收敛 + outcome 族标签注册

## 1. 权威文档引用

* **D470 交付审计报告**（交付时产出，记录于 D470 PR #94 说明）：「三个非阻塞发现」——#2 standardKey 块读英文键 `row['period']`（L203）绕过白名单（历史遗留 D29/D33）；#3 outcome 族 external/innovation/risk.json 使用未注册标签。
* **tags.json 契约**（extensions/ontology/tags.json L2-4 + L63-68）：「所有节点/边 Schema 中的 tags 字段值必须来自本文件三层标签的合法值集合」+「pre-commit 硬阻断 (check-file-driven.sh) + ontology-loader 加载时校验」。
* **D29/D33 契约**（src/agent/data-ingest-service.ts L201-202 注释）：standardKey = `${graph}:${targetNodeType}:${period}:${validFrom}`——period 应来自**映射后的 props**（白名单校验过的值），而非原始行英文键。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A（#2）：standardKey 块读原始行英文键，绕过字段映射白名单
* `src/agent/data-ingest-service.ts` L203：`const period = row['period'];` —— 直接读输入行的英文键 'period'，**不经 §3.1 的映射白名单**（mapping 用中文键如「期间」→ props.period）。D470 建立的目标 schema 校验对 `row['period']` 无效：任何带英文 period 键的行都能绕过白名单写入 props.period + standardKey。当前 GS fixture 用中文键不触发，但通道存在。

### 缺陷 B（#3）：outcome 族 3 个 Schema 使用 4 个未注册标签
* `extensions/ontology/outcome/external.json`：tags `["outcome","environment","external"]` —— `environment`/`external` 不在 tags.json domain values。
* `extensions/ontology/outcome/innovation.json`：tags `["outcome","strategic","growth"]` —— `growth` 未注册。
* `extensions/ontology/outcome/risk.json`：tags `["outcome","risk","control"]` —— `control` 未注册。
* tags.json domain values 实测（L12-15）：outcome/resource/strategic/organizational/financial/technical/marketing/operational/risk/compliance/knowledge/causal/core/structural/competitive/synergy/market/intangible/distribution/legal/physical/supply_chain/ai —— **缺 environment/external/growth/control**。任何任务触碰 outcome 族文件 → group 8 门禁硬阻断（D470 已修 resource 族 8 标签，outcome 族同根剩尾）。

## 3. 实现方案

### 3.1 写集 (3 修改 + 0 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/agent/data-ingest-service.ts | 修改 | L203 `const period = row['period']` → `const period = props.period`（取映射白名单校验后的值）；删除英文键直读回退（防绕过）；若 props.period 缺失则跳过 standardKey 生成（与现状"无 period 不生成"语义一致，但不再接受行级英文键） |
| extensions/ontology/tags.json | 修改 | domain.values 补 `environment`、`external`、`growth`、`control` 四值（outcome 族合法化；与 D470 的 resource 族 8 标签同先例） |
| tests/agent/data-ingest-service.test.ts | 修改 | 新增用例 6：standardKey 行为——中文键行生成 standardKey 不变；**英文 'period' 键行不再注入 period/standardKey（red=现状注入 → green=白名单后不注入）**；Financial 回归不受影响 |

> 共享资源标注（S-8）：本写集不含 VERSION.md（契约收敛，非门禁/工具行为变化，不 bump）；current-brief / 暂存区共享，串行触碰；tags.json 是组 8 门禁数据源——改动后 pre-commit 会重新校验全仓 Schema 标签（本任务已先核 outcome/resource 全族）。

### 3.2 最终实现同 commit 回填
若实现偏离方案（如 standardKey 改为从 mapping 的 period 映射项显式取、或 tags.json 采用按族独立命名空间而非平铺 domain.values），必须在本节同 commit 回填最终形态（S-6）。

### 3.3 不做的事
* 不改 outcome/innovation/risk.json 的 tags 定义本身（本任务只注册标签；若实现者判断某标签语义错误可同步修正，但须 §3.2 回填）。
* 不改 D476 写集（ga-collaboration/interactive-card/overflow）。
* 不改 scripts/（DSH 地盘，check-file-driven.sh 只读消费）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L1 | 单元 tests/agent/data-ingest-service.test.ts（修改，新增用例 6） | +2 | ①中文键「期间」→ standardKey 生成不变（回归）；②英文 'period' 键 → 不再注入 props.period/standardKey（red=现状注入 → green=白名单后不注入） |
| L1 | 门禁回归 check-file-driven.sh（组 8） | 1 | outcome 族 tags 全部合法（注册后 group 8 通过） |

**RED 必须覆盖失败模式（S-5）**：用例②先以现状跑（row 含英文 'period' 键）→ 断言 props.period 不存在 → **修复前失败（被注入）** → 修复后通过；门禁回归在 tags.json 注册前跑 check-file-driven → 红（未注册标签）→ 注册后绿。

## 4.5 决策参考（S-12）
* 决策点 1：standardKey 的 period 取哪？
  * 参考系：第一性原理——白名单是 D470 建立的权威边界，standardKey 不应成为旁路；Anthropic——一个通道一个规则。
  * 结论：`props.period`（映射后值），删除 `row['period']` 直读。
* 决策点 2：outcome 标签注册还是改 Schema tags？
  * 参考系：DeepSeek——最小改动；4 个标签语义有效（environment/external/growth/control 是合法领域维度），注册成本最低；改 Schema 会触碰 outcome 族 3 文件扩大爆炸面。
  * 结论：注册 4 标签（与 D470 resource 族先例一致）。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| 无新增 export（纯逻辑收敛） | ingestRow 内部 standardKey 块 | `grep -n "props.period\|standardKey" src/agent/data-ingest-service.ts` 命中 |
| tags.json 4 新值 | 全仓 Schema 标签校验（check-file-driven） | `grep -n "environment\|external\|growth\|control" extensions/ontology/tags.json` 命中 |

> 本任务无新生产接口（S-3 不适用：接线 = 白名单语义 + 门禁数据源，测试/门禁即验证）。

## 6. 完成标准

* **DS1 standardKey 收敛**：`grep -n "row\['period'\]" src/agent/data-ingest-service.ts` 零命中（英文键直读已删；注意勿用 `grep "row\["`——会误匹配映射循环的 `row[m.externalField]`）。
* **DS2 标签注册**：`grep -n "environment\|external\|growth\|control" extensions/ontology/tags.json` 命中（domain.values 四值）。
* **DS3 测试全绿**：`vitest run tests/agent/data-ingest-service.test.ts` 全 pass（red 先行已证：英文键用例修复前失败）。
* **DS4 门禁回归**：`bash scripts/check-file-driven.sh`（组 8）通过（outcome 族标签合法）。
* **DS5 零回归**：D470 五用例 + Financial 回归绿 + `tsc --noEmit` 零新增（28=28）。
* **DS6 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致，无越界（不碰 D476/DSH 写集）。
* **DS7 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS8 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [ ] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [ ] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [ ] 测试 red→green 覆盖失败模式（英文键旁路注入 → 白名单后不注入；未注册标签 → 门禁红 → 注册后绿）
* [ ] DS verify 命令真实可执行、映射到实际用例
* [ ] 版本编排：契约收敛，非门禁/工具行为变化，不 bump VERSION.md
* [ ] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 standardKey 不再块读英文键 | grep -n "row\['period'\]" src/agent/data-ingest-service.ts | 零命中 |
| DS2 4 标签已注册 | grep -n "environment\|external\|growth\|control" extensions/ontology/tags.json | 命中 |
| DS3 测试全绿 | vitest run tests/agent/data-ingest-service.test.ts | 全 pass |
| DS4 门禁回归 | bash scripts/check-file-driven.sh | 通过 |
| DS5 零回归 | vitest run 相关 + tsc --noEmit | 全绿 + 零新增 |
| DS6 范围一致 | git diff --name-only HEAD^ | 与写集一致，无越界 |
| DS7 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS8 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS8 一一对应（S-10）；派发说明：与 D476 **可并行**（写集零交集），必须 worktree 隔离（D307）；tags.json 改动会触发组 8 全仓标签重校验——实现时先跑一次 check-file-driven 确认 outcome/resource 全族无其他未注册标签；暂存前查 session-registry（S-9）。
