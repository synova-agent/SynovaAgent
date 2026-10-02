# Task Brief: D1003 派单件补登记（解 D2 登记门禁 CI strict 红）

> 生成: 2026-10-02 | 任务: D1003 | 认领: win-codex-cto
> 触发: CI run 36978051120 · Step「bash scripts/pre-commit-check.sh」⇒ `❌ D2 登记门禁: 有未登记文档 3 个 [CI strict]`

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
文档治理层（`docs/authority/DOCS-REGISTRY.yaml`）。本卡只补登记条目，**零文档内容改动、零脚本改动**。

### b) 文件审计（实测）

| 位置 | 现状 |
|---|---|
| `docs/authority/DOCS-REGISTRY.yaml:286-302` | 最后三条为 DOC-0121/0122/0123 |
| `docs/synova/dispatch/D1001-ownership-renderer-tests-20260925.md` | 未登记（D2 门禁点名） |
| `docs/synova/dispatch/D1002-workspaces-route-order-f1-20260925.md` | 未登记（D2 门禁点名） |
| `docs/synova/dispatch/D1003-docs-tools-and-a-class-registry-20260926.md` | 未登记（D2 门禁点名） |

红因原文：
```
❌ D2 登记门禁: 有未登记文档 — 登记 docs/authority/DOCS-REGISTRY.yaml 或核对排除规则: 3 个
```

### c) 决策
按门禁**自己的修复提示**补登记（不发明新机制、不动排除规则）——最小、可逆、判据明确。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 门禁提示即正解：`请加入 docs/authority/DOCS-REGISTRY.yaml`——本卡不绕过门禁，按提示补齐台账。
- 依据：Mac-CTO 2026-09-25 裁定「**正式派单件 = 入库**（`docs/synova/dispatch/**`）」⇒ 派单件既是入库文档，就须在登记表有身份证（与 `docs/synova/coordination/CTO-派单规程.md` 同类归 `governance`）。
- 教训：D1109（#939）已解掉 CT(windows) 超时这条通杀红；#757 复跑后暴露的**下一层**红就是本条——说明"复跑到真红"比"猜红因"有效。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/authority/DOCS-REGISTRY.yaml
- .claude/task-briefs/2026-10-02-D1003-doc-registry-registration.md
- .claude/bypass.log

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/pre-commit-check.sh`（SYNO_CI=1）
处理：向 DOCS-REGISTRY.yaml 追加 DOC-0124/0125/0126 三条
结果：D2 登记门禁对这三份派单件不再点名；CI `TypeScript + Lint + Iron Laws` 转绿

## 架构层:
scripts（文档治理层）

## Done 标准
- [ ] verify: `grep -c "DOC-0126" docs/authority/DOCS-REGISTRY.yaml` ⇒ 1
- [ ] verify: `grep -c "D1003-docs-tools-and-a-class-registry-20260926.md" docs/authority/DOCS-REGISTRY.yaml` ⇒ 1
- [ ] verify: CI run 的 `TypeScript + Lint + Iron Laws` ⇒ success（push 后取）
