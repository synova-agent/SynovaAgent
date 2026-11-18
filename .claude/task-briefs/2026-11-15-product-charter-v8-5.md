# Task Brief: 产品宪章 v8.5 与主线施工契约

## Q0: 定位（项目拼图 + 文件审计）
- 创始人已于 2026-11-15 确认持续经营导航、企业上下文和链式召回方向，并明确产品宪章以 v8.5 为当前执行版本。
- 本票只交付产品文档、施工规格、登记和本 brief，不修改产品代码、运行时或门禁。

## Q1: 调研（决策链 / 既有基础）
- 底稿为 `docs/synova/产品宪章-v8.4-镜像.md`；v8.5 不回写历史镜像。
- 产品决策记录方向与理由；宪章呈现完整产品图景；总体规格承载代码差距、施工契约和验收。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- `docs/synova/产品宪章-v8.5-修订稿.md`
- `decisions/implemented/product/2026-11-15-goal-navigation-enterprise-context.md`
- `docs/synova/Synova-首个客户主线-总体施工规格与Win-CTO交接-v1.0-2026-11-15.md`
- `docs/authority/DOCS-REGISTRY.yaml`
- `.claude/task-briefs/2026-11-15-product-charter-v8-5.md`
不做什么：
- 不修改 `src/**`、`extensions/**`、`scripts/**`、`.gitea/**` 或 `docs/synova/产品宪章-v8.4-镜像.md`。
- 不新增门禁，不合并 PR，不声称代码已实现产品契约。

## Q3: 验收（入口 → 交互 → 结果）
- 入口：当前产品宪章 v8.5 和总体规格。
- 交互：三份文档在中性扫描、⑤持续导航、②①③④分工、链式召回和因果验证上口径一致。
- 结果：文档真值检查通过，PR compare 仅含本 brief 声明文件，无产品代码。

## Q4: 契约与测试
- 运行 `bash scripts/doc-system/check-doc-truth.sh`；硬检查须通过。
- 运行 `git diff --cached --check` 和 PR compare；不得包含未声明文件或删除基线其他登记。
- 本地 pre-commit 的依赖缺失与历史软提示如实报告，不冒充通过。

## 本任务在哪一层
- 产品宪章与主线施工治理；不改代码层 L1–L5。

## Done 标准（至少一条可验证）
- [x] 文档真值硬检查通过。verify: `bash scripts/doc-system/check-doc-truth.sh` 输出“全部硬检查通过”。
- [x] 写集仅限五份声明文件。verify: `git diff --cached --name-only` 与 Q2 对照。
