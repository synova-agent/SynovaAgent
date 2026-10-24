---
状态: proposed
日期: 2026-10-25
决策: "时间可注入：新增 src/services/clock.ts（Clock{now(): number; nowIso(): string} ＋ systemClock 为全仓唯一允许直取系统时钟的实现），把两条服务链改为构造注入——FederatedPipeline(anonymizer?, clock = systemClock) 与 MainAgent(auditStore?, taskDecomposer?, conflictArbitrator?, clock = systemClock)；不传 clock ⇒ systemClock，生产行为与改造前逐字节等价。配套 tests/contract/time-injection.test.ts 冻结清单双向棘轮（src/**/*.ts 直取计数 vs 内嵌清单：新增/删除/新文件有直取皆红，唯一豁免 src/services/clock.ts，src 不可读 fail-closed）＋ tests/contract/clock-injection.test.ts 行为判据（同一测试内时间旅行）。B 类：不改 #912 闸、不新增门禁规则/CI 步/盘点行。"
理由: "域函数直取 Date.now()/new Date() ⇒ 测试只能全局 vi.setSystemTime，无法在同一测试内对局部时间精确控制（联邦条目时间戳、循环 startedAt/耗时不可断言）；且新代码再直取系统时钟没有任何机器约束。既有设施齐备（构造函数已有可选参；tests/contract/ 纯断言惯例）⇒ 只加一个 Clock 抽象＋两链注入＋测试内棘轮，不重建门禁。"
---

# #915 Q-6 · 时间可注入（四态 Note）

## 现状（改之前；数量一律给枚举命令，不手写）

- **存量直取（CTO 基线口径：只算 `src`，锚 `3f1098a0a`）**：
  ```bash
  grep -rn 'Date\.now()' src --include=*.ts | wc -l        # 锚上实测 314
  grep -rn 'new Date()' src --include=*.ts | wc -l         # 锚上实测 287
  grep -rlE 'Date\.now\(\)|new Date\(\)' src --include=*.ts | wc -l   # 锚上实测 180 文件
  ```
  **存量一行不动**（本件只清两条链）；棘轮冻结清单按**目录递归全量**口径（= `grep -r` 基线口径）现算 = **178 文件 / now=306 / newDate=270**（= 180 文件 − 本批清零的两链文件 2 件；规格 §6 的 `git ls-files 'src/**/*.ts'` 命令漏 `src` 顶层 9 件，照抄只得 176 文件/304/262，见「已知限制」）。
- **本件两条链**：`src/services/federated-pipeline.ts`（id/createdAt/updatedAt/reviewedAt，10 处直取）｜`src/agent/main-agent.ts`（startedAt/completedAt/durationMs，15 处直取）。
- **构造点**：`src/services/federated-pipeline.ts:74` `constructor(anonymizer?)` → 加第 2 可选参｜`src/agent/main-agent.ts:101` `constructor(auditStore?, taskDecomposer?, conflictArbitrator?)` 已有三个可选参 → 加第 4 可选参（`:105`）。
- **既有可复用设施**：构造函数可选参模式｜`tests/contract/` 纯 node 断言惯例（`assert-never.test.ts` 等）｜三态退出码／`degraded:`／UTF-8（D732）／判别力自检四个既有约定。
- **缺口**：全仓无时钟抽象（`grep -rn "Clock\b" src --include=*.ts` 锚上 0）⇒ 无从注入。

## 决定

1. **新增 `src/services/clock.ts`**（服务层共用件，不新开顶层目录）：`Clock{now(): number; nowIso(): string}`｜`systemClock: Clock`（唯一允许直取系统时钟的实现）｜`MutableClock extends Clock {set(at); advance(ms)}` **只留 interface**（`createMutableClock` 落测试侧，P1 裁 A）；非法输入 fail-fast。
2. **两链构造注入、默认等价**：`FederatedPipeline(anonymizer?, clock: Clock = systemClock)`｜`MainAgent(auditStore?, taskDecomposer?, conflictArbitrator?, clock: Clock = systemClock)`；既有调用点零改动（不传参 = 旧行为）。
3. **本文件清零**：两链的 `Date.now()`/`new Date()` 全改 `this.clock.now()`/`nowIso()`（`durationMs = this.clock.now() - startTime`）；契约头 `@input/@output/@degraded/@error` 同步（铁律 47）。
4. **测试内棘轮（不新增门禁规则）**：`tests/contract/time-injection.test.ts` 内嵌冻结清单（178 文件 → [now, newDate]），逐文件严格相等；增（文件计数变大／新文件有直取）⇒ 红，减（计数变小且清单未更新）⇒ 红，唯一路径豁免 `src/services/clock.ts`，`src` 不可读 ⇒ **失败（fail-closed，不跳过）**。
5. **行为判据（同一测试内时间旅行）**：`tests/contract/clock-injection.test.ts` S1 clock 单元／S2 联邦链 `advance(60s)` 后新条目时间戳前移／S3 `MainAgent.executeLoop('未注册')` 的 `startedAt` 随 `advance(30s)` 前移／S4 不传 clock ⇒ 时间戳≈当前（默认等价回归）。
6. **回滚单一**：无运行时开关（纯注入＋测试）⇒ **单 commit revert**。

## 依据

- **裁定**：**裁 365**（#915 批 3-B 设计模板：只判变更集／存量棘轮／配对测试＋改坏必红／回滚开关）。
- **卡与开工令**：Issue #915 Q-6 行（禁直取／注入 now／只改新增与本次修改的调用链）｜CTO 2026-10-25 开工令（**否决给 #912 闸加第 5 条规则 G5**／改测试内棘轮／基线只算 `src`／白名单路径）。
- **先例**：**#956 Q-1**（新增 `src` 能力件 ⇒ WIRING 新增 1 行 ＋ 受保护测试常量同步 ⇒ P1 批 **A 案：写集 9→13 件**）｜#915 Q-5（B 类只扩既有面、不新建闸）。
- **契约/判据**：规格 `派单件/2026-10-25-规格-915-Q6-时间可注入-v2.md` §4（@input/@output/@degraded/@error）／§5.1（S1–S4）／§5.2（R1–R6）／§5.3（M1–M4 改坏⇒红）／§8（已知限制）。

## 生效时点

本 PR 合入 `local-main` 起生效：新增 `services.clock` 能力（WIRING rows 10→11，`systemClock` 唯一系统时钟入口；生产消费点 = `federated-pipeline`/`main-agent` 两链）；棘轮测试随 `npx vitest run` 生效（无独立开关）。**首个含本 Note 的 commit message 必须引用本文件路径**（D534／铁律 49）。回滚＝单 commit revert（无运行时开关）；仓内时间戳语义不变（时间仍取自系统时钟，只是经 `systemClock` 注入）。

## 已知限制（禁读成「已防护」）

- **棘轮按正则计数**（`Date.now()`／`new Date()` 原文）：注释/字符串里的同形文本也计数（与基线同口径）；`Date.now` 别名、`performance.now()`、带参 `new Date(x)` 不在视野。
- **文件级计数盲区**：同文件内「删 1 加 1」总数不变 ⇒ 不会红（靠 L1 复核＋两态用例补）。
- **只覆盖 `src/**`**：`packages/`、`scripts/`、`tests/` 的直取不在棘轮内（CTO 口径）。
- **规格 §6 清单生成命令勘误**：`git ls-files 'src/**/*.ts'` 漏 `src` 顶层 9 件，其中 `src/server.ts`、`src/mvp-server.ts` 含直取（合计 now=2/newDate=8）⇒ 照抄该命令得 176 文件/304/262；本件按目录递归全量口径（= `grep -r` 基线）实测 **178 文件 / now=306 / newDate=270**。两链清零后剩余存量（306/270）仍直取系统时钟，本件不承诺「全域可注入」。
- **两条链之外的存量不修**：本件只保证新增与本次修改的调用链可注入。
