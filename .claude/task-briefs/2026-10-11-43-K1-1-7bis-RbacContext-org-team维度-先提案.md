# Task Brief: #43 → K1/1-7bis — RbacContext 无 org/team 维度（rbac.ts:127 department 恒 undefined）—— 接口变更，先提案

> 卡面来源：CTO 2026-10-11 立卡（本件为**正卡** `#43` 的工卡）
> 架构基准：**产品宪章 v8.1**（§0.4 ＋ §4.1）｜机器真源：`docs/synova/coordination/施工项登记.ts`（K1 块 · `1-7bis`）
> 批次：第1批 ｜ 登记件 status：`todo` ｜ 依赖：无

## 〇、为什么要做这个（通俗版 · 先读这一节）
**① 一句话**：给 `RbacContext` 补 **org/team 维度**（`rbac.ts:127` `department` 恒 `undefined`）。
**② 解决什么问题**：实测：`department` 恒 undefined ⇒ 部门轴在多岗位判定里**根本不参与**，多租户/部门隔离形同虚设。
**③ 做完对项目的推动**：它是 §2.7 第①层（知识一致·**分层权限**）的接口前提；也是 K12 的 RB 系列（部门轴/权限项模型）的落点。
**④ 🔴 不做行不行**：**不行**（禁令级）：权限模型缺维度 = 隔离不可达（K12/RB-02 判据同源）。
**⑤ 现在有什么基础（**事实台账 @ 68bf57598**）**：登记件 `status`=`todo`；**本卡判据实跑 1/4 PASS**（逐条见文末「状态」，真 git 仓库 ＋ 真 sqlite）；已存在落点：`src/middleware/rbac.ts`、`tests/security/**`；**待新建**：`docs/synova/coordination/提案/`。
**⑥ 还需要做什么**：先出**提案件**（接口变更须先提案）+ 补 org/team 维度 + 三条判据（含 `req.userId =` 零命中）。
**⑦ DSH 借鉴方式**：**自研**：DSH 是**单机单用户**，无 org/team/部门维度与多租户模型 ⇒ 无对应物；仅借其「接口变更先声明（`static inject` 即接口契约）」的方向（`dsh-permission-presets/lib/index.js:160` `static inject = [...]`）。
**⑧ 涉及代码文件**：docs/synova/coordination/提案/｜src/middleware/rbac.ts｜tests/security/

## Q0: 定位 — 项目拼图 + 文件审计
本卡属 **K1**（接线·点火·权限执行面），架构位置 = ⓪ 连接器（人侧 ⓪-b）＋ 横切权限模型。
文件审计（**逐条实测 @ 68bf5759878a4**）：
### 已存在
- src/middleware/rbac.ts
- tests/security/**
### 待新建（写集，尚未存在）
- docs/synova/coordination/提案/
结论：**本 brief 不下完成/未完成结论**（见文末「状态」的事实台账与待裁项）。

## Q1: 调研
a) 业界：对外可见/安全相关的动作必须有**独立于执行者的判据**（Anthropic 工程基线）。
b) 顶级团队：DSH 的做法是**一能力一包 ＋ 按名声明、宿主满足**（见 ⑦ file:line）。
c) memory 教训：**铁律 0-2**（接线失败 4 次：组件过单测但从未被生产调用）；**铁律 24/31**（禁静默降级）；**判例 V-02**（grep 型不得作验收）；**判例 M-02**（三态 exit 码）。

## Q2: 范围
做什么：
- docs/synova/coordination/提案/
- src/middleware/rbac.ts
- tests/security/
- .claude/task-briefs/2026-10-11-43-K1-1-7bis-RbacContext-org-team维度-先提案.md
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
- 不改 tests/security/rbac-all-routes.test.ts
- 不改 tests/store/metric-readings-schema.test.ts
- 不改 tests/store/metric-readings-insert.test.ts
- 不改 src/security/file-guard.ts
- 不改 src/agent/tools.ts
- 不改 src/agent/tool-profiles.ts
- 不改 tests/agent/tool-role-wiring.test.ts
- 不改 scripts/control-tower/probe-sentinel.ts
- 不改 src/routes/knowledge.ts
- 不改 src/routes/im.ts
- 不改 src/middleware/auth.ts
- 不改 docs/synova/coordination/施工项登记.ts

## Q3: 验收 — 入口 → 交互 → 结果
入口：`test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md`
处理：按 §〇 ⑥ 缺口清单逐条落地。
结果：Done 标准逐条（判据**逐字抄自登记件**）。

## 架构层: ⓪ 连接器（人侧 ⓪-b）＋ 横切权限模型
#CRITERIA: C

## 写集
（单源 = 登记件 `paths`；glob 已折为**目录裸路径**，禁通配符与反引号（格式依据：brief-compose D1231））
- docs/synova/coordination/提案/
- src/middleware/rbac.ts
- tests/security/
- .claude/task-briefs/2026-10-11-43-K1-1-7bis-RbacContext-org-team维度-先提案.md

## Done 标准
### 登记件 acceptance（4 条 · **逐字原文，未改写**）
- [ ] verify: `test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md`（expectExit 0）
- [ ] verify: `npx vitest run tests/security/rbac-org-axis.test.ts`（expectExit 0）
- [ ] verify: `npx vitest run tests/security/rbac-all-routes.test.ts`（expectExit 0）
- [ ] verify: `bash -c "test "$(git grep -l 'req\.userId[[:space:]]*=' origin/main -- src/ | wc -l)" -eq 0"`（expectExit 0）
### 附加模板项（**非登记件原文** · 通用要求）
- [ ] 反例（改坏即红）：按文末「状态」列出的失败/待建项构造反例并留原始输出
- [ ] 三态：未实现必须 **exit 2**（0=通过／1=失败／2=未实现 —— 禁假绿）
---
## 状态（**事实台账** · 不由本 brief 合成结论 · R3 · 2026-10-11）

- 基线：`68bf5759878a458b5e5ceb324a32878660155517`（本分支 base）｜ 判据工作树：`/tmp/kb-work`（真 git 仓库 ＋ 真 `sqlite3`）
- 登记件 `status`：`todo` ｜ 来源卡：#43
- **本卡判据实跑：1/4 PASS**

| # | 判据命令 | expect | 实跑 exit | 判定 |
|---|---|---|---|---|
| 1 | `test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md` | exit 0 | 1 | FAIL |
| 2 | `npx vitest run tests/security/rbac-org-axis.test.ts` | exit 0 | 1 | FAIL |
| 3 | `npx vitest run tests/security/rbac-all-routes.test.ts` | exit 0 | 0 | PASS |
| 4 | `bash -c "test "$(git grep -l 'req\.userId[[:space:]]*=' origin/main -- src/ \| wc -l)" -eq 0"` | exit 0 | 1 | FAIL |

### 待 CTO 裁定的矛盾项（**本 brief 无权下结论**）
- 登记件 `status`=`todo` ↔ Gitea #43 state 须对齐（CTO 裁）
- 🔴 **真源判据语法坏**：`bash -c "test "$(…)" -le N"` 未加引号 ⇒ 拆成无参 `test` ⇒ **恒 exit 1**（本台账已复现）
- ⚠️ 判据 ref 写 `origin/main`（5a6591c4a），比本支 base 旧 146 commit

> 「已完成 / 未完成」**不作为本 brief 的结论**：登记件中已有判据被**自行作废**（#19）、**假绿**（#22 单测绿/真库无表；#55 断言 fail-open）、**结构性跑不通**（#3）、**语法坏**（#27/#43），
> 任一情形下「exit 0 ⇒ 已完成」都不成立。开工/关单请以 CTO 对上述待裁项的裁定为准。

