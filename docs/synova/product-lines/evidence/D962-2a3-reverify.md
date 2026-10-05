# D962 密封网修复复审（task-16 / d962-verifier，窄口径）

> 对象：`feat/d962-2a-precommit-b` @ 7874cbf2（修复提交 85a2e96d），工作树 `.synova-wt-d962b3` 只读。反向判别在 /tmp/d962v4-tree 副本实施。仅"复审结论"。

## ① 复跑密封网

`bash tests/control-tower/grep-oP-regression.test.sh` → **38 通过 / 0 失败，Status: ✅**（原始输出复现）。✔

## ② 五处同步断言的真身依据逐条核（防弱化）

| # | 断言改动 | 真身依据（file:line，本人实测） | 结论 |
|---|---|---|---|
| 1 | #CRITERIA 模式 `[:=]`→`[:=：]`（有用例） | `scripts/pre-commit-check.sh:237` `grep -oE '#CRITERIA[[:space:]]*[:=：][[:space:]]*[A-D]'` 逐字符一致 | ✔ 有真身 |
| 2 | 同模式无空格用例 | 同上 :237（sed 后缀 `s/.*[=:：]…` 亦与 :237 一致） | ✔ |
| 3 | 全角边界翻转（原"不匹配"→现"应匹配"） | :237 `[:=：]` 含全角冒号 → `#CRITERIA：C` 真会命中；语义演进已在断言旁注释声明 | ✔ 非弱化（方向是加严匹配） |
| 4 | brief 日期断言改指 resolve-commit-brief.sh | `scripts/workflow/resolve-commit-brief.sh:60` `grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}'` 在库真身，同为 ERE 日期提取，语义等价 | ✔ |
| 5 | match_file 前缀断言改指 external-auditor.sh | `scripts/control-tower/external-auditor.sh:195/212/220` `grep -oE '^[^:]+:[0-9]+'`（断言模式 `^[^:]+` 为其前缀子式），真身存在 | ✔ |

五处均为"断言跟随真身语义演进/改指在库真身"，**无一处是删断言或放宽**。eq()/eqs() 机制本身先做"模式必须出现在目标文件"的接线检查（test:60-63），弱化无处藏。✔

## ③ 反向判别（/tmp 副本）

把脚本真身 :237 改回旧模式 `[:=]`（去掉全角）后复跑：**34 通过 / 4 失败**——3 条 CRITERIA 同步断言 + BOM 清单断言全部翻红（`模式未出现在 scripts/pre-commit-check.sh`）。密封网对真身漂移仍具判别性，非恒绿。✔

## ④ 轻2/轻3 修复核

- 轻2 措辞：Note 与 `check-plan-integrity.sh:16-18` 均改为"【加严并入】…非逐字"，并写明差异两条（#CRITERIA 必填、Q2 路径条目 ≥1 为硬失败；架构层同源）——与我在 D962-2a2 自验实测的判定集差异逐条吻合。✔
- 轻3 双口径：B 声称 含audit=29/23/22、排除=28/22/21。实测（计数基准 = 2a 分支当前 c4b795ba，含 audit 红线件）：2a=29/28、合并模拟=23/22、canary 后=22/21——**两组数字逐项复现** ✔（我上轮 28/22/21 系基于旧 db3099fa 且未分口径；勘误成立，终态口径以 CTO 批复为准已在 Note 声明）。

## ⑤ 无新增 fail-open

`git diff e58b55fe..7874cbf2 | grep -cE '^\+.*\|\| true'` = **0**；修复仅动 test/plan/Note/check-plan-integrity 头注释，无新增静默跳过。✔

## 问题清单

1. **（预警，非本修复缺陷，合并时必炸）** 密封网仍有 4 条断言指向 2a 分支将删除的脚本（`scripts/check-brief-vs-code.sh`（根）、`check-integrity-startup.sh`、`check-tech-debt.sh`、`checks/check-test-quality.sh`——git cat-file 对 c4b795ba 逐一验证缺失）。本分支（base=main）上它们尚存故 38/0；**2a 与本分支合并当天密封网将再次翻红**。须在合并提交中同步（改指真身或随删），建议随合并卡登记为必改项。

## 复审结论

①②③④⑤ 全过：38/0 复现、五处同步断言全部有真身依据且方向为加严/等价改指、反向判别 34/4 翻红证明非恒绿、双口径计数逐项复现、零新增 fail-open。

**复审结论：阻断 1 修复成立，通过——本分支可提请独立审计**；附 1 项合并期预警（问题 1）须随 2a 合并卡处理，否则密封网将二次翻红。

— d962-verifier，2026-09-25，零仓库源文件改动（反向判别在 /tmp/d962v4-tree）
