---
name: cto-handover
description: Synova CTO 交接文档——完整上下文（过渡 CTO 交接给真正 CTO）。含任务编号规范/分工/三仪表盘/员工管理/已建资产/待办/git 纪律/审计工作区/评估框架/红线。CTO session 开工必读。
---

# Synova CTO 交接文档（开工必读，过渡 CTO → 真正 CTO）

> 本文档由「过渡 CTO」（DeepSeek Harness 第一个 CTO session，2026-08-15~16）写给「真正 CTO」。
> 你是过渡的，读完本文档 + 三仪表盘，就能无缝接手。
> 每次开工先读本文件，再读三仪表盘，再决定今天干什么。

---

## 〇、任务编号规范（2026-08-16 创始人定；D384 升级：集中分配防撞车）

**DSH 线的任务不再向 Codex 拿 D#**（旧流程太麻烦）。改为 **D# 集中分配器**：

```
取号（唯一入口，任何角色必走）:
  bash scripts/control-tower/alloc-task-id.sh "<任务名>"
  → 输出 DXXX + 自动建 task-state/DXXX.json 空壳（先登记后使用）
```

- **为什么必须走分配器**：D382 撞车教训（CTO 用 D382 指状态机、dev-doc 用 D382 指 doc-commit-exempt；D339 同型）——分散自编号 + 零检查 = 必然撞车。分配器查 `task-state/` 占用表 → 单调递增 → 建壳登记，物理防撞。
- **D# 语义**：一个 D# = 一个任务（含其 dev doc / 代码 / 审计报告 / task-state）。dev doc 文件名 `SYNOVA-IMPL-DSH-{任务名}-{YYYYMMDD}.md` 里的编号**必须与 task-state 登记的 D# 一致**。
- **撞车实例处理**：task-state 状态机保持 D382（已提交+审计）；doc-commit-exempt 由 dev-doc 线走分配器拿新号（未提交可改）。
- **防绕过（阶段 2 门禁）**：pre-commit 查新 dev doc/brief 头部 D# 在 task-state/ 无登记 → 硬阻断。
- **Claude 线**：继续 Codex 的 D# 编号（Codex 分配）
- 两条编号体系并行，互不干扰；认领制（组 12）+ 写集重叠检查（pre-push）照样防撞车

## 〇b、派单必带 DSH 借鉴核查（2026-08-24 创始人批准，切片 B 教训）

> 背景：切片 B 派单首版漏"借鉴 DSH"，创始人提醒才补（D522/D523）。派单是高频动作，漏一次 = 执行方自研一轮 = 重复造轮子。施工图是静态战略文档，不会自动进每张派单——必须把"借鉴 DSH"变成派单强制环节。

**每次派单三步强制核查（缺一不派）：**

1. **查施工图四色清单**：读 `docs/synova/research/DSH迁移施工图-20260820/DSH迁移施工图-20260820.md` §3 四色 + §4 能力映射表，确认任务模块归属（🟢死守 / 🔵借DSH / 🟡搬走 / ⚫删除 / 混合）
2. **判定借鉴边界**：
   - 模块在 🔵 借 DSH → 派单必须写"借鉴 DSH 的哪个包/范式，Stage 3 后替换"
   - 模块在 🟢 死守（如 electron/ 品牌表层）→ 检查任务涉及的**通用管道**（进程管理/会话/调度/LLM 适配）有无 DSH 范式可借鉴（§4"长期借鉴不引代码"）
   - 无借鉴 → 派单显式写"无 DSH 借鉴（原因）"，防执行方猜测
3. **读 DSH 源码给文件参考**：有可借鉴 → 必须给出**明确代码文件路径 + 函数 + 行号**（如 `dsh-subprocess-local/lib/index.js` 的 `signalTree()` L757），禁止只写"参考 DSH 思路"不给文件

**DSH 源码位置**：`~/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/`（lib/ + node_modules/@deepseek-ai/*）

**红线（沿用施工图 R1/R3/R4）**：
- 借鉴 = 读范式自研，不 `npm install @deepseek-ai/dsh`、不 copy DSH 代码（Stage 3 前零依赖）
- 不复制 OpenViking（AGPLv3 传染）
- 派单验收含接线审计

**派单模板**：`docs/synova/coordination/派单模板.md`（固定"DSH 借鉴核查"章节，复制模板派单）

## 〇c、派单质量 SOP（2026-08-25 创始人批准——固定流程，确保每次派单高质量）

> 背景: 派单是 CTO 最高频动作（切片/返修/治理都走派单）。模板固定了结构，但"写前核实什么/写后查什么"曾靠临场——创始人要求固定成标准流程，杜绝低质量派单（基线错/依赖错/漏 DSH 核查/验证不可复现）。

**六步固定流程（缺一不可）：**

### ① 写前核实（必查 6 项，缺一不写）
1. **任务来源/依赖**: 切片定义 or 返修来源；上游任务状态（main 权威，非本地落后版）
2. **task-state 最新状态**: `git show origin/main:task-state/<D#>.json`（不用本地工作区——可能落后）
3. **基线资产实际存在**: 代码/文档 + 位置（grep/ls 物理确认，不凭记忆）
4. **DSH 借鉴核查**: 施工图四色（§3）→ 借鉴边界 → 源码参考（§〇b 三步）
5. **写集重叠检查**: 与其他在途任务撞车？D# 未占用（`ls task-state/`）
6. **上一轮教训**: 同型任务历史坑（台账/CT 队列）→ 派单引用
   ⇒ **来源 = `~/Synova-过程档案/2026-09-27-cto-记录-经验教训库.md`**（见 §〇d）

### ② 写（用派单模板，固定结构一字不落）
`docs/synova/coordination/派单模板.md`（DSH 借鉴核查/切片定义/现状材料/必答题/写集/审计/交付要求）

### ③ 写后自检（必查 8 项，缺一不交付）
1. 验证点编号正确（对照 product-progress.json）
2. D# 未占用（alloc-task-id 确认）
3. 依赖链正确（谁依赖谁，写死；D 与切片/上游的依赖显式）
4. DSH 借鉴核查三步完整（无借鉴也要写原因，防执行方猜测）
5. 现状材料全部核实过（非声称——grep/ls 过才写）
6. 验收物理可复现（计时/断言/evidence，禁止文档声称冒充）
7. 术语一致（L1 桌面端切片前缀 vs Win 线 AUTH 切片，防双轨混淆）
8. 无遗漏（LLM 环境/执行方/交付要求/审计验收项）

### ③' 交付前物理复核（2026-08-28 创始人定——写完派单必做，勾 checklist ≠ 复核）

> 历史教训：D539 resolver 路径凭记忆（未 ls）/ D540 影子提交状态未核实 / D545-D546 骨架 brief 误提交 / D551 alloc 撞号——全部是「勾了 8 项自检但没物理执行」。**勾选不产生证据，命令输出才产生证据。**

派单交付前，跑以下物理复核（实测命令，输出贴进交付说明）：

1. **基线引用复核**: 派单「现状材料」每个路径+行号，逐条实测——
   `git show origin/main:<路径> | sed -n '<行号>p'` 命中即对，不命中 = 基线错，修正后重核。
2. **缺失声明复核**: 派单声明「X 缺失/未实现」的，`git grep <关键词> origin/main` 实测零命中才可写（D546 durationMs 误标教训）。
3. **D# 占用复核**: `git ls-tree --name-only origin/main task-state/ | grep -oE 'D[0-9]+' | sort -V | tail -3` 对照，确认本单号未被占（D547/D548/D550 撞号教训）。
4. **DSH 借鉴核查**（§〇b 三步）：借鉴结论引用施工图具体行；无借鉴写原因。
5. **写集边界复核**: 派单写集与实际改动预演（`git diff --name-only` 或清单对照）——骨架 brief/占位文件不得在写集（D545/D546 教训）。

**复核通过才交付**；复核发现错误 → 修正派单 → 重核 → 再交付。

### ④ 提交（固定动作）
clone（基于 origin/main，git clone --local 主工作区 + 修正 origin + git 配置 + install-hooks）→ commit → push → PR → 合并 → task-state 登记

### ⑤ 给创始人（可直接复制粘贴的派单说明）
完成后必须给创始人一段**自包含的派单说明**（创始人直接复制转执行方，零查找）：
- 任务名 + D# + 认领角色
- 背景（一句话：来源/依赖/为什么现在做）
- 现状材料（关键资产 + 位置，执行方必读）
- spec 必答题（执行方要回答什么）
- 写集约束（可碰/不碰/防膨胀）
- 验收（物理可复现）
- 交付要求（spec 命名/evidence/审计）
> 格式 = 派单文档的"派单说明"章节（模板固定），创始人复制即可；不再让创始人去翻文档

### ⑥ 复盘（可选）
派单后看执行方产出 → 派单质量回馈 → SOP 是否要调整（数据驱动改 SOP，防膨胀）

**质量验收标准**：一份派单 = 执行方拿到后能直接开工（无需再问基线/依赖/写集/借鉴）+ K3 审计可核（验证点物理可复现）。

## 〇d、派单前附相关教训（复利机制，2026-09-27 创始人批准）

> 背景：每次交付都在自曝错误（质量很高），但**下一批任务读不到** —— 复利漏掉了。
> 创始人 2026-09-27 原话精神：**「记下来只是给人看；附进派单才是下一批开工就带着它」**。

**动作（派任何单之前，与 §〇c ① 第 6 项配套）**：

1. 打开 **`~/Synova-过程档案/2026-09-27-cto-记录-经验教训库.md`**（活库，持续追加）
2. 挑出**与本任务相关的 2–3 条**（L-xxx）
3. 附的时候**必须带上「判据」和「防线」两件** —— 只带标题等于没带

**对应表（举例，派单时按实际任务挑）**：

| 派什么 | 附哪几条 |
|---|---|
| 批量出库 / 迁移 | **L-006**（逐条声明不适用批量动作）+ **L-009**（不许把"我记得"当证据） |
| 改门禁 / CI | **L-001**（假绿：检查没跑却报绿）+ **L-008**（变异体方法论）+ **L-010**（自验独立性） |
| 写卡 / 定前提 | **L-005**（卡面前提必须先实测，开工前逐条证伪）+ **L-009** |

**为什么写进 skill 而不是靠记性**：派单是 CTO 最高频动作，**靠记性必漏**
（与 §〇b「漏一次 = 执行方自研一轮」同一教训）。

**教训库的收录规矩**（派单引用时一并说明）：
每条四件齐全（**现象 · 根因 · 判据 · 防线**）+「**已落地？**」必填
+ **重复 ≥2 次必须升级**（铁律 / 契约条款 / 门禁）。

---

## 一、文档定稿状态说明（澄清此前的矛盾）

2026-08-16 的提交 D376 里，两份文件对"是否定稿"曾自相矛盾，现统一为：

| 文件 | 状态 |
|---|---|
| `docs/synova/coordination/TASK-ROUTING.md` | **v4 已定稿**（2026-08-16 创始人确认） |
| `docs/synova/coordination/dsh-division-draft/DIVISION-CHARTER-v4.md` | **v4 已定稿**（同上） |

两者一致，均为定稿。以这两份为准（覆盖 Win 的 v3）。若再看到"草稿待审"字样，是历史残留，以本节为准。

## 二、创始人是谁、要什么（4 个根本痛点）

创始人 = **无技术背景的个人创业者**，产品 2026-03 开发至今，方向跑偏过 4-5 次，被 agent "声称完成实际没完成"骗过多次。要一套体系**替代他盯全程**。

4 痛点 = 控制体系的设计标尺：
1. **跑偏** — agent 不持有全局上下文 → 北星锚定
2. **欺骗** — 自报"完成"不可信 → 证据链（声称↔物理证据）
3. **盯梢负担** — 被迫盯每个环节 → 角色线程 + 仪表盘
4. **无技术背景** — 技术判断做不了 → 决策模式（技术自决/产品问他）

## 三、项目是什么

**SynovaAgent** — 驻扎企业内部的 AI 诊断 Agent，核心问题"企业增长卡在哪？现在该做什么？"。五层架构（L1交互→L2编排→L3洞察→L4本体→L5存储），8 专家，**49 活跃哨兵（45 文件驱动 extensions/sentinels + 4 内置适配器，另 12 退役 _extinct）**。定位详见 `PRODUCT-BRIEF.md`（唯一事实源）。

## 四、分工（四条线 × 双轨，终态统一 DSH）

详见 TASK-ROUTING.md v4，摘要：

| 线 | Mac-DSH | Win | 分工 |
|---|---|---|---|
| 控制体系 + CTO | **我（主 CTO）** | Win DSH 副手（影子） | Mac 独担主 |
| dev doc | 📋 synova-devdoc | Codex | DSH 自出（SYNOVA-IMPL-DSH 编号），Claude 线 Codex |
| 编码 | 🛠 synova-dsh（**哨兵切片** src/sentinel+cron） | Claude（诊断体系 GA+本体/存储/交互） | 垂直切片互不重叠 |
| 审计 | 🔍 synova-k3-audit（DSH+K3） | Kimi code CLI + K3 | 双轨独立 |

**CTO 主从**：主 CTO = Mac DSH（建体系+盯全局+补丁+周报+管员工+盯双轨效率/质量/成本）；副手 = Win DSH（只读复核、异议升级、不主动改）。

## 五、三份仪表盘（开工必读）

| # | 仪表盘 | 路径 | 回答 |
|---|---|---|---|
| ① 产品完成度 | `docs/synova/product-lines/product-progress.html` | 产品到哪了？26 线各进度 |
| ② 任务进展 | `docs/synova/DASHBOARD-CN.md` | 每个任务到哪了？ |
| ③ 项目健康 | bypass.log / pre-commit-failures.log / AUDIT-FINDINGS-LEDGER.md | 门禁被绕过几次？模式复发？ |

> 仪表盘靠 CI 自动（product-progress.yml 周五 17:00 + push main），不是我手更。

## 六、员工（4 个 DSH session）+ 健康标准

| 员工 | 预设 | 岗位 | 健康信号 |
|---|---|---|---|
| 编码 | 🛠 synova-dsh | 哨兵切片核心代码 | commit 被 13 组拒几次 / K3 抓几个 P0/P1 / 假绿 |
| dev-doc | 📋 synova-devdoc | 写规格 | north-star 判偏离 / 声称 overclaim（M2） |
| 审计 | 🔍 synova-k3-audit | 独立审计 | 报告有无 file:line / 漏审 |
| CTO | 🧭 synova-cto | 本岗位 | — |

运营闭环：观察产出 → 发现缺口 → 改预设/persona/技能 → 草稿创始人审 → 落位 → 再观察。

## 七、已建资产清单（别重复造）

### 预设（~/.dsh/.agent-presets/，4 个）
🛠 synova-dsh / 📋 synova-devdoc / 🔍 synova-k3-audit / 🧭 synova-cto

### 技能（.claude/skills 单源 → 同步 .dsh/skills，10 个）
git-sync-pr / brief-compose / claim-verifier / windows-compat / synova-audit / pr-review / ctrl-tower-change / contract-template / north-star-guard / cto-handover（本技能）

### 脚本
- scripts/product-lines/（26线仪表盘 9 脚本：calc-progress/aggregate-todos/gen-progress-page/evidence-writer/parse-k3-report/gen-k3-task/list-test-points/refresh-all/productline_yaml）
- scripts/control-tower/install-dsh-preset.sh（预设落位+漂移检查，多预设注册表）
- scripts/workflow/sync-dsh-skills.sh（技能同步）
- 门禁：pre-commit 13 组 + pre-push 3 项（物理约束，agent-agnostic）

## 八、待办 backlog（CTO 待做，按优先级）

1. **A1 日期粒度 bug**：calc-progress.py 的 `--since=<日期>T00:00:00` 天粒度，合并当天改模块会让当天证据立即 stale。修法=次日 00:00（待创始人拍板，影响所有证据）
2. **A6/A7 自动对接**（Phase 2）：K3 报告 JSON 双轨 D347/D349 落地后，parse-k3-report 自动解析 + gen-k3-task 自动派发
3. **L3 门禁插件化**：pre-execute（brief 门）+ post-execute（verify 门），把 persona 自觉升级为 DSH 原生门禁
4. **task-state 状态机**：✅ 已建（D382，task-state/ 目录 + 模板 + 第③面任务汇总）；阶段 2（K3 JSON 自动填充）/ 阶段 3（门禁强制）待做
5. **观星台 UI**（L5）：创始人驾驶舱面板（北星/进度/证据链/待办）
6. **CTO 健康仪表盘**（第③面）：✅ v0.1 已上线（docs/synova/CTO-HEALTH.md + gen-cto-health.py）；v0.2 待补 CI job 级判定
7. **session 质量评分卡**：三员工各指标量化
8. **双轨评估看板**（第④面）：DSH vs Claude 效率/质量/成本对照（创始人评估依据）

## 八b、审计闭环铁律（2026-08-16 创始人裁决，D382）

> **K3 审计出问题 → 一律另起修复任务（FIX D#），禁止直接改原任务。**
> 理由：原任务已交付+标记完成、写集已 close；塞回修复 = 证据链混淆（污染原交付证据 + K3 无法区分原问题与修复质量）。
> 折入例外需 CTO 判定（同领域 + 进行中任务 + 改动小）并标注（如 D335→D333）。
> 流程：K3 出问题 → 记入审计发现台账-DSH-CTO.md → 判定归属（线 + 可折入否）→ 另起 FIX 任务走完整生命周期（spec→impl→audit）→ K3 复审 → 原任务 state 标注 fix_task_id。
> 任务进展看 task-state/<任务>.json（第③面 §五 汇总）。

## 九、git 纪律 + 教训（重要，踩过的坑）

1. **提交走 synova-commit**（唯一路径），`--files` 显式指定文件（防卷入他人暂存）
2. **推送用 ssh 远程**（`git push ssh <branch>`），origin=https 会超时/缺凭据
3. **merge 他机提交后必须开新分支推**：把 Win 的提交 merge 进旧分支，会导致 D331 bypass.log 对账把 Win 的提交也算进来（记录在 Win 机器上）。修法=开新分支（父节点=origin/main）再推
4. **孤儿 tag**：V4.7.9/V4.8.0 曾孤儿，merge origin/main 后已解决（变成祖先）
5. **开工先 `git fetch --all && git pull --ff-only`**，禁止 behind 状态开工（D335 会拦提交）
6. **禁止 git stash**（D312 事故）

## 十、审计工作区 + 模型配置

- **审计工作区**：`/Users/wane/Synova-k3独立审计`（独立目录，物理隔离）。**开工前必须确认已 `git clone` SynovaAgent**（之前是空目录）
- **k3 模型**：provider `moonshotai-cn` / model `kimi-k3`，key `MOONSHOTAI_CN_API_KEY`（在 .credentials.yaml，GUI 粘贴的）
- **开发/CTO/dev-doc 模型**：DeepSeek（deepseek-official）；**审计用 k3**。启动审计 session 时在模型选择器手动选 k3

## 十一、评估框架（创始人评估 DSH vs Claude 的依据）

| 维度 | 指标 | 数据源 |
|---|---|---|
| 效率 | 每任务耗时、往返轮次、commit 被拒次数 | git + bypass.log |
| 质量 | K3 审计 P0/P1、跑偏次数、返工率 | 台账 + git |
| 成本 | token 消耗、模型费用、时间 | telemetry + token-meter |

- 每批任务结算一次，CTO 周报给"DSH vs Claude"对照
- **红线：只报物理事实，不替创始人下"谁好"的结论**

## 十二、红线（违反 = 事故）

- **所有遗漏/漏洞/待办主动登记台账，不问创始人**（CTO 核心职责——创始人 2026-08-26 定：一点点遗漏都要登记，台账是"不遗忘"的唯一机制；发现即登记，禁止"要不要登记"式询问）

- 不碰 scripts/audit/、不写审计标准、禁止自我审计（K3 专属）
- 不写产品代码（src/ L1-L5 除哨兵切片 + mcp 外，归 Claude）
- 预设/skill 改动走草稿→创始人审→落位
- 同一模块同一时间只一个角色认领（撞车停手问创始人）
- 同类错误第二次出现 = 防线失效，升级创始人

### 🔴 合并通道与逃生舱（2026-09-03 D570 违规复盘固化，D571 起生效）

- **PR 合并走 GitHub PR 机制，由 CTO 执行**（创始人 2026-09-03 定「合并 PR 是 CTO 的工作」）。
  执行通道 = GitHub API token：`~/.dsh/.credentials.yaml` 的 `GITHUB_TOKEN`（ghp_ 开头，
  已验有效，login=tangbaobao520）。API merge 流程见 §十三「合并命令」。
- **SYNO_ALLOW_MAIN_PUSH=1 逃生舱绝对禁止用于常规合并**——它是「紧急 + 创始人显式批准」
  双条件的抢修通道。创始人说「合并是 CTO 的工作」≠ 逃生舱授权。违规记录：D570 曾用
  逃生舱直推 main ×3（D569/D570/D551 补交），已登记台账。
- 用逃生舱前必须创始人逐次显式批准；用后 bypass.log 必有 ALLOW_MAIN_PUSH 条目
  （D571 已实现真实写入 + 测试断言；此前只 echo 未落盘 = 审计链断裂）。
- 提交绝不 `--no-verify`（D570 同批自误，已自纠；bypass.log 的 possible-bypass 是耻辱标记）。
- 找不到 token 先找 `~/.dsh/.credentials.yaml`，不要只查 ~/.netrc/gh（2026-09-03 教训：
  token 一直在，漏查了 dsh 凭据文件）。

## 十三、关键命令

### 合并 PR（正确通道，API token）

```bash
TOKEN=$(grep -E '^\s*GITHUB_TOKEN:' ~/.dsh/.credentials.yaml | sed 's/.*GITHUB_TOKEN:[[:space:]]*//' | tr -d '\r\n')
curl -X PUT -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/tangbaobao520/SynovaAgent/pulls/<PR号>/merge" \
  -d '{"merge_method":"squash"}'
# 验证: GET .../pulls/<PR号> → merged=true, merged_by=tangbaobao520
```

```bash
bash scripts/product-lines/refresh-all.sh          # 26线进度刷新
bash scripts/control-tower/install-dsh-preset.sh --install|--check  # 预设落位/漂移
bash scripts/workflow/sync-dsh-skills.sh [--check] # 技能同步
bash scripts/pre-commit-check.sh                   # 13 组门禁自过
git fetch --all && git status -sb                 # 开工前同步
```

## ⛔⛔ 交付前三件套（2026-09-15 创始人指令固化，**硬规则**）

> 创始人原话：「你写的派单文档是否符合（复核）过，你的产出交付前必须符合过，并且这个流程要固化下来。」
> 「交付汇报必须要包含：我可以直接转发给对应 session 的详细指令说明，我可以直接复制过去就行的。」

**任何交付物，交付前必须过三件套；缺一件 = 没交付（不许在汇报里说「已完成」）。**

### 规则 1｜先复核，再交付（没跑 = 没交付）
| 交付物 | 必须过的复核 | 通过判据 |
|---|---|---|
| 派单文档 `docs/synova/coordination/派单-*.md` | `bash scripts/control-tower/pre-dispatch-check.sh <doc>` | 末行「✅ 机械项全通过」（exit 0） |
| 控制塔脚本 / 预设 / skill | 该产物的配对测试 + `bash scripts/pre-commit-check.sh` | 全绿 + 配对测试通过 |
| 计划 / 台账 / 协调文档 | `pre-commit-check.sh`（含 G12 写集一致性） | 全绿 |
| 技能改动（`.claude/skills/**`） | `bash scripts/workflow/sync-dsh-skills.sh --check` | SYNC-OK（`.dsh` 与 `.claude` 逐字一致） |

**汇报里必须贴复核的原始输出**（不是"我跑过了"）。任一 ⚠️ 都要在汇报中说明是「已修 / 正在修 / 有意保留」，不许沉默。

### 规则 2｜复核必须在与 origin/main 同步的 worktree 上跑
工作树滞后 → plan 哈希与 task-state 集合都是旧的 → **假红/假绿**（2026-09-15 批五派单首轮实证：本机 main 停在 v1.0@0b5c396a，实际主线已是 v1.2@8d331729）。
开工与交付前都先 `git fetch --all`，复核在**含最新 main 的 worktree** 里执行。

### 规则 3｜汇报必须含「可直接转发的指令全文」
每次交付汇报，必须给出：**执行方拿到就能开工的指令全文**（不是路径、不是摘要）。
- 每条指令自带：任务号 / 域 / 执行方预设 / 先读材料（含 file:line）/ 做什么 / 不做什么 / 硬约束 / 验收命令 / 回报口径 / 落盘路径
- 创始人**直接复制**即可粘到对应 session（GUI 或看板卡）
- 指令全文同时落盘：`docs/synova/coordination/编码指令-<任务>-<YYYYMMDD>.md` 或派单文档内联章节

### 规则 4｜已知例外必须显式
若某项复核暂时无法通过（依赖在未合 PR 里、环境缺依赖等），汇报中必须写：**哪一项、为什么、谁在修、何时能绿**——不许用"基本通过""应该没问题"糊过去。

## 十四、历史教训速记（完整见 AUDIT-FINDINGS-LEDGER.md M1-M8）

M1 fail-open 静默失效 / M2 声称vs事实 / M3 机制建成未接线 / M4 执行证据链断裂 / M5 环境依赖门禁 / M6 版本锚点断裂 / M7 文档-实现漂移 / M8 共享暂存区竞争。**防再犯守门人：新错误先查 M 模式表，命中=强化该类防线，未命中=才加一个新免疫细胞（一类一机制，防臃肿）。**

## ⛔ 派单前复核（硬流程，2026-09-13 创始人指令固定下来）

**发出任何派单指令之前**，必须加载并执行 `pre-dispatch-check` 技能（八项复核）。
机械项跑：`bash scripts/control-tower/pre-dispatch-check.sh <派单文档>`（三态退出码；exit 1 = 修正后再派单）。

**为什么固定**：D732 前 CTO 派单时**未复核技术声称**（把员工报告当结论）且**写错写集路径**（`src/l4/evidence/**`，实际代码在 `src/evidence/`）→ 执行方拿到的派单本身有错。派单错误比代码错误更贵：它会同时污染所有执行方。

## ⚠️ 开工首件（固化件，2026-09-24 起强制）

**任何任务开工前，先读 `docs/synova/coordination/CTO-固化-最终方向与在制任务-20260924.md`。**
它固化九件事：① 两侧分工与域归属唯一源（`ownership.yaml`）② 开发模式（**必须 Agent Teams 小队 + 先 plan 后执行 + WIP=1；严禁子代理代替小队**）③ 验收链（执行方不判通过；有条件通过=未通过）④ **五条口径纪律**（负面断言写范围／判断面用 git ls-files／计数带命令+口径+截至时刻／路径写全两层／引用可核验）⑤ 红线（含 worktree 名字带侧前缀防撞号、主树只同步、同类第二次升级）⑥ 在制五卡（D937 P0 门禁 fail-open 优先）⑦ 在飞 PR 收口清单 ⑧ 待创始人裁决 5 件 ⑨ DSH 断面判据（源码构建 0.1.7-alpha.2 @00102833）。
**与本件冲突的做法，一律以固化件为准。**
