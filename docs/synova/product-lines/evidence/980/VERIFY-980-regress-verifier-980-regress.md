# VERIFY-980-regress · 自验γ — 全量回归/爆炸半径 + 门禁 + 证据复跑

> **本席身份**：独立自验员 γ（`verifier-980-regress`），**未参与** #980 的任何编写、未参与 V1–V6 判据复现（那是自验 β 的活）。
> **本席只读产品代码**：全程未改 `src/**`、`tests/**`、`scripts/**`、`extensions/**`、`packages/**`；未 commit / push / stash / `--no-reverify`；未使用 `--no-verify`。
> **本席唯一写过的仓库文件** = 本报告。
> **本报告不给「通过」判定**，只给观察到的事实 + 退出码 + `自验结论`。

---

## 0. 被验证版本与前提（本席**现场现查**，未采信任何转述）

| 项 | 本席实测值 | 命令 |
|---|---|---|
| 被验证 sha | `d7a30755fdaeeac8a3884b8d274800a15b56748b` | `git rev-parse HEAD` |
| 分支 | `feat/win-0-6-schema-degraded` | `git rev-parse --abbrev-ref HEAD` |
| 产品承重文件 sha256 | `741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167` | `sha256sum src/l4/sog-schema-validator.ts` |
| 该 sha 与卡面冻结值 | **逐字符一致** ✅ | 同上 |
| 工作树起始状态 | 干净（`git status --porcelain` 空，exit=0） | `git status --porcelain` |

**⚠️ 版本关系（与队长口径不符，依实报）**：
- `git log --oneline -1 origin/main` → `441c3004b Merge pull request #1354 from synova-agent/fix/1052-file-guard-wiring`
- `git rev-list --count HEAD..origin/main` → **9**（exit=0）
- `git merge-base --is-ancestor origin/main HEAD` → **exit=1**（origin/main **不是** HEAD 的祖先）
- `git reflog show origin/main -n 5` → `@{0}=441c3004b`（fetch --no-tags origin main --quiet: fast-forward）；`@{1}=ce5507826`（队长那次 merge 拉进来的）

⇒ **被验证 sha `d7a30755f` 相对当时 origin/main `441c3004b` 落后 9 条**。下列 A/B/C/D 结论**只在 `d7a30755f` 上成立**；merge 之后是否仍成立，本席**未验证**（见 §7）。

**分支自身改动面（相对 merge-base `ce5507826`，本席实查）**：
```
$ git diff --stat ce5507826 HEAD -- src/ tests/
 src/l4/sog-schema-validator.ts                    |  99 ++++++++++-
 tests/l4/sog-schema-validator.integration.test.ts | 195 ++++++++++++++++++++++
 tests/l4/sog-schema-validator.test.ts             | 164 ++++++++++++++++++++++
 3 files changed, 454 insertions(+), 4 deletions(-)
文件数 = 3
```
⇒ **产品改动面 = 1 个源文件 + 2 个测试文件**；其余 14 件为治理/证据产物（全量 17 件）。

**并发纪律**：重型步骤（tsc / vitest）**串行**执行，每步前后自动 `tasklist //FI "IMAGENAME eq node.exe"` 存档。全程 `node.exe` 只有 3 个常驻 **Codex runtime** 进程（PID 7304/4624/15572，各 ~28–30MB，见下文各步快照）；tsc 期间另见 1 个 510,944K 的 node（PID 4136）为**本席自己的 tsc**。**未与任何其他席位的重载并发。**

---

## A. tsc —— 证明「零**新增**」而非「零报错」

```
$ npx tsc --noEmit --pretty false          # 完整输出存 A-tsc.txt（39 行）
### CWD: /d/novis-backup-20260526/Novis/.synova-wt-980
### HEAD: d7a30755fdaeeac8a3884b8d274800a15b56748b
### TSC_VERSION: Version 5.9.3
### START: 2026-10-08T02:45:41+08:00
### END:   2026-10-08T02:45:54+08:00        # 13 秒
### TSC_EXIT=2
### error TS count: 28
```

**完整原始输出（28 条，逐条，未截断）**——按文件归类：

`extensions/sentinels/_extinct/**`（**25 条**）：
```
extensions/sentinels/_extinct/adaptation-velocity/aggregate.ts(1,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/adaptation-velocity/aggregate.ts(2,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/adaptation-velocity/aggregate.ts(22,158): error TS7006: Parameter 'n' implicitly has an 'any' type.
extensions/sentinels/_extinct/capital-efficiency/aggregate.ts(7,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/capital-efficiency/aggregate.ts(8,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/capital-structure/aggregate.ts(4,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/capital-structure/aggregate.ts(5,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/capital-turnover/aggregate.ts(1,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/capital-turnover/aggregate.ts(2,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-dynamics/aggregate.ts(4,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-dynamics/aggregate.ts(5,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-dynamics/aggregate.ts(28,164): error TS7006: Parameter 'n' implicitly has an 'any' type.
extensions/sentinels/_extinct/competitive-moat-perceptual/aggregate.ts(1,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-moat-perceptual/aggregate.ts(2,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-moat-structural/aggregate.ts(1,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-moat-structural/aggregate.ts(2,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/competitive-moat-structural/aggregate.ts(56,47): error TS7006: Parameter 's' implicitly has an 'any' type.
extensions/sentinels/_extinct/competitive-moat-structural/aggregate.ts(56,50): error TS7006: Parameter 'e' implicitly has an 'any' type.
extensions/sentinels/_extinct/connector-coverage/aggregate.ts(1,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/connector-coverage/aggregate.ts(2,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/market-lifecycle/aggregate.ts(4,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/market-lifecycle/aggregate.ts(5,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
extensions/sentinels/_extinct/market-lifecycle/aggregate.ts(27,164): error TS7006: Parameter 'n' implicitly has an 'any' type.
extensions/sentinels/_extinct/structural-change/aggregate.ts(4,38): error TS2307: Cannot find module '../../../src/sentinel/types' or its corresponding type declarations.
extensions/sentinels/_extinct/structural-change/aggregate.ts(5,37): error TS2307: Cannot find module '../../../src/l4/graph-traversal' or its corresponding type declarations.
```
`src/connectors/ima.ts`（**1 条**）：
```
src/connectors/ima.ts(143,64): error TS2345: Argument of type 'string' is not assignable to parameter of type '"strategy" | "operations" | "meetings"'.
```
`src/server.ts`（**2 条**，含 3 行续行）：
```
src/server.ts(163,18): error TS2345: Argument of type 'MainAgent' is not assignable to parameter of type 'MainAgentLike'.
  The types returned by 'executeLoop(...)' are incompatible between these types.
    Type 'Promise<LoopExecutionRecord>' is not assignable to type 'Promise<{ ok: boolean; error?: string | undefined; }>'.
      Property 'ok' is missing in type 'LoopExecutionRecord' but required in type '{ ok: boolean; error?: string | undefined; }'.
src/server.ts(523,22): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'GraphBridgeLike'.
```

### 归类结论
- `extensions/sentinels/_extinct/**` = **25**；`src/connectors/ima.ts` = **1**；`src/server.ts` = **2**；合计 **28** ✅（= `grep -c 'error TS'`）
- **指向 `src/l4/sog-schema-validator.ts` 或 `tests/l4/sog-schema-validator*.test.ts` 的错误 = 0 条**
- 补充（类型图层面）：该文件唯一类型消费方 `src/l4/graph-bridge.ts`（`import { validateAndLog }`）**零诊断**。

> **✅ 新增错误条数 = 0**（口径：按文件族归类；28 条全部落在卡面给定的基线族内）。
>
> **退出码说明（原样并存）**：脚本内记录 `### TSC_EXIT=2`；`tsc` 在 `--noEmit` 且存在诊断时返回 `ExitStatus.DiagnosticsPresent_OutputsSkipped = 2`，与观察一致。pwsh 后台包装层另报 `exit code 1`——**包装层差异，原样记录，不解释为本席命令失败**。

**局限（必须写清）**：**未**在 pristine 基线树上重跑 tsc（主树 `D:\novis-backup-20260526\Novis` 处于 `main`@`16996d490`，但**无 `node_modules`、无 `tsconfig.json`**，不具备重跑条件）。判据「零新增」建立在**文件族归类 + 变更集零诊断 + 唯一消费方零诊断**三条之上。

---

## B. 爆炸半径（串行，一次 ≤1 个 vitest）

### B1 直连面 `tests/l4/`
```
$ npx vitest run tests/l4/
### HEAD: d7a30755fdaeeac8a3884b8d274800a15b56748b
### START: 2026-10-08T02:46:21+08:00  ### END: 2026-10-08T02:46:27+08:00
### tasklist node BEFORE / AFTER: node.exe 7304(28,008K) 4624(29,208K) 15572(30,124K)  ← 前后完全一致，无他席重载
 Test Files  28 passed (28)
      Tests  221 passed (221)
   Duration  3.60s (transform 33%, import 31%, tests 28%, worker 7%)
### EXIT CODE = 0
```
其中直接相关两件：
```
 ✓ tests/l4/sog-schema-validator.test.ts (7 tests) 19ms
 ✓ tests/l4/sog-schema-validator.integration.test.ts (4 tests) 328ms
```
> 观察：`tests/l4/ontology-loader.test.ts` 本机**未**走 CI 排除（`vitest.config.ts:29` 仅当 `CI` 置位才排除），实测 **8 tests passed**。

### B2 调用方面 `tests/contract/l4-contract.test.ts`
```
$ npx vitest run tests/contract/l4-contract.test.ts
### START: 2026-10-08T02:46:36  ### END: 2026-10-08T02:46:38
### tasklist node BEFORE / AFTER: 同上 3 进程，完全一致
 Test Files  1 passed (1)
      Tests  13 passed (13)
   Duration  385ms
### EXIT CODE = 0
```

### B3 消费面 `tests/l4/graph-bridge.test.ts`
```
$ npx vitest run tests/l4/graph-bridge.test.ts
### START: 2026-10-08T02:46:39  ### END: 2026-10-08T02:46:41
### tasklist node BEFORE / AFTER: 同上 3 进程，完全一致
 Test Files  1 passed (1)
      Tests  31 passed (31)
   Duration  389ms
### EXIT CODE = 0
```
⇒ `graph-bridge.ts:82` 忽略返回值 ⇒ 未见行为变化，**实测支持**卡面「预期不受影响」。

### B4 test-kit 架构族 —— **⚠️ 卡面前提不成立，已按实际 CI 面调整**

**卡面写**：`cd packages/test-kit && npx vitest run tests/architecture/ tests/wire/`（称对应 CI 必需检查 `Test-Kit Architecture Tests`）。
**实查（`.github/workflows/ci.yml`）该 job 的真实执行面**：
```
ci.yml:471  test-kit-architecture:
ci.yml:474    name: Test-Kit Architecture Tests (${{ matrix.os }})
ci.yml:542      - name: Install test-kit deps
ci.yml:545        run: bash "$GITHUB_WORKSPACE/scripts/control-tower/install-deps.sh" --prefix .
ci.yml:546      - name: Run ratchet baseline test (05-as-any-audit)
ci.yml:549        run: npx vitest run tests/architecture/05-as-any-audit.test.ts
ci.yml:545-549  # D565 登记: architecture 套件余 4 文件（01/02/04）存量红（wiring-audit 引用已
                # 拆接线、>1000 行文件、l4 import）——从未入 CI 故腐化未察。
```
⇒ **CI 只跑 `05-as-any-audit.test.ts` 一个文件**，**不是** `tests/architecture/` 整目录。`packages/test-kit/node_modules` 本机**不存在**（CI 靠 `install-deps.sh --prefix .` 先装；本机由 root `node_modules` 解析）。

**B4a — CI 权威面（真实 CI 口径）**
```
$ cd packages/test-kit && npx vitest run tests/architecture/05-as-any-audit.test.ts
 RUN  v5.0.2 D:/novis-backup-20260526/Novis/.synova-wt-980/packages/test-kit
 ✓ tests/architecture/05-as-any-audit.test.ts (6 tests) 340ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  629ms
### EXIT CODE = 0
```

**B4b — 卡面点名的 `tests/wire/`**
```
$ cd packages/test-kit && npx vitest run tests/wire/
 ✓ tests/wire/04-graphstore-compatibility.test.ts (3 tests) 7ms
 ✓ tests/wire/05-graphbridge-wiring.test.ts (6 tests) 268ms
 Test Files  2 passed (2)
      Tests  9 passed (9)
   Duration  538ms
### EXIT CODE = 0
```

**B4c — 卡面点名的 `tests/architecture/` 整目录（含 ci.yml 已登记的存量红）**
```
$ cd packages/test-kit && npx vitest run tests/architecture/
 ❯ tests/architecture/02-wiring-audit.test.ts (35 tests | 2 failed) 44ms
 ❯ tests/architecture/04-file-size-audit.test.ts (2 tests | 1 failed) 22ms
 ❯ tests/architecture/01-layer-boundaries.test.ts (74 tests | 1 failed) 199ms
 ✓ tests/architecture/03-vendor-reference.test.ts (1 test) 113ms
 ✓ tests/architecture/05-as-any-audit.test.ts (6 tests) 413ms
 Test Files  3 failed | 2 passed (5)
      Tests  4 failed | 114 passed (118)
### EXIT CODE = 1
```
4 条失败原文：
```
FAIL 01-layer-boundaries.test.ts > 铁律 39 > L2 编排层 > 不应 import ../l4/
AssertionError: expected [ …(2) ] to deeply equal []
+ [ "…\src\agent\knowledge-bridge-service.ts", "…\src\agent\workspace-context-bridge.ts" ]
 ❯ tests/architecture/01-layer-boundaries.test.ts:69:32

FAIL 02-wiring-audit.test.ts > 铁律 0-2 Step 5 > Critical 接线 > FederalReporter → 被 [src/server.ts] 引用
FAIL 02-wiring-audit.test.ts > 铁律 0-2 Step 5 > Critical 接线 > createOrchestrationWiring → 被 [src/server.ts] 引用
AssertionError: expected 0 to be greater than 0
 ❯ tests/architecture/02-wiring-audit.test.ts:28:22

FAIL 04-file-size-audit.test.ts > 铁律 37 > 无 >1000 行源文件（硬阻断）
AssertionError: expected [ …(2) ] to deeply equal []
+ [ "src\deploy\bootstrap.ts: 1337 行", "src\sentinel\runner.ts: 1543 行" ]
 ❯ tests/architecture/04-file-size-audit.test.ts:29:23
```

**B4c 失败归类 = ② 存量（三条独立证据，本席实查）**：
1. **测试套件逐字未动**：`git diff --stat origin/main HEAD -- packages/test-kit/` → **空（0 文件）** ⇒ 测试代码与 `origin/main` 逐字相同。
2. **失败断言点名的件逐条核对**：
   - `01`：`src/agent/knowledge-bridge-service.ts` HEAD=`f3add0c8fcb2` / main=`f3add0c8fcb2` **SAME**；`src/agent/workspace-context-bridge.ts` HEAD=`77746b610178` / main=`77746b610178` **SAME**
   - `02`：依赖的 `src/server.ts` HEAD=`801b536760bd` / main=`801b536760bd` **SAME**
   - `04`：`src/deploy/bootstrap.ts` HEAD=**1337 行** / main=**1341 行**（两者均 >1000 ⇒ 判定相同）；`src/sentinel/runner.ts` HEAD=**1543 行** / main=**1543 行**
3. **仓内自证登记**：`ci.yml:545-549` 明文「D565 登记: architecture 套件余 4 文件（01/02/04）**存量红**」。本席实测失败文件集 = {01, 02, 04}，**与登记集逐字一致**。

> **B4 结论**：CI 权威面（B4a）**绿**；卡面点名的 `tests/wire/`（B4b）**绿**；卡面点名的 `tests/architecture/` 整目录（B4c）**红，但 4 条全部为仓内已登记存量红，且其全部输入在 origin/main 上逐字相同**。

### B5 全量两片（串行；`--shard=1/2` 后 `--shard=2/2`）

**B5a `--shard=1/2`**
```
### START: 2026-10-08T02:51:00  ### END: 2026-10-08T02:51:44 （43.77s）
### tasklist node BEFORE / AFTER: 同上 3 进程，完全一致
 Test Files  4 failed | 311 passed | 1 skipped (316)
      Tests  13 failed | 2479 passed | 9 skipped (2501)
   Duration  43.77s
### EXIT CODE = 1
```
失败文件（4）：
```
❯ tests/agent/context-compaction.test.ts          (18 tests | 2 failed)
❯ tests/golden-scenarios/gss-common.test.ts       (13 tests | 8 failed)
❯ tests/loops/ga-calibration-evolution.test.ts    ( 9 tests | 2 failed)
❯ tests/electron/mac-install-verify.test.ts       (10 tests | 1 failed)
```

**B5b `--shard=2/2`**
```
### START: 2026-10-08T02:51:48  ### END: 2026-10-08T02:54:36 （167.71s）
### tasklist node BEFORE / AFTER: 同上 3 进程，完全一致
 Test Files  4 failed | 310 passed | 2 skipped (316)
      Tests  11 failed | 2315 passed | 17 skipped (2343)
   Duration  167.71s
### EXIT CODE = 1
```
失败文件（4）：
```
❯ tests/routes/workspace-goal-creation.integration.test.ts [ 文件级 ]（15 tests 全 ✓，afterAll 抛错）
❯ tests/acceptance/zero-code-industry.test.ts     ( 5 tests | 2 failed)
❯ tests/architecture/check-architecture-gate.test.ts (12 tests | 8 failed) 163475ms
❯ tests/l3/graphbridge-wiring.test.ts             ( 3 tests | 1 failed)
```

**两片合计**：316×2 文件条目（同一套被两片各自分区）；失败 **8 个文件 / 24 例**（shard1 13 + shard2 11 = 24 测试级；`workspace-goal-creation` 为文件级 `afterAll` 错误，其 15 个用例本身全 ✓）。

---

## B 段失败归类（逐条，附证据）

### ① 与 #980 写集相关 = **0 条**

**判别依据（本席实查，非推理）**：
```
$ git diff --name-only ce5507826 HEAD -- src/ tests/
src/l4/sog-schema-validator.ts
tests/l4/sog-schema-validator.integration.test.ts
tests/l4/sog-schema-validator.test.ts
```
本分支自己的产品改动**只有 3 个文件**。8 个失败测试件**无一**在其中。

### ② 存量（有证据）—— 6 个文件

| 失败文件 | 例数 | 存量证据（本席实查） |
|---|---|---|
| `tests/l3/graphbridge-wiring.test.ts` | 1 | ① `docs/synova/coordination/board-backlog.json:240` 登记件 `PLAN-graphbridge-wiring-red`，**逐字描述同一失败**「`tests/l3/graphbridge-wiring.test.ts:79` `expect(graphNodes.length).toBe(1)` 收到 0」；② `docs/synova/coordination/FIX-014-Vitest既有红-处置卡-20260926.md:30`「唯一失败用例：`tests/l3/graphbridge-wiring.test.ts:79` — `expect(graphNodes.length).toBe(1)` 收到 `0`」；③ `docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md:470`「本地 3 个存量红（zero-code-industry ×2、graphbridge-wiring ×1）**改前即红（基线自带）**，非本卡引入」；④ `docs/synova/audit-reports/2026-09-21-K3-D862.md:301`（**K3 独立审计**）「失败集逐条（两树**逐字相同**）：zero-code-industry(2)、…、graphbridge-wiring(1)、… 共 17 例，全部为**既存环境依赖失败**」；⑤ `docs/synova/audit/SYNOVA-AUDIT-REPORT-20260722.md:194` 同族（2026-07 即已记录）。**实测复现**：单文件重跑 `npx vitest run tests/l3/graphbridge-wiring.test.ts` → `### EXIT CODE = 1`（确定性复现） |
| `tests/acceptance/zero-code-industry.test.ts` | 2 | 同上 ④ K3 D862（两树逐字相同，既存）；同上 ③（改前即红） |
| `tests/architecture/check-architecture-gate.test.ts` | 8 | `docs/synova/product-lines/evidence/D947-20260924/D947-verifier-pr1.md:433`「`expected '…架构边界检查 (铁律 39)…' to contain 'routes/new-violation.ts:1'` 等 **8 条**（门禁脚本输出断言）」、`:461`「`EXIT=1 … 8 failed \| 4 passed（90.18s）`」——**失败数与通过数与本席实测完全一致** |
| `tests/golden-scenarios/gss-common.test.ts` | 8 | `docs/synova/coordination/审计发现台账-DSH-CTO.md:256` 明列 ② DSH 线存量红含 `tests/golden-scenarios/gss-common.test.ts` |
| `tests/loops/ga-calibration-evolution.test.ts` | 2 | 同上台账 :256 ① 线明列 `tests/loops/{ga-calibration-evolution,stagnation-detection}.test.ts` |
| `tests/electron/mac-install-verify.test.ts` | 1 | 同上台账 :256 ② 线明列 `tests/electron/{backend-spawn,desktop-build,mac-install-verify}.test.ts` |

**结构性证据（对全部 8 件成立，本席实查）**：
```
$ for f in <8 个失败测试文件>; do sha256(HEAD:$f) vs sha256(origin/main:$f); done
context-compaction.test.ts                       SAME
gss-common.test.ts                               SAME
ga-calibration-evolution.test.ts                 SAME
mac-install-verify.test.ts                       SAME
workspace-goal-creation.integration.test.ts      SAME
zero-code-industry.test.ts                       SAME
check-architecture-gate.test.ts                  SAME
graphbridge-wiring.test.ts                       SAME
```
```
src/l4/graph-bridge.ts         HEAD=bfd4c26381 / main=bfd4c26381  SAME
src/orchestrator/module-runner.ts HEAD=0ffc98f2ae / main=0ffc98f2ae  SAME
src/agent/context-compaction.ts   HEAD=6bad520bd8 / main=6bad520bd8  SAME
```
⇒ `graphbridge-wiring` 的**全部直接被测件（测试件 + `graph-bridge.ts` + `module-runner.ts`）与 origin/main 逐字相同**；该改动链上唯一的差异件是 `src/l4/sog-schema-validator.ts`（HEAD `741f671bba` vs main `48dc2cad61`）。**该失败在本卡之前即已登记在案（2026-07 至 2026-09 多次），故归类存量**；本席**未**在 origin/main 上直接重跑该文件（见 §7 局限）。

### ③ 环境（Windows）—— 2 个文件

| 失败文件 | 例数 | 原始证据（逐字） |
|---|---|---|
| `tests/routes/workspace-goal-creation.integration.test.ts` | 文件级（15 用例全 ✓） | `Error: EPERM, Permission denied: \\?\C:\Users\ADMINI~1\AppData\Local\Temp\d1322-QRIhG6` @ `:188` ← `if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });`（**Windows 临时目录删除 EPERM**，非断言失败）。该件属 **#1322** 卡写集，非 #980 写集 |
| `tests/loops/ga-calibration-evolution.test.ts` | 2 | `Error: EPERM, Permission denied: \\?\C:\Users\ADMINI~1\AppData\Local\Temp\d556-agent-mem-1560-orme27zfms.db '\\?\...\d556-agent-mem-1560-orme27zfms.db'` @ `:80`（**Windows 临时 db 句柄 EPERM**）。同一文件亦已被 ② 登记为存量红 |
| （附）`tests/electron/mac-install-verify.test.ts` | 1 | `AssertionError: expected +0 not to be +0` @ `:22`「脚本存在且可执行（stat mode 含执行位）」——**macOS 专属断言跑在 Windows** |

### ④ 未找到存量登记者 —— 1 个文件（**如实存疑，不洗白**）

| 失败文件 | 例数 | 本席掌握的全部事实 |
|---|---|---|
| `tests/agent/context-compaction.test.ts` | 2 | 失败原文：① `未超 threshold 不触发 — 返回 null 且消息零变动` @ `:95`；② `summarizer 抛错 → 恰一次 end(ok:false)…` @ `:410:48`，报 `Error: Promise returned by expect(actual).resolves.not.toBeNull() was not awaited. This assertion is asynchronous and must be awaited`（**测试自身漏 await**）。<br>实查：该测试件与 `src/agent/context-compaction.ts` **均与 origin/main 逐字相同**；`git diff --name-only ce5507826 HEAD -- src/agent/context-compaction.ts` → **0**（本分支未碰）。<br>**本席未在 ① ② ③ 任一登记处找到它。** ⇒ 归类为**「独立于本卡，但存量身份未获登记证据」**，不作「存量」断言。 |

### B 段小结
- **① 与本卡写集相关 = 0 条**（24 例无一落在 3 文件改动面内）。
- 存量 = 6 件 / 22 例（含 K3 两树逐字相同背书）；环境 = 2 件 / 3 例；未登记存疑 = 1 件 / 2 例。
- **本卡直接面（B1/B2/B3）全绿**；`tests/l4/` 221 测试全绿；唯二受影响文件（sog-schema-validator + graph-bridge）均零失败。

---

## C. 门禁复核（干净工作树上直接跑，未改任何脚本）

### C1 `bash scripts/pre-commit-check.sh` → **exit 1**
```
### START: 2026-10-08T02:47:53   ### END: 2026-10-08T02:49:29
### --- git status --porcelain BEFORE ---   （空）
### --- tasklist node BEFORE/AFTER ---      （同上 3 进程，完全一致）

  Loop Engineering V4.5.1 — pre-commit (13 组 + 免疫 + plan-integrity)
── 组 1/13: 类型安全 + 硬编码数据 ──
── 组 2/13: 测试质量 ──
── 组 3/13: Secrets ──
── 组 4/13: 接线完整性 ──
── 组 5/13: 架构边界 + 桥接文件 ──
── 组 6/13: Task Brief (6 核心字段) ──
  ✅ 声明闸① brief schema（Q1–Q3/架构层/Done/骨架/Q0c；D1220 退时间戳+Q0）
  ❌ 声明闸③ Done 可证伪（每项 - [x] 带 verify:；D1148）: 6 处  [硬阻断]
     ❌ Done 可证伪性: 6 项 Done 中 6 项缺 verify:  [硬阻断]
     - [x] V1 真 HTTP 提方向→选定后 `graph_nodes` 新增 GOAL（`type='GOAL'` 且 `props.goalId`=新 id）
     - [x] V2 真 HTTP GET 读回 `metrics[0].targetValue` = 提交值（非常量 100）
     - [x] V3 两 org 互不可见，且两条 `props.orgId` 互不相同、都不等于 'default'
     - [x] V4 三条反例逐条实测（变异 → 红 → 还原 → 绿），前后原始输出入 PR 正文
     - [x] V5 store 不可用 ⇒ `degraded:true` + `log.warn/error`（不静默、不假成功）
── 组 7/13: 架构合规 ──
  ✅ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口
── 组 8/13 / 组 9/13 / 组 10/13 ──
── 组 12/13: Task Scope 一致性 ──
  ❌ 声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）: 4 处  [硬阻断]
     ✅ Q2 排除项均含文件路径
     ✅ Q2 排除项: 声明不改的文件未在本次提交中出现
     ✅ Done verify 格式: 6 条已列出
     ❌ plan-integrity: 1 items failed - commit rejected
── 组 13/13: 技能同步一致性 ──

  ❌ 2 组未通过 — 提交已拒绝
### EXIT CODE = 1
### --- git status --porcelain AFTER ---   （空 ⇒ 门禁零残留污染）
```

**⚠️ 原样记录（卡面已预警，本席如实照录，未改任何脚本）**：
**组 6 报出的 6 项 Done 不是 #980 的 Done**——它们讲 `graph_nodes` 新增 GOAL / `props.orgId` / 两 org 互不可见，**属 #1322 卡**（实查：`grep -rl 'props.orgId' .claude/task-briefs/` → `.claude/task-briefs/2026-10-08-1322-goal-creation-entry.md`）。即**门禁解析到了别人的 brief**。

**本席追加的定位实验（只读，未改脚本）**：
```
$ bash scripts/workflow/resolve-commit-brief.sh ""                      # = 本席 C1 的空暂存口径
D:/…/.claude/task-briefs/2026-10-08-1322-goal-creation-entry.md        # ← 别人的卡
$ bash scripts/workflow/resolve-commit-brief.sh "<#980 的 4 个文件集>"
D:/…/.claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md         # ← #980 的卡 ✅
$ bash scripts/workflow/resolve-commit-brief.sh --session session-5fcb4d99-51c1-4242-936d-70216677262e "<同 4 文件>"
D:/…/.claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md         # ← 仍为 #980 的卡 ✅
```
机制（读 `scripts/workflow/resolve-commit-brief.sh` + `scripts/pre-commit-check.sh:949`）：
- `pre-commit-check.sh:949` = `resolve-commit-brief.sh "${DECL_SCOPE:-$STAGED_ALL}" 2>/dev/null`（**无 `--session`，且吞 stderr**）
- `:417` `STAGED_ALL` 源自 git 缓存名集；本席只读工作树**无暂存** ⇒ 空集
- 空集 ⇒ 认领计数全为 0 ⇒ 走过 `:358` **日期回退**（挑「最新日期且可解析」的 brief）⇒ 落到 #1322
- `.claude/current-brief` **不存在**，且**被 `.gitignore:30` 忽略**（`git check-ignore -v` → `.gitignore:30:.claude/current-brief*`）
- 旁证：resolver 对本仓大量 brief 打 `Q2-PARSE-WARN … 反引号包裹残留 ⇒ 恒不中`（含 #980 brief 的 Q2 各条）

> **C1 结论（只写观察到的事实 + 退出码）**：`bash scripts/pre-commit-check.sh` 在**无暂存**的只读工作树上 **exit=1**，失败 2 组（组 6 Done 可证伪、组 12 plan-integrity）。**根因是 brief 解析落到他卡**，而非 #980 的改动面 —— 证据：同名解析器在**给出 #980 文件集时**（含 `--session` 口径）**稳定解析回 #980 的 brief**。
> **诚实边界**：本席**未**在「文件已暂存」的真实提交态下重跑门禁（暂存会改动共享工作树 index，超出本席只读授权）⇒ **「组 6/组 12 在正确 brief 下是否仍红」本席无法证实**（见 §7）。

### C2 `bash scripts/check-architecture.sh` → **exit 0**
```
### START: 2026-10-08T02:49:29   ### END: 2026-10-08T02:49:38
### --- git status --porcelain BEFORE ---   （空）
═══ 架构边界检查 (铁律 39) ═══
  ✅ L2→L4 边界: 无直接引用
  ⚠ L1 扫描目标缺失(跳过): src/tui-v3
─── 1b. L1→L3 跨层引用 ───
  ⚠ 存量违规 9 处 (基线棘轮内, 不阻断——修复后请收紧 tests/architecture/l1-cross-layer-baseline.txt)
     src/routes/conversations.ts:120 / src/routes/diagnosis.ts:278 / src/routes/evolution.ts:68 /
     src/tui-v2/chat.tsx:187 / src/mcp/skill-installer.ts:126 / src/server.ts:253 / src/server.ts:254 /
     src/server.ts:321 / src/server.ts:323
─── 1c. L1→L4 跨层引用 ───
  ⚠ 存量违规 10 处 (基线棘轮内, 不阻断)   [src/routes/chat.ts:49 / evolution.ts:61 / ga-annotations.ts:38 /
     ga-calibration.ts:70 / ga-corrections.ts:9 / knowledge-ask.ts:39 / ontology-admin.ts:16 /
     src/tui-v2/chat.tsx:57 / src/mcp/tool-definitions.ts:393 / src/mcp/tool-registration.ts:104]
─── 1d. L1→L5 跨层引用 ───
  ⚠ 存量违规 19 处 (基线棘轮内, 不阻断)   [routes/chat.ts:29 / conversations.ts:98 / diagnosis.ts:332,676,835,860 /
     evolution.ts:62 / ga-annotations.ts:39 / ga-calibration.ts:71 / ga-corrections.ts:10 / im.ts:42,43 /
     knowledge-ask.ts:38 / mcp/tool-definitions.ts:383,423,428 / mcp/tool-registration.ts:105 /
     src/l1/im-inbound.ts:171 / src/server.ts:495]
  ✅ L3→L5 边界: 无直接数据库操作
  ⚠  GraphStore 在 graph-bridge.ts 声明 (1处, 类型镜像自退役的 engine-core)
  ✅ 多租户安全: query 调用均传递 graph

  架构检查: 全部通过 ✅
### EXIT CODE = 0
### --- git status --porcelain AFTER ---   （空）
```
> **C2 结论**：exit=0。三处 ⚠ 均为**基线棘轮内存量**（脚本自述「不阻断」），**未新增跨层 import** —— 与本卡「只改 `src/l4/` 内部一文件」一致。

---

## D. 双份证据核验（M6）

### D1 证据件是否**真在 git 里**

```
$ git ls-files docs/synova/product-lines/evidence/980/     # exit=0，12 件全部在库
docs/synova/product-lines/evidence/980/ENV-980-better-sqlite3-workaround.md
docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md
docs/synova/product-lines/evidence/980/RECEIPT-980-plan-20261008.md
docs/synova/product-lines/evidence/980/VERIFY-980-acceptance-verifier-980-accept.md
docs/synova/product-lines/evidence/980/VERIFY-980-env-verifier-980-env.md
docs/synova/product-lines/evidence/980/VERIFY-980-plan-verifier-980.md
docs/synova/product-lines/evidence/980/assemble-evidence.sh
docs/synova/product-lines/evidence/980/capture-980-preconditions.sh
docs/synova/product-lines/evidence/980/capture-980-probe.sh
docs/synova/product-lines/evidence/980/evidence-980-plan-preconditions.txt
docs/synova/product-lines/evidence/980/evidence-980-probe-run.txt
docs/synova/product-lines/evidence/980/probe-diagnosis.ts

$ ls -la docs/synova/product-lines/evidence/980/            # 12 个文件，无多余件
$ git status --porcelain --ignored docs/synova/product-lines/evidence/980/   # 空 ⇒ 无未跟踪/被忽略残留
```
⇒ **12 件全部入库**（不是只躺工作树）。

**main 侧同名件核对（本席独立复核队长结论）**：
```
$ git ls-tree -r --name-only origin/main -- docs/synova/product-lines/evidence/980/
COUNT=0
```
⇒ `origin/main` 上**无同名件**，无覆盖冲突。

**远端回执（M4/M6 要求）**：
```
$ git ls-remote --heads origin | grep -i 'win-0-6-schema-degraded'
d7a30755fdaeeac8a3884b8d274800a15b56748b	refs/heads/feat/win-0-6-schema-degraded
```
⇒ 远端分支 tip = 本地 HEAD `d7a30755f`（一致）。

### D2 探针**独立复跑**（本席自己跑，不看归档结论）

```
$ bash docs/synova/product-lines/evidence/980/capture-980-probe.sh
### probe   sha256 BEFORE = 759a115ae3f96ecfd0dad0ffdbfada053d46dae4054a3c8758f6d1cb3cd89ae5
### capture sha256 BEFORE = 759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7
### START: 2026-10-08T02:50:45   ### END: 2026-10-08T02:50:50
### --- git status --porcelain BEFORE ---  （空）
### --- tasklist node BEFORE/AFTER ---     （同上 3 进程，完全一致）

[before] git status --porcelain（原文）:  (空 — 工作树干净)
[before] 6 x thresholds.json sha256（原文）:
2e71fae85f1674ed326dc22f8829a99930c3435163438d9ed3727a853613e7a7 *extensions/industries/financial-services/thresholds.json
e788884b942858b66b856a1fe83b62f476331254c4b2ffd5cb021332b92cbb72 *extensions/industries/general-enterprise/thresholds.json
424e913e2dd3c7724e117a17e736e2900d5c4492a3bf7b71ba54a1a749e6316d *extensions/industries/manufacturing/thresholds.json
32e52162a40036100e18ddefe177242e5ba3ae24aba538a330f1e335e06d4d0c *extensions/industries/retail-ecommerce/thresholds.json
226580f686c30c4ddb6700f83b3bc8825855442dbe25bf179520eaf1585344bc *extensions/industries/saas-tech/thresholds.json
43ec789b79a3f5ac91794d36f81b9f7afd1565d81ff7b49ff5a6206474083aea *extensions/industries/test-write/thresholds.json

════ 探针运行 1/2：人读形态 ════
写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK
未覆盖类型 40 个
- activity/production  - activity/acquisition  - activity/innovation  - activity/coordination
- activity/learning    - activity/governance   - activity/maintenance - activity/compliance
- outcome/financial    - outcome/market        - outcome/operational - outcome/people
- outcome/innovation   - outcome/risk          - outcome/competitive - outcome/external
- resource/money       - resource/person       - resource/team      - resource/agent
- resource/tool        - resource/knowledge    - resource/client    - resource/brand
- resource/data        - resource/ip           - resource/location  - resource/channel
- resource/supplier    - pool/capital          - pool/human_capital - pool/equipment_capacity
- pool/knowledge       - pool/brand            - pool/reputation    - pool/data
- pool/revenue         - pool/sensing          - pool/activity      - external/baseline
── 探针退出码 = 0

════ 探针运行 2/2：--json 形态 ════
{"written":40,"readBackOk":40,"count":40,"uncoveredTypes":[…40 项同序…],"nodeIds":["node-4875b3eb-…", … 共 40]}
── 探针 --json 退出码 = 0

[after] git status --porcelain（原文）: (空 — 工作树干净)
[after] 6 x thresholds.json sha256（原文）: 与 before 逐字相同
════ R28 地雷基线：跑前 / 跑后逐字比对 ════
git status 前后：逐字一致（0 差异）
6 个 thresholds.json sha256 前后：逐字一致（6/6）
════ 判据 V1 的 grep 形态跑在本次原文上 ════
V1-登记原文 grep -q '未覆盖类型'         : 命中（exit 0）
V1-加固     grep -qE '未覆盖类型 [1-9]'  : 命中（exit 0）
RUN_DIR = /tmp/synova-980-probe-out/20261008-025045

### EXIT CODE = 0
### --- git status --porcelain AFTER ---  （空）
### probe   sha256 AFTER = 759a115ae3f96ecfd0dad0ffdbfada053d46dae4054a3c8758f6d1cb3cd89ae5
### capture sha256 AFTER = 759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7
```

**与已入库 `evidence-980-probe-run.txt` 逐项比对**：

| 项 | 入库件（HEAD `c231d80e8` 时产出） | 本席新 run（HEAD `d7a30755f`） | 判定 |
|---|---|---|---|
| `未覆盖类型 N 个` | `40` | **`40`** | **一致** ✅ |
| `--json` 的 `count` | `40` | **`40`** | **一致** ✅ |
| `--json` 的 `written` / `readBackOk` | `40` / `40` | **`40` / `40`** | 一致 ✅ |
| 类型清单（首见序 40 项） | 40 项 | **同 40 项、同序** | 一致 ✅ |
| `git status` 前后逐字 | 0 差异 | **0 差异** | 一致 ✅ |
| 6 × `thresholds.json` sha256 | 6/6 一致 | **6/6 一致，且 6 个哈希值与入库件逐字相同** | 一致 ✅ |
| 探针退出码 | 0 | **0** | 一致 ✅ |
| 仓库内 `git status` 污染 | 0 | **0**（跑前跑后均空） | 一致 ✅ |

### D3 ⚠️ 发现：入库 run 记录的 `capture sha256` 与已入库脚本**不再匹配**

```
入库 evidence-980-probe-run.txt:4   capture sha256 = 6181e7c9ed8739983490375b0e5f549779c38b108e61e4f3c57f377d4b6f5c9b
当前工作树/HEAD  sha256sum capture-980-probe.sh = 759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7   ← 不匹配
（probe-diagnosis.ts 则匹配：759a115ae3f96ecfd0dad0ffdbfada053d46dae4054a3c8758f6d1cb3cd89ae5 = 入库记录 ✅）
```

**本席把差异追到 commit 级并证明其为注释级变更**：
```
$ git log --oneline --follow -- docs/synova/product-lines/evidence/980/capture-980-probe.sh
27099ae9a docs(#980): 静默吞错 3 处补显式降级声明（swallow-ok）
cce821327 docs(#980): 收口三件（自验报告/环境记录/探针 run 落仓）+ 写集表补齐

$ for r in c231d80e8 cce821327 27099ae9a 0692a6d1a d7a30755f; do sha256(git show $r:…capture-980-probe.sh); done
c231d80e8    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855   ← 空串哈希 = 当时**未入库**（untracked）
cce821327    6181e7c9ed8739983490375b0e5f549779c38b108e61e4f3c57f377d4b6f5c9b   ← 落仓版本 = 入库 run 记录的哈希
27099ae9a    759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7   ← 现行版本
0692a6d1a    759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7
d7a30755f    759d07096b5016cb74c8cd09149f496cc132554e12686cac262583523bbad6f7

$ git diff cce821327 27099ae9a -- …/capture-980-probe.sh
-DEPRECATED…（无）
-REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"
+REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败有显式 FATAL 分支（下一行），非静默
```
⇒ **差异 = 仅追加一行注释**（`27099ae9a` 对 `capture-980-probe.sh` 的 diff 共 `+1/-1`，语义零变化）。

**性质与影响（本席判定口径，非「通过」）**：
- 这是**证据件哈希漂移**：入库 run 里记的是「当时那份脚本」的哈希；脚本其后被改了注释，**入库 run 未同步更新其 `capture sha256` 一行**。
- **不影响产物结论**：本席用**现行脚本**独立复跑，`未覆盖类型 40 个` / `count=40` / `written=40` / `readBackOk=40` / R28 全零差异，与入库 run **完全一致**。
- **可核性提示**：任何按「哈希对账」验收该证据件的人会看到不匹配 ⇒ 建议在 PR 正文/收件闸**显式说明**该行为注释级漂移，或把该行更新到现行哈希（属治理件改动，**不在本席写集**，本席只报不动）。

---

## 7. 未解决 / 无法证实项（直说，禁「应该没问题」）

| # | 项 | 为什么无法证实 | 谁能怎么证 |
|---|---|---|---|
| U1 | **「C1 门禁在正确 brief 下是否仍红」** | 本席无暂存（只读授权），只读工作树上 `STAGED_ALL` 为空 ⇒ 解析器走日期回退落到 #1322。本席已证「给定 #980 文件集时解析器稳定返回 #980 brief」，但**未在真实暂存态重跑门禁**（暂存会改共享 index） | 有写权者：`git add src/l4/sog-schema-validator.ts tests/l4/sog-schema-validator*.test.ts docs/synova/product-lines/evidence/980/*` 后跑 `bash scripts/pre-commit-check.sh`，**再 `git reset` 还原**；或直接走 `synova-commit` 走真实提交路径 |
| U2 | **merge 后本报告结论是否仍成立** | 被验证 sha `d7a30755f` 相对当时 `origin/main`（`441c3004b`）**落后 9 条**。本席**未**验证 merge 后的树 | 队长收尾 merge 后复跑 A(tc)+B1+B5a/B5b 即可；产品件 sha256 若变则结论作废 |
| U3 | **「8 个失败件在 origin/main 上同样红」未直接实测** | 本席无第二棵可跑 vitest 的树（主树 `D:\...\Novis` 虽在 `main@16996d490`，但**无 `node_modules`、无 `tsconfig.json`**） | 建一棵装了 deps 的 `origin/main` 工作树重跑同样命令 |
| U4 | **`tests/agent/context-compaction.test.ts`（2 例）存量身份** | 该件与其被测源件均与 `origin/main` 逐字相同、本分支未碰，但**本席在存量红登记/基线/CI 排除清单中均未找到它** | 归编码线或控制塔登记；或按 U3 在 origin/main 上实测 |
| U5 | **A 段「零新增」的 pristine 基线对照** | 见 §A 局限（主树无 deps）。判据建立在文件族归类 + 变更集零诊断 + 唯一类型消费方零诊断 | 同 U3 |
| U6 | **B5b 遗留的工作树污染** | 见 §8。本席未清理（唯一可写 = 本报告） | 见 §8 处置建议 |

**另：本席**未**做的三件事（明示覆盖面缺口，非「跳过不提」）**：
1. 未做 V1–V6 判据复现（属自验 β `verifier-980-accept` 的职责）。
2. 未做真变异（mutation）判别性实验（同上）。
3. 未跑 `better-sqlite3` 跨版本借用的独立验证（属自验 α `verifier-980-env` 的职责）。本席仅在 B1/B5 的 L4 真库路径上**观察到通过**。

**关于 `better-sqlite3` 跨版本借用（卡面要求「先怀疑它」）**：本次全部失败中，**无一条**呈现「源码预期 SQLite 3.53.2 / 实际 3.49.2」型症状；本卡真库路径（`tests/l4/sog-schema-validator.integration.test.ts`、`probe-diagnosis.ts`）**全部通过**（B1 4/4、B5b 4/4、D2 两次 exit 0，均写出 40 节点并读回 40 OK）。**归类：本卡路径未受该变通影响**（不等于「已验证变通无害」，只是「本卡路径未暴露」）。

---

## 8. ⚠️ 副作用与残留（本席未清理，仅报告）

**B5b（`--shard=2/2`）留下了 4 个已跟踪文件的修改**（B5a 前后均为空，B6/D2/C1/C2 前后亦空 ⇒ 归因清晰）：

```
$ git status --porcelain        # HEAD d7a30755f，跑完全部步骤后
 M docs/synova/product-lines/evidence/D817-capture-20260918.json
 M docs/synova/product-lines/evidence/D819-capture-20260919.json
 M synova_worker/connectors/__pycache__/__init__.cpython-313.pyc
 M synova_worker/connectors/__pycache__/feishu.cpython-313.pyc

$ git diff --stat -- <上述文件>
 .../product-lines/evidence/D819-capture-20260919.json |   2 +-
 .../connectors/__pycache__/__init__.cpython-313.pyc   | Bin 177  -> 179 bytes
 .../connectors/__pycache__/feishu.cpython-313.pyc     | Bin 8164 -> 8166 bytes
 3 files changed, 1 insertion(+), 1 deletion(-)
```

**性质**：全量测试过程写入的运行期产物（`D817/D819-capture-*.json` 是既有证据捕获件被测试改写；两个 `__pycache__/*.pyc` 是 Python 字节码时间戳翻新）。
**风险**：任何 `git commit -a` / `git add .` 会把这 4 件**扫进提交**。卡面红线「红证不残留」精神下应处置。
**本席未处置**：写集仅限本报告，`git checkout --` 属工作树写入，超出授权。**处置建议（交队长/有写权者）**：
```
git checkout -- docs/synova/product-lines/evidence/D817-capture-20260918.json \
                docs/synova/product-lines/evidence/D819-capture-20260919.json \
                synova_worker/connectors/__pycache__/__init__.cpython-313.pyc \
                synova_worker/connectors/__pycache__/feishu.cpython-313.pyc
```

### 收尾状态复核（本席实查）
```
$ git rev-parse HEAD          → d7a30755fdaeeac8a3884b8d274800a15b56748b
$ sha256sum src/l4/sog-schema-validator.ts
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts   ← 仍 = 冻结值
```
⇒ **产品件未被本席触碰**（全流程多次核验 sha256，跑前跑后一致）。

---

## 9. 原始输出归档（可复跑）

全部步骤的**完整原文**（含 pino 日志行、ANSI、时间戳）归档于：

```
C:\Users\ADMINI~1\AppData\Local\Temp\synova-980-regress\
  A-tsc.txt                       39 行   ← 本报告 §A 已**全文内贴**（未截断）
  B1-tests-l4.txt                299 行
  B2-l4-contract.txt              63 行
  B3-graph-bridge.txt             64 行
  B4a-tk-ratchet-CI-face.txt      45 行
  B4b-tk-wire.txt                 58 行
  B4c-tk-architecture-full.txt   175 行
  B5a-shard-1of2.txt            5696 行
  B5b-shard-2of2.txt            7074 行
  B6-graphbridge-single.txt       52 行
  C1-pre-commit-check.txt         63 行   ← 本报告 §C1 已全文内贴
  C2-check-architecture.txt       87 行   ← 本报告 §C2 已全文内贴
  D2-probe-rerun.txt             117 行   ← 本报告 §D2 已全文内贴（剔 pino 后）
```
**关于 B 段的呈现口径（诚实声明，非静默截断）**：B1/B5a/B5b 的原文含数百行 pino JSON 日志。本报告**内贴的是「去除以 `{"level":` 开头行」后的完整内容**——该筛选规则**逐字写明**，非 `head`/`tail` 截断；**全部结果行（含每个测试文件的 ✓/❯ 与计数）、全部失败块、汇总块、退出码、node 快照，均逐条内贴**。需要 pino 原文者按上表路径读取。

**复跑命令（本席使用的包装器语义）**：每步先记 `git rev-parse HEAD` + `git status --porcelain` + `tasklist //FI "IMAGENAME eq node.exe"`，再执行，再记退出码 + 快照，最后 `### EXIT CODE = <n>`。包装脚本：`%TEMP%\synova-980-regress\step.sh` / `step2.sh` / `c-gate.sh`。

---

## 10. 自验结论（本席只给这一档，不给「通过」）

> **自验结论：退回（附理由）—— 但退回项**不含**产品证据链；是「版本前提已被超越」+ 两项需有写权者才能闭合的门禁/残留项。**

**支持「可提请独立审计」的部分（本席在 `d7a30755f` 上实测）**：
- **A**：`tsc` 28 条错误**全部落在基线族**，变更集 3 文件**零诊断**、唯一类型消费方 `graph-bridge.ts` 零诊断 ⇒ **新增错误 = 0**。
- **B 直接面全绿**：`tests/l4/` **221/221**、`tests/contract/l4-contract.test.ts` **13/13**、`tests/l4/graph-bridge.test.ts` **31/31**，三件 exit 均为 0。
- **B 爆炸半径可核**：产品改动面 = 3 文件（`src/l4/sog-schema-validator.ts` + 2 测试件）；两片全量 **24 例失败，无一落在该写集内**；存量 6 件（含 K3 两树逐字相同背书）、环境 2 件（Windows EPERM / macOS 执行位 / `spawn EINVAL`）。
- **C2**：`check-architecture.sh` **exit=0**，无新增跨层 import。
- **D**：证据件 **12/12 在 git 里**，`origin/main` 无同名件；探针**独立复跑** `未覆盖类型 40` / `count=40` / `written=40` / `readBackOk=40`，R28 前后零差异，**仓库零污染**；远端回执 `refs/heads/feat/win-0-6-schema-degraded = d7a30755f`。

**退回/未闭合项（逐条）**：
1. **U2 — 版本前提已被超越**：被验证 sha 相对当时 `origin/main` **落后 9 条**。本报告全部结论**仅对 `d7a30755f` 有效**；merge 后必须复跑或重新判定。
2. **U1 — C1 门禁 exit=1 未闭合**：失败 2 组（组 6 Done 可证伪、组 12 plan-integrity），**根因是 brief 解析落到 #1322 卡**（本席已给出定位实验与机制），但**「正确 brief 下是否仍红」本席无写权证实**。
3. **§8 — 工作树残留 4 件**：`--shard=2/2` 的副作用，需有写权者清理，否则可能被 `git add .` 扫入提交。
4. **U4 — `context-compaction.test.ts`（2 例）存量身份未获登记证据**，不作「存量」断言。
5. **U3/U5 — 无 pristine 基线树**，「在 origin/main 上同样红」未直接实测。
6. **D3 — 入库 run 记录的 `capture sha256` 与现行脚本不匹配**（已证明为注释级漂移；建议显式说明或更新该行，属治理件改动，本席只报不动）。

**明确不宣称**：本报告**不**声称「产品被验证」「可以合并」「零风险」。**通过与否归 CTO 收件闸 + K3 终审。**

---

*本报告由独立自验员 γ（`verifier-980-regress`）产出；只读产品代码；唯一写入 = 本文件；未 commit / push / stash / `--no-verify`。*
