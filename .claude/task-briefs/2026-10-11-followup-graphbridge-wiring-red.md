# Task Brief: `tests/l3/graphbridge-wiring.test.ts` 存量红

> 立卡依据：创始人 2026-10-11 明批「另开卡修它」（#308 存量红豁免的配套）
> 性质：**存量红**（基线 `be57f90fb` 即红），非任何在飞卡引入

#CRITERIA: D

## 〇、为什么要做这个（通俗版）
① 一句话：修掉一件**基线就红**的图桥接测试，别让它继续随机拦人。
② 问题：失败用例
   `Given a failing module, When afterRun with GraphBridge, Then only successful modules create nodes`
   ⇒ `AssertionError: expected +0 to be 1`。
   它在基线 `be57f90fb` 上同样 `1 failed | 2 passed` ⇒ **存量**。
③ 推动：它是 `vitest --changed` 的**常驻污染源** —— 任何改 `packages/ontology` 的卡都会被它拦（#308 已实测）。
④ 不做行不行：不行。已实测拦下过 #308；后续每张碰 `@synova/ontology` 的卡都会撞。
⑤ 基础：测试件在库；`createGraphBridge` / `ModuleRunner` 均在库。
⑥ 要做什么：见 Q2。
⑦ DSH 借鉴：不适用。
⑧ 涉及文件：见 Q2。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
代码层 **L3 → L4**（ModuleRunner → GraphBridge）的接线契约。产品架构上属 ② 本体 的写入侧。
### b) 文件审计（as_of `local-main=b88a23f76`）
| 件 | 现状 | 处置 |
|---|---|---|
| `tests/l3/graphbridge-wiring.test.ts` | 3 例中 1 例**基线即红** | **改** |
| `src/l4/graph-bridge.ts` | 只读（除证实 bug 在它里面） | 只读优先 |
| `src/orchestrator/module-runner.ts` | 只读（同上） | 只读优先 |

### c) 决策
**先诊后修**：判定是「测试期望过时」还是「生产真 bug」（`afterRun` 在失败模块下真建了 0 个节点 vs 期望 1 个）

## Q1: 调研 — 依据
### a) 实测证据（原始）
```
$ （基线 be57f90fb 干净 worktree）npx vitest run tests/l3/graphbridge-wiring.test.ts
  Test Files 1 failed (1)
       Tests 1 failed | 2 passed (3)
  × Given a failing module, When afterRun with GraphBridge, Then only successful modules create nodes
    AssertionError: expected +0 to be 1
```
### b) 判据要求
**禁 grep 型静态判据当验收**（判例 V-02）；必须真跑 `ModuleRunner.afterRun` + 真 `GraphBridge`。

## Q2: 范围
做什么：
- tests/l3/graphbridge-wiring.test.ts
不做什么：
- 不改 scripts/pre-commit-check.sh — 门禁语义，归 CTO
- 不改 tests/l3/graphbridge-compatibility.test.ts — 另一件，不在本卡

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx vitest run tests/l3/graphbridge-wiring.test.ts`
处理：真 `ModuleRunner.afterRun`（含失败模块）→ 真 `GraphBridge` → 断言图内节点数
结果：
- V1 `exit 0`（3/3 绿）
- V2 **确诊**：明确说出是「测试期望过时」还是「生产 bug」，并给证据
  （若是生产 bug ⇒ 修 `src/` 并另附说明；若是测试期望过时 ⇒ 修测试并说明为何原期望错）
- V3 反例：**改坏即红** —— 把 `afterRun` 的成功/失败分流逻辑改坏 ⇒ 本测试必红

## 架构层
代码层 **L3**（orchestrator）→ **L4**（graph-bridge）。

## 写集
- tests/l3/graphbridge-wiring.test.ts

## Done 标准
- [ ] verify: `npx vitest run tests/l3/graphbridge-wiring.test.ts` ⇒ rc=0
- [ ] verify: 改坏即红（改坏 `afterRun` 分流 ⇒ 必红）
- [ ] verify: 在**基线 commit 干净 worktree** 上对照，证明修的是存量而非引入
