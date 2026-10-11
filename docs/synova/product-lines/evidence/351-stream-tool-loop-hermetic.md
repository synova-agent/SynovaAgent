# 351 · `tests/stream-tool-loop.test.ts` 离线确定性（非 hermetic 根治）

> 卡：Gitea **#351** ｜ 裁决：**CTO 裁定 5 = 甲**（注入面修红）｜ 分支：`fix/351-stream-tool-loop-hermetic`
> base：`local-main @ 28ae513dcf1103538d859a61cc9fbcebc2ed1b5d`
> 判据件 blob（改前）：`617b8ac45bde1d00cb2ab46bfa94ff1363f82cd7`
> 写集：`tests/stream-tool-loop.test.ts`（**只此一件**；`package.json` 未动 —— #347 那条占用）

---

## 一、根因（锚点 = 符号，不是行号）

```
src/agent/conversation-engine.ts :: ConversationEngine 构造函数
    this.provider = wrapProviderWithFailover(
      wrapProviderWithOverflowRecovery(provider, this.compaction),
      config.fallbackProvider !== undefined ? config.fallbackProvider : buildFallbackProvider(provider),
    );

src/agent/conversation-engine.ts :: buildFallbackProvider(primary)
    primaryKind = detectProviderFromUrl(primary.baseUrl)
    primaryKind !== 'deepseek'  ⇒  取 process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY ⇒ createProvider('deepseek', …)
```

测试夹具的 `baseUrl = 'fake://test'` ⇒ `detectProviderFromUrl` 落**默认分支 `'openai'`** ⇒ 走 else 支 ⇒ **去取 deepseek 凭据**。

🔴 **结论：注入 fake 不足以 hermetic** —— 构造函数会在环境有凭据时**自动再挂一个真实 provider**；
主 provider 抛错时链回退到它并**发出真实网络请求**，断言随模型输出漂移。

**探针原始输出（零网络请求；`%TEMP%\synova-351-evidence\probe-351-counterexample.ts`）**

```
[env 存在性，只报布尔] LLM_API_KEY=true DEEPSEEK_API_KEY=false

=== [A] 改后：fallbackProvider: null + dummy 凭据 ===
  链名（读属性，不调用）= fake-primary-throws
  reply = "抱歉，调用失败：Network timeout"
  含'失败' = true  ⇒ 目标用例绿（期望：绿）

=== [B] 改前：不传 fallbackProvider（走 env 派生）+ dummy 凭据 ===
    ⚠️ 只构造 + 读链名；**不调用 chat()** ⇒ 零网络请求
  链名（读属性，不调用）= chain(fake-primary-throws→deepseek)
  ⇒ 链上是否含真实 deepseek provider：**是**

=== [C] 离线确定性必红：fallback 能解析成功时（= CI 有效凭据的等价物）===
  reply = "收到，不过这条信息我读不出具体意图——\"测试错误\"可能是几种情况：…"
  含'失败' = false  ⇒ 目标用例红（期望：**红**）
```

---

## 二、修法（7 处，逐处已核）

```
116→130  beforeEach    : new AgentConversation(fakeProviderWithTools({…}), { fallbackProvider: null })
127→142  const conv2   : new AgentConversation(provider, { fallbackProvider: null })
174→189  const conv2   : 同上
204→219  const conv2   : 同上
222→237  const conv2   : 同上
238→253  const conv2   : 同上
269→284  const conv      : new AgentConversation(provider, { fallbackProvider: null })
```
`git diff --stat` = **1 file changed, 21 insertions(+), 6 deletions(-)**（= 头部说明块 + 7 处构造点；**无其它改动**）。

语义：`EngineConfig.fallbackProvider?: LLMProvider | null`（**公开字段**）取 `null` ⇒ 构造函数**不调** `buildFallbackProvider` ⇒ 链上只有注入的 fake。**不是改夹具**。

---

## 三、判据与原始输出

### ① 无外部依赖环境 ⇒ exit 0（Done 要求）
```
$ npx vitest run tests/stream-tool-loop.test.ts          # env: LLM_API_KEY=false DEEPSEEK_API_KEY=false OPENAI_API_KEY=false
 ✓ tests/stream-tool-loop.test.ts (6 tests) 5750ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== VITEST-A-NOENV-EXIT=0 ===
```

### ② 敌意环境（`LLM_API_KEY=<dummy>`，模拟 CI 有凭据）⇒ **仍 exit 0**（修复的判别力所在）
```
$ $env:LLM_API_KEY='sk-dummy-…'; npx vitest run tests/stream-tool-loop.test.ts
 ✓ tests/stream-tool-loop.test.ts (6 tests) 5494ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== VITEST-B-DUMMYKEY-EXIT=0 ===
```
🔴 日志里**没有** `无 DeepSeek 备用凭据 — failover 未启用`（该行只在 `buildFallbackProvider` 被调用时打）⇒ 反证构造函数**根本没走 env 派生**。

### ③ 反例（CTO 指定改法：把 7 处的 `null` 去掉）
```
[B] 去 null + dummy 凭据 ⇒ 链名 = chain(fake-primary-throws→deepseek)   ⇒ 真实 provider 在链上
[C] 有可解析的 fallback（= CI 有效凭据的等价物）⇒ 目标断言 含'失败' = false ⇒ **必红**
```

---

## 四、🔴 边界声明（硬约束遵守：**零真实外网调用**）

本批已立硬约束：**不得为复现读数而发真实外网调用**。据此：

- 反例的**完整"必红"**（改回 `null` 缺失 + **有效**凭据 ⇒ 真出网 ⇒ 断言红）**本卡未复现**，原因有二：
  ① 有效凭据只有 CI 侧有；② 复现它必须**真的发出请求** ⇒ 违反硬约束。
- 本卡给的是**两段合起来等价**的离线证据：
  - **链上确有真实 provider**（`[B]` 链名 = `chain(…→deepseek)`，**只读属性、不调用 `chat()`**）
  - **一旦 fallback 可解析，目标断言必红**（`[C]`，确定性、离线）
- 另有旁证（复核员 live 读数，非本卡产出）：同一 blob 在 CI 上以 `DEEPSEEK_API_KEY=dummy` 跑出
  `(401): Authentication Fails` ⇒ **真出网**（记录为"分工：live 物证 ≠ 离线机理"，不可互相替代）。

---

## 五、影响面

- **恢复的 CI 选测面**：凡经 `conversation-engine` 模块依赖被 `vitest --changed` 选中的 PR（K4-04 #237 的 CI 即因此翻红）⇒ 不再被本文件**无差别拖红**。
- **未覆盖（同族风险，另案）**：`tests/e2e/diagnosis-pipeline.test.ts`、`tests/e2e/diagnosis-pipeline.e2e.test.ts`、`tests/e2e/pde-diagnosis.e2e.test.ts` 同样不传 `fallbackProvider`（实测 grep 命中）。
- **机制侧**：根因在 `src/agent/conversation-engine.ts` 的自动接线（D363 包装）。**本卡在写集内只修红**；
  「是否改机制（failover 改 opt-in / 非真实 provider 时跳过 env 派生）」= **系统卡**，已由 Lead 上报 CTO，**本卡不碰**。

---

## 六、未决项

1. **机制卡**未立 ⇒ 本卡只治本文件与 3 个 e2e 的**同类暴露**。
2. `package.json` 未动（#347 react 对齐占用）⇒ 本卡无依赖变更。
3. `vitest --changed` 的**模块级选测口径**是否把本文件纳入，取决于 CI 侧；本卡只保证文件自身 hermetic。
