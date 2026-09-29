# D1061-V · 独立自验报告（verifier）

> 任务: `task-4`（D1061-V · 独立自验）｜ 写者: **`verifier`**（独立成员，**不兼任编码**）
> 复核工作树: `.synova-wt-squad-d1061-verify`（独立，未复用他人树），基线 `20b55eba`（= origin/main）
> 生成: 2026-09-29

## 〇、口径与结论词声明

- 本报告**只使用三种结论词**：`自验结论` / `可提请独立审计` / `退回（附理由）`。
- **本报告永不含「审计通过」**。通过与否归 **CTO 收件闸 + K3 终审**。
- 所有数字均来自**命令原始输出**，禁手写；关键扫描**不截断**并标注「共 N 处」。
- 重型验证（vitest / 全量门禁 / 黄金门禁）**串行 ≤1**，用 `/tmp/.synova-d1061-heavy.lock` 排队（已按队长修订版加**属主校验**）。

## 〇-a、基线漂移登记（**重要**）

复核期间 `origin/main` **前移了**：

```
20b55eba  →  d9955cfb   （Merge PR #875；内含 #882 = D1052 注入夹具 b 面排除 docs）
$ git diff --name-only 20b55eba..origin/main | grep -E '<本卡写集>'
（未触碰本卡任何写集文件）
```
- 影响 1：**`origin/main...` 系列 diff 的基线已改用 `d9955cfb`** 复核（见 §4.1 复算）。
- 影响 2：**b 面基线由 14 → 15**（新增的第 15 条 = `memory/notes/proposed/2026-09-28-d1052-a-face-selfmatch.md`，由 #882 合并列车带入）。
- 影响 3：`main` **未触碰** D1061 任何写集文件 ⇒ 本卡两条分支 rebase 不受影响。

## 〇-b、本轮状态总览（诚实登记）

| 被验对象 | 分支 | 复核 sha | 状态 |
|---|---|---|---|
| **PR-A**（task-1） | `chore/d1061-a-ci-speedup` | — | ❌ **远端无该分支**（`git ls-remote --heads origin \| grep d1061` 只有 PR-B）→ **未完成，未复核** |
| **PR-B**（task-3） | `chore/d1061-b-gate-mechanism` | `96135a1a` → `f116b911` | ✅ 已复核（另见 §七 待补项） |

**PR-A 正式复核（已推送 `adb83dc6` / PR #886 · 详见本文档 §十「PR-A 专章」）**

> 早期版本此处曾记录「PR-A 未推送」的预备观察与一次 `pgrep` 自查纠错；PR-A 推送后已升级为 §十 专章。**一次自查纠错保留在 §十-A-4**（曾据 `pgrep` 见 6 个实例怀疑夹具挂死 → 实测证伪：3 次独立运行均 1s 内 rc=0，6 个 PID 复查不变无新增 = 陈旧孤儿残留，**未据此下结论**）。

```
$ git ls-remote --heads origin | grep -i d1061
f116b91148be0087c7fa65b56543f1b32be369c0	refs/heads/chore/d1061-b-gate-mechanism
（共 1 处；PR-A 分支不在其中）
```

task-4 在 `task-1`+`task-3` 完成前 **blocked，系统拒绝 claim**（实测 `team_task_update action=claim` → `not ready to claim`），故本报告按「准备阶段可做的全部复核」交付。

---

## 一、前提复算（不采信自报）

| # | 声称 | 我的复算命令 | 原始输出摘要 | rc | 结论 |
|---|---|---|---|---|---|
| P1 | `D1060` 已被占用 | `bash scripts/control-tower/alloc-task-id.sh --check-id D1060` | `remote-branch feat/D1060-synova-workbench` / `local-branch …` / `worktree-name .synova-wt-d1060` | **1** | `自验结论` = 独立复现成立 |
| P6 | R8 自冻结（`D[0-9]{3}` 截断） | `printf '派单 D1060 与 D1061\n' \| grep -oE 'D[0-9]{3}'` | `D106` | 0 | `自验结论` = 独立复现成立 |
| P7 | G10 幽灵门（变量恒空） | `grep -cE '(^\|[[:space:]])(export[[:space:]]+)?STAGED_FILES=' scripts/pre-commit-check.sh` | `0`；使用点 `3`（`:1203` `:1225` `:1230`） | 0 | `自验结论` = 独立复现成立 |
| — | 残留基线 a 面 = 0 | `git grep -c INJECTED-RED -- <dir>` | `src 0 / tests 0 / scripts 0 / .github 0` | 0 | `自验结论` = 独立复现成立 |
| — | 残留基线 b 面 = 14，全在 docs（**基线已漂移至 15**，见 §〇-a） | `git grep -l INJECTED-RED` | **共 14 个文件**，逐条全在 `docs/**` | 0 | `自验结论` = 独立复现成立（当时基线 `20b55eba`） |
| — | 建卡器不初始化 `write_set` | `grep -c write_set task-state/D1061.json` | `0`；生成点 `alloc-task-id.sh:375` | **1** | `自验结论` = 独立复现成立 |

b 面 14 条原始清单（不截断，全部 `docs/**`）：
```
docs/synova/audit-reports/2026-09-20-K3-D854.md
docs/synova/coordination/D1028-交付与遗留.md
docs/synova/coordination/D1028-假绿专题-并卡材料.md
docs/synova/coordination/总计划-双DSH提升-W1波-20260923.md
docs/synova/coordination/收件闸检查单.md
docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
docs/synova/presets/synova-squad-lead/cordis.patch.yml
docs/synova/product-lines/evidence/D1028-A2/03-自验结论-原样转存.md
docs/synova/product-lines/evidence/D1028-A2/03d-静态复核-原始.txt
docs/synova/product-lines/evidence/D1028-A2/06d-判据台账v2-原始.md
docs/synova/product-lines/evidence/D1050-B2/A-03-outbound-gates.json
docs/synova/product-lines/evidence/D922-phase0-verify-20260923.md
docs/synova/product-lines/evidence/D935-20260924/closeout.md
docs/synova/product-lines/evidence/D935-20260924/self-verify.md
共 14 个文件
```

---

## 二、N1 归因复算（CI 真跑，不采信自报）

**取数命令（可复跑）**
```bash
TOK=$(grep -E '^\s*GITHUB_TOKEN:' ~/.dsh/.credentials.yaml | sed 's/.*GITHUB_TOKEN:[[:space:]]*//' | tr -d '\r\n')
curl -s  -H "Authorization: token $TOK" \
  "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/36457345292/jobs?per_page=100"   # 取 windows job id
curl -sL -H "Authorization: token $TOK" \
  "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/jobs/109046960841/logs" -o /tmp/winct.log
# 解析: 行首 ISO 时间戳 + CI 自打 `── <test>` 标记间差值
```

**我的解析结果（44 标记，标记间合计 1591s）**

| 排名 | 测试 | 我的实测 | 队长自报 |
|---|---|---|---|
| 1 | `simulate-ci.test.sh` | **1050s** | 1051s |
| 2 | `gate-failopen-net.test.sh` | 135s | 120s |
| 3 | `alloc-task-id-lock.test.sh` | 99s | 99s |
| 4 | `check-gate-integrity.test.sh` | 72s | 72s |
| 5 | `platform-checklist.test.sh` | 44s | 45s |

- **占比 = 1050/1591 = 66.0%**（队长自报 65%）→ `自验结论` = **N1 归因独立复现成立**
- 前 5 名 = **1400s / 1591s = 88.0%**
- job 级：`Control Tower Gate Tests (windows-latest)` = 1632s，其中**单一步骤** `Run hermetic control-tower gate tests` = **1618s（99.1%）** → 全部成本就在密封清单内

**机制复核（深度恰为 1，无更深递归）**
- `tests/control-tower/simulate-ci.test.sh:37,47,52` → 3 次 `bash "$SIM"`
- `scripts/control-tower/simulate-ci.sh:49` 提取清单（排除自身）；`:53-64` 逐条 `GITHUB_ACTIONS=true bash "$ROOT/$t"`
- **44 条内层套件逐条 grep `simulate-ci.sh` → 零命中**（无更深嵌套）
- `synova-submit.test.sh` 用 `SYNO_SUBMIT_SIM_CMD` 绿桩 → 不触发真实 simulate-ci
- ⇒ 嵌套 = 44 × 3 = **132 次，深度 1** — `自验结论` = 独立复现成立

---

## 三、时间对比复核（**两口径分列，禁混用**）

| 口径 | 我的样本 | 我的中位 | 队长样本 | 队长中位 |
|---|---|---|---|---|
| **run 墙钟** | n=14 真跑（wall≥1400s） | **2146s** | n=18 | 2104s |
| **windows CT 腿** | n=14（同批配对） | **2141s** | n=25 | 2035s |
| 腿/墙钟 | 同批配对 | **99.8%** | — | 99.8% |

⇒ `自验结论` = **windows CT 腿即关键路径**（腿 ≈ 墙钟），独立复现成立。

**目标可达性（两口径分别算；未决，待 PR-A 实测）**
- run 墙钟口径（目标 ≤480s）：`2146 − 1050 = 1096s ≈ 18.3min` → **仍差 2.3×**
- windows CT 腿口径（目标 ≤300s）：`2141 − 1050 = 1091s ≈ 18.2min`；同 run 口径腿 1632→**582s**、腿内测试合计 1591→**541s**
- ⇒ **单靠 N1，两个口径都达不到目标**。必须叠加「选择器子集筛选」并给**合计**实测。
- ⇒ 结论词：**未决 —— 待 PR-A 收件闸给两口径的「基线 / 改后 / 取数命令」**。**禁止**只报 N1 单项即宣称达标。

---

## 四、PR-B 逐条复核（sha `96135a1a`；靶点已在 `f116b911` 静态确认仍在）

### 4.1 红线与残留

| 声称 | 证据（命令 + 原始输出） | 结论 |
|---|---|---|
| 不碰 `src/**`、`scripts/audit/**` | `git diff --name-only origin/main...96135a1a \| grep -E '^(src/\|scripts/audit/)'` → **空（共 0 处）** | `自验结论` = 零越界 |
| 零注入残留 | a 面 `src 0 / tests 0 / scripts 0 / .github 0`（新 main 复算同为 0）；b 面见下 | `自验结论` = 零新增 |

**b 面复算（对**新**基线 `d9955cfb` 做差集，禁只看单侧）**
```
新 main b 面 = 15 个文件（15th = memory/notes/proposed/2026-09-28-d1052-a-face-selfmatch.md，由 #882 带入）
PR-B  b 面 = 14 个文件
差集: 仅新 main 有 = memory/notes/proposed/2026-09-28-d1052-a-face-selfmatch.md
      仅 PR-B 有 = （空）   ← PR-B 新增 = 0
```
⇒ PR-B 的 b 面是当前 main 的**严格子集**，**零新增**。（PR-B 分支基于 `20b55eba`，故不含 #882 带入的那 1 条；合并后自动继承 main 的 15。）

### 4.2 写集对照（16 文件，逐条核）

全量清单（禁截断，**共 16 个文件**）：
```
.claude/bypass.log
.claude/task-briefs/2026-09-29-D1061-CT提速+门禁机制修正.md
docs/synova/product-lines/evidence/D1061/B-证据-熔断与推前预演.md
docs/synova/product-lines/evidence/D1061/B-证据.json
memory/notes/proposed/2026-09-29-d1061-gate-mechanism.md
scripts/control-tower/alloc-task-id.sh
scripts/control-tower/brief_parser.py
scripts/control-tower/gate-circuit-breaker.sh
scripts/control-tower/gate-incident-registry.json
scripts/pre-push-check.sh
scripts/workflow/pre-push-preview.sh
task-state/D1061.json
tests/control-tower/alloc-task-id.test.sh
tests/control-tower/brief-parser-cjk-path.test.sh
tests/control-tower/gate-circuit-breaker.test.sh
tests/control-tower/pre-push-preview.test.sh
```
- 全部落在 task-3 声明写集内；**唯一例外** `.claude/bypass.log` —— +2 行，均为
  `COMMITTED | pre-commit PASS (hook 层登记) | HASH=f1e8be91… / ac96bacf…`
  ⇒ **auto-hook 正常登记，非绕过**；属治理产物，按 D860 不计 PR 预算。
- `.github/workflows/ci.yml` **未出现** → 正确遵守「待 PR-A 合并后 rebase」排期。
- ⇒ `自验结论` = 写集互斥成立（无越界）。

### 4.3 四个夹具独立重跑（不采信自报）

| 夹具 | 我的 rc | 我的结果 | real |
|---|---|---|---|
| `gate-circuit-breaker.test.sh` | **0** | 19 通过 / 0 失败 | 2.50s |
| `pre-push-preview.test.sh` | **0** | 16 通过 / 0 失败 | 6.42s |
| `brief-parser-cjk-path.test.sh` | **0** | 11 通过 / 0 失败 | 2.42s |
| `alloc-task-id.test.sh` | **0** | 全绿 | 2.47s |

### 4.4 变异体复核 —— 「改坏一行 → 断言必须变红」（全部在 `/tmp` 独立工作树）

| # | 改坏对象（单行） | 基线 rc | 改坏 rc | 变红的断言（原始输出） |
|---|---|---|---|---|
| **B1** | `gate-circuit-breaker.sh:157` `"active": bool(exp_ok and d >= today)}` → `"active": True}` | 0（19/0） | **1（15/4）** | `❌ 边界: rc=3（过期必须不跳 = 0）`<br>`❌ 边界: 过期无告警`<br>`❌ 边界: → GATE-HEALTH: status=KNOWN-FAULT known=1 expired=0 …`<br>`❌ 边界: DEGRADED rc=0（期望 1）` |
| **B2** | `pre-push-preview.sh:114` `BO="$(bash "$CHECK_BRIEF" "$BRIEF_FILE" 2>&1)"; BRC=$?` → `BO=""; BRC=0` | 0（16/0） | **1（12/4）** | `❌ 边界: 缺 #CRITERIA rc=0（期望 1）`<br>`❌ 边界: 未点名 #CRITERIA`（共 4 条） |
| **B3** | `alloc-task-id.sh:389` 删 `  "write_set": []` | 0 | **1（54/2）** | `❌ 11b 骨架缺 write_set 键（新卡三源皆空 → D708 fail-closed）`<br>`❌ 11b write_set 非空数组/非合法 JSON（骨架契约偏离）` |
| **B4** | `brief_parser.py:131` `if not PATH_SHAPE_RE.match(path):` → `if True:` | 0（11/0） | **1（9/2）** | 2 条（CJK 路径被截断相关） |

- 每条跑完即 `git checkout -- <file>` 还原；**收尾 `git status --short` 为空**（已验证）。
- ⇒ `自验结论` = **四个夹具对各自靶点具判别力**（≠「通过」）。

### 4.5 CTO 三条附加要求

| # | 要求 | 我的复算 | 结论 |
|---|---|---|---|
| ① | 推前**一行命令** | `bash scripts/workflow/pre-push-preview.sh --fast` → **rc=0，real 0.73s**（≤10s 达标）；输出内含该行命令；brief 绑定失败走**显式可见降级**（`⚠️ SKIP（显式，不静默）`） | `自验结论` = 落地 |
| ② | `GATE-HEALTH:` **一行** | `GATE-HEALTH: status=OK known=0 expired=0 sources=1 checked_at=2026-09-29T02:34:03Z`；用冻结正则逐字段校验 → ✅ 匹配（键序固定 + ISO8601） | `自验结论` = 落地（格式符合冻结契约） |
| ③ | 每项实测前后对比进回执 | B 证据文件内自报（含三态）；**我的独立变异体复核见 §4.4** | `自验结论` = 变异体侧独立成立 |

### 4.6 接线复核（「接线了」≠「被执行」）

| 声称 | 证据 | 结论 |
|---|---|---|
| `pre-push-preview.sh` 被 `pre-push-check.sh` 调用 | `:467` `if ! bash "$PREVIEW" "--${SYNO_PREVIEW_MODE:-fast}"; then … exit 1; fi` → **失败直接阻断推送**（真执行，非仅声明） | `自验结论` = 真执行成立 |
| 缺件行为 | `:458` 缺文件 → **fail-open + 可见告警**（`⚠️ pre-push-preview.sh 缺失 — 预演跳过 (fail-open, 可见)`） | 按队长裁定：**沿用既有 fail-open 语义（可见告警，非静默），不作缺陷项** |
| ⚠ **判别性缺口** | 因缺件 fail-open ⇒「**删掉文件即红**」**不成立**；正确判别子是「**preview 非 0 ⇒ 推送被阻断**」。已派 coder-b 做**夹具层注入失败桩**；**端到端不可行的理由**：会被更早的 `golden-case F1` 门禁先拦（`npx tsx scripts/ci/golden-case-checker.ts`，新 /tmp 树缺 node_modules 实测先红），且会触发 `vitest --changed` 重型 | **`可提请独立审计` 前的未清项**（见 §七） |
| ⚠ **现有接线断言是 grep 型（弱）** | `tests/control-tower/pre-push-preview.test.sh:88-89` 仅 `grep -n "pre-push-preview.sh" … \| head -3` → 文件里出现字符串即判「已接线」，而 `:458` 的 fail-open 分支同样会命中 ⇒ 命中 **坑清单第 7 条「禁 grep 型静态判据当验收」** | 记录：**以新增注入桩判别子为准**，不采信该 grep 断言 |

### 4.7 `GATE-HEALTH:` 消费方复核（**本轮最有价值的发现**）

```
$ grep -rn 'GATE-HEALTH' --include='*.sh' --include='*.ts' --include='*.py' --include='*.json' --include='*.yml' --include='*.md' . | wc -l
共 14 处
```
逐条归属：`scripts/control-tower/gate-circuit-breaker.sh:234`（产出点）+ `:41`（文档）+ 其自身测试 `gate-circuit-breaker.test.sh:50/92/102` + `B-证据.json` + `B-证据-熔断与推前预演.md` + `memory/notes/proposed/…`
⇒ **生产消费方 = 0**。

`自验结论` = **「有能力 + 冻结契约 + 可复跑命令」，但未接线到消费方**。
消费方（D963 工作台面板）在另一在飞工作流 ⇒ **必须记为遗留**；**禁止**任何「已接线到面板」的说法。

### 4.8 `--utf8` 复核（队长 ⑤③）

**基线差集口径（关键：该检查在 main 上本就 rc=1，不能当红绿判据）**
```
基线 origin/main : check-silent-swallow.sh --utf8 → rc=1，❌ 17 个 .sh 缺头块
PR-B  96135a1a   : → rc=1，❌ 16 个 .sh 缺头块
差集: 仅 PR-B 有 = （无）   仅 main 有 = scripts/control-tower/alloc-task-id.sh
```
⇒ `自验结论` = **PR-B 零新增 UTF-8 违规，且修好 1 条存量**（`alloc-task-id.sh` 头块，main 计 0 → PR-B 计 1）。

`pre-push-preview.sh` 头块实测（第 2–4 行，`PYTHONIOENCODING` 在**第 3 行**）：
```
1  #!/bin/bash
2  # D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
3  export PYTHONIOENCODING=utf-8
4  export LC_ALL=C.UTF-8 2>/dev/null || true
```
并核对真实判定逻辑 `check-silent-swallow.sh:45,81` 只 `grep -q "PYTHONIOENCODING"`、**不约束"前 3 行"** ⇒ 该文件**通过真实门禁**。（我先用更严的"前 3 行"启发式误报过一次假红，已改口径：**以真实检查器为准**。）

---

## 五、红线复核（绕过痕迹）

| 项 | 证据 | 结论 |
|---|---|---|
| `--no-verify` | `grep -c 'detected-bypass' .claude/bypass.log` = **22**（全史）；**最近一条 = 2026-09-25T00:56:43Z**（4 天前）→ **24h 内 0 条、D1061 本轮 0 条** | `自验结论` = 零绕过 |
| 门禁拒绝 ≠ 绕过 | 行分布 `COMMITTED 1457 / BLOCKED 163 / GATE_FAIL_SOFT 101 / DEGRADED 52 / TIMEOUT 3 / CLARIFIED 1` — `BLOCKED` 是门禁正常拒绝 | 区分正确 |
| `git stash` | `git stash list` = 2 条，日期 **2026-09-08 / 2026-09-05**，分支 `fix/d597-*` / `verify-d575` → **存量旧债，非 D1061** | `自验结论` = 本小队未用 stash |
| force push | `git reflog --date=iso \| grep -inE 'stash\|push -f\|force'` 唯一命中 = `en**force**_admins`（**假阳性**） | `自验结论` = 无 force push |

---

## 六、小队运行记录（成员 · 状态 · 共享任务）

| 成员 | 角色 | 共享任务 | 任务状态 | 本轮可见运行 |
|---|---|---|---|---|
| `lead` | 队长（不下场写码） | — | — | 协调/裁定/改锁协议 |
| `coder-a` | 编码（PR-A 提速线） | `task-1` | `in_progress` | 分支**未推送**；本地跑过 `GITHUB_ACTIONS=true` 基线计时 |
| `coder-b` | 编码（钥匙 + PR-B） | `task-2` / `task-3` | `in_progress` / `in_progress` | PR-B 已推 `f116b911`；另推 `fix/d1052-injection-residue-exclude-docs` |
| `verifier` | **独立自验（不兼任编码）** | `task-4` | **blocked（未 claim）** | 本报告 |

---

## 七、未清项（`退回（附理由）` / 未决清单）

1. **PR-A 全部复核未做** —— 分支未推送（远端零命中）⇒ PR-A 侧**无结论**。
2. **门禁 8 夹具层判别子未到** —— 需 coder-b 注入失败 preview 桩并断言 `pre-push-check.sh` rc 非 0；到件后我复核。
3. **PR-B 最终 sha 上的四变异体重跑** —— 靶点已在 `f116b911` 静态确认仍在（B1 `:157`、B2 `:114`、B3 `:389`、B4 `:131`），因重型锁被他人持有未跑。
4. **`simulate-ci.test.sh` 本地基线计时** —— 首轮因**三实例并发**污染（我已主动让位，见 §八），仍待机器安静窗口重跑。**该数字是 PR-A 前后对比的前提，不得用被污染值。**
5. **`GATE-HEALTH:` 无生产消费方** —— 记遗留，禁称已接线到面板。
6. **`check-silent-swallow.sh --utf8` 在 main 上本就 rc=1（存量 17）** —— 建议 CTO 收件闸改为**基线差集**口径，否则每个 PR 都会被判红或拿存量债冒充新债。

---

## 八、异常登记

### INC-1 · 重型验证三实例并发（2026-09-29 10:02–10:15）
`pgrep -fl` 实测同时存在 3 个 `simulate-ci.test.sh`：coder-a ×2（PID 9043/9044、35507/35508）+ verifier ×1（46495/46506）。
- **我的处置**：**主动让位** —— kill 自身实例 + 释放锁。理由：**我的 origin/main 基线可随时复现；coder-a 的前后对比不可事后复现**，让机器安静给它更值。
- **暴露缺陷**：锁 = 裸目录无属主校验，非属主 `rmdir` 会释放他人锁 ⇒ 两个成员都以为自己持锁。
- **处置**：队长已改为 **owner 校验协议**，全员生效（`mkdir` 后写 `owner`，释放前校验属主）。
- **正面范例**：coder-b 的等待者用**有界重试 + 显式放弃语义**（`仍 BUSY（5min 未释放）——按串行纪律放弃本次，不并发`）。

### INC-2 · verifier 曾在主树误跑一次 `pre-push-check.sh`
`git worktree add` 用了非法分支名（`/tmp-d1061-pb-test`）→ 后续 `cd` 失败，命令落在主树。
- **自查归因**：主树 `M` 文件 mtime = **Sep 27 08:00 / Sep 28 15:51**，**早于我 10:34 的运行** ⇒ **非我造成**；**我未修改主树任何文件**。
- **纪律修正**：以后 `git worktree add` 失败**先断言 `pwd`** 再执行后续命令。

---

## 九、结论词汇总

| 判据 | 结论词 |
|---|---|
| 前提 P1 / P6 / P7 复算 | `自验结论` = 独立复现成立 |
| 残留基线 a=0 / b=14 | `自验结论` = 独立复现成立 |
| N1 归因（1050s / 66.0%） | `自验结论` = 独立复现成立 |
| 机制（132 次 / 深度 1） | `自验结论` = 独立复现成立 |
| windows CT 腿即关键路径（99.8%） | `自验结论` = 独立复现成立 |
| 目标 ≤5min / ≤8min 可达性 | **未决** —— 待 PR-A 合计实测（N1 单独两口径均不足） |
| PR-B 红线 / 残留 / 写集 | `自验结论` = 零越界、零新增 |
| PR-B 四夹具 rc=0 | `自验结论` = 我独立重跑全绿（≠ 通过） |
| PR-B 四变异体 | `自验结论` = 四个夹具具判别力 |
| CTO 附加① / ② | `自验结论` = 落地 |
| CTO 附加③ | `自验结论` = 变异体侧独立成立 |
| `pre-push-preview` 接线 | `自验结论` = 真执行成立；**判别子待补** |
| `GATE-HEALTH:` 消费方 | `自验结论` = **未接线到消费方** → 遗留 |
| 红线（bypass/stash/force） | `自验结论` = 零绕过 |
| **PR-A 整体** | 见 §十（CI 证据面 `退回`；其余面 `可提请独立审计`） |
| **本报告整体** | **`可提请独立审计`（PR-A 非 CI 面 + PR-B）+ CI 面未清**；**不构成任何"通过"** |

---

## 十、PR-A 专章（分支 `chore/d1061-a-ci-speedup` @ `adb83dc6` · PR #886）

### 十-A-1 独立性登记（队长要求如实记录）

**coder-a 全程停滞未提交，PR-A 的提交与推送由队长代做**（代码作者仍为 coder-a）。
⇒ 独立性口径：被验产物 = **coder-a 的代码 + 队长的提交/推送动作**。我（verifier）与**两者均非同人** ⇒ 独立性成立；但「编码者 ↔ 提交者」不一致本身是**流程异常**，登记为流程事实（非缺陷）。队长另代打的 9 处 `# swallow-ok:` 注释见 §十-A-4。

### 十-A-2 红线 / 残留 / 写集

| 项 | 我的复算（命令 → 原始输出） | 结论 |
|---|---|---|
| `src/**` + `scripts/audit/**` | `git diff --name-only origin/main...adb83dc6 \| grep -E '^(src/\|scripts/audit/)'` → **空（0 处）** | `自验结论` = 零越界 |
| 禁碰面四文件 | `simulate-ci.test.sh` / `pre-commit-check.sh` / `merge_writeset_gate.py` / `precommit-groups-injection.test.sh` → **四项均 ✅ 未碰** | `自验结论` = 遵守禁碰 |
| a 面残留 | `src 0 / tests 0 / scripts 0 / .github 0` | `自验结论` = 零残留 |
| b 面残留 | 当前 main = **15** → PR-A = **17**；差集「仅 PR-A 有」= **2 条** | 见下 |
| 写集 | 15 文件：**11 在 task-1 声明内** + 1 治理产物（`.claude/bypass.log` auto-hook）+ **2 条队长追加授权**（派单件 `dispatch/2026-09-29-D1061-…md`、前提证据 `00-前提实测-原始输出.md`）→ **越界 0** | `自验结论` = 无越界 |

**b 面 +2 的口径要点（给 CTO 收件闸）**：新增 2 条**正是队长追加授权由 PR-A 承载的**派单件与前提证据；二者**天然含 `INJECTED-RED` 字样**（证据文件在引用该串）。
按 **#882（已合入 main）新口径**「b 面残留断言不再把 `docs/` 计入」⇒ **合法**。
⚠ **但若用「b 面必须等于基线 15」这类朴素判据，会把 PR-A 的 +2 误判成新增残留。**

### 十-A-3 夹具独立重跑

| 夹具 | 我的 rc | real |
|---|---|---|
| `tests/control-tower/ct-suite-select.test.sh` | **0** | 4.97s |
| `tests/control-tower/simulate-ci-dedup.test.sh` | **0** | 1.18s |

### 十-A-4 队长代打的 9 处 `# swallow-ok:` —— **这 9 处是真的，且承重；但「`--diff` 0 命中」本身有陷阱**

1. **陷阱（重要）**：`check-silent-swallow.sh --diff` 的**输入是 `git diff --cached`（已暂存区间）**（实现 `scripts/workflow/check-silent-swallow.sh:104`）。
   在**已提交的 PR 上直接跑** → 暂存区为空 → 输出 **`[silent-swallow] ✅ 无新增 .sh — 跳过`**、`rc=0`。
   ⇒ **这个 rc=0 是空绿（vacuous），不能作为「豁免有效」的证据。**（我复现了这一步）
2. **正确用法**：把 PR 变更置入暂存区（我用 `git reset --soft origin/main` → 43 文件入暂存）后重跑 → **rc=0，`[silent-swallow] ✅ 无新增静默吞错`**。
3. **判别性证明（改坏即红）**：把 `ct-suite-select.test.sh` 的 **9 处 `# swallow-ok:` 注释全部剥掉**（保留 `2>/dev/null`）后重跑：
```
[silent-swallow] ❌ tests/control-tower/ct-suite-select.test.sh: +OUT=$(sel --all 2>/dev/null); RC=$?; N=$(cnt "$OUT")
[silent-swallow] ❌ …（共 8 行逐条点名）…
[silent-swallow] ❌ 8 处新增静默吞错（如需豁免加 # swallow-ok: 注释）
rc=1
```
⇒ `自验结论` = **9 处豁免真实且承重；改坏即红（rc 0→1，8 条逐条点名）**；还原后复跑回到 `✅`。
4. **备注**：9 处中**第 9 处（`PLAT_N=` :180）冗余** —— 该行已有 `|| true` 命中「同行 fallback」自动豁免。**无害，非缺陷。**

### 十-A-5 变异体 A1–A6（改坏一行 → 断言必须变红）

| # | 改坏对象 | 基线 | 改坏后 | 变红的断言（原始输出） |
|---|---|---|---|---|
| **A1** | `simulate-ci.sh:76` `if [ "$SKIP_NESTED" -eq 1 ]; then` → `if false; then` | rc=0 | **4 条红** | `❌ CI 环境应 0 条内层执行（rc=0 实跑 2 条）`<br>`❌ CI=true 应 0 条（rc=0 实跑 2 条）`<br>`❌ 跳过未打印原因（静默风险）`<br>`❌ degraded 日志缺 N1 事件` |
| **A2** | `simulate-ci.sh:66` IS_CI 判定 → `if false; then` | 内层 **0** 次 | 内层 **2** 次 | 沙箱直测：原始 = 0 次 + `⏭ 段 2/2 显式跳过`；变异 = 2 次跑满内层 |
| **A3** | `ct-suite-select.sh:178` `FORCE_FULL=0` → `1` | rc=0 | rc=1，**7 条红** | `❌ 正常路径应只选 A 域 1 条，实际 3 条`<br>`❌ windows 应 2 条，实际 3`<br>`❌ 摘要行缺 selected_of_total`<br>`❌ D2 不符（rc=0 n=3）`<br>`❌ D4 不符（rc=0 n=3）` |
| **A4** | `ct-suite-select.sh:254` `if [ "$SEL_N" -eq 0 ]; then` → `if false; then` | rc=0 | rc=1，**2 条红** | `❌ D4 不符（rc=0 n=0）`（0 选中静默通过被捕获） |
| **A5** | 映射缺失（不改码，直接行为） | — | — | `[D1061-DEGRADED] code=D1 reason=映射缺失或非法 … → **回退全量**（fail-closed，绝不静默缩小）` + `selected_of_total=54/54 degraded=1` + degraded 日志落盘 1 行 ⇒ **显式回退，非静默 0 条** ✅ |
| **A6** | `simulate-ci.sh` 非法值分支 `SKIP_NESTED=0` → `1` | 非法值 → **按 full 跑内层 2 条** + `⚠ SYNO_SIM_NESTED='BOGUS' 非法（期望 auto\|full\|skip）— fail-closed 按 full 执行` | 非法值 → **静默 skip，内层 0 条，无「非法」告警** | ⇒ 判别成立 |

- A3/A4 额外暴露一条**好行为**：我的变异与夹具自身变异锚点重叠时，夹具打印
  `❌ 变异体①/②锚点未命中（脚本结构已变，夹具须同步）` → **fail-loud，不静默跳过**。
- **A6 覆盖缺口（登记，非缺陷）**：`simulate-ci-dedup.test.sh` 头注释声明「非法值 fail-closed 按 full」，但**夹具内无对应断言**（全文 grep 零命中）。该语义目前**只由我的直接行为测试守护**；建议补一条断言。
- 全部实验在 `/tmp` 副本上做（注入缝 `SYNO_SIM_BIN` / `SYNO_CT_SELECT_BIN`）；真实文件零改动，收尾 `git status --short` 为空（期间一次 `reset --soft` 仅动索引，已 `reset --hard` 复原）。

### 十-A-6 `ci.yml` 接线判别子（「接线了」≠「被执行」）

1. **真调用点**：`.github/workflows/ci.yml:427`
   `TESTS="$(bash scripts/control-tower/ct-suite-select.sh --changed origin/main...HEAD --platform "$CT_PLATFORM" 2>/tmp/ct-select.log)"`
   我**原样执行该命令**（windows 面）→ `rc=0`，stderr：
   `[D1061-SELECT] mode=select platform=windows changed=15 selected_of_total=54/54 degraded=0`
   ⇒ **选择器确实被执行**（非仅字符串在场）✅
2. **单源一致性（我一开始判错，已自查纠正）**：用「整文件 grep」得 catalog=47，一度以为选择器输出含 7 条 catalog 外条目 → **错**。用正确口径（`awk '/for t in \\/,/; do$/'` 提取 job 的 for 块）得 **54**，与选择器 `--all` 的 **54** **双向差集为 0** ⇒ **同一单源、完全一致**，`⊆ catalog` 守卫**不会误触发**。
3. **fail-closed 守卫已实测**：
   - 非法区间 `--changed '~1...'` → `[D1061-DEGRADED] code=D5 reason=变更范围不可解析 … → 回退全量（fail-closed，绝不静默缩小）`，`selected_of_total=54/54 degraded=1` ✅
   - `.github/workflows/*` → map 规则 `{"glob": ".github/workflows/*", "domains": ["__FULL__"], "why": "CI 定义自身变更 ⇒ 选择器前提失效（D1061）"}` ⇒ **PR-A 自身 54/54 属设计内行为，非缺陷** ✅
   - `src/*` / `packages/*` → `__FULL__`（有意不缩小）✅
4. **缩小能力真实存在（真实区间验证）**：`--changed '9e7ffeb1~1...9e7ffeb1'`（**docs-only** 4 文件）→ `changed=4 selected_of_total=**29/54** degraded=0` ⇒ **真实缩小约 46%** ✅
   （对照：PR-B 区间 → 54/54，因其同时命中 5 个 ct 域 + doc-system = **6 域全覆盖** ⇒ 设计内。）
5. **⚠ 接线判别力的边界（须登记）**：**若删掉 `:427` 的选择器调用**，`TESTS` 为空 → 走 `TESTS="$CATALOG"` **回退全量** → **不会变红**（只会变慢）。
   即该接线的**失效模式 = 保守回退全量**，**现有测试抓不到**；夹具对它的"接线"断言是 **grep 型**（`grep -q "ct-suite-select.sh" "$CIY"`）。
   ⇒ 与 PR-B 门禁 8 同类：**弱判据**；但此处失效方向**安全（多跑，不会少跑）**，与门禁 8（预演不生效）性质不同。**登记，不判缺陷。**

### 十-A-7 时间对比（两口径）—— **已完成（CI 真跑，权威 run）**

**run `36528674633`**（event=pull_request, sha **`7d1a614c`**, created 05:57:54Z, updated 06:08:29Z, **`conclusion=success`**）
> 前一版 run `36527360094`（669s/665s，failure）**已作废**。

| 口径 | 改后（权威 run） | 基线 | Δ | 目标 | 达标 |
|---|---|---|---|---|---|
| **A · run 墙钟** | **635s（10.6 min）** | 中位 2146s（我 n=14 配对真跑） | **−70.4%** | ≤480s | ❌ **未达标**（差 155s） |
| **B · windows CT 腿** | **630s（10.5 min）** | 中位 2035s（队长 n=25）／2141s（我 n=14） | **−69.0%** | ≤300s | ❌ **未达标（2.1×）** |

- 腿/run墙钟 = **99.2%** ⇒ windows CT 腿**仍是关键路径**。
- 我独立取数复现：13/13 job 全绿（含前次 skipped 的 `Vitest (1/2)=170s`、`Vitest (2/2)=155s`、`Golden Case F1 Gate=29s`）。

**★ 口径声明（队长要求显式写明，供 K3 复核）**
本次选择集 = **`__FULL__`（55/55）**：
```
$ bash scripts/control-tower/ct-suite-select.sh --changed origin/main...HEAD --platform windows
[D1061-SELECT] mode=select platform=windows changed=18 selected_of_total=55/55 degraded=0
```
机制：**PR-A 自身改了 `.github/workflows/*`** → map 规则
`{"glob": ".github/workflows/*", "domains": ["__FULL__"], "why": "CI 定义自身变更 ⇒ 选择器前提失效（D1061）"}`
（`ct-suite-select.sh:195/:219`「首个命中生效 ⇒ 全量」）。
⇒ **630s 是「全量跑」口径下的数字，不含任何子集裁剪收益。**
子集收益只在**非 ci.yml 变更**的 PR 上体现（我实测 docs-only 区间 → **29/54**）。
**这正是队长裁定 A2 起点口径 (i) 的依据。**

### 十-A-9 CI 真跑失败项（F1/F2 已在 `7d1a614c` 修复，我逐条独立复核）

#### F1 · V5 平台敏感命令（D520）—— ✅ **已修（我独立跑门禁复现）**
```
$ SYNO_CI=1 bash scripts/pre-commit-check.sh        # PR-A 树 @ 7d1a614c，rc=1，wall=3s
:102  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)
$ grep 'ct-suite-select.sh: 平台敏感' f1.log        # → 零命中
```
- 修法实证：`:96 for _c in python3 python py; do  # D520: …`；`:105` 尾注 `# D520: 文案含字面量（非调用）`
- 我另用门禁 `:1538` 的**同款过滤词集**静态复算 → 命中为空 ✅
- ⚠ **本次门禁跑仍有 1 组红，但与本卡无关**：
  `❌ D2 登记门禁: 有未登记文档 2 处`（点名 `docs/synova/dispatch/2026-09-29-D1061-CT提速-门禁机制修正.md`）
  —— 属**共享注册表未登记**，队长已裁定留未清项；**CI 侧该 job 为 success**。**不得算作 F1 未修。**

#### F2 · windows CT 腿红 —— ✅ **已修；真根因 = `MAP_TSV` 未清 CRLF（PLATFORM-CHECKLIST #2 复发）**
`ct-suite-select.sh:128` 新增 `MAP_TSV="$(printf '%s\n' "$MAP_TSV" | tr -d '\r')"`。
机制：Windows python 文本模式输出 `\r\n` → 域名带尾 `\r` → 查表落空 → `D4` → 回退全量。

**① 常驻 CRLF 断言是否真能红 —— 我自己改坏（判别性证明）**
> **诚实登记**：我**第一次变异无效** —— 用 sed 剥 `tr -d '\r'` 产生了**语法错误**
> （`MAP_TSV="$MAP_TSV"| tr -d '\r')"`），失败**源于语法错而非语义** ⇒ 判为无效变异并作废重做。
第二次（**语法合法**，`bash -n` 通过）：
```
变异 :128  MAP_TSV="$(printf '%s\n' "$MAP_TSV" | tr -d '\r')"
      →     MAP_TSV="$(printf '%s\n' "$MAP_TSV")"
基线 26 通过 0 失败 → 改坏 rc=1 / 25 通过 1 失败
  ❌ CRLF 仿真下选择错误（rc=0 n=3）⇒ 域名带尾 \r 查表落空
     ｜ stderr=[D1061-DEGRADED] code=D4 reason=无域命中：选中 0 条（changed=1）——0 条静默通过被禁 → **回退全量**（fail-closed，绝不静默缩小）
```
⇒ `自验结论` = **常驻断言具判别力，且精确复现 CI 的 F2 签名（回退全量 3/3）** ✅

**② `init.defaultBranch` 假设 —— 我独立复算，确认已被证伪（与 coder-a 结论一致，无分歧）**
```
$ GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master \
    bash tests/control-tower/ct-suite-select.test.sh
rc=0   结果: 26 通过, 0 失败   ❌ 行数 = 0
$ GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=master \
    git config --get init.defaultBranch
master                     # ← 证明 env 真的生效，该对照不是空转
```
⇒ `自验结论` = **`init.defaultBranch` 假设确已证伪**（强制 `master` 下夹具仍 26/0）。
备注：当前夹具内**未见** `init.defaultBranch` 的常驻回归探针（grep 零命中）；因假设已证伪，无需常驻守护。

#### F3 · `#872` 夹具 —— ✅ 仍绿（非失败项）
`bash tests/control-tower/ci-signal-classify.test.sh` → `rc=0, 78 通过, 0 失败, 0 显式跳过`

### 十-A-9 CI 真跑失败项（**新增，两条独立阻塞**）

#### F1 · `TypeScript + Lint + Iron Laws` → V5 平台敏感命令（D520）

原始输出：
```
❌ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520): 1 处  [CI strict——软提示在 CI 上为硬阻断]
   scripts/control-tower/ct-suite-select.sh: 平台敏感命令（见 PLATFORM-CHECKLIST.md）
```
**根因（我定位到判定行）**：`scripts/pre-commit-check.sh:1538`
```bash
_pf_hits=$(grep -nE '\bpython3\b|date \+%s|date -v|grep -P' "$ROOT/$_pf" 2>/dev/null | grep -v 'PYBIN\|swallow-ok\|D520\|#' | head -3 || true)
```
即：grep 出含 `\bpython3\b` 的行，再**过滤掉**含 `PYBIN`/`swallow-ok`/`D520`/`#` 的行。
`ct-suite-select.sh:92` 为
```bash
for _c in python3 python py; do
```
—— 这正是 PLATFORM-CHECKLIST #1 **推荐的三级探测本体**，但该行**不含**过滤词 ⇒ 被点名。
讽刺点：**正确写法本身触发门禁**。同一门禁在 PR-B 上由 coder-b 用行尾 `# D520: …` 注释消解。
**消解**：给该行补 `# D520:`（或使该行含 `PYBIN`），与 PR-B 同法。**属一行修复。**

#### F2 · `Control Tower Gate Tests (windows-latest)` → PR-A **自建新夹具**在 Windows 红

原始输出：
```
FAIL: tests/control-tower/ct-suite-select.test.sh
##[error]  ❌ 正常路径应只选 A 域 1 条，实际 3 条: tests/control-tower/sel-a.test.sh|
          ❌ windows 应 2 条，实际 3| ❌ 摘要行缺 selected_of_total| ❌ D4 不符（rc=0 n=3）
```
- **签名**：选择器在 Windows 上走了**全量回退（3/3）**而非收窄（1/3）—— **与我的 A3 变异（`FORCE_FULL=1`）完全同签名**。
- **本地对照**：同一夹具在 **macOS 上 23 通过 / 0 失败**（我独立跑）。
- **root cause**：Windows 特定，**我未能在 macOS 复现**；候选回退码 = D1(`:183`)/D2(`:219,:236,:267`)/D3(`:169`)/D5(`:160`)/D6(`:198`)。
- ⚠ **排障障碍（关键观察）**：夹具 `:108` 的正常路径调用写作
  `OUT=$(sel --changed origin/main...l3only 2>/dev/null); RC=$?; N=$(cnt "$OUT")  # swallow-ok: …`
  —— **`2>/dev/null` 吞掉了 stderr 的 `[D1061-DEGRADED] code=…` 行**，而**那行正是定位本失败所需的唯一诊断**。
  换言之：**那 9 处 `swallow-ok` 豁免（本身合法、见 §十-A-4）遮蔽了本次排障的关键信息**。
  （夹具确有保留 stderr 的调用，见 `:115/:121/:128/:136` 的 `2>"$TMPD/e1"` 形式，但**正常路径这条没有**。）
- **处置建议**：在 Windows 上跑该夹具并**保留 stderr**（去掉 `2>/dev/null`，或改成 `2>"$TMPD/…"`）即可直接读出回退码 → 精确定位。

#### F3 · `#872` 夹具恢复 —— ✅ **已核实恢复（非失败项）**
```
$ bash tests/control-tower/ci-signal-classify.test.sh
rc=0  wall=2s   结果: 78 通过, 0 失败, 0 显式跳过
```
（Windows CT 腿日志中该夹具已通过，未出现在失败点。）

### 十-A-8 结论词（PR-A）—— **最终判定**

| 判据 | 结论词 |
|---|---|
| 红线 / 禁碰面 / a 面残留（新 sha `7d1a614c`，18 文件） | `自验结论` = 零越界、零残留 |
| b 面 main 15 → PR-A 17（+2） | `自验结论` = 合法（队长授权承载；须用 #882 docs 排除口径判） |
| 夹具 rc=0 | `自验结论` = `ct-suite-select.test.sh` 26/0、`simulate-ci-dedup.test.sh` 15/0（我独立重跑） |
| A1–A6 变异体 | `自验结论` = 6/6 判别成立 |
| A6 缺口闭合 + 完整性不变式（55 条集合相等） | `自验结论` = 均成立且**我独立做了判别性变异** |
| **F1（V5/D520）** | `自验结论` = **已修**（我独立跑 `SYNO_CI=1 pre-commit-check.sh`：V5 行 ✅，零点名；残留 D2 红与本卡无关） |
| **F2（Windows CRLF）** | `自验结论` = **已修**；常驻 CRLF 断言经我变异证明**具判别力并复现 CI 签名** |
| **F2-② `init.defaultBranch` 假设** | `自验结论` = **确已证伪**（强制 master 仍 26/0；env 生效已证） |
| `ci.yml:427` 接线 + 单源一致 + fail-closed | `自验结论` = 成立 |
| 选择器缩小能力 | `自验结论` = 真实成立（docs-only → 29/54）；**本次 PR-A 为 `__FULL__` 55/55，无裁剪收益** |
| **两口径时间对比** | `自验结论` = **已完成（权威 run `36528674633`）**：run 墙钟 **635s**（−70.4%）、windows CT 腿 **630s**（−69.0%） |
| 目标 `≤8min` / `≤5min` | **两口径均未达标**（635s > 480s；630s > 300s） |
| **PR-A 整体** | **`可提请独立审计`** —— 非 CI 面（红线/写集/残留/变异体/接线/缩小能力）与 CI 面（F1/F2 修复 + 两口径）**均已独立复核**；**目标达成度未达标**，由你与 CTO 裁定；**合并归 CTO，我不判通过**。 |

### 十-A-10 我自己的操作事故登记（诚实）

**LOCK-LEAK-1**：我在 A1–A6 变异批（被 `job_kill` 终止）时**泄漏了重型锁**（`/tmp/.synova-d1061-heavy.lock`，owner=`91941`），导致后续需要该锁的成员被挡约数小时。
- 发现：本轮开工前 `ls -d` 见锁仍在，且 `kill -0 91941` 证实该进程**已不存在**。
- 处置：按**属主校验**（owner=91941 且进程已亡）`rm -f owner && rmdir` 释放。**未误删他人锁。**
- 纪律修正：**被 kill 的批处理必须留 `trap ... EXIT` 兜底释放**，不能把释放写在脚本末尾（kill 时到不了）。
