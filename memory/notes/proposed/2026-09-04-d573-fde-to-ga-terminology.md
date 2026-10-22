---
状态: proposed
日期: 2026-09-04
决策: FDE 术语全仓退役，统一 GA = Growth Advisor（增长顾问）；GLOSSARY 为唯一允许出现 FDE（退役说明）的活文档；白名单外全仓零 FDE 由 scripts/check-fde-terms.sh 物理守卫
理由: FDE→GA 已由桌面端切片 D538 裁决但只落地了 electron-renderer；全仓 575 处残留中 T0 级（L0/L1 提示词、工具描述、报告文案、技能/专家/剧本文件）会直接进 LLM 上下文与用户可见报告；且 GA 全称在 GLOSSARY（Growth Architect）与代码注释（Growth Advisor）分裂——创始人 2026-09-04 裁决统一为 Growth Advisor。
---

## 决策上下文

- 任务: D573（FDE 术语退役全仓清理 + 防回归门禁）
- 触发: 创始人 2026-09-04 提问"是不是还存在很多 FDE 的残留"→ 全仓 grep 实测 575 处 / ~200 文件，分级 T0（运行时 LLM/用户可见 15 文件）/ T1（tool-profiles `case 'FDE'` 死代码对 + `ga` 角色掉 minimal 潜伏 bug）/ T2（注释 12 文件）/ T3（门禁脚本展示文案）/ T4（锚点链 PRODUCT-BRIEF/AGENTS/CLAUDE/authority/双轨 skills）。
- 语义澄清: FDE→GA 不是单纯改名，是角色拆分——原 FDE 混用"部署工程师"语义被舍弃，GA（增长顾问）是唯一操作者角色（先例: conversation-engine.ts D487 注释、GLOSSARY #16）。
- 防回归: 新增 scripts/check-fde-terms.sh（三态退出码 per D328；大小写敏感避免十六进制误报；白名单 = 历史档案 + 守卫自引用），npm run check:terms 接线；后续可挂 pre-commit 组（需测试 + 接线审计，另行任务）。
- 边界: 审计红线不碰 scripts/audit/；历史档案（docs/、task-state、memory、audit-reports、带日期手册）白名单不动；docs/SYNOVA-MASTER-全量对齐手册 136 处与 docs/specs/sentinels 12 文件留待文档批处理任务。

## 执行证据

- verify: bash scripts/check-fde-terms.sh → exit 0（白名单外零 FDE）
- verify: grep -rn FDE src/ extensions/ skills/ expert/tech 零结果（T0/T2 运行时表面清零）
- verify: tool-profiles `case 'ga'` 接线（getProfileForRole 被 src/agent/tools.ts:170,189 调用）+ tests/agent/tool-profiles.test.ts 同步
- verify: .synova/skills ↔ .dsh/skills 双轨 diff 一致（D370 组 13）
