# D1023「A3 补修」独立自验报告

> **自验结论：`可提请独立审计`**（含 2 条存疑 + 3 条遗留，见 §13/§14；**本报告不给"审计通过"**——通过与否归 CTO 收件闸 + K3 复审）
> 自验员：`a3fix-verifier`（独立成员，非编码者）｜共享任务：`task-2` revision 4（`in_progress`，owner=a3fix-verifier）
> 被测对象：**`98485b7c`**（= `refs/heads/fix/a3-g10-g11-fakegreen-20260927`，`git ls-remote` 已核 local==remote；工作树 `git status --porcelain` = 空）
> 被测改动：`ad2cce20..98485b7c`，`6 files changed, 466 insertions(+), 40 deletions(-)`
> 只读声明：自验员除本文件外未改仓库任何文件；一切实跑在 `git clone --local` 的 `/tmp` 副本内（`/tmp/a3fix-verify-QGG2/repo`），副本内 `git reset --hard` 复位。
> 方法：**不读编码者自述结论**；预期值来自自持的独立参考实现（阶段一建），实际值来自实跑与**从实现文本抽取**的 sed/RE。
> 环境：macOS；`command -v python` = 无（rc=127）、`python3` = `/usr/bin/python3`；门禁实跑统一 `GITHUB_ACTIONS=true SYNO_CI=1`（CI 同口径，G10 在 CI 才硬阻断）。

---

## §0 结论速览

| # | 判据 | 判定 | 一句话依据 |
|---|------|------|-----------|
| 1 | 反例 a：账本文件 + `#CRITERIA:D` ⇒ G10 不红 | **通过** | `✅ 全部 13 组通过`；`✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)` 且 5 项逐个点名 |
| 2 | 反例 b：区域外真代码 ⇒ G10 仍红 | **通过** | `❌ G10: 条件区域不匹配` 点名 `observer-adapters/claude-code-hook/hook.py`，门禁 exit=1 |
| 3 | 判别力：删豁免分支 ⇒ 转红 | **通过** | 物理删除 `:1259-1268` 后**同一注入**转 `❌ G10` 并点名全部 5 个账本文件 |
| 4 | glob 转换修复 + 回归 | **通过** | `scripts/**/*.{sh,py}` → `scripts/(.*/)?.*.(sh|py)` 命中 `scripts/pre-commit-check.sh`；回归 10/10；全仓库**单调放宽、丢失 0** |
| 5 | ⑥ `tests/**` 归 D 且零漂移 | **通过（1 处字面差异）** | D.glob 4→5 仅 `+"tests/**"`，A/B/C 与 D 其余字段零漂移；`_comment` 亦被扩写（差异 D3） |
| 6 | ⑦ 假绿闭合（三态 P1–P4） | **通过（P1/P2/P3/P4 全过）** | 状态1/2 结论逐字一致；三态 `无映射区域(跳过)` 计数 = 0；状态3 可见 ⚠️ + degraded 登记 1 条 |
| 7 | 夹具仍 exit 0 | **通过** | `FIXTURE_EXIT=0`；`GATE_INJECTION_SUMMARY: ... structural_not_red=0 green_fail=0 exempt_probe=RED_CONFIRMED(rc=1)` |
| 8 | 边界/越界扫描 | **通过（1 处需说明）** | 5 手改文件全在写集内；`.github/**` 0 处；改动文件 `INJECTED-RED`=0；无空 blob；**diff 实为 6 文件**（差异 D2） |
| 9 | CI 同口径 + 夹具接线 | **通过** | 全部实跑带 `SYNO_CI=1`；CI 同口径 run `exit=0` + `✅ 全部 13 组通过`；`ci.yml:596` 确登记该夹具 |

**要求的 4 个证伪方向**：条件区域未被锚定化/未被收紧（证伪②，全仓库量化）；`{a,b}`→`(a|b)` 对当前 15 条 glob 无副作用（证伪③）；场景 a 确实由 G10 给出绿（证伪④，指到 G10 行本身）；⑦ 未把闸推到另一个假绿（在 python 不可用情形下证伪⑤-甲）。
**额外自选探针命中**：1 条**残留假绿路径**（§13-存疑1）+ 1 条**潜在副作用**（§13-存疑2）+ 1 条**同族未收口**（§14-遗留1）。

---

## §1 判据 1 —— 反例 a：账本类文件 + `#CRITERIA:D` ⇒ G10 不红

**暂存集**（覆盖判据 1 点名的 5 个 scope）：
```
$ git diff --cached --name-only
.claude/bypass.log
.claude/task-briefs/2026-09-26-D1023-a3-g10-g11-fakegreen.md
.codex/vb1-probe.json
memory/notes/implemented/process/2026-09-27-a3-g10-g11-fakegreen.md
task-state/vb1-probe.json
```
brief 声明（`sed -n 3p`）：`#CRITERIA: D`

**命令**：`GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh`（state1：本机真态，`python` 无 / `python3` 在）

**原始输出**（关键片段）：
```
── 组 10/13: V3 流水线健康度 ──
     domain-neutral 路径豁免 5 项（ownership.yaml:207）
       .claude/bypass.log (domain-neutral 路径豁免，不参与条件区域判定)
       .claude/task-briefs/2026-09-26-D1023-a3-g10-g11-fakegreen.md (domain-neutral 路径豁免，不参与条件区域判定)
       .codex/vb1-probe.json (domain-neutral 路径豁免，不参与条件区域判定)
       memory/notes/implemented/process/2026-09-27-a3-g10-g11-fakegreen.md (domain-neutral 路径豁免，不参与条件区域判定)
       task-state/vb1-probe.json (domain-neutral 路径豁免，不参与条件区域判定)
  ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)
  ✅ G11: 测试覆盖检查通过
```
```
  ✅ 全部 13 组通过          ← exit=0
  grep -c '无映射区域(跳过)' = 0
```

**file:line**：豁免分支 `scripts/pre-commit-check.sh:1259-1268`（`# D1023-DOMNEUTRAL-EXEMPT-BEGIN/END`，10 行）；锚定豁免 RE `:1255`；点名输出 `:1279-1281`；通过行 `:1283`
**判定：通过**。豁免生效且**逐项点名**（绿腿可见），假绿串计数 0。

---

## §2 判据 2（核心）—— 反例 b：区域外真代码 ⇒ G10 仍红

**探针**：`observer-adapters/claude-code-hook/hook.py`（tracked、58 行）—— 阶段一已实测其在 A/B/C/D × {现状转换 / globstar 参考} 下全部 NOMATCH；本阶段再用**修复后抽取式转换**复核仍全 NOMATCH（见 §5）。
命中暂存集：`{brief(#CRITERIA:D), observer-adapters/claude-code-hook/hook.py}`（lead 提醒的坑已避开：**brief 必须在暂存集**）

**原始输出**：
```
── 组 10/13: V3 流水线健康度 ──
  ❌ G10: 条件区域不匹配: 1 处  [CI strict——历史 WARN 类在 CI 也转硬]
     observer-adapters/claude-code-hook/hook.py (不在条件 D 的映射区域内)\n
  ✅ G11: 测试覆盖检查通过
```
```
$ echo $?  →  exit=1
全部 ❌ 明细（共 2 条，均非"带绿"）:
  ❌ G10: 条件区域不匹配: 1 处  [CI strict——历史 WARN 类在 CI 也转硬]
  ❌ G12: task brief Q2 范围一致性（写集单一事实源，D749）: 1 处  [硬阻断]
grep -c '无 task brief 变更(跳过)' = 0        ← 证明不是走软跳过
```
**判定：通过**。豁免未放宽整条闸；且 G12 作为**独立第二道防线**同时判红。

---

## §3 判据 3 —— 判别力（删掉豁免分支必须转红）

**做法**：在副本内**物理删除** `:1259-1268` 区间（`sed -i.bak '/D1023-DOMNEUTRAL-EXEMPT-BEGIN/,/D1023-DOMNEUTRAL-EXEMPT-END/d'`），**重跑判据 1 的同一注入**。

**中间检查（原始）**：
```
  删除前后行数:     1675 -> 1665      （少 10 行 = 该区间）
  语法检查 bash -n: OK
  区间标记残留: 0 处（必须 0）
  豁免串残留: 0 处（必须 0）
```
**原始输出**：
```
── 组 10/13: V3 流水线健康度 ──
  ❌ G10: 条件区域不匹配: 1 处  [CI strict——历史 WARN 类在 CI 也转硬]
     .claude/bypass.log (不在条件 D 的映射区域内)\n  .claude/task-briefs/2026-09-26-D1023-a3-g10-g11-fakegreen.md (不在条件 D 的映射区域内)\n  .codex/vb3-probe.json (不在条件 D 的映射区域内)\n  memory/notes/implemented/process/2026-09-27-a3-g10-g11-fakegreen.md (不在条件 D 的映射区域内)\n  task-state/vb3-probe.json (不在条件 D 的映射区域内)\n
  ❌ 1 组未通过 — 提交已拒绝          ← exit=1
```
**判定：通过**。同一注入、唯一变量 = 豁免分支存在与否 ⇒ 判据 1 的"绿"确实来自该分支，**不是恒绿的静态判据**。
**独立第二证据**：夹具自身的 `exempt_probe=RED_CONFIRMED(rc=1)`（§8）与我的 VB3 结论一致。

---

## §4 判据 4 —— glob 转换修复有效性 + 回归

### 4.1 抽取实现的真实 sed（不是我的复现）
```
$ sed -n '1235p' scripts/pre-commit-check.sh | sed -E "s/.*sed -E '(.*)'\)$/\1/"
s#[*][*]/#@DSTAR@#g; s#[{]([^}]*)[}]#(\1)#g; s#,#|#g; s#[*]#.*#g; s#[?]#.#g; s#@DSTAR@#(.*/)?#g
```
### 4.2 逐 glob 求值（原始）
```
判据 D (5 条):
   src/**/*.ts                        -> src/(.*/)?.*.ts
   scripts/**/*.{sh,py}               -> scripts/(.*/)?.*.(sh|py)        ← 修复生效
   tests/**                           -> tests/.*.*
   package.json                       -> package.json
   build-synova.cjs                   -> build-synova.cjs
合成: (src/(.*/)?.*.ts|scripts/(.*/)?.*.(sh|py)|tests/.*.*|package.json|build-synova.cjs)
```
- `scripts/**/*.{sh,py}` 现命中 `scripts/pre-commit-check.sh`：**是**（`scripts/` + `(.*/)?` 空匹配 + `.*` + `.` + `sh`）。
- 与其他判据的交叉命中（预测+实测一致）：`src/l3/x.ts -> AD`、`src/growth/z.ts -> BD`、`src/routes/r.ts -> CD`（D 为兜底，符合 `D.description="所有源文件(兜底)"`）。

### 4.3 回归集（task-1 rev3 点名的 10 项）
```
   src/l3/x.ts                            应属 A -> AD   （含 A）
   src/sentinel/y.ts                      应属 A -> AD
   src/growth/z.ts                        应属 B -> BD
   src/routes/r.ts                        应属 C -> CD
   electron/main.cjs                      应属 C -> C
   package.json                           应属 D -> D
   build-synova.cjs                       应属 D -> D
   src/index.ts                           应属 D -> D
   src/deep/nested/x.ts                   应属 D -> D
   tests/control-tower/x.test.sh          应属 D -> D
   回归失败数 = 0
```
另用**真实存在文件**复跑：`src/sentinel/runner.ts`(A) / `src/routes/diagnosis.ts`(C) / `electron/main.cjs`(C) / `package.json`(D) / `build-synova.cjs`(D) / `src/index.ts`(D) / `tests/control-tower/precommit-groups-injection.test.sh`(D) 全部 MATCH。

### 4.4 全仓库单调性审计（5571 追踪文件，逐判据）
```
判据 A: 旧命中 6 → 新命中 51 ；新增 45 ；**丢失 0**
判据 B: 旧命中 55 → 新命中 81 ；新增 26 ；**丢失 0**
判据 C: 旧命中 0 → 新命中 98 ；新增 98 ；**丢失 0**
判据 D: 旧命中 1293 → 新命中 1571 ；新增 278 ；**丢失 0**
```
**判定：通过**。修复**只补回**此前被误判的合法在区内文件，**无一条 MATCH→NOMATCH 回归**。

---

## §5 判据 5 —— ⑥ `tests/**` 归 D 且零漂移

**完整 diff**：
```
-  "_comment": "V3 §1.5 条件代码区域映射表 — CP3 检查代码变更归属",
+  "_comment": "…。D.glob 的 tests/** 为 D1023 A3补修新增（CTO 2026-09-27 裁定）：…",
-      "glob": ["src/**/*.ts", "scripts/**/*.{sh,py}", "package.json", "build-synova.cjs"],
+      "glob": ["src/**/*.ts", "scripts/**/*.{sh,py}", "tests/**", "package.json", "build-synova.cjs"],
```
**字段级漂移审计**：
```
  顶层键一致；判据键一致
  A: glob 3->3 added=[] removed=[] | name同=True desc同=True keys同=True
  B: glob 3->3 added=[] removed=[] | name同=True desc同=True keys同=True
  C: glob 4->4 added=[] removed=[] | name同=True desc同=True keys同=True
  D: glob 4->5 added=['tests/**'] removed=[] | name同=True desc同=True keys同=True
  _comment 同 = False            ← 差异 D3
  JSON 合法性: json.load OK
```
命中实测：`tests/control-tower/x.test.sh` / `tests/foo/y.test.ts` / `tests/a.ts` / `tests/control-tower/precommit-groups-injection.test.sh` **全部 → D**。
**判定：通过**（`tests/**` 归 D 且 A/B/C 与 D 判据字段零漂移）；但 `_comment` 亦被改动，与 ⑥ 字面"其余字段零漂移"不符 → **差异 D3**。

---

## §6 判据 6 —— ⑦ 假绿闭合：三态探针（P1–P4 口径**先固化后执行**，未挪动）

| 态 | 构造 | G10 输出（原始） | 门禁 |
|---|---|---|---|
| 状态1 `python`✗/`python3`✓ | 默认 PATH | `✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)` | `✅ 全部 13 组通过` exit=0 |
| 状态2 `python`✓/`python3`✓ | `PATH=/tmp/a3fix-phase1/bin:$PATH`（垫片 python→python3） | `✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)` | `✅ 全部 13 组通过` exit=0 |
| 状态3 两者皆✗ | `PATH=/tmp/a3fix-phase1/nopy-bin`（链接 1254 可执行，排除 python 家族） | `⚠️  G10: 无可用 python（python3/python/py 三级探测全失败） — 条件区域检查本项不可判定（降级登记；既不打绿勾也不判红）` | `❌ 3 组未通过`（皆非 G10） |

**P1（状态1 与状态2 必须同一结论）——PASS**：同一暂存集下两态输出逐字一致：
```
  state1(VB1) = G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)
  state2(VB5) = G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)
```
（修复前两态**相反**：state1 假绿 / state2 红 —— 即阶段一 B1 的可判别前后差异。）

**P2（三态都不得把 `无映射区域(跳过)` 当 ✅）——PASS**：三态 `grep -c '无映射区域(跳过)'` 均为 **0**。

**P3（状态3 必须同时有可见文本 + degraded 登记）——PASS**（lead 指定的重点）：
```
可见文本: ⚠️  G10: 无可用 python（python3/python/py 三级探测全失败）
degraded-events.log 增量 = 1（运行前 0 → 运行后 1）
{"time": "2026-09-27T12:16:01+00:00", "component": "pre-commit-group10-criteria-map", "reason": "无可用 python（python3/python/py 三级探测全失败） — G10 不可判定 (degraded, 不判绿)"}
```
即：**G10 条目确实存在**（`component=pre-commit-group10-criteria-map`），**不是**被别组的红掩盖——状态3 的 3 条红全部是别组（`plan.principles` / `plan.approach` / `plan-integrity` / `D734 … python 不可用，无法做域校验（fail-closed，不静默放过）` / `D943 … 无可用 python（fail-closed，不静默跳过）`），G10 本身只出 `⚠️`、不出 `❌`。
**对照阶段一基线**：状态1 基线为 `✅ G10: 条件 C 无映射区域(跳过)` + `✅ 全部 13 组通过` + **degraded 文件都不存在**；状态3 基线 G10 仍 `✅ …(跳过)` **且 degraded 无 G10 条目** ⇒ B1 已闭合。

**P4（夹具在状态1/2 仍 exit 0）——PASS**：见 §8（夹具自身在 state1 下实跑 `exit=0`）。

**file:line**：三级探测 `:1196-1202`；不可判定置位 `:1203` / `:1217`；⚠️ 可见 `:1220`；degraded 写盘 `:1223`；`MISMATCH` 初始化 `:1239`；判定分支 `:1240-1242`。
**判定：通过**。

---

## §7 判据 7 —— 回归：注入夹具仍须 exit 0

**命令**：`bash tests/control-tower/precommit-groups-injection.test.sh`（副本内）

**原始输出（末行机器可读汇总）**：
```
GATE_INJECTION_SUMMARY: scenarios=8 red_confirmed=5 structural_not_red=0 not_red=0 green_confirmed=2 green_fail=0 baseline=ok probe=not_run(rc=n/a) exempt_probe=RED_CONFIRMED(rc=1) residue_code=0 residue_repo=8 shim=1 g10region_named=1
✅ 注入自测结果：期望红组全部 RED_CONFIRMED、期望绿场景（g10exempt）GREEN_CONFIRMED、判别性探针 RED_CONFIRMED，残留断言满足，baseline=ok（结论归自验/独立审计，本夹具只出证据）
FIXTURE_EXIT=0
```
**逐场景（与本卡相关）**：
```
g10exempt  0  3  3  GREEN_CONFIRMED   → 组 10 区块无 ❌; ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 2 项); 豁免点名行=3
g10region  1  2  3  RED_CONFIRMED     → ❌ G10: 条件区域不匹配: 1 处  [CI strict…]
g10tests   1  3  3  GREEN_CONFIRMED   → 组 10 区块无 ❌; ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 1 项)
[D1023] g10region 点名确认: ❌ 明细含 'observer-adapters/claude-code-hook/hook.py (不在条件 D'
```
**关键项**：`structural_not_red=0`（旧探针地雷已除，阶段一 §9.1 的前提③落地）＋ `green_fail=0` ＋ `exempt_probe=RED_CONFIRMED(rc=1)`（判别力）＋ `residue_code=0`。
`probe=not_run`：该探针是"基线不绿时"的因果隔离探针（`BEFORE_BRIEF_EVI` 宿主 `/tmp` 泄漏），本次 `baseline=ok` 故无需运行；本人已用 VB3 独立复现等价判别力。
`residue_repo=8`：夹具自己说明该面是"仓库全量 = 既有基线数"，且 `:823-832` 已登记为 **P2-2 已知脆弱性**（硬编码计数随文档增长漂移，6→7→8 均为合法文档命中，非真泄漏）——本卡未引入新残留。
**判定：通过**。

---

## §8 判据 8 —— 边界/越界扫描

```
$ git ls-remote --heads origin fix/a3-g10-g11-fakegreen-20260927
98485b7cff7cf7e1bdde3d43fa8183c375ea0d8c	refs/heads/fix/a3-g10-g11-fakegreen-20260927
$ git status --porcelain      → （空）
$ git diff --stat ad2cce20..98485b7c
 .claude/bypass.log                                 |   1 +
 .claude/task-briefs/2026-09-26-D1023-a3-g10-g11-fakegreen.md       |  49 +++-
 .codex/criteria-code-map.json                      |   4 +-
 memory/notes/implemented/process/2026-09-27-a3-g10-g11-fakegreen.md |  53 ++++
 scripts/pre-commit-check.sh                        |  88 +++++-
 tests/control-tower/precommit-groups-injection.test.sh             | 311 +++++++++++++++++++--
 6 files changed, 466 insertions(+), 40 deletions(-)
文件总数 = 6            ← 判据字面是"5 个约定文件" → 差异 D2
.github/** 改动: ad2cce20..HEAD = 0 处；PR 全量 4afd4ce1..HEAD = 0 处
INJECTED-RED 逐文件: scripts/pre-commit-check.sh=0 / .codex/criteria-code-map.json=0 / brief=0 / 夹具=0 / Note=0
空 blob 检测: （无输出）
```
**判定：通过**（写集无越界、`.github/**` 零改动、红证 0、无空 blob），附差异 D2（第 6 个文件是 hook 自动写入，见 §12）。

---

## §9 判据 9 —— CI 同口径 + 夹具接线

- 所有实跑均带 **`SYNO_CI=1`**（＋`GITHUB_ACTIONS=true`）——与 `ci.yml:99-101` 的 Iron Laws job 同口径。
- **CI 同口径绿腿（`SYNO_DIFF_BASE=4afd4ce1` = 真实 PR 全量 6 文件）**：
```
$ GITHUB_ACTIONS=true SYNO_DIFF_BASE=4afd4ce1 SYNO_CI=1 bash scripts/pre-commit-check.sh
── 组 10/13: V3 流水线健康度 ──
     domain-neutral 路径豁免 4 项（ownership.yaml:207）
       .claude/bypass.log / .claude/task-briefs/2026-09-26-D1023-….md / .codex/criteria-code-map.json / memory/notes/implemented/process/2026-09-27-….md
  ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 4 项)
  ✅ 全部 13 组通过            exit=0
  无映射区域(跳过) = 0
```
（与 lead 独立跑出的"豁免 4 项"数字一致——但这是我的复现，不引用其结论。）
- **夹具接线**：
```
$ grep -n "precommit-groups-injection.test.sh" .github/workflows/ci.yml
596:        run: bash tests/control-tower/precommit-groups-injection.test.sh
```
**判定：通过**。

---

## §10 证伪方向（逐条：真的去试了）

### 证伪① 豁免是否过宽？（含 ⑧ 口径诚实性）
- **清单逐字同源**：`ownership.yaml:207` domain_neutral 计数 = **14 项**，与实现 `:1255` 正则内的 14 个分支一一对应（顺序一致）。
- **作用域审计（全量 5571 追踪文件）**：豁免覆盖 **1370 个**文件，其中**源码类 3 个**（全在项 7 `docs/synova/product-lines/evidence/**`）：
```
docs/synova/product-lines/evidence/D592-run-e2e.sh                                                   D区=False 豁免=True ⇒ G10 放行
…/fixtures/fixture-green/extensions/sentinels/canary-sentinel/computes/detect.ts                      D区=False 豁免=True ⇒ G10 放行
…/fixtures/fixture-red/extensions/sentinels/canary-sentinel/computes/detect.ts                        D区=False 豁免=True ⇒ G10 放行
```
⇒ **"豁免只针对账本"字面不成立**（阶段一已报，CTO 裁定按 ⑧ 口径处理）。
- **⑧ 口径诚实性核查（我实测，不采信自述）**：
```
memory/notes/implemented/process/2026-09-27-a3-g10-g11-fakegreen.md
  含「只针对账本」: 1 处  ← 出现在**禁令句**内（:41 `禁写成"只针对账本"`），非违规使用
  含「domain-neutral 路径豁免」: 4 处；含 evidence/** 边界记录: 2 处；含 D592-run-e2e.sh: 1 处；含 detect.ts: 1 处
  :49-51  **已知边界（如实记录）**：该 14 项并非"只含账本文档"——`docs/synova/product-lines/evidence/**`
          实际覆盖 3 个**源码类**文件（`D592-run-e2e.sh` 231 行 + fixtures `fixture-green`/`fixture-red` 的 `detect.ts` 6 / 5 行，均实测）
```
  **行数声明逐条复核（我自己的 wc）**：`D592-run-e2e.sh`=231 ✓；`fixture-green/detect.ts`=**6** ✓；`fixture-red/detect.ts`=**5** ✓ ⇒ **Note 的 ⑧ 数字准确、边界未被隐去**。
- **锚定性**（防前缀误扩）：`task-statefoo/x.json` / `task_state/x.json` / `.codexfoo/x` / `docs/synova/product-lines/evidence2/x.md` / `myAGENTS.md` / `AGENTS.md.bak` / `knowledge/shared/README.md.bak` **全部 豁免=False** ✓
- **结论：未能证伪"豁免被当作闸门放宽"**（它确实只是路径级豁免且已如实登记边界）；但同时确认"账本类"这一措辞不准确 —— 已按 CTO ⑧ 口径记录为 **domain-neutral 路径豁免（14 项）**，已知边界 3 个源码类文件。

### 证伪② 条件区域匹配是否被改成锚定 / 是否被放宽？
```
匹配仍为非锚定（grep -qE，无 ^...$）:
   src/l3/x.ts -> MATCH ; xx/src/l3/x.ts -> MATCH ; src/l3/x.ts.bak -> MATCH ; prefixsrc/index.ts -> MATCH
   scripts/pre-commit-check.sh -> MATCH ; xscripts/a.sh -> MATCH
```
- 实现文本 `:1269` 仍为 `grep -qE "($REGEX_GLOBS)"` —— **未锚定**，符合卡面"不得把条件区域的匹配方式改成锚定"。
- "是否被放宽"用全仓库单调性量化（§4.4）：四判据 **丢失 0** —— 未收紧（无回归）；新增全部是**此前被误判**的合法在区文件（A +45 / B +26 / C +98 / D +278）。
- 边界说明（非缺陷）：因匹配非锚定，`scripts/**/*.{sh,py}` 亦命中 `dsh/plugins/**/scripts/*.sh`（D 覆盖 1293→1571）——这是卡面明确要求保留的既有语义。
- **结论：未能证伪**（既未被锚定化，也未被收紧）。

### 证伪③ `{a,b}`→`(a|b)` 对其余含逗号 glob 是否副作用？
```
map 中 glob 总数 = 15；花括号**外**含逗号 = 0
app/**/*.{html,js,css}                -> app/(.*/)?.*.(html|js|css)     ✓
electron/**/*.{cjs,js}                -> electron/(.*/)?.*.(cjs|js)     ✓
scripts/**/*.{sh,py}                  -> scripts/(.*/)?.*.(sh|py)       ✓
extensions/ontology/edge-types/*.json -> extensions/ontology/edge-types/.*.json  ✓（无逗号，不受影响）
```
- 当前数据下**无副作用**（15 条 glob 无一在花括号外含逗号）。
- **但自选注入实验命中潜在缺陷**：实现里 `s#,#|#g` 是**无条件**的（先花括号→圆括号，再把所有 `,`→`|`），故
```
   src/a,b.ts        -> src/a|b.ts          (被转成 | —— 潜在副作用)
   src/x{1,2},y.ts   -> src/x(1|2)|y.ts     (被转成 | —— 潜在副作用)
```
- **结论：未能证伪"当前回归"**（数据不触发）；但记录为**未被触发的潜在缺陷** → §13-存疑2。

### 证伪④ 场景 a 的绿是否真由 G10 给出？
```
VB1: ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)      ← 指到 G10 行本身
VB1: grep -c '无映射区域(跳过)' = 0 ; grep -c '无 task brief 变更(跳过)' = 0
夹具: g10exempt 判定 GREEN_CONFIRMED；:105 明确记录 `✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 2 项); 豁免点名行=3`
```
- **结论：未能证伪**。场景 a 确走 G10 判定分支（G11 另行为 `✅ G11: 测试覆盖检查通过`，可区分）。

### 证伪⑤ ⑦ 是否把闸门推到另一个假绿？
- **甲（python 不可用，卡面所问）**：状态3 输出 `⚠️` 而非 `✅`，且 degraded 有 G10 条目 ⇒ **未能证伪**。
- **乙（自选：map 存在但声明判据无 glob 映射）**：副本内把 `A.glob` 置空 + brief 改 `#CRITERIA: A`：
```
── 组 10/13: V3 流水线健康度 ──
  ✅ G10: 条件 A 无映射区域(跳过)
  ✅ 全部 13 组通过            exit=0
  「无映射区域(跳过)」计数: 1
```
  ⇒ **命中一条残留静默绿路径**（`:1286`）。属"读不到映射却打绿"同族，但触发条件是 **map 数据**（当前 A–D 均有非空 glob，故**不触发**），非 python 缺失。记 §13-存疑1；**不建议在本卡内修**（属判据语义变更，须另立卡）。

---

## §11 自验员自身的两次失误（主动披露，防止把工具缺陷当被测缺陷）

1. **VB1 首次运行出现 `❌ brief 模板残留: 发现 1 处未填注释 (<!--)`** —— 根因是我的探针标记写成 `<!-- … -->`，被组 6 的模板残留检查命中。**与被测件无关**；改标记后 VB1 = `✅ 全部 13 组通过`。
2. **P1 首次比对"结论不一致"** —— 根因是我给 state1/state2 用了**不同规模**的暂存集（5 文件 vs 2 文件），豁免计数自然不同。改用**逐字相同**的暂存集后 P1 = 逐字一致。
3. **`git ls-files` 默认 `core.quotepath` 会八进制转义中文路径**，导致我第一次统计源码类文件时漏掉 2 个 `detect.ts`（得 1 而非 3）；加 `-c core.quotepath=false` 后得 **3**，与阶段一一致。

---

## §12 编码者声明 ↔ 实测 差异清单（逐条）

| # | 声明出处 | 声明原文 | 实测 | 判定 |
|---|---|---|---|---|
| D1 | `scripts/pre-commit-check.sh:1182-1184` 注释 | "原式对**多行**匹配会产出多行值（**实测**：brief 里出现 3 处 `#CRITERIA:` ⇒ `CRITERIA='D\nD\nD'`）" | 交付态 brief 上按**实现原式** `grep -oE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]'` 的匹配数 = **1**（唯一匹配在第 3 行）。brief 中 8 行含 `#CRITERIA`，其余 7 行刻意避开"紧跟 `:`/`=`" | **声明不可复现**：该"实测"在交付件上不成立（大概率来自施工中某个中间版本）。**代码本身（`head -1`）无害且防御性正确**（无 python 失败路径已有显式降级，故 `head -1` 防的是"多匹配→插值语法错"的可见降级），但注释把不可复现的情形写成"实测"。**建议**：改注释为"防御性：多匹配时取首处"或补上可复现的构造。**不构成退回理由**，仅要求措辞对齐事实 |
| D2 | task-2 判据 8 字面"写集只在 **5** 个约定文件内" | — | `ad2cce20..HEAD` 实为 **6** 文件：多出的 `.claude/bypass.log` 由 post-commit 自动 hook 在提交 `98485b7c`（`chore: bypass COMMITTED 登记 (auto hook, D521)`，author=`D1029 fixture`）写入，内容 = 1 行 `COMMITTED \| pre-commit PASS (hook 层登记) \| HASH=1959f8d3…`；与 `ad2cce20` 同模式 | **非人工越界**：自动 hook 产物、落在豁免域、与基线同模式。判据 8 判定=通过，附此说明 |
| D3 | task-1 rev3 ⑥ 字面"只加 `tests/**` 一项，不动 … 其余字段" | — | D.glob 4→5 仅 `+tests/**` ✓；但 `_comment` **也被扩写**（追加 ⑥ 裁定理由） | **字面差异**：`_comment` 非判定语义字段、内容为裁定留痕（有益），但确实动了"其余字段"。**建议 CTO 收件闸确认可接受**，或要求回退 `_comment` |

（另：`head -1` 是卡面 ①–⑧ 之外**未列示的第 4 处改动**（同文件内）。已就此单列 D1。）

---

## §13 存疑（本卡未闭合的缺口；不建议在本卡内修）

**存疑1（残留静默绿路径，低危、当前数据不触发）**：`scripts/pre-commit-check.sh:1286` 仍存在
```
soft_pass "G10: 条件 $CRITERIA 无映射区域(跳过)"
```
当 **map 可解析成功**但被声明判据的 glob 列表为空时，G10 仍打 `✅`（实测见 §10-证伪⑤-乙：`✅ G10: 条件 A 无映射区域(跳过)`，门禁 `exit=0`）。与"读不到 map 却打绿"同族，但与 ⑦ 所修的 python 不可用路径**不是同一条**。当前 A/B/C/D glob 均非空 ⇒ 不触发。按 ⑦ 自身原则（不可判定须可见、禁假绿），此路径宜改为 ⚠️+degraded —— 但**属判据语义变更，须 CTO 裁定并另立卡**，本卡不动。

**存疑2（潜在副作用，低危、当前数据不触发）**：`:1235` 的 `s#,#|#g` 无条件把**所有**逗号转为 `|`，仅"巧合地"正确（因为当前 15 条 glob 的逗号全在花括号内）。实测注入：`src/a,b.ts -> src/a|b.ts`、`src/x{1,2},y.ts -> src/x(1|2)|y.ts`。未来任何在花括号外含逗号的 glob 会被静默改义。属未触发缺陷，记录待后续卡。

---

## §14 遗留（同族未收口 / 已知项，均超出本卡范围）

**遗留1（同族未收口）**：`scripts/pre-commit-check.sh` 中**另有 2 处**仍用裸 `python`（G10 已改三级探测）：
```
1152:    DECLARED=$(python -c "                 ← 组 9 契约门禁
1647:python -c "                                ← CP3 检查点写盘（|| true，仅影响产物落盘）
```
在本机（`python` 无、rc=127）实测组 9 输出为 `✅ 契约门禁: 声明产出须在暂存区` —— 即**同一族的静默通过**仍然存在（`DECLARED` 为空 ⇒ 无 `CONTRACT_FAIL` ⇒ 打绿）。**本卡范围 = G10，可接受**；建议后续卡按 ⑦ 同一范式收口（夹具 `:181` 亦已记录此发现）。

**遗留2**：夹具面 (b) `residue_repo=8` 为**硬编码基线**，夹具 `:823-832` 已自登记为 **P2-2 已知脆弱性**（新增文档引用该标记即推红）。本卡未引入新增残留（`residue_code=0`，本卡改动文件 `INJECTED-RED` 全 0）。

**遗留3**：`probe=not_run(rc=n/a)`（夹具的因果隔离探针）本次未运行，因 `baseline=ok` 无需归因；若日后 CI 宿主出现 `/tmp/.synova-before-brief` 泄漏，需该探针参与归因。

---

## §15 环境复用与复现

```
# 冻结副本（只读工作树，全部实跑在副本内）
T=$(mktemp -d /tmp/a3fix-verify-XXXX)
git clone --local /Users/wane/SynovaAgent/.synova-wt-a3fix $T/repo    # HEAD=98485b7c
# 判据 1/3/6/9（CI 同口径）
cd $T/repo && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh
# ⑦ 状态2 / 状态3
PATH=/tmp/a3fix-phase1/bin:$PATH … bash scripts/pre-commit-check.sh      # python→python3 垫片（仿真物，不得进仓库）
PATH=/tmp/a3fix-phase1/nopy-bin   … /bin/bash scripts/pre-commit-check.sh # 隔离 python 家族
# 夹具
bash tests/control-tower/precommit-groups-injection.test.sh
```
原始日志（自验员自持，未入库）：`/tmp/a3fix-phase1/verify-logs/{VB1,VB2,VB3,VB4,VB5,VB6,VB7}.log`、`VB8-fixture.log`；阶段一基线 `/tmp/a3fix-phase1/BASELINE.md`、预备档 `/tmp/a3fix-phase1/PHASE2-PREP.md`。

---

## §16 自验结论

**`可提请独立审计`**

依据：task-2 rev3 的 **9 条判据全部通过**（每条附命令原始输出与 `file:line`）；卡面要求的 **4 个证伪方向均未证伪出缺陷**；判别力两路独立确认（本人 VB3 + 夹具 `exempt_probe=RED_CONFIRMED`）。同时**如实列出**：
- 3 条**声明↔实测差异**（D1 `head -1` 注释的"实测"不可复现；D2 diff 实为 6 文件；D3 `_comment` 亦被改动）—— 均为**措辞/登记层面**，不改变判定，**不构成退回理由**，但建议 CTO 收件闸要求 D1 注释措辞对齐事实；
- 2 条**存疑**（§13：`:1286` 残留静默绿路径、`s#,#|#g` 无条件替换）—— 均**当前数据不触发**，属判据语义 / 数据形态边界，**建议另立卡**，不在本卡内修；
- 3 条**遗留**（§14：组 9 与 CP3 写盘仍用裸 `python`、夹具 P2-2、探针未运行）。

**本报告不构成"审计通过"**：通过与否归 CTO 收件闸 + K3 复审。自验员为只读方，除本文件外未改仓库任何文件。

---

## §17 增量复核（task-3 修正后）

> **被测 SHA 对照（务必并列读）**
> · 原 §1–§16 的**原 9 条判据**被测 SHA = **`98485b7c`**（该节内容为原始记录，未删改，见 §17.9）
> · 本 §17 的**增量复核**被测 SHA = **`27886250b1b5223087d8446f8cef949f825150f2`**
>   （= 手工提交 `13520fb2` + auto-hook `27886250`；`git ls-remote` 与本地 HEAD 同值）
> · 增量复核范围 = task-3 的**两处验收后修正**（原报告 D1 注释措辞 + 存疑2 逗号转换收敛）+ 授权扩集（夹具 b 面基线 8→9）。**不重做全量**。
> · 共享任务：`task-4`（owner=a3fix-verifier）。纪律：除本文件外只读；一律 `SYNO_CI=1`；沙箱在 `/tmp` 副本内。

### §17.1 判据 1 —— delta 边界：手改件恰 2 个

```
$ git diff --name-only 98485b7c..27886250
.claude/bypass.log                                          ← auto-hook (D521) 产物，非手改
docs/synova/product-lines/evidence/D1023-A3fix-selfverify.md ← 本报告，a3d5d1c9 已提交，属历史
scripts/pre-commit-check.sh                                 ← 手改 1
tests/control-tower/precommit-groups-injection.test.sh       ← 手改 2

$ 排除上面两个非手改项后 → 手改件数 = 2 （期望 2）✓

$ git diff --stat 98485b7c..27886250
 .claude/bypass.log                                 |   2 +
 .../evidence/D1023-A3fix-selfverify.md             | 434 +++++++++++++++++++++
 scripts/pre-commit-check.sh                        |  37 +-
 .../precommit-groups-injection.test.sh             |  21 +-
 4 files changed, 483 insertions(+), 11 deletions(-)
```

**手改件① `scripts/pre-commit-check.sh`：恰 2 处改动（其余上下文行未动）**
1. `:1184-1193` **注释措辞**（修正 A）——原「（实测：brief 里出现 3 处 `#CRITERIA:` ⇒ `CRITERIA='D\nD\nD'`）」整段替换为可复现表述（见 §17.2）；`head -1` 代码本身**未动**。
2. `:1240-1264` **转换管线**（修正 B）——单参数 `sed -E 'a; b; c; …'` → **9 条 `-e`**（含 `:dmgrp` / `t dmgrp` 标签循环），实现"逗号只在花括号组内转 `|`"（见 §17.3）。

**手改件② `tests/control-tower/precommit-groups-injection.test.sh`：b 面基线 8→9，逐处核对（我上轮提示的 5 处全改）**
```
:815  [b 面登记] 演进叙述   6 →（M9/#741）7 →（D945）8 →（D1023 task-3）9     ✓
:817  「实测 8 条」→「实测 9 条」                                            ✓
:829  #9 docs/synova/product-lines/evidence/D1023-A3fix-selfverify.md 登记    ✓
      （并显式写明"责任归属记在自验报告引用了该标记，不是编码者引入残留"）
:838  REPO_RESIDUE 行尾注释「b 面期望 = 基线 9」                              ✓
:848  b) 回显「基线 9」                                                       ✓
:853  [ "$REPO_RESIDUE" -gt 9 ]                                               ✓
:855  ✅ 回显「b<=9」                                                          ✓
:836  P2-2 待办叙述补「8→9」                                                  ✓
```
⇒ **5 处以上全部同步**，未出现"判据=9、回显=8"的不一致。**判据 1 通过。**

### §17.2 判据 2 —— 修正 A：数字逐字相符 + 证人独立复现（成立）

**我重跑注释所引的四个数字（原始输出）**
```
① .claude/task-briefs/*.md 文件总数                     = 419
② 含 '#CRITERIA' 子串的文件数                            = 320
③ 按本模式 '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' 匹配 ≥2 处 = 36
④ 口径A「含 '#CRITERIA' 子串 ≥2 次」                     = 40
```
**与注释逐字比对**（自实现抽取，防我看错）：
```
#   防御性（可复现，非"我记得"）: `.claude/task-briefs/*.md` 共 419 份，其中 320 份含 `#CRITERIA` 子串，
#   **36 份**按本模式 `#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]` 匹配 **≥2 处**。触发源 = brief 模板注释行
#   `<!-- #CRITERIA: A/B/C/D ... -->`（`A` 是 `A/B/C/D` 的前缀，故与真声明被同一模式一并命中）。
#   一条命令复现证人: grep -nE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' .claude/task-briefs/2026-08-14-auto.md
#     → :128 `#CRITERIA: A` + :129 模板注释行 ⇒ 抽取得 $'A\nA'（多行）⇒ 上述 python 插值 SyntaxError。
#   计数口径勿混: 「含 `#CRITERIA` 子串 ≥2 次」的文件 = 40 份，≠ 上句的模式匹配 36 份。
```
⇒ 419 / 320 / 36 / 40 **四个数字逐字相符**；原不可复现的「实测 3 处」残留计数 = **0**。

**独立复现证人（我按注释给的那一条命令原样跑）**
```
$ grep -nE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' .claude/task-briefs/2026-08-14-auto.md
128:#CRITERIA: A
129:<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->
$ grep -oE … | sed -E 's/.*[=:][[:space:]]*//'
A
A                    ← 2 行 ⇒ CRITERIA = $'A\nA'
```
把该值插进**真实代码形状**的字面量后编译：
```
g = m.get('criteria', {}).get('A
                               A', {}).get('glob', [])
→ SyntaxError（证人成立）: EOL while scanning string literal (<g10-criteria-probe>, line 4)
```
⇒ **证人成立**：一条命令可复现、机制真实（模板注释行的 `A` 是 `A/B/C/D` 前缀，被同一模式命中）。**判据 2 通过，不退回。**

### §17.3 判据 3 —— 修正 B：等价性（15/15 逐字节相同，且只改这一处行为）

方法：**从两个 git 对象抽取真实 sed 管线**（`git show 98485b7c:` / `git show 27886250:`），在同一组输入上分别执行，**不重实现、不采用编码者输出**。
```
OLD(98485b7c) 单参数:
  s#[*][*]/#@DSTAR@#g; s#[{]([^}]*)[}]#(\1)#g; s#,#|#g; s#[*]#.*#g; s#[?]#.#g; s#@DSTAR@#(.*/)?#g
NEW(27886250) 9 条 -e:
  1) s#[*][*]/#@DSTAR@#g                    6) s#@L(GRP|BR)@([^}]*)[}]#(\2)#g
  2) s#[{]#@LBR@#g                          7) s#[*]#.*#g
  3) :dmgrp                                 8) s#[?]#.#g
  4) s#@L(BR|GRP)@([^@}]*),#@LGRP@\2|#g     9) s#@DSTAR@#(.*/)?#g
  5) t dmgrp
```
**要求 1：全部现存 glob（15 条）OLD vs NEW 逐字节比对 → 逐字节不同数 = 0**（示例，全表见运行日志）
```
A src/l3/**/*.ts        OLD=src/l3/(.*/)?.*.ts          NEW=src/l3/(.*/)?.*.ts           相同
C app/**/*.{html,js,css} OLD=app/(.*/)?.*.(html|js|css)  NEW=app/(.*/)?.*.(html|js|css)   相同
D scripts/**/*.{sh,py}  OLD=scripts/(.*/)?.*.(sh|py)     NEW=scripts/(.*/)?.*.(sh|py)     相同
D tests/**              OLD=tests/.*.*                   NEW=tests/.*.*                  相同
D package.json          OLD=package.json                 NEW=package.json                相同
…（15/15 全为「相同」）
```
**要求 2：花括号外逗号保持字面（自造反例 5 条，非编码者输出）**
```
src/a,b.ts        OLD=src/a|b.ts        NEW=src/a,b.ts        逗号保字面 ✓
src/x{1,2},y.ts   OLD=src/x(1|2)|y.ts   NEW=src/x(1|2),y.ts   逗号保字面 ✓
src/[a,b].ts      OLD=src/[a|b].ts      NEW=src/[a,b].ts      逗号保字面 ✓（字符类内）
src/a,b,c.ts      OLD=src/a|b|c.ts      NEW=src/a,b,c.ts      逗号保字面 ✓
src/*,x.ts        OLD=src/.*|x.ts       NEW=src/.*,x.ts       逗号保字面 ✓
```
**要求 3：`{html,js,css}` 三元素仍正确**
```
app/**/*.{html,js,css}   → app/(.*/)?.*.(html|js|css)    OLD=NEW ✓
electron/**/*.{cjs,js}   → electron/(.*/)?.*.(cjs|js)    OLD=NEW ✓
scripts/**/*.{sh,py}     → scripts/(.*/)?.*.(sh|py)      OLD=NEW ✓
```
**要求 4：卡面回归集 10/10 仍 MATCH**（`src/l3/x.ts`→A、`src/sentinel/y.ts`→A、`src/growth/z.ts`→B、`src/routes/r.ts`→C、`electron/main.cjs`→C、`package.json`→D、`build-synova.cjs`→D、`src/index.ts`→D、`src/deep/nested/x.ts`→D、`tests/control-tower/x.test.sh`→D）⇒ **回归失败数 = 0**。

**附加：`-e` 形式的 BSD/GNU 断言（task-4 点名要求在本环境实测）—— 编码者的理由成立**
```
① sed -E ':a; s#x#y#; ta'          → stdout='xxx\n'  stderr="unused label 'a; s#x#y#; ta'"   ← 单参数 ';' 分隔标签：标签被整串吞掉、管线未生效
② sed -E -e ':a' -e 's#x#y#' -e 'ta' → stdout='yyy\n'  stderr=''                            ← 分写 -e 才正确
③ sed -E -e 's#x#y#' -e 't done; s#y#z#' → stderr="undefined label 'done; s#y#z'"            ← `-e` 内标签后裸 ';' 同样被吞
NEW 管线在本机 BSD sed 上跑全部 15 条 glob：**无任何 stderr**
```
⇒ 新管线的 `:dmgrp` / `t dmgrp` **必须**各自独立成 `-e`，编码者注释所述 BSD 原因**成立且必要**。

**判据 3 通过。** 唯一行为差异在**异常输入**（未闭合 `{`），见 §17.6。

### §17.4 判据 4 —— 不回归（门禁 + 夹具，二者均在新 HEAD 上实跑）

**门禁（CI 同口径，`/tmp` 副本内，state1 本机真态：`python` 无 / `python3` 在）**
```
$ GITHUB_ACTIONS=true SYNO_DIFF_BASE=ad2cce209fd556d2e71aa981c14a9b46ff430285 SYNO_CI=1 bash scripts/pre-commit-check.sh
── 组 10/13: V3 流水线健康度 ──
     domain-neutral 路径豁免 5 项（ownership.yaml:207）
       .claude/bypass.log / .claude/task-briefs/2026-09-26-D1023-….md / .codex/criteria-code-map.json
       / docs/synova/product-lines/evidence/D1023-A3fix-selfverify.md / memory/notes/implemented/process/2026-09-27-….md
  ✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)
  ✅ G11: 测试覆盖检查通过
  ✅ 全部 13 组通过                     exit=0
  无映射区域(跳过) = 0
```
该 base 的变更集实为 **7 文件**（`.claude/bypass.log` / brief / `.codex/criteria-code-map.json` / 本证据文档 / memory Note / `scripts/pre-commit-check.sh` / 夹具），其中 **5** 落 domain-neutral 豁免面，另 2 个（脚本、夹具）落 D 区 ⇒ 与期望「豁免 **5** 项」一致。

**夹具（同副本）**
```
$ bash tests/control-tower/precommit-groups-injection.test.sh        → exit=0
GATE_INJECTION_SUMMARY: scenarios=8 red_confirmed=5 structural_not_red=0 not_red=0 green_confirmed=2
  green_fail=0 baseline=ok probe=not_run(rc=n/a) exempt_probe=RED_CONFIRMED(rc=1)
  residue_code=0 residue_repo=9 shim=1 g10region_named=1
b) 仓库全量命中: 9 个文件（基线 9，逐条登记见上方 [b 面登记]；逐行如下）
✅ 残留断言满足（a=0, b<=9, c>0）
  …
  docs/synova/product-lines/evidence/D1023-A3fix-selfverify.md      ← 第 9 条 = 本自验报告自身（已在 [b 面登记] #9）
```
四项期望值逐项命中：`residue_repo=9` ✓ / `exempt_probe=RED_CONFIRMED(rc=1)` ✓ / `green_fail=0` ✓ / `g10region_named=1` ✓。
**判据 4 通过。**

### §17.5 判据 5 —— 原 9 条判据逐条复核（接触面 1/2/3/4/5/7 已重跑）

| # | 判据 | 结论 | 依据 |
|---|------|------|------|
| 1 | 反例 a：账本文件 + `#CRITERIA:D` ⇒ G10 不红 | **不变**（重跑） | `✅ 全部 13 组通过`；`✅ G10: 条件区域检查通过 (D; domain-neutral 豁免 5 项)` + 5 项点名；假绿串 0 |
| 2 | 反例 b：区域外真代码 ⇒ G10 仍红 | **不变**（重跑） | `❌ G10: 条件区域不匹配` 点名 `observer-adapters/claude-code-hook/hook.py`；exit=1；`无 task brief 变更(跳过)`=0（另有 G12 独立红） |
| 3 | 判别力：删豁免分支 ⇒ 转红 | **不变**（重跑） | 物理删 `:1259-1268` 后同注入 `❌ G10` 点名全部 5 个账本文件；`bash -n` OK、标记残留 0 |
| 4 | glob 转换修复 + 回归 | **不变 + 加强**（重跑） | `scripts/**/*.{sh,py}` → `scripts/(.*/)?.*.(sh|py)` 命中 `scripts/pre-commit-check.sh`；回归 **10/10**；**新增：15 条现存 glob 修正前后逐字节相同**（§17.3） |
| 5 | ⑥ `tests/**` 归 D 且零漂移 | **不变**（静态重跑） | task-3 **未碰** map（`git diff 98485b7c..27886250 -- .codex/criteria-code-map.json` = 0 处）；vs `ad2cce20` 仍仅 `+tests/**`，A/B/C 零漂移；`tests/*` 三个探针 + 夹具路径全 → D |
| 6 | ⑦ 假绿闭合（三态 P1–P4） | **不变（未接触面）** | task-3 未改 python 探测（`-e` 管线与 `G10_PYBIN` 无关）；本次门禁实跑 G10 走**真判定**（非"无映射区域(跳过)"），假绿串 0 |
| 7 | 夹具仍 exit 0 | **不变**（重跑） | `FIXTURE_EXIT=0` + SUMMARY 四项全中（§17.4） |
| 8 | 边界/越界扫描 | **不变**（重跑） | 手改件恰 2；`.github/**` 0 处；两处手改件 `INJECTED-RED`=0；无空 blob |
| 9 | CI 同口径 + 夹具接线 | **不变**（重跑） | 所有实跑带 `SYNO_CI=1`；`ci.yml:596` 仍登记夹具 |

### §17.6 异常输入行为差异（新引入的潜在边界）—— **方向 = fail-closed（已实测）**

```
$ ERE_OLD='src/a{b.ts';    echo 'src/a{b.ts' | grep -qE "($ERE_OLD)"   → MATCH   （旧：**不**判红）
$ ERE_NEW='src/a@LBR@b.ts'; echo 'src/a{b.ts' | grep -qE "($ERE_NEW)"  → NOMATCH （新：判 MISMATCH → 红）
派生结果: src/a{b.ts  OLD=src/a{b.ts  NEW=src/a@LBR@b.ts
          src/a}b.ts  OLD=src/a}b.ts  NEW=src/a}b.ts          相同
          src/{a}.ts  OLD=src/(a).ts  NEW=src/(a).ts          相同
```
**机制**：新管线把 `{` 先替为占位符 `@LBR@`、靠 `}` 收口；未闭合 `{` 使占位符**未还原** ⇒ 派生 ERE 含字面 `@LBR@` ⇒ 不再匹配任何真实路径 ⇒ 判红。旧管线对非法 interval `{b` 按**字面量**处理，恰好字面命中同名文件 ⇒ 不判红。
**定级**：当前 **15 条现存 glob 无一含未闭合 `{`** ⇒ **不触发**；且差异方向是 **fail-closed**，新管线在该路径上**比旧管线更严**，属**净安全改进**（不是放宽/假绿方向），**不构成退回理由**，也不在本卡修。

### §17.7 过程诚实性：一条"队长表述经自验员实测更正"（如实记录）

- 队长在裁定 `@LBR@` 泄漏条目时曾附带断言「OLD 管线对未闭合 `{` **也**判红」。**该句系队长未实测而写**（其本人已认领此误）。
- 我实测：**OLD = MATCH（不判红）**；只有 NEW 判红 ⇒ 正确表述是「**旧 = open 侧 / 新 = closed 侧**」。
- **本条属队长表述更正，不是编码者问题**；我按"先报后记"先报队长、经确认后写入本节。同理，我上一轮曾据**旧管线**误判「编码者的 BSD 断言是错误归因」，经队长以一手证据驳回后**已撤回**（判定改为「BSD 断言成立、`-e` 形式必要」，见 §17.3）。

### §17.8 K3 脱离 `/tmp` 的复核命令集（全部可直接复制执行）

```bash
cd /Users/wane/SynovaAgent/.synova-wt-a3fix && git rev-parse HEAD   # 期望 27886250…（本 §17 的被测 SHA）
# ① delta 边界（手改件应恰 2）
git diff --name-only 98485b7c..27886250
git diff --stat      98485b7c..27886250
git diff             98485b7c..27886250 -- scripts/pre-commit-check.sh
git diff             98485b7c..27886250 -- tests/control-tower/precommit-groups-injection.test.sh
# ② 修正 A 的四个数字（应与注释逐字相符）
ls .claude/task-briefs/*.md | wc -l
grep -l '#CRITERIA' .claude/task-briefs/*.md | wc -l
for f in .claude/task-briefs/*.md; do c=$(grep -oE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' "$f" | wc -l); [ "$c" -ge 2 ] && echo "$f"; done | wc -l   # 36
for f in .claude/task-briefs/*.md; do c=$(grep -o '#CRITERIA' "$f" | wc -l); [ "$c" -ge 2 ] && echo "$f"; done | wc -l                                        # 40
# ② 证人（多行值 → python 插值 SyntaxError）
grep -nE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' .claude/task-briefs/2026-08-14-auto.md      # :128 + :129
python3 -c "compile(\"g = m.get('criteria', {}).get('A\nA', {})\", '<p>', 'exec')"                 # SyntaxError
# ③ 修正 B 等价性：从两个 git 对象抽管线后逐字节比对
git show 98485b7c:scripts/pre-commit-check.sh | grep -n "REGEX=\$(echo" -A1
git show 27886250:scripts/pre-commit-check.sh | grep -n "REGEX=\$(echo" -A11
#    （抽取后对 15 条 glob 分别执行；也可直接复用 /tmp/a3fix-phase1/task4-criterion3.py 的方法自建）
# ③ BSD 标签断言
printf 'xxx\n' | sed -E ':a; s#x#y#; ta'                  # 无 yyy + unused label
printf 'xxx\n' | sed -E -e ':a' -e 's#x#y#' -e 'ta'       # yyy
# ④ 门禁（CI 同口径；沙箱请自行 mktemp -d + git clone --local 后在内执行）
GITHUB_ACTIONS=true SYNO_DIFF_BASE=ad2cce209fd556d2e71aa981c14a9b46ff430285 SYNO_CI=1 bash scripts/pre-commit-check.sh
bash tests/control-tower/precommit-groups-injection.test.sh
# ⑤ b 面基线 5 处同步（应全为 9）
grep -n "基线 9\|-gt 9\|b<=9\|实测 9 条\|→（D1023 task-3）9" tests/control-tower/precommit-groups-injection.test.sh
```

### §17.9 §17 后的自验结论

**`可提请独立审计`**

- 增量复核的 **5 条判据全部通过**；task-2 的 **9 条判据结论均不变**（接触面 1/2/3/4/5/7 已在本 HEAD 上重跑，见 §17.5）。
- task-3 的两处修正**均已收口**：D1 从「措辞不实」变为「措辞可复现 + 机制有证人」；存疑2 从「无条件全局转逗号」收敛为「仅花括号组内」，且**已证明在所有现存 glob 上零行为变化**。
- 唯一新增边界（未闭合 `{` ⇒ 占位符泄漏）方向为 **fail-closed**，当前数据不触发，不构成退回理由。
- **本 §17 不引入任何新的引用该标记的文件**（同文件追加不改变文件计数；夹具 b 面维持 `residue_repo=9`，实跑已证）。
- 原 §1–§16 保持原始记录**未删改**，其被测 SHA 仍为 `98485b7c`；两者差异仅为本 §17 所述两处修正。
- **本报告不构成"审计通过"**：通过与否归 CTO 收件闸 + K3 复审。自验员为只读方，除本文件外未改仓库任何文件。
