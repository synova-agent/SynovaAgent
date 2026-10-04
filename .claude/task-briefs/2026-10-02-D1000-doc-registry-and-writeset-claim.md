# Task Brief: D1000 派单件补登记 + 写集认领（解 D2 登记门禁硬红）

> 生成: 2026-10-02 | 任务: D1000 | 认领: win-codex-cto
> 触发: CI · `TypeScript + Lint + Iron Laws` ⇒ `❌ D2 登记门禁: 有未登记文档 2 个 [CI strict]`

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
文档治理层（`docs/authority/DOCS-REGISTRY.yaml`）+ 该 PR 的写集认领。**零文档内容改动、零脚本改动。**

### b) 文件审计（实测）

| 位置 | 现状 |
|---|---|
| `docs/authority/DOCS-REGISTRY.yaml`（合并最新 main 后） | 主干已到 `DOC-0140`（D1111 治理线一窗） |
| `docs/synova/dispatch/D1000-win-identity-chain-department-20260924.md` | **未登记**（D2 门禁点名） |
| `docs/synova/dispatch/D1004-js-yaml-dependency-20260925.md` | **未登记**（D2 门禁点名） |
| 本 PR 对 main 的变更集 | 7 件（4 派单件 + 2 卡片 + hook 产物），+ 本批 2 件 = 9 |

红因原文：
```
❌ D2 登记门禁: 有未登记文档 — 登记 docs/authority/DOCS-REGISTRY.yaml 或核对排除规则: 2 个
```

### c) 决策
按门禁**自己的修复提示**补登记（`DOC-0141` / `DOC-0142`，取号接主干 `DOC-0140` 之后）；同批补写集认领 brief，使 G12 有单一事实源。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 门禁提示即正解，不发明新机制、不动排除规则。
- 依据 Mac-CTO 2026-09-25 裁定「正式派单件 = 入库」⇒ 派单件须有登记身份证。
- 同会话先例：D1109（#939）解掉 CT(windows) 超时后，各 PR 才第一次跑到 D2/G12 这一层；#757 已按同法修好（`doc-registry` 补 `DOC-0124..0126`）。
- 教训：写集认领 brief 的 Q2 **必须覆盖该 PR 的完整变更集**——只列新增文件会让 CI 侧 G12 把原有文件判越界。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/authority/DOCS-REGISTRY.yaml
- .claude/task-briefs/2026-10-02-D1000-doc-registry-and-writeset-claim.md
- docs/synova/dispatch/D1000-K3审计派单-20260925.md
- docs/synova/dispatch/D1000-win-identity-chain-department-20260924.md
- docs/synova/dispatch/D1000-派单勘误-20260925.md
- docs/synova/dispatch/D1004-js-yaml-dependency-20260925.md
- task-state/D1000.json
- task-state/D1004.json
- .claude/bypass.log

不做什么：
- 不改 .github/workflows/ci.yml
- 不改 scripts/pre-commit-check.sh
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/audit/audit-rules.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 的 `bash scripts/pre-commit-check.sh`（SYNO_CI=1）
处理：D2 门禁查登记表；G12 以本 brief 的 Q2 作写集事实源
结果：`D2 登记门禁` 不再点名这两份；`G12: 所有文件均在 Q2 范围内` ⇒ 该 job 转绿

## 架构层:
scripts（文档治理层）

## Done 标准
- [ ] verify: `grep -c "DOC-0142" docs/authority/DOCS-REGISTRY.yaml` ⇒ 1
- [ ] verify: `grep -c "D1004-js-yaml-dependency-20260925.md" docs/authority/DOCS-REGISTRY.yaml` ⇒ 1
- [ ] verify: CI `TypeScript + Lint + Iron Laws` ⇒ success（push 后取）
