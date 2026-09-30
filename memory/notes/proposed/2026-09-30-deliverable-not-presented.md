---
status: proposed
date: 2026-09-30
name: 交付物未 present（只在对话贴路径）
class: DELIVERABLE_NOT_PRESENTED
constraint: "给创始人的可见交付物必须走 present 声明，不得只在正文里贴路径"
expected: "交付卡出现在右侧栏；创始人可直接打开而不必去翻文件系统"
severity: warn
occurrences: 1
first_seen: 2026-09-30
description: D1087 操作卡只在对话里给了路径 → 创始人反馈看不到文档、右边栏没有显示 → 改用 present 补声明
---

# 创始人看不到右侧栏交付卡

- **现象**: 我默认贴了路径就等于交付，但 GUI 的交付面板只渲染 present 声明的文件
- **根因**: 把聊天正文当成交付渠道；不了解 present 与侧栏渲染的关系
- **已做的补救**: 立即补 present（操作卡与验收清单两张卡）；此后统一走 present
- **固化（可机械化与否）**: 可提示化：产出给创始人过目的件时提醒走 present
- **归属**: X30 工程线自我改善；如需机器执法，落点属控制塔域（另立卡）。
