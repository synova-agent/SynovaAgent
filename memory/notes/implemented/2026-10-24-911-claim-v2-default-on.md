# 2026-10-24 · #911 claim-v2 恢复「默认开」（四处同源 ＋ CI 显式注入）

## 现状（改前实测）

`SYNO_CLAIM_V2` 同一事实有四个说法：`claim_store.claim_v2_enabled` 的 docstring 写「未设 ⇒ True」，
但函数体 `if not raw: return False`（2026-10-08 热修留下的回滚态）；`pre-commit-check.sh` 组 6
注释写「默认开（裁 1423）」而 `case` 的 `*)` 把空值吞成 0；`check-verifiable-done.sh` 与
`workflow/resolve-commit-brief.sh` 是同一段 `case` 的复制，同样空值 ⇒ 0；`.gitea` 步① 未注入该变量。
后果：#910 的 CI 红在组 12 的 4 行「不在 Q2 范围」，且任何用 claim 的新批次在 CI 必红。

## 决定

恢复创始人 2026-10-08 裁 1423「一步到位」：**未设 ⇒ 开**；显式 `0|off|false|no|n` ⇒ 关（唯一回滚点）。
四处 `case` 全部显式补空值分支（漏一处就是把同一事实又拆成两个说法）；CI 步① 显式注入
`SYNO_CLAIM_V2: "1"` 并 echo 生效值，防未来默认值被改回时这条腿静默退回 legacy。

## 依据

- Issue #911（CTO 裁 318／319；创始人 2026-10-24 派单第 1 件）；
- 缺陷实证：#910 评论 5540（根因定位）＋ #910 评论 5566 第 8 行（两态复现：未设 ⇒ 4 行红；+1 ⇒ 全绿）；
- 存量面：仓内 36 个 claim 逐个 `--check` 全绿（`claim_store.py --check`，本 PR 复跑）。

## 生效时点

本 PR 合并 `local-main` 起。回滚 = 显式 `SYNO_CLAIM_V2=0`（CI 改 workflow 的 `env:` 值，走
`gate-exemptions` 豁免；本地环境变量即可），**不改代码**。

## 例外与残留

- 四处 vs 卡面三处：`check-verifiable-done.sh` 与 `resolve-commit-brief.sh` 是同一 bug 的另外两份
  复制（不补 ⇒ resolver 默认关 ⇒ 组 6/12 的 claim 分支在默认态不可达，C2 不可能通过）⇒ 计入本 PR 并留痕。
- 存量 claim 的 `note:` 里若仍写「本树 SYNO_CLAIM_V2 缺省为关」（如 828.yaml），属历史陈述，不回改
  （超出本卡写集）；语义以 `claim_store.py --flag` 为准。
