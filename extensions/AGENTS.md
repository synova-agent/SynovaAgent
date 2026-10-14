# AGENTS.md · extensions/（内容面总入口）

> 归属：**产品线** ｜ 承载包：**K3/K4/K5/K7/K9/K10/K12**（与根件 §0 表逐字一致）｜ as_of `55ead6dec`（PR1/7）｜ 多对多冲突：包编号小者优先（🔴 **约定，不是原则——可改，只换规则不改结构**；裁定 089）＋"⚠️ 待裁"行占位

## 是什么
内容面物理载体之首（宪章 §4.1 六根之一）。判别用根件 §5 三条判据，本件只立**装载纪律**，不复述判据原文（零重复）。

## 谁改
- 各子目录归其包：`sentinels/`→K3（见嵌套件）｜`ontology/`→K4｜`skills/`＋`**/manifest.json`→K9｜9 类 manifest→K10｜`presets|onboarding|adapters|knowledge-scope|policies|tools|reports|locales|notifications` 等→K12。
- 新增内容目录＝**必须带 manifest**（K12-15 装载面纪律）＋登记 `docs/authority/DOCS-REGISTRY.yaml`。

## 怎么算完成
新增/改动内容目录后：重扫（`content-reload`）无错 → 对应 probe `expectExit 0` → manifest 版本字段递增（"新增不覆盖"先例，保留类资产）。

## 红线
本目录下**禁放引擎代码**（内容面判据①会红）｜ 回滚＝旧目录保留＋换回＋重扫（唯一真包级粒度回滚面）｜ 与根件零重复。

## 嵌套件
`extensions/sentinels/AGENTS.md`（K3）。其余热点子目录频次不足，暂不立件。
