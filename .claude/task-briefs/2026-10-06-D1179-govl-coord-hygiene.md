# Task Brief: D1179 govl-coord-hygiene

> 生成: 2026-10-06 | 任务: D1179 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=等创始人裁
> 派单源: CTO《开发计划 v2》第四批 **D6**（268 平铺协调文件：一份一主题 + 词数 ceiling + 禁 INDEX.md）+ **D7**（无反重复闸）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
文档契约层（`docs/synova/coordination/`），非产品五层。
治的是「**协调目录无任何卫生判据**」：篇数、篇幅、重复都无人管。
### b) 文件审计（**先实测，不靠记忆**）
- `docs/synova/coordination/` 共 **268** 文件，其中**顶层平铺 187**、顶层 `.md` **173** ⇒ 与派单的「268 平铺」**对得上**
- 篇幅（字符）分布：中位 **3642** ｜ **p90 11824** ｜ max **201133**
- 近重复（token Jaccard ≥0.55）：**25 对**（**排除 `/archive/`**；若不排除则 47 对 —— **口径不同，数不同**）
- 无 `INDEX.md`（当前）
### c) 决策
出**检测器**（三态 + 判别夹具），**并刻意做成"棘轮式"**：
`--all` = **盘点**（存量只报数、**不判红**）；`--changed` = **判红**（只判本次涉及文件）。
🔴 理由 = **D734 教训**：把 251 篇存量的 10 篇超限 + 25 对近重复**一次性转红**，与"清理存量"目标相反。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35（自动化优先）/ 47（契约优先）；判例 **V-08**（改坏即红）、**M-02**（三态）、**V-09**（未核写未核）、**P-03**。
- **阈值必须来自实测分布，不拍脑袋**（同 D734 的 p90 教训）：p90 = 11824 ⇒ 上限取 **×2 = 24000**，
  并把出处写进输出行（可复核）。
- 决策参考：**第一性原理**（先让坏可见，再谈清理）+ **Anthropic 工程基线**（棘轮：新债必红、旧债可见）⇒ 结论 = 检测器 + 棘轮式。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/check-coordination-hygiene.py
- tests/control-tower/check-coordination-hygiene.test.sh
- .github/workflows/ci.yml
  🔴 补声明（复核整改）: 登记新夹具进**两处密封清单**（Gate Integrity 红已消除）——
  D526 语义「未列举 = 永不执行」；**登记 ≠ 进必需 context**（既有机械义务 vs 门禁语义变更）。
- .claude/task-briefs/2026-10-06-D1179-govl-coord-hygiene.md
- memory/notes/proposed/2026-10-06-d1179-coord-hygiene.md
- task-state/D1179.json
不做什么：
- 不批量修存量的 10 篇超限 / 25 对近重复（**须先定过渡策略** ⇒ 提案→K3→CTO）
- 不改 docs/synova/coordination/ 下任何既有文档
- 不改 .github/workflows/ci.yml
- 不改 .github/workflows/product-progress.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh
- 不改 docs/authority/DOCS-REGISTRY.yaml
- 不改 scripts/control-tower/check-pr-budget.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-coordination-hygiene.py [--all|--changed <file>...]`
处理：R1 禁 INDEX.md ／ R2 篇幅上限（24000 字符，源自 p90×2）／ R3 近重复（token Jaccard ≥0.55，排除 archive）
结果：逐条 `✅/❌/ℹ️` + 末行 `COORD-HYGIENE: <OK|VIOLATION(n)|DEGRADED>`；exit 0/1/2
- `bash tests/control-tower/check-coordination-hygiene.test.sh` ⇒ `RESULT: 12 PASS / 0 FAIL`

## 架构层:
文档契约层 + scripts/control-tower（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/check-coordination-hygiene.test.sh` ⇒ 含 `RESULT: 12 PASS / 0 FAIL`
- [ ] verify: `python3 scripts/control-tower/check-coordination-hygiene.py --all; echo $?` ⇒ 0
- [ ] verify: `python3 scripts/control-tower/check-coordination-hygiene.py --changed docs/synova/coordination/CTO履职总账-旧CTO-4d509874-提取20260909.md; echo $?` ⇒ 1
- [ ] verify: `python3 scripts/control-tower/check-coordination-hygiene.py --root /tmp/nope-$$ --all; echo $?` ⇒ 2
