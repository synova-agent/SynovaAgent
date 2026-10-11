# #237 (K4-04) 图边读/写修好 — B2-GRAPH · P1

**分支**：`fix/237-graph-triples-rebuild` ｜ **base**：`local-main`
**基线（建分支时 tip）**：`68bf5759878a458b5e5ceb324a32878660155517`
**内容来源**：旧仓 `fix/1455-graph-triples-props @ a797bdcb4`（逐字节 hash 回核，见下）

---

## 🔴 Done④ 未交付，已拆卡

卡面 Done④「读路径失败时不再返回静默空数组」**本 PR 不实施** —— `src/adapters/sqlite-graph-store.ts` 被在飞分支 `fix/1421-skills-type-assumption` 占用，写集禁止 `src/adapters/**`。

替代口径（CTO 2026-10-11 给，另立卡用）：与同文件 `queryNodes` 的 **D355 先例同款**（`log.error` + `"no such column"` 识别 + **仍返回 `[]`**）；`degraded` 通道**另案**。

⇒ 本 PR 交付 **Done ① ② ③ ⑤**。

## 交付物 + 逐字节回核

| 文件 | 来源 | 回核 |
|---|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts` | 捡回 | `e47568b66…`，只差 1 处 CTO 指定注释改动（`#1424` → `fix/1421-skills-type-assumption`），diff 已贴 |
| `src/store/schema-migration.ts` | 只取「注册 004」改动（import + 注册项 + `SCHEMA_VERSION 4→5`） | == `cc5feace6…`（空 diff） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts` | 捡回（324 行 / 16 例） | == `78a05eb4f…`（空 diff） |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` | 捡回（433 行） | == `10e32f07c…`（空 diff） |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts` | **新增**（卡面 Done① 点名入口，6 例，真机 DDL 夹具） | 新文件 |
| `tests/store/schema-migration.test.ts` / `tests/store/migrations/003-orgs.test.ts` / `tests/store/metric-readings-schema.test.ts` | `SCHEMA_VERSION` 断言 4→5（**逐条**改 3 处） | 见 diff |

🔴 `tests/store/migrations/003-orgs.test.ts:39`（003 自己的 `version=4` 元数据断言）**逐字未动**。

## 判据 D1–D10

原始输出全部落 `docs/synova/product-lines/evidence/237-k4-04/`（不摘要）。

| # | 结果 | 证据 |
|---|---|---|
| D1 | ✅ | `src/store/schema-migration.ts:15` 命中（`GREP_EXIT=0`） |
| D2 | ✅ | a) 新增件 **6 例** EXIT=0；b) 捡回件 **16 例** EXIT=0（`D2a-adapter-legacy.txt` / `D2b-migration-004.txt`） |
| D3 | ✅ | `tests/store/` **12 文件 / 107 例** EXIT=0（`D3-store-regression.txt`） |
| D4 | ✅ | 「同形守卫」单跑 **1 passed / 15 skipped**；`EXPECTED_CANONICAL_COLUMNS` = **12 列**、`toEqual` **逐列**（非计数式）；新增件另有两处 `PRAGMA table_info` **动态**等效守卫 |
| D5 | ✅ | 造红 A：**9 failed / 13 passed**（`no such column: props`）；造红 B：**12 failed / 10 passed**（**`datatype mismatch` ×10**，写面具名失败）；各自恢复后 **22 例绿**；恢复以 `hash-object` 双端同 sha 证明（`D5-red-*.txt`） |
| D6 | ✅ | 真机 DDL 夹具 → 走生产迁移 → `queryEdges()` **N=2**（具体值 `{"action_effect_lag":"3-6_months"}` / `{"share":7}`）→ `createEdge()` 成功 → **N=3**（`D6-D7-legacy-probe.txt`） |
| D7 | ✅ | ①`props(TEXT)` 在、`props_json` 值迁入不丢；②12 列逐列一致（`canonical_12_equal=true` / `removed_extra=true`，**不含 `confidence`/`source`**）；③旧库升级读写双通 |
| D8 | ✅ | `git diff --name-only 68bf57598..HEAD` = **23 文件**，全落在允许写集内（全文见下） |
| D9 | ✅ | token 扫描 **4974 文件 / 0 命中**（口径：工作树全部文件，**排除 `.git` 与 `node_modules`**） |
| D10 | ⏳ | 本 PR；CI 状态见评论区 |

**Done⑤**（CTO 指定口径：`node` + `better-sqlite3` **`readonly:true`** 读旧树真机库；只读、未写、未拷）：
```
[db] D:\novis-backup-20260526\Novis\synova-agent\data\synova.db
[count] 14
[cols] id:INTEGER(pk), subject_type:TEXT, subject_id:TEXT, predicate:TEXT, object_type:TEXT,
       object_id:TEXT, graph:TEXT, weight:REAL, props_json:TEXT, confidence:REAL, source:TEXT,
       valid_from:TEXT, valid_to:TEXT, created_at:TEXT
[has_props_json] true   [has_props] false   [id_type] INTEGER
```
⇒ 卡面前提（真库 `props_json` 在、`props` 不在）**实测成立**。克隆内 `data/` 只有 `golden/`（无 `synova.db`）⇒ 单时点，已标注。

### 附录：D8 全文（23 文件）
```
.claude/claims/237.yaml
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
docs/synova/product-lines/evidence/237-k4-04/D9-token-scan.txt
docs/synova/product-lines/evidence/237-k4-04/d6-legacy-probe.ts
docs/synova/product-lines/evidence/237-k4-04/done5-read-real-db.cjs
docs/synova/product-lines/evidence/237-k4-04/done5-real-db-columns.txt
docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md
src/store/migrations/004-graph-triples-rebuild.ts
src/store/schema-migration.ts
tests/adapters/sqlite-graph-store.legacy-schema.test.ts
tests/store/metric-readings-schema.test.ts
tests/store/migrations/003-orgs.test.ts
tests/store/migrations/004-graph-triples-rebuild.test.ts
tests/store/schema-migration.test.ts
```

## 独立复核（四项）留位

> 复核员请在此贴：**a** 与实测不一致处（附命令）｜**b** 无法核实处｜**c** 跑不通处｜**d** 能否据此独立开工/决策

## 遗留 / 未决

1. **DDL 属 schema 面，须 CTO 逐字批**：整表重建会**移除**旧库多出的 `confidence` / `source` / `props_json`（`props_json` 的值已搬进 `props`）—— 见证据件 §DDL 待批清单。
2. **本地 git hooks 未安装**（`.git/hooks` 仅 `.sample`）⇒ 本地 13 组未跑；**权威门禁 = Gitea CI**。
3. K3 复审通过前**不合并**（本 PR 由 CTO/复核员裁）。
