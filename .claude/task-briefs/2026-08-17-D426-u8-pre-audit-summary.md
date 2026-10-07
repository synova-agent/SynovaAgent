# Task Brief: D426: U8 工程侧 — 机器预审汇总脚本（三层审计模型 第0层）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游 spec: UPGRADE-SPEC-控制塔与审计流程-20260817.md §U8

## Q0: 定位
U8 三层审计模型（机器预审 → 交付方自证 → K3 语义终审）的第0层是"机器预审汇总脚本"：把 U1-U4/U7 已落地的物理门禁聚合成一次"预审是否已过"，没过直接打回，不浪费 K3 语义大脑。本任务只做**工程侧**（红线：不碰 scripts/audit/、不编写审计判定口径）；风险分级表是"建议"（采纳权在创始人+K3），脚本只读取展示不裁决。任务加 risk 字段（low/medium/high，默认 medium）供 CTO/创始人派活时标。

## Q1: 调研
- 上游 spec U8 落地机制：task-state 加 risk 字段 + K3 开工前跑机器预审汇总脚本。
- 铁律 0-2 契约先行：先写测试（接线存在 + 结构 + 三态退出码 + --json verdict + risk 读取）再实现。
- 铁律 11：门禁脚本缺失（U1/U4/U7 未合并）→ 显式"未落地"降级（exit 2），不静默当真。
- D334 跨平台：Mac 无 GNU timeout → 用 Python subprocess.timeout(20s) 兜底；.py 用 python3、.sh 用 bash。
- 研究实证：存量 check-bypass-log.sh 有 git fetch SSH hang bug（正是 U1 要修的），故不回退它，直接标 U1"未落地"。

## Q2: 范围
做什么：
- scripts/control-tower/pre-audit-summary.sh
- tests/control-tower/pre-audit-summary.test.sh
- task-state/TEMPLATE.json
- .claude/task-briefs/2026-08-17-D426-u8-pre-audit-summary.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：bash scripts/control-tower/pre-audit-summary.sh [--task-id D#] [--json]。
处理：聚合 U1-U4/U7 五门禁（缺失→未落地，异常→降级，过→pass），读 risk 字段给建议审计深度。
结果：exit 0=全过(可进 K3) / 1=有未过(打回) / 2=降级或门禁未落地；--json 出 verdict。

## 架构层: 控制塔/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 五门禁聚合 + risk 读取 + 三态退出码，测试 5 项全绿 — verify: bash tests/control-tower/pre-audit-summary.test.sh
- [x] 不碰审计判定口径（红线） — verify: ! grep -nE "scripts/audit" scripts/control-tower/pre-audit-summary.sh
- [x] 快速（<5s，不 hang） — verify: bash scripts/control-tower/pre-audit-summary.sh --json | python3 -m json.tool >/dev/null
