# VERIFY-980-plan · 独立自验报告（verifier-980）

> **性质**：独立只读复算。**本件不给「通过 / 不通过」判定**，只给三类产出：`自验结论`（观察到的事实）+ `原始证据`（命令原文 + 退出码 + 输出）+ `未解决项`。通过与否归 CTO 收件闸 + K3 终审。
> **自验员**：verifier-980（与编码分离，本件未写任何产品代码、未 commit、未 push）
> **复算窗口**：2026-10-07T17:29Z → 2026-10-07T17:39Z（UTC），**现查现报，未抄队长结论**
> **工作树**：`D:\novis-backup-20260526\Novis\.synova-wt-980`（`HEAD = 2f3044dc3`，分支 `feat/win-0-6-schema-degraded`）
> **真值口径**：一律 `git show / git grep / git rev-parse origin/main`；不读工作树当权威
> **只读披露**：本件除本报告文件外，未在工作树内新建 / 修改 / 删除任何文件（见 §5）

---

## 0. 被测件与「移动靶」声明（先看这条）

| 件 | 我在工作树实测的 blob | 行数 | 落点状态 |
|---|---|---|---|
| `PLAN-980-0-6-schema-degraded.md`（**已提交版** @HEAD 2f3044dc3） | `f61ade17dd0854ecc08cda8cb407709a2e43e8d0` | 252 | 已提交 |
| `PLAN-980-0-6-schema-degraded.md`（**工作树版**，我复算时的实际内容） | `ab5b9e6dec42a93747cef62f1e9cdf01e5b71853` | **262** | **未提交（` M`）** |
| `evidence-980-plan-preconditions.txt` | — | 98 | 已提交 |
| `capture-980-preconditions.sh` | — | 75 | 已提交 |
| `RECEIPT-980-plan-20261008.md` | — | 60 | 已提交 |

**实测（命令 + 输出）**：

```
$ git diff --stat
 .claude/reference-map.md                           | 74 +++++++++++++++++++++-
 .../evidence/980/PLAN-980-0-6-schema-degraded.md   | 10 +++
 2 files changed, 82 insertions(+), 2 deletions(-)

$ git diff -- docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md
@@ -175,6 +175,16 @@ if (!schema) return []; // 未知类型 — 不校验（允许扩展）
+### 6b. R25（真库 id 语义断裂）对本卡的影响 —— 实测确认"不踩坑"
+ ...（共 +10 行，全部为新增 §6b）...

$ stat -c '%y' docs/.../PLAN-980-0-6-schema-degraded.md
2026-10-08 01:35:51.662824600 +0800     # = 2026-10-07T17:35:51Z
```

**结论（事实）**：本报告开写时（17:29Z）工作树 `git status --porcelain` 只有 1 行（`.claude/reference-map.md`）；到 17:35:51Z 时 **PLAN 件被追加了 §6b（+10 行）**，变成 2 行未提交修改。即：

- **验证对象在验证过程中发生了变更（移动靶）**。我的逐条复算针对 **`f61ade17d`（252 行，§6b 之前）**；§6b 之后版本的行号在 175 行以后整体 +10。
- 本报告所有 `§x.y` 引用按**章节号**给出，行号标注为"blob `f61ade17d` 口径"。
- `git rev-parse origin/main:<PLAN 路径>` ⇒ `fatal: ... exists on disk, but not in 'origin/main'`（该件**不在 main** 上，符合"feature 分支产物"预期，但按纪律**不可作为"已在 main 可读"的引用件**）。

---

## 1. 环境与基线（现查现报，不引队长数字）

```
$ git rev-parse origin/main
e09202a5f4a25f7df58aeaa76c2e17c55ff9f12f
$ git log --oneline -1 origin/main
e09202a5f Merge pull request #1333 from synova-agent/fix/v2-d1232-p3b-quote-heuristic

$ export GIT_SSH_COMMAND="ssh -i C:/Users/Administrator/.ssh/synova-deploy ..."
$ git ls-remote --heads origin main
e09202a5f4a25f7df58aeaa76c2e17c55ff9f12f	refs/heads/main        [exit=0]

$ git ls-remote --heads origin feat/win-0-6-schema-degraded
2f3044dc3c5be2d74377f3ccf00d664302fcfda2	refs/heads/feat/win-0-6-schema-degraded   [exit=0]
$ git rev-parse HEAD
2f3044dc3c5be2d74377f3ccf00d664302fcfda2
```

| 项 | 我实测 | 队长/证据写的 | 一致? |
|---|---|---|---|
| `origin/main`（现在） | `e09202a5f…` | 计划 §0 表头：`9e9e4bd9d…`；证据 txt：`ff8596cf3…` | **❌ 两处都过期**（见 #7） |
| 远端 `main` 真值 | `e09202a5f…`（ls-remote exit 0） | `ff8596cf3…` | ❌ |
| 本分支远端 SHA | `2f3044dc3…` == 本地 HEAD | RECEIPT 写 `fc69008b6…` | **❌ 回执已过期**（RECEIPT 是 2f3044dc3 之前一轮的产物） |

> 回执过期属"上一轮快照"，**不是伪造**；但按"交付附 `ls-remote` 回执"的要求，**回执需按现 HEAD 重出**。

---

## 2. 九条逐条判

### #1 `origin/main` SHA、目标文件 blob、总行数 —— **成立**

```
$ git rev-parse origin/main:src/l4/sog-schema-validator.ts
0e3122171e38f1e41dd1b627c40bec2ba63fcce5
$ git show origin/main:src/l4/sog-schema-validator.ts | wc -l
182
$ git rev-parse HEAD:src/l4/sog-schema-validator.ts
0e3122171e38f1e41dd1b627c40bec2ba63fcce5          # 工作树 HEAD 与 origin/main 同 blob（未动产品代码）
```
判：**成立**。blob `0e3122171e…`、总行数 **182**。与队长证据 P6（`0e3122171e…`）逐字一致。

### #2 静默放行点是否确在 `:141` —— **成立**

```
$ git show origin/main:src/l4/sog-schema-validator.ts | awk 'NR>=138 && NR<=145 {print NR": "$0}'
138:  */
139: export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {
140:   const schema = NODE_SCHEMAS[nodeType];
141:   if (!schema) return []; // 未知类型 — 不校验（允许扩展）
142:
143:   const errors: ValidationError[] = [];

$ git show origin/main:src/l4/sog-schema-validator.ts | grep -n 'if (!schema) return'
141:  if (!schema) return []; // 未知类型 — 不校验（允许扩展）      [exit=0]
```
**「该文件在多个 main 上 blob 是否相同」的实测**：

```
$ for r in 9e9e4bd9d ff8596cf3 origin/main; do printf '%-12s %s\n' "$r" "$(git rev-parse "$r:src/l4/sog-schema-validator.ts")"; done
9e9e4bd9d    0e3122171e38f1e41dd1b627c40bec2ba63fcce5
ff8596cf3    0e3122171e38f1e41dd1b627c40bec2ba63fcce5
origin/main  0e3122171e38f1e41dd1b627c40bec2ba63fcce5
```
判：**成立**。`:141` 行号未漂；三个 main 快照 blob **完全相同** ⇒ 行号结论在漂移后仍成立。

### #3 `NODE_SCHEMAS` 块 `:36-98`、顶层键 8 个 —— **成立**

```
$ git show origin/main:src/l4/sog-schema-validator.ts | grep -nE '^const NODE_SCHEMAS|^\};'
36:const NODE_SCHEMAS: Record<string, SchemaRule> = {
98:};

$ ... | awk 'NR>=36 && NR<=98 && /^  [A-Z_]+: \{/ {print NR": "$0}'
37:   FINANCIAL: {   47:   PERSON: {     55:   CLIENT: {    64:   RISK: {
71:   GOAL: {        78:   AGENT: {      84:   TEAM: {      91:   DOCUMENT: {
key count = 8

$ git grep -n 'NODE_SCHEMAS' origin/main
origin/main:src/l4/sog-schema-validator.ts:36:const NODE_SCHEMAS: Record<string, SchemaRule> = {
origin/main:src/l4/sog-schema-validator.ts:140:  const schema = NODE_SCHEMAS[nodeType];
hit count = 2        # 未 export ⇒ 模块私有，与计划 §1 表一致
```
判：**成立**。键名 = `FINANCIAL / PERSON / CLIENT / RISK / GOAL / AGENT / TEAM / DOCUMENT`（8 个），块边界 `:36–98`，`NODE_SCHEMAS` 非 export（模块私有）。

### #4 `validateNodeProps|validateAndLog` 完整命中集与外部调用方 —— **成立**

```
$ git grep -n -E 'validateNodeProps|validateAndLog' origin/main -- src packages tests    [exit=0]
origin/main:src/l4/graph-bridge.ts:20:import { validateAndLog } from './sog-schema-validator';
origin/main:src/l4/graph-bridge.ts:82:    validateAndLog(type, props);
origin/main:src/l4/sog-schema-validator.ts:139:export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {
origin/main:src/l4/sog-schema-validator.ts:168:export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {
origin/main:src/l4/sog-schema-validator.ts:169:  const errors = validateNodeProps(nodeType, props);
hit count = 5        # ← 计划的 P4「定义 :139/:168；调用 graph-bridge :20 + :82」逐条命中

$ git grep -n -E 'validateNodeProps|validateAndLog' origin/main        # 去掉路径过滤
... 7 行（多出的 2 行 = docs/synova/audit/SYNOVA-AUDIT-BASELINE-20260801*.txt 里的文本，非代码引用）

$ git grep -n 'validateNodeProps' origin/main | grep -v 'src/l4/sog-schema-validator.ts'
（空）   [grep-exit=1]      # ⇒ 文件外调用方 = 0
```

**返回值是否被忽略（决定 V4「不阻断」成立与否）**：

```
$ git show origin/main:src/l4/graph-bridge.ts | awk 'NR>=79 && NR<=83 {print NR": "$0}'
79:   const _createNode = store.createNode.bind(store);
80:   const _updateNode = store.updateNode?.bind(store);
81:   store.createNode = (type: string, props: Record<string,unknown>, g: string): string => {
82:     validateAndLog(type, props);
83:                                        # ← 返回值确实被丢弃，下一行直接进入 D33 时间字段推导
```
判：**成立**。`validateNodeProps` 零文件外调用方；`validateAndLog` 唯一外部调用点 `graph-bridge.ts:82` **忽略返回值** ⇒ 计划的「接了但恒不生效」「不需要改 graph-bridge」两条推论都站得住。

**附：计划 §0 P3 的「40 个斜杠类型 ∩ 8 大写键 = 0」我做了独立复算（卡面承重数字）：**

```
$ git show origin/main:packages/ontology/src/node-types.ts | grep -oE "'[a-z_]+/[a-z_]+'" | tr -d "'" | sort -u | wc -l
40                                   # distinct 斜杠类型 = 40
$ ... | grep -c '/'       → 40       # 40/40 都是斜杠形态
$ git show origin/main:src/l4/sog-schema-validator.ts | awk 'NR>=36 && NR<=98 && /^  [A-Z_]+: \{/ {gsub(/[ :{]/,""); print}' | sort -u
AGENT CLIENT DOCUMENT FINANCIAL GOAL PERSON RISK TEAM     # 8 键
$ comm -12 <(keys) <(slash-types) ; echo "intersection count = $(... | wc -l)"
intersection count = 0               # ⇒ 40 个斜杠类型 100% 走静默放行，**不是 39/1**
```
判：**成立（且是"全放行"而非"39/1"）**。
⚠️ 但两处口径需在实现时锁死（见 §3 E7）：该文件里 **常量 45 条 → 去重后 40 个**（`pool/activity` 重复 6 次）；源文件自身 JSDoc 写「29 node type string constants」与「All 45 node types」互相矛盾（**既有问题，非本卡引入**）。

### #5 判据交付物 `scripts/control-tower/probe-diagnosis.ts` 不存在 —— **成立**

```
$ git ls-tree -r --name-only origin/main -- scripts/control-tower/ | grep probe
（空）  [grep-exit=1]
$ git ls-tree -r --name-only origin/main | grep 'probe-diagnosis'
（空）  [grep-exit=1]
$ git ls-tree -r --name-only origin/main -- scripts/control-tower/ | wc -l
92                                  # 与计划 §8「目录内 92 文件」一致
$ git ls-files | grep -c 'probe-diagnosis'
0                                   # 本分支/工作树亦无
```
判：**成立**。

### #6 写集互斥（与在飞 #1322）—— **结论成立；但队长的证据用的是过期 ref**

**首先发现：本地 `origin/feat/1322-goal-creation-entry` 已过期。**

```
$ git rev-parse origin/feat/1322-goal-creation-entry
828528906c1871668d251c72a08e9973cf4af805          # 开工时的本地 ref
$ git ls-remote --heads origin feat/1322-goal-creation-entry
87cc07d32223a657d07158c90019cc3426cd563f	refs/heads/feat/1322-goal-creation-entry   [exit=0]
                                                  # ← 差 2 个 commit，队长的 P7 用的是旧 ref
```

**用真值 ref（87cc07d32）重算（三点口径，写集互斥的正确口径）**：

```
$ git diff --name-only origin/main...origin/feat/1322-goal-creation-entry      # 13 文件
.claude/claims/1322.yaml
.claude/task-briefs/2026-10-08-1322-goal-creation-entry.md      # ← 队长版写的是 1322-goal-creation-entry.md（旧名）
src/growth/{goal-store,proposal-engine,proposal-store,proposal-types,workspace-builder,workspace-types}.ts
src/routes/workspace-data.ts
tests/growth/{goal-store-real-graph,proposal-store-real-graph}.integration.test.ts
tests/routes/workspace-goal-creation.integration.test.ts
tests/security/rbac-all-routes.test.ts

$ git diff --name-only origin/main...HEAD        # 6 文件（我的分支自身改动）
.claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md
docs/synova/product-lines/evidence/980/{PLAN-980-0-6-schema-degraded.md,RECEIPT-980-plan-20261008.md,capture-980-preconditions.sh,evidence-980-plan-preconditions.txt}
memory/notes/proposed/2026-10-08-0-6-schema-degraded-visibility.md

$ comm -12 <(both sorted)
（空）
intersection count = 0
```

**真值 ref 是否触及本卡写集**：

```
$ git diff --name-only origin/main...origin/feat/1322-goal-creation-entry | grep -E 'sog-schema-validator|control-tower'
（空）  [grep-exit=1]        # 真值 head 不碰 src/l4/sog-schema-validator.ts，也不碰 scripts/control-tower/
```

**口径交叉核对（防止"选口径挑结论"）**：

| 口径 | 文件数 | 交集 | 解释 |
|---|---|---|---|
| 三点 × 三点（**正确口径**） | 13 × 6 | **0** | 双方各自相对自 merge-base 的**自有改动** |
| 两点 × 三点 | 27 × 6 | **0** | — |
| 两点 × 两点 | 27 × 19 | **13** | ⚠️ **伪交集**：两点口径含 main 侧漂移文件（`scripts/control-tower/check-gate-integrity.sh`、`tests/control-tower/*`、`task-state/*.json`、`src/loops/*` 等），**不是 #1322 自有写集** |

```
$ git merge-base origin/main HEAD                          → 9e9e4bd9d3c5844c51de48e2c42f25d2d2e904ea
$ git merge-base origin/main origin/feat/1322-...          → 9723d23c04bf055c5c706aa291a5238d62223683
```
判：**成立（交集确为空）**。但列为**漏报/瑕疵**：
- (a) 队长 P7 用的 `origin/feat/1322-...` = `828528906`（**过期**），真值 `87cc07d32`；结论侥幸不变，但**证据链未现查现报**。
- (b) 计划 §0 P7 表格写「13 文件：…」。**真值也是 13 个**，但其中一项文件名已从 `1322-goal-creation-entry.md` 变为 `2026-10-08-1322-goal-creation-entry.md`。
- (c) 顺带实测到：main 侧近期**正在往 `scripts/control-tower/**` 落件** ⇒ 计划 §8 的「治理线窗单写者排期」不是形式主义，是**活跃写者区**。

### #7 漂移（`9e9e4bd9d → ff8596cf3`）与「blob 未变」—— **结论成立；基线数字过期**

```
$ for r in 9e9e4bd9d ff8596cf3 e09202a5f; do printf '%s -> ' "$r"; git cat-file -t "$r"; done
9e9e4bd9d -> commit ; ff8596cf3 -> commit ; e09202a5f -> commit      # 三个 SHA 都在

$ git rev-list --count 9e9e4bd9d..origin/main
15                                     # 比计划写明的基线已前移 15 个 commit

$ for f in src/l4/sog-schema-validator.ts src/l4/graph-bridge.ts; do ... ; done
  sog-schema-validator.ts : 9e9e4bd9d = ff8596cf3 = origin/main = 0e3122171e38f1e41dd1b627c40bec2ba63fcce5
  graph-bridge.ts         : 9e9e4bd9d = ff8596cf3 = origin/main = cd2d693ca573f17620022239f345c75e3f5679e7
```
判：**「blob 未变」成立**（目标文件与调用方在 `9e9e4bd9d / ff8596cf3 / 现 origin/main` 三处逐字相同 ⇒ #1/#2 的行号结论在漂移后仍成立）。
**但基线数字两处过期**（**错报**）：
- 计划 §0 表头（blob `f61ade17d` 第 4 行）仍写 `origin/main = 9e9e4bd9d…`（称"2026-10-08 本机 fetch 实测"）——现应为 `e09202a5f…`。
- `evidence-980-plan-preconditions.txt:3` 写 `ff8596cf3…` ——也已不是当前值。
- 队长在本会话给我的坐标里说「我实测过 `9e9e4bd9d → ff8596cf3`」——同样停在上一个快照。

### #8 副作用自查（R28 地雷）—— **hash 部分成立；`git status` 部分不成立**

```
$ for f in $(git ls-files "extensions/industries/*/thresholds.json"); do printf '%s  %s\n' "$(git hash-object "$f")" "$f"; done
daba78f030cd95cf11ade1c0421f1a4970e8ce6d  extensions/industries/financial-services/thresholds.json
bb1e98162b3bb4f5a977a2eec5877b515a286b4e  extensions/industries/general-enterprise/thresholds.json
f7ad5be81922d66899efe8583951562a567d3504  extensions/industries/manufacturing/thresholds.json
16b5bdec888c4c14a08537914dd054ab3599847d  extensions/industries/retail-ecommerce/thresholds.json
b0ec2ecf0b64e96357f054cb0ba8c250dc87266c  extensions/industries/saas-tech/thresholds.json
7926e3ec906980e38a60e64c597210dc16903655  extensions/industries/test-write/thresholds.json
```
**与证据 P9 逐字一致：6/6 全同** ⇒ R28 地雷当前**未被触发**。

```
$ git status --porcelain
 M .claude/reference-map.md
 M docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md
line count = 2                    # ← 不是"干净"，也不是"只有预期产物"一种解释
```
判：**半成立**。
- hash 部分 **成立**（6/6 一致）。
- 「工作树 `git status --porcelain` 只有预期产物」**不成立为"干净"事实**：实为 **2 个未提交修改**；且 PLAN 件**交付内容 ≠ 已提交内容**（262 行 vs 252 行，见 §0）。
- **额外漏报**：计划 §7.1 明文要求「跑前记 `git status --porcelain` 基线 + 6 个 thresholds.json SHA256；跑后逐字比对」，但 `capture-980-preconditions.sh` **只采了 6 个 hash，没有采 `git status --porcelain` 基线**（全脚本 75 行，无 `git status`）⇒ **自定纪律与自采证据不一致**，跑探针后无法做"前后逐字比对"。

### #9 反例探针 / V5 判别性 —— **不成立（两处不自洽）**

**只做静态推理 + 复刻推演 + `/tmp` 变异文本，未改仓库任何文件。**

**证据 A：现状控制流（`origin/main` blob `0e3122171e`，逐字引用）**

```
:168  export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {
:169    const errors = validateNodeProps(nodeType, props);
:170    if (errors.length === 0) return true;              // ← 判据
:172    for (const e of errors) {
:173      log.warn({...}, `[SOG-schema] ${e.nodeType}.${e.field} 校验失败: 期望 ${e.expected}`);
:178    }
:181    return false;
:182  }
```

**证据 B：变异文本只落 `/tmp`，仓库文件未被触碰**

```
$ git show origin/main:src/l4/sog-schema-validator.ts > /tmp/verify980_orig.ts           # 182 行
$ sed 's|if (!schema) return \[\];|/* V5-MUTATION: silent pass restored */ if (!schema) return [];|' /tmp/verify980_orig.ts > /tmp/verify980_v5mut.ts
141c141
<   if (!schema) return []; // 未知类型 — 不校验（允许扩展）
>   /* V5-MUTATION: silent pass restored — no log, no count */ if (!schema) return []; // 未知类型 — 不校验（允许扩展）
$ git status --porcelain    # 变异前后一致，仍是那 2 行（未新增/未改文件）
```

**证据 C：复刻推演输出（`node /tmp/verify980/demo980.mjs`；**逐字复刻** :139-141 与 :168-182 的控制流，非真实模块执行）**

```
--- CURRENT(现状) | nodeType=resource/money ---
  validateNodeProps().length    = 0
  errors[0].degraded            = undefined
  validateAndLog() returns      = true
  log.warn emitted (校验失败行)  = 0

--- PLAN(b-prime) | nodeType=resource/money ---
  validateNodeProps().length    = 1
  errors[0].degraded            = true
  validateAndLog() returns      = false   <-- 计划 §3.1 称「仍返回 true」
  log.warn emitted (校验失败行)  = 1       <-- 计划 §3.2 称不刷屏 / §3.3 称只发「未覆盖类型」告警
```

**判：不成立（两处）**

**(i) 计划 §3.1（blob `f61ade17d` 第 71–72 行）的推论错。** 该行原文：

> 「返回值语义：`errors.length === 0` ⇔ 无错误且**无降级**。`validateAndLog` 判 `errors.length === 0 → return true` **保持原判据** ⇒ 未覆盖类型**仍返回 true（不阻断）**」

按计划自己给的形态（未覆盖类型返回**一条**含 `degraded:true` 的元素），`:170` 的 `errors.length === 0` 为**假** ⇒ `validateAndLog` 返回 **`false`**，并逐个元素打出 `[SOG-schema] <type>.* 校验失败: 期望 schema 未覆盖 — 放行 (degraded)` 的**假失败告警**。计划 §3.4 契约表里 "`validateAndLog` … @degraded 同上（透传）；**语义不变**" 同样**不成立**。
⇒ 要自洽，必须在**同一文件内额外改 `validateAndLog` 的循环/判据**（例如 `errors.every(e => e.degraded)` 时 return true 并跳过"校验失败"文案）。**计划没有声明这处改动**，而 §5.1 的 U1–U7 **没有任何一条断言 `validateAndLog` 的返回值**（U3/U4 只断言 `validateNodeProps` 与聚合计数）⇒ **现有测试计划抓不到这个矛盾**。
⇒ 不得混淆的是：**「写入不阻断」（V4）不受影响** —— `graph-bridge.ts:82` 丢弃返回值，写入路径照旧。

**(ii) 计划 §6 V5「必红」不成立（非判别性）。** 计划 §6（blob `f61ade17d` 第 170 行）称：

> 「V5（反例·必红）｜把 `:141` 改回 `if (!schema) return [];`（无日志无计数）⇒ 跑 V1 ⇒ **必红**（grep 空 + 探针无汇总行）」

而 §5.3（同 blob 第 152–154 行）规定探针「**行2：`未覆盖类型 N 个`**（N 取自 `getUncoveredTypeStats()`）」——这是**无条件打印的字面字符串**。变异后 N 变 0，输出为 `未覆盖类型 0 个`，而 V1 的判据是 `grep -q '未覆盖类型'`（**子串匹配，与 N 无关**）：

```
$ printf '未覆盖类型 0 个\n' > /tmp/probe_sim.txt
$ grep -q '未覆盖类型' /tmp/probe_sim.txt
simulated V1 grep exit = 0        # ⇒ 变异下 V1 仍然绿，V5 不会红
```
⇒ V1 的绿可以**完全由探针自己的静态文案供给**，与校验器降级路径是否存活无关 ⇒ 这正是"grep 型静态判据当验收"的陷阱。要 V5 真判别，必须二选一：① 探针显式声明 "count=0 时**不**打印含 `未覆盖类型` 的行"；② V1 的 grep 目标改为动态断言（如 `未覆盖类型 [1-9]`），或断言日志侧（`log.warn`）而非探针 stdout。

**(iii) 附加静态事实（供实现者避坑）**：若把 `:141` 删成"当成已知键"（不是"改回"而是"移除早退"），`:146 if (schema.required)` 会对 `undefined` 抛 `TypeError` ⇒ 写入路径**抛错**（等价于阻断），**不是**静默放行。即 `:141` 的早退是**防抛错承重件**，变异方向必须写清是"还原"而非"假定已知"。

---

## 3. 队长错报 / 漏报清单（逐条：编号 + 命令 + 原始输出 + 与计划哪一行冲突）

| # | 类型 | 事实（命令 + 输出） | 冲突位置 | 严重度 |
|---|---|---|---|---|
| **E1** | **错报（数字）** | `git rev-parse origin/main` ⇒ `e09202a5f…`；`git rev-list --count 9e9e4bd9d..origin/main` ⇒ `15` | 计划 §0 表头第 4 行「基线：`origin/main = 9e9e4bd9d…`」；证据 txt:3「`ff8596cf3…`」 | 中（结论未被推翻，但数字已过期） |
| **E2** | **错报（逻辑）** | 现码 `:170 if (errors.length === 0) return true;`；按 §3.1 形态未覆盖类型返回 1 元素 ⇒ 返回 **false** + 假"校验失败"告警（复刻推演输出见 #9C） | 计划 §3.1 第 72 行「…`保持原判据` ⇒ 未覆盖类型**仍返回 true**」；§3.4「语义不变」 | **高**（若照字面实现，行为与计划声明不符；且测试计划无断言可抓） |
| **E3** | **错报（判别性）** | `grep -q '未覆盖类型'` 命中 `未覆盖类型 0 个`（exit 0） | 计划 §6 V5 行「必红（grep 空 + 探针无汇总行）」 | **高**（反例不具备判别力 = 验收证据链断裂） |
| **E4** | **漏报（ref 过期）** | 本地 `origin/feat/1322-… = 828528906`，真值 `git ls-remote = 87cc07d32` | 计划 §0 P7 / 证据 P7（结论为空，侥幸不变） | 低 |
| **E5** | **漏报（纪律未自采）** | `capture-980-preconditions.sh` 75 行内**无 `git status`**；`git status --porcelain` 实为 2 行 | 计划 §7.1「跑前记 `git status --porcelain` 基线…跑后逐字比对」 | 中 |
| **E6** | **漏报（移动靶）** | PLAN 工作树 blob `ab5b9e6de`(262 行) ≠ HEAD blob `f61ade17d`(252 行)；mtime `2026-10-08 01:35:51 +0800` | 计划/回执均未申报"计划件在验证期间被改动、且改动未提交" | 中 |
| **E7** | **口径风险** | `node-types.ts` 实测 **45 条常量 / 40 个 distinct**（`pool/activity` ×6）；同文件 JSDoc 自身写「29」与「All 45」互相矛盾；`extensions/ontology/` 仅 **29** 个节点 JSON | 计划 §5.2 I2 / §5.1 U6 用「40 个斜杠类型」；§11.3 用「`pool/*`(15)」 | 中（**必须锁死"去重后 40"**，否则 I2/U6 会写成 45 而红） |
| **E8** | **同类风险（建议自查）** | 计划 §5.3 行1「写入 N 个节点，全部返回 nodeId（未阻断）」同样是探针**硬编码文案**，可被同一类"自证型 grep"污染 | 计划 §5.3 / §10 D1 | 低 |
| **E9** | **回执过期** | `ls-remote` 现为 `2f3044dc3…`，RECEIPT 写 `fc69008b6…` | RECEIPT §2② | 低（补一次 ls-remote 即可） |

**核对结论：计划 §0 表 P1–P11 中，P1/P2/P4/P5/P6/P8（及我复算的 8 键×40 斜杠类型交集=0）我逐条实测成立；P7/P9/P10/P11 我未全量复算（见 §4 未解决项）。「前提不成立项：无」这句话在 P1/P2/P4/P5 范围内我可背书；P3 的 40/40 我复算为真；但 §3.1/§3.4/§6-V5 三处**设计层声明**不成立（E2/E3）。**

---

## 4. 未解决项（**无法证实** 的部分，不猜）

| # | 无法证实的事 | 原因 |
|---|---|---|
| U1 | §3.1 (b') 的**实际**实现形态 | 计划未给 diff；我只能按"计划字面 + 现码控制流"静态推理。若实现者在 `validateAndLog` 内额外过滤 `degraded`，则 §3.1 描述的"仍返回 true"可达成，但 §3.4「语义不变」仍错。**需 CTO 让实现者先补这一句契约。** |
| U2 | 探针/集成测试在**真库**上能否跑通 | 工作树**无 `node_modules`**（计划 §10 第一步才装依赖），且约束"未获线窗不得写 probe" ⇒ 我未执行任何 tsx/vitest。 |
| U3 | tsc / vitest / 13 组门禁 / 架构检查 | 按只读纪律**未跑**重型验证（也避免与"串行 ≤1"冲突）。 |
| U4 | §0 P10 的 GitHub 必需检查清单（9 条 contexts + `enforce_admins`） | 本机 `gh` 未登录（RECEIPT E1/E2 已记）；不在本件 9 条范围 ⇒ **未复算**。 |
| U5 | §0 P9 的 `createSystemGraphStore()`（`src/agent/graph-store-service.ts`）工厂可装配性 | 不在本件 9 条范围 ⇒ **未复算**。 |
| U6 | §0 P6「`validateNodeProps` 返回类型**无 degraded**」 | 已由 `:27-32 ValidationError` 定义（仅 `nodeType/field/value/expected`）+ `:139` 签名间接证实；但"字段名是否已被别处占用"未全仓 grep ⇒ 保留为**部分证实**。 |
| U7 | LIVE 状态下的 `main` 保护/CI | 仅 `ls-remote` 可用；未做 CI 侧查询。 |

---

## 5. 我的写动作与副作用披露（可核）

1. **工作树内**：只新建了本文件 `docs/synova/product-lines/evidence/980/VERIFY-980-plan-verifier-980.md`。**未修改/未删除任何其他文件**，未 commit，未 push。
2. **工作树外**（全部落 `/tmp`）：`/tmp/verify980_orig.ts`、`/tmp/verify980_v5mut.ts`、`/tmp/verify980_slashtypes.txt`、`/tmp/verify980_keys.txt`、`/tmp/probe_sim.txt`、`C:\Users\Administrator\AppData\Local\Temp\verify980\{q1..q12}.sh`、`demo980.mjs`。
3. **`.git` 侧唯一副作用（主动披露）**：为拿 #1322 的**真值** head，我执行了
   `git fetch origin feat/1322-goal-creation-entry`，它把 remote-tracking ref `origin/feat/1322-…` 从 `828528906` 推进到 `87cc07d32`（输出：`828528906..87cc07d32  feat/1322-goal-creation-entry -> origin/feat/1322-goal-creation-entry`）。**这只动 remote-tracking ref，不动任何工作树文件、不动分支、不动 main**（`git status --porcelain` 前后一致）。
4. 未使用 `--no-verify` / `git stash` / force push / `--admin`。
5. 未跑任何重型验证（tsc/vitest/门禁），未执行产品代码。

---

## 6. 复跑方式（现查现报）

```bash
cd /d/novis-backup-20260526/Novis/.synova-wt-980
export GIT_SSH_COMMAND="ssh -i C:/Users/Administrator/.ssh/synova-deploy -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no"
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q1.sh    # #1–#3
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q2.sh    # #7 + ls-remote 真值
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q3.sh    # #4 + 源码全文
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q4.sh    # #5/#6/#8
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q5.sh    # 移动靶 + #1322 真值 fetch
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q6.sh    # 真值口径交集重算
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q7.sh    # 斜杠类型枚举
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q8.sh    # 40 去重 ∩ 8 键 + graph-bridge
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q9.sh    # /tmp 变异文本 + 只读自证
bash /c/Users/Administrator/AppData/Local/Temp/verify980/q12.sh   # NODE_SCHEMAS 私有 + 口径交叉
node /c/Users/Administrator/AppData/Local/Temp/verify980/demo980.mjs   # 复刻推演
```

**报告路径**：`docs/synova/product-lines/evidence/980/VERIFY-980-plan-verifier-980.md`

---

## 7. 自验结论（本件只到这里）

> **#980 计划件的前提实测（P1–P5、P7–P8、8 键 ∩ 40 斜杠类型）我逐条独立复算，全部成立；写集与 #1322 的交集为空成立。**
> **但设计层有三处不成立/不自洽**：§3.1(第 72 行)「未覆盖类型仍返回 true」与现码 `:170` 矛盾（**E2/高**）；§6 V5「必红」不具判别性（**E3/高**）；基线数字与 ref 过期（E1/E4/E9）与工作树不干净（E5/E6）需更正。
> **建议（仅陈述依赖关系，不代为决策）**：E2/E3 属**实现前必须闭合**的契约缺口 —— 否则实现者会照字面写出与计划声明不符的行为，且现有 U1–U7 测试计划**抓不到**。
> **本件不构成「审计通过」**：通过与否归 CTO 收件闸 + K3 终审；本件可作为「可提请独立审计」的输入。
