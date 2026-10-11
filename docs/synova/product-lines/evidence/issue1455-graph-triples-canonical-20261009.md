# #1455 图边表形状漂移 → 整表重建到 canonical（B2 · P1 · 第0批-止血）

- **执行人**：@k4-coder-a（WIN 侧 K4 小队编码员 A）
- **日期**：2026-10-09
- **卡**：https://github.com/synova-agent/SynovaAgent/issues/1455
- **工作树（唯一写点）**：`D:\novis-backup-20260526\Novis\.synova-wt-1455`
- **分支**：`fix/1455-graph-triples-props`（**分支名沿用派单指定，未改**；实现已由"补列"演进为"整表重建"，见 §6-U6）
- **基准**：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`（卡面 `as_of=a7b146280` **已过时**）
- **状态**：**本地已实现 + 定向测试全绿**；**未 push / 未开 PR / 未合并**（GitHub 账号级封禁，见 §8）
- **判定人**：K3（先过 CTO 收件闸）—— 本件只出**自验结论**，不声称"通过"

---

## §1 一句话结论

`graph_triples` 在真机上不只是"缺 `props` 列"，而是**整表形状漂移**（`id INTEGER PRIMARY KEY AUTOINCREMENT`，
canonical 要求 `id TEXT PRIMARY KEY`）。只 `ADD COLUMN props` 属**半修**：读面转绿，写面 `createEdge`
从 `no such column: props` **变成** `datatype mismatch`（错误换脸，不是消失）。SQLite 无法 `ALTER`
列类型/主键 ⇒ **唯一充分修法 = 整表重建到 canonical**。本件以迁移 004 实现重建；真机库一致性快照上
**读写面同时转绿**，且二次执行 no-op。

---

## §2 根因（含列名对照表）

### 2.1 两侧差异（**完整清单**：canonical `SCHEMA_SQL` 逐字 vs 真机 `PRAGMA` 程序化对差）

**`graph_triples`（canonical 12 列 / 真机 14 列）—— 本卡修复对象**

| 类别 | 项 | canonical | 真机实测 | 后果 / 处置 |
|---|---|---|---|---|
| **[缺]** | `props` | `props TEXT NOT NULL DEFAULT '{}'` | 不存在（只有 `props_json TEXT DEFAULT '{}'`） | 读面 `no such column: props` ⇒ **本卡修** |
| **[多]** | `confidence` | —— | `REAL DEFAULT 1.0` | 按 canonical **移除**（见 §6-U2） |
| **[多]** | `props_json` | —— | `TEXT DEFAULT '{}'` | 值搬进 `props` 后按 canonical **移除** |
| **[多]** | `source` | —— | `TEXT` | 按 canonical **移除**（见 §6-U2） |
| 🔴 **[同名异义]** | `id` | `TEXT PRIMARY KEY` | **`INTEGER PRIMARY KEY AUTOINCREMENT`** | **根因**：`createEdge` 写 `'edge-<uuid>'` ⇒ `datatype mismatch` |
| **[同名异义]** | `graph` | `TEXT NOT NULL DEFAULT 'default'` | `TEXT NOT NULL`（**丢 DEFAULT**） | 重建收敛 |
| **[同名异义]** | `weight` | `REAL NOT NULL DEFAULT 1.0` | `REAL DEFAULT 1.0`（**丢 NOT NULL**） | 重建收敛 |
| 索引 | `idx_gt_*` ×5 | 同名同定义（`:52-56`） | 同名 | 重建后同形 |

> 上述 `graph_triples` 漂移项**由整表重建一并收敛**（重建产物 = canonical 逐列）⇒ 不需单独立卡。

**`graph_nodes`（canonical 8 列 / 真机 10 列）—— 🔴 本卡「已实测，不修」**

| 类别 | 项 | canonical | 真机实测 | 处置 |
|---|---|---|---|---|
| **[缺]** | `valid_from` | `valid_from TEXT NOT NULL DEFAULT (datetime('now'))` | 不存在 | 🔴 不修（见 §6-U3） |
| **[多]** | `confidence` | —— | `REAL DEFAULT 1.0` | 🔴 不修 |
| **[多]** | `props_json` | —— | `TEXT DEFAULT '{}'` | 🔴 不修（**注意：不止多 `confidence`/`updated_at`，`props_json` 也在**） |
| **[多]** | `updated_at` | —— | `TEXT NOT NULL DEFAULT (datetime('now'))` | 🔴 不修 |
| **[同名异义]** | `id` | `TEXT PRIMARY KEY` | `TEXT NOT NULL`（**+ 复合主键 `(id, graph)`**） | 🔴 不修（`createNode` 实测写通） |
| **[同名异义]** | `graph` | `… NOT NULL DEFAULT 'default'` | `TEXT NOT NULL`（**丢 DEFAULT**） | 🔴 不修（实测不红） |
| **[同名异义]** | `name` | `TEXT`（**可空**） | `TEXT NOT NULL DEFAULT ''`（**收紧为 NOT NULL**） | 🔴 不修（实测不红） |

> `created_at` / `valid_from` 的 default **文本形态**差异属语义等价，不计漂移。
> 不修理由（队长裁）：`createNode()` 在真机 DDL 上**实测写通**、节点读面被迁移 001 治好 ⇒ **今天不红**；
> 「重建一张当前可用的表 = 纯风险无实测收益」⇒ **建议另立卡**（形状不一致本身是技术债）。

### 2.1b 🔴 双缺陷「按序暴露」——为什么必须做写面判别

真机形态下**两个缺陷按序暴露**（独立自验员在真机库字节副本上实测，本卡在同夹具复现）：

```
STEP 0: createEdge FAILED: table graph_triples has no column named props   ← 先暴露「缺列」
STEP 1: (只加 props 列) createEdge STILL FAILED: datatype mismatch          ← 加完列仍红
STEP 2: raw TEXT-id INSERT FAILED: datatype mismatch                        ← PK 类型才是阻塞点
STEP 3: raw INTEGER-id INSERT SUCCEEDED
```
⇒ **只要补上 `props` 列，`no such column: props` 就归零**（错误换成**另一个字符串** `datatype mismatch`）
⇒ 🔴 **「只数错误串」的判据会绿而边仍建不出来 = 假绿**；同理加列后 `queryEdges` 会**成功返回 `[]`**
（表本就空、边压根建不出来）⇒ **「从报错变成空」不是修复证据**。
**故本卡判据口径（V1′）**：`createEdge` **真跑成功**（返回 `edge-*` id）**且** `SELECT COUNT(*) FROM graph_triples`
由 0 增长；**同时** `no such column: props` 计数 = 0（基线 50）。

### 2.2 根因链

```
真机 graph_triples 表形状漂移（INTEGER PK + props_json）
  ├─ 读面：queryEdges (:245 SELECT … props) → no such column: props
  │        → catch(:255-259) 返回 [] → 哨兵把"查询失败"当"无边" → compute 连环降级（一轮 50 次）
  └─ 写面：createEdge (:171-180 INSERT … props, id='edge-<uuid>')
           → table graph_triples has no column named props
           （补列后 → datatype mismatch：TEXT id 进 INTEGER PK 列）
```

**为什么 001 没治好**：`001-graph-nodes-props.ts` 只 `ALTER graph_nodes`；`src/store/migrations/`
**没有任何 graph_triples 迁移**（基线 `git ls-tree origin/main src/store/migrations/` 仅 001/002/003，见 §4.4）。
⇒ 「新库有 `props`、旧库只有 `props_json`」被完整解释：新库由 `CREATE TABLE IF NOT EXISTS` 建成 canonical
（含 `props`），旧库建表在前且 `IF NOT EXISTS` 不会改既有表 ⇒ 漂移永久留存，直到有迁移来对齐。

### 2.3 约束遵从（卡面 §③「不改 schema 定义迁就查询」）

- ❌ 未改 `src/adapters/sqlite-graph-store.ts:245` 的列名（新库就是 `props`，改查询会打破新库）
- ❌ 未改 `SCHEMA_SQL` 的 schema 定义（canonical 保持不动，它就是"权威侧"）
- ✅ 只新增迁移，把**旧库对齐到代码已声明的形状**——与 001 处理 `graph_nodes` 同一修法先例

---

## §3 判据逐条（卡面 §⑥）

| 判据 | 结果 | 证据 |
|---|---|---|
| **V1′**（写面 + 读面）`createEdge` **真跑成功**（返回 `edge-*` id）且 `SELECT COUNT(*) FROM graph_triples` **由 0 增长**；**同时** `no such column: props` 计数 = 0（基线 50） | ✅ | §4.3：缺列态 `createEdge ×50` 成功 **0/50** → 重建后 **50/50**，边总数 **2 → 52**；错误行 `no such column: props` = **50 → 0**。§4.2 真机快照：`createEdge() = OK id=edge-4f6b856c-…` |
| **V2** 图边查询成功率对照（失败 50 → 0，附前后数字） | ✅ | §4.3：`queryEdges` ×50 命中 **0 → 50**，落空 **50 → 0**。🔴 **明确声明：不得把"报错 → 空"当修复证据**——加列后 `queryEdges` 会**成功返回 `[]`**（表空且边建不出来）⇒ 判据必须是 `length === N(N>0)`，不是"不抛错" |
| **V3** 哨兵 compute 降级计数对照 | **机制级达成 + 静默降级单列读数** | §4.3 写面：`createEdge` ×50 成功 **0 → 50**；§6-U1 单列「失败态返回 `[]` 且**无 `degraded` 标记** ⇒ 调用方无法区分"没有边"与"查询失败"」= 连环降级的机制本体 |
| **V4** 改坏即红：恢复错误列名 ⇒ 相关测试必红 | ✅ | §4.1 四态：态3 绿（`length=2`/`createEdge` OK）→ 态4 改坏后 **`length=0`**；且已固化为**常驻单测**（`004-graph-triples-rebuild.test.ts` 的 V4 用例，判别断言用 `toHaveLength(1)`/`toHaveLength(0)`，**不使用 `Array.isArray` 恒真式**） |

> **V1 诚实注记**：卡面 V1 字面要求"**一轮哨兵跑**后日志计数"。完整哨兵轮属**重型端到端验证**
> （需全量哨兵 + 真库 + 由自验员串行执行），本件未跑，交付的是**充分机制条件**：导致该日志行的
> **同一 SQL 路径**在真机形态夹具上 ×50 的对照读数。⇒ 「一轮哨兵跑 = 0」的**端到端复测**列为 §6-U4 未决项，
> 建议由自验员/CTO 收件闸在真机快照上补跑。**不把机制级读数冒充端到端读数**。

---

## §4 原始输出（命令 + 原样输出）

### 4.1 四态（V4 判别性夹具全过程；夹具 DDL **逐字抄真机**）

夹具：`graph_triples` 用真机 DDL 逐字（含 `id INTEGER PRIMARY KEY AUTOINCREMENT`）+ 2 行真数据；
`graph_nodes` 用真机 DDL（保留 001 已补的 `props`，还原"真机现状"）；**无 `schema_version` 表**（= 真机时点1 形态）。
命令：`npx vitest run tests/store/migrations/<四态探针> 2>&1`（探针跑完即删，不进 PR）

```
[态1 缺列态] graph_triples 有 props = false | id 类型 = INTEGER
[态1 缺列态] queryEdges().length = 0
[态1 缺列态] createEdge() = 抛错 table graph_triples has no column named props
[态2 只补列态] graph_triples 有 props = true | id 类型 = INTEGER
[态2 只补列态] queryEdges().length = 2
[态2 只补列态] createEdge() = 抛错 datatype mismatch
[态3 重建后] id 类型 = TEXT | 列 = id,graph,subject_type,subject_id,predicate,object_type,object_id,weight,props,created_at,valid_from,valid_to
[态3 重建后] queryEdges().length = 2
[态3 重建后] createEdge() = OK id=edge-e5dbef5c-d95a-4e73-387d-b4d3018935fd
[态4 再改坏] 改坏前 length = 3 ⇒ 改坏后 length = 0   ← RED
[态5 二次执行] 两次结构/数据快照一致 = true
[态5 二次执行] 快照 = {"cols":["id:TEXT","graph:TEXT","subject_type:TEXT","subject_id:TEXT","predicate:TEXT","object_type:TEXT","object_id:TEXT","weight:REAL","props:TEXT","created_at:TEXT","valid_from:TEXT","valid_to:TEXT"],"idx":["idx_gt_object","idx_gt_predicate","idx_gt_subject","idx_gt_valid","idx_gt_weight","sqlite_autoindex_graph_triples_1"],"rows":{"n":2}}
```

🔴 **态2 = 「半修掩盖」的物证**：`props` 列已在（`false → true`），读面已绿（`0 → 2`），
但写面错误**从"缺列"换脸成"类型不匹配"**（`no column named props` → `datatype mismatch`）。
⇒ 只补列后"看列名"会判为已修好；**必须补完列再跑一次写面**，深层 DDL 类型冲突才浮出来。

### 4.2 真机库一致性快照实验（`sqlite3.backup` 快照，**非 cp**；全程只读原库）

命令：`python3 <snapshot> <原库> <副本>` + `npx vitest run <真机快照探针>`；原库路径 `data/synova.db`
快照前原库状态：`schema_version = [2,3,4]`、`graph_nodes` 有 `props`、`graph_triples` **无 props + id INTEGER**

```
[快照] graph_triples 迁移前 = id:INTEGER(pk), subject_type:TEXT, subject_id:TEXT, predicate:TEXT, object_type:TEXT, object_id:TEXT, graph:TEXT, weight:REAL, props_json:TEXT, confidence:REAL, source:TEXT, valid_from:TEXT, valid_to:TEXT, created_at:TEXT
[快照] graph_nodes   迁移前 = id:TEXT(pk), type:TEXT, graph:TEXT(pk), name:TEXT, confidence:REAL, props_json:TEXT, created_at:TEXT, updated_at:TEXT, valid_to:TEXT, props:TEXT
[快照] schema_version 表存在 = 是
[快照] schema_version 行 = [{"version":2},{"version":3},{"version":4}]
[快照] graph_triples 迁移后 = id:TEXT(pk), graph:TEXT, subject_type:TEXT, subject_id:TEXT, predicate:TEXT, object_type:TEXT, object_id:TEXT, weight:REAL, props:TEXT, created_at:TEXT, valid_from:TEXT, valid_to:TEXT
[快照] schema_version 迁移后 = [{"version":2},{"version":3},{"version":4},{"version":5}]
[读面] queryEdges() = 返回 0 条
[读面] queryNodes('Client') = 返回 0 条
[写面] createNode() = OK id=node-3f70ff7f-dd49-42fe-7578-ecc7d5a33dbf
[写面] createEdge() = OK id=edge-4f6b856c-1ec3-45cd-5443-3eb7f9d4d665
```
错误计数（原始日志 grep）：`no such column: props` = **0 次**；`datatype mismatch` = **0 次**
⇒ **真机升级路径（既有库 2/3/4 → 5）走通，读写面同时绿**。（该表真机 0 行，故 `queryEdges` 返回 0 条属正确空集，非失败。）

### 4.3 V1/V2/V3 计数（终版实现；同一 SQL 路径 ×50）

命令：`npx vitest run tests/store/migrations/<计数探针> 2>&1`

```
[缺列态] queryEdges ×50 → 命中 0 次，落空 50 次   ← 复现卡面 50 次症状
[缺列态] createEdge ×50 → 成功 0 次，失败 50 次
[重建后] queryEdges ×50 → 命中 50 次，落空 0 次   ← 读面 50→0（失败计数）
[重建后] createEdge ×50 → 成功 50 次，失败 0 次   ← 写面由 0 转 50
[重建后] 边总数 = 52（2 旧 + 50 新）
```
日志行计数：`no such column: props` = **50 次**；`no column named props`（写路径）= **50 次**；`查询图边失败` = **50 次**

### 4.4 前提复跑（对照卡面 §②）

完整日志：`.k4-publish/premise-rerun.log`（227 行，含 §a 查询面 / §b SCHEMA_SQL / §c 真机库两时点 / §d 迁移目录 / §e 冲突扫描）。
要点：

```
共 2 处   ← SCHEMA_SQL 两表 props 声明（:30 graph_nodes、:47 graph_triples）
:245: const sql = `SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHERE ${conditions.join(" AND ")}`;
:253: props: JSON.parse(row.props || "{}") as Record<string, unknown>,
共 4 处   ← 迁移 version：001→2、002→3、003→4、004→5
git ls-tree origin/main src/store/migrations/ → 001-graph-nodes-props.ts, 002-metric-readings.ts, 003-orgs.ts
```

### 4.5 定向测试（最终，无 scratch 残留）

命令：`npx vitest run tests/store`（**非全量 vitest**——全量属重型验证，由自验员串行执行）

```
 ✓ tests/store/migrations/004-graph-triples-rebuild.test.ts (16 tests)
 ✓ tests/store/schema-migration.test.ts (9 tests)
 ✓ tests/store/schema-migration-idempotency.test.ts (6 tests)
 ✓ tests/store/migrations/001-graph-nodes-props.test.ts (6 tests)
 ✓ tests/store/migrations/002-metric-readings.test.ts (4 tests)
 ✓ tests/store/migrations/003-orgs.test.ts (10 tests)
 ✓ tests/store/metric-readings-schema.test.ts (12 tests)
 ✓ tests/store/metric-readings-insert.test.ts (11 tests)
 ✓ tests/store/session-store.test.ts (3 tests)
 ✓ tests/store/session-event-log.test.ts (17 tests)
 ✓ tests/store/session-projection.test.ts (7 tests)
 ✓ tests/store/retry-projection.test.ts (6 tests)
 Test Files  12 passed (12)
      Tests  107 passed (107)
```

### 4.6 夹具质量双检（🔴 更正：仓库 `tsc` 对 `tests/**` **零覆盖**，不能充当夹具闸）

**问题（队长 2026-10-09 纪律更正，本条系我采纳后补测）**：仓库 `tsconfig.json` 的
`"exclude": ["node_modules", "dist", "tests"]` ⇒ **`npx tsc --noEmit` 对 `tests/**` 纳入 0 条**
⇒ 它对本卡的判别性夹具（`tests/store/migrations/004-graph-triples-rebuild.test.ts`）**零覆盖**：
「`tsc` 本卡文件 0 错误」这句话**读起来像夹具被检查过，实际没有** ⇒ 属**绿灯来源不是被检查对象**。
（事故点在**夹具**里，而原口径恰好在事故点上给"零覆盖的通过"。）

**更正后的夹具双检（「破坏」之后、读 exit code 之前，两条都必须过）**：

**① 夹具单文件类型检查（仓库同等选项 + `paths` 别名 ⇒ 真覆盖）**
```bash
npx tsc -p .k4-publish/tsconfig-fixture-1455.json   # extends ../tsconfig.json + include 夹具 + exclude []
npx tsc -p .k4-publish/tsconfig-fixture-1455.json --listFiles | grep 004-graph-triples-rebuild.test.ts
```
```
（① 输出）0 行 —— 0 错误 ✓    exit=0
（①b --listFiles 确认纳入）
D:/novis-backup-20260526/Novis/.synova-wt-1455/tests/store/migrations/004-graph-triples-rebuild.test.ts
```
⇒ `--listFiles` 证明该"0 错误"是**真覆盖**，不是零覆盖的假绿。

**② 收集数 == 预期用例数**
```bash
npx vitest run tests/store/migrations/004-graph-triples-rebuild.test.ts
```
```
 ✓ tests/store/migrations/004-graph-triples-rebuild.test.ts (16 tests) 96ms
 Test Files  1 passed (1)
      Tests  16 passed (16)          ← 收集数 16 == 预期 16 ✓
```
⇒ 两条都过 ⇒ 之后读 exit code 判判别性才成立。

**`src/**` 侧未受影响**：仓库 `tsc --noEmit` 对**未被 `exclude` 的**文件仍有覆盖 ⇒ 本卡改动的
`src/store/migrations/004-graph-triples-rebuild.ts` / `src/store/schema-migration.ts` **0 错误**成立
（该次运行的 38 处存量错误全在 `extensions/**` 与其他 `src/**`）。

**未做（不在任何卡写集，禁自碰）**：给 `tests/` 建专用 tsconfig（正规解）属**控制塔/门禁域**
⇒ 提案→K3→CTO。本卡**未改 `tsconfig.json`**。本卡用的 `.k4-publish/tsconfig-fixture-1455.json`
是**临时辅助件**，且 `.k4-publish/` 已被 `.git/info/exclude` 排除 ⇒ 不进本提交、不进 PR。

---

## §5 变更清单（**本文件不固化自身 sha/行数**，理由见 §5.0）

`git show --name-only HEAD`（原始输出；文件清单**不随编辑浮动**，任何 head 上可复跑）：

```
.claude/claims/1455.yaml
.claude/task-briefs/2026-10-09-1455-graph-triples-rebuild.md
docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md
src/store/migrations/004-graph-triples-rebuild.ts
src/store/schema-migration.ts
tests/store/metric-readings-schema.test.ts
tests/store/migrations/003-orgs.test.ts
tests/store/migrations/004-graph-triples-rebuild.test.ts
tests/store/schema-migration.test.ts
```

### §5.0 为什么不在此处写死 sha 与 diff 行数（自指悖论）

本证据件被提交进**它所描述的那个提交**里 ⇒ 任何 `git commit --amend`（或再编辑本文件）都会让
"写死的 sha" / "本文件自身的行数" **立刻过期**，修一次旧一次（本次实践中实测踩到：sha 从
`835f77f81` → `848400e06` → `3885f2cae` → …，逐次自失效）。
⇒ **约定**：
- **sha 由卡上【WIN-1455 交付】回执 / PR 正文 / `ls-remote` 回执持有**（`.k4-publish/WIN-1455-delivery.md`、
  `PUBLISH.sh` 产出的 `ls-remote-receipt.txt`）——那些载体在提交之外，可后置更新；
- 本文件只固化**不随编辑浮动**的东西：文件清单（上一块）、逐条判据原始输出（§4）、未决项（§6）。
- **数值裁决以现场复跑为准**：`git show --stat HEAD`、`npx vitest run tests/store`、`bash scripts/pre-commit-check.sh`。

| 文件 | 类型 | 说明 |
|---|---|---|
| `.claude/claims/1455.yaml` | 新增（**治理产物，不计 PR 预算**） | issue 号卡的 D708 S0 写集声明源 |
| `.claude/task-briefs/2026-10-09-1455-graph-triples-rebuild.md` | 新增（**治理产物**） | task brief（6 核心字段 + `#CRITERIA: A`） |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` | 新增 | 本证据件 |
| `src/store/migrations/004-graph-triples-rebuild.ts` | 新增 | 迁移 004：整表重建到 canonical（事务内；幂等；双形态鲁棒；fail-closed） |
| `src/store/migrations/004-graph-triples-rebuild.test.ts` | 新增 | 16 例：搬运/回填/幂等/边界/视图/事务回滚/版本门控/L2 读写/同形守卫/V4 |
| `src/store/schema-migration.ts` | 改 | 注册 004 + `SCHEMA_VERSION` 4 → 5 |
| `tests/store/schema-migration.test.ts` | 改 | 版本钉 4 → 5（**该钉的存在意义就是迫使新增迁移显式确认**） |
| `tests/store/metric-readings-schema.test.ts` | 改 | 同上 |
| `tests/store/migrations/003-orgs.test.ts` | 改 | 同上（003 自身 `version: 4` 不变） |

**PR 预算口径**：计入预算 **7 文件**（治理产物 2 件不计）+ **单域** `src/store` + `tests/store` ⇒ 满足 PR ≤12 文件 + 单域。
`git status --porcelain=v1` 落定后**为空**（工作区干净）。

**未碰**：`scripts/audit/**`、`extensions/ontology/edge-types/**`、`src/cron/**`、`src/loops/**`、
`src/adapters/sqlite-graph-store.ts`（在飞 PR #1424）。

### 5.1 本地门禁（pre-commit 13 组）原始结果

```
── 组 1/13: 类型安全 + 硬编码数据 ──
── 组 2/13: 测试质量 ──
── 组 3/13: Secrets ──
── 组 4/13: 接线完整性 ──
── 组 5/13: 架构边界 + 桥接文件 ──
── 组 6/13: Task Brief (6 核心字段) ── ✅ 声明闸① / ✅ 声明闸③
── 组 7/13: 架构合规 ── ✅
── 组 8/13: 文件驱动架构完整性 (V3.9) ──
── 组 9/13: 契约门禁 ──
── 组 10/13: V3 流水线健康度 ──
── 组 12/13: Task Scope 一致性 ── ✅ 声明闸②
── 组 13/13: 技能同步一致性 ──
✅ 全部 13 组通过
✅ Commit 格式正确 + 含 issue 引用
```

**两次被门禁抓到的真实问题（留痕，非抹平）**：

1. **组 4 接线完整性**：首版 `export const CANONICAL_TRIPLES_COLUMNS` **未被任何 `src/` 引用**（只有测试用）
   ⇒ 修法：**去掉 export** 并让它在迁移内**落地承重**（重建 INSERT 的列清单由它生成），测试改用本文件自持的
   `EXPECTED_CANONICAL_COLUMNS` 规格常量 + 保留【同形守卫】与 adapter `SCHEMA_SQL` 解析结果比对。
2. **组 12 Task Scope**：brief 首版命名为 `1455-graph-triples-rebuild.md`（**无日期前缀**）
   ⇒ 组 12 的 `ALL_TODAY_BRIEFS` 按**文件名日期前缀**取当日 brief ⇒ 我的 brief 不在池 ⇒ 两个 `.ts` 被判"不在 Q2 范围内"。
   ⇒ 修法：重命名为 `2026-10-09-1455-graph-triples-rebuild.md`（与仓库既有 `2026-10-08-1053-*` 同惯例），
   同步 claim writeset 与 `.claude/current-brief`；复跑后 13/13 全绿。

> 这两条是**门禁真抓到的缺陷**（首版 commit 在本地软提示下曾放行，CI 会硬阻断）——记录以备 K3 复查修法是否到位。

---

## §6 未决项（**合并/落地前必须处置**）

### U1 🔴 静默降级（不许本卡顺手修）
`queryEdges` 的 catch 是 `log.warn` + **返回 `[]`，无任何 `degraded` 标记** ⇒ 按铁律 11/31 属**静默降级**：
调用方**无法区分**「真的没有边」与「查询失败」。§4.1 态2 即此机制：读面"绿"实为失败被吞。
**建议**：独立卡（`src/adapters/sqlite-graph-store.ts` 被在飞 **PR #1424** 占用 ⇒ 同文件双写者，本卡**不碰**）。
**归属**：CTO 派单决定（本卡只登记，不扩写集）。

### U2 🔴 DDL 待 CTO 逐字批（schema 面，本卡只做本地准备）
`graph_triples` 的**形状**（PK 类型 + 列集合）属 schema 面 ⇒ 按 **003-orgs 先例「schema 归 CTO，逐字实施」**，
本迁移 DDL **落地前须 CTO 逐字批**。待批清单：

1. `id TEXT PRIMARY KEY`（把真机 `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 canonical 声明形）
2. 属性列 `props TEXT NOT NULL DEFAULT '{}'`（值由 `props_json` 搬运）
3. **移除**真机多出列 `confidence` / `source` / `props_json`（按 canonical 定义）
   —— 🔴 真机 `graph_triples` 当前 **0 行**，移除重建的实现是先重建后搬数据，移除本身**无数据损失**；
   但只要表里有行，`confidence`/`source` 的取值就会**被丢弃**（`props_json` 的值已搬进 `props`，不丢）
4. 搬运规则：`id CAST AS TEXT`（保身份稳定，不重造 id）；`props_json → props`（空串/NULL 视同未设置 → `'{}'`，与 001 同语义）；
   `valid_from` 缺失时回退 `created_at`，再回退 `now()`
5. 5 索引名与定义逐字对齐 `SCHEMA_SQL:52-56`

### U3 🔴 `graph_nodes` 形状差异：**已实测，本卡不修**（队长裁 ①，硬要求声明）
真机 `graph_nodes` DDL 与 canonical **亦不同**：真实为**复合主键** `PRIMARY KEY (id, graph)`、
**缺 `valid_from`**、多 `confidence` + `updated_at`（canonical 是单主键 `id TEXT PRIMARY KEY` + `valid_from NOT NULL`）。
**但实测：`createNode()` 在该 DDL 上写通、节点读面被迁移 001 治好 ⇒ 今天不红** ⇒ 按「卡面授权只修实测到的失败，
无失败 = 无理由」**不重建**（重建一张当前可用的表 = 纯风险无实测收益）。
**建议另立卡**跟踪（形状不一致本身是技术债）。

### U4 V1 端到端复测（一轮真哨兵跑）
见 §3 注记：完整哨兵轮未跑，机制级读数已完成。建议自验员/CTO 收件闸在**真机快照**上补跑一轮，
以闭合 V1 字面口径。

### U5 🔴 同域双作者协调项：`origin/feat/D967a-measurements-store`
- `db7f0503f`（2026-09-25，**未并入 main**，ahead=2/behind=2）含 `src/store/migrations/002-graph-triples-rebuild.ts`
  （同表整表重建）+ 改 `src/store/schema-migration.ts` + `tests/store/schema-migration.test.ts` ⇒ **与本卡写集重叠**
- 其迁移编号 `002`/`003` 与 main 现行 `002-metric-readings`/`003-orgs` **逐号冲突 ⇒ 已 stale**，原样无法合并，若复活须重编号
- **本卡不移植该提交**：理由 = ① 上条编号撞号（硬）② 自写纪律（独立实现 + 以本卡 A/B·四态夹具自证）；
  004 由本卡独立实现
- 🔴 **更正留痕（本证据件初稿的错误陈述，已撤回，不抹平）**：初稿写「其 diff 含 `.claude/bypass.log | 1 +`
  （该分支用过 `--no-verify`）⇒ 不作移植来源」。**该判断是错的。** 实测：
  ```
  （D967a 提交 db7f0503f 对 .claude/bypass.log 的新增行）
  +2026-09-25T23:32:51+08:00 | BLOCKED | pre-commit FAIL (exit 1) | TASK_ID=D967 | AGENT=coder-a
  （其后续提交 2017a9cf4 的新增行）
  +2026-09-25T23:37:14+08:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=db7f0503f849e5f9c651861f5921c43038ac2bfe
  ```
  ⇒ 这是「**被门禁拦下 + 随后合规通过**」，**不是绕过**。
  **错误根因**：由**文件名** `bypass.log` 推断语义，**未读文件内容** —— 与「grep 型静态判据当验收」同类。
  实测该文件是**门禁事件总账**（分支 tip 1811 行：COMMITTED 1399 / BLOCKED 162 / GATE_FAIL_SOFT 98 /
  DEGRADED 52 / TIMEOUT 3 / CLARIFIED 1）；真正的 `detected-bypass` 行仅 21 条且均属更早历史
  （最早 2026-07-26），**不在 D967a 的提交里**。
- **需 CTO 裁**：`graph_triples` 这张表的后续演进归谁（避免双写同表）

### U6 分支名与实现口径
分支名 `fix/1455-graph-triples-props` 为**派单指定**，实现已演进为**整表重建** ⇒ 名不副实（未 push，改名零风险）。
**本卡保留原名以免与队长/看板记录漂移**，是否改名请 CTO 裁。

### U7 派单前提「50 次」的口径
卡面 §② 的 50 次取自 #1432 首跑烟测。本件在真机形态夹具上**同值复现**（§4.3）但**非同一轮次**
⇒ 作为"同症状同量级机制复现"采信，不作"同一轮次复测"声称。

---

## §7 环境与取证限制（K3 必读）

| 项 | 事实 |
|---|---|
| 🔴 GitHub 封禁 | **账号级**：`gh api user`/`rate_limit` → 403 `Sorry. Your account was suspended`（3 次同错）；SSH `ls-remote` → exit 128 同因。⇒ **`gh issue view`、136 open PR 扫描、推送、开 PR、`ls-remote` 回执全部不可执行**。卡面镜像由队长经匿名只读获得：`.k4-cards/card-1455.md`（comments_count=0，无评论遗漏） |
| 冲突扫描降级 | 用 `git log --all --source` 单遍扫全部 1048 个本地 ref 替代"136 open PR"扫描；命中见 §6-U5 |
| `sqlite3` CLI | **本机不存在**（队长核实）⇒ 全部 PRAGMA/快照改用 **`python3` 内置 `sqlite3`**（3.13.13），并显式标注替换 |
| Node ABI | 本件全部测试跑在 **Node v24.16.0（modules=137）**；仓库内 D589 README 记有「better-sqlite3 编译于 Node 22 ⇒ Node 24 出 350 假败」的**历史**环境注记 ⇒ **环境先行声明**：本件 `tests/store` 12 文件 107 例全绿，未出现 ABI 假败；若 K3 在他机复跑，请先核 ABI |
| 真机库漂移（**两时点皆记，不抹平**） | 时点1（03:32 只读探测）= `graph_nodes` **9 列无 props**、**无 `schema_version` 表**；时点2（03:40）= `graph_nodes` **10 列含 props**、`schema_version=[2,3,4]`（updated_at `2026-10-08 19:34:59`）。定性：队长裁 #1057 时准过对真机库走生产路径 ⇒ `SqliteGraphStore` 构造函数自带 `reconcileSchema` 的副作用使 001 在生产库执行。**本 session 全程只用 `mode=ro` 只读连接 + `sqlite3.backup` 快照副本，未写原库** |
| 重型验证串行 | 本件只跑**定向** `tests/store`（107 例，≈3.4s）；**全量 vitest 未跑**（属重型验证，由自验员串行执行） |

---

## §8 复核命令（K3 可逐条重跑）

```bash
# 环境（Git Bash 必需，否则 .git/hooks 静默 fail-open）
export PATH="/c/Program Files/Git/bin:$PATH"
cd /d/novis-backup-20260526/Novis/.synova-wt-1455

# ① 定点测试（16 例含 V4 判别性夹具）
npx vitest run tests/store/migrations/004-graph-triples-rebuild.test.ts

# ② 域内回归（107 例）
npx vitest run tests/store

# ③ 前提复跑日志（227 行，含真机库两时点 + 冲突扫描）
cat .k4-publish/premise-rerun.log

# ④ 真机库只读复测（勿写原库；先备份快照）
python3 -c "import sqlite3;c=sqlite3.connect('file:D:/novis-backup-20260526/Novis/synova-agent/data/synova.db?mode=ro',uri=True);print([r[1] for r in c.execute('PRAGMA table_info(graph_triples)')])"
```

---

## §9 自验结论（本件**不是**"审计通过"）

- **可提请独立审计**：实现 + 判据原始输出 + 证据件齐备，`tests/store` 107/107 绿，V4 判别性夹具常驻。
- **未合并**：按小队红线「K3 复审通过前不得合并」；且 GitHub 封禁期无法开 PR。
- **未声称**：不声称"端到端 V1 已闭合"（见 §6-U4）、不声称"audit passed"、不声称「越用越准/进化」。
- **未决项 7 条**（§6 U1–U7）全部显式登记，其中 U1/U2/U3/U5 为**合并前须处置**。
