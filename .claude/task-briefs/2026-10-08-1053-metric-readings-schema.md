# Task Brief: #1053（2-1a）· 测量值时序 · 表定义（承重件 W1 的 schema 侧）

> 卡: **#1053**（施工项 2-1a，模块 K3 哨兵装载与时序落盘，批次第2批）
> 声明载体: `.claude/claims/1053.yaml`（issue 号卡 ⇒ D708 的 S0 源）+ 本 brief（pre-commit 组 6 载体）
> CTO 放行: 2026-10-08（三项待裁全裁：① 三列可空 ② id=INTEGER AUTOINCREMENT ③ 加表级不变量 CHECK）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
`src/store/`（L5 存储层）。承重件 **W1-时序**的 **schema 侧**：新建 `metric_readings`（17 列 + 3 索引），
落实宪章 §4.3 a 行「哨兵的测量值（指标取值 × 时间）」与硬顺序「指标时序存储必须先于参数标定」。
本卡**只建表**：不写数据、不提供读写 API（写入 = 2-1b #1054；读取/趋势 = 2-2 / 2-7）。

### b) 文件审计（实跑，origin/main@441c3004b）
- `git grep -l metric_readings origin/main -- src/` ⇒ **0 文件**（全仓 6 处命中全在 `docs/`）⇒ 无命名冲突、无既有实现
- 迁移机制：`src/store/schema-migration.ts`（`SCHEMA_VERSION = 2` + `migrations[]` + `reconcileSchema`）；
  先例 `src/store/migrations/001-graph-nodes-props.ts`（`Migration{version,name,up}`，幂等 `IF NOT EXISTS`）
- `reconcileSchema` 调用方：`src/adapters/sqlite-graph-store.ts:112`、`src/init/engine-context.ts:134`（＋`bootstrap.ts` 进口）
  ⇒ 版本号变更影响**所有 DB 初始化路径**，新迁移必须幂等
- 库口径：`data/` 被 `.gitignore:3` 排除 ⇒ 一律用**临时库**（`:memory:` / `mkdtemp`），**禁 `data/synova.db`**（R61/R87）

### c) 决策
新建迁移 `002-metric-readings.ts` + 注册 + `SCHEMA_VERSION 2→3`；沿用 001 的 `Migration` 契约。
不新建 store 类（表定义不需要）；不建聚合表/指标定义表/决策台账（卡面 §③-8）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **设计正本**：`archive/25-指标时序存储-设计v0.md` §2.1（DDL）/ §2.3（四条硬要求）/ §四（验收判据）
  —— ✳️ 库外件：`~/山河研究院/04-技术研究/专题研究/CTO委托-基座治理/archive/`
- **判据源矛盾两处（已裁，留痕不可省）**：
  ① `unit`/`source_id`/`evidence_ref`：正本 archive/25 行 51/55/59 = 可空；登记件 `:848-855` 列入 `notNullFields`
     但同处 `:845` 注释自指 archive/25 ⇒ 自相矛盾 ⇒ **CTO 裁可空**（理由：创始人裁 A 的「不能表能建、写不进」原则，
     T9 物证 = `run_id` NOT NULL ⇒ 写入 exit 19；三列生产者 `[known-gap] 待 2-1b 补` ⇒ NOT NULL = 要求写不存在的生产者）
  ② `id`：正本行 46 = `INTEGER PRIMARY KEY AUTOINCREMENT`；登记件写 `TEXT PRIMARY KEY` 且自相矛盾 ⇒ **CTO 裁按正本**
- **铁律 47/48**：迁移文件写全契约（@input/@output/@degraded/@invariant/@not-here）；测试三路径 + 零空壳
- **DSH 借鉴（不引代码）**：`dsh-storage-domain` 的「包自带不变量」⇒ 表级 CHECK 承载「三列缺省 ⇒ degraded=1」
- **证据形态模板 v1**（`/Users/wane/SynovaAgent/.synova-out/2026-10-08-证据形态模板-判据与覆盖面-v1.md`）：
  覆盖面声明固定形态 / 判据带 ref / 本地绿≠PR 级绿 / 修前红→修后绿 / 反例判别性 / 入 main 权威判定

## Q2: 范围 — 正确的最简方案
做什么：
- src/store/migrations/002-metric-readings.ts — 新建：表 DDL（17 列）+ 3 索引 + 契约 JSDoc + 裁定留痕注释
- src/store/schema-migration.ts — `SCHEMA_VERSION` 2→3；import + 注册 `metricReadingsMigration`
- tests/store/metric-readings-schema.test.ts — 新建：V1（17 列/3 索引/默认值/三条 CHECK）+ V6（删除安全）
- tests/store/metric-readings-insert.test.ts — 新建：V3（幂等）+ 降级（R4 三列 null ⇒ degraded=1）+ 边界（NOT NULL/CHECK）
- tests/store/migrations/002-metric-readings.test.ts — 新建：迁移模块本体配对测试（version/name/up 幂等/失败面）
- tests/store/schema-migration.test.ts — 必要连带：3 处版本断言改「成员 + 最大值」口径（多迁移下首行 ≠ 最新版）
- .claude/claims/1053.yaml — 新建（S0 写集声明，含 done 必填键）
- .claude/task-briefs/2026-10-08-1053-metric-readings-schema.md — 本 brief

不做什么：
- 不改 src/sentinel/（属 2-1b #1054）
- 不改 src/loops/（属 #1054 写集）
- 不改 data/synova.db（gitignored；判据禁真库，R61/R87）
- 不改 src/adapters/sqlite-graph-store.ts、src/init/engine-context.ts（只读调用方，本次不动）
- 不改 docs/synova/coordination/施工项登记.ts（登记件订正归下一轮回填，CTO 裁）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`reconcileSchema(db)`（既有生产迁移入口；调用方 `sqlite-graph-store.ts:112` / `engine-context.ts:134`）。
处理：`SCHEMA_VERSION 2→3` ⇒ 新库/旧库执行迁移 002 ⇒ 建 `metric_readings` + 3 索引（幂等）。
结果：临时库上 `.schema` 等价物 = 1 表 + 3 索引 + 17 列（`PRAGMA table_info | wc -l` ⇒ 17）。
**覆盖面**：时序表已建（表结构 + 3 索引 + 唯一约束 + 不变量 CHECK；**写入侧未接**（2-1b #1054）；**查询/聚合未接**）。

## Q4 契约与测试:
- 契约：迁移文件 JSDoc 五段（@input/@output/@degraded/@invariant/@not-here）；`@degraded — 无`（纯 DDL，异常上抛由 reconcileSchema 阻断启动）
- 测试：**23 例**（schema 12 + insert 11），全含 `expect()`；覆盖正常 / 幂等 / 降级 / 边界 / 删除安全
- 反例 5 条（M1–M5）逐条声明「预期红 / 其余仍绿」，两轮原始输出留档
- 零 `as any` / `as never` / `as unknown as`；既有文件被我触碰的行同步去 `as any`

## 架构层:
L5（`src/store/` 存储层）+ 测试面 `tests/store/`

## Done 标准
- [ ] verify: npx vitest run tests/store/metric-readings-schema.test.ts
- [ ] verify: npx vitest run tests/store/metric-readings-insert.test.ts
- [ ] verify: npx vitest run tests/store/
- [ ] verify: test "$(git grep -nE '^[^*/]*(UPDATE[[:space:]]+metric_readings|DELETE[[:space:]]+FROM[[:space:]]+metric_readings)' HEAD -- src/ packages/ | wc -l)" -eq 0
- [ ] verify: npx tsc --noEmit
