# Task Brief: D480 诊断报告一页纸渲染（GS-08 前置工程侧）

> 生成: 2026-08-23 15:53:11 | 分支: feat/win-d480-report-onepager（worktree synova-wt-d480，基于 origin/main bbd77d0c）| as any: 0
> 权威任务文档: docs/plans/codex/implementation/SYNOVA-IMPL-D480-report-onepager-20260823.md（dev doc，§1-§8 全部 file:line 实测；§4.5 已含 2 决策点：registry 轨 / markdown 输出）
> 依赖: D475（诊断循环真实化已合并）；报告模板文案待 K3 定稿——本任务实现工程侧渲染与端点，模板以现有 executive_summary 为准
> 并行: 写集与 D478（src/server.ts）、D479（src/middleware/auth.ts）文件级零交集，worktree 隔离（主 checkout 当前被 D478 session 占用，实测分支 feat/win-d478-overflow-mount）

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
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于哪个系统？触及哪层？该层现有模块？新增/替换/扩展？

- 系统: GA 诊断（SynovaAgent 持续增长导航系统的诊断报告输出侧——GS-08「报告可读（GS-01 产物 → 一页纸 + 移动端）」前置工程侧）
- 触及层: L2 编排（src/agent/report-assembler.ts，修改——新增 renderOnePager 渲染函数）+ L1 交互（src/routes/diagnosis.ts，修改——SSE 附加 onePager + 新建 GET 报告端点）
- 现有模块: report-assembler.ts 已有四层组装（assembleCeo L31-40 / assembleFlywheel L43-53 / assembleExpert L56-62 / assembleRaw L65-72 / assembleReport L98-164）；src/l3/report-templates.ts registry 已注册 executive_summary 模板（L116-139，「高管摘要—一句话结论+Top3+行动」）
- 操作: 扩展（新增渲染函数**消费**既有闲置模板，K3 定稿后仅改模板数据不动物料）+ 扩展（诊断路由新增读取端点）；零新建 src 文件、零改 report-templates.ts（DS3：只消费不改，G12c 漂移规避）

### b) 文件审计
grep 实测（2026-08-23，worktree synova-wt-d480 @ bbd77d0c）：

- `grep -rn "executive_summary" src/` → 仅 src/l3/report-templates.ts L5/L117——模板已注册但**全仓零渲染调用**（闲置资产，缺陷 B 现场）
- `grep -rn "renderOnePager" src/` → 零命中（新函数，无命名冲突）
- `grep -rn "onePager" src/` → 零命中（新字段，无命名冲突）
- `grep -rn "saveDiagnosisReport|getDiagnosisReport" src/` → 零命中——无报告持久化设施；src/routes/diagnosis.ts L263 finally 删除 activeConsultations → GET 报告端点需有界内存缓存作数据源
- src/routes/diagnosis.ts L66-321: POST consult / GET status / POST interrupt / POST resume——**无报告 GET 端点**（新建真实存在，缺陷 A 现场）
- src/l3/report-templates.ts L166-175: registry.render 内部吞模板异常返回「模板渲染失败: ...」字符串不 rethrow——降级测试必须覆写 registry.render 本身（注入 seam L181-185 getReportTemplateRegistry(inject)）
- src/l3/briefing-generator.ts L124-135: formatMarkdown 每次调用时 getReportTemplateRegistry()——registry 消费先例（renderOnePager 同款模式，模块顶层捕获会使测试注入失效）
- src/agent/report-assembler.ts L31-53: assembleCeo（≤200字瓶颈+建议）/ assembleFlywheel（dimensions/rootCauses/recommendations）——一页纸数据源已就绪
- tests/e2e/full-pipeline.integration.test.ts L170-199: Stage 5a 调用 assembleReport(report,'flywheel')——回归守护对象（assembleReport 零行为改动）
- 关系: 复用 report-templates registry + assembleCeo/assembleFlywheel + diagnosis.ts 既有 assembleReport 完成块（L239-254）；扩展 report-assembler.ts（尾部追加）+ diagnosis.ts（完成块 + 新端点）；无冲突（与 D478 src/server.ts / D479 src/middleware/auth.ts 写集文件级零交集）

### c) 决策
- 一页纸模板形态 → executive_summary 已注册（L116-119）→ **复用**（消费不修改——dev doc DS3 明令零改 report-templates.ts，头部注释虽列它入写集但 §3.1 表/DS3/脚注三方一致要求零改动，以多数为准）
- 报告 GET 端点数据源 → 无覆盖（无持久化设施）→ 有界内存缓存（50 条 FIFO 淘汰；routes/ 内存 Map 为仓库既有模式，diagnosis-upload-v2.ts L43 jobStore 同型但无界——本缓存更严）
- 2 个难决策点（缓存设计 / 降级触发机制）→ DECISION-REFERENCE 四步已执行（dev doc §4.5 + 本 brief Q1c）

## 注入上下文
### DECISION-REFERENCE

> D333 决策参考框架全文（创始人 2026-08-13 定）:

# 决策参考框架（双参考系）

> 2026-08-13 创始人定 | 用途：遇到难决策/多选项/最佳实践选择时，强制走四步参考，并记录所用参考系
> 触发条件：①多选项需取舍 ②设计/架构方案选择 ③优先级排序 ④"最佳实践是什么"类问题 ⑤实现与文档声称冲突时

## 四步框架

```
① 第一性原理（DeepSeek/梁文峰）：这个问题的最简本质是什么？最少机制能解决吗？
② Anthropic 工程基线：隔离/失败即关闭/脚本验证/机器可验契约——哪条适用？
③ 开源实证（DeepSeek）：有可克隆的代码/架构参考吗？clone 下来看实际做法（成本/效率/结构）
④ 收敛检查：两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
```

## 双参考系边界

| 参考系 | 适用 | 不适用 |
|--------|------|--------|
| **Anthropic 工程实践** | agent 隔离、门禁/fail-closed、脚本化验证、机器可验契约、并行协作 | 成本/产品定位/模型选择 |
| **DeepSeek 第一性原理 + 开源实证** | 产品哲学、成本/效率/架构取舍、反内卷、开源参考（clone 仓库） | 工程流程细节（其仓库是模型/推理代码，非 agent 协作） |

## 梁文峰原则摘要（DeepSeek 参考时使用）

- **第一性原理**：不做无意义的炫技，回到问题本质
- **极致成本**：能用最少机制解决就不用多的（这正好支持"worktree 隔离 = 最少机制"而非 N 个门禁）
- **开源开放**：能参考开源实证就不闭门造车
- **反内卷**：机制是为了减少摩擦，不是为了增加流程

## 记录要求（可验证，不靠记忆）

- Codex 决策：在 dev doc / 本会话回复中**明确写"参考：Anthropic/DeepSeek/第一性原理 + 结论"**
- Claude Code 决策：dev doc 要求完成报告含**决策记录**（决策点 + 参考系 + 理由），K3 审计可核

## 已用案例

| 日期 | 决策 | 参考系 | 结论 |
|------|------|--------|------|
| 2026-08-13 | 并行 agent 冲突（串行 vs 并行） | Anthropic（隔离基线）+ DeepSeek（最少机制） | 收敛：worktree 隔离（D307）优先解锁并行 |


## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — dev doc §6 DS1-DS8（全部 grep/verify 可验证，映射到本 brief Done 标准）
  ② 测试 — tests/agent/report-assembler.test.ts 先写（5 用例），red 先行（renderOnePager 不存在 → ①②③失败）
  ③ 实现 — report-assembler.ts 尾部追加 renderOnePager + diagnosis.ts onePager 附加/缓存/GET 端点
  ④ 接线 — DS2 grep 物理证据：renderOnePager 在 src/routes/diagnosis.ts 被生产调用；DS3 executive_summary 在 report-assembler.ts 命中
  ⑤ 验证 — 自检 6 问 + vitest 全绿 + tsc 基线 28=28 + 回归（full-pipeline.integration + multi-role-interview）

引用依据:
  - 铁律 0-2: spec → test → impl → wire → review → merge（dev doc 即 spec，测试先行）
  - 铁律 7: 入口可触达（POST /consult 既有 SSE 链路 + 新建 GET report 端点）+ 完整链路走通 + 结果可见（SSE complete 事件 onePager 字段 / GET markdown 文本）
  - 铁律 24+31: renderOnePager whole-body catch + log.warn + 降级标记文案；路由渲染失败不阻断主报告
  - 铁律 33: tests/agent/report-assembler.test.ts（单元）
  - 铁律 38: 零新增 as any
  - 铁律 47/48: renderOnePager JSDoc 契约（输入/输出/降级）+ 测试真实 expect 断言（正常/降级/边界三路径）
  - memory/2026-08-22-d471-packages-as-any-cleanup.md（strict 类型陷阱）、memory/2026-08-16-d355-l4-contract.md（worktree 基线对照法）、memory/2026-08-06-D316-dev-doc-verification.md（dev doc 声称须独立核验——本任务 §2 审计已逐条 file:line 实测复核，含 3 处补充实测：executive_summary 零消费/无报告持久化/registry.render 吞错不 rethrow）

### b) 本任务执行约束（pre-commit 组 6 验证）
- rule: "report-templates.ts 零改动（executive_summary 只消费不修改，DS3）"
  verify: "test -z \"$(git diff origin/main -- src/l3/report-templates.ts)\""
- rule: "renderOnePager 必须在生产入口 src/routes/diagnosis.ts 被调用（DS2 接线）"
  verify: "grep -n \"renderOnePager\" src/routes/diagnosis.ts"
- rule: "renderOnePager 永不抛出（whole-body catch → 纯文本降级，GET 按需渲染路径依赖此契约）"
  verify: "grep -n \"onePagerFallback\" src/agent/report-assembler.ts"

### c) 决策参考系（S-12，K3 审计可核）
- 决策点 1（GET 报告端点数据源）: 参考：第一性原理（activeConsultations 在 finally 删除 L263 + 无持久化设施——有界内存缓存是让端点可用的最少机制）+ Anthropic（有界 50 条 FIFO 防 OOM，优于 diagnosis-upload-v2 jobStore 无界先例）+ 收敛：两者一致 → 有界缓存
- 决策点 2（降级路径触发机制）: 参考：Anthropic（铁律 24+31 降级信号传播）+ 结论：renderOnePager whole-body catch（永不抛出）+ registry.render 返回降级标记串（模板渲染失败/未找到模板前缀——K3 定稿后改模板文案可能引入运行时异常，此路兜底）也走纯文本 fallback；测试用 getReportTemplateRegistry(inject) seam 覆写 registry.render 本身触发（模板内部异常被 registry 吞掉不 rethrow，注册 throwing template 不触发 fallback——防后人简化丢失降级覆盖）
- 决策点 3（expert 深度映射）: dev doc 签名仅 ceo|flywheel → expert 映射 flywheel（更全量）；raw 深度不附加 onePager（dev doc §3.1 明令），GET 端点按需以 ceo 深度补渲染
- （dev doc §4.5 既有决策点 1/2: registry 轨（非 .hbs）；markdown 输出（非 HTML）——照案执行）

### d) 相关 Note 引用
- [ ] memory/notes/proposed/2026-08-23-d480-report-onepager.md（本任务决策沉淀：闲置模板消费模式 + 永不抛出渲染函数契约）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/report-assembler.ts — 尾部追加：`renderOnePager(report: DiagnosisReport, depth: 'ceo'|'flywheel' = 'ceo'): string`（export）+ 内部 toOnePagerData 映射（orgId=teamId/date=generatedAt/goals=[]/obstacles=[]（诚实空数组，诊断报告无目标进度数据）/alerts=rootCauses 按置信度降序 clone-sort（ceo top2/flywheel top5，confidence>=0.7 → 'high'）/recommendations=ceo:[assembleCeo] / flywheel:assembleFlywheel().recommendations.slice(0,3)）+ onePagerFallback 纯文本降级（含「降级」标记）；whole-body catch 永不抛出
- src/routes/diagnosis.ts — ①完成块（L239-254）reportDepth 非 raw 时独立 try/catch 调 renderOnePager 挂 result.report.onePager（失败 log.warn 不阻断）；②completedReports 有界缓存（50 条 FIFO，快照值不存 active 引用）——raw 咨询也入缓存；③新建 GET /api/diagnosis/consult/:consultId/report（format=markdown → text/markdown 响应，onePager 为 null 时按需 ceo 深度补渲染；默认 json → {ok,consultId,teamId,completedAt,report}；miss → 404 NOT_FOUND）
- tests/agent/report-assembler.test.ts — 新建 5 用例（①正常报告 markdown 含瓶颈+建议+高风险行；②空 rootCauses → 运行平稳/未发现显著瓶颈优雅文案；③registry.render 抛错 → 纯文本 fallback 含降级标记；④flywheel 深度全量建议；⑤assembleReport flywheel 回归守护）；断言全部用无 emoji 子串

不做什么（含文件路径）：
- 不改 src/l3/report-templates.ts
- 不改 src/l3/report-template-loader.ts
- 不改 src/server.ts
- 不改 src/middleware/auth.ts
- 不改 src/agent/post-diagnosis-processor.ts
- 不改 tests/e2e/full-pipeline.integration.test.ts
- 不改 VERSION.md

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）: ① POST /api/diagnosis/consult（body scope.reportDepth 非 raw）——既有 GA 诊断 SSE 链路零改动；② GET /api/diagnosis/consult/:consultId/report?format=markdown ——新建读取端点（consultId 来自 POST 响应头 X-Consult-Id）

处理（中间经过哪些步骤）: 引擎 runConsultation 完成 → 既有 assembleReport 四层组装 → renderOnePager（DiagnosisReport → ReportData 映射 → getReportTemplateRegistry().render('executive_summary', data)）→ 挂 result.report.onePager → completedReports 缓存快照 → sseClose（SSE complete 事件含报告+onePager）；GET 端点查缓存 → markdown 按需/直接返回；渲染任何失败 → log.warn + 纯文本降级/原报告保留（不阻断主链路）

结果（最终展示在哪）: ① SSE complete 事件 result.report.onePager = markdown 字符串（## ⚠️/✅ 头行 + Top3 + 📎 完整报告计数——移动端/邮件可读一页纸）；② GET ?format=markdown → text/markdown 文本响应；GET 默认 → JSON {ok,consultId,teamId,completedAt,report}；未完成/过期 → 404

## 文档引用
- CLAUDE.md §V4.5.1 铁律速览（0-2/7/24/31/33/38/47/48）+ §五层架构 + §门禁系统
- docs/plans/codex/implementation/SYNOVA-IMPL-D480-report-onepager-20260823.md（权威 dev doc §1-§8）
- docs/synova/coordination/编码session派单-20260821.md（GS-08 权威来源）
- docs/synova/coordination/DECISION-REFERENCE.md（D333 四步框架，已全文注入）

## 接口审计
- src/agent/report-assembler.ts:renderOnePager(report, depth) — 新增 export（本任务定义）；消费方 src/routes/diagnosis.ts 完成块 + GET 按需渲染
- src/agent/report-assembler.ts:assembleCeo/assembleFlywheel — 既有内部函数 L31-53（renderOnePager 复用，零改动）
- src/l3/report-templates.ts:getReportTemplateRegistry()/ReportData — 既有 L181-185/L20-28（消费，零改动）；registry.render L166-175 吞模板异常返回降级标记串
- src/routes/diagnosis.ts:assembleReport 完成块 — L239-254 既有（并列追加 onePager 块）
- src/l3/synova-diagnosis-engine.ts:DiagnosisReport — L277-306 类型（inline import 引用形态，routes 禁 from-字面 l3 import）

## 架构层: L2 编排（src/agent/report-assembler.ts）+ L1 交互（src/routes/diagnosis.ts）
#CRITERIA: A

## Done 标准
- [ ] DS1 渲染函数: verify: grep -n "renderOnePager" src/agent/report-assembler.ts 命中（定义）
- [ ] DS2 端点接线: verify: grep -n "renderOnePager" src/routes/diagnosis.ts 命中且被调用（生产调用点）
- [ ] DS3 模板启用: verify: grep -n "executive_summary" src/agent/report-assembler.ts 命中；git diff origin/main -- src/l3/report-templates.ts 为空（零改动）
- [ ] DS4 测试全绿: verify: npx vitest run tests/agent/report-assembler.test.ts 全 pass（red 先行已证：renderOnePager 不存在时 ①②③失败）
- [ ] DS5 零回归: verify: npx vitest run tests/e2e/full-pipeline.integration.test.ts tests/multi-role-interview.test.ts 全绿 + npm run lint 经 baseline-check 存量豁免零新增（28=28）
- [ ] DS6 范围一致: verify: git diff --name-only origin/main 与 Q2 写集一致（3 文件 + brief + reference-map），无越界（不碰 server.ts/middleware/auth.ts）
- [ ] DS7 无绕过: verify: grep -n "no-verify" .claude/bypass.log 零命中
- [ ] DS8 推送 + CI: verify: git push 后 git log origin/main..HEAD --oneline 空 + CI 相关 job 绿
