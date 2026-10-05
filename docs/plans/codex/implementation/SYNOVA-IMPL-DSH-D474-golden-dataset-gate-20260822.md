---
north-star:
  服务用户: 创始人（push 前机器确认"模型/报告输出可复现，黄金数据集没被改坏"）+ FDE/实现线（改阈值/契约/报告结构时立即被门禁拦截）
  服务场景: 黄金数据集 wani-baby-v1.json 是"客户A真实数据的冻结快照"，但目前只有 check-golden-regression.sh 校验 checksum（数据没被改），**没有一条门禁真正跑代码验证"模型/UI 输出可复现"**——改坏哨兵 aggregate / 报告结构，CI 照样绿
  模块终态: 黄金数据集接入 pre-push 门禁：push 时跑真实哨兵 aggregate + 报告结构断言 vs client-a 冻结快照 diff；新快照可 keyless 录制（跑真实代码生成 → 人工确认冻结），回放即 diff——输出可复现、可回放、可审计
  对齐北星: PRODUCT-BRIEF.md §八「Loop Engineering 需要成为什么」——门禁不查产品对齐的缺口；黄金案例 = 修复断裂场景的最小数据副本（C 线 P1-2 黄金数据集门禁）
  完成标准: 入口 git push → 处理 golden-case-checker 追加黄金数据集阶段（跑真实 aggregate diff client-a）+ check-golden-regression 接线 → 结果：改坏哨兵 aggregate → exit 1 红，恢复 → exit 0 绿（机器可复现）
  当前进度: D396 已交付三层快照（compute/findings/expertReport）+ pre-push/CI 接线（golden-case-checker.ts）；fixtures 11 条含 golden-case-11 示范。缺口：① data/golden/wani-baby-v1.json 的回归脚本零接线（M3）② 无 keyless 录制模式（快照只能手写）③ findingsFnRegistry 空（只示范 compute 层）
---

<!--
  SYNOVA-IMPL-DSH-D474: snapshot keyless 回放 + 黄金数据集门禁（Stage1 D3，借鉴 B3）
  状态: dev doc | 2026-08-22 | 优先级 P1（Stage1 序 3）
  权威文档: 派发 Stage1-派发-devdoc-20260821.md Spec 3 + 施工图 DOC-0114 §5.3 + 借鉴清单 B3 + C 线 P1-2 + D396 dev doc
  依赖: D396（三层快照执行器已交付）/ D355-D360 修复对象（增量登记 registry）
  并行: 与 D472（D2）/ D473（D4）零文件交集（scripts/ci/ + scripts/workflow/check-golden-regression.sh + pre-push 区域）；D471（D1）src/store 不碰
  撞车记录（2026-08-22，创始人裁定）: D470 号原被 Win 线 8-22 提交的 ingest 契约修复任务（feat/win-d470-field-mapping-contract 分支，Track A 最高优先级，703 行未合并代码）占用且未登记 task-state；本任务取号时分配器发 D470 造成撞号。处理：D470 号留给 Win 分支，本任务改号 D474（分配器重取，task-state/D474.json）；与 D469→D472 撞车先例同式处理。
-->

# SYNOVA-IMPL-DSH-D474: snapshot keyless 回放 + 黄金数据集门禁

> 一句话问题: D396 把 golden-case-checker 从"自洽 F1"升级为"真跑 compute 的三层快照"，并接上了 pre-push/CI——但**黄金数据集（data/golden/wani-baby-v1.json）这条线没接**：`check-golden-regression.sh` 只校验 checksum（证明"数据没被改"），全仓 grep 无任何 pre-push/CI 调用它（M3 建了不接线）；且快照只能手写（无 keyless 录制）。借鉴 DSH snapshot 测试的 keyless 回放范式（B3），把黄金数据集接入门禁（compute 纯函数 + severity 级对比）+ 录制/回放闭环。**2026-08-22 修正**：client-a sentinels 实证为 `{哨兵名: {expected, value}}` 结构（非 FindingSnapshot[]），diff 契约 = severity 级对比；哨兵 aggregate 依赖 GraphStoreReader 不符合同步纯函数契约 → findings 层登记显式 descope（S-10）。

## 1. Authority Doc Verification

**来源**: [Stage1 派发文档](docs/synova/coordination/Stage1-派发-devdoc-20260821.md)（Spec 3 / D3）

> Spec 3：D3 snapshot 测试（借鉴 B3）。落地对象 `scripts/ci/golden-snapshot-runner.ts`（已有雏形）；补缺口黄金数据集门禁（P1-2，模型/UI 输出可复现）；验收：黄金数据集接入门禁 + snapshot 可复现。归属治理层，Mac DSH。

**来源**: [第六章借鉴清单 B3](docs/synova/research/Harness研究与Synova战略再定位-20260816/第六章-借鉴清单与走出自己的特色-20260816.md)（6.1 表 B3 行）

> snapshot 测试（keyless 回放）——模型/UI 输出可复现——补黄金数据集门禁（P1-2）。落地方式：黄金数据集接入门禁 + snapshot 机制。

**来源**: [C 线差距清单](docs/synova/research/C线-世界级基准-20260802/第五章-差距清单与路线图-20260802.md)（L108 一致性声明）

> B 线 P1-1/P1-2/P1-3/P1-5 = 本表 S1-5/S1-6、**黄金数据集门禁（未单列，归 S1-1）**、S5-2、S3-3 ✅ 一致。S1-1 根因命中率：黄金数据集+客户A回测。

**来源**: [D396 dev doc](docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D396-golden-case-gate-20260816.md)（§5 接线现状）

> pre-push-check.sh L221 + ci.yml golden-case job 已接线 golden-case-checker.ts（grep 实测 2 处）。快照分层：compute 全 diff / findings 全 diff / 专家报告结构化断言。扩用例不碰 src/ 业务逻辑。

**来源**: [AGENTS.md 铁律](AGENTS.md)（35 自动化优先 / 36 vitest 全量 / 48 测试非空壳 / 0-2 接线验收）

> 铁律 0-2 WIRE CHECK：`grep -rn "新函数名" src/` 零结果 = 未完成。check-golden-regression.sh 零接线 = 未完成（M3 活实例）。

## 2. Problem Statement

C 线 S1-1（根因命中率）要求"黄金数据集+客户A回测"作为外部验证基准，B 线 P1-2 明确"黄金数据集门禁"。现状：

1. **黄金数据集零门禁（M3 建了不接线）**：`scripts/workflow/check-golden-regression.sh` 已存在（checksum 校验 + 字段完整性），但 `grep -rn "check-golden-regression" scripts/ .github/` 只有脚本自身——**pre-push 不跑、CI 不跑**。它校验的是"wani-baby-v1.json 文件没被改"，而真正要防的是"代码改了导致 client-a 数据跑出来的诊断输出变了"——checksum 防不住代码回归。
2. **无 keyless 录制模式**：D396 的快照是手写 JSON（golden-case-11 的 compute.snapshot 是人工填的）。DSH snapshot 范式是 keyless——跑真实代码生成快照 → 人工确认冻结 → 回放 diff。没有录制模式，新修复对象的快照全靠手写，门槛高、易错。
3. **findingsFnRegistry 空转（2026-08-22 修正为背景事实）**：`golden-snapshot-runner.ts:86` `findingsFnRegistry` 是 `{}`——但哨兵 aggregate 依赖 GraphStoreReader + async（financingConstraintSentinel.check 实证签名），不符合同步纯函数契约 → findings 层登记显式 descope（S-10），非本卡可修项。

对齐北星：PRODUCT-BRIEF §八——门禁查语法/安全/接线/架构，不查"产品对齐"；黄金数据集门禁 = 把"客户A真实数据 + 期望诊断"变成机器断言，是产品对齐的机器验证。

## 3. Current State（2026-08-22 grep/read 实测）

### 3.1 已存在（D396/D51/D300 交付，复用不重造）

| 资产 | 位置 | 状态 |
|------|------|------|
| 三层快照执行器 | `scripts/ci/golden-snapshot-runner.ts` | ✅ runComputeSnapshot/runFindingsSnapshot/runExpertReportAssertion + diffObjects + diffFindings |
| 主流程接线 | `scripts/ci/golden-case-checker.ts:264-266` | ✅ runAllChecks 按 fixture 段调用三层执行器 |
| pre-push 接线 | `scripts/pre-push-check.sh:244` | ✅ `npx tsx scripts/ci/golden-case-checker.ts` |
| CI 接线 | `.github/workflows/ci.yml:153` | ✅ golden-case job 同命令 |
| 快照 fixture | `tests/fixtures/golden-cases/golden-case-11-cash-runway-threshold.json` | ✅ 示范 compute 段 |
| compute 登记 | `golden-snapshot-runner.ts:76-79` | ✅ computeCashRunway 1 条 |

### 3.2 缺陷 A（P1）: 黄金数据集回归零接线（M3）

`scripts/workflow/check-golden-regression.sh` 存在（完整 checksum 校验逻辑，exit 0/1），但生产调用方 grep 零结果：

```bash
grep -rn "check-golden-regression" scripts/ .github/  # 仅脚本自身注释，零调用
```

pre-push 只跑 golden-case-checker（F1 + 三层快照，基于 tests/fixtures/），**不跑 client-a 黄金数据集**——黄金数据集与门禁之间没有通路。

### 3.3 缺陷 B（P1）: 无 keyless 录制模式

`golden-snapshot-runner.ts` 只有"回放 diff"（snapshot 缺失 → degraded 显式失败），无"录制"路径：`runComputeSnapshot` 在 `!section.snapshot` 时直接 `degraded:true`（L145-148）——不能"跑真实函数 → 生成 snapshot 段 → 供人工确认冻结"。新 fixture 的快照只能手写 JSON（golden-case-11 即人工填）。

### 3.4 缺陷 C（P2）: findingsFnRegistry 空转（2026-08-22 修正——降级为背景事实）

`golden-snapshot-runner.ts:86` `export const findingsFnRegistry: Record<string, (input: unknown) => FindingSnapshot[]> = {}`——findings 快照机制（runFindingsSnapshot/diffFindings）完整但零登记。**修正结论**：哨兵 aggregate（如 financingConstraintSentinel.check = (store, teamId, traversal?) → Promise<SentinelFinding[]>）依赖 L4 GraphStoreReader + async，不符合 findingsFnRegistry 的同步纯函数契约——强行适配 = 快照测的不是真实函数（违背 D396"真跑"锚点）。故 findings 层登记 = **显式 descope（S-10）**，本卡黄金数据集检查走 compute 纯函数 + severity 级对比。

## 4. What We Build

### 4.1 写集 (3 修改 + 1 新建)

| 文件 | 操作 | 说明 |
|------|:---:|------|
| [scripts/ci/golden-snapshot-runner.ts](scripts/ci/golden-snapshot-runner.ts) | 修改 | ① 新增 keyless 录制入口 `recordComputeSnapshot(section)`：跑真实函数 → 返回可写入 fixture 的 snapshot 段（供人工确认冻结，缺陷 B）② 新增 `runGoldenDatasetCheck(datasetPath)`：读 data/golden/wani-baby-v1.json → 对已登记的 compute 纯函数跑真实代码 → severity 与 dataset.sentinels[哨兵名].expected 对比（缺陷 A/C 机制支撑；**不做 findings 集合 diff**——数据集 sentinels 是 {expected,value} 结构非 FindingSnapshot[]，2026-08-22 实证） |
| [scripts/ci/golden-case-checker.ts](scripts/ci/golden-case-checker.ts) | 修改 | ① runAllChecks 追加阶段 5：黄金数据集检查（读 data/golden/wani-baby-v1.json + checksums → runGoldenDatasetCheck），缺陷 A ② 追加 `--record` 模式（录入 fixture 快照，不判定），缺陷 B |
| [scripts/pre-push-check.sh](scripts/pre-push-check.sh) | 修改 | golden-case 区块追加调用 `bash scripts/workflow/check-golden-regression.sh --verify-only`（checksum 校验，黄金数据集完整性）——缺陷 A 接线 |
| [tests/ci/golden-case-checker.test.ts](tests/ci/golden-case-checker.test.ts) | 修改 | 新增 keyless 录制 + 黄金数据集 severity 对比 + 降级测试（≥8 用例，见 §5） |

> 说明：`check-golden-regression.sh --verify-only` 已有（checksum 校验分支），本次只接 pre-push 调用，不改其逻辑（除非接线暴露缺陷）。client-a 数据集的 sentinels/expectedDiagnosis 字段结构已实证（16 个哨兵 dict + expectedDiagnosis.rootCauseEdges/causalChain）。

### 4.2 修复模式

**keyless 录制（golden-snapshot-runner.ts 新增）**:

```ts
/**
 * recordComputeSnapshot — keyless 快照录制（DSH snapshot 范式）
 * 契约:
 *   @input  — section: ComputeSnapshotSection（function + input，无 snapshot）
 *   @output — { snapshot: Record<string, unknown> } 跑真实函数生成的冻结候选
 *   @degraded — function 未登记 → { error } + stderr（不静默）
 *   录制 ≠ 判定：返回的 snapshot 须人工确认后写入 fixture（冻结），回放走 runComputeSnapshot
 */
export function recordComputeSnapshot(section: ComputeSnapshotSection): { snapshot?: Record<string, unknown>; error?: string } {
  const fn = computeFnRegistry[section.function];
  if (!fn) return { error: `compute function "${section.function}" 未登记` };
  try {
    return { snapshot: fn(section.input) as Record<string, unknown> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

**黄金数据集检查（runGoldenDatasetCheck — 契约修正版，2026-08-22 实测）**:

```ts
/**
 * runGoldenDatasetCheck — 黄金数据集门禁（client-a 真实数据 + 期望诊断）
 * 契约（实证 data/golden/wani-baby-v1.json 结构）:
 *   @input  — dataset: GoldenDataset，其中 sentinels: Record<哨兵名, { expected: severity, value: number }>
 *             expectedDiagnosis: { rootCauseEdges, primaryBlocker, severity, causalChain }
 *   @output — SnapshotCheckResult：
 *             ① 对每个「已登记在 computeFnRegistry 的哨兵 compute 纯函数」跑真实代码
 *                → 产出 severity → 与 dataset.sentinels[哨兵名].expected 对比（severity 级 diff）
 *             ② expectedDiagnosis.severity 与数据集声明的全局严重度对比
 *   @degraded — 数据集缺 sentinels/expectedDiagnosis → degraded:true + stderr（不静默 pass）
 *   ⚠️ 数据集 sentinels 是「哨兵名 → {expected, value}」结构（cash-runway → {expected:"critical", value:0.22}），
 *      不是 FindingSnapshot[]（{id,severity,title}）——diff 契约是 **severity 级对比**，
 *      不做 findings 集合 diff（findingsFnRegistry 契约是 FindingSnapshot[]，两者不混用）
 */
```

**findingsFnRegistry 登记（修正——不强行登记 store 依赖 aggregate）**:

```ts
// 2026-08-22 实测修正: financing-constraint/aggregate.ts 的 financingConstraintSentinel.check
// 签名 = (store: GraphStoreReader, teamId, traversal?) => Promise<SentinelFinding[]>
// ——依赖 L4 GraphStoreReader + async，**不符合 findingsFnRegistry 的同步纯函数契约**
// (input: unknown) => FindingSnapshot[]。强行包装适配器 = 快照测的不是真实函数，违背 D396
// "真跑 compute 纯函数" 锚点。故 findings 层登记 = 显式 descope（S-10），本卡只登记 compute 纯函数。
// 黄金数据集检查基于 computeFnRegistry 已有登记（computeCashRunway 等）+ severity 级对比。
```

### 4.3 不做的事

| 不做 | 原因 |
|------|------|
| 改 F1 判定逻辑（computeF1Score/deriveActual） | K3"只扩用例不改判定"（D396 明令） |
| 改 check-golden-regression.sh 本体逻辑 | 已有完整 checksum 校验，本次只接线（除非暴露缺陷则回填） |
| 改 src/ 业务逻辑（compute 阈值/哨兵 aggregate） | 归 D355-D360 实现线（Win Claude），本任务只登记 registry |
| 全诊断管线端到端跑 client-a（起服务） | 归 GSS 场景脚本（D361+），本任务只做数据级快照 |
| 改 .github/workflows/ci.yml | 接 pre-push 即可（CI golden-case job 已跑同命令） |
| 批量登记全部哨兵 aggregate | 2026-08-22 修正：哨兵 aggregate 依赖 GraphStoreReader + async（financingConstraintSentinel.check 实证），不符合 findingsFnRegistry 同步纯函数契约——**findings 层登记显式 descope（S-10）**，本卡只登记 compute 纯函数（D396 已示范 computeCashRunway） |

## 5. Test Requirements（测试优先 — 铁律 0-2/48，red→green）

**第一步（red）**: 扩展 `tests/ci/golden-case-checker.test.ts`，用例在实现前必须失败：

| 用例 | 修复前（red） | 修复后（green） |
|------|------|------|
| L1 黄金数据集接线：`grep -rn "check-golden-regression" scripts/pre-push-check.sh` 命中调用行 | 零调用 | 命中 |
| L1 keyless 录制：`recordComputeSnapshot({function:'computeCashRunway', input:[...]})` 返回含 snapshot 的对象 | 函数不存在 | 返回 snapshot |
| L1 keyless 录制：未登记 function → 返回 error（不静默） | 不存在 | error 返回 |
| L1 黄金数据集检查：读 wani-baby-v1.json → 对已登记 compute 纯函数跑真实代码 → severity 对比 SnapshotCheckResult | 函数不存在 | 返回结构化结果 |
| L1 黄金数据集降级：数据集缺 sentinels → degraded:true + stderr | 不存在 | degraded |
| L1 severity 对比：`computeCashRunway` 输出 signal='critical' 与 dataset.sentinels['cash-runway'].expected='critical' 一致 → passed:true | 无对比逻辑 | passed:true |
| L1 severity 对比红-绿：改坏 cash-runway.ts 阈值（`<6`→`<3`）→ severity 漂移 → passed:false；恢复 → passed:true | 门禁不响（未接线） | 红/绿机器复现 |
| L1 findings 登记 descope 回归：findingsFnRegistry 保持 `{}` 且黄金数据集检查不依赖它（S-10 显式 descope） | — | 空 registry 不阻塞黄金数据集检查 |
| L1 回归：D396 三层快照原用例全绿（runComputeSnapshot/diffFindings 行为不变） | — | 全绿 |
| L2a 接线：pre-push golden-case 区块含 check-golden-regression 调用 | 无 | grep 命中 |

**第二步（green）**: 实现后全绿。

| 层 | 类型 | 数量 | 覆盖 |
|:---|------|:---:|------|
| L1 | vitest 单元 | ≥10 | 上述 10 用例（正常/降级/边界/红-绿/severity 对比/descope 回归） |
| L2a | 接线 | 1 | pre-push 真实调用 check-golden-regression |

## 6. Wiring Verification

| 新 export/函数 | 生产调用点 | 确认方式 |
|---------------|-----------|---------|
| recordComputeSnapshot | golden-case-checker.ts `--record` 模式 | `grep -n "recordComputeSnapshot" scripts/ci/golden-case-checker.ts` 命中调用（非仅 import） |
| runGoldenDatasetCheck | golden-case-checker.ts runAllChecks 阶段 5 | `grep -n "runGoldenDatasetCheck" scripts/ci/golden-case-checker.ts` 命中调用 |
| check-golden-regression 接线 | pre-push-check.sh golden-case 区块 | `grep -n "check-golden-regression" scripts/pre-push-check.sh` 命中调用行（测试调用不计，S-3） |

> 生产调用点必须（S-3）：pre-push 真实调用 check-golden-regression（grep 断言）；runGoldenDatasetCheck 被 runAllChecks 真实调用。findingsFnRegistry 显式 descope（S-10），不做非空断言。

## 7. Test Requirements（契约明细，铁律 47/48）

### 7.1 L1 单元契约 — golden-case-checker.test.ts 扩展（≥10 用例）

- 正常路径：keyless 录制返回 snapshot；黄金数据集检查返回结构化结果；severity 对比一致 → passed
- 降级路径：数据集缺字段 → degraded:true + stderr（不静默 pass）
- 边界条件：未登记 function / 空 dataset / 录制对象含 undefined 字段 / findingsFnRegistry 保持 `{}` 不阻塞
- 失败模式覆盖（S-5）：门禁不响（broken 接线）/ 录制静默失败（broken 降级）/ severity 漂移（broken 对比）

### 7.2 L2a 接线契约

- pre-push-check.sh golden-case 区块在 F1 门禁后追加 check-golden-regression --verify-only（grep 断言）
- CI golden-case job 已跑 golden-case-checker（含阶段 5 黄金数据集），无需改 ci.yml

### 7.3 L2b 降级契约

- client-a 数据集缺失/损坏 → runGoldenDatasetCheck degraded:true + stderr（铁律 11/24）
- check-golden-regression 在 pre-push 中失败 → exit 1 阻断（不静默吞，铁律 31）

### 7.4 L2c 边界契约

- checksum 匹配但代码改坏 compute 纯函数 → 黄金数据集检查红（checksum 防不住代码回归，正是本任务补的）
- checksum 不匹配（数据集被改）→ check-golden-regression 红
- 两者独立判定，任一红 → push 阻断
- 数据集 sentinels 含未登记 compute 的哨兵 → 跳过该哨兵（registry 登记什么查什么，不因未登记全量红）

## 8. Architecture Layer

**L0（测试/门禁层）**。依据：
- `scripts/ci/` + `scripts/workflow/check-golden-regression.sh` + `scripts/pre-push-check.sh` 全在治理层（施工图 §3 🟡 搬走）
- 黄金数据集 `data/golden/` 是测试资产（冻结快照），非 L1-L5 业务代码
- registry 登记的是哨兵 compute/aggregate 纯函数引用（import 真实代码，不改其实现）——不触碰 src/ 业务逻辑
- 接线点 pre-push 归 Mac DSH（控制塔体系）

## 9. Completion Standard（DS 与 dev doc 一一对应，禁重编号/跳号/静默缺项——S-10）

1. DS1: `tests/ci/golden-case-checker.test.ts` 全过（≥10 新用例；red 已证——pre-push 接线缺失在修复前 grep 零命中）
2. DS2: keyless 录制——`recordComputeSnapshot` 存在且对合法 fixture 返回 snapshot（`grep -n "recordComputeSnapshot" scripts/ci/golden-snapshot-runner.ts` 命中定义）
3. DS3: 黄金数据集检查——`runGoldenDatasetCheck` 存在且读 data/golden/wani-baby-v1.json（grep 命中）
4. DS4: 黄金数据集降级——缺字段 → degraded:true + stderr（铁律 11/24）
5. DS5: severity 对比——`computeCashRunway` 输出 signal 与 dataset.sentinels['cash-runway'].expected 对比（测试断言 passed:true；改坏阈值 → passed:false）
6. DS6: 红-绿演练——临时改坏 cash-runway.ts 阈值 → runGoldenDatasetCheck passed:false；恢复 → passed:true（机器复现）
7. DS7: 接线——`grep -n "check-golden-regression" scripts/pre-push-check.sh` 命中生产调用（测试调用不计，S-3）
8. DS8: 零回归——`bash scripts/control-tower/baseline-check.sh` 无新增失败；D396 三层快照原用例全绿
9. DS9: 写集一致——`git diff --name-only HEAD^` 与 §4.1 写集一致，无越界文件
10. DS10: 无绕过——pre-commit 13 组全过、bypass.log 无 `--no-verify`
11. DS11: 完成报告含决策记录（§4.2 录制/接线两处模式选择的参考系与结论，S-12）——K3 可核

> 交付声明必须覆盖以上 DS1-DS11 全部并标注状态（✅/⏸/❌+理由）；禁止重编号/跳号/静默缺项。

## 10. Auth Doc References

- [Stage1 派发文档](docs/synova/coordination/Stage1-派发-devdoc-20260821.md)（Spec 3 / D3）
- [第六章借鉴清单 B3](docs/synova/research/Harness研究与Synova战略再定位-20260816/第六章-借鉴清单与走出自己的特色-20260816.md)
- [C 线差距清单](docs/synova/research/C线-世界级基准-20260802/第五章-差距清单与路线图-20260802.md)（S1-1 / L108 一致性声明）
- [D396 dev doc](docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D396-golden-case-gate-20260816.md)
- [golden-case-checker.ts](scripts/ci/golden-case-checker.ts) / [golden-snapshot-runner.ts](scripts/ci/golden-snapshot-runner.ts)
- [check-golden-regression.sh](scripts/workflow/check-golden-regression.sh) / [pre-push-check.sh](scripts/pre-push-check.sh)
- [client-a 黄金数据集](data/golden/wani-baby-v1.json) + [checksums](data/golden/checksums/wani-baby-v1-checksums.json)
- AGENTS.md 铁律 0-2/11/24/31/35/36/48

## 11. 自检清单

- [x] check-golden-regression.sh 零接线实测（grep scripts/ .github/ 仅脚本自身）
- [x] 三层快照现状实测（golden-snapshot-runner.ts runComputeSnapshot 等 + fixture golden-case-11）
- [x] findingsFnRegistry 空转实测（:86 `{}`）+ **修正：不强行登记 store 依赖 aggregate**（financingConstraintSentinel.check 签名实证 = (store, teamId, traversal?) → Promise<SentinelFinding[]>，不符合同步纯函数契约 → 显式 descope，S-10）
- [x] pre-push/CI 接线现状实测（pre-push-check.sh:244 + ci.yml:153）
- [x] client-a 数据结构实证（16 哨兵 dict = {哨兵名: {expected, value}} + expectedDiagnosis.rootCauseEdges/causalChain）——**diff 契约 = severity 级对比，非 findings 集合 diff**
- [x] 决策参考已记录（keyless 录制形态/接线点/severity 对比契约，§4.2）
- [x] 测试 red→green 覆盖失败模式（S-5：门禁不响/录制静默失败/severity 漂移）
- [x] DS 与 dev doc 一一对应（DS1-DS11）；写集表标题紧跟表头（D381 格式契约）
- [x] 与 D472/D473/D471 写集零交集（并行安全，S-7/S-8）
- [x] 不是凭记忆；不用 --no-verify

## 12. 复核修复记录（2026-08-22 impl 后独立复核，commit 7e44c02e）

> 创始人要求交付后批判性复核。复核发现 2 个真实问题并修复（K3 可核）:

1. **main 入口阶段 5 失败误绿（高严重度）**：`golden-case-checker.ts` isMainModule 分支只检查 `report.failedCases`（golden-case 计数），阶段 5（黄金数据集 severity 对比）失败时 failedCases=0 但 summary='SOME_FAILED' → 门禁误 exit 0。修复：`failedCases>0 || summary!=='ALL_PASSED'` → exit 1（fail-closed）。红-绿实测：改坏阈值 → exit 1；恢复 → exit 0（修复前误绿）。
2. **expectedDiagnosis.severity 过度约束（中严重度）**：原实现做"全局 severity ∈ 已登记哨兵期望集合"匹配——全局严重度是跨哨兵聚合结果，未必等于任一单哨兵 expected，未来数据集重建会误伤。修复：放宽为结构断言（存在 + 值域合法 critical|high|medium|low|warning|healthy），不做跨哨兵匹配。测试更新（合法值≠单哨兵期望 → 通过；非法值 → diff）。
