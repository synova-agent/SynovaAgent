# AGENTS.md · src/agent/（编排面）

> 归属：**产品线** ｜ 承载包：**K2/K7/K8/K9/K12**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR1/7）｜ 全仓交点最多的代码域：多对多冲突=包编号小者优先（🔴 约定，不是原则——可改，只换规则不改结构；裁定 089）＋"⚠️ 待裁：Kx 要 A／Ky 要 B"行占位

## 是什么
agent 运行核心（锚下 52 文件）：`tools.ts`/`tool-profiles.ts`（K2 工具门禁）、`report-assembler.ts`（K7）、`skill-lazy-loader.ts`（K9）、`prompt-assembler.ts`（K12）。

## 谁改
产品线。并档段（根件 §0 口径"含 security"）：**`src/security/**`**（`file-guard.ts`）——同"写入门禁"性质，不另立件。

## 怎么算完成
- 工具面改动：`tests/agent/tool-role-wiring.test.ts` 绿＋工具策略配置同步。
- 技能面：`probe-skills` 列表与 manifest 一致。
- 报告链：`tests/agent/agent-matrix-trigger.test.ts` 绿。

## 红线
工具门禁语义变更＝门禁域动作，独立送审（同 `.gitea/` 件规约），禁与业务改动同 PR ｜ 静默降级禁止｜ 与根件零重复。
