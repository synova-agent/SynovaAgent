# K4-b3-VERIFY-1412 — 独立复核：#66（= issue #1412）现状核验件

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：分支 `k4b3/l3-65`，`git ls-remote` 实测 tip = `afa582cd8034309b2866e1a5c6086f2bbf819d15`
> **diff 左端**：`ba1b22a8b5`（读数全部在**该 SHA 上**取，不在工作树取）
> **被审件**：`docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md`（提交 `97d659785` 引入，`afa582cd8` 追加 §五自证）
> **队内用语**：本件只给「自验结论」，不写「审计通过」；通过与否归 CTO 收件闸 + K3 终审。

---

## 〇、对象与字节（先证明"我审的就是它"）

```
$ git ls-remote --heads origin | grep k4b3/l3-65
afa582cd8034309b2866e1a5c6086f2bbf819d15	refs/heads/k4b3/l3-65

$ git -c core.quotepath=false diff --name-only ba1b22a8b5..afa582cd8   （共 3 条）
.claude/claims/1350.yaml
.claude/task-briefs/2026-10-11-1350-K4-05bis-边词表-目标层级边与计划边.md
docs/synova/product-lines/evidence/K4-b3-1412-status-recheck.md
```

**独立 SHA-1 比对（逐 blob `git cat-file -p` 导出后自算，非 `git hash-object`）**：3/3 一致；三件 **BOM = none**。
⇒ 写集**逐条等于** impl-c 声明的 3 条，**零越界**（无 `src/`、无 `extensions/`）。

---

## 一、结论：**可提请独立审计**，附 **2 处必改 + 1 条口径**

优点先说（复核为真，逐条见 §二）：三节结构完整、口径名齐、**"测不出什么"逐条自陈**、级别声明（L1 成立 / L2 不声称）**克制且诚实**、把"§四⑥ 原件不在仓"当作**限制**而非**已满足**——这几点按纪律是对的。

但有两处**计数/逐字**不准，一处**自陈过宽**。

### a-1（必改）`tests/` 侧 `standardKeyGuard: false` 命中数：件里写 **6 行**，实测 **7 行 / 2 文件**

件 §3.3 原文：「**共 6 行 / 2 文件**（其中 `:97` 是形态扫描判据的实现行…⇒ 真实 opt-out 调用点 = 5 行）」。

我的独立实测（`git grep -n "standardKeyGuard: false" ba1b22a8b5 -- tests/`，原文全列）：
```
tests/adapters/standard-key-guard.test.ts:18:  const raw = new SqliteGraphStore(db, { standardKeyGuard: false });
tests/adapters/standard-key-guard.test.ts:19:  const guarded = wrapStandardKeyGuard(new SqliteGraphStore(db, { standardKeyGuard: false }));
tests/adapters/standard-key-guard.test.ts:78:    const store = new SqliteGraphStore(db, { standardKeyGuard: false });
tests/adapters/standard-key-guard.test.ts:94:  it('🔴 V4-new【形态扫描·只证明形态】**生产路径没有 opt-out**（`src/**` 里 `standardKeyGuard: false` 必须为零）', () => {
tests/adapters/standard-key-guard.test.ts:97:    const raw = execSync("grep -rn 'standardKeyGuard: false' src/ --include='*.ts' || true", { encoding: 'utf-8' }).trim();
tests/agent/write-side-axis-alignment.test.ts:60:    const store = new SqliteGraphStore(db, { standardKeyGuard: false })   // #1412 (C)：本用例需"裸语义"…;
tests/agent/write-side-axis-alignment.test.ts:80:    const store = new SqliteGraphStore(db, { standardKeyGuard: false })   // #1412 (C)：本用例需"裸语义"…;
```
- **命中 = 7 行 / 2 文件**（件里 6）。漏的是 **`:94`** —— 该行是 **`it(...)` 测试标题**，其中的字面串被 grep 计入。
- 件的**实质结论仍成立**：真实 opt-out **构造调用点 = 5 行**（`:18/:19/:78` ＋ `:60/:80`），与 `.claude/claims/1412.yaml` 自陈「测试侧 2 个显式 opt-out」一致。
- **附带增益（建议并入 S-2）**：这恰好给「shell grep 形态判据」添了**第 4 条分辨率盲区** —— 该判据统计的是**字面串出现行数**，**字符串/标题/注释里的同名串会污染计数**（`:94` 即实证）。件 §3.5 S-2 只列了 3 条盲区（变量取值、绕过构造参数、Windows 依赖 grep），本条可补为第 4 条。
- **归属**：impl-c / 卡 #1350 A 段（该核验件）§3.3；处置 = 改数并补盲区第 4 条。

### a-2（必改）两个功能 commit 的 subject **不是逐字原文**

件 §1.3 以「原始输出」块给出：
```
d180632d66365081789d223b2b638a669535f321 | Thu Oct 8 10:46:33 2026 +0800 | feat(#1412): 守卫收口补全 —— 适配器默认带守卫（(C) 案）+ 显式 opt-out
```
我的独立实测（`git log -1 --format='%H | %ad | %s'`）：
```
d180632d66365081789d223b2b638a669535f321 | Thu Oct 8 10:46:33 2026 +0800 | feat(#1412): 守卫收口补全 —— 适配器**默认带守卫**（(C) 案）+ 显式 opt-out
d87b1ce3b3655c2858239674b796616408281e6e | Thu Oct 8 10:46:33 2026 +0800 | feat(#1412): 守卫收口补全 —— 适配器**默认带守卫**（(C) 案）+ 显式 opt-out
```
⇒ 两处 `**默认带守卫**` 的 markdown 加粗标记被脱去，**"原始输出"块非逐字**（哈希、时间戳、语义均无误）。
**归属**：impl-c / 同件 §1.3；处置 = 补回 `**`（纪律：标"原始输出"即须逐字）。

### a-3（口径）「零代码零测试 ⇒ 不可造红」**过宽**

件 §七/交付回执自陈 A 段「不可造红」。**实测：该段并非无可执行判据**——`.claude/claims/1350.yaml` 的 `done:` 给了 **6 条可跑命令**，我逐条实跑：
```
#3  git merge-base --is-ancestor 0b0601fac ba1b22a8b5 / 1ab0cbb33 → 0 / 0  ⇒ BOTH_ANCESTOR   ✅ 与件声明一致
#4  brief 六字段计数 = 6      ✅
#5  '#CRITERIA: B' 计数 = 1  ✅
#1  git diff --name-only ba1b22a8b5..afa582cd8 | grep -c '^src/' = 0   ✅
#6  禁入项（1134 / 1031 两测试件）命中 = 0   ✅
#2  edge-types 计数 = 56     ✅
```
**判别力分层（这才是"能不能造红"的答案）**：
| 判据 | 对本段是否有判别力 | 依据 |
|---|---|---|
| #1 `src/ 前缀 = 0` | ✅ **可造红** | 反证：同一条 grep 打 `1ab0cbb33^1..1ab0cbb33` → **1**（该区间真改了 src/）⇒ 非恒真 |
| #4 六字段 = 6 | ✅ 可造红 | 删任一 `## Qx:` 即变 5 |
| #5 `#CRITERIA: B` = 1 | ✅ 可造红 | 删该行即 0 |
| #2 edge-types = 56 | ⚠️ **恒真** | 断的是 **base** 的目录计数，不随本段产物变化 |
| #3 BOTH_ANCESTOR | ⚠️ **恒真** | 同上，断 base 的祖先链 |
| #6 禁入项 = 0 | ⚠️ 恒真（除非有人误加） | 本段不含这两件 ⇒ 结构性恒真 |
⇒ 正确表述 =「**本段无行为可验（无代码/无测试）；但 claim 的 6 条判据可执行，其中 3 条对本段有判别力、3 条只是基线断言（恒真风险，不得当作本段成果）**」。
**归属**：impl-c / 卡 #1350 A 段自陈；处置 = 按上表改写"不可造红"一句（**不需要**真去造红，但不得把它写成"无可执行判据"）。

---

## 二、复核为**真**的项（逐条附命令，可直接引用）

| # | 件中声明 | 我的独立实测 |
|---|---|---|
| 1 | §1.1 `1ab0cbb33` 是 `ba1b22a8b5` 祖先 | `git merge-base --is-ancestor` → **exit 0** ✅ |
| 2 | §1.2 merge commit = `1ab0cbb331702fdac21ee3a2ec68127793d6a869`，标题含 `Merge PR #392` | **逐字一致** ✅ |
| 3 | §1.4 写集 = 5 条 | `git diff --name-only 1ab0cbb33^1 1ab0cbb33` → **5 条逐字一致** ✅ |
| 4 | §1.5 判别串 = `this.standardKeyGuardEnabled = options?.standardKeyGuard !== false;` | `git grep -n standardKeyGuard -- src/adapters/sqlite-graph-store.ts` → L120 **逐字一致** ✅ |
| 5 | §1.5 生产侧 opt-out = 0 | `git grep -n "standardKeyGuard: false" ba1b22a8b5 -- src/` → 无输出 **exit 1** ✅ |
| 6 | §1.6 `engine-context` 不构造 store | `git grep -n -E "SqliteGraphStore\|new .*Store\(" ba1b22a8b5 -- src/init/engine-context.ts` → **exit 1** ✅ |
| 7 | §3.1 构造点 = 口径A 14 行 / 口径B 13 处 / 12 文件 | 实测 **14 / 13 / 12** ✅（注释行 = `src/agent/graph-store-service.ts:10`） |
| 8 | §3.2 `INSERT INTO graph_nodes` 4 处（2 归档 + 1 注释 + 1 真实现） | 实测 4 处，逐处一致 ✅ |
| 9 | §3.2 归档包不可达 | `@synova/graph-store` 与 `_archived` 两条 grep → **exit 1 / exit 1** ✅ |
| 10 | §〇 `四⑥` 在仓内零命中 | `git grep -l "四⑥"` → 无输出 **exit 1** ✅ |
| 11 | §〇 `第二收口点` 仅 1 命中 | 命中 `docs/synova/coordination/issue-number-mapping.md` **1 处** ✅ |
| 12 | §3.4 「`src/ingest/index.ts` 实测 1 处（非 2 处）」 | `git grep -n -E "new SqliteGraphStore\(" ba1b22a8b5 -- src/ingest/index.ts` → **唯一命中 `:35`** ✅ |
| 13 | §五 自证「本件不改任何 `src/`」 | `git diff --name-only ba1b22a8b5..afa582cd8` 中 `^src/` = **0** ✅ |

### 绿腿告警归因复核（队长点名项）：**结论采纳，但证据比件里的更强**

impl-c 判「CC1–CC4 新增 493 条**非本段引入**」，理由是"本段 diff 无 `extensions/` 条目"。**该归因成立**，我给两条更硬的证据：

**证据 A（扫描面逐字节相同）** —— 门禁 `scripts/check-content-coupling.sh` 的扫描面 = `extensions/**` ＋ `src/**`：
```
$ git ls-tree -r ba1b22a8b5 -- extensions/ src/ | sha256   → B8E97DD690F0D26B2B5C83A250C4769CB952049FBF4B3F404A88D8543D9AB854
$ git ls-tree -r afa582cd8  -- extensions/ src/ | sha256   → B8E97DD690F0D26B2B5C83A250C4769CB952049FBF4B3F404A88D8543D9AB854
逐字节相同 = True   条目数 = 1215 / 1215
$ git log --all 全树差异 = 恰好 3 行（= 本段 3 件）
```
⇒ **门禁输入集在本段前后完全不变** ⇒ 其输出在数学上不可能由本段引入。

**证据 B（在 base 上实跑该门禁）** —— 我的工作树 `D:\k4b3-verify` **就在 base**（`HEAD == ba1b22a8b5`，且**不含**本段 3 件），直接运行该门禁：
```
$ bash scripts/check-content-coupling.sh
CC1 方向: extensions 越界 import —— 违规 118 文件 / 160 type ＋ 236 值（棘轮内 396｜新增 396）
CC2 对称: src 从 extensions 取 type/值 —— 违规 2 文件 / 96 type ＋ 1 值（棘轮内 97｜新增 97）
CC3 可达: 违规 0 ｜ CC4 结构: 违规 0
汇总: 存量 493 条（棘轮内）｜新增 493 条｜基线待下调 87 条
CONTENT-COUPLING: 新增 493（local 只报数不判红｜存量 493 条在棘轮内｜CI 上同一条会硬阻断）
```
⇒ **base 上就报 `新增 493`** ⇒ 与 impl-c 的判断一致，**且证明该告警是存量**。

**同时报告两条门禁侧事实（不属本批，但影响收件闸判断）**：
1. 该门禁自身输出「**存量 493 条（棘轮内）｜新增 493 条**」**自相矛盾**：两个数相同说明 87 条基线**全部 STALE**（实测确实全 STALE），故"新增"实为"基线外总数"，措辞会让人误读为"本段新增 493 条"。
2. 该门禁在 `SYNO_CI=1` 下会因这 493 条 **exit 1** ⇒ **base 上该门禁本就是红的**，任何 PR 走 CI 都会被它拦。是否属已知存量、是否需先下调基线，请在收件闸前明确。

---

## 三、"测不出什么"复核（b 类）

| # | 件已声明测不出 | 我的复核意见 |
|---|---|---|
| b-1 | 工作令 §四⑥ **全文**不在仓 | ✅ **成立**（我独立复跑：`四⑥` 零命中；`第二收口点` 仅 1 命中且非工作令）。⇒ 本卡可核面上限确实只到「issue 标题 ＋ 派单件转述」 |
| b-2 | 运行期真的每次走守卫（未跑 vitest） | ✅ 未跑（我亦未跑；重型验证按纪律串行，由自验员承担） |
| b-3 | 变量式/逃逸式关守卫 | ✅ 未测；且见 a-1 —— 现有判据连"字面串计数"都受标题/注释污染 |
| b-4 | 运行时经 `require` 直读归档文件 | ✅ 未插桩；两条构建面 grep exit 1 只能证"构建不可达" |
| b-5 | 动态 `import()` 间接构造 | ✅ 未扫 |

---

## 四、c 类（跑不通）

**本件未发现跑不通项。** 复核过程本身的两条环境约束（复用于后续复核）：
- `git diff --name-only` 默认 `core.quotepath=true` 会把 CJK 路径输出成八进制 ⇒ **必须 `-c core.quotepath=false`**，否则循环里按"路径"取 blob 会 **`fatal: path … does not exist`**（我在本件复核第一遍即踩中，属 A1 类测量污染）。
- `setup`：PS 5.1 下 `$B`/`$b` 同名（大小写不敏感）会互相覆盖 —— 我因此一度把 brief 路径变成 `0`。命名需带前缀。

---

## 五、d 类：能否据此独立开工/决策

**能。** 事实层 13 项逐条复核吻合；唯一实质结论（「§四⑥ 点名落点的剩余面 = 0：`engine-context` 对象不存在、`ingest/index` 被默认守卫覆盖」）**有物理依据**（exit 1 判"对象不存在"而非"没做"，判法正确）；绿腿告警归因**成立且已被我用两种更强方法证实**。

**处置建议（3 条，均不动其结论）**：
1. 改 a-1 的 6 → **7 行**，并把"标题/注释同名串污染计数"补为 S-2 盲区第 4 条。**归属 impl-c / #1350 A 段 §3.3。**
2. 改 a-2 两处 subject 为逐字（补 `**`）。**归属 impl-c / 同件 §1.3。**
3. 按 a-3 的判别力分层表改写"不可造红"。**归属 impl-c / #1350 A 段自陈。**

**结论用语：`可提请独立审计`**（限本件对 `afa582cd8` 的静态复核；运行时面/§四⑥ 全文/变量式 opt-out 均未核，见 §三）。
