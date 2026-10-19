---
状态: proposed
日期: 2026-10-19
决策: ①d「门禁本体自检」在 CI 下改为**每次运行都刷新 canonical base**（单远端 ∧ SYNO_CI=1/GITHUB_ACTIONS=true ⇒ fetch）＋**新鲜度断言**（canonical 不可解析 ⇒ 2；与唯一远端的 local-main 跟踪引用不等 ⇒ 2），检查器**退役 bootstrap**（base 无清单 ⇒ 沿用 E_BAD_BASE / exit 2），T10/自证 ⑧ 预期同批由「0＋BOOTSTRAP」改「2＋无 BOOTSTRAP」。
理由: CI 工作区建一次后 canonical ref 永不刷新（实测停在 5833c0d1b，早于 S1 23a4f5a38）⇒ ①d 永远拿陈旧 base 算 diff；而检查器「base 无清单 ⇒ bootstrap 返回 0」是一次性开孔，在陈旧 base 下恒真 ⇒ run 1019（#606）仍判 success（假绿）。只收紧 bootstrap 不够（陈旧 base 的 diff 仍可能把 S1 的清单新增算进来），必须同时让 CI 用当前 base 并让「无清单 base」fail-closed。
---

# 决策 Note — P4 · #610 ①d 在 CI 被陈旧 base 跳过（bootstrap 恒真）

> 过程件：记「做了什么、为什么、怎么判」，不写操作手册（手册归 `docs/` C 层）。
> 规格（唯一）：`.handbook/派单件/2026-10-19-规格-610-gate-protection-ci-base.md`（307 行；sha256/16 = 589c41f7c19b3e2e；status: proposed）。
> 数值口径：标「**实测**」＝本轮亲自跑的原始输出（留存 `/tmp/synova-610-evidence/`）；其余标「判据」（引规格/库内既有输出，**未宣称本轮已复跑**）。禁把文档自述当证据。

## 现状（2026-10-19 实测）

- **CI 假绿（实测）**：Gitea API `GET /api/v1/repos/synova-agent/SynovaAgent/actions/jobs/1034` ⇒ `run_id=1019`、`head_sha=a1378e757…`、`status=completed`、`conclusion=success`；①d 步（job 1034 第 4 步）日志原文（`.../actions/jobs/1034/logs`，全文 272 行已落档）：

  ```
  ①d base = gitea/local-main
  ✅ base 无清单（.gitea/protected-files.txt@5833c0d1 不存在）⇒ 一次性 bootstrap 开孔（唯一开孔，DS-6 反例把守）
  BOOTSTRAP: 清单在 base 不存在，diff 模式跳过（首次落盘）
  结果: 5 通过, 0 失败
  ```

  该 PR（#606 头 a1378e757）**判据（规格 §3 F4：本地 fresh base 跑同一检查器 ⇒ 返回 1）**实际触碰 15 条受保护路径；①d 仍在 0.16s 内「通过」（**实测**：日志时间戳 00:13:54.460→.621）⇒ diff 判定从未执行。
- **工作区 base 陈旧（实测）**：`git -C /Users/wane/.ci-work/SynovaAgent log -1 refs/remotes/gitea/local-main` ⇒ `5833c0d1b … Merge pull request … (#588)`；S1 `23a4f5a38` **不是**其后代（`git merge-base --is-ancestor 23a4f5a38 refs/remotes/gitea/local-main` ⇒ rc=1）；该 ref 的 reflog 仅一条：`fetch -q origin +refs/heads/local-main:refs/remotes/gitea/local-main: storing head`（建工作区时一次，此后未再刷新）。
- **根因（判据，规格 §3 F3）**：①d 的物化条件是 `if ! git rev-parse --verify -q gitea/local-main` ⇒ ref 一旦可解析就永不 fetch；而工作区步骤的 `git fetch -q origin` 只更新 `origin/*`，不更新 `gitea/*`。
- **假绿机制（判据，规格 §3 F5-F6）**：检查器 base 无清单 ⇒ `report["bootstrap"]=True; return finish()`（返回 0，输出 `BOOTSTRAP:` 行）；配对 T10 与自证 ⑧ 当时把「0＋BOOTSTRAP」写成断言 ⇒ 假绿被测试锁定。
- **影响面（判据＋实测校正）**：#606 的 ①d 在旧 ①d 下拿不到真实 diff 判定；本批 PR 提交后 ①d 将跑 PR head 的新 workflow（run 991 实证 Gitea 取 PR head）⇒ 本 PR 不假绿（见 Known Limitations 2）。S1 的 bootstrap 原本是为「清单首次落盘」留的一次性开孔，S1 已于 `23a4f5a38` 落 main ⇒ 该开孔此后只产生假绿。

## 决定

1. **CI 每次刷新 canonical ref**（`.gitea/workflows/local-gates.yml` ①d 步 run 块）：`CI_FLAG=1`（`SYNO_CI=1` 或 `GITHUB_ACTIONS=true`）∧ 单远端 ⇒ **每次** `git fetch -q "<唯一远端>" '+refs/heads/local-main:refs/remotes/gitea/local-main'`；多远端 ⇒ `::warning` 不 fetch（不猜）；**非 CI 保持旧行为**（仅 canonical 不可解析且单远端才 fetch）。
2. **新鲜度断言（仅 CI）**：① canonical 不可解析 ⇒ `::error` ＋ `exit 2`；② 唯一远端的 local-main 跟踪引用若可解析 ⇒ 其 SHA 必须与 canonical 相等，不等 ⇒ `::error` ＋ `exit 2`（陈旧 base fail-closed）；相等则打印实测短 SHA。
3. **检查器退役 bootstrap**（`scripts/control-tower/check-gate-protection.sh`）：base 无清单 ⇒ `raise GateError("E_BAD_BASE", …)` / `exit 2`（沿用既有 code，**禁新造**）；删 `BOOTSTRAP` 输出与 `--json` 的 bootstrap 键；头部「已知限制 4」改写并补「陈旧但含清单的 base」一条。
4. **测试预期同批改**：配对 T10 与自证 ⑧ 由「0＋BOOTSTRAP」改为「2＋E_BAD_BASE、`BOOTSTRAP` 行=0」；新增「base 无清单」同族反例；T12/DS-6 与其余项**不动**；`|| exit $?` 三态不折叠。
5. **不改**：豁免解析／作者校验／glob／pin／APPROVERS／其余三态分支；12 组编号与内容；`.gitea/protected-files.txt` 内容；`.github/**`；`scripts/audit/**`。
6. **实现口径（重要，防后人改回）**：规格 W1 的字面「与 `origin/local-main` 相等」与自证 ⑪ 的硬判据「①d 步块内 `origin/local-main`／`origin/main` 命中必须 = 0」**互斥**（前者是描述、后者是禁语扫描）。本批解法 = **动态拼** `TRACK_REF="refs/remotes/${ONLY_REMOTE}/local-main"` 再比 SHA —— 语义等价、字面不撞；🔴 **禁**把该镜像分支名写回块内（连注释也不行），否则 ⑪ 立刻红。

## 依据

- CTO 2026-10-19 批（同意修 #610，派 L2 实施）｜Issue #610｜规格 `SYNOVA-IMPL-610`（撰写者独立于实现者）。
- 复用既有约定（不新建机制族）：三态退出码 ／ `@降级`＋`SYNO_GATE_DEGRADED_LOG` ／ D732 UTF-8 强制 ／ 判别力自检（`scripts/control-tower/AGENTS.md`、`.gitea/AGENTS.md`：信号量==0 ⇒ exit 2）。
- S1 前例：`memory/notes/proposed/2026-10-18-gate-protection.md`（bootstrap 是一次性开孔，Known Limitations 4；push 腿 diff 空，Known Limitations 5）——本卡正是它的到期退场。
- 顺序钉死：**本卡先于 #606**；#606 rebase 后 ①d 才真红 → 创始人豁免 → 绿（DS-7，由 L1 执行，不在本批）。

## 生效时点

- 合入 `local-main` 后，**下一次 PR** 起 ①d 用本次运行的 base（`local-gates / gates (pull_request)` 是 required status check）。
- 检查器退役 bootstrap 与两测试预期**同批生效**（同一 PR）；旧 PR（base 早于 S1 `23a4f5a38`）在修后 ①d 返回 2 **直到 rebase**（有意 fail-closed，非缺陷）。
- **本 PR 自身未被 ①d 判绿**：提交后 ①d 将以新 checker 真红（本 PR 触 4 条受保护路径、diff 内无创始人作者豁免件，见 Known Limitations 2）；合入前需创始人把 `gate-exemptions/2026-10-19-gate-protection-ci-base-610.md`（作者 huangxuesongvip@163.com）提交到本分支后再评。

## Known Limitations（做不到什么 —— 每条都是「做不到」，不得改写成「已核过」）

1. **旧 PR 影响**：修后，任何 base 早于 S1 的 PR，①d 将返回 2 直到 rebase（P5 窗口处理）；这是有意的 fail-closed，不是缺陷。
2. 🔴 **本 PR 不代表已被 ①d 核过**（派单原写「旧 ①d 下最后一件、会 bootstrap 假绿」——**本批实测校正**：Gitea Actions 取 **PR head** 的 workflow（实证 run **991**／#591：base `5833c0d1b` 无 ①d，job 1006 日志却执行 ①d）＋ 工作区 checkout `github.sha` = PR head（实证 run **1019**：`HEAD=a1378e757` = 该 run 的 head_sha）⇒ 本 PR 的 ①d 会跑**新** checker：新 workflow 每次刷新 base（新鲜、含 S1 清单）＋ 本 PR 触 4 条受保护路径而 diff 内无豁免件 ⇒ **真红 exit 1，不是假绿**。①d 对后续 PR 的覆盖在合入后才生效；**禁写成「本 PR 已被 ①d 核过」**。
3. **陈旧但含清单的 base**：diff 会把别人的变更算进来 ⇒ 可能假红；CI 靠每次刷新消除；**检查器无远端知识，不判新鲜度**（本地开发者需自己 `git fetch`）。
4. **push 腿**：base==HEAD ⇒ diff 空 ⇒ 只做清单完整性＋pin（不变；真正拦截在 pull_request 腿）。
5. **新鲜度断言的时序边界（本轮新增，如实记）**：canonical 与「唯一远端跟踪引用」来自**两次 fetch**（工作区步骤一次、①d 一次）；若远端 local-main 恰在两步之间前进，可能被判「陈旧」而 exit 2 —— 取向是 fail-closed（重跑即恢复），本批不消除（规格 §C3：平台原生新鲜保证可用时可简化刷新，但 bootstrap 不得恢复）。
6. **平台侧核不到**：①d 不核 Gitea `protected_file_patterns` 是否生效（平台配置＝S2 创始人执行）。

## 关联

- 上游：CTO 2026-10-19 批 ｜ Issue #610 ｜ 规格 `SYNOVA-IMPL-610`（status: proposed）
- 同族：S1 `memory/notes/proposed/2026-10-18-gate-protection.md` ｜ 三态退出码与判别力自检（`scripts/control-tower/AGENTS.md`）｜ `check-gate-protection.sh` 头部契约
- 后续：#606 rebase（DS-7：①d 真红 → 创始人豁免 → 绿）｜若 #598 抽出 `resolve-ci-base.sh`，本卡 inline 刷新逻辑须**同批删除**（规格 §C3，避免双实现）
