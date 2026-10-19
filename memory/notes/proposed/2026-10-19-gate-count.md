---
状态: proposed
日期: 2026-10-19
决策: 门禁组数真值 = 脚本实际执行的 `── 组 N:` 横幅数（12，D1）；C2 改「数横幅」，文档/夹具/CI/其余现行声明同口径，禁任何字面总数。
理由: C2 原读脚本里的「全部 N 组通过」字串（自指）——文档与脚本写同一个错数即恒绿；组 11 已并入组 4（`:822` 注释，D20），是计数口径错不是缺功能；故只改口径、不增删/重排任何组。
---

# 2026-10-19 · 门禁组数口径纠偏（真值 12 组 · Issue #595）

> 批次 P4 · #595 ｜ 起点 `gitea/local-main` @ `ab70d634b` ｜ 规格 `docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md`（sha256/16=`5a3d2683b0368024`，D13）
> 数字纪律：正文每个计量数字标 `D#`，出处见文末「数字出处」——命令原始输出，不手写。**标识符类数字**（日期、Issue/task 号、commit 哈希、文件路径、组号 `组 N`、W 编号、表格行序号与表内行号）不计为计量值；表内行号出处统一为 D16（新建件 D18、横幅行号 D28），表内「N 处」计数出处为对应文件 hunk（D16）。

## ① 现状（改造前 → 改造后，实测）

改造前（基线 = HEAD `ab70d634b`，用 `git show HEAD:` 取真值，不读工作树）：

| 事实 | 实测 | 出处 |
|---|---|---|
| 脚本实际执行的组横幅 | `12`（旧形态 `组 N/13`） | D3 |
| 脚本内字面「全部 N 组通过」 | `4` 行（其中 `1` 行为汇总行、其余为注释/自承） | D4 |
| 文档声明 `13 组` | AGENTS.md `3` ＋ LOOP.md `3` ＝ `6` 处 | D5 |
| C2 真值来源 | `:62` 读取「全部 N 组通过」字串（自指） | D6 |
| 写集内 5 个控制塔夹具 `13 组` | 逐文件 `1`／`1`／`3`／`1`／`1`，合计 `7` | D7 |
| 写集内夹具 `组 N/13` | 命中 `2` 个文件 | D8 |
| W6 其余声明 `13 组` | synova-commit `8`、merge_writeset_gate.py `1`、check-content-coupling.sh `1`、agents/P4-门禁/AGENTS.md `1` | D9 |
| 组 11 标签 | `0`（组 11 已并入组 4：`:822` 注释） | D19／D20 |

改造后（工作树）：

| 事实 | 实测 | 出处 |
|---|---|---|
| 横幅数（新形态 `── 组 N:`） | `12` | D1 |
| 组号集合 | `1 2 3 4 5 6 7 8 9 10 12 13`（`12` 个） | D2 |
| 汇总行 | 运行时 `${GROUP_DONE}`：自增 `12` 次；非注释汇总行 `1` 行（`:2101`） | D21／D22 |
| C2 | 数横幅；两行 `12 = 12`；exit `0` | D11／D12 |
| W6 四文件 `13 组` | 全 `0` | D10 |
| 白名单 14 文件 `13 组` | 全 `0` | D26 |
| 全仓含 `13 组` 的 tracked 文件 | `159` 个：白名单 `0`／历史·过程件 `142`／其余现行 `17`（后两类不判红） | D17／D27 |

## ② 决定

1. **真值单一来源**：`── 组 N:` 横幅数（W1 去分母、组号不重排）；汇总行改运行时计数 `全部 ${GROUP_DONE} 组通过`（W1，D21／D22），禁字面总数。
2. **C2 改造**（W2）：`TRUTH_GROUPS=$(grep -cE '── 组 [0-9]+:')`；两条硬断言——① 横幅数 == 0 ⇒ 硬失败（信号量==0 禁当通过）；② 脚本内 `全部 [0-9]+ 组通过` 字面量必须为 `0`（防回潮）（D11）。
3. **文档/夹具/CI 同口径**：6 处文档声明（W3）、5 个控制塔夹具（W4）、workflow step 名（W5）、W6 其余声明（W6）、2 个 doc-system 配对 fixture（W7＝L1 2026-10-19 批准的 `+2` 写集）（D5／D7／D16）。
4. **不做什么**：不补第 11 组；不增删/重排/改任何组内容与顺序；不碰 `scripts/audit/**`、`.github/**`、其它门禁数字；历史件（CHRONICLE／冻结 dev doc／memory 引述）不回改。

## ③ 依据

- 规格：`docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md`（sha256/16=`5a3d2683b0368024`，D13）
- Issue #595（CTO 2026-10-19 A 类卡）；基线 `gitea/local-main` @ `ab70d634b`
- 写集 `18` 件 ＝ `16` 改（D15 的 `M` 行）＋ `2` 新建（自证脚本 `??` ＋ 本 Note）；另 `.claude/task-briefs/2026-10-19-595-gate-count.md` 是组 6 声明载体（非交付件，不计入写集）
- L1 2026-10-19 批准写集扩写 `+2`：`tests/doc-system/check-doc-truth.test.sh`、`tests/doc-system/doc-truth-probe.test.sh`（D16 对应两文件 hunk）

## ④ 写集（逐文件 18 件；计法见 ③）

| # | 文件 | 动作 | 行号（现文件；hunk 明细见 D16） | 要点 |
|---|---|---|---|---|
| 1 | `AGENTS.md` | 改 | 5／230／300 | 3 处声明改 `12 组`，措辞归一为 C2 可提取形态 |
| 2 | `LOOP.md` | 改 | 15／39／53 | 3 处声明改 `12 组` |
| 3 | `scripts/pre-commit-check.sh` | 改 | 横幅 12 处（659/714/822/836/896/983/1251/1406/1437/1516/1590/1884，D28）＋ `:53`／`:2101` | 12 横幅去 `/13`；`GROUP_DONE` 初始化与 12 次自增（D21）；汇总行 `${GROUP_DONE}`；注释同批 |
| 4 | `scripts/doc-system/check-doc-truth.sh` | 改 | 95–111（C2 段 hunk） | 真值改数横幅；两条硬断言（横幅=0 硬失败／字面量=0） |
| 5 | `.gitea/workflows/local-gates.yml` | 改 | 57／63／150 | step 名与注释 `13 组`→`12 组`；不动 job 名与 `run:` |
| 6 | `scripts/control-tower/synova-commit` | 改 | 6／283／338／344／447／454／753／781 | 8 处（`:447`／`:454` 为用户可见 echo）→ `12` |
| 7 | `scripts/control-tower/merge_writeset_gate.py` | 改 | 9 | 注释 → `12` |
| 8 | `scripts/check-content-coupling.sh` | 改 | 689 | 注释 → `12` |
| 9 | `agents/P4-门禁/AGENTS.md` | 改 | 155 | 包守则声明 → `12 组` |
| 10 | `tests/control-tower/precommit-groups-injection.test.sh` | 改 | 25／86–97／196–208／396／536 | 常量去 `/13`；注释同步；「组 11 不存在」事实保留 |
| 11 | `tests/control-tower/fastlane-bypass-only.test.sh` | 改 | 9／29／38 | `组 1/13`→`组 1:` |
| 12 | `tests/control-tower/check-pr-budget.test.sh` | 改 | 395／397 | 字面断言改「锚定信号 `全部 [0-9]+ 组通过`」 |
| 13 | `tests/control-tower/gate-failopen-net.test.sh` | 改 | 34 | 注释同步锚定写法 |
| 14 | `tests/control-tower/ci-deps-step-sim.test.sh` | 改 | 51 | step 名索引同步 `① 12 组门禁` |
| 15 | `tests/doc-system/check-doc-truth.test.sh` | 改（W7） | 28 | fixture 补 5 条横幅（D29）＋汇总改运行时变量 |
| 16 | `tests/doc-system/doc-truth-probe.test.sh` | 改（W7） | 34 | 同上（5 条横幅，D29） |
| 17 | `tests/control-tower/gate-count-acceptance.test.sh` | 新建 | 1–471（D18） | 自证：12 判据＋R1/R2/R3＋三态退出码（D23） |
| 18 | `memory/notes/proposed/2026-10-19-gate-count.md` | 新建 | 全文 | 本 Note（四字段头＋七节＋数字出处） |

> 表中「3 处／8 处／12 处／5 条」等计数：改文件取自 D16 的 hunk 内改动点；doc-system 两 fixture 的「5 条横幅」来自 D29；横幅行号来自 D28；新建件行数来自 D18。

## ⑤ 自证

- 自证脚本：`tests/control-tower/gate-count-acceptance.test.sh`（新建，`471` 行，D18；判据 `12` 项＋反例 `3` 条，D23）。
- 本机自跑（原始输出 `/tmp/task7-final-run-1019.log`）：`15 通过 / 0 失败`，exit `0`（D24）——`12` 判据＋`3` 反例全 ✅。此为**自验结论**；「通过」判定归 L1 收件闸与 K3。
- R1 删组必红：副本从 `── 组 13:` 横幅删到 EOF（`11821` 字符）⇒ C2 `12 ≠ 11`、exit `1`；恢复 ⇒ exit `0`（D25）。
- R2 改数必红：副本 AGENTS.md `12 组 pre-commit`→`13 组 pre-commit` ⇒ C2 `13 ≠ 12`、exit `1`；恢复 ⇒ exit `0`（D25）。
- R3 硬编码回潮必红：副本汇总行 `${GROUP_DONE}`→字面 `12`（`:2101`）⇒ 判据 4 同款 grep 命中 `1` 行；C2 参考 exit `1`（D25）。
- 独立验证据（task-9）将在 `docs/evidence/p4-gate-count/` 落全量原始输出；截至本 Note 落盘，task-9 受 `blocked_by task-7/task-8` 尚未运行，终态以其复跑原始输出为准。

## ⑥ Known Limitations

1. C2 只核 `AGENTS.md`／`LOOP.md` 两处文档；其余现行声明（W5/W6）靠自证脚本 grep 断言，不在 C2 内。
2. R1 依赖「删整块（含横幅）」；只删块体留横幅 ⇒ 横幅数不变 ⇒ 不红（口径边界，DS-11 用组号集合兜底）。
3. 历史件保留 `13 组`（有意）：全仓仍有 `159` 文件含该词（D17），判据只对白名单判红；B 类 `142`、C 类 `17` 只打印不判红（D27）。
4. DS-10 白名单口径：判红仅白名单 `14` 文件（D26）；其余现行件（C 类 `17`，D27）列残留清单交 L1/独立复核裁决，不判红。
5. 豁免件 `gate-exemptions/2026-10-19-gate-count-595.md` 必须由创始人网页提交（作者校验），不占 L2 写集。

## ⑦ 生效时点

合入 `gitea/local-main` 后生效；本 Note 状态由 `proposed` 迁移为 `implemented`（`git mv` 换目录，见 `memory/notes/README.md` 迁移门禁）。在此之前的任何增删组 PR 必须同批更新 6 处声明（D5）与夹具，否则 C2 红——这是有意设计（C3 失效条件）。

---

## 数字出处（命令原始输出）

> 全部命令在 `/Users/wane/SynovaAgent/.synova-wt-gcnt-impl-1019` 执行；基线类命令用 `git show HEAD:<file>` 取 `ab70d634b` 真值（不读工作树）。C2 输出中的 ANSI 颜色控制符已剔除，文本与计数不变。

### D1 横幅数（现）

```bash
$ grep -cE '── 组 [0-9]+:' scripts/pre-commit-check.sh
12
```

### D2 组号集合（现）

```bash
$ grep -oE '── 组 [0-9]+' scripts/pre-commit-check.sh | grep -oE '[0-9]+' | sort -n | uniq | tr '\n' ' '
1 2 3 4 5 6 7 8 9 10 12 13
```

### D3 基线（HEAD）旧横幅数

```bash
$ git show HEAD:scripts/pre-commit-check.sh | grep -cE '── 组 [0-9]+/[0-9]+'
12
```

### D4 基线（HEAD）字面汇总行数

```bash
$ git show HEAD:scripts/pre-commit-check.sh | grep -cE '全部 [0-9]+ 组通过'
4
```

### D5 基线（HEAD）文档声明数

```bash
$ git show HEAD:AGENTS.md | grep -c '13 组'
3
$ git show HEAD:LOOP.md | grep -c '13 组'
3
```

### D6 基线（HEAD）C2 自指行

```bash
$ git show HEAD:scripts/doc-system/check-doc-truth.sh | grep -n 'TRUTH_GROUPS='
62:  TRUTH_GROUPS=$(grep -oE '全部 [0-9]+ 组通过' "$PCC" | grep -oE '[0-9]+' | head -1)
```

### D7 基线（HEAD）控制塔夹具 `13 组` 计数

```bash
$ git grep -c '13 组' HEAD -- tests/control-tower/
HEAD:tests/control-tower/check-pr-budget.test.sh:1
HEAD:tests/control-tower/ci-deps-step-sim.test.sh:1
HEAD:tests/control-tower/doc-commit-exempt.test.sh:2
HEAD:tests/control-tower/fastlane-bypass-only.test.sh:3
HEAD:tests/control-tower/g12-taskstate-exempt.test.sh:1
HEAD:tests/control-tower/gate-failopen-net.test.sh:1
HEAD:tests/control-tower/hooks-install.test.sh:1
HEAD:tests/control-tower/precommit-groups-injection.test.sh:1
```

> 写集内 5 个夹具 = check-pr-budget / ci-deps-step-sim / fastlane-bypass-only / gate-failopen-net / precommit-groups-injection（上列其余 3 个文件不在本批写集，属 Known Limitations 3 的 B/C 类）。

### D8 基线（HEAD）夹具 `组 N/13`

```bash
$ git grep -lE '组 [0-9]+/13' HEAD -- tests/control-tower/
HEAD:tests/control-tower/fastlane-bypass-only.test.sh
HEAD:tests/control-tower/precommit-groups-injection.test.sh
```

### D9 基线（HEAD）W6 四文件 `13 组`

```bash
$ git grep -c '13 组' HEAD -- scripts/control-tower/synova-commit scripts/control-tower/merge_writeset_gate.py scripts/check-content-coupling.sh 'agents/P4-门禁/AGENTS.md'
HEAD:agents/P4-门禁/AGENTS.md:1
HEAD:scripts/check-content-coupling.sh:1
HEAD:scripts/control-tower/merge_writeset_gate.py:1
HEAD:scripts/control-tower/synova-commit:8
```

### D10 现 W6 四文件 `13 组`

```bash
$ for f in scripts/control-tower/synova-commit scripts/control-tower/merge_writeset_gate.py scripts/check-content-coupling.sh 'agents/P4-门禁/AGENTS.md'; do printf '%s: ' "$f"; grep -c '13 组' "$f"; done
scripts/control-tower/synova-commit: 0
scripts/control-tower/merge_writeset_gate.py: 0
scripts/check-content-coupling.sh: 0
agents/P4-门禁/AGENTS.md: 0
```

### D11 C2 硬断言行

```bash
$ grep -nE "全部 \[0-9\]\+ 组通过|TRUTH_GROUPS|信号量" scripts/doc-system/check-doc-truth.sh
95:  TRUTH_GROUPS=$(grep -cE '── 组 [0-9]+:' "$PCC" | tr -d '\n\r') # swallow-ok: 无匹配时 grep 输出 0/exit1，0 即信号量（非吞错）
96:  TRUTH_GROUPS="${TRUTH_GROUPS:-0}"
97:  HARDCODED_SUMMARY=$(grep -nE '全部 [0-9]+ 组通过' "$PCC")
98:  # 硬断言①: 信号量==0 禁当通过（横幅被删/被改名 ⇒ 组数无从谈起，硬失败）
99:  if [ "$TRUTH_GROUPS" -gt 0 ]; then
100:    check "C2 真值来源: 组横幅数" 0 "grep -cE '── 组 [0-9]+:' = ${TRUTH_GROUPS}（> 0）"
102:    check "C2 真值来源: 组横幅数" 1 "硬失败: grep -cE '── 组 [0-9]+:' = 0（信号量==0，禁当通过）"
106:    check "C2 真值来源: 无字面组数" 0 "grep -cE '全部 [0-9]+ 组通过' = 0（汇总行为运行时计数）"
111:  if [ "$TRUTH_GROUPS" -gt 0 ]; then
117:        if [ "$CLAIM" -eq "$TRUTH_GROUPS" ]; then
118:          check "C2 门禁组数 ($f)" 0 "${CLAIM} = ${TRUTH_GROUPS}（pre-commit-check.sh 横幅数）"
120:          check "C2 门禁组数 ($f)" 1 "${CLAIM} ≠ ${TRUTH_GROUPS}（pre-commit-check.sh 横幅数）"
```

### D12 C2 两行 `12 = 12`

```bash
$ bash scripts/doc-system/check-doc-truth.sh | grep -E 'C2 门禁组数'; echo "exit=$?"
  ✅ C2 门禁组数 (AGENTS.md) — 12 = 12（pre-commit-check.sh 横幅数）
  ✅ C2 门禁组数 (LOOP.md) — 12 = 12（pre-commit-check.sh 横幅数）
exit=0
```

### D13 规格 sha256/16

```bash
$ shasum -a 256 docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md | cut -c1-16
5a3d2683b0368024
```

### D15 本 Note 落盘前 `git status --porcelain`

```bash
$ git status --porcelain
 M .gitea/workflows/local-gates.yml
 M AGENTS.md
 M LOOP.md
 M agents/P4-门禁/AGENTS.md
 M scripts/check-content-coupling.sh
 M scripts/control-tower/merge_writeset_gate.py
 M scripts/control-tower/synova-commit
 M scripts/doc-system/check-doc-truth.sh
 M scripts/pre-commit-check.sh
 M tests/control-tower/check-pr-budget.test.sh
 M tests/control-tower/ci-deps-step-sim.test.sh
 M tests/control-tower/fastlane-bypass-only.test.sh
 M tests/control-tower/gate-failopen-net.test.sh
 M tests/control-tower/precommit-groups-injection.test.sh
 M tests/doc-system/check-doc-truth.test.sh
 M tests/doc-system/doc-truth-probe.test.sh
?? .claude/task-briefs/2026-10-19-595-gate-count.md
?? tests/control-tower/gate-count-acceptance.test.sh
```

### D16 写集 hunk 行号（`git diff -U0 -- <file> | grep -oE '^@@ ...'`）

```text
AGENTS.md: @@ -5 +5 @@ @@ -230 +230 @@ @@ -300 +300 @@
LOOP.md: @@ -15 +15 @@ @@ -39 +39 @@ @@ -53 +53 @@
scripts/pre-commit-check.sh: @@ -23 +23 @@ @@ -51,0 +52,2 @@ @@ -77 +79 @@ @@ -365 +367 @@ @@ -396 +398 @@ @@ -407 +409 @@ @@ -643 +645 @@ @@ -657 +659,2 @@ @@ -711 +714,2 @@ @@ -818 +822,2 @@ @@ -831 +836,2 @@ @@ -890 +896,2 @@ @@ -976 +983,2 @@ @@ -1243 +1251,2 @@ @@ -1397 +1406,2 @@ @@ -1426,2 +1436,3 @@ @@ -1464 +1475 @@ @@ -1504,2 +1515,3 @@ @@ -1577,2 +1589,3 @@ @@ -1611 +1624 @@ @@ -1868 +1881 @@ @@ -1871 +1884,2 @@ @@ -1887 +1901 @@ @@ -1900,2 +1914,2 @@ @@ -1937 +1951 @@ @@ -1943 +1957 @@ @@ -1969 +1983 @@ @@ -2027 +2041 @@ @@ -2087 +2101 @@
scripts/doc-system/check-doc-truth.sh: @@ -1,0 +2,3 @@ @@ -4,0 +8,3 @@ @@ -6,4 +12,18 @@ @@ -14,2 +34,2 @@ @@ -18,0 +39,11 @@ @@ -36 +67 @@ @@ -59,0 +91,2 @@ @@ -62,2 +95,17 @@ @@ -70 +118 @@ @@ -72 +120 @@ @@ -78,2 +125,0 @@
.gitea/workflows/local-gates.yml: @@ -57 +57 @@ @@ -63 +63 @@ @@ -150 +150 @@
scripts/control-tower/synova-commit: @@ -6 +6 @@ @@ -283 +283 @@ @@ -338 +338 @@ @@ -344 +344 @@ @@ -447 +447 @@ @@ -454 +454 @@ @@ -753 +753 @@ @@ -781 +781 @@
scripts/control-tower/merge_writeset_gate.py: @@ -9 +9 @@
scripts/check-content-coupling.sh: @@ -689 +689 @@
agents/P4-门禁/AGENTS.md: @@ -155 +155 @@
tests/control-tower/precommit-groups-injection.test.sh: @@ -25 +25 @@ @@ -86,12 +86,12 @@ @@ -196,12 +196,13 @@ @@ -395 +396 @@ @@ -535 +536 @@
tests/control-tower/fastlane-bypass-only.test.sh: @@ -9 +9 @@ @@ -29 +29 @@ @@ -38 +38 @@
tests/control-tower/check-pr-budget.test.sh: @@ -395 +395 @@ @@ -397 +397,7 @@
tests/control-tower/gate-failopen-net.test.sh: @@ -34 +34 @@
tests/control-tower/ci-deps-step-sim.test.sh: @@ -51 +51 @@
tests/doc-system/check-doc-truth.test.sh: @@ -28 +28,7 @@
tests/doc-system/doc-truth-probe.test.sh: @@ -34 +34,7 @@
```

### D17 全仓含 `13 组` 的 tracked 文件数

```bash
$ git grep -l '13 组' | wc -l
159
```

（终态 HEAD 68bc99f91 实测；本批新增 Note/brief/自证脚本含该词，计数随 tracked 文件集变化）

### D18 自证脚本行数

```bash
$ wc -l < tests/control-tower/gate-count-acceptance.test.sh
471
```

（silent-swallow 豁免 17 行后；修复前后行数见 git diff +17/−18）

### D19 基线（HEAD）组 11 标签数

```bash
$ git show HEAD:scripts/pre-commit-check.sh | grep -cE '── 组 11/'
0
```

### D20 组 4 并组注释

```bash
$ git show HEAD:scripts/pre-commit-check.sh | grep -n '原 5, 11 合并'
822:# 组 4: 接线完整性 (原 5, 11 合并)
```

### D21 现 GROUP_DONE 自增行数

```bash
$ grep -cF 'GROUP_DONE=$((GROUP_DONE+1))' scripts/pre-commit-check.sh
12
```

### D22 现汇总行（非注释）

```bash
$ grep -nF '全部 ${GROUP_DONE} 组通过' scripts/pre-commit-check.sh | grep -vE '^[0-9]+:[[:space:]]*#'
2101:  echo -e "  ${GREEN}✅ 全部 ${GROUP_DONE} 组通过${RESET}"
```

### D23 自证脚本判据数／反例数

```bash
$ grep -c '^# ── 判据' tests/control-tower/gate-count-acceptance.test.sh
12
$ grep -c '^# ── R[123]:' tests/control-tower/gate-count-acceptance.test.sh
3
```

### D24 本机自跑末两行

```bash
$ tail -2 /tmp/task7-final-run-1019.log
── 汇总: 15 通过 / 0 失败 ──
  Status: ✅ gate-count-acceptance 全部通过（自验结论；通过判定归 L1/K3）
```

### D25 反例 R1／R2／R3 关键行（同一日志）

```text
174:    | 已删除：从 `── 组 13:` 横幅行到 EOF（11821 字符）
182:    |   ❌ C2 门禁组数 (AGENTS.md) — 12 ≠ 11（pre-commit-check.sh 横幅数）
183:    |   ❌ C2 门禁组数 (LOOP.md) — 12 ≠ 11（pre-commit-check.sh 横幅数）
194:    | exit=1
213:    | exit=0
214:  ✅ 反例 R1 — 删组必红，恢复必绿
237:    | 已改：`12 组 pre-commit` → `13 组 pre-commit`（替换 1 处）
245:    |   ❌ C2 门禁组数 (AGENTS.md) — 13 ≠ 12（pre-commit-check.sh 横幅数）
257:    | exit=1
276:    | exit=0
277:  ✅ 反例 R2 — 改数必红，恢复必绿
281:    | 已改第 2101 行（可执行汇总行）：`全部 ${GROUP_DONE} 组通过` → `全部 12 组通过`
284:    | 1
289:  ✅ 反例 R3 — 硬编码回潮必被捕获
```

### D26 白名单 14 文件 `13 组` 计数（全 0）

```bash
$ for f in AGENTS.md LOOP.md scripts/pre-commit-check.sh scripts/doc-system/check-doc-truth.sh .gitea/workflows/local-gates.yml scripts/control-tower/synova-commit scripts/control-tower/merge_writeset_gate.py scripts/check-content-coupling.sh 'agents/P4-门禁/AGENTS.md' tests/control-tower/precommit-groups-injection.test.sh tests/control-tower/fastlane-bypass-only.test.sh tests/control-tower/check-pr-budget.test.sh tests/control-tower/gate-failopen-net.test.sh tests/control-tower/ci-deps-step-sim.test.sh; do printf '%s=%s ' "$(basename "$f")" "$(grep -c '13 组' "$f")"; done
AGENTS.md=0 LOOP.md=0 pre-commit-check.sh=0 check-doc-truth.sh=0 local-gates.yml=0 synova-commit=0 merge_writeset_gate.py=0 check-content-coupling.sh=0 AGENTS.md=0 precommit-groups-injection.test.sh=0 fastlane-bypass-only.test.sh=0 check-pr-budget.test.sh=0 gate-failopen-net.test.sh=0 ci-deps-step-sim.test.sh=0
```

### D27 全仓分类（自证脚本判据 11 打印）

```text
分类: 白名单(判红) / 历史·过程件(不判红) / 其余现行(不判红，列残留)
A=0 B=142 C=17
```

（终态实测（HEAD 68bc99f91）；早期 138/16 为中间快照，已被本值取代）

### D28 横幅行号（现）

```bash
$ grep -nE '── 组 [0-9]+:' scripts/pre-commit-check.sh | cut -d: -f1 | tr '\n' ' '
659 714 822 836 896 983 1251 1406 1437 1516 1590 1884
```

### D29 doc-system 两 fixture 横幅数与字面量

```bash
$ for f in tests/doc-system/check-doc-truth.test.sh tests/doc-system/doc-truth-probe.test.sh; do printf '%s: 横幅=%s 字面=%s\n' "$f" "$(grep -oF '── 组 ' "$f" | wc -l | tr -d ' ')" "$(grep -cF '全部 5 组通过' "$f")"; done
tests/doc-system/check-doc-truth.test.sh: 横幅=5 字面=0
tests/doc-system/doc-truth-probe.test.sh: 横幅=5 字面=0
```
