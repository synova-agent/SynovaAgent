# Task Brief — alloc-task-id 占用判定补「issue 标题」来源（过渡件）（D1219）

> **编号留痕**：本卡初拟 D1219 —— 被 `check-name-allocation.sh` 判占用（`feat/D1219-gen-cto-health-degrade` 在途）
> ⇒ 按 gate 取 **D1219**（三重核验：gate 可用 / main 零文件 / issue 标题零命中）。

> 卡：本卡由 Lead 立（**过渡专用**）· 来源：D# 撞号本日 5 次代价的第 5 项（命名分配器来源缺失）
> **🔴 过渡件声明（Lead 裁决③ 逐字要求）：本来源为过渡件 —— `D# 退役时同批删除此来源`。**
> 本句同时落在：本卡面 + 代码注释（`alloc-task-id.sh` 该段头）+ PR 正文三处。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（`scripts/control-tower`）控制塔**发号器**。只补一个**占用判定来源**，不改发号语义。

### b) 文件审计（本轮实测，file:line）
- **实现点 = `scripts/control-tower/alloc-task-id.sh` 的 `_occupy_locations()`（:246）**，
  现有 5 源：`task-state` / `origin-main` / `remote-branch` / `local-branch` / `worktree-name`。
- ⚠️ **卡面原写 `check-name-allocation.sh` 是错的**（Lead 已批更正）：`check-name-allocation.sh:113`
  **明文委派** `alloc-task-id.sh --check-id`（注释：单一实现，杜绝第二副本漂移）⇒ 改前者 = 造第二副本。
- 网络源的既有范式 = `REMOTE_BRANCH_REFS`（:208-241）：**拿锁前**取快照 +
  `_run_bounded` 超时 + **超时 fail-closed(2) / 不可达 degraded 继续** + 注入缝 `SYNO_ALLOC_NO_BRANCH`。
- **实测缺口**：D1208 当日被 `check-name-allocation.sh` 报「可用」，而 **issue #1268 的标题已带 `D1208`**
  ⇒ 号被 issue 卡占用却不可判 ⇒ 我据此撞了第 4 次。

### c) 决策
复用既有范式（快照 + 注入缝 + 显式降级），**只增一源**，不重写占用判定。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **铁律 11（静默降级禁止）**：新源必须**显式**报告自身状态（可达/不可达/被禁用），禁静默。
- **Hermetic 红线（Lead 裁决④）**：`alloc-task-id.test.sh` / `check-name-allocation.test.sh` 都在
  CI 密封清单里 ⇒ **不得打真网络** ⇒ 注入缝不是可选项，是**必要条件**。
- **本日实证（5 次代价）**：D# 撞号造成互合冲突 / 与 main 撞号 / 污染 D708 / 多命中 fail-closed /
  **命名分配器来源缺失**（本卡）。分配器看不见 issue 卡 ⇒ 卡面号与分配器号两套口径。
- **判据不降级**：既有 5 源与退出码语义**逐字不变**；新源只在 `--check-id` 的判定面上**增**一条。
参考：第一性原理（判定来源必须覆盖真实占用面）+ 既有 REMOTE_BRANCH_REFS 范式 ⇒ 增第 6 源 + 三段降级。

## Q2: 范围 — 正确的最简方案
做什么（`scripts/control-tower/alloc-task-id.sh`）：
- 新增第 6 源 `issue-title`：`gh issue list --state all` 快照 → 标题命中 D# 即报占用；
- **拿锁前**取快照（对齐 REMOTE_BRANCH_REFS 的性能理由），`_run_bounded` 超时保护；
- **三段语义（Lead 裁决②）**：
  ① 不可达/超时 ⇒ **fail-open**：stderr 显式 `degraded: issue 标题源不可达（…）`，继续按可判定位置判；
  ② 结论措辞只报**「可判定范围内未见占用」**（不得报「未占用」）；
  ③ 注入缝 `SYNO_ALLOC_NO_ISSUES=1`（hermetic 完全离线）+ `SYNO_ALLOC_ISSUES_FILE=<path>`
     （测试注入快照内容，生产不设）；
- **来源可追溯（Lead 额外要求）**：`--check-id` 输出一行**来源说明**（含 issue-title 是否参与本次判定），
  **走 stderr** —— 因 `_occupy_locations` 的 **stdout 是冲突行契约**（非空即「已占」），不得污染。
- `tests/control-tower/alloc-task-id.test.sh` — 夹具：禁用缝 / 注入快照命中 / 不命中 / 来源说明可见。
- `tests/control-tower/check-name-allocation.test.sh` — 委派侧：仍走单一实现 + 来源说明透传。
- brief + `task-state/D1219.json` + `memory/notes/proposed/2026-10-07-alloc-issue-source.md`

不做什么（含文件路径）：
- 不改 `scripts/control-tower/check-name-allocation.sh` 的**委派结构**（它调 alloc，改它就造第二副本）
- 不改 `alloc-task-id.sh` 既有的 5 源与退出码语义（0=未占 / 1=已占 / 2=非法输入）
- 不改 `scripts/control-tower/ci-red-baseline.txt`、`.github/workflows/ci.yml`（非本线）
- 不改 `scripts/audit/**`（K3 红线）
- 不做 D# 退役本身（另卡 #1222 D-C）—— 本卡**只补来源**，且自带删除条件

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/alloc-task-id.sh --check-id D1219`
处理：取 issue 快照（可禁用/可注入）→ 6 源合并 → 冲突行（stdout）+ 来源说明（stderr）。
结果：issue 标题含该 D# ⇒ exit 1 且点名 `issue-title`；离线 ⇒ 显式 degraded + 仍可用；来源说明可见。

## 架构层: 治理面（scripts/control-tower）
#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| `scripts/control-tower/alloc-task-id.sh` | task（第 6 源 + 三段降级 + 来源说明） |
| `tests/control-tower/alloc-task-id.test.sh` | task |
| `tests/control-tower/check-name-allocation.test.sh` | task（委派侧） |
| `.claude/task-briefs/2026-10-07-D1219-alloc-issue-source.md` | task |
| `task-state/D1219.json` | task |
| `memory/notes/proposed/2026-10-07-alloc-issue-source.md` | task |

## Done 标准
- [ ] verify: bash tests/control-tower/alloc-task-id.test.sh ⇒ 全绿 0 失败
- [ ] verify: bash tests/control-tower/check-name-allocation.test.sh ⇒ 全绿 0 失败
- [ ] verify: SYNO_ALLOC_NO_ISSUES=1 bash scripts/control-tower/alloc-task-id.sh --check-id D1219 ⇒ 不打网络（夹具断言离线可跑）
- [ ] verify: SYNO_ALLOC_ISSUES_FILE=<含"D1219"的快照> … --check-id D1219 ⇒ exit 1 且 stdout 点名 issue-title
- [ ] verify: grep -c 'D# 退役时同批删除此来源' scripts/control-tower/alloc-task-id.sh ⇒ ≥1（过渡件声明在位）
- [ ] verify: bash scripts/pre-commit-check.sh ⇒ 13 组通过
