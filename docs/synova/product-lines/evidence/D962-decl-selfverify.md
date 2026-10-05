# D962 声明源与口径独立自验（task-20 / d962-verifier）

> 对象：`feat/d962-2a-merge` @ a20911e7（task-19 三件提交 d99e048c），工作树 `.synova-wt-d962m` 只读。全部数字本人实测，禁引 B 数字。仅"自验结论"。

## ① merge_writeset_gate 独立复跑

`python3 scripts/control-tower/merge_writeset_gate.py --repo . --branch feat/d962-2a-merge` →
`✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）`，rc=0（含逐文件声明源 S3:brief.Q2-include 打印 + bypass.log 1 条显式豁免 + "PR 正文不可用——仅文件声明源生效"提示）。✔

## ② 防声明超宽（双向差，核心项）

- 声明源 `task-state/D962.json` write_set（added+deleted+modified）= **75**；实际 `git diff --name-only $(git merge-base origin/main HEAD=0ab457f2)..HEAD` = **75**。
- **声明\\实际 = 0；实际\\声明 = 0**（双向均空，python 集合差原始输出在案）。
- 非兜底式全量：75 条逐文件列出、A/D/M 分类（卡 §五 18A+26D+31M 与我上轮 73/16A 勘误 + D962.json 重写 + D956 声明 2 件的沿革声明自洽）。**无超宽声明。** ✔

## ③ 双口径三态复现（git archive 到 /tmp 实跑 find，非 ls-tree 替代）

| 三态 | 口径A(maxdepth2 check-*.sh) | 口径B(maxdepth3 check-*) | B排audit |
|---|---|---|---|
| main@0ab457f2 | **41** | **47** | **46** |
| 候选@a20911e7 | **17** | **23** | **22** |
| 候选+2b（/tmp 删 canary 模拟） | **16** | **22** | **21** |

与卡 §三三态表逐项一致；口径A 候选 17 文件清单逐文件比对（删 canary 前实列 17，与卡"写死清单"含 check-canary-drift 完全一致）。✔

## ④ `|| true` 分类抽核（各抽 3，读码判定）

**需清零 4 处（抽 3+补读 1）——分类全部成立：**
1. `:118` DOC_ONLY：`[ -z "$(echo … | grep -vE "$DOC_PREFIX_RE" || true)" ]` → grep **error**（坏 ERE）与"无非文档行"坍缩为空 → DOC_ONLY=1 → CT-34 早退豁免后续 12 组。真 fail-open，最高危定级成立。
2. `:94-107` git diff 采集族（抽 :94/:97）：`git diff --cached … 2>/dev/null || true` → git 失败=空输入=全部判定跳过，与 ROOT=pwd 回退叠加非 git 目录整体假绿。成立。
3. `:243` CRITERIA_GLOBS：`python -c … except Exception: pass … 2>/dev/null || true` → 解释器/解析失败 → G10 静默"无映射跳过"。成立。
4. （:339 SCOPE_VIOLATION 同型，读码确认。）

**可保留 33 处（抽 3）——分类全部成立：**
- `:284` as-any 提取 grep：no-match=合法空（V3.7 bash 只做物理事实分工），✔；
- `:84`/`:19`/`:122`：swallow-ok 注释在位的降级登记/gate-hits 统计/豁免审计——非判定路径，✔；
- `:125` SKEL_EARLY 提取：no-match=无骨架 brief=合法空，✔。

计数口径复核：候选 pre-commit `grep -c '|| true'` = 38（卡声明 37 可执行+1 注释引用，口径自洽）。✔

## ⑤ D956 声明件覆盖核

`task-state/D956.json` 声明 = {added: tests/control-tower/d956-failmsg.test.sh；modified: .github/workflows/ci.yml, .claude/bypass.log}；
`git diff --name-only $(merge-base)..36b960e4` 实际 = {bypass.log, ci.yml, d956-failmsg.test.sh}。
**双向差均为 0**，且 bypass.log 运行期账本如实入声明（未藏未兜底）。✔

## ⑥ 候选仍无损

399 行 ✔｜断面 check-dsh-anchor=3 ✔｜密封网复跑 **24/0 ✅**。✔

## 问题清单

无阻断、无勘误项（上轮 73→75 沿革已在卡 §五如实声明）。
照录：需清零 4 处属"本卡仅登记不改码"，归 2a②续卡处理（卡已声明）——其中 L118 DOC_ONLY 为最高危，建议续卡优先。

## 自验结论

①②③④⑤⑥ 全过：gate 夹带=0 复现、声明/实际双向差为零（75=75，非兜底）、双口径三态逐项复现、`|| true` 两类各抽 3 读码分类成立、D956 声明双向吻合、候选完整性无损。

**自验结论：通过——可提请独立审计**（需清零 4 处为登记在案的后续卡事项，不影响本候选）。

— d962-verifier，2026-09-25，零仓库源文件改动（口径实跑在 /tmp/cal-* 导出树）
