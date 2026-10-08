# V8 · 测试执行面：三集合实测 + 补前/补后

> 基线 `origin/main = 74eb6c44c` ｜ node v24.19.0 ｜ vitest **4.1.8**（`package.json` 声明 5.0.2，实装 4.1.8 —— 见文末）
> 口径纪律：本文所有数字都是**本卡实跑产出**；**不引用** S5 尽调的数（S5 的数只用于事后对账）。
> 原始集合清单在 `raw/set-*.txt`，原始运行输出在 `raw/v8-*.txt`。

---

## 1. 三集合（V8 要求"先量"）

### 1.1 全集 A —— 仓内所有 `*.test.ts(x)`

```bash
git ls-tree -r --name-only origin/main | grep -E '\.test\.(ts|tsx)$' | sort
```

**实测 = 656 个文件**（其中 `*.test.tsx` = **0** 个）。
分布：`tests/` **619** ｜ `packages/` **25** ｜ `extensions/` **12**。

> ⚠️ **口径更正**：Lead 转述的 S5 数"`.test.sh` 131"是**另一族**（shell 测试），不是这一族。
> 两个 131/656 曾混为一谈 —— 本卡把两族彻底分开（§3）。

### 1.2 include 集合 B —— `vitest.config.ts` 的 `include` 实际匹配

**补前**（`origin/main`）：
```ts
include: ['./tests/**/*.test.ts', './tests/**/*.integration.test.ts']
```
⚠️ 第 2 条是**冗余**的（`*.integration.test.ts` 已被 `*.test.ts` 包含）。
实测匹配 = **619** 个 ⇒ **37 个 `.test.ts` 不匹配任何 include**（`raw/set-D-outside-include-before.txt`）：

| 组 | 个数 | 路径 |
|---|---|---|
| `packages/test-kit/tests/**` | 21 | architecture 5 · e2e 3 · observer-adapters 1 · python-bridge 1 · security 7 · unit 2 · wire 2 |
| `extensions/sentinels/**` | 12 | 其中 3 个在 `_extinct/`（已退役哨兵） |
| 单包 `packages/*/tests/**` | 4 | connector-registry · error-types · extension-registry · sog-core |

**补后**（本卡改动，`raw/set-B2-include-after.txt`）：
```ts
include: [
  './tests/**/*.test.ts',
  './tests/**/*.integration.test.ts',
  './packages/*/tests/**/*.test.ts',
  './extensions/**/*.test.ts',
]
```
实测匹配 = **656** ⇒ **模式层差集 = 0**（`comm -23 A B2` 输出为空）。

### 1.3 CI 实跑集合 C —— vitest **真实收集**的（不是读配置）

```bash
CI=1 node ./node_modules/vitest/vitest.mjs list --reporter=default
```

| | 补前 | 补后 |
|---|---|---|
| 真实收集的文件 | **599** | **636** |
| 真实收集的用例 | **4611** | **4959** |

> 🔴 为什么必须真收集：`include` 里有文件 ≠ 文件会被执行。
> 实测 **3 个文件在 include 内却收集 0 条用例**（`raw/set-I-include-but-zero-collect-3.txt`）：
> - `tests/e2e/diagnosis-pipeline.e2e.test.ts` — 用 `it.runIf(!SKIP)`，`SKIP = !isLLMConfigured()` ⇒ 无 LLM key 时 0 条
> - `tests/e2e/pde-diagnosis.e2e.test.ts` — 同上
> - `tests/sentinel/threshold-manifest-flip.test.ts` — `describe.skipIf(!RUN_FLIP)`，需 `D577_FLIP_TEST=1` ⇒ 0 条
>
> 这 3 个文件**在"文件存在"口径下永远是绿的**（判例 V-01：L1 不许报成 L2）。

### 1.4 差集总表

| 口径 | 补前 | 补后 |
|---|---|---|
| 全集 A | 656 | 656 |
| include 模式匹配 B | 619 | **656** |
| vitest 真实收集 C | 599 | **636** |
| **A − B（无 include）** | **37** | **0** |
| **A − C（无 runner 执行）** | **57** | **20** |
| CI-only `exclude` 移除 | — | 17（`raw/set-H-*.txt`） |
| include 内 0 用例 | 3 | 3 |
| 57 / 20 的构成校验 | 37 + 17 + 3 = 57 ✓ | 17 + 3 = **20** ✓ |

> 卡面目标判据写的是「`git ls-files 'tests/**.test.*'` 与 CI 实跑集合**差集 = 0**」。
> **诚实结论：该目标未达成**，剩余 20 个（`tests/` 面）。
> 其中 **17 个是 `CI=1` 时才生效的刻意 `exclude`**（每条都有注释理由），
> **3 个是上文的零用例文件**。两者都**不是本卡可单方面处置**的（前者 = 覆盖率策略，后者 = 测试自身守卫）。

---

## 2. 补前 / 补后全量实跑（原始输出）

命令（两段完全相同，只有 include 不同）：
```bash
CI=1 NO_COLOR=1 node ./node_modules/vitest/vitest.mjs run --reporter=default
```

### 补前
```
 Test Files  1 failed | 586 passed | 1 skipped (600)
      Tests  1 failed | 4477 passed | 8 skipped (4619)
     Errors  12 errors
   Duration  49.03s (transform 31.77s, setup 0ms, import 72.89s, tests 103.30s, environment 160ms)
```
唯一失败文件：`tests/l3/graphbridge-wiring.test.ts`
```
AssertionError: expected +0 to be 1 // Object.is equality
 ❯ tests/l3/graphbridge-wiring.test.ts:79:31
```

### 补后
```
 Test Files  8 failed | 616 passed | 1 skipped (637)
      Tests  18 failed | 4807 passed | 8 skipped (4967)
     Errors  12 errors
   Duration  35.66s (transform 23.73s, setup 0ms, import 48.68s, tests 72.38s, environment 160ms)
```
新增失败文件（7 个，**如实报数，未做任何 exclude 美化**）：

| 文件 | 组 | 失败数 |
|---|---|---|
| `extensions/sentinels/_extinct/capital-turnover/computes/cash-conversion-cycle.test.ts` | extensions | 1 |
| `packages/test-kit/tests/architecture/01-layer-boundaries.test.ts` | test-kit | — |
| `packages/test-kit/tests/architecture/02-wiring-audit.test.ts` | test-kit | — |
| `packages/test-kit/tests/architecture/04-file-size-audit.test.ts` | test-kit | — |
| `packages/test-kit/tests/e2e/01-diagnosis-journey.test.ts` | test-kit | — |
| `packages/test-kit/tests/e2e/02-expert-contribution-journey.test.ts` | test-kit | — |
| `packages/test-kit/tests/e2e/03-tui-smoke.test.ts` | test-kit | — |

分组隔离实跑（给出 exit code，因为小集合能干净退出）：
```
# extensions/** + 4 个单包（16 文件）
 Test Files  1 failed | 15 passed (16)
      Tests  1 failed | 134 passed (135)
   Duration  1.09s          EXIT=1
唯一失败：cash-conversion-cycle.test.ts:21 AssertionError: expected 'critical' to be 'warning'

# packages/test-kit/**（21 文件）
 Test Files  6 failed | 15 passed (21)
      Tests  16 failed | 197 passed (213)
   Duration  919ms          EXIT=1
```

### 补前/补后净变化

| 指标 | 补前 | 补后 | Δ |
|---|---|---|---|
| 执行的文件（run 口径） | 600 | 637 | **+37** |
| 执行的文件（list 口径） | 599 | 636 | **+37** |
| 执行的用例 | 4619 | 4967 | **+348** |
| **通过**用例 | 4477 | 4807 | **+330** |
| **失败**用例 | 1 | 18 | **+17** |
| 失败文件 | 1 | 8 | **+7** |

> 结论：**+330 条此前从不执行的测试现在真的在跑**；代价是 **+7 个真红暴露出来**。
> 这 7 个红**不是新引入的缺陷**，是既有缺陷此前没有 runner 所以看不见。

### 原始验证：test-kit 的注释早已自承
`ci.yml:361-363`（`test-kit-architecture` job）：
> `D565 登记: architecture 套件余 4 文件（01/02/04）存量红（wiring-audit 引用已拆接线、>1000 行文件、l4 import）——从未入 CI 故腐化未察。`

实测吻合：架构套件 01/02/04 红、03/05 绿。

---

## 3. `.test.sh` 家族（**与 §1 是两族，勿混**）

```bash
git ls-tree -r --name-only origin/main | grep -E '\.test\.sh$' | sort   # 131
```

| 口径 | 数 | 说明 |
|---|---|---|
| 全集 | **131** | 130 个在 `tests/`，1 个在 `dsh/plugins/task-board-adapter/test/` |
| `ci.yml` 实跑（PR 门禁面） | **60** | 59 个 `for t in \…` 清单（`Control Tower Gate Tests` job）+ 1 个 `gate-integrity` job 显式 `bash tests/control-tower/precommit-groups-injection.test.sh` |
| 全部 workflow 实跑 | **61** | 再加 `desktop-build.yml:118` 的 `tests/desktop/verify-package-signature.test.sh`（**仅 `push: main` 触发，不在 PR 面**） |
| **从不执行（`ci.yml` 口径）** | **71** | `raw/set-G-*.txt` |
| **从不执行（全部 workflow 口径）** | **70** | `raw/set-G2-*.txt` |

> 与 S5 对账：S5 记「131 / 60 / 71」= **`ci.yml` 口径**，逐字吻合。
> 本卡补出第 61 个执行点（`desktop-build`），并把它单独标注为**仅 main push 触发**，
> 因为它**不在 PR 门禁面**，并入"CI 跑了"会掩盖"PR 门禁跑不到"这一事实。

`for t in` 清单提取（两处 `for` 循环 = ubuntu 重活 + windows 顾问腿，**清单逐字同源**，各 59 项，并集 59）：
```bash
python3 -c "import re;s=open('.github/workflows/ci.yml',encoding='utf-8').read();\
print([len([x for x in b.replace(chr(92),'').split(chr(10)) if x.strip()]) \
       for b in re.findall(r'for t in \\\\\n(.*?); do', s, re.S)])"
# → [59, 59]
```

未跑的 71 个构成（`raw/set-G-*.txt`）：`tests/control-tower/**` 63 · `tests/doc-system/**` 2 · `tests/project/**` 3 · `tests/desktop/**` 1 · `dsh/plugins/**` 1 · 其余 1。

---

## 4. 附带实测项（卡面要求"只记录"）

| 项 | 声明 | 实装 | 后果 |
|---|---|---|---|
| vitest | `package.json` **5.0.2** | `node_modules` **4.1.8** | 本机结论 ≠ CI runner 结论；`npm ci` 在 main 上 ERESOLVE 必红 |
| `@vitest/coverage-v8` | 4.1.8 | 4.1.8 | 与 vitest 5.0.2 不配对 ⇒ ERESOLVE 根因 |

**本卡未改** `package.json` / `package-lock.json`（属治理线 W1，修它的 #1159 未合）。

### 另一条重要实测：全量跑不退出
两次全量（补前/补后）都在打印汇总后**进程不退出**（外部强杀；补后实测 post-summary 仍存活 **≥180s**），
伴随 12 条 `[vitest-pool]: Timeout terminating forks worker`。涉及文件（两轮一致，12 个）：
`bootstrap · ga-manual-injection · llm-config · metrics · middleware-order · production-entry-conversation.integration · qa-router · report.integration · sessions-api · smoke · tool-loop-tool-pairing.integration · workspace-access-write-endpoint`。
⇒ **本机拿不到全量 exit code**（判据改用汇总计数）；CI 上是否撞 `timeout-minutes: 8` 本机无法证明 ⇒ 标"未验"。
