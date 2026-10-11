# #237 (K4-04) 图边读/写修好 — B2-GRAPH · P1

**分支** `fix/237-graph-triples-rebuild` ｜ **base** `local-main` ｜ **建分支时基线** `68bf5759878a458b5e5ceb324a32878660155517`（＝现测 merge-base）
**读数时点（本文 sha/字节数现测于）**：`09240a496935900fdf902f25d5c5c4dcb8229cca`（本正文 commit 仅同步文档）
**内容来源（口径必须写严）**：**只读旧仓** `D:\novis-backup-20260526\Novis\synova-agent` 的**本地分支** `fix/1455-graph-triples-props @ a797bdcb4` —— 🔴 **该对象未推送到 Gitea 远端**（复核员受控对照：已知对象走 blob API `HTTP 200 / 8534 B`、左对象 `e47568b663…` 同端点 `HTTP 400`；`git fetch <sha>` 与按 ref 取均失败）。**取回方式**：在本工作区同名本地分支上逐字节 `git cat-file blob`，并以 `git hash-object -t blob` 自证 sha；复核员另在只读旧仓独立取到同一对象并自证 sha。

---

## (a) 改了什么（逐文件一句话）

| 文件 | 一句话 |
|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts`（新） | 捡回整表重建迁移（`version: 5`）：旧库 `graph_triples` 事务内重建到 canonical（`id TEXT PRIMARY KEY` + `props`）+ 5 索引；**仅 1 处 JSDoc 注释改动**（净 +1 行），见 (d) |
| `src/store/schema-migration.ts`（改） | 只取「注册 004」改动：import + 注册项 + `SCHEMA_VERSION 4→5` |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts`（新） | **卡面 Done① 点名入口（验收责任在此件）**：6 例，真机 DDL 夹具 → 生产构造路径（读/写双通） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts`（新） | **额外回归**（16 例，含 D4 同形守卫）；**不得顶替 Done① 入口** |
| `tests/store/schema-migration.test.ts`・`tests/store/migrations/003-orgs.test.ts`・`tests/store/metric-readings-schema.test.ts`（改） | `SCHEMA_VERSION` 4→5 **逐条改 3 处**；🔴 `003-orgs.test.ts:39`（003 自己的 `version=4` 元数据断言）**逐字未动** |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md`（新） | 捡回的证据件（433 行） |
| `docs/synova/product-lines/evidence/237-k4-04/**`（新） | 判据原始输出、收尾三件（`README.md`）、CI 日志、Done⑤ 脚本/输出、Z8 提案（`PROPOSAL-skill-tool-discipline.md`） |
| `docs/synova/product-lines/evidence/k4-04-verify-review-20261011.md`（新） | **独立复核件 v1.8（后升 v1.9）**（逐字节搬运，实施员不编辑一字；`git rev-parse 4ae424e51:<path>` = `c1313b22b7efb56dff861519ed78b9103c91dc43`（**该读数为对象 `4ae424e51…` 时点；当前 HEAD 见 L221 / §16**）） |
| `.claude/claims/237.yaml`（新） | 认领件（`writeset` + `done:` 三条 `verify:`） |

## (b) Done ①②③⑤ 逐条勾选 + 判据原始输出

- [x] **Done①**（**验收责任 = 卡面点名的 `tests/adapters/sqlite-graph-store.legacy-schema.test.ts`**）
  ```
  Test Files  1 passed (1)
       Tests  6 passed (6)
  EXIT=0
  ```
- [x] **Done②**（反例：只 `ADD COLUMN props` ⇒ 必红）—— 造红 B 原始输出：
  ```
  Test Files  2 failed (2)
       Tests  12 failed | 10 passed (22)
  EXIT=1
  × 【L2 真路径·写面】同一 store createEdge() 成功（半修的 datatype mismatch 已消失）
  × ① createEdge() 成功：返回 edge- 前缀 id、props 正确落库、queryEdges 计数 +1
  AssertionError: expected [Function] to not throw an error but 'SqliteError: datatype mismatch' was thrown
  （`datatype mismatch` 命中 10 处）
  ⇒ 恢复后：Tests 22 passed (22) / EXIT=0（恢复以 hash-object 双端同 sha 证明）
  ```
- [x] **Done③**（反例：删掉迁移 ⇒ 必红）—— 造红 A 原始输出：
  ```
  Test Files  2 failed (2)
       Tests  9 failed | 13 passed (22)
  EXIT=1
  AssertionError: expected [] to have a length of 2 but got +0
  SqliteError: table graph_triples has no column named props
  ⇒ 恢复后：Tests 22 passed (22) / EXIT=0
  ```
- [x] **Done⑤**（CTO v3 口径：node + better-sqlite3；只读、未写、未拷）：
  ```
  [db] D:\novis-backup-20260526\Novis\synova-agent\data\synova.db
  [file_bytes] 12959744
  [mode_immutable1] FAILED: unable to open database file ⇒ 回落 readonly + query_only
  [mode] readonly:true + PRAGMA query_only=1
  [count] 14
  [cols] id:INTEGER(pk), subject_type:TEXT, subject_id:TEXT, predicate:TEXT, object_type:TEXT,
         object_id:TEXT, graph:TEXT, weight:REAL, props_json:TEXT, confidence:REAL, source:TEXT,
         valid_from:TEXT, valid_to:TEXT, created_at:TEXT
  [has_props_json] true   [has_props] false   [id_type] INTEGER
  [sha256_before] 771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a
  [sha256_after]  771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a
  [sha256_unchanged] true
  ```
  ⇒ 卡面前提（真库 `props_json` 在、`props` 不在）**实测成立**；本体 sha256 前后一致（`-shm`/`-wal` mtime 变化按 CTO 裁定豁免）。克隆内 `data/` 只有 `golden/`（无 `synova.db`）⇒ 单时点。

**旁证（原始输出见证据目录）**：D3 `tests/store/` = `12 passed (12) / Tests 107 passed (107) / EXIT=0`；
D4 同形守卫单跑 = `1 passed | 15 skipped`；D6/D7 探针 = `[read] queryEdges N = 2` → `[write] createEdge = edge-… no-throw = true` → `[read-after] N = 3`、`[D7②] canonical_12_equal = true | count = 12`、`removed_extra = true`。

## (c) C5′ — Done④ 未交付

**Done④ 未交付 ⇒ 已拆卡 #345**

（本 PR 不实施：`src/adapters/sqlite-graph-store.ts:255-259` 仍为 `log.warn + return []`；原因：该文件被在飞分支 `fix/1421-skills-type-assumption` 占用，写集禁 `src/adapters/**`。另立卡口径（CTO 给）：与同文件 `queryNodes` 的 **D355 先例同款**（`log.error` + `"no such column"` 识别 + **仍返回 `[]`**）；`degraded` 通道**另案**。）

## (d) 注释改动声明

> **注释改动声明**：`a797bdcb4:src/store/migrations/004-graph-triples-rebuild.ts` blob `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B）↔ `HEAD` 同路径 blob `46e255d5540271684025465dfacf183ed1749052`（8534 B）；差 **+36 B / 净 +1 行（1 hunk / 2 删 3 增）**，内容为 **1 处 JSDoc 注释**（在飞 PR 号 `#1424` → 分支名 `fix/1421-skills-type-assumption`），**代码零改动**（`git diff <old-sha> <head-sha>` 全文已贴）。

```diff
diff --git a/e47568b663edae57984095072a7f76d4e8ee9931 b/46e255d5540271684025465dfacf183ed1749052
index e47568b66..46e255d55 100644
--- a/e47568b663edae57984095072a7f76d4e8ee9931
+++ b/46e255d5540271684025465dfacf183ed1749052
@@ -42,8 +42,9 @@ import type { Migration } from '../schema-migration';
 
 /**
  * canonical `graph_triples` DDL。
- * 🔴 与 `src/adapters/sqlite-graph-store.ts` `SCHEMA_SQL:38-51` **同形**（该文件被在飞 PR #1424 占用，
- *    不可导出/不可改 ⇒ 此处复制，并由 `tests/store/migrations/004-*.test.ts` 的静态同形守卫钉死防漂移）。
+ * 🔴 与 `src/adapters/sqlite-graph-store.ts` `SCHEMA_SQL:38-51` **同形**（该文件被在飞分支
+ *    `fix/1421-skills-type-assumption` 占用，不可导出/不可改 ⇒ 此处复制，并由
+ *    `tests/store/migrations/004-*.test.ts` 的静态同形守卫钉死防漂移）。
  */
 const CANONICAL_TRIPLES_DDL = `
 CREATE TABLE graph_triples (
```

## (e) 「相同」声明的两个对象 + 现测（新口径）

| 对象 A（`a797bdcb4:<path>`） | 对象 B（`HEAD:<path>`） | 差 | 现测命令 |
|---|---|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts` sha `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B） | sha `46e255d5540271684025465dfacf183ed1749052`（8534 B） | **+36 B / 净 +1 行（2 删 3 增）· 1 hunk · 全在 JSDoc 内** | `git rev-parse` + `git cat-file -s` + `git diff <A> <B>`（全文见 (d)） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts` sha `78a05eb4ffed2092da597e81b9b28d13270c1964`（16652 B） | sha `78a05eb4ffed2092da597e81b9b28d13270c1964`（16652 B） | **同 sha（0 B / 0 行）** | 同上（两对象 sha 现测一致；`git diff A B` 空） |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` sha `10e32f07c697d1899c2aefa3672e9bfba1830ff1`（30391 B） | sha `10e32f07c697d1899c2aefa3672e9bfba1830ff1`（30391 B） | **同 sha（0 B / 0 行）** | 同上 |
| `src/store/schema-migration.ts` sha `cc5feace6e03a7afa60158c5b6af2eb5cdbcb7ec`（5731 B） | sha `cc5feace6e03a7afa60158c5b6af2eb5cdbcb7ec`（5731 B） | **同 sha（0 B / 0 行）** | 同上 |

> 口径：凡称「相同」，写明**两个对象**并**当点现测**；⛔ 不再使用「逐字节一致 / delta=0 / 无差异」等无对象、无时点的表述。

## (f) D8 写集（口径 = `merge-base`，非死 SHA）

`git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD`，`MERGE_BASE=68bf5759878a458b5e5ceb324a32878660155517`，共 **31 文件**（含本轮新增的复核件搬运）：

```
.claude/claims/237.yaml
docs/synova/product-lines/evidence/237-k4-04/CI-repro-BASELINE-68bf57598.txt
docs/synova/product-lines/evidence/237-k4-04/CI-repro-head-Windows.txt
docs/synova/product-lines/evidence/237-k4-04/CI-run-281-existing-red.log.txt
docs/synova/product-lines/evidence/237-k4-04/CI-run-307-push-failure.log.txt
docs/synova/product-lines/evidence/237-k4-04/D2-targeted.txt
docs/synova/product-lines/evidence/237-k4-04/D2a-adapter-legacy.txt
docs/synova/product-lines/evidence/237-k4-04/D2b-migration-004.txt
docs/synova/product-lines/evidence/237-k4-04/D3-store-regression.txt
docs/synova/product-lines/evidence/237-k4-04/D4-shape-guard.txt
docs/synova/product-lines/evidence/237-k4-04/D5-red-A-no-registration.txt
docs/synova/product-lines/evidence/237-k4-04/D5-red-A-restored-green.txt
docs/synova/product-lines/evidence/237-k4-04/D5-red-B-add-column-only.txt
docs/synova/product-lines/evidence/237-k4-04/D5-red-B-restored-green.txt
docs/synova/product-lines/evidence/237-k4-04/D6-D7-legacy-probe.txt
docs/synova/product-lines/evidence/237-k4-04/d6-legacy-probe.ts
docs/synova/product-lines/evidence/237-k4-04/D9-token-scan.txt
docs/synova/product-lines/evidence/237-k4-04/done5-read-real-db.cjs
docs/synova/product-lines/evidence/237-k4-04/done5-real-db-columns.txt
docs/synova/product-lines/evidence/237-k4-04/PR-BODY.md
docs/synova/product-lines/evidence/237-k4-04/PROPOSAL-skill-tool-discipline.md
docs/synova/product-lines/evidence/237-k4-04/README.md
docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md
docs/synova/product-lines/evidence/k4-04-verify-review-20261011.md
src/store/migrations/004-graph-triples-rebuild.ts
src/store/schema-migration.ts
tests/adapters/sqlite-graph-store.legacy-schema.test.ts
tests/store/metric-readings-schema.test.ts
tests/store/migrations/003-orgs.test.ts
tests/store/migrations/004-graph-triples-rebuild.test.ts
tests/store/schema-migration.test.ts
```
✅ `src/adapters/**` 零命中；`scripts/audit/**`、`scripts/control-tower/**` 零命中。

## (g) token 零落地

```
SCANNED_FILES=4974
TOKEN_HITS=0
```
（口径：工作树全部文件；**排除 `.git` 对象库与 `node_modules`**；token 只经运行时变量/环境变量，未落任何文件、commit、PR 正文。）

## (h) 【CI 红归因】红件逐条点名 + 每条双证据（CTO v4 §① / §2-(h)）

> 红件**应含且仅含**下列两件；本 PR 正文**未点名任何其它红件**。

### 红件 1｜`tests/tui-v2/chat-degradation.test.ts`（6 例；`TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')`）

**证据① — 不在本卡写集**（现测）：
```
$ git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD -- tests/tui-v2/
命中数 = 0
```
**证据② — 在"零本卡改动的基线"上同样红（且存量卡已立）**：
- 实施员实测（基线树 = `git archive 68bf57598`）：
```
Test Files  1 failed | 1 passed (2)
     Tests  6 failed | 6 passed (12)
Caused by: TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
（原始输出：docs/synova/product-lines/evidence/237-k4-04/CI-repro-BASELINE-68bf57598.txt）
```
- **独立复核员 `k4-04-verify`** 另用**完整 checkout** 重做同一对照（非 `git archive`，不受解包完整度影响）⇒ `chat-degradation` **6 failed**、与 HEAD **逐条一致 = True**（复核件 §15.2 附注）；其在 CI 侧另独立取证：run **281**（另一分支 `3449c05bb`）与 run **319**（本卡）**失败用例名逐条对齐**（① ② ③ ④a ④b ⑤ 六条，同根因）。
- **存量卡号：`#347`**（`[open] 存量红（与 K4 批无关）：tests/tui-v2/chat-degradation.test.ts 6/6 红 —— react19 × ink 5.2.1 reconciler 不兼容`）。

### 红件 2｜`tests/stream-tool-loop.test.ts:210`（`Given chat throws an error, When processMessageStream, Then returns error message`）

**证据① — 不在本卡写集**（现测）：
```
$ git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD -- tests/stream-tool-loop.test.ts
命中数 = 0
```
**证据② — 本地 6/6 绿；CI 收的是外部 LLM 文本（两态对照）**：
- 本地（本卡 HEAD 与零改动基线 **两态皆绿**）：两文件同跑为 `1 failed | 1 passed (2) / 6 failed | 6 passed (12)`，其中**该件是"通过的 1 件"**（`CI-repro-head-Windows.txt`、`CI-repro-BASELINE-68bf57598.txt`）。
- CI 侧 **verbatim**（独立复核员自取日志，§15.2-2）：`line=210,column=26::AssertionError: expected '收到你的"测试错误"——我这边运作正常…' to contain '失败'` ⇒ 断言收到的是**真实 LLM 自然语言回复**（provider failover 生效）。
- 该用例只构造 `AgentConversation(fakeProvider)`、**不建库**（imports 见用例头部）⇒ 与本写集**无因果**。

**（引用许可）** 上述复核员读数按 CTO v4 §2-(h) 授权引用，署名 **`独立复核员 k4-04-verify`**；四项原文见本 PR「独立复核四项结论」节。

## (i) 【存量卡号 + 写集内判据全绿】

- **存量红卡号：`#347`**（`tests/tui-v2/chat-degradation.test.ts` 6/6 红，react19 × ink 5.2.1 reconciler 不兼容 —— **与 K4 批无关**）。
- **本卡写集内判据全绿**（**独立复核员已独立重跑**）：**C1 / C2 / C3 / C4 / C5′ / C6 / C7 / C8 / C9 ＋ D8 全部通过**；三件定向同跑 `Tests 28 passed (28)`（验收件 6 ＋ 复核员探针 6 ＋ 004 回归 16）。
- 依 CTO v4 §①（D10 = **存量红点名放行**，**不收紧 `--changed`**）：(a) 红件逐条点名 + 双证据 ✅（见 (h)）；(b) 存量卡已立 `#347` ✅；(c) 写集内判据全绿 ✅。
- **即时生效令合规声明（CTO v4 §①-⑤）**：本 PR 正文**未引用 `check-file-driven.sh` 的任何"事后复跑"读数**；凡引用门禁读数处，均为 **staged 窗口内**（pre-commit）或**改引其它判据**（本地定向测试 / CI 步骤①②）。

## (j) 【DDL 逐字声明】（CTO v4 §①-②：逐字批 12 列 canonical）

1. **三列被移除**：整表重建到 canonical（12 列）时，旧库多出的 **`confidence` / `source` / `props_json` 三列被移除** —— CTO v4 裁定②：**属既定取舍**。
2. **「`props_json` 值并入 `props` 不丢」的断言出处**（用例名 ＋ `file:line`；行号**当点现测**）：

| 用例（`file:line`） | 断言点 | 断言内容 |
|---|---|---|
| `tests/store/migrations/004-graph-triples-rebuild.test.ts:101`「2 行真数据：行数不丢、props_json → props 回填、id CAST 为 TEXT」 | `:109` `:114` `:115` | `edgeCount(db)).toBe(2)`（**行数不丢**）；`JSON.parse(rows[0].props) === {"action_effect_lag":"3-6_months"}`；`rows[1].props === {"share":7}`（**值不丢**） |
| 同文件 `:127`「props_json 为 NULL / 空串的行回填默认 {}，有值行保留原值」 | `:137` `:138` `:139` | NULL/空串 → `'{}'`；有值行 `JSON.parse(rows[2].props) === {"share":7}` |
| 同文件 `:154`「幂等：连跑两次 ⇒ 第二次 no-op（列/索引/行数/值都不变）」 | `:165` `:167` | 行数仍 1；`row.props === {"action_effect_lag":"3-6_months"}` |
| 同文件 `:186`「中间态（id 仍 INTEGER 但已被补过 props 列）⇒ 仍重建（兜住"只补列"半修遗留态）」 | `:194` `:197` | `id` 转 `TEXT`；`props === {"share":7}` |
| 同文件 `:251`「【L2 真路径·读面】真机形态库 → new SqliteGraphStore → queryEdges() 读回 2 条且 props 可解析」 | `:260` `:263` `:264` | `toHaveLength(2)`；`{"action_effect_lag":"3-6_months"}`；`{"share":7}` |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts:104`「① queryEdges() 读回旧边 2 条，且 props 由 props_json 迁入、端点映射正确」 | `:113` `:116` `:117` | `toHaveLength(2)`；`{"action_effect_lag":"3-6_months"}`；`{"share":7}` |
| 同文件 `:133`「① createEdge() 成功：返回 edge- 前缀 id、props 正确落库、queryEdges 计数 +1」 | `:145` `:150` `:152` | `toHaveLength(2)`；读回 `props === {"k":"v"}`；**落库面**（不经读路径）`SELECT props` ⇒ `{"k":"v"}` |
3. **口径**：以上行号现测自本 commit 的工作树（`it(` 行 ＋ 断言行 grep）；若后续 commit 使行号位移，**以复查命令重出**为准。

---

## 独立复核四项结论（M6 回写 · 原文照贴）

> **增量复核**：head `cd1a34a8a9d09edddf8af5ed3ebe83009cafeff0`（见复核件 **§16**，v1.9，blob `625c44c8bc4ed82e33cd7858b6594251bfd29c7b`）；本节的四项结论对象为前序 head `09240a496…`。
**复核员**：`独立复核员 k4-04-verify` ｜ **复核件**：`docs/synova/product-lines/evidence/k4-04-verify-review-20261011.md`（**v1.8 → v1.9**，见本节 L221）｜ **对象**：新 head `09240a496935900fdf902f25d5c5c4dcb8229cca`，base `68bf5759878a458b5e5ceb324a32878660155517`

**复核员结论原文**：
> **`自验结论`：新 head `09240a496` 上全部可执行判据（C1/C2/C3/C4/C5′/C6/C7/C8/C9 ＋ D8）均通过复核员独立重跑，未发现与判据冲突之处 ⇒ `可提请独立审计`。** ⚠️ **"通过与否"归 CTO 收件闸 ＋ K3 终审**；本条不含审计结论，也不替代三项 CTO 决策。

**搬运读数（当点现测，两个对象都写明；口径 = 两个对象 + 现测）**：

| 对象 | 读数（现测） |
|---|---|
| 源 `D:\synova-wt-1455-verify\docs\synova\product-lines\evidence\k4-04-verify-review-20261011.md`（**v1.8 时点**） | **69928 B / sha256 `A70372221E0ED25C258590982A240DA5693D02F3E3F375FBBD923A48497E36EF` / 654 个 `0x0A` / LF（CRLF=0）/ UTF-8 无 BOM** |
| 目 本 PR 同相对路径（**该读数为对象 `4ae424e51…` 时点**） | `git rev-parse 4ae424e51:…k4-04-verify-review-20261011.md` ⇒ **`c1313b22b7efb56dff861519ed78b9103c91dc43`**（**当前 HEAD 见 L220 / §16**） |

`bytes_eq=true / sha_eq=true`；实施员 `git hash-object -t blob` 自出数 = **`c1313b22…`** = 队长给出的 blob sha（⇒ clean 过滤器不改动，raw == filtered）。

**版本更替留痕（不许沉默；每版注明【测量者】与【时点】）**：
`v1.7 / 68611 B / 652 行`（**复核员自出数**）→ 中间态 `70493 B / 656 行`（**实施员中途实测**；同一时期复核员自报的中间态为 `69840 B / 654 行` —— 二者是**不同时点的不同磁盘态**，非同一读数）→ `v1.8 / 69928 B / 654 行`（**复核员**收编纪律第 10 条后按 C9 口径自出数）→ **`v1.9 / 77382 B / 708 个 `0x0A` / blob `625c44c8bc4ed82e33cd7858b6594251bfd29c7b`**（**复核员**，纪律第 11–13 条登记后；**708 为队长实测**）。
🔴 **本 PR 以最新版为准（当前 = v1.9 / `625c44c8…`）**；v1.8 及更早读数已作废，仅留痕。

### a) 与实测不一致处（新 head）
1. **"捡回源"是旧树本地分支，不在 Gitea 远端**：**受控对照**证明方法有效（已知对象 blob API **HTTP 200 / 8534 B**；左对象 **HTTP 400**）；`git fetch <sha>` 与按 ref 取均失败 ⇒ 源分支从未推送。**复核员最终从只读旧仓字节级取到左对象并自证 sha** ⇒ **可核**，但正文/claims 应写清"源 = 旧树本地分支"，勿暗示远端可达。
2. **C9 的「+1 行」是净行**：复核员自出数为 **删 2 / 增 3 / 净 +1**（一处注释由 2 行重排为 3 行）。数值不冲突，但按新口径应写清。
3. **交付件 004（157 行）与卡面 §⑤ 所指 `db7f0503f:002-…`（124 行）不同源**（交付件源为另一分支同名 004）；语义要素一致，**未发现语义退化**。
4. **改动 30 文件 vs 卡面 3 条**：全在 CTO v2 §3 白名单内 ⇒ **非越界**，仅账面一致。

### b) 无法核实处（新 head）
1. **`immutable=1` 在本环境不可用**这一约束：**实施员实测 + 队长转述；复核员未亲测**（未再触碰真库）。
2. **Z8 提案件条目 2「等长替换」的"反例"是假设性**（"若换成等长串…"），**非本批实际发生**；实际那次（长度断言误报 `REPLACE FAILED`）记在复核件 §13 第 2 条 ⇒ **不判冒充实测，但反例强度弱于复核件**。
3. **`stream-tool-loop` 本地为何不收到真 LLM 回复**：未测（只测到"本地两态皆绿"与"CI 收到真回复"两端）。

### c) 跑不通处（新 head）
1. **`/actions/runs/{n}/logs` = 404**；正确端点是 **`/actions/jobs/{id}/logs`**（200）⇒ 首探失败属**我用错端点**（与复核件 §9.2 c-3 同族：**读错口径**）。
2. `git fetch <sha>` 直取被拒；blob API 对左对象 400 ⇒ 改走只读旧仓。
3. **造红锚点的一次失败（CRLF）**：C3 首轮 `(?m)^  graphTriplesRebuildMigration,$` **未命中** —— 工作树该行以 **`\r`** 结尾（CRLF 检出）；改 `,\r?$` 后命中。**断言拦住了静默空替换**（未写入，`diff=0` 已核）⇒ 与纪律第 3 条同族（**先核口径/行尾再断言**）。
4. `sqlite3` 不存在；`pnpm` 损坏（`index.js: SyntaxError`）。

### d) 能否据此独立开工 / 决策（新 head）
1. **已独立完成**：D8（30 文件 + 三禁域零命中）、C8、C9（自出数）、C5′（新正文）、绿腿（28/28）、C2/C3 双造红、C4/C6、**D10 反证检查（自取日志）**。
2. **🔴 须 CTO 决策（不由复核员代办）**：① **DDL 属 schema 面** —— 重建会移除 `confidence` / `source` / `props_json`（交付件已自标待批；生产边表 0 行 ⇒ 无行数据风险，但**列语义取舍属 CTO**）；② **Done④ 拆卡的卡号补登**；③ **CI 步骤③ 红的合并口径** —— 存量 + 环境已证，但"是否须转绿 / 是否豁免"属**流程决策**。
3. **Z8 提案交叉核（复核员逐条）**：
   - ✅ **无冒充实测**：该件 9 条与本件 §13 第 **1–9** 条**同组**；本件第 10 条「转述·未亲测」**未被夹带**。
   - ✅ **我自测其条目 1 的两条 PS 5.1 声称**：`Out-File -Encoding utf8` → **`EF BB BF`（确加 BOM）**；`*>` → **`FF FE`（UTF-16LE）**（PS `5.1.26100.9444`）⇒ **实测为真**。
   - 🔴 **须补写（条目 3）**：其"原因"写成"末行换行 / BOM / CRLF 切分"，**漏掉本批实测主因** —— UTF-8 内容按 ANSI/CP936 解码时**高字节吞 `0x0A`**；次因才是 `Measure-Object -Line` **不计空元素**。✅ **已按此补写为两效应版**。
   - 🔴 **须补写（条目 6）**：其写"只读读数**优先 `immutable=1`**"，但本环境该法**不可用** ⇒ 应改为"**本环境实测不可用；实际口径 = `readonly: true` + `PRAGMA query_only=1`**"。✅ **已按此改**。
4. **复核员的结论（依职责用语）**：见本节开头「复核员结论原文」。

---

## CI 状态

> CTO v4 §① 裁定：**存量红点名放行**（**不收紧 `--changed`**）；D10 判过三条（(a) 逐条点名＋双证据 / (b) 存量卡 `#347` / (c) 写集内判据全绿）见 **(h) / (i)**。

- 步骤 **① 13 组门禁 ✅**、**② 架构边界 ✅**、**③ `vitest --changed origin/local-main` ❌**（run 307/308/309/310/319 同型）。
- **失败件 1** `tests/tui-v2/chat-degradation.test.ts`（6 例，`ReactCurrentOwner`）⇒ **存量红**（独立复核员已复做并**加强**）：run **281**（**另一分支** `3449c05bb`）与 run **319**（本卡）**失败用例名逐条对齐**（① ② ③ ④a ④b ⑤ 六条，同根因）；本地**完整 checkout 基线树**（`local-main @ 68bf57598`）复跑同组 `6 failed` / `stream-tool-loop` `6 passed`，与 HEAD 一致。
- **失败件 2** `tests/stream-tool-loop.test.ts:210` ⇒ **环境依赖**：CI 日志原文 `expected '收到你的"测试错误"——我这边运作正常…' to contain '失败'` ⇒ 收到**真 LLM 回复**（provider failover）；本地两态皆绿；该用例只构造 `AgentConversation(fakeProvider)`、**不建库**。
- **反证检查**（复核员独立重做，方法更强）：4 个绿 run 的日志中 `chat-degradation` / `stream-tool-loop` / `ReactCurrentOwner` **全 0 命中** ⇒ 它们**根本没跑这些用例** ⇒ **"找不到反例"成立**。
- 两件**均不在本写集**；`--changed` 选中它们只因 `conversation-engine → sqlite-graph-store → store/schema-migration` 的**模块级依赖**。
- 🔴 **`pending=0` 未达成**；处置路径（另开卡 / CI 收敛 `--changed` / 按「存量红点名」放行）**请 CTO 裁**。

## 遗留 / 未决

1. **DDL：CTO 已逐字批（12 列 canonical）** —— `confidence` / `source` / `props_json` **三列被移除属既定取舍**；「`props_json` 值并入 `props` 不丢」的断言出处见 **(j)**。
2. **Done④ 已拆卡 `#345`**（口径＝与 `queryNodes` 同款 D355：`log.error` + `"no such column"` 识别 + 仍返回 `[]`）。
3. **CI 步骤③ 红：按「存量红点名放行」判过**（D10 三条见 (h)/(i)）；存量卡 `#347`（react19×ink）；**不收紧 `--changed`**。
4. **本地 git hooks 未安装**（`.git/hooks` 仅 `.sample`）⇒ 本地 13 组未跑；权威门禁＝Gitea CI。
5. **Z8 提案**（`PROPOSAL-skill-tool-discipline.md`）＝提案→K3→CTO；**本批未落地** `SKILL.md`（条目 3、6 已按复核员交叉核补写）。
6. K3 复审通过前**不合并**。
