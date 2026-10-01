## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务位于**控制塔工作流层**（非产品 L1-L5）。
现状：D328 缺陷 —— `resolve-commit-brief.sh` 的强锚点只在对应 D# brief 存在时生效；计数按出现次数；
`briefs_by_id()` 用 `*-D<id>-*` glob ⇒ 17 个 brief 不可达。本 PR 已实现三级锚点修复。
新增/替换/扩展：**补齐当日 brief**（实现已在分支上）。

### b) 文件审计
- scripts/workflow/resolve-commit-brief.sh（三级锚点修复）
- tests/control-tower/resolve-commit-brief.test.sh（配对测试）
- .claude/task-briefs/2026-09-29-D1069-resolve-commit-brief-强锚点失配修复.md（原 brief）
- memory/notes/proposed/2026-09-29-D1069-resolve-brief-anchor.md（决策 Note）

### c) 决策
实现已存在 → 本件**只补当日 brief**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **Anthropic 决策链**：先定义"锚点应如何解析"（三级：explicit → task-state → commit-subject），再实现。
- **memory 历史教训**：D328 —— 强锚点失配导致 brief 认领链断裂；glob 模式 `*-D<id>-*` 只覆盖部分命名。

## Q2: 范围
做什么：
- scripts/workflow/resolve-commit-brief.sh
- tests/control-tower/resolve-commit-brief.test.sh
- .claude/task-briefs/2026-10-01-D1069-resolve-brief锚点修复-今日brief.md
- task-state/D1069.json

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/pre-push-check.sh
- 不改 .github/workflows/ci.yml
- 不改 scripts/control-tower/check-pr-budget.sh

（做什么的说明：本件为"当日 brief 补齐"，实现内容见 09-29 原 brief）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/workflow/resolve-commit-brief.sh <file>`
处理：三级锚点解析（explicit → task-state → commit-subject）
结果：17 个此前不可达的 brief 变为可达；配对测试全绿

## 架构层: scripts/workflow

## Done 标准:
1. `bash tests/control-tower/resolve-commit-brief.test.sh` 全绿（可核）
2. resolve-commit-brief 对 17 个不可达 brief 可达（可核）
