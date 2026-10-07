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
- docs/plans/codex/implementation/SYNOVA-IMPL-D338-org-isolation-audit-20260822.md
- docs/synova/research/权威文档17-自诊断系统-20260729/权威文档17-预期状态模型-v3-20260729.md
- docs/synova/research/跨文档一致性审计-20260727/txt/JTBD研究-2026-07-06_SYNOVA-RESEARCH-JTBD-场景基础画像-20260706.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/JTBD研究-2026-07-06_SYNOVA-RESEARCH-JTBD-综合研究报告-20260706.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/nci_NCI-对抗性验证报告-Epsilon-20260704.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/nci_SYNOVA-RESEARCH-NCI五路研究汇合报告-20260705.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/nci_SYNOVA-WHITEPAPER-NCI非共识检测白皮书-20260705.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/权威文档05-Agent主动交互系统蓝图-20260710_SYNOVA-RESEARCH-Module-3-GA人机协同与反馈闭环-20260710.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/权威文档05-Agent主动交互系统蓝图-20260710_SYNOVA-RESEARCH-Module-4-Loop循环交互体现-20260710.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/权威文档06-测试体系权威规范-20260710_SYNOVA-RESEARCH-第一章-测试架构总览-20260710.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/权威文档06-测试体系权威规范-20260710_SYNOVA-RESEARCH-第四章-因果回归测试-20260710.txt
- docs/synova/research/跨文档一致性审计-20260727/txt/权威文档11-管理经济学权威规范-20260714_SYNOVA-RESEARCH-第六章-路线图与因果验证-20260715.txt
- task-state/D861.json
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
