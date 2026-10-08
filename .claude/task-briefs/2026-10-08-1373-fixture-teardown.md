# Task Brief: #1373 ticket-store 夹具偶发 forks-teardown 断言

> 卡: **#1373**（K2 · p1）｜CTO 2026-10-08 裁 (A)：改判【测试基础设施面已知风险】+ 采纳已测缓解（拆文件）
> 声明载体: `.claude/claims/1373.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
本地 `ticket-store` 夹具在 **forks worker 退出后**偶发 `Assertion failed: (env) != nullptr` @ `Database::~Database()`（**吞掉诊断输出** ⇒ 排查更贵 ⇒ p1）。

### b) 文件审计（实跑，ref=origin/main@fe533a124；**全部 n≥10**）
- **P1 基线**：`ticket-store` **4/10**｜对照 `org-registry` **0/10**｜`metric-readings-writer` **0/10** ⇒ **文件特异**
- **P2 定位（时间盒一轮）**：最小形状 **0/10**｜前半 6 例 **0/10**｜后半 6 例 **0/10**｜**全文件 4/10**
  ⇒ 🔴 **两侧单独不崩、合起来崩** ⇒ **累积效应**
- **误判更正**：我首测 `--pool=threads` 得 0/5 ⇒ 曾判"绑定池"；复测 **5/10** ⇒ **该结论被推翻**（n=5 功效不足）
- 拒绝的其它变量：**哑迁移 004**（空 up）⇒ 1/5（未增加）⇒ **迁移条数不是根因**

### c) 决策（CTO 裁 (A)）
**缓解 = 拆文件**（各 6 例，降低每文件 native 对象累积量）；**根因不动**（改判已知风险）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 🔴 **R202（CTO 收紧）**：判"有无"的频次观测 ⇒ **n≥10**；判"率的大小" ⇒ n≥20 或区间估计；**对照组也要 n≥10**
- 🔴 **R201**：A/B 差异若每组仅 1 次观测 ⇒ 不可信（本卡原前提"迁移上限 2 条"即此型错误）
- 教训：**放弃"无限投入不可解释的偶发"** ⇒ 登记为已知风险 + 已测缓解（**缓解 ≠ 修复**）

## Q2: 范围 — 正确的最简方案
做什么：
- tests/sentinel/ticket-store.test.ts — 拆为前 6 例 + **(a) 卫生改进**（模块级句柄跟踪 openDb + 顶层 afterEach 兜底关闭 + **先置空全局单例再关句柄**）
- tests/sentinel/ticket-store-2.test.ts — 新建（后 6 例；头部与 A 重复 **不可避免**：`vi.hoisted`/`vi.mock` 为**文件级**）
- .claude/claims/1373.yaml + 本 brief

不做什么（逐条含具体文件名）：
- 不改 src/store/schema-migration.ts（迁移注册表 —— 实测与本崩溃无因果）
- 不改 src/store/migrations/001-graph-nodes-props.ts（语义不动）
- 不改 src/store/migrations/002-metric-readings.ts（语义不动）
- 不改 src/store/migrations/003-orgs.ts（语义不动）
- 不改 vitest.config.ts（换池已由 n=10 否证：threads 5/10）
- 不改 src/l4/graph-bridge.ts（与 #1403 的检测落点无关）

范围外约束（非文件级）：**机制层根因**（native 析构时序）⇒ 登记为已知风险；再启动条件：**"拆了还崩"或"更多文件出现同类"** ⇒ 那时上 P3′（`--expose-gc` 强制 flush / `process.on('exit')` 打点）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx vitest run tests/sentinel/ticket-store.test.ts`（本地，forks 默认池）。
处理：12 例分两文件执行（各 6 例）。
结果：**无 teardown 断言**、worker 正常退出（**n≥10 各 0 崩**）。

## Q4 契约与测试:
- 契约：测试夹具的收尾契约 = **先断开全局单例引用 → 再关闭全部登记句柄**（GC/析构顺序）
- 测试：**V2a（频次判据，可复跑）**：拆后**各 0/10**（命令见 Done）｜**V2b**：CI 侧 0 崩（R113 口径）
- 反例：① 合回单文件 ⇒ 4/10（P1 实测）② 换池 ⇒ **不成立**（n=10 否证）③ 仅 (a) 卫生 ⇒ 4/10（无改善）
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 测试基础设施（**非产品代码**）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/ticket-store.test.ts tests/sentinel/ticket-store-2.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/ tests/l3/
- [ ] verify: bash -c 'for f in tests/sentinel/ticket-store.test.ts tests/sentinel/ticket-store-2.test.ts; do c=0; for i in $(seq 1 10); do npx vitest run $f 2>&1 | grep -q "Assertion failed" && c=$((c+1)); done; echo "$f 崩 $c/10"; done'
- [ ] verify: npx tsc --noEmit
