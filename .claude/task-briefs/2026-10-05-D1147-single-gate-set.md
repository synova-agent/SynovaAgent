# Task Brief: D1147 单套门禁（批2）—— CI 收敛：windows 腿降级顾问 + 必需 context 12→9→10

> 生成: 2026-10-05 | 任务: D1147 | 认领: 治理线（`gate-single-set`，worktree `.synova-wt-single-set`）
> 上游: task-2（T3/批2）｜lead 裁决回执 2026-10-05（三步全回：定案接受 + 步骤1 PATCH 已执行 + 夹具更新批准）
> 参考: D333 决策四步（第一性原理 → Anthropic 基线 → 开源实证 → 收敛检查）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务位于**治理层（控制塔门禁 / CI 结构）**，非产品五层。
病根（批2 主题"单套门禁"）：Mac/Win 都用 DSH ⇒ 门禁只该维护一套；而 windows 腿此前是
**main 分支保护的必需 context**，实测中位数 106min（vs ubuntu 14min，见 ci.yml T3 基线注释）
⇒ 平台抖动即卡死整条 PR 队列，与其承载的信息量（平台差异信号）不成比例。
现状取数（`origin/main=1630a5014`）：
- 必需集 12 条（`gh api …/protection`，2026-10-01T18:41:11Z）；`strict=false` / `enforce_admins=true` / reviews=0；
- `Gate Integrity (pattern sentinel + injection fixture + ci-reds)` job 存在（`ci.yml` gate-integrity）
  但**不在必需集**（0 命中）——一个真会红的三态门禁，白白非必需；
- `npm audit` 在必需集但 `continue-on-error: true` + 脚本内 `|| echo 豁免`（**双层豁免 = 恒绿 = 纸老虎**）；
- 两条 windows 腿与 ubuntu 腿同 job 同矩阵（`os: [ubuntu-latest, windows-latest]`）。

### b) 文件审计
- `.github/workflows/ci.yml`（1130 行）—— 存在 → 改：两个必需 job 矩阵收敛单元素 + 新增 `windows-leg-trigger`
  + 两个 `*-windows-advisory` 顾问 job（绝不产 failure 结论）+ 相应注释/证据指针校正。
- `scripts/control-tower/required-checks-baseline.txt`（53 行）—— 存在 → **按文件头生成命令重放**
  （12 条 → 9 条，禁手抄）。
- `tests/control-tower/ci-signal-classify.test.sh` —— 存在 → 改（:241/:243 两处钉子期望值 + :279-293 登记 2 个顾问 job）。
- `tests/control-tower/check-required-contexts.test.sh` —— 存在 → 改（:88 `12/12` 与 ⑥/⑤ 的 `npm audit` 金丝雀改为派生）。
- `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` —— 存在 → 改（⑥ 计数口径限定到 docs-only step 体内）。
- `docs/authority/DOCS-REGISTRY.yaml` —— 存在 → 改（追加 `DOC-0143` 登记本卡送审件；**机器强制**：D2 登记门禁
  在 `SYNO_CI=1` 下转硬阻断，首轮 CI run 即被它判红 —— 见 PR 正文 §八）。
- 新建：`docs/synova/coordination/D1147-单套门禁-必需context变更提案.md`（提案 + 判据原始输出 + 例外清单）。
- 新建：`memory/notes/proposed/2026-10-05-d1147-single-gate-set.md`（铁律 49 决策 Note）。

### c) 决策
**已有覆盖 → 复用**：不必新造路径判据（沿用项目既有 fail-safe 风格：`origin/main` 不可解析 ⇒ run=true，
绝不误跳）；不必新造看板通道（沿用 M9 task-11 的公开注解面 `check-runs/{id}/annotations`）。
**无覆盖 → 新建**：windows 腿的"路径触发 + 非必需 + 恒 success"三约束结构。
**冲突 → 上报不自裁**：必需 context 增删（branch protection）归 lead（本线只出命令）；
C 段棘轮排除非必需 context（判据变更）须 K3，已请 lead 另立卡。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **第一性原理**：门禁的目标不是"更严"，是**"真拦得住 + 不拦不该拦的"**。两条推论：
  ① 必需 context 必须**满足 success**。两种失败机制都要认清（独立复核席 2026-10-05 实测订正）：
     · job 级 `if:` 为 false ⇒ check-run **仍存在**、`conclusion=skipped`（≠ 不存在）；`skipped` ≠ success ⇒ 合并条件不满足；
     · run 根本没建（`GITHUB_TOKEN` 推送 / workflow 级 paths 过滤）⇒ check-run 恒 0 ⇒ `N of N expected`（D971 的真机制）。
  ② 一个**不可能变红**的必需 context 不是门禁（`npm audit` 双层豁免即此形），把它留在必需集是把
  "必需"二字贬值。⇒ windows 腿的去向只能是"离开必需集"，而不是"留在必需集但恒绿"。
- **Anthropic 基线**：改门禁结构**必须配判别性夹具**（改坏即红 + 复原后一致）；读不到判据源 ⇒ fail-closed 且不静默
  （铁律 11/24）；三层退出码 0/1/2，禁 `|| true` 吞崩溃（`ctrl-tower-change` 模式 1）。
- **开源实证（GitHub Actions 官方语义；本仓实测订正）**：job 级 `if:` 为 false ⇒ job `completed/skipped`，其 check-run 仍存在且 `conclusion=skipped`（实测锚点 main tip `1630a5014` 恰 1 条 skipped，指向 run `37183822437` job `111381534143`）；
  `needs:` 下游默认被 `success()` 隐式跳过 ⇒ 必须写显式 `if:`（D1112 的教训，本卡沿用 `!= 'false'` 的 fail-safe 写法）；
  step 级 `continue-on-error: true` ⇒ step `outcome=failure` 但 **job 结论 = success**（本卡 ③ 约束的实现依据）。
- **memory 历史教训**：D971（必需 context 消失 ⇒ 405 "N of N required status checks are expected"）；
  D1112（`needs:` 上游红 ⇒ 下游必需 context 消失）；D954（用未定态集合证明"无红" = 空转）；
  D1093/D526（密封清单必须在 ci.yml 全文内，抽走即"失登记"）；V4.5.1（本地门禁太挡 ⇒ `--no-verify` 泛滥
  ⇒ 本地软提示 + CI 权威）；V3.9（软机制 0% 有效）。
- 参考系：`ctrl-tower-change`（门禁变更模式库）+ `squad-discipline`（声称↔证据、写集不重叠）
  + 第一性原理 + GitHub Actions 语义 ⇒ **结论：windows 腿降级为"路径触发 + 非必需 + 恒 success + 注解上看板"，
  并把 Gate Integrity 提为必需（两条 windows context 必须同步移出必需集）**。

## Q2: 范围

做什么：
- `.github/workflows/ci.yml`：`test-kit-architecture` / `control-tower-tests` 矩阵收敛为 `os: [ubuntu-latest]`
  （**job `name:` 字段逐字不动**）；新增 `windows-leg-trigger`（路径判据，只产结论）+ 顾问 job
  `test-kit-windows-advisory` / `control-tower-windows-advisory`（`needs` + job 级 `if:` + 恒 success）。
- `scripts/control-tower/required-checks-baseline.txt`：按文件头生成命令重放（12 → 9，镜像 live）。
- `tests/control-tower/ci-signal-classify.test.sh`：2 处钉子期望值 + 登记 2 个顾问 job（lead 已批）。
- `tests/control-tower/check-required-contexts.test.sh`：写死 `12/12`、`npm audit` 金丝雀改为派生。
- `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh`：⑥ 计数口径限定到 docs-only step 体内。
- `docs/authority/DOCS-REGISTRY.yaml`：追加 `DOC-0143` 登记送审件（D2 登记门禁 strict 红因）。
- `docs/synova/coordination/D1147-单套门禁-必需context变更提案.md`（提案件）。
- `.claude/task-briefs/2026-10-05-D1147-single-gate-set.md`、`memory/notes/proposed/2026-10-05-d1147-single-gate-set.md`。

不做什么（含文件路径）：
- 不改 `package.json` / `tsconfig.json` / `vitest.config.ts`（构建与测试配置与本卡无关）；更不改任何 job 的
  `name:` 字段（12 必需 context 名的唯一产出者）——尤其 `ci.yml` 里
  `name: Control Tower Gate Tests (${{ matrix.os }})` 与 `name: Test-Kit Architecture Tests (${{ matrix.os }})`。
- 不碰 branch protection（红线）：`gh api -X PATCH …/protection/...` 由 lead 执行，本卡只给命令与回滚。
- 不改 `scripts/pre-commit-check.sh`（归 task-3/T4）；不改 `.claude/settings.json`、`.codex/hooks.json`、
  `scripts/hooks/**`、`scripts/workflow/**`（归 task-1/T1）。
- 不碰 `scripts/audit/**`（K3 域）；不改 `scripts/control-tower/check-gate-integrity.sh` 与
  `scripts/control-tower/ci-red-baseline.txt`（C 段/红基线属判据面，须 K3；本卡只登记指针）。
- 不改 `scripts/control-tower/check-required-contexts.py`（判据器本体不动）。
- 不自行合并、不开 auto-merge、不 `--no-verify`。
- 不做：C 段棘轮排除非必需 context（判据变更，另卡）；顾问腿清单抽公共脚本（会让 ~58 个测试失登记，另卡）。

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：PR 事件（`pull_request` / `merge_group` / 每周 `schedule` / `workflow_dispatch`）
落入 `.github/workflows/ci.yml`；必需集由 main 分支保护提供（lead PATCH）。

处理（中间步骤）：
① `windows-leg-trigger` 判 `scripts/**|tests/**` 是否变更（fail-safe：origin/main 不可解析 ⇒ run=true）；
② 命中才创建两条顾问腿（windows runner），重活 step `continue-on-error: true`；
③ 收尾 step 读 `steps.*.outcome` → `::notice`（通过）/`::warning`（未过，**不拦合并**）+ 逐条 `::error` 注解；
④ `control-tower-tests`(ubuntu) 照旧恒被调度、按 D1039 判据跑重活 → 唯一承载必需 context 的腿；
⑤ 必需集由 lead PATCH 到 9（已落地）→ 10（步骤 2 待 #948）；
⑥ baseline 表按生成命令重放 + 双模式复核。

结果（最终展示）：
- PR 检查列表：非 scripts PR 上两条 windows 腿 = **`conclusion=skipped`**（不占 runner；且**不在必需集** ⇒ 不构成合并条件）；必需 context 9（步骤 2 后 10）全绿且 pending=0；
- 顾问腿失败可在**公开注解面**（`GET /check-runs/{id}/annotations`）与 job log 检索，且不改任何阻断判定；
- `python3 scripts/control-tower/check-required-contexts.py --api-check` → `live 9 条与基线逐字一致（双向零差集）`。

## 架构层: scripts（控制塔/治理层，非产品五层）

## Done 标准:
- [ ] verify: `python3 scripts/control-tower/check-required-contexts.py` → `REQUIRED-CONTEXTS: OK` 且 `9/9 命中`（可核：命令输出）
- [ ] verify: `python3 scripts/control-tower/check-required-contexts.py --api-check` → `live 9 条与基线逐字一致（双向零差集）`（可核）
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh` → 末行 `GATE-INTEGRITY: OK`（rc=0）（可核）
- [ ] verify: `bash tests/control-tower/ci-signal-classify.test.sh` → `结果: 79 通过, 0 失败`（可核）
- [ ] verify: `bash tests/control-tower/check-required-contexts.test.sh` → `结果: 47 通过, 0 失败`（可核）
- [ ] verify: `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` → `RESULT: 20 PASS / 0 FAIL`（可核）
- [ ] verify: 改坏即红（4 注入 + 2 桩）逐条复原后各夹具回 rc=0（可核：见提案件 §6 表与 PR 正文原始输出）
- [ ] verify: `gh pr checks <本PR>` 必需 context 全绿且 pending=0（顾问 windows 腿非必需，单独报告）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-10-05-D1147-single-gate-set.md | task |
| .github/workflows/ci.yml | task |
| docs/authority/DOCS-REGISTRY.yaml | task |
| docs/synova/coordination/D1147-单套门禁-必需context变更提案.md | task |
| docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh | task |
| memory/notes/proposed/2026-10-05-d1147-single-gate-set.md | task |
| scripts/control-tower/required-checks-baseline.txt | task |
| tests/control-tower/check-required-contexts.test.sh | task |
| tests/control-tower/ci-signal-classify.test.sh | task |

