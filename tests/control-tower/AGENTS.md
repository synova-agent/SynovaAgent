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
- 报备：#808 `weekly-recon.test.sh`（周对账探针 `scripts/control-tower/weekly-recon.sh` 配对测试；WIRE：`grep -rn "weekly-recon" .gitea/ scripts/ tests/` 非零）。
- 报备：#828 `weekly-recon-launchd.test.sh`（launchd 安装器 `scripts/control-tower/weekly-recon-launchd.sh` 配对测试：HOME 隔离＋PATH 注入假 launchctl，绝不触系统 launchd；WIRE：`grep -rn "weekly-recon-launchd" tests/ scripts/` 非零）。

## 红线
测试命名三档（`*.test.ts`/`*.integration.test.ts`/`*.e2e.test.ts`）｜ 集成测试 cover **真实路由**｜ 与根件零重复。

## 🔗 改本域涉及的包（双向清单 · 2026-10-18）

P4｜P7｜P3｜P6👁

> 口径：与 `handbook 包/交叉矩阵-12守则×10包.md` 一致；`👁`=只读不改
