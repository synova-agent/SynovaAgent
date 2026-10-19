---
状态: proposed
日期: 2026-10-19
决策: 新增「两仓对账探针」`scripts/control-tower/check-dual-repo-sync.sh`（三态退出码，只从远端真值取 sha）＋ CT-40 配对测试 ＋ 独立 `dual-repo-sync.yml` 每日 cron；结果落固定路径 `.codex/control-tower/tmp/dual-repo-sync.json`。
理由: 两仓 sha 差此前无人自动算、无人报警（K3 审计 #594/commit 14e7177 的 P1-2）；而常用判据写法 `git rev-list --count mirror/main..local-main` 会因本地指针落后得出 0（假绿，K3 P11 实证）⇒ 必须用远端 sha 钉住判定，且"读不到"要显式 degraded（exit 2），不得当"差=0"。
---

# 决策 Note — P10 两仓对账探针（Issue #609）

> 过程件：记「做了什么、为什么、怎么判」；不写操作手册。
> 数值以命令原始输出为准；标「实测」的为本轮亲自复跑。

## 现状（2026-10-19 实测）

- **无探针**：`grep -rln "dual-repo" scripts/control-tower/ tests/control-tower/` ⇒ 0 命中 ⇒ 两仓差只能人查。
- **判据有假绿**：本地 `local-main` 落后远端时，`git rev-list --count mirror/main..local-main` = **0**；同刻真值为 `mirror/main..gitea/local-main` = **120**（as_of 2026-10-19T06:10Z）。
- **两仓真值（同刻）**：`gitea/local-main = 695ada515`｜`mirror/main = 49ddc63ee`｜`merge-base --is-ancestor` = 0（零分叉）。
- **结果落点**：`.codex/control-tower/tmp/` 已被 `.gitignore:62` 覆盖 ⇒ JSON 不污染仓库。

## 决定

1. 新增探针 `check-dual-repo-sync.sh`：远端 sha 只从 `git ls-remote`（Gitea）／GitHub API（gh → 匿名 curl 回退）取；**绝不读本地同名分支**。
2. 判定：`merge-base --is-ancestor <gh_main> <gitea_local_main>` ⇒ 分叉红（FORK）；`rev-list --count` ⇒ lag；lag=0 才绿。
3. 三态：`0` 一致／`1` 滞后或分叉／`2` degraded（远端读不到、sha 不在本地且补取失败、JSON 写不出）。
4. 接线：独立 `.gitea/workflows/dual-repo-sync.yml`（每日 01:00 UTC ＋ dispatch，`runs-on: macos`，与 local-gates 分离，不拖慢阻断腿）；job 红＝可见告警，`::error` 带 verdict。
5. 配套：CT-40 配对测试（沙箱 bare 仓，零网络），含**假绿陷阱**用例（naive=0 必被拦成 lag=2）。

## 依据

- CTO 2026-10-19 卡（三态判据 ＋ 改坏必红 ＋ "runner 单点不属本包"）。
- K3 审计 #594（`14e7177`）P1-2：单点无报警、无 owner；P11：假绿陷阱真实。
- 既有约定：三态退出码、`@降级` 显式、只读、钉 SHA 不钉分支（根件 §12）。

## 生效时点

- 本 PR 合入 `local-main` 后：探针可被人/CI 直接调；次日 01:00 UTC 起由 cron 每日跑一次（runner 在时）。
- **不改变**阻断腿语义、require check、分支保护；**不覆盖** runner 存活探测（归 P4 门禁域）。
