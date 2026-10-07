# Task Brief: D711 D1-notification-model-landing

> 生成: 2026-09-12 | 任务: D711 | 认领: 主 CTO（synova-cto）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）；铁律 49（决策沉淀）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
产品决策落地批次（**零产品代码改动**）。创始人 2026-09-12 裁定 D-1「告警去重窗口」问题框架作废，
改为**状态驱动通知模型**（CTO 起草），并裁定 D-2「桌面端先行」。本批次把决策写入单一事实源
（product-lines.yaml / cockpit-override.yaml）、重算进度、沉淀决策文档与跨线同步文档
（创始人明确要求涉及 Win 侧必须同步）。
### b) 文件审计
- `cockpit-override.yaml` D-1/D-2 原 status: open（实测）→ 本批改 resolved + 裁决正文
- `product-lines.yaml` 线 8 原 5 个验收点（实测）→ 本批 done_definition 改写 + 8-3 收窄 + 新增 8-6（6 点）
- 代码侧证据（本批只引用不改）：`src/sentinel/runner.ts:178` TicketStatus、`:1021` transitionFindingStatus、`:1321` 通知决策仅查 last_sent_ms
- 归属核实：TASK-ROUTING v4 —— Mac DSH 编码＝`src/sentinel/`+`src/cron/`+`src/mcp/`；Win＝`src/` 其余 + `extensions/` + `app/`
### c) 决策
改单一事实源 + 新增两份文档 + 重算生成物；接线与跨线落地另立任务（PLAN-d1-notification-wiring）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 创始人一手场景：企业经营问题是慢变量、需流程、需时间；时间窗去重必然两头错（反复轰炸 →
  告警疲劳；窗口过长 → 误合并丢掉真实变化）。
- memory 教训：M1 fail-open/信号失效（长期显示"没进度"会让仪表盘失去信号价值）；M3 机制建成
  未接线（状态机已存在但通知决策不读它——本决策的物理根因）。
- 参考：第一性原理（告警＝事件、跟踪＝订阅，两者不可混为一个时间窗机制）+ 咨询师类比（发现→
  沟通节奏→按约汇报→升级→复盘）+ 行业告警疲劳治理实证 → 结论：状态驱动 + 契约化节奏。
### 参考：第一性原理 + 咨询师实践 + 代码实证（runner.ts:1321 vs :178）→ 状态驱动模型

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/product-lines/cockpit-override.yaml — D-1/D-2 标 resolved + 裁决正文
- docs/synova/product-lines/product-lines.yaml — 线 8 done_definition 改写；8-3 收窄为「键稳定」+ note 订正；新增 8-6
- docs/synova/product-lines/DECISION-D1-状态驱动通知模型-20260912.md — 决策全文（六态/咨询师映射/落地/风险）
- docs/synova/coordination/跨线同步-D1状态驱动通知模型-Mac-Win-20260912.md — 跨线归属/接口/写集边界/时序
- docs/synova/coordination/board-backlog.json — 增 PLAN-d1-notification-wiring(P0) + PLAN-evidence-invalidation-granularity(P1)
- docs/synova/product-lines/product-progress.json — refresh-all 重算（生成物）
- docs/synova/product-lines/product-progress.html — refresh-all 重生成（生成物）
- scripts/product-lines/gen-progress-page.py — 修复 render_decisions 不按 status 过滤（已裁决项误入置顶区，CTO 复核抓出）
- tests/control-tower/product-lines.test.py — 新增 TestRenderDecisionsFilter（4 断言：已裁决不渲染/全裁决空/缺状态按 open/空输入）
- docs/synova/coordination/board-backlog.json — 增 PLAN-product-lines-suite-red-unwired（存量红+未接线，含基线对照证据）
- docs/synova/coordination/board-backlog.json — 增 PLAN-product-lines-test-side-effect（套件副作用写回 tracked 生成物，实证 #464/D657 价值）
- memory/notes/implemented/2026-09-12-D1-state-driven-notification.md — 四态 Note（铁律 49）
- .claude/task-briefs/2026-09-12-D711-D1-notification-model-landing.md — 本 brief
- task-state/D711.json — 状态登记
不做什么：
- 不改 src/sentinel/runner.ts（产品代码＝接线任务，归 Mac DSH 编码线另立 spec）
- 不改 src/growth/action-store.ts（Win 线域，线 16 行动闭环）
- 不改 scripts/audit/audit-rules.sh（K3 红线，审计域禁碰）
- 不改 .github/workflows/ci.yml（Win 线 D703/D704 与 D708 在途，写集重叠）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人打开 product-progress.html（驾驶舱）
处理：决策标 resolved + 线 8 验收点按新语义重算
结果：页面不再出现"待裁决 D-1/D-2"；线 8 显示 6 点（含 8-6 显式 uncommitted）；跨线同步文档可被 Win 侧引用

## 架构层: 基础设施（产品定义与决策台账，非五层）
产品决策落地与跨线同步约定，不属于五层产品架构（零产品代码改动）

## Done 标准:
- [ ] python3 -c "import sys;sys.path.insert(0,'scripts/product-lines');import productline_yaml as p;p.parse(open('docs/synova/product-lines/product-lines.yaml',encoding='utf-8').read());p.parse(open('docs/synova/product-lines/cockpit-override.yaml',encoding='utf-8').read());print('ok')" → 输出 ok
- [ ] grep -c "status: resolved" docs/synova/product-lines/cockpit-override.yaml → 2
- [ ] python3 -c "import json;d=json.load(open('docs/synova/product-lines/product-progress.json'));assert all(x['status']=='resolved' for x in d['decisions']);print('ok')" → 输出 ok
- [ ] grep -c "8-6" docs/synova/product-lines/product-lines.yaml → ≥1
