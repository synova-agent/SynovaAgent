# #401 · tests/tui-v2/chat-degradation.test.ts 在 CI=true 下判据必红（ink 静态输出分支）

> 批次：K12 第 6 批 · 卡 K12-6th-03（`task-3`）｜分支 `fix/401-chatdeg-ci-tty`｜基 = `gitea/local-main` = `ed63e2086`

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
代码层 L1（TUI 交互层）的**测试件**修复，不触生产代码。
被测对象 = `src/tui-v2/chat.tsx` 4 处 catch 的降级语义（`:237`/`:242`/`:260`/`:418`）。
本件只改**跑测环境适配**：让 `tests/tui-v2/chat-degradation.test.ts` 在 `CI=true` 下也走 ink 的**交互式输出路径**。

### b) 文件审计
```
$ git grep -n "vi.mock('ink'\|vi.mock(\"ink\"" -- tests/ src/ | wc -l   → 1
   tests/tui-v2/chat-degradation.test.ts:89
$ git grep -n "from 'ink'\|from './ink-fakes'\|ink-fakes" -- tests/tui-v2/   → 唯一消费者
   tests/tui-v2/chat-degradation.test.ts:40（ink-fakes 注释与 import）
   tests/tui-v2/ink-fakes.ts:2（仅文档提及，自身不 import ink）
$ ls tests/tui-v2/ tests/tui-v2/harness/   → 6 件；harness/* 不在 vitest include 内（*.test.ts 之外），不受本件影响
```
复用：`tests/tui-v2/ink-fakes.ts`（假 TTY）不动。

### c) 决策
已有覆盖 → 复用 fakes；冲突 = 无（本文件是全仓唯一 ink mock 消费点）。**最小改：加 1 段 hoisted 环境 shim + 边界注释，共 +20 行。**

## Q1: 调研 — 业界最佳实践 / 决策链 / 记忆教训

### a) 业界最佳实践
第三方库按「环境探测常量」分支时（`is-in-ci` 属此类），**测试应在模块加载前把被测场景的环境事实钉住**，而不是让运行器环境泄漏进被测语义。Anthropic 工程基线：测试的**场景属性**（这里是「交互式 TTY」）应由测试显式声明。

### b) 本仓现状（实测）
```
node_modules/is-in-ci/index.js      const isInCi = env.CI !== '0' && env.CI !== 'false' && ('CI' in env || …)   ← 模块加载期取一次并冻结
node_modules/ink/build/ink.js:5     import isInCi from 'is-in-ci';
node_modules/ink/build/ink.js:111   if (isInCi) { if (hasStaticOutput) { stdout.write(staticOutput); } this.lastOutput = output; return; }
                                                                     ↑ 动态帧在此分支根本不 write
```
Gitea Actions 必然注入 `CI=true` ⇒ `FakeStdout.raw` 恒空 ⇒ `stdout.text === ''` ⇒ 5 条依赖帧文本的断言必红。

### c) memory 历史教训
V-09（边界声明）：测试侧注入面必须写清「改了什么、没改什么」。本件沿用该惯例。

## Q2: 范围 — 正确的最简方案

做什么（写集，逐文件）：
- `tests/tui-v2/chat-degradation.test.ts`（唯一功能改动，+20 行：`vi.hoisted(() => { process.env.CI = '0'; })` + 边界声明注释）

不做什么：
- 不动 `vitest.config.ts`（不在写集；且 shim 文件内即可生效，无需配置层）
- 不动 `tests/tui-v2/ink-fakes.ts`（fakes 语义正确，`isTTY` 已如实为 true）
- 不动 `src/tui-v2/chat.tsx` 与任何生产代码
- 不用 `.skip` / `.only` / `--exclude` / 条件跳过 / 放宽断言串 / 直接断言 `process.stdout`

## Q3: 验收 — 入口 → 交互 → 结果

- 入口：`npx vitest run tests/tui-v2/chat-degradation.test.ts`（本地）与 `CI=true …`（CI 口径）
- 处理：vitest 提升 `vi.hoisted` 到静态 import 之前 ⇒ `process.env.CI='0'` 早于 `is-in-ci` 冻结 ⇒ ink 走交互式输出路径
- 结果：两种口径均 `Tests 6 passed (6)` / rc=0；注释掉 shim ⇒ `CI=true` 下回红并点名 5 条断言

## Q4 契约与测试

- 输入：运行器环境（`CI=true` 或未设）
- 输出：6 条降级语义断言全绿 / rc=0
- 降级：不适用（测试件无降级路径）
- 边界：**只改跑测环境变量**，不改被测语义；`CI='0'` 是 `is-in-ci` 明确认可的「非 CI」取值（源码 `env.CI !== '0'` 分支）
- 测试：本件自身即判据；改坏即红已实测（见卡面判据③）

## 架构层: L1（代码层 L1 交互 / 测试件）

## Done 标准
- [ ] verify: `CI=true npx vitest run tests/tui-v2/chat-degradation.test.ts` → exit 0 / 6 passed
- [ ] verify: `npx vitest run tests/tui-v2/chat-degradation.test.ts` → exit 0 / 6 passed
- [ ] verify: 注释掉 `vi.hoisted` shim ⇒ `CI=true` 下 5 failed 且点名 `expected '' to contain '⚠️ 检查更新失败'`
- [ ] verify: `CI=true npx vitest run --changed gitea/local-main` → 1 passed / 6 passed
- [ ] verify: `git diff --name-status gitea/local-main...HEAD` 只有 `tests/tui-v2/chat-degradation.test.ts`
