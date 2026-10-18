# AGENTS.md · extensions/（内容面总入口）

> 归属：**产品线** ｜ 承载包：**K3/K4/K5/K7/K9/K10/K12**（与根件 §0 表逐字一致）｜ as_of `3ab277c44`（2026-10-18 真源核对）｜ 多对多冲突：包编号小者优先（🔴 **约定，不是原则——可改，只换规则不改结构**；裁定 089）＋"⚠️ 待裁"行占位

## 是什么
内容面物理载体之首（宪章 §4.1 六根之一）。判别用根件 §5 三条判据，本件只立**装载纪律**，不复述判据原文（零重复）。

## 谁改
- 各子目录归其包：`sentinels/`→K3（见嵌套件）｜`ontology/`→K4｜`skills/`＋`**/manifest.json`→K9｜9 类 manifest→K10｜`presets|onboarding|adapters|knowledge-scope|policies|tools|reports|locales|notifications` 等→K12。
- 新增内容目录＝**必须带 manifest**（K12-15 装载面纪律）＋登记 `docs/authority/DOCS-REGISTRY.yaml`。

## 怎么算完成
新增/改动内容目录后：重扫（`content-reload`）无错 → 对应 probe `expectExit 0` → manifest 版本字段递增（"新增不覆盖"先例，保留类资产）。

## 红线
本目录下**禁放引擎代码**（内容面判据①会红）｜ 回滚＝旧目录保留＋换回＋**重启**（🔴 重扫**不卸**：`content-reload.ts` 无 `unregister`，裁定 167-U2）（唯一真包级粒度回滚面）｜ 与根件零重复。

## 嵌套件
`extensions/sentinels/AGENTS.md`（K3）。其余热点子目录频次不足，暂不立件。

## 🔴 2026-10-18 增量：**内容面在客户形态不可装载**（最重要的事实）

```
 同 SHA 只换形态（裁定 161 复现矩阵）：
   · **dev**（tsx src/index.ts）⇒ registered **46**／total **50**（46 内容 ＋ 4 builtin）
   · **bundle**（dist/backend.mjs, node22）⇒ **5**／errors **41**
   · **桌面 GA**（Electron 内嵌 node 20.18.3）⇒ **0**（46/46 失败）
   · **容器** ⇒ **0**（`Dockerfile` builder **不 COPY `extensions/`**，实测 grep=0）
 ⇒ 🔴 **"加目录＋重扫即生效"只在 dev 形态成立；客户形态需 C4 修法**
   （C4 阶段 1 已验收：#558 head `75abe203a`；阶段 2 补 `COPY extensions/`＋6 根分发，待 U1）
 🔴 **根因形态**：`aggregate.ts` 顶层**无扩展名相对 import**（ESM）＋ Electron node20 **无 TS 支持**
   ⇒ 解法：**构建期逐入口 esbuild bundle 为自包含 `.js`** ＋ `extensions/package.json {"type":"module"}`（marker）
```

## 🔴 2026-10-18 增量：**6 根内容面的分发现状**

| 根 | 桌面 | 容器 | 归 |
|---|---|---|---|
| `extensions/**` | 随包 ✅ | ❌ | P2（C4） |
| `cycles/**` | ❌ | ❌ | P2（C4 阶段 2 · R3=B 6 根统一分发） |
| `expert/**` | ❌ | ❌ | P2 |
| `knowledge/**` | ❌ | ❌ | P2 |
| `skills/**` | ❌ | ❌ | P2 |
| `customer-config/**` | ❌ | ❌ | P2（🔴 **只发模板骨架**，客户实例 `wani-baby/activity-production.json` 不得进包 —— 裁定 167-U1） |
