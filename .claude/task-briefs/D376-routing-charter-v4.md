# Task Brief: D376: 分工章程 v4 + 路由表 v4（覆盖 Win v3）

> 生成: 2026-08-16 | 分支: feat/d374-dsh-devdoc-preset | as any: 0

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属基础设施（coordination 协作宪法，D336 延伸）。创始人 2026-08-16 定稿分工：编码双轨（DSH 领哨兵切片）、审计双轨、CTO 主从、仪表盘归 Mac DSH。以创始人与 DSH 沟通为准，覆盖 Win 的路由表 v3。

### b) 文件审计
- TASK-ROUTING.md 现有 v3（Win 版，150 行），本任务升级 v4
- 新增 dsh-division-draft/DIVISION-CHARTER-v4.md（完整章程）
- 关系: 覆盖（v4 以创始人沟通为准）

### c) 决策
冲突取舍：Win v3 的模块所有权基本合理，采纳；分歧点（编码切片/审计双轨/CTO主从/仪表盘）按创始人定稿覆盖。参考：DeepSeek/第一性原理（垂直切片，端到端可评估）+ Anthropic（CODEOWNERS 机器强制）——收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（Done 标准）→ ② 测试（coordination 文档，无代码测试，靠解析/一致性）→ ③ 实现（v4 已起草）→ ④ 接线（TASK-ROUTING.md 是唯一权威，被 TASK-ROUTING 引用）→ ⑤ 验证（自检）。
引用铁律 0（先对齐）、0-5（多 Agent 协作红线）、D333（决策参考）。

### b) 执行约束
- rule: "路由表是唯一权威，撞车查表"
  verify: "grep -n '模块所有权表' docs/synova/coordination/TASK-ROUTING.md"

### c) 决策参考系
参考：DeepSeek/第一性原理（垂直切片）+ Anthropic（CODEOWNERS）——收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- docs/synova/coordination/TASK-ROUTING.md
- docs/synova/coordination/dsh-division-draft/DIVISION-CHARTER-v4.md

不做什么：
- 不改 src/server.ts（及 src/ 下其他业务代码——独立任务）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：派活前查路由表
处理（中间经过哪些步骤）：读模块所有权表 → 认领 → 实现 → PR
结果（最终展示在哪）：TASK-ROUTING.md v4 是唯一权威，撞车时查它

## 架构层: 基础设施

#CRITERIA: A

## Done 标准
- [ ] grep -n "CTO 主从\|审计双轨\|哨兵体系核心" docs/synova/coordination/TASK-ROUTING.md 命中
