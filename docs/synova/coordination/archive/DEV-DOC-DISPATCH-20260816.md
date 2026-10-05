# Dev-Doc 派活指引（2026-08-16 启动批）

> 给 📋 synova-devdoc session 的启动文件。读本文件 + 各任务派活 brief + 参考材料，即可开始写 spec。

## 你是谁
dev doc 撰写线。产出一份「活规格」（SYNOVA-IMPL dev doc），供实现角色照做。你只写 doc 不写实现。

## 启动步骤（按序）
1. 读 `docs/synova/coordination/TASK-ROUTING.md`（认领表——你的任务标注「spec 由 dev-doc 线产出」）
2. 读 `docs/synova/coordination/审计发现台账-DSH-CTO.md`（演进记录——任务来源与上下文）
3. 读 D381 纪律（写前必读 D352 范例对齐结构，见你的 persona）
4. 逐任务读派活 brief + 参考材料，产出 spec

## 本批 4 个任务（按优先级）

| 任务 | 派活 brief | 核心参考 | 产出物 |
|------|-----------|---------|--------|
| **D396** 黄金用例门禁 | `.claude/task-briefs/D396-snapshot-golden.md` | K3 咨询 §4.3（docs/synova/audit-reports/2026-08-16-D394-D398-strategy-consult.md）+ scripts/ci/golden-case-checker.ts | SYNOVA-IMPL-DSH-D396-*.md |
| **D394 片1** 哨兵事件化 | `.claude/task-briefs/D394-sentinel-events.md` | K3 咨询 §4.1 + src/sentinel/runner.ts + src/agent/sentinel-service.ts:97 | SYNOVA-IMPL-DSH-D394-sentinel-events-*.md |
| **D395-a** Notes 四态 | `.claude/task-briefs/D395a-notes-four-state.md` | K3 咨询 §4.2 + memory/（20 文件） | SYNOVA-IMPL-DSH-D395a-notes-*.md |
| **D402** D391 P1 修复 | `.claude/task-briefs/D402-audit-fix-p1.md` | audit-reports/2026-08-16-D391.md + src/routes/admin-knowledge.ts | SYNOVA-IMPL-DSH-D402-*.md |

## 关键纪律（来自 K3 咨询 + 历史教训）
- **以 K3 咨询为准**（docs/synova/audit-reports/2026-08-16-D394-D398-strategy-consult.md 436 行终版）——每个任务的神（invariant）/形似神不似预警/验收锚点 K3 已定义，写进 spec
- **编号**：任务编号已分配（D396/D394/D395/D402），spec 文件名带对应编号
- **写集表**：格式 `### N.N 写集`，标题行下一行紧跟表头（D381 格式契约）
- **Wiring Verification 章节**：只用此标题（gatekeeper C4）
- **接线 grep 实测**：调用方/被调用方 read 真实定义，禁凭描述推断
- **产出后**：bash scripts/control-tower/dev-doc-gatekeeper.sh <doc> → exit 0 + 更新 task-state/<任务>.json（spec 段）

## 产出后
- 通知 CTO（spec 已交付）→ CTO 派实现
- 你的 spec 会进 task-state（生成器自动检测 spec ✅）
