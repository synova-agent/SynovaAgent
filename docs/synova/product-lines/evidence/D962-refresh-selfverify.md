# D962 刷新后树等价最终复核（task-22 / d962-verifier，落盘前把关）

> 对象：`feat/d962-2a-merge` @ cdee3d32（前已验 a20911e7），工作树 `.synova-wt-d962m` 只读。仅"自验结论"。

## ① 树等价核（核心）

`git diff a20911e7..cdee3d32 --name-only` 共 **289 文件**，逐类判定：
- 274 × R100 `.claude/task-briefs/*.md → archive/`（#767 D964-P4 归档，main 侧）；
- 3 × A `docs/synova/audit-reports/`（2026-09-24-K3-批次2/批次3/INDEX，#751/#773，main 侧）；
- 11 × task-state M/A（D918–D935 十件 M + D964.json A，main 侧合并产物）+ 1 × `.claude/task-briefs/2026-09-25-D964-phase4-archive-batch1.md` A + 1 × `.claude/bypass.log` M；
- **D962 自身内容文件命中数 = 0**（pre-commit-check.sh / 声明件 / D962 测试 / 合并卡 / phase2-plan / loop-score / ct-health 等全不在 diff 中；grep -iE 'pre-commit|d962|grep-oP|…' 仅误中 3 个归档 brief 文件名中的 "Phase2" 字样，非 D962 文件）。
⇒ **刷新仅引入 main 侧文件，D962 内容零语义变化。** ✔

## ② gate 复跑

merge-base 实测重算为 **b7dfac2d** ✔；`merge_writeset_gate.py --branch feat/d962-2a-merge` → `✅ pass — 提交文件集 ⊆ 声明写集（无夹带）`。✔

## ③ 完整性

399 行 ✔｜断面 `check-dsh-anchor`=3 ✔｜密封网 `grep-oP-regression` **24 通过 / 0 失败 ✅**。✔

## ④ 声明双向差

`task-state/D962.json` 声明 75 vs `git diff b7dfac2d..HEAD` 实际 75：**声明\实际 = 0，实际\声明 = 0**。✔

## ⑤ 电池抽 3

g10-cp3 PASS=14/0 ✔｜ct-health PASS=7/0 ✔｜ci-strict-mode pass=5/0 ✔。✔

## 结论

**通过——刷新未触碰任何 D962 自身内容（289 文件全为 main 侧 #767/#751/#773 及其合并产物），前七轮自验结论对新树全部延续成立。可提请独立审计 / 落盘。**

— d962-verifier，2026-09-25，零仓库源文件改动
