---
状态: proposed
日期: 2026-10-09
决策: extensions 内容面的 `type → loader` 映射改由**引擎侧唯一真源** `src/deploy/content-registry.ts` 持有；顶层 manifest 的 `entryPoint` 降为纯文档，不再承担可执行语义。
理由: |
  ① 实测（as_of origin/main=5a6591c4a）证明顶层 `entryPoint` 是**语义破损的「文档即配置」**：
     10 处 `../src/...` 反指在「文件相对」口径下 10/10 解析失败（`extensions/src/` 不存在）、
     1 处 `locales` 的 `./locale-loader.ts` 两口径皆悬空、且**顶层 entryPoint 零运行时消费者**。
     ⇒ 映射放在内容侧 = 方向错（内容声明引擎）+ 基准错（差一级）。
  ② 装配散点：`src/init/file-driven-loaders.ts` 原硬编码 8 处 `await import('…-loader')`，
     每个新内容项都要改宿主代码；规范 §5.4 的「0 宿主改动」不可达。
  ③ DSH 亲证（规范 §3.4）：插件的运行时依赖方向是**按名声明 → 宿主注入**，
     与我们「内容主动 import 引擎」相反。本决策只取**方向**，不搬 Cordis 的代际机制。
  ④ 取舍：**宿主扫目录**（否决内容自注册）—— 表是宿主侧静态数据，内容侧零改动即可增删；
     采「早激活（boot 全量解析）/ 失败隔离（逐项 try/catch + degraded 传播）/ 标识持久化」。
  ⑤ 导出面纪律：本模块只导出**生产真消费的两件**（`initContentTypes()` boot 装配、
     `describeContentRegistry()` boot 可观测 + 判据探针取数），其余表项模块私有 ——
     避免「导出但无人调用」的表面积（铁律 0-2 WIRE CHECK 的正确形态）。
  ⑥ 门禁交互（如实记录）：`scripts/check-file-driven.sh` 组(a) 对**暂存 manifest**（含 M）
     硬要求 `entryPoint` 字段，与「顶层 entryPoint 降为纯文档」存在张力；
     本决策的处置 = **保留该字段但只用「文件相对可解析」的形态**，真实映射交给 content-registry，
     不为过门禁写假指针。`extensions/{engine,tools}/manifest.json` 因此**不改动**。
---

# content-registry：extensions 内容面唯一 `type → loader` 真源

## 触发场景

卡 #1465（模块 K10·第1批-补齐·EXT-WIRE 接线族），出处《extensions内容面规范-v0.1》§5.1/§5.2/§5.4。
判据源：`docs/synova/coordination/施工项登记.ts` 的 EXT-WIRE 条目
（`acceptance`: `npx tsx scripts/control-tower/probe-content-registry.ts` expectExit 0）。

## 决策上下文（落地形态）

| 项 | 内容 |
|---|---|
| 唯一真源 | `src/deploy/content-registry.ts` —— 20 项 `type` 全覆盖，每项显式 `status`（`reachable` / `retired` / `pending-cto`） |
| 装配驱动 | `src/init/file-driven-loaders.ts` 只调 `initContentTypes()`；直连 loader import 实测 **8 → 0** |
| 4 项不可达裁决 | `business-models` **接活**（loader 已在库、零调用者）；`engine` / `tools` **废弃显式化**（零读者 / 目录仅 manifest）；`llm-providers` **仅提案不落地**（CTO 预裁） |
| 结构补齐 | `extensions/{context-strategies,implementation-patterns,policies,security}/manifest.json` 4 件新建（§d 组(d) 只查 staged 新增，存量漏网） |
| 判据交付物 | `scripts/control-tower/probe-content-registry.ts`（PRESENCE / INTEGRITY / RESOLVE / CALL 四段，全断言） |

## 状态迁移提示

本 Note 置 `proposed/`：代码已本地交付，但**未 merge**（GitHub 账号级 suspended ⇒ 无法 push/开 PR）
⇒ 尚未「生效」。合入 main 后应 `git mv` 至 `implemented/` 并同步头字段「状态」。

## 参考系

- 规范原文：`~/山河研究院/04-技术研究/专题研究/extensions内容面/extensions内容面规范-v0.md` §3.2 / §3.4 / §3.5 / §5.1 / §5.2 / §5.3 / §5.4
- 架构基准：#1448（`extensions/` = 内容面，`src/` = 引擎面）
- 相关铁律：0-2（接线验收）/ 4-5（写了代码没接线）/ 11·24·31（禁止静默降级）/ 37（dead code）/ 47·48（契约优先 + 测试非空壳）
- 未决（等 CTO）：`llm-providers` 两侧并行的裁决方向 —— 见 `.synova-out/提案-llm-providers-1465.md`

## 🔴 勘误回写（2026-10-09 独立复核 F1，判例 S-07：更正必须回写载体）

本 Note 与交付件初版对 `extensions/llm-providers/*/adapter.ts` 的描述为「1 行 stub（`export const …Adapter = {…}`）」
—— **不实**。复核实测口径：`grep -c '^export'` ×10 **全为 0**；文件**第一字节即 `//`**（`od -c`）；
整文件是**一行注释**，`export` 那句落在**注释体内**（`\n` 为字面两字符）；真 `import()` 实测 **`EXPORTS= []`** ×10。

**为什么必须回写**：该描述是 CTO 待裁项（案 A/B/C）的**决策前提**。初版口径暗示「侧 A 脚手架已成形、只差接活」；
真相是**侧 A 连脚手架都没有、不可被宿主 import** ⇒ **「接活文件驱动系」的真实成本 = 从零写 10 个适配器**，
而非「接上已有实现」。案 B（删空壳、侧 B 保持唯一运行时）的成本与风险**随之更低更安全**（零导出 ⇒ 无调用者可能断裂）。

已同步勘误的载体：本 Note ｜ `src/deploy/content-registry.ts`（`llm-providers.reason` 内置实测原文）
｜ `.synova-out/提案-llm-providers-1465.md`（含「此勘误改变三案成本评估」显式声明）｜ `.synova-out/WIN-1465-交付.md`。
