# Task Brief: D720 brief-landing-and-tree-hygiene

> 生成: 2026-09-13 | 任务: D720 | 认领: 主 CTO（synova-cto）
> 参考: cto-handover skill §〇b/§〇c + 派单文档 docs/synova/coordination/派单-下一批四线并行-20260913.md

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
派单交付补全（非五层）。D715-D719 派单文档已入 main（#515），但四个执行方的 task brief 只以 **alloc 骨架**形式散落在主树未跟踪区
（`alloc-task-id.sh` 每次分配生成骨架 brief；`alloc-task-id-lock.test.sh:42` 又把它泄漏进真仓）→ 执行方开工时面对的是
「D# 已登记但对不上可用的 brief」。本单把四份 brief 按派单内容**填实并落 main**，使派单自包含。
### b) 文件审计
- 实测：`git ls-tree origin/main .claude/task-briefs/ | grep D71` → 仅 D714/D719 在 main；**D715/D716/D717/D718 四份不在**
- 实测：四份仅存在于主树未跟踪区，且均为**未填写的 alloc 骨架**（36 行模板，`<...>` 占位符未替换）
- 实测：task-state D715-D719 已在 main（派单登记 OK）；派单文档第 85-122 行含四段创始人复制块
### c) 决策
按派单内容填实四份 brief 后落 main；不新建任务（D# 已分配）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 0-2 / 7：Done 标准须可证伪 → 四份 brief 全部写物理验收命令，不写「已完成」式文字
- pre-commit 组 6：brief 六核心字段（Q0-Q3 / 架构层 / Done）+ 模板残留检查（`<...>` 占位符 → 阻断）
- 历史教训：D712 派单因未先并入 main，执行方在净仓库态读不到（Win 侧 G0）→ 本单延续「先落 main 再转发」纪律
- 审计红线：D715 是给 K3 的审计单，CTO **只写范围/材料/写集/红线，不写审计方法与判据**（不写审计标准）
### 参考：派单 SOP + G0 教训 + 铁律 0-2/7 → 派单产物必须落在 main 且 brief 可独立开工

## Q2: 范围 — 正确的最简方案
做什么：
- `.claude/task-briefs/2026-09-13-D715-k3-audit-ctl-slice-and-line1.md` — 按派单填实（范围/材料/写集/红线；审计方法留 K3 自定）
- `.claude/task-briefs/2026-09-13-D716-devdoc-monitoring-contract-and-dual-guide.md` — 两份 spec 的写集与 Done
- `.claude/task-briefs/2026-09-13-D717-coding-product-debt-batch.md` — 产品真债两项的验收（干净安装 + grep 调用方）
- `.claude/task-briefs/2026-09-13-D718-cto-parallel-ctl-minor-fixes.md` — 控制塔三项 + 技能加载要求
- `.claude/task-briefs/2026-09-13-D720-brief-landing-and-tree-hygiene.md` — 本 brief
- `task-state/D720.json` — 本单登记
不做什么：
- 不改 `docs/synova/coordination/派单-下一批四线并行-20260913.md`（已入 main，改则需重开 PR）
- 不改 `scripts/control-tower/alloc-task-id.sh`（骨架生成逻辑改动归 D718 范围①，避免撞车）
- 不改 `scripts/audit/`（审计红线）
- 不为 D715-D718 写实现代码（各自执行方域）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人从派单文档复制四段说明转给四个执行方
处理：执行方在自己 session 打开对应 brief（已填实）→ 直接开工，无需先补 brief 机制
结果：四份 brief 在 main 且字段完整；主树残留清理后不再干扰 git 状态

## 架构层: 基础设施（派单与任务登记，非五层）
本单只改 `.claude/task-briefs/` 与 `task-state/`，零代码改动

## Done 标准:
- [ ] 四份 brief 在 main 且字段完整：`for d in 715 716 717 718; do grep -q "^\#\# Done 标准:" .claude/task-briefs/2026-09-13-D$d-*.md || echo "MISSING $d"; done` → 零输出
- [ ] 无模板残留：`grep -l '<本任务在哪一层\|<path/to/' .claude/task-briefs/2026-09-13-D7*.md` → 零输出
- [ ] 主树残留清零：`git status --porcelain | grep -c '^??'` → 0
- [ ] 骨架未落 main（反证本单填的是真内容）：主树删除的 4 份骨架 == 本单落盘的 4 份，且行数 >36
