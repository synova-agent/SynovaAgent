# Task Brief: B5 四卡 task-state 补登记

> 生成: 2026-09-24 | 任务: B5（并入 D940 队列） | 认领: b5-c1
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔治理层（**纯簿记，非代码**）。四张已落地但漏登记的卡需补 `task-state/*.json` 登记。
派单件：`派单-B类并行与预规划-20260924.md` §三（B5 = 唯一可与 D938 并行的写码项；写集仅 `task-state/`，domain_neutral，不撞热点文件）。
### b) 文件审计
- 目标 4 文件**当前均不存在**（实测 `ls task-state/{D928,D933,D934,D936}.json` → 全部缺失）→ 本卡新建
- 参照格式：`task-state/D922.json`（含 `task_id/title/status/executor/write_set/evidence/...` 的完整字段集）
- 相关事实源（须核对，不许编）：`task-state/D922.json`、`task-state/D925.json`、`docs/synova/coordination/派单-W1-双DSH提升-20260923.md`
### c) 决策
复用既有登记格式（不新建 schema）；四卡各自内容**以事实源为唯一依据**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 49 / D534（决策必须沉淀）：四态 Note 与 task-state 是"决策可检索"的物理载体；漏登记 = 证据链缺口。
- D382（取号必走分配器）/ D547-D550（漏号撞号实证）：登记是防撞号的基础设施。
- **F1 族第四次**：同类"当时漏登记"已第四次发生 → 本卡判据④要求**每卡附一句根因**（不许只补数据不补原因）。
- 决策参考：第一性原理（不可检索的完成 = 未完成）
  + Anthropic 基线（事实源单一：以 PR/派单件为准，禁推测）
  + 开源实证（既有 task-state 字段集即 schema）
  → 结论：新建 4 个 JSON，逐字段对齐既有格式，内容逐条挂事实源。
  参考：Anthropic/DeepSeek/第一性原理 + 结论=按既有 schema 补 4 卡 + 每卡一句漏登记根因

## Q2: 范围 — 正确的最简方案
做什么：
- `task-state/D928.json`（新建）— D928 = 第③面生成器修复（PR #725，**尚未合并**）
- `task-state/D933.json`（新建）— D933 = Win 派单 + 模块归属基线（PR #730）
- `task-state/D934.json`（新建）— D934 = 两侧协作方式（PR #731）
- `task-state/D936.json`（新建）— D936 = 模块归属改为服从 `ownership.yaml` + 台账（PR #733）
- 每卡附"为什么当时漏登记"的一句话根因
不做什么：
- 不改任何代码文件（`git diff --name-only` 只允许出现 `task-state/`）
- 不改 `scripts/control-tower/alloc-task-id.sh`（D940 写集）
- 不改 `docs/synova/coordination/ownership.yaml`（卡 3/卡 5 写集）
- 不改 `scripts/audit/**`（K3 红线）
- 不改 `src/**`、`packages/**`（非本卡域）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`ls task-state/D928.json task-state/D933.json task-state/D934.json task-state/D936.json`
处理：逐字段按既有 schema 填充，内容挂事实源（PR 号 / 派单件路径）
结果：4 文件存在、字段完整、内容与事实相符、`git diff --name-only` 仅 `task-state/`

## 写集

| 文件 | 类别 |
|---|---|
| `task-state/D928.json` | task（写者 b5-c1，新建） |
| `task-state/D933.json` | task（写者 b5-c1，新建） |
| `task-state/D934.json` | task（写者 b5-c1，新建） |
| `task-state/D936.json` | task（写者 b5-c1，新建） |
| `docs/synova/product-lines/evidence/B5-改动清单.md` | task（证据，写者 b5-c1） |
| `docs/synova/product-lines/evidence/B5-自验.md` | task（证据，写者 b5-v，独立自验） |
| `docs/synova/product-lines/evidence/B5-收尾与回执-20260924.md` | task（M6 收尾，写者 lead，治理产物） |
| `.claude/task-briefs/2026-09-24-B5-taskstate-backfill.md` | builtin（本 brief，队长治理产物） |

## 架构层: scripts（控制塔治理层，非 L1-L5）

## Done 标准
- [ ] verify: 四卡 JSON 存在且字段含 `task_id / title / status / executor / write_set / evidence / updated_at`
- [ ] verify: 内容与事实相符（PR 号可核；D928 须标"尚未合并"）
- [ ] verify: `git diff --name-only` 仅出现 `task-state/`（+ 治理产物）
- [ ] verify: 每卡附"为什么当时漏登记"一句话根因
