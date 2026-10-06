# Task Brief: D1181 govl-transition-proposal

> 生成: 2026-10-06 | 任务: D1181 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L1-静态可达 ｜ 阻塞源=等创始人裁
> 派单源: **本线自开卡**（常设授权四条件满足）—— 把 4 项存量债的**过渡策略**合成一份提案

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`docs/synova/coordination/` 提案 + 文档契约面），非产品五层。
治的是「**待裁项散成 7 条，每条都要 CTO 裁一次**」—— 合成一份 ⇒ 裁一次。
### b) 文件审计（先实测）
- 四项存量债的**实测数字与口径**见提案第一节（D5 473/1710=27.7%（全局）与 593/4119=14.4%（按文件）**两个口径两个数**；
  D6/D7 10 篇超限 + 25 对近重复；D8 顶层平铺 187 / 无前缀 66；D1180 死参数 7）
- 🔴 发现的**问题本身**：同一个 D5 我量出 14.4% 与 27.7%，CTO 派单写 18.9% ⇒ **三个口径，三个数**
- 现存过渡策略载体：`grep -rln "过渡\|棘轮" docs/synova/coordination/` ⇒ 有零散提及，**无统一策略文件**
### c) 决策
**新建一份统一提案**，给出①统一策略（棘轮式五条）②需裁的主问 + 两个子问（各带倾向与代价）
③明确"告知"三项（判据体已交付/存量一条没动/本提案不碰既有文件）。**不改任何既有文件。**

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35/47；判例 **M-03**（棘轮台账只减不增）、**V-09**（未核写未核）、**P-02**（写目的不写形态）、**B档**（按最保守解释 + 标注代价）。
- **本线自己的两次实证**：① D734（`MAX_FILES=12` 直接转硬 ⇒ 36 条既有 PR 一次性转红）
  ② **本线在 D6/D7 上自己重演了一次**（第一版把 `--all` 当"判全部" ⇒ 存量 74 条一次性全红，自测时抓到）
- **V3.9 教训**：噪音 → 整条门禁被绕过 ⇒ 存量债天天红会把判据体本身 `--no-verify` 掉
- 决策参考：**第一性原理**（新债必红 + 存量可清，只有"棘轮"同时满足）+ **开源实证**（ESLint `--fix`/`--max-warnings` 的棘轮用法）⇒ 结论 = 棘轮式五条

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/D1181-提案-存量债统一过渡策略.md
- .claude/task-briefs/2026-10-06-D1181-govl-transition-proposal.md
- memory/notes/proposed/2026-10-06-d1181-transition-proposal.md
- task-state/D1181.json
不做什么：
- 不改任何既有存量文件（7 个死参数 / 10 篇超限 / 25 对近重复 / 187 个平铺文件）
- 不改 scripts/control-tower/check-decl-vs-impl.py
- 不改 scripts/control-tower/check-coordination-hygiene.py
- 不改 scripts/doc-system/doc-registry-gate.sh
- 不改 .github/workflows/ci.yml
- 不改 .github/workflows/product-progress.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh
- 不改 docs/authority/DOCS-REGISTRY.yaml

## Q3: 验收 — 入口 → 交互 → 结果
入口：CTO 阅读该提案
处理：读第一节（四项实测 + 口径）→ 第二节（统一策略五条）→ 第三节（主问 + 子问 A/B，各带倾向与代价）
结果：CTO 裁一次即可铺开四项
- `git cat-file -e HEAD:docs/synova/coordination/D1181-提案-存量债统一过渡策略.md` ⇒ 成功
- `grep -c "27.7%" <文件>` ⇒ 1（两个口径都写明）
- `grep -c "子问 A" <文件>` ⇒ 1

## 架构层:
文档契约层（非产品五层）

## Done 标准
- [ ] verify: `git cat-file -e HEAD:docs/synova/coordination/D1181-提案-存量债统一过渡策略.md` ⇒ exit 0
- [ ] verify: `grep -c "27.7%" docs/synova/coordination/D1181-提案-存量债统一过渡策略.md` ⇒ 1
- [ ] verify: `grep -c "我倾向 A1" docs/synova/coordination/D1181-提案-存量债统一过渡策略.md` ⇒ 1
- [ ] verify: `grep -c "我倾向 B2" docs/synova/coordination/D1181-提案-存量债统一过渡策略.md` ⇒ 1
