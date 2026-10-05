# D962 task-26 独立自验（V8 · 自验员 d962-verifier2）

> **自验员**：`d962-verifier2`（顶替连续运行失败成员 V；只读，独立于编码成员 C）
> **对象**：分支 `feat/d962-2a-merge` @ **68747574**（= `git ls-remote --heads origin` 实测值；= PR #803 `refs/pull/803/head`）
> **方法**：全流程在 `/tmp` 副本内进行（`git archive 68747574` 导出树 + `git clone --shared` 克隆）；**未修改任何仓库源文件**，主树 HEAD `b8573c7a` 开工/收工一致、`git status --porcelain` 条目数 5→5 未变。
> **口径**：本文所有数字来自命令原始输出；禁引编码成员 C 的数字（七项全部自跑）。本报告**只给自验结论**，不代表"审计通过"。
> **禁止项自查**：未碰 `scripts/audit/**`、`docs/synova/audit-reports/**`、`src/**`；未用 `--no-verify`/`git stash`/force push。

---

## 〇、结论摘要

| # | 核对项 | 结论 |
|---|---|---|
| ① | 全树冲突标记 = 0 + 4 件原坏文件可运行 | **一致** |
| ② | 4 处关键路径 `\|\| true` 清零（显式三态 + 注入反例） | **一致**（4/4 站点三态化经注入实证） |
| ③ | A 档四点能力等价抽核 | **一致**（含本自验另建独立夹具复算 G12 等价） |
| ④ | 写集双向差重算 + D708 gate 复跑 | **一致**（89=25A+26D+38M，双向差 0，gate rc=0） |
| ⑤ | k3-report 夹具 `:991→:1` 负向对照 | **一致**（`:1` OK / `:991` 越界 / 不存在路径 VIOLATION） |
| ⑥ | 回执数字抽 5 处回放 | **5/5 可回放**；另发现 2 处口径精度问题（F2/F3） |
| ⑦ | 推送记录核 | **sha 一致、末次 FF**；"无 force 痕迹"不可本地完全支持（F4） |

**另发现缺陷 1 处（F1，低危、一行可修，由本交付提交 8792450e 引入）**，详见 §八。

---

## 一、① 全树冲突标记 + 4 件原坏文件可运行

### 1.1 全树扫描（原始输出）

```
$ git grep -n -E '^(<<<<<<< |>>>>>>> )' 68747574 -- . | wc -l
       0
$ git grep -n -E '^(<<<<<<< |>>>>>>> )' origin/main -- . | wc -l
       0
```

含 `=======` 的全模式命中 9 处，逐条核为 Markdown/HTML 装饰分隔线（非冲突标记）：

```
68747574:docs/synova/DASHBOARD-backup-20260716.md:79:====...
68747574:docs/synova/research/archive/.../GROWTH_DIAGNOSTICS_IMPLEMENTATION.html:10:====...
…（共 9 处，全部为 ≥8 个 '=' 的分隔线；`git grep -c -E '^=======' origin/main` = 6，main 亦存在）
```

**结论**：HEAD 全树冲突标记 **0 行 / 0 件** —— 一致。

### 1.2 修复前后对照（跨修订）

```
$ git grep -l -E '^(<<<<<<< |>>>>>>> )' 80ce4ec6 -- .   → 6 件（22 行）
   .claude/task-briefs/2026-09-25-D956-ci-failmsg.md   (M)
   task-state/D956.json                                (M)
   scripts/workflow/loop-score.sh                      (M)
   tests/control-tower/g10-cp3.test.sh                 (A)
   tests/control-tower/g9-contract.test.sh             (A)
   tests/control-tower/grep-oP-regression.test.sh      (M)
$ git grep -l -E '^(<<<<<<< |>>>>>>> )' 68747574 -- .   → 0 件
```

- 4 件（loop-score / g10-cp3 / g9-contract / grep-oP）由 `4ce3e999` 修复，其 diff 确含删除的
  `<<<<<<<` / `=======` / `>>>>>>>` 行；4 件与 2b 版 `176d2e06` **git blob sha 逐字节一致**：

```
一致  tests/control-tower/grep-oP-regression.test.sh  sha=d18d0efc54b3d17e3d13a0c2528aee4bd7036cdc
一致  scripts/workflow/loop-score.sh                  sha=6fb758bccbc988c17245718eb363b9c1bb0dd882
一致  tests/control-tower/g9-contract.test.sh         sha=30bbb5cc083b133349130caf39a1534727f82fec
一致  tests/control-tower/g10-cp3.test.sh             sha=81bedd679647ffcdfa17c57d36bce080f37c452c
```

### 1.3 4 件原坏文件实跑（bash -n + 各跑其测试）

| 文件 | `bash -n` | 实跑 | 结果 |
|---|---|---|---|
| `tests/control-tower/grep-oP-regression.test.sh` | OK rc=0 | `bash …`（自身） | **24 通过, 0 失败** rc=0 |
| `scripts/workflow/loop-score.sh` | OK rc=0 | `tests/control-tower/loop-score.test.sh` | **PASS=5 FAIL=0** rc=0；直跑 `loop-score.sh` rc=0 |
| `tests/control-tower/g9-contract.test.sh` | OK rc=0 | `bash …`（自身） | **PASS=4 FAIL=0** rc=0 |
| `tests/control-tower/g10-cp3.test.sh` | OK rc=0 | `bash …`（自身） | **PASS=14 FAIL=0** rc=0 |

（`loop-score.test.sh` 打印 1 行内层 `ROOT: unbound variable` stderr 噪音，rc 仍 0 —— 与回执 L6 登记一致。）

**①结论：一致。**

---

## 二、② 4 处关键路径 `|| true` 清零（读码 + 自造失败样本）

### 2.1 读码定位（`scripts/pre-commit-check.sh`，564 行）

| 站点 | 行号 | 三态实现 |
|---|---|---|
| diff 采集族 | 110-127 | `_GIT_DIFF_RC` 捕获三处 git rc；非 0 ⇒ `❌ diff 采集降级` + `HARD_FAIL+1` |
| CT-34 纯文档早退 | 184-198 | `grep -vE` rc 三态：0=非文档 / 1=真纯文档 / **≥2=显式降级 + 按非纯文档继续** |
| G10 criteria-map | 349-357 | `_CG_RC`；非 0 ⇒ `soft_check "…解析降级（…不当作无映射）"` |
| G12 写集判定 | 435-470 | python `except → sys.exit(2)`；`_SV_RC` 非 0 ⇒ `soft_check "…执行失败…fail-closed"`；`PYBIN` 空 ⇒ 独立 fail-closed 分支 |

（文件内仍有 44 处 `|| true`，逐条核：日志/统计 `swallow-ok`、grep 管道惯用式、测试注入缝 —— 4 处**关键路径**已无 `|| true`。）

### 2.2 自造注入失败样本（**修前/修后同环境对照**，全部在 /tmp 副本运行）

| 站点 | 注入 | 修前（8792450e^） | 修后（68747574） |
|---|---|---|---|
| diff 采集 | `GIT_INDEX_FILE=<损坏 index>`（实测 `git diff --cached` rc=128） | `✅ 本地清单通过` **rc=0**（静默） | `❌ diff 采集降级: git 返回非 0 — 判定面无输入（fail-closed，绝不当作「无变更」）` + `❌ 1 组未通过 — 提交已拒绝` **rc=1** |
| CT-34 | `DOC_PREFIX_RE='^('`（实测 `grep -E` rc=2） | `纯文档提交 (CT-34): 豁免 — 仅 Secrets + Notes` **rc=0**（整链绕过） | `⚠️ 纯文档早退判定降级 — grep rc=2；按非纯文档继续（fail-closed）`，**不出现豁免行** |
| G10 | 站点 python 解释器指向不存在路径（rc=127） | `✅ G10: 条件 B 无映射区域(跳过)` **rc=0** | `⚠️ G10: criteria-map 解析降级（python3 rc=127，不当作无映射）`；`SYNO_CI=1` 下 `❌ … [CI strict——软提示转硬]` **rc=1** |
| G12 | 同上（rc=127） | `✅ G12: 所有文件均在 Q2 范围内` **假绿** | `❌ G12: 写集判定执行失败（python3 rc=127）— fail-closed，不当作范围全通过: 1 处 [CI strict——软提示转硬]` **rc=1** |

补证（G12 python 侧）：抽出内联 python 片段、不设 `STAGED_ALL` 触发异常 ⇒ `stderr: DEGRADED: 'STAGED_ALL'`，**rc=2**（即新增的 `sys.exit(2)` 生效）。

补证（G12 正/反向对照，确证 `\$` 逃逸修复未反向破坏）：真在库 Q2 条目 `scripts/pre-commit-check.sh` ⇒ `✅ G12: 所有文件均在 Q2 范围内`；范围外 `src/definitely-not-in-any-q2.ts` ⇒ `❌ … (不在 Q2 范围内)`。

**②结论：一致**（4/4 站点为显式降级/HARD_FAIL，注入反例证明"删掉即报红"）。

---

## 三、③ A 档四点能力等价抽核

### ③-1 doc-registry 活点在 CI 权威区 + 删块必红

- **活点行号**：CI 权威区 `if [ "${SYNO_CI:-0}" = "1" ]`（`scripts/pre-commit-check.sh:395–517`）内，D782 块 **479–516**；
  `.github/workflows/ci.yml:111` = `iron-laws:` job（实测无 `needs`，跑 `bash scripts/pre-commit-check.sh` + `SYNO_CI=1` + `SYNO_DIFF_BASE=origin/main`）——与 `iron-laws-live-point.test.sh` 断言同源。
- **基线**：`bash tests/doc-system/doc-registry-gate.test.sh` → **9 通过 / 0 失败** rc=0。
- **删块必红复现**（删 479–516 行、其余逐字节不变，跑完即 `git checkout` 恢复、sha 回 `d61ac6b3…`）：

```
❌ W1 接线: registry-gate 在 pre-commit (期望 0 实际 1)
❌ W2 接线: check-doc-truth 在 pre-commit (期望 0 实际 1)
── 汇总: 7 通过 / 2 失败 ──  rc=1
```

- CI 等价实跑（`GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main`）确见两块在跑：
  `✅ D1 文档真相: 全部硬检查通过 (12 ✅)` / `✅ D2 登记门禁: 汇总: 检查 0 个文档，0 个未登记`。

### ③-2 G12 日窗「新 glob == 旧正则」集合等价（**本自验另建夹具独立复算**）

自建 29 条目夹具（-1/0/+1 三日内 `-D900/D901/-nodash/--double/-space /-isdir.md` 多形态 + ±2/±3 日窗口外 + `README.txt` + `UPPER.MD`），
新实现（生产 `glob('.claude/task-briefs/%s-*.md')` 三日）× 旧实现（`*.md` basename × `^(D-1|D0|D+1)-` 正则）：

```
新实现(glob 三日) 集合: 12 条 ; 旧实现(三日正则) 集合: 12 条 ; diff → SET-EQUAL: 0 差
```

交付测试实跑：`tests/control-tower/g12-day-window.test.sh` → **14 通过, 0 失败** rc=0（含 活点②行为集合相等 / 活点③能力等价 / 活点④CI 可达性 / 活点⑤降级三态）。
另：强制 `PYBIN=""`（模拟 python 不可用，SYNO_CI=1）⇒ `❌ G12: 无可用 python — fail-closed（不静默当作范围全通过，D328 三态）` **rc=1**（非静态 grep 判据，行为级）。

### ③-3 7a 三态降级（非法 ERE / 裸排除模式）

用生产自带的武装缝 `SYNO_TEST_ARM=1 SYNO_DIAG_EXCL_OVERRIDE=…` 注入，不改脚本：

| 探针 | 结果 |
|---|---|
| 内联注释含真命中（`+const y = 1; // DiagnosticModule 内联`） | `⚠️ 禁止 DiagnosticModule …: 1 处`（命中未被放过） |
| 纯注释行（`+  // DiagnosticModule`） | `✅`（无过捕） |
| 注入**裸**排除模式 `//` | `✅` —— **复现 fail-open 形态**（真命中被吞），证交付的行首锚 `^\+[[:space:]]*(//|/\*|\*|#)` 是必要修正 |
| 注入非法 ERE `a(b`（实测 rc=2） | `⚠️ 禁止新 DiagnosticModule: 检查降级 — grep 不可用或排除模式非法 (rc=2)；本项未判定` |
| 同上 + `SYNO_CI=1` | `❌ 禁止新 DiagnosticModule: 检查降级 [CI strict——降级即失败]` + `❌ 2 组未通过 — 提交已拒绝` **rc=1** |

交付测试实跑：`tests/control-tower/gate-failopen-net.test.sh` → **结果: 20/0** rc=0（含 T3p/T3/T3f/T4/T5/T5b 判别对照、家族网 244/123 扫描、金丝雀非空转）。

### ③-4 scan-fullwidth 真因（退役路径 fail-closed rc=2）

- 基线：`tests/control-tower/scan-fullwidth-vars.test.sh` → **PASS=32 FAIL=0 SKIP=0** rc=0。
- 真因复现（仅把 `D938_WS` 第 2 项 `scripts/check-architecture.sh` 换回**已退役**的 `scripts/control-tower/check-sentinel-type-net.sh`，其余不动）：

```
❌ 写集模式未输出标签且扫描器 fail-closed (rc=2): ❌ scan-fullwidth-vars: 路径不存在: scripts/control-tower/check-sentinel-type-net.sh（fail-closed，不静默跳过）
❌ 写集模式应 rc=0，实得 2
结果: PASS=30 FAIL=2 SKIP=0
```

即：该断言此前被误归为"标签格式漂移"，实为退役路径 fail-closed(rc=2)；改指在库真身后判据强度不变（仍 9 文件全覆盖 + 条数自检）。

**③结论：一致。**

---

## 四、④ 写集双向差独立重算 + D708 gate 复跑

### 4.1 实测重算

```
$ git diff --name-status --no-renames origin/main..68747574
总行数 89 ; A=25 D=26 M=38 R=0 其他=0 ; git diff --shortstat → 89 files changed, 3365 insertions(+), 4000 deletions(-)
（merge-base = ee721b0a = origin/main = 真远端 main，`git ls-remote --heads origin main` 实测一致）
```

双向对账（脚本重算，禁用单侧配平）：

```
actual    : 89  A/D/M = (25, 26, 38)
brief Q2  : 89  A/D/M = (25, 26, 38, unclassified 0)
task-state: 89  A/D/M = (25, 26, 38, unclassified 0)
方向A（声明有/实际无）：brief 0 处 / task-state 0 处
方向B（实际有/声明无）：brief 0 处 / task-state 0 处
brief ⟷ task-state 集合差：0 处
```

### 4.2 D708 gate 复跑（克隆内，声明源取工作树 = 目标提交）

```
$ python3 scripts/control-tower/merge_writeset_gate.py --base ee721b0a… --head 68747574 --branch feat/d962-2a-merge --did D962 --repo-root .
✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）   rc=0
   变更集: 89 个文件（merge-base ee721b0a） ; 声明写集 89 条 ; 豁免 1 条（.claude/bypass.log builtin）
```

**④结论：一致。**

---

## 五、⑤ k3-report 夹具 `:991→:1` 负向对照

`tests/control-tower/check-k3-report.test.sh` 基线：**8 通过, 0 失败** rc=0。
自建三夹具直跑 `scripts/control-tower/check-k3-report.py`（独立于该测试）：

| 夹具 | rc | 原始输出 |
|---|---|---|
| 正向 `scripts/pre-commit-check.sh:1` | **0** | `统计: 引用 1 条 ｜ K3-REPORT: OK` |
| 旧夹具 `scripts/pre-commit-check.sh:991` | **1** | `❌ R3 …:6 行号越界: scripts/pre-commit-check.sh:991 (文件仅 564 行)` |
| 负向 `scripts/nope/nonexistent.sh:1` | **1** | `❌ R3 …:6 引用不存在: scripts/nope/nonexistent.sh` |

（`:991` 的越界阈值 564 行与本自验 `wc -l scripts/pre-commit-check.sh` = 564 自洽。）
即：`R3 行号须存在/不越界` 判据与"引用不存在路径 → VIOLATION"的负向对照**均未被削弱**，仅把正向夹具改指在库行。

**⑤结论：一致。**

---

## 六、⑥ 回执数字抽 5 处回放（`docs/synova/product-lines/evidence/D962-task26-回执.md`）

| 回执处 | 回执声明 | 本自验原始回放 | 判定 |
|---|---|---|---|
| §一 写集 | 88 文件 = 24A+26D+38M @ `e74aae55` | `git diff --name-status origin/main..e74aae55` = 88，24A/26D/38M | ✅ 可回放（该 sha 时点） |
| §二 冲突标记 | 修复前 4 件 / 修复后 0 件 | 修复后 **0 件 0 行** ✅；修复前全树实测 **6 件 22 行**（见 F2） | ⚠ 部分 |
| §三① 删块必红 | `7 通过 / 2 失败` rc=1 | 删 D782 块后 **7 通过 / 2 失败 rc=1** | ✅ |
| §三②/③/④ 测试计数 | `14 通过,0 失败` / `20/0` / `PASS=32→30,FAIL=0→2` | g12-day-window **14/0**；gate-failopen **20/0**；scan-fullwidth **32/0 → 30/2** | ✅ |
| §一⒞ CI 等价 + 复跑 5 件 | `live-point 9/9`、`selfdiff 7/7`、`grep-oP 24/24`、CI 口径 rc=0 | live-point **9 通过 0 失败**；selfdiff **7 通过 0 失败**；grep-oP **24 通过 0 失败**；`GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main` **rc=0**（但 stderr 有 2 行语法错误，见 F1） | ✅（rc 一致） |
| §六 合规 | 未 `--no-verify` | `.claude/bypass.log` @HEAD 中 `2026-09-26 .* detected-bypass` = **0 条**（当日条目全为 `COMMITTED \| pre-commit PASS`） | ✅ |

**⑥结论：5/5 数字可回放**；另附 2 处口径精度问题（F2/F3）。

---

## 七、⑦ 推送记录核

```
$ git ls-remote --heads origin feat/d962-2a-merge
687475743b11c183ce74f0485253db3a3ffd8354	refs/heads/feat/d962-2a-merge        # = 交付 sha ✓
$ git ls-remote origin 'refs/pull/803/head'
687475743b11c183ce74f0485253db3a3ffd8354	refs/pull/803/head                    # PR head = 交付 sha ✓
$ git -C .synova-wt-d962c rev-parse HEAD   → 68747574（工作树分支 fix/d962-803-final，干净）
$ git merge-base --is-ancestor 25e1b414 68747574 → 是 FF（上次已知远端点 → 末态）
```

远端跟踪 reflog 逐段祖先核（末态与主链）：

```
origin/feat/d962-2a-merge : 16 段中 14 段 FF；2 段非 FF（见 F4）
   e74aae55 -> 68747574  FF   [02:07:04 update by push]     ← 末次发布为 push（FF）
   25e1b414 -> e74aae55  FF   [02:05:51 update by push]
ssh/feat/d962-2a-merge    : 7 段全部 FF（末段 25e1b414 -> 68747574，02:19:32 fetch fast-forward）
```

**⑦结论：sha 一致、末次发布为 FF**；但"**无 force 痕迹**"这一表述不可由本地证据完全支持（F4）。

---

## 八、发现（需 CTO/队长裁定，均**不影响**①②③④⑤⑥⑦ 的核对通过）

### F1（缺陷 · 低-中）`scripts/pre-commit-check.sh:459` 反引号落在双引号命令替换内 → CI 路径 stderr 语法错误

交付提交 `8792450e` 给内联 python 加的注释里含反引号，而该 python 源码位于 `$(… "$PYBIN" -c "…")` **双引号串**内：

```bash
459: except Exception as e:   # task-26 2a②: 原实现静默吞（外层无 try，靠 bash `|| true`）⇒ 判定失败变「范围全通过」
```

bash 会把 `` `|| true` `` 当命令替换执行，**每次 CI 路径（`SYNO_CI=1`）执行 G12 时向 stderr 打印 2 行**：

```
scripts/pre-commit-check.sh: command substitution: line 462: syntax error near unexpected token `||'
scripts/pre-commit-check.sh: command substitution: line 462: `|| true'
```

- **A/B 同路径隔离**（同一 clone、同一 env，仅差该行反引号）：原文 **rc=0 / stderr=2 行**；反引号换「」后 **rc=0 / stderr=0 行**。
- 功能面影响：**无**。G12 判定仍正确（正/反向对照、注入降级对照均通过），因为失败的反引号替换展开为空、等价于注释文本被截断。
- 仍然是交付缺陷：CI 绿腿日志里留下无法解释的 syntax error（"绿腿告警"），且注释文本被静默截断（`靠 bash ）⇒`）。
- **一行修复**：`` `|| true` `` → `「|| true」` 或转义 `` \` ``。同类扫描：全脚本含反引号共 17 行，除 459 行外**其余 16 行均在 `#` 普通注释行内**（bash 不处理），**仅 459 行落在命令替换内**。
- 非 CI 路径（本地 `SYNO_CI≠1`）实测 stderr=0。

### F2（登记 · 低）回执 §二「修复前 4 件」相对全树欠计

`80ce4ec6` 全树实测 **6 件 / 22 行**冲突标记：除回执列的 4 件外，另含 `.claude/task-briefs/2026-09-25-D956-ci-failmsg.md`、`task-state/D956.json`（当时均在该提交 diff 内，`M`）；二者随 main 再同步取 main 权威版解决，HEAD 已与 main 一致（`git diff origin/main..68747574 -- <二者>` 为空）。HEAD 全树 **0 件**不变。

### F3（登记 · 低）回执首部写集与 head 为入档前快照

回执正文首部写 `@ e74aae55` + `88 文件 = 24A+26D+38M`（该 sha 实测正确），而 HEAD `68747574` 的声明与实测均为 **89 = 25A+26D+38M**（差 1 = 回执自身入库，属 D962 自举声明）。brief Q2（89 逐条，且段落小标题仍写 `### M（35）` 实列 38 条）与 task-state（89）双源与实测**双向差 0**，故非写集缺陷，属文档快照未回填。

### F4（登记 · 中）"无 force 痕迹"不可本地完全支持

`refs/remotes/origin/feat/d962-2a-merge` reflog 16 段中有 **2 段非 FF**：
`25e1b414 → 9fd034dd`（2026-09-26 01:57:55，fetch/forced-update）、`3d810151 → 9aa0f13e`（2026-09-25 23:38:55，fetch/forced-update）。
`ssh/` 侧 7 段全 FF，末态 `ls-remote` = 68747574 = 本地工作树 tip。远端侧无 reflog ⇒ **远端是否 force 不可判**。
分支自身提交记录含 rebase 重发布（`c4b795ba`「rebase 平铺后并回远端（-s ours…）」、`21457f58`「并回远端历史（rebase 后发布路径）」、`ac0ad90a`「rebase 改写 hash → D331 对账断裂」），与上述非 FF 段同源。
建议回执口径改为"**本地可观测范围内末次发布为 FF；历史含 rebase 重发布，远端无 reflog 不可判**"。

### F5（登记 · 低）测试注入缝（`SYNO_TEST_ARM=1`）下三条 git diff 仍带 `|| true`

102/104/105 行（ARM 分支）保留 `git … || true` ⇒ ARM 模式下 git 失败仍静默置空缓存；生产路径（ARM≠1）已三态化并经注入实证阻断，且 `T3f` 断言"未武装时覆盖变量被忽略"。属设计内测试缝，登记即可。
另：G10 显式降级后仍打印 `✅ G10: 条件 B 无映射区域(跳过)`，同屏 ✅/⚠️ 易混读，建议降级时止于此行（低）。

---

## 九、未做 / 不可判（本自验边界，勿当作已验）

1. **真 CI run 未核**：`gh` 本机不可用/未认证，无法读 PR #803 的 checks；`refs/pull/803/head` = 68747574 仅证 PR head 一致。回执已自标"真 run 待补（L3）"，与本次观察一致。
2. **Windows 侧未核**：本自验全在 macOS（`/tmp` 克隆）执行，`--domain win` 等仅经既有测试间接覆盖。
3. **未跑重型全量门禁**：本自验按"串行 ≤1"约束只跑组级测试与 pre-commit 等价复跑，未跑 vitest 全量（属另一 lane）。
4. **远端 reflog 不可得** ⇒ force 判定只能给"本地可观测"结论（F4）。
5. 交付物本身：本报告写入主树（唯一可写产物），**未提交**（主树为 CTO session 占用、本角色禁写其他/禁 commit）；请队长以正规通道（`synova-commit` / PR）提交后按 M6 收口。

---

## 十、自验结论

> **自验结论：通过（七项核对全部一致；附 1 处必修建议 + 4 项登记）。**
>
> - ①②③④⑤⑥⑦ 七项均以**本自验自跑原始输出**复现，无引编码成员数字：
>   - 冲突标记 0（6 件→0 件修复链已验）；4 件原坏文件 `bash -n` + 实跑 24/5/4/14 全绿；
>   - 4 处关键路径三态化**经修前/修后同环境注入对照**证明（静默 → 显式降级/HARD_FAIL）；
>   - A 档四点：删块必红 7/2、G12 等价自建夹具 0 差、7a 裸模式 fail-open 已复现且非法 ERE 显式降级、scan-fullwidth 真因 rc=2 复现；
>   - 写集 89 = 25A+26D+38M，双向差 0，D708 gate `pass` rc=0；
>   - k3-report `:1` OK / `:991` 越界 / 不存在路径 VIOLATION；
>   - 回执 5/5 数字可回放；推送 sha 一致（`ls-remote` = PR head = 本地 tip）。
> - **建议合并前修 F1**（`scripts/pre-commit-check.sh:459` 反引号 → 一行），否则 CI 日志每次带 2 行无法解释的 syntax error；
>   F2/F3 为回执文字精度（回头修订即可）；F4 建议改写"无 force 痕迹"口径；F5 登记。
> - 以上**不构成审计通过**；通过与否归 CTO 收件闸 + K3 终审。
