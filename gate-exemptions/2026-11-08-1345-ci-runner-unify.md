# review: #1345
<!-- 任务: "#1345" -->
# 豁免说明：把 CI 唯一阻断门的**运行面**从 Mac 专用 runner 切到 win-ci，让 Synova 与
#   CompanyOS 共用同一个 runner label（一套运行面），并解封因环境故障而无法取得绿色证据的在飞 PR。
#   本改动只动 `runs-on` 一行：不改 workflow 名、不改 job 名、不改任何 step、不改任何判据、
#   不改必需 context 名（`local-gates / gates (pull_request)`）。
# 依据（2026-11-08 实测）：
#   · hub 已迁到 Win（`ROOT_URL=http://192.168.1.5:3000/`）；CompanyOS `ci.yml` 已是 `runs-on: win-ci`，
#     最近 3 次 run 在 `win-host-runner` 上全部 success。
#   · Synova `local-gates.yml` 仍 `runs-on: macos`；`win-host-runner` 声明 label `[win-ci, ubuntu-latest]`
#     ⇒ 接不到 Synova 的 job（label 不匹配）。
#   · Mac runner 侧：`local-gates` 在「① 12 组门禁」1 秒红，日志 `env: node: No such file or directory`；
#     根因 `local-gates.yml:73` 的 `node_modules/.bin/tsx ...` 依赖环境 PATH 里的 node，
#     runner 重注册后无 nvm PATH（同机 CompanyOS 每步显式 export PATH 故不受影响）。
#   · Win 侧 WSL(Ubuntu) 工具链实测齐备：node v24.16.0 / npm 11.13.0 / git / bash / python3 / curl / jq，
#     hub 从 WSL 可达（403＝缺 token，属正常）。
#   回滚：将本行改回 `runs-on: macos` 即完全回退（无数据、无迁移、无外部状态）。
- .gitea/workflows/local-gates.yml — `runs-on: macos` → `runs-on: win-ci`（仅第 16 行 1 行；job/workflow 名与全部 step 不动，必需 context 名不变） — #1345
- gate-exemptions/2026-11-08-1345-ci-runner-unify.md — 本豁免件自身属受保护目录变更故随批自覆盖 — #1345
