# 2026-11-23 · #1431（阶段 2 · S2b）诊断运行显式携带 period/objectKey → ④a 真落行

> **类型**：implemented ｜ **Issue**：#1431（阶段 2 · S2b）｜ **S2b 卡**：评论 14354 ｜ **Mandate**：评论 14357（`synova-1431-s2b-period-wiring-v1`）
> **基线**：`caf61fcdeb3e00c79abe9211546690ca963549a2`（S2 已合）｜ **分支**：`feat/1431-s2b-period-wiring`（worktree：`synova-agent/.agents/worktrees/1431-s2b-period-wiring`）
> **交付形态**：PR（不 merge）｜ **库口径**：只连 `:memory:`（不碰 `data/synova.db`）

## 为什么

S2 把「哨兵轮次 → ④a」的真实生产者接上了：`runSentinelForTeam(teamId, store, { period, objectKey })` 会写 `metric_observations`。
但**唯一生产调用点**（`src/l3/synova-diagnosis-engine-impl.ts:261`）仍只传 `(teamId, store)`，其上下文里
只有 `teamId/initiator/scope/graphStore/now()` —— **没有任何业务期间来源**。结果：真实诊断每次只留
`S2_DEGRADED_NO_PERIOD` 警告，④a 一行不落。

本卡把「请求 → 诊断运行 → 哨兵轮次」这条链上的 `period`/`objectKey` 接通：**由请求显式携带**
（`scope.period` / `scope.objectKey`），引擎原样透传，哨兵层按 S2 既有契约落行或降级；
**禁止引擎内 `new Date()` 派生 period**。

## 第 0 步核定（开工前实读 @`caf61fcde`；与 Mandate「已核事实」逐条复核）

| 前提 | 证据（实读） | 结论 |
|---|---|---|
| 唯一生产调用点不传 options | `src/l3/synova-diagnosis-engine-impl.ts:261`（`git grep runSentinelForTeam` 产品侧仅此一处） | 需在此透传 |
| 该处上下文无 period/objectKey | 同文件 `:251-261` | period 只能来自 `scope`（或新引入来源，卡面禁止） |
| `DiagnosisScope` 定义 | `src/l3/synova-diagnosis-engine.ts:35-52` | 加两个可选字段即可，不动既有字段语义 |
| 路由 scope 形状无这两字段 | `src/routes/diagnosis.ts:193` | 需加字段 |
| S2 已支持 options 且校验完整 | `src/sentinel/sentinel-runner.ts:36-40,84`；`src/sentinel/registry.ts:160,184-250` | 复用 S2 码，哨兵层零改动 |
| **路由 scope 是否真能到引擎？** | **否**：L2 `DiagnosisEngine.runConsultation` 为 3 参（`src/l2-interfaces/diagnosis-engine.ts:39-43`）；`DiagnosisLauncher` 只传 initiator（`src/agent/diagnosis-launcher.ts:176-181`）；路由适配器原把 scope 写死 `undefined`（`src/routes/diagnosis.ts:318`） | 「路由 → 引擎」需在**路由构造引擎的适配闭包边界**注入（见下「偏差」1），不改写集外文件 |
| 旧链写入不受影响 | `registry.runAll` 内 `writeRoundReadings` 逐字保留（`registry.ts:134`） | 旧表 `metric_readings` 行为零改动 |

## 改了什么（6 件，见 `.claude/claims/1431.yaml`）

1. **`src/l3/synova-diagnosis-engine.ts`**（`DiagnosisScope`）：新增 `period?: string`、`objectKey?: string`，
   契约注释钉死「由调用方显式携带 / 禁 `new Date()` 派生 / 缺省与非法形态按 S2 降级码不写 ④a / 不得回退 `'*'`」。
2. **`src/l3/synova-diagnosis-engine-impl.ts`**（`:261` 处）：调用改为
   `runSentinelForTeam(teamId, store, { period: scope?.period, objectKey: scope?.objectKey })`；引擎内不产生 period。
3. **`src/routes/diagnosis.ts`**：
   - `:193` `scope` 形状加 `period?: string; objectKey?: string`（仍只做透传，不在路由做形态校验——非法形态必须
     由哨兵层记 `S2_DEGRADED_BAD_PERIOD`，路由提前丢弃会吞掉降级码）；
   - 构造引擎的适配器（原 `:318` 传 `undefined`）改为把闭包内请求 `scope` 的这两个字段注入 L3 `runConsultation`，
     其余 scope 字段保持不传（与改动前逐字等价）。
4. **`tests/l3/diagnosis-s2b-period.test.ts`**（新，5 用例）：**真实路由** `POST /api/diagnosis/consult` + 真实
   L3 引擎 + 真实哨兵轮次 + `:memory:` 库；只 mock LLM provider/config、`engine-context.getDatabase`（指向 `:memory:`）与 logger（捕获降级码）。
5. **`.claude/claims/1431.yaml`**：本卡声明（writeset 6 件）。
6. **本 Note**。

## 钉死的语义（本卡不改）

- `period` 形态 `YYYY-MM`；非法 ⇒ 不写 ④a + `S2_DEGRADED_BAD_PERIOD`（**复用 S2 码，零新增码**）。
- `objectKey` 非空；缺 ⇒ 不写 ④a + `S2_DEGRADED_NO_OBJECT`（不回退 `'*'`）。
- 无 period 时诊断**照常返回**（findings/报告不变），只是不写 ④a。
- 引擎内**禁止** `new Date()` 生成 period；`observed_at` 兜底仍用 S2 注入的 `context.now`。
- 旧链 `metric_readings` 写入、`src/sentinel/**` 语义、`graph-store-service.ts`、`src/store/**`、`src/adapters/**`、
  迁移、renderer、scripts、门禁：**零改动**。

## 验证（原始输出）

| 命令 | 改动前（基线 worktree @`caf61fcde`） | 改动后（本分支） |
|---|---|---|
| `vitest run tests/l3/diagnosis-s2b-period.test.ts` | （新文件不存在） | exit 0｜`Tests 5 passed (5)` |
| `vitest run tests/l3 tests/sentinel` | exit 1｜`Test Files 4 failed \| 267 passed \| 1 skipped (272)`｜`Tests 9 failed \| 1337 passed \| 1 skipped (1347)` | exit 1｜`Test Files 4 failed \| 268 passed \| 1 skipped (273)`｜`Tests 9 failed \| 1342 passed \| 1 skipped (1352)`；**同 4 文件、同 9 条**既有失败，新增 1 文件/5 用例全绿 |
| `tsc --noEmit` | exit 0 | exit 0（零输出） |

既有 9 条失败（`caf61fcde` 上就红，同因，非本卡引入）：`tests/sentinel/d752-type-net-gate.integration.test.ts` 4｜
`tests/sentinel/field-name-alignment.test.ts` 1｜`tests/sentinel/metric-readings-reader.integration.test.ts` 3｜
`tests/sentinel/tenant-filter-keys.test.ts` 1。

正例断言（期望全部来自测试构造的请求入参）：`org_id`=请求 teamId、`period`=入参、`object_id` 匹配 `node-<uuid>` 且能在
`graph_nodes` 查到（graph=teamId、type=Team、`props.businessKey`=入参）、`value`=探针 findings 数、`def_version`=哨兵版本。

## 改坏必红（2 条，逐条留原始失败行后恢复；恢复后 5/5 复绿）

| # | 改坏 | 原始失败行（节选） | 结果 |
|---|---|---|---|
| ① | 引擎内 `period: new Date().toISOString().slice(0, 7)` 派生 | `AssertionError: expected '2026-11' to be '2034-06' // Object.is equality`（正例·非当期：时钟派生值 ≠ 入参）；`AssertionError: expected [ 'S2_DEGRADED_NO_OBJECT' ] to include 'S2_DEGRADED_NO_PERIOD'`（反例1）；`AssertionError: expected [ { …(7) }, { …(7) } ] to have a length of +0 but got 2`（反例3） | `Tests 3 failed \| 2 passed (5)` |
| ② | 路由丢 scope 透传（`engineScope` 恒 `{}`） | `AssertionError: expected [] to have a length of 2 but got +0`（正例·真实入口：④a 0 行）；`AssertionError: expected [] to have a length of 2 but got +0`（正例·非当期）；`AssertionError: expected [ 'S2_DEGRADED_NO_PERIOD' ] to include 'S2_DEGRADED_NO_OBJECT'`（反例2）；`…to include 'S2_DEGRADED_BAD_PERIOD'`（反例3） | `Tests 4 failed \| 1 passed (5)` |

> 注：系统当前月为 2026-11，卡面字面正例 `period='2026-11'` 与 `new Date()` 派生值同月 ⇒ 单靠它无法区分时钟派生。
> 故加「正例·非当期」（固定 `2034-06`）作为判别用例——这是改坏①必红的实际触发点。

## 与卡面／Mandate 的偏差（如实记录，需 CTO 知悉）

1. **路由透传落点**：Mandate 写「`src/routes/diagnosis.ts:193` 加两字段并透传到引擎调用」。实测 L2 `DiagnosisEngine`
   接口 3 参且 `DiagnosisLauncher` 不传 scope ⇒ 唯一不越写集的落点是**路由构造引擎的适配闭包**：
   把 `scope.period/objectKey` 注入 `newEngine.runConsultation(..., engineScope, ...)`。未改
   `src/l2-interfaces/**`、`src/agent/diagnosis-launcher.ts`（写集外）。**若要求 scope 经 L2 接口正式透传，需另开卡改 L2。**
2. **worktree 位置**：Mandate 要求「仓库外独立 worktree」；本机 DSH 文件沙箱只允许会话工作区（`synova-agent/`）内写，
   仓外路径（`../.synova-wt-*`）被拒。实际使用仓内 `.agents/worktrees/1431-s2b-period-wiring`（git 忽略目录、独立分支、
   主树零写入）。**若必须仓外，需放开沙箱或人工迁移后再交付。**
3. **测试环境**：新 worktree 无 `node_modules` ⇒ 创建 junction 指向既有 worktree 依赖（`package.json` 与基线零 diff，无产品影响）；
   `vitest` 因 Vite/Windows 的 `net use` 命名管道 spawn 在受限沙箱下 `EPERM` ⇒ 测试运行使用了一次性 `danger-full-access` 放行
   （仅测试命令，未改门禁/未用 `--no-verify`）。等价命令用 `node_modules/.bin/vitest.cmd` / `tsc.cmd` 替代 `npx`。

## NOT DONE / 未验证

- **生产库未验**：只用 `:memory:`；真实客户库的 `metric_observations` 迁移属 T1（007），本卡未触碰。
- **period 的业务生产者（调度/UI）未接**：本卡只接通「请求显式携带」；谁按周期调用路由仍归后续卡。
- **conversations 路由路径未接**：`src/routes/conversations.ts` 有自己的引擎适配器，不在写集内，未改（该路径仍不携带 period ⇒ 只记 NO_PERIOD）。
- **CI（Gitea core-gates）实跑结果未取**：本机只到 PR 创建，CI 结论以 Gitea 为准。

## 回滚

还原 3 个源文件（删 `DiagnosisScope` 两字段、恢复 `runSentinelForTeam(teamId, store)` 单调用、恢复路由 `undefined` scope）
并移除新测试/claim/Note 即回到基线；无迁移、无数据写入、无旧链改动。
