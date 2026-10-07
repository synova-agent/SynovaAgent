# Task Brief: D380: CODEOWNERS 落地（B1 自动化清单）

> 生成: 2026-08-16 | 分支: feat/d377-cto-handover-finalize | 认领: 🧭 CTO（主）
> 来源: 影子 CTO 首份复核报告异议 1（章程 §1.2 第一层机器强制 CODEOWNERS 缺失）+ 主 CTO 独立验证属实

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
v4 分工 §1.2「互不重叠保证」三层：①CODEOWNERS（机器强制）②认领制 G12 ③写集重叠 pre-push。物理核查 .github/ 无 CODEOWNERS → 第一层空置，实际只剩两层。本任务补齐第一层：把 TASK-ROUTING v4 §一 模块所有权表转成 .github/CODEOWNERS。

### b) 文件审计
- .github/ 现状: dependabot.yml + pull_request_template.md + workflows/（无 CODEOWNERS）
- 新建: .github/CODEOWNERS
- 映射源: docs/synova/coordination/TASK-ROUTING.md v4 §一 模块所有权表 + §串行点表

### c) 决策
owner 账号体系未知 → 全部兜底指向仓库主账号 @tangbaobao520 + 注释写明「待创始人定三线团队后替换」。参考：Anthropic（CODEOWNERS 机器强制）。收敛——先立骨架，账号是创始人信息。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（映射完整）→ ② 验证（路径全覆盖：DSH/Claude/K3 三领地 + 串行点）→ ③ 实现（写文件）→ ④ 接线（GitHub 侧 PR 规则）→ ⑤ 验证（grep 覆盖 + 语法）。
引用 v4 §1.2、TASK-ROUTING §串行点。

### b) 执行约束
- rule: "所有权表每条映射必须在 CODEOWNERS 有对应"
  verify: "grep -E 'src/sentinel|src/mcp|scripts/audit|src/server.ts|VERSION' .github/CODEOWNERS 全命中"

### c) 决策参考系
参考：Anthropic 工程基线（CODEOWNERS 为地盘机器强制标准做法）。收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- .github/CODEOWNERS（新建，映射 + 兜底 owner + 替换指引注释）

不做什么：
- 不改 TASK-ROUTING.md（映射源已定稿）
- 不创建 GitHub 团队（账号体系待创始人，注释指引）
- 不改 .github/workflows/（独立任务）

## Q3: 验收 — 入口 → 交互 → 结果

入口：GitHub PR 触发 CODEOWNERS 生效
处理：越界文件（如 DSH 改 src/ 业务）→ GitHub 要求 owner approve
结果：v4 三领地 + 串行点的路径映射全部在 CODEOWNERS；账号替换指引清晰

## 架构层: 基础设施（协作机器强制）

#CRITERIA: A

## Done 标准
- [ ] .github/CODEOWNERS 存在且覆盖：src/sentinel/ src/cron/ src/mcp/ electron/ scripts/control-tower/ scripts/audit/ src/server.ts VERSION.md 全命中
- [ ] 注释含「三线团队替换指引（待创始人定）」
