# Task Brief: D371 产品完成度仪表盘 Phase 1（product-lines.yaml + 三脚本 + 产品进度页 + 自动化 A1-A8）

> 生成: 2026-08-16 | 分支: main | 角色: DeepSeek Harness (Mac) | as any: 0
> 依据: SYNOVA-DESIGN-产品完成度仪表盘-v1.4 §九 Phase 1 + PHASE0-LINE-REVIEW-v3（26 条线创始人已确认）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属于：**基础设施 — 产品真值层**（不属于 L1-L5 业务代码；消费过程仪表盘结论，只做"汇总成完成度"）。
现有同类模块：scripts/control-tower/gen-task-board.py（任务看板生成器，复用其契约思路）、scripts/control-tower/generate-dashboard.py（控制塔仪表盘）。
本任务**新增**：
- scripts/product-lines/（三个核心脚本 + A1-A8 支撑脚本）
- scripts/golden-scenarios/（证据引擎目录骨架；GS-01~08 场景脚本本体属 D361-D364 下一任务）
- docs/synova/product-lines/（yaml 单一事实源 + 生成产物 + 手工覆盖区）

### b) 文件审计（grep 已做，2026-08-16）
- 数据源 5 项全部现成：docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（P0/P1 表）、docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v2.md、docs/synova/research/C线-世界级基准-20260802/第五章（33 项差距清单 ⚠️/❌/📊）、docs/synova/DASHBOARD-CN.md（D# 状态）、scripts/golden-scenarios/evidence/（暂无→空源诚实标注）。
- K3 证据现成（初始 verified 只认这些）：docs/synova/audit-reports/AGENT-CAPABILITY-FULL-CHAIN-AUDIT-20260813.md（调度 PASS、customer-demand-shift PASS、key-person-risk PASS、talent-density PASS）。
- 复用：gen-task-board.py 的 AUTO/MANUAL marker 契约 + degraded 诚实标注惯例。无冲突，全部新建。

### c) 决策（参考系记录，K3 可核）
- 参考：第一性原理（页面即真相：创始人不推送不摘要，打开即最新）+ Anthropic（机器可验契约、fail-closed）+ DeepSeek（最少机制：1 yaml + 3 脚本 + 1 HTML，不建新系统）。
- A1 证据失效：不做独立 mark-stale 脚本，calc-progress.py 内置 git 惰性失效（最少机制）；合并事件路径由 CI workflow 触发 calc 重算。
- CI 自动更新：生成物变更 → bot PR（对齐 MULTI-MACHINE-PR-WORKFLOW 合并走 PR），不直接 push main。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC（设计 v1.4 §九 Phase 1 验收已定义）→ ② 测试（tests/control-tower/product-lines.test.py 三路径：正常/降级/边界）→ ③ 实现（契约优先，先 JSDoc/头部契约再代码）→ ④ 接线（refresh-all.sh 串联三脚本；CI workflow 接线；calc 消费 yaml）→ ⑤ 验证（自检 6 问）。
引用依据：铁律 0-2（spec→test→impl→wire→review→merge）、铁律 7（入口可触达+链路走通+结果可见）、铁律 24+31（catch 必有 log+degraded）、铁律 47（契约优先）、铁律 48（测试非空壳）、铁律 11（静默降级禁止）。

### b) 本任务执行约束
- rule: "证据判定只认机器事实：K3 报告明确 PASS 的验收点才可计 verified，其余一律 uncommitted/pending_k3"
  verify: "grep -c 'status: verified' docs/synova/product-lines/product-lines.yaml 的 verified 点逐一绑定 k3:/founder-demo: 证据"
- rule: "生成物（product-progress.json/html/todos.yaml）由脚本生成，人工不手改"
  verify: "head 注释含 '由 scripts/product-lines/*.py 生成'"
- rule: "页面语言大白话：不出现 D#、P0/P1、git hash、门禁组号"
  verify: "grep -cE 'D[0-9]{3}|P0-block' docs/synova/product-lines/product-progress.html 为 0（术语映射表除外）"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论（见 Q0c）。K3 状态机实现（§3.4 五态+stale）与证据有效期 14 天直接照设计文档，无分歧。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/product-lines/productline_yaml.py
- docs/synova/product-lines/product-lines.yaml
- docs/synova/product-lines/todo-line-map.yaml
- docs/synova/product-lines/cockpit-override.yaml
- docs/synova/product-lines/todos.yaml
- docs/synova/product-lines/product-progress.json
- docs/synova/product-lines/product-progress.html
- docs/synova/product-lines/README.md
- scripts/product-lines/calc-progress.py
- scripts/product-lines/aggregate-todos.py
- scripts/product-lines/gen-progress-page.py
- scripts/product-lines/evidence-writer.py
- scripts/product-lines/parse-k3-report.py
- scripts/product-lines/gen-k3-task.py
- scripts/product-lines/refresh-all.sh
- scripts/product-lines/README.md
- scripts/golden-scenarios/README.md
- scripts/golden-scenarios/evidence/.gitkeep
- .github/workflows/product-progress.yml
- tests/control-tower/product-lines.test.py
- docs/synova/coordination/TASK-ROUTING.md

不做什么：
- 不改 src/server.ts（及 src/ 下全部业务代码——Claude Code 领地，D355-D360 修复任务）
- 不改 scripts/audit/audit-check.py（K3 专属红线）
- 不改 scripts/pre-commit-check.sh（门禁不动，本任务不加第 14 组）
- 不改 scripts/pre-push-check.sh
- 不改 docs/synova/DASHBOARD-CN.md（生成器产物，D# 由 commit message 自动登记）
- 不写 GS-01~GS-08 场景脚本本体（scripts/golden-scenarios/GS-*/run.sh 属 D361-D364 下一任务）
- 不改 docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（台账维护者另有流程）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：创始人打开 docs/synova/product-lines/product-progress.html（本地文件/PR 预览/部署后 URL）；或运行 bash scripts/product-lines/refresh-all.sh 一键刷新。
处理（中间经过哪些步骤）：aggregate-todos.py 从 5 源抓待办 → todos.yaml；calc-progress.py 读 product-lines.yaml + 证据（K3 报告/evidence/git）按 §3.4 六态状态机算进度 → product-progress.json；gen-progress-page.py 渲染 → product-progress.html（26 条线进度条 + 每条待办 + 待裁决置顶区）。
结果（最终展示在哪）：页面显示 26 条线（等权聚合产品总进度）、资本循环线 0/8 精确显示、代码变更后相关证据自动转黄（stale）、待裁决置顶区来自 cockpit-override.yaml。

## 架构层: 基础设施
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: bash scripts/product-lines/refresh-all.sh 退出 0 且生成 product-progress.json + product-progress.html + todos.yaml
- [ ] 链路走通: python3 scripts/product-lines/calc-progress.py 输出中 line 10（资本循环）verified=0/total=8（0/8 精确显示）；修改 product-lines.yaml 后重跑页面百分比变化
- [ ] 结果可见: 页面含 26 条线进度条 + 待裁决置顶区 + 术语全大白话（grep D#/P0 为 0）
- [ ] 测试: tests/control-tower/product-lines.test.py 三路径（正常/降级/边界）全绿
- [ ] 门禁: bash scripts/pre-commit-check.sh 全绿 + bash scripts/workflow/check-silent-swallow.sh --utf8 全绿
