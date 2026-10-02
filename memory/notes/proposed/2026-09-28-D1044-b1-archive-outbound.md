---
状态: proposed
日期: 2026-09-28
决策: `.claude/task-briefs/archive/` 294 件按「先承接、后移出」出库——承接副本落**仓外档案仓** `~/Synova-过程档案/出库-主仓/.claude/task-briefs/archive/`（保形落点，逐件 sha256 对账 294/294），主仓侧 `git rm -r` 一气执行；本批**不依赖** A3/#862（G10 恒不触发，实测），也**不依赖** D1028 出库豁免（预算实测由 D860 治理产物豁免放行）。
理由: ① 删除对读者是不可逆动作，唯一可接受对价 = 同一内容的副本已在**另一个独立 git 仓**可读，故顺序不可颠倒（契约 §9:295「移出必与接手同批」）；② 卡面「隐藏前置：G10 会报红 ⇒ 等 #862」**前提不成立**——`scripts/pre-commit-check.sh` 的 G10 条件区域检查读 `$CHANGED_FILES`/`$STAGED_FILES`，二者**全脚本 0 处赋值**（幽灵变量），注入缝实测输出恒为 `✅ G10: 无 task brief 变更(跳过)`；③ 卡面「D734 预算靠 #864 出库豁免」**归因错误**——实测 `check-pr-budget.sh --diff-status <301 行真实变更集>` 输出 `ℹ️ 出库豁免不适用（ⓐ 不满足）`，实际放行来自既有 D860 治理产物豁免 300 件 → `N_FILES=1`；④ 卡面 2172→1878 是 `4afd4ce1` 时点的绝对值，`origin/main` 已前进至 `ff467712`（实测 2193），故判据必须改为「同一命令 Δ = −294」，否则数字必然漂移（M7 型）；⑤ 证据文件用 `.json` 而非 `.txt`：`.txt` 不在 `ci.yml:51` docs-only 白名单 ⇒ 触发全量 CI（≈35 min，卡面红线），`.md` 落证据目录会被 `doc-registry-gate.sh` 判未登记（实测 ❌），`.json` 是唯一同时满足两者的扩展名。
---

# 决策 Note — D1044 B1 `.claude/task-briefs/archive/` 294 件出库

> 任务: D1044 ｜ 小队 B1（队长 `synova-squad-lead`）｜ 分支 `chore/b1-archive-outbound`
> 规格源：`.claude/task-briefs/2026-09-28-D1044-B1-archive-294-outbound.md`
> 状态：proposed（待 K3 复审 + CTO 收件闸后 `git mv` 到 `implemented/`）

---

## 1. 触发场景

`docs/synova/DOC-CONTRACT.md` §7:256 规定 `.claude/task-briefs/` 停产出，存量分流为「含决策⇒抽决策文件；不含⇒出库」。
B1 是文档线出库批次的第一批：对象 `.claude/task-briefs/archive/` 294 件（实测 `git ls-files` = 294）。

## 2. 实测依据（可核，命令原始输出见 `docs/synova/product-lines/evidence/D1044-B1/`）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 294 件零引用（294/294） | `git grep -F -f <294 全路径>` 与 `-f <294 词干>`（`--untracked`、排除 archive 自身）两遍均 **0 行** |
| F2 | G10 是**幽灵变量**死检查 | `grep -n "STAGED_FILES\|CHANGED_FILES" scripts/pre-commit-check.sh` → 使用 4 处（`:1179,:1203,:1225,:1230`）、**赋值 0 处**；仓内既有登记：`docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D387-doc-commit-exempt-20260816.md:144`「`CHANGED_FILES` 是幽灵变量 → 条件区域检查当前不触发（既存缺陷，CT-33 批次处理）」 |
| F3 | 预算放行机制 = D860 治理产物豁免 | `check-pr-budget.sh --diff-status <301 行>` → `ℹ️ D860 治理产物豁免: 300 件不计预算` + `✅ ① 变更文件数 1 ≤ 上限 12`（`GOV_PREFIX_RE` 含 `^\.claude/task-briefs/`，`.claude/bypass.log` 不匹配前缀故计入 1） |
| F4 | docs-only 早退白名单不含 `.txt` | `.github/workflows/ci.yml:51` `grep -qvE '\.(md\|json)$\|task-state/\|\.claude/\|…'`；实测 301 行变更集：`.md` 版 → `docs_only=true`，`.txt` 版 → `docs_only=false` |
| F5 | doc-registry 只扫 `\.(md\|yaml)$` | `scripts/doc-system/doc-registry-gate.sh:47`（`grep -E '\.(md\|yaml)$'`）+ `:21` EXCLUDE 含 `\.claude/`、`/archive/` |
| F6 | 承接落点在会话沙箱外 | `touch ~/Synova-过程档案/.b1-write-probe` → `Operation not permitted`（提权后 `WRITE OK`） |

## 3. 决策

1. **顺序冻结**：承接（仓外副本 + sha256 对账）**先于**主仓 `git rm`；对账不为 294/294 则不进第三步。
2. **不动 A3 依赖**：G10 恒不触发 ⇒ 本批不等 `#862`；但 A3 仍须独立推进（它修的是 G10/G11 假绿的**根因**，本批只登记不改）。
3. **失败判据**：`Δmd ≠ −294` 或 `sha256 ≠ 294/294` 或回退演练恢复 ≠ 294 件 ⇒ 交付不成立。
4. **不扩写集**：`scripts/**`、`.github/**`、`src/**`、`docs/authority/**` 本批零改动。

## 4. 遗留（交 CTO/K3）

| # | 项 | 证据 |
|---|---|---|
| L1 | G10/G11 幽灵变量 = 假绿（检查未执行 == 检查通过） | F2 |
| L2 | doc-registry 门禁输入在 commit 后归零 ⇒ CI 复跑恒 0 文档（与 D1028 交付遗留 L7 同源） | `doc-registry-gate.sh:43` |
| L3 | 卡面 P6/P9 两处前提不成立；P7 基线漂移 | brief §Q0.b |
| L4 | §11.3 命名条款对「批量出库件」不适用（改名即丢原始路径）——本批采用 `出库-主仓/<原路径>` 保形落点 | 源规格 §3② 契约缺口 |
