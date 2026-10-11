---
状态: implemented
日期: 2026-10-11
决策: pre-push 的 D331 bypass 对账基由 `origin/main`（GitHub 旧 main，已废）改为真源 trunk `origin/local-main`（回退 origin/main）—— 与 CI 第③步既有口径一致
理由: 基指向死 ref 使对账范围扩到**他人早已合入 trunk** 的提交，向本机索要它们在**各自会话账本**里的执行记录（D1145 per-session 账本不可跨工位读到）⇒ 本仓**任何**分支（含 main）推送一律被拒 = 推送通道整体失效
---

# Note: pre-push bypass 对账基改真源 trunk（K12 第5批 · 推送通道解除阻塞）

## 触发场景

K12 第 5 批执行中，第 1、2 件已交付（判据全绿、提交经 `synova-commit`），
执行 `git push` 时被 pre-push 门禁 7（D331 bypass 对账）拒绝。

## 实测证据（非推断）

```
① 拒绝范围不是本分支：以同一门禁 + `origin/main` 为基，**main 分支同样 rc=1**
   ⇒ 推送通道整体不可用。
② 被索记录的 4 条提交：fd63e17c / f4e32728 / c0a7b736 / ab13a96c
   逐条 `git merge-base --is-ancestor <sha> gitea/local-main` ⇒ **4/4 = YES**
   ⇒ 它们**早已合入真源 trunk**（他人经各自分支/PR 合入）。
③ 本机账本读不到它们：门禁 union 读取 4 个来源（本工位 `.claude/bypass.log` + 3 个
   `.sessions/<sid>/bypass.log`），4 条 HASH 命中数 = **0/4**。
   原因：D1145 起记录写 per-session 权威账本，**不随 git 走** ⇒ 跨工位/跨机天然读不到。
④ 基的真相：`origin/main` = GitHub 旧 main，停 **5a6591c4a**（账号已封）；
   真源 trunk = `local-main` = **e52499ddd**（`git ls-remote --heads gitea` 实测）。
```

## 决策

**pre-push 的 `BYPASS_BASE` 优先取 `origin/local-main`**，不存在才回退 `origin/main`，
再回退 `$PUSH_REMOTE/$PUSH_BRANCH`。

**依据（核既有决议，不另立口径）**：`.gitea/workflows/local-gates.yml` 第 ③ 步**早已**改用
`CHANGED_BASE=origin/local-main`，其注释原文写明同一病灶：
> 「origin/main = GitHub 旧 main（停 5a6591c4a），拿它当基线会把 local-main 全部 diverge
>  提交的存量红算进本 PR（实测 141 tests failed，与本 PR 改动零相关）」

⇒ 本次只是把**同一口径补到 pre-push**（此前只改了 CI 侧）。

## 边界（明确不做）

```
· check-bypass-log.sh 的判据**一字不动**（D1157 的 COMMITTED/HASH= 锚定、D1243 孤儿豁免、
  D1152 收窄范围、三态 exit 码 —— 全部保留）
· 不改阈值、不引入新机制、不豁免任何提交
· 缺记录仍然 rc 1 拒绝（本次不放松任何判定）
```

## 基源定序（第二层坑：remote-tracking ref 会陈旧，且 fetch 会假成功）

**改完第一版后实测仍被拒** ⇒ 再挖出一层：
```
· 第一版取 `origin/local-main` —— 本工位实测它停在 **68bf57598**（陈旧），
  而真值是 **e52499ddd** ⇒ 基比改前**更旧**，对账范围反而**扩大**（实测多列 60 个提交）。
· 加"先 fetch 刷新"后再取 —— fetch **返回 0 却什么都没推进**：
  本机 `origin` = GitHub（账号已封）⇒ 空成功。**以 rc 判"刷新成功"是错的**
  （实测：必须比对 ref 前后值）。
```

**定序（实测定，逐条有据）**：
```
① 本地 `local-main` 分支   —— 本机 trunk 真值（实测 e52499ddd，与 gitea 远端一致）
② `origin/local-main`      —— **只在刷新真的推进了它**时采用（比对 ref 前后值）
③ `origin/main`            —— 旧回退位（GitHub 旧 main 5a6591c4a，已废，仅兜底）
④ `$PUSH_REMOTE/$PUSH_BRANCH` —— 末位兜底
```

**判据（改后，钩子级实跑）**：
```
bash <git-common-dir>/hooks/pre-push origin <url> <<< "<refspec>"
⇒ ✅ bypass.log 对账通过: 2 条本机待推提交全部有记录
改坏：把 ① 去掉（并在 fetch 后无条件取 origin/local-main）⇒ 列 44 条未记录提交 ⇒ 拒
```

## 可复跑判据

```
改后: bash scripts/control-tower/check-bypass-log.sh   ⇒ rc 0（本机待推 1 条，全部有记录）
改坏: 基临时改回 origin/main                            ⇒ rc 1（列 4 条他人已合入 trunk 的提交）
回退: 把 pre-push-check.sh 的首个分支改回 origin/main 即恢复原状（判据脚本零改动）
```

## 代价（如实）

```
· 对账范围改为「距 local-main 的新提交」⇒ 若某分支的 base 不是 local-main（如从旧 main 拉出
  的遗留分支），范围口径随之变化；判据本身未放松（仍要求逐条有 COMMITTED 记录）。
· 授权来源：**创始人 2026-10-11 授权改这一行基**（执行方不自裁控制塔域变更）。
· 定序①依赖"本机 `local-main` 分支 = trunk 真值"这一事实（本机实测成立）。
  若某克隆的 `local-main` 落后于远端，则 ① 会把"已在远端的提交"算进范围 ⇒ 误拦。
  故 ② 保留了「刷新真推进即优先」的通道；两者取舍已在正文写明。
```
