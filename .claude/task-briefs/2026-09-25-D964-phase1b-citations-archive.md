# Task Brief: D964 阶段1b — check-citations 加 archive/** 豁免根
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
引用可核验门禁（D919）。文档减负归档后，归档件引用的是「移动前」路径 → 若不豁免，归档批 PR 会因断链恒红。
### b) 文件审计
`scripts/control-tower/check-citations.py`（main 流程 236-249 行）；测试 `tests/control-tower/check-citations.test.sh`（14 用例）。
### c) 决策
已有覆盖 → 在既有检查里加豁免根（不新建脚本/门禁）。

## Q1: 调研
铁律 35 + 铁律 11（跳过必须显式，不得静默）。DSH 借鉴：无（本地引用门禁）。

## Q2: 范围 — 最简方案
做什么:
- scripts/control-tower/check-citations.py：artifact 路径命中 `archive/**` ⇒ 跳过引用核验并**显式打印**跳过（铁律 11）
- tests/control-tower/check-citations.test.sh：⑨ 豁免生效 + 改坏即红（同内容非 archive 路径必须 exit 1）
不做什么（含文件路径）:
- 不改 scripts/audit/**（K3 专属）、src/**、docs/plans/**、docs/synova/audit-reports/**
- 不改本检查的既有判据（只加豁免根）

## Q3: 验收
入口: CI Control Tower Gate Tests / 派单前 check-citations。
处理: artifact 路径匹配 `/archive/` 或前缀 `archive/`。
结果: 跳过并打印 `⏭ 跳过（archive/** 豁免根，D964）`；非 archive 同内容仍报 CITE_FILE_NOT_FOUND。

## 架构层: scripts（控制塔）
## Done 标准
- [ ] tests/control-tower/check-citations.test.sh 全绿（16 通过）
- [ ] 改坏即红：非 archive 路径同内容 ⇒ exit 1 + CITE_FILE_NOT_FOUND
- 不改 scripts/audit/audit-rules.sh、scripts/pre-commit-check.sh、tests/control-tower/gate-stats.test.sh（明确不动这些具体文件）
