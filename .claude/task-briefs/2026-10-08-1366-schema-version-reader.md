# Task Brief: #1366 · schema_version 读取器不确定 + 类型不设防（迁移重复执行）

> 卡: **#1366**（模块 K2 写入门禁与工具治理；第2批-地基；p1；判据等级 L3-真跑）
> 声明载体: `.claude/claims/1366.yaml`（issue 号卡 ⇒ D708 的 S0 源）+ 本 brief（pre-commit 组 6 载体）
> CTO 放行: 2026-10-08（修法 B2 + 双层防御；写入侧不动；M1–M3 据实测填表；V6 断言翻转联动一并做）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
`src/store/`（L5 存储层）的**迁移系统读取器**。`reconcileSchema` 决定"哪些迁移要跑"，被**所有 store 初始化路径**调用
（`src/adapters/sqlite-graph-store.ts:112`、`src/init/engine-context.ts:134`）。缺陷 = 读取"当前版本"的方式不确定且类型不设防。

### b) 文件审计（实跑，origin/main@b3f1c99c5）
- **数值版本读取方全仓仅 1 处**：`git grep -n "SELECT version FROM schema_version" origin/main -- src/` ⇒ `src/store/schema-migration.ts:62`（唯一）
- 旧形态：`:62` `... ORDER BY updated_at DESC LIMIT 1` ＋ `:63` `as { version: number } | undefined` ⇒ ① 同秒并列取旧行 ② 字符串混入后 NaN 比较
- 字符串 tag 读取方 3 处（**无关**）：`feedback-collector.ts:288,352`、`agent-memory-store.ts:447`
- 写入方 7 处：`schema-migration.ts:75,84`（数值）＋ `feedback-collector.ts`×5、`agent-memory-store.ts`×2（字符串 tag）
- 迁移数 = 2（`001-...` + `002-metric-readings.ts`）⇒ 缺陷**已上线**

### c) 决策
读侧改 **B2**：`SELECT MAX(version) WHERE typeof(version)='integer'` + JS 数值守卫（双层防御）。
**写侧不动**（两侧一起定后的结论）：MAX 对多行/同秒天然免疫 ⇒ 写侧无需改；保留逐迁移一行 ⇒ 保留可审计历史；
且"只改写侧"在**既有库**上仍会读旧行（反例 M3），也解决不了字符串 tag 面。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **发现来源**：#1053（2-1a）回执探针（`archive/` 无关）；本卡为发现型新卡
- **SQLite 语义**：① 普通表有 rowid，但 **VACUUM 可能重排** ⇒ 不采用 `ORDER BY rowid DESC`（曾作为 B1 候选，已否）
  ② 混合类型比较：INTEGER < TEXT ⇒ `MAX()` 不加 `typeof` 过滤会取到 TEXT ⇒ 必须 SQL 层过滤
- **本仓教训**：R58（注释断言必须可复跑）／R61（判据真空过）／**R109（空对象可检）**／R29（引用旧值，不新立类）
- **铁律 47/48**：读侧改动写全契约；新测试三路径 + 零空壳
- 参考：第一性原理（版本读数必须**确定 + 类型自证**）+ SQLite 语义 + 本仓判据纪律 ⇒ **B2 + 双层防御**

## Q2: 范围 — 正确的最简方案
做什么：
- src/store/schema-migration.ts — 读取改为 `MAX(version) ... WHERE typeof(version)='integer'` + JS 数值守卫；注释写明**写侧不动**的理由 + 缺陷历史
- tests/store/schema-migration-idempotency.test.ts — 新建：V1（二次 reconcile 不新增行）/ V2（字符串 tag 不污染）/ V2b（同秒并列既有库）/ 边界 2 条 / 幂等三连跑
- tests/store/metric-readings-schema.test.ts — **V6 断言翻转**（`tableExists === true → false`）+ 注释改"真 no-op"（#1053 登记的联动）
- .claude/claims/1366.yaml — 新建（S0 写集声明，含 done 必填键）
- .claude/task-briefs/2026-10-08-1366-schema-version-reader.md — 本 brief

不做什么（逐条含具体文件名）：
- 不改 src/store/migrations/001-graph-nodes-props.ts（迁移内容）
- 不改 src/store/migrations/002-metric-readings.ts（迁移内容）
- 不改 src/growth/feedback-collector.ts（tag 写入方，属他人写集）
- 不改 src/l4/agent-memory-store.ts（tag 写入方，属他人写集）

范围外约束（非文件级，故不列入排除清单）：`SCHEMA_VERSION` 取值保持 3；写入侧行为（`:75` 初始化路径 + `:84` 每迁移一行）保持不变。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`reconcileSchema(db)`（生产入口；调用方 `sqlite-graph-store.ts:112` / `engine-context.ts:134`）。
处理：读取 `MAX(数值版本)` ⇒ 与 `SCHEMA_VERSION` 比较 ⇒ 只跑缺失迁移（不再重复跑最后一条）。
结果：二次 `reconcileSchema` **不新增** `schema_version` 行（修前 3 行 → 修后 2 行）；字符串 tag 行不改变版本判定。

## Q4 契约与测试:
- 契约：`reconcileSchema` 的读取语义（@invariant：只认数值行 / 取 MAX / 二次调用不新增行 / tag 不影响判定）
- 测试：新文件 6 例 + V6 用例翻转（schema 文件 12 例）全含 `expect()`；覆盖正常 / 幂等 / 边界（空库、仅 tag 行）
- 反例 M1–M3 据实测填表；**连带红与"一改全红"分开写清**（模板 §5）
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
L5（`src/store/` 存储层）+ 测试面 `tests/store/`

## Done 标准
- [ ] verify: npx vitest run tests/store/schema-migration-idempotency.test.ts
- [ ] verify: npx vitest run tests/store/
- [ ] verify: npx vitest run tests/store/ tests/adapters/
- [ ] verify: test "$(git grep -nE 'ORDER BY updated_at DESC LIMIT 1' HEAD -- src/store/ | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' | wc -l)" -eq 0
- [ ] verify: npx tsc --noEmit
