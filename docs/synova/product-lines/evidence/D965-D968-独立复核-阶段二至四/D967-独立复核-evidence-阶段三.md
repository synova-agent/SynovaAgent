# D967 栈式两支 独立验收 evidence（task-4 阶段三）

> 复核员：`sentinel-verifier`（独立复核员，**非编码**；只读仓库，产物全部在 `/tmp/verify-d967/**`）
> 口径：只出 **自验结论**；永不写「审计通过」。判据 = **运行时断言 + 改坏即红**；**不复用被验方脚本作判据**。

## 0. 环境与栈结构（先量）

| 项 | 值 |
|---|---|
| PR-A（栈底, win 域） | `feat/D967a-measurements-store` @ `2017a9cf45712af28ff9df365a70c5cae373cc66` |
| PR-B（base=PR-A, mac 域） | `feat/D967b-sentinel-alert-stats` @ `80045321fe1194e10ef8810065e9a8116ca3a796` |
| 我的验收工作树 | `.synova-wt-vd967a@2017a9cf` ／ `.synova-wt-vd967b@80045321` ／ `.synova-wt-main967@ef299746`（对照） |
| ls-remote 回执 | 两分支与发单 HEAD 逐字一致 |
| 栈关系 | `merge-base(A,B)=2017a9cf=A`；`A` 是 `B` 的祖先 ✅ ⇒ PR-B 树 = A∪B，跨 PR 联合验收点可在 PR-B 树上做 |
| 真实基线 | `origin/main` = `ef299746`（A 的 merge-base 与之相同） |
| 生产库 | 全程只读，仅 `sqlite3 .backup` 快照 |

`plan.json` 只增不改（发单方特别要求）：

```
$ git diff -U0 ef299746..2017a9cf -- .claude/plan.json | grep '^-[^-]'
-  "current_phase": 2,
（仅此一行；新增 23 行）
$ ... | grep -E '^\+.*(step|action|wiring)'
+      "step": 3,
+      "action": "D967 PR-A（win 域，栈底）… 本支 API 的消费者是 PR-B（src/sentinel/runner.ts，mac 域，base = 本支）⇒ 接线在后续阶段；栈式两支拆分经 CTO 2026-09-25 裁定。",
+      "checks": { "wiring": "deferred", "test_pairing": "enforce" }
```

⇒ **「PR-A 单独看无同域消费者」= plan.json 声明的 deferred，非缺陷**（按发单方提示，不判缺陷）。

---

# 一、七条权威 Done 逐条自验

## ① measurements 8 列 + 时序索引 —— **成立**

我自建 harness（`:memory:` + `reconcileSchema`，`db.name=:memory:`）：

```
# measurements 列 = ["entity_id:TEXT(pk)1","metric_id:TEXT(pk)2","value:REAL","computed_at:TEXT(pk)3",
                     "run_id:TEXT(pk)4","source:TEXT","input_digest:TEXT","def_version:TEXT"]
# 索引 = [{"name":"idx_measurements_entity_metric_time","unique":0},
          {"name":"sqlite_autoindex_measurements_1","unique":1,"origin":"pk"}]
# 时序索引列 = [["entity_id","metric_id","computed_at"]]
```
8 列 ✓（与 `MEASUREMENTS_TABLE_DDL` 逐字一致）；复合主键 `(entity_id, metric_id, computed_at, run_id)` ✓；时序索引列序一致 ✓。

## ② `UPDATE/DELETE measurements` 在 `src/` = 0 + 静态守卫 —— **成立（含改坏即红）**

```
$ grep -rn "UPDATE measurements\|DELETE FROM measurements" src/ --include="*.ts"   → 0 处
```
守卫 = `tests/store/measurements-append-only.test.ts`（静态扫 `src/**` + 自证判别 + API 导出面检查）。
**改坏即红（我在 /tmp 副本注入）**：

```
× src/ 内 UPDATE/DELETE measurements 计数 = 0
AssertionError: 发现针对 measurements 的改写语句: [{"file":"src/store/measurements.ts","hits":["UPDATE measurements"]}]
 Tests  1 failed | 2 passed (3)      ← 守卫本身「能识别」的用例仍绿（判别性用例设计正确）
```

## ③ 跑一次哨兵 ⇒ measurements 有该 metric_id 行 —— **成立**

自建探针（公开 API：`reconcileSchema` → `CronScheduler` → `SentinelRunner` → `runOnce`；`:memory:`）：

```
# run R1: findings=3 ｜ run R2: findings=5 ｜ run R3-零finding: findings=0
# 全部 measurements 行数 = 9 （3 次运行 × 3 metric）
# metric_id 清单 = ["vd967-probe:critical_count","vd967-probe:finding_count","vd967-probe:warning_count"]
# 行样例: {"entityId":"","metricId":"vd967-probe:finding_count","value":3,
           "computedAt":"2026-09-25T15:59:18.088Z","runId":"vd967-probe@2026-09-25T15:59:18.088Z",
           "source":"sentinel","inputDigest":"vd967-probe|ok|normal|f1,f2,f3","defVersion":"sentinel-counters/v1"}
```
零 finding 也落盘（`value: 0` = "测到 0"，非"没测"）✓。

## ④ 改名 + 消费点全绿 + PDP 不写伪条目 —— **成立（三部分分别有判别性夹具）**

**(a) 改名（ALTER … RENAME TO，原地保数据）**

```
A) 实现路径（PR-B 代码）
before: tables=["sentinel_baselines"] old_rows=3 indexes=[idx_sentinel_baselines_sid, …]
after : tables=["sentinel_alert_stats"] new_rows=3 indexes=[idx_sentinel_alert_stats_sid, …]
搬运后数据: [cash-runway/5, cash-runway/7, unit-economics/3]   ← 逐行保留
追加后 new_rows=4 ｜ 幂等再跑: tables 不变, new_rows=4
```
**(b) 反事实陷阱（建新表 = 静默丢数据）**

```
before: tables=["sentinel_baselines"] old_rows=3
after : tables=["sentinel_alert_stats","sentinel_baselines"] new_rows=0 old_rows_still_there=3
应用层 getBaseline(...) = {"totalRuns":0, …, "baselineReady":false}   ← 历史对应用层"消失"
```
**(c) 旧名残留**：`src/` 5 处**全部在改名逻辑内**（注释 / sqlite_master 探测 / ALTER / DROP INDEX / log）；读写路径均已用新名（INSERT / SELECT / CREATE TABLE / CREATE INDEX 各 1 处）。
**(d) 消费点全绿**：我自建副本（**无 `data/synova.db`**）跑 `tests/sentinel` 全量 → `Test Files 211 passed | 1 skipped`，`Tests 951 passed | 1 skipped`。
**(e) PDP 伪条目（绿/红对照）**

```
[GREEN] 调用前=0 → 调用后=0，无 org-baseline-* → ASSERT HOLDS
[RED-RESTORED（把被删的旧代码放回）] 调用后=1 →
   {"sentinel_id":"org-baseline-verify-team","finding_count":0,…} → ASSERT VIOLATED
```

## ⑤ 同 metric 两个 computed_at 相减（delta=+2 / defVersionMatched=true）—— **成立**

```
# diffMeasurement(from=R1(value=3), to=R2(value=5)) → {"delta":2,"defVersionMatched":true}
# diffMeasurement(critical_count) → {"delta":1,"defVersionMatched":true}
```

## ⑥ P7 整表重建（真实生产副本三条 ALL PASS）—— **成立**

端到端（**生产启动路径**：`new SqliteGraphStore(prodCopy)` → 构造器内 `reconcileSchema`）：

```
before: id=INTEGER props=false rows=0
after : id=TEXT props=true rows=0 idx=[idx_gt_subject, idx_gt_object, idx_gt_predicate, idx_gt_weight, idx_gt_valid, sqlite_autoindex_graph_triples_1]
measurements 表 = true
ALL PASS ① schema 回 canonical = true ｜ ② queryEdges = YES ｜ ③ createEdge = YES(edge-df5b6f03-aa)
```
**有数据的重建**（我自建 3 行 legacy，含 1 行软删除）：

```
[L before] id=INTEGER props=false rows=3
[L after ] id=TEXT props=true rows=3  idx=5 个 canonical 索引 + PK autoindex
   id=1 (text) props="{\"edge\":\"1\"}" valid_to=null
   id=3 (text) props="{\"edge\":\"3\"}" valid_to=2026-01-01 00:00:00   ← 软删除行保留
[L after] createEdge=YES ｜ queryEdges 读回=3 行 ｜ 幂等: 行数 4→4，列数 12
```
全新库（`graph_triples` 不存在）→ 迁移 no-op（交给 initSchema）✓。

## ⑦ 测试只用临时/内存库 —— **成立**

我把 PR-B 树 `git archive` 到 `/tmp`（副本 `data/` 下**只有 `golden`，无 `synova.db`**），跑 D967 定向 7 文件：

```
✓ tests/store/measurements.test.ts (9)   ✓ tests/store/measurements-append-only.test.ts (3)
✓ tests/store/migrations/002-graph-triples-rebuild.test.ts (7)   ✓ tests/store/migrations/003-measurements-table.test.ts (6)
✓ tests/store/schema-migration.test.ts (12)   ✓ tests/sentinel/baseline-store.test.ts (15)
✓ tests/sentinel/measurements-wiring.test.ts (5)
 Test Files 7 passed (7)   Tests 57 passed (57)
```
wiring 测试显式 `new Database(':memory:')`；全程无内建生产库依赖 ⇒ 判据成立。

---

# 二、三条「必须独立证实或证伪」的关键声称

## 声称 1「迁移机制整体失效 + 非确定性」—— **成立（我自建判别性实验）**

**(a) 并列行确认（生产副本只读）**

```
$ sqlite3 prod.db "SELECT rowid, version, typeof(version), updated_at FROM schema_version ORDER BY rowid DESC LIMIT 3;"
18|2|integer|2026-09-13 01:52:53
17|d93b_actor_role|text|2026-09-13 01:52:53      ← 同一秒并列
16|2|integer|2026-09-13 01:52:28
```
**(b) 非确定性（物理行序翻转即改变结果）**

```
变体 A（生产原样: text 行在前, int 行在后）  旧口径 → d93b_actor_role (text)
变体 B（删两行后按 int 在前/text 在后重插）  旧口径 → 2 (integer)
```
⇒ `ORDER BY updated_at DESC LIMIT 1` 在并列时结果**未定义**，仅物理行序不同即可翻转。

**(c) 后果（旧代码 vs 新代码 × 两个变体）**

| 变体 | 旧代码（main ef299746） | 新代码（PR-A） |
|---|---|---|
| A | **零迁移执行**：`measurements` 仍 no、`graph_triples` 仍 `id=INTEGER/props=false`，只追加一行版本（rows 18→19） | 执行 002+003：`measurements=YES`、`graph_triples → id=TEXT/props=true`、MAX=4（rows 18→20） |
| B | 早退（rows 18→18），同样零迁移 | 与 A 完全一致（rows 18→20） |

**(d) 机制复现（自实现 pending 计算）**

```
旧口径 currentVersion = "d93b_actor_role" (string) → pending = []      ← NaN 比较恒 false
新口径 currentVersion = 2                          → pending = [002, 003]
NaN 复现: ('d93b_actor_role' > 3) = false ; ('d93b_actor_role' >= 4) = false
```
**(e) 反例边界（发单方特别要求）**：`graph_nodes.props 存在 = true`、`schema_version 数值行数 = 10` ⇒ **不是"从未跑过任何迁移"**，001 历史上确实跑过；失效的是"文本行污染后的后续迁移"。

## 声称 2「只 ALTER ADD COLUMN 修不好写路径」—— **成立**

为保证观测到"仅补列"断面，我把 `schema_version` 数值行钉到 4（构造器早退、不自动修表）：

```
═══ legacy(仅缺列) ═══      createEdge = THREW: table graph_triples has no column named props
                            queryEdges 读回 = 0 行（表内 2 行）
                            整表重建后 createEdge = OK ｜ queryEdges = 3 行
═══ props-added(只补列) ═══  createEdge = THREW: datatype mismatch      ← 判别性证据
                            queryEdges 读回 = 2 行（读修好、写仍坏）
                            整表重建后 createEdge = OK ｜ queryEdges = 3 行
```
（注：在 PR-A 代码下，直接 `new SqliteGraphStore(db)` 会**自动**跑 002 修好表 ⇒ 观测"仅补列"断面必须先钉版本号，否则会被构造器修好而看不到红。）

## 声称 3「改名必须原地 ALTER … RENAME TO，建新表会静默丢数据」—— **成立**

见 ④(a)(b)：原地 RENAME ⇒ 3 行保留；建新表 ⇒ 新表 0 行 + 旧表数据孤悬 + 应用层 `totalRuns=0/baselineReady=false`。

---

# 三、两条「已登记语义偏差」核对（不判缺陷，只核登记与影响面）

| 偏差 | 登记位置 | 我核对的原文要点 | 运行时佐证 | 判定 |
|---|---|---|---|---|
| `inputDigest` 用运行指纹代替输入哈希 | PR-B evidence §7.1（"批级未清项①"，含"没防住什么"） | 明写"不等于输入内容哈希"；指出"图输入变但 finding id 集不变时指纹不变" | `inputDigest = "vd967-probe\|ok\|normal\|f1,f2,f3"`（只含 sentinel id + ok/degraded + finding id 有序集，确无输入数据） | **登记如实、影响面准确** |
| `entityId` 恒 `''` ⇒ entity 维度不可分 | PR-B evidence §7.2（"批级未清项②"） | 明写"多客户场景下所有组织的同名 metric 写进同一 `entity_id=''` 分区 ⇒ 同表混流"，并限定"单客户部署结论有效、多租户只能按组织级汇总" | 运行时 `entity_id` 取值集合 = `[""]`（9 行全空） | **登记如实、影响面准确** |

**补充发现（发单方未列，我实测新增）**：`measurements` 主键含 `run_id`，而 `runId = ${sentinelId}@${checkedAt}`（毫秒级）；`entity_id` 恒空 ⇒ **两个组织在同一毫秒跑同一哨兵会产生完全相同的四元主键**。实测第二次写入 **抛错**：

```
二次写入 = THREW: UNIQUE constraint failed: measurements.entity_id, measurements.metric_id, measurements.computed_at, measurements.run_id
表内行 = [{"value":1,…}]   ← 后写者未覆盖，直接丢失
```
runner 侧该异常被 `catch` 降级为 `log.warn('[runner] measurements 时序落盘失败 — 降级')`（`recordMeasurements` 是单事务 ⇒ 该次运行的 3 条 metric **整批丢弃**）。
⇒ 这是 `entityId` 偏差的**新增影响面**（多租户同毫秒 = 静默丢记录），建议登记进 §7.2 或后续卡。

---

# 四、与发单方/被验方不一致之处

| # | 来源 | 其表述 | 我的实测 | 性质 |
|---|---|---|---|---|
| 1 | `src/store/measurements.ts` 注释 | "同主键重复写入 → **覆盖为同一内容，SQLite UPSERT 语义**" | 实测 **抛 `UNIQUE constraint failed`**（SQL 是裸 `INSERT`，无 `ON CONFLICT`） | 🟡 代码注释与行为不符（非 Done 判据项，但会误导下游） |
| 2 | PR-B evidence §④ | "改名 + **5 消费点**" | `src/` 中旧名 5 处**全部在改名逻辑内**；真正消费点（写/读/建表/建索引）共 4 处以新名出现；全量 `tests/sentinel` 951 passed | 🟡 表述口径差异（"5"= 旧名残留行数，非"5 个消费点"）；结论不受影响 |
| 3 | PR-B evidence | "`tests/sentinel/` 全量 **236 passed**" | 我跑同目录 **951 passed / 1 skipped**（超集全绿） | ⚪ 范围口径不同（其为子集），非矛盾 |
| 4 | 发单方转述 | "改名 + 5 消费点全绿" | 同 #2 | 同上 |

# 五、未能复现项（诚实登记）

1. **未运行被验方脚本**（`p7-acceptance.mts` 等）：按纪律全部用自建探针/夹具；其"结果 txt"仅作对照，未逐条对拍。
2. **未跑全仓库 vitest**（其 evidence 有 10934 行 `vitest-full.txt`）：本轮只跑 D967 定向 7 文件（57 tests）+ `tests/sentinel` 全量（952）+ 两处红对照。全仓回归不在本轮判据内。
3. **非确定性未在"同一文件上重复观测到两种结果"**：我观测到的是"并列行存在 + 翻转物理行序即改变结果"（构造性证明 + 旧代码在两个变体下行为不同）。同一生产文件的 10 次重复查询当前稳定返回 text 行——即**当前实际态是"迁移不跑"**，"有时跑"是可被物理重排触发的风险，非已发生的抖动。
4. **PR-A 单独全量验收**：PR-A 无同域消费者（plan.json `wiring: deferred`，CTO 已批），我只验其存储层与迁移本体；其 API 的生产消费在 PR-B 树验证。

# 六、红线自证

- 未修改任何仓库文件；三个验收工作树 `git status --short` 为空；全部实验在 `/tmp/verify-d967/**`。
- 生产库只读（`.backup` 快照）；未对 `data/synova.db` 写入。
- 未复用被验方脚本作判据来源；未写「审计通过」；未触碰 `scripts/audit/**`。
