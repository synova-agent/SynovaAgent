# Task Brief: #52 → K10/BS-5 — BS-5 交付打包卫生：Dockerfile 路径 + 三处版本号统一 + sourcemap 泄漏核查

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#52` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K10 块 · `BS-5`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：交付包卫生三件：Dockerfile 路径正确、**版本号单一来源**、不泄漏 sourcemap。
**② 解决什么问题**：实测：Dockerfile COPY 路径错；版本号散在三处易漂移；`.map` 泄漏面未核。
**③ 做完对项目的推动**：交付面是客户的**第一接触面**；打包不卫生 = 客户镜像里带宿主绝对路径（`/Users/wane` 一类）⇒ 信息泄漏 ＋ 构建不可复现。
**④ 🔴 不做行不行**：**不行**：泄漏宿主路径是信息泄漏，且不可复现构建会让"客户装不上"无法定位。
**⑤ 现在有什么基础（**事实台账 @ 68bf57598**）**：登记件 `status`=`todo`；**本卡判据实跑 1/1 PASS**（逐条见文末「状态」，真 git 仓库 ＋ 真 sqlite）；已存在落点：`Dockerfile`、`package.json`、`scripts/control-tower/probe-packaging.sh`；**待新建**：`scripts/build/**`。
**⑥ 还需要做什么**：无需再做什么；如需加固仅保持判据绿（写集不变）。
**⑦ DSH 借鉴方式**：**自研**：DSH 是桌面宿主 + npm 包形态，**不出客户镜像**，无"Dockerfile/版本号单一来源/交付包卫生"语义 ⇒ DSH 无对应物可借（诚实标注）。
**⑧ 涉及代码文件**：Dockerfile｜package.json｜scripts/build/｜scripts/control-tower/probe-packaging.sh

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K10 平台交付与运行时（DSH）**，架构位置 = −1 运行时（交付面）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在
- Dockerfile
- package.json
- scripts/control-tower/probe-packaging.sh
### 待新建（写集，尚未存在）
- scripts/build/**
结论：**本 brief 不下完成/未完成结论**（见文末「状态」的事实台账与待裁项）。

## Q1: 调研
a) 业界：交付面与运行时面必须**单一入口 ＋ 可机器判**（Anthropic 工程基线：不可逆 / 对外可见的动作要有独立于执行者的判据）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ 的 file:line 证据）。
c) memory 教训：**铁律 0-2**（接线失败 4 次 —— 组件过了单测但从未被生产调用）；**判例 V-02**（grep 型不得作验收）；**判例 V-07**（假绿要用"拔掉实现照样通过"证伪）。

## Q2: 范围
做什么：
- Dockerfile
- package.json
- scripts/build/
- scripts/control-tower/probe-packaging.sh
- .claude/task-briefs/2026-10-11-52-K10-BS-5-交付打包卫生-Dockerfile-版本号-sourcemap.md
不做什么：
- 不改 scripts/control-tower/probe-egress.sh
- 不改 src/routes/healthz.ts
- 不改 src/deploy/data-directory.ts
- 不改 tests/sentinel/builtin-registration.test.ts
- 不改 src/deploy/content-registry.ts
- 不改 src/init/file-driven-loaders.ts
- 不改 extensions/llm-providers/manifest.json
- 不改 extensions/business-models/manifest.json
- 不改 extensions/engine/manifest.json
- 不改 extensions/tools/manifest.json
- 不改 extensions/context-strategies/manifest.json
- 不改 extensions/implementation-patterns/manifest.json
- 不改 extensions/policies/manifest.json
- 不改 extensions/security/manifest.json
- 不改 scripts/control-tower/probe-content-registry.ts
- 不改 .gitignore
- 不改 scripts/control-tower/probe-delivery-hygiene.sh
- 不改 src/security/pre-upload-validator.ts
- 不改 tests/security/pre-upload-validator.test.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/probe-packaging.sh`
处理：按 §〇 ⑥ 的缺口清单逐条落地。
结果：见 Done 标准逐条（判据逐字抄自登记件）。

## 架构层: −1 运行时（交付面）
#CRITERIA: D

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号 —— 见 skill brief-compose D1231）
- Dockerfile
- package.json
- scripts/build/
- scripts/control-tower/probe-packaging.sh
- .claude/task-briefs/2026-10-11-52-K10-BS-5-交付打包卫生-Dockerfile-版本号-sourcemap.md

## Done 标准
### 登记件 acceptance（1 条 · **逐字原文，未改写**）
- [ ] verify: `bash scripts/control-tower/probe-packaging.sh`（expectExit 0）
### 附加模板项（**非登记件原文** · 通用要求）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）
---
## 状态（**事实台账** · 不由本 brief 合成结论 · R3 · 2026-10-11）

- 基线：`68bf5759878a458b5e5ceb324a32878660155517`（本分支 base）｜ 判据工作树：`/tmp/kb-work`（真 git 仓库 ＋ 真 `sqlite3`）
- 登记件 `status`：`todo` ｜ 来源卡：#52
- **本卡判据实跑：1/1 PASS**

| # | 判据命令 | expect | 实跑 exit | 判定 |
|---|---|---|---|---|
| 1 | `bash scripts/control-tower/probe-packaging.sh` | exit 0 | 0 | PASS |

### 待 CTO 裁定的矛盾项（**本 brief 无权下结论**）
- 登记件 `status`=`todo` ↔ Gitea #52 state 须对齐（CTO 裁）

> 「已完成 / 未完成」**不作为本 brief 的结论**：登记件中已有判据被**自行作废**（#19）、**假绿**（#22 单测绿/真库无表；#55 断言 fail-open）、**结构性跑不通**（#3）、**语法坏**（#27/#43），
> 任一情形下「exit 0 ⇒ 已完成」都不成立。开工/关单请以 CTO 对上述待裁项的裁定为准。

