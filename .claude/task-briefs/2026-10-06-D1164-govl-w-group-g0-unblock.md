# Task Brief: D1164 govl-w-group-g0-unblock

> 生成: 2026-10-06 | 任务: D1164 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=进行中 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=无阻塞
> 派单源: CTO 2026-10-06《开发计划 v2 · 全缺口补完》A 槽 W 组 · **W1** + G0 解锁前置

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
本任务**不在产品五层内**（L1-L5 无关），在**治理/门禁层**（`scripts/control-tower/**` + `.github/` + 依赖根文件）。
它做的是**解冻**：当前 main 的两处破损使**一切非 docs-only PR 物理不可合**，W 组其余 11 项、B/C/D/P 各组全部排在其后。
- 破损 ①（依赖面）：`package.json` 的 `vitest@5.0.2` 与 `@vitest/coverage-v8@4.1.8` peer 互斥（双方 peer 均 exact）
  ⇒ 任何 merge ref 带 main 的 PR，`npm ci` 走 `ERESOLVE` 必红 ⇒ 7 个必需 job 连带红。
- 破损 ②（门禁面）：必需 context `Control Tower Gate Tests (ubuntu-latest)` 因两条**存量**失败恒红
  ⇒ 任何触及 `scripts/**`、`tests/**`、`.github/workflows/**`、根 `package.json` 的 PR 永久 blocked。

### b) 文件审计
- `git show origin/main:package.json:84` → `"@vitest/coverage-v8": "4.1.8"`；`:91` → `"vitest": "5.0.2"`（互斥对）
- `package-lock.json` L2334-2337 → `@vitest/coverage-v8` 4.1.8，`peer vitest@4.1.8`（锁文件已登记互斥）
- `tests/control-tower/post-commit.test.sh:336` → 旧 prefilter 取 `origin/main:` 当"旧实现"来源；`:340` → `grep -q` **扫全文（含注释）**
- `git show origin/main:scripts/hooks/post-commit.sh:42` → **注释行**里逐字出现旧模式串 `grep -q "$h" $srcs` ⇒ 触发上述 prefilter 误判
- `git log -S'D1157-REC-RE' origin/main -- scripts/hooks/post-commit.sh` → `9e29d88e0`（把锚定判据并进 main 的那个提交；其父 `f5cc7fe7a` 才是最后的无锚实现）
- `scripts/control-tower/check-dsh-anchor.py:114` → 未登记版本串判违规；`:89` → 白名单来源 `known_versions`
- `docs/synova/coordination/DSH-断面.json:24` → 原文「**历史版本一律入本表，不用豁免段**」；`:26-40` → `known_versions` 13 条
- 违例两行：`docs/synova/coordination/提案/RbacContext-org-team-维度.md:405-406`（三棵 DSH 树台账表的目录名/版本列）

### c) 决策
- 依赖面：**复用 CTO 已核候选 (B)**（coverage-v8 → 5.0.2，与 vitest 同版；2 文件，不触 D734 的 12 文件上限）。取 **PR #1159 的 diff 逐字**（`git apply --check` 通过），不自行另生成 lock。
- 门禁面 F2：**修夹具前提判据**（只看代码行 + 红例基线改钉"引入锚定判据那个提交的父提交"）——**保判别力**，非"改夹具迁就实现"。
- 门禁面 DSH：**按本表既有口径登记**（`known_versions` 补两条），不用豁免段（该表 note 明文）。
- 不新建任何机制：三处都是**修复既有件**，无新门禁、无新判据。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 0-2（接线验收）/ 铁律 47+48（契约+测试非空壳）/ 铁律 11（静默降级禁止）。
- 判例 **P-01**「派单方的配方同样要执行方核」⇒ 本件核出 W1 判据 `npm ci --dry-run ⇒ exit 0` **结构性不可满足**（见 Q3 例外①）。
- 判例 **P-03**（断言不变性「这条断言在什么情况下必然失败」）⇒ 同上，`--dry-run` 下 npm 仍跑根 `postinstall`，而 dry-run 不装 `node_modules` ⇒ `patch-package: command not found` ⇒ 127。**与本次修复无关**，健康 main 同样 127。
- 判例 **V-08**（改坏即红）/ **V-05**（CI 快照必须终态）/ **M-02**（三态退出码）/ **M-03**（棘轮只减不增）。
- 判例 **S-01**（用 `git show origin/main:` 而非工作树）；本件所有现状断言均按此取数。
- 决策参考：**第一性原理**（先让"能不能合"成立，才谈"合什么"）+ **Anthropic 工程基线**（修复而非新增机制；夹具必须保判别力）⇒ 结论 = 三处最小修复合成一笔，先解冻。

## Q2: 范围 — 正确的最简方案
做什么：
- package.json — `@vitest/coverage-v8` 4.1.8 → 5.0.2（与 vitest 同版，消 peer 互斥）
- package-lock.json — 随 lock 重生成（coverage-v8 5.0.2 + 其传递依赖）
- tests/control-tower/post-commit.test.sh — F2 红例基线改钉「引入 D1157-REC-RE 提交的父提交」+ prefilter 只看非注释行
- docs/synova/coordination/DSH-断面.json — `known_versions` 补登 `0.1.2-install`、`0.2.0-rc.2`（出处见 note）
- .claude/task-briefs/2026-10-06-D1164-govl-w-group-g0-unblock.md — 本件
- memory/notes/proposed/2026-10-06-d1164-g0-unblock.md — 决策沉淀（铁律 49）
- task-state/D1164.json — 认领登记
不做什么：
- 不改 .github/workflows/ci.yml（W2/W3/W5/W9 属**门禁语义变更** ⇒ 走 提案→K3→CTO 裁，另笔 D1165）
- 不改 scripts/pre-commit-check.sh（W6/W11 同属门禁语义变更，另笔 D1165）
- 不改 scripts/audit/**（K3 红线）
- 不改 scripts/control-tower/check-dsh-anchor.py（本次违例是"事实未登记"，不是检查器判据错——不动判据）
- 不改 docs/synova/coordination/提案/RbacContext-org-team-维度.md（内容面归 K1；本次只动登记表）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`git fetch && git checkout feat/govl-w-group`（或 CI 对 main 的 push run）
处理：① 依赖解析 ② hermetic 密封测试 ③ DSH 断面自扫
结果（三条可复跑）：
- ① `cd /tmp/w1 && npm ci --dry-run --ignore-scripts` ⇒ exit 0
- ② `bash tests/control-tower/post-commit.test.sh` ⇒ `结果: 33 通过, 0 失败`
- ③ `python3 scripts/control-tower/check-dsh-anchor.py --repo . --no-tree-check` ⇒ `DSH-ANCHOR: OK`
例外（判据更正，依 P-01/P-03 上报）：
- ① CTO 原文判据 `npm ci --dry-run`（无 `--ignore-scripts`）⇒ exit **127**，**结构性**不可满足：
  `--dry-run` 不落 `node_modules` 而 npm 仍执行根 `postinstall`（`patch-package`）⇒ `command not found`。
  健康 main 同此。本件以 `--ignore-scripts` 变体作依赖解析判据，并附**真跑 `npm ci`** 作端到端判据。

## 架构层:
scripts（控制塔/门禁治理线）+ 依赖根文件（非产品五层）

## Done 标准
- [ ] verify: `bash tests/control-tower/post-commit.test.sh` ⇒ 末行 `结果: 33 通过, 0 失败` 且 exit 0
- [ ] verify: `python3 scripts/control-tower/check-dsh-anchor.py --repo . --no-tree-check` ⇒ 含 `DSH-ANCHOR: OK`
- [ ] verify: `bash tests/control-tower/check-dsh-anchor.test.sh` ⇒ `结果: 12 通过, 0 失败`（修后夹具判别力未损）
- [ ] verify: `grep -c '"@vitest/coverage-v8": "5.0.2"' package.json` ⇒ 1
- [ ] verify: `grep -c '0.2.0-rc.2' docs/synova/coordination/DSH-断面.json` ⇒ 1（登记已落）
