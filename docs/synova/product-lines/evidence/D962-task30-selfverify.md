# D962 task-30 独立自验（V10 · 自验员 d962-verifier2）

> **自验员**：`d962-verifier2`（独立于编码成员 C；只读 + /tmp 副本，**未改任何仓库源文件**）
> **对象**：`feat/d962-2a-merge` @ **807b6b67**（`git ls-remote --heads origin` 实测同值；= PR #803 head）
> **方法**：`/tmp/d962v10/tree`（`git archive` 导出）+ `/tmp/d962v10/repo`（`git clone --shared`，`origin/main` 置 `ee721b0a`）；变异探针一律 same-path swap（改→跑→`git checkout --` 还原→sha 核对）；CI 侧证据走 **GitHub REST API 原始 JSON**（未认证只读）
> **主树**：开工 `b8573c7a` → 收工 `ee721b0a`（**CTO session 同期在使用主树**，非本自验所致）；本自验未改任何仓库源文件，主树唯一写入 = 本报告
> **口径**：全部数字来自本自验命令/API 原始输出；**未引用编码成员 C 的数字**；只给"自验结论"，不代表审计通过

---

## 〇、七项结论摘要

| # | 核对项 | 结论 |
|---|---|---|
| ① | grep-oP 根因独立复现（BSD ⇄ GNU 方言） | **成立**：BSD 本机命中 / GNU（ubuntu CI 原始注解）实得空；GNU 一方法义 = `\`` 为"整段输入起点"⇒ 双锚恒不匹配 |
| ② | Gate Integrity 修复（读码 + 真 run success） | **一致**：`git rev-parse --verify -q` 守卫在 `:552-553`；A/B 复现假红与修复；job **success**（API 原始输出） |
| ③ | Windows 修复（读码 + 本机复跑） | **一致**（macOS 侧）；Windows CI 腿 **in_progress ⇒ 不可判**（附 52f5aa1f 失败原文与预测） |
| ④ | T3 锚点抽核 ≥5 | **一致**（实核 **14/14** 条） |
| ⑤ | A9 before 侧 sha256 8/8 抽核 ≥3 | **一致**（自算 **8/8**：7 逐字节同 + 1 脱敏差异） |
| ⑥ | T5 21 条清单抽核 ≥5 + 零接线 5 条 | **一致**（21/21 逐条核；**零接线 5 条复核均 0 非自身引用**） |
| ⑦ | T6 P-a 仅 +1 条目 + CODEOWNERS 一致性 | **一致**（+3 行 = 1 条规则；PASS；CODEOWNERS 重生成 **零漂移**） |

**附（本自验自取的 CI 原始数据）**：head `807b6b67` PR run 14 job = **12 success / 1 failure（ubuntu control-tower）/ 1 in_progress（windows control-tower）**；修复前 `52f5aa1f` = **11 success / 13 cancelled / 3 failure**（Gate Integrity、windows、ubuntu）——即 3 红中 **2 红已闭**（②真 run success 实测 + windows 腿修复已入库待跑完），剩 1 红 = ① 的 GNU 方言项（供件待裁）。

---

## 一、① grep-oP 根因独立复现（自建 /tmp 夹具 + CI 原始原文）

### 1.1 BSD 侧（本机 `/usr/bin/grep` = `grep (BSD grep, GNU compatible) 2.6.0-FreeBSD`）

```
$ printf '改 `src/routes/a.ts` 完成\n' > /tmp/d962v10/bt.txt
$ grep -oE '\`[^\`]+\.[a-z]{2,5}\`' /tmp/d962v10/bt.txt
`src/routes/a.ts`        rc=0     ← BSD：`\`` = 字面反引号 ⇒ 命中
$ grep -oE '[`][^`]+\.[a-z]{2,5}[`]' /tmp/d962v10/bt.txt
`src/routes/a.ts`        rc=0     ← 供件方括号式在 BSD 侧等价（行为不变）
$ sed -n '/^## Q2:/,/^## Q3:/p' <brief> | grep -oE '\`…\`' | sed 's/\`//g'
src/routes/a.ts          rc=0     ← 生产脚本整段兜底管线（含 sed）BSD 侧通过
```

### 1.2 GNU 侧（**引用 CI 原始注解**，非 C 的转述）

`GET /repos/…/check-runs/108238521604/annotations`（head `807b6b67`，ubuntu job）原文：

```
[failure] ❌ backtick 路径（workflow brief-vs-code） — 期望 '`src/routes/a.ts`' 实得 ''|
          Status: ❌ grep -P 回归网未通过| … | 结果: 23 通过, 1 失败|
   path=.github  line=147
```

同一断言在 **windows-latest** 也失败（`check-runs/108215840089` 注解原文同样含
`期望 '`src/routes/a.ts`' 实得 ''`）——因为 **Git-Bash 自带 GNU grep**：

```
[failure] ❌ backtick 路径（workflow brief-vs-code） — 期望 '`src/routes/a.ts`' 实得 ''…
[failure] ❌ 活点② 行为: … 期望 [.claude/task-briefs/2026-09-24-D100-x.md …] 实得 [.claude/task-briefs\2026-09-24-D100-x.md
[failure] ❌ G10 红分支未触发（死分支回归或映射缺失）… 结果: PASS=12 FAIL=1
```

### 1.3 判定机制核实（"GNU 视 `\`` 为缓冲区起始锚"）

- **一方法义（GNU 官方文档）**：GNU Findutils 手册 *grep regular expression syntax* 明列
  `\`` **matches the beginning of the whole input**（`\'` = end of input）。
  ⇒ 该模式 `\`[^\`]+\.[a-z]{2,5}\`` 含**两个"输入起点"锚** ⇒ **恒不可能匹配** ⇒ `grep -oE` 输出空。
- **判别性论证**：若 GNU 把 `\`` 当字面反引号（同 BSD），则 ubuntu 该断言必然通过；实测恒红 ⇒ GNU 语义≠字面。
- **测试侧同命令**：`eq()` 的实得值 = `printf '%s\n' "$input" | grep -oE -- "$pat"`（测试 :46），与我在 BSD 侧跑的命令逐字相同。
- **库真身**：`scripts/workflow/check-brief-vs-code.sh:59-60`（`grep -oE '\`[^\`]+\.[a-z]{2,5}\`'` + `sed 's/\`//g'`）——
  即**在 GNU（Linux/Git-Bash）上该 Q2 兜底抽取恒返空**，属生产缺陷而非仅测试问题。
- **本机 BSD 全绿**：`grep-oP-regression.test.sh` → `结果: 24 通过, 0 失败` ⇒ "CI-only 红"成立（本机无法暴露）。
- **未修确认**：`git diff --stat 52f5aa1f..807b6b67 -- <测试> <生产脚本>` = **空**（两文件未动），测试内平台分支计数 = **0**，
  ubuntu 腿在 `807b6b67` 仍 failure（API 实测）⇒ 与"该修复点为供件、待 CTO 授权"一致。

**①结论：根因判定成立**（BSD 命中 / GNU 空；机制 = GNU `\`` 起点锚；影响面 = Linux 与 Git-Bash 两平台）。

---

## 二、② Gate Integrity 修复核（读码 + 真 run success）

### 2.1 读码（file:line）

```
scripts/pre-commit-check.sh:552   _CT40_BASE=""
scripts/pre-commit-check.sh:553   if [ -n "${SYNO_DIFF_BASE:-}" ] && git rev-parse --verify -q "${SYNO_DIFF_BASE}" >/dev/null 2>&1; then _CT40_BASE="$SYNO_DIFF_BASE"; fi
scripts/pre-commit-check.sh:554   _CT40_OUT="$(SYNO_CT_DIFF_BASE="$_CT40_BASE" bash "$ROOT/scripts/control-tower/ct-test-gate.sh" 2>&1)"; _CT40_RC=$?
```

### 2.2 行为复现（模拟 Gate Integrity 干净副本：删掉 `origin/main` ref）

```
A1 交付版（有守卫）:
   ✅ CT-40 控制塔脚本测试配对: SYNC-OK: 无控制塔脚本变更(跳过)         ← 不再假红
A2 反例（同场景，去守卫，无条件传基）:
   ❌ CT-40 控制塔脚本测试配对（rc=2）: 1 处  [CI strict——软提示转硬]
      degraded: git diff origin/main...HEAD 失败（fail-closed，不当作无变更）
   ::error title=IronLaws:CT-40 …
（跑后 `git checkout --` 还原：sha 7611ed87… == HEAD 版，守卫行回位 :553）
```

即 Gate Integrity 基线场景的"假红"被独立复现（A2），且交付版已消除（A1）。

### 2.3 真 run success（API 原始输出）

```
GET /repos/…/actions/jobs/108238521356
  name:        Gate Integrity (pattern sentinel + injection fixture + ci-reds)
  status:      completed | conclusion: success | head_sha: 807b6b67… | run_id: 36185739267
  steps: 1 Set up job ✅ / 2 checkout ✅ / 3 Gate integrity pattern sentinel + registration reconciliation ✅
         4 pre-commit groups injection fixture (sampled) ✅ / 5 CI red baseline reconciliation (--ci-reds, fail-on-drift) ✅
         6 Publish gate-integrity summary (public evidence) ✅
注解复核: 10 条，其中 failure 级 = 0（仅 1 条 Node20 deprecation warning）
对照: 修复前 52f5aa1f 同 job(108215839357) = failure（注解: "1 组未通过（详见上方 ❌ 行）"）
```

**②结论：一致**（守卫在位 + 行为复现 + 真 run success 三项齐备）。

---

## 三、③ Windows 修复核（读码 + 本机复跑）

### 3.1 读码

```
:84   _TO_PY() { command -v cygpath >/dev/null 2>&1 && { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; } || printf '%s' "$1"; }
:354  CRITERIA_GLOBS=$(CRITERIA_MAP_PY="$(_TO_PY "$CRITERIA_MAP")" CRITERIA_KEY="$CRITERIA" "$PYBIN" -c "…
:356  try: print(…json.load(open(os.environ['CRITERIA_MAP_PY']))…)     ← G10 改 env 传参（避反斜杠转义）
:452  SCOPE_TSV_PY="$(_TO_PY "$SCOPE_TSV")"; EXCL_TSV_PY="$(_TO_PY "$EXCL_TSV")"
:456  print('\n'.join(f.replace(os.sep,'/') for k in (-1,0,1) for f in glob.glob('.claude/task-briefs/%s-*.md' % …)))
:462  SCOPE_VIOLATION=$(STAGED_ALL=… SCOPE_TSV="$SCOPE_TSV_PY" EXCL_TSV="$EXCL_TSV_PY" "$PYBIN" -c "…
```

`_TO_PY` 分支实测（伪造 `cygpath` 注入 PATH）：**无 cygpath → 原样返回 `/d/a/x.json`；有 cygpath → 走转换** ⇒ 非 Windows 平台行为不变（macOS 实测同值）。

### 3.2 本机（macOS/BSD）复跑

```
tests/control-tower/g10-cp3.test.sh          → PASS=14 FAIL=0   rc=0
tests/control-tower/g12-day-window.test.sh   → 14 通过, 0 失败   rc=0
tests/control-tower/ct-test-gate.test.sh     → 6 通过, 0 失败    rc=0
CI 等价整跑（GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main）→ rc=0，stderr 0 行，❌ 计数 0
```

### 3.3 Windows 腿（**不可判**，附原始证据与预测）

```
GET /actions/jobs/108238521451 (windows-latest @807b6b67)：status=in_progress, step3 "Run hermetic control-tower gate tests" = in_progress
（同一 job 在 52f5aa1f 的失败注解给出被修目标的原文：
   ❌ 活点② 行为 … 实得 [.claude/task-briefs\2026-09-24-D100-x.md  ← 反斜杠路径
   ❌ G10 红分支未触发 … PASS=12 FAIL=1）
预测（有据）：该腿跑完仍将因 **① 的 backtick 断言**（Git-Bash GNU grep）转红 —— 依据：该测试与生产脚本自 52f5aa1f 起未改（diff 空）、无平台分支（计数 0）、Windows 侧 52f5aa1f 注解确实同断言失败。**G10/G12 的反斜杠类失败预期已被 3.1 的修复消除**（本机无法直接验 Windows，须待 CI）。
```

**③结论：一致（macOS 侧 + 读码）；Windows 侧 CI 未终态 ⇒ 不给"已绿"结论。**

---

## 四、④ T3 锚点抽核（实核 14 条，抽核要求 ≥5）

| 锚点（回执 T3 表） | 该行实际内容（本自验逐行打印） | 判定 |
|---|---|---|
| `pre-commit-check.sh:311` | `soft_check "硬编码业务数据/类型 (#3 保留·本地)" …` | ✅ |
| `pre-commit-check.sh:507` | `# 背景: K3 2026-09-14 §7.2 收割 2/3 —— D1 check-doc-truth.sh 与 D2…` | ✅ |
| `pre-commit-check.sh:413` | `soft_check "V5 平台敏感命令: … (D520)"` | ✅ |
| `pre-commit-check.sh:548` | `soft_check "CT-40 控制塔脚本测试配对: 门禁脚本缺失" "1"` | ✅ |
| `pre-commit-check.sh:565` | `# ⑥ 铁律 47: 声称完成须 grep 物理证明（…）`（块首注释；**正则实为 :569**） | ✅（见 O3） |
| `pre-commit-check.sh:577` | `soft_check "D945 预设 bundle 源校验: 脚本缺失" "1"` | ✅ |
| `pre-commit-check.sh:456` | `… f.replace(os.sep,'/') …`（G12 三日窗） | ✅ |
| `pre-commit-check.sh:331` | `⚠️ 禁止新 DiagnosticModule: 检查降级 …`（组 7a 三态） | ✅ |
| `ct-health.sh:206` | `run_canary_drift() {` | ✅ |
| `alloc-task-id.sh:226` | `if [ -n "$CHECK_ID" ]; then`（--check-id 段） | ✅ |
| `alloc-task-id.sh:170` | `_occupy_locations() {` | ✅ |
| `ct-test-gate.sh:25` | `# 生产 diff 基缝（task-28 裁定④）…` | ✅ |
| `ci.yml:111` | `iron-laws:` | ✅ |
| `ci.yml:339` | `if ! bash scripts/control-tower/ct-health.sh canary-drift; then` | ✅ |

**④结论：一致（14/14）** —— 回执 T3 是"更正表"（原文→实测），本表逐条复核与其更正后取值一致。

---

## 五、⑤ A9 before 侧 sha256（自算 8/8，抽核要求 ≥3）

before 侧 = 主树忽略目录 `docs/synova/coordination/evidence/` 原件；after 侧 = `git show 807b6b67:<tracked path> | shasum -a 256`：

```
✅ D962-2a-selfverify.md       一致 b800c9f01b95f362…
⚠ D962-2a2-selfverify.md      before=91cbbaf2774a7a9f…  after=fa3c44251ca1a11b…   （脱敏差异）
✅ D962-2a3-reverify.md        一致 370bc089babfa71b…
✅ D962-decl-selfverify.md     一致 20d7e5ba2d5f4229…
✅ D962-merge-selfverify.md    一致 d99e01393e8de85f…
✅ D962-refresh-selfverify.md  一致 f6f6aa677ab534c9…
✅ D962-selfverify.md          一致 c0694f843585fa02…
✅ D962-task26-selfverify.md   一致 0da05a4cb34cfddd…
```

**⑤结论：一致**（7/8 逐字节相同 + 1 件因 L11 脱敏而差异；两值均由本自验自算，与回执列值可对上）。
**O4（登记）**：before 侧位于**被忽略目录**（非版本锚定），本表数值仅对当前主树磁盘状态成立。

---

## 六、⑥ T5 21 条清单抽核（实核 21/21 + 零接线 5 条）

### 6.1 活点真实性（抽核要求 ≥5，本自验全核）

逐条打印被引行并核"是否真为调用/入口"（`$SCRIPT_DIR` 拼接式亦计入）：

```
#1 check-architecture.sh → baseline-check.sh:121 `bash "$REPO_DIR/scripts/check-architecture.sh"` ✅ ｜ ci.yml:193 `run: bash scripts/check-architecture.sh` ✅
#3 check-plan-integrity.sh → attach.py:11 为**注释**；同文件:168 实为调用 `[bash, …/scripts/check-plan-integrity.sh, --brief, brief]` ✅ ｜ synova-commit:433 `PLAN_OUT=$(bash "$PROJECT_ROOT/scripts/check-plan-integrity.sh" …)` ✅
#4 check-secrets.sh → pre-commit-check.sh:208/233/392 ✅ ｜ pre-push-check.sh:262 `bash "$SCRIPT_DIR/check-secrets.sh" || {` ✅
#5 check-bypass-log.sh → pre-push-check.sh:425 `CHECK_BYPASS="$SCRIPT_DIR/control-tower/check-bypass-log.sh"` ✅ ｜ pre-audit-summary.sh:46 表项 ✅
#6 check-citations.py → pre-dispatch-check.sh:50 ✅
#7 check-dsh-anchor.py → pre-commit-check.sh:594-597 ✅ ｜ ci.yml:331 ✅
#8 check-gate-integrity.sh → ci.yml:416/470/488 ✅
#11 check-notes-lifecycle.sh → pre-commit-check.sh:218 ✅
#12 check-ownership.py → check-pr-budget.sh:37 `OWNERSHIP="$SCRIPT_DIR/check-ownership.py"`（+ :137 使用）✅ ｜ scan-fullwidth-vars.sh:68 ✅
#14 check-preset-bundles.sh → pre-commit-check.sh:576/579 ✅
#15 check-doc-truth.sh → pre-commit-check.sh:514-526 ✅
#16 check-progress-freshness.py → progress-freshness-watchdog.yml:32 ✅
#17 check-brief-vs-code.sh → ci.yml:369 `run: bash … --strict` ✅
#18 check-dev-doc-write-set.sh → pre-audit-summary.sh:15 注释 + :47 表项 ✅
#19 check-golden-regression.sh → pre-push-check.sh:283 `bash "$SCRIPT_DIR/workflow/check-golden-regression.sh" --verify-only` ✅
#20 check-integration.sh → ci.yml:353 ✅
```

（余 #2/#9/#10/#13/#21 属"零接线"组，见 6.2；#1-#21 计数口径同 task-29 复核：`find scripts -type f -name 'check-*' ! -path 'scripts/audit/*' | wc -l` = 21。）

### 6.2 零接线 5 条复核（basename 口径，含 `$SCRIPT_DIR`/`REPO_ROOT / "…"` 路径拼接，排除 tests/）

```
check-file-driven.sh        非自身引用数 = 0  ✅ 真零
check-gitlinks.sh           非自身引用数 = 0  ✅ 真零
check-k3-report.py          非自身引用数 = 0  ✅ 真零
check-pr-budget.sh          非自身引用数 = 0  ✅ 真零
check-silent-swallow.sh     非自身引用数 = 0  ✅ 真零
```

**⑥结论：一致**（清单 21 条逐条可核；5 条零接线经验证为真零；未见"活点指向注释而实际无调用"的情形——唯二指向注释的 #3/#18 在同文件均有真实调用）。

---

## 七、⑦ T6 P-a（ownership.yaml +1 条目 + CODEOWNERS 一致性）

### 7.1 变更面（原始 diff）

```
$ git diff --numstat 1f577444..807b6b67 -- docs/synova/coordination/ownership.yaml
3	0	docs/synova/coordination/ownership.yaml
$ git diff --stat …
 docs/synova/coordination/ownership.yaml | 3 +++        1 file changed, 3 insertions(+)
```

实际新增 = **1 条规则（glob+owner+source 三行，+3/-0）**，无删除、无他处改动。任务书"仅 +1 行"应理解为"仅 +1 条目"；**原始 stat 为 3 行**（口径登记 O6）。

```
+  - glob: "scripts/commit-msg-check.sh"
+    owner: "mac"
+    source: "TASK-ROUTING.md L63 门禁脚本 DSH 专属（task-30 T6 补登记；此前落 ** 兜底误判 win）"
```

### 7.2 判据复跑 + CODEOWNERS 一致性

```
$ python3 scripts/control-tower/check-ownership.py scripts/commit-msg-check.sh --owner mac
mac  scripts/commit-msg-check.sh
✅ PASS 1 个文件全部归属 owner=mac（无归属 0）          rc=0

$ python3 scripts/control-tower/check-ownership.py --emit-codeowners > gen ; diff .github/CODEOWNERS gen
✅ 无漂移（在库 CODEOWNERS == 由 yaml 重生成）           rc=0
$ grep -n commit-msg-check docs/synova/coordination/ownership.yaml .github/CODEOWNERS
ownership.yaml:94:  - glob: "scripts/commit-msg-check.sh"
.github/CODEOWNERS:30:scripts/commit-msg-check.sh              @tangbaobao520

$ bash tests/control-tower/check-ownership.test.sh → ✅ 全部通过: 58 项
```

**⑦结论：一致**（yaml +1 条目 / 归属 PASS / CODEOWNERS 与 yaml 单源一致 / 组级测试 58 项全绿）。

---

## 八、登记项（不影响七项通过）

| # | 事项 | 级别 | 依据 |
|---|---|---|---|
| O1 | ① 的 GNU 方言缺陷在**生产脚本**（`check-brief-vs-code.sh:59-60`），非仅测试：Linux/Git-Bash 上该 Q2 兜底抽取恒返空 ⇒ 建议 CTO 尽快裁 U1（授权落两文件） | 需裁 | 本报告 §一 |
| O2 | 回执 §T2(3) 称 ubuntu 为"唯一剩余真因"：就"当前剩余红"成立，但**同一根因也打断 Windows 腿**（52f5aa1f windows 注解含同断言）；Windows 路径修复落地后，backtick 项将是**两腿共同**的拦截点 | 口径 | §1.2/§3.3 |
| O3 | T3 表 `claim-regex … 565` 实为块首注释，正则行 = **569**（表本身是"更正表"，偏差 ≤4 行，属正常漂移） | 微 | §四 |
| O4 | A9 before 侧源自**被忽略目录**（非版本锚）⇒ sha256 只对当前磁盘状态成立；建议将 before 侧清单同步入库以免复核断链 | 登记 | §五 |
| O5 | 现状 CI 已非"停摆"：head `807b6b67` 的 PR run 在跑（14 job），修复前 `52f5aa1f` 为 11/13/3——与正文口径更正一致 | 信息 | §〇 |
| O6 | ⑦ 任务书"仅 +1 行"与实测 `+3`（1 条目三行）措辞差异 | 微 | §7.1 |

---

## 九、自验结论

> **自验结论：通过（七项核对一致），附 1 项需 CTO 裁定的前置（O1/U1）+ 5 项登记。**
>
> - ① **根因独立复现成立**：BSD 本机同命令命中（`实得 = `src/routes/a.ts``），GNU 侧（ubuntu/windows CI **原始注解**）同断言 `实得 ''`；GNU 一方文档明列 `\`` = "matches the beginning of the whole input" ⇒ 双锚恒不匹配；库真身 `check-brief-vs-code.sh:59-60` 未修（自 52f5aa1f 无 diff、无平台分支），ubuntu 腿在 HEAD 仍红。
> - ② Gate Integrity：守卫 `:552-553` 在位；删 `origin/main` 的干净副本场景下交付版 `✅ SYNC-OK 跳过`、去守卫反例 `❌ rc=2 degraded`（复现假红成因）；**真 run = completed/success**（API 原始 JSON + 步骤全绿 + 注解 0 failure）。
> - ③ Windows：`_TO_PY`/env 传参/`os.sep` 归一化读码成立且非 Windows 平台等价（伪造 cygpath 分支实测）；macOS 复跑 g10-cp3 14/0、g12 14/0、ct-test-gate 6/0、CI 等价 rc=0 stderr=0；**Windows 腿 in_progress ⇒ 不判"已绿"**。
> - ④ T3 锚点实核 **14/14** 可核。
> - ⑤ A9 sha256 自算 **8/8**（7 同 + 1 脱敏差异）。
> - ⑥ T5 **21/21** 条逐条核，**零接线 5 条均为真零**。
> - ⑦ T6：ownership.yaml **+1 条目（+3/-0）**、`--owner mac` PASS rc=0、CODEOWNERS 重生成**零漂移**、组级测试 58 项全绿。
>
> **不构成审计通过** —— 通过与否归 CTO 收件闸 + K3 终审。
> **边界（未核/不可判）**：Windows CI 腿终态（in_progress，本报告 as_of 见下）；`gh` 本机不可用，job **日志正文**（`/logs`）未认证返回 **403**，故 CI 侧引用一律走 **check-runs/jobs 注解与状态 API 原始 JSON**（非日志全文）；远端 reflog（force 判定，承接 V8-F4）。
> **本报告落 `docs/synova/product-lines/evidence/`（D581 豁免跟踪路径）**，主树未提交（本角色不 commit）。
>
> **as_of**：本自验 CI 数据 = 2026-09-26T04:41+08:00（API 调用时点；windows-latest job `108238521451` 彼时仍 **in_progress**，step3 未终态）；代码/测试数据 = 807b6b67 快照。
