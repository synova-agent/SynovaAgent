---
状态: proposed
日期: 2026-10-01
决策: CTO 岗位改三级制——只对线负责人说话，派单权下移线负责人层
理由: 瓶颈是「CTO 上下文 ∝ 任务总数」。判别式：凡随任务数增长的一律下放，只随线数×窗数增长的留下。载体物理约束（maxDepth 默认 1）决定线负责人必须是独立常驻 session，不能由 CTO spawn。
---

# D1098 · CTO 岗位改三级制

## 触发场景

创始人 2026-10-01 裁定「**CTO 只对线负责人说话，不对执行者说话**」（原话，出处：研究院委托书收录，`Q1-组织设计.md` v1.3 :263）。
触发条件可核：治理:产品提交比 **1:4.9**（目标 1:2）、110 open PR 无一推产品、产品完成度停 **verified 25/181**。

## 决策内容

1. CTO 四件事：方向锚+边界声明（每线每窗）／跨线裁决（当日）／治理三件事／线级周对账。
2. 派单权（F1-F12 + 派单前复核 + 线内收件）下移**线负责人**。
3. CTO 不写 F1-F12、不做派单前复核、不做线内收件、不接执行者回执、**不 spawn 线负责人**。
4. 载体：线负责人＝独立常驻 session；执行者＝Agent Teams 小队。
5. 判据沿用创始人 2026-08-17 判据，上移一层成三档（自裁／上 CTO／上创始人带推荐）。

## 物理依据（file:line）

- 🔴 `maxDepth` 默认 1 —— 「depth 1 permits direct children only」
  （`/Users/wane/src/deepseek-harness-020 packages/subagent/subagent/README.md:47`）
  ⇒ CTO spawn 的线负责人无法再派小队 ⇒ **链断**；这是「线负责人＝独立 session」的**硬约束**而非偏好。
- Agent Teams 原语＝持久 mailbox + 共享任务板 + 成员为 Team Lead 直系子代
  （`-020 docs/subsystems/agent-team.md:26-28,:61-74`）。
- 活载体是 `file:` **拷贝不是软链** ⇒「文件在 ≠ 已生效」（本波两份 P0 的成因）。
- 旧形状载体实测仍在位：`/Users/wane/src/dsh-preset-bundles/synova-main-cto/cordis.patch.yml:16`（description 写「派单（pre-dispatch 十项）」）、`:29`（personа 写「派单前必过 pre-dispatch-check 十项复核」）。

## 相关 D#

- **D1098**（本件）：CTO 岗位说明书落地
- 前置：D1074（DSH 上游新版对预设载体的影响评估，基座线）
- 关联未做项：`synova-main-cto` 载体 v2 落位（沙箱外，需在可写环境执行）；派单权第二载体移交

## 本文件不做的事（防误读）

- **不声称载体已生效**：本次执行环境对活载体路径不可写；载体仍是旧扁平模型。落位步骤见 `docs/synova/CTO-ROLE.md` §6 G-3。
- **不声称门禁已接线**：C′1–C′7 现状列全为 🔲。
- **不引用院方设计稿的结论作为依据**：该稿自述「增量复核通过前不进决策依据」，本件逐条回仓库实测后才采纳。

## 参考系

- 决策全文：`decisions/proposed/process/2026-10-01-cto-role-three-tier.md`
- 岗位全文：`docs/synova/CTO-ROLE.md`
- 判据原件：`docs/synova/coordination/DECISION-REFERENCE-决策权归属-20260817.md`
