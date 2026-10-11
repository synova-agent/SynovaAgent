# K4-04 独立复核件 — 图边读/写修好（B2-GRAPH · P1）

> **任务**：Gitea #237 → K4-04
> **复核员**：独立复核员 `k4-04-verify`（独立于实施员；**未进入实施员工作树**）
> **基线**：`local-main` @ `68bf5759878a458b5e5ceb324a32878660155517`（**CTO v2 §1 正式采纳**；原钉死值 `07b28dfe2` 已废弃 —— 它是当前 tip 的干净祖先，换过去=倒退）
> **日期**：2026-10-11 ｜ **版本**：**v1.8** —— 交付物**已到手并复核两轮**：§9.2（旧 head `8d9963431`，**已标注失效**）；**§15（新 head `09240a496`）= 当前有效结论**（含 C1–C9 + D8 判定表、D10 独立反证检查、Z8 提案交叉核、四层 a/b/c/d）。v1.1 §12 仪器校准；v1.2 §13 纪律清单；v1.3 证伪登记；v1.4 判据集按 CTO v2 更新；v1.5 `-shm` 裁定入账；v1.7 §14.3 补 `immutable=1` 不可用约束 + §15 全文；**v1.8 §13 收编纪律第 10 条（替换/锚点类操作必须先证命中）⇒ 现为「10 条亲测 + 1 条转述」**
> **性质**：本件是**独立复核**，不是审计结论。**不含"通过/不通过"判定**（通过与否归 CTO 收件闸 ＋ K3 终审）。
> **更新约定**：§9 四项结论中"对交付物"的部分，待交付物到手后按**同一格式逐条附原始输出**补齐；补齐前不得当作已复核。

---

## 0. 本件怎么核（判别性纪律，先立后跑）

1. **判据先行**：把"修好后应有的期望"（绿腿）**先写死在用例里**，再在未修代码上跑红腿 —— **红→绿成对**才算证据。
2. **对照组不可省**：先跑 canonical 新库（**基线应绿**）作对照 ⇒ 红腿才**可归因于"旧库形态未被处理"**，而不是探针自身故障。**没有对照组，红腿不可解释。**
3. **造假红之前先证判别性**：先独立复现"半修态确实产出目标 token"（本例 = `datatype mismatch`），否则"必红"可能被**别的错误顶替**而无判别性。
4. **判别性三步，一步不省**：① 改动后单文件 `tsc` ⇒ **`TS1xxx` 必须 0**（证明文件仍被解析）；② **收集用例数 == 期望值**；③ 才读 exit code，并核对失败消息含预期 token。
5. **未实测的只写"推断"**，不假装测过。
6. **数字一律来自命令原始输出**，禁手写。

---

## 1. 工作区与基线

| 项 | 值 |
|---|---|
| 复核工作区 | `D:\synova-wt-1455-verify`（**独立建，非实施员 `D:\synova-wt-1455`**） |
| 分支 / HEAD | `local-main` / `68bf5759878a458b5e5ceb324a32878660155517`（全程未动） |
| 已跟踪文件改动 | **0**（`git diff --name-only` 输出 0 行） |
| origin | `http://192.168.1.7:3000/synova-agent/SynovaAgent.git`（凭据已摘；token 未打印、未落盘） |

**ls-remote 回执**：
```
68bf5759878a458b5e5ceb324a32878660155517	refs/heads/local-main
```

复核员自建探针（**未跟踪，非交付件**）：
- `tests/adapters/k4-04-verifier-baseline.test.ts`（6 例）
- `tests/adapters/k4-04-verifier-addcolumn.test.ts`（2 例）

---

## 2. 环境事实

| 事实 | 命令 | 输出 |
|---|---|---|
| `sqlite3` CLI | `Get-Command sqlite3` | **NOT FOUND** |
| 克隆内真库 | `Test-Path data\synova.db` | **ABSENT**（`data\` 下仅 `golden\`） |
| npm / node | `npm --version` / `node --version` | `11.13.0` / `v24.16.0` |
| `pnpm` shim | `pnpm --version` | `index.js: SyntaxError: Invalid or unexpected token` ⇒ **全队走 npm** |
| 依赖安装 | `npm ci --no-audit --no-fund` | **exit=0**｜`added 813 packages in 1m`｜20:29:48→20:31:03 |
| vitest | `npx vitest --version` | `vitest/5.0.2 win32-x64 node-v24.16.0` |
| vitest 收集范围 | `vitest.config.ts:28` | `./tests/**/*.test.ts` ＋ `./tests/**/*.integration.test.ts` |

**铁律 40 冻结项核**：

| 冻结项 | 实测 |
|---|---|
| `patches/ink+5.2.1.patch` | ✅ 6771 B，`git ls-files` 已跟踪 |
| `"postinstall": "patch-package"` | ✅ 匹配 |
| 补丁是否被应用 | ✅ `patch-package 8.0.1 / Applying patches... / ink@5.2.1 ✔` |
| 痕迹 `node_modules/ink/build/log-update.js` | ✅ **7 处**（`:6 SYNC_BEGIN`、`:7 SYNC_END`、`:55 :60 :79 :85 :95`） |
| 痕迹 `node_modules/ink/build/ink.js` | ✅ **8 处**（`:123 :124 :130 :134 :158 :162 :178 :182`） |

**工具语义告警（队内纪律已收）**：`glob` 在本环境对 `patches/*.patch` 与含中文的路径返回**假阴性**（报 `No files found` 而文件实际存在）。**不得把 glob 空结果当作"文件不存在"的证据**；一律改 `pwsh`/直接读复核。

---

## 3. 前提冻结实测

| # | 前提 | 命令 | 输出摘要 | 判定 |
|---|---|---|---|---|
| P1 | 读路径用 `props` | 读 `src/adapters/sqlite-graph-store.ts:245` | `SELECT id, predicate, subject_id, object_id, weight, props FROM graph_triples …` | ✅ |
| P2 | 写路径用 `props` | 同文件 `:175-181` | `INSERT INTO graph_triples (…, weight, props) VALUES (…9 个 ?)` | ✅ |
| P3 | 读失败静默 | 同文件 `:255-259` | `log.warn({err:msg}, "查询图边失败"); return [];` | ✅ |
| P4 | 同文件读失败清单 | grep `return \[\];` | 4 处：`:222`/`:225`（queryNodes，已 `log.error`）｜`:258`（**queryEdges，warn**）｜`:290`（**queryTriples，warn**） | ✅ |
| P5 | 代码自建 canonical 表 | 同文件 `:24-57` | `graph_triples(id TEXT PRIMARY KEY, …, props TEXT NOT NULL DEFAULT '{}', …)` + 5 索引 | ✅ |
| P6 | `IF NOT EXISTS` 对旧表 no-op | 同文件 `:129-136` | `initSchema()` → `db.exec(SCHEMA_SQL)`，DDL 全 `IF NOT EXISTS` | ✅ |
| P7 | `SCHEMA_VERSION` 现状 | 读 `src/store/schema-migration.ts:21` | `export const SCHEMA_VERSION = 4;` | ✅ |
| P8 | 已注册迁移版本 | grep `version:` | `001`→v2｜`002-metric-readings`→v3｜`003-orgs`→v4 | ✅（新迁移须 v≥5） |
| P9 | 迁移目录 | `ls src/store/migrations` | `001/002/003`，**无 004** | ✅ |
| P10 | 「`queryEdges` 调用点 25 处」 | grep `src/` | 命中 48 行；剔除接口声明/JSDoc 后**实调用 = 25** | ✅ 精确 |
| P11 | 「哨兵 compute 直连 2 处」 | grep `extensions/` | `path-dependency/computes/detect.ts:56`、`unit-economics/aggregate.ts:72` | ✅ |
| P12 | 「既有 `:memory:` 5 处」 | grep `tests/` | **5/5 命中卡面所给行号** | ✅ |
| P13 | 参考正解未合入主线 | `merge-base --is-ancestor db7f0503f HEAD` | exit=**1** | ✅ |
| P14 | 「16 个 ref 全部未合入主线」 | `for-each-ref --contains db7f0503f` | **4** 个 ref（无 tag） | ⚠️ **数不符（4 ≠ 16）** |
| P15 | 参考正解内容 | `git show db7f0503f:src/store/migrations/002-graph-triples-rebuild.ts` | 124 行；**`version: 3`**；`name:'graph-triples-rebuild'` | ✅ |
| P16 | 仓内证据 DDL 可读性 | 读 `…/D967a-measurements-store/results/p7-acceptance-prod-copy.txt` | 两行 DDL **各恰 200 字符、断在词中** ⇒ 列清单不可从此件核实 | ⚠️ 部分不可核实 → **已由 §14 生产库只读抽验收敛（全 DDL 可读，与夹具 set-equal）** |
| **P17** | **卡面 §⑤「ADD COLUMN 修不好」** | 本件 §8 夹具层复现 | **读通（3 行）＋ 写抛 `datatype mismatch`** | ✅ **独立复现成立** |
| **P18** | **旧表形态与 `schema_version`（生产库）** | **§14 只读抽验（CTO v2 §五 口径）** | `props_json` **在** / `props` **不在**；`schema_version MAX(integer) = **4**`；`graph_triples` 行数 **0** | ✅ **生产库实测确认**（含 C4 的生产实况） |

---

## 4. 阻断清单

### B-1 基线钉死值与实测不符（**独立复现**）
```
git ls-remote --heads  → 68bf5759878a458b5e5ceb324a32878660155517  refs/heads/local-main
git merge-base --is-ancestor 07b28dfe2 HEAD   → exit=0（07b28dfe2 是干净祖先）
git rev-list --count 07b28dfe2..HEAD          → 4
68bf57598 Merge PR #331: K12-10 部门轴（存量环境红豁免）
29b7a4a46 Merge PR #330: K12-19 人在环审批 seam（无人应答⇒拒）
c84144526 feat(k12-10): 部门轴 departmentIds ＋ 文件驱动真源 ＋ 上下文单入口
6b133891a feat(k12-19): 人在环审批 seam（无人应答⇒拒，fail-closed）
```
⇒ 指令钉死 `07b28dfe2`，实测 `local-main` 头 = `68bf57598`（差 4 提交）。

### B-1 × D8 耦合（**决定性**）
```
git diff --name-only 07b28dfe2..HEAD @local-main  →  COUNT = 19
```
其中 **16 个与 K4-04 无关**（K12-10 / approval-seam / departments / memory-notes / control-tower 探针 / content-registry / self-ops 等）。
⇒ **D8 的对照命令只有在 HEAD 基于 `07b28dfe2` 时才自洽**；基于 `local-main` 则 **D8 天然越界 16 件**。
⇒ B-1 不只是"基线写错"，它**直接决定 D8 能不能算**。

### B-2 两套写集口径互斥 —— 见 §5
### B-3 Done⑤ 不可跑（**独立复现**）：`sqlite3` NOT FOUND ＋ 克隆内无 `data/synova.db`
### B-4 验收文件口径冲突 —— 见 §5
### B-5 ✅ 已解：装依赖前无 `node_modules`/`vitest`；`npm ci` exit=0，vitest 已就位

---

## 5. B-2 / B-4 独立核（两向互斥）

**卡面 `## 写集`（`:60-65`）—— 3 条**
```
src/store/migrations/004-graph-triples-rebuild.ts
src/adapters/sqlite-graph-store.ts
tests/adapters/sqlite-graph-store.legacy-schema.test.ts
```
**派单 §六 D8 —— 6 条模式，显式 allow-list（"只含："）**
```
src/store/migrations/004-* ｜ src/store/schema-migration.ts ｜ tests/store/**
docs/synova/product-lines/evidence/** ｜ .claude/claims/** ｜ .claude/task-briefs/**
```

| 路径 | 卡面写集 | 派单 D8 | 冲突方向 |
|---|---|---|---|
| `src/store/migrations/004-*` | ✅ | ✅ | —（**唯一交集**） |
| **`src/adapters/sqlite-graph-store.ts`** | ✅ | ❌ | **卡面允许 / D8 禁止** |
| `tests/adapters/sqlite-graph-store.legacy-schema.test.ts` | ✅ | ❌ | **卡面允许 / D8 禁止** |
| `src/store/schema-migration.ts` | ❌ | ✅ | **D8 允许 / 卡面禁止** |
| `tests/store/**` | ❌ | ✅ | **D8 允许 / 卡面禁止** |
| `docs/…/evidence/**`、`.claude/claims/**`、`.claude/task-briefs/**` | ❌ | ✅ | D8 允许 / 卡面禁止（治理产物） |

**可达性结论**（只报可达性，不评价对错）：
- **Done④ 在 D8 下不可达**：④ 的对象是"读路径失败不再静默空数组"，实测静默点在 `src/adapters/sqlite-graph-store.ts:255-259`（`queryEdges`）与 `:287-291`（`queryTriples`）；同文件 `queryNodes:219-225` 已是 `log.error`（D355 修过）⇒ 本卡要修的就是**剩下的 warn 级读失败**，**只能在 `src/adapters/**` 内改**，而 D8 不含该路径。
- **Done① 在 D8 下不可达**：① 钉死的验收文件 `tests/adapters/sqlite-graph-store.legacy-schema.test.ts` 不在 D8 allow-list ⇒ 遵守 D8 即**无该文件可跑**。
- **C4 在卡面 3 条写集下不可达**：C4 需把迁移登记进 `src/store/schema-migration.ts`（`:21` 版本常量、`:35-42` 注册表），该文件不在卡面写集 ⇒ 迁移**永不执行**。
- **B-4 实证**：`tests/store/migrations/` **存在**，已有 `001-graph-nodes-props.test.ts`／`002-metric-readings.test.ts`／`003-orgs.test.ts` ⇒ 派单点名的 `tests/store/migrations/004-graph-triples-rebuild.test.ts` **与既有约定一致**；`tests/adapters/` 亦存在但**无 legacy-schema 文件**（卡面那个为新建）。两候选文件**当前均不存在**，且分属**互斥口径**。

⇒ **请 CTO 钉单一写集**，并**显式声明 Done① 的验收文件路径**。**这不是实施员能自行选择的事。**

---

## 6. 独立判据（复核员口径 · **已按 CTO v2 更新**）

> **来源标注**：**[卡面]** = 卡面 Done 明载｜**[CTO v2]** = CTO 第 2 版续做指令新定｜**[加严]** = 复核员自加（**卡面未载**，须 CTO 背书方进判据集）。
> **本轮口径变更（CTO v2）**：**C4 升为正式判据**（§四 明令 `SCHEMA_VERSION 4→5`）｜**C5 作废**（Done④ 不实施，拆卡）｜**新增 C5′、C8**｜**C7 由"不可跑"转"可跑"**。

- **C1**（Done①）**[卡面]** `npx vitest run tests/adapters/sqlite-graph-store.legacy-schema.test.ts` ⇒ exit 0；逐条断言 `createEdge()` 返回匹配 `^edge-`、`queryEdges()` 长度 **N>0**。
- **C2**（Done②）**[卡面]** 迁移替换为仅 `ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'` ⇒ 必红，**消息含 `datatype mismatch`**（前置可复现性已由 §8 在夹具层独立验证）。
- **C3**（Done③）**[卡面]** 迁移 no-op／从注册表摘除（**不删文件** —— 删文件退化为模块解析错误，不产生 `no such column` 型红）⇒ 必红，**消息含 `no such column: props`**。
- **C4**（**已升为正式判据**）**[CTO v2 §四]** 判据 = 新迁移 `version ≥ 5` **且** `SCHEMA_VERSION = 5`，**且在生产形态库（`schema_version` 已达 4）上迁移仍被执行**。
  - **生产证据（实测，见 §14）**：真机 `data/synova.db` 的 `schema_version MAX(integer) = **4**` ⇒ **生产库确已在 v4** ⇒ `version ≤ 4` 的迁移**永远不会执行** ⇒ **C4 不是理论风险，是当前生产实况**。
- **C5** ❌ **本卡作废** **[CTO v2 §三]**：Done④ 不实施（`src/adapters/**` 被 `fix/1421-skills-type-assumption` 占用），**已拆卡**。
- **C5′**（**新增 · 本卡唯一"非代码型"判据**）**[CTO v2 §四 → **v3 §二.8 口径改写**]** **PR 正文必须显式写「Done④ 未交付 ⇒ CTO 已裁定拆卡，卡号待 CTO 补登」**（不是笼统的"已拆卡"）。CTO 原话：**不许沉默略过**。
  - ⇒ 判法：**若 PR 正文未写，即使测试全绿，亦判「不合规」。** 复核员须独立核；**须注明所核正文的版本/时点**（正文会被更新 ⇒ 断言不得与时点脱钩）。
  - ⇒ **复核实测（v3 口径，针对【更新后】正文）**：`updated_at = 2026-10-11T21:12:40+08:00`，`body = 9646 chars`（旧版 6708）；命中逐字行 `## (c) C5′ — Done④ 未交付` ＋ `**Done④ 未交付 ⇒ CTO 已裁定拆卡，卡号待 CTO 补登。**` ⇒ **PASS**。另核 (a)–(g) 七节齐全（标题逐字见 §9.2）。**旧版正文（6708 chars）只含「已拆卡」，不满足 v3 口径 ⇒ 已按新口径重核。**
- **C6**（**[加严]·卡面未载**）旧库预置 N>0 行 → 迁移后行数==N、`props`==旧 `props_json`、`id` 保留；再 `createEdge()` ⇒ N+1。依据：Done① 只要"取到数据"，**新写那 1 条边即可满足，旧行全丢照样绿**；且 **§14 实测生产 `graph_triples` 行数 = 0** ⇒ 旧行搬运**从未在真实数据上被验证**。
- **C7**（Done⑤，**已转可跑**）**[CTO v2 §五]** 本机无 `sqlite3` CLI ⇒ 用 **`node` + `better-sqlite3` 只读（`readonly: true`）** 读**旧树真机库**，取 `PRAGMA table_info(graph_triples)` ⇒ **须见 `props_json` 在、`props` 不在**；**须标注时点**。🔴 **禁写、禁拷进任何工作区。**（复核员已按此口径预跑，结果与副作用见 **§14**。）
- **C8**（**新增 · 最高风险抽验**）**[CTO v2 §六]** `tests/store/migrations/003-orgs.test.ts:39` 的 `expect(orgsMigration.version).toBe(4);` **必须逐字未动**（CTO 明令「不许动」），而**同一文件 `:70` 的 `SCHEMA_VERSION` 断言要求改** ⇒ **同文件"一改一不改"**是误伤高发点。
  - ⇒ 判法：`git diff $(git merge-base origin/local-main HEAD)..HEAD -- tests/store/migrations/003-orgs.test.ts` **只含 `:70` 附近**，`:39` 逐字未动；外加**逐字回读 `:39` 行**双保险。
- **C9**（**新增 · 最高优先级**）**[CTO v3 §一]** 🔴 **永久停用「逐字节一致 / delta=0 / 无差异」这类表述**；凡声称"相同/差异"，**必须写明【比较的两个对象】＋ 用 `hash-object`/`git diff` 当点出数**。
  - ⇒ 判法：**由复核员自己出这个数，不采信任何转述**（含队长与 CTO）。
  - ⇒ **复核实测（自出数，blob → blob）**：
    ```
    左  a797bdcb4:src/store/migrations/004-graph-triples-rebuild.ts
        = e47568b663edae57984095072a7f76d4e8ee9931   (8498 B)
    右  HEAD:src/store/migrations/004-graph-triples-rebuild.ts
        = 46e255d5540271684025465dfacf183ed1749052   (8534 B)
    git diff <左> <右> → hunk=1 ｜ 删=2 ｜ 增=3 ｜ **净行 = +1** ｜ **字节 delta = +36 B**
    变更行是否全在 JSDoc 注释体内 = **True** ⇒ **代码零改动** ✓
    ```
    ⚠️ **精度更正**：CTO 表述「+1 行」是**净行**；实际编辑是 **2 行 → 3 行**（净 +1）。两者不冲突，但按 C9 口径应写清。
    ✅ **与交付件 (d) 节自报一致**（交付件写 +36 B / +1 行 / 1 处 JSDoc 注释 / 代码零改动）。
  - ⇒ **左对象获取路径（可复现）**：Gitea 远端**无**该 ref（源分支 `fix/1455-graph-triples-props` 是**旧树本地分支，从未推送**；SHA 直取被拒、blob API 对左对象返回 400 而对照已知对象返回 200 ⇒ 方法有效、对象不在远端）。复核员最终**从只读旧仓 `D:\novis-backup-20260526\Novis\synova-agent` 字节级取到左对象**（`cat-file blob`，`hash-object --no-filters` 自证 = `e47568b663…`）。

---

## 7. 基线红腿（未修代码上实测）

**夹具真源不臆造（实测比对）**：
```
FIXTURE COL COUNT = 14
FIXTURE COLS = ["id:INTEGER PK","subject_type:TEXT","subject_id:TEXT","predicate:TEXT","object_type:TEXT",
 "object_id:TEXT","graph:TEXT","weight:REAL","props_json:TEXT","confidence:REAL","source:TEXT",
 "valid_from:TEXT","valid_to:TEXT","created_at:TEXT"]
MISSING vs authoritative = []      EXTRA vs authoritative = []      SET EQUAL = true
```

**判别性三步**：
```
① 单文件 tsc：TS1xxx COUNT = 0（必须 0）｜本探针自身错误 = 0
   （另有 2 条 TS2307 `@synova/logger`：裸 tsc 不解 vitest alias，属预期）
② 收集数：tests/adapters/k4-04-verifier-baseline.test.ts (6 tests | 5 failed)  ⇒ 收集 6 = 期望
③ exit code + 消息
```

**结果**：`vitest exit=1` ｜ `Test Files 1 failed (1)` ｜ `Tests 5 failed | 1 passed (6)`
```
 ✓ C0[对照·基线应绿] canonical 新库：createEdge 返回 edge-* 且 queryEdges 取到 1 行
 × C1a[Done①·绿腿期望] 旧库升级后 createEdge 返回 edge-*
 × C1b[Done①·绿腿期望] 旧库升级后 queryEdges 取到数据（N+1 行）
 × C6a[C6·绿腿期望] 旧行不丢：3 条 props_json 载荷全部保留
 × C6b[C6·绿腿期望] 旧 id 以 TEXT 保留（'1'/'2'/'3'）
 × C4[C4·绿腿期望] schema_version 已到 4 ＋ 旧表 ⇒ 迁移仍须执行（表形态 canonical）
```

| 例 | 错误（verbatim） | 归因 |
|---|---|---|
| C1a | `SqliteError: table graph_triples has no column named props`（栈 `src/adapters/sqlite-graph-store.ts:176`） | **写路径断** |
| C1b | 同一条 `SqliteError`（栈指向测试 `:102` 的 createEdge 调用） | **C1a 的级联；不作为独立证据** |
| C6a | `AssertionError: expected [] to deeply equal ArrayContaining{…}` | **读路径静默返回 []**（载荷全丢） |
| C6b | `AssertionError: expected [] to deeply equal ArrayContaining ["1","2","3"]` | 同上 |
| C4 | `AssertionError: expected false to be true`（`byName.has("props")`） | **迁移根本未执行**（库已 v4 ⇒ `currentVersion >= SCHEMA_VERSION` 提前 return） |

**读路径静默的直接证据**（同次运行日志）：
```
"err":"no such column: props","msg":"查询图边失败"        ← 只 log.warn；调用方收到 []
"err":"table graph_triples has no column named props","msg":"创建图边失败"
```

**C0 对照组通过** ⇒ 失败**可归因于"旧库形态未被处理"**，而非探针自身故障。

---

## 8. 半修复现（Done② 的判别性前提）

夹具：旧 14 列表 ＋ `ALTER TABLE graph_triples ADD COLUMN props TEXT NOT NULL DEFAULT '{}'`（卡面所称"半修掩盖"）。
```
① TS1xxx COUNT = 0 ｜本探针自身错误 = 0
② 收集数：tests/adapters/k4-04-verifier-addcolumn.test.ts (2 tests)
③ vitest exit=0 ｜ Tests 2 passed (2)
 ✓ D1[§⑤前半句·应绿] ADD COLUMN 后读通：queryEdges 取到 3 行
 ✓ D2[§⑤后半句·应绿] 写仍失败：createEdge 抛错且消息含 datatype mismatch
日志："err":"datatype mismatch","type":"DEPENDS_ON","from":"n0","to":"n1","msg":"创建图边失败"
```
⇒ 卡面 §⑤ 两半句**在本夹具上独立复现成立** ⇒ 后续 **Done② 的造红具备判别性前提**。

**未实测的推断（明确标注，不假装测过）**：`ALTER TABLE … ADD COLUMN props TEXT NOT NULL DEFAULT '{}'` 为**常量默认**，按 SQLite 语义**不会回填 `props_json`** ⇒ 半修路径**同时丢载荷**。此点**未单独测量**；若 CTO 需要，复核员补一例测。

---

## 9. 四项结论（a / b / c / d）

> 格式约定：**a** 与实测不一致处（附命令＋原始输出）｜**b** 无法核实处｜**c** 跑不通处｜**d** 能否据此独立开工/决策。
> ⚠️ **本节 v1 只覆盖"卡面 / 派单 / 环境"层**；"对交付物"层的四项待交付物到手后按同一格式补齐。

### a) 与实测不一致处（卡面/派单/环境层）
1. **卡面 §⑤「16 个 ref 全部未合入主线」** —— 实测 `for-each-ref --contains db7f0503f` = **4**（`feat/D967a-measurements-store`、`feat/D967b-sentinel-alert-stats`、`feat/D968a-sentinel-single-registry`、`feat/D968b-win-single-entry`，无 tag）。"未合入主线"本身成立（`merge-base --is-ancestor` exit=1）。**建议以实测 4 为准并订正卡面数字。**
2. **指令钉死基线 `07b28dfe2` vs 实测 `local-main` = `68bf57598`** —— 差 4 提交（B-1）；且该差异**直接使 D8 不可算**（B-1×D8 耦合，19 文件 / 16 件无关）。
3. **卡面写集（3 条）与派单 D8（6 条模式）两向互斥** —— 交集只剩 `src/store/migrations/004-*`（B-2，§5）。
4. **卡面 Done⑤ 点名的 `sqlite3` CLI 在本机不存在；`data/synova.db` 不在任何工作区** —— 与"Done⑤ 可执行"隐含前提不符（B-3）。
5. **卡面与派单点名的验收测试文件分属两套口径**（`tests/adapters/…legacy-schema.test.ts` vs `tests/store/migrations/004-…test.ts`），两文件当前**均不存在**（B-4）。

### b) 无法核实处
1. **旧表真实列清单**：仓内唯一原始证据的 DDL 行**被截断**（P16），真机不在工作区 ⇒ 本无法逐列核实；**① 由 CTO 提供双口径采集的权威 14 列 DDL，复核员据此建夹具并实测 set-equal**（§7）；**② 2026-10-11 20:54:50 按 CTO v2 §五 口径对生产库只读抽验，全 DDL 可读且与夹具逐字同形**（§14.2，P18）⇒ **该条已双重收敛**，最终以生产库实测 + 夹具实测为准。
2. **「16 个 ref」的确切口径**：本克隆实测 4；若 CTO 档案仓有额外 ref，需其提供对照。
3. **卡面 §⑤ 的 `datatype mismatch` 在"真机"上的表现**：克隆内无真库 ⇒ **无法在真机复现**；已在**夹具层**独立复现（§8）。
4. **派单件全文**：复核员仅见 §六 D8 段与 §四/§五要点；**§一~§五、§七 及其余完成标准（Z1–Z7）未核**。
5. **Done④ 的准确口径**（抛错 vs error 级＋仍 `return []`）：语义歧义，须 CTO 钉（C5）。

### c) 跑不通处
1. **Done⑤ 原命令跑不通**：`sqlite3` 不存在 ＋ 目标库缺失（B-3）。**替代**：`python3 -c` 只读 `PRAGMA table_info`／`sqlite_master.sql`，但**需 CTO 指定目标库**。
2. **装依赖前任何 vitest 跑不通**：`node_modules`/`vitest` 缺失（B-5）。**已解**：`npm ci` exit=0，vitest 5.0.2 就位。
3. **`pnpm` 跑不通**：`index.js: SyntaxError` ⇒ 全队走 npm。
4. **（复核员侧）`glob` 对 `patches/*.patch` 与中文路径返回假阴性** ⇒ 不得作为"文件不存在"证据，须改用 `pwsh`/直接读。

### d) 能否据此独立开工 / 决策
1. **可以独立开工的部分**：旧库夹具、读写双路径判据、基线红腿、半修判别性前提 —— 复核员**已独立完成**（§7/§8），不依赖交付物。
2. **不能独立开工的部分（须先裁决）**：**B-2 写集口径不钉死，任何交付物都无法同时满足两套口径**（按 D8 ⇒ Done①④ 不可达；按卡面 ⇒ C4 不可达）；**B-1 基线不钉死 ⇒ D8 不可算**。⇒ **请 CTO 先裁 B-1/B-2/B-4 与 C4/C5/C6，再验收交付物。**
3. **对"能否据交付物决策"** ⇒ **§9.2（交付物已到手，已补齐）**。

### 9.2 对交付物层 —— ⚠️ **本节已失效（针对旧 head `8d9963431`）**，以 **§15（新 head `09240a496`）** 为准

> 🔴 **失效声明（2026-10-11）**：交付物其后推进到新 head `09240a496935900fdf902f25d5c5c4dcb8229cca`（PR #343，PATCH 201，5 commits，旧 head 为其祖先 ⇒ 非 force push 重写）。按 C9 口径，**本节所有读数绑定旧对象 `8d9963431`，不再作为当前有效结论**；重核结果见 **§15**。本节保留作历史与差异对照。

#### （旧对象）PR **#343** ｜ head `8d99634313ed85bb91f92f800508096bd3039d0d` ｜ base `68bf57598…`

**复核时点**：2026-10-11 21:0x–21:2x（正文为 `updated_at 21:12:40` 的 **v3 更新版**，9646 chars）。

#### 判据判定表（全部由复核员独立重跑）
| 判据 | 结果 | 关键原始读数 |
|---|---|---|
| **C1**（Done①，验收责任 = 卡面点名件） | ✅ 绿 | `vitest exit=0`；`tests/adapters/sqlite-graph-store.legacy-schema.test.ts (6 tests) → 6 passed` |
| **C2**（Done② 半修掩盖 ⇒ 必红） | ✅ 红（判别性成立） | 造红后 `exit=1`；**`datatype mismatch` ×9 行**；收集数 12 = 期望（6+6）；交付验收件 3/6 红、复核探针 4/6 红（C6a 仍绿 = 回填生效） |
| **C3**（Done③ 摘注册 ⇒ 必红） | ✅ 红（判别性成立） | 造红后 `exit=1`；**`no such column: props` ×7 行**；且 **`datatype mismatch` = 0**（证明与 C2 红因子不同） |
| **C4**（生产路径 ⇒ 正式判据） | ✅ 绿 | 静态：`004 version: 5`｜`schema-migration.ts:22 SCHEMA_VERSION = 5`｜`:15` import ｜`:47` 注册。行为：复核探针 C4 用例在 `schema_version=4` ＋ 旧表夹具上**绿**；生产库实测 `schema_version = 4`（§14.2） |
| **C5** | ❌ 作废（拆卡） | — |
| **C5′**（v3 口径 · 非代码判据） | ✅ PASS（**针对更新后正文**） | `## (c) C5′ — Done④ 未交付` ＋ `**Done④ 未交付 ⇒ CTO 已裁定拆卡，卡号待 CTO 补登。**`；(a)–(g) 七节齐全 |
| **C6**（加严 · 卡面未载） | ✅ 绿 | 复核探针 C6a（3 条 `props_json` 载荷全保留）/ C6b（旧 id `'1'/'2'/'3'` 以 TEXT 保留）均 pass |
| **C7**（Done⑤） | ✅ 读数成立 | §14.2：14 列 / `props_json` 在 / `props` 不在 / `schema_version=4` / 边行数 0（时点 20:54:50） |
| **C8**（最高风险抽验） | ✅ 干净 | 该文件 **1 个 hunk**（`@@ -62,12 +62,12 @@`）、行数 110→110；**`:39` 逐字未动**（base/head 同位置同内容）；**`:70` 已改 `.toBe(5)`** |
| **C9**（最高优先级 · 新口径） | ✅ 自出数成立 | 见 §6-C9：hunk=1 / 删2 / 增3 / 净 +1 行 / Δ+36 B / 代码零改动 |
| **D8 写集** | ✅ 不越界 | `merge-base..HEAD` = **29 文件**，全在 CTO v2 §3 白名单内；**`src/adapters/**` 零命中** |

**端到端绿腿（复核员自己的仪器）**：`tests/adapters/sqlite-graph-store.legacy-schema.test.ts` ＋ **复核员自建探针**同跑 ⇒ `exit=0`，`Test Files 2 passed (2)` ／ **`Tests 12 passed (12)`**（各 6 例）。✅ **即：校准过的探针（可满足 6/6 + 有判别力 5/6）在交付件上全绿。**

#### a) 与实测不一致处
1. **"捡回源"的 ref 不在 Gitea 远端**：交付件（`.claude/claims/237.yaml`、`README.md`、PR 正文）称资产捡回自 `fix/1455-graph-triples-props @ a797bdcb4`。**实测**：`git fetch <url> fix/1455-graph-triples-props` → `fatal: couldn't find remote ref`（本克隆 930 个远端 ref，匹配 `1455` 的 **0** 个）；`a797bdcb4` / `e47568b663…` 在 Gitea 对象库均不可取（**blob API 受控对照**：已知对象 `46e255d55402` → **HTTP 200 / size 8534**；目标 `e47568b663…` → **HTTP 400**）⇒ **该源是旧树的本地分支，从未推送**。⇒ **不构成缺陷**（复核员最终从只读旧仓字节级取到并自证），但**若正文/claims 暗示其为远端可达，则与实测不符**，建议按 C9 口径写清"源 = 旧树本地分支"。
2. **C9 的"+1 行"是净行，非"只改了 1 行"**：复核员自出数为 **删 2 / 增 3 / 净 +1**（一行注释被重排为两行）。数值不冲突，但按新口径应写清。
3. **交付件 004（157 行）= 语义重实现，而非照抄卡面 §⑤ 所指的 `db7f0503f:002-…`（124 行）**：两者**不同源**（交付件源为另一分支的同名 004）。语义要素一致（形状守卫 / 幂等 / 列映射 / 事务 / 先 DROP 再建索引），**复核员未发现语义退化**；但"捡回"的对象与卡面举例的 commit **不是同一个**，应由 CTO 确认口径。
4. **额外改动文件超出卡面 3 条**：`tests/store/metric-readings-schema.test.ts`、`tests/store/schema-migration.test.ts` 亦被修改 —— **均落在 CTO v2 §3 的 `tests/store/**` 白名单内**，**非越界**，此处仅为账面一致（29 vs 3）。

#### b) 无法核实处
1. **run 281 的失败"用例清单"**：Gitea API 可给出 job 级（`run 281 → job id=295 name=gates`）与**步骤级**（`③ 增量测试（vitest --changed）→ failure`），但**无 job 日志端点**（`/actions/jobs/{id}` 不含 steps 明细日志；三次端点尝试均无日志内容）⇒ 281 内具体红在哪两个文件**无法独立取数**。
   - ⚠️ **但"存量红"结论不依赖 281**：复核员用**基线对照实验**独立证明（见 c-2 与下条）。
2. **`stream-tool-loop.test.ts` CI 红的环境成因**：实施员归因"CI 上收到真 LLM 文本"。复核员实测**本地 HEAD 与基线皆为 6 passed** ⇒ **成因无法本地复现**，**该因果关系未核实**（可核实的是"本地两态皆绿"这一事实）。
3. **B 腿恢复哈希的自洽性**：`README.md:62` 把 `hash-object == e47568b66…` 记为 B 腿"恢复后"的核验值；而 `e47568b66…` 是**捡回源 blob**。这与"注释改动发生在 D5 之后"的时序假设自洽，但复核员**无法复核其当时的工作树状态** ⇒ 标为不可独立复核（**表述易误读，建议按 C9 写清对象与时点**）。
4. **派单件 §一~§五、§七 全文**：复核员仍未见到（仅队长转述要点）。

#### c) 跑不通处
1. **`git fetch <sha>` 直取被拒**：`fatal: couldn't find remote ref a797bdcb4`（两种写法均失败）⇒ 远端未开 SHA 直取。
2. **Gitea blob API 对左对象 400**（受控对照已知对象 200）⇒ 对象不在远端；**最终改走只读旧仓**（字节级 `cat-file blob` + `hash-object --no-filters` 自证）⇒ **已绕过**。
3. **🔴 复核员自身的读法错（自报）**：首探 `/actions/runs/{n}/jobs` 时我按"数组"读 `.Count` ⇒ 得空 ⇒ **误判为"该版本不暴露 jobs"**；实际返回 `{"jobs":[...]}` **对象**。**改名后即取到** `job id=295/321、name=gates`。**是我读错，不是 API 不可用**（与纪律第 3 条同族：**先核口径再下"不可用"结论**）。
4. 本机 `sqlite3` 不存在、`pnpm` 损坏（`index.js: SyntaxError`）⇒ 已按 CTO 指定口径用 `node + better-sqlite3` 只读替代。

#### d) 能否据此独立开工 / 决策
1. **可以独立完成并已完成的**：D8 白名单核、C8 抽验、C9 自出数、C5′（更新版）、绿腿（交付验收件 + 复核员探针 12/12）、三条造红（C2 / C3 / Done③ 等价态）、**D10 基线对照**。
2. **🔴 D10 CI 红的独立结论（不依赖实施员自证）**：
   - **基线对照实验（决定性）**：在**零本卡改动**的基线树（`local-main @ 68bf57598`，`diff=0`，`004` 不存在）上重跑同样两件 ⇒ `chat-degradation` **6 failed（逐例一致）**、`stream-tool-loop` **6 passed**；与 HEAD 逐条对照 **`用例级结果一致 = True`** ⇒ **该 6 例红是基线就红（存量），与本卡改动无因果** ✅。
   - **步骤级对照**：`run 281` 与 `run 307` 均 `job=gates`、**同为步骤 ③（vitest --changed）failure**，其余步骤无失败 ⇒ 与实施员归因方向一致。
3. **不能由复核员代办（须 CTO 决策）**：
   - **DDL 属 schema 面**：重建会**移除** `confidence` / `source` / `props_json` 三列（交付件已自标"待 CTO 逐字批"）；**须 CTO 逐字批**（生产边表当前 0 行 ⇒ 无行数据风险，但**列语义取舍属 CTO 权限**）。
   - **Done④ 拆卡的卡号补登**。
   - **CI 步骤③ 红的合并口径**：虽已证明为存量 + 环境，**"合并前是否须 CI 转绿 / 是否豁免"是流程决策**，不由复核员判。
4. **复核员的结论（依职责用语）**：**`自验结论`：本卡全部可执行判据（C1/C2/C3/C4/C5′/C6/C7/C8/C9 + D8）均通过复核员独立重跑，未发现与判据冲突之处 ⇒ `可提请独立审计`。** ⚠️ **"通过与否"归 CTO 收件闸 ＋ K3 终审**；本条不含审计结论，也不替代 §d.3 的三项 CTO 决策。

---

## 10. 待裁决（阻塞项）—— **已由 CTO v2 全部裁定（2026-10-11）**

| # | 事项 | 裁定 |
|---|---|---|
| 1 | B-1 基线（`07b28dfe2` vs `68bf57598`）＋ 其对 D8 的耦合（§4） | ✅ **CTO v2 §1**：基 = **当前 `local-main` tip（`68bf57598`）**；`07b28dfe2` 废弃（换过去=倒退）。**我的"B-1 使 D8 不可算"分析被采纳为改 D8 的理由。** |
| 2 | B-2 单一口径：卡面 3 条 or 派单 D8 6 条（互斥，§5） | ✅ **CTO v2 §3**：**以卡面为准**，写集 7 类（含 `tests/adapters/…legacy-schema.test.ts`、`src/store/schema-migration.ts`）；🔴 **禁 `src/adapters/**`**（被 `fix/1421-skills-type-assumption` 占用）⇒ **两条"不可达"解除，仅 Done④ 不可达（拆卡）** |
| 3 | B-4 Done① 验收文件路径 | ✅ **CTO v2 §3**：`tests/adapters/sqlite-graph-store.legacy-schema.test.ts`（**卡面口径胜出，必建**） |
| 4 | B-3/Done⑤ 目标库与等价读数口径 | ✅ **CTO v2 §5**：`node` + `better-sqlite3` **只读**读**旧树真机库**；须见 `props_json` 在 / `props` 不在；禁写禁拷。**复核员已预跑（§14）** |
| 5 | C4 / C6 是否进判据集 | ✅ **C4 升正式判据**（§四 明令 `SCHEMA_VERSION 4→5`）；**C6 保留为加严判据并标注「卡面未载」** |
| 6 | C5 Done④ 口径歧义 | ✅ **C5 作废**（Done④ 拆卡）；**新增 C5′**：PR 正文必须显式写「Done④ 未交付，已拆卡」——**不许沉默略过**（不写 ⇒ 即使全绿亦判不合规） |
| ~~7~~ | ~~依赖安装授权~~ | ✅ 已解（§2） |
| ~~8~~ | ~~判据可绿性未验证（原风险登记）~~ | ✅ **已验证可绿**：参考实现 6/6 全绿，且复原后红腿复现（§12）—— **未发现判据过紧，未放宽任何一条** |
| **9（新）** | **C8 抽验优先级** | ✅ 队长判定：与 Done② 半修掩盖**同级**（"改了会静默破坏 003 的元数据契约"，比 Done② 更隐蔽） |

⇒ **本轮无未决阻塞项**；复核员按 §6 更新后的判据集执行（等交付物）。

---

## 11. 复现方式（第三方可重跑）

```powershell
# 0) 独立工作区（勿用他人工作树）
$tok = (Get-Content "D:\win-push.token" -Raw).Trim()
$url = "http://win-push:$tok@192.168.1.7:3000/synova-agent/SynovaAgent.git"
git -c credential.helper= -c safe.directory=* clone -b local-main $url "D:\synova-wt-1455-verify"
git -c safe.directory=* -C "D:\synova-wt-1455-verify" remote set-url origin "http://192.168.1.7:3000/synova-agent/SynovaAgent.git"

# 1) 依赖（约 1min；postinstall 跑 patch-package）
cd D:\synova-wt-1455-verify ; npm ci --no-audit --no-fund

# 2) 判别性三步（本例）
npx tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler tests/adapters/k4-04-verifier-baseline.test.ts   # TS1xxx 必须 0
npx vitest run tests/adapters/k4-04-verifier-baseline.test.ts        # 收集数须 = 6
npx vitest run tests/adapters/k4-04-verifier-addcolumn.test.ts       # 收集数须 = 2（§8 判别性前提）
```
> 基线红腿对应 HEAD `68bf57598`。**若 CTO 裁换基，本红腿须在新基上原样重跑并重记 HEAD sha**（探针与夹具与基线无关，可原样重跑）。

---

## 12. 仪器校准（探针可满足性验证）

> 🔴 **本节只校准探针可满足性，不构成对交付物的任何结论。** 参考实现系**校准用临时件**：已删除，**未提交、未推、未进入任何交付件/PR**。

### 12.1 为什么需要校准
§7 的 5 条绿腿期望**只验证过"会红"，从未验证过"能不能绿"**。若判据过紧（例如 C6b 要求旧 id 恰为 `'1'/'2'/'3'`，而正解可能重新生成 id），交付物到手后会把「**探针不可满足**」误判为「**交付物不合规**」⇒ **仪器未校准就不该拿去量别人**（与"测量管线污染读数"同族：问题不在被测方，在测量口径）。

### 12.2 前置断言（不过则校准无效）
依据 C4：参考正解 `db7f0503f:002-graph-triples-rebuild.ts` 是 `version: 3`，而现行 `SCHEMA_VERSION=4`、`003-orgs` 恰占 version 4 ⇒ **逐字照搬 = 生产上永不被执行 ⇒ 校准会假红**。故先断言：
```
[GUARD] SCHEMA_VERSION = 5 | migration.version = 5 | migration.name = graph-triples-rebuild
 ✓ tests/adapters/k4-04-verifier-calibration-guard.test.ts (1 test)
 Test Files 1 passed (1)      Tests  1 passed (1)      guard exit=0
```

### 12.3 参考实现（逐字 ＋ 仅改版本号；机械施加并断言）
- 取法：`git cat-file blob db7f0503f:src/store/migrations/002-graph-triples-rebuild.ts` **字节级**（6461 B；**CRLF=0 / bare-LF=124**）
- 改动：正则替换 `^  version: 3,$` → `^  version: 5,$`（断言：内容已变 **且** 匹配 `version: 5`；⚠️ 见 12.6）＋ 头部 3 行校准横幅注释
- 差异范围（实测）：`orig 行数 = 125 ; new 行数 = 128`；代码行 `^  version: 5,$` 命中 **1**、`^  version: 3,$` 命中 **0** ⇒ **除横幅 3 行 ＋ 版本 1 行外逐字**
- 临时登记 `src/store/schema-migration.ts`（import ＋ 注册表 ＋ `SCHEMA_VERSION: 4 → 5`）：
```
 src/store/schema-migration.ts | 6 +++++-
 1 file changed, 5 insertions(+), 1 deletion(-)
```
- 单文件 `tsc`：`TS1xxx COUNT = 0`

### 12.4 校准结果
```
npx vitest run tests/adapters/k4-04-verifier-baseline.test.ts
 ✓ tests/adapters/k4-04-verifier-baseline.test.ts (6 tests)   vitest exit=0
 Test Files  1 passed (1)      Tests  6 passed (6)
失败消息匹配（AssertionError|SqliteError|no such column|datatype mismatch）= 0 条
```
⇒ **6/6 全绿** ⇒ 6 条判据**全部可满足**，含曾被担心的 C6b。**未放宽任何一条判据**；探针文件全程未改动，证据为时间序：`probe mtime 20:31:45 < §7 红腿日志 20:32:03 < 校准日志 20:37:02`。

### 12.5 复原可核 ＋ 判别力仍在（红 → 绿 → 红）
复原（删 004 临时件 ＋ 删 guard ＋ `git restore src/store/schema-migration.ts`）后三个读数：
```
git diff --name-only   COUNT = 0     （必须 0）
git status --short     COUNT = 3     （必须 3：复核件 + 2 探针）
HEAD = 68bf57598                      （必须 68bf57598）
回读 schema-migration.ts → export const SCHEMA_VERSION = 4;
```
复原后**重跑红腿**（同一探针，未改一字）：
```
post-restore vitest exit=1 ｜ Test Files 1 failed (1) ｜ Tests 5 failed | 1 passed (6)
与 §7 红腿逐条用例结果一致 = True
```
⇒ **仪器同时具备两个性质：① 可满足（参考实现 6/6 绿）② 有判别力（未修代码 5/6 红）**，且未因校准而放宽。

### 12.6 本节生产的三条工具教训（自报，防他人重踩）
1. **等长替换不能用"长度变化"断言**：`version: 3` → `version: 5` **长度不变**，首版脚本以 `$txt.Length -eq $before` 判"替换失败" ⇒ **误报 `REPLACE FAILED`**（实际替换已成功）。修法：比**内容**（`$txt -eq $orig`）或匹配目标串。
2. **`(Get-Content | Measure-Object -Line)` 的行数是"两个误差叠加"，主因是解码路径而非"非空"规则**（复核员原版表述不完整，此处更正）：
   - 实测（本件 v1.1，真值 **0x0A = 360**）：
     ```
     A) Get-Content（未指定编码 ⇒ 默认 ANSI/CP936）: elements=265  empty=41  Measure-Line=224
     B) Get-Content -Encoding UTF8               : elements=360  empty=72  Measure-Line=288
     ```
   - **效应①（主因）**：UTF-8 中文内容按 ANSI 解码时，**高字节与 0x0A 被成对吞掉 ⇒ 换行丢失**。受控隔离：
     ```
     中文 3 行（UTF-8，真值 0x0A=3）: 默认 → elements=1（!）;  -Encoding UTF8 → elements=3
     ASCII 3 行（真值 0x0A=3）      : 默认 → elements=3          （纯 ASCII 不受影响）
     ```
     ⇒ 本件 360 行被默认解码读成 **265** 个元素（少 95）。
   - **效应②（次因）**：`Measure-Object -Line` **不计空元素**。受控隔离：
     ```
     ASCII "aaa\n\nbbb\n"（真值 3 行）: elements=3 ; Measure-Line=2
     ```
     ⇒ 本件按 `-Encoding UTF8` 读为 360 时，Measure-Line = **288**（= 360 − 72 空行，自洽）。
   - **结论**：凡"行数"结论必须**写明口径**，且**优先字节级**（数 `0x0A` 字节 / `git cat-file`）。**不得用 `Get-Content`（未声明编码）＋ `Measure-Object -Line` 报"总行数"。**
3. **复核员的一个假设经队长实测【证伪】（如实登记，防他人重提）**：
   - **复核员原假设**：同类第一次（2026-10-09 `k4-coder-f` #1031 U-5）的 `67/91 = 0.7363` 与本件 `265/360 = 0.7361` 比值几乎相同 ⇒ *可能*同因（解码吞换行）。
   - **证据来自队长 `lead`（2026-10-11 实测；署名备 K3 追）**：被核对象 = 同类第一次的原件 `docs/synova/coordination/CTO-固化-最终方向与在制任务-20260924.md`，取法 = `git cat-file blob origin/main:…` **原始字节**（不走文本管线）：
     ```
     bytes = 8724 ｜ 0x0A（真值行数口径）= 93 ｜ 高字节(>=0x80) = 1116 (12.8%)
     A) Get-Content 默认          : elements=91   Measure-Line=67
     B) Get-Content -Encoding UTF8: elements=91   Measure-Line=67    ← 与 A 逐字相同
     ```
   - **判定**：默认与 UTF-8 **逐字相同** ⇒ **解码效应在该件上未咬** ⇒ 第一次的 `67` **确系"空元素口径"**（91 元素中 24 个空），**当时的诊断成立**；`elements=91` 与当时 `wc -l=91` 逐字吻合。
   - **比值巧合的真实解释**：两者是**不同量的比** —— 本件 = `默认元素数 / 真值行数`（解码吞 95 行）；第一次 = `非空行 / 元素数`（空元素扣 24 个）。⇒ **同一数值、两种机制；数值巧合不能当作同因证据**（见 §13 第 5 条）。
   - **复核员据此撤回该假设**：**已被证伪，不再成立。**

### 12.7 对 Z6 的证据面（队长④点名引用）
> **参考实现（`db7f0503f` 逐字，仅 `version: 3 → 5`）在旧库夹具上使复核探针 6/6 全绿**（原始输出见 §12.4）。

⇒ 仅作为 **Z6（逐文件捡回）** 的"该文件本身可用"独立证据面；**不等于**对交付物的任何结论。

---

## 13. 工具纪律清单（本批可核 · **10 条亲测 + 1 条转述** · 供 PR 正文与跨会话沉淀引用）

> **性质声明**：本节是**工程纪律记录**，**不是审计标准**，**不改动任何门禁/技能**（技能与门禁变更须走 提案 → K3 → CTO；复核员不擅改）。
> **为什么落在这里**：同类工具语义错在本批已是**第二次**（第一次 2026-10-09 `k4-coder-f` #1031 U-5：把 `Measure-Object -Line` 当总行数，报"近邻件 67 行"实际 91 行 ⇒ 被独立自验抓出）。当时的批次报告**未发布**，教训**没有跨会话传到本批** ⇒ 属"**教训沉淀无出口**"的系统性缺口。本节先把清单落在**仓内可核处**；升级通道由队长走 CTO。
> **升级口径（队长 2026-10-11 更正，本件照录）**：两次的**表面症状同类**（报行数不写口径 ＋ 用了会失真的工具），但**子机制不同**（第一次 = 空元素口径；第二次 = 解码吞换行）。⇒ 升级对象是「**缺一条统一的行数口径纪律**」这一**纪律缺口**，**不是某个成员重复犯错**。**升级仍然成立，但对象是缺口，不是人。**
> **每条格式**：错误读法（会骗人） → 正确读法 → **实测样例**。凡复核员亲测标「实测」；仅批次转述、未亲测标「转述·样例待补」，**不冒充实测**。

| # | 纪律 | 错误读法（会骗人） | 正确读法 | 出处 / 实测样例 |
|---|---|---|---|---|
| 1 | **量字节 / 行尾 / 编码禁用文本管线中转** | `git cat-file blob … \| Out-File`（LF 被重写成 CRLF）、`Set-Content`、`>` 参与判据 | 直读字节（`[IO.File]::ReadAllBytes`），或用 `git hash-object --no-filters` 与 blob sha **比对** | **实测**：首测仓库 `.md` 得"blob = CRLF"；改 sha 比对后真值 = **LF**（`README.md` blob `946e1fdd` = filtered ≠ raw `641eb6a0`） |
| 2 | **等长 / 保长变换禁用"长度变化"断言** | `if ($new.Length -eq $old.Length) { 判"替换失败" }` | 比**内容**（`$new -eq $old`）或断言匹配目标串 | **实测**：`version: 3` → `version: 5` **等长** ⇒ 首版脚本误报 `REPLACE FAILED`（实际替换成功，**断言错**而非替换错） |
| 3 | **凡"行数"必须写口径，且优先字节级；禁 `Get-Content`（未声明编码）+ `Measure-Object -Line` 报总行数** | 不声明口径就报数；把 `Measure-Object -Line` 当总行数 | 数 `0x0A` 字节 / `git cat-file`；或显式声明口径（`\n` 段 / 非空行 / `wc -l`） | **实测（两效应已隔离，队长定稿口径）**：**两个独立失真源** —— **(a) 解码**（UTF-8 按 ANSI/CP936 解码时高字节可吞 `0x0A`，**文件相关**）：本件真值 **0x0A = 360**，默认编码读成 **265 元素**（少 95）；受控：中文 3 行文件默认读成 **1** 个元素。**(b) 空元素不计**（`Measure-Object -Line` 统计非空行，**次因**）：265 → **224**；受控：ASCII `"aaa\n\nbbb\n"`（真值 3）→ Measure **2**。同一文件 `-Encoding UTF8` → 360 元素 / Measure **288**。**同类第一次**：2026-10-09 `k4-coder-f` #1031 U-5（经队长实测复核 = **纯"空元素口径"**，见 §12.6 第 3 条） |
| 4 | **glob 空结果不得当作"文件不存在"的证据** | `glob patches/*.patch` → `No files found` ⇒ 判"文件缺失" | `pwsh` `Test-Path` / `Get-ChildItem` / 直接 `read` 复核 | **实测**：`patches/*.patch` 与含中文路径均返回假阴性；实际 `patches/ink+5.2.1.patch` **存在**（6771 B，`git ls-files` 已跟踪） |
| 5 | **表面相同 ≠ 机制相同：数值巧合不得当作同因证据** | 两个比值几乎相同（`0.7363` vs `0.7361`）⇒ 推"同因" | 必须**逐机制隔离验证**（改一个变量看读数是否随之变），再下同因结论 | **实测·证伪（证据来自队长 `lead`，2026-10-11）**：本件 `265/360 = 0.7361` = `默认元素数/真值行数`（解码吞行）；第一次 `67/91 = 0.7363` = `非空行/元素数`（空元素扣行）。队长对第一次原件实测：默认与 `-Encoding UTF8` **逐字相同（91 / 67）** ⇒ **解码效应未咬** ⇒ **同数值、不同机制**。复核员据此**撤回**自己的"同因"假设 |
| 6 | **「零改动」的判据是【内容 sha256】，不是 mtime**；只读打开 WAL 库会触碰 `-shm` mtime | 用 mtime 判"有没有写"；或声称"零改动"却只看文件列表 | 内容 **sha256**（必要时逐文件）；mtime 只作**副作用信号** | **实测 + 队长裁定（2026-10-11）**：只读抽验后 `synova.db-shm` mtime 变为探针时点（2026-10-11 20:54:50）⚠️，但 `synova.db` sha256 `771f0677…` **与 2026-10-09 基线逐字节一致** ⇒ **不判违规**。口径定稿：要求 **mtime 级**零改动须 ① 事先豁免 `-shm`，或 ② 一次性快照（**本卡禁拷真库**）⇒ 否则是不可达断言 |
| 7 | **做对照实验前先核对照物与原物是否同构** | 拿"看起来一样"的副本做对照，结论照用 | 先核**同构性**（同一组文件/同一状态/同一路径形态），再谈对照效力 | **队长自报的无效实验（2026-10-11）**：副本只 `Copy-Item` 主库、**未拷 `-wal`/`-shm`** ⇒ 副本是新库、无需 attach 既有 `-shm` ⇒ `t.db-wal`/`t.db-shm` 两时点皆 **ABSENT**、mtime 未变。**与原物不同构 ⇒ 不支持也不否证任何结论**（与第 5 条同族：**表面相似 ≠ 同构**） |
| 8 | **命令报错（如 usage error）时，它的输出不是数据** | 命令失败但打印了 `0`/空 → 当读数采用 | 先判 exit/usage，**再**决定输出是否可用 | **复核员自纠（2026-10-11）**：内联 `$(...)` 调 `git diff` 展开失败、git 报 usage 错误，而那行仍打印"0 个文件" ⇒ **判废数、不采信**，改分步执行重测。（队长判为标准动作；与"红了 ≠ 被测行为"同族） |
| 9 | **声称"相同"必须写明【两个对象】的 sha，并【当点现测】**；⛔ 停用「逐字节一致 / delta=0 / 无差异」 | 说"两部分一致""没差异"却不写比的是哪两个对象、什么时候比的 | 写出两侧对象的**全 sha**（必要时附大小），**由复核方自己**跑 `hash-object` / `git diff <A> <B>` 出数 | **实测（CTO v3 §一 定案；复核员自出数）**：左 `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B）↔ 右 `46e255d5540271684025465dfacf183ed1749052`（8534 B）；`git diff` ⇒ hunk=1 / 删2 / 增3 / **净 +1 行** / **Δ+36 B** / 变更全在 JSDoc 注释体内（代码零改动）。⚠️ 转述"**+1 行**"实为**净行**，真编辑是 2→3 行 |
| 10 | **替换 / 锚点类操作必须先证「命中」，再信结果** | 正则/字符串替换**静默不命中**（或只命中部分），却继续跑并采信下游结果 ⇒ 把"没改"当成"改了没用" | 替换后**立刻断言内容已变**（`$new -ne $old` / 目标串命中数 / 命中计数 > 0）；**未命中即抛错停跑**，不得继续 | **实测（复核员，2026-10-11）**：C3 造红首轮 `(?m)^  graphTriplesRebuildMigration,$` **未命中** —— 工作树该行以 **`\r`** 结尾（CRLF 检出）；**断言当场抛错 ⇒ 未写入任何改动**（`diff=0` 已核）；改 `,\r?$` 后命中。与第 3 条同族（**先核口径/行尾再断言**）、与"命令报错时输出不是数据"同族（**操作没生效时，结果不是结果**） |
| 11 | 其它批次在册项（复核员未亲测） | — | — | **转述·样例待补**：PowerShell 变量名不区分大小写导致吞 `$i`/`$id`；`--listFiles` 与 `2>&1` 混流污染读数。**出处**：队长转述批次记录；本节不冒充实测 |

**同族归并（队长口径，2026-10-11）**：第 5 条与既有"**子串匹配 ≠ 声明匹配**""**模式宽于命题**"同族 —— 共同的错法是**用表面特征（相同数值 / 匹配到子串 / 模式能覆盖）替代机制验证**。第 7 条（对照物同构性）与第 5 条同族（**表面相似 ≠ 同构 / ≠ 同因**）；第 8 条（报错输出非数据）与"**红了 ≠ 被测行为**"同族；**第 9 条与第 5 条同族（"相同"必须有对象与当点读数，否则不可核）**；**第 10 条与"命令报错时输出不是数据"同族（操作未生效时，结果不是结果）**（队长 2026-10-11 提名，复核员采纳收编）。

**使用建议（供后续沉淀参考，非标准）**：第 1–10 条均可写成**可执行机械检查**（比对 sha／比内容／强制口径字段／`Test-Path` 兜底／同因结论必须附隔离实验／完整性判据用 sha256 而非 mtime／对照实验先断言同构／先判 exit 再采信输出／"相同"声明强制附双侧 sha 与当点命令／**替换类操作强制断言命中**），符合"能自动化就别靠自觉"的既有原则；**是否落成技能或门禁，由 CTO 定**，复核员不越界。**（据 CTO v3 §二.6：本清单作为提案素材送 `.dsh/skills/line-audit-and-cards/SKILL.md`，走 提案→K3→CTO；本批只提案不落地。）**
> ⚠️ **给 Z8 搬运者**：本件现有 **10 条亲测**；实施员的 `PROPOSAL-skill-tool-discipline.md` 目前只收 9 条 ⇒ **第 10 条（替换类操作先证命中）尚未收进提案**，是否一并收编由 CTO/K3 定。

---

## 14. 生产库只读抽验（CTO v2 §五 口径）与口径变更记录

> 🔴 **本节只做只读读数。旧树真机库 = `D:\novis-backup-20260526\Novis\synova-agent\data\synova.db`（**禁写、禁拷进任何工作区**）。**

### 14.1 口径（CTO v2 §五 指定）
本机无 `sqlite3` CLI ⇒ 用 **`node` + `better-sqlite3`**，`new Database(path, { readonly: true, fileMustExist: true })`，只发 `PRAGMA` / `SELECT`。

### 14.2 实测读数（时点 **2026-10-11 20:54:50**）
```
OPEN = readonly OK
sqlite_version = 3.53.2
graph_triples COL COUNT = 14
graph_triples COLS = ["id:INTEGER PK","subject_type:TEXT","subject_id:TEXT","predicate:TEXT","object_type:TEXT",
 "object_id:TEXT","graph:TEXT","weight:REAL","props_json:TEXT","confidence:REAL","source:TEXT",
 "valid_from:TEXT","valid_to:TEXT","created_at:TEXT"]
has props_json = true
has props      = false
DDL = CREATE TABLE graph_triples ( id INTEGER PRIMARY KEY AUTOINCREMENT, subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL, predicate TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
      graph TEXT NOT NULL, weight REAL DEFAULT 1.0, props_json TEXT DEFAULT '{}', confidence REAL DEFAULT 1.0,
      source TEXT, valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')) )
schema_version MAX(integer) = 4
graph_triples ROW COUNT = 0
CLOSE = ok
```
**三条结论（均落在生产库上）**：
1. **`props_json` 在、`props` 不在** ⇒ 卡面 §② 的根因前提 **在生产库上实测成立**（此前只能靠被截断的仓内证据 + CTO 转述）。
2. **全 DDL 可读**（不再被 200 字符截断）⇒ **与 CTO 给的权威 14 列 DDL 及复核员夹具逐字同形** ⇒ 夹具"不臆造"再获一层独立证据（P16 收敛、见 P18）。
3. 🔴 **`schema_version MAX(integer) = 4`** ⇒ **生产库已在 v4** ⇒ **C4 从"论风险"变为"生产实况"**：任何 `version ≤ 4` 的迁移在生产上**永不执行**。
4. 附带：`graph_triples` **行数 = 0** ⇒ 佐证 C6："旧行搬运/行数不丢"**从未在真实数据上被验证**。

### 14.3 🔴 只读抽验的**副作用披露**（不许沉默）
开测前后各做一次 `data/` 目录快照（`Name / Length / LastWriteTime`），**逐字比对结果 = 不一致**：
```
synova.db       12959744  2026-10-09 03:34:59   → 未变（size/mtime 均不变）✔
synova.db-wal          0  2026-10-09 03:35:00   → 未变 ✔
synova.db-shm      32768  2026-10-09 04:35:56   → **mtime 变为 2026-10-11 20:54:50（= 探针时点）** ⚠️
新增/消失文件 = 无 ✔
```
**判定**：**数据库本体与 WAL 均未被写入**；但 **WAL 的共享内存文件 `-shm` 的 mtime 被更新** —— 最可能由 **readonly 连接 attach WAL 库**时的共享内存协调造成，**同步发生在探针时点**。
**我不能排除**旧仓同期有其它进程在跑（但 `synova.db` 与 `-wal` 均未变，故与本次读数无关）。

**🔴 队长决定性核验（2026-10-11，内容级判据）**：
```
sha256(D:\novis-backup-20260526\Novis\synova-agent\data\synova.db)
  现值 = 771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a
  基线 = 771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a  （2026-10-09 记录）
  一致 = ✅ 逐字节未变
```
**⇒ 队长裁定：不判违规。** CTO「只读，禁写」的实质是**不改库内容**；内容 sha256 逐字节未变，`-shm` 是 WAL 协调的**共享内存文件**，attach 时被映射/触碰 mtime，**不构成数据写入**。
**⇒ 口径定稿（队长）**：
> **「零改动」的正确判据是【内容 sha256】，不是 mtime。** mtime 是副作用信号，不是完整性判据。
> 若口径确实要求 **mtime 级**零改动 ⇒ 须 ① **事先豁免 `-shm`**，或 ② 用一次性快照/副本（**本卡禁止拷贝真库**）⇒ 否则"零改动"是**不可达断言**。

**⇒ 复核员处置**：**未删除旧树任何文件**（删 `-shm` 才是破坏）；读数已标时点；本条已作**队内纪律第 6 条**（见 §13）并连同读数提交 CTO（因其触及"旧仓只读"红线的操作定义）。

**（附）队长同一轮的受控对照 = 无效实验，如实记录**：队长用一次性副本做对照，但 `Copy-Item` **只拷了主库、未拷 `-wal`/`-shm`** ⇒ 副本是**新库**、无需 attach 既有 `-shm` ⇒ 实验中 `t.db-wal` / `t.db-shm` 两时点皆 **ABSENT**、`t.db` mtime 未变。**该对照与原物不同构，故不能支持或否证任何结论**；队长已自报"原因在我、不下结论"。**原始读数（原树上 mtime 确实变了）是观测事实，成立。** ⇒ 该教训成为纪律第 7 条。

**🎯 CTO v3 §二.7 裁定（2026-10-11，口径升级 — 本节以此为准）**：
- ✅ **`-shm` / `-wal` 的 mtime 豁免：准**（`.db-shm` / `.db-wal` 由 SQLite 管理，**非数据写入**）。
- 🔴 **唯一硬线 = `data/synova.db` 本体的 sha256，前后必须一致。**
  ⇒ 复核员那次 `771f0677…`（现值）= `771f0677…`（2026-10-09 基线）**已满足该硬线** ✅。
- ⇒ **本节口径就此从「零改动判据 = 内容 sha256」升级/收敛为**：
  > **唯一硬线 = `data/synova.db` 本体 sha256；`-shm`/`-wal` 的 mtime 已获 CTO 豁免。**
- 💡 CTO 并建议**下次**改用 **`immutable=1`** 或 **`mode=ro` + `PRAGMA query_only=1`**，以避免触碰 WAL 共享内存。**本次未采用该法**（读数已在硬线下合规），如实记录。
  - 🔴 **该建议的后半句有实测约束（下一位读者务必先读）**：`immutable=1` **在本环境不可用** —— better-sqlite3 **不传 `SQLITE_OPEN_URI`** ⇒ 报 `unable to open database file`（实施员实测，队长转述；**复核员未亲测**）。⇒ **实际可复现口径 = `readonly: true` + `PRAGMA query_only=1`**，并在脚本内**自测本体 sha256 前后**（实施员读数：`771f0677…` = `771f0677…`）⇒ **不要照 CTO 原句直接上 `immutable=1`**。

### 14.4 本轮口径变更记录（CTO v2 → 本件）
| 项 | 变更前 | 变更后（本件已落） |
|---|---|---|
| 基线 | 指令钉死 `07b28dfe2` | `local-main` tip `68bf57598`（§1）；**红腿已于 2026-10-11 20:55:08 在新基重跑，6 收集 / 5 失败 / 1 通过，与 §7 逐条一致 = True** |
| D8 命令 | `git diff --name-only 07b28dfe2..HEAD` | `git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD`（§2）。**复核员验证**：新形式在本 clone（HEAD == `origin/local-main`）⇒ **0 文件**；旧形式同 clone ⇒ **19 文件**（含 16 件无关）⇒ **新形式构造上不会把更早提交算作越界** |
| 写集 | 卡面 3 条 vs 派单 6 条互斥 | **以卡面为准 + CTO 扩充**（含 `schema-migration.ts`、`tests/adapters/…legacy-schema.test.ts`）；**禁 `src/adapters/**`**（§3） |
| Done④ | 待钉口径（C5） | **拆除**（拆卡）；**新增 C5′**：PR 正文须显式写「Done④ 未交付，已拆卡」，**不写即不合规** |
| Done⑤ | 判不可跑（C7） | **可跑**：node + better-sqlite3 只读（§五）⇒ **本件 §14.2 已预跑** |

---

## 15. v2 复核 —— 新 head `09240a496`（**本节为当前有效结论**；§9.2 已标注失效）

**对象（按 C9 口径写明两侧对象）**
| 项 | 值 |
|---|---|
| base | `68bf5759878a458b5e5ceb324a32878660155517` |
| **head（当前）** | `09240a496935900fdf902f25d5c5c4dcb8229cca` |
| 旧 head（已失效） | `8d99634313ed85bb91f92f800508096bd3039d0d` —— **是新 head 的祖先**（`merge-base --is-ancestor` exit=0）⇒ 5 commits、**无 force-push 重写** |
| PR 正文 | `9646 chars` ｜ `updated_at 2026-10-11T21:12:40+08:00` |
| 复核时点 | 2026-10-11 21:2x–21:3x |

### 15.1 判据判定表（全部独立重跑，不采信任何转述）
| 判据 | 结果 | 关键原始读数 |
|---|---|---|
| **C1**（Done①，验收责任 = 卡面点名件） | ✅ | 3 文件同跑 `vitest exit=0`；**`Tests 28 passed (28)`** = 验收件 6 ＋ **复核员探针 6** ＋ 004 回归 16 |
| **C2**（Done② 半修 ⇒ 必红） | ✅ 红·判别性成立 | `exit=1`；`7 failed / 5 passed`；**`datatype mismatch` ×9**；收集 12 = 期望 |
| **C3**（Done③ 摘注册 ⇒ 必红） | ✅ 红·判别性成立 | `exit=1`；`10 failed / 2 passed`；**`no such column: props` ×7**；**`datatype mismatch` = 0**（红因子与 C2 可区分） |
| **C4**（正式判据） | ✅ | `004`：`version: 5`／`name: 'graph-triples-rebuild'`；`schema-migration.ts`：`:22 SCHEMA_VERSION = 5`、`:15` import、`:47` 注册；探针 C4 用例绿；生产库 `schema_version = 4`（§14.2） |
| **C5′**（非代码判据） | ✅ **PASS（针对新 head 的正文）** | `head.sha = 09240a496…`；正文含 `## (c) C5′ — Done④ 未交付` ＋ `**Done④ 未交付 ⇒ CTO 已裁定拆卡，卡号待 CTO 补登。**`；(a)–(g) 七节齐全；`Done④ 未交付`/`CTO 已裁定拆卡`/`卡号待 CTO 补登`/`merge-base`/`e47568b663`/`46e255d554`/`+36`/`TOKEN_HITS=0`/`SCANNED_FILES=4974` **9/9 = True** |
| **C6**（加严·卡面未载） | ✅ | 复核探针 C6a（3 条 `props_json` 载荷保留）/C6b（旧 id `'1'/'2'/'3'` 以 TEXT 保留）在新 head 上 pass |
| **C7**（Done⑤） | ✅ | §14.2：14 列 / `props_json` 在 / `props` 不在 / `schema_version=4` / 边行数 0（时点 20:54:50） |
| **C8**（最高风险抽验） | ✅ 干净 | `003-orgs.test.ts` **1 个 hunk**（`@@ -62,12 +62,12 @@`）；**`:39` = `expect(orgsMigration.version).toBe(4);` 逐字未动**；**`:70` = `.toBe(5)`** |
| **C9**（最高优先级） | ✅ 自出数 | 左 `e47568b66…`（8498 B）↔ 右 `46e255d55402`（8534 B）；**hunk=1 / 删2 / 增3 / 净 +1 行 / Δ+36 B**；**变更行全在 JSDoc 内 ⇒ 代码零改动** |
| **D8**（写集） | ✅ 不越界 | **30 文件**（`merge-base` 口径）；`src/adapters/` = **0**、`scripts/audit/` = **0**、`scripts/control-tower/` = **0**；相对旧 head 仅新增 Z8 提案件 |

**复原核（造红纪律）**：C2 后 `004` blob 回 `46e255d55402…` ✓；C3 后 `schema-migration.ts` blob 回 `cc5feace6e03…` ✓；**`git diff --name-only` = 0** ✓。

### 15.2 D10 —— CI 红的**独立反证检查**（复核员自取日志，不采信转述）

**方法**：`GET /api/v1/repos/.../actions/jobs/{id}/logs`（**该端点可用**；`/actions/runs/{n}/logs` = 404）。逐 run 抓日志后计数：

| run | job | 类型 | `chat-degradation` | `stream-tool-loop` | `ReactCurrentOwner` |
|---|---|---|---|---|---|
| 317 | 331 | 绿（docs-only） | **0** | **0** | **0** |
| 315 | 329 | 绿（docs-only） | 0 | 0 | 0 |
| 313 | 327 | 绿（docs-only） | 0 | 0 | 0 |
| 305 | 319 | 绿（docs-only） | 0 | 0 | 0 |
| **319** | 333 | **本卡新 head（push）❌** | **12** | **3** | **6** |
| **281** | 295 | 另一分支（开工前）❌ | **12** | **0** | **6** |

⇒ **"找不到反例"成立** ✅：4 个绿 run 的日志里这两个文件与 `ReactCurrentOwner` **全 0 命中** ⇒ 它们**根本没跑这些用例**（`vitest --changed` 未选到）⇒ **CI 历史上不存在"跑过且绿"的对照**。

**复核员另得两条（强度高于转述版本）**：
1. **run 281 的失败用例名可与 319 逐条对齐**：281 同报 ①②③④a④b⑤ 六条 `chat-degradation` 失败，根因同为 `Cannot read properties of undefined (reading 'ReactCurrentOwner')` ⇒ **存量红坐实**；差异仅在栈行号（281 `:183` / 319 `:162`，文件版本差异）与 281 **未跑** `stream-tool-loop`（0 命中）。
2. **`stream-tool-loop:210` 的 CI 失败原因有 verbatim 证据**：319 日志原文 `line=210,column=26::AssertionError: expected '收到你的"测试错误"——我这边运作正常…' to contain '失败'` ⇒ 断言收到的是**真实 LLM 自然语言回复** ⇒ 实施员"环境依赖（CI 收到真 LLM 文本）"的归因**由我方读数直接支持**（本地两态皆绿 + CI 收到真回复）。

**另附本地独立对照（§c 同源）**：零本卡改动的基线树（`local-main @ 68bf57598`，`diff=0`，`004` 不存在）重跑同样两件 ⇒ `chat-degradation` **6 failed**、`stream-tool-loop` **6 passed**，与 HEAD **逐条一致 = True**（且复核员用的是**完整 checkout**，非 `git archive`，不受解包完整度影响）。

### 15.3 a) 与实测不一致处（新 head）
1. **"捡回源"是旧树本地分支，不在 Gitea 远端**：**受控对照**证明方法有效（已知对象 blob API **HTTP 200 / 8534 B**；左对象 **HTTP 400**）；`git fetch <sha>` 与按 ref 取均失败 ⇒ 源分支从未推送。**复核员最终从只读旧仓字节级取到左对象并自证 sha** ⇒ **可核**，但正文/claims 应写清"源 = 旧树本地分支"，勿暗示远端可达。
2. **C9 的「+1 行」是净行**：复核员自出数为 **删 2 / 增 3 / 净 +1**（一处注释由 2 行重排为 3 行）。数值不冲突，但按新口径应写清。
3. **交付件 004（157 行）与卡面 §⑤ 所指 `db7f0503f:002-…`（124 行）不同源**（交付件源为另一分支同名 004）；语义要素一致，**未发现语义退化**。
4. **改动 30 文件 vs 卡面 3 条**：全在 CTO v2 §3 白名单内 ⇒ **非越界**，仅账面一致。

### 15.4 b) 无法核实处（新 head）
1. **`immutable=1` 在本环境不可用**这一约束：**实施员实测 + 队长转述；复核员未亲测**（未再触碰真库）。
2. **Z8 提案件条目 2「等长替换」的"反例"是假设性**（"若换成等长串…"），**非本批实际发生**；实际那次（长度断言误报 `REPLACE FAILED`）记在本件 §13 第 2 条 ⇒ **不判冒充实测，但反例强度弱于本件**。
3. **`stream-tool-loop` 本地为何不收到真 LLM 回复**：未测（只测到"本地两态皆绿"与"CI 收到真回复"两端）。

### 15.5 c) 跑不通处（新 head）
1. **`/actions/runs/{n}/logs` = 404**；正确端点是 **`/actions/jobs/{id}/logs`**（200）⇒ 首探失败属**我用错端点**（与 §9.2 c-3 同族：**读错口径**）。
2. `git fetch <sha>` 直取被拒；blob API 对左对象 400 ⇒ 改走只读旧仓。
3. **造红锚点的一次失败（CRLF）**：C3 首轮 `(?m)^  graphTriplesRebuildMigration,$` **未命中** —— 工作树该行以 **`\r`** 结尾（CRLF 检出）；改 `,\r?$` 后命中。**我的断言拦住了静默空替换**（未写入，`diff=0` 已核）⇒ 与纪律第 3 条同族（**先核口径/行尾再断言**）。
4. `sqlite3` 不存在；`pnpm` 损坏（`index.js: SyntaxError`）。

### 15.6 d) 能否据此独立开工 / 决策（新 head）
1. **已独立完成**：D8（30 文件 + 三禁域零命中）、C8、C9（自出数）、C5′（新正文）、绿腿（28/28）、C2/C3 双造红、C4/C6、**D10 反证检查（自取日志）**。
2. **🔴 须 CTO 决策（不由复核员代办）**：① **DDL 属 schema 面** —— 重建会移除 `confidence` / `source` / `props_json`（交付件已自标待批；生产边表 0 行 ⇒ 无行数据风险，但**列语义取舍属 CTO**）；② **Done④ 拆卡的卡号补登**；③ **CI 步骤③ 红的合并口径** —— 存量 + 环境已证，但"是否须转绿 / 是否豁免"属**流程决策**。
3. **Z8 提案交叉核（复核员逐条）**：
   - ✅ **无冒充实测**：该件 9 条与本件 §13 第 **1–9** 条**同组**；本件第 10 条「转述·未亲测」**未被夹带**（PowerShell 吞 `$i`/`$id`、`--listFiles` 与 `2>&1` 混流两项均未出现）。
   - ✅ **我自测其条目 1 的两条 PS 5.1 声称**：`Out-File -Encoding utf8` → **`EF BB BF`（确加 BOM）**；`*>` → **`FF FE`（UTF-16LE）**（PS `5.1.26100.9444`）⇒ **实测为真**。
   - 🔴 **须补写（条目 3）**：其"原因"写成"末行换行 / BOM / CRLF 切分"，**漏掉本批实测主因** —— UTF-8 内容按 ANSI/CP936 解码时**高字节吞 `0x0A`**；次因才是 `Measure-Object -Line` **不计空元素**。照此条实施会**往错方向排查**（见 §12.6）。
   - 🔴 **须补写（条目 6）**：其写"只读读数**优先 `immutable=1`**"，但本环境该法**不可用**（见 §14.3 补注）⇒ 应改为"**本环境实测不可用；实际口径 = `readonly: true` + `PRAGMA query_only=1`**"。
4. **复核员的结论（依职责用语）**：**`自验结论`：新 head `09240a496` 上全部可执行判据（C1 / C2 / C3 / C4 / C5′ / C6 / C7 / C8 / C9 ＋ D8）均通过复核员独立重跑；未发现与判据冲突之处 ⇒ `可提请独立审计`。** ⚠️ **"通过与否"归 CTO 收件闸 ＋ K3 终审**；本节不含审计结论，亦不替代 15.6-2 的三项 CTO 决策。

---

*本件 v1.8 由独立复核员 `k4-04-verify` 撰写。内容不得由实施员编辑；实施员仅承担搬运与提交。*
