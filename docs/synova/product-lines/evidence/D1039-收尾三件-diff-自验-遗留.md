# D1039 收尾三件 —— diff / 自验结论 / 遗留清单

> 小队: 🧭 synova-squad-lead（收口，不下场写码）｜ 🔧 coder-a（A4-c/D1039）｜ 🔧 coder-b（A4-b/D1040、A4-d/D1041）
> ｜ 🔍 diagnoser-c（A4-e/D1042）｜ 🔍 verifier-v（A4-v/D1043，独立复核）
> 日期: 2026-09-28 ｜ 基线: `origin/main` `ff467712`
> 本文件 = M6 要求的**收尾三件**（diff / 自验结论 / 遗留清单），随 PR 提交入库。

---

## 一、diff（命令原始输出，禁手写）

### PR-1 · 域 = mac · 分支 `team/a4-ci-cost`

```
$ git diff --stat origin/main...HEAD
 .claude/bypass.log                                 |   1 +
 .../task-briefs/2026-09-28-D1039-A4-CI成本收口.md  | 178 ++++++++
 .github/workflows/ci.yml                           |  85 +++-
 .../evidence/D1039-A4e-watchdog-根因.md            | 480 +++++++++++++++++++++
 .../2026-09-28-D1039-ci-signal-classify.md         |  73 ++++
 scripts/control-tower/ci-signal-classify.sh        | 208 +++++++++
 task-state/D1039.json                              |  27 ++
 task-state/D1040.json                              |  17 +
 task-state/D1041.json                              |  14 +
 task-state/D1042.json                              |  14 +
 task-state/D1043.json                              |  14 +
 tests/control-tower/ci-signal-classify.test.sh     | 348 +++++++++++++++++++++
 12 files changed, 1457 insertions(+), 2 deletions(-)
```

**D734 PR 预算核算（按 D860 口径：治理产物不计入）**

| 类别 | 文件 | 计预算 |
|---|---|---|
| 实现 | `.github/workflows/ci.yml` ｜ `scripts/control-tower/ci-signal-classify.sh` ｜ `tests/control-tower/ci-signal-classify.test.sh` | **3** |
| 治理产物（不计） | brief ｜ 5 × `task-state/D10*.json` ｜ `memory/notes/proposed/` Note | 7 |
| 证据（域判定 domain-neutral，不计） | `docs/synova/product-lines/evidence/D1039-*.md` ×4 | 4 |
| hook 自动 | `.claude/bypass.log`（`post-commit` 自动追加，非人工写集） | 1 |
| **计预算合计** | | **3 / 12** ✅ |

域检查（机器判定）：`python3 scripts/control-tower/check-ownership.py .github/workflows/ci.yml
scripts/control-tower/ci-signal-classify.sh tests/control-tower/ci-signal-classify.test.sh --owner mac`
→ `✅ PASS 3 个文件全部归属 owner=mac`。

### PR-2 · 域 = win · 分支 `team/a4b-vitest-log`

```
$ git diff --stat origin/main...HEAD
 .claude/bypass.log                                 |   5 +
 .../evidence/D1039-A4d-五workflow成本基线.md       | 478 +++++++++++++++++++++
 tests/win/vitest-log-level.test.sh                 | 175 ++++++++
 vitest.config.ts                                   |   9 +
 4 files changed, 667 insertions(+)
```
实现文件 = **2**（`vitest.config.ts` + `tests/win/vitest-log-level.test.sh`），均在 win 域 ✅。
**D734 分段**：`vitest.config.ts` 机器判定属 **win**（`scripts/control-tower/ownership.yaml` 的 `**` 兜底），
`tests/win/**` 同域 ⇒ **两件不同域，必须拆 PR**。这是派单件 §八 明确许可的处置（「若跨域被拦 ⇒ 按域拆 ≤2 件」）。

---

## 二、自验结论（逐项，附原始输出出处）

> 口径：队内只说「自验结论」。**通过与否归 CTO 收件闸 + K3 终审**，本条不判「通过」。

### 2.1 A4-c（D1039）control-tower-tests 按需跑

| 判据 | 结果 | 原始输出出处 |
|---|---|---|
| 配对测试 | **78 通过 / 0 失败 / 0 显式跳过 ｜ EXIT=0** | `D1039-A4c-自验与反例-原始输出.md` §3 |
| 「收窄即红」（原建议 5 条） | **73 通过 / 5 失败 ｜ EXIT=1**（红在 watchdog yml / dashboard-auto yml / .gitattributes / .gitmodules / tsconfig.build.json） | 同上 §4① |
| 「抽掉两处漏点即红」 | **74 通过 / 4 失败 ｜ EXIT=1** | 同上 §4② |
| 恢复逐字节一致 | `sha256 a5959792b647c1ba4a4b80973cb7d8e5c4977bddbaf95f03ac341d2f8cf88178` 前后一致 | 同上 §4 |
| P0 `-e` 陷阱（GH 真实语义，抽 ci.yml 真 step 正文） | 降级 ⇒ `STEP EXIT=0` + ::warning；拿掉 `\|\| RC=$?` ⇒ `STEP EXIT=2`；自身失败 ⇒ `EXIT=1` | 同上 §4③ |
| 必需 context 不动（结构） | ct job `has if?: false ｜ has paths?: false`；job 名/matrix/timeout **零改动**；全文件 `^    if:` 仅 **1 行**（`ci.yml:550` checker-review，逐字同基线） | 同上 §2 |
| for 清单只追加 | `origin/main=45 → 工作区=46` | 同上 §3 |
| pre-commit / 预算 / 域 | 13/13 通过 ｜ `✅ D734 PR 预算 … 均在预算内` ｜ `✅ PASS 3 个文件全部归属 owner=mac` | 同上 §3 |
| CRLF（windows 腿专属风险，成员补测） | `.gitattributes\r\n` 注入 ⇒ `run=true`；`od -c` 核验 `\r` 被 `tr -s '[:space:]' '\n'` 剥净 | coder-a 补测回报 |

### 2.2 A4-b（D1040）测试期 `LOG_LEVEL=warn`

成员 coder-b 与**独立复核员 verifier-v 各自整跑**（同一 SHA、同命令、同范围）：

| 量 | coder-b | verifier-v（独立） | 判定 |
|---|---|---|---|
| INFO | 6,619 → **0** | 6,619 → **0** | ✅ 逐字一致 |
| WARN（after） | 2,715 | 2,716 | ⚠️ 差 1（见下） |
| ERROR | 320 → **320**（恒等） | 320 → **320**（恒等） | ✅ 逐字一致 |
| 范围 | 610 文件 / 4,538 用例 | 610 / 4,538 | ✅ 一致 |
| `wc -l` | 14,502 → 7,911 | 14,506 → 7,887 | ⚠️ 差 4 / 24 |

**归因闭环（最硬一条）**：verifier-v 在**完全相同的 SHA**上复跑，`wc -l` 仍差 4、WARN 仍差 11，
且失败用例从 2f/3t 变 3f/4t ⇒ 差异**不是基点漂移**，是**运行间不确定性（flaky）**，且失败条数差异正好解释行数差异。
⇒ **不得据此判 coder-b 测量有误**；两组数字都存在，**歧义必须披露而不是调和**。
**内部自洽检验**：`14506 − 7887 = 6619` **恰等于** INFO 灭失量 ⇒ 「ERROR 不再被 INFO 淹没、失败上下文仍在」成立。

### 2.3 A4-d（D1041）五 workflow 成本基线

改前实测（run `36356959940`，口径 = `updated_at − run_started_at`）：

| 量 | 值 |
|---|---|
| ci.yml **run 级墙钟** | `22:55:54Z → 23:34:04Z` = **2290 s (38.2 min)** |
| `Control Tower Gate Tests (windows-latest)` | `22:57:01Z → 23:34:03Z` = **2222 s** |
| 占比（run 墙钟口径） | **97.031%** |
| 占比（全部 job 跨度口径） | **99.955%**（2222/2223） |
| step 级 | `Run hermetic control-tower gate tests` = **2204 s** = 该 job 的 **99.19%** |
| docs-only run 的 windows CT 腿 | `36356863703` = **17 s**（step `skipped`，**不得当作提速证据**） |

⚠️ **口径更正声明**：队长初版把 `326 s`（排除 windows CT 腿后其余 12 job 跨度）**错标**为「run 总墙钟」，
由独立复核员 verifier-v 抓出（差 1964 s / 85.8%）。**本表已按 A/C/D 三分版更正**；
且「D/A = 97.0%」比原错误口径下的论证**更强**（windows 腿几乎就是整条 run 的墙钟）。

### 2.4 A4-e（D1042）watchdog 红根因

**分类：数据过期（判据对，链路断）** —— 判据本体只有 `check-progress-freshness.py:93` 算术 + `:94` 比较；
其自身密封测试在同一次红灯期间 **11/11 全绿**；9 条 run 的红/绿 **100%** 被 main 侧产物时间戳解释。
`age == 3.0` 不 fail（文档 `:8/:11`、代码 `:94` 严格 `>`、workflow `:7/:24`、密封测试四者一致）。
**但判据另有一处真 bug（±8h 时区）**：`:66` `datetime.now()` 本地墙钟 + naive 相减，生成端
`calc-progress.py:691/:808` 同样本地墙钟 ⇒ 跨机器差 8.000 小时，实测出**假绿**与**假红**两向。
**断点 = 「没人合」不是「合不进去」**：`git merge-tree --write-tree origin/main origin/auto/product-progress` → **EXIT=0 零冲突**；
最后一次真合并 = PR #367（2026-09-06），当前 0 个 open PR。

### 2.5 🔴 A4-v（D1043）独立复核的最终结论：**退回（数据缺失型）**

verifier-v 的冻结结论（`D1039-A4v-独立复核-墙钟比对.md` @ `verify/a4-ci-cost ed806bd5`）：

- 基线复核 **5/5 数值一致**（+1 处口径错已更正）
- **第 2/3/4 项未实测**：`team/a4-ci-cost` 未 push ⇒ 改后 PR run 不存在 ⇒ **未使用任何估算值或旧数据充数**
- **唯一退回理由 = 缺改后真实 run**（用户判据明令「用 run 实测，不许估算」）。
  「若此刻给『可提请独立审计』，等于替一个未成立的判据背书。」
- 其余全部消解：A4-b 因果独立确证 ✅ ｜ A4-a 判别性变异矩阵 **8/8 规则全部转红** ✅ ｜
  两处漏点 + §5A `-e` 陷阱**均已修复并复核** ✅ ｜「12 必需检查」前提独立核实成立 ✅

> **队长收件闸裁定**：**接受该「退回」为正确且必需的动作，不予推翻。**
> 这是**数据缺失型**退回，不是产出质量型退回。按队规，退回只约束该件（此处 = 「改动后墙钟比对」这一判据），
> **不冻结无依赖的并行项**：A4-b / A4-d / A4-e 的交付与 PR-1/PR-2 的提出不依赖它。
> ⇒ **处置：PR 照常提出；「改后墙钟 + 必需 context 断言」明确移交 push 后的首个 run（见 §三·遗留 1/2/4）。**

---

## 三、遗留清单（每条 = **为什么本批不能做**，不留「待后续」空尾巴）

| # | 遗留 | 为什么本批不能做 |
|---|---|---|
| 1 | 改后 run 的真实墙钟对比表 + 必需 context 断言 | **数据缺失**：改后 PR run 在本文件写就时尚未产生（分支未 push）。push 后 verifier-v 立即执行其 §7 对账命令清单（`bash /tmp/v-a4-reconcile.sh <run_id>`，已用两个已知基线自测通过）。**显式移交，不默认已验。** |
| 2 | 「碰路径 ⇒ 真执行」一侧实证 | 同 #1。口径已裁定：本批 PR 自身充当「碰路径」侧（它改 `scripts/control-tower/**` + `.github/workflows/**`）。 |
| 3 | 「不碰 ⇒ 跳」一侧实证 | ⚠️ **结构性无法在本批观察**：需**合入 main 后下一个不碰控制塔路径的 PR**。push main 也不满足（main 上无 base 可 diff ⇒ 走降级＝全量跑）。**必须显式移交下一批，不能默认已验。** |
| 4 | 12 必需检查在真实 run 里 `conclusion=success` | 同 #1。结构等价性已核（无 job 级 `if:`/`paths:`、job 名/matrix/timeout 逐字同基线），但「结构可判 ≠ 判据成立」。 |
| 5 | `tests/win/vitest-log-level.test.sh` 的 CI 接线 | **真依赖 D1040**：该测试断言本分支 `vitest.config.ts` 已收敛 `LOG_LEVEL=warn`（本分支实测**无**）⇒ 现在入 canary 清单 = **恒红 ⇒ 必需 context 红**。要变绿须搬 win 域 `vitest.config.ts` = 与 coder-b **同文件双写者**（违反写集互斥）。⇒ **D1040 落 main 后由 1 行卡补**（移交给 CTO；责任归队长）。 |
| 6 | `scripts/control-tower/brief_parser.py` bullet 分支不剥反引号 | 表格分支 L67 会 `strip("\`")`、bullet 分支 L111-114 不剥 ⇒ G12 匹配式 `re.search(r'(^|/)'+re.escape(pat)+r'$', path)` 对带反引号路径**永不匹配**（本批实际被此拦下一次 commit）。**最高风险门禁脚本类变更**，须另立卡 + 配对测试 + K2/K3 复审，超本批写集。 |
| 7 | **G12 排除臂对目录 glob 失效（fail-open）** | 实测 `src/**` vs `src/x.ts` → `False`；`src/x.ts` vs `src/x.ts` → `True` ⇒ `matches()` 是**字面后缀匹配不是 glob**。⇒ 全仓所有 brief 的 Q2「不做什么」里写目录级排除的，**物理上从未生效**。**独立高风险发现**（非本卡问题，是门禁问题），本批只登记，报 CTO 单列。 |
| 8 | `package-lock.json` 不纳入路径集 | **裁决：不纳管。** 依据（**已按 verifier-v 复核更正——队长原「近 30 commit 24 个 ≈80%」是错的**，那是 `git log --oneline -30 -- <file>` 的**全历史累计**语义）：① **无安全收益（实测）**：canary for-list 52 个测试中 bare-specifier `import/require` = **0** ⇒ 控制塔 `.sh` 测试**零第三方依赖**；② **改动确实稀少**：最后改动 `3fef816f`（**2026-09-15**），**近 30 commit 中 0 次**（两种口径均 0），本批期间 0 次，全历史累计 24 次。 |
| 9 | `packages/test-kit/vitest.config.ts:29` `LOG_LEVEL: 'silent'` | `packages/**` 非本批写集（红线）。与 A4-b「失败仍能出上下文」语义相悖，须单独裁决。 |
| 10 | `ci.yml:106` `（$doc）` / `ci.yml:193` `=$BASE（`（**D370 同型**） | 全角标点贴 `$VAR`，`set -u` 下 `unbound variable`。既有上游代码、非本批写集；当前两 step 无 `-u` ⇒ 仅丢值不致命。扩写集需 CTO 批。 |
| 11 | canary 漂移 **71 项**（总 742 / 清单 54 / 幽灵 **0**） | 存量维护缺口（`check-canary-drift.sh` 恒 exit 0，告警不阻断），非本批引入，K3 P2-4 独立立项。 |
| 12 | A4-e 的链路修复（CTO 用 PAT 开 PR 合 `auto/product-progress`） | **越权**：① 会写 main 的 6 个产物文件（扩写集）；② 需 founder 宽权 classic PAT，`CI-诊断通道.md:147-150` 记载 CTO 亦不自决；③ 合并是 D570 规定的 CTO 动作。 |
| 13 | A4-e 的判据修法 T1–T4（时区归一 / `%.1f`→`%.2f` / watchdog `::error` / 静默周假红） | 全部落在**门禁脚本 / 判分链 / `.github/workflows/**`** ⇒ 本批红线覆盖，须另立卡 + K3 复审。 |
| 14 | `schedule` 在仓库 60 天无活动后被 GitHub 自动暂停 | 平台行为，本地不可消除；安全网①②（路径判据 + `workflow_dispatch` 强制）不依赖它。 |
| 15 | `concurrency.cancel-in-progress` 会让 main push 取消进行中的 schedule run | 动它是 D1014 域（`ci.yml:12-18` 记载的既定设计），超本卡范围。 |
| 16 | `force_control_tower_tests` 与 dispatch 强制的语义冗余 | 派单件 §二/2c 明确要求保留该输入；改语义/删需 CTO 裁决。本批**保留**且在 `if:` 中被消费（**非死代码**），注释已写明。 |
| 17 | **授权偏离（须点名，防下一复核员按卡面判漏做）** | 派单件 §二/2(d) 要求「schedule run 里**只**跑 control-tower-tests，其余 9 个 job 用 job 级 `if:` 排除」；**冻结版未加那 9 个 `if:`**，且 ci.yml 注释明写这是**队长 D1039 裁决**。代价实测可忽略（那 9 个 job 各 9–20 s，而 CT windows 腿 2222 s 独占关键路径 ⇒ schedule run 时长不变）；好处是不引入 job 级跳过语义（必需 context 风险面不扩大）。**偏离已被队长显式授权。** |
| 18 | `scripts/control-tower/alloc-task-id.sh` 不查 brief 文件名 | 本批实际撞号（发 D1034，与 main 的 `.claude/task-briefs/2026-09-27-D1034-dispatch-template-v2.md` 冲突）⇒ 全队改号 D1039–D1043。属号段纪律缺口，须另立卡。 |
| 19 | **卡面前提 2 条不成立**（已更正，供 K3 核） | ① 「`ci.yml:101-105` 记的 D971 同型事故」→ `grep -c "D971" ci.yml` = **0**；D971（`0e8b6420`）**从未合入 main**；改用 `周报-20260922.md:58` 的 `405 "12 of 12 required status checks are expected."` 等可核出处。② 派单件「改前基线 7,767 行 / INFO 2,696 / WARN 1,380 / **ERROR 39**」与实测（**ERROR 320**，差 8.2×）对不上；那是 **CI `Vitest(1/2)` 单分片网页日志**口径 ≠ 本地全量 stdout。**若有人拿 39 当改前 ERROR 会得出完全错误结论。** |
| 20 | 卡面验收命令 1 条坏、1 条不可用 | ① `grep -c '"level":20\|40\|50'` 在 BRE 下是**字面量**且 `-c` 只数行**不分类** ⇒ 产不出「级别分布」（已作废，改用逐档 `-oE`）。② `python3 -c "import yaml"` 本机 python3 3.9.6 **无 PyYAML**（改用 ruby/js-yaml/node-yaml 三解析器交叉）。 |
| 21 | 「本地红」类数字**禁入验收** | verifier-v §6.4b 实测：**同一 SHA**上失败条数不稳定（其 3f/4t vs coder-b 2f/3t）。本地红条数受环境影响 ⇒ 只能作旁证，不得作判据。 |
| 22 | `D1039-A4e-watchdog-根因.md` 未登记 `DOCS-REGISTRY.yaml` | V5 文档登记门禁为**软提示**（不阻断）；该文件属队长写集，本批未登记。 |
| 23 | `scripts/audit/**` 是否应入判据 | **审计域**，复核员与实现者均为红线不可判（铁律 0-5）⇒ 由 K3/CTO 定。 |

---

## 四、推送纪律与回执

- **本轮零 push 至 `19fad252` 为止**（`git ls-remote --heads origin | grep team/a4-ci-cost` → **无输出**）。
- 推送纪律（派单件 §四）：① 推送前本地全验 ② **攒批推送**（一轮做完再推）③ 推送后不立刻再推 ④ `merge_method` 用 **`merge`** 而非 `squash`
  —— 因为 `.claude/bypass.log` 声明 `merge=union`，而 **squash 不跑 merge driver ⇒ 假冲突**（#864/#865 实证，代价是两次 sync + 两次取消）。
- 每次 push ≈ **37 min windows 腿**（`cancel-in-progress: true` 会取消前一次 run）。
- **与 PR #868 的冲突复核（派单件 §七）**：`#868`（`fix/ct-flow-brief-ledger-20260927`）仍 open、未合。
  `git merge-tree --write-tree origin/fix/ct-flow-brief-ledger-20260927 <A4-c HEAD>` → **EXIT=0，零冲突**。
  两方都在 canary 清单**同一位置插入一行**（#868 插 `resolve-commit-brief.test.sh`，A4-c 插 `ci-signal-classify.test.sh`），
  但因 hunk 上下文不重叠，git 可自动合并 ⇒ **采纳派单件建议 ⓑ（不等待，PR 标注协调需求）**。
  ⚠️ **合并顺序建议**：#868 先合 ⇒ A4-c 再做一次 `merge origin/main`（会多一次 push ≈37 min）。若 A4-c 先合则反之。
