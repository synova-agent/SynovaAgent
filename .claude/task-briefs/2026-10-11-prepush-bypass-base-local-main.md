# Task Brief: 推送通道解除阻塞 — pre-push bypass 对账基改真源 trunk（`origin/local-main`）

> 触发：K12 第 5 批执行中**实测阻塞**（非本批任一件的问题）
> 授权：**创始人 2026-10-11 授权改这一行基**（本会话第 1 次请示即获批）
> 批次：第 5 批（阻塞解除件）｜坐标系：总闸 不适用｜承重件 不适用｜命名空间 不适用

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把 pre-push 门禁的对账基线从**已废弃的 GitHub 旧 main** 改回**真源 trunk `local-main`**，
让推送通道恢复可用。

**② 解决什么问题（实测，非推断）**：
```
· 现象：本仓**任何**分支推送都被拒 —— 不只有本批的改动（实测 main 分支跑同一门禁同样 rc=1）
· 根因：pre-push-check.sh 对账基取 `origin/main`，而 `origin/main`
        = GitHub 旧 main，**停在 5a6591c4a**（账号已封，永不再前进）
        本仓真源 trunk = `local-main`（实测 gitea `refs/heads/local-main` = e52499ddd）
· 后果：`origin/main..HEAD` 范围被扩到**他人早已合入 trunk** 的提交
        实测 4 条：fd63e17c / f4e32728 / c0a7b736 / ab13a96c
        —— 4 条**全部已是 `gitea/local-main` 的祖先**（命令：`git merge-base --is-ancestor`）
        ⇒ 门禁向本机索要它们的「synova-commit 执行记录」
· 为什么本机没有它们的记录：D1145 起记录写 **per-session 权威账本**（`.sessions/<sid>/bypass.log`）
        上述提交的记录在**各自会话/机器**的账本里；本工位 union 读取（实测 4 个来源）读不到
· ⇒ 这不是"我的提交没过门禁"，而是**门禁的基指向了一个死 ref**。
```

**③ 判据（改前/改后，同一命令）**：
```
改前：bash scripts/control-tower/check-bypass-log.sh            ⇒ rc 1（列 4 条他人提交索记录）
改后：bash scripts/control-tower/check-bypass-log.sh            ⇒ rc 0（本机待推 1 条，全部有记录）
```

**④ 🔴 不做行不行**：**不行**——推送通道整体坏 ⇒ 本批**所有**交付件都推不上去、开不了 PR。

**⑤ 与既有决议的关系（**先核既有决议**，纪律 G）**：`.gitea/workflows/local-gates.yml` 第 ③ 步
**早已**改用 `CHANGED_BASE=origin/local-main`（同一条理由，注释写明"origin/main = GitHub 旧 main
（停 5a6591c4），拿它当基线会把 local-main 全部 diverge 提交的存量红算进本 PR"）⇒
**本次只是把同一口径补到 pre-push**（此前只改了 CI 侧）。

**⑥ 明确不做（避免"顺手改门禁语义"）**：不改 `check-bypass-log.sh` 的任何判据（D1157 的
COMMITTED/HASH= 锚定、D1243 孤儿豁免、D1152 收窄范围等**一字不动**）；不改阈值；不引入新机制。

**⑦ 涉及代码文件**：`scripts/pre-push-check.sh`（单文件，一处 base 选择 + 注释留痕）

## Q0: 定位 — 项目拼图 + 文件审计

属**门禁/控制塔面**（`scripts/`），不属产品代码分层 L1–L5 —— 它是**推送通道**的可用性修复。

文件审计（**逐条实测**）：
### 已存在
- scripts/pre-push-check.sh（门禁 7: bypass 对账，行 415-432）
- scripts/control-tower/check-bypass-log.sh（判据本体，**本次不动**）
### 结论
**本 brief 不下"完成"结论** —— 见文末「状态」。

## Q1: 调研
a) 业界：门禁的**基线**必须指向"当前真相"，指向废弃 ref 会以**误拦**形式让整条通道失效。
b) 顶级团队：改基前先核**既有决议**（本仓第 ③ 步已裁过同一问题），同口径复用到别处，不另立口径。
c) memory 教训：**纪律 G**「判据/口径由 CTO 给，写判据前先核既有决议」；**型 A**「真值用 ref 量」；
   本仓历史病根「被绕过的门禁 = 没有门禁」——但**误拦到"人人推不动"同属门禁失效**。

## Q2: 范围
做什么：
- scripts/pre-push-check.sh
- memory/notes/implemented/2026-10-11-prepush-bypass-base-local-main.md
- .claude/task-briefs/2026-10-11-prepush-bypass-base-local-main.md

不做什么：
- 不改 scripts/control-tower/check-bypass-log.sh
- 不改 scripts/control-tower/bypass-ledger.sh
- 不改 .gitea/workflows/local-gates.yml
- 不改 scripts/control-tower/check-pr-budget.sh
- 不改 scripts/pre-commit-check.sh
- 不改 .claude/bypass.log

## Q3: 验收 — 入口 → 交互 → 结果
入口：`git push`（pre-push hook）或直接跑 `bash scripts/control-tower/check-bypass-log.sh`
处理：取 `origin/local-main` 作对账基 → 只覆盖本机新推提交 → 比对账本 COMMITTED 记录
结果：本机新推提交全部有记录 ⇒ rc 0 放行；缺记录仍 rc 1 拒（**原有判据不变**）

## 架构层: ⓪ 连接器（人侧 ⓪-b：谁/能看什么）
#CRITERIA: C

## 写集
- scripts/pre-push-check.sh
- memory/notes/implemented/2026-10-11-prepush-bypass-base-local-main.md
- .claude/task-briefs/2026-10-11-prepush-bypass-base-local-main.md

## Done 标准
- [ ] verify: `bash scripts/control-tower/check-bypass-log.sh`（expectExit 0）
- [ ] verify: `git rev-parse --verify origin/local-main >/dev/null && echo ok`（expectExit 0）
### 附加模板项（**非卡面原文** · 通用要求）
- [ ] 反证（改坏即红）：把基临时改回 `origin/main` ⇒ 同一命令 rc 1（列他人提交）⇒ 改回 rc 0
- [ ] 判据未动：`git diff` 不含 `scripts/control-tower/check-bypass-log.sh`
---
## 状态（**事实台账** · 2026-10-11）

| # | 判据命令 | expect | 实跑 exit | 判定 |
|---|---|---|---|---|
| 1 | `bash scripts/control-tower/check-bypass-log.sh` | 0 | 0（本机待推 1 条全部有记录） | PASS |
| 2 | 改坏即红：基改回 `origin/main` | 1 | 1（列 4 条他人已合入 trunk 的提交） | PASS |
| 3 | 钩子级实跑：`bash <git-common-dir>/hooks/pre-push origin <url> <<< "<refspec>"` | 通过 | ✅「2 条本机待推提交全部有记录」 | PASS |
| 4 | 第二层坑（实测）：第一版取 `origin/local-main`（陈旧 68bf57598）⇒ 列 **44** 条 ⇒ 仍拒 | — | 44 条 | 已修（改定序） |

### 第二层坑（第一版改完仍被拒 —— 如实记录）
```
· `origin/local-main` 是 remote-tracking ref，本工位实测**陈旧**（68bf57598 vs 真值 e52499ddd）
  ⇒ 直接当基会比改前**更旧**、范围更大。
· "先 fetch 刷新"**会假成功**：本机 origin = GitHub（账号已封），fetch 返回 0 却什么都不推进
  ⇒ 不能以 rc 判"刷新成功"，必须**比对 ref 前后值**。
· 定序改为：① 本地 `local-main`（本机 trunk 真值）→ ② origin/local-main（**仅当刷新真推进**）
  → ③ origin/main → ④ $PUSH_REMOTE/$PUSH_BRANCH。
```

### 待 CTO 裁定的项
- 本件属**控制塔域**（`scripts/pre-push-check.sh`），创始人已授权改这一行基；
  是否需并入治理线台账留痕，请 CTO 裁。
