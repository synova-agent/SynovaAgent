# D1039 · A4-b — D708 真 merge-ref 端到端复现（假 D# / 误控夹带）

> 任务号 **D1040**（A4-b；父卡 **D1039**）｜产出人 `coder-b`｜日期 2026-09-28
> 分支 `team/a4b-vitest-log`｜HEAD `63b847c6c63510b942d8bc5699f77bac66871af8`
> **性质**：只读复现。**未改任何实现文件**；临时 worktree 与临时 ref 均已清理（见 §6）。
> **用途**：为「D708 缺陷」提供**端到端**证据 —— 不只证明"推断错了"，而是证明**它把零违纪的交付控成了夹带**。

---

## 1. 三条对照因果链（本节最硬）

```
线性 HEAD（本地，我跑）   → git log -1 = test(D1040): 按裁决 A 回退 ci.yml 登记…
                              ⇒ D# = D1040  ⇒  ✅ pass        EXIT=0
真 merge ref（CI 形态）   → git log -1 = Merge 63b847c6… into ff467712…
                              ⇒ D# = D8     ⇒  ❌ block 4 件  EXIT=1
#872（队长/复核员实测）    → 同一 merge-commit 形态 ⇒ 假号 D63 ⇒ 声明 0 条 ⇒ EXIT=2（降级）
```

**同一份仓库内容、同一条 gate、同一套声明 —— 只因 `git log -1` 的对象从「线性提交」换成「PR merge commit」，
结论就从 `pass` 翻成 `block`。** 而两者的**被检内容完全相同**（变更集都是那 5 个文件）。

---

## 2. 真 merge ref 的取法（命令逐字）

```bash
$ git fetch origin 'refs/pull/873/merge:refs/remotes/pr873/merge'
From github.com:tangbaobao520/SynovaAgent
 * [new ref]           refs/pull/873/merge -> pr873/merge

$ git log -1 --format="%H%n%s%n%P" refs/remotes/pr873/merge
b1dceae954bde9cc03bebb5d7b564e9a16664f96
Merge 63b847c6c63510b942d8bc5699f77bac66871af8 into ff4677129dce2ff068a816eed3db0687b060c64c
ff4677129dce2ff068a816eed3db0687b060c64c 63b847c6c63510b942d8bc5699f77bac66871af8

$ git worktree add --detach /tmp/a4b-pr873 refs/remotes/pr873/merge
$ cd /tmp/a4b-pr873
$ python3 scripts/control-tower/merge_writeset_gate.py --base origin/main --head HEAD --branch team/a4b-vitest-log
```

**关键形态**：merge commit 的 `subject` **内嵌两个 40 字符全长 SHA**（GitHub `refs/pull/N/merge` 的固有形态）。

---

## 3. gate 原始输出（真 merge ref，逐字转存）

```
── merge-writeset-gate (D708) 合并级写集对账 ──
❌ 结论: block — 检测到 4 个写集外文件（夹带）
   任务: D8 | 分支: team/a4b-vitest-log
   D# 推断来源: commit-subject → D8
   变更集: 5 个文件（merge-base ff467712）
   声明写集 17 条（多源并集）:
     · scripts/golden-scenarios/gs-03-capital-cycle/run.sh   ← S2:devdoc.写集表
     · scripts/golden-scenarios/gs-03-capital-cycle/expect.json   ← S2:devdoc.写集表
     · extensions/sentinels/cash-runway/computes/compute-cash-runway-months.ts   ← S2:devdoc.写集表
     · extensions/sentinels/cash-runway/computes/compute-receivable-overdue-rate.ts   ← S2:devdoc.写集表
     · extensions/sentinels/revenue-health/aggregate.ts   ← S2:devdoc.写集表
     · tests/sentinels/cash-runway/compute-cash-runway-months.test.ts   ← S2:devdoc.写集表
     · tests/sentinels/cash-runway/compute-receivable-overdue-rate.test.ts   ← S2:devdoc.写集表
     · tests/sentinels/revenue-health.test.ts   ← S2:devdoc.写集表
     · tests/contract/l4-contract.test.ts   ← S2:devdoc.写集表
     · docs/synova/product-lines/product-lines.yaml   ← S2:devdoc.写集表
     · docs/synova/product-lines/preconditions.yaml   ← S3:brief.Q2-include
     · docs/synova/coordination/D852-live-restart-清单-20260920.md   ← S3:brief.Q2-include
     · docs/synova/coordination/D852-V1-轻量变更单-20260920.md   ← S3:brief.Q2-include
     · docs/synova/coordination/D852-派单回执-20260920.md   ← S3:brief.Q2-include
     · memory/notes/proposed/2026-09-20-D852-product-decisions-6-points.md   ← S3:brief.Q2-include
     · task-state/D852.json   ← S3:brief.Q2-include
     · .claude/task-briefs/D852.md   ← S3:brief.Q2-include
   豁免 1 条（显式，逐条打印理由）:
     · .claude/bypass.log   ← [builtin] post-commit hook 每次提交追加的证据账本（运行期产物，与写集无关）
   夹带文件 4 个（不匹配任何声明项）:
     - .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md
     - docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md
     - tests/win/vitest-log-level.test.sh
     - vitest.config.ts
   修复指引（三选一，禁止静默忽略）:
     ① 把该文件加入声明（S1 task-state write_set / S2 dev doc 写集表 / S3 brief Q2）
     ② 从本 PR 移出该文件（它可能属于另一个任务）
     ③ 显式豁免: 在 PR 正文/声明文件加 `## 写集豁免` 段落，每行 `- <路径> — <理由>`（无理由不生效）
     ⚠ 豁免/声明条目必须逐条**精确路径**（或 `<dir>/**` glob）——
        模糊描述（如「相关脚本」「治理文档若干」）不被匹配，直接判夹带。
     可直接粘贴的精确豁免行（补全理由后放入 PR 正文 `## 写集豁免`）:
       - .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md — <理由：为何此文件属于本任务>
       - docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md — <理由：为何此文件属于本任务>
       - tests/win/vitest-log-level.test.sh — <理由：为何此文件属于本任务>
       - vitest.config.ts — <理由：为何此文件属于本任务>
   ⚠️  PR 正文不可用（--pr-body 未给且无 GITHUB_EVENT_PATH）—— 仅文件声明源生效
EXIT=1
```

**读法（三点，缺一不可）**：
1. `任务: **D8**` / `D# 推断来源: commit-subject → **D8**` —— **推断出的任务号是假的**；
2. `声明写集 17 条` **全部来自 D8 与 D852 的无关交付**（golden-scenarios / cash-runway / revenue-health / `task-state/D852.json` / `.claude/task-briefs/D852.md`）——
   **与本 PR 的实际内容无一相关**；
3. 于是本 PR 的 **4 个真实交付文件**被判成 `夹带文件` ⇒ `❌ 结论: block`。

---

## 4. 对照：线性 HEAD（本地）同一条 gate —— `pass`

```bash
$ cd /Users/wane/SynovaAgent/.synova-wt-a4-b        # HEAD = 63b847c6（线性，非 merge commit）
$ python3 scripts/control-tower/merge_writeset_gate.py --base origin/main --head HEAD --branch team/a4b-vitest-log
── merge-writeset-gate (D708) 合并级写集对账 ──
✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）
   任务: D1040 | 分支: team/a4b-vitest-log
   D# 推断来源: commit-subject → D1040
   变更集: 5 个文件（merge-base ff467712）
   声明写集 4 条（多源并集）:
     · vitest.config.ts   ← S3:brief.Q2-include
     · tests/win/vitest-log-level.test.sh   ← S3:brief.Q2-include
     · docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md   ← S3:brief.Q2-include
     · .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md   ← S3:brief.Q2-include
   豁免 1 条（显式，逐条打印理由）:
     · .claude/bypass.log   ← [builtin] post-commit hook 每次提交追加的证据账本（运行期产物，与写集无关）
   ⚠️  PR 正文不可用（--pr-body 未给且无 GITHUB_EVENT_PATH）—— 仅文件声明源生效
EXIT=0
```
**同一 gate、同一 `--base`、同一分支名、同一变更集（都是 5 个文件）** ——
唯一差别 = `git log -1` 落在**线性提交**（subject 含 `(D1040)`）还是**merge commit**（subject 内嵌全长 SHA）。
⇒ `D# 推断来源: commit-subject → D1040` ✅ vs `→ D8` ❌。

---

## 5. 逐字复算假 D#

```bash
$ python3 -c "
import re
subj = 'Merge 63b847c6c63510b942d8bc5699f77bac66871af8 into ff4677129dce2ff068a816eed3db0687b060c64c'
DID_RE = re.compile(r'[Dd]\d+')
print('DID_RE 命中 =', DID_RE.findall(subj))
print('首个被当任务号 =', DID_RE.findall(subj)[0].upper())
"
DID_RE 命中 = ['d8', 'd3']
首个被当任务号 = D8
```
`scripts/control-tower/merge_writeset_gate.py:122` 的 `DID_RE = re.compile(r"[Dd]\d+")`
**无词边界** ⇒ 吃进 SHA 的十六进制片段（`…b68**d8**…` ⇒ `d8`）。取**首个命中**即 `D8`。

**修法对照（复核员方案，已在 `#872` 的 `5271db08` 上，本卡只验证不实现）**：
```python
FIXED = re.compile(r'(?<![0-9A-Za-z])[Dd]\d+(?![0-9A-Za-z])')
# 同一 merge subject   → []          （去伪）
# 'test(D1040): 按裁决 A 回退…' → ['D1040']   （True-Positive 不伤）
```

---

## 6. 同机制、不同数字 —— **两种后果，后者更坏**

| PR | merge subject 中命中的片段 | 假 D# | 派生到的声明集 | 后果 |
|---|---|---|---|---|
| `#872`（`team/a4-ci-cost`，队长/复核员实测） | `…d63…` | `D63` | **0 条**（无对应声明源） | `EXIT=2` **降级**（判不出） |
| `#873`（本卡，本次实测） | `…d8…` | `D8` | **17 条**（D8 / D852 的无关写集） | `EXIT=1` **block 4 件**（判错并指控） |

⇒ **假号的具体值随 PR 的 SHA 字符而变，这是预期的，不是矛盾**（两次都是同一 `DID_RE` 无词边界所致）。
⇒ 🔴 **`#873` 这一侧对本批更致命**：若无人复核，本卡会以「**你夹带 4 个文件**」结案 ——
**对一个零违纪的交付的误控**。`#872` 只是"判不出"，`#873` 是"判错并指控"。

---

## 7. 清理回执与影响面

```
worktree /tmp/a4b-pr873              : 已移除
ref refs/remotes/pr873/merge         : 已删除
分支 HEAD                            = 63b847c6c63510b942d8bc5699f77bac66871af8（未变）
工作树                               = []（clean）
```

**影响面**：本文件为**只读复现**，未改 `vitest.config.ts` / `tests/win/**` / `.github/workflows/ci.yml` / 其他任何已定稿内容。
`#873` 的其余部分保持**冻结**。

---

## 8. 自验结论

- 证据来源：**本机逐字原始输出**（命令与输出均已就地转存，见 §2–§5），非转述。
- `#872` 那一行数据**来自队长/独立复核员的实测**，**非我本人实测** —— 已在上表逐行标注来源，**不冒充为己测**。
- **自验结论：可提请独立审计。**
