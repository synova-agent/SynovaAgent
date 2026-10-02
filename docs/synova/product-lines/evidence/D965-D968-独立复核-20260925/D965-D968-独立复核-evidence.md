# D965–D968 独立复核 evidence（task-4 阶段一：批基线复现 + P7 因果性）

> 复核员：`sentinel-verifier`（独立复核员，**非编码**；只读仓库，全部产物落 `/tmp/verify-d965/**`）
> 口径声明：本文只出 **自验结论**，永不写「审计通过」；通过性判定归 CTO 收件闸 + K3 终审。
> 判据纪律：**不使用 grep 型静态判据当验收**；全部结论由**运行时断言**给出，且带**红/绿对照**（canary 夹具 / 改坏即红）。

---

## 0. 环境与基线（先量）

| 项 | 实测 |
|---|---|
| 专用工作树 | `/Users/wane/SynovaAgent/.synova-wt-verify-d965`（**新建**；`.synova-wt-VERIFY` 在本机大小写不敏感 FS 上等于已存在他人工作树 `.synova-wt-verify@9a960893`，故换名，避免复用他人工作树） |
| worktree HEAD | `25e081ce3f55aa383e2f8c4c0f75a236a74e82a8`（detached, origin/main） |
| node / tsx | v24.19.0 / tsx 4.23.13（`/Users/wane/SynovaAgent/node_modules/.bin/tsx`） |
| 生产库访问 | 仅只读：`sqlite3 "file:data/synova.db?mode=ro"` + `sqlite3 .backup` 快照到 `/tmp/verify-d965/synova-ro-copy.db`（`PRAGMA integrity_check` = ok）；**全程未对 `data/synova.db` 写入** |

**生产库写入面声明（诚实登记）**：

```
$ shasum -a 256 data/synova.db
0d1e4cffb0f1f290b4b588e58c1fd0e7f92c5c81328e7f6186abdbed562c1830  data/synova.db
$ stat -f "file=%N birth=%SB modify=%Sm" -t "%F %T" data/synova.db data/synova.db-shm data/synova.db-wal
file=data/synova.db     birth=2026-08-20 03:08:03 modify=2026-09-13 15:40:53   ← 内容文件未变
file=data/synova.db-shm birth=2026-08-27 02:42:17 modify=2026-09-25 16:26:56   ← 索引文件 mtime 在本 session 内被推进
file=data/synova.db-wal birth=2026-08-27 02:42:17 modify=2026-09-13 15:40:53   ← 0 字节（无未落盘事务）
```

- 全程**未对 `data/synova.db` 执行任何写语句**；仅 `mode=ro` 只读打开 + `sqlite3 .backup` 一致性快照。生产库内容文件 mtime/sha256 未变，WAL 保持 0 字节。
- 但 **`data/synova.db-shm` 的 mtime 在 16:26:56 被推进**（该文件 2026-08-27 即已存在，非我创建）。这是 SQLite WAL 模式下**任何读者**都会触及的共享内存索引文件，不含业务数据；不排除是常驻进程所为（本机 `ps` 被沙箱拒绝，无法定证）。按纪律登记，供 CTO 判是否需后续改为"只从快照副本读"。

**基线不一致（已实测，必须登记）**：

```
$ git rev-parse origin/main
25e081ce3f55aa383e2f8c4c0f75a236a74e82a8
$ git log --oneline b7dfac2d..origin/main
25e081ce docs(D964): 台账第五批 + K3 审计请求（门禁语义变更）+ 审计报告 INDEX 指针式 (#770)
260b89f4 feat(D964-P5): 日报加「文档:代码 比」指标（旁路不阻断） (#765)
$ git merge-base --is-ancestor b7dfac2d origin/main ; echo exit=$?
exit=0
$ git diff --stat b7dfac2d origin/main -- extensions/sentinels src/sentinel src/adapters src/l4
(空输出, exit=0)
```

→ 队长声称「批基线 = origin/main = `b7dfac2d`」，实测 **origin/main 已前进 2 个 commit**（`b7dfac2d` 是祖先）；两者在哨兵域**零差异**（8 个改动文件全在 docs/scripts/tests/.claude），故本批复核结论对两个 commit 同真。

**45 的来源（可复算）**：

```
$ git ls-tree -r --name-only origin/main -- extensions/sentinels | grep -c 'manifest.json'
58
# 58 = 45 个 extensions/sentinels/<name>/manifest.json
#    + 12 个 extensions/sentinels/_extinct/<name>/manifest.json（loader 跳过 `_` 前缀）
#    +  1 个 extensions/sentinels/manifest.json（顶层扩展目录清单，非哨兵；loader 只扫目录）
$ loadSentinels() → count=45  degraded=false  errors=[]
```

`entryPoint` 分布：44 个 `./aggregate.ts`，1 个 `./computes/detect.ts`（path-dependency）。

---

## 1. 探针设计（自研，未复用队长/CTO 脚本）

产物（全部 `/tmp/verify-d965/`）：

- `probe-sentinels.mts` — 主探针。对每个哨兵：`loadSentinels()` → 动态 import `manifest.entryPoint` → 取 `manifest.exportKey` → **loader 同款注入**（`if ('manifest' in obj) obj.manifest = manifest`）→ `createGraphTraversal(store)` → `await check(store, 'probe-team', traversal, thresholds)`。
  - `thresholds` 由 `resolveThresholds(name, 'probe-team', { memoryStore: { recall: () => null } })` 取 manifest 基线（**偏离声明**：未走真 memStore，避免生产库写；等价于"无覆写"）。
  - store = 真 `SqliteGraphStore` + `Proxy` 插桩计数（`queryNodes/queryEdges/getNode/queryTriples/createNode/createEdge/...`）；traversal 同样代理计数 `traverse`。
  - 另加 **SQL 级取证**：包 `db.prepare()`，统计 `FROM graph_triples` 的 prepare 次数与抛错次数（= 边读路径是否可用）。
  - 两列输出：`Array.isArray(raw)` **原始值** 与 **loader 口径解包** `Array.isArray(raw) ? raw : raw.findings ?? []` 的条数。
- `probe-loader-path.mts` — **走 loader 自身解包路径**：`initEngineContext()`（`SYNOVA_DB_PATH` 重定向到 /tmp 副本，脚本内断言 `db.name` 必须 `/tmp/verify-d965/` 前缀，否则退出）→ `registerLoadedSentinels()` → `registry.list()` → `sentinel.check({db, teamId:'probe-team'})` → 读 loader 返回的 `result.findings`。
- `p7-check.mts` / `write-path-check.mts` — P7 因果性（补列前后 / 边写路径）。
- `claims-check.mts` — (b)(c)(d) 运行时断言（合成 store、毒 store、降级路径对照）。
- canary 夹具 `fixture-green/` `fixture-red/`（同一 manifest，`computes/detect.ts` 一份返回 finding、一份 `throw new Error('CANARY-RED-D965')`）→ 验证探针的"抛错检出"不是空判据。

口径（DB 场景，全部 /tmp 副本）：

| 代号 | 内容 | nodes | triples | graph_triples.props |
|---|---|---|---|---|
| A | 生产库快照原样 | 0 | 0 | 无 |
| A2 | A + 只补 `props` 列 | 0 | 0 | 有 |
| B | A + 注入 5 节点/3 边 | 5 | 3 | 无 |
| C | B + 补 `props` 列 | 5 | 3 | 有 |
| D | A + 注入 6 节点/4 边（含 `probe-team` 起点 DEPLOYS 边） | 6 | 4 | 无 |
| E | D + 补 `props` 列 | 6 | 4 | 有 |

---

## 2. (a) 抛错 = 0（CTO 派单件报 3）

**自验结论：(a) 成立 —— 45 哨兵逐个体检，抛错 0；CTO 报的「3」在 6 次全量运行 + loader 原生注册路径中均未复现。**

```
=== SUMMARY A ===
sentinels_total=45
raw_is_array_count=42
threw_count=0
non_array_count=3 -> [["customer-demand-shift",["findings","degraded"],0],
                      ["sentinel-forecast-accuracy",["ok","findings","durationMs","checkedAt","degraded"],3],
                      ["sentinel-pricing-strategy",["ok","findings","durationMs","checkedAt","degraded"],1]]
module_import_failures=[]
entry_missing=[]
hasCheck_false=[]
```

`threw_count=0` 在 **A/A2/B/C/D/E 六次全量运行**（45×6=270 次 check）中一致；loader 原生路径：

```
$ tsx probe-loader-path.mts
# db opened at = /tmp/verify-d965/db-loader.db
# loadSentinels count= 45 errors= []
# registerLoadedSentinels = {"registered":45,"errors":[]}
# registry.list().length = 45
```

**该断言不是空判据（改坏即红）**：同款探针跑 canary 夹具，红件必须报错、绿件必须不报：

```
########## CANARY GREEN（对照）##########
sentinels_total=1
raw_is_array_count=1
threw_count=0
unpacked_nonzero_count=1 -> [{"name":"canary-sentinel","len":1,"ids":["canary-green"]}]

########## CANARY RED（改坏即红）##########
sentinels_total=1
raw_is_array_count=0
threw_count=1 -> [["canary-sentinel","Error: CANARY-RED-D965"]]
```

**CTO「3」的可能来源（假设，未证实）**：非数组返回恰为 **3** 个（`customer-demand-shift` 对象形态 + 2 个硬编码桩）。若非数组被计为 error，就会得到 3。此假设需 CTO 提供其脚本原始输出才能定论。

---

## 3. (b) path-dependency「不坏」

**自验结论：成立。** `entryPoint=./computes/detect.ts`、`exportKey=pathDependencySentinel` 存在；`check()` 返回 `SentinelFinding[]`；且在**合成高依赖图**上真实产出 critical finding（非空 evidence），空边图正确返回 `[]`（不误报）。

```
══════ (b) path-dependency ══════
manifest.entryPoint = ./computes/detect.ts | exportKey = pathDependencySentinel
entry exists = true | typeof check = function
高依赖图 → Array? true | findings = 1 | ids = ["pd-crit-1790324759053"] | evidenceLens = [3]
空边图 → Array? true | findings = 0
ASSERT(b) = HOLDS
```

主探针（生产库快照 A）：`path-dependency | ./computes/detect.ts | true | 0 | - | 0 | no | qN=1/qE=1/getNode=0/trav=0`——**确实调用 store**（不是空壳），只是空库下按设计返回 `[]`（degraded）。

目录事实：`extensions/sentinels/path-dependency/` 下只有 `manifest.json` + `computes/`，**无 `aggregate.ts`**——但 manifest 的 `entryPoint` 不指向 aggregate，D965 卡面「缺 aggregate」的表述**不是缺陷判据**（loader 按 `entryPoint` 加载，实测通过）。

---

## 4. (c) customer-demand-shift 对象形态 = 设计内降级路径

**自验结论：成立。** 对象形态**仅在**"有 traversal 且取不到 DEPLOYS 节点"时出现；注入 DEPLOYS 节点或未注入 traversal 时返回数组。loader 明确支持该形态（`sentinel-loader.ts:288` 解包 + `:290` 传播 degraded）。

```
══════ (c) customer-demand-shift ══════
traversal 有但无 DEPLOYS 节点 → rawKeys = ["findings","degraded"] | unpacked = 0 | degraded = true
traversal 有且有 DEPLOYS 节点 → Array? = true | unpacked = 1 | ids = ["e4-concent-crit"]
traversal 未注入 → Array? = true | unpacked = 1 | ids = ["e4-concent-crit"]
ASSERT(c 对象形态只出现在降级路径) = HOLDS
aggregate.ts:53 = "return { findings: [], degraded: true };"
sentinel-loader.ts:288 = "const findings: SentinelFinding[] = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.findings as SentinelFinding[]) || [];"
sentinel-loader.ts:290 = "const degraded = !Array.isArray(raw) && (raw as Record<string, unknown>)?.degraded === true;"
```

生产库快照口径下该哨兵经 loader 返回 0 finding（`probe-loader-path.json` 中列于 `zero_finding_ids`），`degraded` 由 loader 传播（不落 finding）。**因此"非数组"≠"坏件"**。

---

## 5. (d) sentinel-forecast-accuracy / sentinel-pricing-strategy = 硬编码桩

**自验结论：成立（生产口径可复现）。** 两哨兵第一参按 `(context:{db,now,registry?})` 定义、loader 传的是 `(store, teamId, traversal, thresholds)`；**无论传 `null` 还是"访问即抛"的毒 store，结果完全一致**，store 调用数 = 0，`evidence` 全空；经 loader 原生解包后每次运行产出 **4 条 finding**（forecast 3 + pricing 1）。

```
══════ (d) forecast-accuracy / pricing-strategy ══════
sentinel-forecast-accuracy:
  store=null     → threw = no | ids = ["forecast-mape","forecast-sample","forecast-timeseries"] | evidenceLens = [0,0,0]
  store=poisoned → threw = no | ids = ["forecast-mape","forecast-sample","forecast-timeseries"]
  raw is Array? = false | raw keys = ["ok","findings","durationMs","checkedAt","degraded"]
  ASSERT(与期望 id 集一致) = HOLDS | ASSERT(两次调用结果与 store 无关) = HOLDS | ASSERT(evidence 全空) = HOLDS
sentinel-pricing-strategy:
  store=null     → threw = no | ids = ["pricing-disc"] | evidenceLens = [0]
  store=poisoned → threw = no | ids = ["pricing-disc"]
  raw is Array? = false | raw keys = ["ok","findings","durationMs","checkedAt","degraded"]
  ASSERT(与期望 id 集一致) = HOLDS | ASSERT(两次调用结果与 store 无关) = HOLDS | ASSERT(evidence 全空) = HOLDS
```

主探针（A）：`store_zero_call_count=2 -> ["sentinel-forecast-accuracy","sentinel-pricing-strategy"]`；`qN=0/qE=0/getNode=0/trav=0`。

**loader 原生解包口径（生产真相，非我的复刻）**：

```
sentinel-sentinel-forecast-accuracy -> findings=3 ids=["forecast-mape","forecast-sample","forecast-timeseries"] evidenceLens=[0,0,0] degraded=false
sentinel-sentinel-pricing-strategy -> findings=1 ids=["pricing-disc"] evidenceLens=[0] degraded=false
=== LOADER-PATH SUMMARY ===
registered_sentinels=45
sentinels_with_findings=15
sentinels_zero_findings=30
total_findings_via_loader=18
```

即：空库上 loader 全量 18 条 finding，其中 **4 条来自这两个桩**（`evidence` 全空），其余 14 条来自 13 个哨兵的「nodata/degraded/空数据告警」类 finding。

---

## 6. P7（P0）独立核验 + D966 判别性基线

**自验结论：P7 成立（0 生产库访问写入）。** `graph_triples` 无 `props` 列 → `queryEdges` **100% 失败**（49/49 prepare 抛错 → catch → `[]`）；`graph_nodes` 有 `props`；`src/store/migrations/` 只有 `001-graph-nodes-props.ts`（只覆盖 `graph_nodes`）。**追加发现：边写路径同样死** —— `createEdge` 也 INSERT `props` 列，实测抛错。

### 6.1 schema 原始输出（只读）

```
$ sqlite3 "file:/Users/wane/SynovaAgent/data/synova.db?mode=ro" "SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHERE 1=1 LIMIT 1;"
Error: in prepare, no such column: props
  ECT id, predicate, subject_id, object_id, weight, props FROM graph_triples WHE
                                      error here ---^

$ sqlite3 "...?mode=ro" "PRAGMA table_info(graph_nodes);"
0|id|TEXT|1||1
1|type|TEXT|1||0
2|graph|TEXT|1||2
3|name|TEXT|1||0
4|confidence|REAL|0|1.0|0
5|props_json|TEXT|0|'{}'|0
6|created_at|TEXT|1|datetime('now')|0
7|updated_at|TEXT|1|datetime('now')|0
8|valid_to|TEXT|0||0
9|props|TEXT|1|'{}'|0          ← graph_nodes 有 props

$ sqlite3 "...?mode=ro" "PRAGMA table_info(graph_triples);"
0|id|INTEGER|0||1
1|subject_type|TEXT|1||0
2|subject_id|TEXT|1||0
3|predicate|TEXT|1||0
4|object_type|TEXT|1||0
5|object_id|TEXT|1||0
6|graph|TEXT|1||0
7|weight|REAL|0|1.0|0
8|props_json|TEXT|0|'{}'|0   ← 只有 props_json
9|confidence|REAL|0|1.0|0
10|source|TEXT|0||0
11|valid_from|TEXT|1|datetime('now')|0
12|valid_to|TEXT|0||0
13|created_at|TEXT|1|datetime('now')|0

$ ls -1 src/store/migrations/
001-graph-nodes-props.ts
```

### 6.2 运行时因果性（真 `SqliteGraphStore`，/tmp 副本）

```
== [2] db-B: 3 triples present, no props col — real store runtime ==
after construct: graph_triples cols = [... 无 props ...]     ← 构造器 reconcileSchema 不补该列
SELECT COUNT(*) graph_triples (via db) = {"n":3}             ← 表里确有 3 行
queryNodes("Client").length  = 2 (expect 2 — node path OK)
queryEdges().length          = 0 (expect 0 despite 3 rows present)
queryEdges("DEPLOYS",...).length = 0 (expect 0)
queryTriples({predicate}).length = 1 (SELECT * — expect 1)
RAW SQL (sqlite-graph-store.ts:245) throws -> no such column: props

== [3] 因果性: db-C = db-B + ALTER TABLE graph_triples ADD COLUMN props ==
queryEdges().length (props col added) = 3 (expect 3 → 失败可归因于缺列)
queryEdges("DEPLOYS").length = 1 (expect 1)
```

边写路径（同一 schema 副本）：

```
-- createNode (graph_nodes 有 props) --
createNode OK id=node-229e65c4-7b51-4fb7-47ca-2bf1358095c4
-- createEdge (graph_triples 无 props) --
{"level":40,...,"err":"table graph_triples has no column named props",...,"msg":"创建图边失败"}
createEdge THREW: table graph_triples has no column named props
-- rows after -- {"n":1} {"n":0}
```

### 6.3 队长要求的 D966 判别性基线（补列前/后两口径）

| 口径 | graph_triples 行数 | `props` 列 | queryEdges 调用 | 边读 SQL prepare 成功/总 | 零 finding 哨兵数（loader 口径） | 有 finding 哨兵数 | 非数组返回 | 总 store 调用 |
|---|---|---|---|---|---|---|---|---|
| **db-A**（生产快照原样） | 0 | 无 | 49 | **0/49** | **30** | 15 | 3 | 97 |
| **db-A2**（A + 补列） | 0 | 有 | 49 | 49/49 | **30** | 15 | 3 | 97 |
| **db-B**（+3 边） | 3 | 无 | 49 | 0/49 | 29 | 16 | 3 | 97 |
| **db-C**（B + 补列） | 3 | 有 | 49 | 49/49 | 29 | 16 | 3 | 97 |
| **db-D**（+4 边含 DEPLOYS） | 4 | 无 | 49 | 0/49 | 29 | 16 | 3 | 97 |
| **db-E**（D + 补列） | 4 | 有 | 49 | 49/49 | **19** | **26** | 2 | 175 |

**读法（诚实版）**：
1. **边读成功数 0/49 ↔ 49/49** 完全由 `props` 列决定（A↔A2、B↔C、D↔E 三对对照，唯一变量是该列）→ **"queryEdges 100% 失败"成立**。
2. **零 finding 数只在有图数据时才被该列影响**：A vs A2 = 30 vs 30（生产库 graph 表**当前为空**，补列也读不出边）；D vs E = 29 vs 19（有边时补列后 26 个哨兵产出 finding，含 `customer-demand-shift → e4-concent-crit`）。
3. 因此 D966「空转」结论的正确表述应是：**「边读路径 100% 失效（写边同样失效）是系统性缺陷；但在当前生产库（graph_nodes=0/graph_triples=0）上，它暂未改变 finding 计数」**——两者不可混为一谈。

---

## 7. 复现 vs 队长数字对照表

| 项 | 队长/CTO 数字 | 我的实测 | 判定 |
|---|---|---|---|
| 哨兵总数 | 45 | 45（58 manifest − 12 `_extinct` − 1 顶层清单） | ✅ 一致 |
| 返回数组 | 42 | 42 | ✅ 一致 |
| 抛错 | 队长 0（CTO 派单件 3） | **0**（45×6 全量 + loader 原生 45） | ✅ 队长一致；❌ CTO 的 3 未复现 |
| 非数组返回 | 3 | 3（customer-demand-shift + 2 桩） | ✅ 一致 |
| 零 finding（解包口径，生产库） | —（队长给的第一列 29） | **30**（解包后）／29（仅数组口径） | ⚠️ 口径差异：只报第一列会漏 `customer-demand-shift` |
| 零 store 调用 | 2（两个桩） | 2（仅两个桩） | ✅ 一致 |
| loader 解包后编造 finding | 4（forecast 3 + pricing 1），`evidence: []` | 4（loader 原生 `result.findings`：3+1；`evidenceLens=[0,0,0]`/`[0]`） | ✅ 一致 |
| path-dependency | 不坏，entryPoint=./computes/detect.ts，返回 SentinelFinding[] | 成立（且合成高依赖图产出 critical + 3 条 evidence） | ✅ 一致 |
| customer-demand-shift 对象形态 | 只在设计内降级路径（aggregate.ts:53），loader 支持（288-290） | 成立（三种输入对照 HOLDS；行号逐字核对） | ✅ 一致 |
| `origin/main` = b7dfac2d | 声称 | 实测 `25e081ce`；`b7dfac2d` 落后 2 commit（哨兵域零差异） | ⚠️ 基线数字需更正 |
| 生产库 graph 表 | 未提 | **graph_nodes=0 行、graph_triples=0 行**（表存在、schema_version=2） | ⚠️ 新增事实，影响 D966 口径 |

---

## 8. 未能复现 / 与队长不一致之处（诚实登记）

1. **CTO「3 个抛错」未能复现**：270 次 check + loader 原生 45 次注册/检查，`threw=0`。怀疑其把「3 个非数组返回」计为 error（非数组恰为 3），**但这是假设，需 CTO 脚本原始输出**。
2. **批基线数字不一致**：`origin/main` 已是 `25e081ce`，非队长所报 `b7dfac2d`（后者为祖先）。已证明哨兵域零差异，故不影响本轮结论；但后续所有「对 …main」的引用需统一。
3. **「零 finding = 29」的口径分歧**：原始数组列 29；loader 解包口径 **30**（差额 = `customer-demand-shift` 的对象形态，其 `findings: []`）。队长已自行更正，此处只做数字固定。
4. **探针口径偏离 1 处（须声明）**：我的 `resolveThresholds` 用 stub memoryStore（`recall()=null`）→ 只取 manifest 基线，**未走生产 memStore 覆写**；这是为了不写生产库。真生产路径（memStore 覆写）未在本轮复现。
5. **生产库图数据为空**（新增事实）：`data/synova.db` 的 `graph_nodes`/`graph_triples` 均 0 行。故 P7 的功能影响在当前生产数据下"不可见"，只在有图数据时显形（D/E 对照）。

---

## 9. 未清项

1. **未跑全量 `vitest` / `tsc --noEmit`**：阶段一未涉及代码改动；D965–D968 逐卡验收时按卡面 Done 逐条决定是否申请重型令牌。
2. **未核验生产 memStore 阈值覆写路径**（见 §8.4）。
3. **未在真生产库上运行写路径**（红线：只读）；`createEdge` 失败证据来自 /tmp 副本（同 schema）。
4. **`data/synova.db` 图数据为空的原因未查**（是设计如此，还是写入路径长期失败所致）——**这条对 D966/D967 影响最大**：需 CTO 决定是否立卡。
5. **canary 夹具与全部脚本未入库**（按纪律只写 /tmp）；如需并入 `tests/sentinel/**`，由队长指派编码成员走分支落地，我不自行扩写集。

---

## 附录 A：45 哨兵全表（生产库快照口径 + 补列+数据口径）

（见下方表格；列为 `probe-A.json` / `probe-E.json` 原始 JSON 生成，非手写）

列含义：`raw 是数组` = `Array.isArray(raw)`；`loader 解包 findings` = `Array.isArray(raw) ? raw : raw.findings ?? []` 的条数；`store 调用` = 插桩计数；`空库(A)finding ids` / `补列+数据(E)finding ids`。

| # | 哨兵 | entryPoint | raw 是数组 | raw.length | loader 解包 findings | 抛错 | store 调用(qN/qE/getNode/trav) | 空库(A)finding ids | 补列+数据(E)finding ids |
|---|---|---|---|---|---|---|---|---|---|
| 1 | agent-deployment-maturity | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 2 | ai-ecosystem-fit | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["t-na"] |
| 3 | ai-investment-return | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["t-ai"] |
| 4 | api-coverage | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["t2-proto-crit"] |
| 5 | business-model-coherence | ./aggregate.ts | true | 1 | 1 | no | qN=5/qE=1/getNode=0/trav=1 | ["i7-crit"] | ["i7-warn"] |
| 6 | capital-health | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=0/getNode=0/trav=0 | [] | [] |
| 7 | cash-runway | ./aggregate.ts | true | 2 | 2 | no | qN=2/qE=4/getNode=0/trav=4 | ["cr_runway_degraded","cr_overdue_degraded"] | ["cr_runway_degraded"] |
| 8 | channel-capacity | ./aggregate.ts | true | 1 | 1 | no | qN=3/qE=1/getNode=0/trav=1 | ["o6-nodata"] | ["o6-nodata"] |
| 9 | competitive-moat | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=2/getNode=0/trav=2 | ["i3-nodata"] | ["i4-crit","i3-nodata"] |
| 10 | competitive-position | ./aggregate.ts | true | 1 | 1 | no | qN=4/qE=2/getNode=0/trav=2 | ["e1-nodata"] | ["e1-nodata"] |
| 11 | customer-demand-shift | ./aggregate.ts | false | - | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["e4-concent-crit"] |
| 12 | data-health | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["t3-silo-crit"] |
| 13 | environment-rent-dependency | ./aggregate.ts | true | 1 | 1 | no | qN=1/qE=1/getNode=0/trav=1 | ["e5-rent-warn"] | ["e5-rent-warn"] |
| 14 | explore-exploit-balance | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["o1-nodata"] |
| 15 | financing-constraint | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=1 | [] | [] |
| 16 | growth-quality | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=1 | [] | [] |
| 17 | human-agent-boundary | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 18 | incentive-alignment | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=1/getNode=0/trav=1 | ["o3-nodata"] | ["o3-nodata"] |
| 19 | info-distortion | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=1/getNode=0/trav=1 | ["o7-nodata"] | ["o7-nodata"] |
| 20 | internal-transaction-cost | ./aggregate.ts | true | 0 | 0 | no | qN=3/qE=1/getNode=0/trav=1 | [] | [] |
| 21 | key-person-risk | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=1 | [] | [] |
| 22 | knowledge-accessibility | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=1/getNode=0/trav=1 | ["o4-nodata"] | ["o4-nodata"] |
| 23 | make-or-buy | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 24 | margin-health | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=0/getNode=0/trav=0 | [] | [] |
| 25 | moat-dependency | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 26 | network-power | ./aggregate.ts | true | 0 | 0 | no | qN=4/qE=1/getNode=0/trav=1 | [] | [] |
| 27 | niche-breadth | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["i1-breadth-warn","i1-depth"] |
| 28 | niche-squeeze | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["i2-crit"] |
| 29 | opportunity-window | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 30 | org-repairability | ./aggregate.ts | true | 1 | 1 | no | qN=1/qE=1/getNode=0/trav=1 | ["o8-nodata"] | ["o8-nodata"] |
| 31 | path-dependency | ./computes/detect.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=0 | [] | [] |
| 32 | power-rigidity | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=1/getNode=0/trav=1 | ["o9-nodata"] | ["o9-nodata"] |
| 33 | process-ai-readiness | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["t-na"] |
| 34 | resource-misallocation | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
| 35 | revenue-health | ./aggregate.ts | true | 0 | 0 | no | qN=2/qE=2/getNode=0/trav=2 | [] | [] |
| 36 | routine-diffusion | ./aggregate.ts | true | 1 | 1 | no | qN=2/qE=1/getNode=0/trav=1 | ["o5-nodata"] | ["o5-crit"] |
| 37 | routine-mutation | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["o2-frozen"] |
| 38 | sentinel-forecast-accuracy | ./aggregate.ts | false | - | 3 | no | qN=0/qE=0/getNode=0/trav=0 | ["forecast-mape","forecast-sample","forecast-timeseries"] | ["forecast-mape","forecast-sample","forecast-timeseries"] |
| 39 | sentinel-pricing-strategy | ./aggregate.ts | false | - | 1 | no | qN=0/qE=0/getNode=0/trav=0 | ["pricing-disc"] | ["pricing-disc"] |
| 40 | software-health | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=1 | [] | [] |
| 41 | strategy-capability-fit | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | ["s1-nodata"] |
| 42 | talent-density | ./aggregate.ts | true | 1 | 1 | no | qN=1/qE=1/getNode=0/trav=1 | ["o10-nodata"] | ["o10-nodata"] |
| 43 | time-penetration | ./aggregate.ts | true | 0 | 0 | no | qN=1/qE=1/getNode=0/trav=1 | [] | [] |
| 44 | unit-economics | ./aggregate.ts | true | 0 | 0 | no | qN=2/qE=3/getNode=0/trav=2 | [] | [] |
| 45 | value-capture | ./aggregate.ts | true | 0 | 0 | no | qN=0/qE=1/getNode=0/trav=1 | [] | [] |
---

## 附录 B：原始产物清单（全部 /tmp/verify-d965/）

| 文件 | 内容 |
|---|---|
| `probe-sentinels.mts` | 自研主探针（插桩 store + SQL 级边读取证 + loader 口径解包两列） |
| `probe-loader-path.mts` | loader 原生路径（`registerLoadedSentinels` + `registry.check`，DB 重定向断言） |
| `p7-check.mts` | P7 schema 因果性（补列前/后） |
| `write-path-check.mts` | `createNode` OK / `createEdge` THREW 取证 |
| `claims-check.mts` | (b)(c)(d) 运行时断言 |
| `fixture-green/`, `fixture-red/` | canary 红绿夹具（`CANARY-RED-D965`） |
| `probe-A.json` … `probe-E.json` | 6 个 DB 场景 × 45 哨兵逐条原始记录 |
| `probe-loader-path.json` | loader 原生 45 哨兵逐条 findings |
| `probe-CANARY-GREEN.json`, `probe-CANARY-RED.json` | 探针判别力自证 |
| `synova-ro-copy.db` | 生产库一致性快照（`sqlite3 .backup`，integrity ok） |
| `db-A/A2/B/C/D/E.db` | 6 个只读实验口径副本（**均为 /tmp 副本**） |

**生产库完整性**：`data/synova.db` 全程只读（`mode=ro` + `.backup` 快照），未执行任何写语句。
