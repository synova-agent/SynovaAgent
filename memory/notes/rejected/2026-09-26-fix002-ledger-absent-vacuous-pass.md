---
状态: rejected
日期: 2026-09-26
决策: 【已否决】「本机无任何账本来源 → 判『无绕过记录』显式放行 exit 0」这一读面对账语义**不采用**；#796 改走主路径 A（撤销删除 `.claude/bypass.log`，恢复其 git 跟踪），D331 迁移留在 D970（#799），顺序 PR-2（归档）→ #799 → #796。
理由: CTO 裁决（2026-09-26，synova-squad-lead 转达）：(1) 同一文件已有 CTO 裁决——D970 读面保留 exit 1，本提案在「范围非空 + 全部来源不可读」态与之结论相反；(2) 两分支改同一文件且语义分叉 ⇒ 禁止自创第二套语义（D970 brief 硬要求「语义 / exit code / fail-closed 不变」）；(3) 根因纠正——#796 的 `.claude/bypass.log` 删除是**为躲 union 冲突的本地绕道**，不是迁移：把账本删掉本身才是「新 clone 全员拒推」的成因，正解是撤销该删除、把迁移留给 D970。否决理由保留，防重蹈（「无账本即放行」会用一个更弱的判据掩盖证据链缺失）。
---

# 【已否决】无账本来源 → vacuous pass（FIX-002 读面提案）

## 提案内容（原样保留）

`scripts/control-tower/check-bypass-log.sh` 把「`$LOG` 不存在 → exit 1」改为「本机无任何账本来源（旧路径 + per-session + 归档全部不存在）→ 判『无绕过记录』显式放行 exit 0（输出可见 + degraded 记录）」，红路径其余不改。

## 为什么被否决

1. **与既有 CTO 裁决分叉**：D970（#799）读面已裁定「有提交待对账但全部来源不可读 → exit 1」（fail-closed）。本提案在同一态给相反结论，而两分支改同一文件 ⇒ 合并后语义谁后合谁赢，等于制造第二套口径。
2. **根因判错**：实测口径纠正后（必须显式给 base：`check-bypass-log.sh origin/main`；裸跑默认 base 是 2226 提交的老分支，恒 rc=1），#796 的 rc=1 成因不是「旧实现太严」，而是 **#796 自己删掉了 tracked 账本**（`3ce59bbb`：为躲 union 冲突的本地绕道）。真正的最小修法是撤销该删除（主路径 A），而不是放宽读面判据。
3. **削弱方向错误**：账本被删/从未存在，与该机器上「从未有提交」不可区分。以「无账本 → 放行」当修法，会用更弱判据掩盖真实证据链缺失（同类：M1 假 PASS）。

## 已执行的回退

- `scripts/control-tower/check-bypass-log.sh`、`tests/control-tower/check-bypass-log.test.sh` 已回退到 `41b97740` 原状（与 #799 同源，零分叉）。
- 本 Note 由 `memory/notes/proposed/` 迁到 `memory/notes/rejected/`（四态语义：否决 → rejected 并留理由）。

## 生效替代（主路径 A）

`.claude/bypass.log` 从 `origin/main` 恢复 tracked（撤销 `3ce59bbb` 的删除），并修复被该删除破坏的证据链：`3ce59bbb^` 中 3 条真实 hook 记录逐字还原 + 1 条显式一次性补记（D451）。详见 `docs/synova/product-lines/evidence/FIX-002-20260926-回执.md`。
