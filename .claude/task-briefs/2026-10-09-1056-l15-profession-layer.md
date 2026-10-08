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
- src/extensions/profession-layer.ts
- src/init/file-driven-loaders.ts
- extensions/professions/manifest.json
- extensions/professions/chain-retail-expansion/manifest.json
- extensions/professions/chain-retail-expansion/thresholds.json
- tests/extensions/layer-precedence.test.ts
- tests/extensions/profession-layer.test.ts
- docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md
- .claude/task-briefs/2026-10-09-1056-l15-profession-layer.md
不做什么（含文件路径）：
- 不改 extensions/ontology/node-types.json（#1057/#1436/#1134 在飞）
- 不改 extensions/playbooks/manifest.json（本卡不碰 playbooks 域任何字节）
- 不改 scripts/audit/check-gates-v2.py（审计域红线，禁碰）
- 不改 .github/workflows/ci.yml（改门禁语义须走 提案→K3→CTO）
- 不改 src/playbook/playbook-loader.ts（其三层倒置为写集外缺陷，已报 Lead 另立卡）
- 不改 packages/extension-registry/src/index.ts（机制落在 src/extensions/，不越 packages 域）
- 不新建 extensions/customers/manifest.json（L2 客户层沿用既有 customer-config/<orgId>/ 约定，不新造顶层目录）

## Q3:
入口：`src/init/file-driven-loaders.ts :: initFileDrivenLoaders()`（服务启动即执行，生产调用方）
处理：`loadProfessionPackages()` 文件驱动发现 `extensions/professions/<专业包>/manifest.json`
     → `detectCustomerFragmentation()` 反碎片化审计（≥2 客户同键同值 ⇒ 告警）
     → 逐包 `resolveContentLayers()` 四层栈自检（发现到 ≠ 叠得进去）
结果：`log.info({layers:'builtin < industry < profession < custom', packages, fragmentation})`；
     单包解析失败走 `log.warn(..., '— degraded')`，不抛错（降级传播，铁律 24/31）。
验收链路：`npx vitest run tests/extensions/layer-precedence.test.ts` exit 0（V1–V6 + P1）
     + 真实包 `extensions/professions/chain-retail-expansion/` 在两个 orgId 下均命中。

## 架构层: L4 本体层（内容面扩展）

## Done 标准
- [x] V2 判据原文命令 exit=0 verify: npx vitest run tests/extensions/layer-precedence.test.ts
- [x] V1 同一 L1.5 包在两个 orgId 下均被命中 verify: 同上（真实路径 extensions/professions/chain-retail-expansion）
- [x] V3 覆盖顺序 custom>profession>industry>builtin 逐层断言胜出者身份 verify: 同上
- [x] V4 叠加=覆盖非替换（下层独有键保留） verify: 同上
- [x] V5 把 L1.5 从加载顺序真删 ⇒ 必红（真实退出码 1） verify: 证据件 §四 V5 原始输出
- [x] V6 覆盖语义改整文档替换 ⇒ 必红（真实退出码 1） verify: 证据件 §四 V6 原始输出
- [x] 被改文件的既有测试未被改测试迁就且仍绿 verify: npx vitest run tests/init/file-driven-loaders.test.ts
