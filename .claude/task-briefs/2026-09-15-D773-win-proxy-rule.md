# Task Brief: D773 Win 域代行规约（临时）+ 计划 v1.3

> 生成: 2026-09-15 | 分支: docs/d773-win-proxy-rule | as any: 0
> 域: mac（docs/synova/coordination + task-state；单域）
> 主线贡献: infra:执行方路由规约（防止「Win 不在」期间主线被域边界卡住）
> 依据: 创始人 2026-09-15「这几天 win 不在身边，同一个模块或者切片，涉及到 win 工作范畴的，也一并安排给 Mac 侧执行」

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理层：**执行方路由**。常设路由在 `TASK-ROUTING.md` + `ownership.yaml`（域归属）；本单加一层**临时执行方规约**（域不变、执行方改 Mac），效期至 Win 机回归。
当前受影响面（待执行）：DSH 借鉴卡十张（D760~D769，9 张 win 域）+ Win 域待办（D753 计数一致性、D754 的 Win 半 manifest route、D728/D729 证据链接线）。

### b) 文件审计（实测）
- `整体推进计划-主线-20260913.md` §四 资源分配表：只写「Win 100% 主线」，**无代行口径** → 期间无据可依。
- `派单-D760-D769-DSH借鉴卡-20260915.md` §〇：只写「Win 域编码 → Win 线」→ 与创始人新指令冲突（已在 D771 分支更新）。
- `ownership.yaml` 域判定**不需要改**：代行只改执行方，不改归属（改归属会同时影响 CODEOWNERS 与单域判定，属过度改动）。
- Win 域待办台账实测：`task-state/D753.json` ✅、`D754.json` ✅、`D728/D729` 在未合 PR #536 分支（`5732b5ab`）→ 看板不可见（PR 未合所致，非缺登记）。

### c) 决策
新增**单点规约文档**（唯一事实源）+ 计划表加一行引用；不动 `ownership.yaml`、不动 `TASK-ROUTING.md`（常设规则不改，临时规约独立成文、可由 CTO 显式撤销）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 「同一模块/切片只派一个执行方（Mac）」+ 域声明不变 + 单域 PR 不变 + 验收分两级。
② 测试 = 规约类无单测；等价验收 = 规则可被机器引用（计划表引用 + 派单文档引用 + 挂账清单可查 task-state）。
③ 实现 = 一份规约 + 计划表一行 + 派单文档执行方列（后者在 D771 分支）。
④ 接线 = 计划表 §四（资源分配）与派单文档均已链接本规约路径。
⑤ 验证 = `grep` 三处引用 + 挂账清单每一项都有登记路径。

引用依据：
- 铁律 0（协作对齐前置）：创始人指令必须落成可引用的文档，否则下次派单又会按老口径走
- 计划 §五 原则 8（声称必有物理证据）：验收分级正是为「不许用 Mac 结果声称实机通过」
- M2（声称 vs 事实）：实机级挂账清单明确写「挂账 ≠ 未完成」

### b) 本任务执行约束
- rule: "不改域归属" verify: "git -c core.quotepath=false diff --name-only origin/main...HEAD | grep -c ownership.yaml → 0"
- rule: "规约被计划表引用" verify: "grep -c 'Win域代行规约-20260915.md' docs/synova/coordination/整体推进计划-主线-20260913.md → ≥1"

### c) 决策参考系
参考：第一性原理（域归属=谁负责长期维护；执行方=这几天谁有机器，两者解耦）+ Anthropic 基线（临时策略单点成文、可撤销）→ 独立规约文档。

### d) 相关 Note 引用
无（未触治理脚本区/规则文档区的脚本改动；本文档为 coordination 文档，D534 触发面不含）。

## Q2: 范围 — 正确的最简方案

做什么：
- docs/synova/coordination/Win域代行规约-20260915.md — 新增（规约 + 执行方映射 + 挂账清单 + 红线）
- docs/synova/coordination/整体推进计划-主线-20260913.md — §四 资源分配加「Win（代行）」行 + 版本 v1.3 + 变更记录
- task-state/D773.json — 本任务台账

不做什么：
- 不改 docs/synova/coordination/ownership.yaml（域归属不动）
- 不改 docs/synova/coordination/TASK-ROUTING.md（常设路由不动）
- 不改 scripts/control-tower/check-pr-budget.sh（预算门禁不动）
- 不改 scripts/audit/**（K3 红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口：任何派单/任务认领时查执行方（CTO 派单文档 + 计划表 §四）
处理：按规约第二张表判执行方（Win 域产品代码 → Mac 编码 session；CTO 域 → 并行 CTO）
结果：主线不再因「Win 不在」停摆；实机级项在挂账清单可查，不会被误当作已完成

## 架构层: scripts（治理层文档 + task-state）；不触 L1-L5
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: `grep -c "Win域代行规约-20260915.md" docs/synova/coordination/整体推进计划-主线-20260913.md` → ≥1
- [ ] 链路走通: verify: `grep -c "Mac 侧执行" docs/synova/coordination/Win域代行规约-20260915.md` → ≥1
- [ ] 结果可见: verify: `grep -c "挂账" docs/synova/coordination/Win域代行规约-20260915.md` → ≥3（挂账清单可查）
- [ ] 域归属未动: verify: `git -c core.quotepath=false diff --name-only origin/main...HEAD | grep -c "ownership.yaml"` → 0

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-15-D773-win-proxy-rule.md | task |
| docs/synova/coordination/Win域代行规约-20260915.md | task |
| docs/synova/coordination/整体推进计划-主线-20260913.md | task |
| docs/synova/coordination/编码指令-D767-B18运行时不变量注册表-20260915.md | task |
| task-state/D773.json | task |

