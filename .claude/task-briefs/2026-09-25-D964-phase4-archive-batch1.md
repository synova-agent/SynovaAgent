# Task Brief: D964 阶段4 批次1 — 零引用 briefs 归档（274 份 2026-06/07）
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
文档减负（治理域）。仓库文档:代码 比 ≈4.2（DSH 0.68）；`.claude/task-briefs` 706 份居首。
### b) 文件审计
phase 0 零引用扫描（git 全量跟踪文件搜路径+词干）产出 436 份零引用 briefs；本批取 2026-08-01 前 274 份。
归档目标 `.claude/task-briefs/archive/` —— **仍在 `.claude/task-briefs/` 前缀内**（pre-commit:901/:1126 brief 绑定依赖此前缀）。
### c) 决策
只归档零引用集合；有引用的一律不动。

## Q1: 调研
铁律 35/37；D964 派单门禁影响 ④（brief 前缀约束）。DSH 借鉴：无（本地文档治理）。

## Q2: 范围 — 最简方案
做什么：
- `.claude/task-briefs/*.md`（2026-06/07 零引用 274 份）→ `git mv .claude/task-briefs/archive/`
- `.claude/task-briefs/2026-09-25-D964-phase4-archive-batch1.md`（本 brief）
不做什么（含文件路径）：
- 不碰 docs/plans/**（win 域）、docs/synova/audit-reports/**（K3 域）、scripts/audit/**、src/**
- 不删除任何文件（只移动）；不动有引用 briefs

## Q3: 验收
入口: 归档 PR。
处理: git mv 274 份。
结果: 顶层 briefs 700 / archive 294；旧路径引用 0 处。

## 架构层: scripts/文档治理（.claude 域）
## Done 标准
- [ ] 归档后零引用复核：旧路径/旧词干在全量跟踪文件中引用数 = 0
- [ ] `git ls-files '.claude/task-briefs/*.md'` 与 archive 计数可复核
- [ ] docs/plans/** 未被触碰（diff 无该前缀）
