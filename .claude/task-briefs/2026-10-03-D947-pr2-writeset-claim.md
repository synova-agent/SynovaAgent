# Task Brief: D947 PR-2 写集认领 + 空 catch 降级注记（解 G12 与铁律 24 双红）

> 生成: 2026-10-03 | 任务: D947 | 认领: win-codex-cto
> 触发: CI run 37092059610 · `TypeScript + Lint + Iron Laws` 两组红

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L2 编排层（鉴权中间件挂载序 + 工作区写端点接线）。本卡是 **D947 PR-2 的写集认领**，代码早已完成并推送。

### b) 文件审计（实测）

| 检查 | 实测 |
|---|---|
| `git diff --name-only origin/main...HEAD` | 24 件 |
| 计入 D734 预算（新版门禁实测） | **11 ≤ 12 ✅ PASS** |
| CI 红① | `❌ empty catch 无 log: tests/routes/workspace-access-write-endpoint.test.ts:78` |
| CI 红② | `❌ G12: task brief Q2 范围一致性 9 处 [硬阻断]` |

红①真因：该 catch 是 JSON 解析失败的**降级分支**（已有 `body = { _raw: text }` 兜底），
但门禁要求在 `catch {` 后 2 行内出现 `log./logger./console./degraded/throw/*///` 之一
（`scripts/pre-commit-check.sh:538-546`）——是**缺注记**，不是真吞错。

红②真因：main 里没有覆盖本 PR 变更集的 brief ⇒ G12 把 9 个文件全判越界。

### c) 决策
① 按门禁语义补一行 **降级注释**（行为零变化，诚实标注是降级不是吞错）；
② 补一份写集认领 brief，Q2 覆盖本 PR **完整变更集**（只列新增文件会让原有文件仍判越界）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 门禁提示即正解：empty-catch 扫描器接受"注释级"说明（`//` 即算），说明其语义是「不许无声吞」而非「必须打日志」——测试夹具的降级分支用注释标注即可，无需引入 logger。
- G12 是写集单一事实源（D749）；本 PR 原 brief 在 main 中不存在（`git grep -l D947 origin/main` ⇒ 0）。
- 同会话先例：#754 已按同法补 `2026-10-02-D947-pr1-writeset-claim.md` 并**合并进 main**（02f1a9c6）⇒ 本卡是它的姊妹卡。

## Q2: 范围 — 正确的最简方案
做什么：
- .claude/bypass.log
- .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
- docs/synova/product-lines/evidence/D947-20260924/D947-RECEIPT.md
- docs/synova/product-lines/evidence/D947-20260924/D947-RULINGS.md
- docs/synova/product-lines/evidence/D947-20260924/D947-T-V-verifier-raw-evidence.md
- docs/synova/product-lines/evidence/D947-20260924/D947-code-b-pr2a.md
- docs/synova/product-lines/evidence/D947-20260924/D947-code-b-recon.md
- docs/synova/product-lines/evidence/D947-20260924/D947-code-c-pr2b.md
- docs/synova/product-lines/evidence/D947-20260924/D947-code-c-recon.md
- docs/synova/product-lines/evidence/D947-20260924/D947-reviewer-pr1.md
- docs/synova/product-lines/evidence/D947-20260924/D947-reviewer-pr2.md
- docs/synova/product-lines/evidence/D947-20260924/D947-verifier-pr1.md
- docs/synova/product-lines/evidence/D947-20260924/D947-verifier-pr2.md
- docs/synova/product-lines/evidence/D947-20260924/PLAN-REV2.md
- docs/synova/product-lines/evidence/D947-20260924/PLAN.md
- src/routes/department-workspace.ts
- src/routes/documents.ts
- src/routes/workspaces-api.ts
- src/server.ts
- src/services/request-context.ts
- tests/routes/department-workspace.test.ts
- tests/routes/middleware-order.test.ts
- tests/routes/overflow.test.ts
- tests/routes/workspace-access-write-endpoint.test.ts
- .claude/task-briefs/2026-10-03-D947-pr2-writeset-claim.md

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 的 `bash scripts/pre-commit-check.sh`（SYNO_CI=1）
处理：组 2 扫 empty catch；组 12 以本 brief 的 Q2 作写集事实源
结果：两组均绿 ⇒ `TypeScript + Lint + Iron Laws` 转绿 ⇒ PR 可合并

## 架构层:
L2 编排（src/middleware + src/routes）

## Done 标准
- [ ] verify: `bash tests/control-tower/simulate-ci.test.sh` 不受影响（回归）
- [ ] verify: `git diff --name-only origin/main...HEAD | wc -l` ⇒ 25
- [ ] verify: CI `TypeScript + Lint + Iron Laws` ⇒ success（push 后取）
