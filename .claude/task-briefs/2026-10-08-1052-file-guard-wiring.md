# Task Brief: #1052 2-4 写入门禁两道未接（FileGuard 接线 — 落点 A+B）

> 生成: 2026-10-08 | 工作树: `.synova-wt-1052` | 分支: `fix/1052-file-guard-wiring` | 基线: `origin/main b2e211e7a`
> 角色: exec-3（CTO 2026-10-08 放行实施）｜ 结论口径: 执行方自验，**不称审计**；判据原始输出入 PR 正文
> 卡: `gh issue 1052`（CTO R40 裁定 + 4 项待裁已裁：落点 A+B／审计=调用点复用 `AuditStoreLike`→`AuditService`／workDir=`process.cwd()`／覆盖面口径固定形态）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
写入门禁（宪章 §4.3 硬要求①，`产品宪章.md:224`；施工单 2-4，`施工单.md:73`）——**2-1 时序存储的前提**。
- 纵向解耦：**L5 安全件** `src/security/file-guard.ts`（纯逻辑、无 IO）＋ **接线点** `src/loops/middle-evolution-engine.ts`（进化产物写）＋ `src/agent/atomic-write.ts`（B 项：接口就位）＋ `src/deploy/bootstrap.ts`（装配 workDir 修正）。
- 横向解耦：不新增包、不动 `packages/`。
- 扩展解耦：不新增表、不新增租户真源、**不新造授权体系**（真源 = `src/agent/tool-profiles.ts`）。

**现状定性（实测，as_of `origin/main@b2e211e7a`）**：
1. **FileGuard 零消费者**：`git grep -l "canWrite\|canRead" origin/main -- src | grep -v "src/security/file-guard.ts" | wc -l` ⇒ **0**；
2. **容器只写不读**：`ctx.set('fileGuard', …)` 1 处（`bootstrap.ts:1271`）／`ctx.get('fileGuard')` **0** 处；
3. 🔴 **workDir 陷阱**：`bootstrap.ts:1271` 传 `config.dbPath`（默认 `./data/synova.db`，**文件**路径，`config.ts:104-105`）当 workDir ⇒ `checkBoundary`（`file-guard.ts:113-137`）「工作目录内」分支**永不为真** ⇒ naive 接线几乎全拒；
4. **「两道门」实为 0 道门**：PolicyEngine 只在 `routes/data-lifecycle.ts:39/:68`（DATA_EXPORT/DATA_DELETE）活 ⇒ 不覆盖写入；
5. **写原语无收敛点**：`src/` 含写原语的文件 = **24**（本卡**只覆盖进化产物写 3 处**，覆盖面必须声明）；
6. 既有单测绿：`npx vitest run tests/security/file-guard.test.ts` ⇒ **12 passed / exit 0**（须保持）。

### b) 文件审计（实测行号，as_of `origin/main@b2e211e7a`）

| 目标 | 实测行号 | 结论 |
|---|---|---|
| `src/security/file-guard.ts` constructor / canWrite / canRead / checkBoundary | `:73` / `:78` / `:98` / `:114` | 复用；**加** `FileGuardOptions` + `onDecision`（纯逻辑保持） |
| `src/deploy/bootstrap.ts` fileGuard 装配 | `:1270-1272`（传 `config.dbPath`） | **改** workDir → `process.cwd()` |
| `src/loops/middle-evolution-engine.ts` 写点 | `:411`（manifest）／`:495`／`:517`（thresholds） | 三处**写入前过门** |
| `src/loops/middle-evolution-engine.ts` 循环结构 | `:457` `for (const industry of industries)`；`:501` `continue`；`:526-531` break 已移除 | 拒绝 ⇒ `result.errors.push` + `continue` |
| `src/agent/atomic-write.ts` `write()` | `:46-`（178 行；构造点 `bootstrap.ts:964`、`server.ts:236`） | **B 项**：写前过门（今日零调用 ⇒ 只作接口就位＋单测） |
| 审计通道 | `src/services/audit-service.ts` `AuditService.log` `:46`；`init` 在 `bootstrap.ts:684` | **复用**（既有唯一审计写通道；先例 `providers/base.ts:73`） |
| `AuditStoreLike` 契约 | `src/growth/goal-types.ts:303-314` | **复用**（不新建契约） |
| `applyEvolutionActions` 生产调用点 | `src/agent/loop-handlers.ts:23` 导入 / `:425` 调用 | **穿入口载体** |
| 既有端到端链（判据载体） | `tests/growth/evolution-writeback-runtime.integration.test.ts`（186 行 / 17 expect） | 扩展它做拒绝路径断言 |

### c) 决策
已有覆盖 → **复用**（FileGuard 判定逻辑／`AuditService` 审计通道／`AuditStoreLike` 契约／进化写回端到端链）；
无覆盖 → **新增**（`onDecision` 回调 ＋ 3 处门禁调用 ＋ B 项接口就位 ＋ 拒绝路径测试）；
冲突 → 无（串行核查：`fix/986`、`fix/1322` 与本卡写集**不同文件**）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **决策参考系**：第一性原理（门禁必须挂**真实写点**，不是挂"看起来在拦"的地方）＋ Anthropic 工程基线（fail-closed + 显式降级）＋ 本仓实证。
- **memory 教训（同族）**：0-11「双重死门」（`tool-registry.ts` 假门，CTO 2026-10-08 拆）｜#1347「`_role` 恒 null ⇒ 授权分支生产不可达」｜#982「写了没接」——**三次同病**：代码在位、入口不在位。本卡判据一律**穿生产入口**（铁律 4/5）。
- **铁律引用**：4/5（接线）｜24/31（降级可见 + 传播）｜39（层边界）｜47/48（契约 + 测试非空壳）。
- **口径纪律**：R42（计数用 `git grep -l | wc -l`）｜R66（判据写明 ref）｜R71（卡面/计划命令逐条实跑）｜R48/R61/R64（任何"接通/归零"声明必须附**口径 + 范围**）。

## Q2: 范围 — 正确的最简方案

做什么：
- src/security/file-guard.ts
- src/loops/middle-evolution-engine.ts
- src/agent/atomic-write.ts
- src/deploy/bootstrap.ts
- tests/security/file-guard.test.ts
- tests/security/file-guard-wiring.test.ts
- .claude/task-briefs/2026-10-08-1052-file-guard-wiring.md
- .claude/claims/1052.yaml

不做什么：
- 不改 src/tools/tool-registry.ts — R40：0-11 采 (b) 拆门，该项不成立
- 不改 src/agent/tool-profiles.ts — #1347 的授权真源（只读优先）
- 不改 src/store — 属 2-1a 写集
- 不改 src/sentinel — 属 2-1b 写集
- 不改 scripts/audit — 红线
- 不覆盖其余 21 个写点 — 另立卡「写原语全域收敛」（草案已交 CTO 审）

## Q3: 验收 — 入口 → 交互 → 结果

- **入口**：进化写回链 `src/agent/loop-handlers.ts:23/:425` → `applyEvolutionActions()`（生产函数）；单测层直接驱动同一函数。
- **交互**：每个写点在 `writeFileSync` 前 `getFileGuard().canWrite(target)`；拒 ⇒ 不写 + `log.warn` + 审计行。
- **结果**：① 合法路径（`expert/**`、`extensions/industries/**`）写成功 ② 越界/穿越路径**不写**且有审计行 ③ 既有 12 项单测保绿。

## 架构层: L5（`src/security/file-guard.ts`）← 调用方 L2/L3 域（`src/loops/`、`src/agent/`）

- 已核：`PAT_L5='(/store/|/cron/|/l5/|init/engine-context|better-sqlite3)'` ⇒ `services/audit-service`、`security/file-guard` **不在**该模式内 ⇒ 不新增跨层违规；先例 `providers/base.ts:20,73`。`bash scripts/check-architecture.sh` 在基线上**已跑通**。

## Done 标准

- [ ] V1 `git grep -l "canWrite\|canRead" origin/main -- src | grep -v "src/security/file-guard.ts" | wc -l` ⇒ **≥ 1**（今天 = 0）
- [ ] V2 穿生产入口：越界写被拒（拒绝原文 + 原始输出）
- [ ] V3 审计留痕：拒绝产生审计行（查询原始输出）
- [ ] V4 反例双红：拒绝分支改恒放行 ⇒ V2 红；去审计 ⇒ V3 红
- [ ] V5 `npx vitest run tests/security/file-guard.test.ts` ⇒ exit 0（基线 12 passed）
- [ ] V6 `setPolicyEngine` 在 tool-registry = 0（保持）｜`getProfileForRole` 文件数 = 2（不增）
