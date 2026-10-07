# Task Brief: D424: 创始人零信任控制台 — 三问面板扩展（诚信账本+北星对齐+CI+主动告警）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制台脚本领地) | 上游: FOUNDER-CONSOLE-创始人零信任控制台-20260817.md + founder-truth-mvp (D419)

## Q0: 定位
D419 已交付 founder-truth.py 面板1（任务真相：声称 vs git 物理事实）。本任务补齐控制台设计的另外两块 + 两件基础设施：面板2 诚信账本（bypass.log 按 agent 对账 COMMITTED/BLOCKED/detected-bypass → 诚信分）、面板3 北星对齐（task brief Q0 vs PRODUCT-BRIEF.md 八节关键词 → 对齐/偏离）、CI 核验（GitHub Actions 最近一次运行，--offline 跳过）、主动告警（红灯写 founder-alerts.md + exit 1 供 cron 拾取）。全部数据源仍是物理事实（git/bypass.log/PRODUCT-BRIEF/CI API），零 agent 自报。

## Q1: 调研
- FOUNDER-CONSOLE 文档 §三已定义三问面板 + §五挑战机制 + §六 L1 物理事实白名单。
- 铁律 0-2 契约先行：先扩测试（接线存在 + 三面板输出 + 北星无对应 + 诚信计分 + 降级 + HTML）再实现。
- 铁律 11：CI/北星源不可用 → degraded 显式标记（不静默当真），CI 未接 token → "未接入 CI"。
- 防回归：render_html 用字符串拼接（不用 % 格式化，历史 CSS width:100% 与 % 冲突 ValueError）。

## Q2: 范围
做什么：
- scripts/control-tower/founder-truth.py
- tests/control-tower/founder-truth.test.sh
- docs/synova/founder-console.html
- .claude/task-briefs/2026-08-17-D424-console-panels.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：python3 scripts/control-tower/founder-truth.py [--offline] [--html]。
处理：collect（任务真相）→ integrity_ledger（诚信账本）→ north_star_alignment（北星对齐）→ ci_status（CI，--offline 跳过）→ write_alert（红灯告警文件）。
结果：stdout 三问面板 + 红绿灯小结；--html 生成自包含 founder-console.html；有红灯 exit 1 + founder-alerts.md。

## 架构层: 控制台/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 三问面板 + CI + 告警函数接线，测试 7 项全绿 — verify: bash tests/control-tower/founder-truth.test.sh
- [x] 北星对齐：无对应任务标"北星无对应—需创始人确认" — verify: python3 scripts/control-tower/founder-truth.py --offline | grep -q "北星无对应"
- [x] HTML 自包含三面板可双击开 — verify: python3 scripts/control-tower/founder-truth.py --offline --html && test -f docs/synova/founder-console.html
