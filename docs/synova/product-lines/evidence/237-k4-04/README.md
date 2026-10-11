# #237 (K4-04) 图边读/写修好 — 交付证据 · 收尾三件

> **分支**：`fix/237-graph-triples-rebuild` ｜ **PR**：http://192.168.1.7:3000/synova-agent/SynovaAgent/pulls/343
> **建分支时基线 tip**：`68bf5759878a458b5e5ceb324a32878660155517` ｜ **HEAD**：`274f0e87f00a4831dc074277bdc7e0806b3b00b9`
> **交付人**：k4-04-impl ｜ 2026-10-11 ｜ **自验结论：可提请独立审计**（Done ① ② ③ ⑤）｜ Done ④ **未交付（已拆卡）**
> 🔴 K3 复审通过前**不得合并**。

---

## 一、前提冻结五样

| 项 | 值 / 证据 |
|---|---|
| 基线 sha | `68bf5759878a458b5e5ceb324a32878660155517`＝建分支时 `origin/local-main` tip；`merge-base(origin/local-main,HEAD)` 同值（D8 计数从 0 起算） |
| 分支 HEAD | `274f0e87f00a4831dc074277bdc7e0806b3b00b9`（push 回执：`git ls-remote` 同 sha） |
| 写集 | 23 文件，全落在允许路径（D8 全文见 `PR-BODY.md` / §三 D8） |
| 判据命令 | D1–D10（派单 §六 原文 + CTO v2 三处附加），逐条见 §三 |
| 前置满足 | `node v24.16.0` / `npm 11.13.0`；`npm ci --no-audit --no-fund` **exit 0**；`ink@5.2.1 ✔` 补丁已应用（铁律 40） |

## 二、交付物与来源（逐字节回核）

| 文件 | 来源 | 回核命令与结论 |
|---|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts` | 捡回 `a797bdcb4` | `git diff e47568b66 HEAD:<file>` ⇒ **仅 1 hunk**：CTO 指定的过时注释改动（`#1424` → `fix/1421-skills-type-assumption`） |
| `src/store/schema-migration.ts` | 只取「注册 004」改动 | `git diff cc5feace6 HEAD:<file>` ⇒ **空**（字节等价） |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts` | 捡回（324 行 / 16 例） | `git diff 78a05eb4f HEAD:<file>` ⇒ **空** |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` | 捡回（433 行） | `git diff 10e32f07c HEAD:<file>` ⇒ **空** |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts` | **新增**（卡面 Done① 点名入口，6 例） | 新文件（真机 DDL 夹具，非 mock） |
| `tests/store/{schema-migration,metric-readings-schema,migrations/003-orgs}.test.ts` | `SCHEMA_VERSION` 4→5（**逐条**改 3 处：`:81` / `:207` / `:70`） | 🔴 `003-orgs.test.ts:39`（003 自己的 `version=4` 元数据断言）**逐字未动** |

## 三、判据 D1–D10（原始输出文件见本目录）

| # | 结果 | 证据（文件 / 原始读数） |
|---|---|---|
| D1 | ✅ | `src/store/schema-migration.ts:15:import { graphTriplesRebuildMigration } from './migrations/004-graph-triples-rebuild';`（`GREP_EXIT=0`） |
| D2 | ✅ | a) `tests/adapters/sqlite-graph-store.legacy-schema.test.ts`：**6 passed / EXIT=0**；b) `tests/store/migrations/004-graph-triples-rebuild.test.ts`：**16 passed / EXIT=0**（`D2a-*.txt`、`D2b-*.txt`） |
| D3 | ✅ | `tests/store/`：**12 文件 / 107 例 / EXIT=0**（`D3-store-regression.txt`） |
| D4 | ✅ | 单跑「同形守卫」：**1 passed / 15 skipped**；`EXPECTED_CANONICAL_COLUMNS` = **12 列**（`id, graph, subject_type, subject_id, predicate, object_type, object_id, weight, props, created_at, valid_from, valid_to`），`:306` 用 `toEqual` **逐列**（非计数式）；另新增件两处 `PRAGMA table_info` **动态**等效守卫（`D4-shape-guard.txt`） |
| D5 | ✅ | 造红 A：**9 failed / 13 passed**（`AssertionError: expected [] to have a length of 2 but got +0`、`SqliteError: table graph_triples has no column named props`）；造红 B：**12 failed / 10 passed**（**`datatype mismatch` ×10**，写面 `<File>.test.ts:273` 与 `legacy-schema.test.ts:142` 具名失败）；各自**恢复后 22 例绿**（`D5-*.txt`，4 份） |
| D6 | ✅ | `D6-D7-legacy-probe.txt`：真机 DDL 夹具 → `new SqliteGraphStore`（生产迁移路径）→ `queryEdges()` **N=2**（`{"action_effect_lag":"3-6_months"}` / `{"share":7}`）→ `createEdge('OWNS','c1','p2',1.0,{k:'v'})` 成功 → **N=3** 且 `raw_props={"k":"v"}` |
| D7 | ✅ | ①`props(TEXT)` 在 + `props_json` 值迁入（同 D6 值）；②`canonical_12_equal=true` / `removed_extra=true`（**不含 `confidence`/`source`**）；③旧库升级读写双通 |
| D8 | ✅ | `git diff --name-only 68bf57598..HEAD` = **23 文件**，全在允许写集（`PR-BODY.md` §附录 全文） |
| D9 | ✅ | `SCANNED_FILES=4974 / TOKEN_HITS=0`（口径：工作树全部文件，**排除 `.git` 对象库与 `node_modules`**）（`D9-token-scan.txt`） |
| D10 | ⚠️ | PR **#343** 已开（base=`local-main`）；CI **红**——见 §五（**存量红 + 环境依赖，非本写集**） |

**Done⑤**（CTO 指定：`node` + `better-sqlite3` **`readonly:true`**；只读、未写、未拷）：
```
[db] D:\novis-backup-20260526\Novis\synova-agent\data\synova.db
[count] 14
[cols] id:INTEGER(pk), subject_type:TEXT, subject_id:TEXT, predicate:TEXT, object_type:TEXT,
       object_id:TEXT, graph:TEXT, weight:REAL, props_json:TEXT, confidence:REAL, source:TEXT,
       valid_from:TEXT, valid_to:TEXT, created_at:TEXT
[has_props_json] true   [has_props] false   [id_type] INTEGER
```
⇒ 卡面前提（真库 `props_json` 在、`props` 不在）**实测成立**；克隆内 `data/` 只有 `golden/`（无 `synova.db`）⇒ 单时点，已标注。脚本：`done5-read-real-db.cjs`；输出：`done5-real-db-columns.txt`。

## 四、造红 A / 造红 B（临时改动，均已复原）

| 项 | 临时改动 | 红 | 恢复后 | 复原证明 |
|---|---|---|---|---|
| A（缺实现态） | `schema-migration.ts` 摘掉 004 的 import + 注册项 | `9 failed / 13 passed`、EXIT=1 | `22 passed`、EXIT=0 | `hash-object` == `cc5feace6…`（MATCH=True） |
| B（半修掩盖） | 004 改为"只 `ADD COLUMN props` + 回填、不重建" | `12 failed / 10 passed`、EXIT=1、**`datatype mismatch` ×10** | `22 passed`、EXIT=0 | `hash-object` == `e47568b66…`（MATCH=True） |

临时改动**只在工作区**、未 commit、未 push；复原后 `git status` 干净（HEAD 未变）。

## 五、CI 状态与存量红归因（🔴 需 CTO 裁；不在本写集）

- **run 307（push）/ 308（PR）**：步骤 ① 13 组门禁 ✅、② 架构边界 ✅、**③ `vitest --changed origin/local-main` ❌**。
- 失败件 1 `tests/tui-v2/chat-degradation.test.ts`（6 例，`TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')`）⇒ **存量**：
  - CI **run 281**（**另一分支** `3449c05bb` = `fix(#337): react 回 18.3.1 —— react19×ink5.2.1 reconciler 冲突`）**同样红**在步骤 ③，`chat-degradation` 命中 12 处、`ReactCurrentOwner` 6 处（`CI-run-281-existing-red.log.txt`）；
  - 本地**基线树**（`git archive 68bf57598`，无本卡任何改动）复跑同一组：`1 failed | 1 passed / 6 failed | 6 passed`，与 HEAD **完全一致**（`CI-repro-BASELINE-68bf57598.txt`）。
- 失败件 2 `tests/stream-tool-loop.test.ts:210`（`expected '收到，不过这条信息我读不出具体意图…' to contain '失败'`）⇒ **环境依赖**：本地 HEAD 与基线**均通过**；该用例只构造 `AgentConversation(fakeProvider)`、**不建库**（imports 见用例头部）；CI 上收到的是**真 LLM 文本**（provider failover 生效）⇒ 与本写集**无因果**。
- 两件均**不在本卡写集**（`tests/tui-v2/**`、`tests/stream-tool-loop.test.ts`）⇒ 修它们＝越界；且 `--changed` 之所以选中它们，是因为 `conversation-engine` → `sqlite-graph-store` → `store/schema-migration` 的**模块级依赖**（不是行为依赖）。

## 六、遗留清单 / 未决项

1. **Done④ 未交付（已拆卡）**：`src/adapters/sqlite-graph-store.ts:255-259` 仍是 `log.warn + return []`；口径（CTO 给）＝与 `queryNodes` 的 **D355 先例同款**（`log.error` + `"no such column"` 识别 + **仍返回 `[]`**）；`degraded` 通道**另案**。
2. **DDL 属 schema 面，须 CTO 逐字批**：整表重建**移除**旧库多出的 `confidence` / `source` / `props_json`（`props_json` 值已搬进 `props`）—— 见 `issue1455-…-20261009.md` §DDL 待批清单。
3. **CI 红为存量/环境（§五）**：是否需要①另开卡修 `chat-degradation`×react19 ②在 CI 侧收敛 `--changed` 选择面 ③以"存量红点名"方式放行本 PR —— 请 CTO 裁（本卡不自行处置）。
4. **本地 git hooks 未安装**（`.git/hooks` 仅 `.sample`）⇒ 本地 13 组未跑；权威门禁＝Gitea CI（已跑）。M4 提醒：本仓 `synova-commit` 类工具自带 push，本轮**未使用**，push 为显式命令。
5. **证据件编码事故与修正**：首版 9 份证据 txt 因本机 `pwsh` 实为 **Windows PowerShell 5.1**、`*>` 重定向产出 **UTF-16LE**（git 判 binary），另有 2 份被 `Out-File -Encoding utf8` 加了 **BOM**；已全量转 **UTF-8 无 BOM**（12 文件，`nul=false / BOM=false`）后 amend 进同一 commit（未 push 前 amend，无 force push）。
6. K3 复审通过前**不合并**；PR 正文已留「独立复核四项」栏位。

## 七、归属逐张收口

| 项 | 归属 | 状态 |
|---|---|---|
| Done ① ② ③（旧库读/写 + 反例判别） | 本卡 | 交付（D2/D5/D6 证据） |
| Done ⑤（真库读数） | 本卡 | 交付（python3/Node 只读，单时点） |
| Done ④（读路径不静默） | **拆卡**（`src/adapters/**` 被 `fix/1421-skills-type-assumption` 占用） | 未交付，PR 正文显式声明 |
| DDL（`confidence`/`source`/`props_json` 移除） | **CTO 逐字批** | 待批 |
| CI 存量红（chat-degradation / stream-tool-loop） | **CTO 裁处理路径** | 未决 |
| 资产来源（`a797bdcb4`）与捡回方式 | 本卡 | 已按 CTO v2 口径执行 + 逐字节回核 |
