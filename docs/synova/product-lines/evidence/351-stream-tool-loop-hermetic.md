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

### ② 敌意环境（`LLM_API_KEY=<dummy>`，模拟 CI 有凭据）⇒ **仍 exit 0**
```
$ $env:LLM_API_KEY='sk-dummy-…'; npx vitest run tests/stream-tool-loop.test.ts
 ✓ tests/stream-tool-loop.test.ts (6 tests) 5494ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== VITEST-B-DUMMYKEY-EXIT=0 ===
```
🔴 **判别式 = 【链名判别】**（= 读构造后 `engine.provider.name`，对应代码里的 `chain_name`；
**只读属性，零网络调用**；读数见 §一 [A]/[B]）：
```
修后（`{ fallbackProvider: null }`） ⇒ chain_name = **fake-primary-throws**            （单 provider，链上无真实 provider）
修前（`undefined`，走 env 派生）     ⇒ chain_name = **chain(fake-primary-throws→deepseek)**（真实 provider 在链上）
```

> ⚠️ **自纠（本件初版判据被独立复核员证伪，2026-10-12）**：本件初版在这里写过
> 「日志里**没有** `无 DeepSeek 备用凭据 — failover 未启用` ⇒ 反证构造函数**未走 env 派生**」。**该推理无效。**
> **源码条件**（`buildFallbackProvider`）：那行 `log.info` 只在 `if (!deepseekKey) { … }` 分支内 ⇒
> 打印条件 = **函数被调用 ∧ `LLM_API_KEY` 与 `DEEPSEEK_API_KEY` 均缺失**。
> ② 的环境里 **dummy key 在场** ⇒ **即便构造函数真的走了派生，该行也不会打**
> ⇒ **修前/修后两态都恒 0 行 ⇒ 零判别力**（典型的"无判别力判据"，正是本卡要治的那类病）。
> **复核员正对照（同场地、零网络）**：未修 + 无凭据 ⇒ 该行 **11 行**（说明仪器看得见它）；修后 + 无凭据 ⇒ **0 行**；修后 + dummy ⇒ **0 行**；
>   其 live（未修 + dummy）⇒ **4×401** + `Provider 失败，尝试下一个`，**同样 0 行** ⇒ 直接证明该行不可判别。
> ⇒ **本件已改用【链名判别】，并声明：本件不再以该日志行的有无作为任何结论的依据。**

### ③ 反例（CTO 指定改法：把 7 处的 `null` 去掉）
```
[B] 去 null + dummy 凭据 ⇒ 链名 = chain(fake-primary-throws→deepseek)   ⇒ 真实 provider 在链上
[C] 有可解析的 fallback（= CI 有效凭据的等价物）⇒ 目标断言 含'失败' = false ⇒ **必红**
```
🔴 **[C] 的性质必须写明：它是【断言级仿真】，不是 live 复现** ——
它用一个**本地 fake** 扮演"env 派生出的真 provider 能成功返回"的角色，从而在**离线、零网络**下把
"fallback 可解析 ⇒ 目标断言必红"这一**因果链**跑通。它**不证明**真 provider 真出网（那只有 CI 侧能承担）。
复核员判定：**「[B]/[C] 等价（结构级），不等同（live 级）」** —— `[B]` = 改坏的**机制物证**、`[C]` = 即红的**断言级等价物**。
⇒ 读者**不得**把 `[C]` 读成 live 出网复现。

---

## 四、🔴 边界声明（硬约束遵守：**零真实外网调用**）

本批已立硬约束：**不得为复现读数而发真实外网调用**。据此：

- 反例的**完整"必红"**（改回 `null` 缺失 + **有效**凭据 ⇒ 真出网 ⇒ 断言红）**本卡未复现**，原因有二：
  ① 有效凭据只有 CI 侧有；② 复现它必须**真的发出请求** ⇒ 违反硬约束。
- 本卡给的是**两段合起来等价**的离线证据：
  - **链上确有真实 provider**（`[B]` 链名 = `chain(…→deepseek)`，**只读属性、不调用 `chat()`**）
  - **一旦 fallback 可解析，目标断言必红**（`[C]`，确定性、离线；🔴 **[C] = 断言级仿真，非 live 复现** —— 见 §三③）
- 另有旁证（复核员 live 读数，非本卡产出）：同一 blob 在 CI 上以 `DEEPSEEK_API_KEY=dummy` 跑出
  `(401): Authentication Fails` ⇒ **真出网**（记录为"分工：live 物证 ≠ 离线机理"，不可互相替代）。

---

## 五、影响面

- **恢复的 CI 选测面**：凡经 `conversation-engine` 模块依赖被 `vitest --changed` 选中的 PR（K4-04 #237 的 CI 即因此翻红）⇒ 不再被本文件**无差别拖红**。
- **未覆盖（同族风险，另案）**：3 个 e2e 同样**不传** `fallbackProvider`。**我方原始测量**（命令与输出原文，时点见下）：

```
$ git rev-parse origin/local-main
28ae513dcf1103538d859a61cc9fbcebc2ed1b5d

$ git ls-tree -r --name-only origin/local-main -- <每个文件>          # 三件均 exists = YES

$ git grep -n -E 'new (ConversationEngine|AgentConversation)\(' origin/local-main -- \
    tests/e2e/diagnosis-pipeline.test.ts tests/e2e/diagnosis-pipeline.e2e.test.ts tests/e2e/pde-diagnosis.e2e.test.ts
origin/local-main:tests/e2e/diagnosis-pipeline.test.ts:76:    const engine = new ConversationEngine(fakeProvider(), {
origin/local-main:tests/e2e/diagnosis-pipeline.test.ts:90:    const engine = new ConversationEngine(fakeProvider()); // no diagnosisEngine
origin/local-main:tests/e2e/diagnosis-pipeline.e2e.test.ts:78:    const engine = new ConversationEngine(provider, {
origin/local-main:tests/e2e/pde-diagnosis.e2e.test.ts:100:    const engine = new ConversationEngine(provider, {

$ git grep -c -E 'new (ConversationEngine|AgentConversation)\(' origin/local-main -- <三件>
origin/local-main:tests/e2e/diagnosis-pipeline.e2e.test.ts:1
origin/local-main:tests/e2e/diagnosis-pipeline.test.ts:2
origin/local-main:tests/e2e/pde-diagnosis.e2e.test.ts:1

$ git grep -c -E 'fallbackProvider' origin/local-main -- <三件>
（**0 命中**：三件均为 0）

★ 口径：构造点命中 = **2 / 1 / 1**（合计 4 处）｜ `fallbackProvider` 命中 = **0 / 0 / 0**
★ 读数时点 = `origin/local-main @ 28ae513dcf1103538d859a61cc9fbcebc2ed1b5d`（独立复核员另跑得同数，逐项一致）
★ 边界：本卡**只测未改**这 3 件 —— 它们属**另案**，不在本卡写集
```
- **机制侧**：根因在 `src/agent/conversation-engine.ts` 的自动接线（D363 包装）。**本卡在写集内只修红**；
  「是否改机制（failover 改 opt-in / 非真实 provider 时跳过 env 派生）」= **系统卡**，已由 Lead 上报 CTO，**本卡不碰**。

---

## 六、未决项

1. **机制卡**未立 ⇒ 本卡只治本文件与 3 个 e2e 的**同类暴露**。
2. `package.json` 未动（#347 react 对齐占用）⇒ 本卡无依赖变更。
3. `vitest --changed` 的**模块级选测口径**是否把本文件纳入，取决于 CI 侧；本卡只保证文件自身 hermetic。
