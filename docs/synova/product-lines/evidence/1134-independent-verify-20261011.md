# K4-01 / #1134 · 独立复核报告（四项 a/b/c/d）
> 复核席：**verifier-k4**（独立成员，非实施员）｜出具：2026-10-11 23:3x
> 被测：分支 `fix/1134-edge-lag-enum` @ **`429d8ebe19e38eaf2e34811c6545124a4ce44ad3`**（队长钉）
> 基线：**merge-base = `e52499ddd6a1320435abd44f24323b5865d4caa1`**（= rebase 当刻的 local-main）
> ⚠️ 我取到的最新 `origin/local-main = dc5ce093c37f6cf8ef069431b3192a390637f88d`（晚于交付基线 14 个提交）
> 我的克隆：`D:\synova-wt-b2-verify`（唯一；**未在实施员任何工作树跑过一个命令**）

---

## 0. 取件、钉定与**基线漂移**

**远端回执（M6）**
```
LSREMOTE_EXIT=0
TOTAL_REMOTE_HEADS=941
---- 命中行原文 ----
429d8ebe19e38eaf2e34811c6545124a4ce44ad3	refs/heads/fix/1134-edge-lag-enum
---- local-main 行 ----
dc5ce093c37f6cf8ef069431b3192a390637f88d	refs/heads/local-main
TOKEN_IN_OUTPUT=0
```
**钉定核对**：`PINNED=429d8ebe…` / `ACTUAL=429d8ebe…` / `MATCH=YES`；交付 commit `bfea3acf` 在分支上。
**分支近 6 提交**
```
429d8ebe docs(1134): 证据件补 §A.9（提交后复跑 + 门禁双配置 + D708 + token 复核）
bfea3acf fix(1134): 时滞棘轮上移 55→56 + 第 3 类值如实点名（goal_decomposition.json 散文值）
54c09ef1 docs(1134): …
13222cd5 fix(1134): action_effect_lag …unknown…degraded
e52499dd Merge pull request …（= 基线）
```

### 0.1 🔴 漂移（我独立发现，超出实施员声称）
```
MERGE_BASE(origin/local-main, 交付分支) = e52499ddd…   MB_IS_OLD_LOCALMAIN=YES
rev-list --left-right --count origin/local-main...HEAD = 14	4
NEW_LOCALMAIN_COMMITS(e52499ddd..origin/local-main) = 14
```
**漂移影响分析（决定性）**
```
14 个新提交改了哪些目录：docs/synova 23 · tests/store 4 · src/store 2 · tests/adapters 1 · .claude/claims 1
EDGE_TYPES_CHANGED_COUNT      = 0
ONTOLOGY_CHANGED_COUNT        = 0
LOADER_CHANGED_COUNT          = 0     （src/l4/ontology-loader.ts，测试 A 组穿的入口）
FILE_COLLISION（14 提交 × 交付件）= 0
⇒ 漂移不触本卡前提（棘轮 56/50 与 loader 均未变）；但分支仍 [behind 14] ⇒ 合并前必须 rebase
```
> 判定口径：**这是流程问题（铁律 0-3 禁 `[behind N]` 状态合并），不是正确性问题** —— 我已逐项验证漂移未触碰本卡任何前提。

---

## a. 我跑了什么命令（原始）

```bash
# —— 取件 / 钉定 / 漂移 ——
git -c … ls-remote --heads "http://Synova:<TOKEN>@192.168.1.7:3000/…/SynovaAgent.git"
git -c … fetch --no-tags "$URL" "+refs/heads/fix/1134-edge-lag-enum:refs/remotes/origin/fix/1134-edge-lag-enum" \
                              "+refs/heads/local-main:refs/remotes/origin/local-main"
git -c … merge-base origin/local-main origin/fix/1134-edge-lag-enum
git -c … rev-list --left-right --count origin/local-main...origin/fix/1134-edge-lag-enum

# —— 前提冻结（我自己的只读实测）——
git -c … ls-tree --name-only origin/local-main -- extensions/ontology/edge-types/ | wc -l
git -c … show origin/local-main:extensions/ontology/edge-types/goal_decomposition.json
git -c … grep -h '"action_effect_lag"' origin/local-main -- extensions/ontology/edge-types/ | sed 's/.*: //' | sort | uniq -c
git -c … grep -n "action_effect_lag" origin/local-main -- src packages
bash scripts/control-tower/check-ontology-fields.sh          # 冻结判据，真仓
SYNO_EDGE_TYPES_DIR=/tmp/k4v-frozen-gate-sandbox bash scripts/control-tower/check-ontology-fields.sh

# —— Stage A（结构面，merge-base 口径）——
git -c … checkout -B verify-k4-01 429d8ebe…
git -c … diff --name-status --find-renames "$MB"...HEAD
git -c … diff "$MB" HEAD -- extensions/ontology      # 必须空
git -c … diff "$MB" HEAD -- src packages             # 必须空

# —— Stage B（五连，全部在自建克隆内造红 + 原样恢复）——
node_modules/.bin/vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts     # T-green
python3 改 tests/…-1134.test.ts: const BASELINE_TOTAL = 56 → 57                  # T-mut-A
git checkout -- tests/…-1134.test.ts
python3 把散文值加进 EDGE_LAG_ALLOWED_SET（豁免面 7 → 8）                          # T-mut-B
git checkout -- tests/…-1134.test.ts
python3 改 extensions/ontology/edge-types/assumption_triggered_reallocation.json  # T-real
        "action_effect_lag": "unknown" → "immediate"
git checkout -- extensions/ontology/edge-types/assumption_triggered_reallocation.json
python3 改 同件 description（追加 "[k4v-neg-control]"）                              # T-neg
git checkout -- extensions/ontology/edge-types/assumption_triggered_reallocation.json

# —— 终检 ——
git -c … status --porcelain ; git -c … stash list ; git -c … rev-parse HEAD ; git -c … hash-object <各件>
```

---

## b. 原始输出

### b-1 前提冻结（我独立实测，不采信转述）
| 项 | 我的原始读数 | 与任务书 |
|---|---|---|
| D1 `edge-types` 件数 | **56** | 任务书「56（非卡面 55）」✅ |
| D2 `goal_decomposition.json:32` | `"action_effect_lag": "0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞"` | ✅ 散文串（第 3 类值） |
| D3 `unknown` 计数 | `50 "unknown"` / `2 "3-6_months"` / `1 "immediate"` / `1 "1_month"` / `1 "1-3_months"` / `1 ×散文串`，总 56 | ✅ unknown=50、inEnum=5 |
| 读取侧消费方 | `src/` + `packages/` 对 `action_effect_lag` **COUNT=0** | ✅「无读取侧可插桩」成立 |
| 任务书「23 it / 94 expect」 | 批 1 分支实测 **700 行 / 30 it / 81 expect** | ⚠️ **任务书不实**，实施员更正可信 |

### b-2 🔴 冻结判据 `check-ontology-fields.sh` 零枚举感知（加分独立取证）
```
[F1] 真仓（含那条散文违规值）
  >>> bash scripts/control-tower/check-ontology-fields.sh
  ✅ 全部 56 件边类型关键字段齐全（action_effect_lag, transfer_function）
  <<< FROZEN_GATE_EXIT=0          ← 非法值照样过

[F3] 沙箱注入一条 blatant 第三类值 "NOT_IN_ENUM_AT_ALL"
  >>> SYNO_EDGE_TYPES_DIR=<sb> bash scripts/control-tower/check-ontology-fields.sh
  ✅ 全部 1 件边类型关键字段齐全（action_effect_lag, transfer_function）
  <<< FROZEN_GATE_SANDBOX_EXIT=0  ← 仍放行

[F4] 负对照：删掉字段
  ❌ probe-missing.json: 缺字段 action_effect_lag
  ❌ probe-missing.json: 缺字段 transfer_function
  ── 汇总: 检查 1 件，违规 2 处（字段集: action_effect_lag, transfer_function）
  <<< FROZEN_GATE_MISSING_EXIT=1  ← 它在工作，只是不看值域
```
读源佐证：该脚本第 76-82 行只判 `fld not in d` 与 `isinstance(d[fld], str) and d[fld].strip()`
⇒ **那条散文违规只有本卡的审计能抓到；本卡不是重复建设**。

### b-3 Stage A 结构面
| 检查 | 原始读数 | 判 |
|---|---|---|
| 钉定 | `SHA_MATCH=YES`；`MERGE_BASE=e52499ddd…`；`MB_IS_OLD_LOCALMAIN=YES` | ✅ |
| 变更集 | `4 files changed, 1561 insertions(+)`；`FILES_TOTAL=4`（治理 3 + **计预算 1**）≤12 | ✅ |
| 单域 | 唯一计预算件 = `tests/l4/edge-lag-unknown-degraded-1134.test.ts` | ✅ |
| **边界 extensions/ontology** | `BOUNDARY_EXT_EMPTY=YES`（vs merge-base 空输出） | ✅ |
| **边界 src/ packages/** | `BOUNDARY_SRC_EMPTY=YES`（vs merge-base 空输出） | ✅ |
| 探针 | `PROBE_ABSENT=YES`（未外提 = 首选形态） | ✅ |
| 判据件结构 | `LINES=754`／`IT_COUNT=31`／`EXPECT_COUNT=87`；describe A–F 6 组 | ✅ 非空壳 |
| 棘轮常量（交付态） | `BASELINE_TOTAL=56`、`BASELINE_DEGRADED=50`、`BASELINE_IN_ENUM=5`、**`BASELINE_SPEC_VIOLATION=1`**、`SPEC_VIOLATION_FILES=['goal_decomposition.json']`、`SPEC_VIOLATION_VALUE_PREFIX='0d —'`、`ID_FILENAME_DIVERGENT=5`、`SANDBOX 5/4/1`、`READ_SIDE_EMISSION='NOT_IMPLEMENTED'` | ✅ 与盘上事实一致 |
| token | `HITS_IN_GITDIR=0` / `HITS_IN_WORKTREE=0` | ✅ |
| 盘上事实 | `EDGE_TYPES_COUNT=56`；50 unknown / 5 inEnum / 1 散文 | ✅ |

**与批 1 逐行增量（我自持参照物 diff）**：棘轮 `55 → 56`；新增 `BASELINE_SPEC_VIOLATION*` 三常量；A4 由「违规 = 0」改为「违规 = 1」并**新增 A4b**（点名真实文件名 + 原样值 + 断言豁免面仍恰 7 项 + 断言散文值**不在**豁免面内）；E4 同步改为 `BASELINE_SPEC_VIOLATION`；F1 标题 55→56。**改动方向 = 如实计入，不是放宽**。

### b-4 Stage B 五连判别性（**exit code 已修正**，见 §e 自我纠错）
```
[B1] T-green  VITEST_EXIT=0   Test Files 1 passed (1)   Tests 31 passed (31)   12.26s / 9.56s(复跑)
[B2] T-mut-A  VITEST_EXIT=1   Tests 2 failed | 29 passed (31)
       × A1 生产装载器读到 56 件边类型（棘轮…）        AssertionError: expected 56 to be 57
       × F1 56 件的 `$id` 均能映射到真实文件（无断裂）  AssertionError: expected 56 to be 57
     恢复：BASELINE_TOTAL 回 56；PORCELAIN_LINES=0
[B3] T-mut-B  VITEST_EXIT=1   Tests 2 failed | 29 passed (31)
       × A4b 🔴 第 3 类值必须显形…且**不**放宽豁免面    AssertionError: expected 8 to be 7
       × C4b 显式豁免面 = 6 值 ∪ {unknown}，且**恰为** 7 项（防悄悄放宽）  expected 8 to be 7
     恢复：EDGE_LAG_ALLOWED_SET 回原式；PORCELAIN_LINES=0
[B4] T-real   VITEST_EXIT=1   Tests 11 failed | 20 passed (31)
     TARGET=extensions/ontology/edge-types/assumption_triggered_reallocation.json
     BEFORE_BLOB=da649ae0ac147c633d52a78d43a54f934b97f2f9
     改后盘上：49 "unknown" / 2 "immediate" / 2 "3-6_months" / 1 "1_month" / 1 "1-3_months" / 1 散文
       × A2 派生降级计数 = 50（棘轮）                  AssertionError: expected 49 to be 50
       × A3 枚举内真值 = 5（棘轮）                      AssertionError: expected 6 to be 5
       × A4b / × A6 / × D3 / × E4                      expected 49 to be 50（各一）
       × B1 沙箱基线 degraded=4                        expected 3 to be 4
       × B2 / × B3 / × B4 / × B5                       （沙箱链连带）
     恢复：AFTER_BLOB=da649ae0ac147c633d52a78d43a54f934b97f2f9（**逐字相同**）；盘上回 50 "unknown"；PORCELAIN_LINES=0
[B5] T-neg    VITEST_EXIT=0   Tests 31 passed (31)
     NEG=同目录 assumption_triggered_reallocation.json，仅改 description ⇒ 全绿（红是特异的）
     恢复：AFTER_BLOB=da649ae0…（逐字相同）；PORCELAIN_LINES=0
[B6] 终检     PORCELAIN_LINES=0 / STASH_ENTRIES=0 / HEAD_UNCHANGED=429d8ebe…
     交付件 blob 与交付态逐字相同：OK tests/…-1134.test.ts / OK extensions/…/goal_decomposition.json
```

---

## c. 与交付声称的异同

| # | 实施员声称 | 我的实测 | 判 |
|---|---|---|---|
| 1 | tip `429d8ebe`；交付 commit `bfea3acf` | 远端 tip = `429d8ebe`；`bfea3acf` 在分支上 | **[一致]** |
| 2 | `31 passed / exit 0` | `VITEST_EXIT=0  Tests 31 passed (31)` | **[一致]** |
| 3 | `diff --stat origin/local-main -- extensions/ontology` 空输出 | 我用 **merge-base 口径**也得空输出（`BOUNDARY_EXT_EMPTY=YES`） | **[一致]** |
| 4 | `git grep action_effect_lag -- src packages` 无输出 | **COUNT=0** | **[一致]** |
| 5 | `claim_store.py --coverage` ⇒ 3/3 覆盖 | 该命令喂 `git diff --cached --name-only`，需 staged 状态；我**未复跑** | **[未覆盖]** |
| 6 | 变更集 4 件 | `FILES_TOTAL=4`（治理 3 + 计预算 1） | **[一致]** |
| 7 | 任务书「23 it / 94 expect」不实；实测 30（改前）/31；`grep -c expect` = 81 | 我独立实测：批 1 = **30 it / 81 expect**；交付 = **31 it / 87 expect** | **[一致]**（他的 81 指批 1） |
| 8 | 门禁手动跑同源脚本；默认态 2 组硬红、`SYNO_CLAIM_V2=1` 时 13 组全过 | **我未复跑 13 组**（未跑全量门禁） | **[未覆盖]** |
| 9 | 边界①：散文值原样留存、**只被点名**，不含值域迁移 | A4b 断言原样前缀 `'0d —'` 出现、且散文值**不在**豁免面内；**T-mut-B 证明「塞进豁免面换全绿」必红**（A4b/C4b，`expected 8 to be 7`） | **[一致]** |
| 10 | 边界②：`READ_SIDE_EMISSION='NOT_IMPLEMENTED'` 是**刻意棘轮** | D 组断言它；且我独立证实 **0 消费方** | **[一致]** |
| 11 | 边界③：审计穿生产入口 `loadOntology()`；子进程 + `chdir` + 动态 import；沙箱在 `os.tmpdir()`；**零真仓写入** | 我确认 B 组 5 条确实起子进程（~0.5-1s/条）；但「零真仓写入」的隔离细节我**未单独验证** | **[部分覆盖]** |
| 12 | 建议对抗①：放宽豁免面/吸收第 3 类值 ⇒ 应红 | **我做了 → 红**（A4b/C4b）。他用的是改分类逻辑（M1，9 failed），我用的是直接把值加进 `ALLOWED_SET`（2 failed）—— **手法不同、触发断言组不同，但都必红** | **[一致（方向）]** |
| 13 | 建议对抗②：棘轮改 1 个数 ⇒ 必红 | **我做了 → 红**（A1/F1，`expected 56 to be 57`） | **[一致]** |

### c-补（超出实施员声称的独立发现）
- 🔴 **基线漂移**：分支**落后 local-main 14 个提交**（`14 4`；merge-base 仍 = `e52499ddd`）；我取到的最新 local-main = `dc5ce093`。实施员**未提**这条。已做影响分析（见 §0.1）⇒ **不触本卡前提，但合并前必须 rebase**。
- ✅ **冻结判据零枚举感知**已由我独立证实（§b-2）⇒ 支持本卡立项前提，不是重复建设。

---

## d. 自验结论

### **自验结论：一致（可提请独立审计）**

**逐条对卡面 Done**
- **Done ④（我按协议选定的最高风险判据：R1 伪绿最高 / R2 后果最高 / R3 可证伪）** —— 三条真跑且**双向判据成立**：
  - 「读到 `unknown` ⇒ 必产 degraded 标记/具名审计行」：T-green 绿（A2/A5/A6 通过）；**T-real 把真仓一件 `unknown` 改掉 ⇒ A2 `expected 49 to be 50`、A6 具名审计行同步红**。
  - 「豁免面**恰为** 7 项」：C4b 断言 7；**T-mut-B 把它撑到 8 ⇒ 必红**。
  - 「`unknown` 计数**钉 50** 且漂移必红」：**T-real 造出 49 ⇒ 必红**；**T-mut-A 把棘轮改成 57 ⇒ 必红**。
  ⇒ **既非恒真也非恒假**：真读盘（T-real 证明计数来自盘）、且改坏必红、还原即回绿。
- **Done ①/②/③**：判据件 754 行 / 31 it / 87 expect，A–F 六组覆盖正常/降级/边界；交付内已含批 1→批 2 的棘轮上移与 A4b 补测（我逐行 diff 核过，方向 = 如实计入而非放宽）。
- **Done ⑤**：`PORCELAIN_LINES=0`／`STASH_ENTRIES=0`／交付件 blob 与交付态**逐字相同** ⇒ 红证不残留。
- **Done ⑥**：4 件（计预算 **1**）≤12、单域、无禁碰路径。

**我**没**验到的（诚实边界，勿放大）**
1. 🔴 **本卡只交「防线 / 审计侧」**。`READ_SIDE_EMISSION='NOT_IMPLEMENTED'` 是**刻意棘轮**，**不得**读成「读取侧已发射 degraded」。我独立证实前提为真（`src/`+`packages/` 命中 0）。
2. **全量门禁我未跑**（只单文件 vitest）；tsc / 全量 vitest / 13 组（含他声称的「默认态 2 组硬红、`SYNO_CLAIM_V2=1` 全过」）归 CTO 收件闸 + K3 终审，**那 13 组读数不是我的证据**。
3. **`claim_store.py --coverage` 我未复跑**（需 staged 状态）。
4. **边界③「零真仓写入」的子进程隔离细节我未单独验证**（只从「B 组 5 条 ~0.5-1s/条起子进程 + 结构」侧证）。
5. 🔴 **分支 `[behind 14]`**：merge-base 仍是 `e52499ddd`，而当前 local-main = `dc5ce093`（**我取到的那次**）。漂移**未触**本卡前提（ontology 0 / loader 0 / 文件重叠 0），但**合并前必须 rebase**（铁律 0-3）。

**归属声明**：本报告只给「自验结论」，**不是审计**；是否通过归 CTO 收件闸 + K3 终审。我未合并、未推送、未改任何产品文件（T-real/T-mut/T-neg 的改动**全部发生在我自己的克隆**，非实施员写集，且已原样恢复并自证）。

---

## e. 自我纠错（必须披露）
第一轮 Stage B 我打印的 `VITEST_EXIT` **全部为 0**，与「Tests 2 failed」自相矛盾。根因是**我 harness 的 bug**：
```bash
node_modules/.bin/vitest run "$T" > "$f" 2>&1
local ec        # ← 这一句本身是命令且成功，把 $? 冲成 0
ec=$?
```
已修为 `local ec; ec=0; cmd || ec=$?`，并**整轮重跑**（上表全部为重跑后的真值：T-mut-A/B/T-real = **exit 1**，T-green/T-neg = exit 0）。原始两轮输出均在 `verify\out\` 与 `verify\out-stageB{,2}-1134.txt` 留存可核。

---

## 附：我的重型验证运行记录（串行 ≤1）
| # | 时间(Asia/Shanghai) | 命令 | 真 exit | 重型 | 串行位 | 结果 |
|---|---|---|---|---|---|---|
| 1 | 23:2x | `vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts` ×5（T-green/mut-A/mut-B/real/neg，第一轮 exit code 记录有 bug） | — | 是 | 占用 | 判别性已成立，但 exit code 记录作废 |
| 2 | 23:3x | 同上 ×5（**修正后重跑**） | 0 / 1 / 1 / 1 / 0 | 是 | **已释放**（已向队长报） | 见 §b-4 |

## 附：我的取证脚本与产物（全部在仓库外）
- 协议：`.k4-b2-lead\VERIFY-PROTOCOL.md`
- 脚本：`.k4-b2-lead\verify\`（`v20-premises-1134.sh` `v23-frozen-gate.sh` `v24-fetch-1134.sh` `v25-drift.sh` `v26-k401-stageA.sh` `v27-k401-stageB.sh` `v29-clean2.sh`）
- 原始输出：`.k4-b2-lead\verify\out-stageA-1134.txt`、`out-stageB-1134.txt`、`out-stageB2-1134{,clean}.txt`、`out\1134-T-*.txt`
- 对照物：`/tmp/k4v-b1134-ref/`（批 1 原件：test 700 行 30 it 81 expect / evidence / claims）
