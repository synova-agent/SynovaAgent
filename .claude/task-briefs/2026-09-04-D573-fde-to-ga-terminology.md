# D573 — FDE 术语退役，统一 GA（Growth Advisor，增长顾问）

> 项目身份: SynovaAgent — 组织数字孪生诊断 + 持续增长导航系统。本任务在 L1 交互表层（提示词/文案/术语）+ L2（tool-profiles 角色映射）+ 治理文档锚点链。
> 日期: 2026-09-04 | 创始人裁决: GA = Growth Advisor（增长顾问），FDE 术语退役并入 GA | #CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。桌面端 D538 已裁定"界面无 FDE，统一 GA"（electron-renderer 零 FDE + capability.test.ts 守卫），但该裁决只落地在前端。本任务把同一裁决推广到全仓运行时表面：L0/L1 提示词、工具描述、报告文案、技能/专家文件、门禁脚本展示文案、锚点文档链。

### b) 文件审计
全仓 (?i)fde = 575 处 / ~200 文件。分级实测：T0 运行时字符串 15 文件（l0-global-prompt.ts / conversation-engine.ts / knowledge-expert-tools.ts / pkb-seed.ts / mvp-server.ts / diagnosis-upload-v2.ts / extensions/playbooks/builtin/PB-cross-enterprise-growth.yaml / skills×4 / expert/tech+template×3 / report-template.html）；T1 tool-profiles.ts:85 `case 'FDE'` + 配对测试（生产从未赋值 FDE 角色，RBAC 实际五角色 admin/manager/liaison/staff/ga，`ga` 现掉 default→minimal 属潜伏 bug）；T2 注释 12 文件；T3 门禁脚本 3 个（scripts/audit/ 红线不碰）；T4 锚点链（PRODUCT-BRIEF/AGENTS/CLAUDE/SPEC/authority×3/GLOSSARY/TASK-ROUTING/runbooks×2/SPEC-TEMPLATE/双轨 skills×4）。历史档案（audit-reports/archive/plans/task-state/memory/WORKLOG/_deprecated/全量对齐手册136处/specs/sentinels 12 文件）不动。

### c) 决策
术语已由创始人裁决（GA = Growth Advisor）；GLOSSARY #16 现写 Growth Architect 与代码注释 Growth Advisor 分裂 → 以创始人裁决为准统一为 Growth Advisor；FDE 退役说明仅保留在 GLOSSARY（门禁白名单），其余表面零 FDE。

## Q1: 调研 — 历史教训与先例

- 铁律 9（关键变更 grep 全仓库传播）：术语是跨 200 文件的核心定义，改完必须全仓 grep 复核 + 防回归门禁。
- 铁律 35（自动化优先）：先例 = capability.test.ts L114 `expect(label).not.toMatch(/FDE/)` 已证明"断言守卫"有效；本任务升级为全仓门禁脚本（白名单制）。
- 先例 D538/D544/D550：验收项"术语无 FDE"用 `grep -rn FDE electron-renderer/src/ = 0` 物理证明——本任务复用同款验收方式。
- 铁律 0-4/审计红线：scripts/audit/ 为审计线资产，永不修改（analyze-transitive-closure.py 内的 fde-toolset.ts 陈旧路径留给审计线自行处理）。
- D370 技能双轨一致性：.claude/skills 与 .dsh/skills 必须同步改，否则组 13 拦。

## Q2: 范围 — 正确的最简方案

做什么：
- src/l1/l0-global-prompt.ts
- src/agent/conversation-engine.ts
- src/tools/knowledge-expert-tools.ts
- src/l3/pkb-seed.ts
- src/mvp-server.ts
- src/routes/diagnosis-upload-v2.ts
- extensions/playbooks/builtin/PB-cross-enterprise-growth.yaml
- skills/strategy/market-gravity.md
- skills/marketing/jtbd-interview.md
- skills/action/constraint-id.md
- skills/business-model/canvas-nine.md
- expert/tech/TOOLS.md
- expert/_template/TOOLS.md
- expert/_template/RULES.md
- docs/synova/report-template.html
- src/agent/tool-profiles.ts
- tests/agent/tool-profiles.test.ts
- tests/agent/knowledge-conflict-handler.test.ts
- src/orchestrator/subagent-coordinator.ts
- src/l3/pkb-lifecycle.ts
- src/sentinel/baseline-store.ts
- src/sentinel/runner.ts
- src/routes/home.ts
- src/routes/reload.ts
- src/routes/evolution.ts
- src/agent/builtin-tools.ts
- src/agent/knowledge-conflict-handler.ts
- packages/evolution/src/expert-evolution.ts
- electron/backend-spawn.cjs
- scripts/desktop/build-backend.sh
- scripts/workflow/check-dataflow-alignment.sh
- scripts/workflow/scope-check.sh
- scripts/control-tower/founder-truth.py
- .claude/PRODUCT-BRIEF.md
- AGENTS.md
- CLAUDE.md
- SPEC.md
- docs/authority/STATUS.md
- docs/authority/ARCHITECTURE.md
- docs/authority/PRD.md
- docs/synova/GLOSSARY.md
- docs/synova/coordination/TASK-ROUTING.md
- docs/synova/runbooks/desktop-deploy-acceptance.md
- docs/synova/runbooks/desktop-dev-prod.md
- scripts/workflow/SPEC-TEMPLATE.md
- .claude/skills/north-star-guard/SKILL.md
- .claude/skills/cto-handover/SKILL.md
- .dsh/skills/north-star-guard/SKILL.md
- .dsh/skills/cto-handover/SKILL.md
- tests/orchestrator/context-compressor-confirmed.test.ts
- tests/expert-quality/layer1-rules.test.ts
- tests/run-e2e-pipeline.cjs
- scripts/check-fde-terms.sh
- ~~package.json~~ (D573 已合并，此声明失效)
- docs/synova/coordination/审计发现台账-DSH-CTO.md（merge 双写合并条目，CTO 接手合并时产生）
- .claude/task-briefs/2026-09-04-D573-fde-to-ga-terminology.md
- memory/notes/proposed/2026-09-04-d573-fde-to-ga-terminology.md
- .github/CODEOWNERS

不做什么（含文件路径）：
- 不改 scripts/audit/analyze-transitive-closure.py — 审计红线：永不修改审计脚本）
- 不改 scripts/check-secrets.sh — 'fde-tool' 为扫描器白名单自引用，保留不动）
- 不改 docs/synova/audit-reports/2026-09-02-D489-D563-D564.md — audit-reports 全目录为带日期历史审计记录，禁止篡改）
- 不改 docs/archive/SYNOVA-IMPL-DSH-D538-frontend-leftbar-codex-20260827.md — archive 全目录不动）
- 不改 docs/SYNOVA-MASTER-全量对齐手册-20260610.html — 136 处属手册整体刷新，另行派单）
- 不改 docs/specs/sentinels/cpc-sentinel.md — docs/specs/sentinels 12 文件遗留 spec，另行文档批处理）
- 不改 docs/synova/business/SYNOVA-商业计划书-20260618.html — 带日期商业档案）
- 不改 expert/_deprecated/finance/TOOLS.md — _deprecated 全目录不动）
- 不改 task-state/D538.json — 历史台账回填记录）
- 不改 ./mvp-server.cjs — Stage 0 删除候选，不投资
- 不改 memory/notes/implemented/2026-08-18-d402-lazy-singleton-fix.md — 四态 Note 历史记录）
- 不改 src/server.ts、src/config.ts（独立任务，本任务零逻辑变更）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：LLM 提示词装配（L0/L1 层）、工具注册 schema、诊断报告生成、门禁脚本运行。
处理（中间步骤）：运行时字符串 FDE→GA（含"前线部署工程师"括注→"Growth Advisor，增长顾问"）；tool-profiles `case 'FDE'` → `case 'ga'`（修复 ga 角色掉 minimal 的潜伏 bug）；门禁脚本展示文案/排除词表同步（check-dataflow 排除项加 ^GA$ 保留 ^FDE$ 兼容旧 brief）。
结果（最终展示）：白名单外全仓零 FDE（新门禁脚本物理验证）；GA 全称在 GLOSSARY 统一为 Growth Advisor；四态 Note 沉淀决策。

## 架构层:

L1+L2 交互与编排表层 + 治理文档锚点链

## Done 标准:
- [ ] bash scripts/check-fde-terms.sh 返回 exit 0（白名单外大小写敏感 "FDE" 零命中）
- [ ] grep -n "case 'FDE'" src/agent/tool-profiles.ts 无结果，且 grep -n "case 'ga'" src/agent/tool-profiles.ts 有结果
- [ ] npx tsc --noEmit exit 0
- [ ] npx vitest run tests/agent/tool-profiles.test.ts tests/electron/capability.test.ts tests/orchestrator/context-compressor-confirmed.test.ts tests/expert-quality/layer1-rules.test.ts 全绿
- [ ] grep -rn "FDE" src/ extensions/ skills/ expert/tech expert/_template --include="*.ts" --include="*.md" --include="*.yaml" | grep -v node_modules 零结果
