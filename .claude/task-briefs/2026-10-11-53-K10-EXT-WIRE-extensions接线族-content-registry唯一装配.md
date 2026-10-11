# Task Brief: #53 → K10/EXT-WIRE — extensions 接线族：4 项生产不可达 + content-registry（type→loader 唯一真源）+ 4 存量 manifest 补漏

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#53` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K10 块 · `EXT-WIRE`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：把 4 项"注册了但生产不可达"的 extensions 接上，并建**唯一 type→loader 真源** `src/deploy/content-registry.ts`，补 4 个存量 manifest。
**② 解决什么问题**：实测教训形状：「**能注册，但没接线；没接线，但不报错**」—— 加专家 6/6 degraded、加边零校验、加映射 0/8 命中、加循环静默返 0、加哨兵 20/45 不查 store。对非技术用户是最坏体验：**他以为自己配好了**。
**③ 做完对项目的推动**：这是内容面（宪章 §5.6）的**命门**：内容面的判据是"删掉 X 引擎照常启动"；不可达 ⇒ **加文件即可用**这个核心承诺失效。
**④ 🔴 不做行不行**：**不行**（禁令级）：判据本体不成立 ⇒ 整个"文件驱动"契约（约束 1）无凭据。
**⑤ 现在有什么基础（**判据实测 @ 68bf57598 ＋ 路径实测**）**：❌ **判据未达标**（见下「状态」的失败项）；已存在落点：`src/deploy/content-registry.ts`、`src/init/file-driven-loaders.ts`、`extensions/llm-providers/manifest.json`、`extensions/business-models/manifest.json`、`extensions/engine/manifest.json`、`extensions/tools/manifest.json`、`extensions/context-strategies/manifest.json`、`extensions/implementation-patterns/manifest.json`、`extensions/policies/manifest.json`、`extensions/security/manifest.json`、`scripts/control-tower/probe-content-registry.ts`；**待新建**：（无）。
**⑥ 还需要做什么**：**仅剩判据修绿**：探针 ① 段硬编码 `!== 20` 已过期（**实测磁盘 24 × 注册表 24** 双向相等，而硬编码仍是 20 ⇒ 探针 FAIL exit 1）⇒ 见新卡 **#304**（本卡同族）。
**⑦ DSH 借鉴方式**：**参考自研**：借 DSH「**按名声明、宿主满足**」—— `dsh-compaction-basic/lib/index.js:801` `static inject = [...]`（DSH 全仓实测 **7 处**同型：`agent-loop:1524`／`sandbox-policy:105`／`token-meter:608`／`permission-presets:160`／`agent-preset:10`／`authorization:60`）＋「宿主侧注册表是唯一装配点」；**不借** Cordis 代际/生命周期（宪章 §5.7：我们内容是静态文件、boot 装配）。
**⑧ 涉及代码文件**：src/deploy/content-registry.ts｜src/init/file-driven-loaders.ts｜extensions/llm-providers/manifest.json｜extensions/business-models/manifest.json｜extensions/engine/manifest.json｜extensions/tools/manifest.json｜extensions/context-strategies/manifest.json｜extensions/implementation-patterns/manifest.json｜extensions/policies/manifest.json｜extensions/security/manifest.json｜scripts/control-tower/probe-content-registry.ts

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K10 平台交付与运行时（DSH）**，架构位置 = ② 本体层 ＋ 内容面（宪章 §5.6）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在（本卡可直接复用/修改）
- src/deploy/content-registry.ts
- src/init/file-driven-loaders.ts
- extensions/llm-providers/manifest.json
- extensions/business-models/manifest.json
- extensions/engine/manifest.json
- extensions/tools/manifest.json
- extensions/context-strategies/manifest.json
- extensions/implementation-patterns/manifest.json
- extensions/policies/manifest.json
- extensions/security/manifest.json
- scripts/control-tower/probe-content-registry.ts
### 待新建（写集，尚未存在）
- （无）
结论：NOT-DONE。

## Q1: 调研
a) 业界：交付面与运行时面必须**单一入口 ＋ 可机器判**（Anthropic 工程基线：不可逆 / 对外可见的动作要有独立于执行者的判据）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ 的 file:line 证据）。
c) memory 教训：**铁律 0-2**（接线失败 4 次 —— 组件过了单测但从未被生产调用）；**判例 V-02**（grep 型不得作验收）；**判例 V-07**（假绿要用"拔掉实现照样通过"证伪）。

## Q2: 范围
做什么：
- src/deploy/content-registry.ts
- src/init/file-driven-loaders.ts
- extensions/llm-providers/manifest.json
- extensions/business-models/manifest.json
- extensions/engine/manifest.json
- extensions/tools/manifest.json
- extensions/context-strategies/manifest.json
- extensions/implementation-patterns/manifest.json
- extensions/policies/manifest.json
- extensions/security/manifest.json
- scripts/control-tower/probe-content-registry.ts
- .claude/task-briefs/2026-10-11-53-K10-EXT-WIRE-extensions接线族-content-registry唯一装配.md
不做什么：
- 不改 scripts/control-tower/probe-egress.sh
- 不改 src/routes/healthz.ts
- 不改 src/deploy/data-directory.ts
- 不改 tests/sentinel/builtin-registration.test.ts
- 不改 package.json
- 不改 scripts/control-tower/probe-packaging.sh
- 不改 .gitignore
- 不改 scripts/control-tower/probe-delivery-hygiene.sh
- 不改 src/security/pre-upload-validator.ts
- 不改 tests/security/pre-upload-validator.test.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx tsx scripts/control-tower/probe-content-registry.ts`
处理：按 §〇 ⑥ 的缺口清单逐条落地。
结果：见 Done 标准逐条（判据逐字抄自登记件）。

## 架构层: ② 本体层 ＋ 内容面（宪章 §5.6）
#CRITERIA: C

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号 —— 见 skill brief-compose D1231）
- src/deploy/content-registry.ts
- src/init/file-driven-loaders.ts
- extensions/llm-providers/manifest.json
- extensions/business-models/manifest.json
- extensions/engine/manifest.json
- extensions/tools/manifest.json
- extensions/context-strategies/manifest.json
- extensions/implementation-patterns/manifest.json
- extensions/policies/manifest.json
- extensions/security/manifest.json
- scripts/control-tower/probe-content-registry.ts
- .claude/task-briefs/2026-10-11-53-K10-EXT-WIRE-extensions接线族-content-registry唯一装配.md

## Done 标准
### 登记件 acceptance（1 条 · **逐字原文，未改写**）
- [ ] verify: `npx tsx scripts/control-tower/probe-content-registry.ts`（expectExit 0）
### 附加模板项（**非登记件原文** · 通用要求）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）
---
## 状态（判据实测 · 独立复核回写 R2 · 2026-10-11）

基线：`68bf5759878a458b5e5ceb324a32878660155517`（**本分支 base**，非旧 as_of）
判定：**NOT-DONE**（判据逐条：FAIL）
登记件 status：`todo` ｜ 来源卡：#53

❌ 判据未达标 —— 失败项见 Done 段。

### 复核回写轮次
R1 修订：as_of 重钉 ／ Q0 分「已存在/待新建」／ Done 抄登记件原文 ／ 去失效跨引。
**R2 修订（据第二轮独立复核）**：① 修 R1 的**路径分类 bug** —— 登记件写 `src/cron/**` 这类 glob，R1 按字面测试 ⇒ 把**已存在目录**误判成「待新建」（本轮已剥 glob 后缀重测）；② 修告示不实 —— 登记件 acceptance 只有 1 条，R1 曾把 3 条整体标为「逐条原文」，现**拆分为「登记件原文」与「附加模板项」**；③ 「全仓实测 N 处」等**末经复算的手写数**改为实测值。
⚠️ 本卡 Done 内含的探针/测试若**不存在**，属「判据件待建」，非「已存在」。

