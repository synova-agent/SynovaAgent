# DEV DOC · CompanyOS Ticket 0——最小多 Agent 协作闭环

> **版本**：**v1.8**（v1.7 ＋ 第八次复审：step5 三态守卫修正／判别力表按实测重写／schemas 七份口径）  
> **日期**：2026-11-04（v1.8 修订 2026-11-05 03:40）  
> **任务**：#1327  
> **Issue**：`synova-agent/SynovaAgent#1327`  
> **状态**：**T0.1 部分完成；关卡 A 已八轮（初审＋复验＋六次收缩复审），v1.8 已按第八次复审再修；待第九次复审；未通过不得写实现**  
> **本版修订**：见 §0.2（K1–K12）、§0.2b（N1–N4）、§5.8（S1 变更落地：不新增 profile，角色走 Context Pack）
> **模块**：CompanyOS 自用先行·最小协作控制面  
> **目标施工仓**：`win-push/company-os-practice`（Gitea 私有仓，默认分支 `main`）  
> **本文存放**：Synova 协调目录，仅作为方案与施工契约，不要求把 CompanyOS 代码写进 Synova 产品仓  
> **角色边界**：3 个核心角色＝DSH CTO／DSH coding／DSH K3；2 个辅助角色＝Kimi／WorkBuddy  
> **上游方案**：`CompanyOS-自用先行与多Agent协同架构-v1.0-2026-11-04.md`  
> **T0.1 证据**：`docs/synova/coordination/T0.1-探针证据-CompanyOS-20261104.md`（**部分完成，未覆盖项不得冒充通过**）  
> **基线 SHA**：`48580c5da6a9c699d93e63f5f78e46f17b536b70`

---

## §0 归属与依据

### 0.1 这段话属于谁、依据什么

- **归属**：CompanyOS 自用先行线（跨域模块）。**不映射 Synova 产品线的"线 N · 点 N"**——`pre-dispatch-check` ⑩ 对该格式的检查对本件不适用（本件不是 Synova 产品主线卡），此处显式声明以免被误判为缺字段。
- **目的声明**：消除创始人在「CTO → coding → K3」之间的手工消息路由，让人只保留产品方向与高后果决策。
- **依据顺序**：① 创始人 2026-11-04 裁定（§8.2 S1–S9）＞ ② 本件已批准契约 ＞ ③ T0.1 实测（证据册）＞ ④ 上游方案（**仅方案来源**）＞ ⑤ 历史材料。
- **事实源锚**：目标仓 `48580c5d`（迁移后回填新 SHA）｜DSH `0.2.1-alpha.2`｜Gitea `1.27.3`｜本机 Windows `192.168.1.5`。

### 0.2 初审 K1–K12 → 本版落点（供复核者逐项对号）

| 阻塞 | 落点 |
|---|---|
| K1 预设/停止无路径 | §2.5、§5.8（ACP 方法映射＋**Context Pack 承载角色**）、§3.2、T0.3 |
| K2 飞书通道归属错 | §2.5、§3.1、§5.10、T0.4（Hub 直连 OpenAPI，非 DSH Connector） |
| K3 Kimi 无物证 | §3.3、T0.5、§7.2 A9（本地 CLI＋Hub 只读） |
| K4 WorkBuddy 无物证 | §3.4、§5.11、T0.6、§7.5（辅助线不阻塞） |
| K5 权威出处缺失 | §8.2（S1–S9 为唯一裁定源）、§8.2 末段（其余"已裁定"降级）、§2.4 |
| K6 逐条映射未做 | **§0.3 窄映射**（按 S7 只映本模块面） |
| K7 验收不可执行 | **§7.2 四列改写（触发/观测/期望来源/失败判据）＋新增 A13/A14**、§5.10 字数口径 |
| K8 目标仓无门禁 | 开工硬停点 5、T0.2 首段、**§7.5 第 3 条改为脚本可判** |
| K9 权限执行点缺失 | **§5.13 执行点与时序**、**§7.3 B16** |
| K10 工具体系未定 | **§7.1（Node/npm/测试运行器/Schema 校验器，逐项实测）** |
| K11 可追溯锚缺失 | 头部（#1327／基线 SHA／证据册）、§7.1、**§9 一致性自检**、登记项 `DOC-1327-01` |
| K12 T0.1 未完成且含错 | 证据册 §0 状态行与 §1.2 勘误；本件 §2.5／§2.6 分列"已验证/未核实" |

### 0.2b 复审新增 N1–N4 → 本版落点

| 复审发现 | 改法 | 落点 |
|---|---|---|
| **N1** A3 判据把正确行为判成失败（"epoch 未变"被当失败） | A3 失败判据改为"**epoch 发生变化**"；epoch 递增的正例归 A8；并把"epoch 只在交接时递增"写进状态机 | §7.2 A3、§5.15 |
| **N2** Ticket／Assignment 状态机未定义 | 新增两个状态枚举 ＋ 迁移表 ＋ 触发者 ＋ 非法迁移 409 | **§5.15** |
| **N3** Kimi"只读"与"Report 回流"矛盾 | 新增 `kimi-report` 域 token（只放行 `POST /v1/reports`），Hub 代写评论 | §3.3、§7.1 token 表 |
| **N4** S6 迁移范围未清单化 | 新增完整迁移清单（**7 个内容目录 38 件迁出；根件 README/MANIFEST/.gitignore 不迁**）+ 执行与核验命令 | **§4.4** |

### 0.3 Ticket 0 窄映射（按 S7：只映本模块要用的面，不读全 41 件）

| Ticket 0 面 | 权威出处 | 状态 |
|---|---|---|
| 分层与产品边界（DSH／CompanyOS／Synova） | `01-体系与设计/体系-分层与产品边界-DSH-CompanyOS-Synova.md`:§2、§4 责任矩阵 | 一致（本件 §1.4 同） |
| **AgentRuntime 接口**（CompanyOS → DSH） | 同件 §5.1 | 需对齐：本件 §5.8 沿用其语义，**传输取 ACP**（该件写于探针前，未指定传输） |
| TruthProvider 接口 | 同件 §5.2 | 本模块不实现（Ticket 0 不接 Synova 真值层） |
| 事件信封（v0 八字段 → v1） | `00-最终方案/…v1.4.md`:§4.2；`01-体系与设计/体系-公司级Agent架构与迁移.md`:§5.2 | 需对齐：§5.5 Report 与 §5.9 幂等键沿用其字段语义 |
| 仓库布局（company-os） | `01-体系与设计/体系-公司级Agent架构与迁移.md`:§6.1 | 🔴 **真冲突**：该节把 company-os 定位为"方案仓库"，本件 §4.1 要放 `src/**`；**已由 S6 解决**（客户材料迁研究仓，该仓转代码仓，其 README 章程在首个客户材料迁移 PR 内重写） |
| 四层（L0 接口→L1 内容→L2 编排→L3 真值） | `00-最终方案/…v1.4.md`:§2.2、§2.6 | 一致（本件对应 L1/L2） |
| 三个工作流 Agent（数据/会议/方案管家） | `01-体系与设计/体系-公司级Agent架构与迁移.md`:§7 | 本模块不实现（业务 Agent，不在 Ticket 0） |
| 数据边界（PII 不出内网；禁 `danger-full-access`） | 目标仓 `README.md`:「v1.4 关键结论·数据边界」 | 边界声明：自用阶段本机为 `danger-full-access`（现行运行态）；**客户部署与影子验收一律禁用** |

窄映射结论：**1 处真冲突（S6 已决）＋ 1 处需对齐（传输取 ACP）＋ 1 处边界声明**，无遗留未裁冲突。

### 0.4 权威件回执（本版写作与修订实际读过的权威/契约件，按类列明）

| 类别 | 读了什么 | 用于本版哪一段 |
|---|---|---|
| **创始人裁定** | 2026-11-04 会话对 S1–S9 的逐条答复（正文本件 §8.2） | 全文；改法取舍 |
| **本仓规则／指引** | `AGENTS.md`（V7.3：任务唯一编号=Issue、§15 关卡 A）、`docs/AGENTS.md`（文档分层与登记）、`.dsh/skills/devdoc-gate-a/SKILL.md`、`.dsh/skills/dev-doc-spec/SKILL.md` | §0 归属、§7 验收、§9 一致性、复验请求 |
| **实测证据册** | `docs/synova/coordination/T0.1-探针证据-CompanyOS-20261104.md`（含 §11 两轮独立核验回写） | §2.5／§2.6／§5.8／§7.1 全部实测值 |
| **目标仓契约件** | `README.md`（效力顺序、数据边界）、`MANIFEST.md`（38 件文档声明）、`01-体系与设计/体系-分层与产品边界-DSH-CompanyOS-Synova.md`:§2/§4/§5.1、`01-体系与设计/体系-公司级Agent架构与迁移.md`:§5.2/§6.1/§7、`00-最终方案/…v1.4.md`:§2.2/§2.5/§2.6/§4.2 | §0.3 窄映射、§1.4、§5.5、§5.9、§4.3 边界 |
| **DSH 运行态源码（只读）** | `dsh-app-boot` 的 `lib/index.js` 第 537–544 行（出厂 profile 模板）；`dsh-acp` 的 `lib/index.js` 第 554–586 行（块级 update）、第 1198–1202 行（sessionCapabilities）、第 1259 行（sameDirectory）——四者均在 `<DSH 安装目录>/node_modules/@deepseek-ai/` 下，实读记录见证据册 §11.4 | §5.8、§2.5、§7.2 A3/A14 |
| **上游方案（仅方案来源）** | `CompanyOS-自用先行与多Agent协同架构-v1.0-2026-11-04.md`（文件内 v1.4） | §2.4、§8.2 末段（已降级） |

> 未读／未采信的：`agents/P4-门禁/AGENTS.md` 的 2026-10-18 流程（只登记为时代差，不作判据）；目标仓 38 件文档的正文（按 S7 只读上表所列章节）。

---

## 开工硬停点

以下任一未满足，**只允许补资料、执行已批准的配置动作或做合成探针，不允许写业务实现代码**：

1. 本 DEV DOC 尚未由原关卡 A 复核者复验初审阻塞项；不得换作者自审，也不重开多角色流程；
2. 角色 Context Pack 模板（`role_template` v1 ＋ sha256）尚未建好并版本化（由 **T0.3** 承接产出），或有人试图以「新建角色 profile」代替它；**统一用出厂 `acp` profile，不新增任何 profile**，不得删除旧 profile 或修改 Electron 独占的 `desktop`。
   · 🔴 **本项不阻断 T0.2**：T0.2 只建工程骨架／六份 Schema／SQLite／HTTP 骨架，**既不生成也不消费 Context Pack**；「永不可解除」的循环前置（T0.2 等 T0.3、T0.3 等 T0.2）由此消除——T0.2 只受硬停点 5（门禁）与 4（材料迁出）约束；
3. 飞书 Synova 机器人尚无发送对象；等待创始人完成一次会话绑定并提供 `chat_id`；
4. 客户实践材料仍与拟建代码同仓；须先按 S6 移入研究仓的哇呢宝贝客户目录，复制核验后再移除原文件；
5. 目标仓尚无 main 分支保护和最小 CI；须在 T0.2 前按 S5 建好，禁止直推；
6. 凭证、发送对象、Gitea 仓库范围和本地 Attention 访问方式未完成最小授权；
7. 需要扩大本文写集、改变产品边界、开放自动合并、部署、付费或敏感数据权限。

WorkBuddy 是独立辅助线，其实测缺口**不阻塞 T0.2–T0.5 研发主闭环**，但未通过自身验收前不得宣称辅助巡检已上线。

---

## §1 模块锚

### 1.1 服务的真实用户动作

创始人创建一个符合要求的 Gitea Issue 后，不再需要：

- 把 CTO 的 DEV DOC 手工转发给 coding；
- 把 coding 回执手工转回 CTO；
- 把问题手工转给 K3；
- 为询问独立意见而在多个工具之间复制材料；
- 守在电脑前等待完成、阻塞或审批消息。

创始人可以：

1. 在飞书接收研发任务的完成汇报和必要审批；
2. 直接联系 Kimi，让 Kimi 主动读取限定任务并提供独立意见；
3. 直接联系 WorkBuddy，并在 WorkBuddy 内管理夜间定时巡检；
4. 只处理产品方向和高后果决策，不承担消息路由。

### 1.2 本模块完成后用户能够做什么

- 一个指定 Gitea 仓库的合规 Issue 能自动生成 Ticket、Mandate 和 Assignment；
- Hub 能选择 DSH CTO／coding／K3 预设并创建或恢复对应会话；
- coding 一个任务一个干净会话，CTO 一个模块一个会话并可交接；
- Worker、CTO、K3 通过结构化 Report 流转，无需创始人复制粘贴；
- 每个 Ticket 最终完成时，创始人收到一次 100±20 个汉字 IM 汇报，证据链接另列；
- 等待输入、阻塞或高风险动作产生可防伪、防重放的审批；
- CTO 会话失效或交接后，新会话可凭 Context Pack 与证据引用接回；
- 创始人直接联系 Kimi 后，Kimi 可主动介入限定任务，全程不经过 DSH；
- WorkBuddy 辅助线按 23:00–08:00、混元 3 的配置目标做固定只读巡检，直接通知创始人，全程不经过 DSH。

### 1.3 与首个客户闭环及长期 CompanyOS 的关系

先在 Synova 真实研发中验证任务、权限、上下文、恢复、通知和审计。验证后的通用控制面再承载 Synova 业务能力和哇呢宝贝行业内容；客户侧从观测、建议、人工决策和结果回验开始，不继承内部研发写权限。

### 1.4 长期产品边界

- CompanyOS 是协作控制面，不重建 DSH 通用 Agent 运行时；
- Gitea／Git 是任务记录与代码真相，Hub 只保存运行状态和投影；
- Agent Session 是执行缓存，不是权限或任务真相源；
- 统一任务、权限和审计，不统一 Agent 的联系人入口；
- 提示词负责引导，程序负责约束，证据负责验收；
- 不用预设数量、文档数量、门禁数量或 Agent 数量证明价值。

### 1.5 明确不做

- 不自动合并，不直推 main，不建设自动部署；
- 不接 Codex 自动执行；
- 不让 CTO 成为所有消息的语义中转；
- 不让 Kimi 进入自主派工链，不让 WorkBuddy 自动修复；
- 不做多租户、多客户、多 IM 平台、群聊全量监听；
- 不把飞书聊天或模型摘要当唯一审计记录；
- 不顺手重写全部 DSH 预设、Skill、AGENTS.md 或门禁体系；
- 不修改 Synova 业务代码、`scripts/audit/**` 或 G0–G2 判据；
- 不在 Ticket 0 建设计费、完整企业管理后台或公网部署。

---

## §2 现状证据与可复用资产

### 2.1 已核实的当前协作问题

来自创始人对当前真实流程的描述：CTO 写 DEV DOC 后，需要创始人转发给开发会话；回执再转 CTO；问题再转开发；部分任务还需转 K3；最后常由 CTO 合并。创始人真正能贡献的是产品决策，却被迫承担消息转发和流程看守。

这是本模块要消除的用户动作，不需要再用代码数量证明。

### 2.2 已读取的 Synova 规则资产

本方案已实际读取：

- `docs/synova/presets/synova-cto/persona-block.yml`：CTO 一个会话一个模块，产品方向归创始人，技术决策自决；
- `docs/synova/presets/synova-cto/persona-block.yml`、`docs/synova/presets/synova-k3-audit/preset.yml`、`docs/synova/presets/synova-coding/preset.yml`：模块 CTO／K3／coding 的定位来源（三者在 PR 基枝 `main` 上均存在；S1 变更后角色不再依赖预设，但人格文本仍是 `role_template` 的**内容来源**）；
- `docs/synova/presets/synova-k3-audit/preset.yml`：K3 独立审计定位；
- `.dsh/skills/cto-handover/SKILL.md`：新会话或压缩后重读权威源，不把摘要当完整事实源；
- `.dsh/skills/dev-doc-spec/SKILL.md`：零上下文可执行、真实入口、失败路径与验收；
- `.dsh/skills/devdoc-gate-a/SKILL.md`：新模块／高风险交付 coding 前一次独立复核。

直接复用上述角色与交付纪律，不另造人格体系。

### 2.3 已发现的规则冲突

- `agents/P4-门禁/AGENTS.md` 仍含 2026-10-18 的九问和创始人手动开 squad-lead 会话流程；现行 `dev-doc-spec` v4 已删除这些默认强制；
- K3 仓内人格仍含 D 号、G1–G6、旧状态文件等历史引用；
- P1–P10 是职责守则集合，不等于十个常驻 Agent。

Ticket 0 只保证新系统引用当前有效版本，不顺手完成历史清理。冲突影响本模块时按“创始人最新裁定＞当前已确认方案＞历史材料”处理。

### 2.4 可复用的外部设计

- Super-agent：`Trigger / Thread / Ticket / Mandate / Policy / Report / Attention`、原会话恢复、独立工作目录、外部消息不扩权；
- Agent-Autoloop：确定性内核、事件幂等、Outbox、结构化回执、原会话修复、挂起零消耗、指令数据分离、跳数熔断；
- 两者均不能未经验证就视为 Gitea＋Windows＋多 Agent 的现成生产实现。

### 2.5 T0.1 已实测事实

证据原件见 T0.1 证据册；本节只保留会改变实现的结论：

- 目标仓基线为 `48580c5d…`，当前只有方案／实践材料，无代码、包管理器、测试、CI、labels 或分支保护；§4.1 拟写集全部为新建；
- DSH 为 `0.2.1-alpha.2`；headless 可启动／恢复但无 stop／status／preset；desktop 由 Electron 独占；
- **ACP 已实测支持 `session/new / prompt / close / list / resume` 和跨进程记忆**；resume 必须带同一物理 cwd，close 只释放活动句柄；
- ACP `agent_message_chunk` 是回合消息的块级事件，不是 token 流；Hub 以 `stopReason` 判回合结束；
- **ACP 面不消费 agent-preset**（`dsh-acp` 源码 0 处引用 `preset`；模块 CTO／主 CTO／profile 级 persona 三组实测均无效）⇒ **角色改由 Hub 版本化的 Context Pack 承载，不新增任何 profile**（S1 已批准此变更，2026-11-05）；
- DSH 侧不存在飞书 Connector；飞书 App／机器人和 tenant token 已验证，但机器人尚无聊天对象；因此由 **Hub 直接接飞书 OpenAPI**，不再虚构 DSH Connector；
- Kimi Code CLI `0.34.0` 支持非交互与会话，但无飞书集成物证；首版采用本地 Kimi CLI＋Hub 只读 HTTP；
- Gitea `1.27.3` API 可操作并支持 scoped token；Webhook 到 Windows 的真实投递未证实，首版先用轮询；
- WorkBuddy 有自有自动化实物，但混元 3、可控窗口、直接 IM、Gitea 评论均未核实；两条既有邮件通道当前不可用。

### 2.6 仍未核实的事实

- 角色 Context Pack 模板（`role_template`）的版本化与 hash 计算方式，以及 Hub 侧「Assignment／Mandate／Pack 三者 role 一致」校验的落点；
- ACP close 对正在执行的 prompt 的副作用；
- 飞书发送、回调、卡片、消息更新和失败确认；
- Gitea 真实 Issue／评论写操作及真实事件投递；
- WorkBuddy 的模型、调度窗口、直接 IM 与 Gitea 权限；
- 新仓最小 CI 的实际命令须由 T0.2 首批提交建立。

**未核实项不得由 coding 猜测为已支持。**

---

## §3 目标行为

### 3.1 研发 Ticket 主闭环

```text
合规 Gitea Issue
  ↓ Hub 定时轮询，事件幂等（Webhook 仅作实测后的增强）
Hub 创建 Ticket＋Mandate
  ↓ Session Router
DSH CTO 模块会话／coding 单任务会话（ACP）
  ↓ 结构化 Report
CTO 验收；按风险派 K3 独立复核
  ↓ Ticket 进入 done（Ticket 0 不自动合并）
Hub → 飞书 OpenAPI：100±20 个汉字完成汇报；证据链接另列
```

- 相同来源事件重复投递不得产生第二个 Ticket／Assignment；
- 新补充指令优先恢复原 Assignment 和 SessionRef；
- `ready` 只代表请求验收，不等于完成；
- Ticket 0 的 PR 仍由 CTO 按现有规则手动合并。

### 3.2 CTO 上下文与交接

- CTO 一个会话一个模块；coding 一个任务一个会话；K3 一个复核一个独立会话；
- 每次调用前按角色生成 Context Pack，不注入全部历史聊天；
- 交接由旧 CTO Checkpoint＋Hub 程序事实＋新 CTO Handoff Ack 构成；
- 交接成功后递增 `session_epoch`，旧会话只能归档读取，不能继续派工或作技术决定；
- 权威文件、Mandate、Policy、PR head SHA 变化后必须重建 Context Pack，旧记忆不得覆盖新事实。

### 3.3 Kimi 独立顾问通道

```text
创始人 ↔ Kimi 当前直接对话
              │
              ├─ 直接讨论，不关联 Ticket：直接回答
              │
              └─ 关联 Ticket：本地 Kimi CLI 通过 Hub 只读 HTTP 取得 Context Pack
                              ↓
                         独立分析并在当前对话直接回复
                              ↓
                         Report 回流 Gitea／Hub
```

- 首版使用本地 Kimi Code CLI＋Hub 只读 HTTP，不以“Kimi 自有飞书”为前提；未来如接入独立 IM，仍沿用同一任务契约；
- DSH 不参与联系、通知、转述或召唤；
- Kimi 默认只读，不写代码、不合并、不部署、不对外发送任务外内容；
- Kimi 结论是独立意见，不自动覆盖 CTO 技术决定或创始人产品决定；
- 没有可调接口时必须明确报“未接通”，不得伪称已介入。
- 🔴 **Report 回流路径（N3：原"只读"与"回流"互相矛盾，此处定死）**：Kimi 侧由 `scripts/kimi/report.mjs`（新建，**T0.5 交付**） 包装脚本提交，凭证为 **`kimi-report` 域 token**，**只能**调 Hub 的 `POST /v1/reports`（Hub 侧只对该 token 放行这一条路由），**不给 Gitea 任何写权限**；Hub 收到后按 **§5.13b 顾问报告分支**校验（**不套**执行链的 Assignment/Lease/epoch 五步），再以 `hub` 身份把结论写成 Issue 评论（**不得**让创始人手工转贴，否则重回手工路由）。

### 3.4 WorkBuddy 独立巡检通道

WorkBuddy 是独立辅助验收线，不阻塞 T0.2–T0.5 研发主闭环；以下模型、窗口与通知方式是配置目标，逐项实测前不得宣称已上线。

- 创始人在 WorkBuddy 内直接创建、修改和停用定时任务，并可直接与其对话；
- 运行窗口目标为 **23:00–08:00**，模型目标为混元 3；只运行固定批次，不整夜持续执行；
- 程序／命令先采集事实，模型只做固定模板检查和语义摘要；
- 每次巡检完成后，WorkBuddy **直接**向创始人发 100±20 个汉字 IM：检查对象、结果、异常数及证据位置；无异常也发短结果；
- 异常关联具体 Ticket 时，在原 Gitea Issue／PR 留证据评论；系统性异常提交 Hub Attention；
- 仅当邮件通道已配置且验证可用、同时 IM 发送失败时，才使用邮件降级；否则明确报告降级不可用，不对每次任务重复发邮件；
- WorkBuddy 可获得 Gitea 读取与评论的最小权限，但不得写代码、改判据、自动修复或合并。

### 3.5 强制完成汇报与问题审批

每个 Ticket 最终 `done` 时只发一次 100±20 个汉字汇报，包含任务、结果、真实验证、遗留风险／下一步；证据链接另列，不计入汇报字数。Worker、K3、CTO 的中间回执不分别冒充最终完成。

进入 `waiting_input / blocked`，或触及产品方向、对外发布、部署、付费、Secrets、敏感数据及其他高风险动作时，必须发送 IM 审批／接管卡片。普通可自修技术错误不滥发创始人。

### 3.6 失败与降级

| 故障 | 必须表现 | 禁止 |
|---|---|---|
| IM 不可用 | 本地 Attention 可用；Outbox 退避重试；WorkBuddy 仅在邮件已配置且验证可用时降级，否则明确降级不可用 | 把已入队当已送达 |
| Agent 进程退出 | Lease 到期，进入 reconcile | 立即在新会话重放全部副作用 |
| SessionRef 失效 | 从权威状态重建 Context Pack，再开新会话 | 把旧摘要当完整事实 |
| 回执非法 | 原会话修复一次；仍失败进入 Attention | 推进 Ticket 或合并 |
| 外部消息重复 | 返回首次处理结果 | 重复派工、重复审批动作 |
| 检查对象为零 | 明确 `no_objects / unavailable` | 报告“全部正常” |
| WorkBuddy 无法判定 | 输出 `无法判定`＋缺失输入 | 为显得完成而猜结论 |

---

## §4 范围与边界

### 4.1 目标仓拟写集

T0.1 已确认目标仓当前只有文档，以下代码、工程与测试路径**全部为新建**。T0.2 首批提交先建立 Node `24.16.0`＋npm 工程、lockfile、最小 CI 和 main 分支保护；pnpm 实测 corepack 挂起，不作为首版前提。

> 🔴 **口径说明（防误判）**：本节路径**相对目标仓根**（`company-os-practice`），不是 Synova 仓。在 `synova-agent` 里跑 `pre-dispatch-check.sh` 时，④ 会把 `src/**` 那 9 条报成「不存在」（`scripts/**`／`tests/**` 因本仓同名而报 ✅，`schemas/**`／`config/**` 等不在 ④ 的路径白名单内）——**这是跨仓的预期结果，不是遗漏**；逐条核验请用：
> `git -C <company-os-practice 克隆> ls-tree -r --name-only 48580c5d | grep -E '^(src/|schemas/|config/|tests/|scripts/)'` → 当前 **0 命中**（即 §4.1 的 13 条运行时代码路径全为新建；另 4 项工程文件同样新建）。

```text
package.json                # 固定 typecheck/build/test/dev 脚本
package-lock.json           # 首次 npm install 生成；后续 CI 使用 npm ci
tsconfig.json               # TypeScript 类型检查与构建配置
.gitea/workflows/**         # 仅新仓最小 CI，不修改 Synova 权威门禁
src/core/**                 # Ticket、Assignment、Lease、Report、Attention、事件投影
src/context/**              # Context Pack、Checkpoint、Handoff Ack
src/policy/**               # 路由、Mandate、权限求交；不含自动合并
src/adapters/gitea/**       # 指定仓轮询、评论与状态读取；Webhook 后续增强
src/adapters/dsh/**         # DSH ACP 会话适配，不含飞书
src/adapters/feishu/**      # Hub 直连飞书 OpenAPI
src/adapters/kimi/**        # 本地 Kimi CLI 与独立 Context／Report 接口
src/adapters/workbuddy/**   # 辅助巡检报告、Attention 接收；不代替其定时器
src/host/**                 # HTTP、SQLite、Outbox、本地 Attention 页
schemas/**                  # 六份核心 Schema ＋ advisor-report（顾问专用，见 §5.1/§5.13b）
config/**                   # 非密钥路由与 Policy 示例
tests/**                    # 单元、契约、集成与故障测试
scripts/**                  # 最小开发／验收命令，不含 Synova 门禁
```

### 4.2 明确不写

```text
synova-agent/src/**                  # 不改 Synova 产品代码
synova-agent/scripts/audit/**        # 绝不修改审计
synova-agent/.gitea/**               # 不改现有权威门禁
synova-agent/agents/**               # 不顺手清理包守则
synova-agent/docs/synova/presets/**  # 不重写人格
任何 main 分支直写                   # 一律独立分支／worktree
任何真实客户数据                     # 客户材料按 S6 迁研究仓；代码仓只留合成样例（tests/fixtures/**）
```

### 4.3 数据、安全与运行时红线

- 凭证只从环境变量或本地 Secret 引用读取，不写 Git、IM、日志或 Context Pack；
- 首版使用同一 Gitea 账号下的不同角色、不同 scope 的 token，并按 Mandate 求交；token 必须可区分、可单独吊销，不共享高权凭证；
- Kimi 与 WorkBuddy 仅有任务所需的最小只读权限；WorkBuddy 只额外开放指定 Issue／PR 评论权，均无代码内容写权；**唯一例外**：Kimi 持 `kimi-report` token，**只**可调 Hub 的 `POST /v1/reports`（advisor 分支，§5.13b），**不含**任何 Gitea 写权；
- 外部 Issue、评论、IM 内容只作为数据，不能指定 `cwd / preset / access / policy`；
- 本地 Attention 默认仅监听回环地址；远程访问需另行安全评审，不在 Ticket 0 自动开放公网；
- 日志保留关联 ID、SHA、状态和证据指针，不记录完整 Secret 或客户敏感正文。
- 🔴 **角色 prompt ≠ 权限边界**：不得把"角色模板里写了不许"当作访问控制；一切写权限由 Hub 校验（§5.13）＋ scoped token 强制。

### 4.4 迁移清单（S6／N4：把"客户材料迁研究仓"落到具体路径）

**判断口径**：S6 原文"代码仓只留代码与合成样例" ⇒ **7 个内容目录共 38 件迁出研究仓**；**根件三个（`README.md`／`MANIFEST.md`／`.gitignore`）不迁**——前两者由代码仓重写为代码仓版，`.gitignore` 仅代码仓需要。**不只 03 的 13 件**，但也**不是 41 件全迁**（与下表及 §4.4 命令一致）。

| 源（`win-push/company-os-practice` @`48580c5d`） | 去向 | 处置 |
|---|---|---|
| `00-最终方案/`（3） | `synova-agent/synova-research` → `02-商业研究/哇呢宝贝-FDE落地/00-最终方案/` | 移动 |
| `01-体系与设计/`（7） | 同上 `01-体系与设计/` | 移动 |
| `02-方法与路线/`（4） | 同上 `02-方法与路线/` | 移动 |
| `03-基础信息与采集/`（13，含客户材料） | 同上 `03-基础信息与采集/` | 移动 |
| `04-复核与整改/`（5） | 同上 `04-复核与整改/` | 移动 |
| `05-参考/`（1） | 同上 `05-参考/` | 移动 |
| `06-历史版/`（5） | 同上 `06-历史版/` | 移动 |
| `MANIFEST.md`、`README.md` | **不迁**（代码仓重写为代码仓版） | 代码仓原地重写 |
| `.gitignore` | **不迁** | 代码仓保留并重写 |

**执行与核验**（T0.0 前置，未完成不得开 T0.2）：
```bash
# 先把 <code-repo> 与 <synova-research 克隆> 换成绝对路径（不替换会直接 bash 语法错）
# 通过口径（唯一）：代码仓的 **7 个内容目录（38 件）** 逐件在研究仓同前缀都有副本且 sha256 相等。
# 根件（README.md／MANIFEST.md／.gitignore）**不迁移**：前两者由代码仓重写为代码仓版，
#   .gitignore 仅代码仓需要 —— 因此它们既不进复制集、也不进核验集（避免与"不迁移"自相矛盾）。
QR='-c core.quotepath=false'          # 必须：否则中文名被 C-quote
RESEARCH=<synova-research 克隆>
PREFIX='02-商业研究/哇呢宝贝-FDE落地'
DEST="$RESEARCH/$PREFIX"
SRC=48580c5d
DIRS='00-最终方案 01-体系与设计 02-方法与路线 03-基础信息与采集 04-复核与整改 05-参考 06-历史版'

# 1) 清单：只列 7 个目录（38 件）
git -C <code-repo> $QR ls-tree -r --name-only "$SRC" -- $DIRS | sort > /tmp/src.list
echo "src=$(wc -l < /tmp/src.list)"; [ "$(wc -l < /tmp/src.list)" -eq 38 ] || { echo "判不了：清单不是 38 件"; exit 2; }

# 2) 复制：只复制 7 个目录（不会碰研究仓既有的 README/MANIFEST）
mkdir -p "$DEST"
git -C <code-repo> -c core.quotepath=false archive "$SRC" $DIRS | tar -x -C "$DEST" || exit 1

# 3) 逐件核验（缺件/不等即红并点名）
miss=0; diff=0; ok=0
while IFS= read -r f; do
  if [ ! -f "$DEST/$f" ]; then echo "MISSING: $f"; miss=$((miss+1)); continue; fi
  a=$( git -C <code-repo> $QR show "$SRC:$f" | sha256sum | cut -d' ' -f1 )
  b=$( sha256sum "$DEST/$f" | cut -d' ' -f1 )
  if [ "$a" = "$b" ]; then ok=$((ok+1)); else echo "DIFF: $f"; diff=$((diff+1)); fi
done < /tmp/src.list
echo "files=$(wc -l < /tmp/src.list) ok=$ok diff=$diff missing=$miss"
[ "$diff" -eq 0 ] && [ "$miss" -eq 0 ] || { echo "核验未过：先出上述 DIFF/MISSING 清单，由 CTO 裁哪版权威"; exit 1; }
echo "SHA256-ALL-EQUAL"

# 4) 删代码仓原件（7 个目录 + 两个根件；.gitignore 保留）—— 必须绑定目标仓，任一步失败即红
git -C <code-repo> rev-parse --git-dir >/dev/null 2>&1 || { echo "判不了：<code-repo> 不是 git 仓库"; exit 2; }
git -C <code-repo> rm -r $DIRS || { echo "红：删除 7 目录失败"; exit 1; }
git -C <code-repo> rm -f MANIFEST.md README.md || { echo "红：删除根件失败"; exit 1; }

# 5) 验收：代码仓不得再有客户材料（绑定目标仓；无匹配与执行失败必须分开）
#    ⚠️ 不能用 `n=$(... | wc -l)` 再判 `||`：管道退出码是 wc 的（恒 0）⇒ 守卫永不可达。
#    git grep 语义：0=有匹配，1=无匹配，≥2=执行失败。据此三态。
set +e
out=$(git -C <code-repo> grep -lE '南宁|员工简表|人效地图|流程制度卡' -- ':!tests/fixtures' 2>/dev/null)
rc=$?
set -e
case "$rc" in
  0) n=$(printf '%s\n' "$out" | grep -c . || true)
     echo "红：仍有 $n 个文件含客户材料"; exit 1 ;;
  1) echo "step5 OK（0 命中）" ;;
  *) echo "判不了：git grep 执行失败（rc=$rc）"; exit 2 ;;
esac
```
- **`.gitignore`**：**不迁移、不复制、不核验**（代码仓保留）。上面 step 1/2/3 的清单都不含它。
- **`README.md`／`MANIFEST.md`**：**不迁移**；代码仓改为代码仓版。这样 step 2 不会覆盖研究仓自有的 `README.md`（实测过：整目录 archive 会覆盖它，65+/117-）。
- **权威裁定**：研究仓同前缀若已有同批副本 —— sha256 全等 ⇒ 以研究仓为准、只删代码仓原件；**不一致 ⇒ 先出 DIFF/MISSING 清单，由 CTO 裁哪版权威**，不得两边都留。**本件不写死差异件数**（会随研究仓状态漂移）。
- **布局**：研究仓按代码仓的 7 层目录落位；研究仓既有的平铺件归位属其自身治理，不在本卡写集内。

- 迁移后**必须回填本件头部的基线 SHA**
- §0.3 窄映射引用的 8 处文档路径，迁移后统一指向研究仓（T0.0 完成时同步更新本表）。

---

## §5 关键契约

### 5.1 六份核心 Schema（＋顾问报告专用 schema）

必须提供并用非法样本测试：

```text
schemas/agent-instance.schema.json
schemas/mandate.schema.json
schemas/assignment-lease.schema.json
schemas/worker-report.schema.json
schemas/context-pack.schema.json
schemas/session-checkpoint.schema.json
```

Schema 使用明确 `required`、字段类型、枚举和 `additionalProperties: false`；版本字段从 `v1` 开始。非法字段不得静默忽略。

> 第 7 份 `schemas/advisor-report.schema.json` 属**顾问专用**（字段口径见 §5.13b，不含 `role_template_*`），不计入上面六份执行链 Schema。

### 5.2 AgentInstance

```yaml
instance_id: acp-coding-01@win
kind: dsh-acp                 # 传输＝ACP；不写泛指的 "dsh"，避免与 headless CLI 混淆
host_id: win-main
role: worker                  # cto | worker | auditor | advisor | inspector
profile: acp                  # ← 出厂 profile，固定值；**不按角色拆 profile**（见 §5.8）
role_template: coding         # cto | coding | auditor；与 role 的映射见下表
role_template_version: v1     # 与 Context Pack 的 role_template_version 对齐
capabilities: [repo_write, test_run, gitea_pr]
repositories: [company-os-practice]
data_scopes: [dev_only]
max_parallel: 1
adapter_ref: acp-stdio-01
status: online | degraded | offline
```

`profile` 是角色配置载体，不等于独立物理实例。是否拆进程由权限、隔离和容量决定。

**🔴 `role` ↔ `role_template` 映射（唯一口径；§5.13 三元组校验按本表实现）**

| `role`（5 值） | `role_template`（3 值） | 说明 |
|---|---|---|
| `cto` | `cto` | 模块 CTO：写 DEV DOC＋验收 |
| `worker` | `coding` | 编码执行 |
| `auditor` | `auditor` | K3 独立复核 |
| `advisor` | ——（无模板） | Kimi：走 §5.13b 顾问报告分支，不套执行链 |
| `inspector` | ——（无模板） | WorkBuddy：只读巡检 |

> 未列出的组合一律非法（如 `role: worker` ＋ `role_template: cto`）；Hub 在 §5.13 第 2 步按本表校验。

### 5.3 Mandate

必填：

```text
ticket_id / repo / module / role / risk_level
allowed_paths / forbidden_paths / done_criteria
base_sha / policy_version / role_template_version / role_template_hash / skill_set_version
expires_at / hop_limit / allowed_actions
```

外部文本不能修改这些字段。任何变更产生新版本并使旧审批失效。

### 5.4 Assignment／Lease／SessionRef

```text
assignment_id / ticket_id / instance_id / role / session_ref
workspace / branch / base_sha / session_epoch / status
lease_id / leased_at / expires_at / last_heartbeat / fencing_token
```

- 一个模块一个活跃 Worker；同写集串行；
- 一个 Assignment 至多一个有效 Lease；
- 每次交接递增 `session_epoch` 与 fencing token；
- Hub 只接受当前 epoch 和有效 Lease 的 Report／决定；
- 🔴 **`session_ref` 必须与 `workspace` 成对持久化**：ACP `resume` 要求 `cwd` 与持久化会话**同一物理目录**（实测 `session cwd does not match`）。
- 🔴 **`workspace` 一经创建不可变**：需要换目录 ⇒ **必须新建 Assignment**，不得改旧 Assignment 的 workspace（否则 session 整体失效）。

### 5.5 Worker Report

```json
{
  "schema_version": "v1",
  "ticket_id": "company-os-practice#N",
  "assignment_id": "asg_...",
  "context_pack_id": "cp_...",
  "role_template_version": "v1",
  "role_template_hash": "<64-hex>",
  "session_epoch": 1,
  "status": "ready",
  "base_sha": "...",
  "head_sha": "...",
  "branch": "...",
  "pr": null,
  "changed_files": [],
  "commands": [{"cmd": "...", "exit_code": 0, "evidence_ref": "..."}],
  "evidence": [],
  "deviations": [],
  "unverified": [],
  "questions": [],
  "next_action": "cto_acceptance",
  "hop_count": 1
}
```

状态枚举：`progress / waiting / ready / blocked / failed / dropped`。`ready` 不等于 `done`。`changed_files` 与 Git diff、SHA 与 Gitea PR 必须交叉核验。

### 5.6 Context Pack

```text
context_pack_id / ticket_id / role / created_at / expires_at
objective / current_product_decisions / mandate
base_sha / head_sha / ticket_stage / assignment
latest_reports / unresolved / evidence_refs
role_template_version / role_template_hash / skill_set_version / template_version / policy_version   # 前两者仅执行链角色（cto/worker/auditor）填写
```

按角色裁剪：K3 不默认接收 Worker 自我解释；Kimi 只接收创始人当前咨询所需范围；WorkBuddy 只接收固定检查所需事实。Context Pack 不保存 Secret。

**🔴 角色契约（2026-11-05 创始人裁定，S1 变更配套）**：

- 角色 prompt（`role_template`）**只是行为约束，不是权限边界**。权限仍由 **Hub 服务端 ＋ Mandate ＋ scoped token ＋ 写集 ＋ Schema** 程序强制（§5.13）；prompt 里写"你只能做 X"不产生任何强制力。
- Context Pack **按角色决定是否带模板字段**（口径唯一）：
  · **执行链角色**（`cto`／`worker`／`auditor`）**必须**带 `role_template_version`（如 `v1`）＋ `role_template_hash`，二者随 Pack 入库、随 Report 回引；
  · **`advisor`／`inspector` 不带**这两个字段（无角色模板，见 §5.2 映射表与 §5.13b）；其 Pack 只带 `role`＋任务范围。
- **`role_template_hash` 口径（定死）**：对 `config/role-templates/<role>.md` 的**文件原始字节**做 `sha256`（含 front-matter，不做任何规范化、不 trim）。同一模板字节 ⇒ 同一 hash；模板任何改动 ⇒ 新 version ＋ 新 hash。
- **执行链角色的 Report 必须回引 `context_pack_id` ＋ `role_template_version` ＋ `role_template_hash`**；缺失即 §5.13 第 1 步 Schema 拒绝。`advisor` 的 Report 只回引 `context_pack_id`（见 §5.13b）。
- **禁止以"模型自称什么角色"作为验收证据**：A4/A9/T0.3 一律以 Hub 记录（pack id／hash／role 三元组）判定，模型口头声明无效。

### 5.7 Session Checkpoint／Handoff Ack

Checkpoint 必填：

```text
ticket_or_module / session_ref / session_epoch
confirmed_judgements / rejected_options / unverified_judgements
open_questions / suggested_next_step / evidence_refs
```

Hub 另行附上 Issue、Mandate、Git、PR、CI、Assignment 和 Attention 的程序事实。新 CTO 的 Handoff Ack 必填：目标、边界、当前状态、已确认事实、未验证判断、唯一未决问题。两者不一致则停。

### 5.8 DSH ACP Adapter

```text
start(mandate, workspace, context_pack) -> assignment, session_ref
resume(assignment, input, context_pack) -> report
stop(assignment) -> stopped | unknown
status(assignment) -> running | exited | unavailable
```

- 通过 ACP `session/new / prompt / close / list / resume` 实现，不采用缺少 preset 入口的 headless CLI；
- **角色不依赖 DSH 预设**（实测 ACP 面不消费 preset，见下）：CTO／coding／K3 的角色文本由 **Context Pack** 注入；旧 profile 与 Electron 独占的 `desktop` 一律不动；
- Hub 必须持久化 `sessionId ↔ 物理 cwd`；resume 必须携带同一物理 cwd，不能只凭逻辑项目名恢复；
- 以 `stopReason` 判定 prompt 回合结束；`agent_message_chunk` 只按块级消息处理，不承诺 token 流；
- `close` 只保证释放活动句柄，不得伪称已终止正在执行的 prompt；停止中的执行须报 `unknown` 并进入 reconcile。

**方法映射（T0.1 实测，证据册 §2.8）**：

| 适配器动作 | ACP 方法 | 关键参数 | 实测要点 |
|---|---|---|---|
| `start` | `session/new` | `cwd=workspace`，`mcpServers=[]` | 返回 `sessionId`（UUID）＋ `configOptions`（`model`／`reasoning_effort`） |
| `resume` | `session/resume` → `session/prompt` | **必须** `sessionId` ＋ `cwd` | 缺 `cwd` → `-32602`；`cwd` 非同一物理目录 → `session cwd does not match` |
| `stop` | `session/close` | `sessionId` | 返回 `{}`；**只释放活动句柄**，会话随后仍可 resume ⇒ **Lease 失效必须由 Hub 自己置位** |
| `status` | `session/list` | 可选 `cwd` 过滤 | 返回 `sessions[]`（`sessionId`／`cwd`）；不带过滤实测 92 条 |
| 回合判定 | `session/prompt` 的 `stopReason` | — | `end_turn` 即回合结束；**不得**用 `agent_message_chunk` 做流式进度 |

**🔴 角色承载：实测推翻 v1.1 的"三个角色 profile"做法（2026-11-05 00:00–00:55，见证据册 §12）**

先厘清**两个 CTO 预设**（此前本件未区分，是缺陷——创始人当场指出的）：

| bundle | preset id | 名称 | 定位 | 仓内源 |
|---|---|---|---|---|
| `@local/dsh-preset-synova-main-cto` | `synova-main-cto` | **Synova-主CTO** | 总 CTO（三级制）：只对线负责人说话；方向锚／跨线裁决／治理三件事／线级周对账；**不写 DEV DOC** | 无仓内源（bundle 在仓外，含 `PERSONA.md`） |
| `@local/dsh-preset-synova-cto` | `synova-cto` | 🧭 Synova CTO | **模块 CTO**：一个会话一个模块，建模块锚→核现状→写 DEV DOC→拆单任务定验收 | `docs/synova/presets/synova-cto/`（`persona-block.yml`） |

⇒ **Ticket 0 闭环里的 "DSH CTO" = 模块 CTO（`synova-cto`）**；主CTO 不进 ACP 自动调度（它是派单与终审侧，即当前这个会话）。

实测（**两个 CTO 预设都测过**，原始输出全留档）：

| 实验 | 做法 | 结果 |
|---|---|---|
| E1 | 三 profile（bundles = base + acp-app + 对应 preset），**CTO 用模块 CTO `synova-cto`** | `--dump-config` 合成成功（774/661/700 行）；entry 未激活：`pending (waiting for service: agentPresets)` |
| E2 | 补 `agent-preset-registry`（cordis `insert`）＋ `selectedDefault=<role>` | entry 激活、无告警；ACP 起会话拿 `sessionId`——**角色不变** |
| E3 | 绕过 preset，profile 层 `insert` `@deepseek-ai/dsh-persona` 打唯一标记 | **仍无效**（排除"预设加载顺序"解释） |
| **E4** | 换 **主CTO 预设 `synova-main-cto`**（dump 825 行、`maincto_hits=2`、无告警） | **仍答 "coding agent（编码智能体）"** ⇒ 与用哪个 CTO 预设无关 |

**行为对照（同一问题，五组）**：

```
synova-acp-cto（模块CTO）  → 编码代理（coding agent）
synova-acp-coding          → 编码智能体（coding agent）
synova-acp-k3              → 编码智能体（coding agent）
t01-maincto（主CTO）        → coding agent（编码智能体）
acp（无预设对照）           → 编码代理（coding agent）
```

源码佐证：`@deepseek-ai/dsh-acp/lib/index.js` **全文 0 处引用 `preset`** ⇒ **ACP 面根本不消费 agent-preset**，固定使用通用 coding agent。

⇒ **本件改为**：

- **传输**：单一个 `acp` 出厂 profile（`@deepseek-ai/dsh-base` ＋ `@deepseek-ai/dsh-acp-app`，无需第三方依赖，`--dump-config` 已实测可合成）；
- **角色**：**由 Hub 生成的第 1 条 prompt（Context Pack，§5.6）承载**——角色、边界、禁止事项、验收口径全部写进 Context Pack 的系统段；`session/new` 只负责建会话，`session/prompt` 投递角色上下文；
- **不再需要**三个角色 profile；**旧 profile 继续一律不动**；本件不新增任何 DSH profile；
- **判据（可复跑，最终版）**：
  1. `dsh --profile acp --dump-config > /dev/null` → RC=0；
  2. ACP `initialize` → `sessionCapabilities` 含 `close/list/resume`；
  3. `session/new {cwd, mcpServers:[]}` → 返回 UUID `sessionId`；
  4. `session/prompt`（首条＝Context Pack）→ `stopReason=end_turn` 且 `agent_message_chunk` 非空；
  5. 新进程 `session/resume {sessionId, cwd}` → 成功（同 cwd）；
  6. **角色一致性由 Hub 保证**：Report 必须回引 `context_pack_id`，Hub 校验 pack 的 `role` 与 Assignment 的 `role` 一致（§5.13 第 2 步扩展）。

> 未采用但保留的可能：改 DSH 本体让 ACP 消费 preset（**属改 DSH 边界，停点 S1，本件不做**）。
> 原 S1 的"三个角色 profile"由此**降级为已实测无效的实现细节**；S1 的目标（按角色起会话）改由**版本化 Context Pack** 达成——**✅ 创始人已于 2026-11-05 批准此变更**（见 §8.2 S1）。

未通过启动、恢复、停止边界、超时、非法回执、重复回执、崩溃和 Session 失效测试的 Adapter，不进入自动调度。

### 5.9 Gitea Source

- 只读取配置白名单中的仓库、标签和事件；首版由 Hub 定时轮询，不依赖尚未实测的 Webhook 投递；
- 轮询游标与规范化事件键必须持久化；有平台事件唯一 ID 时优先使用，无唯一 ID 时使用 `repo + event_type + object_id + object_updated_at` 哈希，并用重复轮询测试验证幂等；
- Webhook 仅在真实投递与验签探针通过后作为增强加入；验签失败返回拒绝，不进入模型；
- 外部正文写为数据文件／引用，不拼成可改变权限的系统提示；
- 评论失败必须可见，不改变代码或 Ticket 真相。

### 5.10 飞书／Outbox／Attention

研发通知与审批由 Hub 直接调用飞书 OpenAPI，不经过 DSH Connector。

通知幂等键：

```text
ticket_id + event_type + head_sha + attention_id（如有）
```

审批绑定：

```text
attention_id + ticket_id + action + head_sha + policy_version + expires_at
```

- SHA、Mandate 或风险变化使旧审批失效；
- 重复回调返回首次结果；
- 发送成功必须有通道确认；无确认记 `unknown`，不得记 delivered；
- 完成汇报为 100±20 个汉字，证据链接另列且不计字数；
- Kimi 与 WorkBuddy 的直接对话不经过 DSH。

### 5.11 WorkBuddy Report

```yaml
schema_version: v1
job_id: nightly-readonly-check
started_at: ...
finished_at: ...
model: hunyuan-3
objects_seen: ...
result: normal | abnormal | suspicious | indeterminate
checks:
  - check_id: stale-lease
    result: ...
    evidence_refs: [...]
summary_100_chars: ...          # 100±20 个汉字，链接另列
im_delivery: delivered | failed | unknown
email_fallback_used: false       # 仅已配置且验证可用的邮件通道可作 IM 失败降级
```

`objects_seen = 0` 不得输出 `normal`；模型不能自行添加检查项或授权动作。该辅助报告不参与研发主闭环的完成判定。

### 5.12 本地 HTTP 最小面

具体路由在 T0.2 按本契约实现，至少覆盖：

```text
POST /v1/events/gitea            # 轮询器写入内部事件；外部 Webhook 非首版依赖
GET  /v1/tickets/:id
GET  /v1/context-packs/:id        # 对应 Agent 的短期只读授权
POST /v1/reports                  # Schema＋Assignment＋epoch 校验
GET  /v1/attentions
POST /v1/attentions/:id/actions   # 审批绑定与幂等
GET  /attention                   # 本地降级页
POST /v1/assignments/:id/stop     # A14「一键停止」：ACP close ＋ Hub 置 Lease 失效
```

**🔴 `POST /v1/reports` 的按 token 分派（唯一口径；消除 A2 与 A9② 的撞车）**

| 调用方 token | 走哪条校验 | 期望 |
|---|---|---|
| `coding-bot`／`cto-bot`／`k3-bot` | §5.13 执行链五步 | 2xx（A2） |
| `kimi-report` | **§5.13b** 顾问分支 | **201**（A9①） |
| 其余（含 `kimi-readonly`、未认证） | 拒绝 | **403**（A9②） |

分派依据是 **token 身份**，不是 body 内容；两分支共用同一路由但互不重叠。

所有写接口认证、鉴权、校验和失败可见；不存在“本机调用所以免鉴权”。

### 5.13 🔴 权限执行点与时序（K9）

**执行点在 Hub 服务端 `POST /v1/reports`，不在 Worker 侧，也不靠提示词。** 顺序固定，任一不通过即终止：

1. **Schema 校验**（严格模式，含 `additionalProperties: false`）→ 失败 **422**，不落库；
2. **身份与租约＋角色一致性**：`assignment_id` 存在 ∧ `session_epoch` == 当前 epoch ∧ Lease 有效 ∧ `fencing_token` 匹配；**且** `context_pack_id` 可查、`role_template_version/hash` 与 Pack 一致、Pack.role ＝ Mandate.role ＝ Assignment.role（三元组一致）→ 任一不符 **409**；
3. **写集核验**：Hub **自行**从 Gitea 读 `base_sha..head_sha` 的 diff 文件列表，与 `changed_files` 比对；不一致 ⇒ 拒绝（B5）；
4. **Mandate 求交**：diff 中每个路径必须 ∈ `allowed_paths` ∧ ∉ `forbidden_paths`；越界 ⇒ **拒绝 ＋ 建 Attention**，**Ticket 不得推进**（B16）；
5. 落库 Report → 按状态推进 Ticket → 触发通知。

Worker 侧的 worktree 策略只是**软约束**；硬约束一律在第 3、4 步。

### 5.13b 顾问报告（advisor）校验分支（N3：Kimi 回流不得套执行链）

Kimi 没有 Assignment／Lease／epoch，**不能**走 §5.13 的执行链五步（否则必 409）。advisor 报告走独立分支：

| 步 | 校验 | 失败码 |
|---|---|---|
| 1 | Schema：`schemas/advisor-report.schema.json`（字段 `advisory_id`／`ticket_id`／`context_pack_id`／`conclusion`／`evidence_refs`／`unverified`；**不含** `role_template_version/hash`——advisor 无角色模板，见 §5.2 映射表；`additionalProperties:false`） | 422 |
| 2 | 凭证：token 必须是 `kimi-report`（Hub 侧只放行该 token 调本路由）；其他 token（含 `kimi-readonly`）调本路由 | **403** |
| 3 | 上下文：`context_pack_id` 存在 ∧ 未过期 ∧ **`pack.role == advisor`**（advisor 不校验模板 hash） | 409 |
| 4 | 落库 `advisories` → Hub 以 `hub` 身份写 Issue 评论 → **不推进 Ticket 状态**（顾问意见不改变 Ticket 真相）；成功返回 **201**（A9 ① 以此为准） | — |

- **不校验**：Assignment／Lease／epoch／`base..head` diff／Mandate 路径求交（顾问不写代码）；
- `kimi-readonly` 只能 `GET /v1/context-packs/:id`，**调 `POST /v1/reports` 必 403**（A9 必须实测这条）。

### 5.14 标签／风险等级／字数口径（K7 补齐；三者都必须机器可判）

**① 标签（目标仓当前 labels＝0，T0.2 首批必须建）**

| label | 颜色 | 含义 | 谁打 |
|---|---|---|---|
| `companyos:ready` | `0e8a16` | 该 Issue 可被 Hub 接单（缺此标签一律不接） | 创始人／CTO |
| `risk:high` | `d73a4a` | 高风险镜像（与 Mandate.risk_level 同步，仅供人看；**判定以 Mandate 为准**） | Hub 自动 |
| `probe` | `cccccc` | 探针产生的合成对象，可随时关闭 | 探针脚本 |

创建命令（幂等：已存在返回 409 视为通过）：
```bash
for L in 'companyos:ready|0e8a16|Hub 接单标记' 'risk:high|d73a4a|高风险镜像' 'probe|cccccc|合成探针' ; do
  IFS='|' read -r name color desc <<< "$L"
  curl -sS -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: token $GITEA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"color\":\"$color\",\"description\":\"$desc\"}" \
    "$GITEA/api/v1/repos/win-push/company-os-practice/labels"
done
```

**② `risk_level` 枚举与判定人**

```text
risk_level ∈ { low, medium, high }
判定人：CTO（在 Mandate 上置位）；Hub 只读不推断
high 的触发条件（任一）：触及外部发布／部署／付费／Secrets／客户敏感数据；
                       跨模块契约；改门禁或权限；单 PR > 300 行
high ⇒ 必须派 K3 独立复核（A4）；medium ⇒ CTO 自行决定是否派；low ⇒ 不派
镜像：Mandate.risk_level=high 时 Hub 自动给 Issue 打 risk:high（打标签失败不阻断，但必须记日志）
```

**③ 完成汇报字数口径（取代"约 100 字"）**

```text
计数对象：summary 字段
计数规则：只数 CJK 统一表意文字（正则 [\u4e00-\u9fff]），数字／英文／标点／空白一律不计
链接：放 evidence_links 独立字段，不进入 summary，不计字数
通过区间：80 ≤ count ≤ 120
实现：scripts/accept/han-count.mjs（T0.2 交付），并作为 A5 的判据
反例：count=79 与 count=121 都必须判红（B9 同族）
```

### 5.15 Ticket／Assignment 状态机（N2 补齐；此前只定义了 Report 状态）

**Ticket**（`tickets.state`）：`queued → ticketed → assigned → in_progress → review → done`，另有 `waiting_input`（等待输入）与两个终态分支 `blocked`、`dropped`。

| 迁移 | 触发者 | 条件 |
|---|---|---|
| ∅ → `queued` | Hub 轮询器 | 发现带 `companyos:ready` 的 Issue，且幂等键未命中 |
| `queued` → `ticketed` | Hub | Ticket 落库 ＋ Mandate 生成成功 |
| `ticketed` → `assigned` | Hub Router | 选中实例、建 Assignment ＋ Lease |
| `assigned` → `in_progress` | Worker | 首个 `progress` Report 通过 §5.13 五步 |
| `in_progress` → `review` | Worker | `ready` Report 通过校验 |
| `review` → `done` | CTO | CTO 验收通过（Ticket 0 期间＝人工点击/命令） |
| `*` → `blocked` | Worker／CTO | `blocked` Report 或审批超时 |
| `in_progress` → `waiting_input` | Worker | 提交 `waiting` Report（需要人给输入） |
| `waiting_input` → `in_progress` | Worker | 收到补充指令且 resume 成功 |
| `waiting_input` → `blocked` | Hub | 审批/输入超时 |
| `blocked` → `in_progress` | Worker | 收到补充指令且 resume 成功 |
| `*` → `dropped` | CTO | 明确放弃（需记录理由） |

**Assignment**（`assignments.state`）：`created → leased → running → waiting → closed`，另有 `expired`（Lease 到期）、`revoked`（交接／撤销）。

| 迁移 | 触发者 | 条件 |
|---|---|---|
| ∅ → `created` | Hub Router | 选定 instance |
| `created` → `leased` | Hub | 下发 Lease ＋ fencing_token |
| `leased` → `running` | Worker | 首个心跳／progress |
| `running` → `waiting` | Worker | `waiting` Report |
| `waiting` → `running` | Worker | resume 成功 |
| `running`/`waiting` → `closed` | Worker／CTO | 终态 Report 且 Ticket 离开 in_progress |
| `*` → `expired` | Hub | Lease 到期无心跳 |
| `*` → `revoked` | CTO | 交接（`session_epoch += 1`）或人工撤销 |

**规则**：非法迁移一律 **409 ＋ 记日志 ＋ 不落库**；状态迁移必须单事务；`session_epoch` **只在 `revoked`（交接）时递增**（对应 N1：补充指令不改 epoch）。

---

## §6 单任务拆分

每个子任务交给一个独立 coding 会话。除 T0.1 外，均须使用独立分支／worktree；前置未满足不得开工。

### T0.1 · 仓库基线与真实接口探针（部分完成，只补剩余项）

- **模块锚**：同 §1；本任务只消除未知，不写实现；
- **目标**：在现有证据册上只补 §2.6 与开工硬停点所需探针，不重复已完成的只读核验；
- **范围／不做**：只读仓库与本机配置；经批准的合成消息探针；不改生产规则、不付费、不发外部公开内容；
- **现状证据**：§2.5 已有实测事实与 §2.6 未核实项，T0.1 不得标为已全部通过；
- **关键契约**：§5 的接口需求；记录命令、版本、原始输出和限制；
- **真实入口与验收**：验证 Context Pack 角色模板注入（首条 prompt）确实被会话接受、飞书绑定后的合成收发、Gitea 合成 Issue／评论；**不再验证任何 profile**；WorkBuddy 只补自身辅助线探针；
- **失败与回退**：接口不存在就标不支持并提出最小替代，不猜测；探针创建的数据可删除且仅位于测试范围；
- **停点**：需要 Secrets、付费、公网暴露、真实客户数据或改变产品边界。

### T0.2 · 新仓引导、Schema、事件幂等与核心状态

- **模块锚**：同 §1；
- **目标**：先配置 main 分支保护，再通过首批 PR 建立 Node 24.16.0＋npm 工程、lockfile 和最小 CI；随后实现六份 Schema、SQLite 持久化、Ticket／Assignment／Lease／Report／Attention／Outbox 和事件幂等；
- **范围／不做**：`package.json`（新建）、`package-lock.json`（新建）、`tsconfig.json`（新建）、`.gitea/workflows/**`（新建）、`schemas/**`（新建）、`src/core/**`（新建）、`src/host/{sqlite,http,outbox}*`（新建）、`scripts/accept/run-tests.sh`（新建）、`scripts/accept/han-count.mjs`（新建）、`scripts/accept/check-main-integrity.sh`（新建）、对应测试（新建）；不接真实 Agent；`scripts/kimi/report.mjs`（新建）归 T0.5
- **现状证据**：T0.1 仓库基线与 §4.1 工程口径；保护未生效、CI 未建立前不得写业务实现；
- **关键契约**：§5.1–§5.12；
- **真实入口与验收**：CI 真实执行 `npm ci`、`npm run typecheck`、`npm run build`、`npm test`；通过 HTTP 和数据库测试完成事件→Ticket→Assignment→Report→Attention；
- **失败与回退**：事务失败整体回滚；重启后已确认记录不丢；零对象不得假绿；
- **停点**：需改变状态语义、增加自动合并或引入不可验证外部服务。

### T0.3 · DSH ACP Adapter、Session Router 与上下文交接

- **模块锚**：同 §1；
- **目标**：统一用出厂 `acp` profile 启动／恢复／close DSH 会话，持久化 `sessionId ↔ 物理 cwd`，维护 SessionRef／Lease／epoch；按角色生成**版本化 Context Pack**（`role_template_version` ＋ `role_template_hash`）并作为首条 prompt 投递，完成 CTO 交接；**并产出 `role_template` v1 三份正文（cto／coding／auditor）与 sha256，落 `config/role-templates/`（本任务承接，解决「硬停点 2 的前提无人承接」）**；🔴 **本任务的第 1 步（只产模板＋sha256）属「补资料」，不受硬停点 2 阻断**——硬停点 2 阻断的是**写 Adapter／消费 Context Pack 的代码**；模板版本化之后方可继续第 2 步；
- **范围／不做**：`src/adapters/dsh/**`、`src/context/**`、`src/policy/**`、**`config/role-templates/**`（新建：三份 `role_template` 正文＋`manifest.json` 记 sha256）**、对应测试；不接飞书、Kimi／WorkBuddy；
- **现状证据**：T0.1 DSH ACP 实测；T0.2 核心接口；
- **关键契约**：§5.2–§5.8；
- **真实入口与验收**：真实 ACP 会话完成启动、同 cwd 补充指令恢复、`stopReason` 回合判定、失忆接回和旧 epoch 拒绝；close 不得冒充强制停止；
- **失败与回退**：Session 失败先 reconcile，不能重放副作用；
- **停点**：DSH 实际行为与探针不符、需要修改 DSH 本体或扩大权限。

### T0.4 · Hub 飞书与本地 Attention

- **模块锚**：同 §1；
- **目标**：Hub 直连飞书 OpenAPI，实现研发通知、100±20 个汉字完成汇报、必要审批、补充指令、停止、查询及本地降级；
- **范围／不做**：`src/adapters/feishu/**`、`src/host/**` 通知与 Attention、测试；不接其他 IM 平台，不在 DSH Adapter 内实现飞书；
- **现状证据**：T0.1 飞书 App／token 实测与创始人完成会话绑定后的 `chat_id`；
- **关键契约**：§5.10；
- **真实入口与验收**：合成 Ticket 完成／等待／阻塞各走一次，验证按钮／口令、过期审批、重复回调与断网恢复；
- **失败与回退**：本地 Attention 始终可用；不对未知送达状态造假；
- **停点**：需要公开公网、真实外部发布或绕过审批。

### T0.5 · Kimi 本地 CLI 独立顾问通道

- **模块锚**：同 §1；
- **目标**：创始人直接联系 Kimi；关联 Ticket 时由本地 Kimi CLI 主动获取限定 Context Pack，在当前对话直接回复并回流 Report；
- **范围／不做**：`src/adapters/kimi/**`、**`scripts/kimi/report.mjs`（新建，本任务交付；T0.2 不写它）**、相应 Context／Report 接口和测试；不调用 DSH，不写代码，不预设 Kimi 自有飞书；
- **现状证据**：T0.1 Kimi Code CLI `0.34.0` 非交互与会话能力；
- **关键契约**：§5.6、§5.10、§5.12；
- **真实入口与验收**：从创始人与 Kimi 的直接对话发起，全程无 DSH；核对 CLI 调用、只读范围、报告回流和直接回复；
- **失败与回退**：接口不可用时明确未接通，只保留直接对话，不伪称任务已关联；
- **停点**：需要代码写入、合并、部署、外发或让 CTO 自动召唤。

### T0.6 · WorkBuddy 独立辅助定时巡检（不阻塞主闭环）

- **模块锚**：同 §1；
- **目标**：创始人在 WorkBuddy 内直接配置 23:00–08:00 固定巡检；混元 3 生成固定检查摘要；直接 IM、原 Ticket 评论；邮件仅在已配置且验证可用、同时 IM 失败时降级；
- **范围／不做**：WorkBuddy 自有任务配置、`src/adapters/workbuddy/**`、检查脚本和测试；不创建 DSH 定时任务，不自动修复；
- **现状证据**：T0.1 仅确认自动化实物与历史真跑；模型、窗口、直接 IM、Gitea 评论及邮件仍须逐项验证；
- **关键契约**：§5.11；
- **真实入口与验收**：真实运行一个合成批次；分别构造正常、异常、零对象和 IM 失败；邮件不可用时必须明确“降级不可用”；
- **失败与回退**：异常只留证据和 Attention；可随时在 WorkBuddy 停用；未通过不影响 T0.2–T0.5，但不得宣称辅助巡检上线；
- **停点**：需要代码写权、自动修复、改门禁或长时间持续运行。

### T0.7 · 端到端影子验收

- **模块锚**：同 §1；
- **目标**：把 T0.2–T0.5 装成一条真实但无自动合并的研发影子闭环；T0.6 单独做辅助线验收，不阻塞主闭环；
- **范围／不做**：`tests/**`、最小验收脚本和配置；不改 G0–G2，不扩大 Adapter 能力；
- **现状证据**：前序任务实际 merge SHA 与测试记录；
- **关键契约**：§3、§5；
- **真实入口与验收**：§7 核心场景与辅助场景分别判定，不合并成假全绿；
- **失败与回退**：任一核心场景失败即主闭环不收口；关闭 Adapter 后现有 Synova 流程不受影响；
- **停点**：为通过验收而删反例、放宽 Schema、隐藏异常或增加自动合并。

---

## §7 验收与反例

### 7.1 验收环境冻结

T0.1 已回填的基线与 T0.2 必须建立的工程契约如下：

```text
目标仓 URL：win-push/company-os-practice（Gitea 1.27.3）
默认分支：main
基线 HEAD：48580c5da6a9c699d93e63f5f78e46f17b536b70   ← 客户材料迁出后回填新 SHA
Node／包管理器／操作系统：Node v24.16.0（实测）／npm 11.13.0＋package-lock.json／Windows
   · pnpm 本机 corepack 挂起（>120s 无输出），**不采用**
安装命令：首次 `npm install` 生成 lockfile；CI 与复跑一律 `npm ci`
类型检查命令：`npm run typecheck`（tsc --noEmit；TypeScript 仅作类型检查，**无构建步骤**）
   · Node 24 原生类型剥离可直接执行 .ts（本机实测 RC=0），故 `npm run build` 允许为 no-op
   · 🔴 **strip-only 限制（实测）**：只支持 **erasable syntax**。**禁** `enum`／`namespace`／构造器参数属性／装饰器 —— `node e.ts`（含 `enum`）实测 `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode`，RC=1。状态枚举一律写 `as const` 对象 ＋ union type（§5.15 的状态表按此实现）
测试运行器：`node --test`（内置，实测 pass/fail 计数可用）——**不用 vitest/jest**
   · 🔴 **Windows 陷阱（实测）**：`node --test tests/**` 在 cmd 下通配符不展开 → `Cannot find module '…\tests'` → **幻影失败 RC=1**。**必须**写 `"test": "node --test"`（自动发现 `**/*.test.*`）或 `"test": "node --test \"tests/**/*.test.js\""`（引号内由 Node 自行展开）
Schema 校验器：ajv 8.20.0 严格模式（实测 `additionalProperties:false` 生效）
持久化：`node:sqlite` DatabaseSync（内置，实测建表/插入/查询通过）——**不用 better-sqlite3**
测试命令：`npm test` **不得直接写 `node --test`**（实测：空 `tests/` 时 `tests 0/pass 0/fail 0/RC=0` ⇒ 0 测试也全绿）。**必须**用守卫脚本 `scripts/accept/run-tests.sh`（新建，T0.2 交付）——脚本正文与判据见本节末的**顶层 bash 块**（可原样落盘）。
本地启动命令：`npm run dev`（T0.2 首批提交建立；端口与命令须回填本节）
Gitea 测试仓：win-push/company-os-practice（仅使用批准的合成对象）
DSH 锁版：0.2.1-alpha.2；ACP profile＝**acp（出厂，唯一）**；角色＝Context Pack 的 `role_template`（版本化＋hash）
Kimi 通道版本／接口：Kimi Code CLI 0.34.0（kimi-platform/k3）＋Hub 只读 HTTP
WorkBuddy 版本／模型：自动化实物已确认；混元 3 与配置窗口仍待实测（辅助线，不阻塞）
凭证：同账号 `win-push` 下 **5 枚 Gitea scoped token（hub／cto-bot／coding-bot／k3-bot／workbuddy-bot）＋ 2 枚 Hub-only token（`kimi-readonly`／`kimi-report`，均不下发 Gitea）**，共 7 枚，可区分、可单独吊销（下表）
```

**测试守卫脚本（新建，T0.2 交付；**原样落盘，不要缩进**）**（另一段门禁脚本 `check-main-integrity.sh` 在 §7.5）

```bash
#!/usr/bin/env bash
# scripts/accept/run-tests.sh
set -u
command -v node >/dev/null 2>&1 || { echo "判不了：node 不可用（依赖缺失）"; exit 2; }
out="$(node --test 2>&1)"; rc=$?
echo "$out"
[ "$rc" -eq 0 ] || exit 1
grep -qE '^ℹ pass [1-9][0-9]*$' <<<"$out" || { echo "0 tests executed → exit 2（禁假绿）"; exit 2; }
exit 0
```

判据：**pass>0 且 fail=0**；空 `tests/` ⇒ **exit 2**（不是 0）；改坏用例 ⇒ exit 1；node 缺失 ⇒ **exit 2**（依赖缺失＝判不了）。`package.json` 写 `"test": "bash scripts/accept/run-tests.sh"`。

**scoped token 能力表（S8；scope 字符串以 Gitea 1.27.3 实测为准，T0.2 首批回填）**

| token | 角色 | 能力（最小） | 明确不给 |
|---|---|---|---|
| `hub` | Hub 服务 | 读仓＋读/写 issue 评论＋读 PR＋读 CI | 合并、admin |
| `cto-bot` | CTO 会话 | 读仓＋读/写 issue＋读 PR | 写仓、合并 |
| `coding-bot` | coding 会话 | 写仓（仅目标仓分支）＋读/写 issue＋读 PR | 合并、admin |
| `k3-bot` | K3 会话 | 读仓＋读 issue＋写评论 | 写仓、合并 |
| `workbuddy-bot` | WorkBuddy（辅助） | 读仓＋写评论 | 写代码、改判据、合并 |
| `kimi-readonly` | Kimi（辅助） | 只读 Context Pack（Hub 侧 token，不给 Gitea） | 一切写 |
| `kimi-report` | Kimi 报告回流（辅助） | **仅** `POST /v1/reports`（Hub 侧限该方法） | Gitea 任何写、合并 |

上述 npm 脚本是 T0.2 首批提交必须建立的契约，**不是当前仓库已有命令**。分支保护、最小 CI、**角色 Context Pack 模板（`role_template` v1＋sha256）建好并版本化**（**仅阻断 T0.3 及之后**；T0.2 不受此项阻断，理由见硬停点 2）、飞书 `chat_id`、客户材料迁移及最小授权未解除前，仍不得写业务实现。测试必须证明信号量非零，不能只报 `0 failed`。

**Gitea 合并方式冻结（K8 ② 前提）**：`allow_squash_merge=false`、`allow_rebase=false`、`default_merge_style=merge` —— 否则 squash/rebase 会在 main 上产生非合并提交，② 的判据会永红。该三项属目标仓设置，T0.2 建保护时一并配置并回填本节。

### 7.2 必过真实场景

| # | 场景 | 触发（怎么造） | 观测点 | 期望值来源 | 失败判据 |
|---|---|---|---|---|---|
| **A1** | 合规 Issue 进入 | 在目标仓建带约定标签的 Issue | `GET /v1/tickets/:id`；DB `tickets` 表 | Issue number ＋ §5.9 幂等键 | 超时无 Ticket／出现 2 条 |
| **A2** | coding 回执 | 用 T0.2 夹具提交一份合法 Report | `POST /v1/reports` 返回码；Ticket 状态 | §5.5 Schema＋§5.13 五步 | 422/409／Ticket 未进 `review` |
| **A3** | 补充指令恢复原会话 | 对同一 Assignment 发第二条指令 | ACP `session/list` 中该 `sessionId` 的 `cwd`；Report 的 `session_epoch` | §5.8 resume 行；证据册 §2.8 | 🔴 **新建了 sessionId／`cwd` 不一致／`epoch` 发生变化**（补充指令**不应**改 epoch——epoch 只在**交接**时递增，见 §5.4；epoch 递增的正例归 A8 验证） |
| **A4** | 风险复核 | 高风险 Ticket 派 K3（`risk_level=high`） | Hub 记录的 `(context_pack_id, role_template_version, role_template_hash, role=auditor)` 三元组；K3 会话首条 prompt 的 pack id；`GET /v1/context-packs/:id` | §5.6 角色裁剪＋角色契约；§5.13 第 2 步 | K3 拿到 Worker 自我解释全文／无独立 Assignment／**以模型自称角色作为证据** |
| **A5** | 最终完成汇报 | Ticket 置 `done` | 飞书消息体；Outbox 记录 | §5.10：**100±20 个汉字**、链接独立字段 | 发 2 次／字数越界／链接混入正文 |
| **A6** | 等待／阻塞／高风险审批 | `waiting_input`、`blocked`、高风险各造一次 | 飞书卡片；`GET /v1/attentions` | §5.10 审批绑定六元组 | 缺审批卡／普通自修错误也发 |
| **A7** | CTO 失忆接回 | 结束 CTO 会话，新会话只给 Context Pack | 新会话首个 Handoff Ack | §5.7＋§5.6 | 需人工补料／把旧摘要当事实 |
| **A8** | 会话交接旧 epoch 拒绝 | 交接后旧会话再提交 Report | `POST /v1/reports` 返回码 | §5.4 epoch＋fencing | 旧 epoch 被接受（应 409） |
| **A9** | Kimi 直接咨询 | 创始人跑 `kimi -p "…"` 并要求引用 Ticket | ①`kimi-report` 调 `POST /v1/reports` → **201**；②`kimi-readonly` 调同路由 → **403**；③Hub 日志 client 归属正确；④`%DSH_HOME%\sessions` 无新目录；⑤回流的 advisory 带 `context_pack_id` 且 `pack.role==advisor`（**不带** `role_template_*`，见 §5.13b 步1） | §3.3；§5.13b；§5.6 角色契约 | ①非 201／②非 403／期间产生 DSH 会话／获得 `kimi-report` 之外的任何写权限／**以模型自称角色作为证据** |
| **A10** | WorkBuddy 正常巡检（辅助） | 在 WorkBuddy 内触发一次固定批次 | 创始人 IM；`summary_100_chars` | §5.11 | 无消息／用邮件重复发 |
| **A11** | WorkBuddy 异常巡检（辅助） | 造一个过期 Lease | 原 Issue 证据评论＋Hub Attention | §3.4 | 只发 IM 不留证据／自动"修复" |
| **A12** | WorkBuddy IM 失败（辅助） | 断开 IM 通道后触发 | `im_delivery=failed`＋邮件或"降级不可用" | §5.11 | 记成 delivered／静默 |
| **A13** | IM 不可用→本地审批→恢复不重发 | 停飞书通道，用 `/attention` 页审一次，恢复后重放回调 | 本地页结果；Outbox 发送次数 | §5.10 幂等键；§3.6 | 恢复后重复发送／审批执行两次 |
| **A14** | 一键停止→Lease 失效 | ACP `session/close` 且 Hub 置 Lease 失效，再让 Worker 提交心跳/Report | `POST /v1/reports` 返回码；Lease 记录 | §5.8 stop 行＋§5.4 | 停止后仍能提交有效 Report（应 409） |

> 主闭环行＝A1–A9、A13、A14；辅助线行＝A10–A12（单列判定，不影响主闭环收口）。

### 7.3 改坏必红反例

| # | 故意注入的故障 | 必须失败／阻断 |
|---|---|---|
| B1 | 同一 Gitea 事件投递两次 | 第二个 Assignment 不得产生 |
| B2 | 重复 IM 审批回调 | 动作只执行一次 |
| B3 | 审批后改变 head SHA | 旧审批失效 |
| B4 | Report 篡改 ticket／assignment／epoch | Schema 或权限校验拒绝 |
| B5 | changed_files 与 Git diff 不符 | 不得进入验收通过 |
| B6 | 非法 Report，原会话修复仍非法 | Ticket 不推进，进入 Attention |
| B7 | Agent 无心跳后恢复 | 先 reconcile，不直接重放 |
| B8 | 外部消息携带 `access: admin` | 字段拒绝且权限不变 |
| B9 | 测试／巡检对象为零 | 不得报告全部正常 |
| B10 | IM 发送无通道确认 | 不得标记 delivered |
| B11 | Context Pack 缺少最新有效裁定 | 不得完成交接 |
| B12 | 新 CTO Handoff Ack 与程序事实冲突 | 停止派工并进入 Attention |
| B13 | Kimi 通道暗中调用 DSH 中转 | 独立链路验收失败 |
| B14 | WorkBuddy 试图写代码／改判据／合并 | 权限拒绝并留异常 |
| B15 | 为让测试通过删除反例或跳过真实入口 | 整体验收失败 |
| **B16** | **Worker 改了 `allowed_paths` 之外的路径** | **Report 被拒 ＋ 建 Attention，Ticket 不得推进**（§5.13 第 4 步） |

### 7.4 证据要求

每个场景保留：Ticket／Assignment ID、相关 SHA、命令原文、退出码、关键原始输出、Gitea／IM 记录引用、未验证项。不得只贴最终“PASS”。

### 7.5 Done 标准

研发主闭环与 WorkBuddy 辅助线分别收口，不得相互冒充：

1. 主闭环必须通过 **A1–A9、A13、A14** 及 **B1–B13、B15、B16**；任一失败即主闭环不收口；
2. WorkBuddy 只有通过 A10–A12 与 B14 才可宣称辅助巡检上线；其失败不阻塞主闭环，但必须列入回执；
3. 🔴 **"无 main 直写"改为脚本可判（K8）**。放 `scripts/accept/check-main-integrity.sh`（新建，T0.2 交付），**三态退出码**（0 通过／1 真红／2 判不了）。**下面这段是顶层 bash 块，原样落盘即可（不要再缩进）**：

```bash
#!/usr/bin/env bash
# check-main-integrity.sh [--only=N]  N∈{1,2,3,4,5}
# 三态：0=通过  1=真红  2=判不了（环境/依赖/权限）
set -u
: "${GITEA:?GITEA 未设置（例 http://192.168.1.6:3000）}"
: "${GITEA_TOKEN:?GITEA_TOKEN 未设置（角色：hub token，只读）}"
REPO=win-push/company-os-practice
ONLY="${1:-}"
FAIL=0; UNKNOWN=0
export PYTHONIOENCODING=utf-8          # 让 python traceback 也走 UTF-8（N-5）
TMPD="$(mktemp -d)"; BP="$TMPD/bp.json"
trap 'rm -rf "$TMPD"' EXIT INT TERM    # 早退也清理（N-4）

api() {  # api <path> <outfile>；0=200, 2=判不了
  local url="$GITEA/api/v1/repos/$REPO/$1" out="$2" code
  code=$(curl -sS -o "$out" -w '%{http_code}' -H "Authorization: token $GITEA_TOKEN" "$url") || return 2
  [ "$code" = "200" ] || { echo "判不了：$url → HTTP $code"; return 2; }
  return 0
}

# ① 分支保护（空保护 ⇒ 红 1，不是判不了 2）
if [ -z "$ONLY" ] || [ "$ONLY" = "--only=1" ]; then
  api "branch_protections" "$BP" || exit 2
  python3 - "$BP" <<'PY' || { echo "① 红：main 保护缺失或不合规"; FAIL=1; }
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
assert isinstance(d,list) and d, "branch_protections 为空"
m=[b for b in d if b.get("branch_name")=="main"]; assert m, "main 无保护"
b=m[0]
assert b.get("enable_push") is False, "main 仍允许直推"
assert b.get("enable_status_check") is True, "未启用状态检查"
assert b.get("status_check_contexts"), "status_check_contexts 为空"
print("① OK", b.get("status_check_contexts"))
PY
fi

# ② 保护生效后 main 无非合并提交（fetch 远端 + origin 身份校验；① 已红则跳过）
if [ -z "$ONLY" ] || [ "$ONLY" = "--only=2" ]; then
  if [ "$FAIL" -eq 0 ]; then
    case "$(git config --get remote.origin.url 2>/dev/null || echo '')" in
      *company-os-practice*) ;;
      *) echo "判不了：origin 不是目标仓（$(git config --get remote.origin.url 2>/dev/null)）"; exit 2 ;;
    esac
    [ -s "$BP" ] || api "branch_protections" "$BP" || exit 2
    SINCE=$(python3 - "$BP" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
print([b for b in d if b["branch_name"]=="main"][0]["created_at"])
PY
    ) || exit 2
    [ -n "$SINCE" ] || { echo "判不了：无保护创建时间"; exit 2; }
    git fetch -q origin '+refs/heads/main:refs/remotes/origin/main' || { echo "判不了：fetch 失败"; exit 2; }
    REF=refs/remotes/origin/main
    [ "$(git log --format=%H "$REF" 2>/dev/null | wc -l)" -gt 0 ] || { echo "判不了：远端 main 无提交"; exit 2; }
    N=$(git log --first-parent --no-merges --since="$SINCE" --format=%H "$REF" | wc -l)
    [ "$N" -eq 0 ] || { echo "② 红：保护生效后 $REF 仍有 $N 条非合并提交"; FAIL=1; }
    [ "$N" -eq 0 ] && echo "② OK（自 $SINCE 起无非合并提交）"
  else
    echo "② 跳过：① 已红（保护缺失时②无意义；三态不压平）"
  fi
fi

# ③ 无自动合并（可单跑）
if [ -z "$ONLY" ] || [ "$ONLY" = "--only=3" ]; then
  [ -d .gitea/workflows ] || { echo "判不了：无 .gitea/workflows"; UNKNOWN=1; }
  [ -d .gitea/workflows ] && {
  HITS=$(grep -rniE 'auto[_-]?merge|merge_queue' .gitea/workflows/ \
         | sed -E 's#^[^:]+:[0-9]+:##' | grep -vE '^[[:space:]]*#' || true)
  if [ -n "$HITS" ]; then echo "③ 红：CI 含自动合并配置："; echo "$HITS"; FAIL=1; else echo "③ OK"; fi
  }
fi

# ④ 无 Synova 业务代码 / 无客户材料（判不了与空集分开）
if [ -z "$ONLY" ] || [ "$ONLY" = "--only=4" ]; then
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "判不了：不在 git 仓库内（禁把看不见当没问题）"; UNKNOWN=1; }
  [ -n "$(git rev-parse --git-dir 2>/dev/null)" ] && {
  [ -d synova-agent/src ] && { echo "④ 红：Synova 业务代码混入"; FAIL=1; }
  [ "$(git rev-list --count HEAD 2>/dev/null || echo 0)" -gt 0 ] || { echo "判不了：仓库无提交（禁把空仓当无客户材料）"; UNKNOWN=1; }
  if git grep -lE '南宁|员工简表|人效地图' -- ':!tests/fixtures' >/dev/null 2>&1; then
    echo "④ 红：客户材料仍在代码仓"; FAIL=1
  elif [ "$UNKNOWN" -eq 0 ]; then echo "④ OK"; fi
  }
fi

# ⑤ 合并方式冻结（squash/rebase 关闭、default=merge）
if [ -z "$ONLY" ] || [ "$ONLY" = "--only=5" ]; then
  if api "" "$TMPD/repo.json"; then
    python3 - "$TMPD/repo.json" <<'PY' || { echo "⑤ 红：合并方式未冻结"; FAIL=1; }
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
assert d.get("allow_squash_merge") is False, "allow_squash_merge=true"
assert d.get("allow_rebase") is False, "allow_rebase=true"
assert d.get("default_merge_style")=="merge", "default_merge_style!=merge"
print("⑤ OK")
PY
  else
    echo "判不了：合并方式读取失败（不覆盖已判定的红）"; UNKNOWN=1
  fi
fi

[ "$FAIL" -ne 0 ] && exit 1
[ "$UNKNOWN" -ne 0 ] && exit 2
exit 0
```

   **判别力自检（逐行实跑并把命令＋exit code 贴回 PR；下表为最小集）**

   | 场景 | 跑法 | 期望 | 说明 |
   |---|---|---|---|
   | 目标仓当前（保护为空） | `--only=1` | **1** | 空保护是红，不是判不了 |
   | 错 token | `--only=1` | **2** | HTTP≠200 ⇒ 判不了 |
   | 无 `.gitea/workflows` | `--only=3` | **2** | 依赖缺失 |
   | workflow 含 `auto_merge` | `--only=3` | **1** | |
   | 仅注释含该词 | `--only=3` | **0** | 不误报 |
   | 造一条 main 非合并提交 | `--only=2` | **1** | |
   | 只有 merge commit | `--only=2` | **0** | |
   | `origin` ≠ 目标仓 | `--only=2` | **2** | 身份盲区必须判不了，不得盲绿 |
   | 合并方式未冻结（当前仓） | `--only=5` | **1** | 目标仓实测 squash/rebase=true |
   | 三态不压平 | 无参（当前仓） | **1** | ① 红优先于 ③ 的「无 workflows 判不了」（聚合：先红后判不了）；且无参**也会跑 ⑤** |
| 非 git 目录 | `--only=4` | **2** | 禁把 `git grep` 失败吞成通过（N-1） |
| 迁移 step4 目标参数指向非 git 目录 | 传 `<code-repo>=非git` | **2** | 判不了，不得当通过（F1） |
| 迁移 step4 目标参数指向非目标 git 仓 | 传 `<code-repo>=其他仓` | **1** | 红（pathspec 不匹配） |
| 迁移 step5 单跑·非 git 目录 | 传 `<code-repo>=非git` | **2** | 必须真跑过；`git grep` rc≥2 ⇒ 判不了（F1 残留修复） |
| 迁移 step5 单跑·有客户材料 | 有命中的仓 | **1** | 红 |
| 迁移 step4/5 cwd 无关 | 错误 cwd + 正确目标 | **0** | 绑定后 cwd 不应影响结果 |
| 早退清理 | 任一 `exit 2` 路径 | — | `trap` 清理 `mktemp -d`，不留垃圾（N-4） |
   | T0.2 建好保护＋CI＋冻结合并 | 无参 | **0** | |

4. Kimi 主链路可独立直接联系且通信不经过 DSH；WorkBuddy 未上线时明确标记辅助线未就绪；
5. 每个 Ticket 完成均有 100±20 个汉字直接 IM，链接另列；WorkBuddy 上线后每次巡检也须符合该要求；
6. 所有失败、跳过和未验证项已列入回执；
7. 关卡 A 初审 K1–K12 已由原复核者复验，并抽验三条；不重开完整评审。
8. 🔴 **角色一致性有机器证据**：**执行链角色会话（`cto`／`worker`／`auditor`）**的 Report 均带 `context_pack_id`＋`role_template_version`＋`role_template_hash`，Hub 校验三元组一致；`advisor`／`inspector` 不在本项范围（无角色模板，见 §5.2 映射表与 §5.13b）；**验收材料中不得出现"模型自称某角色"作为证据**。

---

## §8 未决项与变更规则

### 8.1 仍需回答的技术未决项

1. `role_template` 的版本化与 hash 口径，以及 close 对执行中 prompt 的实际副作用；
2. 创始人绑定飞书会话后的发送、回调、卡片、消息更新与失败确认；
3. Gitea 真实 Issue／评论写操作、轮询幂等、CI 与分支保护；Webhook 只作后续增强，不是首版阻塞项；
4. 本地 Kimi CLI 与 Hub 只读 HTTP 的真实关联、恢复与 Report 回流；
5. WorkBuddy 的混元 3、23:00–08:00 窗口、直接 IM、Gitea 评论与邮件通道是否可用；
6. Windows 常开主机的进程守护、休眠、断网与重启恢复方式；
7. 本地 Attention 的访问与认证方式。

### 8.2 已由创始人裁定，不再由 coding 重开

> **出处（K5 修复）**：创始人 2026-11-04 会话原话**逐字**记录于
> **#1327 评论 10668**：`http://192.168.1.6:3000/synova-agent/SynovaAgent/issues/1327#issuecomment-10668`
> ⇒ 任一会话可点开核对；本小节以下 9 条与该评论逐条对应，**不再自指**。
> 若该评论与本小节冲突，**以评论（原话）为准**。

1. **S1**：允许新建 CTO／coding／K3 的 ACP profile；保留旧 profile，不动 desktop，先备份且可回退；
   - ✅ **实测修正（2026-11-05，创始人已批准）**：**两个 CTO 预设都测了**——模块 CTO `synova-cto` 与主CTO `synova-main-cto`，加 profile 级 persona 对照，五组一致答"coding agent"；`dsh-acp` 源码 0 处引用 `preset`。**最终裁定**：不新增任何 DSH profile，统一用出厂 `acp` profile；CTO／coding／K3 的角色由 **Hub 生成、版本化的 Context Pack 首条 prompt** 承载。既有 profile 不动，不改 DSH 本体。
2. **S2**：飞书 Synova 机器人由创始人手动加入会话并提供 `chat_id`；
3. **S3**：Kimi 首版采用本地 Kimi CLI＋Hub 只读 HTTP，独立于 DSH，不预设自有飞书；
4. **S4**：WorkBuddy 为独立辅助验收线，不阻塞研发主闭环；23:00–08:00、混元 3、直接 IM 为配置目标；邮件不是首版依赖；
5. **S5**：T0.2 前为新仓 main 配置分支保护和最小 CI；
6. **S6**：客户访谈、员工资料等先复制并核验到研究仓哇呢宝贝客户目录，再移除代码仓原件；代码仓只留代码与合成样例；
7. **S7**：只做 Ticket 0 相关窄映射，不全量对账现有方案文档；
8. **S8**：首版使用同账号、不同角色、不同 scope 的 Gitea token；
9. **S9**：完成汇报为 100±20 个汉字，链接另列且不计字数。

既有裁定继续有效：3 个核心角色＋2 个辅助角色；飞书为首版研发 IM；Gitea 为权威任务与代码面；Ticket 0 不自动合并、不建设第二套门禁或任务台账。
**出处同样为 #1327 评论 10668 之前的上游方案 §0.2／§8.2**——本轮创始人未逐条复述这四条；它们属"已确认方案"级，**不是**本件最高权威（见 §0.1 依据顺序）。

### 8.3 变更规则

- 技术事实变化：CTO 可更新本 DEV DOC 的版本、接口和实现取舍，但保留实测证据；
- 范围、写集或验收变化：先更新 DEV DOC，再继续；验收者不得临时加需求；
- 产品方向、对外发布、部署、付费、Secrets、敏感数据：必须创始人明确批准；
- 发现历史规则冲突：登记并按权威顺序处理，不顺手扩大为全仓治理；
- 同类错误第二次出现：视为防线失效，停止自动推进并升级创始人。

---

## §9 派单内部一致性自检（D733 教训：同一单两条要求对同一路径互斥）

| 检查项 | 结论 |
|---|---|
| 同一路径是否被两处要求互斥？ | 否。写集只在 §4.1；§4.2 全为 Synova 仓或"任何 main／客户数据"表述，无交集。**§4.4 根件四处口径已核一致**（§0.2b／§4.4 判断口径／§4.4 表／§4.4 命令均为「38 件迁出、根件不迁」） |
| 同一动作是否两处不同判据？ | 否。停止语义只在 §5.8 定义（`close` 只释放句柄，Lease 由 Hub 置位）；§5.4、§7.2 A14、§7.5 第 1 条引用同一处 |
| SessionRef 是否一处说"不透明"、另一处又要求解析？ | 否。v1.0 的矛盾已修：§5.4 现明确 `session_ref` 必须与 `workspace` 成对持久化 |
| 验收行是否都能落到 §5 某个契约？ | 是。A1→5.9；A2→5.5+5.13；A3/A8→5.4+5.8；A4→5.6；A5/A6/A13→5.10；A7→5.7；A9→3.3；A10/A11/A12→5.11；A14→5.8+5.4 |
| 是否有"本件未定义却要验收"的能力？ | 否。原唯一风险点（profile 内 preset 是否真生效）已由实测**证否**并从设计移除；改为 §8.1 第 1 项的多角色模板版本化 |
| 文档内数字是否都给口径/命令？ | 是。41 件文件/38 件文档（MANIFEST 声明）、**§4.1 写集 17 条（13 条运行时代码路径＋4 项工程文件：package.json／package-lock.json／tsconfig.json／.gitea/workflows）**、100±20 汉字计数口径、92 条会话，均给复跑命令或计数规则 |
| 写集里是否残留 v1.0 的 `src/adapters/dsh/**` 与实际 ACP 实现不一致？ | 否。§4.1 保留 `src/adapters/dsh/**` 作为目录名（ACP 实现在其内），§6 T0.3 与 §5.8 同指该目录，不另立 `adapters/acp/**` |

---

## 关卡 A 复验请求

请一个**未参与本版写作的零上下文独立会话**（非作者、非 CTO）只读复验初审 K1–K12 是否已关闭，并按下列三条抽验；**不重开完整评审、不新增范围**。上轮 K1–K12 原文即唯一待关闭清单（见交付说明随附），本件 §0.2 只是作者自报的对应关系，**不得当作已关闭证据**。输出一条结论：

```text
结论：可交付 coding／退回修改
初审阻塞项：K1–K12 逐项关闭／未关闭＋位置＋证据（本件 §0.2 为对应关系表）
抽验三条：
  ① 目录清单：证据册 §1.2（41 件／38 件文档；01-体系与设计=7、03=13、06=5）与 `git ls-tree` 是否逐行一致
  ② 裁定出处：§8.2 的 S1–S9 是否与创始人 2026-11-04 原话一致、能否点开
  ③ 停止能力：§5.8 的 stop 行 ↔ §7.2 A14 ↔ 证据册 §2.8 是否自洽（close 只释放句柄）
停点：coding 不得自行决定的问题
未核实项：明确列出（禁"基本通过"）
```

在结论为“可交付 coding”且开工硬停点全部解除前，Ticket 0 只能补资料、执行已批准的配置动作或做合成探针，不能进入业务实现。
