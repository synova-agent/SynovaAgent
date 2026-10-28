# Task Brief — #1125 `check-dev-doc-write-set.sh` 补删除项语义（D 进变更集）

#CRITERIA: D

> 任务唯一编号 = Issue 号。#1125 ｜ 分支 `fix/1125-dev-doc-writeset` ｜ base `gitea/main` = 94ed76b2d
> 声明载体 = `.claude/claims/1125.yaml`（writeset ＋ done 两字段制）；本件是 Q1–Q3 的可读说明（同批提交）。
> 架构层: 不属五层业务（治理脚本）

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **缺陷实测（本支 base 94ed76b2d）**：写集门禁取变更集用 `--diff-filter=ACMR`（不含 D），且正向判据
  走 `--name-only` ⇒ ① 纯删除（`rm`+add）的路径整行不出现；② `git mv` 在重命名检测下 `--name-only`
  **只报新路径**，旧路径（＝被删那一侧）完全不可见 ⇒ 声明「删除」永远对不上，被判「文件不存在」/「零实际变更」假红 exit 1。
- **业界/仓内基线**：门禁判据必须**带状态**（`--name-status`）才能区分「删除」与「修改/新建」；
  重命名要拆成 `D(旧) + A(新)`（`--no-renames`）才能让两侧都可被写集声明命中。
- **历史教训**：V4.5.1「`grep -c` 无匹配输出 0 且 exit 1」同族（此处是「取不到变更集」被静默当「无变更」）；
  三态纪律（0 通过／1 真红／**2 判不了**，禁把 2 当 0）——git 不可用必须 exit 2。
  铁律 48 三路径（正常/降级/边界）＋ 改坏即红（判别力）。

## Q2: 范围

做什么：

- scripts/workflow/check-dev-doc-write-set.sh
- tests/control-tower/check-dev-doc-write-set.test.sh
- gate-exemptions/2026-10-29-1125-dev-doc-writeset.md
- docs/authority/DOCS-REGISTRY.yaml

不做什么（含文件路径）：

- 不修改 scripts/control-tower/devdoc_writeset.py（机器单源解析器；本卡不引入「操作列」解析，避免第二套表格口径）
- 不修改 scripts/pre-commit-check.sh（本卡不增删门禁组）
- 不修改 scripts/audit/**（K3 审计专属，红线）
- 不修改 .gitea/protected-files.txt（不动受保护清单本体与 pin）
- 不合并任何 PR、不触碰 #1123 / #1126 写集

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：`bash scripts/workflow/check-dev-doc-write-set.sh <dev doc>`（pre-commit 里由既有调用点触发）。
- **交互**：取**带状态**的变更集（`git diff --name-status --diff-filter=ACMRD --no-renames`，staged ∪
  worktree-vs-HEAD）→ 逐条核验：声明「删除」的路径以 D 出现即成立（免存在性检查）；声明「修改/新建」
  仍须 A/C/M/R；既不命中变更集、也不满足存在性 ⇒ 漂移；git 不可用 ⇒ exit 2。
- **结果**：夹具A（声明删除＋`git mv`）exit 0；它的「去掉 D」改坏版 exit 1；夹具B（声明修改＋零变更）
  仍 exit 1；非 git 目录 / `GIT_DIR` 损坏 ⇒ exit 2。

## 架构层: 不属五层业务（治理脚本）

## Done 标准

- [x] 变更集三处补 D ＋ 带状态判据 verify: bash tests/control-tower/check-dev-doc-write-set.test.sh
- [x] 夹具A exit 0、改坏版 exit 1（承重） verify: bash tests/control-tower/check-dev-doc-write-set.test.sh
- [x] 夹具B 声明修改＋零变更仍 exit 1（判别力） verify: bash tests/control-tower/check-dev-doc-write-set.test.sh
- [x] git 不可用 ⇒ exit 2（三态） verify: bash tests/control-tower/check-dev-doc-write-set.test.sh
- [x] 受保护路径豁免合规（含自覆盖行） verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root .
