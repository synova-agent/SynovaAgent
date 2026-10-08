# Task Brief — #1048 2-6 compute 契约注册表最小件：3 条契约 + resolve/调用双断言 + fail-closed

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

**项目拼图**：契约面（承重件 W4）。卡面坐标系：模块 K5 参数层清单+契约注册表，服务承重件 W4-compute注册表，命名空间 K5，施工批次 第2批-地基。目标 = 让「加一个 compute」从**改宿主**变成**加文件 + 自带判据**（宪章 P1 检验标准）。
**文件审计**（一律 `git … origin/main` 口径，本机主工作树落后 1404 禁用）：`src/contract/` 既有 = `contract-gate.ts` + `contract-store.ts`（D215 符号契约存档，**另一概念**，刻意并存不合并）；`COMPUTE-HHI-v1` 全仓 27 处命中；实现 = `extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts:4`（契约ID 注释）`:31`（export function computeHHI）；判据登记源 = `docs/synova/coordination/施工项登记.ts:1697`（`:1071` 已自陈原判据为弱形态）。
**★ 关键现状**：`computeHHI` / `computeDOL` / `computeNPV` 三者**生产调用点 = 0**（各 5 处命中 = 1 定义行 + 4 处 tests）⇒ 契约「登记满天飞、真调用为零」正是本卡要修的缺口。
> ⚠️ 勘误留痕：队长初测曾报「`施工项登记.ts` 不在 main」「`COMPUTE-HHI-v1` 全仓 0 命中」——两条均为**量了落后 origin/main 1404 个 commit 的主工作区**所致（由 sra-smoke 抓出，队长复测确认）。本卡正确口径由 sra-smoke 实测给出。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/第一性原理 + 结论=**注册表只提供"注册表在 + 不生效就报错"，检查由各包自带判据**（对齐 `@deepseek-ai/dsh-invariants` 的 package-owned runtime invariants 范式，仅借范式不引代码）。
历史教训引用：① 「禁 grep 型静态判据当验收」——登记件 `:1071` 自陈 `expectStdoutContains` 是弱形态（可被无关输出满足）⇒ 本卡给 **PRESENCE/RESOLVE/CALL 三段强断言**；② 铁律 32 错误分类强制 ⇒ `ComputeContractError` 带 `.code/.phase/.retryable`；③ 铁律 24/31 禁静默降级 ⇒ fail-closed，无 `degraded:true` 静默通过路径；④ 铁律 48 ⇒ 同 commit 配对测试三路径。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- src/contract/compute-registry.ts
- src/contract/contract-gate.ts
- scripts/control-tower/probe-compute-registry.ts
- tests/contract/compute-registry.test.ts
- docs/synova/product-lines/evidence/D1048-contract-registry-20261008.md
- .claude/claims/1048.yaml
- .claude/task-briefs/2026-10-08-1048-contract-registry.md
- memory/notes/proposed/2026-10-08-1048-compute-contract-registry.md

不做什么（含文件路径）：
- 不改 src/sentinel/**（卡面「绝不能碰」）
- 不改 src/store/**（卡面「绝不能碰」）
- 不碰 scripts/audit/**（审计红线）
- 不改「哪条检查阻断合并」：`compute` 面**不参与** `ValidationReport.pass` 判定（`pass: failures.length === 0 && !degraded` 逐字未改），只上报 `blocking: false`
- 不做全量口径铺开（U-4 已裁非阻塞；全量另立卡）

## 写集

| 文件 | 类别 |
|---|---|
| src/contract/compute-registry.ts | task |
| src/contract/contract-gate.ts | task |
| scripts/control-tower/probe-compute-registry.ts | task |
| tests/contract/compute-registry.test.ts | task |
| docs/synova/product-lines/evidence/D1048-contract-registry-20261008.md | task |
| .claude/claims/1048.yaml | task |
| .claude/task-briefs/2026-10-08-1048-contract-registry.md | task |
| memory/notes/proposed/2026-10-08-1048-compute-contract-registry.md | task |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`npx tsx scripts/control-tower/probe-compute-registry.ts`
处理：注册表 resolve（ID → 实现文件 + 导出符号）→ 真调用（fixture 执行并断言结果 shape 与非空）
结果：`SUMMARY: PASS — presence 1/1 | resolve 3/3 | call 3/3`，**exit 0**；两条反例（删 ID / 指向不存在实现）⇒ **exit 1**；既有 D215 测试仍全绿

## 架构层

L4/契约面（`src/contract/**` 属本体-契约边界之外的工具面）+ `scripts/control-tower/**` 判据件 + `tests/contract/**`。不触五层依赖图跨层；不动 L1/L2/L3 交互与编排。验证级别按实评：resolve + 调用**两步真跑通** ⇒ L3；仅 static ⇒ L1/L2。

## Done 标准

- [ ] `npx tsx scripts/control-tower/probe-compute-registry.ts` ⇒ exit 0，三段断言明确（PRESENCE/RESOLVE/CALL）
- [ ] 反例两条真跑：删契约 ID ⇒ 红；指向不存在实现 ⇒ 红（禁静默）
- [ ] 计数口径写进卡（口径名 + 命令 + 数字，数字自跑）
- [ ] **披露「3 条契约生产调用点 = 0」**（原始输出）
- [ ] 既有 `tests/contract/contract-gate.test.ts` 仍全绿（证明 `pass` 判定未变）
- [ ] `git ls-remote --heads origin | grep 1048` 回执
