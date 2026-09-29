# Task Brief: D1069 resolve-commit-brief 强锚点失配修复

> 生成: 2026-09-29 | 任务: D1069 | 认领: squad-lead (门禁线小队)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 源派单: 现场 alloc「D328 修复：resolve-commit-brief.sh 强锚点失配」
> 🔴 目的声明: 解除「认领锚点失配」对四条链的阻塞（#868→#894 / #883 / #892）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔（scripts/，非 L1–L5 产品层）。scripts/workflow/resolve-commit-brief.sh 是
**认领制 brief 解析器**：给定暂存文件列表，回答「本提交由哪个 task brief 管辖」。
它是 pre-commit G12 / check-plan-integrity.sh / check-brief-vs-code.sh /
check-verifiable-done.sh / commit-msg-check.sh / staging_guard.py 的共同上游。

**本任务不是扩展能力，是修复既有解析器的优先级语义**：
（i）强锚点（提交自身身份 = 暂存 task-state 的 D# / 分支名）当前只做 tie-break 与
末位回退，**永远压不过「窗口内旧 brief 的认领计数」**；
（ii）认领计数按 (暂存文件 × Q2 路径条目) 出现次数 而非去重文件数；
（iii）强锚点 D#→brief 定位依赖文件名 `*-D<id>-*` 分隔符 glob，**17 个 brief / 18 个 D# 物理不可达**。

### b) 文件审计（全部为开工前实测原始输出）
> **复现环境钉（2026-09-29 补，由 coder-tests 上报 + 队长复核）**：下列两条复现**只在 main 树成立**：
> `ROOT=/Users/wane/SynovaAgent`、`git rev-parse --abbrev-ref HEAD` = `main`（**无分支强锚点**）、
> 被测脚本 `shasum -a 256` 前缀 `47ea3d3aa63f5aa7`（= `git show origin/main:…` 逐字节同源，diff 为空）、
> 且 main 树存在**未跟踪**的 `2026-09-29-D1061-CT提速+门禁机制修正.md`（1049 B，alloc 空模板）。
> **在工作树不复现**：工作树分支 `fix/D1069-resolve-brief-anchor` 自带 D1069 强锚点，
> 且其 `.claude/task-briefs/` 为已跟踪检出、不含该 untracked brief。
> ⇒ C1/C3 的「修前」被测物一律改用**按内容定 pin** 的
> `git show origin/main:scripts/workflow/resolve-commit-brief.sh`（sha256 前缀同上），
> 使红证不依赖「当时工作树恰好是什么」。C2/C3 绿证须在「D1061 brief 可见」的环境跑（临时按字节复制并证明零残留）。

复现 1 —— 暂存 task-state/D1061.json（提交自身身份 = D1061）却解析到 D1039：
```
$ bash scripts/workflow/resolve-commit-brief.sh ".github/workflows/ci.yml
task-state/D1061.json"
/Users/wane/SynovaAgent/.claude/task-briefs/2026-09-28-D1039-A4-CI成本收口.md
--- exit=0 ---
```
对照 —— 仅当竞争者认领数为 0 时强锚点才生效（= 末位回退，形同虚设）：
```
$ bash scripts/workflow/resolve-commit-brief.sh "task-state/D1061.json"
/Users/wane/SynovaAgent/.claude/task-briefs/2026-09-29-D1061-CT提速+门禁机制修正.md
--- exit=0 ---
```
计数语义（同一路径在 D1039 brief Q2 中重复 4 次）：
```
$ sed -n '/^## Q2/,/^## Q3/p' ".claude/task-briefs/2026-09-28-D1039-A4-CI成本收口.md" | grep -c '^\- \.github/workflows/ci\.yml —'
4
```
锚点 glob 可达性（briefs_by_id :92-102 用 `*-D${id}-*`）：
```
$ for f in .claude/task-briefs/*.md; do ... done
MISS  2026-08-22-D471.md   (D471)
MISS  2026-09-17-D791a-line3-onepager-win.md   (D791)
MISS  D311-multi-session-coordination.md   (D311)
MISS  D312-baseline-tools.md   (D312)
MISS  D313-D314-control-tower-finalize.md   (D313)
MISS  D320-dashboard-gitify.md   (D320)
MISS  D362-docs-sync.md   (D362)
MISS  D371-product-progress-phase1.md   (D371)
MISS  D372-product-progress-idempotency.md   (D372)
MISS  D373-product-progress-pr-fix.md   (D373)
MISS  D374-dsh-devdoc-preset.md   (D374)
MISS  D375-dsh-cto-audit-a2.md   (D375)
MISS  D376-routing-charter-v4.md   (D376)
MISS  D377-cto-handover-finalize.md   (D377)
MISS  D378-sentinel-count-fix.md   (D378)
MISS  D380-codeowners.md   (D380)
MISS  D808.md   (D808)
---
total briefs=173  missing-glob-cases=20
```
> **Q0b 勘误（2026-09-29，由独立自验员 T3 阶段一证伪后由队长自测复核）**
> 上文 `total briefs=173` 是**扫描时刻**的真值；加本任务书自身后现为 **174**
> （`ls .claude/task-briefs/*.md | wc -l` → 174）。属时间点漂移，非前提失效。
> 上表 20 行是**按 D# 枚举**的输出（同一 brief 可产多行）。按**文件名首 D# token**口径重算，
> 20 例的构成为：**17 例真身份失配**（上表除 D282/D593/D370 外）
> ＋ **3 例文件名内根本没有 D# token**（`2026-09-24-B5-taskstate-backfill.md`、
> `2026-09-24-M9-gate-integrity.md`、`brief.md`）——后 3 例不在上表中，因为按 D# 枚举时
> 内层循环为空、不产出行。**原稿「另 3 个是次位交叉引用」的归类不成立，特此更正。**
> （D282/D593/D370 三例确实是次位交叉引用，但它们的正确归属是「按规范 3 不再锚定」，
> 不计入失配清单。）
> 复核命令与输出：
> ```
> $ ls .claude/task-briefs/*.md | wc -l
> 174
> $ for f in .claude/task-briefs/*.md; do ... 首 D# token 为空 → echo NO-D-TOKEN ...; done
> NO-D-TOKEN  2026-09-24-B5-taskstate-backfill.md
> NO-D-TOKEN  2026-09-24-M9-gate-integrity.md
> NO-D-TOKEN  brief.md
> $ for f in ...; do <首 D# token 的 *-D<id>-* glob 是否命中>; done   # 排除 NO-D-TOKEN
> IDENTITY-MISS 2026-08-22-D471.md (D471) … IDENTITY-MISS D808.md (D808)   # 共 17 行
> ```

消费方（决定「失配」为何升级为硬阻断）：
- scripts/control-tower/staging_guard.py:75 以 --session <sid> 调 resolver，
  :86 `claim_did != sess_did` → status=block（"认领 brief D# 与本 session 任务不一致"）。
- scripts/pre-commit-check.sh:772、scripts/check-plan-integrity.sh:19、
  scripts/workflow/check-brief-vs-code.sh:35、scripts/check-verifiable-done.sh:21、
  scripts/commit-msg-check.sh:96、scripts/workflow/check-brief-parseable.sh:43。

写集选型实测 —— 新建 `tests/**/*.test.sh` 会触发 M9 密封面棘轮 CI-REGISTRY 违规
（check-gate-integrity.sh B 模式，CI 执行点 .github/workflows/ci.yml:732）：
```
$ bash scripts/control-tower/check-gate-integrity.sh      # 干净 main 树
CI-REGISTRY: 测试文件 742（密封面 sh/py 132；ts 面 610）；ci.yml 登记（密封面）55；密封面未登记 78；基线 78 条；基线外新增 0；基线过期 0
GATE-INTEGRITY: OK

$ printf '#!/bin/bash\nexit 0\n' > tests/control-tower/zz-probe-anchor.test.sh   # 探针（已删除）
$ bash scripts/control-tower/check-gate-integrity.sh
VIOLATION: 新增测试未登记 CI 密封清单: tests/control-tower/zz-probe-anchor.test.sh
CI-REGISTRY: 测试文件 743（密封面 sh/py 133；ts 面 610）；ci.yml 登记（密封面）55；密封面未登记 79；基线 78 条；基线外新增 1；基线过期 0
GATE-INTEGRITY: VIOLATION(1)

$ rm -f tests/control-tower/zz-probe-anchor.test.sh   # 已清理，无残留
```
⇒ 专项测试必须**追加进既有 `tests/control-tower/resolve-commit-brief.test.sh`**
（该文件已在 gate-integrity-baseline.txt [R] 段，追加零新增未登记文件）。

### c) 决策
复用既有强锚点机制（D718 已建立 ANCHOR_STRONG/WEAK 数据通路），**只改优先级与计数语义**。
新建 1 个专项测试文件（不碰既有 406 行套件的断言，避免同文件双写者）。
不为 anchor D#→brief 定位引入新格式约定 —— 复用 alloc-task-id.sh:191 既有边界正则惯例
`(^|[^0-9a-z])d<num>([^0-9]|$)`。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 0-2（spec→test→impl→wire→review→merge）；铁律 9（改核心定义后 grep 全仓库传播）；
  铁律 24/31（降级必留痕）；铁律 47（契约优先）；铁律 48（测试非空壳，三态覆盖）。
- memory 教训：D291/D296 跨 session 误伤（A 的提交被 B 的 brief 校验）；
  D317 回退静默返回坏 brief → CI 红；D328 认领校验判「他人文件」硬阻断（D664 实测被拦 2 次）；
  D559 CI runner UTC vs brief 日期 UTC+8；D660/D661 macOS `grep -oP` 家族复发；
  D718 同数认领字典序 → 陈旧 brief 恒胜。
- ctrl-tower-change 技能：模式 1（三态退出码，禁 `|| true` 吞崩溃）、模式 2（bash + 中文全角标点
  贴 `$VAR` → unbound variable）、模式 4（grep -c 无匹配 → "0\n0"）、模式 6（改门禁者的验收链）。
  本任务按 ctrl-tower-change 模式 6 全链执行。

### 决策参考（D333 四步）
- **① 第一性原理**：resolver 回答「本提交由哪个 brief 管辖」。证据分三级：
  ①**自证级** —— 暂存 task-state/D<id>.json 是**本提交自身的载荷**，分支名是本 session 的任务声明；
  ②**声明级** —— current-brief（session 单文件声明，不在提交载荷内）；
  ③**启发级** —— 日期窗口 + 路径认领计数。
  **当前实现把 ③ 排在 ① 之前**，即启发级压过自证级 —— 这是缺陷本体。
- **② Anthropic 工程基线**：显式优先级 > 投票启发；可判别性 > 统计性；降级必须留痕、绝不静默。
  自证信号是确定性输入，不应与计数投票同台竞争。
- **③ 开源实证（本项目内先例）**：alloc-task-id.sh:191/200/214 判断 D# 占用时已用边界正则
  `(^|[^0-9a-z])d${num}([^0-9]|$)` 而非分隔符 glob —— 「D# 边界匹配」是本仓既有惯例。
  git 自身身份解析（显式 user.name > 启发推导）同构。
- **④ 收敛检查**：修复须同时满足 —— 不回归 D291/D296（无锚点的陈旧 brief 仍不得劫持）、
  不回归 D718 测试 8/9/10/11、不引入「候选集窗口整体放宽」。故**仅抬高强锚点、不放宽窗口**。
- **参考系结论**：`参考：Anthropic 显式优先级 + 本项目 alloc-task-id 边界正则先例 + 第一性原理（自证级 > 启发级）`
  ⇒ 强锚点 brief 可解析时**直接定案**（不参与计数投票）；计数改为**去重文件数**；
  D#→brief 定位改为**文件名首 D# token 边界匹配**。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/workflow/resolve-commit-brief.sh — 三处修复（规范 1/2/3）。
- tests/control-tower/resolve-commit-brief.test.sh — **追加**专项测试段落（三态 + 改坏即红 + 生产接线）。
  ⚠️ 为什么是「追加」而不是「新建独立文件」：新建 `tests/**/*.test.sh` 会触发 M9 密封面棘轮
  CI-REGISTRY 违规（实测见 Q0b 末段），本卡不改 .github/workflows/ci.yml（与 #868/#1039 争用），
  故落在**已在基线 [R] 段的既有文件**上追加 —— 零新未登记文件、零写集扩张。
- docs/synova/product-lines/evidence/D1069/D1069-anchor-fix-evidence.json — 新建（C1–C5 证据 .json）。
- docs/synova/product-lines/evidence/D1069/D1069-C1C5-原始输出.md — 新建（C1–C5 命令原始输出全文）。
- docs/synova/product-lines/evidence/D1069/D1069-独立自验.md — 新建（独立自验员结论，非编码方）。
- docs/synova/product-lines/evidence/D1069/D1069-收尾三件-diff-自验结论-遗留清单.md — 新建（**M6 强制**队长收尾件）。
  · 非可选：M6「收尾三件（diff / 自验结论 / 遗留清单）必须提交进仓库并给路径」。
- memory/notes/implemented/2026-09-29-D1069-resolve-brief-anchor.md — 新建（**铁律 49 / D534 强制**决策 Note）。
  · 非可选：commit-msg-check.sh:140 的 CT_ORCH_TOUCHED 命中 `scripts/workflow/**` ⇒ 无 Note 引用则**物理无法提交**。
  · ⚠️ **文件名必须纯 ASCII**：门禁用 `grep -oE '(memory/notes|decisions)/[A-Za-z0-9_./-]+\.md'` 抽取路径，
    含中文字符的路径**抽不出来**（实测：中文名 → 抽取为空 → 判「引用的 Note 文件不存在」）。
  · 落 `implemented/` 而非 `proposed/`：先例 `memory/notes/implemented/2026-09-13-D718-ctl-minor-fixes.md`
    （同文件上次变更 D718 即把 Note 与脚本放进同一提交）。
- .claude/task-briefs/2026-09-29-D1069-resolve-commit-brief-强锚点失配修复.md — 本文件。
- task-state/D1069.json — 本卡任务态（alloc 已生成）。
不做什么：
- 不改 scripts/audit/ 下任何文件（K3 审计域红线）。
- 不改 scripts/pre-commit-check.sh（**与 D1065 争用，必须串行**；本卡只读调用它自检）。
- 不改 scripts/control-tower/brief_parser.py（最高风险门禁脚本类；其 bullet 不剥反引号 +
  排除臂对目录 glob 失效两处缺口已由 D1039 brief 登记为遗留，另立卡）。
- 不改 scripts/control-tower/staging_guard.py（消费方；本卡只修上游解析语义）。
- 不改 scripts/control-tower/alloc-task-id.sh（仅引用其边界正则惯例）。
- 不改 scripts/control-tower/gate-integrity-baseline.txt（棘轮基线，治理文件；本卡的方案选型
  已刻意规避对它的改动 —— 见上方「为什么是追加」）。
- 不改 tests/control-tower/brief-parser-strip.test.sh。
- 不改 .github/workflows/ci.yml（CI 域，本卡不新增 job；且与 #868 canary 追加同一处）。
- 不改 src/ 下任何文件（产品代码，铁律 0-5 分工）。

## 规范（冻结契约 — 编码方与测试方共同遵守，改此契约须回队长）★

**规范 1 — 优先级阶梯（显式，替换现有隐式投票）**
```
P0  强锚点**身份**集（ANCHORED_STRONG_IDENTITY，规范 3 一级）中存在 parse_criteria 通过的 brief
    →  直接输出，不再进入认领计数
    · 强锚点 D# 来源优先级: 暂存 task-state/D<id>.json  >  分支名 D#
    · P0 brief 不可解析 / 身份集为空 → 下探（不阻断），行为与修复前一致
    · **二级提及集不进 P0**（只入候选池 / 参与 tie-break）
P1  current-brief 认领 ≥1                     →  输出（原 :222 语义保留）
P2  去重认领数最高（同数: 强锚点 > 弱锚点 > 字典序）（原 :226-232）
P3  current-brief                             →  输出（原 :235 语义保留）
P4  最新日期可解析 brief                      →  输出（原 :284 语义保留）
```

**规范 2 — 认领计数 = 去重文件数**
```
scope = sorted({p.strip() for p in parse_q2(text)['include'] if p.strip()})   # 去空 + 去重路径
n     = sum(1 for sf in sorted({s.strip() for s in staged if s.strip()})      # 去空 + 去重暂存
            if any(match_path(sf, p) for p in scope))                         # 每文件至多计 1
```
不变式：同一路径在 Q2 写 N 次 ⇒ 对任一暂存文件贡献恒为 1。

**规范 3 — D#→brief 定位 = 两级（身份优先，提及兜底）★2026-09-29 队长裁决修订**
> 修订缘由：原稿「次位 D# 不参与锚定」与末句兜底「必须仍能命中旧 glob 能命中的全部组合」
> 在 2 个真实文件上互斥（coder-anchor 实测上报）。现按立法目的拆为两级，矛盾消解。

- brief 的**任务身份 D#** = 文件名 basename 中**第一个** `D<digits>` token；
- 边界规则对齐 alloc-task-id.sh:191：`(^|[^0-9a-z])d<num>([^0-9]|$)`（大小写无关）；
- **一级（身份集）**：`身份 D# == 锚点 D#` 的 brief ⇒ 进 `ANCHORED_STRONG_IDENTITY`：
  **可被 P0 直接定案** + 入候选池；
- **二级（提及集）**：**仅当一级为空时**，**追加**「锚点 D# 出现在非首位」的 brief ⇒
  只入候选池 / 参与 tie-break（= 今天的行为），**P0 不认**；
- 兜底（修订后口径）：**旧 glob 能命中的「任务身份」组合必须仍能命中**（身份回归目标 = 0 例）；
  次位「提及」不再**优先**锚定 —— 这是规范 3 的修复目标，不是回归。
- 已登记取舍（实测 2 例，须在回执与证据里逐条登记）：
  · `2026-09-29-D1064-FIX-D1032-….md` 含次位 D1032 ⇒ 一级对 D1032 不命中；
    而 D1032 有真身份件 `2026-09-28-D1032-CT系列-brief账本门禁收口.md` ⇒ 一级命中正确件，
    旧 glob 的双命中歧义被消除。
  · `D313-D314-control-tower-finalize.md` 含次位 D314 且**无独立 D314 身份件** ⇒
    一级为空 → **二级兜底保住覆盖**（这正是保留二级的理由）。

**规范 4 — 改坏即红的注入缝（★ 测试方依赖，不可改名/不可删）**
强锚点优先级逻辑必须包裹在如下**字面标记**之间（标记行独立成行、全大写）：
```
# <<<ANCHOR-PRIORITY-START>>>
... P0 优先级实现 ...
# <<<ANCHOR-PRIORITY-END>>>
```
测试方以 `sed '/<<<ANCHOR-PRIORITY-START>>>/,/<<<ANCHOR-PRIORITY-END>>>/d'` 生成**变异副本**，
断言其对复现输入返回 D1039（红）。标记外的一切（ANCHOR 采集、:149-151 入池、:230 tie-break、
:246 末位回退）保持不变，**变异副本必须仍可运行**。

**规范 5 — 不变式（修复不得破坏）**
- 无任何锚点时行为与修复前一致；
- current-brief 陈旧（日期 ≠ 今日窗口）时忽略（原 :61-62）；
- 候选池**不因本修复而扩大**（只改选择优先级，不改入池规则）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/workflow/resolve-commit-brief.sh "<暂存文件列表>"`（生产接线点见 Q0b）。
处理：解析锚点 → 优先级阶梯（规范 1）→ 输出 brief 绝对路径（或 exit 1 fail-open）。
结果：**修后对 Q0b 复现 1 的同一输入，返回 D1061 的 brief**；staging_guard.py:86 的
`claim_did != sess_did` 不再触发 → 四条链（#868/#883/#892/#894）解锁。

判据（全交，缺一退回）：
- C1 复现：修前两条实测原始输出（Q0b 已录；测试方须独立重跑复现并留原始输出）。
- C2 修复：修后**同一输入** ⇒ 强锚点命中（不再落 D1039）。
- C3 **改坏即红**：按规范 4 删除强锚点优先级 ⇒ 测试红；恢复 ⇒ 绿（两段原始输出全交）。
- C4 回归：resolve-commit-brief 相关套件全绿 + 邻居 commit-msg 类不回归。
- C5 证据 .json 落 docs/synova/product-lines/evidence/D1069/（附套件名与用例数）。

## 架构层:
scripts（控制塔 / 门禁链）— 非 L1–L5 产品层。按 ctrl-tower-change 技能模式 6 验收。

## Done 标准
- [ ] verify: bash scripts/workflow/resolve-commit-brief.sh "task-state/D1069.json" → exit 0 且输出含 D1069
- [ ] verify: bash tests/control-tower/resolve-commit-brief.test.sh → exit 0 且用例数 >0
- [ ] verify: 变异副本（规范 4 sed 删除）对复现输入返回 D1039 ⇒ C3 红证成立
- [ ] verify: bash scripts/control-tower/check-gate-integrity.sh → GATE-INTEGRITY: OK（密封面棘轮零新增违规）
- [ ] verify: git diff --name-only origin/main → 恰为写集 **9** 条，零越界
      （实测另含第 10 条 `.claude/bypass.log` —— 工具台账，append-only + `merge=union`，
        近 200 次提交 100% 触发；定性见 D1069-收尾三件 §2.4(a)，不剥离、随 PR 入 main、登记遗留 L6）
- [ ] verify: bash tests/control-tower/resolve-commit-brief.test.sh → 既有套件全绿（C4）
- [ ] verify: bash -n scripts/workflow/resolve-commit-brief.sh → exit 0
- [ ] verify: bash scripts/workflow/check-silent-swallow.sh **--diff** → exit 0（= pre-commit-check.sh:554 实际调用模式）。
      注：`--utf8` 是**全仓审计**，存量红（17 个 .sh 缺头块，实测本卡被测文件不在其中，`grep -c` = 0）
      ⇒ 只要求「零新增违规」，存量红登记遗留清单，不阻塞本卡。
- [ ] verify: bash scripts/check-plan-integrity.sh → exit 0
- [ ] verify: bash scripts/commit-msg-check.sh <msg> → exit 0（含 D395-a/D534 Note 门禁，Note 须纯 ASCII 文件名）
- [ ] 证据: docs/synova/product-lines/evidence/D1069/D1069-anchor-fix-evidence.json 含 C1–C5 结论与套件用例数
