# Task Brief — D1150 资产回收（worktree / task-state / docs）

> 卡片: task-5（T6/批6 · 资产回收）｜线: 治理线（gate-assets）｜日期: 2026-10-05
> 分支: `chore/D1150-asset-reclaim`（PR-1）＋ `chore/D1150-docs-archive`（PR-2，纯改名，见 Q2）
> 【坐标系】执行态=进行中｜施工批次=批6 资产回收｜服务承重件=无（治理资产）｜总闸=#973 无关｜命名空间=D1150｜验证级别=L2（本地判据 + CI 12 必需 context）｜阻塞源=无（沙箱限制见 Q2 排除项）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理线资产面（非产品五层）。治理对象 = **仓库自身的存量**：worktree（实测 78→82 个）、
`task-state/`（429 件）、`docs/synova/coordination/`（233 件）。本任务不新增业务能力，
只做「回收 + 归档 + 索引」——目的是让存量可枚举、可判据化，把手工 `rm -rf` 换成
「先取证再动手」的命令。

### b) 文件审计（改前 grep 实测）
- `scripts/control-tower/worktree-manager.py`（D307）：session/<sid> 的 create/finish，**不覆盖**历史分支存量回收。
- `scripts/control-tower/classify-worktrees.py`（D1071）：**只读**三分类，文件头明写红线「绝不删除/移动任何工作树或分支」⇒ 本卡不动它。
- `scripts/control-tower/check-orphan-worktrees.sh`：只查「注册表有、目录没了」的孤儿 ⇒ 与存量回收正交。
- `task-state/README.md`：定义状态机（audited=终态），**无归档规则**、无索引 ⇒ 本卡补。
- `scripts/control-tower/check-pr-budget.sh:409`：出库白名单含 `docs/synova/coordination/`、`:449` 豁免要求纯改名 ⇒ docs 归档必须单独成 PR。

### c) 决策
已有覆盖 → 复用（fail-closed 三态退出码 / UTF-8 强制 / git 解析链 均沿用控制塔既有约定）；
无覆盖 → 新建 `reclaim-worktrees.py`（回收面）与 `task-state-retention.py`（保留策略 + 索引）；
冲突 → 不碰 `classify-worktrees.py`（只读红线）、不碰 `scripts/audit/**`、不碰 `ci.yml`。

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **git 自身的安全语义优先**：`git worktree remove` 不带 `--force` 时 git 会拒绝脏工作树；
  本工具把「无未推送提交 ∧ 无脏文件」再加一层前置判据 ⇒ 两道闸，且第二道是 git 的（不可绕过）。
- **Anthropic 基线（决策点 4 fail-closed）**：任何 git 失败显式报错，绝不静默假装成功；
  目录删不掉（权限）→ `degraded:` 留痕 + 打印清理命令，**不吞**。
- **memory/ 教训**：判例「删除类动作误删 = 事故」；D312 `git stash` 事故 ⇒ 一切隔离/暂存走显式路径；
  沙箱事实：DSH 会话写权限 = 仅本工作树（实测 `mkdir /Users/wane/...` = Operation not permitted）。
- **参考**：Anthropic「逐步验证，不信任声称完成」+ 第一性原理（先取证后动手）⇒ 默认 dry-run，
  写入路径必须显式 `--apply`。

## Q2: 范围 — 正确的最简方案

做什么：
1. 新增 `scripts/control-tower/reclaim-worktrees.py` + 夹具 `tests/control-tower/reclaim-worktrees.test.sh`：
   逐 worktree 取证（ahead/dirty/branch/head）并分类，`--apply` 只回收 RECLAIM 且只用 `git worktree remove`。
2. 新增 `scripts/control-tower/task-state-retention.py` + 夹具 `tests/control-tower/task-state-retention.test.sh`：
   保留策略（终态 ∧ >30 天 → 归档，Lead 2026-10-05 裁决的 union 规则）+ `INDEX.md` 生成（覆盖自检）。
3. 产出 `task-state/INDEX.md`（429 件全覆盖）并按规则 `git mv` 归档 86 件（可一条命令回滚）。
4. PR-2：`docs/synova/coordination/` 2026-09 之前的派单/交付/裁决件 → `archive/`（纯改名）。
   - 候选判据（可复跑）: 文件名带 8 位日期 ∧ 日期 < 202609 ⇒ 71 件；
   - 减去「被 live 文件引用」（`scripts/**`、`docs/authority/**`、`.codex/**`、`docs/synova/presets/**`、coordination 顶层非候选件）4 件 ⇒ **67 件移动**，4 件保留并列例外。

不做什么（含文件路径）：
- 不改 `ci.yml`、`scripts/pre-commit-check.sh`、`scripts/hooks/**`、`scripts/audit/**`；
- 不改 `scripts/control-tower/classify-worktrees.py`（D1071 只读红线）；
- 不动 `.claude/task-briefs/`；
- **不删任何被跟踪源码/文档**（只做 git mv / 索引 / 分类）；
- 不回收任何「有未推送提交 ∨ 有脏文件 ∨ 在保护名单」的 worktree；
- wave-2（dirty 仅=hook 产物）**不做**：Lead 2026-10-05 裁决「等 #1075 合并后重扫，不放宽判据」；
- 沙箱外（`/Users/wane/synova-wt-*`）目录删除**不做**（环境事实：Operation not permitted），
  已完成 git 侧注销 3 个（D507/D520/D525），目录残留由 Lead 处理。

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：
- `python3 scripts/control-tower/reclaim-worktrees.py [--apply] [--protect <名>]`
- `python3 scripts/control-tower/task-state-retention.py expire|index [--apply]`
- 夹具：`bash tests/control-tower/reclaim-worktrees.test.sh` / `bash tests/control-tower/task-state-retention.test.sh`

处理（中间步骤）：逐件 git 取证（ahead/dirty/最后提交日期）→ 分类/判定 → dry-run 打印 →
`--apply` 逐条打印绝对路径后动作（git worktree remove / git mv）→ 覆盖自检。

结果（最终展示）：分类汇总行 + 逐条证据 + `task-state/INDEX.md`（429 行覆盖）+
`docs/synova/coordination/archive/**`（67 件）+ PR 正文判据原始输出。

## 架构层
治理面（非五层架构）：`scripts/control-tower/**` + `task-state/**` + `docs/synova/coordination/**`。

## Done 标准
- [ ] 夹具全绿 1: `bash tests/control-tower/reclaim-worktrees.test.sh` → rc=0（PASS=17, FAIL=0）
- [ ] 夹具全绿 2: `bash tests/control-tower/task-state-retention.test.sh` → rc=0（PASS=20, FAIL=0）
- [ ] 号分配无冲突: `bash scripts/control-tower/check-name-allocation.sh --id D1999`（对照号）→ rc=0；
      D1150 自身冲突位置唯一 = 本分支（在飞卡自占，属预期）
- [ ] 登记门禁: `bash scripts/doc-system/doc-registry-gate.sh` → rc=0
- [ ] 台账棘轮: `bash scripts/control-tower/check-gate-integrity.sh` → `GATE-INTEGRITY: OK`
      （当前 VIOLATION(2) = 2 条新 sealed 测试待 T3 登记 ci.yml，见偏差声明 5）
- [ ] 合并级: `gh pr checks <PR>` 12 必需 context 全绿且 pending=0（交 Lead 复核后合并）

#CRITERIA: A

## Q4: 契约与测试（铁律 47/48，写代码前定义）
- `reclaim-worktrees.py`：@input/`@output`/`@exit 0|1|2`/`@degraded` 见文件头契约块；
  夹具覆盖 正常（4 分类）/ 副作用（dry-run 零删除、--apply 只动 RECLAIM）/ 降级（非仓库 rc=2）/ 边界（未知参数 rc=2）/ 接线（grep 引用）。
- `task-state-retention.py`：同上；夹具覆盖 正常（终态超期归档）/ 降级（未跟踪件 os.replace + `degraded:` 留痕）/
  冲突（归档目标已存在 ⇒ rc=1 且整批不动）/ 索引（覆盖自检 6=6）/ 边界（负天数 rc=2）/ 字面 90 天口径留证（ARCHIVE=0）。

## 偏差声明（Lead 已知并裁决）
1. **保留规则**：卡片原写「保留近 90 天」。逐件实测 429 件最后提交全在 2026-08-22~10-04 ⇒ 90 天窗口内 **0 件**，
   字面规则恒为空操作（P-01 型配方错误）。Lead 2026-10-05 裁决改用 union 规则（终态 ∧ >30 天 ⇒ 86 件），
   本 PR 按裁决执行，并在 PR 正文标注。
2. **工具名**：卡片写 `classify-worktrees.py（如需）`，该名已被 D1071 只读工具占用（含删除红线）⇒ 新建
   `reclaim-worktrees.py`，不动既有只读工具。
3. **拆 2 PR**：`check-pr-budget.sh` 机器强制（出库豁免要求 AM_N=0）⇒ PR-2 必须纯改名，Lead 已同意。
4. **worktree 回收量**：判据①（75→≤20）在**本会话内不可达**（沙箱 + 双空铁律下仅 3 个可回收，
   且其中 0 个在工作树可写区）。已完成 3 个 git 侧注销，其余逐条列例外清单（PR 正文）。
5. **ci.yml 登记待 T3**：`check-gate-integrity.sh` 的 CI-REGISTRY 面要求 `tests/**/*.test.sh` 必须
   在 `ci.yml` 密封清单内（否则「基线外新增」= 违规），而棘轮基线只减不增 ⇒ 不能靠加基线绕过。
   本卡红线「不改 ci.yml」（ci.yml 唯一所有者 = T3/gate-single-set）⇒ 交付**精确补丁**给 Lead/T3 落：
   在 `.github/workflows/ci.yml` 第 531 行 `tests/control-tower/classify-worktrees.test.sh \` 之后插入两行
   （`tests/control-tower/reclaim-worktrees.test.sh \` 与 `tests/control-tower/task-state-retention.test.sh \`）。
   在该补丁落地前，本 PR 的 `check-gate-integrity` 面保持 VIOLATION(2)——**这是已知且已上报的状态**，不是隐藏红。

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-05-D1150-asset-reclaim.md | task |
| docs/authority/DOCS-REGISTRY.yaml | task |
| memory/notes/proposed/2026-10-05-d1150-asset-reclaim.md | task |
| scripts/control-tower/reclaim-worktrees.py | task |
| scripts/control-tower/task-state-retention.py | task |
| task-state/INDEX.md | task |
| task-state/archive/D356.json | task |
| task-state/archive/D379.json | task |
| task-state/archive/D383.json | task |
| task-state/archive/D384.json | task |
| task-state/archive/D385.json | task |
| task-state/archive/D386.json | task |
| task-state/archive/D387.json | task |
| task-state/archive/D389.json | task |
| task-state/archive/D390.json | task |
| task-state/archive/D391.json | task |
| task-state/archive/D392.json | task |
| task-state/archive/D393.json | task |
| task-state/archive/D394.json | task |
| task-state/archive/D395.json | task |
| task-state/archive/D396.json | task |
| task-state/archive/D399.json | task |
| task-state/archive/D400.json | task |
| task-state/archive/D401.json | task |
| task-state/archive/D402.json | task |
| task-state/archive/D403.json | task |
| task-state/archive/D404.json | task |
| task-state/archive/D405.json | task |
| task-state/archive/D406.json | task |
| task-state/archive/D407.json | task |
| task-state/archive/D408.json | task |
| task-state/archive/D409.json | task |
| task-state/archive/D410.json | task |
| task-state/archive/D412.json | task |
| task-state/archive/D413.json | task |
| task-state/archive/D414.json | task |
| task-state/archive/D415.json | task |
| task-state/archive/D416.json | task |
| task-state/archive/D417.json | task |
| task-state/archive/D419.json | task |
| task-state/archive/D428.json | task |
| task-state/archive/D429.json | task |
| task-state/archive/D430.json | task |
| task-state/archive/D439.json | task |
| task-state/archive/D440.json | task |
| task-state/archive/D441.json | task |
| task-state/archive/D442.json | task |
| task-state/archive/D443.json | task |
| task-state/archive/D444.json | task |
| task-state/archive/D445.json | task |
| task-state/archive/D446.json | task |
| task-state/archive/D447.json | task |
| task-state/archive/D448.json | task |
| task-state/archive/D449.json | task |
| task-state/archive/D450.json | task |
| task-state/archive/D451.json | task |
| task-state/archive/D452.json | task |
| task-state/archive/D453.json | task |
| task-state/archive/D454.json | task |
| task-state/archive/D455.json | task |
| task-state/archive/D456.json | task |
| task-state/archive/D457.json | task |
| task-state/archive/D458.json | task |
| task-state/archive/D459.json | task |
| task-state/archive/D460.json | task |
| task-state/archive/D461.json | task |
| task-state/archive/D462.json | task |
| task-state/archive/D463.json | task |
| task-state/archive/D464.json | task |
| task-state/archive/D465.json | task |
| task-state/archive/D466.json | task |
| task-state/archive/D467.json | task |
| task-state/archive/D468.json | task |
| task-state/archive/D472.json | task |
| task-state/archive/D473.json | task |
| task-state/archive/D474.json | task |
| task-state/archive/D483.json | task |
| task-state/archive/D484.json | task |
| task-state/archive/D486.json | task |
| task-state/archive/D487.json | task |
| task-state/archive/D500.json | task |
| task-state/archive/D510.json | task |
| task-state/archive/D514.json | task |
| task-state/archive/D517.json | task |
| task-state/archive/D518.json | task |
| task-state/archive/D519.json | task |
| task-state/archive/D522.json | task |
| task-state/archive/D523.json | task |
| task-state/archive/D527.json | task |
| task-state/archive/D528.json | task |
| task-state/archive/D539.json | task |
| task-state/archive/D551.json | task |
| tests/control-tower/reclaim-worktrees.test.sh | task |
| tests/control-tower/task-state-retention.test.sh | task |
