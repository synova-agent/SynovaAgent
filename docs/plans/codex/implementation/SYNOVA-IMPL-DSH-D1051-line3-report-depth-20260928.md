# SYNOVA-IMPL-DSH-D1051 线 3 报告体系首切片：一页纸（浅层默认）+ 详细报告 + 对话调深度

> 规格作者: 成员 S（D1051 小队，**独立于实现者**，不写产品代码）
> 日期: 2026-09-28 | 工作树 `/Users/wane/SynovaAgent/.synova-wt-d1051-spec` | 分支 `docs/d1051-line3-spec`
> base: `origin/main @ d8590040`（`git merge-base --is-ancestor` 实测同源，未落后）
> 认领验收点: **3-1 / 3-2 / 3-3**（`docs/synova/product-lines/product-lines.yaml:167,172,177`）
> 依据计划: `docs/synova/coordination/整体推进计划-主线-20260913.md`，**v1.2**，sha256 前 8 位 `4e46603f`
> 服务场景: 诊断跑完 → 老板默认拿到一页纸（10 分钟看懂）→ 想深挖要看完整各章节 → 不想翻文档就地说一句「讲细一点 / 说人话」即可切换深浅。

---

## 1. 权威件核验

| # | 权威件 | 核验命令（实测于本工作树） | 原始输出摘要 | 结论 |
|---|--------|--------------------------|-------------|------|
| 1 | 整体推进计划 v1.2 + 哈希 | `shasum -a 256 docs/synova/coordination/整体推进计划-主线-20260913.md` | `4e46603facae436191cb730084d7fd441bc2ba194dbf7fd7fdbbeb7cfa0f4c9a` | ✅ 前 8 位 `4e46603f` 相符 |
| 2 | 计划版本号 | `grep -n "版本" docs/synova/coordination/整体推进计划-主线-20260913.md` | `:3:> **版本: v1.2 \| 定稿: 2026-09-13（v1.2 2026-09-15）` | ✅ v1.2 |
| 3 | 线 3 验收点 3-1/3-2/3-3 | `sed -n '160,200p' docs/synova/product-lines/product-lines.yaml` | `3-1 "一页纸报告结构（结论先行，10 分钟看完）"`、`3-2 "详细报告（完整诊断各章节…）"`、`3-3 "对话式调整深度（『讲细一点/说人话』能切换深浅）"`，三点 `status: uncommitted`，`evidence: ["scenario:GS-08"]` | ✅ 口径一致 |
| 4 | 线 3 级定义 | 同上 `:159-165` | `done_definition: "老板拿到一页纸结论（看得懂），想深挖有详细报告，想调整深浅说句话就行；手机能看，能导出"`；`baseline_note: "一页纸结构有；详细报告/交互深度 = 0"` | ✅ |
| 5 | 3-9 时间窗口径（**禁另立**） | `sed -n '208,212p' docs/synova/product-lines/product-lines.yaml` | `3-9 …日粒度为主 + 周/月聚合视图…聚合不得另立独立口径`，`note` 明写 **依赖 D828**，`fail_when` 含「报告未标注数据时点」 | ✅ 本卡**不认领** 3-9（见 §6） |
| 6 | 创始人 13 问 → 线 3 落点 | `sed -n '100,130p' docs/plans/codex/strategy/SYNOVA-DESIGN-产品完成度仪表盘-v1-20260816.md` | 表格行 `\| 2 详细报告 + 交互深度 \| 线 03（扩定义：一页纸+详细+对话式调整） \|` | ✅ 3-2/3-3 属产品承诺 |
| 7 | D791a 前置（win 域已落 main） | `git log --oneline -1 b396bafc` + `git merge-base --is-ancestor b396bafc origin/main` | `b396bafc feat(D791a): 线3 一页纸 win 域切片（src 5 + tests 2 + spec，23 单测绿）(#617)`；`IS ancestor` | ✅ 前置在 main |
| 8 | **偏差①：D791 PR-B 未落 main** | `git merge-base --is-ancestor db7252c8 origin/main` | 输出 `NOT ancestor`；`git branch -a --contains db7252c8` → `feat/d791b-onepager-mac`（+ `remotes/origin/…`、`remotes/ssh/…`） | ⚠️ **main 的 GS-08 仍为 D446 初版**（模板加载级，evidence_map 用 `S8-1/S8-2`，与 3-x **无映射**） |
| 9 | **偏差②：GS-08 无固定诊断产物** | `git ls-tree -r --name-only origin/main -- scripts/golden-scenarios/GS-08-report-readable/` | 仅 `README.md` / `expect.json` / `run.sh` 三行（`fixtures/` 未跟踪） | ⚠️ **本切片须自备 fixture 诊断产物**（见 §5.5） |

### 1.1 偏差② 的精确表述（避免引用歧义）

- **交付态（fresh checkout / 本工作树）**：`[ -d scripts/golden-scenarios/GS-08-report-readable/fixtures ]` → **目录不存在**；`git ls-tree` 无该路径。
- **主工作区（`/Users/wane/SynovaAgent`，队长实测）**：同名路径**存在一个空目录**（`ls -1 …/fixtures | wc -l` = 0），但**未被 git 跟踪**（git 不跟踪空目录）。
- 两种表述的**结论一致**：**main 无任何现成诊断报告产物**。本规格统一采用上表第 9 行的 git 口径（交付态可复现）。
- `GS-08-report-readable/README.md` 自陈（原文）：「**诚实 RED 声明**…GS-01 产物 → 一页纸的**端到端管线**…的渲染调用点仍待验证…列为后续增强」⇒ 该场景当前是**模板契约级**，不构成 3-x 的证据。

---

## 2. 问题陈述

线 3 的三个验收点各自缺的是**不同层的东西**，不能当作「一个深度参数没接通」来修：

1. **3-1 一页纸**：结构已存在（D791a），且**已是可交付产物**；本卡的义务是**把它钉成浅层默认**（默认路径字节级不变），并作为「说人话」方向的回归目标。
2. **3-2 详细报告**：**载体不存在**。模板注册表只有 `daily_briefing` / `weekly_summary` / `executive_summary`（`src/l3/report-templates.ts:44,89,197`，构造器 `:246-249` 逐个 `set`），**没有一个「完整诊断各章节」的版式**；`assembleReport` 的 `expert` / `raw` 深度产出的是 `AssembledReport.data`（`Record<string, unknown>` JSON），**不是 markdown 章节**（`src/agent/report-assembler.ts:63-87,109-166`）。⇒ 靠「给 `renderOnePager` 多传一个深度」实现不了。
3. **3-3 对话调深度**：**判别与渲染两条链路都不存在**。对话 SSE 流里 `renderOnePager` 出现 **0 次**（`grep -c` 实测，见 §4-F3）；`ConversationEngine` 无深度概念；对话桥在 `phaseComplete` 时只把**裸 JSON** 报告放进 `complete` 帧（`src/routes/conversations.ts:328-336`）。路由层也没有任何意图判别（`grep -c "intent\|Intent" src/routes/conversations.ts` = **0**）。

**同时**，读路径有一个已存在的硬缺口：`GET /api/diagnosis/consult/:consultId/report` 的按需渲染**硬编码 `'ceo'`**（`src/routes/diagnosis.ts:818`），而 SSE 完成路径已有深度入参链（`:535`）。⇒ **端点侧不接受任何深度入参**，这是 3-2/3-3 在 HTTP 面的共同缺口。

---

## 3. Q0–Q4

### Q0 定位（项目拼图 + 文件审计）

**a) 项目拼图** — 本卡横跨两层但**只动尾部呈现**：

| 层 | 本卡动作 | 既有模块 |
|----|---------|---------|
| L1 交互 | `GET …/report?depth=` 生效；对话 SSE 旁挂 `report_view` 帧 | `src/routes/diagnosis.ts`、`src/routes/conversations.ts` |
| L2 编排/装配 | **呈现粒度轴单一事实源（DR-1 裁定落点）** + 详细报告渲染器（`DiagnosisReport → 章节 markdown`）+ S2/S3 输入装配下沉为可复用导出 | `src/agent/report-assembler.ts`、`src/agent/report-onepager-trace.ts`、`src/agent/cycle-conclusion-service.ts`、**新增 `src/agent/report-depth.ts`** |
| L3 洞察/版式 | 第 4 个模板 `detailed_report`（**哑渲染器，零新增 import**——见 §4.5 Q7 子裁定 (i)） | `src/l3/report-templates.ts` |
| L4/L5 | **零改动**（报告归档读面用既有 `listDiagnosisReports` / `getDiagnosisCheckpoint`） | — |

**b) 文件审计（grep 实测，全部 file:line 于 §4）** — 复用判断：`renderOnePager` 复用（不透支）；`ReportTemplateRegistry` 复用（加第 4 模板，**无任何 `list().length` 断言**，见 §7.2）；`ReportData` 复用（**纯附加可选字段**）；`buildOnePagerInputs` 的 S2/S3 装配**下沉复用**（消除两处实现）；对话入口复用（**不新建路由**）。

**c) 决策** — 复用优先，**只新增 1 个 src 模块**（`src/agent/report-depth.ts`，**L2**：深度轴词表 + 守卫 + 一页纸深度映射 + 对话判别词表；**零 import，不引 L3 也不引其他 L2 模块**——见 §4.5 Q7）；不新建路由、不新建 SSE 端点、不扩 `.hbs` 第二轨、不碰 `IntentRouter`、**L1 零新增跨层 import**。

### Q1 调研

**a) 业界最佳实践**：报告「一页纸 + 附录深潜」是咨询交付的成熟双层结构（结论先行 = BLUF：Bottom Line Up Front）。深度切换的**确定性做法**是「显式参数 + 已渲染产物缓存」，不是让 LLM 自由裁量——LLM 判意图会引入不确定性，而本仓库既有测试文化明确钉死**确定性**（跨系统时刻字节相等，`tests/agent/report-onepager-trace.test.ts`）。

**b) 顶级团队怎么做**：① 呈现与装配分层——「组装多少数据」与「渲染成几章」是两根轴，不共用一个枚举；② 深色路径（deep link）——同一资源多视图用**查询参数**（`?depth=`）表达，视图为**附加可选字段**，默认值保证旧客户端零回归；③ 新增能力**旁挂**（additive frame field）而非改既有字段，避免破坏向后兼容。

**c) memory/ 历史教训**：
- 铁律 0-2 / 4 / 5 / 7：**入口→交互→结果三环节缺一不可**，`grep -rn "新函数名" src/` 零结果 = 未完成（4 次接线失败史）。
- 铁律 47/48：新函数先 JSDoc `@input/@output/@degraded`，测试三路径 + `expect()`。
- 铁律 11/24/31：降级必须 `log.warn` + `degraded` 标记 + 调用方传播；**禁静默**。
- 铁律 37：死代码入仓库即违规。
- 铁律 38：`as any` / `as never` / `as unknown as` 零容忍（本卡所有窄化一律用**类型谓词**）。
- D791a 教训（本卡直接继承）：一页纸是**结构化 markdown 非散文**，不得过 `tone-enforcer`；输出**禁含渲染时刻**（幂等前提）。
- CT-62 证据新鲜度：`evidence-writer.py` **无 `--at`**（实测 `--help`，见 §4-A6）⇒ 同日提交判 `stale`，点级证据须**次日重跑**。
- 小队纪律 8：技术决策自决并记录参考系（下表）。

**Q1c 决策参考系**：`参考：Anthropic 工程基线（分层/契约/三路径）+ DeepSeek（确定性优先、additive 兼容）+ 第一性原理（呈现粒度 ≠ 装配粒度）→ 结论：新立独立呈现轴 + 第 4 模板 + 查询参数 + 旁挂帧字段`

### Q2 范围（最简方案）

**做什么**（逐文件见 §5.1）：
- 新增 `src/agent/report-depth.ts`（**L2**）：`ReportViewDepth` 轴 + 守卫 + 一页纸深度映射 + 3-3 对话判别词表（**纯函数，零 I/O，零 import**——DR-1 裁定 A 案）。
- `src/l3/report-templates.ts`：`ReportData` **+1 个可选字段** `chapters?`；注册第 4 个模板 `detailed_report`（消费 `chapters`）。
- `src/agent/report-assembler.ts`：+`renderReportView(report, viewDepth, inputs?)` 分发器、+`renderDetailedReport(report)`（`DiagnosisReport → 章节 ReportData → registry.render`）、+`assembleOnePagerInputsForOrg(orgId, graphStore?)`（S2/S3 装配的**唯一实现**，`diagnosis.ts:723` 私有函数改为薄委托）；+`isRenderableDiagnosisReport(v)` 形状谓词。
- `src/routes/diagnosis.ts`：`GET …/report` 的 markdown 分支接受 `?depth=one_pager|detailed`，默认 `one_pager` = **现状字节级不变**。
- `src/routes/conversations.ts`：对话轮内**确定性**判别深度词 → 渲染 → 旁挂 `report_view` 帧；`complete` 帧既有字段**一字不改**。
- 测试 4 个新文件（三路径 + 判别性夹具）。

**不做什么（含文件路径，与 §6 同源）**：
- 不改 `scripts/**`（含 `scripts/golden-scenarios/GS-08-report-readable/run.sh`、`scripts/control-tower/**`、`scripts/audit/**`）
- 不改 `docs/synova/coordination/**`（含 `整体推进计划-主线-20260913.md`、`product-lines.yaml`）
- 不改 `.github/**`、不改 `packages/engine-core/**`
- 不改 `src/agent/report-onepager-trace.ts`、`src/agent/cycle-conclusion-service.ts`、`src/store/session-store.ts`
- 不改 `src/agent/interactive-card.ts`、`src/agent/intent-router.ts`
- 不改 `extensions/reports/**`
- 不实现 3-4 导出 / 3-5 手机端 / 3-6 复述核验 / 3-9 时间窗口径

### Q3 验收（入口 → 交互 → 结果）

| 点 | 入口（从哪触发） | 交互（中间步骤） | 结果（最终可验证输出） |
|----|----------------|----------------|---------------------|
| 3-1 | `GET /api/diagnosis/consult/:id/report?format=markdown`（**不带 depth**） | `respondReport` → 默认 `one_pager` → `renderOnePager(report,'ceo',inputs)` | 与今日 main **字节级相同**的一页纸（四槽位 + `[src:…]` 指针）；头 `X-Report-View-Depth: one_pager` |
| 3-2 | 同上 **`?depth=detailed`** | `respondReport` → `renderReportView(report,'detailed')` → `renderDetailedReport` → `detailed_report` 模板 | 章节化 markdown：结论 / 根因全量 / 专家完整推理 / 行动建议 / 数据时点；每章非空或有 `[degraded]` 说明行 |
| 3-3 | `POST /api/conversations/:id/messages`，`message` 含深度词（「讲细一点」/「说人话」） | `handleConversationMessage` → `resolveViewDepthFromUtterance(message)` → 命中 → 取报告（本轮或归档最新）→ `renderReportView` | SSE 流内新帧 `report_view`：`{depth, reportId, markdown, degraded, reason?}`；**最后一帧仍为 `end`、无 `error` 帧** |

### Q4 契约与测试（铁律 47/48，写代码前定义）

- 每个新 export 先写含 `@input` / `@output` / `@degraded` 的 JSDoc（**全文见 §5 各契约块**），再实现。
- 测试三路径：**正常** / **降级** / **边界**，且每文件**必须有 `expect()`**（禁空壳）。
- 判别性夹具（「删掉即报红」）：**3-2 必须有一条断言在「未注册 `detailed_report` 模板」时失败**；**3-3 必须有一条断言在「判别函数恒返回默认值」时失败**（见 §7.3）。

---

## 4. Current State（2026-09-28 实测，全部 file:line；工作树 `.synova-wt-d1051-spec` @ `origin/main d8590040`）

### A. 环境与工具（影响实现选择）

| # | 事实 | 命令 | 原始输出 |
|---|------|------|---------|
| A1 | 工作树落后判定 | `git status -sb` / `git rev-parse HEAD` | `## docs/d1051-line3-spec`；`HEAD = d85900407a46fbeb9bb97271ae8fb1fb4ccc4fc4` = `origin/main` |
| A2 | 域归属检查器可用 | `python3 scripts/control-tower/check-ownership.py --help` | `usage: … [--owner {mac,win,k3}]`；`@exit 0=同域 / 1=越域 / 2=检查失败` |
| A3 | 拟写集 10 文件全 win | `check-ownership.py <10 文件> --owner win` | `✅ PASS 10 个文件全部归属 owner=win（无归属 0）`，`exit=0` |
| A4 | 治理件域中性 | `check-ownership.py task-state docs/synova/product-lines/evidence/` | `· domain-neutral task-state` / `· domain-neutral docs/synova/product-lines/evidence/` |
| A5 | 回归红线规模 | `grep -c "^\s*it(" / "expect("` 三文件 | `report-assembler.test.ts it=5 expect=29`；`report-onepager-trace.test.ts it=12 expect=71`；`cycle-conclusion-service.test.ts it=6 expect=40` ⇒ **合计 23 it / 140 expect** |
| A6 | CT-62 证据新鲜度（**实测**） | `python3 scripts/product-lines/evidence-writer.py --help` | 选项为 `--type/--date/--verdict/--points/--source/--quote/--out-dir`；**无 `--at`**（`grep -n add_argument` 7 项佐证）⇒ 只落日期，同日提交判 `stale` |
| A7 | 证据落盘目录存在 | `ls -ld docs/synova/product-lines/evidence/` | 目录存在（93 项） |
| A8 | 对话帧序列断言方式 | `grep -n "frames\.\(find\|filter\)" tests/routes/conversations.test.ts` | 全部 `find`/`filter` 按 `type` 取帧，**无严格序列 equality**；唯一硬约束 = 末帧 `end` 且无 `error` 帧（`tests/integration/production-entry-conversation.integration.test.ts:153,257`）⇒ **新帧类型 additive 安全** |
| A9 | SSE 帧可承载任意 type | `sed -n '88,90p' src/l1-interaction/web-adapter.ts` | `sendFrame` → `this.writeRaw(\`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n\`)` |

### B. 一页纸（3-1）现状 —— **已存在，须零回归**

| # | 事实 | file:line / 命令 | 原文摘要 |
|---|------|-----------------|---------|
| B1 | 四槽位渲染器 | `src/agent/report-assembler.ts:329` | `export function renderOnePager(report: DiagnosisReport, depth: 'ceo' \| 'flywheel' = 'ceo', inputs?: OnePagerInputs): string` |
| B2 | 渲染器**只吃 2 值**（≠装配轴） | 同上 `:331` | `depth: 'ceo' \| 'flywheel' = 'ceo'` |
| B3 | 装配轴 4 值（**另一根轴**） | `src/agent/report-assembler.ts:31` | `export type ReportDepth = 'ceo' \| 'flywheel' \| 'expert' \| 'raw';` |
| B4 | 装配轴产出 JSON 非 markdown | `:109-166` | 返回 `AssembledReport { reportId, teamId, depth, summary, data: Record<string, unknown> }`；`assembleExpert` = `{expertReports, rootCauses, recommendations}`（`:67-73`） |
| B5 | 模板名常量 | `:180` | `const ONE_PAGER_TEMPLATE = 'executive_summary';` |
| B6 | 槽位标题常量（模板侧） | `src/l3/report-templates.ts:143` | `export const EXECUTIVE_SUMMARY_SLOT_TITLES = [`（与 `src/agent/report-onepager-trace.ts:42 ONEPAGER_SLOT_TITLES` **双源相等**，由 `tests/agent/report-onepager-trace.test.ts:140` 守护） |
| B7 | 四槽位值 | `src/agent/report-onepager-trace.ts:42-47` | `['### 结论','### 关键证据','### 各维度循环结论','### 行动建议']` |
| B8 | 降级标记为 ASCII | `src/agent/report-onepager-trace.ts:50` | `export const DEGRADED_MARK = '[degraded]';`（注释明写：正常路径断言 `not.toContain('降级')`，中文标记会误伤） |
| B9 | 一页纸契约（永不抛出/确定性） | `src/agent/report-assembler.ts:309-328` | JSDoc：`@degraded` 三路；「本函数永不抛出（whole-body catch…）」；「确定性：输出**禁含渲染时刻**」；「不走 tone-enforcer」 |
| B10 | 一页纸预算常量 | `:404-406` | `ONEPAGER_CHAR_BUDGET = 1200` / `ONEPAGER_CONCLUSION_MAX_CHARS = 200` / `ONEPAGER_MAX_LINE_CHARS = 60` |

### C. 报告端点（§2 缺口面）

| # | 事实 | file:line | 原文摘要 |
|---|------|----------|---------|
| C1 | 端点定义 | `src/routes/diagnosis.ts:910` | `router.get('/api/diagnosis/consult/:consultId/report', async (req, res) => {` |
| C2 | 只认 `format` | `:912` | `const format = typeof req.query.format === 'string' ? req.query.format : 'json';` ⇒ **无任何 depth 入参** |
| C3 | 按需渲染硬编码 `'ceo'` | `:818` | `return renderOnePager(report, 'ceo', inputs);` |
| C4 | markdown 分支 | `:875-893`（`respondReport`） | `if (onePager) {…send(onePager)} else if (isFullDiagnosisReportLike(report)) {…send(await renderOnePagerOnDemand(req, report))}` |
| C5 | SSE 完成路径**已有**深度入参链 | `:532-539` | `const reportDepth = asReportDepth(scope?.reportDepth) ?? asReportDepth(scope?.depth) ?? configDiagnosis.reportDepth ?? 'raw';` … `if (reportDepth !== 'raw') {` |
| C6 | 深度白名单（4 值，本地类型） | `:57-64` | `type ConfigReportDepth = 'ceo'\|'flywheel'\|'expert'\|'raw';` + `asReportDepth` |
| C7 | 一页纸模板白名单（2 值） | `:58,67-70` | `type OnePagerTemplate = 'ceo' \| 'flywheel';` + `asOnePagerTemplate` |
| C8 | 完成路径渲染调用 | `:552-562` | `renderOnePager(report, appliedTemplate ?? (reportDepth === 'ceo' ? 'ceo' : 'flywheel'), onePagerInputs)` |
| C9 | S2/S3 输入装配（**私有**） | `:723` | `async function buildOnePagerInputs(req: Request, orgId: string): Promise<OnePagerInputsLike>`（S2 = `sentinel.getSentinelExpertReports()`；S3 = `cycleService.buildCycleConclusions(orgId, readGraphStore(req))`；汇入 L2 `assembleOnePagerInputs`） |
| C10 | graphStore 只能从 `app.locals` 取 | `:706-709` | `function readGraphStore(req: Request): unknown { … locals.graphStore … }`；`src/server.ts:282 if (graphStore) app.locals.graphStore = graphStore;`（**无全局单例**） |
| C11 | 完整报告形状守卫（**私有**，L1 内联） | `:124-139` | `function isFullDiagnosisReportLike(v: object): v is DiagnosisReportLike`（校验 reportId/teamId/generatedAt/summary + 4 数组/对象） |
| C12 | 归档行形状守卫（**L5 导出**） | `src/store/session-store.ts:84` | `export function isDiagnosisReportArchive(v: unknown): v is DiagnosisReportArchive`（`report` 仅验 `summary: string`） |
| C13 | 归档行写入面 | `src/store/session-store.ts:546` | `saveDiagnosisCheckpoint({sessionId, phase, completedModules, partialReport, savedAt})`（`INSERT OR REPLACE INTO diagnosis_checkpoints`） |
| C14 | 归档行读面 | `src/store/session-store.ts:562` | `getDiagnosisCheckpoint(sessionId)` |
| C15 | 报告列表读面（orgId 过滤需客户端做） | `src/store/session-store.ts:598-599` | `listDiagnosisReports({limit,offset})` → `Array<{reportId, teamId, completedAt, summary, onePagerAvailable}>`；**无 orgId 入参** |
| C16 | `DiagnosisReport` 权威形状 | `src/l3/synova-diagnosis-engine.ts:277-306` | `{reportId, teamId, generatedAt, summary, expertReports[{expert,findings[],confidence}], rootCauses[{description,dimension,confidence}], recommendations[{action,priority,expert}], raw}` |

### D. 模板注册表（3-2 载体缺口）

| # | 事实 | file:line | 原文摘要 |
|---|------|----------|---------|
| D1 | **仅 3 个模板** | `src/l3/report-templates.ts:246-249` | `constructor() { for (const t of [DAILY_BRIEFING, WEEKLY_SUMMARY, EXECUTIVE_SUMMARY]) { this.templates.set(t.name, t); } }` |
| D2 | 三模板名 | `:44` / `:89` / `:197` | `name: 'daily_briefing'` / `'weekly_summary'` / `'executive_summary'` ⇒ **无详细报告载体** |
| D3 | `ReportData` 形状（可纯附加扩展） | `:20-43` | `{orgId, date, goals[], alerts[], obstacles[], recommendations[], extra?, conclusionPointer?, keyEvidence?, cycleConclusions?, actionItems?}` |
| D4 | 渲染降级语义（返回标记串不抛） | `:265-274` | `render()`: `if (!template) return \`未找到模板: ${templateName}\``；catch → `log.warn` + `return \`模板渲染失败: ${err.message}\`` |
| D5 | 注入缝（测试可用） | `:281-284` | `getReportTemplateRegistry(inject?)`；`if (inject) { _instance = inject; return inject; }` |
| D6 | **无注册表长度断言** | `grep -rn "\.list()\|toHaveLength(3)" tests/ \| grep -i "report\|template"` | 仅 `tests/cycles/*`、`tests/connector-registry.test.ts` 等**其他**注册表命中；report 模板注册表**零长度断言** ⇒ 加第 4 模板不破既有测试 |
| D7 | 双注册表并存（**勿混用**） | `src/l3/report-template-loader.ts:89,135,152` | 文件驱动轨 `loadTemplate/listTemplates/clearTemplateCache`（读 `extensions/reports/{default,executive-summary}.hbs`），由 `src/init/file-driven-loaders.ts:35` 装载 ⇒ 与 D1 的**内存注册表是两套**；D480 已裁决 **markdown 为主载体**（见 §6） |

### E. 对话入口（3-3 现状）

| # | 事实 | file:line / 命令 | 原文摘要 |
|---|------|-----------------|---------|
| E1 | 两个入口 | `src/routes/conversations.ts:354` / `:359` | `router.post('/api/conversations', …)` / `router.post('/api/conversations/:id/messages', …)` |
| E2 | 共用 handler | `:157` | `async function handleConversationMessage(req: Request, res: Response, pathSessionId?: string)` |
| E3 | **对话流内零一页纸** | `grep -c "renderOnePager" src/routes/conversations.ts` | **0** |
| E4 | **路由层零意图判别** | `grep -c "intent\|Intent" src/routes/conversations.ts` | **0** |
| E5 | 对话桥诊断完成分支 | `:272-325` | `if (result.phaseComplete && !disconnected) { … launcher.startDiagnosis(…) … store.saveDiagnosisCheckpoint({… partialReport: {reportId, report: diagnosisResult.report, teamId, completedAt, source:'conversation'}}) }` |
| E6 | 对话桥**不渲染一页纸**（归档 `onePager` 缺席） | `:307-318` | `partialReport` 字面量仅 5 个键，**无 `onePager`** ⇒ 对话产出的报告在归档中 `onePagerAvailable=false` |
| E7 | `complete` 帧（既有字段，**一字不改**） | `:328-336` | `{type:'complete', sessionId, teamId, totalDurationMs, degradedModules, report: diagnosisResult?.report ?? null}` |
| E8 | 内建工具注册面（**3 个生产入口**） | `src/agent/builtin-tools.ts:15`；调用点 `src/routes/conversations.ts:242`、`src/cli.ts:107,129`、`src/l1/im-inbound.ts:189` | `registerBuiltinTools(registry, store, sessionId, getPhase, getOrgId)` |
| E9 | 内建工具清单（8 个，**无报告深度**） | `grep -n "name: '" src/agent/builtin-tools.ts` | `query_ontology` / `show_diagnosis_progress` / `explain_finding` / `list_sessions` / `read_document` / `schedule_task` / `list_scheduled_tasks` / `install_skill` |
| E10 | `interactive-card` 语义错配 | `src/agent/interactive-card.ts:25,37` | `CardSentinelFinding`（哨兵告警）；`CardActionType = 'confirm'\|'dismiss'\|'details'\|'flag'\|'correct'\|'rediagnose'` ⇒ **无报告深度语义**，不挂 |
| E11 | `intent-router` 语义错配 | `src/agent/intent-router.ts`（挂于 `ConversationEngine`，`src/agent/conversation-engine.ts:634` 调用） | 分类**诊断维度意图**，非报告深度 ⇒ **不扩**（扩会动 L2/orchestrator 与既有维度路由） |
| E12 | 生产入口 bootstrap 会自杀 | `src/server.ts:124` `createServer()`；`:141` | `process.exit(1)`（Bootstrap 6 phase 失败时）⇒ 集成测试**不宜调完整 createServer**，须证明等价性 |
| E13 | `app.locals` 注入面 | `src/server.ts:281,282,285,286,287,289,290,291,292,296,300,306,309` | `container` / `graphStore?` / `sessionStore` / `orchestration{…db…}` / `federalAdapter` / … ⇒ in-process 复刻可行 |
| E14 | 真实入口级测试范式（可复用） | `tests/integration/production-entry-conversation.integration.test.ts:200-232` | `process.env.PORT='0'` + 假 LLM 上游 + `createServer()` + `server.address().port`；脚本化 `toolCalls:[{name: SCRIPTED_TOOL}]` 让**工具循环真的转起来** |

### F. 缺口汇总（本卡要闭合的 5 条）

- **F1（3-2 载体）**：注册表无详细报告模板（D1/D2）；`ReportData` 无章节承载字段（D3）。
- **F2（3-2/3-3 端点面）**：`GET …/report` 硬编码 `'ceo'`，不接受深度入参（C2/C3）。
- **F3（3-3 判别链）**：路由层零意图判别（E4）；无任何「话语 → 深度」的确定性映射。
- **F4（3-3 渲染链）**：对话流内零渲染（E3）；S2/S3 装配私有不可复用（C9）。
- **F5（证据面）**：GS-08 无固定诊断产物（§1 偏差②）；三点 `status: uncommitted`，**0 证据**。

### G. 架构门禁实测（DR-1 依据；两个方向都写清）

**门禁脚本**：`bash scripts/check-architecture.sh`（250 行）；L1 文件集含 **`src/routes/`**（`:70` `for d in routes tui-v2 tui-v3 mcp cli l1 l1-interaction`）；L3 路径模式 `PAT_L3='(/l3/|/sentinel/|/expert-platform/|/expert/)'`（`:88`）；棘轮比对 `compare_baseline()`（`:96-125`）；`new > 0` 且 `SYNO_CI=1` → `FAIL=$((FAIL+1))`（`:157-159`）⇒ **CI strict = 硬阻断**。匹配的是 import 语句文本的三形态（`from ''` / `import('')` / `require('')`，`:132`），且 `strip_type_position()`（`:94`）**豁免 `import type` 与非值位置**。

| 方向 | 门禁规则（实测） | 本卡约束 |
|------|----------------|---------|
| **L1 → L3**（禁新增） | 基线 `tests/architecture/l1-cross-layer-baseline.txt` `[L1→L3]` 段实测：`src/routes/conversations.ts=1`、`src/routes/diagnosis.ts=1`（各已用满 1 处——`../l3/synova-diagnosis-engine-impl` 引擎动态 import，见下方原始输出 `:120` / `:278`） | **两文件各不得再出现任何 `../l3/**` 值导入**（否则 `2 > 1` = 2 处 `NEW` = PR CI 硬失败）。⇒ **呈现轴模块必须落 L2**（`src/agent/report-depth.ts`），L1 经 `../agent/report-depth` 取用 ⇒ 命中 `PAT_L3` 零次 |
| **L3 → L2**（本模块的依赖方向） | 门禁**未**设 L3→L2 检查（脚本内边界检查仅：L2→L4 `:40-57`、L1→L3/L4/L5 `:174-180`、L3→L5 `:181-199`）；架构规则（铁律 39 图：`L3 → L2 + L4`）**允许** L3 依赖 L2 | 本卡**不制造任何 L3→L2 的值导入**：子裁定 (i) 让章节标题**随数据走**（`chapters: {title, body}[]`），`src/l3/report-templates.ts` **零新增 import** ⇒ 既无 L1→L3，也无 **L2↔L3 循环 import**（唯一方向为既有的 L2→L3：`src/agent/report-assembler.ts` → `src/l3/report-templates.ts`，今日已存在，未改） |

**门禁现状实测（撰写/修订时，未写产品代码）**：`bash scripts/check-architecture.sh` → `1b./1c./1d.` 三段均为「存量违规…基线棘轮内」`new=0`，末行 **`架构检查: 全部通过 ✅`**，`exit=0`（全量原始输出见交付回报）。

---

## 4.5 决策参考（D333 四步 + 收敛检查）

> 每条给 **① 第一性原理 ② Anthropic 工程基线 ③ 开源实证 ④ 收敛检查**；本表即 §3 Q1c 的展开，**6 点裁定全部落在此**（对应成员 C 的 6 个未闭合点）。

### Q1（深度轴）——裁定：**新立独立呈现粒度轴 `ReportViewDepth = 'one_pager' | 'detailed'`，不与 `ReportDepth` 互通、不重载**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 「装配多少层数据」（`ReportDepth`：ceo/flywheel/expert/raw → `AssembledReport.data` JSON）与「输出几章多少字」（呈现粒度 → markdown）是**正交的两根轴**。实测 B3/B4 证明装配轴产出 JSON 而非章节 ⇒ 复用必然错义。 |
| ② Anthropic 基线 | 契约优先（铁律 47）：一根轴一个类型、一个词表。共享枚举会让 `?depth=expert` 二义（要 JSON？要章节？要一页纸？）。 |
| ③ 开源实证 | 同资源多视图走**查询参数 + 独立视图枚举**（`?format=…&depth=…`）是 HTTP 内容协商的通用形态；`format=markdown\|json` 已是既有形态（C2），`depth` 与之正交、互不覆盖。 |
| ④ 收敛检查 | **取值域**：`one_pager \| detailed`（**不含** ceo/flywheel/expert/raw）。**非法值/缺席语义**：回退 `one_pager`（= 今日现状）+ `log.warn` + 响应头 `X-Report-Depth-Degraded: UNKNOWN_DEPTH`（**不静默**，铁律 24）。**两轴映射**（唯一定义点：一页纸深度 `VIEW_TO_ONEPAGER_DEPTH` 在 `src/agent/report-depth.ts`（W1）；装配深度 `VIEW_TO_ASSEMBLE_DEPTH` 在 `src/agent/report-assembler.ts`（W3，`ReportDepth:31` 同文件）——**均为 L2，零跨层边**）：`one_pager → 装配 'ceo' / 一页纸 'ceo'`，`detailed → 装配 'expert' / 一页纸 'flywheel'`（`flywheel` 仅用于详版页头的 Top-N 更全，不额外接线）。 |

### Q2（装载层与文件数）——裁定：**L3 加第 4 模板 + L2 做映射；新增 src 模块 1 个（不是 3 个）**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 版式（模板）与数据装配（映射）必须分层：模板只认 `ReportData`，映射只认 `DiagnosisReport`。第 4 模板与既有 3 个同构 ⇒ 注册表是**唯一版式事实源**，不引入第二套加载轨。 |
| ② Anthropic 基线 | 最小可审单元：1 个新 src 模块（纯函数词表）+ 4 处同构扩展，优于 3 个新模块。 |
| ③ 开源实证 | add optional prop（`ReportData.chapters?`）而非新增 5 个模板专属字段——泛型章节数组把章节语义留在 L2，模板保持哑渲染器。 |
| ④ 收敛检查（**文件数硬算**） | D734 上限 **12 文件**（治理产物豁免）。本卡 **9 个预算内文件** = 5 改（`src/agent/report-depth.ts` 为新增，**L2**；`src/l3/report-templates.ts`、`src/agent/report-assembler.ts`、`src/routes/diagnosis.ts`、`src/routes/conversations.ts` 为改）+ 4 新 test；**+2 治理产物**（spec/brief）。**不触** `src/agent/builtin-tools.ts`（见 Q3 改动说明：3-3 走路由层，工具面不动 ⇒ 比 C 草案少 1 改）。**落层修正（Q7 A 案）不改变文件数**。 |

### Q3（3-3 判别归属层）——裁定：**L1 路由层确定性判别（关键词表），禁 LLM 判意图；不扩 `IntentRouter`**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 「说句话就切换」是可承诺的产品行为 ⇒ 必须**确定性**。LLM 判意图引入不确定性，且无法写「删掉即报红」的夹具。 |
| ② Anthropic 基线 | 判别纯函数化（零 I/O、可单测）；路由只做「取词 → 查表 → 分发」。既有测试文化钉死确定性（`report-onepager-trace.test.ts` 跨系统时刻字节相等）⇒ 判别不得引入任何时刻/随机。 |
| ③ 开源实证 | 命令式自然语言接口（CLI/git 风格）用**关键词表 + 最长匹配**实现确定性别名，而非语义模型。 |
| ④ 收敛检查（**确定性边界**） | 词表（**单源** `src/agent/report-depth.ts`，L2；按 `(长度 desc, 字典序 asc)` 排序，**逐条 `includes`，首个命中即判定**——最长匹配优先，故 `讲细一点` 先于 `细一点` 命中 `detailed`）：<br>· `detailed`：`讲细一点` / `再详细一点` / `详细` / `细一点` / `展开` / `深一点` / `再深` / `完整报告` / `全量`<br>· `one_pager`：`说人话` / `一句话` / `概览` / `简单说` / `太长了` / `看不懂` / `简短` / `总结一下`<br>**未命中 → 不切换**（不出现 `report_view` 帧，零行为变化），工具/日志侧 `log.debug`。**禁 LLM 判意图**；`IntentRouter`（E11）不动。 |

### Q4（对话桥报告产物字段）——裁定：**既有 `complete` 帧一字不改；旁挂新帧 `report_view`（不是给 `complete` 加字段）**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 深度切换可能发生在**没有新诊断的轮次**（诊断早已完成，用户后来说「讲细一点」）⇒ 挂到 `complete` 帧上会在主场景缺席。独立帧才能在两种轮次都出现。 |
| ② Anthropic 基线 | Additive 兼容：新帧类型对旧客户端是未知帧（A8/A9 实测断言方式为按 `type` 取帧、无严格序列 equality）⇒ 破面为零。 |
| ③ 开源实证 | SSE 事件流用 `event:` 名区分消息类别，新增事件类型是标准演进方式。 |
| ④ 收敛检查（**字段契约**） | `report_view` 帧：`{type:'report_view', sessionId, depth: ReportViewDepth, reportId: string \| null, markdown: string \| null, degraded: boolean, reason?: 'NO_REPORT' \| 'RENDER_DEGRADED'}`。硬约束：末帧仍为 `end`、**不得出现 `error` 帧**（A8）；无报告 → `markdown:null, degraded:true, reason:'NO_REPORT'`（**不伪造**）。 |

### Q5（真实入口形态）——裁定：**in-process app + 同款 `app.locals` 注入；不调完整 `createServer()`；必须把等价性写成断言**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 测试要能**判**。`createServer()` 的 bootstrap 失败会 `process.exit(1)`（E12）⇒ 测试进程被杀 = 不可判（假绿/假红都不可信）。 |
| ② Anthropic 基线 | 铁律 12：集成测试 cover **真实路由**，不 mock 管线。本卡用**真实 express app + 真实路由模块 + 真实 SessionStore（sqlite）+ 真实 HTTP `fetch`**。 |
| ③ 开源实证 | `tests/routes/diagnosis-report-persistence.test.ts:255` 已有「同 db 新 express app → 真实 fetch 打真实路由」范式（D593 先例）⇒ 沿用。 |
| ④ 收敛检查（**等价性断言**） | 测试内**必须显式断言**注入面与生产同形：① `app.locals.orchestration.db` 存在且为 SQLite 句柄；② `app.locals.graphStore` 已注入；③ 走 `router` 的真实路径（`app.use(diagnosisRouter)` / `app.use(conversationsRouter)`，非直调 handler）；④ 断言 `typeof db.prepare === 'function'`（区别于假对象）。四条任一失败即测试红 ⇒ 等价性**可判**而非声明。 |

### Q6（`extensions/reports/` 是否本卡范围）——裁定：**不扩 `.hbs`；走 markdown 单载体**

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 域不是理由（实测 `extensions/**` 属 win 域），**双轨同步成本**才是：`.hbs`（文件驱动，D7）与内存注册表（D1）是两套渲染轨，同时维护=漂移风险 ×2，且 D480 已把 markdown 定为报告主载体（`GET …?format=markdown`，C4）。 |
| ② Anthropic 基线 | 一轨一事实源；新增第二轨需独立卡与独立证据面（手机端响应式 = 3-5，导出 = 3-4）。 |
| ③ 开源实证 | 报告交付以「服务端渲染 markdown → 客户端样式化」为常见形态；HTML/PDF 属导出层（3-4）。 |
| ④ 收敛检查 | §6 逐条写明「不改 `extensions/reports/default.hbs` / `executive-summary.hbs` / `manifest.json`」；若后续裁定改走 `.hbs` 轨，须**另立卡**并同步本表第 4 行。 |

### Q7（DR-1 退回裁定：呈现轴的落层）——裁定：**A 案 + 子裁定 (i)**

> 触发：队长退回 `task-1`（rev 5），缺陷 **DR-1：新增 L1→L3 跨层违规 ⇒ CI strict 硬失败**。本规格初版把呈现轴模块放在 L3（`src/l3/report-depth.ts`），而 L1 的 `src/routes/diagnosis.ts`（读 `?depth=`）与 `src/routes/conversations.ts`（判别深度词）都要 import 它 ⇒ **两文件各 +1 → `2 > 1` = 2 处 NEW**。

| 步 | 内容 |
|----|------|
| ① 第一性原理 | 「深度词表 / 查询参数规范化 / 对话话语判别」全部是**编排层关注点**（解析入参、决定渲染策略），不是 L3 洞察层能力。放 L3 只是「版式相关所以放版式目录」的类比误推——**语义归属应看谁定义策略，而非看概念像谁**。 |
| ② Anthropic 基线 | 铁律 39 只允许 L1→L2 相邻依赖；门禁是**棘轮**（只减不增），存量违规不是「预留配额」而是待偿债。新增能力**不得消耗存量额度**。 |
| ③ 开源实证 | 分层仓库中「请求解释层（request interpretation）」惯例与编排层同居；跨层白名单/棘轮基线的通行做法是**新代码零新增命中**，而非提高基线。 |
| ④ 收敛检查（**选 A 不选 B**） | **A 案**：`src/l3/report-depth.ts` → **`src/agent/report-depth.ts`**（L2），配对测试 `tests/l3/report-depth.test.ts` → **`tests/agent/report-depth.test.ts`**。合法性：L1→L2 ✓（相邻）、L2 同层 ✓、L3→L2 ✓。**文件数不变（仍 9）**。**B 案被否**：让 L1 只透传原始字符串、由 L2 回深度结果——虽然也能消除 NEW，但把「解析 + 判别 + 映射」三件都塞进 `report-assembler.ts`（该文件已 533 行且持有 D791a 回归红线），**职责混杂 + 扩大热点文件改动面**；A 案把新概念集中在新文件，边界更清。 |

**子裁定 (i)（`DETAILED_REPORT_CHAPTER_TITLES` 归属）——裁定：L3 模板不依赖共享常量，章节标题随数据走。**

- `ReportData.chapters?: Array<{ title: string; body: string[] }>` —— **title 与正文同源**（由 L2 装配时一并写入）。
- `DETAILED_REPORT_CHAPTER_TITLES` 留在 **L2**（`src/agent/report-depth.ts`），**唯一消费者 = `src/agent/report-assembler.ts`（同层）**；`src/l3/report-templates.ts` 只做 `for (const ch of data.chapters)` 的哑渲染，**零新增 import**。
- **否决 (ii)**（明写 L3→L2 import）：虽然门禁未设 L3→L2 检查且铁律 39 允许，但 `src/agent/report-assembler.ts`（L2）今日已 import `src/l3/report-templates.ts`（L3）⇒ 再加 L3→L2 就构成 **L2↔L3 双向耦合**（运行时无环但**模块图成环**，后续任一侧改动都会引发两侧连锁），且为省一个字段引入跨层依赖，**收益不抵成本**。
- ⇒ **两个方向都要干净**：无 L1→L3（A 案保证）、无 L3→L2（子裁定 (i) 保证）、无 L2↔L3 环；唯一跨层边是既有的 L2→L3（未改动）。

**连带修订清单（本裁定波及）**：§3 Q0(a) 分层表 · §3 Q2 做什么 · §4 新增 G 节 · §5.1 写集表 W1/T1 与 W2 字段形状 · §5.2 契约块（路径 + `VIEW_TO_ASSEMBLE_DEPTH` 移至 W3）· §5.3 章节表 · §7.2 架构注（改为双向口径）· §7.4 新增门禁验收 · §8 接线指纹 #8 · §11 DS1/DS5/DS8 路径 · §12 自检链。**均已同步，无遗漏**（复核方式：`grep -n "src/l3/report-depth\|tests/l3/report-depth" <spec>` 应仅命中本 Q7 行的**历史对照**表述）。

---

## 5. What We Build

### 5.1 写集表（逐文件；两两不重叠；9 预算内 + 2 治理）

| # | 文件 | 操作 | 说明 | 层 | 承重验收点 |
|---|------|------|------|----|-----------|
| W1 | `src/agent/report-depth.ts` | **新建** | 呈现粒度轴单一事实源：`REPORT_VIEW_DEPTHS` / `ReportViewDepth` / `DEFAULT_REPORT_VIEW_DEPTH` / `normalizeReportViewDepth` / `VIEW_TO_ONEPAGER_DEPTH` / `DETAILED_REPORT_CHAPTER_TITLES` / `resolveViewDepthFromUtterance`（含词表常量）。**纯函数，零 I/O，零时刻，零 import**（不引 L3、不引其他 L2 模块——DR-1 裁定 A 案） | **L2** | 3-2 / 3-3 |
| W2 | `src/l3/report-templates.ts` | 改 | `ReportData` **+1 可选字段** `chapters?: Array<{ title: string; body: string[] }>`（**标题随数据走**——子裁定 (i)，本文件**零新增 import**）；注册第 4 模板 `detailed_report`（哑渲染 `data.chapters`，空章 → `[degraded]` 说明行）；既有 3 模板与既有字段**逐字不动** | L3 | 3-2 |
| W3 | `src/agent/report-assembler.ts` | 改 | +`renderDetailedReport(report)`、+`renderReportView(report, viewDepth, inputs?)` 分发器、+`VIEW_TO_ASSEMBLE_DEPTH`（**装配轴映射表唯一落点**——`ReportDepth` 本就定义于本文件 `:31`，与 W1 同层取值，**零跨层边**）、+`assembleOnePagerInputsForOrg(orgId, graphStore?)`（F4 的 S2/S3 装配**唯一实现**）、+`isRenderableDiagnosisReport(v)` 谓词；`renderOnePager`/`assembleReport` **逻辑零改** | L2 | 3-1/3-2/3-3 |
| W4 | `src/routes/diagnosis.ts` | 改 | `respondReport` 的 **markdown 分支**读 `?depth=`（默认 `one_pager`）；`renderOnePagerOnDemand` 改收 `viewDepth`；`buildOnePagerInputs`（`:723`）改为薄委托 `assembleOnePagerInputsForOrg`（**行为等价**）；私有 `isFullDiagnosisReportLike` **不动** | L1 | 3-1/3-2 |
| W5 | `src/routes/conversations.ts` | 改 | ① `handleConversationMessage` 内**确定性判别**深度词 → ② 取报告（本轮 `diagnosisResult.report` 优先，否则归档最新）→ ③ `renderReportView` → ④ 旁挂 `report_view` 帧。`complete` 帧（`:328-336`）**一字不改**；未命中词 → 零行为变化 | L1 | 3-3 |
| T1 | `tests/agent/report-depth.test.ts` | 新建 | W1 三路径：正常（两值全映射）/ 降级（非法值 → `undefined`；空串 → 未命中）/ 边界（**最长匹配优先级**：`讲细一点` 必须命中 `detailed` 而非被 `细一点` 截断；同长词字典序稳定）。**配对测试路径随 W1 落层同步**（DR-1 裁定 A 案） | — | 3-2/3-3 |
| T2 | `tests/agent/report-detailed.test.ts` | 新建 | W3 详细渲染三路径：正常（五章俱全）/ 降级（空 `rootCauses`/空 `expertReports` → 该章 `[degraded]` 且**不抛**）/ 边界（**删掉即红**：注入缺 `detailed_report` 的注册表 → 必须落到 fallback 并含降级标记；确定性：同输入两次字节相等） | — | 3-2 |
| T3 | `tests/routes/diagnosis-report-depth.test.ts` | 新建 | **真实路由集成**（Q5 四条等价性断言）：`?depth=detailed` → 200 text/markdown 且含章节标题；**不带 depth → 与 `?depth=one_pager` 字节相等**（零回归判别夹具）；非法 depth → 200 + `X-Report-Depth-Degraded` + 落回一页纸 | — | 3-1/3-2 |
| T4 | `tests/routes/conversations-report-view.test.ts`（**承重对象是路由帧，不是工具单测**——由 C 草案的 `tests/agent/builtin-tools-report-depth.test.ts` 改名而来，见下方改名说明） | 新建 | **对话帧集成**：注入归档报告（`saveDiagnosisCheckpoint`）→ `POST /api/conversations/:id/messages` 带「讲细一点」→ 流内出现 `report_view` 且 `depth='detailed'`、`markdown` 含章节；带「说人话」→ `depth='one_pager'`；**不含深度词 → 无 `report_view` 帧**（判别性夹具）；无报告 → `degraded:true, reason:'NO_REPORT'`；全程末帧 `end`、无 `error` 帧 | — | 3-3 |
| G1 | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1051-line3-report-depth-20260928.md` | 新建 | 本规格（治理产物，不计 PR 预算） | — | — |
| G2 | `.claude/task-briefs/2026-09-28-D1051-线3报告体系首切片-一页纸+详细报告+对话调深度.md` | 新建 | task brief（治理产物，不计 PR 预算） | — | — |

> **W5 撤销说明（对应 §4.5 Q2 收敛检查）**：成员 C 草案含 `src/agent/builtin-tools.ts` 改动（新增内建工具）。**本规格裁定 3-3 走路由层确定性判别**（Q3/Q4），故 **`src/agent/builtin-tools.ts` 移出写集**——工具面不动，写集由 6 改降为 5 改。
> **T4 改名说明**：3-3 的承重测试是**路由帧集成**，不是工具单测；文件名必须反映承重对象（`tests/routes/conversations-report-view.test.ts`）。

### 5.2 深度契约（`src/agent/report-depth.ts`，W1；**L2**，DR-1 裁定 A 案）

> **依赖方向声明（本模块的铁律 39 面）**：W1 **零 import** —— 不引 `src/l3/**`（不越层）、不引其他 `src/agent/**` 模块（不制造同层耦合）。`ReportDepth`（装配轴）与 `VIEW_TO_ASSEMBLE_DEPTH` 均落在 **W3**（同层，`:31` 定义处），因此本模块**不产生任何跨层边**；L1 两路由经 `../agent/report-depth` 取用（**L1→L2，相邻合法**）。

```ts
/** 报告呈现粒度轴（与装配轴 ReportDepth 正交——见 §4.5 Q1） */
export const REPORT_VIEW_DEPTHS = ['one_pager', 'detailed'] as const;
export type ReportViewDepth = (typeof REPORT_VIEW_DEPTHS)[number];

/** 浅层默认（3-1 是一页纸作为默认层） */
export const DEFAULT_REPORT_VIEW_DEPTH: ReportViewDepth = 'one_pager';

/**
 * 规范化任意入参为呈现深度。
 * 契约（铁律 47）:
 *   @input  — value: unknown（HTTP `?depth=` / 配置值 / 任意来源，不信任）
 *   @output — 'one_pager' | 'detailed' | undefined（undefined = 非法或非字符串，调用方回退默认 + 记降级）
 *   @degraded — 不降级（纯判定；判定失败以 undefined 表达，由调用方 log.warn + 回退默认）
 *   确定性：同输入同输出；零 I/O；零时刻。
 */
export function normalizeReportViewDepth(value: unknown): ReportViewDepth | undefined;

/** 呈现轴 → 装配轴（**不在此文件**——装配轴类型 `ReportDepth` 定义于 W3 `src/agent/report-assembler.ts:31`，
 *  故本映射表落 W3（同层 L2，零跨层边）。本文件不定义、不导出它，避免 L2 内互相 import。
 *  W3 侧形态：export const VIEW_TO_ASSEMBLE_DEPTH: Readonly<Record<ReportViewDepth, ReportDepth>>;
 *  one_pager → 'ceo' ｜ detailed → 'expert' */

/** 呈现轴 → 一页纸渲染深度（唯一映射点；决定页头 Top-N 全集宽度） */
export const VIEW_TO_ONEPAGER_DEPTH: Readonly<Record<ReportViewDepth, 'ceo' | 'flywheel'>>;
// one_pager → 'ceo' ｜ detailed → 'flywheel'

/** 详细报告章节标题（字面固定——W1 定义、**唯一消费者 = 同层 W3** 构造 `chapters` 时使用；
 *  L3 模板**不依赖本常量**（标题随数据走——§4.5 Q7 子裁定 (i)），故本文件对 L3 零可见性要求。
 *  漂移由单测守护。） */
export const DETAILED_REPORT_CHAPTER_TITLES = [
  '### 结论', '### 根因', '### 专家完整推理', '### 行动建议', '### 数据时点',
] as const;

/**
 * 对话话语 → 呈现深度（3-3 判别链；**确定性关键词表，禁 LLM 判意图**）。
 * 契约（铁律 47）:
 *   @input  — text: unknown（用户消息原文，不信任）
 *   @output — { depth: ReportViewDepth; matched: true; keyword: string } | { depth: DEFAULT; matched: false }
 *             （未命中返回默认值 + matched:false —— 调用方据此**不切换**，不静默改写）
 *   @degraded — 不降级（纯判别）；非字符串/空串 → matched:false（调用方零行为变化）
 *   判定规则：词表按 (长度 desc, 字典序 asc) 排序后逐条 includes，**首个命中即返回**（最长匹配优先）。
 *   确定性：同输入同输出；零 I/O；零随机；零时刻。
 */
export function resolveViewDepthFromUtterance(text: unknown):
  | { depth: ReportViewDepth; matched: true; keyword: string }
  | { depth: ReportViewDepth; matched: false };
```

### 5.3 章节契约与槽位契约（W2 + W3）

**详细报告章节表（`chapters` → markdown）**——数据源**全部为既有字段**，零新指标、零新窗口。**装载形状（§4.5 Q7 子裁定 (i)）**：`ReportData.chapters?: Array<{ title: string; body: string[] }>`——**标题随数据走**（W3 用 `DETAILED_REPORT_CHAPTER_TITLES[i]` 作 `title` 装配；W2 模板只做 `for (const ch of data.chapters)` 哑渲染，**不 import 任何常量**）：

| 章 | `title`（= `DETAILED_REPORT_CHAPTER_TITLES[i]`） | `body[]` 数据源（既有字段） | 空态（不静默 → 该章 `body` 为单行说明） |
|----|------|------------------|--------------|
| 1 | `### 结论` | `report.summary`（经 `enforceReport` 散文化，M1 对齐一页纸 S1 语义：结论可溯源） | `[degraded] 无结论内容可溯源` |
| 2 | `### 根因` | `report.rootCauses[]`，按 `confidence` **降序全量**（非 Top-N——这是「详细」的判别点），每行带 `[src:report:<reportId>#rootcause:<i>]` | `[degraded] 无根因记录` |
| 3 | `### 专家完整推理` | `report.expertReports[]`（`expert` + 全部 `findings[]` + `confidence`），每行带 `[src:report:<reportId>#expert:<i>]` | `[degraded] 无专家报告记录` |
| 4 | `### 行动建议` | `report.recommendations[]` **全量**（含 `priority` / `expert`），每行带 `[src:report:<reportId>#recommendation:<i>]` | `[degraded] 无行动建议记录` |
| 5 | `### 数据时点` | `report.generatedAt` **逐字透传** + 说明「本行为既有字段透传，**不主张 3-9 时间窗口径**（周/月聚合视图归 D828）」 | `[degraded] 报告缺数据时点` |

> **模板侧零 import 的可核性**：`git diff src/l3/report-templates.ts` 的**新增行不得含任何 `import` 语句**（唯一新增是 `ReportData.chapters?` 字段 + `DETAILED_REPORT` 模板对象）。验收命令：`git diff origin/main -- src/l3/report-templates.ts | grep -c "^+.*import"` → **必须为 0**。

**槽位契约（一页纸，3-1，**不得改语义**）**：四槽位标题与顺序 = `['### 结论','### 关键证据','### 各维度循环结论','### 行动建议']`（B7）；降级标记 = ASCII `[degraded]`（B8）；渲染输出**禁含渲染时刻**（B9）；`renderOnePager(report)` 默认 === `'ceo'`（B2 + 回归断言）；`ONEPAGER_CHAR_BUDGET=1200` 不因本卡变化（B10）。

**`renderDetailedReport` / `renderReportView` 契约**：

```ts
/**
 * 渲染详细报告（完整诊断各章节，markdown）。
 * 契约（铁律 47）:
 *   @input  — report: DiagnosisReport（完整引擎形状；调用方须先经 isRenderableDiagnosisReport 窄化）
 *   @output — markdown 字符串（`## <teamId> 诊断详细报告` 头行 + DETAILED_REPORT_CHAPTER_TITLES 五章；
 *             每章非空或含 `[degraded]` 说明行；条目行带可解析溯源指针 `[src:report:<reportId>#…]`；
 *             `📎 报告 ID: <reportId>` 尾行）
 *   @degraded — ① registry 抛错/返回「模板渲染失败」/「未找到模板」→ log.warn + 纯文本 fallback（含「降级」标记）
 *             ② 单章数据缺失 → 该章 `[degraded]` 说明行（其余章照常）
 *             ③ 渲染成功但条目行缺指针 → log.warn（不改写输出）
 *   本函数永不抛出（whole-body catch）。
 *   确定性：输出**禁含渲染时刻**（同输入 → 字节级同输出，幂等重跑前提）。
 *   不走 tone-enforcer（结构化 markdown 非散文，同 renderOnePager 先例）。
 */
export function renderDetailedReport(report: DiagnosisReport): string;

/**
 * 呈现深度分发器（3-2/3-3 共用入口——保证两入口同深度同产物）。
 * 契约（铁律 47）:
 *   @input  — report；viewDepth: ReportViewDepth；inputs?: OnePagerInputs（仅 one_pager 方向消费）
 *   @output — markdown 字符串（one_pager → renderOnePager 产物；detailed → renderDetailedReport 产物）
 *   @degraded — 透传被分发渲染器的降级语义（两渲染器均永不抛出）
 *   确定性：同输入同输出；分发本身零逻辑分支副作用。
 */
export function renderReportView(report: DiagnosisReport, viewDepth: ReportViewDepth, inputs?: OnePagerInputs): string;

/**
 * S2/S3 装配（消除两处实现——F4）。
 * 契约（铁律 47）:
 *   @input  — orgId: string（= 报告 teamId）；graphStore?: unknown（缺席 → S3 槽位降级）
 *   @output — Promise<OnePagerInputs>（两字段各自独立可选——缺席即模板侧 [degraded] 空态行）
 *   @degraded — 任一来源失败/为空 → 对应字段不设置 + log.warn（不静默、不阻断渲染，铁律 24/31）
 *   注：S2 经 L2 只读面 getSentinelExpertReports（模块单例，无需 req）；
 *       S3 经 L2 派生服务 buildCycleConclusions（graphStore 缺席 → S3 走 [degraded]）。
 */
export function assembleOnePagerInputsForOrg(orgId: string, graphStore?: unknown): Promise<OnePagerInputs>;
```

### 5.4 端点契约（W4）

| 入参 | 语义 | 响应 |
|------|------|------|
| `?format=markdown`（无 `depth`） | 浅层默认（**3-1**） | 现状一页纸，**字节级不变**；头 `X-Report-View-Depth: one_pager` |
| `?format=markdown&depth=one_pager` | 显式浅层 | 与上行**字节相等** |
| `?format=markdown&depth=detailed` | 详细报告（**3-2**） | 五章 markdown；头 `X-Report-View-Depth: detailed` |
| `?format=markdown&depth=<非法>` | 非法 | 回退 `one_pager` + `log.warn` + 头 `X-Report-Depth-Degraded: UNKNOWN_DEPTH`（**不静默**） |
| `?format=json`（含任何 depth） | JSON 分支 | **完全不变**（不新增字段、不加头）——`depth` 只作用于 markdown 渲染 |

**状态码语义不变**：命中缓存 → 200；归档冷读 → 200；均 miss → 404 `{ok:false, code:'NOT_FOUND'}`（C1 现状，C4）。**报告形状不完整**（归档非完整引擎形状）→ markdown 走既有摘要降级文案（C4），detailed 亦同（**不伪造章节**）。

### 5.5 3-3 帧契约（W5）+ 固定诊断产物（F5）

**`report_view` 帧**（新，additive）：
```jsonc
{ "type": "report_view", "sessionId": "<echo>", "depth": "one_pager|detailed",
  "reportId": "<id|null>", "markdown": "<markdown|null>", "degraded": false|true,
  "reason": "NO_REPORT|RENDER_DEGRADED" }   // reason 仅 degraded=true 时出现
```
- 触发条件：`resolveViewDepthFromUtterance(message).matched === true`。**未命中不出现该帧**（零回归）。
- 报告取源顺序：① 本轮 `diagnosisResult.report`（`phaseComplete` 且未断线）；② 否则归档最新报告 —— `store.listDiagnosisReports({limit:20,offset:0})` → `filter(r => r.teamId === orgId)` → 取 `completedAt` 最新 → `store.getDiagnosisCheckpoint(reportId)` → `isDiagnosisReportArchive` 窄化；③ 均无 → `markdown:null, degraded:true, reason:'NO_REPORT'`。
- 硬约束：流**末帧仍为 `end`**、**无 `error` 帧**；`complete` 帧既有 6 个字段（E7）**一字不改**；帧内 markdown 与 HTTP `?depth=` 同深度产物**必须同源同构**（同一 `renderReportView`，由 T4 断言）。

**固定诊断产物（须自备）**：main 无任何诊断报告产物（§1 偏差②）。本卡在**测试内**构造固定产物，**不新增仓库 fixture 文件**（控文件数），形状必须能过 `isDiagnosisReportArchive`（C12）与 `isRenderableDiagnosisReport`（W3）：

```jsonc
// partialReport（写入 saveDiagnosisCheckpoint，sessionId = reportId, phase = 5）
{ "reportId": "d1051-fixed-report-001", "teamId": "d1051-org", "completedAt": "2026-09-28T00:00:00.000Z",
  "source": "test",   // 实际取值 'conversation' | 'consult'（C12 只校验 string）
  "report": { "reportId": "d1051-fixed-report-001", "teamId": "d1051-org",
              "generatedAt": "2026-09-28T00:00:00.000Z", "summary": "增长健康度中等，现金流为关键约束。",
              "rootCauses": [{ "description": "现金流跑道不足 6 个月", "dimension": "finance", "confidence": 0.9 }],
              "expertReports": [{ "expert": "fundamental-efficiency", "findings": ["应收账期过长"], "confidence": 0.8 }],
              "recommendations": [{ "action": "启动应急融资", "priority": "critical", "expert": "fundamental-efficiency" }],
              "raw": {} } }
```

### 5.6 证据与兑换链路（三点各四项：可重跑 verify / 机器证据 `.json` / 真实入口 / 独立 V 判 red）

| 点 | ① 可重跑 verify | ② 机器证据落 `docs/synova/product-lines/evidence/` | ③ 真实入口 | ④ 改坏即红（V 独立） |
|----|----------------|--------------------------------|-----------|-------------------|
| 3-1 | `npx vitest run tests/routes/diagnosis-report-depth.test.ts` | `evidence-writer.py --type test --verdict pass --points 3-1 --source "tests/routes/diagnosis-report-depth.test.ts" --quote "<用例输出>"` | `GET /api/diagnosis/consult/:id/report?format=markdown` | V 删掉「默认 = one_pager」分支 → 无 depth 请求产物变化 ⇒ 必红 |
| 3-2 | `npx vitest run tests/agent/report-detailed.test.ts tests/routes/diagnosis-report-depth.test.ts` | `… --points 3-2 --source "tests/agent/report-detailed.test.ts"` | `GET …?format=markdown&depth=detailed` | V 从注册表移除 `detailed_report` → 必落 fallback（含降级标记）⇒ 必红 |
| 3-3 | `npx vitest run tests/routes/conversations-report-view.test.ts` | `… --points 3-3 --source "tests/routes/conversations-report-view.test.ts"` | `POST /api/conversations/:id/messages`（message=「讲细一点」） | V 让 `resolveViewDepthFromUtterance` 恒返回默认 → 无 `report_view` 帧/depth 不变 ⇒ 必红 |

**CT-62 新鲜度步骤（**不得用改口径消解**）**：`evidence-writer.py` 无 `--at`（A6 实测）⇒ 证据只带日期。**代码 commit 后的下一个自然日**重跑上表 verify 并落证据，消解同日 `stale`。spec 交付当日**不落点级证据**（避免制造 stale 记录）。

---

## 6. What We Don't Do（逐条带文件路径）

| # | 不做 | 路径 | 理由 |
|---|------|------|------|
| X1 | 不认领 / 不实现 3-4 报告导出（PDF/HTML） | `scripts/**`（导出链） | 独立验收点（`product-lines.yaml:182`），本卡不认领 |
| X2 | 不认领 / 不实现 3-5 手机端 | `extensions/reports/executive-summary.hbs` | 独立验收点（`:187`）；`.hbs` 轨不动（§4.5 Q6） |
| X3 | 不认领 3-6 创始人复述核验 | — | 人测类（`:192`），K3/创始人面 |
| X4 | **不认领 3-9 时间窗口径** | `docs/synova/product-lines/product-lines.yaml:208-212` | 口径已定且**依赖 D828**；本卡「数据时点」章仅**逐字透传 `generatedAt`**，不主张周/月聚合、不另立口径 |
| X5 | 不改 3-7 循环结论派生 | `src/agent/cycle-conclusion-service.ts` | D791a 已交付；S2/S3 装配仅**下沉复用**，逻辑不变 |
| X6 | 不改一页纸溯源审计 | `src/agent/report-onepager-trace.ts` | D791a 交付物，回归红线（§7） |
| X7 | 不改会话持久化 / checkpoint 读写语义 | `src/store/session-store.ts` | L5 只读复用（`listDiagnosisReports` / `getDiagnosisCheckpoint` / `isDiagnosisReportArchive`） |
| X8 | 不挂交互卡片 | `src/agent/interactive-card.ts` | 入参硬绑 `CardSentinelFinding`（E10）⇒ 挂上 = 扩写集 + 语义错配 |
| X9 | 不扩意图路由 | `src/agent/intent-router.ts` | 语义不对口（E11）⇒ 扩会动 L2/orchestrator 与既有维度路由 |
| X10 | **不改内建工具集** | `src/agent/builtin-tools.ts` | 3-3 走路由层判别（§4.5 Q3）⇒ 工具面零改动 |
| X11 | 不扩 `.hbs` 第二轨 | `extensions/reports/default.hbs`、`extensions/reports/executive-summary.hbs`、`extensions/reports/manifest.json` | 双轨同步成本（§4.5 Q6）；D480 已定 markdown 主载体 |
| X12 | 不改 GS-08 场景与断言 | `scripts/golden-scenarios/GS-08-report-readable/run.sh`、`expect.json`、`README.md` | **mac 域**（本轮 PR-B 未落 main，§1 偏差①）；本卡自备产物（§5.5） |
| X13 | 不改计划件与产品线登记 | `docs/synova/coordination/整体推进计划-主线-20260913.md`、`docs/synova/product-lines/product-lines.yaml` | **mac 域**；验收点状态由证据驱动改写，非本卡手改 |
| X14 | 不碰审计 | `scripts/audit/**` | K3 红线 |
| X15 | 不改 CI 与引擎遗产包 | `.github/**`、`packages/engine-core/**` | 越域 + 铁律 46 |
| X16 | 不新建路由 / 不新建 SSE 端点 / 不引入深度持久化状态 | — | 3-3 复用线 2 现成入口（`src/routes/conversations.ts:354,359`）；深度**每轮现算**，不写会话状态（幂等、免新状态机） |
| X17 | 不新造指标 | — | 零新比率 / 零新评分 / 零新阈值；章节数据源 100% 既有字段（§5.3 表） |

---

## 7. 回归红线

### 7.1 D791a 既有断言语义**不得改**（23 it / 140 expect，A5 实测）

| 文件 | it / expect | 钉死的契约（改这些 = 红线违规） |
|------|------------|---------------------------|
| `tests/agent/report-assembler.test.ts` | 5 / 29 | `renderOnePager(report)` 默认 === `'ceo'` 深度（`:130`）；正常路径 `not.toContain('降级')`（`:61,74,122`）；空 `rootCauses` → 「运行平稳」且无降级标记（`:69-74`）；registry 抛错 → 纯文本 fallback 含「降级」（`:93`）；`assembleReport(report,'flywheel')` 四层语义不变（`:135-143`） |
| `tests/agent/report-onepager-trace.test.ts` | 12 / 71 | `EXECUTIVE_SUMMARY_SLOT_TITLES` 与 `ONEPAGER_SLOT_TITLES` **双源相等**（`:140`）；四槽位结构；指针 `[src:<kind>:<ref>]` 可解析；**确定性**（跨系统时刻字节相等）；`ONEPAGER_CHAR_BUDGET` / `CONCLUSION_MAX_CHARS` / `MAX_LINE_CHARS` |
| `tests/agent/cycle-conclusion-service.test.ts` | 6 / 40 | S3 循环结论派生语义与指针 |

**约束**：三文件**一行不改**。本卡改动若使其中任一红 ⇒ **退回实现**，不修改测试迁就实现。

### 7.2 其他不得回归面

- `tests/routes/diagnosis-report-persistence.test.ts`（含用例 10：`?format=markdown` → `text/markdown` 200）、`tests/routes/diagnosis-consult-events.test.ts:161`（GET report 行为零回归）、`tests/routes/diagnosis-customer-config.test.ts`（`report.onePager` 为字符串且非空）——**均须保持绿**。
- 注册表加第 4 模板**安全**：D6 实测 report 模板注册表**零长度断言**。
- 对话帧 additive **安全**：A8 实测无严格序列 equality；硬约束仅「末帧 `end`、无 `error` 帧」。
- 架构边界（**双向口径，DR-1 修正后**——详见 §4 G 节与 §4.5 Q7）：
  - **L1 → L3 禁新增**：`src/routes/diagnosis.ts` 与 `src/routes/conversations.ts` 的 `[L1→L3]` 基线**各 = 1（已用满）**。⇒ 本卡两文件**不得出现任何 `../l3/**` 值导入**；呈现轴模块经 **`../agent/report-depth`（L2）**取用。
  - **L3 → L2 本卡不新增**：`src/l3/report-templates.ts` **零新增 import**（章节标题随 `chapters[].title` 数据走 ⇒ 无需 import L2 的常量）。⇒ 既无 L1→L3，也无 **L2↔L3 双向耦合**（唯一跨层边是既有的 L2→L3：`report-assembler.ts` → `report-templates.ts`，未改）。
  - **L2 内同层**：`src/agent/report-depth.ts` **零 import**；`VIEW_TO_ASSEMBLE_DEPTH` 落 W3（`ReportDepth` 同文件定义）。

### 7.3 判别性夹具（「删掉即报红」——铁律 0-2 第 5 步 + 坑清单第 8 条）

| # | 夹具 | 删掉/改坏什么 | 必须报红的方式 |
|---|------|-------------|--------------|
| J1 | 3-2 载体 | 从注册表构造器移除 `DETAILED_REPORT` | T2 断言 `expect(md).toContain('### 根因')` 失败（fallback 无章节） |
| J2 | 3-1 零回归 | 让无 `depth` 请求改走 detailed | T3 断言「无 depth 产物 === `?depth=one_pager` 产物（字节相等）」失败 |
| J3 | 3-3 判别 | 让 `resolveViewDepthFromUtterance` 恒返回默认 | T1「`讲细一点` → `matched:true`」+ T4「含词 → 出现 `report_view`」双红 |
| J4 | 3-3 最长匹配 | 词表未按长度降序排 | T1「`讲细一点` 命中 `detailed` 且 `keyword==='讲细一点'`」失败 |
| J5 | 3-3 零回归 | 未命中词也发 `report_view` 帧 | T4「不含深度词 → 无 `report_view`」失败 |
| J6 | 降级不静默 | 删掉 `[degraded]` 空态行 | T2「空 `expertReports` → 该章含 `[degraded]`」失败 |

---

### 7.4 架构门禁验收（**可重跑**；DR-1 退回新增，必须贴原始输出全文）

```bash
# 硬门禁：L1→L3 段 new=0（CI strict 下 new>0 = 硬阻断，见 §4 G）
bash scripts/check-architecture.sh
```

**通过判据（逐条）**：
1. `1b. L1→L3 跨层引用` 段**不出现** `❌`、**不出现** `基线外新增`（`new=0`）；允许出现「存量违规 N 处（基线棘轮内）」。
2. 输出**不得**出现 `↳ src/routes/diagnosis.ts: 实际 2 > 基线 1` 或 `↳ src/routes/conversations.ts: 实际 2 > 基线 1` 形态的行。
3. `SUMMARY total=… new=…`（脚本内部棘轮比对摘要；如需单独取用：`SYNO_ARCH_BASELINE=tests/architecture/l1-cross-layer-baseline.txt` 下 `compare_baseline` 的 `new` 计数字段）。
4. 末行 `架构检查: 全部通过 ✅`，`exit=0`。
5. 三段 `[L1→L3]/[L1→L4]/[L1→L5]` 的 **`new` 均为 0**（本卡若因其他存量文件漂移导致任一 `new>0`，**退回实现**并报 CTO——不得抬高基线消解）。

**独立反证（V 必做）**：临时把 `src/routes/diagnosis.ts` 的深度解析改成直接 `import … from '../l3/report-depth'` → 跑同一命令 → **必须出现 `实际 2 > 基线 1` + `❌ … [CI strict——软提示在 CI 上为硬阻断]`**（这是「门禁真的在管这件事」的判别性证据）；还原后必须回到 `new=0`。

## 8. 接线点（每条新 export 的生产调用点 + grep 指纹）

| # | 新 export（文件） | 生产调用点（写进 src/ 的调用） | grep 指纹（实现完成后须命中，**禁 `head` 截断**） |
|---|------------------|----------------------------|----------------------------------------------|
| 1 | `renderReportView`（W3） | `src/routes/diagnosis.ts`（markdown 分支）+ `src/routes/conversations.ts`（`report_view` 帧） | `grep -rn "renderReportView" src/` → 期待 **3 行**（1 定义 + 2 调用） |
| 2 | `renderDetailedReport`（W3） | 经 `renderReportView` 的 `detailed` 分支（**唯一调用点**） | `grep -rn "renderDetailedReport" src/` → 期待 **2 行**（1 定义 + 1 调用） |
| 3 | `assembleOnePagerInputsForOrg`（W3） | `src/routes/diagnosis.ts:723`（薄委托）+ `src/routes/conversations.ts`（`one_pager` 方向装配） | `grep -rn "assembleOnePagerInputsForOrg" src/` → 期待 **3 行** |
| 4 | `isRenderableDiagnosisReport`（W3） | `src/routes/diagnosis.ts`（detailed 分支前置窄化）+ `src/routes/conversations.ts`（归档报告窄化） | `grep -rn "isRenderableDiagnosisReport" src/` → 期待 **3 行** |
| 5 | `normalizeReportViewDepth`（W1） | `src/routes/diagnosis.ts`（`?depth=` 解析）+ `src/routes/conversations.ts`（判别结果校验） | `grep -rn "normalizeReportViewDepth" src/` → 期待 **3 行** |
| 6 | `resolveViewDepthFromUtterance`（W1） | `src/routes/conversations.ts`（每轮判别，**唯一生产调用点**） | `grep -rn "resolveViewDepthFromUtterance" src/` → 期待 **2 行** |
| 7 | `REPORT_VIEW_DEPTHS` / `DEFAULT_REPORT_VIEW_DEPTH` / `VIEW_TO_ONEPAGER_DEPTH`（W1） | `src/routes/diagnosis.ts` + `src/routes/conversations.ts` | `grep -rn "REPORT_VIEW_DEPTHS\|DEFAULT_REPORT_VIEW_DEPTH\|VIEW_TO_ONEPAGER_DEPTH" src/` → 期待 **≥4 行** |
| 8 | `DETAILED_REPORT_CHAPTER_TITLES`（W1，L2） | **唯一生产调用点 = `src/agent/report-assembler.ts`（同层 W3）**；`src/l3/report-templates.ts` **不得**出现该符号（子裁定 (i)：标题随数据走） | `grep -rn "DETAILED_REPORT_CHAPTER_TITLES" src/` → 期待 **恰 2 行**（1 定义 + 1 调用）；且 `grep -rn "DETAILED_REPORT_CHAPTER_TITLES" src/l3/` → **0 行** |
| 9 | 模板名 `detailed_report`（W2） | `src/agent/report-assembler.ts`（`renderDetailedReport` 内 `registry.render('detailed_report', …)`） | `grep -rn "detailed_report" src/` → 期待 **≥2 行**（注册 + 消费） |
| 10 | **架构：L1→L3 零新增**（DR-1） | L1 两路由经 `../agent/report-depth`（L2）取用，**不出现 `../l3/**` 新值导入** | `bash scripts/check-architecture.sh` → `1b. L1→L3` 段 `new=0`（§7.4）；`grep -nE "from ['\"]\.\./l3/\|import\(['\"]\.\./l3/" src/routes/diagnosis.ts src/routes/conversations.ts` → **仍各恰 1 行**（既有 `../l3/synova-diagnosis-engine-impl`，不得变成 2） |
| 11 | **架构：L3 模板零新增 import**（子裁定 (i)） | `src/l3/report-templates.ts` 只加字段与模板对象 | `git diff origin/main -- src/l3/report-templates.ts \| grep -c "^+.*import"` → **0** |

> **WIRE CHECK 硬门禁（铁律 0-2 第 5 步）**：上表 **11 条**指纹**全部命中**才算接线完成；任一条 0 命中 = 未完成，**不得声称交付**。
> `VIEW_TO_ASSEMBLE_DEPTH` 落 W3（同层，`ReportDepth` 定义处）——指纹 #7 的调用点仍在两路由，期待行数不变。

---

## 9. 边界值清单（每个数值/集合参数：空 / 单元素 / 恰临界 / 超限 / 零 / 负值）

| 参数 | 空 | 单元素 | 恰临界 | 超限 | 零 / 负值 | 期望行为 |
|------|----|-------|-------|------|----------|---------|
| `?depth=` | 缺席 | `one_pager` | `detailed` | `expert`（**非法**，属装配轴词） | `''` / `'0'` / `-1` | 缺席 & 非法 → 默认 `one_pager` + `log.warn` + 头 `X-Report-Depth-Degraded`；`expert`/`0`/`-1` 一律按非法 |
| `report.rootCauses` | `[]` | 1 条 | 恰 3 条（一页纸 Top3 满） | 100 条（详细报告**全量**输出，不截断） | — | 空 → 该章 `[degraded]`；详细章不设上限（「详细」的判别点） |
| `report.expertReports` | `[]` | 1 位专家 / 1 条 finding | 同专家多 finding | 6 位专家 × 多 finding | — | 空 → `[degraded]`；全量输出 |
| `report.recommendations` | `[]` | 1 条 | 恰 3 条 | 50 条 | — | 空 → 该章 `[degraded]` |
| `report.generatedAt` | `''` | 合法 ISO | 跨时区 ISO（带 offset） | 非法串 | — | 空/非法 → `[degraded] 报告缺数据时点`（**逐字透传，不解析不换算**） |
| `report.reportId` | `''` | 合法 id | — | — | — | `''` → 指针省略（`conclusionPointer` 同源先例，B9）；不伪造 |
| 对话 `message` | `''`（**上游已 400**） | 1 字符 | 恰命中词边界（如「细」单字） | 8000 字符（`MESSAGE_MAX`，`:45`） | — | 空/超限由既有校验 400（不改）；未命中词 → `matched:false`，**零行为变化** |
| 词表匹配 | 无命中 | 1 命中 | 重叠命中（`讲细一点` vs `细一点`） | 多命中（同时含 detailed 与 one_pager 词） | — | **最长优先**；同长取字典序在前者；**判定唯一且稳定**（T1 断言） |
| `store.listDiagnosisReports` | 0 报告 | 1 报告 | `limit=20` 边界（21 条报告） | >200（内部夹取 1..200，C15） | `limit=0` | 0 → `reason:'NO_REPORT'`；>20 时**取 orgId 过滤后 `completedAt` 最新**（跨 org 报告不得误用） |

---

## 10. 风险与上限

| # | 风险 | 应对 |
|---|------|------|
| R1 | **热点文件争用**：`src/routes/diagnosis.ts`、`src/agent/report-assembler.ts` 被多卡引用 | 同文件**单写者**；本卡不并发改这两文件的其他卡。`src/l3/report-templates.ts` 若被他卡（如 D828 无关）占用 → 停下报 CTO |
| R2 | **D828 依赖面** | D828（趋势接线）为 win+mac 跨域（`docs/synova/coordination/Win域代行安排-20260918.md:30`），写集含 `src/l4/**` 与 `src/sentinel/**`，**与本卡 9 文件零重叠**；但 3-9 口径归 D828 ⇒ 本卡「数据时点」章**仅透传**（X4） |
| R3 | 写集越域 | 每个文件先过 `check-ownership.py --owner win`（A3 已实测 10/10 PASS）；**禁碰** `scripts/**`、`docs/synova/coordination/**`、`.github/**`、`scripts/audit/**` |
| R4 | PR 预算 | 预算内 **9 文件**（5 改 + 4 新 test）≤12 ✓；治理产物 2 件不计（D860 口径） |
| R5 | 重型验证压机 | vitest / 全量门禁 / 黄金门禁**串行**，同时间 ≤1 个（8GB 机器已两次压满） |
| R6 | 接线了≠被执行 | §8 九条 grep 指纹 + §7.3 六个判别性夹具（「删掉即报红」）+ §5.5 四项四件套 |
| R7 | 证据新鲜度 | CT-62（A6）：**次日重跑**落证据，不用改口径消解 |
| R8 | 前置未满足 | 若发现 `renderOnePager` 契约已被他卡改动（B2/B9 与实测不符）→ **停，报 CTO**，不抢跑 |
| R9 | 中段破面 | 只动尾部呈现：不改 `runModules` / `ExpertDispatcher` / `SignalAggregator` / 引擎六阶段；`GET …/report` 默认路径字节级不变（J2 夹具守护） |

---

## 11. DS 清单（delivery statements，逐条可核，供 K3 复审）

| # | 声明 | 核验方式 |
|---|------|---------|
| DS1 | 呈现粒度轴为**独立轴**，取值域恰 `{one_pager, detailed}`，与 `ReportDepth`(4 值) 不相通 | `grep -n "REPORT_VIEW_DEPTHS" src/agent/report-depth.ts`；T1 断言 `expert/raw/ceo/flywheel` 均 `undefined` |
| DS2 | 注册表新增**恰 1 个**模板 `detailed_report`，既有 3 模板与既有 `ReportData` 字段逐字未改 | `git diff src/l3/report-templates.ts`；`grep -c "name:" src/l3/report-templates.ts` = 4 |
| DS3 | 无 `depth` 的 markdown 请求产物与改动前**字节级相同** | T3 断言「无 depth === `?depth=one_pager`」（J2） |
| DS4 | 非法 `depth` **不静默**：fallback `one_pager` + `log.warn` + `X-Report-Depth-Degraded: UNKNOWN_DEPTH` | T3 断言响应头存在 + 断言返回一页纸结构 |
| DS5 | 详细报告为**五章**，章标题来自 `DETAILED_REPORT_CHAPTER_TITLES` 单源（**L2 定义、L2 消费；标题经 `chapters[].title` 随数据进 L3**） | T2 断言五章标题齐全；`grep -rn "DETAILED_REPORT_CHAPTER_TITLES" src/` = **恰 2 行**；`grep -rn "DETAILED_REPORT_CHAPTER_TITLES" src/l3/` = **0 行** |
| DS6 | 详细报告章节数据源 **100% 既有字段**，零新指标 / 零新窗口 | `git diff` 中无新比率/评分/阈值常量；`src/agent/report-assembler.ts` 新增行不含算术聚合 |
| DS7 | 详情渲染**永不抛出**且**不含量化时刻** | T2 注入抛错注册表 → 返回含降级标记的字符串（不 throw）；同输入两次 `toBe` 相等 |
| DS8 | 3-3 判别为**确定性关键词表**（不含 LLM 调用、不含随机、不含时刻） | `grep -rn "resolveViewDepthFromUtterance" src/agent/report-depth.ts`；T1 同输入两次相等 |
| DS19 | **架构双向干净（DR-1）**：L1 零新增 `../l3/**` 值导入；L3 模板零新增 import | `bash scripts/check-architecture.sh` → `1b. L1→L3` 段 `new=0`（§7.4）；`git diff origin/main -- src/l3/report-templates.ts \| grep -c "^+.*import"` = **0**；`grep -nE "from ['\"]\.\./l3/\|import\(['\"]\.\./l3/" src/routes/diagnosis.ts src/routes/conversations.ts` 各恰 1 行 |
| DS20 | 呈现轴模块**零 import**（无 L1→L3、无 L2↔L3 环） | `grep -cE "^import\|^} from\|from '" src/agent/report-depth.ts` = **0**（除 JSDoc 注释外无 import 语句） |
| DS9 | 3-3 未命中词 → **零行为变化**（无 `report_view` 帧） | T4 断言（J5） |
| DS10 | `report_view` 帧为 **additive**，`complete` 帧既有 6 字段一字未改 | `git diff src/routes/conversations.ts` 中 `complete` 帧块无删除行；T4 断言末帧 `end` + 无 `error` 帧 |
| DS11 | 对话路与 HTTP 路**同深度同产物**（同源 `renderReportView`） | `grep -rn "renderReportView" src/` = 3 行；T4 断言帧内 markdown 与 HTTP 产物同构 |
| DS12 | 无报告时**不伪造**（`markdown:null, degraded:true, reason:'NO_REPORT'`） | T4 断言 |
| DS13 | `buildOnePagerInputs` 下沉为**行为等价**委托（D791a 路径零回归） | 23 it/140 expect 三文件全绿（A5）；`git diff` 仅删除函数体、改为委托调用 |
| DS14 | 写集**仅 win 域**且 **≤12 文件**（治理产物不计） | `check-ownership.py <写集> --owner win` → PASS；`git diff --stat` 文件数 ≤9 |
| DS15 | §8 九条接线指纹**全部命中** | 逐条 `grep -rn` 原始输出（禁 `head` 截断） |
| DS16 | 三点证据落 `docs/synova/product-lines/evidence/`，且**次日重跑**（CT-62） | `ls -1 docs/synova/product-lines/evidence/ \| grep <date>`；证据 `.json` 含 3-1/3-2/3-3 |
| DS17 | 免责边界：**未**实现 3-4/3-5/3-6/3-9；**未**改 GS-08 场景 | `git diff --stat` 不含 `scripts/**`、`extensions/**`、`docs/synova/coordination/**` |
| DS18 | 无死代码 / 无 `as any` / 无空壳测试 | `grep -rn "as any\|as never\|as unknown as" <写集>` = 0；每个新 test 文件 `grep -c "expect("` > 0 |

---

## 12. 自检清单（规格作者自验，撰写完成后执行）

```bash
# ① 交付存在性
test -f docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1051-line3-report-depth-20260928.md
test -f .claude/task-briefs/2026-09-28-D1051-线3报告体系首切片-一页纸+详细报告+对话调深度.md
# ② brief 结构（≥5 个 ## Q + ≥1 个 CRITERIA）
grep -c "^## Q" .claude/task-briefs/2026-09-28-D1051-线3报告体系首切片-一页纸+详细报告+对话调深度.md
grep -c "CRITERIA" .claude/task-briefs/2026-09-28-D1051-线3报告体系首切片-一页纸+详细报告+对话调深度.md
# ③ 写集域（从本 spec 提取 src/tests 路径，断言全 win）
python3 scripts/control-tower/check-ownership.py \
  $(grep -oE 'src/[A-Za-z0-9_./-]+\.ts|tests/[A-Za-z0-9_./-]+\.ts' \
    docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1051-line3-report-depth-20260928.md | sort -u) --owner win
# ④ 改动面
git diff --stat
# ⑤ 架构门禁（DR-1 修正后必跑）——1b. L1→L3 段须 new=0
bash scripts/check-architecture.sh
# ⑥ DR-1 复核：旧路径不得残留（仅允许 Q7 行的历史对照表述）
grep -n "src/l3/report-depth\|tests/l3/report-depth" \
  docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1051-line3-report-depth-20260928.md
```

> **规格边界声明**：本规格**不写任何产品代码**（`git diff --stat` 中 `src/**`、`tests/**` 必须为 0 行改动）。规格作者与实现者**分离**（`squad-discipline` 独立性硬要求）；本规格须**先落 main 可读**，实现方不得引用未落 main 的规格路径。

---

## 附：权威件引用（路径 + 版本，供 K3 复核）

| 件 | 路径 | 版本/哈希 |
|----|------|----------|
| 整体推进计划（主线） | `docs/synova/coordination/整体推进计划-主线-20260913.md` | v1.2 / sha256 `4e46603f…` |
| 产品线验收点 | `docs/synova/product-lines/product-lines.yaml` | 线 3 `:159-199`；3-9 `:208-212` |
| 产品完成度设计 | `docs/plans/codex/strategy/SYNOVA-DESIGN-产品完成度仪表盘-v1-20260816.md` | v1.4 |
| D791 一页纸规格（前序） | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D791-line3-report-onepager-20260917.md` | 已落 main（`b396bafc`） |
| 创始人裁定表 §6 五项 | `docs/synova/coordination/创始人裁定表-§6五项-20260920.md` | §6-5 ③（时间窗口径） |
| Win 域代行安排（D828） | `docs/synova/coordination/Win域代行安排-20260918.md` | `:30` |
| 域归属真相源 | `scripts/control-tower/check-ownership.py`（`ownership.yaml`） | D733 |
