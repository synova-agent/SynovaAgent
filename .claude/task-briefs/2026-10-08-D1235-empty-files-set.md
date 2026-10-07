# Task Brief — D734 空写集注入缝：`--files ""` 不再直落真实 diff（D1235）

> 编号 **D1235**（用前三重核验：gate 可用 / main 零文件 / issue 标题零命中）
> 来源：卡 **#1302** 附带发现（Lead 派单「先只报定位」，定位获采纳后**批准修法**）
> 属**门禁语义变更** ⇒ 编入 **K3 批五**；我只做到 PR，不自行合并。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（控制塔门禁）。`check-pr-budget.sh` = D734 PR 预算门禁（≤12 文件），
其 `--files` / `--diff-status` 是**测试注入缝**（D1028 设计）。
### b) 文件审计（实跑）
- 病灶：`check-pr-budget.sh:137` 旧判据 `elif [ -n "$FILES_OVERRIDE" ]`
  ⇒ `--files ""` 与「未给 `--files`」**不可区分** ⇒ 直落**真实三点 diff**。
- 同文件 `--diff-status` **已有**正确范式：`DIFF_STATUS_SET=0`（`:104`）+ `-eq 1`（`:134`）
  ⇒ 作者本人知道该陷阱，**只是 `--files` 没照做**（同文件内不一致）。
- 后果实测：造 14 文件三点 diff 的工作树 ⇒ 该用例 **rc=1**，且**误报成「0 文件（空写集）」失败**；
  `git fetch` 把 main 前移后同一棵树**自动转绿** ⇒ 表现为「flake」（今日两次"看似的红其实不是"即此类）。
### c) 决策
与 `DIFF_STATUS_SET` **对齐**（最小一致修），保留缺省路径零行为变化。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **第一性原理**：测试注入缝的语义应是「**是否提供**」而非「值是否非空」——
  空集是**合法输入**，不能被当成"没提供"。
- **既有实证（同仓）**：`--diff-status` 早已用 `_SET` 标志解决同一问题 ⇒ **复用既有范式**，不新造机制。
- **反例（反向教训）**：我本次**又踩了全角陷阱**（`rc=$_rc（期望 0）`）——
  被**棘轮**（`scan-fullwidth-vars.test.sh` tests/ 面硬零）与**我自己的夹具**当场抓住
  （`line 599: _rc?: unbound variable`）⇒ 已修 3 处 `${_rc}（`，棘轮回 0。
  教训：**新写夹具必须过棘轮**，我在交 PR 前跑了它。
参考：第一性原理（空集是合法输入）+ 同仓既有范式（`DIFF_STATUS_SET`）⇒ 对齐式最小修。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/check-pr-budget.sh
- tests/control-tower/check-pr-budget.test.sh
- .claude/task-briefs/2026-10-08-D1235-empty-files-set.md
- memory/notes/proposed/2026-10-08-d1235-empty-files-set.md
- task-state/D1235.json

改动内容：
1. 工具：`FILES_SET=0` 新增 · `--files) … FILES_SET=1` · 判据改 `[ "$FILES_SET" -eq 1 ]`（3 处，含注释）；
2. 夹具：`check-pr-budget.test.sh` 新增 **§17**（自建 14 文件沙箱，与工作树解耦）：
   17.1 先红后绿（`--files ""` ⇒ exit 0）· 17.2 判据实况（输出「变更文件数 0」）·
   17.3 **反例**（不传 `--files` ⇒ 仍走真实 diff ⇒ exit 1）· 17.4 与 `--diff-status` 对称性 ·
   夹具自查（沙箱三点 diff=14，防夹具自身失真）；
3. `:139` 用例名改写（旧名「0 文件（空写集）」在失败时**误导** ⇒ 写明注入缝语义）。

不做什么（含文件路径）：
- **不改**缺省路径（不传 `--files`/`--diff-status`）的任何行为 —— 由 17.3 反例钉住
- **不改** `--max-files` / `--decl-file` / D1028 出库豁免 / 单域判定的判据
- 不改 `.github/workflows/ci.yml`、`scripts/pre-commit-check.sh`、`scripts/audit/**`

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/check-pr-budget.test.sh`
处理：沙箱 14 文件变更 → 三种调用（`--files ""` / 不传 / `--diff-status ""`）
结果：修后 **197/197 rc=0**；指向旧口径（`SYNO_BUDGET_SRC`）⇒ **rc=1 且干净报 ❌**（不再崩）。

## 架构层: 治理面（scripts/control-tower）
#CRITERIA: D

## 变更点 / 旧口径 vs 新口径 / 回滚（供 K3 批五）
| 项 | 旧口径 | 新口径 |
|---|---|---|
| `--files ""` | 与「未提供」不可区分 ⇒ 落真实三点 diff | **显式提供 ⇒ 真空写集**（0 文件 ⇒ exit 0） |
| 不传 `--files` | 落真实三点 diff | **不变**（真实三点 diff）—— 反例 17.3 钉住 |
| 与 `--diff-status` | 不一致（一个用 `_SET`、一个用 `-n`） | **一致**（两者皆 `_SET`） |
| 回滚 | — | 单文件 3 处：删 `FILES_SET`/`FILES_SET=1`，判据改回 `[ -n "$FILES_OVERRIDE" ]` |

## Done 标准
- [ ] verify: `bash tests/control-tower/check-pr-budget.test.sh` ⇒ rc=0 且 `全部通过: 197 项`
- [ ] verify: `SYNO_BUDGET_SRC=<origin/main 版工具> bash tests/control-tower/check-pr-budget.test.sh` ⇒ rc=1 且含 `❌ 17.1`
- [ ] verify: 沙箱内 `--files ""` ⇒ rc=0；不传 `--files` ⇒ rc=1（先红后绿 + 反例）
- [ ] verify: `bash tests/control-tower/scan-fullwidth-vars.test.sh` ⇒ `棘轮: tests/ 面违规 = 0`
- [ ] verify: `bash scripts/pre-commit-check.sh` ⇒ 13 组通过
