# 决策: CI 运行面跨平台化（local-gates 从 Mac 专用改为 win-ci 通用）+ 两条到期夹具豁免续期 — #1345

状态: proposed
日期: 2026-11-08

> 承接：交接单 `D:\gitea\HANDOFF-gate-line-2026-11-08.md`（Win hub 运维 → 门禁线）；
> 方向依据：创始人 2026-11-08「全仓，Synova/CompanyOS，都只用一套 CI/门禁，只维护一套即可」。
> 本件只记录运行面这一决定；「判据源单份」不在本件范围（另立切片）。

## 一句话

把 `local-gates` 从「只能在 Mac 上跑」改为「在 win-ci 通用 runner 上能跑」，**不动任何判据**，
让 Synova 与 CompanyOS 共用同一个 runner label 与同一份 workflow 语义。

## 问题

- hub 已从 Mac 迁到 Win（`ROOT_URL=http://192.168.1.5:3000/`）；CompanyOS 的 `ci.yml` 已是 `runs-on: win-ci`，
  而 Synova 的 4 个 workflow 仍是 `runs-on: macos` ⇒ 实例级 runner（labels `win-ci,ubuntu-latest`）接不到。
- Mac runner 侧 `local-gates` 在「① 12 组门禁」1 秒红：`env: node: No such file or directory`
  （`:73` 的 `node_modules/.bin/tsx` 依赖环境 PATH 的 node，runner 重注册后无 nvm PATH）。
- 26 个在飞 PR 因此拿不到绿色证据。

## 决定（只动运行面，逐条附实测依据）

1. `runs-on: macos` → `win-ci`（job/workflow 名不变 ⇒ 必需 context 名 `local-gates / gates (pull_request)` 不变）。
2. 工作区步：私库 clone 改用 `${{ github.token }}`（原匿名 clone 在私库上 401）。
3. 工作区步：**显式 refspec** `+refs/heads/*:refs/remotes/origin/*`；缺本次提交即 `cannot judge`（exit 2）。
   依据：本工作区的 `origin` 被配成只取 HEAD，`git fetch` 只更新 FETCH_HEAD ⇒ checkout 静默失败后
   回退到陈旧 FETCH_HEAD，**CI 实际跑的是 main 而不是被检提交**（run 3740 实证 `HEAD=96436fa9f`）。
   这是假红/假绿级缺陷，故改为 fail-closed，**禁**回退陈旧提交。
4. lock 指纹计算加 `sha256sum` 回退（Linux 无 `shasum`）。
5. ①b 的 `GITEA_TOKEN` 来源由 Mac 本地 token 文件改为工作流令牌。
6. job 级 `GIT_TERMINAL_PROMPT=0`：CI 内 git 不得等交互输入。依据：origin 无凭据时
   `resolve-ci-base.sh` 的 fetch 在私库上弹凭据提示，8 分钟 0% CPU 挂死。
7. job 级 `ELECTRON_MIRROR`（npmmirror）：GitHub releases 实测 97KB/s（106MB 需约 1 小时），
   npmmirror 实测 11.4MB/s（约 9 秒）。只改「从哪下」：版本仍由 package-lock 锁定，校验仍走 SHASUMS256。
   必须 job 级——④ 门禁复现器把「依赖」步正文抽进沙箱重跑，step 级 env 不进沙箱。
8. 新增末步「清理（令牌不落盘 · always）」：job 结束后把 origin 还原为无凭据 URL。
9. `fixture-power-baseline.txt` 两条豁免 `expires=2026-11-07` 已到期（今天 11-08 起任何 PR 必红，
   与本改动无关）。逐条复核后原理由仍成立，续期至 2027-02-08 并记录复核人/日期；**未改任何判据**：
   - `hooks-install.test.sh:43`：正向断言（克隆里出现非 sample 项即 fail）；
   - `docsonly-diff-base.test.sh:59`：在 `OLD_BLOCK_EOF` 冻结标本 heredoc 内，属**测试数据**不是判据。

## 边界

- **不改**任何检查项、阈值、词表、基线内容（第 9 条只改到期日，判据与理由不变）。
- **不改** job 名 / workflow 名 / 必需 context 名。
- **不整批替换** 35 处 `/Users/wane`（`mkdir -p` 会建目录、`$PATH` 尾部有 node ⇒ 属技术债，不是阻塞）。

## 证据（run 3746，runner id=3 / WSL Ubuntu 26.04）

- 22 步中 16 步 success：含 `① 12 组门禁`、`①d`（豁免被接受）、`②`、`③`、`④` 复现器、`①e`、`①j`、`①f`、`①g`、`①i`、`⑤`、`⑥`，以及 `清理`。
- 唯一红为 `⑦ 门禁完整性`（上述到期豁免）；该红在改动前即存在，属存量、非本次引入。

## 回滚

逐处还原即可（无数据、无迁移、无外部状态）；`runs-on` 改回 `macos` 即完全回退运行面。

## 未验证

- 判据在 macOS 与 Linux 上的行为等价性：本片只证明「Linux 上 16/22 步可过」，等价性未逐条比对。
- Mac 侧加入 `win-ci` 作为第二台 runner 尚未做（需 Mac 升级 gitea-runner 并加 label）。
