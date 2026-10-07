# Task Brief — 1361-helper-precondition: helper 前提缺失 ⇒ 显式点名（卡 #1361 候选 B）

## Q0: 定位
- 治理面（门禁/控制塔域）：`scripts/control-tower/merge_writeset_gate.py` 的 `collect_declared`
  （D708 合并级写集对账的 S0/S2/S3 声明源取数）。
- 本件 = 卡 **#1361（D1245）** 三候选中 Lead 指定的 **候选 B**：**仅消息层**，**不改 helper 定位策略**。
  （候选 A/C 属 A 类行为变更 ⇒ 须 K3→CTO 裁，不在本件。）

## Q1: 调研
- 病灶（#1353 唯一变量对照锁定）：helper 脚本按 `<repo-root>/scripts/control-tower/` 定位 ⇒
  该树缺失时 `python3 <缺失路径>` 退出码 2（Python "can't open file"）⇒ S0/S2 记「解析失败」
  ⇒ 四源皆空 ⇒ fail-closed ⇒ 观感是"claim 读不到"，真因是**前提缺失**。
- 决策参考：第一性原理（**报错必须指认真因而非表象**；本次 #1308 同族：误导性措辞把排查引偏）+
  Anthropic 工程基线（fail-closed 不变，只改可诊断性）+ 本仓既有做法（同族 D317 在 resolver 侧）。

## Q2: 范围
做什么：
- scripts/control-tower/merge_writeset_gate.py
- tests/control-tower/gate-helper-precondition.test.sh
- memory/notes/implemented/2026-10-08-1361-helper-precondition.md
- .claude/task-briefs/2026-10-08-1361-helper-precondition.md
- .claude/claims/1361.yaml
不做什么（含文件路径）：
- 不改 scripts/workflow/resolve-commit-brief.sh（同族 D317 已改脚本相对；本件不动其它定位点：
  helper 定位改相对属 A 类**行为变更** ⇒ 须 K3→CTO 裁，只在本件做消息层）
- 不改 tests/control-tower/claim-gate-drill.test.sh（#1353 在飞夹具；本件刻意保留其稳定串以零 churn）
- 不改 scripts/control-tower/brief_parser.py、scripts/commit-msg-check.sh（#1344 已合入，本件不回头改）
- 不改 scripts/control-tower/alloc-task-id.sh、.github/workflows/ci.yml、scripts/audit/**
- 不改 tests/control-tower/merge_writeset_gate.test.sh（既有配对夹具，本件只验它不回归）
- 不动 scripts/control-tower/claim_store.py 的 SYNO_CLAIM_V2 默认值

## Q3: 验收
入口：`bash tests/control-tower/gate-helper-precondition.test.sh`
处理：裸沙箱（无 helper 树）⇒ 点名 helper 缺失 + 真因行 + rc=2 不变；真仓等价前提 ⇒ pass + 零告警；
      变异体（定位改脚本相对）⇒ 裸沙箱能解析 ⇒ 本件①与 #1353 D 断言同时必红；反例 ⇒ 不误报
结果：8 断言全绿；配对夹具 63/0 未回归；#1353 夹具零 churn

## 架构层: 基础设施

#CRITERIA: D

## Done 标准:
- [ ] verify: bash tests/control-tower/gate-helper-precondition.test.sh ⇒ 0 失败（8 断言）
- [ ] verify: bash tests/control-tower/merge_writeset_gate.test.sh ⇒ 0 失败（63 断言，配对门禁）
- [ ] verify: bash scripts/control-tower/scan-fullwidth-vars.sh --paths tests/control-tower/gate-helper-precondition.test.sh ⇒ 违规 0
- [ ] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh ⇒ rc=0

## 写集
| 文件 | 类型 |
|---|---|
| scripts/control-tower/merge_writeset_gate.py | task（仅消息层：前提点名 + 真因行） |
| tests/control-tower/gate-helper-precondition.test.sh | task（新夹具：① ② ③变异体 ④反例） |
| memory/notes/implemented/2026-10-08-1361-helper-precondition.md | task（决策沉淀，铁律 49） |
| .claude/task-briefs/2026-10-08-1361-helper-precondition.md | task（自身） |
| .claude/claims/1361.yaml | task（新格式声明载体） |
