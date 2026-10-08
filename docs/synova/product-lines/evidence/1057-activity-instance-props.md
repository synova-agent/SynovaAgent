# #1057 证据件 — 作业单元缺两件（实例 + 评估属性）

- **卡**：GitHub issue #1057（3-5｜模块 K4）｜本地镜像 `.k4-cards/card-1057.md`（GitHub 账号级封禁期：**未读线上、未发评论、未开 PR**）
- **执行人**：`k4-coder-c`（k4 小队编码 C）｜**自验**：独立成员（task-8），**非编码兼任**
- **工作树**：`D:\novis-backup-20260526\Novis\.synova-wt-1057`｜分支 `fix/1057-activity-instance-props`
- **基线**：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`
- **判据等级**：L2-真跑通（真机库 + 真实写入路径 + 改坏即红）
- **状态**：**未合并** —— 等待 GitHub 通路恢复 + CTO/K3 放行
- 读卡确认（先于写码产生）：`.k4-publish/read-card-confirm.md`

---

## 0. 卡面判据 ↔ 本件读数（一屏对照）

| # | 卡面判据（§⑥） | 本件读数 | 状态 |
|---|---|---|---|
| ① | `graph_nodes` 出现 `activity/*` 节点（计数非 0） | 真机库**在位**：`0 → 1`（`activity/production`，graph=`wani-baby`） | 🟢 |
| ② | 属性非空（10 个属性至少覆盖读得到） | 8 个 `activity/*` 类目 **10/10** 覆盖；实例 10 个属性经 `queryNodes` 逐字读回 | 🟢 |
| ③ | 反例（改坏即红） | 删实例文件 ⇒ **5 条判据测试红**；复原 ⇒ **11 绿** | 🟢 |

---

## 1. 前提冻结（逐条实测；输出为命令原始读数）

| 前提 | 命令 | 输出摘要 |
|---|---|---|
| `activity/` = 8 个类目 | `Get-ChildItem extensions/ontology/activity -File` | `acquisition/compliance/coordination/governance/innovation/learning/maintenance/production` ⇒ **count = 8** |
| `production.json` 顶层键 = 6 个、**10 属性 0 命中** | `python3` 读 JSON | `TOP= ['$id','label','tags','requiredProps','optionalProps','description']`；`optionalProps` 原有 **7 键**，卡面 10 属性**全缺** |
| 已在生产链加载 | `grep -rn 'loadOntology(' src`（排除 loader 本体） | **4 处**：`src/init/file-driven-loaders.ts:96`、`src/mcp/tool-definitions.ts:394`、`src/routes/ontology-admin.ts:17`、`src/sentinel/sentinel-loader.ts:219`；目录常量 `src/l4/ontology-loader.ts:80` |
| 真机库 `graph_nodes` = 0 行 | python3 sqlite3（`mode=ro`） | `SELECT COUNT(*) FROM graph_nodes` = **0** |
| 真机库为**旧形态** | `PRAGMA table_info(graph_nodes)` | `['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to']` —— **无 `props` 列**；`schema_version` 表**不存在** |
| loader 平铺扫描（实例须放子目录） | 读 `src/l4/ontology-loader.ts:59-68` | `scanDir` = `readdirSync(dir).filter(f => f.endsWith('.json'))`，**不递归** |

> ⚠️ 口径替换（队长 2026-10-09 裁定 ③）：卡面 §⑥ 的 `sqlite3` **CLI 在本机不存在**（`command -v sqlite3` ⇒ `NOT_FOUND`）。**语义不变，读数工具替换为 python3 内置 `sqlite3`**（`mode=ro` 只读打开做查询）。上面与下面的所有 SQL 读数均出自该替换工具，**未假装原命令跑过**。

---

## 2. 判据① — 真机 `data/synova.db` **在位**（队长裁定授权；生产路径自愈式迁移）

**执行序**：先落一致性快照（回滚件）→ 记 sha256 before → 开库打印 before → **走生产路径** `new SqliteGraphStore(db)`（构造函数自带 `reconcileSchema`，属应用自身行为，非手工 hack）→ `createNode` → 打印 after。

### 2.1 原件 sha256（前后）+ 回滚件

```
STEP B｜一致性快照（VACUUM INTO，落 worktree data/1057-snapshot/；data/ 已 gitignore 不进 git）
snapshot = data\1057-snapshot\snapshot-1057-before-inplace.db size = 12812288
9b8b398a73437bcffc6f835add857f638deae8b432b0fee6a58aee2470d9f161 *data/1057-snapshot/snapshot-1057-before-inplace.db

STEP C｜真机原件 sha256 BEFORE
437d07a662b9fb1320820fb9357551f593d3ebe8011b69f0abee8b8b6452db2a *…/synova-agent/data/synova.db

STEP E｜真机原件 sha256 AFTER
771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a *…/synova-agent/data/synova.db
size=12959744 mtime=2026-10-09 03:34:59.148433400 +0800   （BEFORE: 12926976 / 2026-08-14 20:21:52）
```

### 2.2 before / 迁移后 / after（测试内原始读数）

```
[1057][真机在位·before] {"cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to"],"hasSchemaVersionTable":false,"schemaVersionRows":[],"activityCount":0,"totalNodes":0}
[1057][真机在位·迁移后] {"cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to","props"],"schemaVersionRows":[2,3,4]}
[1057][真机在位·after] {"nodeId":"node-6da9de53-bf8f-4273-a880-70ec9ecebfec","cols":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to","props"],"activityCount":1,"cardSql":"SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'","rows":[{"id":"node-6da9de53-bf8f-4273-a880-70ec9ecebfec","type":"activity/production","name":"门店零售交付","graph":"wani-baby"}]}
```

### 2.3 独立于测试断言的真机只读复读（python3 sqlite3）

```
PRAGMA table_info(graph_nodes) cols = ['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to','props']
schema_version rows = [2, 3, 4]
SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%' = 1
SELECT COUNT(*) FROM graph_nodes (total) = 1
ROW id=node-6da9de53-bf8f-4273-a880-70ec9ecebfec graph=wani-baby type=activity/production name_cjk_chars=6
    props keys(15) = ['name','output_type','production_mode','cycle_time_hours','capacity_utilization','headcount','hours_per_run','runs_per_period','unit_labor_cost','error_rate','structuredness','error_tolerance','data_reachability','agent_readiness_score','agent_type_recommendation']
    10 eval props present = True
    10 eval props numeric  = {'headcount': 10, 'hours_per_run': 10, 'runs_per_period': 30, 'unit_labor_cost': 88, 'error_rate': 0.02, 'structuredness': 0.55, 'error_tolerance': 0.35, 'data_reachability': 0.2, 'agent_readiness_score': 0.45}
    agent_type_recommendation set = True
```

### 2.4 回滚件可核（快照仍为迁移前形态）

```
snapshot cols = ['id','type','graph','name','confidence','props_json','created_at','updated_at','valid_to']
snapshot activity/* count = 0
```

> **未合并声明**：真机库是**本机 dev 数据资产**（`data/` 已在 `.gitignore`），本次在位迁移+写入**不产生 git 变更**。回滚方式：以 2.1 快照覆盖原库（sha256 `9b8b398a…`），即回到 count=0 / 无 `props` 列的迁移前形态。

### 2.5 表级副作用披露（CTO 2026-10-09 追问项，逐项如实）

**库表数 52 → 55**（+3）：`schema_version`（迁移框架表）、`metric_readings`（迁移 002）、`orgs`（迁移 003）。
⇒ 在位运行不只加 `graph_nodes.props`，**还建了 3 张表**（属同一 `reconcileSchema` 行为，非本卡手工动作）。

**`PRAGMA table_info(graph_triples)` 前 / 后（CTO 点名项）**：前置口径 = 迁移前一致性快照（该快照是整库副本，取它即"迁移前真值"，非推理）。

```
BEFORE = AFTER，**逐列完全相同、未被本次写入触碰**：
  14 列: id,subject_type,subject_id,predicate,object_type,object_id,graph,weight,props_json,
         confidence,source,valid_from,valid_to,created_at
  DDL: CREATE TABLE graph_triples ( id INTEGER PRIMARY KEY AUTOINCREMENT, … props_json TEXT DEFAULT '{}', … )
  COUNT(graph_triples) = 0 → 0
```
⇒ ① 该表**没有 `props` 列**；② 主键是 `INTEGER PRIMARY KEY AUTOINCREMENT`（**canonical 是 `TEXT PRIMARY KEY`**）；
③ 迁移 001 只 `ALTER graph_nodes`，**没碰它**。本卡据此**未建任何边**（`createEdge` 在本形态上物理不可用，#1455 在修）。

### 2.6 🔴 形状漂移声明（如实声明 + 建议另立卡；本卡不擅动）

真机 `graph_nodes` 的形态与 canonical `SCHEMA_SQL`（`src/adapters/sqlite-graph-store.ts:20-40`）**不一致**，且迁移 001 未涉及主键：

| 维度 | 真机库实测 | canonical `SCHEMA_SQL` | 差异 |
|---|---|---|---|
| 主键 | 复合 `PRIMARY KEY (id, graph)` | `id TEXT PRIMARY KEY` | 🔴 形状漂移 |
| `valid_from` | **不存在** | `valid_from TEXT NOT NULL DEFAULT (datetime('now'))` | 🔴 缺列 |
| 额外列 | `confidence` / `updated_at` / `props_json` | 无 | 遗留形态 |

⇒ **本批不重建 `graph_nodes`**（今天不红，重建属高风险数据迁移）⇒ **建议另立卡**（提案→K3→CTO）。**本卡不擅动**（写集也不含 `src/**`）。

---

## 3. 判据① 对照组（队长裁定 ⑤：**两个读数都贴，不许合并成一句「通过」**）

### 3.1 新库对照（`:memory:` 全新库）

```
[1057][新库对照] {"kind":":memory: 全新库","cols":["id","graph","type","name","props","created_at","valid_from","valid_to"],"migrations":[2,3,4],"nodeId":"node-bc294df9-…","countAfter":1,"note":"迁移 001 在全新库上是 no-op（表由 initSchema 建，已含 props 列）"}
```

### 3.2 旧形态库（hermetic 夹具）+ 判别性反证

```
[1057][判别性反证] 旧形态库列 = id,type,graph,name,confidence,props_json,created_at,updated_at,valid_to | INSERT 与 SELECT props 双双报错 | 插入 activity/* 前计数 = 0
[1057][判据① 真实写入路径] {"colsBefore":["id","type","graph","name","confidence","props_json","created_at","updated_at","valid_to"],"countBefore":0,"colsAfter":[…,"props"],"migrations":[2,3,4],"nodeId":"node-04c11c3c-…","cardSql":"SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'","countAfter":1,"readBackEvalProps":[…]}
```

**三者对照结论（分开陈述）**：
- 真机库：**需要**迁移 001 真加列 + 回填（`props_json→props`），之后写入成功 ⇒ 判据① 绿。
- 新库：`initSchema` 建表即含 `props`，迁移 001 空转 ⇒ 同一写入路径也绿（**但不能据此声称真机库曾绿**）。
- 旧形态库 + 裸 INSERT（绕过生产类）：**必红**（`table graph_nodes has no column named props` / `no such column: props`）⇒ 证明判据走的是**真实写入路径**，不是静态 grep。

---

## 4. 判据② — 10 个评估属性覆盖 + 实例属性读回

### 4.1 schema 面（8 个类目 × 10 属性）

```
[1057][判据② schema 面] ["acquisition: optionalProps=16 含 10/10","compliance: optionalProps=14 含 10/10","coordination: optionalProps=15 含 10/10","governance: optionalProps=14 含 10/10","innovation: optionalProps=14 含 10/10","learning: optionalProps=12 含 10/10","maintenance: optionalProps=15 含 10/10","production: optionalProps=17 含 10/10"]
```

### 4.2 生产链真实加载（接线 ≠ 被执行 —— 这里真调 loader）

```
[1057][loader 实测] activityTypes = activity/acquisition,activity/compliance,activity/coordination,activity/governance,activity/innovation,activity/learning,activity/maintenance,activity/production
（logger 原始行：{"service":"l4/ontology-loader","nodes":29,"edges":55,"msg":"本体类型加载完成"} ⇒ 类型总数 29 **未变** = 无新节点类型）
```

### 4.3 实例面（逐字读回）

```
[1057][实例属性] {"type":"activity/production","graph":"wani-baby","name":"门店零售交付","evalProps":["headcount=10","hours_per_run=10","runs_per_period=30","unit_labor_cost=88","error_rate=0.02","structuredness=0.55","error_tolerance=0.35","data_reachability=0.2","agent_readiness_score=0.45","agent_type_recommendation=copilot — 辅助型 Agent（商品推荐/补货建议，人工确认后放行）"]}
```

**属性类型口径（本卡自决，卡面未给，见读卡确认 §6-2）**：9 × `number` + 1 × `string`（`agent_type_recommendation`）。
**实例值来源**：逐字段 `_provenance` 标注 `derived:`（派生自 `data/golden/wani-baby-v1.json`，sha256 `f2f4cee40f982488abdab707beb125c3712969b66b63c93c20c3f8f271988bab`）或 `handfill:`（**手填占位，待访谈核实**）。**未声称"已核访谈"**。

---

## 5. 判据③ — 改坏即红（删实例 ⇒ 必红；复原 ⇒ 必绿）

```
阶段 1｜mv 走实例文件 → 实例是否还在: NO
阶段 2｜npx vitest run tests/l4/activity-instance-1057.test.ts
  × 实例文件不会被 loader 当成第 9 个节点类型（…）
  × 实例引用既有 $id（不新建类型）、10 个评估属性非空、含逐字段来源标注
  × 判别性夹具（改坏即红）：抹掉任一评估属性 ⇒ 同一判据函数必报缺失
  × 真实路径：SqliteGraphStore 构造即迁移（props_json→props）+ 写入实例 + 判据 SQL 计数 = 1 + 10 属性读回
  × 全新库：initSchema 建表即含 props 列 ⇒ 同一写入路径计数 = 1
  Error: [1057] 实例文件不存在: …\instances\activity-production-wani-baby-001.json
  Test Files  1 failed (1)      Tests  5 failed | 6 passed | 2 skipped (13)
  VITEST_DAMAGED_EXIT=1
阶段 3｜mv 复原 → 实例是否复原: YES｜复原后 sha256: 9c9aa30a629a91a875f390198afca950ba09e1674f5011ae30bcb3105a8f292e
阶段 4｜重跑
  Test Files  1 passed (1)      Tests  11 passed | 2 skipped (13)
  VITEST_RESTORED_EXIT=0
```

（"2 skipped" = 两个真机口径段落未设 env 时的正常跳过。）

### 5.1 判别性夹具自检协议（队长 2026-10-09 纪律；本卡事后补齐，并**据以修掉一个真缺陷**）

**为什么必须两小步都过**：① 仓库 `tsconfig.json` 的 `exclude` 含 `tests` ⇒ 全局 `tsc --noEmit` 对夹具**零覆盖**，必须单文件跑；② 破坏若让语法非法，vitest 报 `no tests / exit 1` ⇒ **抄 exit code 会把"文件没解析"当成"判别性成立"**。

**结果一（本协议当场抓出并修掉 4 处真类型错误 TS2345）**：原用自造结构体 `SqliteHandle` 当库句柄，缺 `memory/readonly/name/open/…` ⇒ 传给 `new SqliteGraphStore(db)` 报 TS2345；**全局 tsc 永远看不见**（`tests` 被 exclude）。已修：改用 `better-sqlite3` 真实类型 `type Db = Database.Database`（零 `as any` / `as unknown as`）。

**结果二（破坏态，两小步 + exit code 原始读数）**
```
期望用例数（源文件真值）: it( 11 + realIt( 1 + inplaceIt( 1 = 13
步骤①-b 单文件 tsc（破坏态）: TSC_DAMAGED_EXIT=2  TS1xxx 计数 = 0  本测试文件诊断数 = 0
        （余下 3 条 TS2307 全在 src/**，是 @synova/logger 为 vitest alias 所致的单文件编译假象，非本卡缺陷）
步骤②-b vitest 收集数: Test Files 1 failed (1) ｜ Tests 5 failed | 6 passed | 2 skipped (13)
        ⇒ 收集数 13 == 期望 13（**不是 no tests**），且逐用例行有具名 ×/✓/↓
失败证据: AssertionError: expected false to be true ｜ Error: [1057] 实例文件不存在: …activity-production-wani-baby-001.json
步骤③ 两小步都过后才读 exit code: VITEST_DAMAGED_EXIT=1
复原: sha256 = 9c9aa30a629a91a875f390198afca950ba09e1674f5011ae30bcb3105a8f292e（与破坏前逐字一致）
绿腿复跑: tsc TS1xxx=0 / 本文件诊断=0 ｜ Tests 11 passed | 2 skipped (13)
```
⇒ 判别性成立：**收集数满 + 断言真失败**，不是"解析失败被当成红"。
**遗留（控制塔域，本卡不碰）**：给 `tests/` 建专用 tsconfig ⇒ 提案→K3→CTO。

---

## 6. 写集互斥 / 冲突扫描（M2；完整输出，标注「共 N 处」）

```
扫描 1｜src+tests 中引用 `ontology/activity` 的 .ts 文件：**共 1 处**（= 本卡新建测试自身）
    tests/l4/activity-instance-1057.test.ts:58  const ACTIVITY_DIR = join(REPO_ROOT, 'extensions', 'ontology', 'activity');
扫描 2｜`loadOntology(` 装配点（排除 loader 本体）：**共 4 处**
    src/init/file-driven-loaders.ts:96 / src/mcp/tool-definitions.ts:394 / src/routes/ontology-admin.ts:17 / src/sentinel/sentinel-loader.ts:219
扫描 3｜10 个属性名在 HEAD 基线（main 5a6591c4a）的引用：
    headcount => 26 处；hours_per_run / runs_per_period / unit_labor_cost / error_rate / structuredness /
    error_tolerance / data_reachability / agent_readiness_score / agent_type_recommendation => 各 0 处
扫描 4｜本卡文件名唯一性：`activity-instance-1057` 命中 3 个文件（本卡 task brief / 读卡确认 / 测试自身）——**无他卡撞名**
扫描 5｜写集交叉核：本卡 `extensions/ontology/activity/**`；并行卡 #1134 = `edge-types/**`、#1436 = `pool|external/**` ⇒ **不同子目录，无交叉**
```

🔴 **同名近义披露（不隐藏在结论里）**：`headcount` 在 main 本体中**已存在**，语义位置 3 处 —— `resource/team.json`（团队人数）、`outcome/people.json`（人员结果）、`field-mappings/hr-standard.json`（外部字段「员工总数」）。本卡新增的是**作业单元投入人数**（`activity/*`）。属**不同节点类型下的近义字段**，非"同一概念两个 id"；若 CTO 要求改名（如 `staff_count`），每文件 1 行改动 ⇒ 列入未决项。

---

## 7. 改动清单（数字来自命令原始输出）

```
$ git status --porcelain
 M extensions/ontology/activity/acquisition.json
 M extensions/ontology/activity/compliance.json
 M extensions/ontology/activity/coordination.json
 M extensions/ontology/activity/governance.json
 M extensions/ontology/activity/innovation.json
 M extensions/ontology/activity/learning.json
 M extensions/ontology/activity/maintenance.json
 M extensions/ontology/activity/production.json
?? .claude/task-briefs/1057-activity-instance-props.md
?? extensions/ontology/activity/instances/
?? tests/l4/activity-instance-1057.test.ts

$ git diff --stat     （提交前，仅已跟踪文件）
 8 files changed, 8 insertions(+), 8 deletions(-)
```

**文件总数**：8 改 + 3 新（实例 JSON / 测试 / task brief）= **11 个**；其中治理产物（task brief）不计入 PR 预算 ⇒ **PR 内产品/测试文件 = 10 ≤ 12** ✔｜**单域**（L4 本体内容面）✔

---

## 8. 自验独立性与边界

**判据资格口径（原文照录 · CTO/队长 2026-10-09 裁定）**：**活库 = 交付本体，fixture = 判据**。
即：真机库那条 `activity/production` 节点是**交付本体 + 留档**，**不得充当判据**；判据①的可复现来源 = **cwd 在本工作树内**的隔离 fixture（旧形态库 DDL 逐列抄真机读数 → 自愈迁移 → 写入 → 判据 SQL），加"裸 INSERT 必红"判别性反证。

- **本件不含"审计通过"字样**；编码（`k4-coder-c`）**不自判通过**。自验由独立成员（task-8 `docs/synova/product-lines/evidence/1057-verify-*.md`）执行，三态结论归其出具；通过与否归 CTO 收件闸 + K3 终审。
- 提交前已跑定向测试（**未跑全量 vitest**，遵守"重型验证串行 ≤1"上限）。
- 本卡提交 4 个（时间序，无 amend/rebase 改写）：`17d1d18be`（仅 task brief，先于写码）→ `d083c212b`（brief 改名加日期前缀，修组 12 日期窗口）→ `ad7ab56ac`（实现 + 本证据件）→ `3975cd5ed`（`.claude/claims/1057.yaml` 写集声明，治理产物）。
- 组 12 载体双备：date-prefixed brief（本地认领）+ `.claude/claims/1057.yaml`（**日期无关**，CI 可核：`--issue-of fix/1057-activity-instance-props ⇒ 1057`、`--path 1057 ⇒ 该文件`、`--coverage` 本卡 13/13 全覆盖、`broken=[] degraded=false`）。
- **提交后复跑**（committed tree，worktree 干净）：`Tests 11 passed | 2 skipped (13)` exit 0；复跑后真机库 sha256 **仍为 `771f0677…`**、`activity/*` 计数**仍为 1** ⇒ 证明测试 cwd 隔离生效、无二次写入。

## 9. 遗留 / 待裁清单（未解决项，直说）

1. 🔴 **`graph_triples` 同样缺 `props` 列且零迁移** ⇒ 本机 `createEdge` 硬失败、`queryEdges` 失败后静默返回 `[]`（队长裁定 ④ 明示 #1455 在修）。⇒ **本卡未建任何边**；"实例 + 因果边"里的**边那半今天物理不可用**，待 #1455 落地后另卡接续。
2. 🔴 **`graph_nodes` 形状漂移**（真机复合 PK `(id, graph)`、缺 `valid_from`、多 `confidence`/`updated_at`/`props_json`，与 canonical `SCHEMA_SQL` 不一致；迁移 001 未涉主键）⇒ **本批不重建**，**建议另立卡**（提案→K3→CTO），本卡不擅动。详见 §2.6。
3. **表级副作用**：在位运行同时建了 `metric_readings` / `orgs` / `schema_version` 三表（库表 52→55），属 `reconcileSchema` 行为，非本卡手工动作。详见 §2.5。
4. **SOG 校验器无 `activity/*` schema** ⇒ 走「未覆盖类型 — 可见降级放行」（`src/l4/sog-schema-validator.ts:198-210`，`NODE_SCHEMAS` 仅 8 个旧 UPPERCASE 类型）。不在本卡修（`src/**` 禁碰；#980/#1436 域）。
5. **实例值多为手填占位**（`_provenance` 标注 `handfill:`），**待真实访谈核实**；`data_reachability`/`capacity_utilization` 为 golden 近似派生（语义近似已标注）。
6. **`agent_readiness_score` / `agent_type_recommendation` 的口径属 3-6（agent_readiness）** ⇒ 本卡只落示例值 + 自由文本，**不锁死算法/枚举**。
7. **10 属性的类型口径（9 number + 1 string）为本卡自决**（卡面未给），可被 3-6 推翻。
8. `headcount` 与 `resource/team`、`outcome/people` 近义（见 §6 披露）⇒ 是否改名待 CTO 裁。
9. 测试文件按卡面指定名 `activity-instance-1057.test.ts`（实质含真实 SQLite I/O，按铁律 33 本可叫 `.integration.test.ts`）；**遵卡面文件名**，此处备案。
10. **未合并**：GitHub 账号级封禁 ⇒ 无 `ls-remote` 回执（实测 `git ls-remote --heads origin` ⇒ **exit 128 `ERROR: Your account is suspended`**）、未 push、未开 PR、未回填板。本地 commit 见分支 `fix/1057-activity-instance-props`（4 个，见 §8）。
