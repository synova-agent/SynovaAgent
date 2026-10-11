# Task Brief: #42 → K1/0-9bis — 知识审计不可归属（req.userId 恒 undefined ⇒ user_id 恒 anonymous）

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#42` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K1 块 · `0-9bis`）
> 批次：第0批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：让知识审计**可归属**：`req.userId` 恒 `undefined` ⇒ `user_id` 恒 `anonymous`。
**② 解决什么问题**：实测：审计表里 `user_id` 实测库中该表唯一一行为 `l3-real-user-1155`（非 anonymous） ⇒ 出了事**无法定位是谁**（审计等于没有）。
**③ 做完对项目的推动**：归因能力是 §2.7 一致性与 ⑥ 进化回环的共同前提（判例：DSH 「账本可归因」为其六原则之一）。
**④ 🔴 不做行不行**：**不行**（禁令级）：不可归属的审计 = 假审计（合规与追责皆为空洞）。
**⑤ 现在有什么基础（**判据实测 @ 68bf57598 ＋ 路径实测**）**：⚠️ 代码面判据绿、**数据面需运行期断面**；已存在落点：`src/routes/knowledge.ts`；**待新建**：（无）。
**⑥ 还需要做什么**：把身份贯通到审计写入点 + 跑两条 sqlite 判据。
**⑦ DSH 借鉴方式**：**参考自研**：借 DSH「**错误/违规必须带归属**」—— `dsh-invariants/lib/index.js:93` `throw new InvariantError(packageName, message)`（失败必须**归属于违规的包**）；`:12` `class InvariantError`；`:123` 导出。**不借**其包级归属粒度（我们要到人）。
**⑧ 涉及代码文件**：src/routes/knowledge.ts

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K1**（接线·点火·权限执行面），架构位置 = ⓪ 连接器（人侧 ⓪-b）＋ 横切（归因）。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在（本卡可直接复用/修改）
- src/routes/knowledge.ts
### 待新建（写集，尚未存在）
- （无）
结论：RUNTIME-ONLY。

## Q1: 调研
a) 业界：对外可见/安全相关的动作必须有**独立于执行者的判据**（Anthropic 工程基线）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ file:line）。
c) memory 教训：**铁律 0-2**（接线失败 4 次：组件过单测但从未被生产调用）；**铁律 24/31**（禁静默降级）；**判例 V-02**（grep 型不得作验收）；**判例 M-02**（三态 exit 码）。

## Q2: 范围
做什么：
- src/routes/knowledge.ts
- .claude/task-briefs/2026-10-11-42-K1-0-9bis-知识审计不可归属-userId恒undefined.md
不做什么：
- 不改 tests/loops/probes/batch0a-probes.ts
- 不改 src/sentinel/builtins.ts
- 不改 src/l4/knowledge-store.ts
- 不改 tests/security/request-context-failclosed.test.ts
- 不改 tests/routes/im-authprovider.test.ts
- 不改 src/tools/tool-registry.ts
- 不改 scripts/control-tower/probe-tool-policy.ts
- 不改 src/routes/workspaces-api.ts
- 不改 src/routes/workspace-data.ts
- 不改 src/routes/actions-api.ts
- 不改 src/routes/workspace.ts
- 不改 src/routes/department-workspace.ts
- 不改 src/middleware/rbac.ts
- 不改 tests/security/rbac-all-routes.test.ts
- 不改 tests/store/metric-readings-schema.test.ts
- 不改 tests/store/metric-readings-insert.test.ts
- 不改 src/security/file-guard.ts
- 不改 src/agent/tools.ts
- 不改 src/agent/tool-profiles.ts
- 不改 tests/agent/tool-role-wiring.test.ts
- 不改 scripts/control-tower/probe-sentinel.ts
- 不改 src/routes/im.ts
- 不改 src/middleware/auth.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`sqlite3 data/synova.db "SELECT COUNT(*) FROM knowledge_audit WHERE user_id NOT IN ('anonymous','unauthenticated')"`
处理：按 §〇 ⑥ 缺口清单逐条落地。
结果：Done 标准逐条（判据**逐字抄自登记件**）。

## 架构层: ⓪ 连接器（人侧 ⓪-b）＋ 横切（归因）
#CRITERIA: C

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号（格式依据：brief-compose D1231））
- src/routes/knowledge.ts
- .claude/task-briefs/2026-10-11-42-K1-0-9bis-知识审计不可归属-userId恒undefined.md

## Done 标准
（**逐条抄自登记件 `acceptance` 原文，未改写**）
- [ ] verify: `sqlite3 data/synova.db "SELECT COUNT(*) FROM knowledge_audit WHERE user_id NOT IN ('anonymous','unauthenticated')"`（knowledge_audit 行数 > 0）
- [ ] verify: `sqlite3 data/synova.db "SELECT COUNT(*) FROM knowledge_audit WHERE user_id='unauthenticated'"`（knowledge_audit 行数 > 0）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）

---
## 状态（判据实测 · 独立复核回写 · 2026-10-11）

基线：`68bf5759878a458b5e5ceb324a32878660155517`（**本分支 base**，非旧 as_of）
判定：**RUNTIME-ONLY**（判据逐条：RUNTIME,RUNTIME）
登记件 status：`todo` ｜ 来源卡：#42

⚠️ 代码面判据全绿；**数据面判据需运行期断面**（sqlite 行数），本次未核。

### 独立复核结论（fresh context · 三批各自复核）
本批经独立复核，判定：不能按现状直接开工，需按本卡修订后执行。
修订项：as_of 重钉 ／ ⑤ 与 Q0 分「已存在 / 待新建」两栏 ／ Done 逐条抄登记件原文 ／ 去 #1308 引用。
真源（`施工项登记.ts`）缺陷另由 CTO 处置（判据语法坏 / 假绿判据 / status 与 issue state 分歧）。
