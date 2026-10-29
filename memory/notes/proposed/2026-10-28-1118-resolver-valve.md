# #1118（#1115 后续）· legacy 别名要配安全阀：`local-main ⇒ main` 的等价只在同一棵树上成立

- **状态**: proposed（本批实现已落同一分支；trunk 切换后的收口批）
- **任务**: #1118（分支 `fix/1118-resolver-valve`；基线 `gitea/main` = 94ed76b2d；#1119 已合入 main）
- **日期**: 2026-10-28
- **#CRITERIA**: D
- **架构层**: 不属五层业务（治理脚本）

## 现状（做之前是什么样）

- #1119 把 trunk 切到 `main`：`resolve-ci-base.sh` 里 `main|local-main) BASE="gitea/main"`、默认 base＝`gitea/main`、
  fetch `+refs/heads/main:refs/remotes/gitea/main`。P0（base=main 不可解析）已解，CI 双绿（`pull_request success 1m36s`）。
- 但 `local-main` 到 `gitea/main` 是**无条件**映射：resolver 全文 `grep --base|安全阀|非同干|ALIAS|merge-base` 零命中。
  沙箱实测（`origin/main` 与 `origin/local-main` 已分叉）：`GITHUB_BASE_REF=local-main SYNO_CI=1` ⇒ `rc=0 out=gitea/main`，
  stderr **0 行**提到 local-main ⇒ **静默别名到不同树**：调用方以为自己按旧名取 base，实际拿到另一棵树 ⇒ diff 判据跑错。
- 同时 #1119 没改配对测试：现有 8 例在其 resolver 上 **7 通过 / 3 失败**（3/4/5 仍断言 `gitea/local-main`），
  而 `.gitea/workflows/**` 与 `scripts/pre-commit-check.sh` 都不跑该测试 ⇒ 红着没人管。

## 决定（做成了什么）

| 层 | 件 | 决策 |
|---|---|---|
| 解析器 | `scripts/control-tower/resolve-ci-base.sh` | `case` 拆两臂：`main)` 直通 `gitea/main`（无阀）｜`local-main)` 标 `LEGACY_ALIAS=1`；**④b 安全阀**只在别名路径生效：候选 `refs/heads/local-main` ＋ `refs/remotes/*/local-main` 与 canonical 比 SHA —— 相等 ⇒ 放行；候选是祖先 ⇒ `::warning` 容忍（同干陈旧）；**分叉 / 候选领先 ⇒ `die` exit 2** |
| 头注 | 同上 | `@exit` 补「legacy 别名非同干 ⇒ 2」；顺手修正 #1115 留下的错字（新鲜度断言写成了 local-main 跟踪引用，代码实为 main） |
| 配对测试 | `tests/control-tower/resolve-ci-base.test.sh` | 修存量 3/4/5（断言与 `update-ref` 物化路径 → `gitea/main`）；补 9 至 14b：同 SHA ⇒ 0｜祖先 ⇒ 0＋「容忍」告警｜分叉 ⇒ 2＋「非同干」｜领先 ⇒ 2｜非别名 `main` 不误伤 ⇒ 0｜**改坏即红两条**（删 `local-main)` 臂 ⇒ 用例 9 红；删阀 `die` ⇒ 用例 11 红） |
| 豁免/登记 | `gate-exemptions/2026-10-28-1118-resolver-valve.md`、`docs/authority/DOCS-REGISTRY.yaml` | 首行 `# review: #1118`；四条受保护路径（解析器／测试／自覆盖／DOCS-REGISTRY 自登记）；`DOC-1118`（R1 口径：id = DOC-<Issue#>） |

## 为什么容忍「祖先」而拒绝「分叉/领先」

- 迁移期 `local-main` 冻结在 trunk 切换点（实测 `b8edf9860` 是 `94ed76b2d` 的祖先）：调用方按旧名取 base，
  落在同一干线的旧点上，diff 语义不变 ⇒ 容忍并打 `::warning` 点名两个 SHA（**不是静默**）。
- 分叉或别名侧领先 ⇒ 别名会把 base 指到另一棵树／更旧的树，diff 结果随之失真 ⇒ **exit 2 fail-closed**，
  宁可红，也不许算出错误 diff。
- 同型教训：`#1119` 的"无条件映射"本身不是错，缺的是**一致性断言**——这正是这轮在治的「假绿」根因之一。

## 已知限制

1. 阀只看 `refs/heads/local-main` 与 `refs/remotes/*/local-main`；自定义命名空间下的 local-main 副本不判。
2. `local-main` 若在 Gitea 侧被删除，克隆里可能残留陈旧的 `refs/remotes/origin/local-main`（fetch 不带 --prune）——
   那属于祖先 ⇒ 容忍告警，不阻断（符合设计）。
3. 不新增 `--base` 入参（#1119 无该入口）；本卡验收走 `SYNO_BASE_REF` / `GITHUB_BASE_REF` 同一条解析链。

## 证据（本卡原始输出摘要）

- `GITHUB_BASE_REF=main` / `SYNO_BASE_REF=main` ⇒ `gitea/main` rc=0；`SYNO_BASE_REF=nope` ⇒ rc=2。
- 阀三态沙箱：同 SHA ⇒ 0 ｜ 祖先 ⇒ 0 ＋「容忍」告警 ｜ 分叉 ⇒ 2 ＋「非同干」 ｜ 领先 ⇒ 2 ｜ 非别名 ⇒ 0。
- 配对测试：0 失败；两条改坏即红均实测变红（删臂 ⇒ 输出退化为 `local-main`；删 `die` ⇒ 分叉变 0）。
- `check-gate-protection.sh --changed-base gitea/main --root .` ⇒ 0 失败。
