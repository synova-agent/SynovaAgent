# Task Brief: D922 Phase 0 — 双 DSH 提升落地总计划

> 生成: 2026-09-23 | 任务: D922（程序卡） | 认领: synova-squad-lead（队长）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图

Synova = AI 诊断 Agent。本任务在**治理层（scripts/control-tower + 规范文档）**，不在 L1–L5 产品代码层。
本任务 = 程序卡 D922 的 **Phase 0**：只出《双 DSH 提升落地总计划》（含依赖图 / W1 三卡方案骨架 / 前置冻结清单 / 风险与上限），**不执行 W1**（执行待 CTO 复核放行）。
该层现有模块：控制塔门禁族（`scripts/control-tower/*.sh|*.py`，62 项）、CI 12 项 required checks、dev doc 规格族。本任务**新增**总计划文档与 Phase 0 证据，**不改**任何门禁脚本。

### b) 文件审计

- 派单件（规格来源）：`docs/synova/coordination/派单-W1-双DSH提升-20260923.md` — 实测**仅在 PR #719 分支**，未落 main。
- 裁定：`docs/synova/coordination/裁定-双DSH提升清单-20260922.md` — main 可读。
- 写集冲突扫描：本任务拟写 4 文件（总计划 1 + 证据 3），`git grep` 对新建文件名为 0 处命中；与 W1 三卡写集（`scripts/control-tower/**`、`tests/control-tower/**`、`.github/workflows/ci.yml`）**零交集**。
- 复用/新建：**新建**《总计划》（此前无 W1 波总计划）；**复用**既有实测命令与既有门禁（`pre-dispatch-check.sh`）作自证。

### c) 决策

复用既有门禁与证据格式（memory/notes 四态 / evidence 目录约定）；无覆盖 → 新建总计划文档；与 W1 三卡写集无冲突。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **铁律 0-2（spec→test→impl→wire）**：本 Phase 只交规格与前提，不写实现 → 天然合规。
- **铁律 47/48（契约优先 / 测试非空壳）**：三卡骨架已给「三路径夹具（正常/降级/反例）+ 判别性变异体」，反例是"删掉即报红"型，非 grep 型静态判据。
- **铁律 24/31（降级诚实）**：三卡检查器统一契约 `0 通过 / 1 命中违规 / 2 检查执行失败（fail-closed）`，降级必须显式可见。
- **memory/ 历史教训**：D732（派单写集凭印象写错路径）→ 本件逐条实测写集；D919（引用门禁截断漏检）→ 本件实跑 `pre-dispatch-check.sh` 并贴终态输出；D708/G12（判据漂移/误拦）→ 本件把"门禁自身质量"立为不变量。
- **决策参考（Q1c）**：参考：Anthropic/DeepSeek/第一性原理 + 结论 —— ①第一性原理：门禁的价值 = 能被独立复算，故本件以"命令 + 原始输出"为唯一证据形态；②Anthropic 基线：门禁改动必须配判别性夹具，故三卡反例一律为变异体夹具；③开源实证：ratchet（存量清单只减不增）是既有 `as any` 门禁与 `check-pr-budget` 的成熟做法，故三卡沿用 baseline 清单；④收敛：结论 = 依赖边由实测推出（ci.yml 单写者强制串行 + 仓外分支保护为硬前置），非抄清单顺序。

## Q2: 范围 — 正确的最简方案

做什么：

- `docs/synova/coordination/总计划-双DSH提升-W1波-20260923.md` — 总计划（依赖图 / 方案骨架 / 冻结清单 / 风险上限）
- `docs/synova/product-lines/evidence/D922-phase0-recon-20260923.md` — 侦察证据（三域基础设施 + 冲突扫描）
- `docs/synova/product-lines/evidence/D922-phase0-verify-20260923.md` — 独立自验记录（多轮）
- `docs/synova/product-lines/evidence/D922-phase0-lead-probes-20260923.md` — 队长探针与门禁实跑原始输出（附录 B）
- `.claude/task-briefs/2026-09-23-D922-phase0-master-plan.md` — 本 brief 自身（D708 合并级写集对账要求逐条精确路径；CI 实测曾因本文件与下条 Note 未声明而判「夹带 2 个」）
- `memory/notes/proposed/2026-09-23-d922-w1-master-plan.md` — 决策 Note（铁律 49：治理类变更须引四态 Note）

不做什么：

- 不改 `scripts/control-tower/pre-dispatch-check.sh`（只报告其 ④/⑨ 口径缺口，另立卡）
- 不改 `scripts/pre-commit-check.sh`、不改 `.github/workflows/ci.yml`（门禁改动属 W1 三卡写集，本 Phase 不碰）
- 不改 `scripts/audit/**`（K3 红线）；不写审计标准；不做自我审计
- 不改 `src/**` 产品代码
- 不执行 W1（D923/D924/D925 的代码一行不写）

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/总计划-双DSH提升-W1波-20260923.md`
处理：机械项 ①④⑥⑨⑩② 全过（引用 65 条全可核验）；独立自验员只读复算 C1–C15 + 三卡计数 + 引用抽查
结果：总计划四节齐备 + 终态门禁原始输出（exit=0）+ 两轮自验记录 + `git ls-remote` 回执；**停在 Phase 0，等 CTO 复核放行**

## 架构层:

scripts（控制塔/治理层，非 L1–L5）

## Done 标准

- [ ] verify: `bash scripts/control-tower/pre-dispatch-check.sh docs/synova/coordination/总计划-双DSH提升-W1波-20260923.md` → 机械项全通过（退出码 0）
- [ ] verify: `git ls-remote --heads origin | grep d922` → 含 `refs/heads/docs/d922-w1-master-plan`
- [ ] verify: 总计划含「依赖图 / 方案骨架 / 前置冻结清单 / 风险与上限」四节，且 9 子卡依赖边逐条给实测依据
- [ ] verify: 独立自验（非编码成员）对 C1–C15 逐条复算并给出自验结论
