---
状态: proposed
日期: 2026-10-05
决策: 提交端声明类门禁 15 个执行点收敛为 3 条硬闸（①brief schema ②brief↔代码一致性 ③可证伪 Done），其余转旁路（只打印不判红不进 gate-hits）或退役；成功路径静默、失败路径点名。
理由: 门禁的价值是判别力而非执行点数量——声明类实测占 gate-hits 命中约 35%，榜首 `opt_check "PRD 对照…"` 261 次命中且永不阻断，噪音 ⇒ 整条门禁链被绕过（V3.9：软机制 0% 有效；V4.5.1：122s pre-commit ⇒ `--no-verify` 泛滥）。合并执行点 + 成功静默 = 保留判定力、去掉噪音；三条硬闸各自可注入即红（先红后绿夹具物理证明）。
---

# D1148 · 声明类门禁 15 → 3（降噪，改坏即红）

## 触发场景

批 3「单套门禁」task-3：提交端 `scripts/pre-commit-check.sh` 的声明/文书类执行点实测 15 个，
其中多个是**零判别力**或**重复判定**，但每次提交都占输出行：

| 原执行点 | 实测问题 | 处置 |
|---|---|---|
| `opt_check "PRD 对照…"` | 261 次命中 / 永不阻断（`opt_check` 有意不转硬，D520） | **退役**（删检查点 + 注释指向 D1148；`opt_check` 函数随之为死代码删除） |
| 6 字段 / 骨架 / 时间戳 / brief 存在 / Q0c | 四条独立输出行，同一类错 | 并入**闸① brief schema** |
| G12 范围 / G12b 可解析 / plan-integrity Q2 排除项 | 三处判同一件事（写集 ⊆ 声明） | 并入**闸② brief↔代码一致性** |
| `check-verifiable-done.sh` | 独立执行点 | 升为**闸③ 可证伪 Done** |
| G12c dev doc 写集 / G12d 声称↔证据表(U4 D423) | 条件触发、判定与主闸重叠 | 转旁路 |
| plan-integrity（plan.json principles/approach/memory_refs） | 与本提交质量弱相关 | 转旁路 |
| acceptance-ci | 条件触发 | 转旁路 |
| D782 D1 文档真相 / D2 登记门禁 | 文档域，非提交质量根 | 转旁路（**保留调用点**——`doc-registry-gate.test.sh` W1/W2 依赖） |
| D734 PR 预算 | 与 D708/D734/G12 阈值互斥（#1017 在办） | 转旁路 |
| q0c（plan.json cancel/follow_up） | 实测零命中（plan.json 无 cancel 相位） | 并入闸①（Q0 系列成员）；脚本调用降为旁路观测 |

## 撤回留痕（2026-10-05 CTO 裁决：撤回表述 + 立卡，不补完再合）

| 处 | 原句 | 改后 | 依据 |
|---|---|---|---|
| `scripts/pre-commit-check.sh` D734 注释块 | 「…PR 级预算仍可由 check-pr-budget.sh 独立运行/**CI 侧接入**。」 | 「**现无阻断执行方**（全树无第二个阻断调用点）」 | `git grep -n check-pr-budget -- .github scripts/ci` **零命中**（rc=1）⇒「CI 侧接入」无据；「独立运行」=手工可跑（同义反复） |
| 同文件 acceptance-ci 注释块 | 「…**实际阻断记录为零**…」 | 「**现无阻断执行方**」 | 唯一调用点 `pre-commit-check.sh:497` 已旁路；gate-hits '验收 CI' 0 条（历史未触发）；改前 `v5_soft` 在 CI strict 下**可**阻断 ⇒ 原句不精确（非虚构） |

**例外清单（新增，明写）**：**现无阻断执行方** = ①D734 PR 预算门禁 ②`check-acceptance-ci.sh`
⇒ 二者不再阻断任何提交；连带 **"Done 已证"无人做**（闸③ 只验 `verify:` 字符串存在，不执行命令）。
**立卡内容**：卡 A = D734 CI 侧接入；卡 B = `check-verifiable-done.sh --brief`（K3：闸③ 升硬前必须先改它）。

## 关键设计（可核）

1. **成功静默 / 失败点名**：`hard_check`/`soft_check`/`soft_pass` 的成功分支改为
   `[ "${SYNO_QUIET_SUCCESS:-1}" = "1" ] || echo ✅` —— 自包含（不引入外部函数），
   故 `ci-strict-visible.test.sh` 用 `sed` 提取函数源码后单独 `source` 仍打印 ✅（缺省为**打印**）。
   组 7a 以 `SYNO_QUIET_SUCCESS=0 soft_check …` 前缀赋值**显式保留 ✅ 行**——`gate-failopen-net.test.sh`
   的 `seven_a_lines` 以该行做判别（T1/T1s/T4/T5/T5c/T3f 全靠它）。
2. **旁路 = 只打印不判红且不进 `.claude/gate-hits.log`**（新增 `note_check` / `bypass_run`：
   成功零输出，失败打 `ℹ️ …（旁路观测，不阻断）`）。与软提示的差别：软提示在 CI strict 转硬，旁路不转。
3. **三态不放松**：0=过 / 1=违规 / 2=检查自身失败（同阻断）；无新增 `|| true`；`decl_check`
   的沙箱感知（真提交硬 / 夹具软）原样保留。
4. **不动的接线**：12 个 `── 组 N/13` 标签、`全部 13 组通过`、`跳过 12 组` 横幅、
   组 7a ✅ 行、`doc-registry-gate.test.sh` W1/W2、`doc-commit-exempt.test.sh` T11、
   `check-notes-lifecycle.test.sh` 的 Notes 迁移调用点、`check-pr-budget.test.sh` 的调用点。

## 参考系

- 参考：Anthropic/DeepSeek/第一性原理 + 结论＝三闸 + 旁路 + 成功静默。
- 判例：V-03（独立复核）、M-02（三态退出码）、U5（同类错误第二次=防线系统性失效）。
- 前序：D515/D516（软提示 + CI 权威）、D542（CI strict 失败必须点名）、D1028（假绿专题：注入即验证）。
- 相关 D#: D1148（本卡）｜#1017（D734 阈值互斥，另卡）｜#1015（治理三条，另卡）。
