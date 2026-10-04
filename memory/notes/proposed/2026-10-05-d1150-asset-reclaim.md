# D1150 — 资产回收：worktree 分类回收 / task-state 保留策略 / docs 归档（proposed）

- **日期**: 2026-10-05 ｜ **线**: 治理线（gate-assets）｜ **分支**: `chore/D1150-asset-reclaim`（PR-1）+ `chore/D1150-docs-archive`（PR-2）
- **状态**: proposed（PR 开、待 Lead 走独立复核与合并）

## 决策

1. **worktree 回收 = 先取证后动手，默认只取证**
   - 新增 `scripts/control-tower/reclaim-worktrees.py`（配套夹具 `tests/control-tower/reclaim-worktrees.test.sh`）。
   - 判据（严格版，不放宽）：`git log --oneline <base>..HEAD` 空 ∧ `git status --porcelain` 空 ∧ 不在保护名单
     ⇒ 才判 `RECLAIM`；`--apply` 只用 `git worktree remove`（**绝不 `--force`**）；默认 dry-run。
   - **不选**「脏=hook 产物就删」的放宽口径（Lead 2026-10-05 明确红线）；等 #1075 落（`.claude/bypass.log` 停跟踪）
     后重扫，届时那类工作树的脏因自然消失。
2. **task-state 保留策略 = 终态 ∧ 超期 才归档**（Lead 2026-10-05 裁决的 union 规则）
   - 新增 `scripts/control-tower/task-state-retention.py`（配套夹具 `tests/control-tower/task-state-retention.test.sh`），
     两个子命令：`expire`（判定 + `git mv` 归档）、`index`（生成 `task-state/INDEX.md`，含覆盖自检）。
   - **依据**：`task-state/README.md` 自证 `audited` = 终态；卡片原写「近 90 天」经逐件实测恒为 0 件（见下「配方错误」）。
3. **docs 归档必须拆纯改名 PR**
   - `check-pr-budget.sh:409` 出库白名单含 `docs/synova/coordination/`，`:449` 豁免要求 ⓐ`AM_N=0`（纯删/改名）
     ∧ ⓑ全部路径落白名单 ⇒ 混入任何新增/修改件（脚本、索引、登记）豁免即失效，71 件改名会被计入「>12 件」判红。
   - 故 PR-1 = 工具 + 索引 + 登记；PR-2 = 纯改名归档。两者均**不需要**任何人改 `ci.yml` 放宽阈值。

## 配方错误（Lead 规则 vs 实测，以实测为准）

| 项 | Lead 卡面原写 | 逐件实测 | 处置 |
|---|---|---|---|
| task-state 保留窗口 | 「保留近 90 天」 | 429 件最后提交全在 **2026-08-22 ~ 10-04**（90 天窗口切 2026-07-07）⇒ **0 件过期**，字面规则恒为空操作 | Lead 2026-10-05 裁决改 union 规则（终态 ∧ >30 天）⇒ 86 件归档 |
| worktree 可回收数 | 「实测 14 个」 | 双空铁律下全量 80 个里仅 **3 个**（且 0 个在工作树可写区） | 3 个 git 侧注销；其余逐条列例外清单；≤20 目标需全盘权限会话 |
| docs 归档量 | 「240 → 归档一半」 | 带日期且 < 202609 的候选 **71 件**；减 live 引用 4 件 ⇒ **67 件移动** | PR-2 纯改名，逐件清单进正文 |

## 环境事实（不是判断，是实测）

- DSH 会话写权限 = 仅工作树（`mkdir /Users/wane/.dsh-sandbox-probe` → `Operation not permitted`）；
  `git worktree remove /Users/wane/synova-wt-D5xx` → `error: failed to delete ...: Operation not permitted`（rc=255），
  但 **git 元数据注销成功**（该工作树已从 `git worktree list` 消失）⇒ 目录残留需全盘权限者 `rm -rf`。
- 已完成：D507 / D520 / D525 三棵（判据：`origin/main..HEAD` 空 + `status --porcelain` 空），commit 均已在 origin/main 内 ⇒ 零数据风险。
- 保留（在飞同僚工作树，删了即事故）：`.synova-wt-cc-retire`（task-1）、`.synova-wt-single-set`（task-2）、
  `.synova-wt-decl`（task-3）、`.synova-wt-dead`（task-4）——四者虽「双空」，但**正在被使用**。

## 验收证据

- `bash tests/control-tower/reclaim-worktrees.test.sh` → PASS=16 FAIL=0（含 dry-run 零副作用、`--apply` 只回收 RECLAIM）
- `bash tests/control-tower/task-state-retention.test.sh` → PASS=19 FAIL=0（含冲突 ⇒ exit 1 且整批不动、未跟踪件 `degraded:` 留痕、覆盖自检 6=6）
- `bash scripts/control-tower/check-name-allocation.sh --id D1150` rc=0
- `bash scripts/doc-system/doc-registry-gate.sh` rc=0
- `bash scripts/control-tower/check-gate-integrity.sh` → `GATE-INTEGRITY: OK`

## 回滚

- task-state 归档：`git mv task-state/archive/*.json task-state/`（一条命令；全部经 `git mv`，历史可追）
- docs 归档：`git mv docs/synova/coordination/archive/*.md docs/synova/coordination/`（PR-2 正文附）
- 工具：新增文件，删除即回到原状（不影响任何既有执行路径）
