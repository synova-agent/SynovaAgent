# Task Brief: #55 → K10/BS-6 — BS-6 pre-upload-validator fail-closed 改造【待创始人裁 A/B 后转 todo】

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#55` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K10 块 · `BS-6`）
> 批次：第1批 ｜ 登记件 status：`proposal` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：把**上传前校验器**从 fail-open 改成 **fail-closed**（校验器自身失败时**拒绝**，不是放行）。
**② 解决什么问题**：实测三条静默失效路径（院方《边界C》§2.6）⇒ 校验器自身失败时"放行"，最坏结果是**未校验内容出厂**，且无任何告警。
**③ 做完对项目的推动**：宪章 §6.2「可见性承诺」要求"发什么、发多少"可查 ⇒ 校验器是其中一个执行点；fail-open 会让承诺**在失败时静默失效**。
**④ 🔴 不做行不行**：**不行**（禁令级）：fail-open 的校验器 = **假绿**（判例 V-07「拔掉实现照样通过」/ M-02 三态退出码同型）。
**⑤ 现在有什么基础（**事实台账 @ 68bf57598**）**：登记件 `status`=`proposal`；**本卡判据实跑 1/1 PASS**（逐条见文末「状态」，真 git 仓库 ＋ 真 sqlite）；已存在落点：`src/security/pre-upload-validator.ts`、`tests/security/pre-upload-validator.test.ts`；**待新建**：（无）。
**⑥ 还需要做什么**：改 fail-closed + 三态 exit（0/1/2，未实现必须 exit 2）+ 反例测试（把校验器打进失败态 ⇒ 必须**拒**）。
**⑦ DSH 借鉴方式**：**照搬（语义）**：DSH `dsh-user-approval/lib/index.js:41` 原文 —— "Approval policy: ask. Operations that require approval may ask through the configured answerers; **without an available answerer, the request fails closed**"；`:39` `NEVER_SENTENCE`；`:64` policy ∈ {`ask`,`never`}；`:81` `approval:policy` ⇒ **fail-closed ＋ 显式政策词表**直接照搬。
**⑧ 涉及代码文件**：src/security/pre-upload-validator.ts｜tests/security/pre-upload-validator.test.ts

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K10 平台交付与运行时（DSH）**，架构位置 = ⓪ 连接器（数据边界 ＝ 可见性承诺）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在
- src/security/pre-upload-validator.ts
- tests/security/pre-upload-validator.test.ts
### 待新建（写集，尚未存在）
- （无）
结论：**本 brief 不下完成/未完成结论**（见文末「状态」的事实台账与待裁项）。

## Q1: 调研
a) 业界：交付面与运行时面必须**单一入口 ＋ 可机器判**（Anthropic 工程基线：不可逆 / 对外可见的动作要有独立于执行者的判据）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ 的 file:line 证据）。
c) memory 教训：**铁律 0-2**（接线失败 4 次 —— 组件过了单测但从未被生产调用）；**判例 V-02**（grep 型不得作验收）；**判例 V-07**（假绿要用"拔掉实现照样通过"证伪）。

## Q2: 范围
做什么：
- src/security/pre-upload-validator.ts
- tests/security/pre-upload-validator.test.ts
- .claude/task-briefs/2026-10-11-55-K10-BS-6-pre-upload-validator-fail-closed.md
不做什么：
- 不改 scripts/control-tower/probe-egress.sh
- 不改 src/routes/healthz.ts
- 不改 src/deploy/data-directory.ts
- 不改 tests/sentinel/builtin-registration.test.ts
- 不改 package.json
- 不改 scripts/control-tower/probe-packaging.sh
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
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx vitest run tests/security/pre-upload-validator.test.ts`
处理：按 §〇 ⑥ 的缺口清单逐条落地。
结果：见 Done 标准逐条（判据逐字抄自登记件）。

## 架构层: ⓪ 连接器（数据边界 ＝ 可见性承诺）
#CRITERIA: C

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号 —— 见 skill brief-compose D1231）
- src/security/pre-upload-validator.ts
- tests/security/pre-upload-validator.test.ts
- .claude/task-briefs/2026-10-11-55-K10-BS-6-pre-upload-validator-fail-closed.md

## Done 标准
### 登记件 acceptance（1 条 · **逐字原文，未改写**）
- [ ] verify: `npx vitest run tests/security/pre-upload-validator.test.ts`（expectExit 0）
### 附加模板项（**非登记件原文** · 通用要求）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）
---
## 状态（**事实台账** · 不由本 brief 合成结论 · R3 · 2026-10-11）

- 基线：`68bf5759878a458b5e5ceb324a32878660155517`（本分支 base）｜ 判据工作树：`/tmp/kb-work`（真 git 仓库 ＋ 真 `sqlite3`）
- 登记件 `status`：`proposal` ｜ 来源卡：#55
- **本卡判据实跑：1/1 PASS**

| # | 判据命令 | expect | 实跑 exit | 判定 |
|---|---|---|---|---|
| 1 | `npx vitest run tests/security/pre-upload-validator.test.ts` | exit 0 | 0 | PASS |

### 待 CTO 裁定的矛盾项（**本 brief 无权下结论**）
- 登记件 `status`=`proposal` ↔ Gitea #55 state 须对齐（CTO 裁）
- 🔴 **判据假绿**：Done 命令 exit 0 只因现有测试断言的正是 fail-open ⇒ 不得据本卡关闭

> 「已完成 / 未完成」**不作为本 brief 的结论**：登记件中已有判据被**自行作废**（#19）、**假绿**（#22 单测绿/真库无表；#55 断言 fail-open）、**结构性跑不通**（#3）、**语法坏**（#27/#43），
> 任一情形下「exit 0 ⇒ 已完成」都不成立。开工/关单请以 CTO 对上述待裁项的裁定为准。

