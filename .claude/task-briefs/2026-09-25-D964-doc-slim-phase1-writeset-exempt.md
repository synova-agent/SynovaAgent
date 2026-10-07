# Task Brief: D964 — 文档减负+K3指针式 阶段1（merge-writeset-gate 内置豁免）
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
Synova 控制塔门禁域。merge_writeset_gate.py（D708）以「声明写集 vs 实际变更集」判夹带；K3 报告改指针式后 audit-reports/INDEX.md 由任意任务追加，天然不在各任务写集内 → 误判夹带。
### b) 文件审计
`scripts/control-tower/merge_writeset_gate.py:61` BUILTIN_EXEMPT 现仅 bypass.log 一条且精确匹配；测试 `tests/control-tower/merge_writeset_gate.test.sh` ⑤ 已有内置豁免用例可扩展。
### c) 决策
已有覆盖 → 扩展内置豁免清单（路径级），不新增门禁。

## Q1: 调研
铁律 35（自动化优先）+ ctrl-tower-change 模式 5（密封测试）。改前已实测复现夹带红（INDEX.md 被点名）。DSH 借鉴：无（本仓自有门禁扩展，不涉及 DSH 通用管道）。

## Q2: 范围 — 最简方案
做什么：
- scripts/control-tower/merge_writeset_gate.py：BUILTIN_EXEMPT 加 `docs/synova/audit-reports/**`、`archive/**`（附理由）+ fnmatch glob 匹配
- tests/control-tower/merge_writeset_gate.test.sh：⑨ 用例（豁免绿 + 改坏即红）
不做什么（含文件路径）：
- 不碰 scripts/audit/**、docs/synova/audit-reports/ 内容、src/**、docs/plans/**
- 不改 check-citations.py、pre-commit-check.sh（后续阶段）

## Q3: 验收
入口: CI merge-writeset-gate job。
处理: 声明写集不含 audit-reports 的 PR。
结果: INDEX.md 判「内置豁免」并打印理由；去掉豁免键 → 必须红（改坏即红）。

## 架构层: scripts（控制塔）
## Done 标准
- [ ] tests/control-tower/merge_writeset_gate.test.sh 全绿（33 通过）
- [ ] 改前/改后原始输出各一份（夹带 → 豁免）
- [ ] K3 审计通过后才合并
- 不改 scripts/audit/audit-rules.sh、scripts/pre-commit-check.sh、tests/control-tower/gate-stats.test.sh（明确不动这些具体文件）
