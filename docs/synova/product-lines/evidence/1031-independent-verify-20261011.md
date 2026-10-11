# K4-02 / #1031 · 独立复核报告（四项 a/b/c/d）
> 复核席：**verifier-k4**（独立成员，非实施员）｜出具：2026-10-11 23:4x
> 被测：分支 `fix/1031-ontology-param-bridge` @ **`ab3f2a553ed3dc15b499fe128fd7915847201618`**（队长钉）
> 基线：`merge-base = dc5ce093c37f6cf8ef069431b3192a390637f88d`（= 队长给的基线）
> 交付 commit：`db53d316`（`DB53D316_IS_ANCESTOR=YES`）
> 我的克隆：`D:\synova-wt-b2-verify`（唯一；**未在实施员任何工作树跑过一个命令**）

---

## 0. 取件与钉定
```
LSREMOTE_EXIT=0
TOTAL_REMOTE_HEADS=944
---- 命中行原文 ----
ab3f2a553ed3dc15b499fe128fd7915847201618	refs/heads/fix/1031-ontology-param-bridge
---- local-main 行 ----
dc5ce093c37f6cf8ef069431b3192a390637f88d	refs/heads/local-main
TOKEN_IN_OUTPUT=0
```
```
PIN_FULL=ab3f2a553ed3dc15b499fe128fd7915847201618   MATCH=YES
MERGE_BASE=dc5ce093…                                MERGE_BASE == dc5ce093? YES
rev-list --left-right --count origin/local-main...HEAD = 0	8      ⇒ 不落后
DB53D316_IS_ANCESTOR=YES
```
**变更集（merge-base 三点）= 6 件 / 1682 insertions**
```
A .claude/claims/1031.yaml                                     （治理）
A .claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md （治理）
A docs/synova/product-lines/evidence/1031-delivery.md          （治理）
A docs/synova/product-lines/evidence/1031-injection-contract.md（治理）
M src/l4/ontology-loader.ts                              +259   （计预算）
A tests/l4/ontology-loader-param-bridge-1031.test.ts      513   （计预算）
⇒ 计预算 2 件 ≤12，单域（本体参数桥）✓
```

---

## a. 我跑了什么命令（原始）

```bash
# —— 取件 / 钉定 / 基线 ——
git -c … ls-remote --heads "http://Synova:<TOKEN>@192.168.1.7:3000/…/SynovaAgent.git"
git -c … fetch --no-tags "$URL" "+refs/heads/fix/1031-ontology-param-bridge:refs/remotes/origin/…" \
                              "+refs/heads/local-main:refs/remotes/origin/local-main"
git -c … merge-base origin/local-main origin/fix/1031-ontology-param-bridge
git -c … rev-list --left-right --count origin/local-main...origin/fix/1031-ontology-param-bridge

# —— 🔴 红线 + 零碰 ——
git -c … rev-parse origin/local-main:src/loops/direction-monitor.ts ; git -c … rev-parse origin/<BR>:同件
git -c … diff origin/local-main origin/<BR> -- src/loops/direction-monitor.ts
git -c … log --oneline "$MB"..origin/<BR> -- <7 条路径>            # 逐件 COMMITS_TOUCHING
git -c … diff --name-only "$MB" origin/<BR> | grep -E "edge-types/|server\.ts$|loop-scheduler\.ts$|main-agent-binding\.ts$|engine-context\.ts$|direction-monitor\.ts$"

# —— 判据/账/棘轮/规模 ——
git -c … show origin/<BR>:tests/l4/ontology-loader-param-bridge-1031.test.ts | wc -l 等（规模计数）
git -c … grep -n "EDGE_PARAM_KEYS\|causal_strength" origin/<BR> -- src
grep -h '"action_effect_lag"' extensions/ontology/edge-types/*.json | sed 's/.*: //' | sort | uniq -c
grep -h '"transfer_function"' extensions/ontology/edge-types/*.json | sed 's/.*: //' | sort | uniq -c
（逐件核 causal_strength 缺键：for f in …; do grep -q '"causal_strength"' "$f" || echo ABSENT; done）
git -c … grep -n "readEdgeTypeParams\|getEdgeTypeParams\|applyEdgeTypeParams" origin/<BR> -- src tests scripts packages
git -c … diff --stat db53d316^ db53d316 -- src/l4/ontology-loader.ts          # 本轮（必须空）
git -c … diff --numstat origin/local-main...origin/<BR> -- src/l4/ontology-loader.ts   # 相对基线（应为 +259）

# —— Stage B：五连（全部在自建克隆内造红 + 原样恢复）——
node_modules/.bin/vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts        # T-green
python3 把 EDGE_PARAM_KEYS 摘掉 'causal_strength'（3→2）                                # T-red
python3 把 BASELINE_EDGE_TYPES 56 → 57                                                  # T-mut
python3 把真仓 assumption_triggered_reallocation.json 的 optionalProps.causal_strength 改成 0.5  # T-real
python3 往 extensions/frameworks/fts5-cjk-tokenizer.json 加 _k4v_neg_control 键          # T-neg
# 每次改后 git checkout -- 恢复并 hash-object 核逐字相同

# —— 并发清场（起跑前）——
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where CommandLine -match 'vitest|tsx'   ⇒ 空
```

---

## b. 原始输出

### b-1 🔴 红线④：CTO 明令剔除项是否被碰
```
src/loops/direction-monitor.ts
  LOCALMAIN_BLOB = 34fe81773d881f963d2eb654233e76721f8efe13
  DELIVERY_BLOB  = 34fe81773d881f963d2eb654233e76721f8efe13      BLOB_SAME=YES
  DIFF_EMPTY=YES
  COMMITS_TOUCHING(db53d316^..tip) = 0
  COMMITS_TOUCHING(MB..tip)        = 0
```
⇒ **逐字节相同，剔除项未被碰** ✓

### b-2 零碰核查（**我修正了队长给的两处路径**后逐件双核）
| 路径 | COMMITS_TOUCHING | IN_DIFF |
|---|---|---|
| `extensions/ontology/edge-types` | 0 | 0 |
| `src/server.ts` | 0 | 0 |
| `src/mvp-server.ts` | 0 | 0 |
| `src/loops/loop-scheduler.ts` | 0 | 0 |
| **`src/loops/main-agent-binding.ts`**（队长给的是 `src/main-agent-binding.ts`，实际在 `src/loops/` 下） | 0 | 0 |
| `src/init/engine-context.ts` | 0 | 0 |
| `src/loops/direction-monitor.ts` | 0 | 0 |

硬口径：整个变更集里带这些名的文件 = **0 件**。

### b-3 测试规模自测复核（声称 513 / 6 / 29 / 115）
```
LINES=513   DESCRIBE_COUNT=6   IT_COUNT=29   EXPECT_COUNT=115        ⇒ 与声称逐字相同
describe 组：V1 注入存在且可判 ／ V2 注入前 vs 注入后（乙案改落点：注入面断言）／ V3 降级可见
            ／ V5(L2-真跑) 真实 56 件过桥实测 ／ 零影响既有面（回归）／ 两笔账棘轮
```

### b-4 🔴 抽验①：判据②是否真落在**注入面**（不得是 DirectionMonitor 输出差异）
```
测试对 direction-monitor 的全部引用（共 4 处，**无一是行为断言**）：
  :14  注释「🔴 乙案降档声明：原判据②要求「DirectionMonitor 输出必须不同」，本卡改为「注入面 props 值必须不同」」
  :116 LEDGER.readFaceDirectionMonitor: 'NOT_DELIVERED'
  :483 断言 LEDGER 常量 == 'NOT_DELIVERED'
  :508-511 it('未交① 的边界：本桥不为 direction-monitor 读取面提供任何"已交"证据（防误读）')
            注释：「本文件不 import direction-monitor，也不断言其行为」
  import 面：仅 `from '../../src/l4/ontology-loader'` ⇒ **确未 import direction-monitor**
```
**V2 组断言对象 = `applyEdgeTypeParams(...).props`（注入面）**，且带三重混淆控制：
- 差值只来自参数：非参数键逐个不变；`added.sort()` 恰 = `['causal_strength','transfer_function']`
- 差值不来自时钟/顺序：纯函数、两次调用逐字节相等、入参 `props` 未被改
- 同一 weight / 同一 edgeType ⇒ **唯一变量是「是否注入」**（`Object.keys(after).length === 4`）
⇒ **判据②真落在注入面** ✓

### b-5 🔴 抽验②：两笔账机器可判
```
LEDGER（测试 :110-120，机器可判常量）
  已交 3：injectionContract / implementation / criteriaFile = DELIVERED
  未交 4：readFaceDirectionMonitor / productionVisibleEffect
          / causalStrengthNumericInjection / scriptSchemaGate = NOT_DELIVERED
          （第 4 项标注「📌实施席实测补记」——与队长口径一致）
未交③ 的机器可判证据：it('未交③ 的机器可判证据：**真仓** `cs_resolved === 0`')
  expect(resolved).toBe(0) ; expect(resolved).toBe(BASELINE_TALLY.cs_resolved)
  ⇒ 我在 T-real 里**把它打红验证过**（见 b-7）
EDGE_PARAM_KEYS（loader :191）= ['transfer_function','causal_strength','action_effect_lag']
```

### b-6 棘轮新事实（全部有盘上原始输出支撑）
```
EDGE_TYPES_FILES_ON_DISK = 56
action_effect_lag 逐值：50 "unknown" / 2 "3-6_months" / 1 "immediate" / 1 "1_month" / 1 "1-3_months" / 1 散文
transfer_function 逐值：52 "TBD — to be defined in compute phase" / 3 散文公式 / 1 "N/A — 结构性从属边…"
causal_strength 缺键：全仓**仅 1 件** = extensions/ontology/edge-types/goal_decomposition.json
```
⇒ `BASELINE_TALLY` 逐项核对：`cs_other=1` ✓｜`lag_resolved=56` ✓｜`tf_resolved=0` ✓｜`tf_prose=3` ✓｜`cs_resolved=0` ✓｜`cs_declaration=55` ✓
**`tf_placeholder=53` 的口径我追到底**：我一开只数到 52 处 `TBD —`，疑为不符；读 loader 第 239 行
`PLACEHOLDER_RE = /\b(tbd|to be defined|todo|pending|n\/a)\b/i` ⇒ `goal_decomposition` 的 `"N/A — …"` **也落 `placeholder`**，**52 + 1 = 53 成立**（测试注释已写明该口径）⇒ 不是数字对不上，是分类口径。

### b-7 Stage B 五连判别性（真值 exit code）
```
[B0] 基线 HEAD=ab3f2a55…  PORCELAIN_LINES=0

[B1] T-green  VITEST_EXIT=0   Test Files 1 passed (1)   Tests 29 passed (29)   803ms

[B2] T-red    VITEST_EXIT=1   12 failed | 17 passed
       （突变：EDGE_PARAM_KEYS 摘掉 'causal_strength'，3 → 2）
       × 已交② 的机器可判证据：读取面含 causal_strength
         AssertionError: expected [ 'transfer_function', …(1) ] to include 'causal_strength'
       × 另 11 条：params 恒 3 条 / 注入前无键 vs 注入后有值 / 陈旧值 vs 类型层真值 /
         差值只来自参数 / 唯一变量是注入 / absent 三态 / declaration_only / 棘轮 56 件 /
         第 56 件点名 / CONSTRAINS 三字段各归其位 / 读取面三键齐备
       例：AssertionError: expected [ …(2) ] to have a length of 3 but got 2
           AssertionError: expected undefined to be 0.73
     恢复 RESTORE_EXIT=0  BLOB[src/l4/ontology-loader.ts]=91b44093f84962f46ec22158fc2c8b32dc6eab0c

[B3] T-mut    VITEST_EXIT=1   1 failed | 28 passed
       （突变：BASELINE_EDGE_TYPES 56 → 57）
       × 56 件全部过桥；分类计数与 as_of local-main=dc5ce093 逐件实测一致（棘轮）
         AssertionError: expected [ { …(11) }, …(55) ] to have a length of 57 but got 56
     恢复 RESTORE_EXIT=0  BLOB[tests/…-1031.test.ts]=33d0387b62d394d8fd6fefb65c01100e25f00f0a

[B4] T-real   VITEST_EXIT=1   2 failed | 27 passed
     TARGET=extensions/ontology/edge-types/assumption_triggered_reallocation.json
     BEFORE_BLOB=da649ae0ac147c633d52a78d43a54f934b97f2f9
     突变：optionalProps.causal_strength 由声明串 → **数值 0.5**（真仓件，我克隆内）
       × 未交③ 的机器可判证据：**真仓** `cs_resolved === 0`
         AssertionError: expected 1 to be +0        ← ★ 决定性：真读盘
       × 56 件全部过桥…棘轮（tally 逐件比对）
     恢复 RESTORE_EXIT=0  AFTER_BLOB=da649ae0ac147c633d52a78d43a54f934b97f2f9（**逐字相同**）

[B5] T-neg    VITEST_EXIT=0   Tests 29 passed (29)
       （无关目录 extensions/frameworks/fts5-cjk-tokenizer.json 加键 ⇒ 仍全绿 ⇒ 红是特异的）
     恢复 RESTORE_EXIT=0  BLOB=e242cd6568c009c528df3e1d02c171fab03ee313（逐字相同）

[B6] 终检
     PORCELAIN_LINES=0 / STASH_ENTRIES=0 / HEAD_UNCHANGED=ab3f2a55…
     被改 4 件 blob 与交付态逐字相同：OK ×4
     EDGE_TYPES_FILES=56 / CAUSAL_STRENGTH_VALUE_NUMERIC_COUNT=0（计数回位）
```

### b-8 独立核「无生产调用方」（LEDGER 的 `productionVisibleEffect=NOT_DELIVERED`）
```
readEdgeTypeParams / getEdgeTypeParams / applyEdgeTypeParams 在 src/ 的命中：
  仅 src/l4/ontology-loader.ts（定义 + 内部互调 :375 :393）
  除定义文件外：NO_PRODUCTION_CALLER
全仓 import 面：仅 tests/l4/ontology-loader-param-bridge-1031.test.ts
```
⇒ 声明属实：**桥是纯库能力，今天无生产调用方**。

### b-9 token 0 处（**含一次我自己的假警报更正**）
```
❌ 我第一次写成：grep -rIl -F -- --exclude-dir=node_modules "$TOK" .
   ⇒ `--` 之后 `--exclude-dir=node_modules` 被当成**搜索模式**，报出 9 处"命中"
✅ 改对参数后：
   克隆工作树（排除 node_modules/.git）：HITS=0
   .git 目录：HITS=0
   我的划记区（仓库外）：HITS=0
   那 9 个文件只是正文含字符串 "--exclude-dir=node_modules" 的既有文档/脚本
   origin URL：http://192.168.1.7:3000/synova-agent/SynovaAgent.git（无 userinfo）
```
⇒ **token 0 处成立。**

---

## c. 与声称的异同

| # | 声称（队长口径 / 实施席） | 我的实测 | 判 |
|---|---|---|---|
| 1 | 钉定 `ab3f2a55`／交付 commit `db53d316`／基线 `dc5ce093` | 全部相符；`0 8` 不落后；`db53d316` 是祖先 | **[一致]** |
| 2 | **口径①** `ontology-loader.ts` 本轮零改动（`db53d316^..db53d316` 空）**≠** 相对基线零差异（vs local-main = +259） | `THIS_ROUND_EMPTY=YES`；`VS_BASELINE_LINES_ADDED=259`（全部来自 `ca9d826c`） | **[一致]** |
| 3 | **口径②** 未交 4 项（含实测补记的脚本级 schema 门禁）须机器可判（`LEDGER` + 真仓 `cs_resolved===0`） | `LEDGER` 3 已交 + **4** 未交；`cs_resolved===0` 为真仓断言，我在 T-real 打红验证 | **[一致]** |
| 4 | **口径③** 第 56 件 `goal_decomposition.json` 的 `causal_strength` 缺键（全仓唯一 absent） | 逐件核：**全仓缺键件数 = 1**，就是该件 | **[一致]** |
| 5 | 测试规模 513 行 / 6 describe / 29 it / 115 expect | 逐项相同 | **[一致]** |
| 6 | 棘轮新事实 56 件 / tf_placeholder 53 / cs_other 1 / lag_resolved 56 | 56 ✓；cs_other 1 ✓；lag_resolved 56 ✓；tf_placeholder **53 = 52×`TBD —` + 1×`N/A —`**（`PLACEHOLDER_RE` 含 `n\/a`）⇒ 成立 | **[一致]** |
| 7 | 红线 `direction-monitor.ts` 未碰 | blob 双侧 `34fe8177…`、diff 空、0 提交 | **[一致]** |
| 8 | 零碰 `edge-types / server.ts / loop-scheduler.ts / main-agent-binding.ts / engine-context.ts` | 全部 0/0（**两处路径我做了修正**：`main-agent-binding.ts` 实际在 `src/loops/` 下） | **[一致]** |
| 9 | 判据②改落点 = **注入面**断言（不是 DirectionMonitor 输出差异） | 测试不 import direction-monitor；断言对象是 `applyEdgeTypeParams(...).props`，带三重混淆控制 | **[一致]** |
| 10 | `productionVisibleEffect: NOT_DELIVERED`（无生产调用方） | 我独立核：三面符号在 `src/` 中除定义文件外 **0 调用方** | **[一致]** |

**未覆盖（诚实标注）**：实施席证据件里的**过程性读数**（其自跑 vitest 原始输出、tsc、门禁配置、D708 等）我**未逐条复跑**，不作为我的证据；我**未跑全量门禁**。

---

## d. 自验结论

### **自验结论：一致（可提请独立审计）**

**四条最高风险判据（开工前写死在 `task-9`，未事后调整）**
1. **判据②真落在注入面** —— 通过。测试不 import direction-monitor，断言对象是 `applyEdgeTypeParams(...).props`，且用「差值只来自参数／不来自时钟顺序／唯一变量是注入」三重控制隔离混淆。
2. **两笔账机器可判** —— 通过。`LEDGER` 3 已交 + 4 未交为常量；未交③ 由**真仓** `cs_resolved === 0` 承载，我在 T-real 里把它打红（`expected 1 to be +0`）证明该断言有分辨力。
3. **造红：摘掉 `EDGE_PARAM_KEYS` 的 `causal_strength`** —— 通过。12 条用例连红，含「已交② 的机器可判证据」本身。
4. 🔴 **红线：`src/loops/direction-monitor.ts` 逐字节相同** —— 通过。blob 双侧 `34fe8177…`、diff 空、两段区间 0 提交。

**判别性成色**：T-real 改真仓一件 `causal_strength` 声明串→数值 ⇒ `cs_resolved` 0→1 ⇒ **「真仓零数值」断言当场红** ⇒ 证明该断言**真读盘**、未交③ 的机器可判性成立；恢复后 blob 逐字相同、`CAUSAL_STRENGTH_VALUE_NUMERIC_COUNT=0`。T-neg（无关目录加键仍全绿）证明红是特异的。**既非恒真也非恒假。**

**红证不残留**：`PORCELAIN_LINES=0` / `STASH_ENTRIES=0` / `HEAD=ab3f2a55…` 未变 / 被改 4 件 blob 与交付态**逐字相同** / edge-types 计数回位 56。

**授权边界落实**：造红**只在我自己的克隆** `D:\synova-wt-b2-verify`；全部**原样恢复并自证干净**；**未 push** ⇒ 改的是我的克隆，非实施员写集。

### 边界（勿放大）
- 🔴 **本桥是纯库能力，今天无生产调用方**（我独立核：`src/` 除定义文件外 0 调用方）。这与卡面「本卡【不要求】本卡内出现生产可见效果」一致 ⇒ **不得**读成「本体参数已注入生产实例」。
- 🔴 **未交③ 是真实的**：真仓 `cs_resolved === 0`（55 声明串 + 1 缺键）⇒ 今天**没有任何数值可注入**；真值标定属另卡。
- 我**未跑全量门禁**（只单文件 vitest 29 用例）；tsc / 全量 / 13 组归 CTO 收件闸 + K3 终审。
- 本报告只给「自验结论」，**不是审计**；是否通过归 CTO 收件闸 + K3 终审。我未合并、未推送、未改任何产品文件。

---

## e. 方法学注记（我自己踩到并纠正的两点）
1. **token 扫描参数写错 ⇒ 报出 9 处假"泄漏"**：`grep -F -- --exclude-dir=node_modules "$TOK"` 里 `--` 把选项变成模式。改对后 0/0/0。**若直接上报"发现 9 处 token 泄漏"就是假结论。**
2. **`tf_placeholder` 我一度数成 52（声称 53）**：没有直接判"数字不符"，而是回去读 loader 的分类实现（`PLACEHOLDER_RE` 含 `n\/a`），确认 `"N/A — …"` 同落 `placeholder` ⇒ 52+1=53。**差异是分类口径，不是数据不符。**
3. 另修正队长给的零碰名单中 **两处路径**（`src/main-agent-binding.ts` → 实际 `src/loops/main-agent-binding.ts`；`src/routes/server.ts` 不存在 → 实际 `src/server.ts` / `src/mvp-server.ts`），补全后才做双核。

---

## 附：重型验证运行记录（串行 ≤1）
| # | 时间(Asia/Shanghai) | 命令 | 真 exit | 重型 | 串行位 | 结果 |
|---|---|---|---|---|---|---|
| 1 | 23:4x | `vitest run tests/l4/ontology-loader-param-bridge-1031.test.ts` ×6（T-green / red / mut / real / neg，含终检复跑） | 0 / 1 / 1 / 1 / 0 | 是 | 队长放行占用 → **已释放** | 29 passed 基线；三条突变各自必红；终检干净 |

## 附：取证脚本与产物（全部在仓库外）
- 协议：`.k4-b2-lead\VERIFY-PROTOCOL.md`
- 脚本：`.k4-b2-lead\verify\`（`v40-fetch-1031.sh` `v41-token-check.sh` `v42-1031-deep.sh` `v43-1031-zero.sh` `v44-1031-stageB.sh` `v45-clean4.sh` `v46-1031-callers.sh`）
- 原始输出：`.k4-b2-lead\verify\out-1031-readonly.txt`、`out-1031-deep.txt`、`out-1031-zero.txt`、`out-stageB-1031{,clean}.txt`、`out\1031-T-*.txt`
