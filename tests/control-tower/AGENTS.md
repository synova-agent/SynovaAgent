# AGENTS.md · tests/control-tower/（控制塔测试域，含 golden-scenarios）

> 归属：**治理线** ｜ 承载包：**K12**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR2/4）

## 是什么
控制塔测试与契约断言域（30 天 275 commits）。`*.test.sh` 断 probe 契约、`content-coupling.test.sh` 断内容耦合。

## 谁改
- 测试骨架＝治理线；断言值随对应块卡判据走（改断言先引卡号）。
- 并档段（根件 §0 口径"含 golden-scenarios"）：**`scripts/golden-scenarios/**`**（GS-08 报告可读等黄金场景）——测试性质同域，不另立件；GS 场景改动在本件报备。

## 怎么算完成
- 新增/改 probe ⇒ 对应 `tests/control-tower/` 断言同步（WIRE CHECK：`grep` 零结果＝未完成）。
- vitest 零失败才合并；测试必有 `expect()`（禁空壳）。

## 红线
测试命名三档（`*.test.ts`/`*.integration.test.ts`/`*.e2e.test.ts`）｜ 集成测试 cover **真实路由**｜ 与根件零重复。
