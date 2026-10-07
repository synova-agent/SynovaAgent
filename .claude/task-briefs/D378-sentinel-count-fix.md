# Task Brief: D378: 哨兵数量口径修正（审计核实后更新）

> 生成: 2026-08-16 | 分支: feat/d377-cto-handover-finalize | as any: 0
> 承接: 台账 D339「文档口径同步」中未落地的哨兵口径部分（D339 编号已被 quotepath 修复占用）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
CTO 审计核实：哨兵为**双体系注册**——文件驱动 45 个（extensions/sentinels/，42 个在顶层 manifest + 3 个规范外）+ 内置适配器 4 个（src/sentinel/adapters/）= **49 活跃哨兵**，另有 12 个退役（_extinct/）。交接文档与 AGENTS.md 的「26/20 哨兵」口径过时。台账 D339 任务名「文档口径同步（哨兵 20→45+4）」从未落地（D339 编号被 quotepath 修复占用）。

### b) 文件审计
- AGENTS.md:128「20哨兵适配器」→ 过时
- .claude/skills/cto-handover/SKILL.md:50 + .dsh/skills/cto-handover/SKILL.md:50「26 哨兵」→ 过时
- docs/synova/DASHBOARD-CN.md:290（D339 编号冲突）/ :336（规范外哨兵 2 个 → 实际 3 个）/ :507（45活跃 → 49）
- docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（演进记录补登记）

### c) 决策
口径以代码物理事实为准（sentinel-loader.ts + builtins.ts 双加载器扫描结果）。参考：第一性原理（数目录 + 数注册表，不数文档）。收敛。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（口径统一为 45+4=49）→ ② 验证（find extensions/sentinels + registry count）→ ③ 实现（改 4 处文档）→ ④ 接线（skill 同步 .claude↔.dsh）→ ⑤ 验证（sync --check + grep 复查）。
引用铁律 9（关键变更 grep 传播）、M7（文档-实现漂移防线）。

### b) 执行约束
- rule: "口径必须与代码物理一致"
  verify: "ls extensions/sentinels | wc -l 且 grep -rn '45 文件驱动' 命中"

### c) 决策参考系
参考：第一性原理（代码即真相）。收敛。

## Q2: 范围 — 正确的最简方案

做什么：
- .claude/task-briefs/D378-sentinel-count-fix.md（本文件）
- AGENTS.md
- .claude/skills/cto-handover/SKILL.md + .dsh/skills/cto-handover/SKILL.md（经 sync-dsh-skills.sh 同步）
- docs/synova/DASHBOARD-CN.md（手动区 D339/D360/关键指标）
- docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（演进记录）

不做什么：
- 不改 extensions/sentinels/path-dependency/manifest.json（空壳哨兵另立任务）
- 不改 docs/synova/product-lines/product-progress.html（无哨兵数量口径）
- 不改 docs/synova/product-lines/product-lines.yaml（无哨兵数量口径）

## Q3: 验收 — 入口 → 交互 → 结果

入口：任何读哨兵数量的文档/会话
处理：口径统一为「45 文件驱动 + 4 内置 = 49 活跃（12 退役）」
结果：grep 全仓无「26 哨兵」「20哨兵适配器」残留；DASHBOARD 关键指标 49

## 架构层: 基础设施（文档）

#CRITERIA: A

## Done 标准
- [ ] grep -rn "26 哨兵\|20哨兵适配器" AGENTS.md .claude/skills/cto-handover/SKILL.md .dsh/skills/cto-handover/SKILL.md 零结果
- [ ] DASHBOARD-CN.md 关键指标「哨兵 49 活跃（45 扩展 + 4 内置）」
- [ ] DASHBOARD-CN.md D339 行标注编号冲突 + D360 行规范外哨兵 3 个
