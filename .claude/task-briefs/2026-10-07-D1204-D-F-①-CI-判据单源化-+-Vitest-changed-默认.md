# Task Brief — D-F/① CI 判据单源化 + D-E 余项 Vitest `--changed` 默认（D1204）

> 生成: 2026-10-07 | 任务: D1204 | 认领: line-b-ci | 父卡: #1221（v2.0）
> 卡: #1227（D-F 判据单源）· #1226（D-E CI 提速余项）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（非 L1-L5）：CI 判据载体 = `.github/workflows/ci.yml`（本卡前 1199 行）。
本卡动两件：① **判据文本单源化**（docs-only 早退白名单正则）② **Vitest 默认跑法**（全量 → 影响面）。
两件都**不动**「哪条检查阻断合并」：9 条必需 context 的 job `name:`、`all-checks-passed.needs` 一字不改。

### b) 文件审计
- `grep -n 'grep -qvE .\^docs' .github/workflows/ci.yml` → 改动前 **9 处内联副本**（L89/224/301/353/435/657/697/745/794）。
- `grep -c 'name: Detect docs-only change (D515)' ci.yml` → **9**（= 副本数 = fail-safe 数，同轴）。
- D1023 守卫 `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh:90` 用
  `grep -oE "grep -qvE '[^']+'"` 从 ci.yml 提取正则 ⇒ 单源化后此提取必归零 ⇒ 守卫必须同步改（否则恒红）。
- vitest 5.0.2（package-lock.json:`node_modules/vitest` = 5.0.2）`dist/chunks/cac.BLbEtnDd.js:956`
  = `changed: { argument: "[since]" }`；`passWithNoTests` 在同文件 947 行；
  实现 `GitVCSProvider.getFilesSince()` = `git diff --name-only <since>...HEAD`（与 D721 三点差同口径）；
  `executeTests` 内 `if (!passWithNoTests && shard.count > specs.length) throw` ⇒ **`--passWithNoTests` 必需**。
- `.github/ci-criteria.txt` **不存在**（新建）；`.gitattributes` 已有 `*.sh/*.py text eol=lf`（追加 1 行）。

### c) 决策
复用既有消费形态（bash + `grep -qvE`），只把**正则文本**外移到一个键值文件；
不引入 composite action（多一层间接、job 结构变更面更大）。Vitest 走 CLI 参数，**不改** `vitest.config.ts`（他线写集）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 判据单源（DRY）：本仓 `D1111/A5` 注释自陈「同源多副本」是**临时**态、「单一真值源收敛属重构（另卡）」——本卡即那张卡。
- `--changed`（影响面测试）属 Anthropic/Monorepo 基线：PR 跑影响面 + 主干/夜间跑全量；D-E 卡（#1226）为
  创始人 2026-10-07 批准方案七⑥，非本卡自创。
- memory 教训：**判据漂移**是本仓 P0 家族（必需 context 名静默失配 D971、D# 双编号、10 处副本正则）——
  同一判据多副本 = 下一次漂移的温床；铁律 35（自动化优先）指向「判据变成可执行单源」。
- 决策参考：Anthropic（影响面优先）/ 第一性原理（同一判据只应有一个物理位置）+ 结论：
  **正则外移 + 守卫改「单源派生 + 内联副本=0 + 消费点=9」**，行为逐字不变（14 条行为用例全保留）。

## Q2: 范围 — 正确的最简方案
做什么：
- `.github/ci-criteria.txt`（新建）— 唯一真值源：`DOCSONLY_WHITELIST_RE=<ERE>` + 分层理由/消费契约/降级契约。
- `.github/workflows/ci.yml` — 9 个 `Detect docs-only change (D515)` step 改为**读单源**（零内联副本）；
  内联副本的注释一并改写（注释里也不留正则字面量，防「验收命令恒 0 = 纸老虎」）。
- `.github/workflows/ci.yml` — `test` job「Run tests」step：默认 `--changed <merge-base>` + `--passWithNoTests`；
  `schedule`/`workflow_dispatch` ⇒ 全量；`BASE` 不可解析 ⇒ 全量（可见 `::warning`）。
- `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` — 从单源派生；新增结构断言
  （单源键=1 行 / 内联副本=0 / 单引号内联形态=0 / 消费点=9 / detect step=9 / 变异体自证）；
  保留 fail-safe=9 与原 14 条行为用例。
- `.gitattributes` — `.github/ci-criteria.txt text eol=lf`（行尾 CR 会被写进正则 ⇒ 平台层判据漂移）。
- `memory/notes/proposed/2026-10-07-d1204-ci-criteria-single-source.md`（决策沉淀，铁律 49）。
- `.claude/task-briefs/2026-10-07-D1204-*.md` + `task-state/D1204.json`（认领/流程）。

不做什么（含文件路径）：
- 不改 `.github/workflows/` 下其余 5 个 workflow（`dashboard-auto.yml` / `product-progress.yml` /
  `desktop-build.yml` / `progress-freshness-watchdog.yml` / `project-coordinates.yml`）。
- 不改 `vitest.config.ts`（CI exclude 列表属他线）。
- 不改 `scripts/control-tower/check-gate-integrity.sh`、`scripts/control-tower/gate-integrity-baseline.txt`
  （发现制另切片）。
- 不改 `scripts/audit/**`（K3 红线）、不改 `scripts/pre-commit-check.sh`（线 A 写集）。

冻结约束（非排除项）：`ci.yml` 内 9 条必需 context 的 job `name:`、`test` 矩阵结构、
`all-checks-passed` 的 `needs` 与判据一字不改（本卡只动 detect step 的判据来源与 test job 的跑法）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：PR 触发 `.github/workflows/ci.yml`（9 个 detect step 读 `.github/ci-criteria.txt`）。
处理：① detect 决定 docs_only；② 非 docs-only ⇒ Vitest 以 `--changed <merge-base>` 选影响面，
nightly/人工 ⇒ 全量；③ D1023 守卫（`SYNO_CI=1` HARD）断言单源结构 + 行为用例。
结果：内联副本 0、消费点 9；守卫 25 断言全绿；三个本地门禁全绿；PR CI 绿且墙钟不劣于现值。

## 架构层: 治理面（scripts/.github，非 L1-L5）

## 写集
| 文件 | 类型 |
|---|---|
| `.github/ci-criteria.txt` | 新建（单源） |
| `.github/workflows/ci.yml` | 改（9 detect + test job） |
| `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` | 改（守卫同步） |
| `.gitattributes` | 改（LF 冻结 1 行） |
| `memory/notes/proposed/2026-10-07-d1204-ci-criteria-single-source.md` | 新建（决策 Note） |
| `.claude/task-briefs/2026-10-07-D1204-D-F-①-CI-判据单源化-+-Vitest-changed-默认.md` | 新建（流程） |
| `task-state/D1204.json` | 新建（认领） |

## Done 标准:
- [ ] verify: `grep -cF 'docs/.+\.(md|json|html)' .github/workflows/ci.yml` ⇒ 0（内联副本清零）
- [ ] verify: `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` ⇒ 25 PASS / 0 FAIL（exit 0）
- [ ] verify: 变异体①（回填内联副本）⇒ 守卫 exit 1；②（单源宽松化）⇒ ≥6 用例翻红；③（删一处 fail-safe）⇒ fail-safe 计数红
- [ ] verify: `bash tests/control-tower/ci-signal-classify.test.sh` ⇒ 80 通过 / 0 失败
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh` ⇒ `GATE-INTEGRITY: OK`
- [ ] verify: `python3 scripts/control-tower/check-required-contexts.py --repo .` ⇒ 9/9 命中（job 名零变更）
- [ ] verify: PR CI 全绿 pending=0 + 墙钟 ≤5m（贴 run 号）
