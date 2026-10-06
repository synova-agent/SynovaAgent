# Task Brief: D1176 govl-p3-issue-policy

> 生成: 2026-10-06 | 任务: D1176 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等创始人裁
> 派单源: CTO《开发计划 v2》**P3**（Issue 作为工作单元）—— A 槽代做

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`scripts/control-tower/` + `tests/`），非产品五层。
治的是「**PR 没有工作单元**」：改动能合入，但没有任何 Issue 承接它 —— 于是"为什么改"与"改到哪算完"都无锚。
### b) 文件审计
- `gh label list` 实况：`kind/*`（feature/bug-fix/doc/testing/cleanup…）、`area/*`（ci/docs/dispatch/runtime/domain…）、`p0`–`p3` **均已存在** ⇒ 判据有落地载体
- `grep -rln "issue-policy" .github/workflows/ scripts/` ⇒ **零命中**（既有资产 = 无）
- 权威数据源：GitHub 的 `closingIssuesReferences`（**不是**正则扫 PR 正文 —— 那是 S-04「grep 结论分两层」的反面教材）
### c) 决策
新建一个判据脚本 + 判别夹具；**不**在本卡把它接成必需 context（那属"改哪条检查阻断合并" ⇒ 提案→K3→CTO）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35（自动化优先）/ 47（契约优先）；判例 **M-02**（三态 0/1/2，2=检查自身失败同样阻断）、**V-08**（改坏即红）、**V-02**（真跑非 grep）。
- **跳过的坑（本条最重要）**：我第一版只看"有没有 `p0-p3` 标签"，于是「**PR 声明了 Priority、但关联 Issue 一个优先级都没有**」这一支落进了 SKIP 分支。
  夹具的**负对照**（同一载荷 + 一个不一致的 PR Priority）当场抓出 `expect=1 got=0`。
  ⇒ 判据「PR Priority = 最高 resolving Issue 的 Priority」的反面就是：**Issue 没有优先级时 PR 也不该有** ⇒ 那是**不一致**，不是 SKIP。已补这一支。
- **离线可测性是刻意设计**：`--from-json` 让夹具**不依赖网络/不依赖 token** ⇒ 判别力可被任何人复跑（否则夹具会变成"只有 CI 能跑"的黑箱）。
- **R3 的 SKIP 要说出来**：`⏭️ R3: SKIP —— 不冒充通过（不代表合规）`。理由：判据静默跳过 = 假绿（铁律 11 同精神）。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/check-issue-policy.py
- tests/control-tower/check-issue-policy.test.sh
- .github/workflows/ci.yml
  🔴 补声明（复核整改）: 登记新夹具进**两处密封清单**（Gate Integrity 红已消除）——
  D526 语义「未列举 = 永不执行」；**登记 ≠ 进必需 context**（既有机械义务 vs 门禁语义变更）。
- tests/fixtures/issue-policy/pr-ok.json
- tests/fixtures/issue-policy/pr-no-issue.json
- tests/fixtures/issue-policy/pr-bad-labels.json
- tests/fixtures/issue-policy/pr-prio-mismatch.json
- .claude/task-briefs/2026-10-06-D1176-govl-p3-issue-policy.md
- memory/notes/proposed/2026-10-06-d1176-p3-issue-policy.md
- task-state/D1176.json
不做什么：
- 不改 .github/workflows/ci.yml（**接线 = 加一个 job 并在必需集里加它** ⇒ 属"改哪条检查阻断合并" ⇒ 提案→K3→CTO 裁；本卡只出判据体）
- 不改 .github/workflows/product-progress.yml
- 不改 scripts/control-tower/check-pr-budget.sh（阈值归 #1017）
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh
- 不改 docs/synova/coordination/ownership.yaml

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-issue-policy.py --repo <owner/name> --pr <N>`（live，CI 里用 `GITHUB_TOKEN`）
处理：取 `closingIssuesReferences` → 逐 Issue 校标签契约（kind 恰好 1 / area ≥1 / p ≤1）→ 校 PR 与最高优先级 Issue 的 Priority 一致
结果：stdout 逐条 `✅/❌/⏭️` + 末行 `ISSUE-POLICY: <OK|VIOLATION(n)|DEGRADED>`；exit 0/1/2
- `bash tests/control-tower/check-issue-policy.test.sh` ⇒ `RESULT: 18 PASS / 0 FAIL`

## 架构层:
scripts（控制塔门禁面）+ tests（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/check-issue-policy.test.sh` ⇒ 含 `RESULT: 18 PASS / 0 FAIL`
- [ ] verify: `python3 scripts/control-tower/check-issue-policy.py --from-json tests/fixtures/issue-policy/pr-no-issue.json; echo $?` ⇒ 1
- [ ] verify: `python3 scripts/control-tower/check-issue-policy.py; echo $?` ⇒ 2
- [ ] verify: `python3 scripts/control-tower/check-issue-policy.py --from-json tests/fixtures/issue-policy/pr-ok.json; echo $?` ⇒ 0
