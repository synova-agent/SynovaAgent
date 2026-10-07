# Task Brief: #1379（遗留轴内一致性：读写匹配）

> 卡: **#1379**（模块 K3；服务承重件 W1-时序；p1）｜CTO 2026-10-08 **改判 X**
> 声明载体: `.claude/claims/1379.yaml`（S0）+ 本 brief（组 6 载体）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
哨兵/上层读图（L5→L4）时的**类型字面量**与**写入侧**是否同名。本卡只处理**遗留轴内**的"读写匹配"；
**轴迁移**（本体轴 = 真源）归 **#1381（p0）**。

### b) 文件审计（实跑，ref=origin/main@3db1ead44）
- **写侧**（UPPER 3 处）：`src/growth/goal-store.ts:169`（GOAL）｜`src/growth/proposal-store.ts:143`（PROPOSAL）｜`src/growth/action-store.ts:89`（ACTION）
- **真断链**：`'TEAM'`（`src/sentinel/adapters/goal-alignment-sentinel.ts:40`，写侧只有 `'Team'` 2 处）；`'Goal'` 读 5 行（写侧 0）
- **自洽（非断链）**：`GOAL` 读 11/写 1｜`PROPOSAL` 读 4/写 1｜`ACTION` 读 3/写 1｜`Person` 14/4｜`Document` 3/3
- **孤轴（0 写入者）**：`Financial`(28)｜`Event`(19)｜`Tool`(10)｜`Client`(10)｜`Process`(6)｜`Risk`｜`Capability`｜`Evidence`｜`Agent` ⇒ 归 #1381
- **CTO 改判记录**：原裁 a（统一 TitleCase）= 25 行 / 12 文件 / **无功能收益** / 与 #1381 重复改两次 ⇒ 实测推翻 ⇒ 改 X

### c) 决策
X（读写匹配）：修 5 行断链 + 空读留痕 + 对照表判据；**不做风格统一**（Y 归 #1381）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- CTO 规：**"一致/统一"必须表达为可判的功能断言**；仅风格的目标不立卡（风格不可判 ⇒ 无法验收；无收益 ⇒ 白花预算）
- R92 排注释（`goal-types.ts:83`、`sidebar-aggregator.ts` 注释）；R61（空结果 ≠ 成功）；R109（判据不得过宽兜底）
- 预算纪律：D734 ≤12 文件；CTO 两次不批豁免（#1330、#1372 先例）⇒ 改动面必须先测准再裁

## Q2: 范围 — 正确的最简方案
做什么：
- src/sentinel/adapters/goal-alignment-sentinel.ts — `'TEAM'`→`'Team'` + 空读 warn
- src/sentinel/adapters/cash-flow-sentinel.ts — 空读 warn（V3）
- src/l3/briefing-generator.ts — `'Goal'`→`'GOAL'`
- src/l3/business-model-canvas.ts — 同上
- src/routes/chat.ts — 同上
- src/tui-v2/chat.tsx — 同上
- src/tui-v2/lib/sidebar-aggregator.ts — 注释同步（文档不实描述修正）
- tests/sentinel/type-casing.test.ts — 新建（V1/V2/V3）
- tests/l3/business-model-canvas.test.ts — **必要连带**（夹具 `type:'Goal'` → `'GOAL'`）
- .claude/claims/1379.yaml
- .claude/task-briefs/2026-10-08-1379-legacy-axis-consistency.md

不做什么（逐条含具体文件名）：
- 不改 src/growth/goal-store.ts（GOAL 写侧：与读侧自洽，风格统一属 #1381）
- 不改 src/growth/proposal-store.ts（PROPOSAL 同）
- 不改 src/growth/action-store.ts（ACTION 同）
- 不改 src/l4/graph-bridge.ts（轴迁移本体，归 #1381）
- 不改 src/store/migrations/002-metric-readings.ts（表定义）

范围外约束（非文件级）：风格统一（GOAL/PROPOSAL/ACTION → TitleCase）并入 #1381；孤轴显式登记归 #1381。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`queryNodes('<type>')` / raw `type = '<type>'` 的读点。
处理：读侧字面量与写侧同名 + 空读留痕。
结果：**逐对核验读写匹配**（对照表）；无同名者**显式登记为"无源"**。

## Q4 契约与测试:
- 测试：3 例（V1 零残留 / V2 对照表 / V3 空读留痕）全含 `expect()`；**V2 已收紧**（只认同名写入者，禁"存在任意 NodeType 写入"过宽兜底）
- 反例：M1 还原 `'TEAM'`/`'Goal'` ⇒ V1 红；M2 从无源登记移除一项 ⇒ V2 红
- 零 `as any` / `as never` / `as unknown as`

## 架构层:
L3 哨兵/上层读点（只改字面量与留痕，不改架构）

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/type-casing.test.ts
- [ ] verify: npx vitest run tests/sentinel/ tests/store/
- [ ] verify: test "$(git grep -nE "type *= *'TEAM'|queryNodes\('Goal'|type *= *'Goal'" HEAD -- src/ extensions/ | grep -vE ':[0-9]+:[[:space:]]*(\*|//)' | wc -l)" -eq 0
- [ ] verify: npx tsc --noEmit
