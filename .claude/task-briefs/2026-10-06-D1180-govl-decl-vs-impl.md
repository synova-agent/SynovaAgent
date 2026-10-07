# Task Brief: D1180 govl-decl-vs-impl

> 生成: 2026-10-06 | 任务: D1180 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第4批-文档 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=无阻塞
> 派单源: **本线自开卡**（常设授权：属本线域/判据可机器判/不改架构接口schema/不与在飞 PR 写集重叠）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（`scripts/`），非产品五层。
治的是本线**反复踩的同一族**：「**声明**」与「**实现**」之间没有任何东西在守。
### b) 文件审计（先实测）
- 实测形态（本线真实案例）：`--json` 写在文档头却**从未声明**（#1189）｜`--all` 声明却**从不被引用**（#1189）｜
  `REBUILT/ABSENT` 死变量伪造计数（W12 N2）｜`git log -S` 定位漂移（W12 B2）｜注释写「12 必需 context」实为 9（W9）
- 现存检查：`grep -rln "decl.*impl\|声明.*实现" scripts/` ⇒ 零命中（无检测器）
### c) 决策
自建 `check-decl-vs-impl.py`，**只守最容易机器判的那一类 = Python argparse**（声明↔实现）。
**不泛化**到 shell（假阳性会淹没信号 —— V3.9 教训：噪音导致整条门禁被绕过）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35（自动化优先）/ 37（死码入仓库即违规）；判例 **V-08**（改坏即红）、**M-02**（三态）、**V-09**（未核写未核）。
- **V3.9 教训直接决定设计**：「硬阻断 100% 有效，软机制 0% 有效；噪音 → 整条门禁被绕过」
  ⇒ 凡**精确**的判据做硬阻断（R1），凡**启发式**的判据**只做顾问级**（R2）——
  **不同精度必须给不同强度**，否则 R2 的假阳性会拖垮 R1 的信誉。
- 决策参考：**第一性原理**（守不住全部，就先守住能被机器精确判的那一类）+ **Anthropic 工程基线**
  （AST 取声明、按属性名查引用，而不是文本猜测）⇒ 结论 = AST 级 R1 硬 + 文本级 R2 顾问。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/check-decl-vs-impl.py
- tests/control-tower/check-decl-vs-impl.test.sh
- .github/workflows/ci.yml
  🔴 补声明（复核整改）: 登记新夹具进**两处密封清单**（Gate Integrity 红已消除）——
  D526 语义「未列举 = 永不执行」；**登记 ≠ 进必需 context**（既有机械义务 vs 门禁语义变更）。
- .claude/task-briefs/2026-10-06-D1180-govl-decl-vs-impl.md
- memory/notes/proposed/2026-10-06-d1180-decl-vs-impl.md
- task-state/D1180.json
不做什么：
- 不修存量 7 个死参数（**报数不改** —— 改别的线的脚本超出本卡写集；且须先定过渡）
- 不改 scripts/control-tower/brief_parser.py
- 不改 scripts/control-tower/wait_manager.py
- 不改 scripts/control-tower/staging_guard.py
- 不改 scripts/control-tower/check-required-contexts.py
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/audit/check-audit-consistency.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-decl-vs-impl.py [--changed <py>...]`
处理：AST 取 `add_argument` 声明（尊重 `dest=`，跳过 `action=version/help`）→ 按属性名查引用
结果：`✅/❌/⚠️/ℹ️` + 末行 `DECL-VS-IMPL: <OK|VIOLATION(n)|DEGRADED>`；exit 0/1/2
- `bash tests/control-tower/check-decl-vs-impl.test.sh` ⇒ `RESULT: 7 PASS / 0 FAIL`

## 架构层:
scripts（控制塔门禁面）（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/check-decl-vs-impl.test.sh` ⇒ 含 `RESULT: 7 PASS / 0 FAIL`
- [ ] verify: `python3 scripts/control-tower/check-decl-vs-impl.py; echo $?` ⇒ 0（盘点不判红）
- [ ] verify: `python3 scripts/control-tower/check-decl-vs-impl.py --changed scripts/control-tower/check-decl-vs-impl.py; echo $?` ⇒ 0
- [ ] verify: `python3 scripts/control-tower/check-decl-vs-impl.py --root /tmp/nope-$$; echo $?` ⇒ 2
