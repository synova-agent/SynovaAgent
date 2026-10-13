# AGENTS.md · src/l3/（洞察层）

> 归属：**产品线** ｜ 承载包：**K7**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR1/7）

## 是什么
洞察/报告模板代码域（锚下 32 文件，30 天 5 commits——P1 立件）：`report-template-loader.ts`、`report-templates.ts` 等；5 类扩展物中 4 类落点（2026-10-02 旧方案依据之一）。

## 谁改
产品线。报告**内容**（模板件）在 `extensions/reports/`（归 `extensions/` 件）；本域只管装载/渲染代码。

## 怎么算完成
- 模板装载改动：`tests/l3/report-contract-versioned.test.ts`（契约版本）＋`report-template-client.test.ts` 绿。
- 新模板类型：契约 JSDoc 先行＋`extensions/reports/contracts/` 同步。

## 红线
模板**版本兼容全 [待建]**（capability.yaml 未实存，图纸未核 #3）——改契约版本字段须留"兼容性未裁"注记｜ 与根件零重复。
