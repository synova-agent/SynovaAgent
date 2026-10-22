# D935-M1 独立自验报告（verifier / task-2）

> 任务号 D935 ｜ 自验员：d935-verifier（**独立于编码 d935-encoder**，M3）
> 工作树：`/Users/wane/SynovaAgent/.synova-wt-d935` ｜ 分支 `fix/d935-ownership-presets-mac`
> 冻结状态：HEAD `6aa126e3b7f63e03d67ae2748cec054592a2943f`（自验期间未变）
> 基线：`origin/main` = `0946608339c5b4d4bc58277b1994d150582d9920`（自验期间曾前进到 `1a1cccc8`，见 §7.5）
> 口径：**独立复算，不采信编码转述**；全部数字取自命令原始输出，禁 `head`/`tail` 截断
> 写权限：本文件落 `docs/synova/product-lines/evidence/D935-20260924/`（本任务唯一可写）+ `/tmp`；**未改任何被测文件**
> 本卡 diff（`git diff --stat origin/main...HEAD`）= 6 文件 +209/-0；`git status --porcelain` = 0 行（本文件除外，见 §8）

## 结论先行

**自验结论：可提请独立审计**（四项全过且反例成立；另有 1 项存量控制塔缺陷 + 6 条口径/事实点名，见 §7）

---

## 0. 环境与冻结状态（命令 + 原始输出）

```
$ cd /Users/wane/SynovaAgent/.synova-wt-d935
$ git rev-parse --abbrev-ref HEAD   →  fix/d935-ownership-presets-mac
$ git rev-parse HEAD                →  6aa126e3b7f63e03d67ae2748cec054592a2943f
$ git status -sb                    →  ## fix/d935-ownership-presets-mac...origin/main [ahead 4]
$ git status --porcelain | wc -l    →  0
$ git diff --stat origin/main...HEAD
 .claude/bypass.log                                 |   2 +
 .../2026-09-24-D935-M1-ownership-presets-域修正.md | 125 +++++++++++++++++++++
 .github/CODEOWNERS                                 |   1 +
 docs/synova/coordination/ownership.yaml            |   8 ++
 .../2026-09-24-d935-ownership-presets-domain.md    |  46 ++++++++
 tests/control-tower/check-ownership.test.sh        |  27 +++++
 6 files changed, 209 insertions(+)
$ git log --oneline origin/main..HEAD
 6aa126e3 chore: bypass COMMITTED 登记 (auto hook, D521)
 51244556 docs(D935): 补 task brief + 决策 Note（治理产物，D860 豁免）
 fd4b4b58 chore: bypass COMMITTED 登记 (auto hook, D521)
 4015ab66 fix(D935): ownership 补 docs/synova/presets/** → mac（DSH 预设与技能，TASK-ROUTING L37）
```

`origin/fix/d935-ownership-presets-mac` **不在远端**：`git ls-remote --heads origin | grep -c d935` = 0（→ 属 task-3 push 待办，见 §7.2）。

---

## 1. ① 判别性夹具（我自造 /tmp 变异体，不复用编码沙箱）

沙箱 = `/tmp/d935-verifier-6c1eGY`（我新建）。变异做法：逐行删除 `- glob: "docs/synova/presets/**"` 规则的 **3 行本体**（glob/owner/source），**保留注释行**——以证明删的是规则而非注释。

**1.1 判别力前置证明（结构化，非 grep）**——用仓库自带 YAML 子集解析器解析两份 yaml：

```
$ python3 - <real> <mutated>   (scripts/product-lines/productline_yaml.py)
real.yaml:    rules 总数=43  presets 规则命中=1 [{'glob': 'docs/synova/presets/**', 'owner': 'mac', 'source': 'TASK-ROUTING.md L37 DSH 预设与技能'}]
mutated.yaml: rules 总数=42  presets 规则命中=0 []
```
```
$ grep -c "D935 增补" mutated.yaml                 → 1   （注释行仍在）
$ grep -c 'glob: "docs/synova/presets/\*\*"' ...    → 0   （规则本体已删）
```

**1.2 红（变异 yaml，先贴红）**

```
$ python3 scripts/control-tower/check-ownership.py docs/synova/presets/install-squad-lead.sh \
      --owner mac --yaml /tmp/d935-verifier-6c1eGY/mutated.yaml
win  docs/synova/presets/install-squad-lead.sh

❌ 越域: docs/synova/presets/install-squad-lead.sh —— 声明 owner=mac，实际 owner=win
❌ FAIL 越域 1 处（声明 owner=mac）
EXIT=1
```

**1.3 绿（真 yaml，后贴绿）**

```
$ python3 scripts/control-tower/check-ownership.py docs/synova/presets/install-squad-lead.sh \
      --owner mac --yaml /tmp/d935-verifier-6c1eGY/real.yaml
mac  docs/synova/presets/install-squad-lead.sh

✅ PASS 1 个文件全部归属 owner=mac（无归属 0）
EXIT=0
```

**1.4 因果对照（额外，比"红/绿"更强）**——`origin/main` 原版 yaml（修复前基线）同路径同断言：

```
$ python3 scripts/control-tower/check-ownership.py docs/synova/presets/install-squad-lead.sh \
      --owner mac --yaml /tmp/d935-verifier-6c1eGY/origin-main.yaml
win  docs/synova/presets/install-squad-lead.sh

❌ 越域: docs/synova/presets/install-squad-lead.sh —— 声明 owner=mac，实际 owner=win
❌ FAIL 越域 1 处（声明 owner=mac）
EXIT=1
```

⇒ **修复前 = 红（与变异体同结论）；修复后 = 绿**：本卡改动是 D734 跨域红转绿的**因果**，非巧合。判据真读数据（非 grep 型静态判据）。

---

## 2. ② 变基预演（D931 真实写集）

**2.1 取写集（8 件）+ 逐条存在性（本分支）**

```
$ git diff --name-only origin/main...origin/fix/d931-squad-lead-team
.claude/bypass.log
.synova/skills/squad-discipline/SKILL.md
.claude/task-briefs/2026-09-23-D931-squad-team-wiring.md
.dsh/skills/squad-discipline/SKILL.md
docs/synova/coordination/派单模板.md
docs/synova/presets/install-squad-lead.sh
docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
task-state/D931.json
（共 8 件）

$ 逐条 [ -e ] 检查本工作树：
EXISTS  : .claude/bypass.log
EXISTS  : .synova/skills/squad-discipline/SKILL.md
MISSING : .claude/task-briefs/2026-09-23-D931-squad-team-wiring.md   ← D931 自己的 brief
EXISTS  : .dsh/skills/squad-discipline/SKILL.md
EXISTS  : docs/synova/coordination/派单模板.md
EXISTS  : docs/synova/presets/install-squad-lead.sh
EXISTS  : docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
MISSING : task-state/D931.json                                       ← D931 自己的卡登记
```
**不存在于本分支的是 2 件，且都是 D931 自己的开工产物**（brief + task-state）——它们只存在于 `origin/fix/d931-squad-lead-team`，不在 `origin/main` 派生的本分支上；其余 6 件真实存在。

**2.2 (a) 路径判定口径（决定性）**——写集原样喂 `check-pr-budget.sh --files`：

```
$ bash scripts/control-tower/check-pr-budget.sh --files "<8 件，空格分隔>"
── PR 预算门禁（D734）: 基线=origin/main 上限=12 文件 / 落后阈值=20 ──
  ℹ️  D860 治理产物豁免: 2 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
  ✅ ① 变更文件数 6 ≤ 上限 12
  ✅ ② 变更单域: ✅ PASS 5 个文件同域: mac（无归属 0，域判定豁免 1）
  ✅ ③ 落后检查跳过（--files 注入模式无 git 上下文）
✅ PASS PR 预算内（6 文件）
EXIT=0
```
✅ 命中 CTO 期望：**exit 0 且出现 `✅ ② 变更单域`**。（换行分隔、单行空格分隔两种喂法结果一致。）

**2.3 (b) staged 口径（真实门禁）——⚠️ 实测该口径空转，必须点名**

```
$ git add <6 件真实存在的 D931 文件>   （6 次 git add 均 OK）
$ git diff --cached --name-only
（空 —— 0 行）
$ git status -sb
## fix/d935-ownership-presets-mac...origin/main [ahead 4]
```

原因（读脚本实证，非推测）：
- 6 件内容与本分支 HEAD **完全一致**（工作树干净）→ `git add` 不产生任何索引差异，暂存集为空；
- 且 D734 的文件清单来自 **脚本内 `git diff --name-only origin/main...HEAD`**（`check-pr-budget.sh:92`），**不读暂存区**；`pre-commit-check.sh` 全脚本 `grep "check-ownership"` = 0 命中 → D733 无独立组，仅经 D734（`check-pr-budget.sh:149` 调 `check-ownership.py`）生效。

⇒ **该口径无法把 D931 写集喂给门禁**，因此它本身不构成"#727 会转绿"的证据。仍按 CTO 要求完整跑一遍真门禁（结果：exit 0，D734 ✅，全 13 组通过 —— 但它判的是**本卡自己**的 6 件 diff）。完整输出见附录 A。

**2.4 补充：真门禁级变基预演（/tmp 克隆，只读源仓库）**

为让真门禁真正吃到 D931 写集，我在 `/tmp/d935-rehearsal` 用 `git clone --local` 建**一次性沙箱**（源仓库零写入），checkout 到 D931 tip `fb7ce0d5`，用 CI 注入缝（`GITHUB_ACTIONS=true SYNO_DIFF_BASE=origin/main`，`pre-commit-check.sh:273-279` 的官方 CI 路径）让 `STAGED_ALL` = `origin/main...HEAD` = D931 8 件：

```
[BEFORE] D931 tip + 未修复 ownership.yaml（与 origin/main 逐字节一致）
$ GITHUB_ACTIONS=true SYNO_DIFF_BASE=origin/main SYNO_CI=1 bash scripts/pre-commit-check.sh
  ── PR 预算门禁 (D734) ──
  ❌ D734 PR 预算超限 (拆 PR，禁调高上限——见 scripts/control-tower/check-pr-budget.sh): 11 处  [CI strict——软提示在 CI 上为硬阻断]
     ── PR 预算门禁（D734）: 基线=origin/main 上限=12 文件 / 落后阈值=20 ──
     ℹ️  D860 治理产物豁免: 2 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
     ✅ ① 变更文件数 6 ≤ 上限 12
     ❌ ② 变更跨域 —— 一个 PR 只许一个域（D733 ownership.yaml）
     mac  .synova/skills/squad-discipline/SKILL.md
     mac  .dsh/skills/squad-discipline/SKILL.md
     mac  docs/synova/coordination/派单模板.md
     win  docs/synova/presets/install-squad-lead.sh
          …（截断处为脚本自带 `head -12` 展示限制，原样保留）
  ❌ 1 组未通过 — 提交已拒绝
EXIT=1     ← #727 现状复现（D733/D734 硬红）

[AFTER] 同一 D931 tip + 注入本卡修复（ownership.yaml + CODEOWNERS，diff 逐字节一致已核）
$ GITHUB_ACTIONS=true SYNO_DIFF_BASE=origin/main SYNO_CI=1 bash scripts/pre-commit-check.sh
  ── PR 预算门禁 (D734) ──
  ✅ D734 PR 预算: 文件数 / 单域 / 落后基线 均在预算内
  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)
  ✅ 全部 13 组通过
EXIT=0     ← D733/D734 不再报错，且无其他组新增红
```

同一 8 件写集在"修复前/后"两个 yaml 下的域判定（直接复算）：

```
[修复前] python3 check-ownership.py <8 件> --yaml origin/main 版
·   domain-neutral  .claude/bypass.log
·   domain-neutral  .claude/task-briefs/2026-09-23-D931-squad-team-wiring.md
·   domain-neutral  task-state/D931.json
mac  .synova/skills/squad-discipline/SKILL.md
mac  .dsh/skills/squad-discipline/SKILL.md
mac  docs/synova/coordination/派单模板.md
win  docs/synova/presets/install-squad-lead.sh
win  docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 3）
EXIT=1

[修复后] 同 8 件 --yaml HEAD 版
·   domain-neutral  .claude/bypass.log
·   domain-neutral  .claude/task-briefs/2026-09-23-D931-squad-team-wiring.md
·   domain-neutral  task-state/D931.json
mac  .synova/skills/squad-discipline/SKILL.md
mac  .dsh/skills/squad-discipline/SKILL.md
mac  docs/synova/coordination/派单模板.md
mac  docs/synova/presets/install-squad-lead.sh
mac  docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
✅ PASS 5 个文件同域: mac（无归属 0，域判定豁免 3）
EXIT=0
```

**2.5 收尾：还原暂存区 + 证明干净**

```
$ git restore --staged .          →  EXIT=0
$ git status -sb
## fix/d935-ownership-presets-mac...origin/main [ahead 4, behind 18]
$ git status --porcelain | wc -l  →  0
$ git rev-parse HEAD              →  6aa126e3…（未变）
（/tmp/d935-rehearsal 已 rm -rf；`git worktree list` 无新增条目；源工作树 `git status` 干净）
```

---

## 3. ③ 本地 D733/D734 两组全绿

```
$ bash tests/control-tower/check-ownership.test.sh
  ✅ 全部通过: 58 项
EXIT=0

$ bash tests/control-tower/check-pr-budget.test.sh
  ✅ 全部通过: 32 项
EXIT=0
```
两组完整输出见附录 B / 附录 C（零删改）。新增判别性夹具段（§5b）在 D733 组内独立跑通：正常 3 项 + 改坏前置 1 项 + 改坏即红 2 项 + 原 yaml 复测 1 项。

---

## 4. ④ 未引入兜底放行（语义未改）

**4.1 变更行性质：纯插入、0 删除**

```
$ git diff --numstat origin/main...HEAD -- docs/synova/coordination/ownership.yaml
8	0	docs/synova/coordination/ownership.yaml

$ git diff -U0 origin/main...HEAD -- docs/synova/coordination/ownership.yaml
@@ -142,0 +143,8 @@ rules:
+  # D935 增补（2026-09-24）: DSH 预设与技能目录 docs/synova/presets/** 漏登记 → 落 `**` 兜底
+  #   判 win，与同写集的 mac 文件混装即被 D734 判「变更跨域」硬拦（D931 实测，卡住 PR #727）。
+  #   权威源 TASK-ROUTING.md L37「… + coordination + DSH 预设与技能 → Mac DSH」；兄弟路径
+  #   .claude/task-briefs/**、.synova/skills/**、.claude/settings.json、.dsh/** 均同源同归属
+  #   （见上方 Mac 例外区）。不改任何既有归属。
+  - glob: "docs/synova/presets/**"
+    owner: "mac"
+    source: "TASK-ROUTING.md L37 DSH 预设与技能"

删除行数（排除 --- 头）= 0 ｜ 新增行数 = 8
```

**4.2 `**` 兜底块 + `domain_neutral` 逐字节零改动**

```
$ diff <origin/main 版兜底块> <HEAD 版兜底块>     →  EXIT=0（无差异）
  - glob: "**"
    owner: "win"
    default: true
    territory: ["src/**", "extensions/**", "packages/**", "synova_worker/**", "docs/plans/**"]
    source: "TASK-ROUTING.md L38/L39（Win 域兜底: src/ 除下列 Mac 例外 + 未列明路径）"

$ diff <origin/main 版 domain_neutral 段> <HEAD 版 domain_neutral 段>  →  EXIT=0（无差异）
domain_neutral: [".claude/bypass.log", ".claude/gate-hits.log", ".claude/task-briefs/**", "task-state/**", "memory/notes/**", ".codex/**", "docs/synova/product-lines/evidence/**", ".gitignore", "AGENTS.md", "CLAUDE.md", "LOOP.md", "knowledge/shared/README.md", "docs/authority/DRIFT-LEDGER.md", "docs/authority/system-registry.json"]
```

**4.3 全仓投影（最强证据）：5406 个追踪文件的归属判定，修复前 vs 修复后**

```
追踪文件总数 = 5406 ｜ 规则条数 before/after = 42 / 43
domain_neutral 条数 before/after = 14 / 14
兜底规则(**) before == after 逐键相等 = True
domain_neutral 列表逐元素相等 = True
归属判定发生变化的追踪文件数 = 3
   docs/synova/presets/install-squad-lead.sh            : win → mac
   docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md: win → mac
   docs/synova/presets/synova-squad-lead/preset.yml      : win → mac
变化文件是否全部位于 docs/synova/presets/ 前缀内 = True
```
⇒ 除 presets 三条外，**全仓 5403 个文件的归属判定逐条不变**；无兜底放行、无越界改判。

**4.4 "无归属不阻断"仍然成立**

```
$ python3 check-ownership.py some/unregistered/area/foo.ts --yaml <HEAD 真 yaml>
win  some/unregistered/area/foo.ts
✅ PASS 1 个文件同域: win（无归属 0，域判定豁免 0）
EXIT=0     （对照 origin/main 版 yaml：逐字相同）

$ python3 check-ownership.py src/server.ts some/unregistered/area/foo.ts --yaml <我自造：删掉兜底块>
⚠️  无归属规则  src/server.ts
⚠️  无归属规则  some/unregistered/area/foo.ts
⚠️  src/server.ts 无归属规则匹配 —— 未计入阻断（ownership.yaml 可能缺规则或兜底被删）
⚠️  some/unregistered/area/foo.ts 无归属规则匹配 —— 未计入阻断（ownership.yaml 可能缺规则或兜底被删）
✅ PASS 0 个文件同域: 无归属（无归属 2，域判定豁免 0）
EXIT=0     （对照 origin/main 版删兜底：逐字相同 ⇒ 该语义本卡未动）
```

---

## 5. 额外必查

**5.1 `.github/CODEOWNERS` == `--emit-codeowners` 逐字节**

```
$ python3 scripts/control-tower/check-ownership.py --emit-codeowners > /tmp/gen   →  EXIT=0（stderr 空）
$ diff .github/CODEOWNERS /tmp/gen                                               →  EXIT=0（无差异）
$ cmp  .github/CODEOWNERS /tmp/gen                                               →  EXIT=0
$ wc -c  →  3308  .github/CODEOWNERS   ｜  3308  /tmp/gen
$ sha256 →  192c3eb3ae516ac75db4a11e4b79871f2e5ee9d2eda362f667c7d5198302f36f  （两侧同）
```

**5.2 presets 两行独立复算**

```
$ python3 scripts/control-tower/check-ownership.py \
      docs/synova/presets/install-squad-lead.sh \
      docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
mac  docs/synova/presets/install-squad-lead.sh
mac  docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
✅ PASS 2 个文件同域: mac（无归属 0，域判定豁免 0）
EXIT=0
```

**5.3 防夹带：brief `## 写集` 表 vs 实际 diff**

实际 diff 6 件：`.claude/bypass.log`、brief、`.github/CODEOWNERS`、`ownership.yaml`、决策 Note、`check-ownership.test.sh`
声明 8 条：上述 6 件 + `task-state/D935.json` + `docs/synova/product-lines/evidence/D935-20260924/**`

```
夹带件数（实际 diff 中未在声明表内）= 0   ✅
声明但尚未产出（非夹带，属待办）= 2 件：task-state/D935.json、evidence/D935-20260924/**（均不存在）
```
`.claude/bypass.log` 本卡新增 2 行，均为 `COMMITTED | pre-commit PASS (hook 层登记)`（HASH=4015ab66…/51244556…），**无 `detected-bypass`** ⇒ 本卡未使用 `--no-verify`。

**5.4 权威源核对（本卡前提）**

```
$ sed -n '37p' docs/synova/coordination/TASK-ROUTING.md
| scripts/control-tower/ + scripts/backup/ + 门禁脚本 + docs/synova/coordination/ + DSH 预设与技能 | **Mac DSH** | 控制塔持续维护 |

$ find . -type d -name presets -not -path "./node_modules/*" -not -path "./.git/*"
./docs/synova/presets        ← 全仓唯一的 presets 目录 → L37「DSH 预设与技能」路径映射无歧义
```
兄弟先例核对（brief 引 `ownership.yaml:155/:161`）——按 **origin/main 版**行号核对**成立**：

```
$ git show origin/main:docs/synova/coordination/ownership.yaml | grep -n 'glob: "\.synova/skills/\*\*"\|glob: "\.dsh/\*\*"'
155:  - glob: ".synova/skills/**"        （HEAD 版因 +8 行顺移至 163）
161:  - glob: ".dsh/**"                  （HEAD 版 169）
```

**5.5 `grep: repetition-operator operand invalid` 归因（编码判"存量"→ 我复核：成立，并定位根因）**

```
源行：scripts/pre-commit-check.sh:991  （组 7a 禁止 DiagnosticModule）
  NEW_DIAG=$(echo "$GIT_CACHED_DIFF" | grep "^+.*DiagnosticModule" | grep -Ev "…|import type|^+++|hard_check|…" || true)

$ diff <(git show origin/main:scripts/pre-commit-check.sh | sed -n '991p') <(sed -n '991p' scripts/pre-commit-check.sh)  →  EXIT=0
$ diff <(git show origin/main:scripts/pre-commit-check.sh) scripts/pre-commit-check.sh | wc -l  →  0
$ git diff --name-only origin/main...HEAD -- scripts/ | wc -l  →  0
$ echo "test" | grep -Ev "^+++"    →  grep: repetition-operator operand invalid   ｜  EXIT=2
```
根因：ERE 里 `^+++` 的 `+` 缺左操作数（本意是滤掉 diff 头 `+++ b/...`，应为 `^\+\+\+` 或 `^\+{3}`）。
**后果（我实测的最小复现）**：该 `-Ev` 整体失败 → `NEW_DIAG` 恒为空 → **组 7a 对"新增 DiagnosticModule"当前为 fail-open（恒过）**：

```
$ echo '<真实违规 diff>' | grep "^+.*DiagnosticModule" | grep -Ev "…|^+++|…"      →  空输出，EXIT=2（漏拦）
$ echo '<同一 diff>'      | grep "^+.*DiagnosticModule" | grep -Ev "… 去掉 ^+++ …"  →  +const m: DiagnosticModule = 1;  EXIT=0（能拦）
```
判"恒过"还需要 soft_check 侧的确认（已核 `pre-commit-check.sh:105-123`）：`[ -n "$matches" ] && count=$(…) || count=0`，`count=0` → 走 `else` → 打印 `✅` 并 `log_gate … miss`。即 **`SYNO_CI=1` 的 strict 分支只在 `count>0` 时生效**，空输出在本地与 CI 都是 ✅ ⇒ **组 7a 在本地与 CI strict 下同样 fail-open**，仅 stderr 留一行 `grep:` 报错（非阻断、无 degraded 登记）。

⇒ **非本卡引入**（脚本与 main 逐字节一致、本卡 0 触碰 `scripts/**`），但属控制塔存量缺陷，见 §7.6。

**5.6 红证不残留**

```
$ 本卡 6 件逐文件 git grep -c INJECTED-RED  →  全部 0
$ git diff origin/main...HEAD | grep -c INJECTED-RED  →  0
$ 全仓字面命中 = 4 个文件，全部为**散文引用**（K3 审计报告 / W1 计划 / D922 证据 / SYSTEM-PROMPT 坑清单原文），无真实注入残留
```
D922-phase0-verify 已记录同一"字面 grep 误报"现象 ⇒ 该判据为 M7 型指标漂移（非本卡问题）。

---

## 6. 与编码/队长声称的逐条对照

| # | 声称 | 我实测 | 判定 |
|---|---|---|---|
| 1 | 编码：判别性夹具"改坏即红" | 真 yaml exit 0（mac）/ 变异 yaml exit 1（win）/ origin/main 版 exit 1 | ✅ 一致，且更强（补因果基线） |
| 2 | 编码：`SYNO_CI=1` 下 `grep: repetition-operator operand invalid` 为存量 | 脚本与 main 逐字节一致、本卡 0 触碰 scripts/** | ✅ 成立（另附 fail-open 发现） |
| 3 | 队长（task-3）：`task-state/D935.json` "已落盘" | `ls` exit 1、`git ls-files` 空、不在 diff | ❌ **不符**（见 §7.1） |
| 4 | brief 写集表：`task-state/D935.json` builtin 卡登记 | 文件不存在 | ❌ **不符**（同上） |
| 5 | 队长（task-3）M6 要求"`git diff --stat` 原始输出" | 干净工作树下**裸 `git diff --stat` 输出 0 行** | ⚠️ 口径需改为 `origin/main...HEAD`（见 §7.3） |
| 6 | CTO 口径 ②(b)"staged 口径 → 真门禁判 D931 写集" | 暂存集为空且 D733/D734 不读暂存区 | ⚠️ 口径空转，已用 /tmp 克隆预演补齐（见 §7.4） |

---

## 7. 发现与点名（附证据）

**7.1 `task-state/D935.json` 不存在**（队长 task-3 写作"已落盘"、brief 写集表列为 builtin 卡登记）
→ 属 task-3 待办（写集内，非我越界修改）。附带一点：`docs/synova/presets/**` 的归属裁定与本文件无依赖，故不阻塞自验结论。

**7.2 `fix/d935-ownership-presets-mac` 尚未推送**：`git ls-remote --heads origin | grep -c d935` = 0 → **task-3 的 ls-remote 回执必须 push 之后再取**（否则会重演"声称已推送、实际只在本地"）。

**7.3 M6 的 diff 证据口径**：干净工作树上裸 `git diff --stat` = 0 行（我实测）。M6 三件里的 diff 应写 `git diff --stat origin/main...HEAD`（= 6 文件 +209/-0）。

**7.4 ②(b) staged 口径本身空转**（见 §2.3）：D734 判据是 `origin/main...HEAD` 而非暂存区，且 D931 内容不在本分支 ⇒ 该口径无法证明"#727 会转绿"。我用 `/tmp` 克隆 + CI 注入缝做了**真门禁预演**（BEFORE exit 1 `❌ ② 变更跨域` / AFTER exit 0 全 13 组通过），建议 CTO 把该预演口径写进后续同类卡的验收要求。

**7.5 `origin/main` 在自验期间前进**：`09466083` → `1a1cccc8`（PR #731 `docs/d934-cross-side-mode` 合并；reflog 显示 `fetch -q origin`，非我发起的写入）。本报告全部口径基线 = `09466083`；`merge-base(HEAD, origin/main)` 仍 = `09466083` ⇒ 三点点 diff 结果不受影响。当前 `ahead 4, behind 18`（≤20 阈值不告警），**PR 前应 rebase 到新 main**。

**7.6 存量控制塔缺陷（建议登记 CT 队列，非本卡范围）**：`scripts/pre-commit-check.sh:991` 的 `grep -Ev` 模式含 `^+++` → ERE 非法 → **组 7a（禁止 DiagnosticModule）fail-open 恒过**（§5.5 附最小复现与漏拦实证）。

**7.7 存量文案缺陷（低危）**：`.github/CODEOWNERS` 头第 4 行声明漂移门禁为 `tests/control-tower/ownership.test.sh`，**该文件全仓不存在**（唯一同类文件是 `check-ownership.test.sh`）；该字符串由生成器 `check-ownership.py:159` 硬编码，`origin/main` 版即如此，**非本卡引入**。

---

## 8. 遗留清单（handover）

1. **task-3**：产出 `task-state/D935.json`（分配器取号，`alloc-task-id.sh`）+ push 分支 + 取 `git ls-remote --heads origin | grep d935` 回执 + M6 三件落库（diff 用 `origin/main...HEAD` 口径）。
2. **本文件**：`docs/synova/product-lines/evidence/D935-20260924/self-verify.md` **已写入但未提交**（我未用 `synova-commit`：其自带 push，push 归 task-3；也避免与该任务同文件并发写）。→ 由 task-3 一并提交。
3. **PR 前 rebase**：新 main = `1a1cccc8`（领先 18 提交）。
4. **CT 队列（非本卡）**：`pre-commit-check.sh:991` 组 7a fail-open（§7.6）；CODEOWNERS 头漂移门禁文件名笔误（§7.7）。
5. **后续卡**：`docs/synova/presets/**` 的归属已由本卡裁定为 mac；M1b（最长前缀 / 未登记 fail-closed）不在本卡写集，本卡未动解析算法与兜底语义（§4 已证）。
6. **自验口径经验（建议回写坑清单）**：
   - "staged 口径"在**判据读 `origin/main...HEAD`** 的门禁上无效（§7.4）；
   - 干净工作树上裸 `git diff --stat` = 0 行（§7.3）；
   - `INJECTED-RED` 字面 grep 存在散文误报（§5.6，D922 已记录）。

---

## 附录：完整原始日志（零删改；仅剥除 ANSI 颜色转义）

- 附录 A：`SYNO_CI=1 bash scripts/pre-commit-check.sh`（staged 口径，本卡自身 6 件 diff）完整 106 行输出
- 附录 B：`bash tests/control-tower/check-ownership.test.sh` 完整输出（exit 0）
- 附录 C：`bash tests/control-tower/check-pr-budget.test.sh` 完整输出（exit 0）
- 附录 D：`/tmp` 克隆真门禁预演 BEFORE / AFTER 关键段（exit 1 / exit 0）

---

### 附录 A —— `SYNO_CI=1 bash scripts/pre-commit-check.sh`（staged 口径，本卡自身 diff；exit 0）

```

═══════════════════════════════════════════════════════════
  Loop Engineering V4.5.1 — pre-commit (13 组 + 免疫 + plan-integrity)
═══════════════════════════════════════════════════════════

── 组 1/13: 类型安全 + 硬编码数据 ──
  ✅ as any / as never / as unknown as 零容忍（新增，铁律 38；存量独立清理）
  ✅ from ????: from??????? (D93/D95??)
  ✅ 硬编码业务数据/类型 (禁止硬编码部门名/可扩展实体列表)
  ✅ 旧适配器映射: 全部已标注 @deprecated

── 组 2/13: 测试质量 ──
  ✅ empty catch 无 log (铁律 24+31)
  ✅ 静默吞错扫描 (D313 M5b)
  ✅ 新文件配对: impl 须同 commit 有 test
  ✅ 桩测试: 新测试需 ≥3 expect()
  ✅ 跨模块集成: bridge/context 类需 .integration.test.ts
  ✅ 控制塔脚本测试门禁 (U7/CT-40)

── 组 3/13: Secrets ──

═══ Secrets 扫描 ═══

── 全工作区扫描 ──
  ✅ 工作区无真实凭证

── .claude/ 目录扫描 ──
  ✅ .claude/ 目录无凭证

  ✅ .env 未被暂存
  ✅ .gitignore 包含 .env
  ✅ 暂存文件无硬编码凭证
  ✅ 无 .env 文件

  Secrets 扫描: 全部通过 ✅

── 组 4/13: 接线完整性 ──
  ✅ 接线审计: 新 export 必须被引用
  ✅ 接线深度: 新 export 必须被调用(非仅 import)

── 组 5/13: 架构边界 + 桥接文件 ──
  ✅ 架构边界: 禁止跨层引用 (铁律 39)
  ✅ 铁律 46: 桥接文件欺诈 + 包级 engine-core + 壳包检测

── 组 6/13: Task Brief (6 核心字段) ──
  ✅ 主树占用检测 (D537 #2): 主树脏 + 多活跃 session
  ✅ Task Brief: 编码变更须有今日 task brief
  ✅ Task Brief: 6 核心字段必须填写 (Q0/Q1/Q2/Q3/架构层/Done)
  ✅ 骨架 brief 占位符检测（认领 agent 填写后提交，禁提交骨架）
  ✅ 时间戳顺序: brief 必须早于代码写入
  ✅ Notes 迁移门禁: 无 proposed/ 变更（跳过）
  ✅ plan.principles (3 条, Done verify: 6)
  ✅ plan.approach = extend
  ✅ plan.memory_refs (2 文件, 全部存在)
  ✅ brief 模板已清理 (无 <!-- 残留)
  ✅ Q2 排除项均含文件路径
  ✅ Q2 排除项: 声明不改的文件未在本次提交中出现
  ✅ Done 可证伪性 (无 checked 项)
  ✅ Q0c 跟踪
  ⚠️  PRD 对照: Done 标准引用 PRD 章节(可选): 1 处  [可选提示——永不阻断]
     Done 标准未引用 PRD 章节 - 重大 feature 建议标注 secX.Y

── 组 7/13: 架构合规 ──
grep: repetition-operator operand invalid
  ✅ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口
  ✅ 专家配置校验
  ✅ 门禁故障审计
  ✅ 绕过审计
  ✅ 数据流: 路由文件须含 API 调用证据

── 组 8/13: 文件驱动架构完整性 (V3.9) ──
  ✅ 能力验收 CI (       1 测试, 全部通过)
  ✅ manifest.json 必填字段 ($schema/name/version/type/entryPoint)
  ✅ tags 引用完整性 (所有标签值必须在 tags.json 中存在)
  ✅ 硬编码类型回归 (禁止在 src/ 新增本体类型定义)
  ✅ extensions/ 目录结构 (新子目录须有 manifest.json)
  ✅ pizza-chain 验收测试存在
  ✅ Feature Flag 审计 (新增文件驱动路径须有回退 flag)
── 组 9/13: 契约门禁 ──
  ✅ 契约门禁: 声明产出须在暂存区

── 组 10/13: V3 流水线健康度 ──
  ✅ G10: 无 task brief 变更(跳过)
  ✅ G11: 无 task brief 变更(跳过)

── 组 12/13: Task Scope 一致性 ──
  ✅ G12: 所有文件均在 Q2 范围内
  ✅ G12d: 无 session 提交生成物 (CI 单点)
  ✅ G12b: brief 可解析 (D313 M3)

── 组 13/13: 技能同步一致性 ──
  ✅ G13: 无技能文件变更(跳过)

── D782: 文档真相防线（D1 真相验证 + D2 登记门禁）──
  ✅ D1 文档真相: 全部硬检查通过 (15 ✅)
  ✅ D2 登记门禁: ── 汇总: 检查 0 个文档，0 个未登记 ──

── PR 预算门禁 (D734) ──
  ✅ D734 PR 预算: 文件数 / 单域 / 落后基线 均在预算内
  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)

═══════════════════════════════════════════════════════════
  ✅ 全部 13 组通过
  ⚠️  1 项警告 (不阻断)
═══════════════════════════════════════════════════════════

```

### 附录 B —— `bash tests/control-tower/check-ownership.test.sh`（exit 0，58 项全过）

```
═══════════════════════════════════════════════════════════
  D733 ownership 机器化测试
═══════════════════════════════════════════════════════════

── 1. 正常路径: 各域正例归属一致 → exit 0 ──
  ✅ src/sentinel/ Mac 正例 (exit=0)
  ✅ src/cron/ Mac 正例 (exit=0)
  ✅ src/mcp/ Mac 正例 (exit=0)
  ✅ scripts/control-tower/ Mac (exit=0)
  ✅ tests/control-tower/ Mac (exit=0)
  ✅ coordination 文档 Mac (exit=0)
  ✅ src/（非例外）= Win (exit=0)
  ✅ src/server.ts = Win 专属 (exit=0)
  ✅ scripts/audit/ = K3 (exit=0)

── 2. 越域: 派单 §一 验收两条（必须非零）──
  ✅ 验收① src/server.ts --owner mac (exit=1)
  ✅ 验收② src/evidence/x.ts --owner mac (exit=1)
  ✅ Mac 文件派给 win 也越域（对称） (exit=1)
  ✅ K3 红线派给 mac 越域 (exit=1)

── 3. 真实回归: CTO 2026-09-13 两次派错线的实写集 ──
  ✅ D728 回归: 整写集派给 mac 必红 (exit=1)
  ✅ D729 回归: Win 域两文件派给 mac 必红 (exit=1)

── 4. 单域模式（无 --owner）──
  ✅ 单域模式: 全 Mac → exit 0
  ✅ 单域模式: Mac+Win 混合 → exit 1（跨域）
  ✅ 跨域输出点名「跨域」

── 4b. 域判定豁免 domain_neutral（D734 前置：各线都写的簿记不构成域信号）──
  ✅ bypass.log 豁免: 只剩 mac → exit 0
  ✅ 豁免路径明示 domain-neutral（不静默）
  ✅ 豁免不掩盖真跨域（Mac+Win 仍 exit 1）
  ✅ 豁免路径不参与 --owner 断言 (exit=0)
  ✅ 非豁免路径仍受 --owner 断言（回归） (exit=1)
  ✅ D758 证据目录豁免: Win 代码 + 自己的验收证据 → exit 0
  ✅ D758 证据路径明示 domain-neutral（不静默）
  ✅ D758 Win 证据 + Mac 控制塔脚本 → 仍单域（证据不掺域）
  ✅ D758 豁免不掩盖真跨域（Win 代码 + Mac 脚本仍 exit 1）
  ✅ D758 豁免路径不参与 --owner 断言 (exit=0)

── 5. 反向验证: 删掉兜底规则 → 验收两条必须变绿（证明真在读 yaml）──
  ✅ 反向验证前置: 兜底规则已移除
  ✅ 删兜底 → src/server.ts 变绿 (exit=0)
  ✅ 删兜底 → src/evidence/x.ts 变绿 (exit=0)
  ✅ 原 yaml 复测仍红（未污染真实文件） (exit=1)
  ✅ 复测输出点名「越域」
  ✅ 无归属时明示 ⚠️（不静默）

── 5b. D935 判别性夹具: presets→mac（删该规则即红 = 判据真读数据，非 grep 型静态判据）──
  ✅ D935 presets 根文件 = Mac (exit=0)
  ✅ D935 presets 子目录文件 = Mac (exit=0)
  ✅ D935 presets 派给 win 越域（对称） (exit=1)
  ✅ D935 改坏前置: 沙箱副本已删 presets 规则
  ✅ D935 删 presets 规则 → presets 路径派 mac 必红 (exit=1)
  ✅ D935 删 presets 规则 → 子目录文件同样必红 (exit=1)
  ✅ D935 原 yaml 复测仍绿（未污染真实文件） (exit=0)

── 6. 降级与边界（fail-closed → exit 2）──
  ✅ yaml 不存在 → exit 2 (exit=2)
  ✅ yaml 语法非法 → exit 2 (exit=2)
  ✅ rules 为空 → exit 2 (exit=2)
  ✅ yaml 非映射 → exit 2 (exit=2)
  ✅ 无文件参数 → exit 2
  ✅ 未知 owner → exit 2（argparse 拒绝）
  ✅ 尚未创建的文件路径也可判域 (exit=0)

── 7. 产物契约: CODEOWNERS == --emit-codeowners（drift 门禁）──
  ✅ drift: .github/CODEOWNERS 与生成结果逐字节一致
  ✅ --emit-codeowners exit 0 (exit=0)
  ✅ CODEOWNERS 顺序: 兜底(12) 在 Mac 例外(17) 之前

── 8. 结构契约: ownership.yaml 恰有一条 default 兜底规则 ──
  ✅ default 规则恰 1 条
  ✅ 显式规则存在: src/sentinel/**
  ✅ 显式规则存在: src/cron/**
  ✅ 显式规则存在: src/mcp/**
  ✅ 显式规则存在: scripts/audit/**
  ✅ 显式规则存在: scripts/control-tower/**

── 9. 生产接线（铁律 0-2 WIRE CHECK）──
  ✅ 接线: CODEOWNERS 头声明由 check-ownership.py 生成（产物消费成立）

═══════════════════════════════════════════════════════════
  ✅ 全部通过: 58 项
═══════════════════════════════════════════════════════════
```

### 附录 C —— `bash tests/control-tower/check-pr-budget.test.sh`（exit 0，32 项全过）

```
═══════════════════════════════════════════════════════════
  D734 PR 预算门禁测试
═══════════════════════════════════════════════════════════

── 1. 正常路径: 小写集单域 → exit 0 ──
  ✅ 2 个 Mac 文件 (exit=0)
  ✅ 单域判定输出点名

── 2. 超预算: 文件数 > 上限 → exit 1 ──
  ✅ 13 文件 > 默认 12 (exit=1)
  ✅ 超限输出点名「拆 PR」
  ✅ 输出禁调高上限
  ✅ --max-files 20 时同写集放行 (exit=0)

── 3. 跨域: 变更落两个域 → exit 1 ──
  ✅ Mac 脚本 + Win src 混合 (exit=1)
  ✅ 跨域输出点名
  ✅ bypass.log 豁免后仍单域 (exit=0)
  ✅ D758 证据目录豁免: Win 代码 + 自己的验收证据 → 单域 (exit=0)
  ✅ D758 豁免不掩盖真跨域（证据 + Win 代码 + Mac 脚本） (exit=1)

── 4. 边界 ──
  ✅ 0 文件（空写集） (exit=0)
  ✅ 恰好等于上限 (exit=0)
  ✅ 上限 1、写集 2 (exit=1)

── 5. 降级: 基线全链不可解析 → 显式留痕 + exit 0（不误红）──
  ✅ 无任何基线的仓库 → exit 0
  ✅ 降级明示「基线不可解析」（不静默）
  ✅ 降级说明不静默放过

── 6. 检查失败: 域校验器缺失 → exit 2（fail-closed）──
  ✅ 缺 check-ownership.py → exit 2
  ✅ 缺口点名「域校验器缺失」

── 7. 落后基线: 沙箱仓库真落后 → ⚠️ 告警但 exit 0 ──
  ✅ 落后但未超文件/域预算 → exit 0（落后不阻断）
  ✅ 落后告警输出点名

── 9. D860 治理产物豁免: 不计入 ≤12 预算 ──
  ✅ 12 交付文件 + brief/卡/Note/规格 各 1 → 豁免 4 件后 12 计数放行 (exit=0)
  ✅ 豁免件数点名（可见，不静默）
  ✅ memory/notes yaml 也豁免 (exit=0)
  ✅ 自验证据目录豁免（docs/synova/product-lines/evidence/） (exit=0)

── 10. D860 反例: 伪装成治理产物的代码必须仍被计数 ──
  ✅ 13 件纯代码仍被拦（豁免不放宽真代码） (exit=1)
  ✅ 反例: task-state/evil.ts（代码伪装进治理前缀）→ 仍计数 13 > 12 (exit=1)
  ✅ 反例计数点名 13
  ✅ 反例: .claude/task-briefs/evil.sh 仍计数 (exit=1)

── 8. 接线（铁律 0-2 WIRE CHECK）──
  ✅ 接线: pre-commit-check.sh 真调用本脚本
  ✅ 组数横幅未改（快速通道仍为「跳过 12 组」）
  ✅ 总结横幅仍为 13 组（未并组）

═══════════════════════════════════════════════════════════
  ✅ 全部通过: 32 项
═══════════════════════════════════════════════════════════
```

### 附录 D —— /tmp 克隆真门禁预演（CI 注入缝；源仓库零写入，克隆已 rm）

**D-1 BEFORE：D931 tip `fb7ce0d5` + 未修复 ownership.yaml → exit 1**

关键段（第 99-105 行）：

```
── PR 预算门禁 (D734) ──
  ❌ D734 PR 预算超限 (拆 PR，禁调高上限——见 scripts/control-tower/check-pr-budget.sh): 11 处  [CI strict——软提示在 CI 上为硬阻断]
     ── PR 预算门禁（D734）: 基线=origin/main 上限=12 文件 / 落后阈值=20 ──
     ℹ️  D860 治理产物豁免: 2 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计数）
     ✅ ① 变更文件数 6 ≤ 上限 12
     ❌ ② 变更跨域 —— 一个 PR 只许一个域（D733 ownership.yaml）
     mac  .synova/skills/squad-discipline/SKILL.md
     mac  .dsh/skills/squad-discipline/SKILL.md
     mac  docs/synova/coordination/派单模板.md
     win  docs/synova/presets/install-squad-lead.sh
  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)

═══════════════════════════════════════════════════════════
  ❌ 1 组未通过 — 提交已拒绝
::error title=IronLaws:提交已拒绝::1 组未通过（详见上方 ❌ 行）
```

全文结论行：

```
100:  ❌ D734 PR 预算超限 (拆 PR，禁调高上限——见 scripts/control-tower/check-pr-budget.sh): 11 处  [CI strict——软提示在 CI 上为硬阻断]
104:     ❌ ② 变更跨域 —— 一个 PR 只许一个域（D733 ownership.yaml）
112:  ❌ 1 组未通过 — 提交已拒绝
113:::error title=IronLaws:提交已拒绝::1 组未通过（详见上方 ❌ 行）
```

**D-2 AFTER：同一 D931 tip + 注入本卡修复（ownership.yaml/CODEOWNERS 与 D935 工作树 diff 逐字节一致）→ exit 0**

```
── D782: 文档真相防线（D1 真相验证 + D2 登记门禁）──
  ✅ D1 文档真相: 全部硬检查通过 (15 ✅)
  ✅ D2 登记门禁: ── 汇总: 检查 0 个文档，0 个未登记 ──

── PR 预算门禁 (D734) ──
  ✅ D734 PR 预算: 文件数 / 单域 / 落后基线 均在预算内
  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)

═══════════════════════════════════════════════════════════
  ✅ 全部 13 组通过
  ⚠️  1 项警告 (不阻断)
═══════════════════════════════════════════════════════════
```

附录 D 原始日志（含 ANSI 版本）在 /tmp/d935-rehearsal-BEFORE.log、/tmp/d935-rehearsal-AFTER.log（未入库）。
