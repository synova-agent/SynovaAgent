---
状态: proposed
日期: 2026-09-23
决策: 编排入口模块（*Handler/*Runner/*Coordinator/*Dispatcher）必须经 deps 接口 + setter 注入取协作者，禁止在调用点直连生产活单例；该规则由可执行检查器（R1/R2，首版只报不拦）+ ratchet 存量清单 + 带理由豁免文件执行。
理由: 直连活单例使①测试无法替换协作者②依赖关系不进签名③降级无统一缝可插桩。而"加一条 pre-commit"不够——必须机器化，否则必然退化为文档约定（铁律 35；V3.9 教训：软机制 0% 有效）。首版**只报不拦**是刻意取舍：先取得覆盖面与误报数据，再翻转（门槛见标准文档 §6-F5）。
---

# 决策 Note — D925 deps 接口 / setter 注入标准（含闭集与范围的取舍）

> 卡号 D924 系列姊妹卡；本 Note 按 `memory/notes/README.md`「四字段头契约」撰写（状态/日期/决策/理由四项必填）。
> 不写可选的 `任务:` 头字段 —— 与 D924 Note 同因（D472 生命周期门禁把 `spec_done` 视为已落地，
> 与 README 迁移表要求的 `impl_done/audited` 相悖，见证据 §6 相关登记）。
> 涉及卡号：D925（`task-state/D925.json`）。

## 触发现场（实测）

`src/agent/loop-handlers.ts` 已有 **5 组**注入缝（`:105/:294/:444/:560/:617`，签名一律 `(deps: XxxDeps | null): void`）
——**正向样板**；而 `:374 defaultEvolutionHandler` 在 `:377` 直连 `getFeedbackCollector()` **活单例**——**反例样板**
（CTO 裁定 5：登记为后续卡，本卡不改 `src/**`）。

## 决策内容（三条取舍均为技术自决，队长核准）

1. **判定单位 = 编排入口（变体 B 窄口径）**。不加"入口函数命名"条件时，闭集在 `src/` 命中 **18 文件**，
   其中 `src/routes/backup.ts`、`src/tui-v2/chat.tsx`、`src/deploy/bootstrap.ts`、`src/cron/scheduler.ts`
   等**基础设施消费者**会被误判为违规（17 条 baseline 稀释 ratchet）。窄化后存量 **2 文件**。
   命令：`git grep -lE '<闭集>\(' -- src | wc -l` → 18；再按 `export (async )?function …(Handler|Runner|Coordinator|Dispatcher)\(` 窄化 → 3 文件，减去已有缝者 → 2。
2. **闭集排除 `getDatabase`/`getDb`**。两条硬理由：①`git grep -l 'getDatabase(' -- src | wc -l` → **34 文件**，纳入即 34 处噪声；
   ②`src/agent/loop-handlers.ts:471` 的 `deps?.getDatabase ?? (await import('../init/engine-context')).getDatabase`
   是**标准的惰性生产默认写法**，纳入会把合规代码判违规（正是"禁 grep 型静态判据"要防的形态）。
3. **降级只允许显式（两条缝）**：测试注入缝 + **带理由**的豁免文件。禁静默 bypass、禁环境变量一键全豁免；
   **无理由的行不生效**；**文件缺失/格式坏 → 0 条豁免**（fail-closed：报得更多，不是放行更多）。

## 依据（参考系，K3 可核）

- 第一性原理：判定单位应匹配"谁该负责注入"——是**编排入口**，不是所有 getter 消费者。
- Anthropic 工程基线：契约优先（脚本头 `@input/@output/@exit/@degraded/@error`）+ 三态退出码（fail-closed）。
- 开源实证：setter/ambient 注入是既有单例系统渐进改造的主流范式（生产默认惰性构造 + 显式覆盖）。
- 本地实证：判据冻结阶段先量化误报面（18 / 17 / 34 / 3 / 2 各数均附命令），再定判据——**先量后写**。

## 反例防复发（判别性设计）

夹具 27 断言含：**变异体①**（改坏 R1 主判据 → 反例样例必须**漏判**，证明红样只由真判据捕获）；
**变异体②**（改坏豁免理由校验 → 无理由豁免被错误吸收，证明理由校验承重）；
**自我豁免**（检查器源码副本放进 `src/` → 0 命中，防自吞）；**diff 模式**（只判新增，落实"只对新模块生效"）。

## 已知边界与失效条件

见 `docs/synova/coordination/标准-deps接口与setter注入-20260923.md` §6（F1 文件级→函数级；F2 `packages/**` 未纳入；
F3 闭集扩 DB；F4 入口命名扩充；F5 何时从 report 翻转为拦；F6 何时放宽为宽口径；F7 整体归档）。
