---
状态: proposed
日期: 2026-10-31
决策: W3 skill 收敛的载体阶段（#1227 task-6）把「判据中枢／pre-commit 组数／预算口径」三处口径单源化到 docs/authority/GATE-STANDARD.md，同批改 verify-d703 引用并迁移编码指令模板；删除 12 并入件与 sync 另行收口
理由: GATE-STANDARD v3.1（D763）§五-3 要求 AGENTS.md V7.1→V7.2 同批改三项，§十一 W3 出口判据含 `git grep -c cto-bookkeeping AGENTS.md`＝0；而 AGENTS.md 头部把仓外产品宪章当判据中枢、写死「12 组」、并带两套预算账，属第二真源（§〇 红线表）。故只做口径收口，不触碰判据语义与文件删除。
---

# W3 skill 收敛 · 载体阶段（#1227 / task-6）

> 四态：**proposed**（待合并后按 `git mv` 转 implemented）｜ 批次 W3（GATE-STANDARD 批 D）｜ 基线 gitea/main=586ecb8ff ｜ 分支 ct/w3-1227

## 决策

1. **判据中枢单源**：AGENTS.md 头部由「对齐产品宪章 v8.3（判据中枢）」改为指向 `docs/authority/GATE-STANDARD.md`（v3.1 / D763）；产品宪章降为**架构基准**（§0.4／§4.1）唯一职责，不再兼任判据中枢。
2. **组数改指针**：三处字面「12 组」全部替换为指针（真值 = `grep -cE '── 组 [0-9]+:' scripts/pre-commit-check.sh`），理由：字面组数与脚本实际横幅数已冲突（GATE-STANDARD §〇 红线表：写死 12 与 23 冲突）。
3. **预算口径择一**：保留头部**本件字节预算**（本批实测 23,154 B；硬上限 65,536 B），删除「13 份域守则合计 23,559 B／合计 46,740 B／最坏账理论值」整段与 §0 重复聚合数字；`≤3.5KB/份` 作为域守则**尺寸规则**保留（新增域守则模板要求），不再作聚合预算账。
4. **硬引用同批修正**：AGENTS.md §16「细则见 `.synova/skills/cto-bookkeeping/SKILL.md`」改为 cto-handover（「记账」节）—— 否则 task-7 删除 cto-bookkeeping 后该引用成断头路，且违反 GATE-STANDARD §十一 W3 出口判据。
5. **verify-d703 引用同批**：`scripts/ci/verify-d703.sh:93-94` 的 `.synova/…` 与 `.dsh/…` 两行由 `dev-doc-delivery/template` 改为 `dev-doc-spec/template`（GATE-STANDARD §六批 D：引用修改并入 W3，不随 W4）。
6. **模板原样迁移**：`dev-doc-spec/template/编码指令模板.md` 从 `dev-doc-delivery/template/编码指令模板.md` 字节级复制（sha256 相同），删除旧件归 task-7。
7. 配套：豁免件 `gate-exemptions/2026-10-31-w3-1227.md`（三段式＋自覆盖）、brief、claim、DOCS-REGISTRY `DOC-1227`（豁免件）＋ `DOC-1227-01`（技能模板迁移，L1 2026-10-31 授权补登）、handbook `包/cto-handover-完整正文-2026-10-31.md`（原 SKILL.md 全文 + 首行来源与日期）。
8. **创始人裁定 A（2026-10-31，L1 转达）**：本批**删除 `sentinel-lifecycle`**（原 8,682 字符）以达 task-7 判据 1 的 12；**正文全文原样迁 handbook** `包/sentinel-lifecycle-完整正文-2026-10-31.md`（做法同 cto-handover），仓内不保留；其**能力面换载体到 D3，由另卡承载**。本卡（task-9）只做正文迁移与声明面同步（claim/brief/豁免/Note），**不删目录**（删除在 task-7，且 task-7 已改为 blocked_by task-9）。迁移实测：handbook 8,917 字符（正文体 sha256 = 原文 `bffed12d…5e8`，逐字节一致）。
9. **task-7 收口执行（2026-10-31）**：已删 14 个技能目录（12 并入件 + `synova-verify` + `sentinel-lifecycle`）；`bash scripts/workflow/sync-dsh-skills.sh --apply` 后 **`.dsh/skills` = 12**（与 `.synova/skills` 一致，`--check` 输出 SYNC-OK）；被替换/移出的目标侧旧件回收于 **`.dsh/.skill-trash/`（22 项，不入仓，仅本机回收留档）**；`.synova` 侧删除 15 个跟踪文件（覆盖 14 目录）。

## 证据（命令原始输出，2026-10-31 实测）

- 改前：`grep -c '12 组' AGENTS.md` = 3；`grep -c 'GATE-STANDARD' AGENTS.md` = 0；`grep -c 'cto-bookkeeping' AGENTS.md` = 1。
- 改后：`grep -c '12 组'` = 0（rc=1）；`grep -c 'GATE-STANDARD'` = 1；`grep -c 'cto-bookkeeping'` = 0（rc=1）。
- 预算数字单点：`grep -n '65,536' AGENTS.md` 仅命中头部行（1 条）。
- `sed -n '93,94p' scripts/ci/verify-d703.sh` → 两行均含 `dev-doc-spec/template/编码指令模板.md`。
- `cmp …/dev-doc-spec/… …/dev-doc-delivery/…` → exit 0；sha256 两侧同为 `911a99e7…b98b544`。
- 全文件 LF（`python3` 测 CR=0）、UTF-8 合法；`bash -n scripts/ci/verify-d703.sh` 通过。
- `bash scripts/doc-system/check-doc-truth.sh` → 全部硬检查通过（C2 组数声明在 AGENTS.md 侧降为「未找到组数声明」警告，属预期，见风险 1）。

## 风险（如实）

1. **C2 组数声明变警告**：`scripts/doc-system/check-doc-truth.sh:115` 的 CLAIM 正则只认 `N 组 pre-commit` 等字面量；组数改为指针后，AGENTS.md 侧 C2 从 ✅ 变 ⚠️（exit 仍 0，不硬阻断）。若要让 C2 重新可判，需另卡改该正则接受指针形态（**判据变更，不在本卡**）。
2. **技能模板的登记门禁（L1 已批处置，已落地）**：`scripts/doc-system/doc-registry-gate.sh` 的 EXCLUDE 不含 `.synova/`；初版实跑得 `⚠️ 未登记(仅警告,untracked): .synova/skills/dev-doc-spec/template/编码指令模板.md`，提交态（staged/base..HEAD）会判 ❌ 未登记且 CI `SYNO_CI=1` 下 D782 D2 转硬。经 L1 指示（不改门禁排除），补登 `DOC-1227-01`（type=devdoc / owner=W3 / status=active）：登记对象为模板，但 R2 要求「Issue 来源可从 front-matter `任务:` 或文件名 `-<N>-` 派生」而模板文件名不含数字、且按本卡要求不得加 front-matter ⇒ 条目 `path` 指向本批可派生件 `gate-exemptions/2026-10-31-w3-1227.md`，模板真实路径写在 `note` 首行（登记门禁按「路径或 basename 出现在台账文本中」判定）。复跑门禁：`✅ 已登记: .synova/skills/dev-doc-spec/template/编码指令模板.md`、`✅ [R1/R2] DOC-1227-01`、`✅ 登记门禁通过`，rc=0。**局限（如实）**：该 path 不表模板的文档归属，属 R2 判据限制下的最小绕行；判据本身不动。
3. **自指字节数**：头部「本件 23,154 B」是自指数字，本文件后续任何改动都会使其漂移；改后须重跑 `wc -c` 刷新（引用纪律：数量以脚本实况为准）。
4. **D 号退役口径**：本 Note 与卡只用 Issue #1227，不引入新 D 号。
5. **task-7 数量判据（裁定 A 已定，2026-10-31）**：本批现状 `.synova/skills/*/` = 26；L1 核：26 = 12 保留 + 12 并入 + synova-verify + sentinel-lifecycle。创始人裁定 A：本批删除 `sentinel-lifecycle`（正文先迁 handbook，能力面换载体 D3 另卡）⇒ 删 14 个目录后剩 12，符合 task-7 判据 1。判据未改；本卡不执行 task-7、不提前删目录。
6. **claim writeset 范围**：`.claude/claims/1227.yaml` 按**整批** #1227 声明（含 task-7 待删除目录与 `.dsh` 再生成路径）——claim 以 Issue 号为键，且 PR 级 `merge_writeset_gate` 以 `claim.writeset` 为声明源（S0）。若 L1 决定按任务拆 PR，须回退为任务级声明。

## 回滚

- 单点回滚：`git revert <本批 merge sha>`（载体件全部为新增或行级替换，无跨件状态）。
- 部分回滚：恢复 AGENTS.md 三处原文（V7.1 头、「12 组」×3、预算段）与 verify-d703:93-94 两行即可；模板复制件可直接删除，不影响 `dev-doc-delivery` 原件（原件未改）。
- 不删除任何技能目录 ⇒ 删除类回滚无需处理（task-7 才有删除，且删除前有对照表前置）。**sentinel-lifecycle 例外**：本批按裁定 A 将删除该目录，回滚只需从 handbook `包/sentinel-lifecycle-完整正文-2026-10-31.md` 去掉首行来源注后原位恢复（正文体 sha256 已与原文对齐 `bffed12d…5e8`）。
