# Task Brief: D977-sentinel-builtins-export-key — 0-3 内建哨兵装载器命名（#977）

> 生成: 2026-10-04 | 分支: fix/sentinel-962-datapath | 工作树: .synova-wt-sentinel-962 | 卡: GitHub #977（父 #973/#974，命名空间 N1）
> 写者: synova-sentinel（哨兵能力面负责人，产品线负责人名下）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务在 **L3 洞察层**（`src/sentinel/`）。该层有**双加载器**：
文件驱动哨兵由 `src/sentinel/sentinel-loader.ts` 扫 `extensions/sentinels/*/manifest.json`；
**内置适配器**由 `src/sentinel/builtins.ts` 扫 `src/sentinel/adapters/*-sentinel.ts`。
本次改的是**内置适配器加载器**——它按文件名推导导出键（`filenameToExportKey`），
而 4 个内置适配器的**真实导出名与推导键全部不一致** ⇒ 4 个全注册失败（实测 `registered=0 / scanned=4`）。
修复方式：**精确键优先 + 哨兵结构遍历兜底**（推荐做法）⇒ 命名约定从「必须记住的规矩」变为「结构上不可能错」。

### b) 文件审计
- `src/sentinel/builtins.ts:25-28` `filenameToExportKey`（按文件名推导）→ **改**（加结构兜底）
- `src/sentinel/adapters/` 4 个文件（只读，**不改**）：
  `cash-flow-sentinel.ts → cashFlowSentinel`｜`cpc-sentinel.ts → cpcSentinel`｜
  `goal-alignment-sentinel.ts → goalalignmentSentinel`（小写 L）｜`integration-health-sentinel.ts → integrationHealthSentinel`
- `tests/sentinel/builtins.test.ts` **已存在**（配对测试）→ 改（原断言在空列表上空转绿）
- 生产调用方 `src/agent/synova-agent.ts:78-79`（boot 时注册，**在 `SentinelRunner.start()` 之前**，只读不改）
- 消费方 `src/sentinel/runner.ts:323-324`（`listCronSentinels()` → cron 排程，只读不改）

### c) 决策
采取「精确键优先 + 结构遍历兜底」而非「统一导出命名 + CI 断言」：
① 后者要动 4 个适配器的导出名 = 扩大写面 + 可能碰外部引用；
② 前者对**未来任何新增适配器**都免疫（结构判定，不看名字）；
③ 精确键优先保留「名字对得上时行为与旧实现逐字一致」，只有名字错时才走兜底并 `log.warn` 留痕（可观测）。
参考：第一性原理（结构 > 约定）+ 铁律 35（自动化优先）。收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① 复现（探针跑生产入口 → `registered=0`）→ ② SPEC（判定口径＝哨兵结构：`config.id` 非空字符串 + `check` 为函数）
→ ③ 实现（`isSentinelShape` + `resolveSentinelExport`）→ ④ 接线（生产调用方已是 `registerBuiltinSentinels()`，无需改）
→ ⑤ 验证（改坏即红四步 + vitest 回归护栏）。
引用铁律 0-2（接线验收）、铁律 11/31（静默降级禁止）、铁律 47（契约优先 JSDoc）、铁律 48（测试非空壳）。

### b) 执行约束
- rule: "注册数 = 磁盘适配器文件数"
  verify: "tsx 探针：registered=4 total=4 scanned=4；vitest：count()===adapterFileCount()"
- rule: "判据改坏即红"
  verify: "删结构兜底 → 探针 RED(missing=4) + vitest 3 failed；恢复 → 全绿；SHA 一致"

### c) 决策参考系
参考：第一性原理（结构判定优于命名约定）+ 铁律 35（能变测试的不靠文档）。收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- `src/sentinel/builtins.ts`（装载器：加结构兜底 + JSDoc 契约）
- `tests/sentinel/builtins.test.ts`（配对测试：加 #977 非空转回归护栏）
- `.claude/task-briefs/D977-sentinel-builtins-export-key.md`（本文件，控制塔提交路径必需）

不做什么：
- 不改 `src/sentinel/adapters/*.ts`（4 个适配器导出名保持原样——结构兜底的意义就是不必改）
- 不改 `src/sentinel/registry.ts` `src/sentinel/types.ts`（注册表/类型契约未变）
- 不改 `src/agent/synova-agent.ts`（生产调用方已有，无需接线）
- 不改 `scripts/**` `ci.yml`（非本域）
- 不删 4 个适配器上的 `// @deprecated` 注释（退役属哨兵四问之「删干净」，另卡）

## 写集

| 文件 | 类别 |
|---|---|
| `src/sentinel/builtins.ts` | task（装载器：结构兜底 + JSDoc 契约） |
| `tests/sentinel/builtins.test.ts` | task（配对测试：#977 非空转回归护栏） |
| `.claude/task-briefs/2026-10-04-D977-sentinel-builtins-export-key.md` | task（本文件） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`registerBuiltinSentinels()`（生产调用点 `src/agent/synova-agent.ts:78-79`，boot 时执行）
处理：扫描 `adapters/*-sentinel.ts`（4 个）→ 动态 import → 结构判定取哨兵 → `registry.register()`
结果：注册表 `total=4 / cronCount=4`；`GET /api/sentinel/reports` 与 cron 排程可见这 4 个内置哨兵

## 架构层: L3（src/sentinel/**）

#CRITERIA: A

## Done 标准
- [ ] 探针（真实 `registerBuiltinSentinels()`）输出 `registered=4 total=4 scanned=4`，ids 含 4 个内置哨兵
- [ ] 改坏即红四步：删结构兜底 → 探针 `RED missing=4` + vitest 3 failed → 恢复 → 全绿，SHA 前后一致
- [ ] `vitest run tests/sentinel/builtins.test.ts` 3/3 通过，且含「空列表必红」断言
- [ ] `tsc --noEmit` 在 `src/sentinel/builtins.ts` 零错误（存量 28 错均为 `_extinct/**` 等既有噪声）
