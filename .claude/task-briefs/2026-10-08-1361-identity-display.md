# Task Brief — 1361-identity-display: 消息层两件（身份显示口径 + 修复指引只列真能用的路径）

## Q0: 定位
- 治理面（门禁/控制塔域）：`scripts/control-tower/merge_writeset_gate.py` 的 `_emit`
  （人读诊断块的**身份行**与**修复指引**）。
- 卡归属：卡 **#1361**（D1245）**同族**（同文件、同"误导性措辞"家族）；Lead 2026-10-08 明确
  「两件合一个 PR」且「**仅消息层**」。

## Q1: 调研
- ① 旧行 `D# 推断来源: claim → 未推断出`：claim 命中时身份其实**已给出**（issue + 声明件）
  ⇒ 该行读起来像"推断失败"（与 #1308 同族：措辞把排查引偏）。
- ② 正文 `## 写集豁免` 只在**已有声明源**时按文件生效（逐文件循环的 `explicit`）；
  `declared` 为空（四源皆空）的分支**不消费**它 —— 旧指引却把它列为可修路径 ⇒ **指引与实现不一致**。
- 决策参考：第一性原理（报错/文档只能承诺**真能用**的路径；措辞必须与实际机制一致）+
  Anthropic 工程基线（fail-closed 与可诊断性分离：本件只改后者）+ 本线 #1308/#1361 的既有口径。

## Q2: 范围
做什么：
- scripts/control-tower/merge_writeset_gate.py
- tests/control-tower/gate-identity-display.test.sh
- memory/notes/implemented/2026-10-08-1361-identity-display.md
- .claude/task-briefs/2026-10-08-1361-identity-display.md
- .claude/claims/1361.yaml
不做什么（含文件路径）：
- 不改 scripts/control-tower/claim_store.py（「真消费正文豁免」属语义变更 ⇒ K3→CTO 裁，见待裁项）
- 不改 scripts/workflow/resolve-commit-brief.sh、scripts/commit-msg-check.sh（本件只动 merge gate 的显示）
- 不改 tests/control-tower/gate-helper-precondition.test.sh（前一件的在飞夹具，避免跨 PR churn）
- 不改 tests/control-tower/merge_writeset_gate.test.sh（既有配对夹具；本件只验它不回归）
- 不改 scripts/control-tower/alloc-task-id.sh、.github/workflows/ci.yml、scripts/audit/**
- 不动 scripts/control-tower/claim_store.py 的 SYNO_CLAIM_V2 默认值

## Q3: 验收
入口：`bash tests/control-tower/gate-identity-display.test.sh`
处理：claim 命中/畸形/未命中三态身份行；四源皆空 vs 真夹带两种指引
结果：11 断言全绿；既有配对夹具 63/0 未回归；身份行与指引**只承诺真能用的事**

## 架构层: 基础设施

#CRITERIA: D

## Done 标准:
- [ ] verify: bash tests/control-tower/gate-identity-display.test.sh ⇒ 0 失败（11 断言）
- [ ] verify: bash tests/control-tower/merge_writeset_gate.test.sh ⇒ 0 失败（63 断言）
- [ ] verify: bash scripts/control-tower/scan-fullwidth-vars.sh --paths tests/control-tower/gate-identity-display.test.sh ⇒ 违规 0
- [ ] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh ⇒ rc=0

## 写集
| 文件 | 类型 |
|---|---|
| scripts/control-tower/merge_writeset_gate.py | task（仅消息层：身份行 + 修复指引） |
| tests/control-tower/gate-identity-display.test.sh | task（新夹具 11 断言） |
| memory/notes/implemented/2026-10-08-1361-identity-display.md | task（决策沉淀） |
| .claude/task-briefs/2026-10-08-1361-identity-display.md | task（自身） |
| .claude/claims/1361.yaml | task（声明载体：累加本件 3 条） |
