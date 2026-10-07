# Task Brief: D719 dispatch-batch2-registration

> 生成: 2026-09-13 | 任务: D719 | 认领: 主 CTO（synova-cto）
> 参考: cto-handover skill §〇b/§〇c（派单 SOP + DSH 借鉴核查）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
派单与任务号登记批次（非五层）。创始人 2026-09-13 指令「处理完桌面端后开始安排其他任务」→
本批按 backlog（39 条）+ 三仪表盘挑出关键路径四项，分派四线并行：
D715 K3 审计（控制塔收口切片 + 线 1 证据）/ D716 dev-doc 两份 spec（监测契约 + 1-5 收敛）/
D717 Mac 编码产品真债两项 / D718 并行 CTO 控制塔小修三项。
### b) 文件审计
- 任务号实测新分配：D715/D716/D717/D718/D719（`alloc-task-id` 输出，无撞号）
- 材料核实：`board-backlog.json` 39 条（含本批四项来源条目）；`DECISION-D1-状态驱动通知模型-20260912.md` 存在；
  `src/server.ts:300` 实测仍挂 `/app` 静态服务（1-5 现状）；`evidence expireOld` 零生产调用方（前批实证）
- 写集交集核实：四线零交集；仅 D717（package.json）与 D718（scripts/）需注意依赖改动惯例
### c) 决策
出派单文档 + 四项任务号登记；零代码改动。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- cto-handover §〇c：派单 SOP（写前核实 6 项 → 写 → 自检 8 项 → 交付前物理复核 → 提交 → 创始人复制段）
- 记忆教训：D712 派单因未先并入 main，执行方在净仓库态读不到（Win 侧 G0）→ 本批**先合并派单文档再转发**
- 审计瓶颈：35 个 pending_k3 积压 → 批量化提审（减少往返、提高吞吐）
### 参考：派单 SOP + G0 教训 + 审计吞吐瓶颈 → 一次打包四项并行

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/派单-下一批四线并行-20260913.md — 派单文档（四项 + 创始人复制段）
- task-state/D715.json — K3 审计批登记
- task-state/D716.json — dev-doc 两份 spec 登记
- task-state/D717.json — Mac 编码产品真债登记
- task-state/D718.json — 并行 CTO 控制塔小修登记
- task-state/D719.json — 本派单登记
- .claude/task-briefs/2026-09-13-D719-dispatch-batch2-registration.md — 本 brief
不做什么：
- 不改 src/server.ts（Claude 专属，D716 spec 后由 Win 实施）
- 不改 scripts/audit/audit-rules.sh（K3 红线，审计域禁碰）
- 不改 .github/workflows/ci.yml（D708/#505 在途，避免撞车）
- 不改 electron/main.cjs（D714 已交付，等其 PR 流程收口）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人复制派单说明给四个执行方
处理：四线并行执行，各自出 PR
结果：K3 审计报告 + 两份 spec + 编码两项修复 + 控制塔三项修复

## 架构层: 基础设施（派单与任务登记，非五层）
本批次为派单登记；各任务的实施层按其自身 spec 声明

## Done 标准:
- [ ] 派单文档含四节任务定义：`for s in D715 D716 D717 D718; do grep -q "$s" docs/synova/coordination/派单-下一批四线并行-20260913.md || echo "MISSING $s"; done` → 零输出
- [ ] 四个 task-state JSON 合法：`python3 -c "import json;[json.load(open(f'task-state/D{d}.json')) for d in (715,716,717,718,719)];print('ok')"` → 输出 ok
- [ ] 创始人复制段齐备：`grep -c "转 K3\|转 dev-doc\|转 Mac 编码\|转并行 CTO" docs/synova/coordination/派单-下一批四线并行-20260913.md` → ≥4
