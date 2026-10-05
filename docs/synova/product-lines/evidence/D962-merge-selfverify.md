# D962 合并候选独立自验（task-18 / d962-verifier）

> 对象：`feat/d962-2a-merge` @ a3af6992（merge 提交 b67983b1，P1=2a-scripts@ab0ebbaf，P2=2a-precommit@7874cbf2，base origin/main=0ab457f2），工作树 `.synova-wt-d962m` 只读。反向判别在 /tmp/d962m-tree 副本。仅"自验结论"。

## ① 冲突 4 处解法逐条读码核

| 文件 | 解法（实测 diff vs 两父） | 判定 |
|---|---|---|
| loop-score.sh | == P1（vs P1 0 行差；vs P2 25 行差）：保留 P1 的乱码修复（:61 引号修正）+ boundaries/deprecated 退役清理注释（:59/:76），仅去掉两个已删脚本的存在性打分项 | ✔ 并集，未丢清理与乱码修复 |
| g10-cp3.test.sh | == P2（vs P2 0 行差）：取 V5.3 死分支修活后的红分支断言版（14 项）；弃 P1 旧"死分支现状快照绊线"版（96→94 行） | ✔ 取修活版正确，弃的是过时绊线 |
| g9-contract.test.sh | == P2（vs P2 0 行差）：改为 #37 退役守卫（零 CONTRACT_DIR 残留、.codex/contracts 仍不存在、run-contract-gate 基建保留），弃 P1 的门禁行为断言 | ✔ **#37 退役系 CTO 裁定**（phase2-plan §必改2 :147"结论：#37 退役"+防护承接三条），P1 断言测的是已裁定退役的门禁——非吞保护 |
| grep-oP-regression.test.sh | 真并集（vs P1 50 行 / vs P2 72 行差），见② | ✔ |

## ② 密封网随删语义核

- 复跑：**24 通过 / 0 失败 ✅**。
- 38→24 差集 **16 处删除断言逐条归因**（本人 grep 旧版逐条对目标）：根 check-brief-vs-code.sh ×9、check-tech-debt ×2、checks/check-test-quality ×1、check-integrity-startup ×2（15 处全部指向合并树已删脚本）+ 新增 1 条 "backtick 路径（workflow brief-vs-code）"（改指 workflow 真身）。**无一例外归因。**
- 六类覆盖逐类 ≥1 存活（目标文件逐一 ls 存在）：\K→pre-commit:237（×3）+brief id；\d→resolve-commit-brief.sh:60；\s→check-file-driven ×4；\S→checker-review:90；match_file 前缀→external-auditor.sh:195；backtick→workflow/check-brief-vs-code。✔
- 反向判别（/tmp 副本篡改 resolve-commit-brief.sh:60 日期模式）→ **22 通过 / 2 失败翻红**（断言 + BOM 清单双红）。非恒绿。✔

## ③ 保护项在位核（合并树）

399 行 ✔｜断面 `grep -c check-dsh-anchor`=3 ✔｜检查调用 18 ✔｜三态（soft_check SYNO_CI 转硬 :33-37）✔｜本地清单 #46 GATEKEEPER(:74)/CT-34(:114)/#17(:160)/#33(:194)/#30/#38/#39 ✔｜gate-hits 钩子 log_gate(:17) ✔｜CI 区回归集内联 铁律38(:285)/铁律46(:291)/接线(:303) ✔。

## ④ 计数复现

合并树 `find scripts -name 'check-*'`：**23 含 audit / 22 排除** ✔；`ls-tree` basename 口径 = **23** ✔。与卡声明一致。

## ⑤ check-bypass-log main PASS / 候选 FAIL 解释核

- 本人双侧实跑：main **5/0 PASS**、候选 **5/0 PASS**（B 的 FAIL 未能复现）。
- 读码：test §2 "无新提交→exit 0" 用例以 `SYNO_BASE_REF=origin/main` 对账**仓库真实提交态 + bypass.log 内容**——结果随分支/日志状态漂移，属环境依赖；且本候选 diff 未触碰 check-bypass-log.sh 及其测试（M 清单无此文件）⇒ **非合并引入回归**，解释成立。✔（附：候选工作树因 bypass.log 含全量 COMMITTED 标记而 PASS，恰证该用例环境依赖）

## ⑥ 电池抽 8 项自跑（串行）

g5 13✅/0❌、g8 11✅/0❌、g9 PASS=4/0、g10 PASS=14/0、ct-health PASS=7/0、ci-strict-mode pass=5/0、loop-score PASS=5/0、grep-oP 24/0 —— **8/8 绿**。✔
（注：d964-linter-wiring.test.sh 不在合并树——见问题 2）

## ⑦ 文件清单一致性

`git diff origin/main...HEAD --name-status`（origin/main 实测 = 0ab457f2）：**73 = 16A + 26D + 31M**。卡写 "72 = 15A+26D+31M"——在卡提交 ab872918 当刻实测也已是 73/16A（非后继 bypass.log 追加所致）。**A 计数少写 1**（勘误，见问题 1）；PR 预算结论不变（72/73 均 ≫12，豁免口径归 CTO）。

## 问题清单

1. （轻·勘误）合并卡 §五文件计数 **72=15A 应为 73=16A**（卡提交当刻即 73；16 个 A 逐文件在案）。需 CTO 收件前改一行。
2. （注记·顺序依赖，非本候选缺陷）**D964（oxlint 真接线）不在本合并**：合并树无 .oxlintrc.json、verify-incremental.sh 仍为旧版（`|| true`=16、:95 轻量通道 fail-open、npx 双轨）。候选入 main 后 D964 分支须 rebase 重验（task-9/10 的验证基于其原 base）；2b 排期亦须含 iron-laws job（卡 §遗留 2 已声明 34 项中仅 5 项内联的窗口）。
3. （照录）卡 §遗留 2 自报"CI 区仅内联 5 项，其余判定面 2b 挂载前本地不跑、CI 未接"窗口——已登记，CTO 收件时知悉。

## 自验结论

①②③④⑤⑥ 全过（冲突解法无吞保护、密封网随删全归因+六类存活+反向判别红、保护项全在位、双口径计数复现、bypass-log 属环境依赖、8/8 电池绿）；⑦ 差一个 A 计数勘误。

**自验结论：修一处文件计数（72→73、15A→16A）后，可提请独立审计**；D964 rebase 与 2b iron-laws 窗口为已知顺序依赖，照录不改判。

— d962-verifier，2026-09-25，零仓库源文件改动（反向判别在 /tmp/d962m-tree）
