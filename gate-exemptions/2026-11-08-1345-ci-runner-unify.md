# review: #1345
<!-- 任务: "#1345" -->
# 豁免说明：把 CI 唯一阻断门的**运行面跨平台化**，让 Synova 与 CompanyOS 共用同一个
#   runner label（一套运行面），并让 `local-gates` 能在一个 Linux/WSL 的自建 runner 上真跑。
#   本次只动「运行面」，不动任何判据：不改 workflow 名、不改 job 名、不改任何检查项、
#   不改任何阈值/词表/基线、不改必需 context 名（`local-gates / gates (pull_request)`）。
# 依据（2026-11-08 实测）：
#   · hub 迁到 Win（`ROOT_URL=http://192.168.1.5:3000/`）；实例级 runner `win-host-runner` id=3、
#     labels `win-ci,ubuntu-latest`、host mode（WSL2 Ubuntu），CompanyOS `ci.yml` 已 `runs-on: win-ci` 且绿。
#   · PR #1346 首跑（run 3728，runner id=3）：卡在「工作区」步 11 分 42 秒后取消；Gitea 日志
#     `22:59:52 GET /synova-agent/SynovaAgent.git/info/refs ... 401 Unauthorized` 且其后无 200
#     ⇒ 根因是**私库匿名 clone**（原 `:23` 不带凭据，Mac 上靠宿主 git 凭据，WSL runner 没有）。
#   · Linux 无 `shasum`（只有 `sha256sum`）：原 `:40` 计算不出 lock 指纹 ⇒ 每轮退化为全量 `npm ci`。
#   · 原 `:116` 从 `/Users/wane/gitea/.win-push-token` 读 token（Mac 专有路径）⇒ ①b 步 token 为空。
#   以上均为运行环境耦合，不涉及判据本身。回滚：还原对应 4 处即完全回退（无数据、无迁移）。
- .gitea/workflows/local-gates.yml — ①`:16` `runs-on: macos` → `runs-on: win-ci`（运行面切换，context 名不变）；②「工作区」步：私库 clone/fetch 改用 `${{ github.token }}`（原匿名 clone 在私库上 401）；③`:40` lock 指纹计算加 `sha256sum` 回退（Linux 无 `shasum`）；④`:116` `GITEA_TOKEN` 来源由 Mac 本地 token 文件改为工作流令牌；⑤新增 job 级 `env: GIT_TERMINAL_PROMPT=0`（CI 内 git 不得等交互输入，缺凭据须快速失败而非挂死）；⑥「依赖」步加 `ELECTRON_MIRROR`（GitHub releases 97KB/s vs npmmirror 11.4MB/s；只改下载源，版本仍由 lock 锁定、校验仍走 SHASUMS256）；⑦新增末步「清理（令牌不落盘 · always）」：job 结束后把 origin 还原为无凭据 URL，令牌只在本次 job 期间留在工作区 `.git/config` — #1345
- gate-exemptions/2026-11-08-1345-ci-runner-unify.md — 本豁免件自身属受保护目录变更故随批自覆盖 — #1345
