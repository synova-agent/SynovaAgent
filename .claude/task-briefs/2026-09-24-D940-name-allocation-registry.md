# Task Brief: D940 名字统一分配（卡号 / worktree / 分支）

> 生成: 2026-09-24 | 任务: D940 | 认领: d940-c1
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔工具层（非 L1-L5）。对象 = `scripts/control-tower/alloc-task-id.sh`（全队取号唯一入口）
+ 一套「命名三元组（卡号 / worktree 名 / 分支名）」一致性校验。病：**撞号已 4 次**。
### b) 文件审计（实测，行号基于 origin/main 9f0c8f65）
- `alloc-task-id.sh:133` 注释 + `:141` **已扫远端分支**（`git branch -r` 提 D 号并入占用表）
- `alloc-task-id.sh:132` **已扫 worktree**（`git worktree list --porcelain`）
- `alloc-task-id.sh:89-91` **已合并 `origin/main` 的 task-state**
- `alloc-task-id.sh:165-166` **已有撞车拒绝**：`if [ -f "$STATE_FILE" ]; then echo "❌ 撞车: … 已存在 …"`（**仅查本 task-state 目录**）
- 排除面：`alloc-task-id` 被 55 个文件引用（须冲突扫描）；`派单模板.md` 最近由 D931 改（热点文件）
- **真实撞号样本（判别夹具直接可用）**：远端分支 `docs/d942-cto-fixation`、`docs/d943-cto-a-items` 占用 942/943，而 `task-state/` 只到 D941
### c) 决策
**扩展现有实现**（CTO 裁定：判据① 是"拒绝覆盖**跨位置**"，非从零新建）；新增**单一事实源**校验器供三元组一致性复用。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）+ `ctrl-tower-change` 模式 1（门禁三态退出码）。
- **CTO 2026-09-24 口径（即刻生效）**：`executor` = 谁执行该卡的工作 ｜ **`writer` = 谁写这个文件** ｜
  `updated_by` = 最后改动者；**判"双写"只能看 writer/updated_by + 文件实际所在工作树，禁止用 executor 推断**
  （此缺口由 B5 事故暴露：我用 `executor` 误判写者，多一轮往返）。
- memory/ 同族：D382（取号必走分配器）/ D547-D550（漏号撞号实证）/ D576（在途分支·worktree 盲区）/
  D500（Mac 线 D500 起步号，**非缺陷**）。
- 决策参考：第一性原理（"名"是跨系统主键，主键重复 = 数据损坏）
  + Anthropic 基线（fail-closed：不确定即拒绝发放，不得静默发重复号）
  + 开源实证（`git branch -r` 依赖本地 tracking ref，**陈旧即漏号**；`git ls-remote` 直读远端为权威）
  → 结论：**占用表补 `ls-remote` 权威源 + 号确定后跨位置二次校验 + 冲突拒绝点名 + 三元组一致性校验器**。
  参考：Anthropic/DeepSeek/第一性原理 + 结论=ls-remote权威源+跨位置二次校验+拒绝点名+三元组校验器

## Q2: 范围 — 正确的最简方案
做什么：
- `scripts/control-tower/alloc-task-id.sh` — ① 占用表补 `git ls-remote --heads origin`（覆盖**未 fetch** 的远端分支）
  ② 号确定后**跨位置二次校验**（`task-state/` ∪ `origin/main` ∪ 远端分支 ∪ worktree 名/分支名）③ 冲突 → **拒绝并点名冲突位置**（fail-closed）④ 命名前缀参数化（`cto-` / `squad-`）
- `scripts/control-tower/check-name-allocation.sh` — **新建**参数化校验器（三元组一致性单一事实源，三态退出码 0/1/2）
- `tests/control-tower/alloc-task-id.test.sh` — 加判别性夹具（**用 942/943 真实样本** + 合成样本）
- `tests/control-tower/check-name-allocation.test.sh` — **新建**配对测试 + 反向金丝雀 + 三路径
- `docs/synova/coordination/派单模板.md` — 命名前缀规范（`cto-` / `squad-`）落到模板（**热点文件**）
- `.github/workflows/ci.yml` — 新测试入 control-tower-tests 密封清单（**当前 ci.yml 单写者，M9→B3→B4 串行，本卡在前**）
不做什么：
- 不改 `scripts/pre-commit-check.sh`（D937 写集，已交付）
- 不改 `scripts/control-tower/gen-cto-health.py`、`task-state/D92*/D93*.json`（B5-U6 返修写集）
- 不改 `docs/synova/coordination/ownership.yaml`、`scripts/control-tower/check-ownership.py`（卡 3/卡 5 写集）
- 不改 `scripts/audit/**`（K3 红线）
- 不改 `src/**`、`packages/**`（非本卡域）
- 不给 win 域起卡号（Win 侧发号）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/alloc-task-id.sh "<任务名>"`；`bash scripts/control-tower/check-name-allocation.sh --id D942`
处理：汇总占用表（本地 + origin/main + **ls-remote 远端** + worktree）→ 取最大 +1 → **跨位置二次校验** → 冲突则拒绝点名
结果：正常取号 rc=0；**任一位置已占该号 → rc≠0 + 点名冲突位置**；远端不可达 → **显式降级**（不静默）

## 写集

| 文件 | 类别 |
|---|---|
| `scripts/control-tower/alloc-task-id.sh` | task（写者 d940-c1） |
| `scripts/control-tower/check-name-allocation.sh` | task（写者 d940-c1，新建） |
| `tests/control-tower/alloc-task-id.test.sh` | task（写者 d940-c2） |
| `tests/control-tower/check-name-allocation.test.sh` | task（写者 d940-c2，新建） |
| `docs/synova/coordination/派单模板.md` | task（写者 d940-c2） |
| `.github/workflows/ci.yml` | task（写者 d940-c2，仅密封清单） |
| `docs/synova/product-lines/evidence/D940-改动清单.md` | task（证据，写者 d940-c1） |
| `docs/synova/product-lines/evidence/D940-夹具原始输出.md` | task（证据，写者 d940-c2） |
| `docs/synova/product-lines/evidence/D940-自验.md` | task（证据，写者 d940-v，独立自验） |
| `memory/notes/implemented/2026-09-24-d940-cross-location-alloc.md` | task（Note，写者 d940-c1） |
| `.claude/task-briefs/2026-09-24-D940-name-allocation-registry.md` | builtin（本 brief，队长治理产物） |
| `docs/synova/product-lines/evidence/D940-收尾与回执-20260924.md` | task（M6 收尾，写者 lead，治理产物） |
| `memory/notes/proposed/2026-09-25-d940-tstop-attribution.md` | task（决策 Note，铁律49 随卡；#743 返工 TS_TOP 归属，写者 coder-a） |
| `.claude/task-briefs/2026-09-24-D940-name-allocation-registry.md` | task（本 brief 随卡演进：#743 返工补写集 include 两行，写者 coder-a） |

## 架构层: scripts（控制塔工具域，非 L1-L5）

## Done 标准
- [ ] verify: 判据① **拒绝覆盖跨位置** — 对 `D942`（远端分支已占）取号 → **rc≠0 且点名 `docs/d942-cto-fixation`**
- [ ] verify: 判据② 三元组一致性 — `check-name-allocation.sh --id D942` → rc=1 点名；一致输入 → rc=0
- [ ] verify: 判据③ 命名前缀规范落 `派单模板.md` + 判别性夹具（构造撞号 → 必须红）
- [ ] verify: 变异体矩阵逐条「改坏→红」+ 复原→绿
- [ ] verify: 远端不可达 → **显式降级**（`degraded` 可见，非静默）
- [ ] verify: `bash scripts/pre-commit-check.sh` + `check-pr-budget.sh` PASS
