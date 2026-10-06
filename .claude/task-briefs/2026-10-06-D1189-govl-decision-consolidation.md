# Task Brief: D1189 govl-decision-consolidation

> 生成: 2026-10-06 | 任务: D1189 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L1-静态可达 ｜ 阻塞源=等创始人裁
> 派单源: **本线自开卡**（常设授权四条件满足）—— 把 6 项待裁**收敛为 1 次裁决**

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`docs/synova/coordination/` 提案面），非产品五层。
治的是「**待裁项散成 6 条，每条都要 CTO 裁一次**」—— 合成一份 ⇒ 裁一次。
### b) 文件审计（先实测）
- 六条待裁的**实测数字**见提案第一节（R1 抽样 25 PR: CIR 非空 1/25 vs `Refs #N` 14/25；
  聚合 needs 10 ⊃ 必需 9；堆叠 PR 0 run；D5 两个口径 27.7%/14.4%；D4 扫描 325 文件 0 命中；
  ruleset `require_extra_approval_for_unattributed_changes` + 全部提交未归属）
- 现存载体：已有 #1191（存量债过渡策略）—— **本提案与之衔接而非重复**（④ 只列结论并指向 #1191）
### c) 决策
**新建一份合并提案**，六条逐条给「事实 → 选项 → 我倾向 → 代价 → 需你裁什么」，
并在开头写明「本提案只新建、不碰既有文件 ⇒ 不需要等 K3 就能先看」。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35/47；判例 **P-02**（写目的不写形态）、**V-09**（未核写未核）、**M-03**（棘轮只减不增）、**B档**（最保守解释 + 标注代价）。
- 本线实证：**D734**（越守规矩越红）→ ① 与 ④ 都是同型；本线**自己在 D6/D7 上重演过一次**。
- 决策参考：**第一性原理**（CTO 的时间是最稀缺资源 ⇒ 减少裁决次数本身就是价值）
  + **Anthropic 工程基线**（决策文档应含选项/倾向/代价，不是开放式提问）⇒ 结论 = 合并提案。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/D1189-提案-六项待裁合并裁决.md
- .claude/task-briefs/2026-10-06-D1189-govl-decision-consolidation.md
- memory/notes/proposed/2026-10-06-d1189-decision-consolidation.md
- task-state/D1189.json
不做什么：
- 不改任何既有文件（**本提案是纯新建**）
- 不改 .github/workflows/ci.yml
- 不改 scripts/control-tower/check-issue-policy.py
- 不改 scripts/doc-system/doc-registry-gate.sh
- 不改 scripts/control-tower/check-coordination-hygiene.py
- 不改 scripts/control-tower/check-doc-ref-integrity.py
- 不改 docs/synova/coordination/D1181-提案-存量债统一过渡策略.md
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO 阅读该提案
处理：逐条读「事实 → 选项 → 我倾向 → 代价」⇒ 每条批/驳即可
结果：**6 次裁决收敛为 1 次**
- `git cat-file -e HEAD:docs/synova/coordination/D1189-提案-六项待裁合并裁决.md` ⇒ 成功
- `grep -c "我倾向" <文件>` ⇒ ≥5（每条都给倾向）
- `grep -c "需你裁 Z" <文件>` ⇒ ≥5

## 架构层:
文档契约层（非产品五层）

## Done 标准
- [ ] verify: `git cat-file -e HEAD:docs/synova/coordination/D1189-提案-六项待裁合并裁决.md` ⇒ exit 0
- [ ] verify: `grep -c "我倾向" docs/synova/coordination/D1189-提案-六项待裁合并裁决.md` ⇒ ≥5（实测 7）
- [ ] verify: `grep -c "需你裁 Z" docs/synova/coordination/D1189-提案-六项待裁合并裁决.md` ⇒ 5
- [ ] verify: `grep -c "未核" docs/synova/coordination/D1189-提案-六项待裁合并裁决.md` ⇒ ≥2
