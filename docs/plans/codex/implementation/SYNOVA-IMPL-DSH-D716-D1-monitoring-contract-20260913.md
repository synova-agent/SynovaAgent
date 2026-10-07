---
north-star:
  服务用户: 企业主（老板，最终受益者）+ GA（增长顾问，直接用户）
  服务场景: 哨兵巡检发现问题后要通知老板——老板说"这个问题我想每周听一次、一页纸"；问题已被认领后系统不再反复喊；老板一直没动作时按契约升级提醒；老板说"这个我不管"也不被遗忘（定期回顾）
  模块终态: 每客户一份监测契约文件（阈值/渠道/节奏/格式/升级规则/责任人）→ 通知决策按「工单状态 + 实质变化」决定打扰与否 → 沉默但不遗忘（未回应/停滞进周报首页）
  对齐北星: PRODUCT-BRIEF.md §三（哨兵定时巡检 → 发现异常 → 严重信号自动建工单）+ §二（企业主自己看信号和报告；GA 从日常翻译变成定期深度诊断）
  完成标准: 写一份契约文件 → 通知行为按契约与工单状态改变（新发现/变化立刻推、已认领静默、未回应 24h 提醒一次、停滞 7 天进周报首页）→ 每条行为有测试与 evidence 物理可证
  当前进度: 创始人已裁 D-1（状态驱动通知模型）；工单状态机/阈值解析单点/通知渠道注册表均已存在；**通知决策只查 sentinelId + last_sent_ms，不读工单状态（M3 缺口）**；契约文件/schema/loader 此前不存在（本 doc 首次定义）
---

# SYNOVA-IMPL-DSH-D716-D1：监测契约（状态驱动通知的配置面）schema + loader + 决策接线

> ⚠️ **已由《DSH 权威手册 v1（2026-09-17）》部分取代**（`docs/synova/research/DSH权威手册-v1-20260917.md`，见其 §6.5）。
> **本 spec 尚未实施——缺口诊断仍然成立**（现验：`monitoring-contract` / `decideNotification` / `sentinel_notification_state` 在 `src/` 命中数均为 **0**）。「通知决策只查 `sentinelId + last_sent_ms`、不读工单状态（M3 缺口）」**仍成立**。
> **被取代的部分——本文「现状材料」的全部 `file:line` 引用已 100% 失效**：在 `src/sentinel/runner.ts` 抽查 12 个行号（L178/184/212/259/517/588/787/1021/1058/1092/1313/1335），**0 个命中原地**。例：
> | 旧引用 | 旧称内容 | **现查实际内容** |
> |---|---|---|
> | L178 | 工单四态枚举 | `source: 'GA_MANUAL';` |
> | L259 | `sentinel_tickets` DDL | `return parsed;` |
> | L1313 | `isNotificationDuplicate()` | `p75: n > 0 ? sorted[Math.floor(n * 0.75)] : 0,` |
> | L1335 | 通知去重持久化表 | `prepare(sql: string): { get(key: string): { last_sent_ms: number } \| undefined }` |
>
> **执行前必须做的第一件事**：把本文所有 `file:line` 改为「<文件> 内 <符号>」并现查（`grep -n '<符号>' src/sentinel/runner.ts`）。**直接照抄本文行号 = 一定走错方向。** 手册 §7 T-08 已登记本 spec 的现状材料重写待办。
> **仍然有效的部分（本文的核心资产）**：§5.2 契约 schema 与字段字典（含默认值 24h / 7 天 / weekly / one_pager / `["electron"]`）、§5.2-D 六态映射表、§5.2-G 阈值三层优先级（契约 > memStore > manifest）、§5.2-H 行为等价性声明（四条显式差异）、§7 测试设计 T1–T16、§6 降级契约。

> 状态: dev doc（spec） | 2026-09-13 | 优先级 P0 | 证明层级: L3 洞察层（哨兵引擎）
> 验收点: `docs/synova/product-lines/product-lines.yaml` 线 8 **8-6**（通知按状态驱动 + 监测契约；当前 `uncommitted` / `evidence: []`）
> 上游裁定: `docs/synova/product-lines/DECISION-D1-状态驱动通知模型-20260912.md`（创始人 2026-09-12 裁定，已生效）
> 归属: **Mac DSH 编码线**（src/sentinel/ 哨兵切片）；Win 侧交互/写入/周报渲染不在本 doc 写集（见 §5.5 跨线边界）

## 1. Authority Doc Verification

**权威 ① — 创始人裁定原文**（`docs/synova/product-lines/DECISION-D1-状态驱动通知模型-20260912.md`，已裁决并生效）:

> **一句话**：不重复喊同一件事，但绝不遗忘任何一件事——靠「状态 + 节奏」，不靠「时间窗」。

> 3. **节奏与格式由老板定**，在首次告警时询问；技术载体＝**监测契约**（每客户/每指标：阈值、渠道、节奏、格式、升级规则、责任人），**文件化**（符合「加文件不改代码」架构哲学）
> 4. **政策值（默认，可改）**：新发现后 **24 小时**未回应 → 提醒一次；**7 天**无进展 → 进周报首页；老板不指定节奏时 → 默认**周报 1 次、一页纸**；老板明确「不处理」的问题 → **每周回顾一次**（简短列出）

**权威 ② — 跨线同步（接口与写集边界）**（`docs/synova/coordination/跨线同步-D1状态驱动通知模型-Mac-Win-20260912.md` §三/§四）:

> **Mac 侧对外提供（Win 可依赖）**：3. 升级事件的产出（含停滞天数、停滞原因字段）
> **待定项（需创始人拍板后由 dev-doc 落入 schema）**：契约文件放哪；契约 schema 归属：建议由 dev-doc 出（单一事实源），Mac/Win 均不得各自扩展字段

**权威 ③ — 派单**（`docs/synova/coordination/派单-下一批四线并行-20260913.md` §D716）:

> 交付：契约文件 schema（每客户/每指标：阈值、渠道、**节奏**、**格式**、升级规则、责任人）+ 文件位置 + 示例 + 默认值（24h 未回应提醒 / 7 天无进展进周报首页 / 默认周报一页纸 / 明确不处理每周回顾）

**权威 ④ — 验收点原文**（`docs/synova/product-lines/product-lines.yaml` 线 8 的 8-6）:

> 通知按状态驱动 + 监测契约（新发现/实质变化立刻推；已认领停止重复、转约定节奏；未回应或停滞按契约升级；节奏与格式在首次告警时由老板确认）

**权威 ⑤ — 铁律**（`AGENTS.md` / `CLAUDE.md`）: 铁律 0-2（spec→test→impl→wire）、4/5（入口→交互→结果；追调用链）、11/24/31（降级必须有 log + degraded 且传播）、38（`as any` 零容忍）、39（五层边界）、47（契约优先）、48（测试非空壳三路径）。

## 2. Problem Statement

**要解决的问题**：老板收到的通知语义是错的——系统按「时间窗去重」决定要不要喊，而经营问题是慢变量：

- 窗口短 → 同一件已知问题反复轰炸 → 告警疲劳 → 老板不再看（监测功能的死法）
- 窗口长 → 把两件不同的事误合并 → 丢掉真实变化

**根因**（创始人裁定原文 §一）：把「告警」（事件，一次性）和「跟踪」（订阅，有节奏）混成一个机制。正解是**问题生命周期 + 状态驱动通知**：新发现与实质变化才配打扰；已认领转约定节奏；未回应/停滞按契约升级；明确不处理也要定期回顾（沉默 ≠ 消失）。

**落地缺口的本质**：产品语义已裁（D-1），但**契约这一配置面在仓库里根本不存在**——老板无法表达"这个问题我想每周听一次、一页纸"，系统也没有地方读这个意愿；同时通知决策（src/sentinel/runner.ts ）只查 `sentinelId + last_sent_ms`，不读已经存在的工单状态（M3 型：机制有、未接线）。

**为什么现在做**：8-6 是线 8（告警推送）的核心验收点，且是首个客户部署前必须成立的产品语义；契约 schema 是 Mac（loader/决策）与 Win（交互/写入/周报）两侧的**唯一接口事实源**——先定 schema 再并行实现（跨线同步文档 §五 时序）。

## 3. Q0-Q4

### Q0: 定位 — 项目拼图 + 文件审计

**a) 项目拼图**：Synova = 组织数字孪生诊断 + 持续增长导航。本任务在 **L3 洞察层**的哨兵切片（src/sentinel/ 目录）：把「通知决策」从时间窗改为「工单状态 + 实质变化 + 客户契约」。不新增系统，只把既有工单状态机（D580）与通知派发链（D6/D17/D272）之间的断点接上，并补一个此前不存在的配置面（契约文件）。

**b) 文件审计**（2026-09-13 实测，逐条 grep/read 见 §4）：

| 需要的部件 | 现状 | 结论 |
|---|---|---|
| 工单状态机（open/acknowledged/resolved/dismissed） | 已存在（src/sentinel/runner.ts ） | **复用**，不改状态机语义（保 K3 D580 credit） |
| 工单读路径（列表/迁移） | 已存在（`listSentinelTickets` / `transitionTicket`） | **复用** |
| 通知派发链（dispatchNotification / ProactivePush） | 已存在（src/notifications/registry.ts 等） | **复用**，只改"要不要发/发到哪" |
| 通知去重（sentinelId + 时间戳） | 已存在（去重表 + 内存 Map） | **降级为抖动合并器**（D-1 裁定 1），语义不变 |
| 阈值解析单点 | 已存在（src/sentinel/sentinel-loader.ts 的 `resolveThresholds`，D577） | **扩展**（加契约层），不另造第二解析点 |
| 通知渠道注册表 | 已存在（src/notifications/registry.ts ） | **复用**（渠道合法性校验用现成 `listNotificationChannels()`） |
| 监测契约 / 契约 loader / 状态驱动决策 | **不存在**（本仓 grep 零命中） | **新建** |
| 事件流（append-only） | 已存在（src/sentinel/sentinel-events.ts ） | 复用，但 **不新增 event_type**（DDL CHECK 迁移陷阱，见 §5.4 决策 5） |

**c) 决策**：能复用的全部复用（工单状态机/读路径/派发链/阈值单点/渠道注册表）；无覆盖的才新建，且新建面压到最小（1 个 loader + 1 个策略模块 + 1 张新表）。

### Q1: 调研 — 业界最佳实践 / 顶尖团队 / memory 历史教训

**a) 业界最佳实践（事件 vs 跟踪的分离）**：告警系统把"事件"与"跟踪"分开是通行做法——事件有生命周期状态（triggered/acknowledged/resolved），**认领后停止升级，超时未认领则升级**；订阅方按"通知偏好/频率"（即时 / 每日摘要 / 每周摘要）表达自己的节奏，而不是由系统用时间窗替老板决定。参考（公开文档，仅取模式，未复制内容）：

- PagerDuty《Incidents》— 事故状态机（含 acknowledged / resolved）：<https://support.pagerduty.com/main/docs/incidents>
- PagerDuty《Escalation Policy Basics》— 超时升级（未认领 → 升级到下一级）：<https://support.pagerduty.com/main/docs/escalation-policies>
- SaaS 通知偏好中心（频率选项：即时/每日/每周摘要）：<https://viprasol.com/blog/saas-notification-preferences/>

**b) 本仓既有范式（顶尖团队 = 本项目自己的先例，优先于外部）**：
- 文件驱动：`expert/`、extensions/sentinels/ 与 extensions/policies/escalation-rules.json （GA 可编辑，改文件即改行为）
- 单一解析点：阈值解析 `resolveThresholds`（D577）与渠道注册表 `listNotificationChannels()`（D580 家族）——**新能力必须挂在这两个既有缝上，不另造第二套**
- 事件溯源：`sentinel_events` append-only + 可重放（I1/I2/I3）

**c) memory/ 历史教训（决定本 doc 的写法）**：
- **M3 机制建成未接线**：本任务的对象正是 M3（工单状态机存在、通知决策不读它）。故本 doc 的 §8 逐条列生产调用点，**测试调用不计**。
- **M2 声称 vs 事实**：所有"现状"断言均带 file:line 并在 §4 标注实测方式；所有 Done 标准带可执行命令。
- **铁律 11/24/31**：契约文件损坏/组织不匹配 → 必须 `log.warn` + `degraded: true` + 显式回退默认值，**不许静默**（历史上静默降级被 K3 反复判 P0）。
- **D580 8-3 credit 不能丢**：去重键稳定性已被 K3 验证；本次只降级窗口语义（创始人已裁），不动键。

> **参考：第一性原理 + 本仓 PagerDuty 式状态机先例 + 铁律 11/24/31/47 → 结论：契约＝文件化配置面（运行时数据目录），决策＝纯函数 + 工单状态，复用既有单点，不新增机制族。**
> 本轮为对外检索（1 轮 2 查询，取模式与链接）；未逐篇精读外部文档，结论以本仓实测为准。

### Q2: 范围 — 正确的最简方案

**做什么**（本 doc 定义；实现在 Mac 哨兵切片）：

1. **契约文件 schema**（§5.2-A）：每客户一份 JSON，含 `defaults`（节奏/格式/渠道/升级/不处理回顾）+ `metrics[]`（阈值/渠道/节奏/格式/升级规则/责任人）
2. **文件位置**：数据目录（与 `synova.db` 同目录）——运行时客户数据，**不是**仓库出货资产（§5.2-B 决策 1）
3. **契约 loader**（§5.2-C）：读 + 校验 + 三层合并（契约 > 内置默认）+ 字段级降级 + mtime 记忆化
4. **通知决策接线**（§5.2-D）：`decideNotification(input, contract)` 纯函数 + 在既有两个派发点真实调用；六态映射逐条落地
5. **通知状态表**（§5.2-E）：按 signal 记录 `first_notified_ms / last_notified_severity / entities / reminded_at_ms / front_page_at_ms`（幂等靠它）
6. **升级队列读接口**（§5.2-F）：Mac 侧对外提供「未回应/停滞」清单（含停滞天数、原因），供 Win 周报消费（跨线同步文档 §三 第 3 项）
7. **阈值契约层**（§5.2-G）：`resolveThresholds` 加一层（契约 > memStore > manifest）
8. 测试（L1/L2a/L2b/L2c）+ 接线 + evidence + 产品线证据绑定建议

**不做什么**（含文件路径，逐条见 §6）：不改 Win 侧交互与写入 API（app/ 、`electron-renderer/`、src/routes/sentinel.ts ）；不改周报渲染与推送（src/agent/boss-mailbox.ts 、src/server.ts 的周报触发块）；不改全局升级链策略文件（extensions/policies/escalation-rules.json ）与其引擎（src/services/escalation-engine.ts ）；不改验收点台账（`docs/synova/product-lines/product-lines.yaml`）；不改 app/ （另见 spec 2）。

### Q3: 验收 — 入口 → 交互 → 结果

| 环节 | 内容 |
|---|---|
| **入口** | ① 老板在首次告警处选择节奏/格式（Win 交互，**写**契约文件——本 doc 只定义文件格式与原子写要求）② GA/老板直接手工编辑契约文件（文件化，路径见 §5.2-B） |
| **处理** | loader 读取并校验契约 → 决策函数读工单状态 + 通知状态表 + 契约 → 输出 `notify / remind / front_page / silent` → 派发点按渠道真实派发；提醒与进首页幂等（状态表落账） |
| **结果** | 老板侧可观测：新发现/实质变化立刻收到；已认领的问题不再重复打扰；24h 未回应收到一次提醒；7 天停滞出现在周报首页清单；明确「不处理」的问题进入每周回顾清单 |

### Q4: 契约与测试（铁律 47/48，写码前定义）

本 doc 的 §5.2 即契约正文（loader 输入/输出/降级/错误分类、纯函数决策、表结构、读接口）；§5.4 为多选项决策参考（S-12）；§7 为测试要求（red→green 三路径 + 边界）。**实现方不得自行扩展字段**（跨线同步文档 §三 待定项裁决：schema 单一事实源 = 本文档）。

## 4. Current State（2026-09-13 实测，全部 grep/read 当场验证）

### 4.1 已存在且本任务复用（逐条证据）

| # | 事实 | 物理证据（file:line） |
|---|---|---|
| A | 工单四态枚举 `open│acknowledged│resolved│dismissed` | src/sentinel/runner.ts L178 |
| B | 工单 DDL（`sentinel_tickets`，含 status CHECK） | src/sentinel/runner.ts L259 |
| C | 工单读路径 `listSentinelTickets(status?)`（≤200 行，created_at DESC） | src/sentinel/runner.ts L1058 |
| D | 工单状态机 `transitionTicket(ticketId, to)`（非法迁移 409） | src/sentinel/runner.ts L1092 |
| E | finding 生命周期 `status?: 'open'│'acknowledged'│'resolved'` + `transitionFindingStatus` | src/sentinel/types.ts L63；src/sentinel/runner.ts L1021 |
| F | 自动工单 id 确定性 = `ticket-${signal.id}-auto`（同信号幂等） | src/sentinel/runner.ts L787 |
| G | 通知去重：按 `sources[0].sentinelId` + `last_sent_ms`；持久化表 `sentinel_notification_dedup` | src/sentinel/runner.ts L1313 / L1335；DDL L277 |
| H | 两个通知派发点：自诊断（L517）与聚合信号循环（L588） | src/sentinel/runner.ts L517 / L588 |
| I | 阈值解析单点 `resolveThresholds`（manifest 基线 + memStore 覆写）**有生产调用方** | 定义 src/sentinel/sentinel-loader.ts L130；调用 src/sentinel/runner.ts L1210 与 src/sentinel/sentinel-loader.ts L259 |
| J | 通知渠道注册表 + 活渠道枚举 `listNotificationChannels()` | src/notifications/registry.ts L41；`electron` 渠道 src/notifications/electron-adapter.ts L14；extensions 渠道由 src/init/file-driven-loaders.ts L58 加载 |
| K | 事件流 append-only（建表/追加/重放）；**event_type 有 CHECK 约束** | src/sentinel/sentinel-events.ts L86 / L119 / L169；类型枚举 L27 |
| L | 老板周报：周一 9:00 触发（`setInterval` 每分钟检查）+ 飞书推送 | src/server.ts L169 起（生成 L216、推送 L217） |
| M | 一页纸渲染器已存在（D480） | src/agent/report-assembler.ts L240 |
| N | 数据目录解析：`SYNOVA_DB_PATH` → `dbPath`；平台数据目录另有一路 `getDataDirectory()` | 配置 src/config.ts L104；平台路径 src/deploy/data-directory.ts L27 |

### 4.2 缺陷（本任务要解决的，逐条实证）

**缺陷 A（P0，M3 型）：通知决策不看工单状态。**
src/sentinel/runner.ts L1313 的 `isNotificationDuplicate()` 只读去重表 `last_sent_ms`（键 = sentinelId）。工单已被 `acknowledged`（老板已认领）时，同一 sentinel 只要过了 5 分钟窗口就会再次推送 → 正是 D-1 §一 描述的"反复轰炸"路径。工单状态机与通知决策之间**零连接**（grep `listSentinelTickets` 在通知路径零命中）。

**缺陷 B（P0）：监测契约不存在。**
全仓 grep `monitoring-contract│monitoringContract│监测契约文件` 零命中（除决策/派单/同步文档的叙述文本）。老板无法表达节奏/格式；渠道/责任人/阈值均无客户级载体。

**缺陷 C（P1）：升级规则引擎双重死（机制在、永不触发）。**
src/sentinel/runner.ts L212 构造 `new EscalationEngine()` **不传 rules** → 引擎内 `this.rules = []`（src/services/escalation-engine.ts L121）；且唯一生产调用点 L630 恒传 `firstIgnoredAt: null`（该值非空才继续判定，L135-140）。两条路径都返回 null → 升级评估**永不触发**，只有一行 `log.warn` 兜底。本任务**不使用**该引擎（见 §5.4 决策 5、§6），但必须登记（避免下一个人以为它活着）。

**缺陷 D（P1）："停滞/无进展"无时间锚。**
`sentinel_tickets` 只有 `created_at` 与 `resolved_at`（src/sentinel/runner.ts L259 的 DDL），无 `acknowledged_at`；`TicketRow`（L184）同样只有这两列。故"7 天无进展"只能以 `created_at` 为锚（§5.4 决策 8）。

**缺陷 E（P2，登记不修）：周报链路三个降级口。**
src/server.ts L177 `if (!webhookUrl) return;` 未配置飞书时**静默跳过**（无 log，违反铁律 11）；L186-196 的 actions 源 `records` 恒为空数组 → 周报"正在执行的方案进展"恒空；周报触发在 Win 域（src/server.ts ），本 spec 不动，只作为 8-6 外发可达性的边界事实记录。

### 4.3 与本次设计相关的环境事实（决定文件位置）

- 打包态后端由 Electron 以 `SYNOVA_DB_PATH=<userData>/data/synova.db` 注入启动（`electron/main.cjs` L256；`electron/backend-spawn.cjs` L174）→ **`dirname(config.dbPath)` 是唯一与实际 DB 同处一地的可写目录**。
- 另有 `getDataDirectory()`（src/deploy/data-directory.ts L27）返回 `…/Synova/data`，与 Electron userData（本机实测 `~/Library/Application Support/synova-agent/data`，独立目录 `…/Synova/data` 下只有 `_snapshots`）**不是同一目录** → 契约路径**不得**用该函数（否则契约与 DB 分居两地，备份/迁移语义断裂）。

## 5. What We Build

### 5.1 写集 (4 修改 + 3 新建)

| 文件 | 操作 | 说明 |
|------|:---:|------|
| src/sentinel/ | 新建 | 新增两个模块：monitoring-contract.ts（schema 类型 + 校验 + 三层合并 loader + mtime 记忆化）与 notification-policy.ts（状态表建表/读写 + 纯函数 decideNotification + 升级队列 listEscalationQueue）。目录级声明（新文件尚不存在，dev-doc 写集核验对未存在文件报假阳，D580/D590/D593 先例）；实现同 commit 精确化为确切文件名 |
| src/sentinel/runner.ts | 修改 | ① `start()` 建通知状态表；② 两个派发点（L517/L588）改走 decideNotification（读工单状态 + 契约）；③ 提醒/首页幂等落账；④ 新增 `listEscalationQueue()` 供 Win 路由消费；⑤ 保留抖动合并器语义（去重表不动） |
| src/sentinel/sentinel-loader.ts | 修改 | `resolveThresholds` 加契约层：契约命中 → 契约优先；未命中 → 既有 memStore → manifest 链不变（零回归） |
| src/sentinel/types.ts | 修改 | 新增契约相关类型导出（如放 monitoring-contract.ts 亦可——实现期定，二者取一，避免类型双源） |
| tests/sentinel/ | 新建 | 三个测试文件（monitoring-contract.test.ts / notification-policy.test.ts / notification-wiring.test.ts）——目录级声明，D593 先例 |
| tests/services/ | 修改 | 仅当 resolveThresholds 既有测试需要跟随契约层（tests/services/escalation-engine.test.ts 不动——引擎不改） |
| docs/synova/product-lines/evidence/ | 新建 | 本任务 evidence 目录（.json/.txt，**不用 .log**——证据 .log 被 .gitignore 静默忽略，另见 D718 待修）；Mac 域 |

> 计数口径：3 个新建（两个新模块目录级 + 测试目录级 + evidence 目录级 = 表中 3 行"新建"），4 行修改（含条件修改行）。实现提交后按 D590 先例精确化为确切文件名。
>
> **共享资源标注（S-8）**：docs/synova/product-lines/evidence/ 与 spec 2 声明同一父目录，但两侧写入**不同文件**（本切片以 D716-mac-* 前缀命名，spec 2 以 D716-win-* / D716-1-5-* 前缀命名）→ 无写冲突；该目录属 Mac/产品线域，Win 侧只读（跨线依赖在 PR 描述显式声明）。

### 5.2 产出物与文件路径（What We Build 正文）

**A. 契约文件 schema（本文档为单一事实源；Mac/Win 均不得自行扩展字段）**

```json
{
  "schema_version": 1,
  "org_id": "default",
  "updated_at": "2026-09-13T06:30:00.000Z",
  "updated_by": "boss",
  "defaults": {
    "cadence": "weekly",
    "format": "one_pager",
    "channels": ["electron"],
    "escalation": {
      "remind_after_hours": 24,
      "front_page_after_days": 7,
      "escalate_to": "owner"
    },
    "dismissed_review": "weekly"
  },
  "metrics": [
    {
      "sentinel_id": "cash-runway",
      "metric": "cash_runway_months",
      "thresholds": { "warning": 12, "critical": 6 },
      "channels": ["electron", "email"],
      "cadence": "daily",
      "format": "short_text",
      "escalation": { "remind_after_hours": 12, "front_page_after_days": 3, "escalate_to": "owner" },
      "owner": "ga",
      "note": "老板要求现金流每日看一眼"
    }
  ]
}
```

**字段字典**（六个必需能力面 + 元字段）：

| 字段 | 类型 | 必需 | 默认 | 语义 |
|---|---|:---:|---|---|
| `schema_version` | `1` | ✅ | — | 版本守卫；非 1 → 忽略整文件 + `log.warn` + degraded |
| `org_id` | string | ✅ | — | 归属守卫：必须等于 `config.orgId`；不等 → **忽略整文件**（防串客户）+ warn + degraded |
| `updated_at` | ISO8601 string | ✅ | — | 人工可读审计；非法格式 → 字段级丢弃 + warn（不致命） |
| `updated_by` | `boss│ga│system` | ✅ | — | 写入者；未知值 → 存原值 + warn（不致命） |
| `defaults.cadence` | `daily│weekly│monthly` | ❌ | `weekly` | 默认节奏（D-1 政策值 3） |
| `defaults.format` | `one_pager│short_text│full_report` | ❌ | `one_pager` | 默认格式（一页纸；渲染器已存在，§4.1-M） |
| `defaults.channels` | string[] | ❌ | `["electron"]` | 默认渠道；元素须 ∈ `listNotificationChannels() ∪ {"weekly_report"}` |
| `defaults.escalation.remind_after_hours` | 正整数(1-720) | ❌ | `24` | 未回应提醒阈值（D-1 政策值 1） |
| `defaults.escalation.front_page_after_days` | 正整数(1-365) | ❌ | `7` | 停滞进周报首页阈值（D-1 政策值 2） |
| `defaults.escalation.escalate_to` | `owner│department_head│liaison` | ❌ | `owner` | 升级接收人角色（取值与 extensions/policies/escalation-rules.json 同族，不造第二套词汇） |
| `defaults.dismissed_review` | `weekly` | ❌ | `weekly` | 「明确不处理」回顾节奏（D-1 政策值 4） |
| `metrics[].sentinel_id` | string | ✅ | — | 哨兵 id（与 `manifest.name` 对齐，兼容 `sentinel-` 前缀剥离，同 `resolveThresholds` 口径） |
| `metrics[].metric` | string | ❌ | 主指标 | `manifest.thresholds` 的键；缺省 = 该哨兵首个键 |
| `metrics[].thresholds` | `{warning:number, critical:number}` | ❌ | manifest 值 | 客户级阈值覆盖（§5.2-G 优先级） |
| `metrics[].channels` | string[] | ❌ | `defaults.channels` | 该问题走哪些渠道 |
| `metrics[].cadence` | 同 `defaults.cadence` | ❌ | `defaults.cadence` | 跟踪节奏 |
| `metrics[].format` | 同 `defaults.format` | ❌ | `defaults.format` | 汇报格式 |
| `metrics[].escalation` | 同 `defaults.escalation`（字段级覆盖） | ❌ | `defaults.escalation` | 该问题的升级规则 |
| `metrics[].owner` | `owner│ga│department_head│liaison` | ❌ | `null`（未指定） | 责任人（第一处理人） |
| `metrics[].note` | string | ❌ | `""` | 自由备注（不改行为） |

**B. 文件位置（决策 1/2 结论）**

- **实例路径**：`<dirname(config.dbPath)>/monitoring-contract.json`
  - 桌面 prod：`<Electron userData>/data/monitoring-contract.json`（与 `synova.db` 同目录，`electron/main.cjs` L256 注入的 `SYNOVA_DB_PATH` 决定）
  - dev/服务端：`./data/monitoring-contract.json`
- **理由**：契约是**运行时客户数据**（老板改节奏要立刻生效、升级/重装不丢、与 DB 同生命周期），不是出货资产；写进 extensions/ 会在打包态变成只读资源目录里的写入（错位），且会把 Mac/Win 的写集叠在同一个仓库路径上。
- **不落仓**：契约文件**不进仓库**（`data/` 已在 `.gitignore`）→ 跨线写集**零重叠**（比"契约文件目录 = Win 域"更强的边界；跨线同步文档 §四 的"共享但不可双写"风险在本设计下不存在）。
- **原子写要求（Win 侧实现约束）**：临时文件 + `rename` 原子替换；写前 schema 校验；失败 → log + degraded，不写半截文件（Mac 侧读侧对损坏文件必须降级而非崩溃，见 C）。
- **多客户演进触发条件**：若未来同实例多 org → 改 `<dirname(dbPath)>/monitoring-contracts/<orgId>.json`；本期不做（单实例 = 单客户，src/config.ts L109 `orgId` 为实例级）。

**C. loader 契约**（新模块；文件名 monitoring-contract.ts，位于 src/sentinel/ 目录）

```ts
/**
 * loadMonitoringContract — 监测契约读取 + 校验 + 三层合并（内置默认 > 契约文件）
 * 契约:
 *   @input  — deps?: { dataDir?: string; readFile?: (p: string) => string; statMtimeMs?: (p: string) => number|null; orgId?: string }
 *             缺省: dataDir = dirname(config.dbPath)；orgId = config.orgId；真实 fs 读
 *   @output — EffectiveContract {
 *               org_id: string; source: 'file' | 'defaults';
 *               degraded: boolean; degradedReasons: string[];
 *               defaults: ContractDefaults;              // 全字段必填（默认已填）
 *               bySentinel: Map<string, ContractMetricEntry>;  // 已合并的哨兵级条目
 *             }
 *   @degraded — ENOENT → 正常缺省（不告警，degraded=false，source='defaults'）
 *               JSON.parse 失败 / schema_version 非 1 / org_id 不匹配 → log.warn + degraded=true + 整文件忽略（全用默认）
 *               单字段非法（类型/枚举/越界/渠道未注册）→ log.warn + degraded=true + 丢弃该字段（其余字段生效），degradedReasons 列出字段名
 *   @error  — 不抛（所有失败路径降级返回，铁律 24/31）
 *   @cache  — 以 (mtimeMs, size) 记忆化；文件未变 → 复用上次解析结果；clearMonitoringContractCache() 供测试/热更新
 */
export function loadMonitoringContract(deps?: LoadMonitoringContractDeps): EffectiveContract;

/** 取某哨兵的有效契约（未声明 → 全默认；sentinel- 前缀自动剥离，口径同 resolveThresholds） */
export function contractForSentinel(c: EffectiveContract, sentinelId: string): ResolvedContract;
```

`ResolvedContract` = `{ thresholds?: {warning:number;critical:number}; channels: string[]; cadence: Cadence; format: ReportFormat; escalation: {remind_after_hours:number; front_page_after_days:number; escalate_to:OwnerRole}; owner: OwnerRole|null }`（**全字段必填**——下游不再判空）。

**D. 决策函数契约**（纯函数，新模块 notification-policy.ts）

```ts
export type NotifyAction =
  | { action: 'notify'; kind: 'first' | 'change'; channels: string[]; reason: string }
  | { action: 'remind'; kind: 'no_response'; channels: string[]; hoursSinceFirstNotify: number }
  | { action: 'front_page'; stalledDays: number; reason: string }   // 不即时推送，进周报首页队列
  | { action: 'silent'; reason: 'acknowledged' | 'dismissed' | 'resolved' | 'jitter_merge' | 'no_change' };

/**
 * decideNotification — 状态驱动的通知决策（D-1 六态映射，见 §5.2-H）
 * 契约:
 *   @input  — input: {
 *               sentinelId: string; signalId: string; severity: 'emergency'|'critical'|'warning'|'info';
 *               entities: string[];                      // 本次关联实体（指纹用）
 *               nowMs: number;                            // 注入时钟（测试确定性）
 *               ticket?: { status: TicketStatus; created_at: string; resolved_at: string|null };
 *               state?: NotificationStateRow;             // 该 signal 的历史通知状态（无 = 首次）
 *               jitterWindowMs?: number;                  // 抖动合并窗口（缺省取既有去重窗口）
 *             }
 *             contract: ResolvedContract
 *   @output — NotifyAction（纯函数，无 IO，无副作用）
 *   @degraded — 无 IO 故无降级路径；上游 loader 的 degraded 由调用方传播（不改动作语义，只记日志）
 *   @error  — 不抛
 */
export function decideNotification(input: DecideNotificationInput, contract: ResolvedContract): NotifyAction;
```

**E. 通知状态表**（新表；DDL 写在 src/sentinel/runner.ts 的 `start()` 内，与既有两张表同址）

```sql
CREATE TABLE IF NOT EXISTS sentinel_notification_state (
  signal_id              TEXT PRIMARY KEY,
  sentinel_id            TEXT NOT NULL,
  first_notified_ms      INTEGER NOT NULL,
  last_notified_ms       INTEGER NOT NULL,
  last_notified_severity TEXT NOT NULL,          -- 变化检测基准（§5.2-H 第 5 行）
  entities               TEXT NOT NULL DEFAULT '[]',  -- JSON 数组（关联集指纹）
  notified_count         INTEGER NOT NULL DEFAULT 1,
  reminded_at_ms         INTEGER,                -- 24h 提醒已发（幂等）
  front_page_at_ms       INTEGER,                -- 已进周报首页（幂等）
  resolved_at_ms         INTEGER
);
```

- 读写封装在同模块：`createNotificationStateTable(db)` / `readNotificationState(db, signalId)` / `upsertNotificationState(db, row)` / `listEscalationQueue(db, opts)`（形态对齐既有 src/sentinel/sentinel-events.ts 的"建表 + 追加 + 重放"三件套；**不新增 event_type**，规避 L86 的 CHECK 约束迁移陷阱：新增枚举值对既有库的旧 CHECK 会 `CHECK constraint failed`）。
- 读失败/表不存在 → 返回 `null` + `log.warn`（**不**降级为"已通知过"，否则会吞掉真实告警；宁可多发一次）。

**F. 升级队列读接口（Mac → Win 的唯一接口面）**

```ts
/**
 * listEscalationQueue — 未回应 / 停滞问题清单（供 Win 周报"需要你关注的事"消费）
 * @input  — opts?: { nowMs?: number; minStalledDays?: number }
 * @output — Array<{ signalId: string; sentinelId: string; severity: string; ticketId: string|null;
 *                   ticketStatus: TicketStatus; stalledDays: number;
 *                   reason: 'no_response' | 'stalled'; channels: string[]; format: ReportFormat }>
 * @degraded — db 不可用 → 抛（由 L2 调用方统一降级，与 listSentinelTickets 同口径）；空集 → []
 * @error  — 表不存在（start() 未调用）→ 抛出（同 listSentinelTickets）
 */
```

**G. 阈值契约层（复用单点，不另造）**
`resolveThresholds` 的优先级改为：**契约 `metrics[].thresholds` > memStore（D577 运行期覆写）> `manifest.thresholds`**；无契约文件时逐条等价（零回归）。命中契约时 `log.info` 注明来源（可审计）。

**H. 六态映射（D-1 §二 → 物理载体 → 可测判据）**

| D-1 产品态 | 物理载体 | 判据（可测） | 决策输出 |
|---|---|---|---|
| 新发现 | finding 产出；工单 status=`open`（自动工单 id 确定，§4.1-F） | `state == null` | `notify/first`（立刻；Win 侧在此挂「沟通请求」） |
| 已告知待回应 | 同上 + 状态表有行、无 ack | `state != null` 且 `now - first_notified_ms < remind_after_hours*3600e3` | `silent`（仅抖动合并器可吞：同一 checker 数十秒内重复） |
| 未回应超时 | 同上 | 超阈值且 `reminded_at_ms == null` | `remind/no_response`（**一次**，落账） |
| 已认领/处理中 | 工单 status=`acknowledged`（或 finding.status=acknowledged） | `ticket.status == 'acknowledged'` | `silent/acknowledged`（转入 cadence 汇总，不即时） |
| 有实质变化 | severity 档位上升（info<warning<critical<emergency）或 entities 出现新增 | `rank(sev) > rank(last_notified_severity)` 或新增实体 | `notify/change`（立刻） |
| 停滞超期 | 工单 status ∈ {open, acknowledged} | `now - created_at >= front_page_after_days` 且 `front_page_at_ms == null` | `front_page`（进队列，落账） |
| 已解决 | 工单 status=`resolved` 或 finding.status=`resolved` | 状态命中 | `silent/resolved`（不再推送） |
| 明确不处理 | 工单 status=`dismissed` | 状态命中 | `silent/dismissed`（进「明确不管」清单，`dismissed_review=weekly`） |

**行为等价性声明（防"顺手改行为"）**：无契约文件、无工单、无状态行时 → `notify/first`（与今天首次推送等价）；**显式差异**只有四条（创始人已裁）：① 已 ack 不再即时推；② 24h 未回应提醒一次；③ 7 天停滞进队列；④ 渠道/节奏/格式按契约。除这四条外的行为变化一律视为回归。

### 5.3 删除清单

无删除。（既有去重表/内存 Map 保留为抖动合并器；`EscalationEngine` 保留不删——见 §6。）

### 5.4 决策参考（S-12/D333）

| 决策点 | 选项 | 参考系 | 结论 |
|---|---|---|---|
| 1. 契约文件位置 | A extensions/ 出货资产 / B 数据目录（`dirname(dbPath)`） / C `knowledge/` | 第一性原理（契约是运行时客户数据：老板改节奏要立刻生效；出货资源目录在打包态是只读资产，写进去=错位）；本仓实测（`SYNOVA_DB_PATH` 注入路径唯一且与 DB 同生命周期）；跨线同步文档 §四（A 会制造 Mac/Win 仓库写集重叠） | **B** |
| 2. 存储形态 | A 纯文件 / B 纯 SQLite 表 / C 文件 + 状态表 | 创始人已裁"文件化"（权威 ① 第 3 条）；第一性原理（配置面 vs 运行状态面是两类数据：配置要人可编辑，状态要事务/幂等） | **C**——契约文件（配置）+ `sentinel_notification_state`（状态） |
| 3. 六态载体 | A 扩 DDL 为六态 / B 四态 + 通知状态表 + 变化事件 | 最少机制（工单四态已过 K3 D580 验证，扩 DDL 要迁移 + 丢 credit）；六态中"有实质变化"本就是**事件**不是状态（D-1 表第 4 行语义） | **B**——不新增工单状态，"新发现 vs 已告知"由状态表区分 |
| 4. 阈值优先级 | A 契约 > memStore > manifest / B memStore > 契约 > manifest | 声明式（客户契约）> 运行期微调（GA API 覆写）；A 在无契约时逐条等价旧链（零回归，§5.2-G） | **A** |
| 5. 升级事件载体 | A 新 `event_type` / B 新表 / C 复用 `signal` | 实测（src/sentinel/sentinel-events.ts L86 的 event_type CHECK：新枚举值对既有库旧 CHECK 会插不进，需表重建迁移）；第一性原理（提醒/首页是**通知状态**，不是哨兵事件） | **B**——状态表落账，读接口供 Win 消费 |
| 6. 默认值来源 | A 代码常量 / B 出货默认文件（extensions/ 下） | 最少机制（当前只有一个客户一个本体，行业差异不存在）；B 会引入"常量 vs 文件"双源与第三层优先级 | **A**；触发条件：第二客户或行业节奏差异出现 → 加出货默认层 |
| 7. 「沟通请求」归属 | A Win / B Mac | 创始人已裁 D-1 落地路径步 2（Win：app/ 、src/l1/ ）；Mac 只需保证 `notify/first` 可被识别为该请求的挂载锚点 | **A**（Mac 只保证 `kind='first'` 语义） |
| 8. 停滞起点 | A `sentinel_tickets.created_at` / B 事件流最近迁移时间 | 最少机制（DDL 无 `acknowledged_at`，§4.2-D；事件流读路径是**全量重放** `replaySentinelEvents`，为一个时间戳全量重放不成比例）；A 确定性、零新增状态 | **A**；触发条件：出现"认领后仍停滞"误报 → 引入 progress 锚（复用 `EscalationEngine` 的 `dataImproved` 概念） |
| 9. 升级链引擎去留 | A 顺手复活（加载 rules + 忽略历史） / B 不碰 + 登记 | 任务边界（D-1 的升级动作是"提醒一次/进首页"，与严重度驱动的**升级链**是两个机制）；复活需 ignore 跟踪（无数据源）；本 spec §6 登记给 CTO 另起任务 | **B**（登记，不复活） |

> 收敛检查：九项决策两参考系（第一性原理 + 本仓实测/创始人裁定）均指向同一答案，无分歧。**参考：第一性原理 + 创始人 D-1 裁定 + 本仓既有单点（D577/D580）**。

### 5.5 跨线边界（Mac 域 / Win 域，硬约束）

| 内容 | 归属 | 关键路径 |
|---|---|---|
| 契约 loader + 决策函数 + 状态表 + 阈值契约层 + 升级队列读接口 | **Mac DSH 编码** | src/sentinel/ |
| 契约文件**写入**（首次告警的「沟通请求」交互 → 原子写） | **Win** | app/ 、electron-renderer 侧交互、src/routes/ |
| 周期报告渲染与「未回应/停滞」呈现 | **Win** | 周报触发块在 src/server.ts L169 起；模板 src/l3/report-templates.ts |
| 复盘沉淀 / 复发识别 | **Win** | 记忆层 src/l4/ 、进化闭环（线 17；仓库内暂无 src/ 下对应目录，按演进另立） |
| 契约 schema 字段增删 | **dev-doc（本文档）** | 两侧均不得自行扩展（跨线同步文档 §三 裁决） |

- **共享资源**：无仓库内共享文件（契约实例在运行时数据目录，`.gitignore` 覆盖 `data/`）→ 两侧写集零交集，**不存在**"共享但不可双写"的路径。
- **依赖顺序**：Win 的写入实现依赖本文档的 schema（先行）；Mac 的 loader/决策依赖本 spec（同批）。任一侧需动对方目录 → **停手报 CTO/创始人**（多 Agent 协作协议）。

## 6. What We Don't Do

| 不做 | 原因 | 归属/触发 |
|---|---|---|
| 沟通请求 UI（老板选节奏/格式的交互入口） | 创始人已裁 D-1 步 2 归 Win；本 doc 只定义文件格式与原子写要求 | Win（线 2 交互） |
| 契约写入 API（HTTP 端点） | 同上（路由在 Win 域） | Win |
| 周报渲染改动（src/agent/boss-mailbox.ts 、src/server.ts 周报块 L169 起） | 本 spec 只产出"升级队列"接口；渲染与推送归 Win（线 3） | Win |
| extensions/policies/escalation-rules.json schema 变更 | 它是"严重度驱动的升级链"全局策略（与 D-1 的"未回应/停滞"动作是两机制）；改 schema 会牵动 src/services/escalation-engine.ts 与既有 K3 credit | 登记待办；触发条件：需要按严重度升级到上级时 |
| 复活 `EscalationEngine`（加载 rules + 忽略历史落账） | §4.2-C 双重死是独立缺陷；复活需要"忽略事件"数据源（当前无），属另一任务 | **登记（建议 CTO 入台账）**：src/sentinel/runner.ts L212 构造零 rules + L630 恒传 null |
| `docs/synova/product-lines/product-lines.yaml` 任何改动（含 8-6 证据绑定） | 验收点状态由证据/裁决驱动，不由文档声称；台账是产品线维护者/CTO 域 | CTO（建议绑定 `test:tests/sentinel/notification-wiring.test.ts` 或场景证据） |
| 多租户契约目录（`monitoring-contracts/<orgId>.json`） | 单实例=单客户（src/config.ts L109）；提前做=过度开发 | 触发条件：同实例多 org |
| 出货默认契约文件（extensions/ 下行业默认） | §5.4 决策 6（第二客户/行业差异出现再加） | 触发条件：第二客户 |
| 新增 `sentinel_events` 事件类型 | §5.4 决策 5（CHECK 约束迁移陷阱） | 触发条件：确需事件级审计时另起迁移任务 |
| 文件 watch / 长连接热重载 | mtime 记忆化已满足"改文件即生效"（下次决策读取） | — |
| 改 app/ 、src/server.ts 的静态挂载（双引导收敛） | 属 spec 2（`SYNOVA-IMPL-DSH-D716-1-5-dual-guide-convergence-20260913.md`），Win 域 | spec 2 |
| 改 src/services/escalation-engine.ts 的实现与测试 | 本任务不消费该引擎（§5.4 决策 9） | 登记待办 |

## 7. Test Requirements（测试先行——铁律 0-2/48；先 red，再 green）

**测试文件**（新建，`tests/sentinel/` 下）：`monitoring-contract.test.ts`（L1 单元）、`notification-policy.test.ts`（L1 单元，纯函数）、`notification-wiring.test.ts`（L2a 接线 + L2b 降级 + L2c 边界，真实 runner/DB 路径）。**模式**：沿 `tests/sentinel/threshold-injection.test.ts`（deps 注入缝，无 DB 依赖）与 `tests/sentinel/dedup-key-stability.test.ts`（去重语义）先例；DB 用 better-sqlite3 `':memory:'`，不 mock 管线（铁律 12）。

**L1 单元契约**（loader + 决策函数）：

| # | 用例 | red（现状） | green（实现后） |
|---|---|---|---|
| T1 | 无契约文件（ENOENT）→ 全默认 + `degraded=false` + `source='defaults'` | 模块不存在 | 断言全字段默认值（24/7/weekly/one_pager/["electron"]） |
| T2 | 合法契约 → 字段逐项生效（含 `metrics[]` 覆盖 defaults） | 同上 | `contractForSentinel()` 输出与文件一致 |
| T3 | `org_id` 不匹配 → 整文件忽略 + `degraded=true` + warn（**不得**应用任何字段） | 同上 | 输出 = 默认值；`degradedReasons` 含 `org_id_mismatch` |
| T4 | JSON.parse 失败 / `schema_version: 2` → 整文件忽略 + degraded | 同上 | 输出 = 默认值；`degraded=true` |
| T5 | 单字段非法（`cadence: 'hourly'`、`remind_after_hours: -1`、`channels: ['telegram']`）→ 丢该字段 + 其余生效 + degraded 列名 | 同上 | 非法字段回落默认；合法字段保留 |
| T6 | mtime 记忆化：文件未变 → 不重读（readFile 调用计数不增）；mtime 变 → 重读 | 同上 | 注入 readFile 计数器断言 |

**L2a 接线**（生产调用点真实传递，测试调用不计——S-3）：

| # | 用例 | red | green |
|---|---|---|---|
| T7 | runner 聚合派发路径调用 `decideNotification`，且契约 `channels` 真实影响派发目标 | 派发点只看 `isNotificationDuplicate` | 断言派发调用参数含契约声明渠道（如 `email`） |
| T8 | `resolveThresholds` 契约优先：契约声明阈值 → 返回值 = 契约值；删掉契约 → 回落 memStore/manifest（既有阈值测试零回归） | 契约层不存在 | 两段断言 + 既有 T5/T6/T9 用例不红 |
| T9 | 状态表建表 + 落账：一次派发后 `sentinel_notification_state` 有行且 `last_notified_severity` 正确 | 表不存在 | 行存在 + 字段值断言 |

**L2b 降级**（铁律 11/24/31）：

| # | 用例 | red | green |
|---|---|---|---|
| T10 | 状态表读失败（db 关闭/表缺失）→ `readNotificationState` 返回 null + warn，**决策按"首次"处理**（宁可多发，不吞真告警） | 无实现 | 返回 null + 决策 `notify/first` |
| T11 | 状态表写失败 → 派发不被阻断 + warn（不静默） | 无实现 | 派发仍执行；日志断言 |
| T12 | 契约 degraded 传播：loader `degraded=true` 时决策仍产出动作，但调用方日志含 degraded 原因 | 无实现 | 动作有效 + 日志含原因 |

**L2c 边界**：

| # | 用例 | red | green |
|---|---|---|---|
| T13 | 空文件 / `{}` / 只有 `schema_version` → 全默认 + degraded（缺必需字段） | — | 断言 |
| T14 | 阈值边界：`now - first_notified_ms` 恰等于 `remind_after_hours*3600e3` → 触发提醒（≥ 语义）；`- 1ms` → 不触发 | — | 两段断言 |
| T15 | 幂等：同一 signal 连续两次决策 → 第二次不再 `remind`（`reminded_at_ms` 已落账）；`front_page` 同理 | — | 断言两次输出不同 |
| T16 | 六态映射逐条（§5.2-H 八行表格 → 8 个断言） | — | 8 断言全绿 |
| T17 | cadence 汇总不触发即时推送：`acknowledged` + 无变化 → `silent`（即使超过抖动窗口） | 现状会推 | 断言 `silent` |

**verify 命令**（交付时逐条跑，输出贴 evidence）：

```bash
npx vitest run tests/sentinel/monitoring-contract.test.ts tests/sentinel/notification-policy.test.ts tests/sentinel/notification-wiring.test.ts
npx vitest run tests/sentinel/            # 全目录零回归
grep -rn "loadMonitoringContract" src/sentinel/ --include=*.ts        # ≥1 生产调用点（非测试）
grep -rn "decideNotification" src/sentinel/ --include=*.ts
grep -rn "sentinel_notification_state" src/sentinel/ --include=*.ts   # DDL + 读写
grep -rn "listEscalationQueue" src/sentinel/ --include=*.ts
```

## 8. Wiring Verification

**规则**：新 export 必须有**生产**调用点（测试调用不计，S-3）；每条给出定位命令。

| 新 export / 新对象 | 生产调用点（实现后应命中） | 定位命令 |
|---|---|---|
| `loadMonitoringContract` / `contractForSentinel` | src/sentinel/runner.ts 的决策构造函数（决策前取契约） | `grep -rn "loadMonitoringContract\|contractForSentinel" src/ --include=*.ts` |
| `decideNotification` | src/sentinel/runner.ts L517 与 L588 两个派发点（替换"只看去重"分支） | `grep -rn "decideNotification" src/sentinel/runner.ts ` |
| `createNotificationStateTable` / `readNotificationState` / `upsertNotificationState` | src/sentinel/runner.ts `start()`（建表）+ 派发点（读/写） | `grep -rn "NotificationState" src/sentinel/runner.ts ` |
| `listEscalationQueue` | Mac 侧：`SentinelRunner` 方法（供 Win 路由调用）；**Win 消费点（跨线，本 spec 声明不实现）**：src/routes/sentinel.ts 新端点 + 周报块 src/server.ts L169 起 | `grep -rn "listEscalationQueue" src/ --include=*.ts`（Mac 侧 ≥1）；Win 侧接线由 Win 任务负责并自证 |
| `resolveThresholds`（改签名不变） | 既有生产调用：src/sentinel/runner.ts L1210、src/sentinel/sentinel-loader.ts L259 | `grep -rn "resolveThresholds" src/ --include=*.ts` |
| 契约 `channels` 合法性校验 | src/notifications/registry.ts 的 `listNotificationChannels()`（复用，不新增渠道词汇） | `grep -rn "listNotificationChannels" src/sentinel/ ` |

**接线纪律**：① 派发点改动必须保留既有降级路径（catch + log.warn，不吞）；② 状态表读写失败不得阻断派发；③ 不得用测试文件冒充调用点（K3 逐条核）。

## 9. Architecture Layer

**层**：L3 洞察层（src/sentinel/ 哨兵引擎），加上 L5 邻接的**运行时数据文件读取**（与 src/services/llm-credential-store.ts 自标的"L5 邻接文件 I/O"同型先例）。

**为何**：通知决策与工单状态机都在哨兵引擎内；契约是哨兵引擎的配置输入，不引入任何新层。

**边界约束**：
- 不新增跨层 import：loader 只依赖 `fs`/`path` + L0 配置（src/config.ts ）；状态表与既有 `sentinel_tickets`/`sentinel_notification_dedup` 同址同域（L5 存储由 src/sentinel/runner.ts 既有 `db` 句柄持有，不新建连接）。
- src/services/escalation-engine.ts 本就是 L2 编排层、被 L3 调用——本次**不改**它（§6）。
- 结构：loader = L5 邻接文件 I/O；决策函数 = L3 纯函数；读接口 = L3 服务方法（Win 路由从 L1 经 L2 调用）。

## 10. Completion Standard（DS 与本 doc 一一对应，禁重编号/跳号/静默缺项——S-10）

| # | 完成标准（可证伪） | 验证命令 | 归属 |
|---|---|---|---|
| DS1 | 契约 schema 落文档且六字段齐（阈值/渠道/节奏/格式/升级规则/责任人） | `grep -cE "阈值\|渠道\|节奏\|格式\|升级规则\|责任人" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D716-D1-monitoring-contract-20260913.md` ≥ 6 | dev-doc（本 doc） |
| DS2 | loader 存在且被生产调用（非测试） | `grep -rn "loadMonitoringContract" src/sentinel/ --include=*.ts` ≥ 1 | Mac 编码 |
| DS3 | 无契约文件 → 全默认且 `degraded=false`（T1 绿） | `npx vitest run tests/sentinel/monitoring-contract.test.ts` | Mac 编码 |
| DS4 | 非法契约 → 显式 degraded（组织不匹配整文件忽略；字段级丢弃并列出）（T3/T4/T5 绿） | 同上 | Mac 编码 |
| DS5 | 六态映射逐条成立（T16 八断言绿）——含"已认领不重复推""变化才推" | `npx vitest run tests/sentinel/notification-policy.test.ts` | Mac 编码 |
| DS6 | 契约阈值优先于 memStore/manifest，且无契约时旧链零回归（T8 绿 + 既有阈值用例全绿） | `npx vitest run tests/sentinel/` | Mac 编码 |
| DS7 | 24h 未回应提醒**一次**（幂等）+ 7 天停滞进首页队列（幂等）（T14/T15 绿） | `npx vitest run tests/sentinel/notification-policy.test.ts` | Mac 编码 |
| DS8 | 升级队列读接口存在且被消费：Mac 侧 ≥1 生产调用；Win 侧端点/周报呈现由 Win 任务自证（跨线依赖在 PR 描述显式声明） | `grep -rn "listEscalationQueue" src/ --include=*.ts` ≥ 1 | Mac 编码（Win 消费另计） |
| DS9 | 派发点接线真实传递：契约 `channels` 改变派发目标（T7 绿），且状态表写失败不阻断派发（T11 绿） | `npx vitest run tests/sentinel/notification-wiring.test.ts` | Mac 编码 |
| DS10 | evidence 落盘（原始输出 + 计时）+ `npx vitest run` 全量零失败 + pre-commit 全过（禁 `--no-verify`）+ 提交走 `git synova-commit` | `git log --oneline -1`；evidence 目录文件存在 | Mac 编码 |
| DS11 | 8-6 证据绑定与状态推进（`test:`/场景绑定 + `pending_k3`），由产品线维护者执行；K3 复核后转 verified | `git show origin/main:docs/synova/product-lines/product-lines.yaml \| grep -A 3 '"8-6"'` | CTO/产品线（非本 doc 写集） |
| DS12 | 缺陷登记：§4.2-C（升级链双重死）与 §4.2-E（周报三降级口）进 CTO 台账 | 台账文件含对应 file:line | CTO |

**Done 判定（入口 → 交互 → 结果，本 spec 的垂直切片）**：入口＝写一份契约文件（或 Win 交互写入）；交互＝下一次通知决策读取契约与工单状态；结果＝行为按 §5.2-H 表改变且测试/evidence 可重跑复现。

## 11. Auth Doc References

| 引用 | 路径 | 用途 |
|---|---|---|
| 创始人 D-1 裁定（状态驱动通知模型） | docs/synova/product-lines/DECISION-D1-状态驱动通知模型-20260912.md | 产品语义唯一来源（六态、政策值、落地路径） |
| 跨线同步（Mac ⇄ Win） | docs/synova/coordination/跨线同步-D1状态驱动通知模型-Mac-Win-20260912.md | 归属与接口边界（§三 Mac 对外三项、§四 写集硬约束） |
| 派单（本批次） | docs/synova/coordination/派单-下一批四线并行-20260913.md | §D716 交付要求 |
| 验收点台账 | docs/synova/product-lines/product-lines.yaml | 线 8 `done_definition` + 8-6 原文与状态 |
| 阈值解析单点（D577） | src/sentinel/sentinel-loader.ts | `resolveThresholds` 既有契约（本 doc §5.2-G 扩展点） |
| 工单状态机与通知链（D580/D6/D17） | src/sentinel/runner.ts | 现状实证（§4 全部 file:line） |
| 事件流（I1/I2/I3） | src/sentinel/sentinel-events.ts | event_type CHECK 约束事实（§5.4 决策 5 依据） |
| 渠道注册表 | src/notifications/registry.ts | `listNotificationChannels()` 渠道合法性校验 |
| 周报与一页纸渲染器 | src/agent/boss-mailbox.ts 、src/agent/report-assembler.ts | Win 消费面（本 doc 不实现） |
| 数据目录与配置 | src/config.ts 、src/deploy/data-directory.ts 、electron/main.cjs | 契约文件位置决策依据（§4.3） |
| 铁律 | AGENTS.md、CLAUDE.md | 0-2/4/5/11/24/31/38/39/47/48 |
| 派单模板与决策框架 | docs/synova/coordination/DECISION-REFERENCE.md | S-12 决策参考四步 |

## 12. 交付声明（声称 ↔ 证据对照表）

| 声称 | 证据命令 | 预期 |
|---|---|---|
| 契约文件此前不存在（本 doc 首次定义） | `grep -rn "monitoring-contract" src/ --include=*.ts \| wc -l` | 0 |
| 通知决策现状只查 sentinelId + 时间戳 | `grep -n "last_sent_ms" src/sentinel/runner.ts ` | 命中 L1313 段 |
| 阈值解析单点有生产调用方 | `grep -rn "resolveThresholds" src/sentinel/ \| grep -v test` | ≥2 命中（runner.ts / sentinel-loader.ts） |
| 升级链引擎构造时零 rules（双重死） | `grep -n "new EscalationEngine()" src/sentinel/runner.ts ` | 命中 L212（无参） |
| 周报触发在 Win 域且依赖 webhook | `grep -n "FEISHU_WEBHOOK_URL" src/server.ts ` | 命中 L176 附近 |
| 数据目录两路不一致（契约路径决策依据） | `ls "$HOME/Library/Application Support/Synova/data"` | 只有 `_snapshots`，无 synova.db |

## 13. 自检清单

- [x] 北星 front-matter 六键齐（用户/场景/终态/对齐节/完成标准/当前进度）
- [x] 11 节齐（§1 Authority / §2 Problem / §3 Q0-Q4 / §4 Current State / §5 What We Build / §6 What We Don't Do / §7 Test Requirements / §8 Wiring Verification / §9 Architecture Layer / §10 Completion Standard / §11 Auth Doc References）
- [x] 声称即引用：§4 每条带 file:line；§1 引权威原文
- [x] 写集表 D381 格式（`### 5.1 写集 (4 修改 + 3 新建)`，标题下一行即表头）；新文件目录级声明（C2 假阳规避，D580/D590/D593 先例）
- [x] DS 一一对应、可证伪（每条带命令）；无跳号
- [x] §6 不做清单含文件路径与归属；跨线边界到文件级（§5.5）
- [x] 决策参考 §5.4（S-12，九决策点 + 收敛检查）
- [x] 铁律核对：契约优先（§5.2 契约正文）、测试三路径（§7 L1/L2a/L2b/L2c）、降级诚实（§5.2-C degraded 语义）、零 `as any`、不改 `scripts/audit/`、不写实现代码（dev-doc 只出 spec）
- [x] 反 overclaim：§5.2-H 给出"行为等价性声明"与四条显式差异，禁止把顺手改动包装成等价
