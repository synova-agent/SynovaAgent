# K4 批 3 · #1412（= 板卡 #66）**现状核验**——「守卫收口」已落地形态 vs 工作令 §四⑥

> **核验人**：impl-c（K4 批 3 · L3 线）｜ **核验时点**：2026-10-12（+08:00）
> **读数时点**：工作树 `D:\k4b3-l3-65` HEAD = `ba1b22a8b5ff75833704bac22fcfcb47295dc970`（分支 `k4b3/l3-65`）
> **diff 左端**：`ba1b22a8b5`（每条读数都给「时点 × 左端」，禁只给一个）
> **本件性质**：**只核验、不实施**。🔴 **本件不改任何 `src/` 文件**（见 §五 自证）。
> **纪律**：所有数字取自命令原始输出，未手写；引用用**稳定锚点**（路径 + 可 grep 唯一串），行号只作辅助。

---

## 〇、B4 声明：工作令 §四⑥ **原件不在本仓**（复核员须知）

| 项 | 实测 | 命令 | 输出 |
|---|---|---|---|
| 工作令 §四⑥ 原文 | ❌ **仓内零命中** | `git grep -l "四⑥"` | 零命中（exit 1） |
| 「第二收口点」串 | 仅 **1** 命中，**且不是工作令** | `git grep -l "第二收口点"` | `docs/synova/coordination/issue-number-mapping.md` |
| 仓内可引**代理** | ✅ issue 标题即需求陈述 | 该文件唯一串 | `\| #66 \| [#1412] 守卫收口：engine-context 第二收口点 + 2 自建 store \| #1412 \| a（标题前缀 `#1412`） \|` |

⇒ **本件所有"工作令要求"的引述，仓内可核代理 = 上表 issue 标题行**；
**"§四⑥"这一节号本身在仓内不可核**（原件在 CTO 会话/库外档案）。
**复核边界**：复核员可以核「落地件与 issue 标题所述需求」的差异，**不能**核「§四⑥ 全文逐字」。
（此局限按纪律显式登记，不当作已满足。）

---

## 一、#66 现状实测（三条：合入 commit / PR 号 / 写集全列）

### 1.1 合入既有向（首件事实：**已在 base 祖先链上**）

```
$ git merge-base --is-ancestor 1ab0cbb33 ba1b22a8b5 ; echo $?
0
```

### 1.2 合入 commit（原始输出）

```
$ git log -1 --format="%H%n%P%n%an%n%ad%n%s" 1ab0cbb33
1ab0cbb331702fdac21ee3a2ec68127793d6a869
8363b72813b0df2cd4e3225a1ba9c009f2433ef4 e459c02eb01341c7e55a30ead128f36adffbf72c
win-push
Mon Oct 12 03:22:34 2026 +0800
Merge PR #392: fix(#1412 (C) 案) 适配器默认带守卫 + 显式 opt-out
```

**PR 号 = #392**（取自 merge 标题，非转述）。

### 1.3 功能 commit（两个 SH、同标题同时间戳）

```
$ git log -1 --format="%H | %ad | %s" d180632d6
d180632d66365081789d223b2b638a669535f321 | Thu Oct 8 10:46:33 2026 +0800 | feat(#1412): 守卫收口补全 —— 适配器默认带守卫（(C) 案）+ 显式 opt-out

$ git log -1 --format="%H | %ad | %s" d87b1ce3b
d87b1ce3b3655c2858239674b796616408281e6e | Thu Oct 8 10:46:33 2026 +0800 | feat(#1412): 守卫收口补全 —— 适配器默认带守卫（(C) 案）+ 显式 opt-out
```

### 1.4 写集全列（`git diff --name-only 1ab0cbb33^1 1ab0cbb33`，原文不摘要）

```
.claude/claims/1412.yaml
.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md
src/adapters/sqlite-graph-store.ts
tests/adapters/standard-key-guard.test.ts
tests/agent/write-side-axis-alignment.test.ts
```

**共 5 条**。与 `.claude/claims/1412.yaml` 的 `writeset:` 声明**逐条一致**（该声明件同 PR 落地 ⇒ D708 的 S0 源不悬空）。
**🔴 关键**：写集里**没有** `src/init/engine-context.ts`，也**没有** `src/ingest/index.ts` —— 与工作令 §四⑥ 点名的两个落点**零交集**（差异见 §二）。

### 1.5 落地形态实测（守卫在适配器**默认开**）

```
$ git grep -n "standardKeyGuard\|wrapStandardKeyGuard\|_insertNodeRaw" -- src/adapters/sqlite-graph-store.ts
src/adapters/sqlite-graph-store.ts:20:import { wrapStandardKeyGuard } from "./standard-key-guard";   // #1412 (C)：默认守卫（复用，不造第二套）
src/adapters/sqlite-graph-store.ts:109:  standardKeyGuard?: boolean;
src/adapters/sqlite-graph-store.ts:115:  private standardKeyGuardEnabled: boolean;
src/adapters/sqlite-graph-store.ts:120:    this.standardKeyGuardEnabled = options?.standardKeyGuard !== false;
src/adapters/sqlite-graph-store.ts:158:    if (this.standardKeyGuardEnabled) {
src/adapters/sqlite-graph-store.ts:160:        this.guardedCreateNode = wrapStandardKeyGuard({
src/adapters/sqlite-graph-store.ts:161:          createNode: (t, p, g) => this._insertNodeRaw(t, p, g),
src/adapters/sqlite-graph-store.ts:168:    return this._insertNodeRaw(type, props, graph);
src/adapters/sqlite-graph-store.ts:172:  private _insertNodeRaw(
```

**判别串 = `this.standardKeyGuardEnabled = options?.standardKeyGuard !== false;`**
⇒ 语义 = **不传选项 = 守卫开**（`!== false`，不是 `=== true`）⇒ **新增构造点自动覆盖**。
守卫**复用**共享实现（`wrapStandardKeyGuard`），**未造第二套逻辑**。

**生产侧 opt-out = 0**（原始输出为空）：

```
$ git grep -n "standardKeyGuard: false" -- src/ ; echo "exit=$?"
exit=1          # 零命中
```

**测试侧 opt-out = 4 行 / 2 文件**（`tests/adapters/standard-key-guard.test.ts` 3 行 ＋ `tests/agent/write-side-axis-alignment.test.ts` 2 处调用点中的 2 行——逐行输出见 §三.3）。

### 1.6 `src/init/engine-context.ts` 是否构造 store（**工作令点名的第二收口点**）

```
$ git grep -n "SqliteGraphStore\|new .*Store(" -- src/init/engine-context.ts ; echo "exit=$?"
exit=1          # 零命中
```

**该文件确实不构造任何 store**。它实际做的事（同文件内可核锚点）：

- 唯一串 `db = new Database(config.dbPath);` ⇒ 只**建 SQLite 连接**
- 唯一串 `export function getDatabase(): Database.Database {` ⇒ 只**导出连接**
- 唯一串 `export function initEngineContext(): void {` ⇒ 建表/WAL/迁移

⇒ **"engine-context 第二收口点"在物理上不成立**（不是"没做"，是**收口对象不存在**）。
此点由 `.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md` 自陈为**实测量推翻 CTO 原裁定**：
其唯一串 `卡面前提更正` 行原文：`🔴 **卡面前提更正**：src/init/engine-context.ts **只建 db**（:50,66）**不构造 store** ⇒ **不是收口点**（CTO 原裁定被实测推翻）`。

---

## 二、与工作令 §四⑥ 要求路径的差异（逐条）

| # | 维度 | 工作令 §四⑥（据 issue 标题 ＋ 派单件转述） | **已落地件（实测）** | 差异性质 |
|---|---|---|---|---|
| D1 | **收口点位置** | `src/init/engine-context.ts`（**第二收口点**） | `src/adapters/sqlite-graph-store.ts`（**适配器层**） | 🔴 **对象层不同**：前者**不构造 store**（§1.6 实测）⇒ 该指定点在物理上不可做 |
| D2 | **手段** | **枚举 + 逐个修**：`src/ingest/index.ts` 的 **2 处自建 store** | **改默认行为**：构造函数默认带守卫，**不枚举任何点** | 🟠 **策略反转**（CTO 2026-10-08 裁 **(C) 案**）；派单件自陈理由唯一串 `"不手写清单"的极致形态 = 改默认行为`（清单会漂；默认不会） |
| D3 | **对 `src/ingest/index.ts` 的动作** | 要求改该文件 | **零改动**（它**不在** 5 条写集里） | 🟢 不是漏做：`src/ingest/index.ts` 的构造点**被默认行为自动覆盖**（实测该处为 `new SqliteGraphStore(db)`，**不传选项**） |
| D4 | **覆盖面** | 显式点名的 2 处 | **全部 13 个非注释构造点 / 12 个文件**（实测，见 §三.1） | 🟢 **更宽**；且对**未来新增**构造点自动生效（实证：`src/tui-v2/chat.tsx` 的构造点由 `89d043f6a feat(D286): GraphStore 统一` 引入，**当时不在任何枚举清单里**，今天仍被默认行为覆盖） |
| D5 | **新增的可审计面** | 无（工作令未提 opt-out） | `SqliteGraphStoreOptions.standardKeyGuard`（**显式 opt-out**，可 grep ⇒ 可审计"谁关了守卫"） | 🟠 **新增面**：带来一条**新判据**（生产路径零 opt-out），实测已成立（§1.5） |

**归纳一句**：工作令 §四⑥ 与落地件**不是"做了 vs 没做"**，而是**"点名的两个落点，一个不存在、一个被更宽的解覆盖"**。

---

## 三、工作令 §四⑥ **剩余面是否仍成立**（实测）

### 3.1 全量构造点（原始输出，非注释行）

```
$ git grep -n "new SqliteGraphStore(" -- src/          # 原始命中 14 条；其中 1 条是注释行
$ （去掉注释行后）13 条 / 12 个文件：
src/agent/conversation-engine.ts:455
src/agent/graph-store-service.ts:27
src/agent/loop-handlers.ts:71
src/agent/sentinel-service.ts:300
src/agent/synova-agent.ts:147
src/deploy/bootstrap.ts:890
src/deploy/bootstrap.ts:1279
src/ingest/index.ts:35
src/l3/knowledge-agent.ts:238
src/mcp/tool-registration.ts:108
src/routes/chat.ts:51
src/sentinel/runner.ts:1446
src/tui-v2/chat.tsx:58
```

**口径声明**：
- **计数口径 A（grep 命中行）** = **14**（含 `src/agent/graph-store-service.ts` 内 1 行**注释**，唯一串 `与修复前 L1 直构`）
- **计数口径 B（非注释构造点，本件采用）** = **13 处 / 12 文件**
- **与落地件简报的差异**：`.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md` 唯一串 `13 处 / 11 文件` 记的是 **11 文件**；**现测 12 文件**，多出 `src/tui-v2/chat.tsx`。经查该构造点由 `89d043f6a feat(D286): GraphStore 统一` 引入（早于本卡），**属简报计数口径差异（列了 11 个文件名 vs 实际 12 个），不是本卡引入的新点**。

### 3.2 是否有绕过适配器的**其它写入路径**（这才是 §四⑥ 的真剩余面候选）

```
$ git grep -n "INSERT INTO graph_nodes" -- src/ packages/
packages/_archived/graph-store/src/graph-store.ts:189
packages/_archived/graph-store/src/graph-store.ts:202
src/adapters/sqlite-graph-store.ts:98        # 注释
src/adapters/sqlite-graph-store.ts:182       # 真实现（守卫已包在 createNode 外层）
```

**候选 = `packages/_archived/graph-store/`（归档包，自带裸 INSERT，无守卫）**。实测它**不可达**：

```
$ git grep -n "@synova/graph-store" -- src/ tests/ tsconfig.json vitest.config.ts ; echo "exit=$?"
exit=1          # 零命中

$ git grep -n "_archived" -- tsconfig.json tsconfig*.json vitest.config.ts package.json ; echo "exit=$?"
exit=1          # 零命中
```

⇒ 与归档件自陈一致（唯一串 `不再被构建系统收集`，`packages/_archived/graph-store/ARCHIVED.md`）：
**无 npm workspaces 收集、tsconfig paths 与 vitest alias 映射已删** ⇒ **不是活的写入路径**（归档 ≠ 绕过）。

### 3.3 是否仍有"未走守卫"的生产写路径

守卫包在 `createNode` 外层；**生产侧 `standardKeyGuard: false` = 0**（§1.5，exit 1）。
测试侧（唯一串计数，逐行）：

```
$ git grep -n "standardKeyGuard: false" -- tests/
tests/adapters/standard-key-guard.test.ts:18
tests/adapters/standard-key-guard.test.ts:19
tests/adapters/standard-key-guard.test.ts:78
tests/adapters/standard-key-guard.test.ts:97       # ← 该行是**判据自身**（grep src/ 断言零命中）
tests/agent/write-side-axis-alignment.test.ts:60
tests/agent/write-side-axis-alignment.test.ts:80
```

**共 6 行 / 2 文件**（其中 `:97` 是**形态扫描判据的实现行**，不是 opt-out 调用点 ⇒ **真实 opt-out 调用点 = 5 行**）。
⇒ 与 `.claude/claims/1412.yaml` 的自陈一致（唯一串 `测试侧 2 个显式 opt-out`）。

### 3.4 结论：§四⑥ 剩余面**是否仍成立**

| §四⑥ 子项 | 剩余面是否成立 | 依据 |
|---|---|---|
| 「`src/init/engine-context.ts` 第二收口点」 | ❌ **不成立**（收口对象不存在） | §1.6 实测 `git grep "SqliteGraphStore" -- src/init/engine-context.ts` exit 1 |
| 「`src/ingest/index.ts` 2 处自建 store」 | ⚠️ **字面已消失，实质已覆盖** | ① 实测该文件构造点 = **1 处**（唯一串 `src/ingest/index.ts:35: const store = new SqliteGraphStore(db);`），**不是 2 处**；② 该处**不传选项** ⇒ 默认守卫已生效 |
| 「守卫覆盖所有 store 构造点」 | ✅ **成立且更强**（默认行为 ⇒ 含未来新增点） | §1.5 判别串 `!== false`；§3.1 13/13 点均不传 opt-out |
| 「生产路径无未守卫写」 | ✅ 成立 | §3.2 归档包不可达（两条 grep 均 exit 1）；§3.3 生产 opt-out = 0 |

⇒ **工作令 §四⑥ 的"点名落点"剩余面 = 0**；**其"目标语义"剩余面 = 0 且超额达成**。

### 3.5 若仍要开卡：**一条可核对的开卡建议**（只给建议，不自行开卡）

> ⚠️ 下面**不是**"§四⑥ 剩余面"，而是**核验中发现的、与本卡相邻但在本卡范围外的两个可核对缺口**。
> 是否开卡由 CTO 定；本件只登记。

**建议候选 S-1（计数口径漂移，低优先）**：落地件简报写 `13 处 / 11 文件`，实测为 `13 处 / 12 文件`。
- 可核判据：`git grep -l "new SqliteGraphStore(" -- src/ | sort -u` ⇒ 12 行；去注释后站点 13。
- 归属：`.claude/task-briefs/2026-10-08-1412-adapter-default-guard.md` 系**已合入卡的卡面**，改它 =
  改历史卡面 ⇒ 属 CTO 域。**建议**：不改历史件，只在**下一次同类卡的判据里钉"口径 A / 口径 B"二词**
  （本件 §3.1 即示范）。

**建议候选 S-2（opt-out 的"形态判据"杠杆，中优先）**：现有 V4-new 判据是
`tests/adapters/standard-key-guard.test.ts:97` 的 **shell 型 `grep` 扫描**（唯一串 `grep -rn 'standardKeyGuard: false' src/`）。
- **分辨率边界（它测不出什么）**：它只抓**字面串** `standardKeyGuard: false`。
  ① 抓不到 `standardKeyGuard: someVar`（变量取值）、② 抓不到**绕过构造参数**的其它关守卫写法
  （如直接调 `_insertNodeRaw` —— 它是 `private`，TS 层挡住，但 `(store as any)[...]` 类逃逸抓不到）、
  ③ 在 Windows 上依赖 `grep` 存在（`execSync` 内）。
- 可核判据（若开卡）：把该判据升级为**TS 层扫描**（读文件 + 正则 + 显式列出"已核例外"），
  并给"删掉即报红"的判别性夹具。
- 归属：`tests/adapters/**` 属**已合入卡的写集**；新一轮改动 = 新卡。

---

## 四、口径与局限（**它测不出什么**——逐条写明）

| 本件**能**判 | 本件**测不出** |
|---|---|
| 落地件与 issue 标题所述需求的**路径差异** | 🔴 **§四⑥ 全文逐字**（原件不在本仓，见 §〇） |
| 守卫**在适配器层默认开**（判别串可 grep） | 🔴 **运行期真的每次都走守卫**（本件只做静态形态；未跑 `tests/adapters/standard-key-guard.test.ts`） |
| 生产侧 `standardKeyGuard: false` **字面零命中** | 🔴 **变量式/逃逸式关守卫**（见 §3.5 S-2 的 3 条分辨率盲区） |
| 归档包 `graph_nodes` INSERT **不可达**（构建面两条 grep exit 1） | 🔴 **运行时通过 `require` 直读归档文件**的可能性（未见调用方；但未做全运行期插桩） |
| 构造点计数 **13 处 / 12 文件** | 🔴 依赖 tsx/动态 `import()` 的**间接构造**（本件只扫 `new SqliteGraphStore(` 字面） |
| 「2 处自建 store」实为 **1 处** | 🔴 该"2 处"是否指**另一个版本/另一个文件**（§〇 原件不可核） |

**级别声明**：
| 级别 | 本件是否声称 |
|---|---|
| L1-静态可达（grep/文件/字段存在） | ✅ 成立 |
| L2-装载穿透（真跑生产入口断言） | ❌ **不声称**（本件**故意不跑** vitest —— 属重型验证，须串行；由自验员承担） |
| L3/L4 | ❌ 不声称 |
| 「守卫已被业务消费」 | ❌ 不声称（本件只核"写入侧是否经守卫"的形态，未核消费侧） |

---

## 五、自证：本件**未改任何 `src/`**（**提交后复跑**，原始输出）

**读数时点**：`97d65978543a153b78db7dd78ad9e9380d7fd22c`（本段提交）｜ **diff 左端**：`ba1b22a8b5`

```
$ git diff --stat ba1b22a8b5..HEAD
 .claude/claims/1350.yaml                           |  37 ++
 ...270\216\350\256\241\345\210\222\350\276\271.md" | 562 +++++++++++++++++++++
 .../evidence/K4-b3-1412-status-recheck.md          | 327 ++++++++++++
 3 files changed, 926 insertions(+)
```

```
$ git diff --name-only ba1b22a8b5..HEAD
.claude/claims/1350.yaml
".claude/task-briefs/2026-10-11-1350-K4-05bis-\350\276\271\350\257\215\350\241\250-\347\233\256\346\240\207\345\261\202\347\272\247\350\276\271\344\270\216\350\256\241\345\210\222\350\276\271.md"
docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md
```

**共 3 条**（`git diff --name-only ba1b22a8b5..HEAD | wc -l` ⇒ `3`）。

**判别性判据（判「不改 src/」）**：

```
$ git diff --name-only ba1b22a8b5..HEAD | grep -c "^src/" || true
0
$ echo "exit=$?"
exit=0
```

⇒ **`src/` 前缀命中 = 0** ⇒ 本件与其同批产物**未改任何 `src/`**。（本判据**测不出**：未提交的工作树改动 ——
故另跑 `git status --porcelain=v1`，本件相关文件之外为空；该判据在**提交前**跑，输出见交付回执。）

**写集声明（本件落点）**：`docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md`（**单件**）。
同批另两件 = `.claude/claims/1350.yaml` ＋ `.claude/task-briefs/2026-10-11-1350-K4-05bis-…md`（#65 A 段卡面）。

---

## 六、复跑命令清单（独立审计可直接重放）

```bash
# 工作树（Windows）：D:\k4b3-l3-65
WT="/d/k4b3-l3-65"; cd "$WT"

# 1) 合入链
git merge-base --is-ancestor 1ab0cbb33 ba1b22a8b5 ; echo "ancestor_exit=$?"
git log -1 --format="%H%n%P%n%an%n%ad%n%s" 1ab0cbb33
git diff --name-only 1ab0cbb33^1 1ab0cbb33

# 2) 落地形态
git grep -n "standardKeyGuard" -- src/adapters/sqlite-graph-store.ts
git grep -n "standardKeyGuard: false" -- src/    ; echo "prod_optout_exit=$?"
git grep -n "standardKeyGuard: false" -- tests/  ; echo "test_optout_exit=$?"

# 3) 工作令点名落点的物理性
git grep -n "SqliteGraphStore" -- src/init/engine-context.ts ; echo "engine_ctx_exit=$?"
git grep -n "new SqliteGraphStore(" -- src/ingest/index.ts

# 4) 全量构造点（口径 A = 含注释行 / 口径 B = 去注释行）
git grep -n "new SqliteGraphStore(" -- src/ | wc -l
git grep -n "new SqliteGraphStore(" -- src/ | grep -v ':[[:space:]]*\*'

# 5) 归档包可达性
git grep -n "@synova/graph-store" -- src/ tests/ tsconfig.json vitest.config.ts ; echo "pkg_exit=$?"
git grep -n "_archived" -- tsconfig.json vitest.config.ts package.json               ; echo "arch_exit=$?"

# 6) 来源不可核项（预期零命中）
git grep -l "四⑥" ; echo "four6_exit=$?"
```

---

## 七、未决项与归属

| # | 未决项 | 归属 | 阻塞性 |
|---|---|---|---|
| U-1 | **§四⑥ 全文原件不在本仓** ⇒ 复核员只能比 issue 标题 + 派单件转述 | **队长 → CTO**（是否把工作令入库） | ⚠️ 限制本件可核面上限（已在 §〇 显式声明，**不假装满足**） |
| U-2 | 「`src/ingest/index.ts` **2 处**自建 store」与实测 **1 处** 不符（`git grep "new SqliteGraphStore(" -- src/ingest/index.ts` 唯一命中 `:35`） | **队长 → CTO** | ❌ 不阻塞（已覆盖：该处不传选项 ⇒ 默认守卫生效） |
| U-3 | 落地件简报记 `11 文件`，实测 **12 文件**（多 `src/tui-v2/chat.tsx`） | **队长 → CTO**（改历史卡面属 CTO 域） | ❌ 不阻塞（见 §3.5 S-1） |
| U-4 | V4-new opt-out 判据为 **shell grep 形态扫描**，有 3 条分辨率盲区 | **队长 → CTO**（是否开 S-2 卡） | ❌ 不阻塞 |
| U-5 | `packages/_archived/graph-store/` 自带裸 `graph_nodes` INSERT，**归档但仍在仓** | **队长 → CTO**（是否物理删除） | ❌ 不阻塞（构建面不可达，实测两条 grep exit 1） |

---

## 八、自检 5 问

1. **接线检查**：本件**不新增任何 export**（纯文档件）⇒ 无接线面。
2. **异常处理**：本件**不含任何 catch**（纯文档件）。
3. **类型安全**：本件**不含 TS 代码** ⇒ `as any` / `as never` / `as unknown as` 均为 0。
4. **测试质量**：本件**不新增测试**（未实施任何代码）；**`src/`/`tests/` 零改动**可由 §五 的 `git diff` 集合直接判。
5. **残留清理**：本件**未删任何东西**；所有读数均为**只读** git 命令（`log` / `grep` / `diff` / `merge-base` / `ls-tree`）。

---

**一句话自验结论**：**本件与实测一致**（`可提请独立审计`）；
边界 = **只核静态形态，未跑任何测试、未改任何 `src/`**；**工作令 §四⑥ 点名落点的剩余面 = 0**（一个对象不存在、一个被"默认行为"覆盖并超额达成）。
