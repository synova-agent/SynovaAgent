# PR #803 正文（六项模板）— D962 α 单 PR

> 产出：d962-coder-b（task-23）起草 → **d962-coder-c 于 task-26 全面刷新**（并入 2b + 项3 A 档四点 + 2a② 四处 `|| true`）。
> 落库方式：GitHub PR 正文由 task-26 经 API 同步（`gh` CLI 本机不可用；本文件为可审版本）。
> ## CI 状态（**逐 head 实测三类**，as_of 2026-09-26T04:20+08:00；禁以"未跑"覆盖"已跑且红"）
> | head | 总 checks | 绿 | 红 | cancelled | 红 job 名 |
> |---|---|---|---|---|---|
> | `9fd034dd` | 28 | 22 | 4 | 2 | Control Tower Gate Tests (ubuntu/windows)（push+PR 两次 run 各 2） |
> | `25e1b414` | 28 | 22 | 4 | 2 | 同上 |
> | `e74aae55` | 28 | 18 | 4 | 6 | 同上 |
> | `68747574` | 28 | 18 | 3 | 7 | Control Tower Gate Tests (ubuntu/windows) |
> | `ae371c45` | 26 | 5 | 0 | 21 | — |
> | `933bf1de` | 26 | 1 | 0 | 25 | — |
> | `1f577444` | 26 | 0 | 0 | 26 | — |
> | **`52f5aa1f`** | 27 | **11** | **3** | 13 | Control Tower Gate Tests (windows) / (ubuntu) / Gate Integrity |
> | `a964c302` | — | **无 run**（task-30 修复提交，待触发） | | | |
> **cancelled 说明**：并发 run 被后推 head 取代（`concurrency` 语义），非失败。
> **红因归属（as_of 同上）**：Gate Integrity 基线 + G10/G12 windows = **本 PR 引入**，修点在写集内，已于 `a964c302` 修复（本地 CI 等价复跑转绿，**真 run 待补**）；Control Tower ubuntu/windows 剩余红 = **本 PR 新增的 grep-oP backtick 断言**暴露**既存生产缺陷**（`scripts/workflow/check-brief-vs-code.sh:59` 的 `\`` 在 GNU grep 是锚点）⇒ 按 rev3 边界**供件**（patch 见 `docs/synova/product-lines/evidence/D962-task30-回执.md` §T2(3)），未自行改。


> **sha 口径**：本正文所述**代码态** = `ae371c45`（写集 97；含 F1 与 8 件证据入库）；**正文文件自身的提交紧随其后** —— 若需精确 head 请以 PR 头部为准（正文不再递归追写自身 sha）。

## ① 卡号 + 分支 + sha
- 卡：**D962**（2a① 门禁瘦身 + 2a② 收口 + 2a③ 接线断言 + 2b iron-laws 并入；CTO 裁决 A：**#803 完成标准包含 2b**）
- 分支：`feat/d962-2a-merge` @ **b8396a5b**，base = `main@ee721b0a`（入档前快照 e74aae55 / 88 文件；随证据入库升至 97）
- 关联：`chore/d962-2a-scripts`（已并入）/ `feat/d962-2a-precommit-b`（已并入）/ `feat/d962-2b-iron-laws-wiring`（**已并入本 PR**；`fix/d962-2b-wiring-merge` 为并入前再同步 main 的中间分支）/ `chore/d964-linter-wiring`（**不在本 PR**，入 main 后 rebase 重验）

## ② 写集声明
**97 文件逐条 = 33A+26D+38M**（`task-state/D962.json#write_set` ⟷ brief Q2 双源一致，含声明件自身）。
- 双向对账（本机原始输出）：`变更集=97 声明集=97` → **方向A 夹带=0 / 方向B 多余=0**
- `merge_writeset_gate --base origin/main --head HEAD --branch feat/d962-2a-merge` → `✅ pass — 提交文件集 ⊆ 声明写集（无夹带）`
- **证据入库（V2 §③ 系统性修复）**：`docs/synova/coordination/evidence/` 被 `.gitignore:76` 忽略（**0 文件 tracked**）⇒ 8 件 `D962-*` 自验记录此前从未入库（M6 违规），本轮全部迁入豁免跟踪路径 `docs/synova/product-lines/evidence/`（**同名、逐字节 sha256 一致**，`git check-ignore` 复核为空=未忽略）
- G12（pre-commit CI 权威区）→ `✅ 所有文件均在 Q2 范围内`

## ③ 逐条判据（本次重跑，非旧绿）
| # | 判据 | 结果（原文摘要） |
|---|---|---|
| 1 | merge-writeset-gate (D708) | `✅ pass`，变更集 87（merge-base ee721b0a） |
| 2 | pre-commit CI 口径（`GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main`） | `✅ 本地清单通过` rc=0（G12 / D782-D1 / D782-D2 / 骨架 / D943 全 ✅）**真 run 待补** |
| 3 | iron-laws 活点接线断言（FIX-013） | `.github/workflows/ci.yml:111` job 存在、无 `needs`、跑 `scripts/pre-commit-check.sh` + `SYNO_CI=1` + `SYNO_DIFF_BASE=origin/main`；测试 `9 通过, 0 失败` |
| 4 | FIX-015 源面/自伤面 判别性夹具 | `7 通过, 0 失败`（Arm-A 真注入仍红 / Arm-B 自伤面不再自伤 / Arm-C 12 行不截断） |
| 5 | doc-registry W1/W2 接线（task-26 A①） | `9 通过 / 0 失败`（原 7/2）；活点 = CI 权威区 D782 块（`pre-commit-check.sh` 内，D1/D2 调用） |
| 6 | G12 三日窗（task-26 A②） | `14 通过, 0 失败`（原 8/2）；含**能力等价**断言（新 glob 三日 == 旧 `^(D-1\|D0\|D+1)-` 正则，同夹具集合相等） |
| 7 | 组 7a fail-open 网（task-26 A③） | `20/0` rc=0（原 17/3）；T3 降级 / T4 三注释形态零误报 / T5b `.ts` 判别对照必红 |
| 8 | scan-fullwidth（task-26 A④） | `PASS=32 FAIL=0`（原 30/2）；阈值不变：覆盖 9 文件 / 写集残留 0 处 0 文件 / mac 6 文件 8 处 / win 10 文件 |
| 9 | 其他控制塔回归 | grep-oP `24/0`；g9-contract `4/0`；g10-cp3 `14/0`；loop-score `5/0`；hard-gate-convergence / ci-strict-mode / ci-strict-visible / precommit-groups-injection / doc-registry-gate 全 PASS |
| 10 | 全树冲突标记扫描 | `git grep -n -E '^(<<<<<<< \|>>>>>>> )' HEAD -- .` → **0 命中**（修复前 4 件：loop-score.sh / g10-cp3 / g9-contract / grep-oP） |
| 11 | 权威口径脚本数 | `find scripts -type f -name 'check-*' ! -path 'scripts/audit/*' \| wc -l`：main **48** → 本分支 **24** |
| 12 | 2a② 四处关键路径 `|| true` | 已清零（CT-34 纯文档早退 / diff 采集族 / G10 criteria-map / G12 写集判定）——均改三态，失败显式降级 |

## ④ 改坏即红原始输出（代表四则）
1. **iron-laws 活点**（真文件临时删 job，同一断言）：`❌ 活点缺失: ci.yml 无 job 'iron-laws'` + `❌ 活点未执行 scripts/pre-commit-check.sh` + `❌ 活点未注入 SYNO_CI=1` + `❌ 变异体行号对照失败` → `4 通过, 5 失败` rc=1（恢复后 sha256 一致、`9 通过, 0 失败`）
2. **G12 三日窗**（`(-1,0,1)` → `(-1,1)` 丢今日）：`❌ 活点② 行为: 期望[…09-25, 09-26, 09-27] 实得[09-25, 09-27]` + `❌ 活点③ 能力等价失败` rc=1
3. **7a 三态降级**（rc 强制 0 = 静默吞错）：`❌ T3 降级: 组 7a 在非法排除模式下仍判 ✅（fail-open 未修）` + `❌ 缺显式「降级」字样（静默吞错）` + `❌ CI strict 下降级应 exit 1，实际 0` → `17/3`
4. **scan-fullwidth 夹具**（路径集改回已退役脚本）：`❌ 写集模式未输出标签且扫描器 fail-closed (rc=2): ❌ scan-fullwidth-vars: 路径不存在: scripts/control-tower/check-sentinel-type-net.sh` → `PASS=30 FAIL=2`

## ⑤ 红线段（**分列，禁写"全绿/通过"**）
### 5.1 本 PR 引入的红（main 基线对照实测 = 本分支独有）
在 `origin/main@ee721b0a` 另建只读工作树跑同测试作基线：**下列各件 main 全绿、本分支全红** ⇒ 属本 PR 引入：
| 测试 | main | 本分支 | 根因 |
|---|---|---|---|
| `ct-test-gate.test.sh` | PASS | ❌ `接线: ct-test-gate.sh 未接入 pre-commit` | 2a 移除组 2d 接线后**无 CI 落点**（待 CTO 裁 wire/retire） |
| `platform-checklist.test.sh` | PASS | ❌ `pre-commit 接线缺失` + `❌ 未点名` | D520 平台软检查被移除，无落点（待裁） |
| `claim-regex-narrow.test.sh` | PASS | ❌ `T1 收窄后正则缺失` | **重写期真丢失**（V5.2.x `pre-commit-check.sh:775` 原文在、现全仓 0 命中；plan §一 无该条目）待裁 |
| ~~`check-k3-report.test.sh`~~ | PASS | ✅ **本轮已修**（`T1 合格 = OK (rc=0)`，8/0） | 夹具引用 `pre-commit-check.sh:991`，重写后文件仅 564 行 ⇒ 行号越界；已改指在库行（T4 负向对照未动） |
| `simulate-ci.test.sh` | PASS | ❌ | **级联**（其断言=整套清单必须 exit 0），非独立缺陷 |
### 5.2 既存红（非本 PR 引入）
- **Vitest 2/2 @main**（main push 全量集红 vs PR changed 集绿的口径差）——**卡 D1008** 登记于分支 `chore/d1008-ratchet-card` @ `1837773d`（本 PR 不修）
### 5.3 合规声明
未碰 `scripts/audit/**`、`docs/synova/audit-reports/**`、`src/**`；**未用 `force push`、未用 `--no-verify`**。D331 bypass 对账按 **D451 一次性补记**路径闭合（8 条 rebase 改写 hash 的 COMMITTED 记录，commit `ac0ad90a`）。
### 5.4 F1（V2 必修）与 stderr
`pre-commit-check.sh` G12 内联 python 注释里的反引号 `` `|| true` `` 落在双引号命令替换内 ⇒ `SYNO_CI=1` 每跑 G12 打 2 行 stderr。**已去反引号**：修前 `stderr 行数=2`（`syntax error near unexpected token \`||'`），修后 **`stderr 行数=0`**，G12 仍 ✅、清单 rc=0。
### 5.5 真 run 状态
**⚠️ 真 CI 队列积压**：`36168743118` / `36168749183`（sha 9fd034dd）与 `36170408913` / `36170416178`（sha 25e1b414）**全部 `queued`、无结论** ⇒ 上表判据均为**本地 CI 等价复跑**；**真 run ⒞ 待队列恢复后补**（不以本地等价冒充实跑）。

## ⑥ 未清项登记
1. **B 档三点待 CTO 裁**（wire / retire）：`ct-test-gate`、`platform-checklist`、`claim-regex`（真丢失，建议接回 CI 权威区 + 测试提取器改指活点）。
2. **可退役计数算式（24 → ≤20）**：`24 − 2 retire（check-hardcoded.sh / control-tower/check-canary-drift.sh，均有 plan 或脚本注释具名承接）− 2 待裁（check-name-allocation.sh / check-preset-bundles.sh）= 20`。另 4 件按 plan 属 **wire**（check-file-driven / check-gitlinks / check-k3-report / check-pr-budget）——wire 属 plan 既定；retire 须 CTO 明批后执行。
3. `check-k3-report.test.sh` 夹具行号越界（同 A4 族）——一行夹具修复已获批，**本次随正文一起落**。
4. 真 CI 队列恢复后需补 ⒞（本 PR 与 main 两侧）。
5. `D964 rebase`（等本 PR 合入）。
6. 小瑕疵登记：`tests/doc-system/doc-registry-gate.test.sh` 首行 BOM（测试仍过）；`loop-score.test.sh` 内层 `ROOT: unbound variable` stderr 噪音；D2 登记门禁在 CI checkout 下输入集为空（空转，已在脚本注释如实登记）。
7. D721（main push 上存量红放行分支不可达）仍为独立 FIX 条目，本 PR 不动。
8. **L8**：ARM 注入缝 `102/104/105` 的 `|| true` 属 D390 设计内测试缝（生产路径不进入）——如实登记，不清。
9. **L9**：G10 降级后仍打印 `✅ …(跳过)` 行，建议改「降级即止」。
10. **L10（本轮已修）**：证据目录必须在 track 路径（建议立为门禁防复发）。
11. **L11（待 CTO 裁）**：迁入的 `D962-2a2-selfverify.md:35` 含 secrets 门禁**夹具假 key**，暂存该文件即判红（CI 不暂存不受影响）；二选一：① 脱敏该串 ② 给证据目录加显式豁免规则。本卡回执 L11 行初稿曾逐字引用该串而自身判红，**已就地脱敏**。
