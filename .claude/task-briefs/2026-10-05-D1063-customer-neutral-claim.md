# Task Brief: D1063 客户名中性化写集认领（B/C 类）

> 生成: 2026-10-05 | 任务: D1063 | 认领: win-codex-cto

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
公开仓库去标识（客户名中性化）。变更集为**机械替换**，不改语义、不改结构。
### b) 文件审计
维护记录: `memory/notes/implemented/2026-10-05-d1063-customer-name-neutralization.md`
### c) 决策
字节级替换（哇呢宝贝→客户A ｜ wani-baby/wane-baby→client-a ｜ 金总→客户A负责人）；仓库真实路径受保护不改名。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
① A 类客户资料本体已出库（PR #1108/#1109）；B/C 类只需去标识。
② 全量替换会误改真实路径引用（触发文档真相检查）⇒ 对 `data/golden/wani-baby-v1.json` 等做掩码保护。
③ 黄金数据集链路改名会破 golden-case F1 ⇒ 拆出另卡。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/plans/codex/implementation/SYNOVA-IMPL-D470-field-mapping-contract-20260822.md
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D474-golden-dataset-gate-20260822.md
- extensions/sentinels/unit-economics/computes/fixed-cost-rigidity.ts
- extensions/sentinels/unit-economics/computes/marginal-contribution.ts
- extensions/sentinels/unit-economics/computes/scenario-simulation.ts
- memory/notes/implemented/2026-10-05-d1063-customer-name-neutralization.md
- scripts/workflow/gen_impl_ch0_1.py
- tests/agent/report-assembler.test.ts
- tests/interview/e2e-preliminary-diagnosis.test.ts
- .claude/task-briefs/2026-10-05-D1063-customer-neutral-claim.md
- .claude/bypass.log

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 data/golden/wani-baby-v1.json
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI `bash scripts/pre-commit-check.sh`（SYNO_CI=1）
处理：G12 以本 brief 的 Q2 作写集事实源
结果：G12 全绿 ⇒ TypeScript + Lint + Iron Laws 转绿

## 架构层:
scripts（治理）

## Done 标准
- [ ] verify: CI `TypeScript + Lint + Iron Laws` ⇒ success（push 后取）
