# Task Brief: #52 → K10/BS-5 — BS-5 交付打包卫生：Dockerfile 路径 + 三处版本号统一 + sourcemap 泄漏核查

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#52` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K10 块 · `BS-5`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：交付包卫生三件：Dockerfile 路径正确、**版本号单一来源**、不泄漏 sourcemap。
**② 解决什么问题**：⚠️ **本项判据实测全绿 —— 问题已不复现**（详见文末「状态」）。登记件 `status` 与卡片 state 不一致，本卡转为**回归/收口**用途；执行方不得按"未完成"照单重做。
**③ 做完对项目的推动**：交付面是客户的**第一接触面**；打包不卫生 = 客户镜像里带宿主绝对路径（`/Users/wane` 一类）⇒ 信息泄漏 ＋ 构建不可复现。
**④ 🔴 不做行不行**：**不行**：泄漏宿主路径是信息泄漏，且不可复现构建会让"客户装不上"无法定位。
**⑤ 现在有什么基础（**判据实测 @ 68bf57598 ＋ 路径实测**）**：✅ **判据全绿 —— 本项已完成**（见下「状态」）；已存在落点：`Dockerfile`、`package.json`、`scripts/control-tower/probe-packaging.sh`；**待新建**：`scripts/build/**`。
**⑥ 还需要做什么**：无需再做什么；如需加固仅保持判据绿（写集不变）。
**⑦ DSH 借鉴方式**：**自研**：DSH 是桌面宿主 + npm 包形态，**不出客户镜像**，无"Dockerfile/版本号单一来源/交付包卫生"语义 ⇒ DSH 无对应物可借（诚实标注）。
**⑧ 涉及代码文件**：Dockerfile｜package.json｜scripts/build/｜scripts/control-tower/probe-packaging.sh

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K10 平台交付与运行时（DSH）**，架构位置 = −1 运行时（交付面）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在（本卡可直接复用/修改）
- Dockerfile
- package.json
- scripts/control-tower/probe-packaging.sh
### 待新建（写集，尚未存在）
- scripts/build/**
结论：ALL-PASS。

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
## 状态（判据实测 · 独立复核回写 R2 · 2026-10-11）

基线：`68bf5759878a458b5e5ceb324a32878660155517`（**本分支 base**，非旧 as_of）
判定：**ALL-PASS**（判据逐条：PASS）
登记件 status：`todo` ｜ 来源卡：#52

✅ 判据全绿 —— 本项**已完成**；卡应 closed（本卡作回归/收口）。

### 复核回写轮次
R1 修订：as_of 重钉 ／ Q0 分「已存在/待新建」／ Done 抄登记件原文 ／ 去失效跨引。
**R2 修订（据第二轮独立复核）**：① 修 R1 的**路径分类 bug** —— 登记件写 `src/cron/**` 这类 glob，R1 按字面测试 ⇒ 把**已存在目录**误判成「待新建」（本轮已剥 glob 后缀重测）；② 修告示不实 —— 登记件 acceptance 只有 1 条，R1 曾把 3 条整体标为「逐条原文」，现**拆分为「登记件原文」与「附加模板项」**；③ 「全仓实测 N 处」等**末经复算的手写数**改为实测值。
⚠️ 本卡 Done 内含的探针/测试若**不存在**，属「判据件待建」，非「已存在」。

