# D662 Task Brief — 专家名残留全量收口（analytical-lens + skills + _extinct）

> 任务 ID: D662 | 日期: 2026-09-10 | 线: Win | Agent: claude | clone: .sessions/D662/repo @ 478dae53
> 唯一契约: docs/plans/codex/implementation/SYNOVA-IMPL-D662-expert-residual-sweep-20260910.md
> #CRITERIA: C

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
Synova = 驻扎企业的 AI 诊断与增长导航 Agent（诊断是手段，增长是目的）。专家体系是 L3 洞察层核心：5 位问题域专家（fundamental-efficiency / customer-growth / organizational-capability / technology-foundation / competitive-strategy）+ host 主持 + multi 跨专家。D650（registry）/ D651（引用）/ D658（哨兵 manifest）已合入，本卡收末梢三处残留：② tests/expert/analytical-lens.test.ts:15 EXPERTS 含 7 旧名；③ tests/skill/d66-manifests.test.ts:23 VALID_EXPERTS 含旧 8 名 + extensions/skills/builtin 41 个 manifest expert 字段旧值；④ extensions/sentinels/_extinct 12 个归档 manifest 同步。该层现有模块：expert/（新 5+host IDENTITY.md 已就位）、src/skill/skill-loader.ts（expert: string 自由字段）、extensions/skills/builtin/（41 出厂技能）。本任务 = 既有文件 expert 字段值机械替换 + 两条测试断言对齐权威口径，不新增机制、src/ 零改动。

### b) 文件审计
grep 实测（clone @ 478dae53）：extensions/skills/builtin expert 分布 = host 9 / finance 8 / marketing 5 / knowledge 4 / org 4 / strategy 4 / action 3 / multi 2 / business_model 1 / tech 1，合计 41；extensions/sentinels/_extinct 分布 = finance 5 / strategy 5 / org 1 / tech 1，合计 12。消费方审计：src/skill/skill-loader.ts:53 expert 为自由 string 不校验取值（改名零运行时风险）；src/skill/skill-loader.ts:99 loadSkills 为加载入口；src/sentinel/types.ts:222-231 仅 type-import _extinct 的 aggregate/computes（不读 manifest）；tests/ 全域无断言 _extinct manifest expert 字段；sentinel-loader 只扫 extensions/sentinels/ 一层，_extinct 不加载。结论：全部复用既有 55 文件做值替换，无新建、无冲突。

### c) 决策
已有覆盖→复用（迁移映射复用 D651 §2.2：finance→fundamental-efficiency、strategy→competitive-strategy、org→organizational-capability、tech→technology-foundation、marketing→customer-growth、action→host、business_model→competitive-strategy、knowledge→host；host/multi 保留）；冲突→取消（无）。决策点 1：skills expert 字段对齐改名（skills 是专家能力载体，标签应指向新问题域名，依据第六章「专家名禁 cycle」+「专家体系完整」）。决策点 2：_extinct 只改字段名不删目录（退役归档保留，与 D658 归档先例同源）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 权威口径：docs/synova/research/专家架构重定义与权威口径审计-20260905/ 第六章 §6.6 术语表（问题域 5 专家、禁含 cycle）+ 第七章 §7.4 英文名；docs/authority/AUTHORITY-UPGRADE-NOTICE-20260906.md。
- 唯一契约：docs/plans/codex/implementation/SYNOVA-IMPL-D662-expert-residual-sweep-20260910.md §2.2 迁移映射 + §4 red→green 测试要求。
- 先例：D650/D651/D658 三卡同一映射已合 main，本卡复用同表保证全仓口径一致。
- memory/ 教训：2026-09-09-d650（G12 matches() 只认路径末段 → Q2 必须逐文件枚举 55 条）；2026-09-10-d658（跨午夜 hook 拦 → 今日内完成提交；基线对照前先存全量 patch）；2026-09-08-d598（clone+junction vitest 双实例全灭 → node --preserve-symlinks node_modules/vitest/vitest.mjs 唯一有效）；2026-09-08-d599（DS 判定用字面量勿写进源码注释）。
- 决策参考四步（docs/synova/coordination/DECISION-REFERENCE.md）：①第一性原理 = expert 标签是能力归属声明，权威口径已改，标签必须跟随；②Anthropic 基线 = 数据文件迁移用机械映射表 + 测试先红后绿锁定契约；③开源实证 = D650/D651/D658 同模式三卡已验证；④收敛 = 一张映射表覆盖三处残留，无歧义、无新抽象。

## Q2: 范围 — 正确的最简方案
本任务排除项与边界：不改 skill-loader/schema、不删 _extinct 归档目录、host/multi 不动、不用全局 sed、src/ 零改动（详见文末排除清单）。
做什么（expert 字段值迁移，机械改名）：
- tests/expert/analytical-lens.test.ts
- tests/skill/d66-manifests.test.ts
- extensions/skills/builtin/acquire-competitive-intel/manifest.json
- extensions/skills/builtin/acquire-customer-data/manifest.json
- extensions/skills/builtin/acquire-financial-data/manifest.json
- extensions/skills/builtin/acquire-operational-data/manifest.json
- extensions/skills/builtin/acquire-org-health-data/manifest.json
- extensions/skills/builtin/agent-self-health/manifest.json
- extensions/skills/builtin/analyze-break-even/manifest.json
- extensions/skills/builtin/analyze-capital-allocation/manifest.json
- extensions/skills/builtin/analyze-competitive-position/manifest.json
- extensions/skills/builtin/analyze-cost-structure/manifest.json
- extensions/skills/builtin/analyze-customer-value/manifest.json
- extensions/skills/builtin/analyze-learning-curve/manifest.json
- extensions/skills/builtin/analyze-operating-leverage/manifest.json
- extensions/skills/builtin/analyze-price-elasticity/manifest.json
- extensions/skills/builtin/backup-restore/manifest.json
- extensions/skills/builtin/check-data-source-health/manifest.json
- extensions/skills/builtin/conflict-resolution/manifest.json
- extensions/skills/builtin/cross-expert-review/manifest.json
- extensions/skills/builtin/detect-plan-deviation/manifest.json
- extensions/skills/builtin/diagnose-agency-cost/manifest.json
- extensions/skills/builtin/diagnose-cashflow-health/manifest.json
- extensions/skills/builtin/diagnose-churn-root-cause/manifest.json
- extensions/skills/builtin/diagnose-competitive-decay/manifest.json
- extensions/skills/builtin/diagnose-margin-erosion/manifest.json
- extensions/skills/builtin/diagnose-org-health/manifest.json
- extensions/skills/builtin/diagnosis-calibration/manifest.json
- extensions/skills/builtin/distill-expert-knowledge/manifest.json
- extensions/skills/builtin/enterprise-growth-diagnosis/manifest.json
- extensions/skills/builtin/knowledge-base-maintenance/manifest.json
- extensions/skills/builtin/manage-sentinel-config/manifest.json
- extensions/skills/builtin/match-best-practice/manifest.json
- extensions/skills/builtin/prescribe-budget-allocation/manifest.json
- extensions/skills/builtin/prescribe-market-entry/manifest.json
- extensions/skills/builtin/prescribe-pricing-strategy/manifest.json
- extensions/skills/builtin/prescribe-synergy-value/manifest.json
- extensions/skills/builtin/retrieve-industry-benchmark/manifest.json
- extensions/skills/builtin/self-diagnose-agent/manifest.json
- extensions/skills/builtin/survival-crisis-diagnosis/manifest.json
- extensions/skills/builtin/synthesizer-invoke/manifest.json
- extensions/skills/builtin/track-execution-progress/manifest.json
- extensions/skills/builtin/verify-hypothesis/manifest.json
- extensions/sentinels/_extinct/adaptation-velocity/manifest.json
- extensions/sentinels/_extinct/capital-efficiency/manifest.json
- extensions/sentinels/_extinct/capital-structure/manifest.json
- extensions/sentinels/_extinct/capital-turnover/manifest.json
- extensions/sentinels/_extinct/competitive-dynamics/manifest.json
- extensions/sentinels/_extinct/competitive-moat-perceptual/manifest.json
- extensions/sentinels/_extinct/competitive-moat-structural/manifest.json
- extensions/sentinels/_extinct/connector-coverage/manifest.json
- extensions/sentinels/_extinct/cost-health/manifest.json
- extensions/sentinels/_extinct/market-lifecycle/manifest.json
- extensions/sentinels/_extinct/profit-health/manifest.json
- extensions/sentinels/_extinct/structural-change/manifest.json
不做什么（含文件路径）：
- 不修改 src/skill/skill-loader.ts

边界说明（prose，非排除路径）：不改 skill-loader / manifest schema（expert 是自由 string 字段，skills 域自洽）；不删 extensions/sentinels/_extinct/ 目录本体（退役归档保留，CI 白名单排除、sentinel-loader 不加载）；host 与 multi 既有字段值一律不动；不用全局 sed（host/multi 误伤风险），只按旧值精确映射替换；不改 expert/ 目录与 IDENTITY.md（D650 已收口）；spec §3.2 确数偏离回填（DS2 确数）随本 commit。

## Q3: 验收 — 入口 → 交互 → 结果
入口（触发）：vitest 与 CI 测试门禁 —— npx vitest run tests/expert/analytical-lens.test.ts tests/skill/d66-manifests.test.ts。
处理（中间步骤）：analytical-lens 遍历 EXPERTS 断言 expert/<名>/IDENTITY.md 存在且含 analytical_lens 章节；d66 断言 41 个 builtin manifest 的 expert ∈ VALID_EXPERTS（新 5+host+multi）。RED 阶段：先改两测试断言，旧名失配 → 红（analytical-lens 旧 7 名 IDENTITY.md 不存在 7 failed；d66 旧 8 名不在 VALID）；GREEN 阶段：迁移 53 个 manifest expert 字段 → 全绿。
结果（最终展示）：vitest 全绿 + DS1 旧名零残留计数 0 + DS2 新名命中计数（builtin 23 + _extinct 12 = 35）+ git diff --name-only 写集对照 + PR CI task-relevant jobs 绿。

文档引用：docs/plans/codex/implementation/SYNOVA-IMPL-D662-expert-residual-sweep-20260910.md（§2 审计/§3 写集/§4 测试/§6 DS1-DS8）；docs/synova/research/专家架构重定义与权威口径审计-20260905/ 第六章 §6.6 + 第七章 §7.4；docs/authority/AUTHORITY-UPGRADE-NOTICE-20260906.md。

接口审计（从代码 grep，非记忆）：
src/skill/skill-loader.ts:loadSkills
tests/skill/d66-manifests.test.ts:VALID_EXPERTS
tests/expert/analytical-lens.test.ts:EXPERTS

## 架构层: L3
extensions/skills = L3 专家能力载体；tests/ 为质量契约层；本卡不改五层路由链，src/ 零改动。

## Done 标准:
- verify: rg -c '"expert": "(finance|strategy|org|tech|marketing|action|business_model|knowledge)"' extensions/skills/builtin extensions/sentinels/_extinct 零命中（DS1）
- verify: rg -c '"expert": "(fundamental-efficiency|competitive-strategy|organizational-capability|technology-foundation|customer-growth)"' extensions/skills/builtin = 23 且 extensions/sentinels/_extinct = 12（DS2 确数，回填 spec §3.2）
- verify: npx vitest run tests/expert/analytical-lens.test.ts tests/skill/d66-manifests.test.ts 全 pass（DS3 red→green）
- verify: npx vitest run tests/expert/ tests/skill/ 全绿；npx tsc --noEmit 报错集 = 基线 28 零新增（DS4）
- verify: rg "as any" 两个测试文件新增行零命中（DS5）
- verify: git diff --name-only 恰为 55 写集 + spec 回填 + brief 簿记（DS6）
- verify: grep -n "no-verify" .claude/bypass.log 零命中（DS7）
