---
状态: proposed
日期: 2026-09-28
决策: B2（D1050）按「**活跃性过滤先行**」出库 `.claude/task-briefs/` 非 archive 存量 brief：以 task-state 实测词表重建映射（fail-closed），在飞卡（claimed/in_progress/spec_done）与近 14 天有 git 活动的 brief **一律保留**；实际出库 **275 / 424**，剩余 149 件留仓。
理由: ① 本批对象是**工作目录**里的 brief，而 G10/G6/G12 的认领机制依赖该目录下存在当前卡的 brief ⇒ 误删在飞卡的 brief = **掐断认领链**，代价远高于少出一批；② 卡面判据的词表（done/merged/superseded）与 main 实测**不匹配**（实测 `audited 124 / impl_done 107 / claimed 103 / spec_done 22 / closed 15 / rejected 2 / in_progress 2 / audit_done 1 / (none) 1`）⇒ 必须用实测词表重建映射而非照抄判据；③ 「无 task-state ⇒ 可出库」需按**注册表结构性下限**细分：实测 task-state D# 区间下界 = **356**，故 D#<356 属结构性无卡（可出库，且 G12 认领窗口是文件名日期 ±1 天，其日期远早于窗口、不参与认领），D#≥356 却无卡属疑似漏登记/在飞（**保留**）；④ 引用复核**不可用「grep 0 命中」单判据**（D1047-R 实证：find 命中的目录级消费者对精确路径 grep 不可见）⇒ 双法并用，实测出库集在 `scripts/`、`tests/`、`.github/`、`.claude/settings.json` 中精确路径命中 **0 行**。
---

# 决策 Note — D1050 B2 `.claude/task-briefs/` 存量 brief 出库

> 任务: D1050 ｜ 小队 B2（队长 `synova-squad-lead`）｜ 分支 `chore/b2-task-briefs-outbound`
> **BASE = `d85900407a46fbeb9bb97271ae8fb1fb4ccc4fc4`（fetch 于 2026-09-28T08:36:36Z；V 复核 08:40:42Z 同 sha ⇒ 未前进）**
> 规格源：`.claude/task-briefs/2026-09-28-D1050-B2-task-briefs-outbound.md`
> 状态：proposed（待 K3 复审 + CTO 收件闸后 `git mv` 到 `implemented/`）

---

## 1. 触发场景

`docs/synova/DOC-CONTRACT.md` §7:256 规定 `.claude/task-briefs/` 停产出、存量分流（含决策⇒抽决策文件；不含⇒出库）；§9 要求「移出必与接手同批」。B1 已完成 archive/ 294 件（PR #874，merged `91f37053`）。B2 = **非 archive 存量**，D1047-R 在 `91f37053` 实测 422 件；本批开工实测 **424 件**（main 已前进，Δ=+2）。

## 2. 实测依据（可核，命令原始输出见 `docs/synova/product-lines/evidence/D1050-B2/`）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 出库基数 **424**（非卡面 422） | `git ls-tree -r --name-only origin/main .claude/task-briefs/ \| grep -c '\.md$'` |
| F2 | **状态词表与卡面判据不匹配** | task-state 全量 status 实测分布（上「理由②」） |
| F3 | task-state 注册表 **D# 区间下界 = 356** | 全量 task-state 文件名 D# 实测 min/max |
| F4 | 实际出库 **N = 275**（424 − 149） | 排除清单 `excluded-briefs.json` 逐条给理由 |
| F5 | 承接 **275/275** 全等 | 档案仓 commit **`0bec81aa`**；三位独立复算（A 自复、队长执行、V 抽样+全量） |
| F6 | 出库集在 `scripts/`、`tests/`、`.github/`、`.claude/settings.json` 精确路径命中 **0 行** | 引用复核法1；法2 目录级消费者扫描另出「活候选仅 5 个文件」 |

## 3. 决策

1. **活跃性过滤先行**：先出排除清单、再承接、最后移出；排除件逐条留理由并**留在主仓**。
2. **fail-closed 映射**：`claimed`/`in_progress`/`spec_done` 一律排除；`audited`/`impl_done`/`closed`/`rejected`/`audit_done` 可出库；`D#≥356 且无 task-state` 保留。
3. **不扩写集**：`memory/notes/**` 归队长；`scripts/**`、`.github/**`、任何门禁脚本零改动。
4. **回退**：`git checkout <BASE> -- .claude/task-briefs/` → 恢复；**再删必须 `git rm -r -f`**（B1 坑：`checkout --` 后 index 已暂存新增，无 `-f` 被拒）。

## 4. 沿用 B1 沉淀的三条机制

① 证据文件用 **`.json`**（`.txt` 不在 `ci.yml:51` docs-only 白名单，触发全量 CI；`.md` 落 evidence 被 doc-registry 判未登记）；
② 回退需 **`git rm -r -f`**；
③ **承接先行** + 逐件 sha256 对账。

## 5. 遗留（交 CTO/K3）

| # | 项 | 依据 |
|---|---|---|
| L1 | `tests/control-tower/brief-parseable.test.sh:97,108` **用真实仓 brief 当夹具**（删掉即红），属脆弱设计 | A 实测；建议改自带临时夹具（**本批不动**） |
| L2 | 卡面 ts 口径歧义：**509 = `src/`+`packages/` .ts**（`daily-cto-board.sh:81`）vs 全仓 .ts = 1453 | 两数皆真，须注明口径 |
| L3 | 证据 `.json` 落 `docs/` ⇒ **本地** pre-commit 走全量 13 组（CI 侧 `ci.yml:51` 含 `\.(md\|json)$` ⇒ 仍 docs-only 早退） | 本地/CI 口径差异 |
| L4 | 本批 brief 骨架由 `alloc-task-id.sh` 生成（占位符）⇒ 组 6 首跑 ❌「Q2 排除项缺少文件路径」硬阻断，须填充后过 | A-03 DEV-3 |
