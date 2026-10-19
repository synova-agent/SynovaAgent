# Task Brief: P4 · #598 — 闸 3 在 Gitea CI 空跑（补 base ＋ fail-loud）

## Q0: 定位（项目拼图 + 文件审计）
- 闸 3（DOC-CONTRACT 入库闸）在 Gitea CI 空跑：`pre-commit-check.sh:435` 仅 `GITHUB_ACTIONS=true && SYNO_DIFF_BASE` 时用 `--base`，而 `local-gates` 的 ① 步从不注入 `SYNO_DIFF_BASE` ⇒ `--staged`（空暂存）⇒ 核 0 件 ⇒ PASS。
- 相关件：`scripts/control-tower/check-doc-contract.sh`、`scripts/control-tower/validate_doc_contract.py`、`docs/synova/DOC-CONTRACT.md` §3。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）
- git pre-commit/CI 空暂存是已知形态；本仓既有 `SYNO_DIFF_BASE` 注入缝（D390 守卫）与 `GIT_CACHED_*` diff 路径（#614 的 ①d 刷新经验）。
- 规格 `docs/plans/codex/implementation/SYNOVA-IMPL-598-doc-contract-ci-20261019.md`（352 行，sha 3f1e2f2d…）。

## Q2: 范围（做什么 / 不做什么——含文件路径）
- 做：`.gitea/workflows/local-gates.yml`（① 注入 base；①d 改用 helper）｜`scripts/control-tower/resolve-ci-base.sh`（新建）｜`scripts/pre-commit-check.sh`（CI 无 base fail-loud）｜`tests/control-tower/resolve-ci-base.test.sh`（新建）｜`tests/control-tower/doc-contract-ci-acceptance.test.sh`（新建）｜`gate-exemptions/2026-10-20-doc-contract-ci-598.md`（L1）｜`docs/synova/DOC-CONTRACT.md`（§3 白名单加 gate-exemptions/**，CTO 批）｜`docs/authority/DOCS-REGISTRY.yaml`（DOC-0211 登记）。
- 不做：不动 checker/validate 判据、不动 §9.1 过渡表、不迁 `docs/plans/**` 存量、不碰 `scripts/audit/**`、不动 `.github/**`。

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/resolve-ci-base.test.sh`；`bash tests/control-tower/doc-contract-ci-acceptance.test.sh`；真 PR 红/绿（临时 docs/plans 提交）。
- 交互：① 注入 `SYNO_DIFF_BASE`；①d 用 helper；CI 无 base ⇒ fail-loud；带 base ⇒ 闸 3 真判。
- 结果：两测试 0 失败；真 PR：加临时 docs/plans 文档 ⇒ CI 红；删掉 ⇒ 绿。

## Q4: 契约与测试
- 契约：helper `@input/@output/@exit`（stdout 仅 ref；日志 stderr；exit 0/2）；pre-commit 作用域 = `SYNO_CI=1 ∧ GITHUB_ACTIONS=true`。
- 测试：`resolve-ci-base.test.sh` 10 例；`doc-contract-ci-acceptance.test.sh` 8 项。

## 本任务在哪一层
- 治理线 / 门禁（doc-contract 闸 3 ＋ CI 工作流）；不涉产品运行时。

## Done 标准（至少一条可验证）
- 两测试 0 失败；真 PR 红/绿 run 号入 PR 正文；`pre-commit-check.sh` 12 组本地 exit 0。

## 写集（机器可读；组 6 认领制判据）

| 文件 | 类型 |
|---|---|
| `.gitea/workflows/local-gates.yml` | task |
| `scripts/control-tower/resolve-ci-base.sh` | task |
| `scripts/pre-commit-check.sh` | task |
| `tests/control-tower/resolve-ci-base.test.sh` | task |
| `tests/control-tower/doc-contract-ci-acceptance.test.sh` | task |
| `gate-exemptions/2026-10-20-doc-contract-ci-598.md` | task |
| `docs/synova/DOC-CONTRACT.md` | task |
| `docs/authority/DOCS-REGISTRY.yaml` | task |
| `.claude/task-briefs/2026-10-20-598-doc-contract-ci.md` | task |
| `memory/notes/proposed/2026-10-20-doc-contract-ci.md` | task |
