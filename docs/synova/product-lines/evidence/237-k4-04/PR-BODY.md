# #237 (K4-04) 图边读/写修好 — B2-GRAPH · P1

**分支** `fix/237-graph-triples-rebuild` ｜ **base** `local-main` ｜ **建分支时基线** `68bf5759878a458b5e5ceb324a32878660155517`（＝现测 merge-base）
**读数时点（本文所有 sha/字节数现测于）**：`5dadc928319e5a6d90d1ad2f47a97b8d57c5c3f9`（本正文 commit 仅同步文档，不新增文件）
**内容来源**：旧仓 `fix/1455-graph-triples-props @ a797bdcb4`

---

## (a) 改了什么（逐文件一句话）

| 文件 | 一句话 |
|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts`（新） | 捡回整表重建迁移（`version: 5`）：旧库 `graph_triples` 事务内重建到 canonical（`id TEXT PRIMARY KEY` + `props`）+ 5 索引；**仅 1 处 JSDoc 注释改动**，见 (d) |
| `src/store/schema-migration.ts`（改） | 只取「注册 004」改动：import + 注册项 + `SCHEMA_VERSION 4→5` |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts`（新） | **卡面 Done① 点名入口**：6 例，真机 DDL 夹具 → 生产构造路径（读/写双通） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts`（新） | **额外回归**（16 例，含 D4 同形守卫）；**不得顶替 Done① 入口** |
| `tests/store/schema-migration.test.ts`・`tests/store/migrations/003-orgs.test.ts`・`tests/store/metric-readings-schema.test.ts`（改） | `SCHEMA_VERSION` 4→5 **逐条改 3 处**；🔴 `003-orgs.test.ts:39`（003 自己的 `version=4` 元数据断言）**逐字未动** |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md`（新） | 捡回的证据件（433 行） |
| `docs/synova/product-lines/evidence/237-k4-04/**`（新） | 判据原始输出、收尾三件（`README.md`）、CI 日志、Done⑤ 脚本/输出、Z8 提案（`PROPOSAL-skill-tool-discipline.md`） |
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

**Done④ 未交付 ⇒ CTO 已裁定拆卡，卡号待 CTO 补登。**

（本 PR 不实施：`src/adapters/sqlite-graph-store.ts:255-259` 仍为 `log.warn + return []`；原因：该文件被在飞分支 `fix/1421-skills-type-assumption` 占用，写集禁 `src/adapters/**`。另立卡口径（CTO 给）：与同文件 `queryNodes` 的 **D355 先例同款**（`log.error` + `"no such column"` 识别 + **仍返回 `[]`**）；`degraded` 通道**另案**。）

## (d) 注释改动声明

> **注释改动声明**：`a797bdcb4:src/store/migrations/004-graph-triples-rebuild.ts` blob `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B）↔ `HEAD` 同路径 blob `46e255d5540271684025465dfacf183ed1749052`（8534 B）；差 **+36 B / +1 行**，内容为 **1 处 JSDoc 注释**（在飞 PR 号 `#1424` → 分支名 `fix/1421-skills-type-assumption`），**代码零改动**（`git diff <old-sha> <head-sha>` 全文已贴）。

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
| `src/store/migrations/004-graph-triples-rebuild.ts` sha `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B） | sha `46e255d5540271684025465dfacf183ed1749052`（8534 B） | **+36 B / +1 行（1 处 JSDoc 注释）** | `git rev-parse` + `git cat-file -s` + `git diff <A> <B>`（全文见 (d)） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts` sha `78a05eb4ffed2092da597e81b9b28d13270c1964`（16652 B） | sha `78a05eb4ffed2092da597e81b9b28d13270c1964`（16652 B） | **同 sha（0 B / 0 行）** | 同上（两对象 sha 现测一致；`git diff A B` 空） |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` sha `10e32f07c697d1899c2aefa3672e9bfba1830ff1`（30391 B） | sha `10e32f07c697d1899c2aefa3672e9bfba1830ff1`（30391 B） | **同 sha（0 B / 0 行）** | 同上 |
| `src/store/schema-migration.ts` sha `cc5feace6e03a7afa60158c5b6af2eb5cdbcb7ec`（5731 B） | sha `cc5feace6e03a7afa60158c5b6af2eb5cdbcb7ec`（5731 B） | **同 sha（0 B / 0 行）** | 同上 |

> 口径：凡称「相同」，写明**两个对象**并**当点现测**；⛔ 不再使用「逐字节一致 / delta=0 / 无差异」等无对象、无时点的表述。

## (f) D8 写集（口径 = `merge-base`，非死 SHA）

`git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD`，`MERGE_BASE=68bf5759878a458b5e5ceb324a32878660155517`，共 **30 文件**：

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

## CI 状态

- 步骤 **① 13 组门禁 ✅**、**② 架构边界 ✅**、**③ `vitest --changed origin/local-main` ❌**（run 307/308/309/310 同型）。
- **失败件 1** `tests/tui-v2/chat-degradation.test.ts`（6 例，`ReactCurrentOwner`）⇒ **存量红**：CI **run 281**（**另一分支** `3449c05bb`＝`fix(#337): react 回 18.3.1`）同样红在步骤 ③；本地**基线树**（`git archive 68bf57598`）复跑同组 `1 failed | 1 passed / 6 failed | 6 passed`，与 HEAD 一致。
- **失败件 2** `tests/stream-tool-loop.test.ts:210` ⇒ **环境依赖**：本地 HEAD 与基线均通过；该用例只构造 `AgentConversation(fakeProvider)`、不建库；CI 收到真 LLM 文本（provider failover）。
- 两件**均不在本写集**；`--changed` 选中它们只因 `conversation-engine → sqlite-graph-store → store/schema-migration` 的**模块级依赖**。
- 🔴 **`pending=0` 未达成**（上述存量/环境红）；处置路径（另开卡 / CI 收敛 `--changed` / 按「存量红点名」放行）**请 CTO 裁**。

## 独立复核（四项）留位

> 复核员请在此贴：**a** 与实测不一致处（附命令）｜**b** 无法核实处｜**c** 跑不通处｜**d** 能否据此独立开工/决策

## 遗留 / 未决

1. **DDL 属 schema 面，须 CTO 逐字批**：整表重建**移除**旧库多出的 `confidence` / `source` / `props_json`（`props_json` 值已搬进 `props`）。
2. **本地 git hooks 未安装**（`.git/hooks` 仅 `.sample`）⇒ 本地 13 组未跑；权威门禁＝Gitea CI。
3. **Z8 提案**（`PROPOSAL-skill-tool-discipline.md`）＝提案→K3→CTO；**本批未落地** `SKILL.md`。
4. K3 复审通过前**不合并**。
