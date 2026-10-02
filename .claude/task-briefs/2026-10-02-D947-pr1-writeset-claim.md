# Task Brief: D947 PR-1 写集认领（补 G12 缺 brief 所致红）

> 生成: 2026-10-02 | 任务: D947 | 认领: win-codex-cto
> 触发: CI run 的 `TypeScript + Lint + Iron Laws` ⇒ `❌ G12: task brief Q2 范围一致性 8 处 [硬阻断]`

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
权限中间件层（`src/middleware/`）。本卡是 **D947 PR-1 的写集认领**——代码早已完成并推送，缺的是"哪份 brief 认领它"。

### b) 文件审计（实测）

| 检查 | 实测 |
|---|---|
| `git grep -l D947 origin/main` | **0 个文件** ⇒ main 里**不存在** D947 的 brief |
| `git ls-tree origin/feat/d947-middleware-pr1` 内 `task-briefs/*d947*` | 空 ⇒ 分支内也没有 |
| 该 PR 对 main 的变更集 | 9 件（1 个 hook 产物 + 2 个 src + 6 个测试） |

⇒ G12 在 CI 上解析不到任何认领这份变更集的 brief，于是把 8 个文件全判「不在 Q2 范围内」。

### c) 决策
**补一份写集认领 brief**（不改代码、不改门禁脚本）。这与 D1109/D1116 同法：门禁要的是"谁认领这些文件"，认领记录缺失就补上。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 门禁语义：G12 是**写集单一事实源**（D749）——变更集必须被某份 brief 的 Q2 覆盖；无 brief 覆盖即硬阻断。
- 与 D1109（#939）的关系：#939 解掉 CT(windows) 超时后，这条 PR 才第一次跑到 G12 这一步 ⇒ **这是"下一层红"，不是新问题**。
- 复用教训（本会话已两次）：Q2 的"做什么"必须是**纯相对路径行**，行尾带说明会被 `re.escape` 一起转义而匹配失败。

## Q2: 范围 — 正确的最简方案
做什么：
- .claude/task-briefs/2026-10-02-D947-pr1-writeset-claim.md
- src/middleware/auth.ts
- src/middleware/rbac.ts
- tests/middleware/auth.test.ts
- tests/middleware/permission-filter.test.ts
- tests/middleware/rbac-default-deny.test.ts
- tests/middleware/rbac.test.ts
- tests/routes/diagnosis-report-persistence.test.ts
- tests/routes/ga-auth.test.ts
- .claude/bypass.log

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/audit/audit-rules.sh
- 不改 docs/authority/DOCS-REGISTRY.yaml

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 的 `bash scripts/pre-commit-check.sh`（SYNO_CI=1）
处理：G12 以本 brief 的 Q2 作为写集事实源
结果：`G12: 所有文件均在 Q2 范围内` ⇒ `TypeScript + Lint + Iron Laws` 转绿

## 架构层:
L2 编排（src/middleware）

## Done 标准
- [ ] verify: `git diff --name-only origin/main...HEAD | wc -l` ⇒ 10（9 件原变更 + 本 brief）
- [ ] verify: CI `TypeScript + Lint + Iron Laws` ⇒ success（push 后取）
- [ ] verify: `check-pr-budget.sh --base origin/main` ⇒ PASS（≤12 件）
