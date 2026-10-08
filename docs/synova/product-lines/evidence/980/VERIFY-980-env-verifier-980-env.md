# VERIFY-980-env · 环境变通（better-sqlite3）+ 副作用/地雷独立自验

- **任务号**：#980 / task-4
- **自验员**：verifier-980-env（独立于编码员 A/B 与队长；本席未参与任何被验对象的编写）
- **工作树**：`D:\novis-backup-20260526\Novis\.synova-wt-980`（分支 `feat/win-0-6-schema-degraded`）
- **快照时刻**：`2026-10-08 02:02:47 +0800` ~ `2026-10-08 02:04:21 +0800`（UTC `2026-10-07T18:02:47Z` ~ `18:04:21Z`）；**02:04:20 为终态基线**
- **只读声明**：本席未修改/未删除/未新建任何仓库文件，**唯一写入** = 本文件。未跑 vitest，未 `git stash`/`--no-verify`，未 commit/push。全部临时脚本与临时库落 `%TEMP%`（= Git Bash `/tmp`）。
- **本席不给「通过 / 不通过」**：下文只给「命令原文 + 退出码 + 原始输出 + 事实判定（可信 / 不可信 / 无法证实）」。

> 目录：§1 二进制来路｜§2 ABI 一致性｜§3 能力面｜§4 风险判定｜§5 副作用基线｜§6 thresholds 哈希｜§7 工作树外污染｜§8 `.git` 侧｜§9 与队长/卡面陈述不符｜§10 无法证实清单｜§11 本席自有残留｜§12 在制品 vs 可疑污染｜§13 未解决项

---

## §1 二进制来路（可信）

### 1.1 位置 / 字节 / 哈希

```powershell
$wt='D:\novis-backup-20260526\Novis\.synova-wt-980'
Get-Item  "$wt\node_modules\better-sqlite3\build\Release\better_sqlite3.node"
Get-FileHash <同上> -Algorithm SHA256
```
```
PATH   = D:\novis-backup-20260526\Novis\.synova-wt-980\node_modules\better-sqlite3\build\Release\better_sqlite3.node
BYTES  = 1908224
SHA256 = BCCD88B5074C5BF2C23706E343F1E8F449D260E9124C86C9D4FAD3B87E3D3E39
mtime  = 2026-07-28 22:05:41.135
ctime  = 2026-10-08 01:59:02.429
[exit=0]
```

`ctime` 落在 `install-deps` 跑完（见 §4.4，`/tmp/install-deps-patch.log` mtime `01:56:23`）之后，`mtime` 保留为 2026-07-28 —— 与"用 `Copy-Item` 类操作复制进来、保留源文件 mtime"的形态一致。

### 1.2 全机比对：同哈希副本不止一处

```powershell
Get-ChildItem 'D:\novis-backup-20260526' -Recurse -Filter 'better_sqlite3.node' -Force -Depth 6 |
  ForEach-Object { "$(package.json 的 version)`t$(Get-FileHash $_ -Algorithm SHA256)" }
```
```
12.11.1   BCCD88B5074C5BF2C23706E343F1E8F449D260E9124C86C9D4FAD3B87E3D3E39   .synova-wt-980\node_modules\better-sqlite3\...   ← 本工作树（被验对象）
11.10.0   BCCD88B5074C5BF2C23706E343F1E8F449D260E9124C86C9D4FAD3B87E3D3E39   synova-agent\node_modules\better-sqlite3\...     ← 主树（[main]）
11.10.0   BCCD88B5074C5BF2C23706E343F1E8F449D260E9124C86C9D4FAD3B87E3D3E39   synova-wt-d358\node_modules\better-sqlite3\...
11.10.0   E3B02D0A576549247A9641486B6D3ACEF9FC6C591F58F05B9D2D0E7288E3ADE7   Novis\box\...
11.10.0   F2DEA3C9CAD8A6FEAEDC4F5C67F1CF64FBEAD912DD619FDD2A47E2093EB47C60   Novis\server\...
11.10.0   27EBDC0B3B1D03026D26ADFCEE8CD4983EFFCEDD8DADCE78677DB349C63658BB   Synova-Engine\...
11.10.0   E8EAF45301F2C2947FB4CCFE4D09B6B4029D58F9A658CF5C4A9F675EAC48B018   synova-session-02\...
11.10.0   A4E5FD476D25E38741386EB759650DF05AFD0C74560CC305292F2269FBEA58   synova-session-04\...
[exit=0]
```

主树身份由 git 自证：
```bash
cd /d/novis-backup-20260526/Novis/.synova-wt-980 && git worktree list
```
```
D:/novis-backup-20260526/Novis/synova-agent                                    1a1cccc8f [main]
D:/novis-backup-20260526/Novis/.synova-wt-980                                  c231d80e8 [feat/win-0-6-schema-degraded]
...（其余 37 条略）
[exit=0]
```

**判定（可信，附限定）**：本树 `.node` 与 **主树 `synova-agent`（11.10.0）字节完全相同**，`mtime` 亦相同（`2026-07-28 22:05:41`）。
**限定**：哈希**不能**在 `synova-agent` 与 `synova-wt-d358`（二者同为 11.10.0 + 同哈希 + 同 mtime）之间唯一确定复制源；"来源 = 主树"是强旁证、非唯一证明。

### 1.3 版本对照：wrapper 12.11.1 装的是 11.10.0 的库

```
WT node_modules\better-sqlite3\package.json  "version": "12.11.1"
MT node_modules\better-sqlite3\package.json  "version": "11.10.0"
[exit=0]
```
两棵树的 `package-lock.json` 都把 `node_modules/better-sqlite3` 解析到 **12.11.1**（`"resolved": ".../better-sqlite3-12.11.1.tgz"`）→ **主树自身的 `node_modules` 是陈旧安装**（与其 lock 不符）；本树 `npm ci` 按 lock 装的是 12.11.1 的源码与 JS 封装。

### 1.4 决定性判别：库版本 ≠ 本树源码编译期版本

```bash
# 本树（12.11.1）源码自带的头文件
WT: node_modules/better-sqlite3/deps/sqlite3/sqlite3.h  ->  #define SQLITE_VERSION  "3.53.2"
MT: node_modules/better-sqlite3/deps/sqlite3/sqlite3.h  ->  #define SQLITE_VERSION  "3.49.2"
[exit=0]
```
```bash
node verify-980-env-dlopen.js <target>
```
```
### A) 工作树（借用 .node / js wrapper 12.11.1）
  [dlopen] \\?\D:\novis-backup-20260526\Novis\.synova-wt-980\node_modules\better-sqlite3\build\Release\better_sqlite3.node
  pkg.version      = 12.11.1
  sqlite_version() = 3.49.2
  sqlite_source_id = 2025-05-07 10:39:52 17144570b0d96ae63cd6f3edca39e27ebd74925252bbaf6723bcb2f6b4861fb1
[exit=0]
### B) 主树 synova-agent（原生 11.10.0 自洽对）
  [dlopen] \\?\D:\novis-backup-20260526\Novis\synova-agent\node_modules\better-sqlite3\build\Release\better_sqlite3.node
  pkg.version      = 11.10.0
  sqlite_version() = 3.49.2
  sqlite_source_id = 2025-05-07 10:39:52 17144570b0d96ae63cd6f3edca39e27ebd74925252bbaf6723bcb2f6b4861fb1
[exit=0]
### C) synova-wt-d358（同为 11.10.0）
  [dlopen] \\?\D:\novis-backup-20260526\Novis\synova-wt-d358\node_modules\better-sqlite3\build\Release\better_sqlite3.node
  pkg.version      = 11.10.0
  sqlite_version() = 3.49.2   （source_id 同 B）
[exit=0]
```

**判定（可信）**：实际 `dlopen` 的确实是本树 `build/Release/better_sqlite3.node`（`process.dlopen` 打点直证）。
**判定（可信）**：该 `.node` 携带的 SQLite 是 **3.49.2**，而**本树源码要求的是 3.53.2** ⇒ **该二进制不是本树源码的编译产物**，与"从别处搬来一个同 ABI 的旧库"完全吻合。
**判定（可信）**：`node_modules/` 被忽略，借用物**不会**进 git：
```
check-ignore: .gitignore:1:node_modules/   node_modules/better-sqlite3/build/Release/better_sqlite3.node   [exit=0]
tracked under node_modules = 0
```

---

## §2 ABI 一致性（可信）

```powershell
node -v
node -e "console.log('process.versions.modules =', process.versions.modules)"
```
```
v24.16.0
process.versions.modules = 137
node = v24.16.0
platform/arch = win32 x64
[exit=0]
```

`require` + 建表 / 插入 / 查询（原始输出）：

```
=== E1 module identity ===
  js-wrapper pkg.version = 12.11.1
  require(worktree better-sqlite3) = OK, typeof = function
  dlopen .node path(s) = []            ← 本探针用的 Module._extensions 钩子在 Node 24 下未触发；
                                          改由 process.dlopen 直证（见 §1.4 A 段）
=== E2 basic handle + sqlite fingerprint ===
  sqlite_version() = 3.49.2
  pragma journal_mode=WAL result = wal
  pragma journal_mode (read back) = wal
=== E3 SCHEMA_SQL（逐字取自 src/adapters/sqlite-graph-store.ts:24-57）===
  [OK]   db.exec(SCHEMA_SQL) -> no throw
  [OK]   graph_nodes columns -> id,graph,type,name,props,created_at,valid_from,valid_to
  [OK]   graph_triples columns -> id,graph,subject_type,subject_id,predicate,object_type,object_id,weight,props,created_at,valid_from,valid_to
=== E4 reconcileSchema 等价语句（src/store/schema-migration.ts:51-88）===
  [OK]   CREATE TABLE schema_version -> no throw
  [OK]   SELECT version ... LIMIT 1 -> .get()
  [OK]   INSERT INTO schema_version (version) VALUES (?) -> 1
=== E5 SqliteGraphStore 真实语句（createNode / getNode / queryNodes）===
  [OK]   INSERT INTO graph_nodes (id, graph, type, name, props) VALUES (?,?,?,?,?) -> 1
  [OK]   getNode: SELECT ... WHERE id = ? AND graph = ? AND valid_to IS NULL -> {"id":"node-probe-1","type":"CLIENT","props":"{\"name\":\"probe\",\"tier\":\"A\"}"}
  [OK]   queryNodes: ... WHERE graph = ? AND type = ? AND valid_to IS NULL -> 1 row(s)
  [OK]   queryNodes+filter: json_extract(props, '$.tier') = ? -> 1 row(s)
  [OK]   json_valid / json_extract scalar -> 2
=== E6 graph_triples INSERT（createEdge，9 参数）===
  [OK]   INSERT INTO graph_triples (...) VALUES (9 ?) -> 1
  [OK]   queryEdges: SELECT ... graph = ? AND predicate ... AND valid_to IS NULL -> 1 row(s)
=== E7 事务 / 软删除 / 批量 ===
  [OK]   db.transaction(bulk 1000 inserts).run -> rows=1000 ms=28
  [OK]   transaction rollback: threw "intentional-rollback", rb-1 rows=0
  [OK]   soft delete UPDATE graph_nodes SET valid_to = datetime('now') -> 1 changed
  [OK]   after soft delete, getNode returns undefined = -> undefined
  [OK]   SqliteError class on constraint violation -> threw SqliteError | instanceof Sqlite.SqliteError=true | code=SQLITE_CONSTRAINT_PRIMARYKEY
=== E8 旧库迁移路径（001-graph-nodes-props: ALTER TABLE + table_info）===
  legacy cols before = id,graph,type,props_json
  [OK]   ALTER TABLE graph_nodes ADD COLUMN props TEXT NOT NULL DEFAULT '{}' -> no throw
  [OK]   UPDATE graph_nodes SET props = props_json WHERE props_json IS NOT NULL AND props_json != '' -> 1 changed
  [OK]   backfilled props = -> {"k":"v"}
=== E9 WAL 文件族确认 ===
  files: ["verify-980-env-legacy.db","verify-980-env-probe.db","verify-980-env-probe.db-shm","verify-980-env-probe.db-wal","verify-980-env-probe.js"]
=== PROBE DONE ===
[exit=0]
```

**判定（可信）**：ABI = **137**，`require` 成功，建表 / 插入 / 查询 / 事务 / 回滚 / WAL / 迁移路径**全部实测通过**。跨版本"能加载"已被物理证实为**能工作**（在该调用面上）。

---

## §3 能力面（可信 + 1 处非缺陷的例外）

### 3.1 产品实际用到的 API 面（固定串计数，`src/` + `packages/ontology/src`，`*.ts`）

```
.pragma(                   11
.transaction(              1
.exec(                     102
.prepare(                  212
.aggregate(                2
.serialize(                9      （多数为非 sqlite 对象的 .serialize()；sqlite 侧未使用 db.serialize）
.raw( / .pluck( / .iterate( / .columns( / .expand( / .safeIntegers(    0
.function( / .table( / .backup( / .loadExtension( / .unsafeMode( / .defaultSafeIntegers(   0
journal_mode               5
json_extract               1
json_valid                 0
ALTER TABLE                21
CREATE INDEX               67
[exit=0]
```

### 3.2 全方法面实测（Statement + Database）

```
=== Statement 表面 ===
  [OK]   st.get(...) / st.all(...) / st.raw().all() / st.pluck().get() / st.expand().all()
  [OK]   st.columns() -> ["id","props"]
  [OK]   st.iterate() -> 2 rows
  [OK]   st.safeIntegers(true).get() -> bigint
  [OK]   st.source / reader / busy -> string,boolean,boolean
  [OK]   named params @x/:x -> {"a":1,"b":2}
=== Database 表面 ===
  [OK]   db.pragma("journal_mode = WAL", {simple:true}) -> wal
  [OK]   db.pragma("foreign_keys"|"table_info(graph_nodes)") -> 1 / 8 cols
  [OK]   db.function + 调用 -> 42
  [OK]   db.aggregate + 调用 -> 3
  [ERR]  db.table("graph_nodes") -> Expected second argument to be a function or a table definition object
  [OK]   db.serialize() 返回 Buffer -> Buffer len=12288
  [OK]   db.defaultSafeIntegers(true/false) -> bigint
  [OK]   db.inTransaction / open / memory / readonly / name -> {"inTransaction":false,"open":true,"memory":false,"readonly":false,"name":"...verify-980-env-wrapper.db"}
  [OK]   db.backup() -> totalPages=3 remainingPages=0 backupFile=12288 bytes
  [OK]   db.loadExtension(missing) -> threw SqliteError: 找不到指定的模块。
=== WRAPPER PROBE DONE ===
[exit=0]
```

**唯一 ERR 的归因（已排除跨版本缺陷）**——同一次调用在**主树 11.10.0 自洽对**下抛完全相同的 TypeError：
```powershell
node -e "...require('D:/.../synova-agent/node_modules/better-sqlite3')... db.table('t') ..."
```
```
threw TypeError: Expected second argument to be a function or a table definition object
[exit=0]
```
且 `src/` 内 `db.table(` 使用数 = **0**。⇒ 该 ERR 是 API 契约用法问题，**不是** 11.10.0/12.11.1 混搭产物。

**判定（可信）**：`SqliteGraphStore` 真正用到的语句（§2 E3–E8）+ 产品实际调用面（§3.1）**全部实测通过**。

---

## §4 风险判定（本席独立判断）

### 4.1 能证实的

| # | 事实 | 证据 |
|---|---|---|
| R-a | **JS 封装层的 addon 调用面两版几乎相同**：`diff -rq` 对 `lib/` 全目录，仅 `database.js` 一处差异 | `diff -u` 唯一 hunk：`if (!anonymous && !fs.existsSync(path.dirname(filename)))` → `... && !filename.startsWith('file:') && ...`；`lib/util.js`（含 `cppdb` Symbol 定义）**字节相同** |
| R-b | **原生 addon 的 JS 可见表面两棵树完全一致** | `getOwnPropertyNames(addon)` = `["Database","Statement","StatementIterator","Backup","setErrorConstructor"]`；`Database.prototype` = `["prepare","exec","backup","serialize","function","aggregate","table","loadExtension","close","defaultSafeIntegers","unsafeMode","constructor"]`；实例自有属性 = `["inTransaction","open","memory","readonly","name"]` —— WT 与 MT **逐字相同** |
| R-c | 已实测的调用面覆盖产品用量 | `.prepare(212 / .exec(102 / .pragma(11 / .transaction(1 / .aggregate(2 / json_extract / ALTER TABLE / CREATE INDEX` 全绿（§2、§3） |
| R-d | **历史已知崩溃形态在本机未复现**：`11.10.0 × Node 24` 的 fork-worker 退出断言、Statement 析构崩溃 —— 本席按该形态做了判别性复现 | 见 4.2 |

**R-d 复现设计与结果**（探针 `verify-980-env-worker-exit.js`，`--expose-gc`）：
```
=== W1 worker_threads × 借用 .node（Node v24.16.0） ===
  round 1 -> [OK]  {"rows":500,"sqlite":"Database"}
  round 2 -> [OK]  {"rows":500,"sqlite":"Database"}
  round 3 -> [OK]  {"rows":500,"sqlite":"Database"}
=== W2 child_process.fork × 借用 .node ===
  round 1 -> [OK]  {"rows":500}
  round 2 -> [OK]  {"rows":500}
  round 3 -> [OK]  {"rows":500}
=== W3 主进程 GC 压力后退出（Statement 析构面） ===
  rows=2000
  db.close() 完成
=== WORKER-EXIT PROBE 到达文件末尾（未崩溃） ===
[exit=0]
```
（每轮：建表 + 500 行事务写 + 读回 + `db.close()`；主进程另做 3000 次 `prepare().get()` + 2000 行事务 + 强制 GC。）

### 4.2 无法证实的（**必须连同 4.1 一起读，不得单独引用 4.1 结论**）

| # | 无法证实的内容 | 为什么 |
|---|---|---|
| U-1 | 该 `.node` 在**其他调用面**下的正确性 | 它携带的 SQLite 是 **3.49.2**，本树源码预期 **3.53.2**（差 4 个 minor）。本席只覆盖了 §3.1 的用量，**未逐项核对 SQLite 3.49.2→3.53.2 的行为变更/修复项**，未覆盖的 SQL 语义差异本席**无从否定** |
| U-2 | 长时运行 / 多进程并发 / 大批量 / 与其他 native 扩展共存 | 未测 |
| U-3 | "本机 6/6 未复现"能否外推 | 仓库内历史崩溃记录均发生在 **macOS / arm64**（路径 `/Users/wane/...`、prebuild `darwin-arm64`）；本机为 **win32 x64**。本机不复现**不等于**该组合在别的平台安全 |
| U-4 | 跨版本混搭是否已在别处踩过 | 有**同类前科**（见 4.3），但 `11.10.0 addon × 12.11.1 wrapper` 这一**具体组合**，仓库内**无**既有实测记录 |

### 4.3 必须随报告转呈的历史黑字（仓库内可核，file:line）

> 以下为**仓库既有记录**，非本席推断；它们把"11.10.0 × Node 24"标为**已知风险组合**：

1. `docs/synova/audit-reports/2026-08-28-D483-D484-D486.md:96-102`
   「K3 工作区 better-sqlite3 版本 / Node 24 表现 … **根因: K3 工作区 node_modules 陈旧（11.10.0），主仓已 12.11.1** … 本问题即已知任务 **D462（better-sqlite3 v12 升级 Node 24 兼容）** 范畴」
2. `docs/synova/audit-reports/2026-08-22-P1-gs-deploy-u.md:37`
   「D462 | better-sqlite3 v12（**Node 24 崩溃根因，WiseLibs#1376**）」
3. `docs/synova/audit-reports/2026-09-08-K3-seven-task-batch-closeout.md:18`
   「better-sqlite3 **11.10.0**：Node 24 下 fork worker 退出时 `Assertion failed: (env) != nullptr` 崩溃（Node 24 cleanup-hook 已知不兼容）」
4. `docs/synova/audit-reports/2026-08-25-D527-D528-slice-c.md:80`（P2-3）与
   `docs/synova/product-lines/evidence/issue962-S2-最小真实路径-20261004.md:43,56,77`（`Statement::~Statement()` native stack）

**落点**：本工作树 **包装层已升到 12.11.1（D462 的目标形态），原生库却被换回 11.10.0** —— 即把 D462 明确要修掉的那一半又放了回来。本席在本机 Windows x64 上**没能复现**其崩溃（4.1 R-d），但该组合落在**已登记的风险坐标内**，且本席**没有** Mac 侧的等价实测。

### 4.4 关于"install-deps 失败"这一前提的取证

```powershell
Get-Content %TEMP%\install-deps-failed.txt        -> FAILED_PKG=better-sqlite3
Get-Content %TEMP%\install-deps-rebuild.log       -> > electron@33.4.11 postinstall / > node install.js / rebuilt dependencies successfully
Get-Content %TEMP%\install-deps-patch.log         -> patch-package 8.0.1 / Applying patches... / ink@5.2.1 …
mtime: npmci.log 01:53:31 / failed.txt 01:53:41 / rebuild.log 01:56:21 / patch.log 01:56:23
```

- **能证实**：「`better-sqlite3` 被记为重建失败包」→ 可信（`FAILED_PKG=better-sqlite3` 就是 `scripts/control-tower/install-deps.sh:126` 在 `npm rebuild` 失败分支写的）。
- **不能证实**：**失败原因是 gyp 编译失败**。`install-deps.sh:123` 用 `>` 重定向到**同一个** `/tmp/install-deps-rebuild.log`，循环里每个包都覆盖一次 —— 现存的 `rebuild.log` 内容是 **electron 的 postinstall**，`better-sqlite3` 的那次 gyp 输出**已被覆盖、不可复得**。
- **字符串层面**：脚本实际格式（`install-deps.sh:147`）是 `INSTALL-DEPS: VIOLATION(1)  [${FAILED}]`（`(1)` 与 `[` 之间是**两个空格**）。
- 另注：`/tmp/install-deps-npmci.log` 显示 `① npm ci --ignore-scripts` **成功**（`added 813 packages in 20s`）—— 失败发生在 ② 显式重建阶段，与 `install-deps.sh` 的三态设计一致。

---

## §5 副作用基线：工作树 `git status` vs `evidence-980-plan-preconditions.txt` P0 段（可信）

```bash
cd /d/novis-backup-20260526/Novis/.synova-wt-980
git status --porcelain -uall
```
```
 M .claude/reference-map.md
 M src/l4/sog-schema-validator.ts
?? docs/synova/product-lines/evidence/980/capture-980-probe.sh
?? docs/synova/product-lines/evidence/980/probe-diagnosis.ts
?? tests/l4/sog-schema-validator.integration.test.ts
?? tests/l4/sog-schema-validator.test.ts
[行数=6]     （快照时刻 2026-10-08 02:04:20 +0800）
```

### 5.1 逐字比对

| P0 段（capture 于 `2026-10-07T17:40:34Z`，5 行） | 本席现况（`02:04:20`，6 行） | 差异判定 |
|---|---|---|
| ` M .claude/reference-map.md` | ` M .claude/reference-map.md` | **一致**（内容已变，见 5.3） |
| ` M .../980/PLAN-980-0-6-schema-degraded.md` | *（已消失）* | **已提交**（`git diff origin/main...HEAD` 中为 `A`） |
| ` M .../980/capture-980-preconditions.sh` | *（已消失）* | **已提交**（同上） |
| ` M .../980/evidence-980-plan-preconditions.txt` | *（已消失）* | **已提交**（同上） |
| `?? .../980/VERIFY-980-plan-verifier-980.md` | *（已消失）* | **已提交**（同上） |
| — | ` M src/l4/sog-schema-validator.ts` | **新增**：编码 A 在制 |
| — | `?? .../980/capture-980-probe.sh` | **新增**：编码 B 在制 |
| — | `?? .../980/probe-diagnosis.ts` | **新增**：编码 B 在制 |
| — | `?? tests/l4/sog-schema-validator.test.ts` | **新增**：编码 A 在制 |
| — | `?? tests/l4/sog-schema-validator.integration.test.ts` | **新增**：编码 A 在制 |

**差异性质**：4 条"消失"= **被提交**（P0 之后 `HEAD` 前进），非丢失；5 条"新增"= **本卡在制品**（见 §12）。**P0 未记录任何 `src/` 改动，现况出现了 1 条 `src/` 改动 → P0 基线已过期**（这是本卡推进的必然结果，非污染）。

### 5.2 HEAD 位移

```bash
git rev-parse HEAD          -> c231d80e813a687526ac57085de285bb11be3424
git rev-parse origin/main   -> 44d4a721bacc26bb840860a2c595a56ceb821587
git log --oneline -3
c231d80e8 Merge remote-tracking branch 'origin/main' into feat/win-0-6-schema-degraded
44d4a721b Merge pull request #1332 from synova-agent/evidence/0gate-20261008
61696dabe Merge pull request #1287 from synova-agent/feat/D1220-da2-second
[exit=0]
```
P0 记录 `HEAD = 2f3044dc3c5be2d74377f3ccf00d664302fcfda2`；现况 `c231d80e8` ⇒ **P0 的 HEAD 口径已失效**，做逐字比对时必须带时刻。

### 5.3 HEAD 相对 `origin/main` 的改动（全部治理产物，无 `src/`）

```
A  .claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md
A  docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md
A  docs/synova/product-lines/evidence/980/RECEIPT-980-plan-20261008.md
A  docs/synova/product-lines/evidence/980/VERIFY-980-plan-verifier-980.md
A  docs/synova/product-lines/evidence/980/capture-980-preconditions.sh
A  docs/synova/product-lines/evidence/980/evidence-980-plan-preconditions.txt
A  memory/notes/proposed/2026-10-08-0-6-schema-degraded-visibility.md
7 files changed, 1186 insertions(+)
[exit=0]
```
> 注意：**本文件 `VERIFY-980-env-verifier-980-env.md` 不在上表内**（本席写它时尚未提交）—— 属本席写集，需由队长按 M6 收口。

### 5.4 唯一的 tracked 改动 `.claude/reference-map.md`

`git diff --stat` = `1 file changed, 72 insertions(+), 2 deletions(-)`；内容是 `grep-refs.sh`（hook）为 `validateNodeProps` / `validateAndLog` / `sog-schema-validator` / `ValidationError` / `NODE_SCHEMAS` / `createGraphBridge` 生成的引用表，D 路径全部指向本工作树。**判定**：hook 自动产物（P0 已登记该文件为 modified），**非可疑污染**。

---

## §6 6 个 `thresholds.json` 哈希 vs P9 段（可信，两次复算）

```bash
for f in financial-services general-enterprise manufacturing retail-ecommerce saas-tech test-write; do
  git hash-object "extensions/industries/$f/thresholds.json"; done
```
```
[daba78f030cd95cf11ade1c0421f1a4970e8ce6d]  financial-services
[bb1e98162b3bb4f5a977a2eec5877b515a286b4e]  general-enterprise
[f7ad5be81922d66899efe8583951562a567d3504]  manufacturing
[16b5bdec888c4c14a08537914dd054ab3599847d]  retail-ecommerce
[b0ec2ecf0b64e96357f054cb0ba8c250dc87266c]  saas-tech
[7926e3ec906980e38a60e64c597210dc16903655]  test-write
[exit=0]
```
P9 段（`evidence-980-plan-preconditions.txt:105-110`）逐字：

```
daba78f030cd95cf11ade1c0421f1a4970e8ce6d  extensions/industries/financial-services/thresholds.json
bb1e98162b3bb4f5a977a2eec5877b515a286b4e  extensions/industries/general-enterprise/thresholds.json
f7ad5be81922d66899efe8583951562a567d3504  extensions/industries/manufacturing/thresholds.json
16b5bdec888c4c14a08537914dd054ab3599847d  extensions/industries/retail-ecommerce/thresholds.json
b0ec2ecf0b64e96357f054cb0ba8c250dc87266c  extensions/industries/saas-tech/thresholds.json
7926e3ec906980e38a60e64c597210dc16903655  extensions/industries/test-write/thresholds.json
```

**判定（可信）**：**6/6 逐字一致**，两次复算（`02:03:41` 与 `02:04:20`）结果相同；`git status` 亦未把任何 `thresholds.json` 列为修改 ⇒ **无 R28 前例型改写**。
旁证：`%TEMP%\synova-980-probe-out\20261008-020352\hashes-before.txt` 与 `hashes-after.txt` 亦相同（`hashes-diff.txt` **0 字节**），其 `sha256sum` 值与上表同批文件的 sha256 一致：
```
2e71fae85f1674ed326dc22f8829a99930c3435163438d9ed3727a853613e7a7 *extensions/industries/financial-services/thresholds.json
e788884b942858b66b856a1fe83b62f476331254c4b2ffd5cb021332b92cbb72 *extensions/industries/general-enterprise/thresholds.json
424e913e2dd3c7724e117a17e736e2900d5c4492a3bf7b71ba54a1a749e6316d *extensions/industries/manufacturing/thresholds.json
32e52162a40036100e18ddefe177242e5ba3ae24aba538a330f1e335e06d4d0c *extensions/industries/retail-ecommerce/thresholds.json
226580f686c30c4ddb6700f83b3bc8825855442dbe25bf179520eaf1585344bc *extensions/industries/saas-tech/thresholds.json
43ec789b79a3f5ac91794d36f81b9f7afd1565d81ff7b49ff5a6206474083aea *extensions/industries/test-write/thresholds.json
```

---

## §7 工作树外污染（可信）

### 7.1 工作树内 `*.db` / `*.sqlite*`

```bash
find . -path ./node_modules -prune -o -path ./.git -prune -o -name '*.db*' -print
[命中=0]
```
**判定（可信）**：工作树内**零**数据库文件残留。

### 7.2 `%TEMP%`（= Git Bash `/tmp`，`cygpath -w /tmp` → `C:\Users\ADMINI~1\AppData\Local\Temp`）

```powershell
Get-ChildItem $T -Recurse -Filter 'probe.db*' -Depth 3   -> 0 命中
Get-ChildItem $T -Recurse -Filter 'org-980*'   -Depth 3  -> 0 命中
Get-ChildItem $T -Directory -Filter 'synova-980-probe-*' -> 1 命中:
  C:\Users\Administrator\AppData\Local\Temp\synova-980-probe-out   2026/10/8 2:03:52
    └ 20261008-020352\
        hashes-after.txt   714 B   02:04:05
        hashes-before.txt  714 B   02:03:55
        hashes-diff.txt      0 B   02:04:05     ← 空 = 跑前跑后阈值哈希一致
        probe-output.json 4867 B   02:04:04
        probe-output.txt  3153 B   02:04:02
        status-after.txt   280 B   02:04:05
        status-before.txt  280 B   02:03:53
        status-diff.txt      0 B   02:04:05     ← 空 = 跑前跑后 git status 一致
```

**判定（可信）**：
- **无** `probe.db` / `org-980` 之名的残留 —— 探针的临时库由 `probe-diagnosis.ts:69-83` 的 `process.on('exit', cleanup)` 负责删净；本席实测确认。
- `synova-980-probe-out\...` 是**有意的证据输出目录**（`capture-980-probe.sh:36` 的设计落点，仓库外），**不是**污染。
- `status-before.txt` / `status-after.txt` 各 280 B 且 `status-diff.txt` 为 0 字节 —— 两个文件内容本席已读，与 §5 的 6 行完全一致（同一快照时段）。

### 7.3 探针的写点审计（R28 关键：探针是否可能改仓库）

- `docs/synova/product-lines/evidence/980/probe-diagnosis.ts:60-66`：
  `runDir = join(tmpdir(), 'synova-980-probe-'+pid+'-'+uuid)`，并**显式守卫**：`resolve(runDir).startsWith(resolve(process.cwd())+sep)` → `DEGRADED: 临时库落点落在仓库内 — 拒绝执行` + `exit 2`。
- `capture-980-probe.sh:36-38`：`OUT_ROOT="${SYNO_980_OUT:-${TMPDIR:-/tmp}/synova-980-probe-out}"`，所有产物（含 stdout 副本、基线快照）均落该目录；脚本**只读**仓库（`git status` / `sha256sum`）。
- 本席通读两个文件全文，**未发现任何对 `extensions/`、`src/`、`docs/` 或任何仓库路径的写入**。

**判定（可信）**：「探针/测试只写 `/tmp`」这一纪律，在**代码层**与**跑前跑后基线 diff** 两侧均成立。

---

## §8 `.git` 侧（**有 2 处与卡面预期不符**）

### 8.1 `git stash list` —— **非空，28 条**（与卡面「必须空」冲突）

```bash
cd /d/novis-backup-20260526/Novis/.synova-wt-980 && git stash list | wc -l   -> 28
cd /d/novis-backup-20260526/Novis/synova-agent   && git stash list | wc -l   -> 28
git rev-parse --git-common-dir                                               -> .git
ls -la "$(git rev-parse --git-common-dir)/refs/stash"
  -> -rw-r--r-- 1 Administrator 197121 41 2026-08-03 12:15:23.559496000 +0800 .git/refs/stash
git reflog show refs/stash --date=iso | head -1
  -> 3c64d5adb refs/stash@{2026-08-03 12:15:23 +0800}: On feat/prompt-architecture: d312-workspace-misc
git reflog show refs/stash --date=iso | grep -c '2026-10-08'                 -> 0
git log -1 --format='%ci %H' refs/stash                                      -> 2026-08-03 12:15:23 +0800 3c64d5adb...
```

**归属判定（可信）**：
- 28 条 stash 属于 **`git-common-dir`**（主仓 `D:/novis-backup-20260526/Novis/synova-agent/.git`），worktree 与主树**看到同一份**（都是 28）；
- `refs/stash` 文件 mtime、最新 reflog 时间戳均为 **2026-08-03 12:15:23**；`grep -c '2026-10-08'` = **0**；
- ⇒ **不是本队产生**，是主仓**两个多月前的历史遗留**（条目内容指向 `feat/prompt-architecture` / `session/02..04` 等旧分支）。
- 本席**未执行**任何 stash 操作（禁项）。

### 8.2 tag —— `V5.2.1*` 命中**两条**（与卡面「只剩 `V5.2.1`」冲突）

```bash
git tag -l 'V5.2.1*'
V5.2.1
V5.2.13
[exit=0]

git for-each-ref --sort=-creatordate --format='%(creatordate:iso8601) %(refname:short)' refs/tags | head -5
2026-10-08 01:46:41 +0800 V5.2.13
2026-10-07 23:39:40 +0800 V5.2.9
2026-09-13 16:09:22 +0800 V5.2.8
2026-08-29 04:39:49 +0800 V5.2.7
2026-08-29 02:05:05 +0800 V5.2.6

git cat-file -t V5.2.13                          -> tag        （annotated）
tagger=synova-cto  subject=控制塔 V5.2.13（合并者补打：D-A 第二刀 #1287 合入）
git rev-parse refs/tags/V5.2.13                  -> 57a2dade2f7355ce2178d9f6d5850d7821440e1b
git rev-parse 'refs/tags/V5.2.13^{}'             -> 61696dabecb2660b2fe36de0ab22068bd36a524e
git ls-remote --tags origin 'refs/tags/V5.2.13*' 'refs/tags/V5.2.1'
  -> 60c4ae340ac94e884f6c6704b7040fc27ae23c93  refs/tags/V5.2.1
  -> 57a2dade2f7355ce2178d9f6d5850d7821440e1b  refs/tags/V5.2.13
  -> 61696dabecb2660b2fe36de0ab22068bd36a524e  refs/tags/V5.2.13^{}
git tag -l 'V5.2.11' | wc -l                     -> 0    （V5.2.11 确已不存在）
[exit=0]
```

**判定（可信）**：
- `V5.2.13` **本地对象 sha 与 origin 完全一致**（tag 对象 `57a2dade2f...`、peeled `61696dab...`）⇒ **不是本地孤儿 tag**，是 CTO 于 `2026-10-08 01:46:41` 打的**已同步**控制塔 tag；可达性：`origin/main`、本卡分支等。
- 但 `git tag -l 'V5.2.1*'` 这条**glob 写法**必然命中 `V5.2.13` ⇒ 卡面「只剩 `V5.2.1`」的**判据本身写错了**（要么改成 `git tag -l 'V5.2.1'` 精确匹配，要么把预期改为两条）。
- `V5.2.11` 删除一事：**可证实**（0 命中），但**无法证实**删除动作由谁/何时执行（reflog 不含 tag 删除记录）。

### 8.3 本地 tag 总量

```
git tag -l | wc -l   -> 38
```

---

## §9 与队长 / 卡面陈述不符处（编号 + 命令 + 原文 + 冲突点）

| # | 冲突点 | 命令 | 原文 | 判定 |
|---|---|---|---|---|
| **C-1** | 卡面称 `git stash list` **必须空** | `git stash list \| wc -l` | `28` | **不符**。但与「本队禁 stash」**不冲突** —— 28 条全部是 2026-08-03 及更早的主仓遗留（§8.1），非本队产生 |
| **C-2** | 卡面称 `git tag -l 'V5.2.1*'` **只剩 `V5.2.1`** | `git tag -l 'V5.2.1*'` | `V5.2.1` + `V5.2.13` | **不符**。`V5.2.13` 是 CTO 的 annotated tag，与 origin 逐字节同步（§8.2）。判据（glob 写法）本身有误 |
| **C-3** | 卡面把该二进制描述为「同 ABI 的 `better_sqlite3.node`」（隐含"仅 ABI 层面差异"） | `sqlite3.h` vs `sqlite_version()` | 源码预期 `3.53.2` / 实际 `3.49.2` | **不完整**。差异不止 ABI：**是跨源码版本借用**（11.10.0 的产物放进 12.11.1 的树）。且仓库内 `D462` 记录明确把「11.10.0 × Node 24」列为崩溃根因坐标（§4.3） |
| **C-4** | 卡面引述的失败输出 `INSTALL-DEPS: VIOLATION(1) [better-sqlite3]` | `install-deps.sh:147` / `%TEMP%` 残留 | 脚本格式为 `VIOLATION(1)  [`（**双空格**）；`rebuild.log` 已被 electron 覆盖 | **无法逐字核对**。「`better-sqlite3` 被记为失败」可信（`FAILED_PKG=better-sqlite3`）；「**gyp 编译失败**」**不可核**（原文已被覆盖） |
| **C-5** | 卡面 P0 段（5 行）作为现况基线 | `git status --porcelain -uall` | 6 行，且含 `src/` 改动 | **P0 已过期**（4 条已被提交、HEAD 从 `2f3044dc3` → `c231d80e8`）。属**预期推进**，非异常 |
| **C-6** | 该环境变通在**治理产物中零记录** | `grep -rn 'better-sqlite3\|better_sqlite3\|node-gyp\|gyp' docs/synova/product-lines/evidence/980/` | 7 命中，**全部**是探针自身的设计说明（`probe-diagnosis.ts:19/85/87/90/93/100`、`PLAN-980...:169`）；**无一条**描述「从别处搬入 11.10.0 的 `.node`」 | **证据缺失（M5）**。变通本身在 `%TEMP%` 只有零散日志，未落入仓库证据 |

---

## §10 无法证实清单（汇总）

1. **U-1** 借用 `.node` 在 §3.1 未覆盖的 SQL 语义面上的正确性（3.49.2 vs 源码预期 3.53.2，差 4 个 minor）。
2. **U-2** 长时运行 / 多进程并发 / 大批量 / 与其他 native 扩展共存下的稳定性。
3. **U-3** 本机（win32 x64 / Node v24.16.0）"6/6 未复现历史崩溃"能否外推到 **macOS arm64**（历史崩溃记录的发生地）。
4. **U-4** 「11.10.0 addon × 12.11.1 wrapper」这一**具体组合**的既有实测记录 —— 仓库内**无**。
5. **U-5** 复制源唯一性：无法在 `synova-agent` 与 `synova-wt-d358` 之间唯一确定（三者 hash + mtime 全同）。
6. **U-6** `install-deps` 失败的 **gyp 原文**（`/tmp/install-deps-rebuild.log` 被后续包覆盖，不可复得）。
7. **U-7** `V5.2.11` tag 删除动作的执行者与时刻。
8. **U-8** 未独立复跑 `npm rebuild better-sqlite3`（属"改环境"，且触发重型重建；本席按纪律未跑）。

---

## §11 本席自有残留声明（`%TEMP%`，可清理）

```
verify-980-env-probe.js               9447 B   02:01:09
verify-980-env-probe.db             184320 B   02:01:11
verify-980-env-legacy.db             12288 B   02:01:11
verify-980-env-dlopen.js               851 B   02:01:16
verify-980-env-addon-surface.js       1781 B   02:01:41
verify-980-env-wrapper-surface.js     4814 B   02:01:52
verify-980-env-wrapper.db            12288 B   02:01:53
verify-980-env-wrapper-backup.db     12288 B   02:01:53
verify-980-env-git.sh                 1929 B   02:02:05
verify-980-env-git2.sh                2915 B   02:02:20
verify-980-env-git3.sh                2029 B   02:02:45
verify-980-env-git4.sh                1541 B   02:03:24
verify-980-env-git5.sh                2074 B   02:03:39
verify-980-env-final.sh               1092 B   02:04:19
verify-980-env-post.sh               （02:06 落盘）
verify-980-env-worker-exit.js / verify-980-env-child.js / verify-980-env-worker-*.db / verify-980-env-child-*.db / verify-980-env-gc.db
```
全部落在 `%TEMP%`（仓库外）。**本席不主动删除**（避免误删他人产物）；是否清理由队长决定。

**同目录下**其他会话/成员的 `/tmp` 产物（**非本席**，仅登记归属以免被误算成"本队污染"）：
- `verify980\`（`q1.sh`..`q12.sh`、`demo980.mjs`、`grep980.sh`、`final.sh`，01:36–01:39）→ 自验 β 会话
- `h980.txt` / `r980.txt`（各 41 B）、`verify980_orig.ts` / `verify980_v5mut.ts` / `verify980_altmut.ts` / `verify980_keys.txt` / `verify980_slashtypes.txt` / `probe_sim.txt` → 同上
- `synova980\`（`run.sh` / `sqlite-check.cjs` / `red.sh`，02:00–02:02）→ 队长 / 编码侧 scratch harness（`run.sh` 内注释自述 "scratch harness: run a command inside the #980 worktree"）
- `install-deps-npmci.log` / `install-deps-failed.txt` / `install-deps-rebuild.log` / `install-deps-patch.log` → `install-deps.sh` 的固定落点（脚本硬编码 `/tmp/install-deps-*`）
- `synova-980-probe-out\` → 编码 B 的探针证据目录（有意产物）

---

## §12 在制品 vs 可疑污染

### 12.1 预期中的在制品（`02:04:20` 快照）

| 路径 | 属主 | 判定 |
|---|---|---|
| `src/l4/sog-schema-validator.ts`（` M`，`+95/-4`） | 编码 A | **预期**（卡面声明的写集） |
| `tests/l4/sog-schema-validator.test.ts`（`??`） | 编码 A | **预期** |
| `tests/l4/sog-schema-validator.integration.test.ts`（`??`） | 编码 A | **预期** |
| `docs/.../evidence/980/probe-diagnosis.ts`（`??`，9361 B） | 编码 B | **预期** |
| `docs/.../evidence/980/capture-980-probe.sh`（`??`，5635 B） | 编码 B | **预期** |
| `.claude/reference-map.md`（` M`，+72/-2） | hook `grep-refs.sh` | **预期**（P0 已登记） |

**移动靶提示**：`02:02:48` 快照为 5 行（**不含** `M src/l4/sog-schema-validator.ts`）；`02:03:41` 起为 6 行。编码 A 在我两次快照之间落盘。**任何时刻比对必须带时刻**（本报告统一以 `02:04:20` 为准）。
同时可见编码侧正在跑 vitest（`%TEMP%\synova980\red.sh` 内含 `npx vitest run tests/l4/sog-schema-validator*.test.ts`）—— **本席按纪律未跑 vitest，未与该重载并发**。

### 12.2 可疑污染：**未发现**

- 工作树内 `*.db*` = 0（§7.1）
- 无 `/tmp` 路径误落进仓库（`git status -uall` 全量展开，无 tmp 型路径）
- 6 个 R28 地雷文件哈希 6/6 一致（§6）
- 无 `git stash` 由本队产生（§8.1）
- 无本地孤儿 tag（`V5.2.11` 已不存在；`V5.2.13` 与 origin 同步）

---

## §13 未解决项（交队长处置）

1. **变通无书面记录（M5 缺口）**：借用 11.10.0 `.node` 这件事，仓库治理产物中**零记录**；`%TEMP%` 侧的证据链也已残缺（`install-deps-rebuild.log` 被覆盖）。若该变通要随卡交付，需要补一份落仓库的说明（含 sha256 / 来源 / 影响面 / 回退方式）。
2. **风险面未闭合**：借用二进制仅覆盖**主进程短时**行为面；历史黑字（D462 / WiseLibs#1376 / 11.10.0×Node24 fork-worker 断言）指向的崩溃形态本机未复现，但**未在 macOS/arm64 复测**。
3. **P0 基线已过期**：任何后续「P0/P9 逐字比对」必须以新基线为准（HEAD `c231d80e8`、`origin/main` `44d4a721b`、`status` 6 行、`%TEMP%\synova-980-probe-out\20261008-020352\status-before.txt` 可作新捕获点）。
4. **未跑项**：vitest（按纪律让位）、`npm rebuild better-sqlite3` 回退复跑、`git ls-remote` 回执（本席未 push 任何分支，故无分支回执可附；如需 origin 侧回执，见 §8.2 的 `git ls-remote --tags`）。
5. **卡面判据写法修正建议**（属 CTO 裁决，本席只报不改）：
   - `git stash list 必须空` → 实际应表述为「**本队不得新增 stash**；存量 28 条属主仓遗留（截止 2026-08-03）」；
   - `git tag -l 'V5.2.1*'` → 应改为 `git tag -l 'V5.2.1'`（精确），否则 `V5.2.13` 必然误报。

---

## §14 本报告落盘后的复验（`2026-10-08 02:06:19 +0800`）

本文件写完后，本席立即重跑全部关键项，确认**本席的写入未扰动受验基线**：

```bash
sha256sum node_modules/better-sqlite3/build/Release/better_sqlite3.node
bccd88b5074c5bf2c23706e343f1e8f449d260e9124c86c9d4fad3b87e3d3e39 *node_modules/better-sqlite3/build/Release/better_sqlite3.node   [exit=0]
# 6 x thresholds.json git hash-object
daba78f030cd95cf11ade1c0421f1a4970e8ce6d / bb1e98162b3bb4f5a977a2eec5877b515a286b4e / f7ad5be81922d66899efe8583951562a567d3504
16b5bdec888c4c14a08537914dd054ab3599847d / b0ec2ecf0b64e96357f054cb0ba8c250dc87266c / 7926e3ec906980e38a60e64c597210dc16903655   [exit=0]
git stash list | wc -l        -> 28      （不变）
git tag -l 'V5.2.1*'          -> V5.2.1 / V5.2.13   （不变）
git rev-parse HEAD            -> c231d80e813a687526ac57085de285bb11be3424   （不变）
```

**本席写入后的 `git status --porcelain -uall`（含本文件 + 编码 A 的 staging 动作）**：
```
 M .claude/reference-map.md
M  src/l4/sog-schema-validator.ts
A  tests/l4/sog-schema-validator.integration.test.ts
A  tests/l4/sog-schema-validator.test.ts
?? docs/synova/product-lines/evidence/980/VERIFY-980-env-verifier-980-env.md
?? docs/synova/product-lines/evidence/980/capture-980-probe.sh
?? docs/synova/product-lines/evidence/980/probe-diagnosis.ts
[exit=0]
```
`git diff --cached --stat`：
```
 src/l4/sog-schema-validator.ts                    |  99 ++++++++++-
 tests/l4/sog-schema-validator.integration.test.ts | 195 ++++++++++++++++++++++
 tests/l4/sog-schema-validator.test.ts             | 164 ++++++++++++++++++
 3 files changed, 454 insertions(+), 4 deletions(-)
```

**漂移说明（不改判上文任何结论）**：§12.1 的快照（`02:04:20`）里编码 A 的三项是 ` M` / `??`；到 `02:06:19` 已变为 **staged**（`M ` / `A `）。这是编码 A 在制动作的**预期推进**，不改变 §5 的比对结论口径（比对基线仍为 `02:04:20`）。本文件本身以 `??` 出现，属本席写集，待队长按 M6 收口。

---


- **写集（唯一）**：`docs/synova/product-lines/evidence/980/VERIFY-980-env-verifier-980-env.md`（本文件，新建）。
- **独立性**：本席未参与 `src/l4/sog-schema-validator.ts`、`tests/l4/sog-schema-validator*`、`probe-diagnosis.ts`、`capture-980-probe.sh` 的任何编写；未执行任何 commit / push / stash / `--no-verify`。
- **不判"通过"**：本报告只给事实、证据与"无法证实"清单。**是否可信到可合并，权归 CTO 收件闸 + K3 终审。**
