# 交接指令落地 skill（brief-compose 五步自检 + cto-handover 指针）

- **状态**: proposed
- **日期**: 2026-10-01
- **背景**: ① 新任 CTO = 【Synova-主CTO】预设，交接文档已交付但"动作指令"未进 skill；
  ② 本波三条 CI 日志实证的 brief/writeset 唯一性要求未沉淀进 `brief-compose`。
- **决定**: 扩展两个既有 skill（不新建）：`brief-compose` 加「交前五步自检」表 + 源码依据；
  `cto-handover` 加「交接指令」指针（开工前 5 分钟三件确认 / 第一天四件事 / 红线 / 接住了的判据）。
- **考虑过的其他方案**:
  1. 新建 `cto-onboarding` skill ⇒ 否决：技能面已有 16 个，扩展既有更省（且 cto-handover 本就是开工必读）。
  2. 只写档案仓不进 skill ⇒ 否决：档案仓是 D 层（不入库），对 main 上开工的 session 不自动生效。
  3. 派 dev-doc 执行 ⇒ 创始人指定由 CTO 直接改（本波收尾，且内容来自 CTO 自身实证）。
- **后果**: 新任 CTO 开工即自动加载；五步自检可拦下本波三类红（唯一性/精确路径/占位符）。
  ⚠️ 未做：未送 K3 独立审（skill 变更影响所有 session 行为，建议后续补审）。
- **取代**: 无（扩展）
