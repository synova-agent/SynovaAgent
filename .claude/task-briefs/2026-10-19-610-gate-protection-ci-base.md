# Task Brief: P4 · #610 — ①d 在 CI 空跑：每次刷新 base ＋ 退役 bootstrap（Issue #610）

> 分支: ct/p4-610-gate-protection-ci-base-1019 ｜ 起点: `gitea/local-main` @ 695ada515（实测 `git rev-parse --short HEAD` == `git ls-remote gitea refs/heads/local-main` 前 9 位）
> 规格（唯一）: `.handbook/派单件/2026-10-19-规格-610-gate-protection-ci-base.md`（307 行；sha256/16 = 589c41f7c19b3e2e；status: proposed）
> 域守则（均显式 read）: `scripts/control-tower/AGENTS.md` ｜ `tests/control-tower/AGENTS.md` ｜ `.gitea/AGENTS.md` ｜ `memory/notes/AGENTS.md`
> 本件是 pre-commit 组 6 要求的声明载体（gate-mandated companion），**不是交付件**（交付件 = Q2 写集 6 件）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：治理线 · P4 门禁。①d「门禁本体自检」是 S1（#586）在活腿 `local-gates` 上加的步：核受保护清单完整（条数／pin／APPROVERS）＋ 本次 diff 若触碰受保护路径必须有合规豁免。本卡修它两个缺陷：① workflow 只在 canonical ref **不可解析**时才 fetch ⇒ CI 工作区建一次后 ref 永不刷新（run 1019 拿 5833c0d1b 算 diff，假绿）；② 检查器「base 无清单 ⇒ bootstrap 返回 0」是一次性开孔，在陈旧 base 下恒真 ⇒ 必须退役。

**b) 文件审计**：`.gitea/workflows/local-gates.yml` ①d 步 run 块（BASE 解析链 ＋ canonical 物化 ＋ 调检查器）；`scripts/control-tower/check-gate-protection.sh` 的 bootstrap 分支（base 无清单 ⇒ `report["bootstrap"]=True; return finish()`）；配对测试 `tests/control-tower/check-gate-protection.test.sh`（T10 bootstrap／T12 DS-6）与自证 `tests/control-tower/gate-protection-acceptance.test.sh`（⑧ bootstrap；⑨⑩⑪⑫ 接线／API／禁语）；同域前例 `.claude/task-briefs/2026-10-18-586-gate-protection.md`、`memory/notes/proposed/2026-10-18-gate-protection.md`。

**c) 决策**：不新建机制族；复用四个既有约定（三态退出码／`@降级`＋`SYNO_GATE_DEGRADED_LOG`／D732 UTF-8 强制／判别力自检）。检查器沿用既有 `E_BAD_BASE`（禁新造 error code）；workflow 只改 ①d 的 run 块，**不动** job/step 名（12 必需 context 的唯一产出者）。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：fail-closed ＋ freshness assertion —— 拿「可能陈旧的 base」算 diff，其结论不可信；判不了 ⇒ exit 2，不得降级为「通过」。依据 `scripts/control-tower/AGENTS.md`（三态＋判别力自检）、`.gitea/AGENTS.md`（信号量==0 ⇒ exit 2）、`.dsh/skills/dsh-code-standards/SKILL.md`。

**b) 决策链**：CTO 2026-10-19 批（同意修 #610，派 L2 实施）｜Issue #610｜规格 `SYNOVA-IMPL-610`（撰写者独立于实现者）｜顺序钉死：**本卡先于 #606**（#606 rebase 后 ①d 才真红 → 创始人豁免 → 绿）。

**c) 历史教训**：S1 的 bootstrap 是「首次落盘」一次性开孔（`memory/notes/proposed/2026-10-18-gate-protection.md` Known Limitations 4）；S1 的 Known Limitations 5 已写明 push 腿 diff 空、真正拦截在 pull_request 腿。**本轮实测**：CI 工作区 `/Users/wane/.ci-work/SynovaAgent` 的 `refs/remotes/gitea/local-main=5833c0d1b`（早于 S1 `23a4f5a38`，非其后代；reflog 仅一次 fetch）⇒ 只收紧 bootstrap 不够，必须让 CI **每次都刷新** base。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行；L1 划定，L2 及成员不得扩）：
- .gitea/workflows/local-gates.yml
- scripts/control-tower/check-gate-protection.sh
- tests/control-tower/check-gate-protection.test.sh
- tests/control-tower/gate-protection-acceptance.test.sh
- .claude/task-briefs/2026-10-19-610-gate-protection-ci-base.md
- memory/notes/proposed/2026-10-19-gate-protection-ci-base.md

（前 4 件为改；后 2 件为新建。豁免件 `gate-exemptions/2026-10-19-gate-protection-ci-base-610.md` 由**创始人网页提交**（作者校验），**不是 L2 写集**。）

不做什么（禁碰，含路径）：
- 不改 .gitea/protected-files.txt — 清单内容／APPROVERS／pin 本批 0 行
- 不改 scripts/pre-commit-check.sh — 12 组编号/内容属 #606 域，本批 0 行
- 不改 scripts/audit/ — K3 审计专属，任何人禁碰
- 不改 .github/ — 非权威 CI；CI 权威在 .gitea/（本批不写死腿）
- 不改 docs/plans/ — 存量迁出批；新规格一律 .handbook/派单件/
- 不改 scripts/control-tower/resolve-ci-base.sh — #598 域（本卡保持 ①d inline）
- 不改 /Users/wane/SynovaAgent — 主树禁写（只写 .synova-wt-610-impl-1019）
- 不改 gate-exemptions/2026-10-19-gate-protection-ci-base-610.md — 创始人作者豁免件，L2 不写

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`bash scripts/control-tower/check-gate-protection.sh [--changed-base <ref>] [--root <dir>]`；CI 侧 = `.gitea/workflows/local-gates.yml` 的 ①d 步（`SYNO_CI=1` 或 `GITHUB_ACTIONS=true` ⇒ CI_FLAG=1）。
**交互**：三态退出码 `0` 通过／`1` 真红／`2` 检查自身失败（base 无清单 ＝ `E_BAD_BASE`；canonical 不可解析或陈旧 ⇒ `::error` ＋ exit 2）；`|| exit $?` 原样透传，禁折叠。
**结果**（原始输出为准，禁手写数字）：
- 默认模式 ⇒ exit 0（清单 20 条／pin 一致）
- 陈旧 base（早于清单落 main）＋ 改受保护路径 ⇒ **2 ＋ E_BAD_BASE ≥1 ＋ `BOOTSTRAP` 行 =0**（历史上是 0＋BOOTSTRAP）
- 新鲜 base ＋ 受保护变更无豁免 ⇒ 1；＋合规豁免（作者=APPROVERS）⇒ 0（回归不破）
- 配对测试 exit 0；自证 12/12 exit 0（⑧ 改「2＋E_BAD_BASE，无 BOOTSTRAP」；⑨⑪⑫ 仍绿）
- `grep -c BOOTSTRAP scripts/control-tower/check-gate-protection.sh` = 0；①d 块 `grep -cE 'origin/local-main|origin/main'` = 0（跟踪引用动态拼 `refs/remotes/${ONLY_REMOTE}/local-main`）
- CI 每次刷新：CI_FLAG=1 ∧ 单远端 ⇒ **必走** fetch（无「仅不可解析才 fetch」的 CI 路径）

## Q4 契约与测试

- 检查器：`@exit 0/1/2`；`E_BAD_BASE` 沿用 C1 定集；删 `BOOTSTRAP` 输出与 `--json` 的 bootstrap 键；豁免解析／作者校验／glob／pin／APPROVERS 与其余三态分支**一行不动**。
- ①d：`@input SYNO_CI=1 或 GITHUB_ACTIONS=true`（CI 标记）＋ 单远端；**CI**：每次 fetch canonical ref ＋ 新鲜度断言（canonical 可解析；与唯一远端的 local-main 跟踪引用可解析时 SHA 必须相等）⇒ 否则 `::error` ＋ exit 2；**非 CI**：旧行为（仅不可解析且单远端才 fetch）。
- 纯 bash ＋ python3 标准库（macOS bash 3.2：禁关联数组/mapfile）；UTF-8；禁静默吞错；三态不折叠。
- 测试配对：配对测试全沙箱（`mktemp`＋`git init`＋注入缝），覆盖正常／降级／陈旧 base／DS-6；自证脚本只读仓库，逐项打印实测数字。

## 本任务在哪一层

基础设施（控制塔 CI 门禁；不触 L1–L5 业务代码）

#CRITERIA: A

## Done 标准

- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && bash scripts/control-tower/check-gate-protection.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && bash tests/control-tower/check-gate-protection.test.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && bash tests/control-tower/gate-protection-acceptance.test.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && S=$(mktemp -d) && git -C "$S" init -q && git -C "$S" -c user.email=t@t -c user.name=t commit -q --allow-empty -m c1 && B=$(git -C "$S" rev-parse HEAD) && mkdir -p "$S/.gitea" "$S/scripts" && cp .gitea/protected-files.txt "$S/.gitea/" && cp scripts/pre-commit-check.sh "$S/scripts/" && echo x >> "$S/scripts/pre-commit-check.sh" && git -C "$S" add -A && git -C "$S" -c user.email=t@t -c user.name=t commit -q -m c2 && bash scripts/control-tower/check-gate-protection.sh --root "$S" --changed-base "$B" 2>&1 | grep -q E_BAD_BASE
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && test "$(grep -c 'BOOTSTRAP' scripts/control-tower/check-gate-protection.sh)" -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && test "$(awk '/- name: ①d/,/- name: ①b/' .gitea/workflows/local-gates.yml | grep -cE 'origin/local-main|origin/main')" -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-610-impl-1019 && test "$(git status --porcelain | wc -l | tr -d ' ')" -eq 6
