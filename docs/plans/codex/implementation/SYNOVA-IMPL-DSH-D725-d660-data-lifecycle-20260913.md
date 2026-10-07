---
north-star:
  服务用户: GA（直接用户）+ 企业主（最终受益者）——痛点是"报告凭什么这么说"：诊断结论必须能沿证据链一路回溯到原始数据。按时间删证据 = 报告变成无源之水
  服务场景: Synova 7×24 驻扎企业，Evidence 持续累积 → 蒸馏成 Findings/Facts/Knowledge；GA 交报告后客户追问"这个结论哪来的"要能追；运维要判"哪些数据可以安全释放、哪些一删就断链"
  模块终态: 五层数据各有明确的保留分级 + 触发条件 + 降级契约；**唯一允许物理删除的层是 Evidence，且必须"已蒸馏"（证据已被更高层引用过）**；其余四层只归档 / 走版本链 / git 永久。默认永久不按时间删；时间清理需双键显式开启且留痕；任何判定失败一律 fail-closed（不删）
  对齐北星: PRODUCT-BRIEF.md §一（7×24 驻扎、主动发现、给出行动建议——诊断是手段，增长是目的，可溯源的证据链是"靠数据不靠感觉"的物理前提）+ §二（直接用户=GA / 最终受益者=企业主）+ §六 P0（诊断报告质量验证——报告准不准，前提是证据链没被人为掐断）
  完成标准: 入口 = bootstrap Phase 5c 注册的内务作业（启动即跑一次 + 每日 03:30 cron）；处理 = 读保留分级 → 判蒸馏完成 → 仅删"已蒸馏"证据（未蒸馏一律保留）；结果 = EvidenceRetentionResult{tier,windowMs,deleted,skipped,degraded} 落日志 + degradedModules。**可证伪点三条**：① provenance 为空时 deleted 恒为 0；② 只设 TIER=periodic（不设 DAYS）时不再删任何证据；③ enterprise_fact 层不存在任何按时间物理删路径
  当前进度: L2 部分达成——D717（分支 feat/mac-d717-product-debt，PR #527 **未合并 main**）已落地"默认 permanent 不按时间删" + degraded 契约 + bootstrap 生产接线；但依据的「蒸馏完成」概念全仓零权威出处（唯一出处是 board-backlog.json 的转述），蒸馏判定无实现、双键门缺失；L4 仍存在活的按时间物理删路径（purgeExpired 零调用方）；L1/L3 零归档机制。本 spec 是「蒸馏完成」的首次权威定义 + 五层阶梯成文 + Win 线实施交接包
---

<!-- ⚠️ 已由《DSH 权威手册 v1（2026-09-17）》部分取代（docs/synova/research/DSH权威手册-v1-20260917.md，见其 §6.5）。

被取代的部分（实测证据，来源 B/C）：
  ① 「D717（PR #527 未合并 main）」→ 已失效：#527 已合并（git merge-base --is-ancestor 退出 0）。
     连带：本文「基线声明」（origin/main @2bc0f724 + PR #527）已过时；origin/main 现为 0f59e514。
  ② 「L4 仍存在活的按时间物理删路径（purgeExpired 零调用方）」→ 已失效：purgeExpired 现有 1 个生产调用方。
  ③ 「expireOld main 零调用方（#527 补 1）」→ 已失效：现 7 个生产调用方。
  ④ 「autoSediment / runPKBLifecycle 零生产调用方（M3）」→ 已失效：autoSediment 现 2 个生产调用方。
  ⑤ src/l3/evidence-distillation.ts（本文计划新建的蒸馏判定模块）→ 仍不存在（本 spec 未实施）。

仍然有效的部分（本文的核心资产）：
  · §5.2 五层保留分级阶梯（L1 permanent-append-only / L2 permanent + 蒸馏判据 / L3 terminal-archive
    / L4 versioned-immutable / L5 permanent-git）与「唯一允许物理删除的层是 Evidence 且必须已蒸馏」的终态定义
  · §5.4 双键门设计（TIER + DAYS 双键，任一单键不得启用删除）
  · §7 可证伪点三条、§5.5 蒸馏判据三选一裁决过程、§6 降级契约（fail-closed 不删）
  · src/evidence/evidence-store.ts 的 4 个行号引用（L22 / L30 / L74 / L121）经复核 4/4 精确命中，文件行数 128 与本文一致

执行前必做：git fetch --all && git pull --ff-only 后重核所有行号（本文第 15 行自己也这么要求——该要求已被本批复核证明是必要的）。
-->

<!--
  SYNOVA-IMPL-DSH-D725: D660 数据生命周期五层阶梯（保留分级 / 触发条件 / 降级契约）
  状态: dev doc（spec） | 2026-09-13 | 优先级 P0 | 证明层级: L3 洞察层（保留编排）+ L4 本体（EvidenceStore / AgentMemoryStore）+ L5 存储
  归属: 实施归 **Win 线（Claude Code）**（创始人 2026-09-13 裁定，§1 权威①）
  基线声明: 本 spec 基线 = origin/main @2bc0f724 **+ PR #527**（feat/mac-d717-product-debt @d04d03cb，含 D717 全部 8 提交，**未合并 main**）。D717 引入的 src/l3/evidence-retention.ts 与 src/deploy/bootstrap.ts 改动只在 #527 上；#527 合入 main 后行号必漂移 → 编码阶段前置 git fetch --all && git pull --ff-only 后**重新核验行号**（防 D524 M7 漂移）
  编号说明: 本任务在 CTO 台账（问题总账与下一批派单-20260913.md §四）中计划号为 D727；按 D384 取号纪律，实际编号由 scripts/control-tower/alloc-task-id.sh 分配为 **D725**（D725-D728 在台账中均为计划号、零登记；自编号 = 撞车风险，D382/D339 教训）。本 doc 编号、task-state 登记、分支名一律以 D725 为准
-->

# SYNOVA-IMPL-DSH-D725：数据生命周期五层阶梯（D660）

> 一句话问题: D717 已经按「默认不按时间删」把证据保留分级落了地，但它依据的**「蒸馏完成」这个概念全仓找不到出处**——唯一出现处是 docs/synova/coordination/board-backlog.json 里 CTO 对创始人 2026-09-10 发言的**转述**，创始人原话没有留档，D717 报告又把它写成了「创始人已裁定」（K3 台账 D717-N4 已记为精度失实）。一个"什么时候可以删掉客户证据"的规则，建立在一句转述 + 一处推断上——这就是本 spec 要确权的对象。同时，五层数据各自的保留分级、触发条件、降级契约从未成文，各层行为各自为政：L4 还留着一条活的按时间物理删路径，L1/L3 连归档机制都没有。

## 1. Authority Doc Verification

### 权威 ① — 创始人 2026-09-13 裁定（本 spec 的**首席权威**，逐字记录）

本 spec 起草前就「蒸馏完成」语义、默认分级与开关粒度、「1-5 实施交接包」指向三问请示创始人，裁定如下（原文照录）：

| # | 问题 | 创始人裁定（逐字） |
|---|---|---|
| 1 | 「蒸馏完成」到底指哪一刻证据可以释放？ | **A) 证据已被更高层引用过（溯源链建立）才算完成** |
| 2 | 按「按时间清理是错误模型」的原意，SYNOVA_EVIDENCE_RETENTION_TIER / _DAYS 开关怎么定？ | **A) 保留开关，但默认 permanent 且删除时必须显式二次确认** |
| 3 | 派单中「1-5 实施交接包（Win 侧执行）」的「1-5」所指？ | **A) 指本 spec 的五层阶梯（层 1-5）实施交接包，交 Win 线执行** |

> **确权结论（本 spec 的核心交付）**：`蒸馏完成` 从本 spec 起获得权威定义 = **「该条证据已被更高层（L3 发现/工单、L4 事实、L5 知识）引用过，溯源链已建立」**。此前全仓零出处（§4.3 穷举证）。
>
> **对 D717 表述的更正**：D717 报告写「创始人 2026-09-10 **已裁定**」某模型——与事实不符。事实是：创始人 2026-09-10 **提出方向**（按时间清理是错误模型），**语义由 2026-09-13 本 spec 请创始人首次裁定**。D717 的**代码注释措辞是准确的**（写的是"创始人 2026-09-10"并标注"D660 spec 落地后…"），失实仅在其交付报告的表述强度（K3 台账已记为 D717-N4，非缺陷）。

### 权威 ② — 创始人 2026-09-10 原始发言（**转述，非原档**）

docs/synova/coordination/board-backlog.json 条目 `PLAN-d660-data-lifecycle`：

> 「创始人 2026-09-10 提出：按时间清理是错误模型。五层=事件日志(归档不删)/Evidence(过期=蒸馏完成)/Findings(关闭归档)/Facts(版本链 superseded_by)/Knowledge(git永久)。dev-doc spec 任务。」

> ⚠️ **证据等级声明**：这是 CTO 的**转述**，不是创始人原话留档（全仓无 2026-09-10 该发言的一手记录）。本 spec 的五层骨架沿用它（创始人在 2026-09-13 裁定①③中确认了该模型与"层 1-5"结构），但**「Evidence(过期=蒸馏完成)」这一条的语义以权威①为准**，不以转述为准。

### 权威 ③ — D717 已落地代码（**已实现、未合并**）

- src/l3/evidence-retention.ts 共 245 行，D717 新建。保留分级表 `TIER_WINDOWS_MS`（permanent=null / periodic=180d / temporary=7d）、`parseEvidenceRetentionPolicy`、`runEvidenceRetention`、`createEvidenceRetentionJob`、`EvidenceRetentionError`（code/phase/retryable）。
- src/deploy/bootstrap.ts — D717 在 Phase 5c 接线（见 §8 接线表）。
- tests/l3/evidence-retention.test.ts 共 266 行，D717 新建。
- task-state/D717.json 的 `impl.note` 字段 — D717 交付声称原文（用于 §4 对照）。

### 权威 ④ — 仓内既存「蒸馏」实现语义（本仓对"蒸馏"的既有工程定义）

- src/l4/graph-bridge.ts 头部注释（第 2 行）— 「诊断→本体自动蒸馏桥接层 (Phase 1a)：诊断模块输出 → 自动写入 GraphStore」。**这是 src/ 下唯一出现「蒸馏」二字的地方**（§4.3 实测）。
- src/l3/pkb-lifecycle.ts — `autoSediment`（诊断结果 → PKB 知识沉淀：confidence ≥ 0.7 才沉淀、同 domain 相似内容标 superseded_by、沉淀后需 GA 审核转 active）。

> **推论（本 spec 采用）**："蒸馏"在本仓的既存含义 = **把低阶产物（证据/诊断发现）转成高阶产物（本体图谱 / PKB 知识）**。权威①的「已被更高层引用过」与这个既存语义一致——**蒸馏完成的判据不是时间，是"高阶产物是否已经引用过它"**。

### 权威 ⑤ — 派单与台账

- docs/synova/coordination/问题总账与下一批派单-20260913.md §四 D727 行 + §一 C 表 D717-N4 行（「D727 spec 须对『蒸馏完成』确权」）
- docs/synova/coordination/派单-下一批四线并行-20260913.md §D716 — **交接包格式先例**（本 spec 的 §12 沿其形态）

### 权威 ⑥ — 产品北星

.claude/PRODUCT-BRIEF.md §一（驻扎企业、主动诊断、靠数据不靠感觉）、§二（GA / 企业主）、§六 P0（诊断报告质量验证）。

### 权威 ⑦ — 铁律

AGENTS.md / CLAUDE.md：0-2（spec→test→impl→wire）、0-3（禁 git stash，隔离用 worktree）、4/5（入口→交互→结果；后端能力 ≠ 用户可用功能）、11/24/31/32（降级显式 + 分类错误）、37（dead code 入仓库即违规）、38（as any / as never / as unknown as 零容忍）、39（五层边界，L3 只能触 L4，不直接碰 L5）、47（契约优先）、48（测试非空壳，正常/降级/边界三路径）、49（决策沉淀）。

---

## 2. Problem Statement

**要解决的问题**：五层数据「什么时候可以释放」从来没有成文规格；唯一成文的规则（D717 的保留分级）建立在一句转述上。

### 2.1 「蒸馏完成」的权威缺口（P0，本 spec 的直接触发因）

D717 落地代码的注释写得很准确——「D660 spec 落地后，『蒸馏完成』触发条件只需接在本模块的单点解析处」。但那个「蒸馏完成」是什么，全仓查不到（§4.3 给了穷证）。**后果不是"少一个文档"，而是**：一个决定客户证据何时被物理删除的规则，其触发条件既不可判定、也无法被审计复核——K3 拿不到判据，运维不知道自己设的开关会不会删掉不该删的东西。

### 2.2 五层阶梯不成文 → 各层行为各自为政

派单只给了骨架（事件日志归档不删 / Evidence 蒸馏完成 / Findings 关闭归档 / Facts 版本链 / Knowledge git 永久），**没有保留分级、没有触发条件、没有降级契约**。实测结果是三层偏差（§4.4 缺陷分节）：

- **L4 事实层仍有一条活的按时间物理删路径**——`purgeExpired()` 直接执行 SQL 删除 `WHERE expires_at <= now`，与「版本链 superseded_by，不按时间删」的模型正面冲突；
- **L1 事件日志层零归档机制**（连"归档不删"这条规则都无处落地）；
- **L3 工单层有终态（resolved/dismissed + resolved_at）但无归档口径**，活跃查询与历史查询不分。

### 2.3 「二次确认」粒度不足（P0，与创始人裁定②不符）

D717 现在的开关语义是**单键即可删证据**：SYNOVA_EVIDENCE_RETENTION_TIER=periodic 单独设置就会启用 180 天窗口并真的执行删除（src/l3/evidence-retention.ts 行 129-138 与行 174-189）。创始人的裁定是「删除时必须**显式二次确认**」——单键不够。

### 2.4 为什么现在做

- L2 是五层里**唯一允许删除**的一层，它的判据必须先确权，后接线——顺序反了就是先建删除机制、再补删除理由（正好是 D717 现在的状态）。
- D717 的 PR #527 还开着。本 spec 的双键门与蒸馏判定**必须在同一批实施里进 #527 所在的模块**，否则一个"单键可删客户证据"的版本会先合进 main。
- 桌面端线（线 1）收口后，CTO 已按创始人要求「开始安排其他任务」——数据生命周期是 board-backlog 里挂了 3 天的 P0 债。

---

## 3. Q0-Q4

### Q0: 定位 — 项目拼图 + 文件审计

**a) 项目拼图**

Synova = 驻扎企业的 AI 诊断 Agent。本任务不属于某一层的功能，而是**横切五层的保留策略规格**：它给 L1-L5 每层定义"留下什么、什么时候释放、失败了怎么办"。落点是 L3 洞察层（保留策略编排，D717 已在 src/l3/ 目录）+ L4 本体层（两处被操作的数据面：EvidenceStore / AgentMemoryStore），L5 存储被 L4 包裹（铁律 39：L3 不直接碰 L5）。

**新增 / 替换 / 扩展**：**扩展**。D717 已建 `evidence-retention` 单点解析处（保留分级 + degraded 契约 + bootstrap 接线），本 spec 在其上补三件它没有的东西：① 蒸馏判定（触发条件）；② 双键门（二次确认）；③ 其余四层的阶梯规格与守卫。**零新建架构**。

**b) 文件审计**（2026-09-13 在基线（= origin/main + #527）上实测）

| 对象 | 现状（实测） | 结论 |
|---|---|---|
| src/l3/evidence-retention.ts | 245 行（D717 新建，**未合并 main**）。分级表 行 54-58；单键语义 行 128-158；permanent 短路 行 174-180；degraded 分流 行 190-208 | **扩展**（补蒸馏判定 + 双键门） |
| src/evidence/evidence-store.ts | 128 行。`evidence` DDL 行 22-33（含 `expires_at` 列，但**无任何写入方设过它**）；`expireOld(maxAgeMs)` 行 121-127 按 `collected_at < cutoff` 物理删 | **扩展**（加溯源引用表 + 蒸馏态删除） |
| src/l4/agent-memory-store.ts | `agent_memory` DDL 行 350-364（有 `expires_at`、`status`；**无 superseded_by 列**）；`purgeExpired()` 行 323-336 按时间物理删；`supersededBy` 只是运行时字段（行 56） | **扩展**（facts 层禁时间删 + 版本链语义对齐） |
| src/deploy/bootstrap.ts | Phase 5c 调度器区（D717 在 db-backup 之后插入证据保留作业） | **扩展**（装配蒸馏解析器 + 留痕日志） |
| src/l3/pkb-lifecycle.ts | `autoSediment` / `runPKBLifecycle` 已实现，**零生产调用方**（M3） | 只读引用（作为"蒸馏"语义权威），**不改** |
| src/l4/knowledge-store.ts | `expireOutdated()` 行 399-406 是 UPDATE 标记 `pkb_status='expired'`——**逻辑过期，不删行** | 只读引用（已是正确形态），**不改** |
| src/l4/data-purger.ts | 租户级导出/清除（D40，`PurgeStage`/`PurgeJob`/`PurgeResult`），与保留策略正交 | **不改**（§6 显式排除，防概念混淆） |
| src/sentinel/runner.ts | `sentinel_tickets` DDL 行 259-269（status 四态 open/acknowledged/resolved/dismissed + resolved_at） | 只读引用；**不改**（见 §6 跨线边界） |
| src/sentinel/sentinel-events.ts | `sentinel_events` DDL 行 89-99（seq AUTOINCREMENT append-only） | 只读引用；**不改** |

**c) 决策**：已有覆盖 → 复用（D717 的分级骨架 + bootstrap 接线点）；无覆盖 → 按本 spec 新建最小件（蒸馏判定模块 + 溯源引用表）；冲突 → 无（未发现同一模块被他人认领）。

### Q1: 调研 — 业界最佳实践 / 顶级团队 / memory 历史教训

**a) 业界最佳实践：保留策略的正确形态不是"到点就删"，是"分级 + 触发 + 可审计"**

- **对象存储生命周期**（S3 Lifecycle / GCS Lifecycle）：策略由**分级**（Standard→IA→Glacier→Expire）构成，每一级有**明确的转移触发条件**（age / 访问模式 / 自定义谓词），而不是一个全局 TTL。关键是：**Expire（真删）是分级链的最后一环，默认不配**。
- **事件溯源（Event Sourcing）**：append-only 事件日志是**唯一事实源**，永不修改、永不删除；状态靠投影（projection）重建。本仓 `sentinel_events`（seq AUTOINCREMENT + CHECK event_type）正是这个形态，且 src/sentinel/runner.ts 已注释「I2 单源落 sentinel_events → projectRunRecord 投影」。
- **数据最小化 vs 审计留痕**（GDPR 存储限制原则的对立面）：合规领域对"删除"的共识解法是 **soft delete / tombstone / 逻辑过期**——行保留、状态标记、可审计，而不是物理 DELETE。本仓 `knowledge_chunks.pkb_status='expired'`（UPDATE）就是正确形态。
- **来源（provenance）驱动的淘汰**：现代数据平台（数据血缘 / ML 特征库）用**引用计数或血缘图**决定一份数据能否释放——"已被下游消费过"是释放的必要条件，而不是充分条件。这正是创始人裁定①的形态。

**b) 顶级团队的工程基线（Anthropic 风格）**

- **fail-closed**：判据不可判定时，选择"不删"而不是"删"。删除是不可逆操作，可逆的默认值只有一个。
- **机器可验契约**：判据必须是可测的函数（provenance 查询返回 0 条 → 不删），不是文档里的形容词。
- **降级显式**：任何失败路径都有 `log.warn` + `degraded: true` + 分类错误码（本仓铁律 24/31/32 与之同源）。
- **可审计留痕**：策略生效与删除动作必须落日志（谁开的、开了哪一级、删了多少）。

**c) memory/ 与台账历史教训（我们犯过的错）**

| 教训 | 出处 | 对本 spec 的约束 |
|---|---|---|
| **M3 机制建成未接线**（4 次接线失败家族） | cto-handover §十四 M3 | 本 spec 每条新机制必须在 §8 给出真实生产调用点；判据是 grep 出生产调用方，**测试调用不计**（S-3） |
| **M2 声称 vs 事实** | 同上 M2 | 「蒸馏完成」必须真确权（拿到创始人裁定），不许再写第二份转述（D717-N4 的坑不重踩） |
| **M7 文档-实现漂移** | 同上 M7 | 本 spec 引用的行号一律经基线实测；并在顶部声明基线，要求编码前重核（D524 教训） |
| **D717-N4 精度失实** | 问题总账 §一 C | 「提出」不得写成「裁定」；一手/转述证据必须分级标注（§1 权威②已带声明） |
| **D510 F1：禁静态 grep 冒充实测** | memory/notes 家族 | §7 的验收必须有物理断言（真跑 SQL / 真读结果），不许只 grep 源码文本 |
| **铁律 49 决策沉淀** | AGENTS.md | 创始人本次三项裁定已逐字固化在 §1 权威①，作为 D660 的决策存档 |

**d) 决策参考系（S-12）**：参考 Anthropic 工程基线（fail-closed + 机器可验契约 + 降级显式）+ 第一性原理（删除不可逆 → 默认值只能是"不删"；信息已凝固进高阶产物 → 低阶副本可释放）+ 开源/业界实证（生命周期分级 + 事件溯源 append-only + 软删除/逻辑过期）+ memory 教训（M2/M3/M7）→ **结论见 §5.5 决策参考表**。

### Q2: 范围 — 正确的最简方案

**做什么（本 spec 定规格；编码由 Win 线按 §5.1 写集执行）**：

1. **五层阶梯成文**（§5.2）：每层的保留分级 / 触发条件 / 降级契约，一张表说完，可对账。
2. **「蒸馏完成」判定契约**（§5.3）：溯源引用表 + fail-closed 判定函数 + 蒸馏态删除。**provenance 为空 → 恒不删**。
3. **双键门**（§5.4）：时间清理必须 TIER ∈ {periodic,temporary} **且** DAYS=正整数 同时显式设置，缺一即 permanent。
4. **L4 facts 层对齐**：禁止按时间物理删 `enterprise_fact`；`purgeExpired()` 收敛为"只标记不物理删"并消除 M3（零调用方）。
5. **守卫 + 运维契约**：五层守卫测试（任何一层出现按时间物理删就红）+ runbook。

**不做什么（含文件路径）**：

- **不改 src/sentinel/ 下任何文件**（含 runner.ts / sentinel-events.ts / baseline-store.ts / sentinel-loader.ts）——跨线边界，见 §6。本 spec 只给 L1/L3 定契约 + 加只读守卫。
- **不改 src/l3/pkb-lifecycle.ts 文件**（`autoSediment` 的 M3 接线）——它是"蒸馏"语义的**权威引用**，不是本任务的修复对象；它的零调用方登记为独立债（§6）。
- **不做租户级导出/清除**：src/l4/data-exporter.ts, src/l4/data-purger.ts, src/l3/data-lifecycle-service.ts （D40 的租户 offboarding 能力，与保留策略正交；混进来会污染"删除"的语义，§6 显式排除）。
- **不做归档导出的物理实现**（L1/L3 的冷存储导出管道）——本 spec 只定"归档不删"契约与守卫；导出管道是后续独立任务。
- **不做 evidence 生产/采集链路**——证据从哪里来是另一个问题（§4.4 D3）；本 spec 不借机扩张。
- **不改 tests/control-tower/ 下任何文件；scripts/control-tower/ 与 scripts/workflow/ 属 CTO 域；scripts/audit/ 属 K3 专属红线，永不触碰。**

### Q3: 验收 — 入口 → 交互 → 结果

- **入口**：bootstrap Phase 5c（src/deploy/bootstrap.ts 调度器初始化区）——启动即跑一次 `runEvidenceRetention`，随后注册每日 03:30 cron 作业（作业名 `evidence-retention`，D717 已落）。
- **交互**：作业内三问——① 保留分级是什么（env 双键解析）？② 每条证据蒸馏完成了吗（provenance 查询）？③ 允许删吗（分级 × 蒸馏态联合判定）？任一步失败 → 不删 + degraded。
- **结果**：`EvidenceRetentionResult{tier, windowMs, deleted, skipped, degraded, errorCode?}` 落日志 + `ctx.addDegraded(5, 'evidence-retention', msg)` 进装配降级面；runbook 给出运维可复现的核对命令。

### Q4: 契约与测试

见 §7（L1 单元契约 / L2a 接线 / L2b 降级 / L2c 边界）与 §5.3 / §5.4 的接口契约（JSDoc @input/@output/@degraded 形态，铁律 47）。测试三路径（正常 / 降级 / 边界）+ 守卫测试，禁空壳（铁律 48）。

---

## 4. Current State（2026-09-13 实测，基线 = origin/main @2bc0f724 + #527 @d04d03cb）

### 4.1 基线声明（**编码前必须重核**）

| 项 | 值 | 复现命令 |
|---|---|---|
| main HEAD | 2bc0f724 | git log --oneline -1 origin/main |
| D717 分支 | feat/mac-d717-product-debt @d04d03cb | git log --oneline -1 origin/feat/mac-d717-product-debt |
| #527 状态 | **OPEN，未合并 main** | git merge-base --is-ancestor origin/feat/mac-d717-product-debt origin/main; echo $? → 非 0 |
| #527 相对 main 的 delta | 8 提交 / 8 文件 | git diff --name-only origin/main...origin/feat/mac-d717-product-debt |
| 本 spec 所在分支 | docs/d725-d660-data-lifecycle（基于 #527，**stacked**） | git status -sb |

> **行号漂移警告（M7）**：本 spec 引用的 src/l3/evidence-retention.ts 与 src/deploy/bootstrap.ts 行号**只对 #527 @d04d03cb 成立**。编码阶段必须先 git fetch --all && git pull --ff-only ，再重核全部行号；若 #527 已合并并修订，以 main 实测为准。

### 4.2 五层物理台账（data/synova.db 2.3MB，2026-09-13 实测）

| 层 | 名称 | 物理载体（DDL 位置） | 生产库实测行数 | 现行清理/删除机制 |
|---|---|---|---|---|
| **L1** | 事件日志 | `sentinel_events`（src/sentinel/sentinel-events.ts 行 89-99，seq AUTOINCREMENT append-only）；`session_events`（src/store/session-store.ts 行 216-224，UNIQUE(session_id,seq)） | 0 / 0 | **零清理**（无 DELETE，也无归档导出） |
| **L2** | 证据 | `evidence`（src/evidence/evidence-store.ts 行 22-33） | **表不存在**（sqlite3 data/synova.db "SELECT COUNT(*) FROM evidence" → Error: no such table: evidence） | `expireOld()` 按 `collected_at` 物理删；D717 分支上 bootstrap 已接线（**main 上仍零调用方**） |
| **L3** | 发现/工单 | `sentinel_tickets`（src/sentinel/runner.ts 行 259-269，status 四态 + resolved_at）；findings 不落表——由 `sentinel_events` 投影 | 0 | **无归档**（终态行与活跃行同表同查） |
| **L4** | 事实 | `agent_memory`（src/l4/agent-memory-store.ts 行 350-364，含 expires_at / status；**无 superseded_by 列**） | 0 | `purgeExpired()` 按 `expires_at` 物理删（行 323-336）——**零生产调用方** |
| **L5** | 知识 | `knowledge_chunks`（src/l4/knowledge-store.ts 行 58 起）1443 行；knowledge/ 10 文件 + docs/ 1324 文件（git 跟踪） | 1443 | `expireOutdated()`（行 399-406）= UPDATE 标记 `pkb_status='expired'`，**逻辑过期，不删行** ✓ |

> 复现命令（K3 可独立重跑）：
> sqlite3 data/synova.db "SELECT COUNT(*) FROM sentinel_events;" （同法替换表名）；sqlite3 data/synova.db ".tables" | tr ' ' '\n' | grep evidence （零输出 = 表不存在）。

### 4.3 「蒸馏完成」出处穷证（本 spec 的存在理由）

在 main 上穷举「蒸馏完成」全形态（含注释、文档、JSON）：

```
git grep -n "蒸馏完成" origin/main
→ 唯一命中: docs/synova/coordination/board-backlog.json:27（CTO 转述）
```

| 出处 | 类型 | 是否权威 |
|---|---|---|
| board-backlog.json 第 27 行 | CTO 对创始人发言的**转述** | ❌ 二手 |
| src/l3/evidence-retention.ts 行 12 / 行 16 | D717 **代码注释**（在 #527 上，未合并 main） | ❌ 引用转述 + 自身推断 |
| 创始人原话留档 | — | ❌ **不存在**（全仓零一手记录） |
| 仓内「蒸馏」既有语义 | src/l4/graph-bridge.ts , src/l3/pkb-lifecycle.ts | ✅ 一手（但讲的是"诊断→本体/PKB"，未定义 Evidence 的完成判据） |

**结论**：K3 台账 D717-N4 的判定**属实且已核实**——「Evidence 过期 = 蒸馏完成」属 D717 的推断，非创始人裁定。本 spec §1 权威① 首次补上权威。

### 4.4 缺陷分节（代码审计）

#### D1（P0）「蒸馏完成」零权威出处 → 判据不可判定、不可审计

见 §4.3 穷证。**后果**：L2 是五层里唯一允许物理删除的层，其触发条件既无定义也无实现 → 运维无法回答"我设了 periodic 到底会删掉什么"。**修复**：§1 权威① 确权 + §5.3 判定契约。

#### D2（P1）时间清理单键可达，与创始人「显式二次确认」不符

src/l3/evidence-retention.ts （#527 @d04d03cb）实测：

- 行 129-131：TIER=periodic 单一环境变量 → `tier='periodic'`，来源串 `env:tier=periodic`；
- 行 138：`windowMs = TIER_WINDOWS_MS['periodic']` = 180 天；
- 行 174-180：`windowMs !== null` → **直接进入 `store.expireOld(policy.windowMs)`**，真删。

即：**只设一个环境变量就会物理删除客户证据**。另有第二条单键路径（行 140-158）：只设 DAYS=30 会把 permanent 提升为 periodic 并启用窗口。**修复**：§5.4 双键门。

#### D3（P1）L2 层事实空心——表不存在、零生产者

- `evidence` 表在**生产库中不存在**（§4.2 实测）；
- `new EvidenceStore(` 在整个 main 的 src/ 下**零生产实例化**；`EvidenceStore` 仅被 src/evidence/index.ts 的类型引用与包装类构造参数引用；
- D717 分支上 src/l3/evidence-retention.ts 行 183 的 `new EvidenceStore(db)` 是**全仓唯一生产实例化**——而它的用途是清理，不是采集；
- `evidence.expires_at` 列（src/evidence/evidence-store.ts 行 30）**零写入方**：DDL 有列，`add()` 行 74 透传 `evidence.expiresAt || null`，但全仓无任何生产者设置该字段。

**后果**：D717 的清理作业在一个**运行期才被它自己创建出来的空表**上执行——不是 bug，但意味着"保留策略"目前管的是零条数据。**本 spec 的处理**：不扩张到采集链路（§6），但把此事实写进 runbook 与完成标准——避免后人拿"作业跑了"当成"证据管起来了"（M2 防再犯）。

#### D4（P1）L4 facts 层存在活的按时间物理删路径，与阶梯模型冲突

src/l4/agent-memory-store.ts 行 323-336：

```sql
DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
```

- 与「Facts(版本链 superseded_by)」正面冲突：facts 的存续应由**版本链 + status** 决定，不由时间决定；
- `purgeExpired()` **零生产调用方**（全仓 grep：定义 1 处 + 测试 1 处 tests/l4/agent-memory-store.test.ts 行 107 + 3 处测试 stub）→ M3 同族；
- 同时 `agent_memory` **无 superseded_by 列**：`supersededBy` 只是运行时字段（行 56），实际由 src/routes/ga-calibration.ts 行 268-274 用 `supersedes` 反向索引**现算**——版本链未持久化。

#### D5（P2）L1 事件日志零归档机制

`sentinel_events` / `session_events` 均只增不归档，无导出、无分区、无容量水位。阶梯规则「归档不删」目前在代码里**无处对应**（既没有归档，也没有"不删"的守卫）。

#### D6（P2）M3 家族：保留/生命周期相关机制批量零接线

| 机制 | 定义位置 | 生产调用方 |
|---|---|---|
| `expireOld` | src/evidence/evidence-store.ts 行 121 | main 零（#527 补 1） |
| `purgeExpired` | src/l4/agent-memory-store.ts 行 323 | **零** |
| `autoSediment` | src/l3/pkb-lifecycle.ts 行 75 | **零** |
| `runPKBLifecycle` | src/l3/pkb-lifecycle.ts 行 44 | **零**（`expireOutdated` 仅被它调用 → 传递性零接线） |

> 本 spec 只修与五层阶梯直接相关的两条（`expireOld` 语义收敛、`purgeExpired` 对齐）；`autoSediment` / `runPKBLifecycle` 的接线登记为独立债（§6），不在本任务写集。

---

## 5. What We Build

### 5.1 写集 (5 修改 + 5 新建)
| 文件 | 操作 | 说明 |
|------|:---:|------|
| src/l3/evidence-retention.ts | 修改 | ①**双键门**（§5.4）：删证据需 TIER ∈ {periodic,temporary} **且** DAYS=正整数 同时显式，单键一律 permanent；②接入蒸馏判定（§5.3）：`runEvidenceRetention` 从"按窗口删"改为"按蒸馏态删"；③`source` 溯源串记录双键、startup/cron 各打一次留痕日志（`log.warn` 级，因涉及删除） |
| src/l3/ | 新建 | 目录级声明——新增 **evidence-distillation.ts**（蒸馏判定模块，§5.3 契约：`DISTILLATION_REF_LAYERS` / `recordDistillationRef()` / `resolveDistillationVerdict()` / `purgeDistilled()`）。**目录级理由**：新文件在 spec 期不存在，dev-doc 写集核验对未存在文件报假阳性（D580/D590/D593/D716-D1 先例）；实现同 commit 精确化为确切文件名。本目录下同时修改 evidence-retention.ts（上行单列）。（说明：本表其它位置对新建文件一律用裸文件名，因 gatekeeper C2 会扫 src/ 前缀路径并对未存在文件判 FAIL。） |
| src/evidence/evidence-store.ts | 修改 | ①新增溯源引用表 `evidence_refs(id, evidence_id, ref_layer, ref_id, created_at)` + 索引（DDL 沿用本文件既有 `CREATE TABLE IF NOT EXISTS` 幂等形态）；②新增 `recordDistillationRef(ref)` / `queryDistillationRefs(evidenceId)`；③新增 `purgeDistilled()`——删"有 ≥1 条引用"的证据行；④`expireOld(maxAgeMs)` 保留但**降级为双键门之后的显式时间通道**，JSDoc 标注"仅双键显式开启可达，默认路径不经过它"（铁律 47 契约头） |
| src/l4/agent-memory-store.ts | 修改 | ①`purgeExpired()` 语义收敛：**不再物理删 `enterprise_fact`**——enterprise_fact 只走 status（pending/active/rejected/conflicted）+ 版本链；非 fact 类型（preference/pattern/ga_correction/manual_signal 等）保留 TTL 物理删；②接线：由证据保留作业同一 cron 调用（消除 M3 零调用方，§8）；③JSDoc 写清两类语义边界（铁律 47） |
| src/deploy/bootstrap.ts | 修改 | Phase 5c：在 D717 已插入的证据保留作业处补 ①蒸馏判定装配（注入 `resolveDistillationVerdict` 依赖）；②`purgeExpired` 同作业调用；③留痕日志（分级 + 双键来源 + deleted 数）；④失败一律走既有 `ctx.addDegraded(5, 'evidence-retention', …)` 通道，不新增静默分支 |
| tests/l3/evidence-retention.test.ts | 修改 | 在 D717 既有 21 用例上补：双键门 4 例（单 TIER / 单 DAYS / 双键齐 / 双键 0）→ 详见 §7 L1；原「tier=periodic → 180 天窗口」用例按新语义改写 |
| tests/l3/evidence-distillation.test.ts | 新建 | 蒸馏判定契约测试 ≥10 例（正常 / 降级 / 边界），见 §7 L1 |
| tests/l4/agent-memory-retention.test.ts | 新建 | facts 层保留语义测试 ≥6 例（enterprise_fact 不随时间消失 / 非 fact 类型 TTL 生效 / 边界），见 §7 L1 |
| tests/architecture/data-lifecycle-ladder-guard.test.ts | 新建 | **五层守卫**（只读源码断言 + 行为断言）：L1/L3/L5 源码零按时间物理删；L2/L4 唯一删除入口经阶梯判定；任何一层出现「DELETE FROM <表> WHERE <时间列>」形态即红。见 §7 L2a |
| docs/synova/runbooks/data-lifecycle-ladder.md | 新建 | 运维契约：五层阶梯表（分级/触发/降级）+ 双键操作手册（怎么开、怎么验证没删、怎么关）+ 蒸馏判定的当前状态诚实声明（provenance 为空 → 恒不删）+ 复现命令 |

> **写集边界（S-7/S-8 共享资源声明）**：本写集与 D717（#527）**共享** src/l3/evidence-retention.ts, src/evidence/evidence-store.ts （D717 只读引用它）, src/deploy/bootstrap.ts, tests/l3/evidence-retention.test.ts → **串行依赖**：#527 合入 main 后本任务才开工（否则改动会与 #527 冲突或被覆盖）。与 D726（Mac 编码，写集 scripts/product-lines/ 与 scripts/control-tower/ 与 tests/ ）在 tests/ 下有**目录级潜在重叠**，但文件级零交集；与 D728（并行 CTO，写集 scripts/ ）零交集。**本写集不含 src/sentinel/ 下任何文件**（跨线边界，§6）。
>
> **写集核验口径（诚实声明，防 overclaim）**：本表声明的是**实施期**的改动集。在 **spec 期**跑 check-dev-doc-write-set.sh 会有两类**预期内**命中——① 4 个"新建"文件尚不存在（存在性检查命中）；② 5 个"修改"文件零 diff（该脚本的 diff 命中检查）。原因是该脚本按其自身设计目标是**实现期门禁**（脚本头注原文：「dev doc 写集表声明的文件 vs 代码实际」）。因此：**本 spec 交付时以 spec 期口径（SYNO_DEV_DOC 注入，跳过 diff 命中）为验收口径**，存在性 6/10 通过、4 条为上述预期命中；**实现期必须跑全量口径并全绿**（§12 硬约束）。精确文件名声明（而非目录级）是本 spec 的有意选择：目录级会让实现期反查（声明 10 / 实际 12）失效。
>
> **本 spec 自身的交付物（dev doc 交付面，非上表内容）**：docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D725-d660-data-lifecycle-20260913.md（本文件，新建）、task-state/D725.json（修改：spec 段回填 + status=spec_done）、.claude/task-briefs/ 下本单的 brief（修改）、docs/synova/coordination/编码指令-D725-数据生命周期五层阶梯-Win-20260913.md（新建：随 spec 交付的 Win 线编码 session 启动指令，dev-doc-delivery 规范三件套之一）。四者均在写集核验的 SKIP 前缀内（docs/ / task-state/ / .claude/），不入反向漂移对账。

### 5.2 五层阶梯规格（本 spec 的核心交付物）

> 读法：每层三列 = **保留分级**（这份数据值多少）/ **触发条件**（什么时候动它）/ **降级契约**（动不了怎么办）。**全表铁律：任何一层都不允许"按时间物理删"，唯一例外是 L2 且必须已蒸馏 + 双键。**

| 层 | 保留分级 | 触发条件 | 降级契约 |
|---|---|---|---|
| **L1 事件日志**（sentinel_events / session_events） | `permanent-append-only`（永久，只增） | **无删除触发。** 唯一允许的动作 = 归档导出（冷存储副本）；导出成功后**原表行仍保留**（归档 ≠ 删除） | 导出失败 → `log.warn` + `degraded=true` + **原数据零变更**（fail-closed：宁可没归档，不可半删）。**现状**：导出管道未建（D5），本任务只落契约 + 守卫 |
| **L2 证据**（evidence） | `permanent`（**默认**，永不删）<br>`distilled`（仅"已蒸馏"可释放）<br>`periodic` / `temporary`（**需双键显式**，§5.4） | **蒸馏完成 = 该证据被更高层（ref_layer ∈ {L3 发现/工单, L4 事实, L5 知识}）引用过，溯源链已建立**（§5.3）。<br>判据：`queryDistillationRefs(evidenceId).length ≥ 1`。<br>**无引用 = 未蒸馏 = 永不删**（创始人裁定①） | ①判定查询失败 → `distilled=false`（**不删**）+ `log.warn` + `degraded=true` + `errorCode=EVIDENCE_DISTILLATION_RESOLVE_FAILED`；②配置非法（如 DAYS 非法值）→ 抛 `EvidenceRetentionError(code=EVIDENCE_RETENTION_CONFIG, retryable=false)`，调用方**不注册作业、不删**；③清理异常 → `degraded=true` + `errorCode=EVIDENCE_RETENTION_SWEEP_FAILED`，不阻断进程 |
| **L3 发现/工单**（sentinel_tickets） | `terminal-archive`（终态即归档，行保留） | 工单进入终态（`resolved` / `dismissed`，已有 `resolved_at` 时间戳）→ 从**活跃查询口径**移出，进入归档口径；**行不物理删** | 归档标记失败 → 保留在活跃口径（**不丢数据**）+ `log.warn` + degraded。<br>**现状**：四态 + resolved_at 已具备（src/sentinel/runner.ts 行 266-268）；归档口径由本 spec 定义在 runbook，**实现归 src/sentinel/ 属主**（§6 跨线边界） |
| **L4 事实**（agent_memory） | `versioned-immutable`（版本链，永不物理删） | 事实被新版本取代 → 写 `superseded_by` 链，**保留旧行**；enterprise_fact 生命周期为 `status`（pending/active/rejected/conflicted，D240）。<br>**禁**按时间物理删 enterprise_fact | 版本链写入失败 → 保留旧行 + `log.warn` + degraded（绝不因链写失败而删行）。<br>非 fact 类型（preference/pattern/…）保留 TTL 语义，`expires_at` 到时**物理删**（这类是缓存型数据，不承载诊断溯源） |
| **L5 知识**（knowledge_chunks + git） | `permanent-git`（git 永久 + 逻辑过期） | 知识作废 → ① git 层新增替代文件 / revert（历史永久可查）；② DB 层 `pkb_status='expired'`（**UPDATE 标记，不删行**） | git 不可用 → 只读降级；DB 标记失败 → 保留原状态 + `log.warn` + degraded |

**阶梯的不变量（守卫断言对象）**：

1. **只有 L2 可以物理删除**，且必须同时满足「已蒸馏」+「双键显式开启时间通道」或「蒸馏态删除通道」；
2. **没有任何一层按时间物理删**（L2 的时间通道是唯一例外且默认关闭、需双键）；
3. **判定失败一律不删**（fail-closed），且失败必须可见（log + degraded + errorCode）；
4. **归档 ≠ 删除**：L1/L3 的归档动作不得产生 DELETE。

### 5.3 蒸馏完成判定契约（铁律 47 契约头）

**新增模块 evidence-distillation.ts（置于 src/l3/ 目录，与 evidence-retention.ts 同目录）**

```
/**
 * @input  recordDistillationRef(db, {evidenceId, refLayer, refId}) —— 更高层判定结论时登记引用
 *         resolveDistillationVerdict(db, evidenceId) —— 判定单条证据是否已蒸馏
 *         purgeDistilled(db, {limit?}) —— 删除已蒸馏证据
 * @output DistillationVerdict { evidenceId, distilled, refCount, refs: DistillationRef[], degraded, errorCode? }
 *         PurgeDistilledResult { scanned, deleted, degraded, errorCode? }
 * @degraded ① 查询抛错 → distilled=false（**fail-closed：不删**）+ log.warn + degraded=true
 *           + errorCode=EVIDENCE_DISTILLATION_RESOLVE_FAILED
 *           ② 表不存在（旧库未迁移）→ 同 ①，errorCode=EVIDENCE_DISTILLATION_SCHEMA_MISSING
 *           ③ 单条判定失败**不**中断整批——该条按未蒸馏处理（保留），批次结果 degraded=true
 * @invariant 无引用 ⇒ 永不删；判定失败 ⇒ 永不删；本模块永不因任何路径抛错给调用方（铁律 24）
 * @layer  L3（经 EvidenceStore(L4) 操作；零 db.prepare / db.exec，铁律 39）
 */
```

**溯源引用表 `evidence_refs`**（DDL 在 src/evidence/evidence-store.ts ，沿用本文件既有幂等建表形态）：

| 列 | 类型 | 语义 |
|---|---|---|
| evidence_id | TEXT NOT NULL | 被引用的证据 id |
| ref_layer | TEXT NOT NULL | 引用方所在层：`L3` / `L4` / `L5`（CHECK 约束） |
| ref_id | TEXT NOT NULL | 引用方实体 id（finding/ticket id、fact key、knowledge chunk id） |
| created_at | TEXT NOT NULL DEFAULT (datetime('now')) | 引用建立时间（审计用） |

索引：`idx_evidence_refs_evidence ON evidence_refs(evidence_id)`。主键：`(evidence_id, ref_layer, ref_id)` 复合（幂等登记）。

**判定规则（三条，全为 fail-closed）**：

1. `refCount ≥ 1` → `distilled=true`；
2. `refCount == 0` → `distilled=false`（**默认形态**——provenance 尚未建立的当前阶段，一切证据都不删）；
3. 判定过程异常 → `distilled=false` + `degraded=true`（**绝不在不确定时删除**）。

**引用写入方的边界（显式声明，防 M3 重演）**：

`recordDistillationRef()` 的调用方 = **更高层的判定点**（工单结论落 sentinel_tickets 时、事实落 agent_memory 时、知识落 PKB 时）。这些写入方**不属于本任务写集**（它们分属 L3/L4/L5 的生产者，且 src/sentinel/ 是跨线边界）。

> **本 spec 对 M3 的正面处理**：不把"机制建成但没人调用"再复制一遍。做法是——**判定侧 fail-closed 且默认不删**，所以"引用写入方未接线"的后果是**零删除**（安全侧），而不是失控删除。§10 DS8 把「引用写入方接线」登记为**显式 defer**（写进 board-backlog 条目），而不是让它变成静默缺口。

### 5.4 双键门契约（创始人裁定②的落地形态）

**规则**：时间窗口清理需要**两个显式环境变量同时存在且合法**，缺一即 permanent。

| TIER | DAYS | 结果 |
|---|---|---|
| 未设 | 未设 | `permanent`（windowMs=null，**不删**）——默认形态 |
| `periodic` / `temporary` | **未设** | `permanent`（**单键不生效**）+ `log.warn` 提示需双键 + `source` 串标注 `single-key-rejected` |
| 未设 | 正整数 | `permanent`（**单键不生效**）+ 同上 |
| `permanent` | `0` | `permanent`（显式关闭） |
| `periodic` / `temporary` | 正整数 | **启用**该窗口（真正的"二次确认"）+ `log.warn` 留痕（含 tier/days/source） |
| 任意 | 负数 / 小数 / 非数字 | 抛 `EvidenceRetentionError(EVIDENCE_RETENTION_CONFIG, retryable=false)` → 不注册作业、不删 |
| 未识别 tier | 任意 | 回落 `permanent` + `log.warn`（D717 既有语义，保留） |

**审计留痕**：双键启用时，启动路径与 cron 路径各打一次 `log.warn`（含 `tier` / `days` / `source` / `deleted`），使"谁在什么时候开了删除"可事后追溯（可审计原则）。

### 5.5 决策参考（S-12，本任务决策点）

| # | 决策点 | 候选 | 参考系与理由 | 结论 |
|---|---|---|---|---|
| 1 | 「蒸馏完成」判据 | ①会话闭合 ②GA 复核 ③**已被更高层引用** ④永不删 | 创始人裁定①；第一性原理（信息已凝固进高阶产物，低阶副本可释放）；provenance 驱动淘汰是业界形态 | **③**（其余留作候选，记录在 runbook） |
| 2 | 判据不可判定时的默认 | ①删 ②不删 + degraded | Anthropic fail-closed；删除不可逆 → 默认值只能是"不删" | **②** |
| 3 | 时间清理开关 | ①单键 ②**双键** ③删掉开关 | 创始人裁定②；"显式二次确认"= 两个独立动作，单键不构成确认 | **②** |
| 4 | L4 facts 存续机制 | ①按 expires_at 时间删 ②**只走 status + 版本链** | 创始人 D660 骨架「Facts(版本链 superseded_by)」；事实承载诊断溯源，不能因时间消失 | **②**（enterprise_fact；非 fact 类型保留 TTL） |
| 5 | L1/L3 归档动作是否含删除 | ①归档即删 ②**归档不删** | 创始人 D660 骨架「归档不删」「关闭归档」；事件溯源 append-only 是业界基线 | **②** |
| 6 | 新增模块落点 | ①并进 evidence-retention.ts ②**独立 evidence-distillation.ts** | 第一性原理（单一职责：保留策略 ≠ 蒸馏判定，两者变更原因不同）；D717 注释已预留"单点解析处"接入点 | **②** |
| 7 | provenance 用表还是回调 | ①回调注入 ②**表** ③不实现 | 机器可验契约需要可对账的持久记录；表可用 SQL 独立复核（K3 可重跑）；回调无法审计 | **②** |
| 8 | 「引用写入方未接线」怎么处理 | ①本任务顺手接 ②**显式 defer + fail-closed** ③假装已接 | 写入方分属 L3/L4/L5 生产者且含跨线边界（src/sentinel/ ）；M3 教训 → 显式登记而非静默缺口；fail-closed 使缺口落在安全侧 | **②** |
| 9 | 是否顺带修 autoSediment / runPKBLifecycle 的 M3 | ①顺带修 ②**登记独立债** | 创始人反复强调「改 A 不断 B」；本任务写集不含 src/l3/pkb-lifecycle.ts ；顺带扩大写集违反 Q2 最简 | **②** |
| 10 | 是否把租户清除（DataPurger）纳入阶梯 | ①纳入 ②**正交，显式排除** | 租户 offboarding 是合规删除（用户行使删除权），与保留策略（系统何时释放）因果不同；混同会污染"删除"语义 | **②** |

**收敛检查**：决策 1/3 由创始人裁定（产品面），其余 8 项为技术自决（D333）。无未收敛项，无需升级。

### 5.6 实现顺序（Win 线）

1. `evidence_refs` 表 + `recordDistillationRef` / `queryDistillationRefs`（数据面先行，可独立测）
2. evidence-distillation.ts 判定 + `purgeDistilled`（对第 1 步的纯函数封装，fail-closed）
3. evidence-retention.ts 双键门 + 接蒸馏判定（**先写红测试**：单键仍删 → 红）
4. agent-memory-store.ts facts 语义收敛 + bootstrap 接线
5. 守卫测试 + runbook

---

## 6. What We Don't Do

**跨线边界（不碰，碰了 = 撞车）**

- **src/sentinel/ 整个目录**（含 runner.ts 、sentinel-events.ts 、baseline-store.ts 、sentinel-loader.ts ）——CODEOWNERS 列为 Mac DSH 领地。L3 工单的**归档实现**、L1 `sentinel_events` 的**归档导出**均归属主；本 spec 只给契约 + 在 tests/architecture/ 加只读守卫。
- **src/cron/ 与 src/mcp/ 与 electron/ 与 electron-renderer/ **——非本任务域。
- **scripts/audit/ **——K3 专属红线，永不触碰；scripts/control-tower/ 与 scripts/workflow/ 属 CTO 域。

**功能上明确不做**

- **不做证据采集链路**：src/evidence/index.ts 的 `EvidenceCollector` 接线、`evidence` 表的写入方——D3 是独立问题，本 spec 只记录事实（runbook 诚实声明 + DS），不借机扩张写集。
- **不做归档导出的物理实现**（L1/L3 的冷存储导出管道）：本 spec 定"归档不删"契约 + 守卫；导出管道是后续独立任务（§10 DS8 一并登记）。
- **不做租户级导出/清除**：src/l4/data-exporter.ts, src/l4/data-purger.ts, src/l3/data-lifecycle-service.ts （D40 能力，正交，见 §5.5 决策 10）。
- **不做 autoSediment / runPKBLifecycle 的 M3 接线**（src/l3/pkb-lifecycle.ts ）：登记独立债（§5.5 决策 9）。
- **不做 agent_memory 的 superseded_by 列迁移**（D4 的持久化部分）：本任务只做"禁按时间删 fact"；版本链持久化需 schema 迁移 + 生产者改造，写集会显著膨胀 → 登记独立债。
- **不做 DB VACUUM / 空间回收**：删除后的物理空间回收是独立运维动作，且 SQLite VACUUM 有锁风险，不在本任务。
- **不改 D717 已绿的任何测试行为**（除 §5.1 明确列出的语义改写）：防止把回归伪装成重构。
- **不改 .github/CODEOWNERS 与该目录下 workflows 任何文件**。

---

## 7. Test Requirements

> 铁律 48：三路径（正常 / 降级 / 边界）全覆盖，禁空壳。铁律 12：接线用例走真实调用链，不 mock 管线。

### L1 单元契约（模块级）

| # | 用例 | 断言 | 文件 |
|---|---|---|---|
| T1 | **正常**：证据有 1 条 L3 引用 → `resolveDistillationVerdict` | `distilled=true`，`refCount=1`，`degraded=false` | tests/l3/evidence-distillation.test.ts |
| T2 | **正常（默认形态）**：`evidence_refs` 空表 → 判定 | `distilled=false`，`refCount=0`（**这是当前生产形态**） | 同上 |
| T3 | **正常**：`purgeDistilled` 在"2 条已蒸馏 + 1 条未蒸馏"下 | `deleted=2`，未蒸馏那条**仍在**（`query()` 命中） | 同上 |
| T4 | **降级**：注入抛错的 db → 判定 | `distilled=false` + `degraded=true` + `errorCode=EVIDENCE_DISTILLATION_RESOLVE_FAILED`，**不抛错**，证据零删除 | 同上 |
| T5 | **降级**：`evidence_refs` 表不存在（旧库） | 同 T4 不删，`errorCode=EVIDENCE_DISTILLATION_SCHEMA_MISSING` | 同上 |
| T6 | **降级**：批量中单条判定失败 | 该条保留、其余正常；`degraded=true`（**不中断整批**） | 同上 |
| T7 | **边界**：同一 (evidence, layer, ref) 重复登记 | 幂等——复合主键生效，`refCount` 不重复计数 | 同上 |
| T8 | **边界**：空字符串 evidenceId / refId | 拒绝写入（抛分类错误）或零命中——**不得**因空值匹配全表 | 同上 |
| T9 | **边界**：`ref_layer` 不在 {L3,L4,L5} | CHECK 约束拒绝；判定侧视为无效引用（不计入 refCount） | 同上 |
| T10 | **不变量**：遍历"空表 / 单条 / 大批量"三形态 | `purgeDistilled` 的删除集合**恒为** refCount≥1 的子集（属性断言） | 同上 |
| T11 | **双键门**：仅 TIER=periodic（无 DAYS） | `tier=permanent`、`windowMs=null`、`source` 含 `single-key-rejected` → **不删** | tests/l3/evidence-retention.test.ts |
| T12 | **双键门**：仅 DAYS=30（无 TIER） | 同 T11 → **不删** | 同上 |
| T13 | **双键门**：TIER=periodic + DAYS=30 | `tier=periodic`、`windowMs=30d`、`log.warn` 留痕已调用（spy） | 同上 |
| T14 | **双键门**：TIER=permanent + DAYS=0 | `permanent`、`windowMs=null`（显式关闭语义保留） | 同上 |
| T15 | **双键门边界**：DAYS = 负数 / 小数 / 非数字 | 抛 `EvidenceRetentionError`，`code=EVIDENCE_RETENTION_CONFIG`，`phase='evidence-retention'`，`retryable=false` | 同上 |
| T16 | **回归（D717 语义保留）**：未设任何 env | `permanent` + `skipped=true` + `deleted=0`，证据一条不动 | 同上 |
| T17 | **facts 层正常**：`enterprise_fact` 行 `expires_at` 已过期 → 调保留作业 | 该行**仍在**（enterprise_fact 不走时间删） | tests/l4/agent-memory-retention.test.ts |
| T18 | **facts 层正常**：`preference` 行 `expires_at` 已过期 → 调保留作业 | 该行被清理（非 fact 类型 TTL 保留） | 同上 |
| T19 | **facts 层边界**：`expires_at` 恰等于 now / 为 NULL | NULL 保留；等于 now 按既有语义（`<=` 删）并**只对非 fact 类型** | 同上 |
| T20 | **facts 层降级**：db 抛错 | `log.warn` + degraded 标记，**不抛给 cron handler**，零删除 | 同上 |

### L2a 接线验证（真实调用链，测试调用不计 —— S-3）

| # | 断言 | 物理命令 |
|---|---|---|
| W1 | `runEvidenceRetention` 在 src/ 有**生产**调用方（非测试） | grep -rn "runEvidenceRetention" src/ \| grep -v "\.test\." → 命中 src/deploy/bootstrap.ts |
| W2 | `createEvidenceRetentionJob` 被注册进调度器 | 同上 grep 命中 bootstrap；且作业名常量 `EVIDENCE_RETENTION_JOB_NAME` 仅此一处消费 |
| W3 | `purgeDistilled` 有生产调用方 | grep -rn "purgeDistilled" src/ \| grep -v "\.test\." → 非空 |
| W4 | `resolveDistillationVerdict` 有生产调用方 | grep -rn "resolveDistillationVerdict" src/ \| grep -v "\.test\." → 非空 |
| W5 | `purgeExpired` 的 M3 已消除 | grep -rn "purgeExpired" src/ \| grep -v "\.test\." → 定义 + **≥1 生产调用方**（基线为 1，零调用方） |
| W6 | 调度器注册点在启动路径可达 | bootstrap Phase 5c 代码路径静态可达 + 启动日志出现 `证据保留分级维护已启动` |

### L2b 降级路径

| # | 场景 | 断言 |
|---|---|---|
| G1 | `evidence_refs` 表缺失（旧库未迁移） | 启动不崩、作业不删、`ctx.addDegraded(5,'evidence-retention', …)` 被调用（spy） |
| G2 | 配置非法（DAYS=abc） | 作业**不注册**、删零行、degraded 记录一条、进程继续 |
| G3 | 清理 SQL 执行失败 | `EvidenceRetentionResult.degraded=true` + `errorCode=EVIDENCE_RETENTION_SWEEP_FAILED`，不阻断进程 |
| G4 | `purgeExpired` 抛错 | 同 G3，作业不崩（cron handler 抛错会变 unhandled rejection） |
| G5 | 全链路 degraded 可见性 | 三条降级路径都落到 `degradedModules`（入口→结果可见，铁律 31 装配面可见） |

### L2c 边界

| # | 边界 | 断言 |
|---|---|---|
| B1 | 空表（0 条证据） | `deleted=0`、`degraded=false`（**空不是错**） |
| B2 | 全部未蒸馏（当前生产形态） | `deleted=0`，证据全留，日志含"蒸馏前资产"口径 |
| B3 | `collected_at` 恰等于 cutoff | 不删（既有 `<` 严格语义保留） |
| B4 | 五层守卫（**反向验证必红**） | tests/architecture/data-lifecycle-ladder-guard.test.ts：人为在 L1/L3/L5 插入「DELETE FROM … WHERE <时间列>」→ **测试红**；撤回 → 绿 |
| B5 | 双键反向验证 | 把双键门改回单键 → T11/T12 红；撤回 → 绿 |

**verify 命令表（声称 ↔ 用例，禁 echo 0 —— S-4）**

| 声称 | verify 命令 | 期望 |
|---|---|---|
| 蒸馏判定无引用即不删 | npx vitest run tests/l3/evidence-distillation.test.ts -t "空表" | pass |
| 单键不再删证据 | npx vitest run tests/l3/evidence-retention.test.ts -t "单键" | pass |
| facts 不随时间消失 | npx vitest run tests/l4/agent-memory-retention.test.ts | pass |
| 五层守卫拦截时间删 | npx vitest run tests/architecture/data-lifecycle-ladder-guard.test.ts | pass（且 B4 反向验证已做） |
| 接线真实存在 | grep -rn "purgeDistilled\|resolveDistillationVerdict" src/ \| grep -v "\.test\." | 非空 |
| 零 as any | grep -rn "as any\|as never\|as unknown as" src/l3/ src/evidence/ src/l4/ \| grep -v "\.test\." | 零命中 |
| L3 不碰 L5 | grep -c "db.prepare\|db.exec" src/l3/evidence-retention.ts | 0 |

---

## 8. Wiring Verification

> 铁律 0-2 / 4：**写了代码没接线 = 未完成**。本节每条给出真实生产调用点（测试调用**不计**，S-3）。基线为 #527 @d04d03cb；#527 合入后行号需重核（§4.1）。

| 新/改 export | 生产调用点（文件:位置） | 传递内容 | 验证命令 |
|---|---|---|---|
| `runEvidenceRetention` | src/deploy/bootstrap.ts （Phase 5c，D717 已接，位于 `db-backup` 注册之后）→ 启动即跑一次 | 注入 `db` + `parseEvidenceRetentionPolicy(process.env)` 的结果；返回值 `degraded` → `ctx.addDegraded(5,'evidence-retention',…)` | grep -n "runEvidenceRetention" src/deploy/bootstrap.ts |
| `EVIDENCE_RETENTION_JOB_NAME` / `EVIDENCE_RETENTION_CRON` | 同上 `scheduler.schedule(retention.EVIDENCE_RETENTION_JOB_NAME, retention.EVIDENCE_RETENTION_CRON, …)` | 作业名 `evidence-retention` + `30 3 * * *` | grep -n "EVIDENCE_RETENTION_JOB_NAME" src/deploy/bootstrap.ts |
| `createEvidenceRetentionJob` | 同上（`onDegraded` 回调 = `(message) => ctx.addDegraded(5,'evidence-retention',message)`） | 降级消息透传到装配降级面 | 同上 |
| `resolveDistillationVerdict`（新） | src/l3/evidence-retention.ts 的删除判定分支（**本任务新增**）← 由 bootstrap 注入 | 判定结果决定某条证据是否进入删除集合 | grep -rn "resolveDistillationVerdict" src/ \| grep -v "\.test\." |
| `purgeDistilled`（新） | src/l3/evidence-retention.ts 的清理分支（经 EvidenceStore）← bootstrap 调 `runEvidenceRetention` 时注入 | 删除集合 = 已蒸馏证据集合 | grep -rn "purgeDistilled" src/ \| grep -v "\.test\." |
| `recordDistillationRef`（新） | **引用写入方（L3/L4/L5 生产者）—— 本任务显式 defer**（§5.3 / §6）；未接线期间判定恒为"未蒸馏" → 零删除（安全侧） | — | grep -rn "recordDistillationRef" src/ \| grep -v "\.test\." → 当前**允许为空**（已登记 defer，非静默缺口） |
| `purgeExpired`（改） | **本任务新增接线**：由证据保留作业同一 cron 调用（bootstrap Phase 5c）——消除 M3 零调用方 | 装配方注入 db；返回值 degraded 走 `ctx.addDegraded(5,'evidence-retention',…)` | grep -rn "purgeExpired" src/ \| grep -v "\.test\." → 定义 + 生产调用方 ≥1（基线 0） |
| `evidence_refs` 表 | src/evidence/evidence-store.ts 的 `initSchema()` 内幂等建表 → 经 `EvidenceStore` 构造在 bootstrap 启动路径创建 | 表在生产库被创建（可 SQL 复核） | sqlite3 data/synova.db ".tables" \| tr ' ' '\n' \| grep evidence_refs |

**接线反向审计（D717 前例已修）**：`expireOld` 全仓唯一生产调用方 = src/l3/evidence-retention.ts 。本任务若把默认路径改为 `purgeDistilled`，**必须保留 `expireOld` 的双键显式通道调用**，否则 `expireOld` 退回零调用方（M3 复发）——grep -rn "expireOld" src/ \| grep -v "\.test\." 必须仍非空。

---

## 9. Architecture Layer

**L3 洞察层**（保留策略编排）→ 经 **L4 本体层**（EvidenceStore / AgentMemoryStore）操作 → **L5 存储**（SQLite）。

- 判定与删除编排落 L3：src/l3/ 下的 evidence-retention.ts（改）+ evidence-distillation.ts（新建）。
- 数据面落 L4：src/evidence/evidence-store.ts （evidence 与 evidence_refs 两张表的属主）、src/l4/agent-memory-store.ts 。
- **铁律 39 校验**：L3 **不得**直接访问 L5——evidence-distillation.ts 与 evidence-retention.ts 内**零 db.prepare / db.exec**（D717 已遵循、其代码注释第 32 行显式声明）；所有 SQL 留在 L4 的 store 里。这是本任务的一条硬验收（§7 verify 表末行）。
- **为何不落 L4**：保留分级是**策略**（何时释放），不是**存储能力**（怎么存）。策略会因产品/合规变化而变，存储层不应承载策略（第一性原理：变更原因不同 → 不同层）。
- **为何不落 L2**：装配（bootstrap）在 L2/L3 之间做注入，不做策略判定——L2 只负责"把判定结果接到启动/cron"。

---

## 10. Completion Standard

> 入口 → 交互 → 结果；每条可证伪（S-10：缺项显式 descope，禁重编号）。

**入口**

- **DS1**：本任务的入口为 **bootstrap Phase 5c 调度器初始化区**——证据保留作业被注册且启动即跑一次。可证伪：grep -n "EVIDENCE_RETENTION_JOB_NAME" src/deploy/bootstrap.ts 非空 + 启动日志出现 `证据保留分级维护已启动`。

**处理**

- **DS2**：**蒸馏完成判定存在且 fail-closed**。可证伪：`evidence_refs` 为空时 `resolveDistillationVerdict` 返回 `distilled=false`、`purgeDistilled` 的 `deleted=0`（T2/T3/T10）。
- **DS3**：**双键门生效**。可证伪：仅设 TIER 或仅设 DAYS 时 `parseEvidenceRetentionPolicy` 返回 `permanent`/`windowMs=null`（T11/T12），且 `source` 串含 `single-key-rejected`。
- **DS4**：**L4 facts 层无按时间物理删路径**。可证伪：`enterprise_fact` 行 `expires_at` 过期后仍在（T17）；且 src/l4/agent-memory-store.ts 中 `purgeExpired` 的删除 SQL 前置排除 enterprise_fact 的条件。
- **DS5**：**五层守卫存在且可反向验证**。可证伪：在 L1/L3/L5 人为插入时间删 → 守卫测试红（B4）；撤回 → 绿。
- **DS6**：**M3 消除**（与五层阶梯直接相关的两条）。可证伪：grep -rn "purgeExpired\|runEvidenceRetention" src/ \| grep -v "\.test\." 各 ≥1 生产调用方（W1/W5）。

**结果**

- **DS7**：**运维契约可复核**。可证伪：docs/synova/runbooks/data-lifecycle-ladder.md 存在，含五层阶梯表 + 双键操作手册 + 复现命令；K3 照 runbook 命令独立重跑得到相同结论。
- **DS8**：**defer 显式登记**（不静默）。可证伪：docs/synova/coordination/board-backlog.json 新增两条条目——①「蒸馏引用写入方（L3/L4/L5 生产者）接线」②「L1/L3 归档导出管道」；条目 note 含本 spec 编号 D725。
- **DS9**：**零类型违规**。可证伪：grep -rn "as any\|as never\|as unknown as" src/l3/ src/evidence/ src/l4/ \| grep -v "\.test\." 零命中。
- **DS10**：**全量测试绿**。可证伪：npx vitest run tests/l3 tests/l4 tests/architecture 零失败（铁律 36）。

**本 spec 自身的完成标准（dev doc 交付面）**

- **DS-S1**：bash scripts/control-tower/dev-doc-gatekeeper.sh <本 doc> → **exit 0**（C1-C6 全过）。
- **DS-S2**：写集表存在且可被 devdoc_writeset.py --extract 提取（C6，**已实测提取 10 条**）；check-dev-doc-write-set.sh 按 §5.1「写集核验口径」的 spec 期口径验收——存在性 6/10 通过，4 条"新建"文件为**预期内**存在性命中（实施期文件存在后消除），**实现期必须跑全量口径并全绿**。
- **DS-S3**：北星 front-matter 齐（服务用户 / 服务场景 / 模块终态 / 对齐北星 / 完成标准 / 当前进度）。
- **DS-S4**：task-state/D725.json 的 spec 段回填 + status=spec_done。

---

## 11. Auth Doc References

| 引用 | 路径 | 用途 |
|---|---|---|
| 创始人裁定（本 spec 首席权威） | 本 doc §1 权威①（逐字记录，2026-09-13） | 「蒸馏完成」确权 / 双键门 / 交接包指向 |
| 创始人 2026-09-10 发言（转述） | docs/synova/coordination/board-backlog.json | 五层骨架来源（带证据等级声明） |
| 派单与台账 | docs/synova/coordination/问题总账与下一批派单-20260913.md | 任务范围 + D717-N4 精度记录 |
| 交接包格式先例 | docs/synova/coordination/派单-下一批四线并行-20260913.md | §12 交接包形态来源 |
| D717 落地代码 | src/l3/evidence-retention.ts , src/deploy/bootstrap.ts , tests/l3/evidence-retention.test.ts | 被扩展对象（未合并，见 §4.1） |
| 「蒸馏」仓内语义 | src/l4/graph-bridge.ts , src/l3/pkb-lifecycle.ts | 既存工程定义 |
| 其余四层数据面 | src/evidence/evidence-store.ts , src/l4/agent-memory-store.ts , src/l4/knowledge-store.ts , src/sentinel/runner.ts , src/sentinel/sentinel-events.ts , src/store/session-store.ts | §4.2 台账 + §5.2 阶梯 |
| 产品北星 | .claude/PRODUCT-BRIEF.md | §一 / §二 / §六，front-matter「对齐北星」来源 |
| 铁律 | AGENTS.md / CLAUDE.md | 0-2 / 0-3 / 4 / 5 / 11 / 24 / 31 / 32 / 37 / 38 / 39 / 47 / 48 / 49 |
| 决策框架 | docs/synova/coordination/DECISION-REFERENCE.md | §5.5 决策参考四步 |
| 参考范例（D381 写前必读） | docs/plans/codex/implementation/SYNOVA-IMPL-D352-resolver硬化-20260813.md | 7 样结构骨架 |
| task-state | task-state/D725.json | 本任务登记 |

---

## 12. 实施交接包（Win 线）

> 形态对齐 D716 spec2（创始人裁定③：本次交接包 = 五层阶梯实施，交 Win 线执行）。

**任务**：D725 五层阶梯实施（数据生命周期保留分级 / 触发条件 / 降级契约）

**为什么现在**：L2 是五层里唯一允许物理删客户证据的层，而它的判据（「蒸馏完成」）此前零权威出处；D717 已把"默认不删"落地但开关仍是单键可删（与创始人裁定冲突）。**本批必须与 #527 同批或紧随其后**——否则一个单键可删的版本会先进 main。

**前置（缺一不开工）**：

1. git fetch --all && git pull --ff-only （铁律 0-3，禁 behind 状态开工）；
2. **#527（feat/mac-d717-product-debt）已合入 main**（本写集与它共享 4 个文件，串行依赖，§5.1 边界声明）；
3. 合入后**重新核验 §4 全部行号**（M7 防漂移，D524 教训）；
4. 加载技能：contract-template（写 JSDoc 契约）+ windows-compat（若脚本涉 UTF-8/subprocess）；
5. 确认 src/sentinel/ 不在写集（跨线边界）。

**写集**：严格按 §5.1 表（5 修改 + 5 新建）。git diff --name-only 与实际改动必须完全一致；**新增 src/ 下的文件时把 §5.1 的目录级条目精确化为确切文件名**（同 commit 回填 spec，S-6）。

**硬约束（违反 = 审计 FAIL）**：

- **fail-closed 不可反**：任何判定失败路径必须返回"不删"。删除是不可逆的。
- **零 as any / as never / as unknown as**（铁律 38，含内联 `as` 断言）；用类型守卫。
- **L3 零 db.prepare / db.exec**（铁律 39）：SQL 全留 L4 store。
- **降级三件套**：每个 catch 有 `log.warn/error` + `degraded: true` + 分类错误码（`.code`/`.phase`/`.retryable`，铁律 24/31/32）。
- **测试非空壳**：§7 的 T1-T20 / W1-W6 / G1-G5 / B1-B5 逐条落地，每条至少一个 `expect()`（铁律 48）；守卫测试（B4/B5）必须做**反向验证**（改红→撤回→绿）。
- **不动 src/sentinel/ 下任何文件、不动 scripts/audit/ **；不改 .github/CODEOWNERS 。
- **禁 git stash**（铁律 0-3）；隔离用 worktree。
- **commit 走 synova-commit，禁 --no-verify**；Conventional Commits + D# 引用。

**验收（物理可复现）**：

- §10 DS1-DS10 逐条给物理证据（命令 + 输出），落 evidence 目录（含时间戳/指纹）；
- §7 verify 命令表逐条跑通；
- npx vitest run tests/l3 tests/l4 tests/architecture 零失败；
- 守卫反向验证**必做**（改红 → 截图/日志 → 撤回 → 绿）。

**交付物**：代码（按 §5.1）+ 测试 + runbook + task-state/D725.json impl 段回填（含 evidence 路径）。

**审计**：K3 独立审计。提审口径 = 本 spec §10 DS1-DS10 + §7 全表；审计员须能照 §7 verify 表与 runbook 独立重跑。

---

## 13. 自检清单

- [x] 北星 front-matter 字段齐（DS-S3）
- [x] 写集表 D381 格式（`### 5.1 写集 (5 修改 + 5 新建)`，标题下一行即表头，中间无空行）；新建 src/ 文件用目录级声明（§5.1 已注理由）
- [x] §8 标题为 `Wiring Verification`；每条给真实生产调用点 + grep 命令；测试调用不计（S-3）
- [x] §7 四层齐（L1 / L2a / L2b / L2c）+ verify 命令表映射"声称↔用例"，无 echo 0（S-4）
- [x] 测试 red 覆盖失败模式（守卫反向验证 B4/B5、双键反向验证），非仅 happy path（S-5）
- [x] §5.2 五层阶梯（保留分级 / 触发条件 / 降级契约）逐层成文 + 4 条不变量
- [x] 「蒸馏完成」确权有创始人一手裁定（§1 权威①），非转述；D717 表述已更正（§1 确权结论）
- [x] 多选项任务写决策参考（§5.5 十项 + 收敛检查，S-12）
- [x] 写集边界声明共享资源与串行依赖（§5.1 注，S-7/S-8）
- [x] 不做清单含文件路径与归属（§6）
- [x] 铁律核对：0-2 接线、0-3 worktree、4/5 入口→结果、11/24/31/32 降级显式、37（defer 显式登记不静默）、38 零 as any、39 五层边界、47 契约头、48 非空壳、49 决策沉淀
- [x] 编号说明：台账计划号 D727 → 实际分配号 D725（D384 取号纪律，禁自编号）
- [x] 基线声明（M7 防漂移）：本 spec 基于 #527 未合并分支，编码前必须重核行号
