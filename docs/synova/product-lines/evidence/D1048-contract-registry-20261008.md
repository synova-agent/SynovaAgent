# D1048 compute 契约注册表最小件 — 证据（#1048 / K5 · W4 · 施工单 2-6）

> 执行者：sra-smoke（小队编码位）｜执行位自测报告，**非独立自验**（判定人 = K3 / 独立复核）
> 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1048`｜分支 `feat/1048-contract-registry`｜HEAD `0c7d77523057481d8025fbee10146923e3efc399`（= origin/main 0c7d77523）
> 执行窗口：2026-10-08（本机时区）｜数字一律命令原始输出

## 0. 结论摘要

| 项 | 结果 | 证据 |
|---|---|---|
| 探针（强形态三段断言） | **PASS / exit 0** | §3 |
| 反例 1（删契约 ID ⇒ 必红） | **红 / exit 1** | §4 |
| 反例 2（指向不存在实现 ⇒ 必红） | **红 / exit 1** | §4 |
| fail-closed（禁静默降级） | **成立**（无 `degraded` 通过路径；缺失即抛 `ComputeContractError`） | §5 |
| 计数口径 | 四口径全部自跑（见 §1） | §1 |
| ★ 本卡真缺口 | **3 条契约的生产调用点 = 0** | §1 口径④ |

**验证级别实评：L3**（resolve + 真调用两步**真跑通**）。未填 L4：无反例以外的独立复跑者、无 K3 判定。

## 1. 计数口径（口径名 + 命令 + 数字，全部自跑）

| # | 口径名 | 命令（在 `.synova-wt-1048` 内） | 数字 |
|---|---|---|---|
| ① | 全局注册表**声明数** | `Select-String -Path scripts/workflow/system-registry.json -Pattern '^\s*"COMPUTE-'` | **41** |
| ② | compute **实现文件数** | `Get-ChildItem extensions/sentinels/shared/computes -Recurse -File -Include *.ts` | **89**（不含 `index.ts` = 88） |
| ③ | sentinel manifest 的 **compute 契约声明** | `... -Include manifest.json \| Select-String '"compute":\s*"COMPUTE-'` | **7 条 / 6 文件** |
| ④ | ★ **生产调用点** | `Select-String -Pattern '\bcompute(HHI\|DOL\|NPV)\s*\('` 后排除定义行与 `tests/` | **0** |

**口径③ 勘误（自我披露）**：执行中我先报过「8 条 / 7 文件」，那是把 `extensions/sentinels/manifest.json:14` 的说明性文本 `"compute": "指标 — 纯数学，盯一个数"` 当成了契约声明。精确命令（带 `"COMPUTE-` 前缀约束）得 **7 条 / 6 文件**。

**口径④ 原始输出**（每条 5 处命中 = 1 处定义行 + 4 处测试，生产 = 0）：

```
computeHHI : 全部 5 | 排除定义行后 4 | 其中生产(非 tests) 0
    .\tests\sentinels\shared\d59-me-enhance.test.ts:99: const r = computeHHI([0.3, 0.25, 0.2, 0.15, 0.1]);
    .\tests\sentinels\shared\d59-me-enhance.test.ts:106: const r = computeHHI([]);
    .\tests\sentinels\shared\d62-me-sentinels.test.ts:57: const r = computeHHI([0.3, 0.25, 0.2, 0.15, 0.1]);
    .\tests\sentinels\shared\d62-me-sentinels.test.ts:62: const r = computeHHI([]);
computeDOL : 全部 5 | 排除定义行后 4 | 其中生产(非 tests) 0   （同为 2 测试文件 × 2 断言）
computeNPV : 全部 5 | 排除定义行后 4 | 其中生产(非 tests) 0   （同上）
```

★ **如实披露**：登记面（①41 / ③7）与实际消费面（④0）**严重不对称** —— 契约 ID 在 manifest、专家、技能、文档里满天飞，但**没有任何生产代码路径按 ID 解析到实现并调用**。这正是 W4 存在的理由，也是"注册表在但没人保证生效"的量化缺口。**不得表述为"契约已被调用"。**

## 2. 覆盖的 3 条契约（ID → 实现文件 → 导出符号 → 声明 → fixture）

| 契约 ID | 实现文件 | 导出符号（行号） | manifest 声明 | 全局注册表 | 探针 fixture |
|---|---|---|---|---|---|
| `COMPUTE-HHI-v1`（卡面指名） | `extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts` | `computeHHI` :31（契约ID 注释 :4） | `extensions/sentinels/competitive-position/manifest.json:55` | `system-registry.json:104` | `[[0.4,0.3,0.2,0.1]]` |
| `COMPUTE-DOL-v1` | `extensions/sentinels/shared/computes/l2-value/compute-dol.ts` | `computeDOL` :33（注释 :4） | `extensions/sentinels/capital-health/manifest.json:68` | `:102` | `[1000,400,400]` |
| `COMPUTE-NPV-v1` | `extensions/sentinels/shared/computes/l2-internal/compute-npv.ts` | `computeNPV` :31（注释 :4） | `extensions/sentinels/capital-health/manifest.json:73` | `:115` | `[500,[150,200,250],0.1]` |

选取口径：实现文件在仓内且含 `契约ID: <ID>` JSDoc 行 ∧ 被 sentinel manifest 的 `compute` 字段声明 ∧ 被全局注册表 computes 段声明。（`COMPUTE-HHI-v1` 为卡面/登记件指名，必须覆盖。）

## 3. 探针基线（原始输出，`EXIT=0`）

命令：`node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-compute-registry.ts`

```
PROBE_REPO_ROOT: D:\novis-backup-20260526\Novis\.synova-wt-1048
PROBE_REGISTERED_CONTRACTS: 3 (COMPUTE-HHI-v1, COMPUTE-DOL-v1, COMPUTE-NPV-v1)

[SECTION 1/3] 注册表存在性
PRESENCE_OK COMPUTE-HHI-v1

[SECTION 2/3] RESOLVE
RESOLVE_OK COMPUTE-HHI-v1 → extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts:31 :: computeHHI (契约ID 注释行 4)
RESOLVE_OK COMPUTE-DOL-v1 → extensions/sentinels/shared/computes/l2-value/compute-dol.ts:33 :: computeDOL (契约ID 注释行 4)
RESOLVE_OK COMPUTE-NPV-v1 → extensions/sentinels/shared/computes/l2-internal/compute-npv.ts:31 :: computeNPV (契约ID 注释行 4)

[SECTION 3/3] CALL
CALL_OK COMPUTE-HHI-v1 fixture=[[0.4,0.3,0.2,0.1]] → hhi=0.3 firmCount=4 top3Share=0.9 ...degraded=false
  CALL_RESULT_JSON {"hhi":0.3,"firmCount":4,"top3Share":0.9,"economicInterpretation":{"marketConcentrationClassification":"concentrated",...},"degraded":false,"warnings":[]}
CALL_OK COMPUTE-DOL-v1 fixture=[1000,400,400] → dol=3 contributionMargin=600 ebit=200 fixedCostRatio=0.4 ...
  CALL_RESULT_JSON {"dol":3,"contributionMargin":600,"ebit":200,"fixedCostRatio":0.4,...,"degraded":false,"warnings":[]}
CALL_OK COMPUTE-NPV-v1 fixture=[500,[150,200,250],0.1] → npv=-10.52 irr=0 paybackPeriod=3 ...
  CALL_RESULT_JSON {"npv":-10.52,"irr":0,"paybackPeriod":3,...,"degraded":false,"warnings":[]}

SUMMARY: PASS — presence 1/1 | resolve 3/3 | call 3/3
```

**强形态 vs 弱形态**：登记件 `docs/synova/coordination/施工项登记.ts:1697` 的判据是 `expectStdoutContains: 'COMPUTE-HHI-v1'`，同文件 `:1071` 自陈其为**弱形态**（"只验 stdout 子串，可被无关输出满足"）。本探针给强形态：**PRESENCE（必需 ID 必须注册）+ RESOLVE（文件/符号/契约ID注释行三查）+ CALL（真调用 + 返回值字段 + `degraded` 类型）**，三段任一失败即 exit 1；仅打印 ID 不可能通过（反例 1 即证明：ID 打印在册仍因 PRESENCE 不过而红）。

## 4. 反例（改坏即红，真跑 + 复原）

**反例 1：删除必需契约 ID**（`contractId: 'COMPUTE-HHI-v1'` → `'COMPUTE-HHI-v1-REMOVED-BY-PROBE-CE1'`）

```
[SECTION 1/3] 注册表存在性
[FAIL] phase=resolve contractId=COMPUTE-HHI-v1 — 必需契约未注册
SUMMARY: FAIL (presence) — 缺 1/1
CE1_EXIT=1
```

**反例 2：注册表指向不存在的实现文件**（`compute-hhi.ts` → `compute-hhi-MISSING-FILE.ts`）

```
[SECTION 1/3] 注册表存在性
PRESENCE_OK COMPUTE-HHI-v1

[SECTION 2/3] RESOLVE
[FAIL] phase=file code=COMPUTE_CONTRACT_FILE_FAILED contractId=COMPUTE-HHI-v1 — 实现文件不存在: extensions/sentinels/shared/computes/l4-competition/compute-hhi-MISSING-FILE.ts（解析根 D:\...\.synova-wt-1048）
SUMMARY: FAIL (resolve)
CE2_EXIT=1
```

**红证不残留（含终稿复跑）**：初审稿 `BASE_SHA256=3A28124A…C635B7` → 复原同值。**组 8 修复 + 接线改动之后，对终稿再跑一遍**：`FINAL_BASE_SHA256=EA3367A0D73C64AACA207DE4D2AEC28F43DA38BD9746C720D907C3FFC052FCAA`，CE1/CE2 仍 `EXIT=1`，复原后 `RESTORED_SHA256` 与基线同值（`RESTORED_IDENTICAL=True`），复跑 `SUMMARY: PASS` / `EXIT=0`；`git status` 无残留夹具。

## 5. fail-closed 语义（禁静默降级）

- `src/contract/compute-registry.ts` **不提供** `degraded: true` 的通过路径：ID 未注册 / 实现文件缺失 / 导出符号缺失 / 动态加载失败 / 调用返回形状不符 ⇒ **抛 `ComputeContractError`**（`code=COMPUTE_CONTRACT_<PHASE>_FAILED` + `phase` + `retryable`，铁律 32）。
- 与铁律 11「显式降级」的关系：本件的正确语义是**缺失即红**；给注册表一条静默通过路径等于把它退回"注册表在但没人保证生效"。调用方若需降级，必须在自己 catch 里显式选择并记录（模块头部 `@consumer` 义务已写明）。
- 与 D215 `contract-store.ts`/`contract-gate.ts`（符号契约存档，来源 `.codex/contracts/*.json`，**有**降级语义）**刻意并存不合并**：两者管的契约家族不同。

## 6. 接线与测试（组 4a / 2b 收口，队长 2026-10-08 裁定后落地）

**接线（组 4a）**：唯一合法消费者必须落在**既有 src/ 文件**（4a 只认 `src/**`，且显式排除 `\.test\.`；探针在 `scripts/` 不算，新文件消费新文件会把阻断递归下去）⇒ 改既有 `src/contract/contract-gate.ts`，**只加调用 + details 上报，`pass` 判定式逐字未改**（队长硬约束：不扩大运行时失败面）：

```ts
pass: failures.length === 0 && !degraded,        // ← D1048 未改
failures,
degraded,
checkedAt: new Date().toISOString(),
computeContracts: await this.validateComputeContracts(),   // ← 新增，只上报
```

新增 `ComputeContractValidation`（`blocking: false` 恒定）+ `validateComputeContracts({ invoke? })`（默认 `invoke=false`，不在运行期引入实现模块的动态加载副作用；探针/CI 显式开）。

**测试（组 2b）**：`tests/contract/compute-registry.test.ts`（新）—— 三路径齐（正常 resolve+真调用 / 降级三条：未注册 ID→`phase=resolve`、文件缺失→`phase=file`、符号缺失→`phase=symbol`，并断言 `code`/`retryable`；边界：HHI 空输入 `degraded=true` + 覆盖面断言）。

**原始输出（scoped vitest）**：

```
 RUN  v4.1.8 D:/novis-backup-20260526/Novis/.synova-wt-1048
 ✓ tests/contract/compute-registry.test.ts (7 tests) 45ms
 ✓ tests/contract/contract-gate.test.ts (4 tests) 30ms        ← 既有 D215 测试，仍全绿
 Test Files  2 passed (2)
      Tests  11 passed (11)
VITEST_EXIT=0
```

`pass` 判定未变 + 新路径**确实被执行**（`validateAll()` 的日志）：

```
{"service":"contract/gate","total":0,"failures":0,"degraded":false,
 "computeContracts":{"checked":3,"passed":3,"failing":0},"msg":"契约门禁检查完成"}
```

**组 8 修复**：`export type ComputeContractPhase = 'resolve' | 'file' | …` → `as const` 数组派生 `(typeof COMPUTE_CONTRACT_PHASES)[number]`（正则自查命中 **0**）；另将 `loadComputeImplementation` **去导出**（对外入口只留 `invokeComputeContract`，避免悬空符号）。

**门禁复跑（`bash scripts/pre-commit-check.sh`）**：

```
组 1/2/3/4/5/8/13 ✅（接线完整性 / 配对测试 / 硬编码类型回归 全清）
组 6 ✅ brief schema / Done 可证伪    组 7 ✅    组 9 ✅    组 10 ✅
组 12 ❌ 声明闸② brief↔代码一致性: 4 处 [硬阻断]
   src/contract/compute-registry.ts / src/contract/contract-gate.ts
   scripts/control-tower/probe-compute-registry.ts / tests/contract/compute-registry.test.ts
   （"不在 Q2 范围内"——待队长落盘 brief 的 Q2 写集）
REAL_EXIT=1
```

**全量 `tsc --noEmit`**：`TSC_ERRORS_TOTAL=34`（与改动前基线同数，均为既有存量错：`extensions/sentinels/_extinct/**`、`src/mcp/**`（缺 SDK）、`src/server.ts` 等）；**我的两个文件命中 = 0**。

## 7. 未决 / 待裁

| # | 项 | 状态 |
|---|---|---|
| 1 | 配对测试 `tests/contract/compute-registry.test.ts` | **已完成**（7 测试，三路径）§6 |
| 2 | 组 4a 接线消费者 | **已完成**（`contract-gate.ts` 真调用 + 只上报）§6 |
| 3 | 组 12：4 文件须在 brief Q2 写集内 | **待队长落盘 brief**（Note/brief 由队长写，不占执行位写集） |
| 4 | 组 8 硬编码类型联合 | **已修**（派生式，正则命中 0）§6 |
| 5 | 全量 `tsc --noEmit` | **已跑**：34 条存量错，我的文件 0 命中 §6 |

## 8. 自测报告（声称 ↔ 证据）

| 声称 | 证据 | 位置 |
|---|---|---|
| 探针强形态三段断言通过 | `SUMMARY: PASS — presence 1/1 \| resolve 3/3 \| call 3/3` / exit 0 | §3 |
| 改坏即红（两条反例） | CE1/CE2 原始输出 + exit 1 | §4 |
| 红证不残留 | SHA256 前后同值 + 复跑绿 + `git status` 干净 | §4 |
| fail-closed | 无 degraded 通过路径；错误分类带 code/phase/retryable | §5 |
| 计数口径自跑 | ①41 ②89/88 ③7/6 ④0 | §1 |
| 注册表已接线（非空壳） | `validateAll()` 真调用；日志 `computeContracts:{checked:3,passed:3,failing:0}` | §6 |
| `pass` 判定未变 | 既有 D215 测试 4/4 仍绿；判定式逐字未改（代码注释 + diff 可核） | §6 |
| 配对测试三路径 | `✓ tests/contract/compute-registry.test.ts (7 tests)`；11/11 passed / exit 0 | §6 |
| 未碰禁写区 | 改动仅 5 文件（见 §7 清单）；`src/sentinel/**`、`src/store/**` 零改动；`scripts/audit/**` 零改动 | §6/§7 |
| 类型零新增错 | `tsc --noEmit` 34 条（与改前基线同数），我的文件命中 0 | §6 |

**本卡自测由执行位完成，不构成独立验证。** 判定人 = K3 / 独立复核。
