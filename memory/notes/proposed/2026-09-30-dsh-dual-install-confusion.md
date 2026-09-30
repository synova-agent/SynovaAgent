---
status: proposed
date: 2026-09-30
name: 两套 DSH 混淆（版本与载体结论失锚）
class: DSH_DUAL_INSTALL
constraint: "凡版本或载体结论必须写明问的是哪一套（桌面端内嵌 rc.2 与 shell shim 0.1.x），优先用运行态证据（runtime.json、asar、listConfigs）"
expected: "不再出现「本机跑 0.1.6」类误判；结论自带断面标注"
severity: warn
occurrences: 1
first_seen: 2026-09-30
description: 初判本机运行时为 0.1.6-alpha.2（依据 which dsh 的版本输出）→ 实为桌面端内嵌 0.2.0-rc.2；两套 CLI 两个 home，行为不同（.agent-presets 在旧 CLI 仍生效）
---

# which dsh 不等于运行宿主

- **现象**: 我据 which dsh 的版本号下了结论，并在对用户的汇报里说错了一次
- **根因**: 把 PATH 上的 CLI 当成运行宿主；没有先查 runtime.json 与监听进程
- **已做的补救**: 公开更正；D1075 载体制核实件 §〇 专设两套 DSH 对照表，并注明 D946 结论只对 rc.2 成立
- **固化（可机械化与否）**: 可提示化：涉及版本结论时提示本机可能存在多套 DSH，请写明断面
- **归属**: X30 工程线自我改善；如需机器执法，落点属控制塔域（另立卡）。
