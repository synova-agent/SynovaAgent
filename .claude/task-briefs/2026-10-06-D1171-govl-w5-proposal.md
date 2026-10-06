# Task Brief: D1171 govl-w5-proposal

> 生成: 2026-10-06 | 任务: D1171 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等创始人裁
> 派单源: CTO《开发计划 v2》A 槽 **W5**（门禁语义变更 ⇒ 提案 → K3 过审 → CTO 裁）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层。本卡**只出提案**（判据未裁 ⇒ 实现无意义），不改任何判据。
### b) 文件审计
- `.github/workflows/ci.yml:512-516` → 重活 step 的 `if:` 带**路径判据门**（`steps.ctsignal.outputs.run == 'true'`）
- `tests/control-tower/ci-signal-classify.test.sh:226-227` → **逐字固定**「重活 step 消费 `steps.ctsignal.outputs.run`」
- 同文件 `:240-248` → **D1147 先例**：「有意的门禁结构变更，随本卡同批送 K3/CTO 过审…钉子的**语义**保留，只改**期望值**」
- 该 job `timeout-minutes: 14`（`ci.yml:416`），重活 step 级 13
### c) 决策
按 D1147 先例出**同形态提案**（含候选/代价/倾向/须裁项/红线/未核），**不实现**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）；判例 **V-02**（真跑，非 grep）、**P-03**（断言不变性）、**S-04**（grep 结论分两层）。
- **独立测量（as_of 2026-10-06）**：最近 40 条 run 里 success 11 条，其中该 step **被 skip 10/11 = 90.9%**；
  40 条里真执行过 10/39 ≈ 25.6%；跳因 = classifier `结论: MISS ⇒ run=false`。
- 🔴 **与 W3 的关系（本卡的关键判断）**：W3 的聚合 job 判的是 **job 级** `needs.*.result`，
  而本处被 skip 的是 **job 内的 step**（job 本身结论 = success）⇒ **W3 在结构上抓不到本处**。两条**正交**。
- 决策参考：**第一性原理**（必需 context 不能在"什么都没跑"时报成功）+ **Anthropic 工程基线**
  （判据必须能区分"跑过且绿"与"没跑"）⇒ 结论 = 必须消除该歧义；但**消除的方式动到 CI 成本与判据本身** ⇒ 交 CTO 裁。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md — 新建（提案本体）
- .claude/task-briefs/2026-10-06-D1171-govl-w5-proposal.md / memory/notes/proposed/2026-10-06-d1171-w5-proposal.md / task-state/D1171.json
不做什么：
- 不改 .github/workflows/ci.yml（判据未裁，实现无意义）
- 不改 tests/control-tower/ci-signal-classify.test.sh（夹具期望值须随**裁后**的实现同批改）
- 不改 scripts/control-tower/check-pr-budget.sh（阈值归 #1017）
- 不改 docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh
- 不碰 scripts/audit/check-audit-consistency.sh（K3 红线）
- 不改 .github/workflows/ci.yml 里任何既有 job 的 `name:`

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO/K3 阅读本提案
处理：三选一（A 恒跑 / B 独立 job / C 两层+改判据）
结果：
- 提案件落库：`git cat-file -e HEAD:docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md` ⇒ 成功
- 三个候选**各有代价列**且**都有"是否满足判据"的判定**（含 C 的"部分"与理由）
- 明确写出**倾向 A + 代价**，并说明"若你更看重吞吐则 C 更优，但那需要你先把判据改写清楚"
- 明列须同批改的夹具断言（`:226-227`）与 D1147 先例出处

## 架构层:
文档契约层 + `.github/workflows/`（非产品五层）

## Done 标准
- [ ] verify: `git cat-file -e HEAD:docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md` ⇒ exit 0
- [ ] verify: `grep -c "90.9%" docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md` ⇒ 1
- [ ] verify: `grep -c "ci-signal-classify.test.sh:226" docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md` ⇒ 1
- [ ] verify: `grep -c "W3 在结构上抓不到本处" docs/synova/coordination/D1171-门禁提案-W5-hermetic-step不再skip.md` ⇒ 1
