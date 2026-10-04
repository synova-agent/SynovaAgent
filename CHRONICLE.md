# CHRONICLE.md — Synova 项目编年史（来时的路）

> 本文件是"项目史记"的唯一主线：从 **ClawOrg → Novis → Synova** 三代，按时间记录我们相信过什么、做过什么、结果如何、学到了什么。
> 阅读对象：创始人（无技术背景）与新伙伴（人或 Agent）。本文尽量不用技术黑话；读不懂的地方，点链接看原始材料。
> 维护方式：由 agent 每月从 WORKLOG/memory/git/审计报告生成草稿，人工审阅后追加。**历史只增不改。**

---

## 0. 怎么读这份编年史

1. 先读「一、三代总览」建立整体框架
2. 按需读各时代章节——每章的结构都是：*我们相信什么 → 做了什么 → 结果 → 学到什么*
3. 想核实细节 → 点「材料位置」里的链接。⚠️ **`D:\novis-backup-20260526\` 是三代历史材料的唯一幸存档案库**（E 盘原始目录已不存在，C 盘用户目录也已清理）
4. `[待补]` = 暂无书面材料、需要创始人回忆补全的部分（见「七、待补清单」）

---

## 一、三代总览

| 时代 | 起止 | 一句话定位 | 今天还能找到的核心资产 |
|---|---|---|---|
| **ClawOrg** | ~2026-03 → 2026-05-25 | "让 Agent 团队共同进步"——AI Agent 团队操作系统，跑在 OpenClaw 上 | 代码历史 615 commits（04-01 起）、定位讨论存档、工作记录 9 份、会话记忆 |
| **Novis** | 2026-05-23 → 06-05 | Novis 桌面端 + Synova 引擎 + 官网（品牌过渡期，ClawOrg 代号废弃） | Novis 文档体系（docs/ 12 类 100+ 份）、Synova-Engine 引擎仓库、桌面端代码 |
| **Synova** | 2026-06-03 → 至今 | 组织数字孪生诊断 + 持续增长导航（AI 组织诊断 Agent，独立 API 进程） | synova-agent 仓库 1684 commits、控制塔门禁体系、审计报告 |

> ⚠️ **品牌演变（重要，勿混淆）**：ClawOrg（最早代号）→ Novis（品牌，2026-05 中启用）→ Synova（最终品牌）。git 提交身份长期显示 `ClawOrg`（直到 2026-08 才加机器前缀）——**这不是错误，是历史**，我们不改写历史。

### 人物与角色对照（新伙伴先看这个）

| 名字 | 身份 | 说明 |
|---|---|---|
| 黄学松 | 创始人（老板） | 无技术背景；git 账号 tangbaobao520 / 邮箱 huangxuesongvip@163.com；Mac 上身份为"哇呢" |
| 张良 | 产品领航员 | ClawOrg 时代的产品规划角色（人设/Agent） |
| Hermes | 战略分析 Agent | 负责定位讨论、战略推演 |
| 墨子 / 沈括 / 鲁班 / 魏征 / 诸葛亮 | 评审五人组 | ClawOrg 时代的"全员评审"机制，每个功能过五关 |
| CodeBuddy | 编码工具 | 4 月主编码工具（Novis 仓库 300 次提交署名） |
| Claude Code | 编码 Agent | 5 月起主编码工具（claude-code@claworg.cn） |
| OpenClaw | 开源 Agent 运行时 | ClawOrg 的技术底座（后让位于自研引擎） |
| K3（Kimi K3） | 审计线 Agent | Synova 时代：独立审计 |
| DSH（DeepSeek Harness） | 架构/基建线 | Synova 时代：架构、PR 审查 |
| Codex | 开发线 | Synova 时代：功能实现 |
| （创始人工具史） | CodeBuddy → OpenClaw → Hermes → Claude Code → Codex → DSH | 创始人先后用过的工具链（2026-08-20 口述） |

---

## 二、第一幕：ClawOrg（~2026-03 → 2026-05-25）

### 起源（2026-03，创始人口述，2026-08-20 补录）
- **时代感**：OpenClaw 刚发布不久，创始人意识到"时代将迎来变局——agent 会把技术平民化"
- **亲身体验**：自己养了几只"龙虾"（Claw），发现配置、协作等一堆问题
- **起点**：想做 ClawOrg——一个**管理 agent 工作的产品**
- **编码工具**：CodeBuddy 主刀，OpenClaw 也参与了一部分
- **名字由来**：ClawOrg = "Claw 的组织"——直接封装 OpenClaw 运行时的产品，管理 OpenClaw Agent

### 我们相信什么（当时的定位）
- **核心命题**："让 Agent 团队共同进步"（2026-04-28 定稿）
- **产品形态**：AI Agent 团队操作系统——管理多个 AI Agent 协作。核心模块：网关桥（Gateway Bridge，让 Agent"看得见"）、APS 评分引擎（看到 Agent"在变强"）、协作模式模板库（让团队"一起变强"）、指挥舱、共享黑板、组织架构图、段位成长
- **技术底座**：OpenClaw（开源 Agent 运行时）+ CodeBuddy（4 月）→ Claude Code（5 月起）
- **团队**：黄学松 + 张良 + Hermes + 评审五人组；开发由编码 Agent 承担，创始人负责判断

### 关键事件（按时间）

| 日期 | 事件 | 结果 / 教训 | 材料位置 |
|---|---|---|---|
| 2026-03 | **起源**：OpenClaw 发布 → 创始人养龙虾遇协作问题 → 启动 ClawOrg（名字 = Claw 的组织，CodeBuddy 主刀） | 无书面材料；创始人口述（2026-08-20 补录） | 见上方"起源"章节 |
| 2026-04-01 | 首个 git 提交：ClawOrg（WF-DB-EXT + TAOR 工作流引擎） | 项目启动 | `D:\novis-backup-20260526\Novis\.git` 历史 |
| 2026-04-04~07 | 团队架构设计器、Agent 配置编辑、记忆库与继承、A2A/MCP、JWT 认证、sql.js→better-sqlite3、流式 LLM | 一周内从 0 到可用的多 Agent 平台 | 同上 |
| 2026-04-25 | **20 小时冲刺：V1.0 破冰版**——从"后端跑不起来"到"核心体验闭环 + 桌面原生 + Web 重构 + 种子团队（总参指挥部：张良/鲁班/魏征/沈括）" | 记录人张良；首次展示"冲刺文化" | `Novis\work-records\2026-04-25-全天开发记录.md` |
| 2026-04-26 | 方向纠偏 + **"能力结晶"自嗨事件** | ⚠️ 最大浪费之一：产品定义模糊就推技术（Merkle+IPFS+5 阶段动画），Hermes 用一个 .md 解决了。**教训：没人喊停** | `Novis\OpenClaw+X-全览\claworg-direction-correction-20260426.md` |
| 2026-04-27 | 段位体系被砍到 V1.5；共享记忆黑板讨论 | 老板 03:04 决策：游戏化不是 V1.0 重点 | `Novis\OpenClaw+X-全览\v1-模块展开-06-决策记录-20260427.md` |
| 2026-04-28 | **定位讨论**（Hermes × 老板，17:00-19:30）+ **全局功能盘点**（37 项分类）+ 全员评审 | "让 Agent 团队共同进步"定稿；X 重新定义 = 产业模板 + 协作模式库 + 用户裂变；"跟跑借势"策略 | `Novis\全局规划\`（5 份文档） |
| 2026-05-04~13 | V1.0 发布：模板市场（4 名人 Agent + 3 团队模板）、Electron 桌面端打包、CultureForge 引擎、v1.0.0 release | 桌面端产品成形（ClawOrg-BOX） | Novis 仓库 git |
| 2026-05-15 | ARCH-00 Novis 完整设计文档 | 从"管理 Agent 的工具"开始转向"组织" | `Novis\docs\01-Architecture-架构设计\` |
| 2026-05-20~21 | Harness 薄运行时设计；Synova/ClawOrg 路线图；P2 完成；8 gaps 设计；云端部署（43.160.196.159） | 定位"同事路线"——人 + Agent 组织；"Synova 薄运行时 + OpenClaw 执行引擎" | `claude-backup-20260525\projects\E--ClawOrg-BOX\memory\` |
| 2026-05-23 | v0.19.0：**Novis 桌面端 + Synova 引擎 + 官网**；踩坑录汇总（LESSONS-全量经验教训库） | 品牌开始从 ClawOrg 更名 Novis | `Novis\CHANGELOG.md`；`Novis\docs\07-Lessons-踩坑录\` |
| 2026-05-24~25 | 知识管道 3 切片；官网 7 屏落地页；桌面端 v2.1.2 推送；L0 流式；孤儿 Agent 扫描修复（79 agent / 25 team） | 桌面端成熟到 v2.1.2 | `Novis\work-records\2026-05-25-全天工作记录.md` |
| 2026-05-25~26 | **E 盘内容备份到 `D:\novis-backup-20260526`** | E 盘原始目录此后消失——这份备份是 ClawOrg 时代的唯一幸存 | 备份根目录 |

### 这一代留下的资产
- 代码历史：`D:\novis-backup-20260526\Novis\.git`（615 commits，2026-04-01 ~ 06-05；4 月 366 次最密集，CodeBuddy 300 次署名）
- 文档：`Novis\全局规划\`（5 份）、`Novis\OpenClaw+X-全览\`（30+ 份：白皮书/PRD/开发指令书/模块展开）、`Novis\work-records\`（9 份工作记录）、`Novis\docs\` 早期 ARCH 系列
- 会话记忆：`claude-backup-20260525\projects\E--ClawOrg-BOX\memory\`（MEMORY.md、work-session-*、pitfalls-log、team-roles）
- 未整理的原始会话：`claude-backup-20260525\projects\E--ClawOrg-BOX\<session-id>\*.jsonl`（大量，可深度挖掘）

### 这一代最重要的教训（已经写进后续每一代）
1. **"能力结晶"事件**：产品定义模糊就堆技术 = 最大浪费。先定义清楚，再让技术实现
2. **没人喊停**：需要一个人专门负责"砍"（后来的"老板决策 + 全员评审"机制由此而来）
3. **踩坑录机制**：每次任务前必读踩坑录——这是后来"铁律"体系的雏形

### 已补录（2026-08-20 创始人口述）
- ✅ 起源（2026-03）、名字由来 → 见上方"起源"章节
- [ ] 04-27/28 为什么密集做定位？当时发生了什么？（仍未答）

---

## 三、第二幕：Novis（2026-05-23 → 06-05）

### 我们相信什么
- **Novis 的思路（创始人口述 2026-08-20）**：觉得 ClawOrg"太没有竞争力"→ 认为未来所有公司都需要 Agent 员工，但不知从何入手 → 从业务出发、从要完成的任务出发，做简单诊断，**直接生成公司需要的 Agent 团队，拿来就能干活**（核心仍是 OpenClaw）
- **蒸馏引擎**：既然能对公司的业务和目标蒸馏出一个团队，这个引擎也能蒸馏个人 → **SoloHub** = 个人蒸馏平台：个人把自己的经验蒸馏，放到 SoloHub 上交易
- 从"Agent 团队协作工具"转向**"组织诊断"**：产品 = Novis 桌面端（主控制台）+ Synova 引擎（诊断）+ 官网
- 引擎思路：Synova 多层诊断引擎（六缝隙模型 + 杨三角 + 7 Powers）；诊断对象 = 人 + Agent 混合组织
- 开始建立工程纪律：架构铁律（ARCHITECTURE-IRON-LAWS）、代码质量铁律（CODE-QUALITY-IRON-RULES-V1.0）、文档规范（DOC-STANDARD）

### 关键事件（按时间）

| 日期 | 事件 | 材料位置 |
|---|---|---|
| 05-25/26 | **Synova-Engine 仓库建立**（"AI 团队操作系统引擎核心"）；引擎去重迁移（engine-core）；Jaccard→LLM-as-judge | `D:\novis-backup-20260526\Synova-Engine\` |
| 05-26 | ARCH-04 多层诊断引擎架构 V2.1；**创始人对谈全记录（24 个主题：BP 评审→商业化→竞争→蒸馏→使命愿景）**；引擎认知升级；愿景路线差距分析；JiuwenSwarm 竞品对比 | `Novis\docs\` |
| 05-27 | ARCH-05 Harness 运行时统一方案；v0.19.3（engine-core 进 vendor、诊断 API） | `Novis\docs\` |
| 05-30 | ARCH-10~13（技能系统 / 双重身份 / 行业诊断师经济 / 自我进化引擎）；代码质量铁律 V1.0；技术债登记制度 | `Novis\docs\12-SynovaAgent-诊断代理\` |
| 05-31 | ARCH-15 多租户部署；ARCH-16 文档体系规范（五圈层全栈文档流）；商业计划书 | 同上 |
| 06-01 | ARCH-17 专家子 Agent 调度与合成器；ARCH-20~23（组织数字孪生终极架构决议 / 模拟仿真引擎）；Novis docs INDEX（40 文件 727 测试全绿） | `Novis\docs\INDEX.md` |
| 06-02 | **SynovaAgent v0.1.0-beta**（6339 行 TS / 75 源文件 / 93 测试）；SOG-Core Schema v1.0（14 节点 10 边）；代码健康度 78/100；**第三方审计委托书：品牌 Novis（原代号 ClawOrg 已废弃），Novis 桌面端和 SoloHub 暂停，SynovaAgent 唯一活跃** | `AUDIT-BRIEF-第三方审计委托书-20260602.md` |
| 06-03 | **synova-agent 独立仓库建立**——SynovaAgent 从 Novis 仓库独立 | synova-agent git（首个提交） |
| 06-05 | Novis 仓库最后一个提交 | `D:\novis-backup-20260526\Novis\.git` |

### 转折点解读（为什么 ClawOrg 变成了 Synova）
- 演变链条：04-28 定位定稿（Agent 团队协作）→ 05-15 ARCH-00（开始谈"组织"）→ 05-21 路线图出现"Synova 薄运行时"→ 05-23 v0.19.0 三件套 → 06-02 官方确认品牌 Novis、代号 ClawOrg 废弃
- 本质：**产品从"管理 Agent 的工具"演进为"诊断组织的引擎"**——诊断对象从 AI Agent 团队，扩展到"人 + Agent 混合组织"
- 技术沉淀：Novis 时代的引擎代码（engine-core）后来成为 synova-agent 里的 `packages/engine-core`（"Novis 遗产"，逐步迁移）
- **聚焦决策（创始人口述 2026-08-20）**：想法太多根本做不了；创始人最有经验的是**企业咨询**，这部分能真正获得付费——"只有挣钱了，才能实现更多想法；前期资源精力有限，必须聚焦"。所以 Novis 桌面端和 SoloHub 暂停，方向收敛为：**把咨询公司的咨询体系变成 Agent——"24 小时驻扎的麦肯锡顾问"**；衍生思路："产品是免疫系统，外部咨询师是医生"。此后一直专注这个方向开发到现在

### 这一代留下的资产
- 文档体系：`Novis\docs\` 12 类（架构 10 / 战略 19 / 决策 30 / 计划 19 / 发布 7 / 调优 6 / 踩坑 9 / 商业 10 / 参考 5 / 审计 7 / 同步 3）+ Archive（433+ 过期文档——**这是"文档膨胀"的第一次教训**）
- 引擎：`Synova-Engine\`（13 commits，含 ARCHITECTURE-IRON-LAWS、ECONOMIC-MODEL、L0-INTERVIEW-PROTOCOL）
- 桌面端：`Novis\box\`（Electron，已暂停）
- 商业材料：`Novis\docs\08-Business-商业申报\`（BP v5.0、可研报告、电梯演讲）

---

## 四、第三幕：Synova（2026-06-03 → 至今）

### 我们相信什么（当前定位）
- **定位**：组织数字孪生诊断 + 持续增长导航。诊断是手段，增长是目的
- **"Agent，不是 ChatBot"**——驻扎企业、持续观测、主动发现、自动诊断、给出行动建议、跟踪执行
- **形态**：独立 API 进程（HTTP + MCP），不依赖前端/桌面端
- **架构**：五层（L1 交互 / L2 编排 / L3 洞察 / L4 本体 / L5 存储）+ 文件驱动扩展 + 铁律门禁体系（"硬阻断 100% 有效，软机制 0% 有效"）

### 关键里程碑（从 git 与文档提取）

| 日期 | 事件 | 材料位置 |
|---|---|---|
| 06-03~04 | 独立仓库重建：编排层 Iter 1-6（ModuleRunner/SubAgentCoordinator/语义压缩/Event Sourcing）、L3 专家自主权、L4 GraphBridge、铁律 0-2 接线验收、pre-commit 门禁、技术债 14→0 | synova-agent git |
| 06-04 | 联邦进化 FED-001、LLM 语义交叉验证、SOG/飞书连接器、Expert Platform | 同上 |
| 06-08~21 | WORKLOG 日记开始；TUI V2 闪烁修复（ink 补丁）；**文件优先设计范式转型（06-15 决策）**；专家体系演进（6→7→8 位） | `WORKLOG-*.md`；`docs\DECISION-文件优先设计范式转型-20260615.md` |
| 06-17~23 | **Loop Engineering v2.5→v3.0**（38 项门禁 → 8 组硬阻断；"硬阻断有效，软机制无效"）；免疫系统 | `LOOP-ENGINEERING-CHANGELOG.md` |
| 07-03~08 | V4.3.0 本体层（22 节点 / 17 边）；**engine-core 拆分"欺诈事故"**（桥接文件伪装迁移 → V4.4.2 三重漏洞修复）；契约优先（铁律 47/48） | `docs\plans\codex\`；AGENTS.md |
| 07-10~16 | 权威文档 01-18 系列（42 条因果边 / 50 哨兵 / 8 位专家体系）；Anthropic 工作流 7 节点 | `docs\synova\research\权威文档*` |
| 07-22~29 | 控制塔（D201 gatekeeper / synova-commit）；自诊断系统；**跨文档一致性审计**（发现"专家 8 声称、代码仅 6 实现" P0-2）；偏离登记册 | `docs\synova\audit-reports\`；`AUTHORITY-DEVIATION-REGISTRY-v1.md` |
| 08-01~04 | V4.5.1（pre-commit 13 组，122s→50s 性能根治）；A/B/C 线审计；**客户A客户项目档案**（首个客户线索） | `docs\synova\research\A线*`；`docs\plans\codex\SYNOVA-客户A-客户项目档案-20260804.md` |
| 08-05~14 | 控制塔 V4.6 独立化；双机身份（Win/Mac）；git tag 自动化；worktree 隔离；认领制（D296）；多机 PR 工作流（D334）；数据备份（D335）；**多 Agent 协作协议（四角色两条线：开发线 Codex+DSH+Claude Code，审计线 K3）** | `docs\synova\coordination\` |
| 08-15~19 | LLM failover、L4 数据契约、哨兵阈值告警、dedup-key 稳定性；持续审计（D355-D366） | `docs\synova\audit-reports\2026-08-1*.md` |

### 这一代最重要的教训
1. **接线失败 4 次**：组件通过单元测试但从未被生产调用 → 铁律 0-2"接线验收"（grep 物理门禁）
2. **engine-core 拆分欺诈**：桥接文件伪装成迁移，tsc 被骗、运行时崩溃 → "拆完了必须由 grep 物理证明"
3. **文档-代码版本漂移**：AGENTS.md/CLAUDE.md 的版本号、组数、专家数互相矛盾（7/8/9 位专家、8/9/12/13 组 pre-commit 并存）→ 本次文档体系改革的直接动因
4. **文档膨胀**：Novis 时代 Archive 已有 433+ 过期文档，Synova 时代 docs/ 已有 532 份 md → 需要"出生即合规"机制

### 这一代留下的资产（= 当前工作区）
- synova-agent 仓库：1684 commits、AGENTS.md / CLAUDE.md / LOOP.md、docs/（532 份 md）、memory/、WORKLOG 系列
- 控制塔：pre-commit 13 组、hooks、审计脚本、任务看板（DASHBOARD）
- 多 Agent 协作体系：Codex / DSH / Claude Code（开发线）+ Kimi K3（审计线）
- 客户：**客户A**（第一个付费客户，2026-08-04 建档）
  - 获客故事（创始人口述 2026-08-20）：客户主要基于**信任**；当时客户遇到问题找过各种答案，创始人用 **Synova 诊断体系作提示词注入**对客户公司业务做诊断，得出与外部咨询公司和高管**完全不同的判断，最终证明 Synova 是对的** → 客户签约并打款
  - 资料源：`C:\Users\Administrator\Desktop\客户A项目咨询\运营文件`（50 份：合同/合伙人机制/战略计划/动员大会逐字稿/产品升级方案等）

---

## 五、时间线总表（极简版）

```
2026-03    OpenClaw 发布 → 创始人启动 ClawOrg（"Claw 的组织"，CodeBuddy 主刀）
2026-03/04  ClawOrg 启动（TAOR 引擎、多 Agent 平台）
2026-04-25  V1.0 破冰版（20 小时冲刺）
2026-04-28  定位定稿："让 Agent 团队共同进步"
2026-05-04  V1.0 发布（模板市场 / Electron 桌面端）
2026-05-15  品牌过渡开始（ARCH-00 Novis 设计文档）
2026-05-23  Novis 品牌启用（桌面端 + Synova 引擎 + 官网）
2026-05-26  E 盘备份 → D:\novis-backup-20260526（E 盘此后消失）
2026-06-02  SynovaAgent v0.1.0-beta + 第三方审计（ClawOrg 代号正式废弃）
2026-06-03  synova-agent 独立仓库（Synova 时代开始）
2026-06-17  Loop Engineering v3.0（硬阻断体系）
2026-07-06  engine-core 拆分欺诈事故 → V4.4.2 修复
2026-07-13  权威文档 01-18 系列（42 边 / 50 哨兵 / 8 专家）
2026-07-22  控制塔建立（gatekeeper / synova-commit）
2026-08-01  V4.5.1（pre-commit 13 组）
2026-08-04  客户A客户项目档案
2026-08-14  多 Agent 协作协议（四角色两条线）
2026-08-19  本编年史启动（文档体系改革）
```

---

## 六、材料索引（全盘搜索结论）

| 时代 | 位置 | 说明 |
|---|---|---|
| 三代 | `D:\novis-backup-20260526\` | **唯一幸存的历史档案库**（E 盘原始目录已不存在，勿再找 E 盘） |
| ClawOrg | `Novis\全局规划\`、`Novis\OpenClaw+X-全览\`、`Novis\work-records\`、`claude-backup-20260525\projects\E--ClawOrg-BOX\memory\` | 定位/白皮书/工作记录/会话记忆 |
| Novis | `Novis\docs\`（12 类 + Archive 433+）、`Synova-Engine\`、`Novis\box\`（桌面端）、`Novis\CHANGELOG.md` | 文档体系/引擎/桌面端 |
| Synova | 当前工作区 `synova-agent\`、`synova-session-01~04`、各 `synova-wt-*` worktree | 现役 |
| 旁证 | `D:\Git项目研究\`（claw-code-main / openclaw-main 等研究克隆）、`D:\EasyClaw`（工具） | 理解 ClawOrg 时代技术底座用 |

**月度史记草稿**（git 事实生成，审阅后并入本编年史）：`docs/authority/chronicle-drafts/2026-06.md`、`2026-07.md`、`2026-08.md`

---

## 七、待补清单（创始人回忆优先）

1. [x] **起源（2026-03）**：OpenClaw 发布 → 时代变局感（agent 平民化技术）→ 养龙虾遇协作问题 → 启动 ClawOrg（2026-08-20 口述，已补录）
2. [x] **名字由来**：ClawOrg = Claw 的组织（封装 OpenClaw 运行时的产品）
3. [ ] 04-27/28 为什么密集做定位？当时发生了什么？
4. [x] **暂停 Novis 桌面端和 SoloHub 的原因**：想法太多 → 聚焦企业咨询（可付费）→ "24 小时驻扎的麦肯锡顾问" / 免疫系统 vs 医生
5. [ ] 06-03：把 SynovaAgent 独立成仓库的决策背景
6. [x] **客户A背景**：第一个付费客户；信任 + Synova 提示词注入诊断被证明正确 → 签约打款

---

*本文件为项目史记主线，随项目持续生长。历史只增不改。*
