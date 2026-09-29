# D1061-A3 · A3-02 PR 与 run 回执

> 写者：coder-a（D1061-A3 小队编码成员）｜工作树：`/Users/wane/SynovaAgent/.synova-wt-squad-d1061-a3`（分支 `chore/d1061-a3-shards`）
> 口径：本文所有数字均来自命令**原始输出**，不手写；关键输出不 `head` 截断，需计数处标「共 N 处」。
> **状态：⛔ 本交付 C4 不成立（ubuntu 必需检查转红），不得提请独立审计。** 本文如实记录反证，修复方案待 CTO 裁定。

---

## 〇、结论摘要（先看这里）

| 项 | 判定 | 一句话 |
|---|---|---|
| A. 推分支 | ✅ | `a3ab5a97` → 远端 `chore/d1061-a3-shards` |
| B. 开 PR | ✅ | PR **#900**，`base=main`，栈式声明齐备 |
| C. 解 dirty | ✅ | merge `origin/main` 后 `mergeable=True`，`dirty`→`blocked` |
| D. 触发 CI | ✅ | run **36542166241**，head `980c629a` |
| E. **腿时 ≤300s** | ❌ | 4 条 windows 分片腿 = **599 / 704 / 730 / 753s**（全 > 300s） |
| F. **其他腿不退化（C4）** | ❌ | **全部 5 条 CT 腿红**（ubuntu 必需检查 + 4 windows 分片） |
| G. 分片是否生效 | ❌ **根因** | 每分片 `selected_of_total=55/55` —— 分片**完全未生效** |

**根因（一句话）**：本 PR 改动 `.github/workflows/ci.yml`，命中 map 规则 `.github/workflows/* → ["__FULL__"]`，选择器 `FORCE_FULL=1` 后**在分片过滤之前**就 `full_list; exit 0` ⇒ 4 个分片各自跑全量 55 条 catalog，既不降时、又 4 倍算力，且每片都撞上同一个夹具。

**另一独立红**：`tests/control-tower/ci-signal-classify.test.sh` 逐字断言 job 名未改；A3 改的就是那一行 ⇒ 5 条腿全红。与分片无关，是**改机制未同步守护**。

---

## 一、前提复核（开工前实测，与队长冻结一致）

| 前提 | 命令 | 原始输出摘要 | 成立 |
|---|---|---|---|
| P1 | `git rev-parse HEAD` / `git status --porcelain \| wc -l` | `a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1` / `0` | ✅ |
| P2 | `git ls-remote --heads origin \| grep -c d1061` | `4`（a / a2 / b / v），无 a3-shards | ✅ |
| P3 | `git merge-base origin/main HEAD` | `c6787513dd9db799a04016ead89292b67a6f72dd` | ✅ |
| P3 | `GET /pulls/886` | `state=open, mergeable_state=clean, head=915805356538b6145da51c7a54b283c0659fed37` | ✅ |
| P4 | `GET /branches/main/protection` | `required_status_checks.count = 12`，含 `'Control Tower Gate Tests (windows-latest)'`（无 shard 后缀） | ✅ |
| P5 | `grep -n "shard" .github/workflows/ci.yml` | `:363 name: Control Tower Gate Tests (${{ matrix.os }}${{ ... format(', shard {0}/4', matrix.shard) ... }})`；`:371 shard: [1, 2, 3, 4]` | ✅ |
| P6 | `git merge-tree --write-tree origin/main HEAD` | `merge_tree_exit=0` | ✅ |
| P7 | `grep GITHUB_TOKEN ~/.dsh/.credentials.yaml` | `token_len=40`（未打印 token 本身） | ✅ |
| P8 | push 时 pre-push 输出 | `⚠️ 门禁 0-1: fetch origin chore/d1061-a3-shards 失败 — 同步检查跳过 (fail-open)` | ✅ |

**A3-only 提交 = 6 个**（`git rev-list --count 91580535..HEAD` → `6`）。

### ⚠️ 前提清单漏了一条（本卡死锁的真因）
派单件前提只覆盖了分支/PR/保护，**未覆盖「本 PR 自身改动 ci.yml 会令 `__FULL__` 规则触发、从而使分片失效」**。这条前提的缺失直接导致 C 判据（≤300s）不成立。

---

## 二、验收命令 A–I 逐条原始输出

### A. `cd 工作树 && git rev-parse HEAD`
```
$ git rev-parse HEAD
a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1
$ git rev-parse --abbrev-ref HEAD
chore/d1061-a3-shards
```
→ 与 `a3ab5a97` 全 sha 一致 ✅

### B. `git status --porcelain` → 0 行
```
$ git status --porcelain
（无输出）
$ git status --porcelain | wc -l
       0
```
✅

### C. `git push -u origin chore/d1061-a3-shards`
```
To github.com:tangbaobao520/SynovaAgent.git
 * [new branch]        chore/d1061-a3-shards -> chore/d1061-a3-shards
branch 'chore/d1061-a3-shards' set up to track 'origin/chore/d1061-a3-shards'.
push_exit=0
```
pre-push 关键行：
```
  ⚠️  门禁 0-1: fetch origin chore/d1061-a3-shards 失败 — 同步检查跳过 (fail-open)
  ✅ 工作区无真实凭证
  [GATE] 全部 11 个黄金案例通过 — F1 门禁开放
  ✅ 全部门禁通过 — 允许推送
```
**未使用 `--no-verify`** ✅

### D. `git ls-remote --heads origin | grep chore/d1061-a3-shards`（首次）
```
a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1	refs/heads/chore/d1061-a3-shards
remote=a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1
local =a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1
MATCH: remote_head == local_HEAD
```
✅

### E. 开 PR（`POST /pulls`, base=main）
```
HTTP 201
pr_number = 900
pr_url = https://github.com/tangbaobao520/SynovaAgent/pull/900
head = chore/d1061-a3-shards a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1
base = main f51aaf9bf8e028b6597ffd9a51fb802966a02faf
state = open
```
标题：`ci(D1061-A3): windows CT 腿四分片 — 解除 ≤300s 阻塞（栈式·base=main）`
body 自检（`GET /pulls/900` 回读）：
```
has 栈式声明       = True
has merge-base sha = True    (c6787513dd9db799a04016ead89292b67a6f72dd)
has #886           = True
has 6 提交         = True
has 收敛声明       = True
```
开 PR 前确认无重复：`pulls?head=tangbaobao520:chore/d1061-a3-shards&state=all` → `count = 0` ✅

---

## 三、中途前提推翻 → CTO 裁定方案 A → 合并 main（步骤 1–9）

### 队长发现（我独立复现，一致）
```
GET /pulls/900 → mergeable = False / mergeable_state = dirty
GET /actions/runs?branch=chore/d1061-a3-shards → total_count = 0
GET /commits/a3ab5a97.../check-runs            → total_count = 0
```
⇒ `pull_request` 事件在无法生成合并树时不触发 workflow，步骤②死锁。

### 执行序列（CTO 批准方案 A）
```
[2] git status --porcelain | wc -l                 → 0
[2] git rev-parse HEAD                             → a3ab5a9756c48f7cd5f26e36ae3743eb56b6e0c1
[3] grep -n 'bypass.log merge=union' .gitattributes → 14:.claude/bypass.log merge=union
[4] git rev-parse origin/main                      → f51aaf9bf8e028b6597ffd9a51fb802966a02faf   （与队长实测一致，未前移）
[5] git merge-tree --write-tree origin/main HEAD   → merge_tree_exit=0
[6] git merge origin/main --no-edit                → merge_exit=0
```
`[6]` 原始输出：
```
Auto-merging .claude/bypass.log
  ℹ D513: MERGE_HEAD 存在 — merge 提交，D328 一致性检查跳过（构成提交已各自校验）
Merge made by the 'ort' strategy.
 .claude/bypass.log                                 |   3 +
 ...-CT-2b-夹具-BSD-宿主假设-usr-bin-stat-硬编码.md |  53 +++++++++++
 .../D1065-eval-3facts-repro-and-options.md         | 100 +++++++++++++++++++++
 task-state/D1067.json                              |  24 +++++
 4 files changed, 180 insertions(+)
```
⇒ main 侧改动 **4 个文件，不含 ci.yml**（与队长实测一致）。

### [7] 合并后自检（逐条）
```
[7a] git log --oneline -1
980c629a Merge remote-tracking branch 'origin/main' into chore/d1061-a3-shards

[7b] git merge-base --is-ancestor origin/main HEAD
ANCESTOR_OK                                  ← GitHub 变 clean 的充要条件

[7c] git status --porcelain | wc -l
       0

[7d] grep -rn '^<<<<<<<\|^>>>>>>>' .claude/bypass.log .github/workflows/ci.yml
grep_exit=1 (1 = 0 matches)
.claude/bypass.log:0
.github/workflows/ci.yml:0
--- 共 0 处 ---

[7e] git show HEAD:.github/workflows/ci.yml | grep -n "shard {0}/4"
363:    name: Control Tower Gate Tests (${{ matrix.os }}${{ matrix.os == 'windows-latest' && format(', shard {0}/4', matrix.shard) || '' }})

[7f] git show HEAD:.claude/bypass.log | wc -l
    1936                                    ← ≥1936 ✅（1925 基 + 双方新增，union 未丢行）

[7g] git rev-parse HEAD
980c629ab1a99bff9582db5838d1d6000761e773
```
全部通过 ✅

### [8] 推送（合并后）
```
  ✅ 门禁 0-1: 与远端同步 (本地领先 10)          ← 真比对通过（非 fail-open）
  ✅ 全部门禁通过 — 允许推送
To github.com:tangbaobao520/SynovaAgent.git
   a3ab5a97..980c629a  chore/d1061-a3-shards -> chore/d1061-a3-shards
push_exit=0
```
**未使用 `--no-verify`** ✅

### [9] 回执 + PR 状态
```
$ git ls-remote --heads origin | grep chore/d1061-a3-shards
980c629ab1a99bff9582db5838d1d6000761e773	refs/heads/chore/d1061-a3-shards
$ git rev-parse HEAD
980c629ab1a99bff9582db5838d1d6000761e773
MATCH: remote_head == local_HEAD
```
```
GET /pulls/900
number          = 900
state           = open
mergeable       = True          ← dirty 已解除
mergeable_state = blocked       ← 旧必需名不再上报
head.sha        = 980c629ab1a99bff9582db5838d1d6000761e773
base.ref        = main
commits         = 19
changed_files   = 19
additions       = 3583   deletions = 4
```

### [10] CI 触发确认
```
GET /actions/runs?branch=chore/d1061-a3-shards
total_count = 1
run_id= 36542166241 | event= pull_request | status= in_progress | conclusion= None
  | head_sha= 980c629ab1a99bff9582db5838d1d6000761e773 | created= 2026-09-29T08:21:06Z
  | url= https://github.com/tangbaobao520/SynovaAgent/actions/runs/36542166241
```
`head_sha` == 新头 ✅

---

## 四、F–I：16 条 job 取证

### F/G. job 名单**逐字**（`GET /actions/runs/36542166241/jobs?per_page=100`，`total_count = 16`）

```
'Integration Contract Check'                                       | success
'Test-Kit Architecture Tests (ubuntu-latest)'                      | success
'Control Tower Gate Tests (windows-latest, shard 2/4)'             | failure
'Control Tower Gate Tests (windows-latest, shard 1/4)'             | failure
'Gate Integrity (pattern sentinel + injection fixture + ci-reds)'  | success
'Test-Kit Architecture Tests (windows-latest)'                     | success
'Control Tower Gate Tests (windows-latest, shard 4/4)'             | failure
'Architecture Check'                                               | success
'Checker Review (maker/checker)'                                   | success
'TypeScript + Lint + Iron Laws'                                    | success
'Control Tower Gate Tests (windows-latest, shard 3/4)'             | failure
'Control Tower Gate Tests (ubuntu-latest)'                         | failure
'npm audit'                                                        | success
'Vitest (2/2)'                                                     | success
'Vitest (1/2)'                                                     | success
'Golden Case F1 Gate'                                              | success
```

### G. 逐字名 vs P5 推算名 比对

| P5 推算名（ci.yml matrix 推导） | 实际上报名（逐字复制） | 判定 |
|---|---|---|
| `Control Tower Gate Tests (ubuntu-latest)` | `Control Tower Gate Tests (ubuntu-latest)` | **逐字一致** |
| `Control Tower Gate Tests (windows-latest, shard 1/4)` | `Control Tower Gate Tests (windows-latest, shard 1/4)` | **逐字一致** |
| `Control Tower Gate Tests (windows-latest, shard 2/4)` | `Control Tower Gate Tests (windows-latest, shard 2/4)` | **逐字一致** |
| `Control Tower Gate Tests (windows-latest, shard 3/4)` | `Control Tower Gate Tests (windows-latest, shard 3/4)` | **逐字一致** |
| `Control Tower Gate Tests (windows-latest, shard 4/4)` | `Control Tower Gate Tests (windows-latest, shard 4/4)` | **逐字一致** |

⇒ **5/5 逐字一致**（P5 的 ci.yml matrix 推导与实际上报名完全吻合）。**但不一致项存在**：旧必需保护名 `Control Tower Gate Tests (windows-latest)`（无 shard 后缀）**不再上报** —— 这正是 `mergeable_state=blocked` 的来源。

### H. 腿时（`completed_at - started_at`，秒）— 全 16 条，含失败项

| job_id | job name | conclusion | started_at | completed_at | leg_s |
|---|---|---|---|---|---|
| 109319929807 | Integration Contract Check | success | 08:21:08Z | 08:22:35Z | 87 |
| 109319930163 | Test-Kit Architecture Tests (windows-latest) | success | 08:21:08Z | 08:21:42Z | 34 |
| 109319930188 | Control Tower Gate Tests (windows-latest, shard 4/4) | **failure** | 08:21:08Z | 08:33:18Z | **730** |
| 109319930029 | Test-Kit Architecture Tests (ubuntu-latest) | success | 08:21:09Z | 08:21:28Z | 19 |
| 109319930106 | Control Tower Gate Tests (windows-latest, shard 1/4) | **failure** | 08:21:09Z | 08:32:53Z | **704** |
| 109319930152 | Gate Integrity (pattern sentinel + injection fixture + ci-reds) | success | 08:21:09Z | 08:21:34Z | 25 |
| 109319930289 | TypeScript + Lint + Iron Laws | success | 08:21:09Z | 08:23:17Z | 128 |
| 109319930338 | Control Tower Gate Tests (ubuntu-latest) | **failure** | 08:21:09Z | 08:22:33Z | **84** |
| 109319930950 | npm audit | success | 08:21:09Z | 08:21:24Z | 15 |
| 109319930077 | Control Tower Gate Tests (windows-latest, shard 2/4) | **failure** | 08:21:10Z | 08:33:43Z | **753** |
| 109319930216 | Architecture Check | success | 08:21:10Z | 08:23:15Z | 125 |
| 109319930217 | Checker Review (maker/checker) | success | 08:21:10Z | 08:23:08Z | 118 |
| 109319930290 | Control Tower Gate Tests (windows-latest, shard 3/4) | **failure** | 08:21:10Z | 08:31:09Z | **599** |
| 109320665033 | Vitest (2/2) | success | 08:23:19Z | 08:26:10Z | 171 |
| 109320665073 | Vitest (1/2) | success | 08:23:19Z | 08:25:37Z | 138 |
| 109321643945 | Golden Case F1 Gate | success | 08:26:13Z | 08:26:45Z | 32 |

**windows 四条分片腿各有真实秒数**：`599 / 704 / 730 / 753` ✅（判据要求）
**全部 5 条 CT 腿失败的 step 均为** `step 6 'Run hermetic control-tower gate tests'`。

### H-对照. baseline（A3-01 引用的 PR-A run）
```
run 36528674633
109277211498 'Control Tower Gate Tests (ubuntu-latest)'  success  leg_s= 72
109277211633 'Control Tower Gate Tests (windows-latest)' success  leg_s= 630    ← 单腿、绿
```

### I. 判据核对（**改口径：不套用预期，只记实测**）

卡面判据（`A3-01:11`）：**`判据 = windows CT 腿 ≤ 300s`**，A3-01 预测四分片为 `238–260s`。

| 口径 | baseline 单腿 | 预测（A3-01） | **实测** | 判定 |
|---|---|---|---|---|
| windows CT 腿墙钟 | 630s（单腿） | 238–260s | **599 / 704 / 730 / 753s** | ❌ **不成立**（超判据 2.0–2.5 倍，超预测 2.3–3.2 倍） |

**总计**：windows 面 CT 计算量由 baseline 的 1×55 套件 → A3 的 **4×55 套件 ≈ 4 倍**，墙钟**零下降**。
（口径变更说明：原预期「PR 恒 blocked」的前提已被方案 A 推翻，已解 dirty；但 `mergeable_state` 实测仍为 `blocked`，原因变为「旧必需检查名不再上报」—— 如实记录，不套用预期。）

---

## 五、C4 反证：ubuntu CT 腿红（原始片段 + 断言出处 + 为什么是 A3 引入）

### 5.1 现象
`Control Tower Gate Tests (ubuntu-latest)` **failure**，`2026-09-29T08:21:09Z → 08:22:33Z`（84s），job id `109319930338`。

### 5.2 原始日志片段（**完整片段，未 tail 截断**）
```
2026-09-29T08:21:36.0004333Z FAIL: tests/control-tower/ci-signal-classify.test.sh
2026-09-29T08:21:36.0074730Z ##[error]  ❌ job 名被改动|  ✅ 接线顺序: ctsignal step (L408) 在重活 step (L446) 之前|  ✅ GH 语义: 分类器降级(2) ⇒ STEP EXIT=0（降级不误判 PR 红）|  ✅ GH 语义: 降级仍显式可见（::warning 留痕，铁律 11）|  ✅ GH 语义: 分类器自身失败(1) ⇒ STEP EXIT=1（fail-closed 仍红）|  ✅ GH 语义: 正常(0) ⇒ STEP EXIT=0|  ✅ 红向证明: 去掉「|| RC=赋值」⇒ STEP EXIT=2（夹具判别性成立）|结果: 77 通过, 1 失败, 0 显式跳过|
```
> 注：ubuntu 片段中「共 1 处 FAIL」；其余 6 项断言全绿，仅 `❌ job 名被改动` 一项红。

### 5.3 断言出处（逐字 `grep -qF` 字面量比对）
`tests/control-tower/ci-signal-classify.test.sh:239-240`：
```bash
printf '%s' "$CTJOB" | grep -qF "name: Control Tower Gate Tests (\${{ matrix.os }})" \
  && ok "身份不变: job 名未改（必需 context 名依赖）" || no "job 名被改动"
```
A3 把 `.github/workflows/ci.yml:363` 改成带 `format(', shard {0}/4', matrix.shard)` 的表达式 ⇒ 字面量 `name: Control Tower Gate Tests (${{ matrix.os }})` 不再出现 ⇒ 夹具判红。

### 5.4 A3 是否改过该夹具 → **未改**
```
$ git diff --stat c6787513..HEAD -- tests/control-tower/ci-signal-classify.test.sh
（无输出）
--- 行数 ---
       0
```
（对照：A3 确实改了 ci.yml —— `git diff --stat c6787513..HEAD -- .github/workflows/ci.yml` → `1 file changed, 72 insertions(+), 3 deletions(-)`）

### 5.5 为什么是 A3 引入
该夹具是 D1039 立下的「**必需 context 名不得擅改**」**元门禁**。A3 的合法性主张（改 job 名以分片）与它直接冲突，而 A3 **只改了 ci.yml、未同步该守护夹具**，属「改机制未同步守护」。

### 5.6 队长的假设 vs 实测（**一处被推翻，如实记**）
队长预期「该夹具在 shard 3，所以 **windows shard 3/4 很可能同样红**」。
**实测：4 条 windows 分片腿全部红**（shard 1/2/3/4 各有一条 `FAIL: tests/control-tower/ci-signal-classify.test.sh`，共 4 处），原因见第六节 —— **分片压根没生效**，每片都跑了该夹具。

```
wshard1: FAIL: tests/control-tower/ci-signal-classify.test.sh   （08:25:34Z）
wshard2: FAIL: tests/control-tower/ci-signal-classify.test.sh   （08:25:48Z）
wshard3: FAIL: tests/control-tower/ci-signal-classify.test.sh   （08:24:53Z）
wshard4: FAIL: tests/control-tower/ci-signal-classify.test.sh   （08:25:45Z）
```

---

## 六、根因（本卡最关键发现）：分片**完全未生效**

### 6.1 观测
CI 每个分片都上报**全量选择集**：
```
[D1061-SELECT] shard=1/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
[D1061-SELECT] shard=2/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
[D1061-SELECT] shard=3/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
[D1061-SELECT] shard=4/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
##[notice]platform=windows shard=1/4 selected=55/55
```
`degraded=0`（**不是**降级回退），即选择器「认为」自己正常地选中了 55 条。

### 6.2 本地复现（同一命令，工作树内跑）
```
$ bash scripts/control-tower/ct-suite-select.sh --changed origin/main...HEAD --platform windows --shard 1/4
[D1061-SELECT] shard=1/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
stdout 条数 = 55
$ bash scripts/control-tower/ct-suite-select.sh --changed origin/main...HEAD --platform windows --shard 3/4
[D1061-SELECT] shard=3/4 mode=select platform=windows changed=19 selected_of_total=55/55 degraded=0
stdout 条数 = 55
$ bash scripts/control-tower/ct-suite-select.sh --changed origin/main...HEAD --platform ubuntu --shard 1/4
[D1061-SELECT] shard=1/4 mode=select platform=ubuntu changed=19 selected_of_total=55/55 degraded=0
stdout 条数 = 55
```
⇒ **`--shard 1/4` 与 `--shard 3/4` 返回完全相同的 55 条**；分片参数对结果无影响。

> **对照**：分片表本身是**合法的满划分**（`ct-suite-map.json → shards.assign`，`count=4`）：
> `shard 1 = 12 条｜shard 2 = 15 条｜shard 3 = 14 条｜shard 4 = 14 条`，合计 **55 = catalog 全量**，零缺口零重复。
> ⇒ 表没问题，**是过滤没被执行**。

### 6.3 机制（`bash -x` 逐步追踪，原始行）
```
+ [[ .github/workflows/ci.yml == .github/workflows/* ]]
+ HIT=__FULL__
+ break
+ '[' __FULL__ = __FULL__ ']'
+ FORCE_FULL=1
...
+ FORCE_FULL=1
+ full_list
+ exit 0
```
map 规则（逐字，`scripts/control-tower/ct-suite-map.json → rules[0]`）：
```json
{ "glob": ".github/workflows/*",
  "domains": ["__FULL__"],
  "why": "CI 定义自身变更 ⇒ 选择器前提失效（D1061）" }
```
语义（逐字）：`"__FULL__": "该路径无法安全判定影响面 → 显式回退全量（fail-closed，绝不静默缩小）"`

### 6.4 执行顺序（致命点）
`scripts/control-tower/ct-suite-select.sh`：
```
:273   if [ "$FORCE_FULL" -eq 1 ]; then
:274     full_list
:275     echo "[D1061-SELECT] ... selected_of_total=${TOTAL}/${TOTAL} degraded=$DEG_COUNT" >&2
:276     exit 0                      ← 在此退出
:277   fi
:280   if [ -n "$SHARD" ]; then     ← 分片过滤在这里，永远到不了
```
⇒ `FORCE_FULL` 短路发生在**分片过滤之前**。

### 6.5 因果链（一句话）
A3 的交付物**本身就是改 ci.yml** ⇒ 命中 `.github/workflows/* → __FULL__` ⇒ 分片被短路 ⇒ **本卡在自己的 PR 上必然失效**。
（`A3-01:10` 已记录起始 run「选择集 = `__FULL__`」，但**未推导出「A3 自己也在改 ci.yml」这层后果**。）

### 6.6 日志读取的一条**既有现象**（明确排除，不作为判据）
各 CT job 日志中可数到的 `── tests/…` 启动行为 **43 条**，而选择器报 `selected=55/55`。
**对照 baseline 绿 run**（`36528674633` Windows CT，630s，success）：日志同样 **43 条**、同样止于 `tag-ancestry.test.sh`、同样无 `tests/doc-system` 启动行。
⇒ 该 43 vs 55 是**日志下载侧既有现象**，**baseline 绿 run 一致 ⇒ 不是 A3 引入的回归**，不作为本卡判据；选择器层面的 `55/55` 才是权威数字。

---

## 七、修复选项与代价（**只记录，不执行**）

> 两个选项都触及本次写集之外，**均须 CTO 批准；coder-a 不得自行动手**。

### 选项 R-A：改夹具期望值 → 新名集
- 动作：把 `tests/control-tower/ci-signal-classify.test.sh:239` 的 `grep -qF` 字面量改为接受分片名集合（或 `grep -qE`）。
- 代价：**扩写集 +1 文件** `tests/control-tower/ci-signal-classify.test.sh`，属 **M2 越界**（原写集只有 2 个证据文件）⇒ 必须 CTO 批。
- **未解决**：它只修「元门禁红」，**不修第六节的分片短路**。若只做 R-A，`selected_of_total` 仍为 `55/55`，腿时仍 599–753s，**判据 ≤300s 依旧不成立**。

### 选项 R-B：改设计 → 保留一个字面名聚合 job
- 动作：保留一个**字面 job 名** `Control Tower Gate Tests (windows-latest)` 的**扇入/聚合 job**（4 个分片跑完 → 聚合 job 汇总），使 **分支保护的必需检查名根本不用改**。
- 代价：`ci.yml` 结构改写（新增聚合 job + `needs:` 依赖 + 结果传递），且该夹具的字面断言**仍要动**（因为原 job 名可能被用于聚合语义，`grep -qF "name: Control Tower Gate Tests (\${{ matrix.os }})"` 仍可能不匹配）。
- **同时需一并处理**：`.github/workflows/* → __FULL__` 与分片过滤的执行顺序（否则分片仍失效）—— 这属**选择器语义变更**，超出本卡原写集。

### 两选项共同未决项
1. 分片短路（`FORCE_FULL` 先于分片过滤）必须修，否则分片永不生效；
2. `mergeable_state=blocked`（旧必需名不再上报）需 CTO 步骤③④⑤同步；
3. 判据 `≤300s` 在实测 `599–753s` 下，**即使分片修好**也需重新核算余量（A3-01 的 238–260s 预测依赖 `__FULL__` 全量口径，一旦分片真正生效，口径改变，需重算）。

---

## 八、交付与红线自查

| 项 | 状态 |
|---|---|
| 写集 = 2 个证据文件 | ✅ 仅 `A3-02-PR与run回执.md` + `A3-02-run-metrics.json` |
| 不碰 `scripts/audit/**` | ✅ 未碰 |
| 不改分支保护 | ✅ 未碰（仅 `GET` 读） |
| 不加 `--no-verify` | ✅ 全程未用（两次 push 门禁均通过） |
| 不 force push / 不 squash | ✅ `push_exit=0`，`a3ab5a97..980c629a` 快进 |
| 不手改 `.claude/bypass.log` | ✅ 由 `git merge` 的 union 驱动产生 |
| 不动 `ci.yml` | ✅ 本轮未改（A3 的 ci.yml 改动来自 `a3ab5a97`） |
| 证据提交 | ⛔ **未提交**（按队长停等令） |

### 未能做到的事（如实）
1. **C4 不成立** ⇒ 本交付**不能**提请独立审计（ubuntu 必需检查转红 ⇒ PR 永久不可合）。
2. **判据「windows CT 腿 ≤300s」不成立**（实测 599/704/730/753s）。
3. **分片未生效**（每分片 55/55）—— 本卡的**核心机制被自身改动短路**。
4. **未提交证据**：`A3-02` 两文件已写入工作树但**未 commit、未 push**（等 CTO 裁定写集与方案）。
5. **未 complete task-1**。
6. **第二条 run 未取**：队长提醒「证据提交会再动分支头 ⇒ 触发第二 run，腿时也照抄」。因**未提交**，第二 run 未产生 ⇒ 两次 run 的方差对照**未取到**。

### Agent 自检 5 问
```
1. 接线检查：本任务无新增 export；产物为证据文档，无需接线。N/A
2. 异常处理：本任务无新增 catch。N/A
3. 类型安全：as any / as never / as unknown as = 0（未写代码）
4. 测试质量：本任务不新增测试文件；A3-02-run-metrics.json 已通过 json.load 校验（JSON valid）
5. 残留清理：工作树 git status --porcelain = 0 行（除 2 个新增证据文件）
```

---

## 九、待 CTO 裁定事项

1. **C4 失败如何记账** —— 本卡是「退回重做」还是「改设计（R-B）」还是「缩范围（只修元门禁 R-A + 分片短路）」？
2. **分片短路**（`.github/workflows/* → __FULL__` 早于分片过滤）是否立新卡？它超出本卡原设计（`A3-01` 未覆盖）。
3. **写集是否扩** —— R-A 需 +1 文件（夹具），R-B 需改 ci.yml 结构 + 可能改选择器语义。
4. **判据是否重定** —— `≤300s` 在 `__FULL__` 口径下无法达成；分片真正生效后需重新核算余量。
5. **证据提交时机** —— 本两文件已在工作树，未提交；等裁定后决定是否提交/改写。

---

*本文所有数字取自命令原始输出；凡未实测项已在第八节「未能做到的事」逐条列明。*

---

## 十、证据提交 + 第二条 run（方差记录）

### 10.1 提交与推送
用 `scripts/control-tower/synova-commit`（自带 auto-push，**未手工再推**）：
```
[chore/d1061-a3-shards 70df8aa7] docs(D1061-A3): 退回证据 —— 分片被 __FULL__ 短路（4 腿各跑全量 55/55，599/704/730/753s）+ 元门禁 5 腿全红
 2 files changed, 839 insertions(+)
 create mode 100644 docs/synova/product-lines/evidence/D1061-A3/A3-02-PR与run回执.md
 create mode 100644 docs/synova/product-lines/evidence/D1061-A3/A3-02-run-metrics.json
  ✅ 全部门禁通过 — 允许推送
To github.com:tangbaobao520/SynovaAgent.git
   980c629a..bab4c126  chore/d1061-a3-shards -> chore/d1061-a3-shards
```
pre-commit：`✅ 全部 13 组通过`；`✅ Commit 格式正确`；`✅ D395-a/D534 Note 引用门禁: 无治理/规则区变更（跳过）`（本次仅 `docs/`，未命中治理区；Note 引用仍按要求写入 commit body）；`✅ D706: 提交树与暂存声明一致（2 项变更逐项核对）`。
**未使用 `--no-verify`**（首次尝试因 `--files` 传参方式不对被拦，读报错后改为多参数，未绕行）。

```bash
$ git ls-remote --heads origin | grep chore/d1061-a3-shards
bab4c126adb461578006e2ab4eedbf587a36ecdf	refs/heads/chore/d1061-a3-shards
$ git rev-parse HEAD
bab4c126adb461578006e2ab4eedbf587a36ecdf
```
（`bab4c126` = post-commit hook 的 `bypass COMMITTED 登记`，紧随 `70df8aa7`；远端 == 本地。）

### 10.2 第二 run
```
GET /actions/runs?branch=chore/d1061-a3-shards
total_count = 2
id=36544058249 | event=pull_request | status=completed | conclusion=failure | head_sha=bab4c126adb461578006e2ab4eedbf587a36ecdf | created=2026-09-29T08:39:00Z
id=36542166241 | event=pull_request | status=completed | conclusion=failure | head_sha=980c629ab1a99bff9582db5838d1d6000761e773 | created=2026-09-29T08:21:06Z
```
第二 run job 数 **15**（第一 run 16）。

### 10.3 两 run 腿时对照（windows CT 分片，秒）

| 分片 | run 1（`36542166241`） | run 2（`36544058249`） | 差值 |
|---|---|---|---|
| shard 1/4 | 704 | **753** | +49 |
| shard 2/4 | 753 | **595** | −158 |
| shard 3/4 | 730 | **700** | −30 |
| shard 4/4 | 599 | **495** | −104 |
| ubuntu | 84 | 66 | −18 |

**极差 258s**（shard 2: 753 → 595；shard 4: 599 → 495），单腿方差达 **~±130s** 量级。
⇒ 这是 A3-01「余量仅 1s」担忧的**量化佐证**；但两 run 全部腿均**远超 300s 判据**，**方差记录不改变判据不成立的结论**。

### 10.4 第二 run 的分片选择集：**仍是 55/55**（符合预期）
```
[D1061-SELECT] shard=1/4 mode=select platform=windows changed=21 selected_of_total=55/55 degraded=0
##[notice]platform=windows shard=1/4 selected=55/55
##[notice]platform=ubuntu shard=1/4 selected=55/55
```
短路未修 ⇒ **第二 run 腿时只作方差记录，不作达标判据**。

### 10.5 第二 run 同因复现
```
FAIL: tests/control-tower/ci-signal-classify.test.sh   （08:43:48Z，shard 1/4 日志内共 1 处）
```

---

## 十一、⚠️ 第二 run 暴露的**新红**：D708 写集声明缺口（本轮最重要新发现）

### 11.1 现象
第二 run 的 `TypeScript + Lint + Iron Laws`（**必需检查**，job id `109326083203`）**failure**，失败 step 为 **`step 10 'Merge write-set reconciliation (D708)'`**。

第一 run 该 job **success**（当时 A3-02 尚未提交）⇒ **是本轮证据提交引入的新红**。

### 11.2 门禁原始输出（完整）
```
── merge-writeset-gate (D708) 合并级写集对账 ──
❌ 结论: block — 检测到 2 个写集外文件（夹带）
   任务: D1061 | 分支: chore/d1061-a3-shards
   D# 推断来源: branch → D1061
   变更集: 21 个文件（merge-base f51aaf9b）
   声明写集 36 条（多源并集）:
     · scripts/control-tower/ct-suite-select.sh   ← S1:task-state.write_set
     ...
     · docs/synova/product-lines/evidence/D1061-A3/A3-01-分片方案与不变式.md   ← S3:brief.Q2-include
     ...
   豁免 1 条（显式，逐条打印理由）:
     · .claude/bypass.log   ← [builtin] post-commit hook 每次提交追加的证据账本（运行期产物，与写集无关）
   夹带文件 2 个（不匹配任何声明项）:
     - docs/synova/product-lines/evidence/D1061-A3/A3-02-PR与run回执.md
     - docs/synova/product-lines/evidence/D1061-A3/A3-02-run-metrics.json
```
（声明写集共 36 条，其中**含 `A3-01-分片方案与不变式.md`，不含 A3-02 两文件**。）

### 11.3 根因
D708 读的是**仓库侧写集声明源**（`S1 task-state/D1061.json → write_set` 与 `S3 brief.Q2-include`）。
这两个源**声明了 `A3-01`，未声明 `A3-02`**。
**task-1 的写集只写在共享任务板上，不在仓库声明源内** ⇒ 门禁看不到 ⇒ 判夹带。
（⇒ 「写集写进 task-1 正文」与 D708 的实际读源之间存在缺口，属**流程级发现**。）

### 11.4 连带影响
- 必需检查 `TypeScript + Lint + Iron Laws` 转红 ⇒ PR 又多一条不可合因由；
- 其下游 `Vitest (${{ matrix.shard }})`（job `109326793372`）与 `Golden Case F1 Gate`（job `109326795067`）被 **skip**（matrix job 名未展开 = 未调度）。

### 11.5 门禁自带的三个修法（**均未执行，等裁定**）
```
① 把该文件加入声明（S1 task-state write_set / S2 dev doc 写集表 / S3 brief Q2）
② 从本 PR 移出该文件（它可能属于另一个任务）
③ 显式豁免: 在 PR 正文/声明文件加 `## 写集豁免` 段落，每行 `- <路径> — <理由>`（无理由不生效）
```
- **①** = 改 `task-state/D1061.json` 或 task brief ⇒ **写集扩写（M2 越界），须 CTO 批**；
- **②** = 撤掉本轮证据提交（与队长授权项 1 冲突）；
- **③** = **仅改 PR #900 正文**，不动任何仓库文件 —— 三个修法里代价最小，但**改 PR 正文不在队长授权的三件事之内**，故未执行。

### 11.6 状态
**未修**。已按红线「遇到门禁拦 → 停下报队长」上报，等 CTO/队长裁定采用 ①②③ 中哪一个。

---

## 十二、更新后的待裁定事项

1. **C4 失败如何记账** —— 退回重做 / 改设计(R-B) / 缩范围(R-A + 分片短路)？
2. **分片短路**（`FORCE_FULL` 早于分片过滤）是否立新卡？最小充分修 = **把分片过滤同样作用于 `full_list` 路径**（`shards.assign` 本身是 55 的完整划分，切分后正好落到 A3-01 预测口径）。
3. **写集是否扩** —— R-A 需 +1 夹具文件；D708 修法① 需改 task-state/brief。
4. **判据是否重定** —— `≤300s` 在 `__FULL__` 口径下无法达成（实测 495–753s）。
5. **D708 修法选 ①②③** —— ③ 只动 PR 正文，是否授权？
6. **第三 run 风险** —— 第二 run 因 D708 转红；若继续提交（如修 D708 后的补证）会再触发第三 run。

---

*本文所有数字取自命令原始输出；凡未实测项已在第八节「未能做到的事」逐条列明。*
