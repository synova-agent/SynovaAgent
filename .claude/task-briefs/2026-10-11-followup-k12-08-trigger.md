# Task Brief: K12-08 决策台账「生产触发点」（recordDecision 零调用者）

> 立卡依据：创始人 2026-10-11 裁「合降级版 + 另开卡做触发点」（#312 的配套）
> 前情：PR #312 已把装配链接上（`bootstrap → server → routes/conversations → 引擎 onDecision → captureDecision`），
>   但 **`engine.recordDecision` 在 `src/` 零调用者** ⇒ **台账在生产上不会被写**。

#CRITERIA: D

## 〇、为什么要做这个（通俗版）
① 一句话：定「**什么用户动作该写台账**」，并在那个真实入口调 `recordDecision` —— 让台账真的被写。
② 问题：装配全通，但**末端无触发者**。独立复核原话：「装配接上了，但生产路径没有任何入口会触发落账」
   「『生产装配接上』≠『生产会写台账』」。
③ 推动：宪章 **④ 参数层 b（决策台账）** 是护城河资产本体；台账不写 ⇒ 该资产恒空。
④ 不做行不行：**不行**。台账是「测量权」的载体，不写 ⇒ 参数层 b 永远为零。
⑤ 基础：#312 已合（V2–V5 全绿、装配链完整、`captureDecision` 单一入口唯一）。
⑥ 要做什么：见 Q2 —— 触发点已由创始人裁定（Q0c），本卡只做落账接线。
⑦ DSH 借鉴：不适用。
⑧ 涉及文件：见 Q2。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
宪章 ④ 参数层 b（决策台账）。代码落点 `src/l4/decision-capture.ts`（已合）＋ 触发它的 L1/L2 入口（本卡）。
### b) 文件审计（as_of `local-main=8cbe3fc1d`）
| 件 | 现状 | 处置 |
|---|---|---|
| `src/l4/decision-capture.ts` | 已合（#312），单一入口 `captureDecision` | **只读**（边界明令）|
| `src/deploy/bootstrap.ts` | 已合（#312），装配链完整 | **只读**（边界明令）|
| `src/agent/conversation-engine.ts` | 有 `recordDecision()`，`src/` 零调用者 | **改**（加进程级引擎持有位，供无会话路径复用同一 L2 接缝）|
| `src/routes/conversations.ts` | 已有装配口注册处 `setDecisionCapturePort` | **改**（把全局引擎一并下放）|
| `src/routes/sentinel.ts` | 已有工单迁移路由 `POST /tickets/:id/transition`（D580 8-4） | **改**（`to==='resolved'` 时接触发点）|

实测（原始命令）：
```
$ git grep -nE "\.recordDecision\s*\(" -- src
（零命中；仓库级只有 tests/l4/decision-capture-single-entry.test.ts:400/412）
```

### c) 决策（🔴 创始人 2026-10-11 逐字裁定）
**「什么用户动作该写台账？」** ⇒ **选 C3：哨兵发现 → 工单关闭时的人工裁决**。
- **依据**：宪章 §4.4「**③ 是唯一允许写 ④ 的角色**」＋ §0.4（③ 第四职责 = **存决策结果**）。
- **否 C2**：自动落账会记「系统说了什么」，污染台账（台账记的是**人的裁决**）。
- **⏸ C1 不是否，是第二阶段**：它须同样**经 ③** 落账，**不许 L1 直写 ④**。
- ⇒ **本卡只做 C3。**

**触发点落位**（读代码后确定，非臆测）：
```
L1  POST /api/sentinel/tickets/:id/transition   src/routes/sentinel.ts:115
L2  transitionSentinelTicket                    src/agent/sentinel-service.ts:442
L3  runner.transitionTicket                     src/sentinel/runner.ts:1145
      状态机白名单（runner.ts:1146）: open→acknowledged|dismissed, acknowledged→resolved
      ⇒ 「工单关闭」的唯一合法真路径 = acknowledged --(人工 POST)--> resolved
本卡在 L1 路由的 `to === 'resolved'` 分支接 `recordDecision`（③ 经 L2 接缝写 ④）。
```

## Q1: 调研
### a) 实测证据（原始）
```
$ git grep -nE "\.recordDecision\s*\(" -- src
（零命中）
$ 装配链 grep：bootstrap.ts:156/731/743 → server.ts:346 → conversations.ts:62/272/80 → engine:491/496
$ 状态机：runner.ts:1146-1151  LEGAL_TRANSITIONS = { open:[acknowledged,dismissed],
                                                    acknowledged:[resolved], resolved:[], dismissed:[] }
```
### b) 同型教训
- 铁律 4/5「写了代码没接线」；本卡是**接线已通但无触发者**的变体（更难发现：门禁全绿）
- 判例 **V-02**：静态命中 ≠ 被执行 ⇒ 判据禁词法扫描，必须真跑流程 + 断言真变化
- #312 已实测弱点：摘掉生产环 `wireDecisionCapture` 的调用后，`tests/l4` 20/20 全绿 ⇒ **门禁失明**
### c) 决策参考系
参考：第一性原理（宪章 §4.4「③ 是唯一允许写 ④ 的角色」）+ Anthropic 工程基线（真跑通判据）
+ 结论：触发点放在 L1 真路由 resolved 分支，落账走既有 L2 接缝（`recordDecision`）→ 单一入口 `captureDecision`。

## Q2: 范围
做什么：
- src/agent/conversation-engine.ts
- src/routes/conversations.ts
- src/routes/sentinel.ts
- tests/l4/decision-capture-single-entry.test.ts
- .claude/task-briefs/2026-10-11-followup-k12-08-trigger.md
不做什么：
- 不改 src/l4/decision-capture.ts — 已合（#312），单一入口已定
- 不改 src/deploy/bootstrap.ts — 装配链已合（#312）
- 不改 src/server.ts — 装配口下放已在 #312 完成（本卡不动它）
- 不改 src/sentinel/runner.ts — 工单状态机已合（D580 8-4），本卡只做触发点
- 不改 scripts/audit/** — 审计红线
- 🔴 不许 L1 直写 ④（宪章 §4.4 硬规则）—— 落账一律经 ③ 的 `recordDecision` 接缝

## Q3: 验收 — 入口 → 交互 → 结果
入口：**真 HTTP 路由** `POST /api/sentinel/tickets/:id/transition`（body `{to:'resolved', operatorId}`），
     真 `express` + 真 router + 真 `SentinelRunner`（真 `:memory:` SQLite + 真 `sentinel_tickets` 表）。
处理：路由 → L2 `transitionSentinelTicket` → L3 `runner.transitionTicket`（工单真置 resolved）
     → resolved 分支 → L2 接缝 `engine.recordDecision` → L4 `captureDecision` → 图存储 `createEdge`。
结果：
- V4 **穿过真入口**的判据：POST 前台账边数 = 0，POST 后 **= 1**，且断言该行的
  `who/role/context/output/presetVersion/review` 真值（**禁词法扫描**；改坏即红）。
- V5 🔴 **门禁有牙**：摘掉触发点（resolved 分支的 `recordDecision` 调用）⇒ V4 **必红**（实测给 exit code）。
- V6 🔴 **补 #312 失明**：摘掉生产环 `wireDecisionCapture(conv, orgId)` 的调用 ⇒ 亦**必红**
  （#312 的存量盲区：摘掉后 20/20 全绿 —— 本卡补上该断言）。
- V7 反例：`recordDecision` 无接缝（未注入装配口）⇒ 显式失败 `recorded:false`，**不静默**（铁律 24/31）。

## 架构层
L1 交互（`src/routes/`）→ L2 编排（`src/agent/`）→ L4 本体（经已有 `onDecision` 回调接缝，**不违 EC-03**）。

## 写集
- src/agent/conversation-engine.ts
- src/routes/conversations.ts
- src/routes/sentinel.ts
- tests/l4/decision-capture-single-entry.test.ts
- .claude/task-briefs/2026-10-11-followup-k12-08-trigger.md

## Done 标准（勾选态 = 实测态；未验证的直说，见 §例外）
- [x] verify: `git grep -nE "\.recordDecision\s*\(" -- src` 从 0 命中 → **1 命中**
      （`src/routes/sentinel.ts:109`，且该调用在真触发时真写台账 —— 见 V8）
- [x] verify: 真 HTTP 入口驱动 ⇒ 台账边数 0 → 1，行内容断言通过
      （`npx vitest run tests/l4/decision-capture-single-entry.test.ts` ⇒ 25/25，含 V8=真路由驱动）
- [x] verify: 摘掉触发点 ⇒ V8/V9/V10/V11 **4 例红**（exit 1）；改回 ⇒ 25/25 全绿
- [x] verify: 摘掉生产环 `wireDecisionCapture` 调用 ⇒ V12 **必红**（exit 1，补 #312 失明）
- [x] verify: 把 `seam.recordDecision(...)` 换 no-op ⇒ V8/V9/V11 **3 例红**（台账零行）
- [x] verify: `npx vitest run tests/l4` ⇒ exit 0（30 files / 266 tests）
- [x] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` ⇒ exit 0（13 组全通过）

## 例外（我没做到 / 未验证的，主动列）
① **`signal_id` 必须是本体图里已存在的节点** —— `captureDecision` 的既有节点存在性检查
   （`decision-capture.ts:341-347`，本卡不得改）在此原样生效：若该哨兵信号尚未成为图节点，
   落账返回 `recorded:false`（显式失败，不静默），响应头 `X-Ledger-Recorded: false`。
   **本卡未验证生产图里 signal 节点是否普遍存在** ⇒ 转 `graphbridge-wiring-red` 卡。
② **审批动作未区分** —— `acknowledged`/`dismissed` 不落账，只有 `resolved` 落账；`action` 恒为
   `'confirmed'`。API body 目前无「确认/驳回」语义字段 ⇒ 记「关单裁决=确认」。若要区分，
   需扩 body 契约（**改接口 ⇒ 须先上报 CTO**，本卡不做）。
③ **预设包版本恒为常量 1** —— `DEFAULT_LEDGER_PRESET_VERSION` 是出厂基线；预设层（K12-01）
   未接入 ⇒ 台账第 ⑤ 要素目前不是"真版本"。**未验证**与预设层的对齐。
④ **C1 未做** —— 创始人裁定 C1 是第二阶段，本卡只做 C3（已逐字记入 Q0c）。
⑤ 本节写完后的**最终全绿复跑**见回执 §B（命令原始输出），不在此处手写数字。
