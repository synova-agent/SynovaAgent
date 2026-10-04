---
状态: proposed
日期: 2026-10-04
决策: bypass 对账范围收窄为「本机要新推的提交」（他机已过闸者跳过，ref 取不到则不过滤=fail-closed），「全部来源皆空 ⇒ exit 1」条件化为「待记录集合为空的 ⇒ exit 0」；夹具侧沙箱只投放被驱动脚本 + 提交动作 fail-fast 报夹具自身失败。
理由: D1145 停跟踪后 COMMITTED 行不再随 git 走，旧判据在新 clone / 他机拉本分支再推时必然假红（永久误拦）；而假红的方向是指控门禁自己（"洗白绕过/证据丢失"），维护者会照错断言去改被测代码。修判据用 git 已有的物理事实（远端祖先），不新增机制；夹具把"夹具自身失败"与"产品缺陷"在退出码上分开，防误修。
---

# D1152 · #1075 阻塞根修：跨机证据链 + 夹具 hermetic 化

## 触发

PR #1075（D1145：`.claude/bypass.log` 停跟踪 + 删影子提交）被独立复核判**阻塞**（本地实测，非推断）：

- fresh clone 里 `bash scripts/control-tower/check-bypass-log.sh origin/main` → **exit 1**（"全部来源均为空"）；
- 「机器 B 拉机器 A 分支再推」⇒ 范围里永远列着 A 的提交（其账本在 A 机本地）⇒ pre-push 被拒 = **永久误拦**；
- 夹具 `post-commit.test.sh` 100 轮 94 绿 / 4 假红 / 2 中止（6% 非零退出），6 轮带 `fatal: … index.lock`。

机因：D1145 之前靠**影子提交把 COMMITTED 行写进被跟踪镜像**实现跨机传播；停跟踪 + 删影子后，
记录天然不再随 git 走 —— **对账范围口径**没有跟着改，于是"本机没记录"与"这提交根本不是本机产生的"
被混为一谈。

## 决策

### ① 对账范围收窄为「本机要新推的提交」（`check-bypass-log.sh`）

- range 内每个 sha：已是 `<远端>/<当前分支>` 祖先 ⇒ **跳过**（= 已推到远端 ⇒ 产生它的机器上已过闸；
  远端由 BASE 的远端前缀推出，缺省 `origin`）。判据用 git 已有物理事实，**不新增账本/协议**。
- **ref 缺失（首次推送 / 无远端 / detached HEAD）⇒ 不过滤**，range 内全部按待记录要求（fail-closed）
  并显式打印说明。**绝不因 ref 取不到把集合算成空集** —— 那等于对首次推送永久免检（新的假绿路径）。
- 祖先判定前 **先 fetch 刷新**（D513 老病：`git push <URL>` 不更新 remote-tracking ref ⇒ 陈旧 ref 误判）。
- 保留 D334 `--no-merges` 与 D451 纯补记豁免不变。

### ② 「全部来源皆空 → exit 1」条件化

判据顺序（不可反）：**先算待记录集合 → 空 ⇒ exit 0**（fresh clone 典型态：镜像/账本天然不存在，
且没有本机新提交）→ **非空 ⇒ 才查来源/可解析性**（来源全空 ⇒ exit 1；base 不可解析 ⇒ 显式 1 /
非显式 2）。三条 fail-closed 全部保留，三态 0/1/2 不变。

### ③ 夹具 hermetic 化（复核席 P1）

- 沙箱**只投放被驱动脚本**（`post-commit.sh` + 它唯一调用的 `bypass-ledger.sh`，运行时拷贝、`cmp` 断言
  与真脚本同内容），**不再 `ln -s $REPO/scripts` + 委托整 hook**。旧写法让真 `external-auditor --dispatch`
  与 `decide-next.sh &`（其 `:57 git status --porcelain` 会刷新并重写 index）在沙箱同仓跑 git
  ⇒ 抢 `$SB/.git/index.lock` ⇒ 6% 假红，且**指控方向是门禁自己**。
- 每个「应当是提交」的动作 fail-fast：断言 rc=0 **且 HEAD 前进**；失败报
  `fixture: commit did not happen (rc=…)` 并 **exit 3**（夹具自身失败 ≠ 产品缺陷）。
  「应当是失败」的动作（identity 清空的提交）反向断言，前提不成立同样报夹具失败。
- hermetic 断言本身改坏即红：沙箱 `scripts/` 为独立投放（非符号链接）、只 2 个文件、
  无 auditor / 无 decide-next、hook 内容与真脚本一致。

## 代价（明列）

- 新增一次 `git fetch <remote> <branch>`（与既有 D513 base fetch 同源同风险；失败只显式告警并用本地 ref）。
- 「他机已过闸」= 信任远端已有提交在其产生机器上过了闸 —— 若那台机器是 `--no-verify` 绕过的，
  本机不再二次索要记录（这是 D1145"证据本地化"的必然代价，不是本卡新增）。
- 方向性：ref 陈旧/缺失 ⇒ 需记录集合变大 ⇒ 可能再误拦（保守方向，且已有 fetch 缓解 + 显式提示）。

## 证据

- `tests/control-tower/check-bypass-log.test.sh`：22/22（含 fresh clone ⇒ 0、他机已过闸 ⇒ 0、
  本机新提交无记录 ⇒ 1、首推不免检 ⇒ 1、D451 豁免面不扩大、缺 base ⇒ 2）。
- `tests/control-tower/post-commit.test.sh`：28/28，**连跑 20 轮 rc 全 0**（flake 率 0）。
- 故障注入（复核席代理 git，`FAKEGIT_N=8/9`）：改前 → `❌ marker 缺失仍登记（洗白绕过）` exit 1（指控型假红）；
  改后 → `❌ fixture: commit did not happen (rc=128) … [stage=commit|add]` **exit 3**。
- 相邻夹具零回归：bypass-ledger / bypass-union-merge / tag-bypass-wiring / clone-shadow-commit /
  pre-audit-summary / post-commit-marker / synova-commit 全 rc=0；`check-gate-integrity.sh` = OK。

## 相关

- 前序: `memory/notes/proposed/2026-10-04-d1145-bypass-untrack.md`（停跟踪 + 删影子提交 + 按 HASH 幂等）
- 语义来源: D331（对账器）/ D334（--no-merges）/ D414·U1c（git log fail-closed）/ D451（纯补记豁免）/
  D508（merge-base 收窄）/ D513（防御性 fetch）/ D735 Stage 1-2（per-session 账本）
