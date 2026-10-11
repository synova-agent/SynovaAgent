# Task Brief: CI 里 LLM mock 失效（stream-tool-loop）— 存量/环境红

> 立卡依据：创始人 2026-10-11 明批「另开卡查 mock」（#312 豁免的配套）
> 性质：**存量/环境红**，非任何在飞卡的引入

#CRITERIA: D

## 〇、为什么要做这个（通俗版）
① 一句话：让 CI 里的 LLM mock **真的生效**，否则增量测试门禁会被"打到真 provider"的用例随机染红。
② 问题：`tests/stream-tool-loop.test.ts` 断言「回复含『失败』」，CI 实际返回一段**真 LLM 风格的中文长回答**
   ⇒ **mock 未生效**，打到了真 provider / 真超时路径。
③ 推动：它是**仓库级 CI 环境问题** —— 任何改动面变宽的 PR 都会被它拦（已实测两次不同 commit 同红）。
④ 不做行不行：不行。已实测它拦下了 #312；后续每张改 `l4/`/`bootstrap`/`conversation-engine` 的卡都会撞。
⑤ 基础：基线 `local-main` 与各分支**本地全绿**；只有 CI 红 ⇒ 环境差异是唯一嫌疑。
⑥ 要做什么：见 Q2。
⑦ DSH 借鉴：不适用（CI 环境问题）。
⑧ 涉及文件：见 Q2。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CI/测试基础设施。不属产品五层。
### b) 文件审计（as_of `local-main=b88a23f76`）
| 件 | 现状 | 处置 |
|---|---|---|
| `tests/stream-tool-loop.test.ts` | 本地/基线全绿，**CI 稳定红** | 查 mock 为何在 CI 失效 |
| `tests/tui-v2/chat-degradation.test.ts` | 同上（`ReactCurrentOwner` undefined） | 同型，可能同根 |

### c) 决策
**诊断优先**：先定位差异根因，再决定修测试还是修 CI 环境。

## Q1: 调研 — 依据
### a) 实测证据（原始）
```
CI（run 214, head dc6ac4c6a9）：
  ::error file=.../tests/stream-tool-loop.test.ts
  AssertionError: expected '收到——不过我需要先确认你说的"测试错误"具体指什么…' to contain '失败'
local-main 基线（干净 worktree）：Test Files 2 passed | Tests 12 passed
本分支本地：#191 两件均 12/12 绿
```
### b) 假设（待验证，**不许当结论**）
- H1：CI 环境注入了真 provider key ⇒ mock 被绕过
- H2：`vi.mock` 提升/SSR transform 在 CI 的 vitest 版本下行为不同
- H3：CI 的 `vitest --changed` 跑法与本地不同（如并行度/isolate 设置触发竞态）

## Q2: 范围
做什么：
- tests/stream-tool-loop.test.ts
- tests/tui-v2/chat-degradation.test.ts
不做什么：
- 不改 scripts/pre-commit-check.sh — 门禁语义，归 CTO
- 不改 .gitea/workflows/** — CI 配置语义，归 CTO
- 不改 src/tui-v2/chat.tsx 的既有降级逻辑 — 只在本卡证实必要时才动

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 的增量测试步骤（`vitest --changed`）
处理：在 CI 等价环境复现 ⇒ 定位 mock 失效根因 ⇒ 修
结果：
- V1 在**能复现 CI 红的等价环境**下，两件测试**不再红**
- V2 反例：**能指出并复现**「mock 未生效时必红」的条件（证明修复真的治了根因，而非掩盖）
- V3 本地与 CI 两侧**同时绿**

## 架构层
不适用（CI 基础设施）。

## 写集
- tests/stream-tool-loop.test.ts
- tests/tui-v2/chat-degradation.test.ts

## Done 标准
- [ ] verify: 复现 CI 红的等价命令（须写进 brief）⇒ 修前 rc=1 / 修后 rc=0
- [ ] verify: `npx vitest run tests/stream-tool-loop.test.ts tests/tui-v2/chat-degradation.test.ts` ⇒ rc=0
