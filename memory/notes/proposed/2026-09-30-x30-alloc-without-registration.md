---
status: proposed
date: 2026-09-30
name: X30 取号未登记（撞号根因）
class: X30_ALLOC_UNREGISTERED
constraint: "取号必须先走 scripts/control-tower/alloc-task-id.sh（占用表为唯一事实源）；台账卡必须随分支纳管，不得只留 brief 与分支"
expected: "发号器对任一 X30 号都能查到占用；不再出现「有分支未登记」导致的 fail-closed 卡发号与撞号"
severity: block
occurrences: 1
first_seen: 2026-09-30
description: X30 开窗自取 D1070（只看 brief 最大号）→ 号对占用表不可见 → 基础线取号撞号；Mac-CTO 代登记 3 卡并让号 D1074；本次补登记 16 卡并让号 D1075
---

# 取号未走分配器 → 号对占用表不可见

- **现象**: 我按 brief 文件名里的最大号自取 D1070，从未写 task-state/；基础线取号时占用表看不到我 → 发出同号卡，且其发号入口因我未登记而 fail-closed 卡住
- **根因**: 把号当成文件名约定，而不是占用表登记项；开窗时图快省了分配器
- **已做的补救**: 让号（载体制核实 D1074→D1075，brief 改名并留号段沿革）；16 张卡补登记（updated_by=harness-登记）并随分支纳管；D1089 起严格执行先登记后使用
- **固化（可机械化与否）**: 可机械化：提交前校验「staged 的 brief 文件名含 D# ⇒ task-state/D#.json 必须存在」，或由分配器提供 --check-brief 模式
- **归属**: X30 工程线自我改善；如需机器执法，落点属控制塔域（另立卡）。
