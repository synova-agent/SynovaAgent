# 2026-10-24 · #914 Q-3（裁 366）：单错误基类 + 原生 cause 链 + 禁解析 message 棘轮

## 现状（实测，锚 = `ct/914-q3` base `8a910555b`；分支基后经 merge 到 `423f60e1f`，#959/#960 等并行合入与本批写集零重叠）

1. **两套同名类**：`git grep -c "class DiagnosticAgentError" -- src packages` 改前 = **2**
   （`packages/error-types/src/index.ts:1`／`src/errors/types.ts:1`）。
2. **真缺陷（E2）**：`src/services/runtime-global-handlers.ts:13,39` 的 `instanceof` 判的是**包类**，
   而分类流水线抛的是**本地同名类** ⇒ 两者永不相等 ⇒ 所有 LLM 失败都走"致命"分支（真类反而被判致命）。
   该文件按规格**只读**（只改它的测试），所以修法必须是"让两个名字落到同一个类"。
3. **cause 不是原生**：本地类只有自研字段 `readonly cause?: unknown`（自赋值），包基类 `super(message)` 未接
   `ErrorOptions` ⇒ `err.cause` 不可链、也不是 ES2022 原生语义。
4. **测试面**：`tests/errors/classify-api-error.test.ts`、`tests/errors/llm-error-taxonomy.test.ts`、
   `tests/llm/call-resilience.test.ts`、`tests/agent/tool-loop-executor-resilience.integration.test.ts`
   四件**从 `src/errors/types` import `DiagnosticAgentError`** 并按 **options 对象**构造（实测 `git grep -n`）。
5. message 解析路由边界实测 **4 条**：`src/llm/types.ts:79`（`includes`）、`src/providers/deepseek.ts:33`（`match`）
   为**路由型**；`src/services/content-layering.ts:212`、`src/services/request-context.ts:253`（`.split('\n')[0]`）为**日志取样型**。

## 决定

- **一个基类**：`packages/error-types` 的 `DiagnosticAgentError` 是全仓唯一根，构造改
  `(code, message, phase, retryable, options?: ErrorOptions)` → `super(message, options)`；**其余 9 个子类构造保持 4 参不变**。
- **子类**：删掉 `src/errors/types.ts` 的本地同名类，改 `ClassifiedLlmError extends BaseDiagnosticAgentError`：
  options 对象构造 ＋ positional 4 参兼容照旧；`shouldCompress/shouldRotateCredential/shouldFallback/statusCode/provider/model` 留子类；
  `declare readonly code: ErrorCodeType`（收窄**不 emit**，禁 `as any`）；`this.name = 'ClassifiedLlmError'`；
  cause 走 `super(code, msg, ph, retry, { cause })` ⇒ **原生 `ErrorOptions.cause`**。
- **同文件 18 处机械改名** `DiagnosticAgentError` → `ClassifiedLlmError`（返回类型/参数类型/`instanceof`/`new`），
  **业务逻辑零改动**（`classifyApiError` 八阶段顺序、模式表、`_classify402`、解码器、`withRetry` 退避全不动）。
- **4 个构造文件**（`providers/base.ts`、`deepseek.ts`、`ernie.ts`、`services/fault-recovery.ts`）只改 import ＋ 构造点，
  重试/退避/超时/phase/retryable/code 取值零变化。
- **向后兼容别名（规格外的必要补丁，报 L1）**：在 `src/errors/types.ts` 末尾
  `export { ClassifiedLlmError as DiagnosticAgentError };`。理由：上面"现状 4"四件测试**不在任何人写集**（规格把它们列为"本批不改"），
  但删掉导出会让它们 import 不到 ⇒ 编译/运行双红，且其中两件正是 L1 声明的 57-passed 基线。别名**不新增类定义**
  （`class DiagnosticAgentError` 仍唯一），且顺带把 E2 的 `instanceof` 判据修到**所有**既有消费者，不止 runtime-handlers。
- **棘轮（判据 C）**：message 解析保持 **4 条**（路由型 2 ＋ 取样型 2），本批新增 0；白名单钉死行号，只减不增。

## 依据

- 裁 **366**（Q-3 范围）＋ **#918 A 节** Q-3；#951 = 另立 A 类卡（794 行搬进 package ＋ 两套码表统一，**不在本批**）。
- DSH 锚：`HarnessError`（`~/src/dsh-src-0.2.1-rc.2/packages/llm/llm/src/error.ts`）——
  注释原文 **"route on this, never by parsing `message`"**，且构造 `(message, code, options?: ErrorOptions)` → `super(message, options)`。
- 本仓既有约定复用：typed error 带 `code`（铁律 32）／测试配对（CT-40）／判别力自检＝变异 M1–M3（铁律「改坏必红」）。
- 设计哲学一句：**按 `code` 路由，永不解析 `message`** —— `message` 只给人读，路由只认稳定码。

## 生效时点

本 PR 合入 `gitea/local-main` 后生效；回滚＝`git revert`（回到"两套同名类 ＋ 自研 cause 字段"的旧行为，
届时 `runtime-global-handlers` 的 `instanceof` 又会永久不命中 ⇒ E2 复现）。

## 已知限制

- ❌ **不改 code 词表**：`LLM_*`（包）与 `TIMEOUT/…`（src）两套码表仍并存，`ClassifiedLlmError.code` 只收窄为 src 词表；
  统一归 **#951**（A 类卡）。
- ❌ **不搬 794 行**进 `packages/error-types`：搬文件要加 `@synova/logger` 依赖 ⇒ `packages/error-types/package.json` 是红线；
  owner 归 **#951**。
- ❌ **别名是临时态**：`export { ClassifiedLlmError as DiagnosticAgentError }` 只为止血（4 件测试不在写集）；
  待 #951 或后续卡把测试 import 改成 `ClassifiedLlmError` 后应删除，删除后 `git grep -c` 仍须为 1。
- ❌ 未改 `runtime-global-handlers.ts` 判定逻辑与 `src/agent/**`、`src/l3/**`、`src/llm/retry-middleware.ts`（红线）。
- ⚠️ **规格口径错（按实测做，已在回执点名）**：dev doc §3-E10「57 passed」实测 **49**（runtime-handlers 实为 10 条）；
  §3-E8「18 条 it(」实测 **10**（`process.emit(` 被误当 `it(`）；§5 回归命令里的 `tests/services/fault-recovery.test.ts` **实测不存在**。
