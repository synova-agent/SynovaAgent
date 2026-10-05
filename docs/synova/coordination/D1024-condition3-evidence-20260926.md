# D1024 · 条件③ 取证记录（T3 / #846 合入 main 后的 doc-only 早退真 run 证据）

> 卡：**D1024**｜观测者：squad-ci｜基线口径：**只取 success**（`n=12` 的 timeout 分布表 as_of=2026-09-26T04:47:47+08:00，冻结断面，写入 ci.yml 注释）
> 本文件全部读数为**活数**（每次读数已绑 as_of），与"冻结断面"分列（见 §4）。CI 侧改动归属 T3（#846，merge `30f3bcedddcf`）。

---

## 1. 四个 run（id / 结论 / as_of / URL）

| # | run | 判定 | 结论 | as_of | URL |
|---|---|---|---|---|---|
| ① | **36235263357** | ⒝ doc-only 早退 | **completed / success**，`created=10:15:55Z → updated=10:16:30Z` = **35s** | 2026-09-26T18:16:30+08:00 | https://github.com/tangbaobao520/SynovaAgent/actions/runs/36235263357 |
| ② | **36235295061** | ⒟ 反例（doc+.ts） | **全量照跑**（10 job 跳步=0、重步在跑） | 2026-09-26T18:17:40+08:00 | https://github.com/tangbaobao520/SynovaAgent/actions/runs/36235295061 |
| ③ | **36235084014** | ❌ CJK v1 误判 | doc-only diff 却**全量照跑**（12 job 跳步=0） | 2026-09-26T18:14:00+08:00 | https://github.com/tangbaobao520/SynovaAgent/actions/runs/36235084014 |
| ④ | **36215533855** | ⒞ 保持引用 | 非 doc PR（#846 本分支）：detect success 后重步照跑 | 2026-09-26T12:0x+08:00 | https://github.com/tangbaobao520/SynovaAgent/actions/runs/36215533855 |

---

## 2. ⒜ 12 个必需检查逐条（**路由 = `check-suites → check-runs`**）

**路由说明（⒥）**：直连 `GET /commits/<sha>/check-runs` 在本次 token 下 **total=0**（分支 tip 与 merge ref 两个 sha 都试过）⇒ 改用 **`GET /commits/<sha>/check-suites` → `GET /check-suites/<id>/check-runs`**。
- 分支 tip（**head ref**）= `274e4fa7772645…` @ refs/heads/chore/D1024-docsonly-verify2
- check-suite = `98127235969`（app=`github-actions`，status=completed，conclusion=success，runs=13）
- 读数 as_of = **2026-09-26T18:18:27+08:00** by squad-ci

| # | 必需检查名 | conclusion |
|---|---|---|
| 1 | Architecture Check | ✅ success |
| 2 | Checker Review (maker/checker) | ✅ success |
| 3 | Control Tower Gate Tests (ubuntu-latest) | ✅ success |
| 4 | Control Tower Gate Tests (windows-latest) | ✅ success |
| 5 | Golden Case F1 Gate | ✅ success |
| 6 | Integration Contract Check | ✅ success |
| 7 | Test-Kit Architecture Tests (ubuntu-latest) | ✅ success |
| 8 | Test-Kit Architecture Tests (windows-latest) | ✅ success |
| 9 | TypeScript + Lint + Iron Laws | ✅ success |
| 10 | Vitest (1/2) | ✅ success |
| 11 | Vitest (2/2) | ✅ success |
| 12 | npm audit | ✅ success |

**→ 12 / 12 success**（名单口径：`GET /branches/main/protection` → `required_status_checks.contexts`，N=12）

**⒝ 早退确已触发的旁证**（同一 run，job 级）：跳步数 = 7/3/1/4/1/1/3/4/4/3/3/3/4；逐 job 时长 7–17s（13 job，最长 17s）。

---

## 3. ⒟ 反例证据（run 36235295061）

分支 `chore/D1024-mixed-verify2`（tip `eb2b5e8eeaf3`）diff vs main = **纯 ASCII `.md` + `tests/ci/golden-case-gate.test.ts`（仅注释）**：
```console
10 个 job  detect=success  跳步=0  重步在跑（Control Tower(win) / Vitest(1/2,2/2) / TS+Lint / Architecture … in_progress）
```
⇒ 非 doc 面文件存在 ⇒ `docs_only=false` ⇒ **全量照跑**（与 T3 设计一致）。

---

## 4. 口径与边界（⒜/⒟/⒡/⒤）

| 项 | 说明 |
|---|---|
| **⒜ 基线口径** | timeout 分布表 = **只取 success**，`n=12`，as_of=2026-09-26T04:47:47+08:00（**冻结断面**，已写入 ci.yml 注释） |
| **⒞ 活数 vs 冻结断面** | 冻结断面 = 上述分布表；**活数** = 本文四个 run（读数值见 §1 各行 as_of）。两者不混用 |
| **⒟ 多口径（含 N）** | `id: docsonly` 计数 = **10**（detect 步数，N=10）；`grep -c docsonly` = **44**（含 `if:` 引用行，N=44 行）；`timeout-minutes` 行 = **21**（N=21）。三者口径不同，勿互换 |
| **⒡ 分支 tip vs merge ref** | 分支 tip = `274e4fa7772645…`；`GET /pulls/850` 报 `merge_commit_sha = 7687ae092e00…`（PR 合并引用）；check-runs 实际挂在 **tip** 的 suite 上（§2 路由） |
| **⒤ 归因区分** | 35s / 跳步数 = **直测**（run + job API 原始读数）；"早退是 35s 的原因" = **由总量推出**（跳步>0 + 全 12 检查 success 同时成立） |
| 观测者 | 全部读数 by **squad-ci** |

---

## 5. 探针处置留档（chord 先例）

| 项 | 值（as_of = 2026-09-26T18:19+08:00 by squad-ci） |
|---|---|
| PR | #848 / #850 / #849 / #851 → **全部 `state=closed`** |
| 远端分支 | `chore/D1024-docsonly-verify` / `…-docsonly-verify2` / `…-mixed-verify` / `…-mixed-verify2` → **4 个 `- [deleted]`** |
| 本地 | 4 分支已删（`was c0189060 / 274e4fa7 / c9914239 / eb2b5e8e`）；4 个 worktree 已 `remove` |
| **ls-remote 判据** | `git ls-remote --heads … \| grep -c 'D1024'` = **0** ✅ |
| 留档 sha（成对） | 分支 tip：`c01890606941`（v1-doc）/ `274e4fa7772645…`（v2-doc）/ `c99142399bd7`（v1-mix）/ `eb2b5e8eeaf3`（v2-mix） |

---

## 6. 新发现：CJK 文件名导致 `docs_only` 误判（run 36235084014）

**现象**：v1 探针的 diff 只有 `.claude/bypass.log` + `docs/synova/coordination/D1022-T3-ci-止血包-20260926.md`（本地复算**两行都属 doc 面**），但该 run 的 12 个 job **跳步=0、全量照跑**。

**机制**：本仓库 `.git/config` 设了 `core.quotepath=false`，**但那是本地克隆配置、不入库**；CI 的 checkout 用**默认 `core.quotepath=true`** ⇒ CJK 路径输出为 `"docs/…/\346\226\207….md"`（**带引号**）⇒ detect 的 `grep -qvE '\.(md|json)$|task-state/|\.claude/'` 因**行尾是 `"` 而非 `.md`** 判为非 doc ⇒ `docs_only=false`。

**影响**：任何改动**非 ASCII 文件名**的 doc-only PR 会静默走全量（**失败方向安全**——全量跑而非误跳，但属误判且 T3 半数收益失效）。

**修法（已批，卡号 D1025）**：`git -c core.quotepath=false diff --name-only origin/main...HEAD`（或在 checkout 设 `core.quotepath false`）。
