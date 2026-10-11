# Task Brief: CI 里 `chat-degradation` mock 失效（追因卡）

> 立卡依据：创始人 2026-10-11 追认 #312 环境豁免时明令「**豁免了不能就忘** ⇒ chat-degradation 也立一张」
> 性质：**存量/环境红**，非任何在飞卡引入
> 姊妹卡：`2026-10-11-followup-ci-mock-lost.md`（`stream-tool-loop`，同型）

#CRITERIA: D

## 〇、为什么要做这个（通俗版）
① 一句话：查清 `tests/tui-v2/chat-degradation.test.ts` 为何**只在 CI 里** mock 失效。
② 问题：CI 报
   `Error: [vitest] There was an error when mocking a module. If you are using "vi.mock" factory,
   make sure there are no top level variables inside, since this call is hoisted to top of the file.`
   `Caused by: TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')`
   （`node_modules/ink/node_modules/react-reconciler/cjs/react-reconciler.development.js:491`）
③ 推动：它和姊妹卡一样是 `vitest --changed` 的常驻污染源 —— 已实测拦下 #312（连续两次不同 commit 同红）。
④ 不做行不行：不行。后续每张改动面较宽的卡都会撞。
⑤ 基础：`local-main` 基线**本地 6/6 全绿**；CI 红 ⇒ 环境差异是唯一嫌疑。
⑥ 要做什么：见 Q2。
⑦ DSH 借鉴：不适用（CI 环境问题）。
⑧ 涉及文件：见 Q2。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
CI/测试基础设施 + TUI V2（代码层 L1）的 mock 环境。
### b) 文件审计（as_of `local-main=8cbe3fc1d`）
| 件 | 现状 | 处置 |
|---|---|---|
| `tests/tui-v2/chat-degradation.test.ts` | 本地/基线全绿，**CI 稳定红** | 查 mock 为何在 CI 失效 |
| `src/tui-v2/chat.tsx` | 被 mock 的目标（`ensureEntryCaptured` 注入式取证） | 只读优先 |

### c) 决策
**先定位根因再决定修谁**（测试 vs 环境 vs TUI 模块的 mock 结构）。

## Q1: 调研 — 依据
### a) 实测证据（原始，来自 #312 的 CI 日志）
```
::error file=.../src/tui-v2/chat.tsx,title=tests/tui-v2/chat-degradation.test.ts > #1348 V2 — 4 处空吞降级语义在位（注入式补充证据） > ① :237 检查更新 reject → log.warn 真被调用 + 界面提示可见
Error: [vitest] There was an error when mocking a module … this call is hoisted to top of the file.
Caused by: TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
 ❯ node_modules/ink/node_modules/react-reconciler/cjs/react-reconciler.development.js:491:46
```
本地/基线：`Test Files 2 passed | Tests 12 passed`（与姊妹卡一并跑）

### b) 假设（**待验证 —— 明写"不许当结论"**）
- **H1**：CI 的 Node/vitest 版本或 resolve 条件与本地不同 ⇒ `ink` 解析到另一份 `react-reconciler`（有版本漂移）
- **H2**：`vi.mock` 工厂里有**顶层变量**（错误信息字面指向这条）⇒ 本地恰好未触发提升顺序问题
- **H3**：CI 的 `isolate`/并行设置导致模块注册顺序不同 ⇒ React 全局在 mock 前被复位
- **H4**：`ink` 的 `patches/ink+5.2.1.patch` 在 CI 未应用（`postinstall: patch-package` 未跑）⇒ reconciler 形状不同
  🔴 **H4 有独立价值**：铁律 40 的冻结项之一就是这条 patch —— 若 CI 未应用，**是双份问题**（测试红 + 冻结项失守）

## Q2: 范围
做什么：
- tests/tui-v2/chat-degradation.test.ts
不做什么：
- 不改 .gitea/workflows/** — CI 配置语义，归 CTO
- 不改 scripts/pre-commit-check.sh — 门禁语义，归 CTO
- 不改 src/tui-v2/chat.tsx 的降级逻辑 — 除非确诊 bug 在它里面（届时另附说明）

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 的增量测试步骤（`vitest --changed`）等价环境
处理：**先在能复现 CI 红的等价环境里复现** ⇒ 定位根因（逐条排除 H1–H4）⇒ 修
结果：
- V1 在**能复现 CI 红的等价环境**下不再红（须把该等价命令写进 brief）
- V2 🔴 **根因确诊**：明确指出是 H1/H2/H3/H4 中哪一条（或新根因），**附命令证据**，不许含糊
- V3 反例：**能复现**「mock 失效时必红」的条件（证明修的是根因，不是掩盖）
- V4 本地与 CI 两侧**同时绿**
- V5（若命中 H4）**同时报铁律 40 冻结项状态**：`postinstall: patch-package` 与 `patches/ink+5.2.1.patch` 在 CI 是否在位

## 架构层
不适用（CI 基础设施）；若确诊 TUI mock 结构问题 ⇒ 代码层 L1。

## 写集
- tests/tui-v2/chat-degradation.test.ts

## Done 标准
- [ ] verify: 复现 CI 红的**等价命令**（写进 brief）⇒ 修前 rc=1 / 修后 rc=0
- [ ] verify: `npx vitest run tests/tui-v2/chat-degradation.test.ts` ⇒ rc=0
- [ ] verify: 根因诊断书（逐条排除 H1–H4，附命令）
- [ ] verify: 反例可复现（mock 失效 ⇒ 必红）
