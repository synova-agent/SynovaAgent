# Task Brief: D748 board-verdict-dimension（看板显示失败）

> 生成: 2026-09-14 | 任务: D748 | 认领: 主 CTO（synova-cto）
> 参考: 整体推进计划 §五 机制 11（看板=真相源）+ D741 定位（sync.js 从不读 audit.verdict）

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
看板呈现层修复（非五层）。看板是创始人唯一的进度来源；它把 FAIL 显示成 done = **决策信息失真**（P0）。
### b) 文件审计（实测）
- dsh/plugins/task-board-adapter/lib/sync.js：改前 `grep -c verdict` = **0**；:44 `audited: "done"` → FAIL 裁决任务显示为已完成
- 线上账本 ~/.dsh/ledger 样本：failed 出现 **0** 次、FAIL 出现 **0** 次
- 有现成测试：test/sync.test.js（node --test，改前 41 通过）
### c) 决策
在 resolveBoardStatus 内**先看 audit.verdict**（独立维度），再回落 status 映射；不覆盖 PASS/CONDITIONAL。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）：把 FAIL 静默压成 done = 最严重的降级隐瞒
- 整体推进计划机制 11：FAIL/未审计项必须在看板呈现为失败
### 参考：铁律 11 + 计划机制 11 → verdict 作为独立维度优先，回落不变

## Q2: 范围 — 正确的最简方案
做什么：
- dsh/plugins/task-board-adapter/lib/sync.js — 新增 verdictBoardStatus()；resolveBoardStatus 首行优先判定；卡片正文化暴露裁决
- dsh/plugins/task-board-adapter/test/sync.test.js — 新增 D748 用例（FAIL/NOT-AUDITABLE → failed；PASS/CONDITIONAL/无 → 交回映射）
- .claude/task-briefs/2026-09-14-D748-board-verdict-dimension.md — 本 brief
- task-state/D748.json — 本单登记
不做什么：
- 不改 scripts/audit/（审计红线）
- 不改 calc-progress.py / 三个消费端（线级状态派生归另一单，避免撞车）
- 不改 .github/workflows/ci.yml

## Q3: 验收 — 入口 → 交互 → 结果
入口：任务看板同步（Host 账本 ← task-state）
处理：读 audit.verdict → FAIL 类落 failed 列
结果：5 个 FAIL 任务（D393/D503/D515/D549/D572）在看板显示为失败

## 架构层: 基础设施（看板呈现层）
## 主线贡献: infra:看板真相源（创始人决策依据，属支撑前提）
## 域: mac

## Done 标准:
- [ ] 测试含新用例且全绿：node --test dsh/plugins/task-board-adapter/test/sync.test.js → fail 0
- [ ] 反向验证：去掉 verdictBoardStatus 调用 → D748 用例必红（贴两次输出）
- [ ] 代码内 verdict 维度在位：grep -c verdictBoardStatus dsh/plugins/task-board-adapter/lib/sync.js → ≥3
