# K4-03 / #1057 · 独立复核报告（四项 a/b/c/d）
> 复核席：**verifier-k4**（独立成员，非实施员）｜出具：2026-10-11 23:1x
> 被测：分支 `fix/1057-activity-instance-props` @ **`cc3ad9fcc70b345c3d890f789beb07091c0cb9a3`**（队长钉）
> 基线：`origin/local-main = e52499ddd6a1320435abd44f24323b5865d4caa1`
> 我的克隆：`D:\synova-wt-b2-verify`（唯一；**未在实施员任何工作树跑过一个命令**）

---

## 0. 取件与 SHA 钉定（先证我测的是它）
**远端回执（M6 要求）**
```
LSREMOTE_EXIT=0
TOTAL_REMOTE_HEADS=937
---- 命中行原文 ----
cc3ad9fcc70b345c3d890f789beb07091c0cb9a3	refs/heads/fix/1057-activity-instance-props
---- local-main 行 ----
e52499ddd6a1320435abd44f24323b5865d4caa1	refs/heads/local-main
TOKEN_IN_OUTPUT=0
```
**落到我克隆后自证**
```
CHECKOUT_EXIT=0
MY_HEAD=cc3ad9fcc70b345c3d890f789beb07091c0cb9a3
SHA_MATCH=YES
E0641824_IS_ANCESTOR=YES     （实施员称的交付 commit，确在本分支线上）
CC3AD9FC_IS_ANCESTOR=YES
```
> 三点一致：实施员报 tip `5cc44ec4` → 远端 tip `cc3ad9fc`（其子提交）→ 队长钉的就是 `cc3ad9fc`；交付 commit `e0641824` 是同一条线上的祖先。**我测的是队长钉的那一个。**

---

## a. 我跑了什么命令（原始）

```bash
# —— 取件 / 钉 SHA ——
git -c credential.helper= -c safe.directory=* ls-remote --heads "http://Synova:<TOKEN>@192.168.1.7:3000/synova-agent/SynovaAgent.git"
git -c credential.helper= -c safe.directory=* fetch --no-tags "$URL" "+refs/heads/fix/1057-activity-instance-props:refs/remotes/origin/fix/1057-activity-instance-props"
git -c credential.helper= -c safe.directory=* checkout -B verify-k4-03 cc3ad9fcc70b345c3d890f789beb07091c0cb9a3

# —— 结构面（v10-stageA.sh）——
git diff --name-status --find-renames origin/local-main...HEAD
git diff origin/local-main -- extensions/ontology/activity
git rev-parse origin/local-main:extensions/ontology/activity/<8 件>.json   # 逐件 blob hash 对照
git cat-file -e HEAD:tests/l4/activity-instance-1057.test.ts               # 旧件存在性
git ls-tree -r --name-only HEAD -- <4 个落点>

# —— 判别性四连（v11-stageB.sh，全部在自建克隆内造红/恢复）——
node_modules/.bin/tsx scripts/control-tower/probe-ontology-instances.ts          # T-green
mv extensions/ontology/extensions /tmp/k4v-quarantine/extensions-bak
node_modules/.bin/tsx scripts/control-tower/probe-ontology-instances.ts          # T-red
mv /tmp/k4v-quarantine/extensions-bak extensions/ontology/extensions             # 恢复
python3 就地改 customer-config/ontology-instances/wani-baby/activity-production.json
node_modules/.bin/tsx scripts/control-tower/probe-ontology-instances.ts          # T-mut-1
git checkout -- customer-config/ontology-instances/wani-baby/activity-production.json
python3 就地改 extensions/ontology/extensions/general-enterprise/activity.json
node_modules/.bin/tsx scripts/control-tower/probe-ontology-instances.ts          # T-mut-2
git checkout -- extensions/ontology/extensions/general-enterprise/activity.json
mv extensions/ontology/resource /tmp/k4v-quarantine/resource-bak
node_modules/.bin/tsx scripts/control-tower/probe-ontology-instances.ts          # T-neg
mv /tmp/k4v-quarantine/resource-bak extensions/ontology/resource

# —— 判据件重型（v12-stageC.sh）——
node_modules/.bin/vitest run tests/ontology/instance-loading.test.ts

# —— 收尾（v13-final.sh / v14-fix.sh）——
git status --porcelain ; git stash list ; sha256sum /tmp/k4v-b1057-ref/instance-batch1.json
```

---

## b. 原始输出

### b-1 结构面（必查清单全项）

| 检查 | 原始读数 | 判 |
|---|---|---|
| 变更文件数（含治理产物） | `7 files changed, 1809 insertions(+)`，7 行全 `A` | — |
| **PR 预算（≤12）** | `FILES_TOTAL=7  FILES_IN_BUDGET=4  LIMIT=12` | ✅ |
| **单域** | `ALL_IN_DECLARED_LANDINGS=YES`；`NO_FORBIDDEN_PATH=YES` | ✅ |
| 计预算 4 件 | `customer-config/ontology-instances/wani-baby/activity-production.json`／`extensions/ontology/extensions/general-enterprise/activity.json`／`scripts/control-tower/probe-ontology-instances.ts`／`tests/ontology/instance-loading.test.ts` | ✅ |
| 治理产物 3 件（不计预算） | `.claude/claims/1057.yaml`／`.claude/task-briefs/2026-10-09-1057-activity-instance-props.md`／`docs/synova/product-lines/evidence/1057-activity-instance-props.md` | ✅ |
| **8 个 activity json 回退原样** | `git diff origin/local-main -- extensions/ontology/activity` ⇒ **空输出**；逐件 `SAME acquisition/compliance/coordination/governance/innovation/learning/maintenance/production` | ✅ |
| **旧件已删** | `ABSENT(符合) extensions/ontology/activity/instances/activity-production-wani-baby-001.json`／`ABSENT(符合) tests/l4/activity-instance-1057.test.ts` | ✅ |
| 4 落点存在 | `COUNT[customer-config/ontology-instances]=1`、`COUNT[extensions/ontology/extensions]=1`、`COUNT[probe]=1`、`COUNT[tests/ontology/instance-loading.test.ts]=1` | ✅ |
| **token 0 处** | `HITS_IN_GITDIR=0`／`HITS_IN_WORKTREE=0`（取件后复扫仍 0） | ✅ |
| 判据件非空壳 | 412 行／`EXPECT_COUNT_IN_TEST=68`／`IT_OR_TEST_COUNT=25` | ✅ |
| 新测试会被门禁执行 | `vitest.config.ts:28 include: ['./tests/**/*.test.ts', …]` ⇒ `tests/ontology/` 在扫描面内 | ✅ |

### b-2 判别性四连（**本卡最高风险判据：Done ②**，升级为可归因三连 + 负对照）

**T-green（不改任何东西 ⇒ 必须 exit 0）**
```
SUMMARY: sections=4 failures=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
<<< PROBE_EXIT=0
```

**T-red（物理移走扩展层 ⇒ 必须 exit 1，且失败行点名被移路径）**
```
AFTER_MOVE_STILL_THERE=NO(已移走)
SUMMARY: sections=4 failures=29
FAILURES:
  - 扩展面: extensions/ontology/extensions/ 零件（或目录不存在）—— 卡面 Done ② 的反例点（删掉扩展层 ⇒ 本段必红）
  - activity/acquisition: 扩展层缺评估属性 [headcount, hours_per_run, runs_per_period, unit_labor_cost, error_rate, structuredness, error_tolerance, data_reachability, agent_readiness_score, agent_type_recommendation]
  …（另 7 个类目同型 + 10 条 LOAD 无归属 + 10 条未被覆盖）…
RESULT=FAIL
<<< PROBE_EXIT=1
```
⇒ **红是可归因的**：首条失败行逐字点名 `extensions/ontology/extensions/`，不是栈崩/ENOENT 冒烟。

**恢复后复跑（必须回到绿）**
```
SUMMARY: sections=4 failures=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
<<< PROBE_EXIT=0
```

**T-mut-1（改盘上被断言的值：实例 `agent_readiness_score` 0.45 → 0.46 ⇒ 必红）**
```
断言值: … agent_readiness_score=0.46 …
[FAIL] LOAD: customer-config/ontology-instances/wani-baby/activity-production.json: 属性 'agent_readiness_score' 实参 0.46 ≠ 冻结值 0.45
SUMMARY: sections=4 failures=1
<<< PROBE_EXIT=1
```
⇒ **证明断言值来自盘上真件，不是探针里的常量**（若探针不读盘，此处不会变红）。

**T-mut-2（改扩展层声明类型：`headcount` number → string ⇒ 必红）**
```
[FAIL] activity/acquisition: 扩展层类型口径不符 [headcount:string≠number]      …（8 类目同型）…
[FAIL] LOAD: …: 扩展声明 'headcount' 类型 string ≠ 冻结口径 number
SUMMARY: sections=4 failures=9
<<< PROBE_EXIT=1
```

**T-neg（移走探针不该依赖的无关目录 `extensions/ontology/resource` ⇒ 必须仍 exit 0）**
```
SUMMARY: sections=4 failures=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
<<< PROBE_EXIT=0
```
⇒ **红是特异的**：探针不是「任何目录缺失就红」。

**红证不残留终检**
```
PORCELAIN_LINES=0
STASH_ENTRIES=0
QUARANTINE_LEFTOVERS=0
UNTRACKED_UNDER_CUSTOMER_CONFIG=0
```

### b-3 Done ① 的**强形式**：真·无 DB 环境
```
DATA_SYNOVA_DB_ON_DISK=NO
TRACKED_SYNOVA_DB=0
（`data/` 在 `.gitignore:3`；我的克隆是从远端新克隆的干净树）
---- 在该状态下复跑探针 ----
PROBE_EXIT=0
RESULT=OK: 四段全绿（SCHEMA / EXTENSION / INSTANCE / LOAD）
```
⇒ 不是「模拟没有库」，是**我这个克隆里根本没有 `data/synova.db`**，探针照样 exit 0。

### b-4 判据件重型（全队串行位，我申请后放行）
```
>>> node_modules/.bin/vitest run tests/ontology/instance-loading.test.ts
 ✓ tests/ontology/instance-loading.test.ts (25 tests) 544ms
 Test Files  1 passed (1)
      Tests  25 passed (25)
   Duration  1.28s
<<< VITEST_EXIT=0
跑后：PORCELAIN_LINES=0
```
判据件结构（我读源确认）：`正常路径-隔离fixture` 3 条／`正常路径-仓内真件` 5 条／`判别性夹具-改坏即红` 5 条／`降级路径` 3 条／`边界` 9 条 = 25。夹具落 `mkdtempSync(os.tmpdir())`，`afterAll` 清理。

### b-5 实例件「内容复用」独立核（我自持批 1 原件做对照物）
```
批 1 原件 sha256 = 9c9aa30a629a91a875f390198afca950ba09e1674f5011ae30bcb3105a8f292e
交付件   sha256 = ab4047ebcc359ed31b9943378ff5d7efa2990b15ab4facc4dc8bf596912e5955

props 逐键比对（15 键）：keys_equal: True，15/15 SAME（含 10 个评估属性值逐字相等）
_semantics  : SAME       _provenance : SAME
$schema / type / graph / instanceVersion / name / sourceRef : SAME
_notes      : 批 1 = 3 行 → 交付 = 5 行；diff_indexes = [2]
  NOTE[2] 批 1  : 本文件放 instances/ 子目录而非 activity/ 平铺层 —— loader 的 scanDir 平铺扫描不递归，实例不会被加载成第 9 个节点类型。
  NOTE[2] 交付 : 落点（K4-03 搬家后）: customer-config/ontology-instances/wani-baby/activity-production.json —— 命名规则 <orgId>/<node-type>.json；orgId = doc.graph = wani-baby。
```

---

## c. 与交付声称的异同

| # | 实施员声称 | 我的实测 | 判 |
|---|---|---|---|
| 1 | 分支 tip `5cc44ec4`；交付 commit `e0641824` | 远端 tip `cc3ad9fc`（`5cc44ec4` 的子），`E0641824_IS_ANCESTOR=YES` | **[一致]**（队长钉 `cc3ad9fc`；被测件即此） |
| 2 | `RESULT=OK, exit 0` | `RESULT=OK … PROBE_EXIT=0` | **[一致]** |
| 3 | `25 passed, exit 0` | `Tests 25 passed (25) … VITEST_EXIT=0` | **[一致]** |
| 4 | `git diff --stat origin/local-main -- extensions/ontology/activity` 空输出 | 空输出 + 8/8 blob hash `SAME` | **[一致]** |
| 5 | `diff --name-status` = 7 行 `A` | 7 行全 `A`；计预算 4 件 ≤12；单域 | **[一致]** |
| 6 | LIMIT #1：`src/l4/ontology-loader.ts:80-97` 不扫新落点 | 我读源独立确认：`ENTITY_DIRS=['resource','activity','outcome']`（:80-84）+ `extensions/ontology/edge-types`（:85）+ `extensions/industries/*/edge-types`（:89-97）；**无** `extensions/ontology/extensions/**`、**无** `customer-config/**` | **[一致]** |
| 7 | 「实例件 `_notes` 有**两行**落点注记是改写过的（其余逐字复用批 1）」 | `props`/`_provenance`/`_semantics`/标识字段 **逐字 SAME**；`_notes` 3→5 行，即 **1 行改写 + 2 行新增** | **[措辞部分不一致]**（实质无差；建议表述为「1 行改写 + 2 行新增」） |
| 8 | 旧判据件里依赖 `data/synova.db` 的段落已撤除 | 新判据件/探针在全仓**无该库**的干净克隆上 exit 0；探针源对该串的两次出现均为注释 | **[一致]** |
| 9 | 「首次改目录名造红是假红（`axisId ≠ 目录名`），已重做为移除扩展件 ⇒ 29 failures」 | 我**独立复现了他的最终反例**：移除扩展层 ⇒ `failures=29 / exit 1`，与他的读数逐字相同。对他自述的「首次假红」过程我**无法取证**（那是他的过程史） | **[一致（终态）]／[未覆盖（过程史）]** |
| 10 | 建议我对抗验证①「扩展层缺失但探针仍 exit 0（如声明藏 Schema 层）」 | 我做了「删扩展层 ⇒ exit 1」（T-red，可归因）；判据件 `:383` 有「Schema 层回潮 ⇒ violation」用例。但**我未单独构造「10 属性写回 Schema optionalProps」的完整对抗路径** | **[部分覆盖]**（我未造这条红） |
| 11 | 建议我对抗验证②「fixture 断言是否恒真」 | 判据件 `:40-45` 确实 import 探针的**同一批** `validateInstance/extensionPropsFor/load*Layer`（非两条码）；「判别性夹具」5 条在 fixture 上造红。**注意**：fixture 的扩展声明由 `EVAL_PROPS` 派生 ⇒ fixture 组本身不能证明真件，真件归属靠「仓内真件」组 + **我的 T-mut** | **[一致，附边界说明]** |

### c-补（超出实施员声称的独立发现）
**落点级冲突（我已单独报文，队长已复核确认机制）**：卡面冻结落点 `customer-config/ontology-instances/<orgId>/…` 会被既有 D599 客户配置包发现逻辑当成一个 **orgId**，产生永久假 broken。这**不是实施员的问题**（落点 CTO 冻结、他按卡执行），也**不影响本报告四项结论**；归 CTO 裁。

---

## d. 自验结论

### **自验结论：一致（可提请独立审计）**

**理由（逐条对卡面 Done）**
- **Done ①** 探针 ⇒ `PROBE_EXIT=0`，且在我这个**从远端新克隆、盘上无 `data/synova.db`（`ON_DISK=NO`／`TRACKED_SYNOVA_DB=0`）**的干净树上跑通 ⇒ 「不依赖 data/synova.db」成立（强形式）。✅
- **Done ②** 删掉扩展层 ⇒ `PROBE_EXIT=1`／`failures=29`，且首条失败行**点名** `extensions/ontology/extensions/`（可归因）；恢复后回绿；负对照（移走无关目录）仍 `exit 0`（红是特异的）；值突变（0.45→0.46）与类型突变（number→string）各自变红 ⇒ **既非恒真也非恒假**。✅
- **Done ③** 判据件 412 行 / 68 `expect` / 25 用例，隔离 fixture（`os.tmpdir()` + `afterAll` 清理）复现，且含「仓内真件」组读交付真件；`vitest run` ⇒ `25 passed (25)`，`VITEST_EXIT=0`。✅

**我**没**验到的（诚实边界，勿放大）**
1. **探针绿 ≠ 生产已消费新落点**。我独立读源确认 `src/l4/ontology-loader.ts:80-97` **不扫** `extensions/ontology/extensions/**` 与 `customer-config/**` ⇒ 本交付是 **L1 真读盘 + 自洽**，生产接线不在本卡写集，属遗留项。**任何人不得把本报告读成「本体层已能装数据」**。
2. **全量门禁我未跑**（只跑单文件 vitest，1.28s）。tsc／全量 vitest／13 组由 CTO 收件闸与 K3 终审阶段定夺。
3. **未覆盖**：上述 c-表第 9（过程史）、第 10（Schema 层回潮对抗路径我未造红）。
4. **红证不残留**已自证：`PORCELAIN_LINES=0 / STASH_ENTRIES=0 / QUARANTINE_LEFTOVERS=0`，`HEAD=cc3ad9fc…` 未变。
5. **落点级冲突待 CTO 裁**（见 c-补）；**不影响本四项自验结论**。
6. 观察（非缺陷归因）：本机 `/tmp/synova-1057-k4-03-89la2G` 存在一条 **22:47:57** 的 fixture 残留，**早于**我 23:10 的运行；我的运行前后该计数均为 1（我的夹具已 `afterAll` 清掉）。建议实施员侧自查一次。

**归属声明**：本报告只给「自验结论」，**不是审计**；是否通过归 CTO 收件闸 + K3 终审。我未合并、未推送、未改任何产品文件。

---

## 附：我的重型验证运行记录（串行 ≤1）
| # | 时间(Asia/Shanghai) | 命令 | exit | 重型 | 串行位 | 结果 |
|---|---|---|---|---|---|---|
| 1 | 2026-10-11 23:10 | `node_modules/.bin/vitest run tests/ontology/instance-loading.test.ts` | 0 | 是 | 申请（lead 放行「全队无重型在跑」）→ 已释放 | 25 passed / 1.28s |
| — | 同日 22:5x–23:1x | `tsx probe-ontology-instances.ts` × 7 次（四连复跑） | 0/1 交替 | 否（秒级） | 不需 | 见 b-2 |

## 附：我的取证脚本与产物（均在仓库外）
- 协议：`D:\novis-backup-20260526\Novis\.k4-b2-lead\VERIFY-PROTOCOL.md`
- 脚本：同目录 `verify\`（`v0-env.sh` `v1-baseline.sh` `v9-fetch-delivery.sh` `v10-stageA.sh` `v11-stageB.sh` `v12-stageC.sh` `v13-final.sh` `v14-fix.sh` `phantom-probe.ts`）
- 对照物：`/tmp/k4v-b1057-ref/`（批 1 原件，供内容复用比对）
