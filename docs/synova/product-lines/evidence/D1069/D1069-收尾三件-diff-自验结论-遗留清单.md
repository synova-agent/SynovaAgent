# D1069 收尾三件 — diff / 自验结论 / 遗留清单

> 任务 D1069 ｜ 队长（squad-lead，门禁线小队）｜ 2026-09-29
> 源派单：现场 alloc「D328 修复：resolve-commit-brief.sh 强锚点失配」
> 🔴 目的：解除「认领锚点失配」对四条链的阻塞（#868→#894 / #883 / #892）
> 分支：`fix/D1069-resolve-brief-anchor` ｜ base：`origin/main @ f51aaf9b`
> **本件为队长收尾产物，不含「通过」结论**——通过与否归 CTO 收件闸 + K3 终审。

---

## 一、diff（全部数字来自命令原始输出）

### 1.1 远端对账（回执，闭合「声称已推送、实际只在本地」）
```
$ git ls-remote --heads origin | grep -i D1069
6c4c912efd584ea7202fc93f2367eb6124ec9357	refs/heads/fix/D1069-resolve-brief-anchor
$ git rev-parse HEAD
6c4c912efd584ea7202fc93f2367eb6124ec9357      # 本地 == 远端
```

### 1.2 提交序列
```
$ git log --oneline origin/main..HEAD
6c4c912e chore: bypass COMMITTED 登记 (auto hook, D521)
a9c355cb docs(D1069): 独立自验 rev3 补检
fc4c797f chore: bypass COMMITTED 登记 (auto hook, D521)
9e2d9e6a docs(D1069): 独立自验 文末回执
26ffb939 chore: bypass COMMITTED 登记 (auto hook, D521)
fdf62506 docs(D1069): 独立自验 V1–V12 结论与原始输出（含 L1–L8 遗留）
f341dd1d chore: bypass COMMITTED 登记 (auto hook, D521)
dae6b55e test(D1069): resolve-commit-brief 强锚点专项段落（追加 13 用例）+ C1–C5 证据
b25f362e chore: bypass COMMITTED 登记 (auto hook, D521)
3104921d fix(D1069): resolve-commit-brief 强锚点优先级 + 去重认领计数 + D# 边界定位
```
实质提交 3 个（3104921d 生产脚本 + dae6b55e 测试与证据 + fdf62506/9e2d9e6a/a9c355cb 自验件），
其余 4 个 `chore: bypass COMMITTED 登记` 是 `scripts/hooks/post-commit.sh` 的**自动台账登记提交**（非成员手写）。

### 1.3 改动面
```
$ git diff --stat origin/main
 .claude/bypass.log                                 |  17 +
 .claude/task-briefs/2026-09-29-D1069-...强锚点失配修复.md | 274 ++++++++
 docs/synova/product-lines/evidence/D1069/D1069-C1C5-原始输出.md | 513 +++++++++++++++
 docs/synova/product-lines/evidence/D1069/D1069-anchor-fix-evidence.json | 121 ++++
 docs/synova/product-lines/evidence/D1069/D1069-独立自验.md | 710 +++++++++++++++++++++
 memory/notes/implemented/2026-09-29-D1069-resolve-brief-anchor.md |  57 ++
 scripts/workflow/resolve-commit-brief.sh           | 110 +++-
 task-state/D1069.json                              |  11 +
 tests/control-tower/resolve-commit-brief.test.sh   | 325 ++++++++++
 9 files changed, 2135 insertions(+), 3 deletions(-)

$ git diff --numstat origin/main
17	0	.claude/bypass.log
274	0	.claude/task-briefs/2026-09-29-D1069-resolve-commit-brief-强锚点失配修复.md
513	0	docs/synova/product-lines/evidence/D1069/D1069-C1C5-原始输出.md
121	0	docs/synova/product-lines/evidence/D1069/D1069-anchor-fix-evidence.json
710	0	docs/synova/product-lines/evidence/D1069/D1069-独立自验.md
57	0	memory/notes/implemented/2026-09-29-D1069-resolve-brief-anchor.md
107	3	scripts/workflow/resolve-commit-brief.sh
11	0	task-state/D1069.json
325	0	tests/control-tower/resolve-commit-brief.test.sh
```
**写集 8 条全部命中、零越界**；第 9 条 `.claude/bypass.log` 为工具台账（定性见 §二.4）。
唯一有删除行的文件是生产脚本（`107+/3-`，3 行删除 = :92-95 旧 glob 函数头改造），其余全部纯新增。

### 1.4 产物指纹
```
scripts/workflow/resolve-commit-brief.sh      sha256 4c618a0d098bb9bf…
tests/control-tower/resolve-commit-brief.test.sh sha256 e2637579baf3ceeb…
规范 4 注入缝：# <<<ANCHOR-PRIORITY-START>>> = :171 ；# <<<ANCHOR-PRIORITY-END>>> = :204
```

---

## 二、自验结论

### 2.1 三人分工（squad-discipline §19/21：自验不得由编码兼任）
| 角色 | 成员 | 共享任务 | 状态 |
|---|---|---|---|
| 队长（协调/判前提/验证据，不下场写码） | lead | — | — |
| 编码方 A（生产脚本 + 决策 Note） | coder-anchor | task-1 | completed |
| 编码方 B（测试段落 + C1–C5 证据） | coder-tests | task-2 | completed |
| **独立自验员（非编码）** | verifier | task-3 | completed |

### 2.2 队长独立复算（不采信成员转述）
队长在**干净沙箱**用**按内容 pin 的 origin/main 版脚本**独立跑出三态，结果：
```
C1（origin/main 版脚本，/tmp 镜像树，无分支锚点）  同一输入 → 2026-09-28-D1039-A4-CI成本收口.md   exit=0
C2（修后生产脚本，工作树 + D1061 brief 临时按字节复制）同一输入 → 2026-09-29-D1061-CT提速+门禁机制修正.md  exit=0
C3（sed 删 171–204 注入缝后的变异副本）           同一输入 → 2026-09-28-D1039-A4-CI成本收口.md   exit=0
临时夹具删除后 find '*D1061*' → 0 件（零残留）
```
⇒ **C1/C2/C3 三条判别性成立**：修前落 D1039、修后落 D1061、去掉强锚点优先级的变异体回落到 D1039。

队长另跑（串行，同一时间 ≤1 个重型验证）：
```
$ bash tests/control-tower/resolve-commit-brief.test.sh
  结果: 69 通过, 0 失败      exit=0
$ bash scripts/control-tower/check-gate-integrity.sh
  CI-REGISTRY: 密封面未登记 78；基线 78 条；基线外新增 0；基线过期 0
  GATE-INTEGRITY: OK
$ bash -n scripts/workflow/resolve-commit-brief.sh   exit=0
$ git status --short                                  （空）
```

### 2.3 独立自验员结论（verifier / task-3，全文见 D1069-独立自验.md）
V1–V12 **逐条自验通过**，其中独立复算而非采信的关键项：
- **V2**：自建 **3 个**变异体（删缝 / 纯修前 / 仅回退规范 2）—— 删缝→D1039（红）、纯修前→D1039（红）、
  **仅回退规范 2 仍返回 D1061** ⇒ 独立证明 **P0 是 C2 的必要条件、规范 2 不是**（与阶段一判断互证）。
- **V3/V4**：自建夹具（非跑他人测试），修前 `AAA-dup4` → 修后 `ZZZ-twofiles`，判别性反转成立。
- **V10**：字节级证明既有 406 行零改动（`grep -c '^-[^-]'` = **0**）。
- **V12**：在沙箱内只破坏 1 条既有断言 ⇒ `67 通过 / 2 失败 / exit=1`，证明追加段未钝化既有断言的可判别性。
- **V6**：红线七项（`scripts/audit/`、`pre-commit-check.sh`、`brief_parser.py`、`staging_guard.py`、
  `gate-integrity-baseline.txt`、`ci.yml`、`src/`）**全部零改动**；写集 8 条全在集。
- **V11**：棘轮 `GATE-INTEGRITY: OK`，密封面基线外新增 0。

**自验员给出的结论：`自验结论 —— 可提请独立审计`**（其原文，未使用「审计通过」措辞）。

### 2.4 队长对两条争议项的裁决
**(a) `.claude/bypass.log` 的处理 —— 裁决：不剥离，随 PR 进入 main，登记遗留。**
自验员建议「合并前剥离 8 行假证据」。队长复核后**不采纳剥离**，理由为物理事实：
```
$ git show origin/main:.claude/bypass.log | grep -c 'TASK_ID=D331-test'
53                                     # ← main 上早已存在 53 行同型假记录（2026-09-14 起）
$ git show origin/main:.claude/bypass.log | grep 'TASK_ID=D331-test' | ... | git cat-file -t <hash>
fatal: git cat-file: could not get object info     # 同型假 HASH，与本分支新增行同源同病
```
故：① 只剥离本分支 8 行**不能修复问题**（main 上 53 行仍在）；② 会导致 append-only 台账在
union 合并驱动下与 main 分歧；③ 属「一次性特例清洗」——违反「预算/豁免/清洗一律走规则」。
**正解 = 立卡修根因（测试隔离），而非在单个 PR 里擦一行**。根因已由自验员定位到 file:line（见 L6）。
本分支新增的 17 行中含 **2 行真实登记**（`COMMITTED | pre-commit PASS | HASH=3104921d…/dae6b55e…`，与真实提交一一对应）。

**(b) 编码方 B 报告的 sha256 `47dc1061…` —— 裁决：不可采信，已被更强证据取代。**
自验员独立复算：仓库内零命中，5 个自然候选均不等 ⇒ 标为**不可复算**。
其欲证明的性质（既有段未被污染）已由 V10 的**字节级哈希**更强地证实。
队长据此不把 `47dc1061…` 写入交付结论。

### 2.5 结论
- 队长意见：**C1–C5 判据全部有原始输出支撑，可提请独立审计**。
- 独立自验员：**可提请独立审计**。
- **队长不给「通过」**；通过与否 = CTO 收件闸 + K3 终审，且**门禁语义变更须过 ctrl-tower-change 模式 6 + K3**（本卡红线）。

---

## 三、遗留清单（逐条带 file:line；本卡不修）

| # | 项 | 位置 | 性质 | 处置建议 |
|---|---|---|---|---|
| **L1** | 任务书曾写 `total briefs=173` / 「另 3 个是次位交叉引用」——后者**不实**（实为 3 份**无 D# token** 的文件） | 任务书 Q0b（已加勘误块） | 队长写卡缺陷，**已由自验员证伪后勘误** | 关闭（已在卡内更正） |
| **L2** | 复现不可移植：任务书 Q0b 两条只在 main 树成立（分支锚点差异 + untracked brief） | 任务书 Q0b（已加「复现环境钉」） | 证据口径缺陷 | 关闭（已改为按内容 pin origin/main 版脚本） |
| **L3** | 红证判据口径错误：全仓 `grep -c INJECTED-RED` = 0 在干净 main 上不成立 | 原 task-3 V7 | 队长派单缺陷 | 关闭（已改「本次 diff 零新增」）；**存量权威值 15**（`git grep -l … origin/main \| wc -l`） |
| **L4** | **既有红**：`staging-guard-session.test.py` 5 失败 | `tests/control-tower/staging-guard-session.test.py:101,119,166`（失败点 :106,:126,:171,:312,:327） | **非本卡引入**（未修复 main 同套件失败集逐条相同）；根因=夹具 brief 名无日期前缀 → 落 D366 日期窗口外 → 认领恒空 ⇒ **认领制回归覆盖当前失效** | **建议另立卡**（认领制回归覆盖修复） |
| **L5** | **既有红**：`today-by-name.test.sh` exit=1 | `line 67: DAY_WINDOW_RE: unbound variable`（eval 取自 `verify-parallel.sh` 函数体） | 非本卡引入（基线逐条一致） | 建议另立卡 |
| **L6** | **门禁台账假证据**：`.claude/bypass.log` 被测试写入 `TASK_ID=D331-test | AGENT=test` 的 `DEGRADED-PASS` + **不存在的 HASH** | 泄漏链：`tests/control-tower/tag-bypass-wiring.test.sh:215,260` 在临时 repo 调**真实** `synova-commit` → `scripts/control-tower/synova-commit:34` 用 `PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"`（**按脚本位置**而非 cwd/git 根）→ `:36 BYPASS_LOG="$PROJECT_ROOT/.claude/bypass.log"` **恒指真实仓库** → `:701/:725` 写入 | **非本卡引入**（main 上已有 53 行同型）；污染 `check-bypass-log` 类审计与「24h 绕过」核查可信度 | **建议另立卡**：`BYPASS_LOG` 需可注入/可重定向 + 测试隔离；这是**审计可信度**问题，优先级应高于 L4/L5 |
| **L7** | `check-silent-swallow.sh --diff` 对本卡输出「无新增 .sh — 跳过」= **真空绿** | `scripts/pre-commit-check.sh:554` | 该 Done 项对「修改既有 .sh」类变更**不构成实质校验** | 建议另立卡（或至少在后续卡改用 `--utf8` 增量口径） |
| **L8** | 套件用例 21 的生产接线检查依赖 `REPO_DIR`，移出树即误红 | `tests/control-tower/resolve-commit-brief.test.sh`（D1069 追加段用例 21） | 测试可移植性小缺口 | 可随下次触及时修 |
| **L9** | `check-silent-swallow.sh --utf8` 全仓存量红 17 个 .sh 缺 PYTHONIOENCODING 头块 | 明文见 `bash scripts/workflow/check-silent-swallow.sh --utf8` 输出（含 `scripts/control-tower/alloc-task-id.sh` 等） | 存量红，本卡文件**不在**名单内（`grep -c` = 0） | 建议另立卡批量补头块 |

### 跨卡簿记（M6：归属逐张收口）
- **D1065**（bypass.log 跨 PR 弄脏）：本卡**未碰** `scripts/pre-commit-check.sh`，与 D1065 争用面**零交集**；
  但本卡 diff 携带 `.claude/bypass.log` 17 行 —— 归属 D1065 域，已在 §2.4(a) 显式裁定并移交。
- **D1039 / #868**：本卡**未碰** `.github/workflows/ci.yml`（canary 追加同一处），争用面零交集。
- **#883 / #892 / #894**：本卡为上游阻塞解除件，合入后认领锚点失配解除，四条链可继续。

---

## 附件索引
| 件 | 路径 |
|---|---|
| 任务书（含冻结契约 规范 1–5） | `.claude/task-briefs/2026-09-29-D1069-resolve-commit-brief-强锚点失配修复.md` |
| C1–C5 原始输出（含 RED/GREEN 全文附录 A/B） | `docs/synova/product-lines/evidence/D1069/D1069-C1C5-原始输出.md` |
| 机器可读证据 | `docs/synova/product-lines/evidence/D1069/D1069-anchor-fix-evidence.json` |
| 独立自验（V1–V12 + L1–L8） | `docs/synova/product-lines/evidence/D1069/D1069-独立自验.md` |
| 决策 Note（铁律 49 / D534） | `memory/notes/implemented/2026-09-29-D1069-resolve-brief-anchor.md` |
| 本件（收尾三件） | `docs/synova/product-lines/evidence/D1069/D1069-收尾三件-diff-自验结论-遗留清单.md` |
