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
⑥ 要做什么：见 Q2 —— **先定触发点（产品决策）再接线**。
⑦ DSH 借鉴：不适用。
⑧ 涉及文件：见 Q2。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
宪章 ④ 参数层 b（决策台账）。代码落点 `src/l4/decision-capture.ts`（已合）＋ 触发它的 L1/L2 入口（本卡）。
### b) 文件审计
| 件 | 现状 | 处置 |
|---|---|---|
| `src/l4/decision-capture.ts` | 已合（#312），单一入口 `captureDecision` | 只读 |
| `src/agent/conversation-engine.ts` | 已有 `recordDecision()`，**零调用者** | 只读（除非触发点在它内部）|
| 触发点候选 | **未定 —— 需先裁**（见 Q2 c 决策） | **本卡第一步是裁这个** |

### c) 决策（🔴 需 CTO 先裁，否则本卡不许开工）
**「什么用户动作该写台账？」** 候选（**不许猜，须裁**）：
- C1：GA 复盘某根因节点时的手工确认动作（属 L1 交互路由）
- C2：诊断报告产出时的自动落账（属 L2 编排）
- C3：哨兵发现 → 工单关闭时的人工裁决（属 L3→L2）
⇒ **未裁前本卡不开工**（判例 P-01：不臆测意图）。

## Q1: 调研
### a) 实测证据（原始）
```
$ git grep -nE "\.recordDecision\s*\(" -- src
（零命中；仓库级只有 tests/l4/decision-capture-single-entry.test.ts:400/412）
$ 装配链 grep：bootstrap.ts:156/731/743 → server.ts:346 → conversations.ts:62/272/80 → engine:491/496
```
### b) 同型教训
- 铁律 4/5「写了代码没接线」；本卡是**接线已通但无触发者**的变体（更难发现：门禁全绿）
- 判例 **V-02**：静态命中 ≠ 被执行

## Q2: 范围
做什么（**等 CTO 裁 C1/C2/C3 后**再填具体路径）：
- src/agent/conversation-engine.ts
- tests/l4/decision-capture-single-entry.test.ts
不做什么：
- 不改 src/l4/decision-capture.ts — 已合（#312），单一入口已定
- 不改 src/deploy/bootstrap.ts — 装配链已合（#312）
- 不改 scripts/audit/** — 审计红线

## Q3: 验收 — 入口 → 交互 → 结果
入口：**裁定的那个真实用户动作**（C1/C2/C3 之一）
处理：用户动作 → 真 route/真引擎 → `recordDecision` → `captureDecision` → 台账一行
结果：
- V1 **穿过真入口**的判据：真 route/真引擎构造路径 ⇒ 台账**真多一行**（禁 mock 管线）
- V2 🔴 **门禁有牙**：摘掉生产环（如 `wireDecisionCapture` 的调用）⇒ **必红**
  （#312 的已实测弱点：摘掉后测试 20/20 全绿 + 探针 PASS，**两门禁同时失明** —— 本卡必须治它）
- V3 反例：把 `recordDecision` 换成 no-op ⇒ V1 必红

## 架构层
L1 交互 → L2 编排 → L4 本体（经已有 `onDecision` 回调接缝，**不违 EC-03**）。

## 写集（待 CTO 裁后补全）
- src/agent/conversation-engine.ts
- tests/l4/decision-capture-single-entry.test.ts

## Done 标准
- [ ] verify: 真入口驱动 ⇒ 台账真多一行的原始输出
- [ ] verify: 摘掉生产环 ⇒ 必红（门禁有牙）；改回 ⇒ 全绿
- [ ] 🔴 前置：CTO 已裁「什么用户动作该写台账」
