# Task Brief: D964 阶段5 — 日报加「文档:代码 比」指标
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
CTO 控制塔每日看板（daily-cto-board.sh）。文档减负需要可复核的量化基线，否则"减负"无法验收。
### b) 文件审计
`scripts/control-tower/daily-cto-board.sh` 现输出 5 类信号（DSH 断面/卡数/工作树/门禁/台账 P0），无文档指标；无配对测试。
### c) 决策
已有覆盖 → 在既有看板加一行（不新建脚本、不新建门禁）。

## Q1: 调研
铁律 35（自动化优先）+ DSH 反模式（别再增一道门禁）。口径参考 DSH 0.68（3936 md / 5774 源文件）。无 DSH 代码借鉴（本项为本地指标呈现，不涉 DSH 通用管道）。

## Q2: 范围 — 最简方案
做什么：
- scripts/control-tower/daily-cto-board.sh：加「文档:代码 比」行（旁路，不参与红项）
- tests/control-tower/daily-cto-board-ratio.test.sh：三路径 + 旁路断言
不做什么（含文件路径）：
- 不改 scripts/audit/**、src/**、docs/plans/**、docs/synova/audit-reports/**

## Q3: 验收
入口: 每日 schedule 跑 daily-cto-board.sh。
处理: git ls-files 计数（文档排除 .sessions/**，代码取 src/+packages/ 的 .ts）。
结果: 看板出现「文档:代码 比 = 4.21（2142 md ÷ 509 ts；口径: …）」。

## 架构层: scripts（控制塔）
## Done 标准
- [ ] tests/control-tower/daily-cto-board-ratio.test.sh 全绿（6 通过）
- [ ] 实跑看板产出含该行且口径可复核
