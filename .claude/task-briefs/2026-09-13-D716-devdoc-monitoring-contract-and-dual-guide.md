# Task Brief: D716 devdoc-monitoring-contract-and-dual-guide

> 生成: 2026-09-13 | 任务: D716 | 认领: 📋 dev-doc（synova-devdoc）
> 参考: 派单文档 docs/synova/coordination/派单-下一批四线并行-20260913.md §D716

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
规格层（非五层实现）。本单出两份 spec，落地创始人两项裁定：
① **D-1 状态驱动通知模型**（创始人 2026-09-13 裁定，全文 docs/synova/product-lines/DECISION-D1-状态驱动通知模型-20260912.md）
② **线 1「1-5 双引导收敛」**（线 1 当前唯一 failed 点）
### b) 文件审计
- src/server.ts:300 实测仍挂载 `app.use('/app', express.static(...))`；app/setup.html + app/js/setup.js + app/js/admin.js 仍在仓库 → 打包态双安装引导入口并存
- D-1 决策文档已存在；线 8 的 `done_definition` 已按状态驱动重写；新增验收点 8-6 处于 `uncommitted`
- 接口契约未定：契约文件 schema、目录归属、loader 读取点均无 spec
### c) 决策
只出 spec，不写实现。实施归各自域（见 Q2 边界）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 0-2：spec → test → impl → wire → review → merge，spec 先行是硬要求
- 铁律 7：Done 标准必须可证伪（否则 spec 无法验收）
- 历史教训：D603 拉平发现 4 条铁律「文档声称有执法、实际零执法」→ spec 不得只写愿望，须写物理验收命令
- 跨线事故：D712 期间主树分支被并发切走 → 涉及双域（Mac/Win）的 spec 必须显式写「谁写哪个文件、谁不得写哪个文件」
### 参考：铁律 0-2/7 + D603 执法拉平教训 + 跨线同步文档 → spec 必须含可证伪验收命令与写集归属

## Q2: 范围 — 正确的最简方案
做什么：
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D716-D1-monitoring-contract-20260913.md — 监测契约 schema（每客户/每指标：阈值、渠道、**节奏**、**格式**、升级规则、责任人）+ 文件位置 + 示例 + 默认值（24h 未回应提醒 / 7 天无进展进周报首页 / 默认周报一页纸 / 明确不处理项每周回顾）+ 与状态机（六状态）的映射〔原声明名 SYNOVA-IMPL-DSH-D1-monitoring-contract.md；按 D384 加 D716 前缀与日期〕
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D716-1-5-dual-guide-convergence-20260913.md — 1-5 收敛 spec：收敛到哪个入口、另一入口如何退场（删除 or 重定向）、既有书签/URL 兼容、如何物理证明「只有一个入口」〔原声明名 SYNOVA-IMPL-DSH-1-5-dual-guide-convergence.md；同上〕
- docs/synova/coordination/编码指令-D716-监测契约-Mac-20260913.md — 编码指令（spec 1，Mac 线）
- docs/synova/coordination/编码指令-D716-1-5双引导收敛-Win-20260913.md — 编码指令（spec 2，Win 线）
- task-state/D716.json — 本单登记
- .claude/task-briefs/2026-09-13-D716-devdoc-monitoring-contract-and-dual-guide.md — 本 brief（回填实际交付物名）
不做什么：
- 不改 src/server.ts（**Claude 专属**，CODEOWNERS 明示，DSH 不碰 → 本单只出 spec，实施归 Win 线）
- 不改 app/setup.html、app/js/setup.js、app/js/admin.js（同上，Win 域实现）
- 不改 scripts/product-lines/product-lines.yaml（验收点状态由证据/裁决驱动，不由文档声称）
- 不写审计标准、不改 scripts/audit/（审计红线）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人转发本单给 📋 dev-doc session
处理：写两份 spec → 过 dev-doc-gatekeeper 结构门禁（Q0-Q3 / 写集 / DS 清单 / Done 可证伪）
结果：两份 spec 落盘 + 契约边界（Mac/Win 各写什么）明确到文件级 + 各自 Done 含物理命令

## 架构层: L3（哨兵/通知）+ L1（安装引导收敛）
D-1 契约 loader 落 src/sentinel/（Mac 域）；契约文件目录归 Win 域；1-5 收敛实施归 Win 线（src/server.ts）

## Done 标准:
- [ ] 两份 spec 落盘：`ls docs/plans/codex/implementation/ | grep -c "D1-monitoring-contract\|1-5-dual-guide"` → 2
- [ ] 契约 schema 含节奏/格式/升级/责任人四字段：`grep -cE "节奏|升级规则|责任人" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1-monitoring-contract.md` → ≥3
- [ ] 跨线写集边界写明：`grep -c "Win 域\|Mac 域" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-1-5-dual-guide-convergence.md` → ≥1
- [ ] 1-5 spec 给出「单入口」物理验收命令（非文字描述）：spec 内 Done 段含可执行 bash 命令
