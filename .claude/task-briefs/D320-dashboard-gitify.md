# D320 — 仪表盘 git 化生成器 v1（gen-task-board.py 渲染 DASHBOARD-CN/EN）

任务 ID: D320 | Agent: claude-code | 会话: 2026-08-09 | 依据: SYNOVA-IMPL-D320-仪表盘git化生成器-20260808.md

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
DASHBOARD-CN.md/DASHBOARD.md 目前靠 Codex 手工维护（v4.8 两次被并行 session 回滚），任务状态没有单一机器事实源。本任务把仪表盘变成"git 状态 + 文件事实 + 薄手动层"的渲染产物：新建 gen-task-board.py（控制塔脚本，基础设施层），数据源 = git log 全历史 D# + dev doc 头 + task briefs + VERSION.md/version.log + gh CI + 审计 JSON，输出 Markdown 任务看板；AUTO 区 marker 之间渲染，MANUAL 区 marker 之间原样保留；幂等（无变化不写文件）；数据缺失走 degraded 诚实标注（D296）。

### b) 文件审计
- scripts/control-tower/generate-dashboard.py：D220 已有数据采集骨架（derive_rdc_pipeline 仅 git log -30 + committed 布尔；read_audit_summary/freshness_check 可借鉴）——**只借鉴不修改**，HTML 驾驶舱与本任务 Markdown 看板共存
- docs/synova/DASHBOARD-CN.md + DASHBOARD.md：现有结构（事故恢复区/表格段/手动维护内容），本次插入 AUTO/MANUAL marker，现有内容全部保留进手动区
- docs/synova/coverage/：目录不存在，新建（board-override.yaml + README.md）
- tests/control-tower/dashboard-alignment.test.py：D220 既有测试，测试风格 = unittest + importlib 加载 SUT（本次沿用）
- 数据源实测：git log 带 D# 共 271 条；dev doc 头格式 `状态: dev doc | 日期 | 优先级`；gh run list 本机 401 Bad credentials（degraded 真实路径）；audit-check.py --full 基线 = PASS:3 WARN:886 FAIL:439；VERSION.md 在 .codex/control-tower/（D319 独占，不碰）；version.log 在 .codex/control-tower/logs/（gitignore 运行时产物，DS6 追加）

### c) 决策
无已有 Markdown 看板生成器覆盖 → 新建 gen-task-board.py（扩展控制塔，不改 generate-dashboard.py）。手动层 = board-override.yaml（优先级/决策/待办/blocked 唯一入口）+ MANUAL 区原样保留。测试先行 5 用例 red→green。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC — dev doc §3-§6（写集/数据契约/测试要求/完成标准已批准）
② 测试先行 — tests/control-tower/gen-task-board.test.py 新建 5 用例（临时 repo 注入 git 提交 + gh 假数据）：D# 提取/推送状态、MANUAL 区保留、幂等、CI 缺失 degraded、空历史不异常
③ 实现 — gen-task-board.py：数据采集（git log 全历史 D# → dev doc 头状态 → briefs 存在性 → VERSION 解析 → gh/audit 降级）→ Markdown 渲染（AUTO 区 + MANUAL 区拼装）→ 幂等写回
④ 接线 — 首次运行插入 marker + 渲染自动区（CN/EN 双份），DASHBOARD 顶部标注"由 gen-task-board.py 生成"
⑤ 验证 — DS1-DS8 全链
#CRITERIA: A

### b) 执行约束
- 铁律 0-2: spec（dev doc）→ test → impl → wire → review → merge
- 铁律 24+31: 每个数据源缺失必须 log/degraded 标注，禁止假 0 假绿（D296）
- 铁律 48: 新测试 ≥5 用例 × 真实断言（正常/降级/边界/幂等/保留）
- 铁律 9: 改 DASHBOARD 前 grep 全仓库引用（docs/ 内其他文件引用 DASHBOARD 的链接）——grep-refs.sh 前置
- 幂等纪律: 自动区无变化不写文件（mtime 不变）；生成器绝不修改 MANUAL marker 之间内容
- verify 命令: `python tests/control-tower/gen-task-board.test.py` 返回 exit 0；连续两次运行 DASHBOARD 文件 diff 空

## Q2: 范围 — 正确的最简方案是什么？

做什么（严格按 dev doc §3.1 写集）：
- scripts/control-tower/gen-task-board.py：新建。渲染 DASHBOARD-CN.md/DASHBOARD.md（Markdown 任务看板）；数据源 = git log 全历史 D# + dev doc 头 + briefs + VERSION.md/version.log + gh CI + audit-result.json + board-override.yaml；AUTO/MANUAL 双 marker 区；幂等（无变化不写）；degraded 标注；--lang cn/en 切换
- docs/synova/coverage/board-override.yaml：新建。手动薄层（优先级/决策/待办/blocked），生成器只读
- docs/synova/coverage/README.md：新建。说明"人工只改 override + MANUAL 区"
- tests/control-tower/gen-task-board.test.py：新建。≥5 用例（D#/推送状态、MANUAL 保留、幂等、CI degraded、空历史），临时 repo 隔离 + 注入假数据
- docs/synova/DASHBOARD-CN.md：修改。插入 AUTO/MANUAL marker，自动区由生成器渲染，现有内容入手动区
- docs/synova/DASHBOARD.md：修改。同 CN（EN 同步）
- .gitignore：修改。`coverage/` → `/coverage/`（根目录测试覆盖率产物保持忽略；现规则无前导斜杠误伤 docs/synova/coverage/ 写集目录）

不做什么（含文件路径）：
- 不改 scripts/control-tower/generate-dashboard.py（HTML 驾驶舱与本任务共存，职责不同）
- 不改 .codex/control-tower/VERSION.md（D319 独占版本编排 V4.7.0，本任务不 bump）
- 不改 scripts/control-tower/control_tower_log.py（只运行 version 子命令追加 version.log）
- 不改 tests/control-tower/dashboard-alignment.test.py（D220 既有测试保留）
- 不改 .github/workflows/ci.yml（GitHub Actions 自动触发 = Phase 3，本任务只做生成器 + 手动触发）
- 不读 git notes（D321 独立任务；生成器预留 hook 点注释）

## Q3: 验收 — 入口 → 交互 → 结果

入口：命令行 `python scripts/control-tower/gen-task-board.py`（可加 --lang cn/en；无参数 = 双份）
处理：采集 git log 全历史 D#/dev doc 头/briefs/VERSION/gh CI/审计 → 合并 override → 渲染 AUTO 区 → MANUAL 区按 marker 原样保留 → 内容无变化不写文件
结果：docs/synova/DASHBOARD-CN.md + DASHBOARD.md 自动区展示 任务状态（git 派生）/版本历史/CI 状态/同步健康（预留），顶部标注"由 gen-task-board.py 生成"；Codex 不再手写自动区

## 架构层: 基础设施
（控制塔脚本，L1-L5 之外的基础设施；五层架构无涉）

## Done 标准
- [x] DS1 测试全过（≥5 用例，red 已证：用例写于实现前）— verify: python tests/control-tower/gen-task-board.test.py
- [x] DS2 自动区与 git log 事实抽查一致（≥5 个 D# 提交存在性/推送状态）— verify: python scripts/control-tower/gen-task-board.py && git log --grep="D[0-9]" --oneline | head -20
- [x] DS3 MANUAL 区零丢失（生成前后 marker 间内容 diff 为空）— verify: python tests/control-tower/gen-task-board.test.py
- [x] DS4 幂等（连续两次运行输出文件内容一致，mtime 不变）— verify: python scripts/control-tower/gen-task-board.py && cmp 前后快照
- [x] DS5 gh 不可用（本机 401 实测）时输出 degraded 标注，不出现假 0/假绿 — verify: grep -n "degraded" docs/synova/DASHBOARD-CN.md
- [x] DS6 version.log 追加 V4.7.0（gitignore 产物）；VERSION.md 不碰（D319 编排）— verify: python scripts/control-tower/control_tower_log.py version --version 4.7.0 --changes "D320 仪表盘 git 化"
- [x] DS7 全量审计与基线一致（PASS:3 WARN:886 FAIL:439）+ as any=0 — verify: python scripts/audit/audit-check.py --full
- [x] DS8 无 --no-verify；git diff --name-only 与写集一致 — verify: git diff --name-only --cached
