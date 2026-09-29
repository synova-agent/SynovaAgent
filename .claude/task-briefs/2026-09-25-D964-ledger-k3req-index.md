# Task Brief: D964 — 台账登记 + K3 审计请求 + 审计报告 INDEX 指针式索引
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
文档治理 + 审计闭环。本单落三件：① 台账第五批登记 ② K3 审计请求（门禁语义变更必过 K3）③ 审计报告 INDEX（指针式，机器可判）。
### b) 文件审计
`docs/synova/coordination/审计发现台账-DSH-CTO.md`（既有登记簿，追加一行）；`docs/synova/audit-reports/`（K3 域，**只加索引 INDEX.md**）；K3 请求为新建协调文档。
### c) 决策
台账行内追加（不新建文档）；INDEX 为指针式索引（正文仍由 K3 侧持有）。

## Q1: 调研
红线「门禁语义变更 ⇒ 必过 K3」；D964 派单主线 A（K3 报告指针式）。DSH 借鉴：无（本仓治理与审计闭环）。

## Q2: 范围 — 最简方案
做什么:
- docs/synova/coordination/审计发现台账-DSH-CTO.md
- docs/synova/coordination/K3审计请求-D964-门禁语义变更-20260925.md
- docs/synova/audit-reports/INDEX.md
- .claude/task-briefs/2026-09-25-D964-ledger-k3req-index.md
不做什么（含文件路径）:
- 不改 scripts/audit/**（K3 专属）、src/**、docs/plans/**
- 不新增 docs/synova/audit-reports/ 下的报告正文文件（只加 INDEX.md 索引）
- 不擅自为 K3 建独立远端（待创始人裁决）

## Q3: 验收
入口: 本 PR 合并 + K3 审计请求送达。
处理: K3 按请求独立复跑判据。
结果: INDEX.md 有 148 行（一行一条批次）；K3 出具结论。

## 架构层: docs（治理文档）
## Done 标准
- [ ] INDEX.md 行数与 audit-reports 内报告数一致（148）
- [ ] K3 请求含可复跑命令与必答问题
- [ ] 台账行落盘且可检索（grep 第五批）
- 不改 scripts/audit/audit-rules.sh、scripts/pre-commit-check.sh、tests/control-tower/gate-stats.test.sh（明确不动这些具体文件）
