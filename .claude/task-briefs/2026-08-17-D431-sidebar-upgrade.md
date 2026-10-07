# Task Brief: D431: 右边栏六维升级 — 自报信号 → 物理核验（Option A）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游: FOUNDER-CONSOLE 设计 §七 方案A（创始人拍板选 A）

## Q0: 定位
创始人右边栏"六维健康雷达"数据来自 6 组件自报信号（emit-signal 写绿，零物理核验）——被忽悠的技术根源。本任务按创始人拍板的方案 A（就地升级，不换外壳）：保留 generate-dashboard.py 框架和其他区块，只把六维雷达数据源换成物理事实（git 提交/合并/绕过/北星/CI），复用 founder-truth.py 已写好的物理计算（铁律 37 不重复造）。

## Q1: 调研
- FOUNDER-CONSOLE §七：先 B（独立 HTML，已做）后 A（改造六维雷达，本次）。
- generate-dashboard.py 现状：read_component_signals() 读 .codex/signals/{6组件}.json 自报 → 渲染六维卡片。
- 复用：importlib 加载 founder-truth.py（文件名含连字符不能普通 import）→ git_committed_dns/collect/judge/integrity_ledger/north_star_alignment/ci_status。
- 铁律 11：founder-truth 缺失/异常 → 全 unknown 显式降级。

## Q2: 范围
做什么：
- scripts/control-tower/generate-dashboard.py
- tests/control-tower/dashboard-alignment.test.py
- .claude/task-briefs/2026-08-17-D431-sidebar-upgrade.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：python3 scripts/control-tower/generate-dashboard.py --output out.html。
处理：read_physical_facts() 复用 founder-truth 计算六维物理事实（任务真相/代码提交/合并 main/诚信账本/北星对齐/CI），渲染到六维卡片 + 每个带"🔍 怎么算的"。
结果：右边栏六维显示物理事实 + 红绿灯 + 可复核数据源，不再是组件自报。

## 架构层: 控制台/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 六维物理事实渲染 + 每卡带"怎么算的" — verify: python3 scripts/control-tower/generate-dashboard.py --output /tmp/x.html && grep -c "怎么算的" /tmp/x.html
- [x] 配对测试更新（物理维度替换 env-validator 断言）— verify: python3 tests/control-tower/dashboard-alignment.test.py
