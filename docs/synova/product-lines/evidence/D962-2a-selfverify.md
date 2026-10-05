# D962-2a 阶段 1 独立自验（task-8 / d962-verifier）

> 对象：B 交付，分支 `chore/d962-2a-scripts` @ db3099fa（工作树 `.synova-wt-d962b2`，只读）。对照计划：`D962-phase2-plan.md` §一（.synova-wt-d962a，只读）+ 决策 Note `memory/notes/proposed/2026-09-25-d962-script-consolidation-phase1.md`。
> 方法约束遵守：全程零改仓库源文件；"改坏即红"全部在 `git archive` 导出到 /tmp/d962v2-tree 的副本上实施，篡改后即还原并复跑确认回绿。仅"自验结论"，不构成"审计通过"。

## ① check-* 计数 28 复现 + 退役 14 项

- `find scripts -name 'check-*' | wc -l` → **28**（原始清单在 /tmp/2a-check-count.txt：audit/check-gates-v2.py 起，28 个，含 canary-drift/brief-parseable 等第二批 8 项仍在）。✔
- 退役 14 项与 plan §一处置列逐一对上（plan 行 4 as-any / 5 bridge-files / 6 根brief-vs-code / 7 deprecated-mapping 归阶段批次 / 8 fde-terms / 10 file-hell / 12 integrity-startup / 13 lessons-learned / 17 security / 18 tech-debt / 20 checks-test-quality / 21 ci-contract-gaps / 39 dataflow-alignment / 43 self-diagnosis / 45 spec / 46 test-first 中本批实际删除 14 个，与 Note 清单一致）。✔
- 删后全仓零引用 grep（**14/14 全查**，超 ≥8 要求）：as-any/security/file-hell/fde-terms/spec/self-diagnosis/integrity-startup/tech-debt/test-quality/contract-gaps/test-first/dataflow-alignment 均 refs=0；lessons-learned 余 1 处= check-notes-lifecycle.sh:14 历史注释（非调用）；根 brief-vs-code 余 1 处= check-brief-vs-code.test.sh:40 回归断言"根目录死副本已退役"（防复活绊线，良性）。✔
- 防护承接声明：Note + plan §一逐条给出（如 as-any→pre-commit L485-493 内联迁 CI、test-quality→L561-611 内联、lessons-learned→#22/#25 承接），完整。✔

## ② 合并行为等价（3 项）

1. **ct-health.sh**（新宿主 221 行）：ci-stale-red 判定体逐字迁移（exit→return），THRESHOLD=24/TODO_FILE/API URL/GitHub 匿名 API/age 三态全在（L31-140）；orphan-worktrees 收集循环等价重构（豁免 shared/_前缀/主树、origin/main..branch 独有提交计数、JSON/文本双输出、return 1）；调用方 gen-cto-health.py:514/530 已改指 `ct-health.sh ci-stale-red|orphan-worktrees --json`。✔
2. **check-architecture.sh §5**（L236-298）：原 check-sentinel-type-net.sh 判定等价——`grep -qF "extensions/sentinels/<name>/"` 尾斜杠防前缀碰撞、三豁免与 sentinel-loader 同源、fail-closed exit 2、SYNO_TYPE_NET_ROOT 注入缝保留、LC_ALL=C 防御。变量改名不影响语义。✔
3. **根 brief-vs-code merge-base 移植**（diff 级证据）：main 的 workflow 真身 grep merge-base = 0 处；分支 +21 行加入 `git merge-base refs/remotes/origin/main HEAD` CI 基准块（D520/D708 棘轮），原逻辑确在根死副本 main:scripts/check-brief-vs-code.sh:45；根副本删除且新测试 check-brief-vs-code.test.sh:40 绊线断言其已退役。✔
4. （附）**boundaries-incremental→verify-incremental L4b**：L191-236 判定逐字内联（L1/L2/L3 三 case、桥接白名单、违规 exit 1），原脚本 61 行删除。✔

## ③ 组级测试"改坏即红"（g5/g8/g10，/tmp 副本实施）

基线（git archive 副本）：g5 13✅/0❌、g8 11✅/0❌、g10 9✅/0❌，全绿。

| 测试 | 篡改（仅 /tmp 副本） | 结果 | 还原后 |
|---|---|---|---|
| g5-architecture | PAT_L3 跨层正则替换为永不匹配 | **11✅/2❌（红）** | 13✅/0❌ |
| g8-file-driven | manifest 必填字段收集行替换为 `true`（检测被掏空） | **10✅/1❌（红）** | 11✅/0❌ |
| g10-cp3 | pre-commit 中 G11 `warn_check` 判定行改名 | **8✅/1❌（红）** | 9✅/0❌ |

三测试均具判别性（改坏必红、还原回绿）。g10 测试头块如实记录已知缺陷绊线：pre-commit L1126 `CHANGED_FILES` 零赋值→G10/G11 红分支死代码——B 已上报归 A（pre-commit 域）修复，非掩盖。✔

## ④ main 既有红 → 分支绿（三项顺手修）

| 项 | main 侧（复现） | 分支侧 |
|---|---|---|
| gen-cto-health isinstance | gen-cto-health.test.sh 在"§2 连续运行幂等"段**崩溃 exit=1 无结果行**；gen-cto-health-repro.test.sh **2 通过/5 失败** | 两测试 PASS=7/FAIL=0，exit=0 |
| utf8 | utf8.test.sh `Status: ❌ utf8 测试未通过` | `Status: ✅ 全部通过` |
| loop-score 反引号 | main:scripts/workflow/loop-score.sh:61 `` [ -f `$ROOT/...' ] `` 反引号命令替换+mojibake；将分支新测试拷入 main 导出树运行 **PASS=2/FAIL=3** | loop-score.test.sh PASS=5/FAIL=0 |

✔ 三项均"main 红、分支绿"成立，且修复 diff 有据（isinstance 守卫 gen-cto-health.py:305-308；loop-score:61-63 修引号+移除两个退役脚本打分项）。

## ⑤ 第二批 8 个待删脚本"删前调用方仅限清单"复核（分支树 grep）

| 脚本 | 实测调用方 | 与 plan §一 |
|---|---|---|
| check-bridge-files | 零调用（仅自述注释） | ✔ 行5 |
| check-deprecated-mapping | pre-commit:412（par_start）唯一 | ✔ 行7 |
| check-acceptance-ci | pre-commit:417 唯一 | ✔ 行2 |
| check-hardcoded | pre-commit:411 唯一（:512 注释） | ✔ 行11 |
| check-q0c-tracking | pre-commit:416 唯一 | ✔ 行15 |
| check-verifiable-done | pre-commit:415 唯一 | ✔ 行19 |
| check-canary-drift | ci.yml:281 唯一直调（ci.yml:245 跑其测试；ct-health.sh:214 过渡期转发，注释声明 2b 后改接线） | ✔ 行23 |
| check-brief-parseable | pre-commit:1351 唯一（其余为注释/brief_parser 单源说明） | ✔ 行37 |

✔ 8 项调用方全部仅限 A 侧 2a① pre-commit 重写将去引用的 par_start 行 / ci.yml 2b 步骤，删除前提成立。

## 问题清单

1. （轻）**canary-drift 归并口径待闭合**：plan §一行23 写"合并到 check-ct-health.sh"，实际宿主名 `ct-health.sh`（无 check- 前缀，Note 声明队长已确认健康观测域不计数）且 2a 阶段仅做**过渡期转发**（ct-health.sh:211-214），ci.yml:281 仍直调原脚本——即"合并"在本批未物理完成，依赖 2b。属计划内分期，但 plan 文本与现状有一处宿主名差，建议 2b 收口时回写。
2. （轻）**g10/g11 死分支**（CHANGED_FILES 零赋值）仍在 pre-commit，B 已如实上报并留绊线测试，归 A 修复——非本批问题，列此跟踪。

## 自验结论

①计数 28 复现、退役 14 零引用（14/14 全查）+承接完整；②三合并+1 内联行为等价均有 diff 级证据；③g5/g8/g10 改坏即红实测红、还原回绿；④三项 main 红/分支绿两侧原始输出在案；⑤第二批 8 脚本调用方与清单逐一相符。分支已推送（ls-remote：db3099fa = refs/heads/chore/d962-2a-scripts）。

**自验结论：可提请独立审计**（附 2 项轻微遗留：canary-drift 宿主名/2b 收口回写、CHANGED_FILES 死分支待 A 修）。

— d962-verifier，2026-09-25，零仓库源文件改动（篡改均在 /tmp/d962v2-tree 副本并已还原）
