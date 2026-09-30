---
status: proposed
date: 2026-09-30
name: 建包只做形状对齐（缺可跑性差集）
class: PRESET_SHAPE_ONLY
constraint: "落位预设必须与一个已验证能跑的同族包做行集差集（可跑性校验），不得只做形状对齐"
expected: "新预设装上一次即不 broken；差集为空作为验收判据"
severity: block
occurrences: 1
first_seen: 2026-09-30
description: shanhe-researcher 按参考件逐字落位，参考件本身缺 workflow-ptc（tool-workflow 的 runtime）→ 预设加载失败（UI 红标）；与 synova-main-cto 做差集后定位并补行修复
---

# 参考件自身缺行 → 逐字复制把缺陷搬过来

- **现象**: 形状（insert 到 config 五字段）完全正确、插件名 24 个全部存在，却整包 broken
- **根因**: 把形状对当成能跑；参考件未经运行验证
- **已做的补救**: 补 workflow-ptc 行（照主 CTO 写法）；修后 delegation 组行集与主 CTO 差集为空；把行集差集写进 D1088 作为建包验收
- **固化（可机械化与否）**: 可机械化：新增预设后自动跑一次与同族包的包名差集，差集非空即告警
- **归属**: X30 工程线自我改善；如需机器执法，落点属控制塔域（另立卡）。
