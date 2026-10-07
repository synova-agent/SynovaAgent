# Task Brief — 1224-b-followers: B 类跟随面一致性断言（D-C 退场口径 · 卡 #1224）

## Q0: 定位
- 治理面（门禁/控制塔域）：D-C「四解析器退场」的 **B 类（经 resolver 间接消费声明、自身不判身份）跟随面**。
  本卡只**新增夹具 + 台账 + 一条 §3 行为断言**，**不改任何 B 类文件**（卡 #1224 口径：「B 类不改」）。
- 服务承重件：声明↔归属对账（D328/D708）在**新格式（claim/issue）**下的跟随面完整性。

## Q1: 调研
- 风险（卡 #1224 口径）：**跟随者漏改** —— A 类身份核心切到 claim 后，B 类若仍按「声明件文件名里的 D#」
  派生身份，会输出空身份/空转而**不报错**（静默）。
- 实测（本卡数据，`grep -rl 'resolve-commit-brief' scripts/`）：
  - resolver 消费点 = **11 个** = A 类 5（`commit-msg-check.sh` / `pre-commit-check.sh` /
    `merge_writeset_gate.py` / `resolve-commit-brief.sh` / `brief_parser.py`）∪ B 类 6（卡面所列）。
  - 其中 B 类内命中「D#-专属身份派生」者 **2 个**：`check-verifiable-done.sh`（同存 claim 容错 ✅）、
    `scripts/project/pr-queue-scan.py`（**无** claim 容错 ⇒ 登记台账，成为"可见待改面"）。
  - 行为实测（沙箱、开关仅沙箱内注入）：分支带 issue + claim + `SYNO_CLAIM_V2=1` ⇒
    `check-verifiable-done.sh` **读到 claim.done** ⇒ rc=0「全部有 verify」（跟随面在新格式下工作）；
    分支**不带** issue（暂存集非空）⇒ **显式 fail-closed** rc=1「解析不出任何声明」（不静默跳过）。
- 决策参考：第一性原理（**跟随面要么可跟随、要么可见**，不许静默）＋ Anthropic 工程基线
  （判据机器可判、台账有 owner/到期）＋ 本仓既有棘轮形态（`fixture-power-baseline.txt` 同格式）。

## Q2: 范围
做什么：
- tests/control-tower/b-followers-claim-consistency.test.sh
- tests/control-tower/b-followers-baseline.txt
- .claude/task-briefs/2026-10-08-1224-b-followers-consistency.md
- .claude/claims/1224.yaml
不做什么（含文件路径）：
- 不改 scripts/check-plan-integrity.sh、scripts/project/pr-queue-scan.py、scripts/workflow/check-brief-parseable.sh、
  scripts/workflow/check-brief-vs-code.sh、scripts/check-brief-vs-code.sh、scripts/check-verifiable-done.sh
  （卡口径：B 类**不改**，本卡只加断言/台账；改 B 类属另一张卡）
- 不改 scripts/control-tower/merge_writeset_gate.py（A 类；helper 定位与措辞修正由 Lead 另裁/另卡）
- 不改 scripts/control-tower/alloc-task-id.sh、.github/workflows/ci.yml、scripts/audit/**
- 不动 scripts/control-tower/claim_store.py 的 SYNO_CLAIM_V2 默认值（仅夹具沙箱内注入 1）

## Q3: 验收
入口：`bash tests/control-tower/b-followers-claim-consistency.test.sh`
处理：§1 枚举闭包（新增 follower 必分类）／§2 形态网（D#-专属身份派生 ⇒ 有容错或可见登记台账）／
      §3 行为网（claim 载体可消费 + 对照显式 fail-closed）／§4 台账格式与到期
结果：10 断言全绿；跟随面在切换那天**不会静默**（可跟随或可见待改）

## 架构层: 基础设施

#CRITERIA: D

## Done 标准:
- [ ] verify: bash tests/control-tower/b-followers-claim-consistency.test.sh ⇒ 0 失败（10 断言）
- [ ] verify: bash scripts/control-tower/scan-fullwidth-vars.sh --paths tests/control-tower/b-followers-claim-consistency.test.sh ⇒ 违规 0
- [ ] verify: bash scripts/control-tower/check-gate-integrity.sh ⇒ GATE-INTEGRITY: OK
- [ ] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh ⇒ rc=0

## 写集
| 文件 | 类型 |
|---|---|
| tests/control-tower/b-followers-claim-consistency.test.sh | task（新夹具） |
| tests/control-tower/b-followers-baseline.txt | task（棘轮台账：owner/expires/reason） |
| .claude/task-briefs/2026-10-08-1224-b-followers-consistency.md | task（自身） |
| .claude/claims/1224.yaml | task（声明载体：累加 3 条，既有行零改动） |
