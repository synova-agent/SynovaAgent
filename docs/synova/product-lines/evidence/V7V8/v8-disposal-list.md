# V8 · 处置清单（逐条判「补 runner / 待裁」）

> 卡面约束：**删除 = 覆盖缩减 ⇒ 本卡不许自己删**，只出处置清单 + 证据 + 请裁。
> 本清单把"没在执行的测试"分成 5 组，每组给：**实测证据 → 处置建议 → 归属**。
> 所有红绿数都是本卡实跑；原始输出在 `raw/`。

---

## 总览

| 组 | 规模 | 本卡已做 | 待裁/待另卡 |
|---|---|---|---|
| **D1** 无 include 的 `.test.ts` | 37 | ✅ 已补 runner（include 扩容） | — |
| **D2** 补后新暴露的真红 | 7 | 只报数（**未做任何 exclude 美化**） | 6 项（1 项建议随死代码退役） |
| **D3** 在 include 但收集 0 条 | 3 | 只列证 | 3 项 |
| **D4** CI-only `exclude` 挡住的文件 | 17 | 实测 16/17 已过期 | 17 项 |
| **D5** 从不执行的 `.test.sh` | 71 | 只列证（逐条清单在 `raw/`） | 71 项 |

---

## D1 · 37 个无 include 的文件 —— 已补 runner

处置 = **补 runner**（include 扩容），不是删除。理由：这些不是死代码，是**被漏掉的覆盖面**。

实测（分组隔离跑，给出 exit code）：

| 组 | 文件数 | 结果 | 原始输出 |
|---|---|---|---|
| `extensions/sentinels/**` | 12 | 11 通过 / **1 红** | `raw/v8-groupA-B-run.txt` |
| 单包 `packages/{connector-registry,error-types,extension-registry,sog-core}` | 4 | **4 全通过** | 同上 |
| `packages/test-kit/tests/**` | 21 | 15 通过 / **6 红** | `raw/v8-groupC-testkit-run.txt` |
| **合计** | **37** | **30 通过 / 7 红** | |

→ 净效果：**+330 条通过用例进入执行面**（见 `v8-inventory.md` §2）。

---

## D2 · 补后新暴露的 7 个真红 —— 逐条判

### D2-1 `extensions/sentinels/_extinct/capital-turnover/computes/cash-conversion-cycle.test.ts` （1 failed）

```
FAIL ... > computeCashConversionCycle > should warn when CCC > 90 days
AssertionError: expected 'critical' to be 'warning' // Object.is equality
 ❯ extensions/sentinels/_extinct/capital-turnover/computes/cash-conversion-cycle.test.ts:21:22
```

**判**：路径在 `_extinct/` = **已退役哨兵的死代码测试**（同目录另两个 `_extinct` 测试 `wacc` / `debt-structure` **通过**）。
**建议**：随 `_extinct/` 死代码一并退役（铁律 37）。**这属删除 ⇒ 请裁**。
**归属**：产品线（哨兵域，`extensions/sentinels/**`）｜**不属本卡**（本卡不许删）。

### D2-2~D2-4 `packages/test-kit/tests/architecture/{01-layer-boundaries,02-wiring-audit,04-file-size-audit}.test.ts`

**判**：**早已被登记为存量红**。`ci.yml:361-363` 原文：
> `D565 登记: architecture 套件余 4 文件（01/02/04）存量红（wiring-audit 引用已拆接线、>1000 行文件、l4 import）——从未入 CI 故腐化未察。修复归编码线（CT-51 队列），修复一个入列一个；全绿后本 job 收敛为跑全目录。`

实测吻合（01/02/04 红，03/05 绿）。
**建议**：按 ci.yml 已声明的路径 —— **修复后入列**（编码线 CT-51 队列），不要继续挂豁免。
**归属**：test-kit 包 / 治理线。

### D2-5~D2-7 `packages/test-kit/tests/e2e/{01-diagnosis-journey,02-expert-contribution-journey,03-tui-smoke}.test.ts`

**判**：e2e 套件（诊断旅程 / 专家贡献旅程 / TUI 冒烟）。其中 TUI 冒烟需 headless 终端、诊断旅程需完整管道。
**建议**：**二选一，需裁**——
 (a) 修成可在 CI 无 LLM 环境跑（对齐 `tests/e2e/**` 的 `it.runIf` 自跳过模式）；
 (b) 明确列为"需真 LLM / 需终端"的**不跑集合**，但必须**登记 owner + 到期日**（M-03：只减不增，过期即红），
     且**不能靠 `exclude` 静默消失**（静默 = 判例 V-01 的 L1 冒报 L2）。
**归属**：test-kit 包 / 治理线。

---

## D3 · 3 个"在 include 但收集 0 条"的文件 —— 只列证，待裁

证据（`raw/set-I-include-but-zero-collect-3.txt`）：

| 文件 | 守卫代码 | 后果 |
|---|---|---|
| `tests/e2e/diagnosis-pipeline.e2e.test.ts` | `const SKIP = !isLLMConfigured(); it.runIf(!SKIP)(...)` | 无 LLM key ⇒ `runIf(false)` ⇒ **0 条被收集，文件在报告里整条消失** |
| `tests/e2e/pde-diagnosis.e2e.test.ts` | 同上 | 同上 |
| `tests/sentinel/threshold-manifest-flip.test.ts` | `describe.skipIf(!RUN_FLIP)`，需 `D577_FLIP_TEST=1` | 0 条 |

**为什么这是问题**：`runIf(false)` 让文件**消失**（既不算 pass 也不算 skip），
而成品/审计口径看到的是"这个文件在 include 里" ⇒ 天然误判为"已执行"。
**建议**（任选，**均需裁**）：
 (a) `it.runIf(!SKIP)` → `it.skipIf(SKIP)` ⇒ 变成**可见的 skipped**（保住"看得见"这一性质，覆盖不增加也不减少）；
 (b) 保留现状，但在"执行面"口径里把"收集 0 条"单独计一档，不许并进"已执行"。
**归属**：测试作者 / 产品线（`tests/**`）。
**本卡为什么不直接改**：这是改测试**语义**（是否可见），不是补 runner；且 e2e 的 LLM 依赖是有意设计。

---

## D4 · 17 个 CI-only `exclude` —— 实测 16/17 已过期

`vitest.config.ts` 的 `exclude` **只在 `CI` 环境变量存在时生效** ⇒ 本地与 CI 跑的不是同一套。
实测（本地姿态跑这 17 个文件，`raw/excluded17-run.txt`）：

```
 Test Files  1 failed | 15 passed (17)
      Tests  3 failed | 66 passed | 14 skipped (92)
     Errors  1 error
   EXIT=1
```

| 文件 | 本地结果 | 执行/跳过 | 配置里的 exclude 理由 | 判定 |
|---|---|---|---|---|
| `tests/acceptance/zero-code-industry.test.ts` | ❌ **3 failed** | — | `"零 .ts 文件修改" depends on uncommitted state` | **仍成立**（真红） |
| `tests/circular-dependency.test.ts` | ✅ 5 passed | 5/0 | `Node 24 import resolution` | ⚠️ **已过期**（但见下方 flaky 注） |
| `tests/data-pipeline.feishu.integration.test.ts` | ✅ passed | 1/2 | `Feishu API` | **已过期** |
| `tests/data-pipeline.ingest.integration.test.ts` | ✅ 4 passed | 4/0 | （同上模式） | **已过期** |
| `tests/e2e/auth-register-flow.e2e.test.ts` | ✅ passed | **0/4** | `Needs LLM API` | 已过期但**全 skip**（等于没测） |
| `tests/e2e/checkpoint-e2e.test.ts` | ✅ 4 passed | 4/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/conversation-flow.e2e.test.ts` | ✅ passed | **0/8** | `Needs LLM API` | 已过期但**全 skip** |
| `tests/e2e/customer-flow.e2e.test.ts` | ✅ 5 passed | 5/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/diagnosis-pipeline.test.ts` | ✅ 2 passed | 2/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/entity-resolution-e2e.test.ts` | ✅ 5 passed | 5/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/full-pipeline.integration.test.ts` | ✅ 10 passed | 10/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/ima-knowledge-e2e.test.ts` | ⚠️ **worker 崩** | — | `Needs LLM API` | **仍成立**（`[vitest-pool] Worker forks emitted error`） |
| `tests/e2e/p0-wane-baby.test.ts` | ✅ 9 passed | 9/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/proposal-flow-e2e.test.ts` | ✅ 5 passed | 5/0 | `Needs LLM API` | **已过期** |
| `tests/e2e/sse-diagnosis.integration.test.ts` | ✅ 3 passed | 3/0 | `Needs LLM API` | **已过期** |
| `tests/l4/ontology-loader.test.ts` | ✅ 8 passed | 8/0 | `edge-types session, not ours` | **已过期** |
| `tests/routes/ga-evolution.test.ts` | ✅ 3 passed | 3/0 | `Pre-existing GA failure` | **已过期** |

**判**：`exclude` 表**已腐化** —— 16 条的排除理由在今天的 main 上**不再成立**；
其中 **13 个文件带着 64 条真跑通的用例**被挡在 CI 之外，2 个全 skip（等于没测），
只有 1 个真红（acceptance）+ 1 个 worker 崩（ima-knowledge-e2e）仍成立。

⚠️ **一处诚实告警**：`tests/circular-dependency.test.ts` 在本机**通过**（5/5），
但 S5 尽调在**它的**环境里实测它 **红**（`ENOENT /private/tmp/packages/connector-registry/src/registry.ts`，
与 `/private/tmp/package.json` 坏 JSON 的环境污染同源）
⇒ **该文件红绿依赖环境**，不能凭本机一次通过就判"可删 exclude"。**这一条建议保留排除，直到环境依赖被证实消除。**

**建议**（需裁，本卡不改 `exclude`）：
1. 把 14 个"已过期且真跑通"的条目**移出 `exclude`**（先修 `circular-dependency` 的环境依赖再议它）；
2. 保留 `tests/acceptance/zero-code-industry.test.ts` + `tests/e2e/ima-knowledge-e2e.test.ts` 的排除，
   但**必须登记 owner + 到期日**，且不得续期式常驻（M-03）；
3. 根治"本地与 CI 两套口径"：`exclude` 只在 `CI=1` 生效这一点本身就该收敛（**判据语义变更，须 K3**）。
**归属**：治理线（配置语义）+ 测试作者。

---

## D5 · 71 个从不执行的 `.test.sh` —— 只列证，待裁

- 逐条清单：`raw/set-G-shell-testsh-never-run-71.txt`（`ci.yml` 口径）/ `raw/set-G2-…-70-all-workflows.txt`（全 workflow 口径）。
- 分布：`tests/control-tower/**` 63 · `tests/project/**` 3 · `tests/doc-system/**` 2 · `tests/desktop/**` 1 · `dsh/plugins/**` 1 · 其余 1。
- 性质：多为**控制塔门禁的判别性夹具**（`*-bypass-*`、`hook-*`、`*-gate`、`commit-msg-*` …）。

**🔴 未做的一步（主动列为例外）**：**这 71 个我没有逐个跑出红绿**。
原因：CI 的 `Control Tower Gate Tests` job 跑其中 59 个的实测耗时是 **13 分钟**
（`ci.yml:491` `timeout-minutes: 13`）⇒ 71 个约 15–20 分钟，且其中多个夹具会**操作 git 仓库**
（在仓内跑有污染工作树的风险）。**这一格是空的，不拿"看起来像夹具"充数**（判例 V-08：造不出来就说造不出来）。

**可判的部分（不含运行结果）**：
1. `tests/control-tower/**` 的 63 个里，有 59 个**属于双份清单同源的那批**（已跑）⇒ 剩余的是**从未进过 canary 清单**的。 
2. `ci.yml:510-520` 自己登记了一个**已知幽灵**：`tests/win/vitest-log-level.test.sh`（占位不执行）。
3. 与 D4 同族：这些 `.test.sh` 的"该不该跑"是**门禁覆盖面策略**，不是本卡能单方面定的。

**建议**（需裁）：
- 逐条判"**进 canary 清单**（`ci.yml` 的 `for t in`）或 **归档/删除**"；
- 判据必须**机器可判**：`bash <file>` 在干净检出上 exit 0，且该文件在 `ci.yml` 全文中出现过（登记闸口径）。
**归属**：治理线（`.github/**` 是 A 槽）+ 控制塔。
**另**：`desktop-build.yml:118` 跑的 `tests/desktop/verify-package-signature.test.sh` **只在 `push: main` 触发**，
不在 PR 门禁面 ⇒ 建议同步进 PR 面（否则坏包在 PR 阶段不可拦）。
