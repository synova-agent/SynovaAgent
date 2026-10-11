# #1056 3-11 专业包层（L1.5）机制

#CRITERIA: A

## Q0:
定位：K4 本体·因果边·循环编号 ｜ 施工批次第 3 批 ｜ 卡 https://github.com/synova-agent/SynovaAgent/issues/1056
项目拼图：宪章 5.2 通用性四层覆盖（L0 基线 / L1 行业包 / **L1.5 专业包** / L2 客户层）现为 **⑤ 纯缺口**。
本任务在**内容加载器**侧补 L1.5 层，使解析顺序成为 `custom > profession > industry > builtin`，
L1.5 物理载体 = `extensions/` 下内容目录（加文件即生效，P1），供第三方维护、跨客户复用。
文件审计（实测 as_of origin/main=5a6591c4a）：`src/extensions/` 仅 2 个 re-export 代理；
`extensions/professions/` 不存在；`tests/extensions/` 整目录不存在 ⇒ 全部新建。
决策：既有覆盖（无）⇒ 文件驱动新建；机制落 `src/extensions/`（卡面 §④ 授权）。

## Q1:
调研：① 唯一三层先例 = `src/playbook/playbook-loader.ts` 的 `PLAYBOOK_ROOTS`（卡面 C7/C8）；
② 第二套层系统 = `src/config/config-layers.ts`（卡面 C9，客户配置包轴 D599/B-10）；
③ 归并内核复用点 = 其 `mergeLayers`（稀疏 patch 语义）。
第一性原理（D333）：层叠覆盖的正确实现 = **升序应用 + 后者胜 + 键级合并**；门禁/铁律参考系 =
铁律 0-2 接线验收（step5 WIRE CHECK 须有生产调用方）、铁律 24/31（ENOENT 正常默认 vs 解析失败须
log.warn + degraded）、铁律 38（as any 零容忍）、铁律 45（注释内 `* /`）。Anthropic 基线 = 先定义
契约（铁律 47）再实现、先设计验证标准再写码。
结论：按卡面 §③.1 显式顺序自建，**不照抄** playbook 实现（其实测与声明相反，见证据件 §二.1），
**不引用** `config-layers` 的 `LAYER_ORDER`（卡面 §③.2）。

## Q2:
做什么：
- src/extensions/layer-resolver.ts  （🔴 原名 src/extensions/profession-layer.ts，CTO 2026-10-11 裁定改名）
- src/deploy/content-registry.ts    （🔴 接线落点：登记 `professions` 项 ＋ `MODULE_IMPORTS` 加键 ＋ 计数钉 24→25）
- tests/deploy/content-registry.test.ts（🔴 计数断言同步：total 24→25 / reachable 19→20）
- extensions/professions/manifest.json
- extensions/professions/chain-retail-expansion/manifest.json
- extensions/professions/chain-retail-expansion/thresholds.json
- tests/extensions/layer-precedence.test.ts
- tests/extensions/profession-layer.test.ts
- docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md
- .claude/task-briefs/2026-10-09-1056-l15-profession-layer.md
- .claude/claims/1056.yaml
不做什么（含文件路径）：
- **不改 src/init/file-driven-loaders.ts**（🔴 CTO 2026-10-11「甲」裁定：保留 main 侧 #1465 的
  content-registry 唯一真源形态；本卡零改动该文件，接线改落 `src/deploy/content-registry.ts`）
- 不改 extensions/ontology/node-types.json（#1057/#1436/#1134 在飞）
- 不改 extensions/playbooks/manifest.json（本卡不碰 playbooks 域任何字节）
- 不改 scripts/audit/check-gates-v2.py（审计域红线，禁碰）
- 不改 scripts/control-tower/probe-content-registry.ts（控制塔域；其 `counts.total !== 20` 存量计数钉
  属批 1/K12-21 写集，本卡只登记不处置）
- 不改 .github/workflows/ci.yml（改门禁语义须走 提案→K3→CTO）
- 不改 src/playbook/playbook-loader.ts（其三层倒置为写集外缺陷，已报 Lead 另立卡）
- 不改 packages/extension-registry/src/index.ts（机制落在 src/extensions/，不越 packages 域）
- 不改 src/config/config-layers.ts（只复用其 mergeLayers 内核，不复用其 LAYER_ORDER）
- 不新建 extensions/customers/manifest.json（L2 客户层沿用既有 customer-config/<orgId>/ 约定，不新造顶层目录）

## Q3:
入口：`src/deploy/bootstrap.ts` Phase 3b → `initFileDrivenLoaders()` → `initContentTypes()`
     → registry 的 `profession` 项按名声明 → `src/extensions/layer-resolver.ts :: initProfessionLayer()`
处理：`loadProfessionPackages()` 文件驱动发现 `extensions/professions/<专业包>/manifest.json`
     → `detectCustomerFragmentation()` 反碎片化审计（≥2 客户同键同值 ⇒ 告警）
     → 逐包 `resolveContentLayers()` 四层栈自检（发现到 ≠ 叠得进去；未参与层叠 ⇒ unwired + degraded）
结果：`log.info({layers:'builtin < industry < profession < custom', packages, fragmentation, unwired})`；
     包声明解析失败/内容未参与层叠 ⇒ `errors[]` + `degraded=true` 经 registry 的
     `collectInitWarnings` 进 `ContentInitReport.warnings`（不抛错，铁律 24/31）。
验收链路：`npx vitest run tests/extensions/layer-precedence.test.ts` exit 0（V0–V4 + V7 + P1）
     + 真实包 `extensions/professions/chain-retail-expansion/` 在两个 orgId 下均命中。

## 架构层: L4 本体层（内容面扩展）

## Done 标准
- [x] V2 判据原文命令 exit=0 verify: npx vitest run tests/extensions/layer-precedence.test.ts
- [x] V1 同一 L1.5 包在两个 orgId 下均被命中 verify: 同上（真实路径 extensions/professions/chain-retail-expansion）
- [x] V3 覆盖顺序 custom>profession>industry>builtin 逐层断言胜出者身份 verify: 同上
- [x] V4 叠加=覆盖非替换（下层独有键保留） verify: 同上
- [x] V5 把 L1.5 从加载顺序真删 ⇒ 必红（真实退出码 1） verify: 证据件 §四 V5 原始输出
- [x] V6 覆盖语义改整文档替换 ⇒ 必红（真实退出码 1） verify: 证据件 §四 V6 原始输出
- [x] V7（🔴 批 2 新增，对应 CTO「甲」裁定后的接线形态）registry 声明 ＋ boot 真执行：
      `npx vitest run tests/extensions/layer-precedence.test.ts` 的 V7 组 5 用例（① registry 登记
      professions 项按名指向 layer-resolver／② boot 真调 initProfessionLayer 且 ok／③ 真实包参与层叠
      且 unwired 为空／④ 构造 unwired 真值必报 degraded／⑤ 降级信号经 registry 上抛）
      verify: 同命令 ＋ 证据件 §五（红证：改名 export ⇒ 4 红；恢复后 hash 一致）
- [x] 被改文件的既有测试未被改测试迁就且仍绿 verify: npx vitest run tests/init/file-driven-loaders.test.ts
      ＋ npx vitest run tests/deploy/content-registry.test.ts（计数断言同步后 18/18 绿）

---

## 批 2 变更记录（CTO 2026-10-11「甲」裁定落地 · 本卡第二次交付）

**背景**：分支自 2026-10-09 04:01 起在 `src/init/file-driven-loaders.ts` 的**旧 131 行版**上作业
（尾插 45 行 L1.5 块）；而同日 03:40 的 `ed7613c1`（#1465）已把该文件**整文件重写为 88 行
content-registry 唯一驱动版** ⇒ rebase 时整文件级冲突（取证见
`D:\novis-backup-20260526\Novis\.k4-b2-lead\K4-07-冲突取证-b2.md`）。

**裁定**：保留 main 侧 content-registry 真源；L1.5 接线改为「经 content-registry 声明」。

**落地差异（本卡 w.r.t. 第一次交付）**：

| # | 项 | 第一次交付（4d004a5d） | 批 2（本提交） |
|---|---|---|---|
| 1 | 接线落点 | `src/init/file-driven-loaders.ts` 尾插 45 行块 | `src/deploy/content-registry.ts` 登记 `profession` 项（按名声明 ＋ 零参 init）＋ `MODULE_IMPORTS` 加键 |
| 2 | 宿主装配入口 | 被改（+45） | **零改动**（`git diff origin/local-main -- src/init/file-driven-loaders.ts` ⇒ 空） |
| 3 | registry 计数 | 不涉及 | 完整性钉 `CONTENT_TYPES.length` 24→25；测试断言 `total 24→25` / `reachable 19→20` |
| 4 | 层序语义位置 | `profession-layer.ts` 的 `CONTENT_LAYER_ORDER` | **不变**（仍只在 resolver 内；registry 表七元无 order 字段位，不承载层序） |
| 5 | 文件改名 | `src/extensions/profession-layer.ts` | `src/extensions/layer-resolver.ts`（全仓引用改净，含 manifest `entryPoint`） |
| 6 | boot 入口函数 | 无（块内内联） | 新增 `initProfessionLayer()`（零参，包名一律来自目录扫描，不硬编码） |

**写集超卡面两项（PR 正文须显式声明）**：
1. `src/deploy/content-registry.ts`（+2 项写集之一）—— 理由：「接线 = registry 声明」是 CTO 裁定，
   而该表有项数硬钉 `CONTENT_TYPES.length !== 24` 与「dir 集 ↔ `extensions/` 顶层目录集双向相等」
   判据测试，加项必须同改；
2. `tests/deploy/content-registry.test.ts`（+2 项写集之二）—— 同上，计数断言同步（24→25 / 19→20）。
   （原第三项 `src/init/file-driven-loaders.ts` 已**移出**写集：本卡零改动该文件。）

