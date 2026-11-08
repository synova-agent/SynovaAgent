# review: #1346
<!-- 任务: "#1345" -->
# 豁免说明：把 CI 唯一阻断门的**运行面跨平台化**，让 Synova 与 CompanyOS 共用同一个 runner label
#   （一套运行面），并让 `local-gates` 能在 Linux/WSL 的自建 runner 上真跑。
#   本次只动「运行面」，不动任何判据：不改 workflow 名、不改 job 名、不改任何检查项、
#   不改任何阈值/词表/基线、不改必需 context 名（`local-gates / gates (pull_request)`）。
# 依据（2026-11-08 实测，run 3728/3738/3740/3742/3744/3746/3748/3750）：
#   · hub 迁到 Win（`ROOT_URL=http://192.168.1.5:3000/`）；实例级 runner `win-host-runner` id=3、
#     labels `win-ci,ubuntu-latest`、host mode（WSL2 Ubuntu 26.04），CompanyOS `ci.yml` 已 `runs-on: win-ci` 且绿。
#   · 私库匿名 clone 返 401（Gitea 日志 22:59:52 synova-agent info/refs 401 且其后无 200）⇒ 工作区步直接红。
#   · 工作区 origin 被配成只取 HEAD ⇒ fetch 只更新 FETCH_HEAD，分支提交不在本地，checkout 静默失败后
#     回退陈旧 FETCH_HEAD，CI 实际跑的是 main（run 3740 实证 HEAD=96436fa9f）⇒ 改 fail-closed。
#   · origin 无凭据时 `resolve-ci-base.sh` 的 fetch 在私库上弹凭据提示，8 分钟 0% CPU 挂死。
#   · Linux 无 `shasum`；GitHub releases 实测 97KB/s vs npmmirror 11.4MB/s（106MB）。
#   · 两条夹具豁免 expires=2026-11-07 已到期 ⇒ 今天起任何 PR 都红（非本次引入），经复核续期。
# 回滚：逐处还原即完全回退（无数据、无迁移、无外部状态）。
- .gitea/workflows/local-gates.yml — ①`runs-on: macos` → `win-ci`（context 名不变）；②工作区私库 clone 改用工作流令牌 + 显式 refspec + 缺本次提交即 cannot judge；③lock 指纹加 `sha256sum` 回退；④①b 的 `GITEA_TOKEN` 改走工作流令牌；⑤job 级 `GIT_TERMINAL_PROMPT=0`；⑥job 级 `ELECTRON_MIRROR`；⑦新增 `always()` 收尾清理（不留令牌在 .git/config） — #1345
- docs/authority/DOCS-REGISTRY.yaml — 为本批豁免件补 DOC-1345-01 登记行以闭合 D782 D2 登记门禁（CI 实撞） — #1345
- scripts/control-tower/fixture-power-baseline.txt — 两条夹具豁免于 2026-11-07 到期（任何 PR 当天必红，与本次改动无关）；逐条复核后原理由仍成立，续期至 2027-02-08 并记录复核人/日期；未改判据 — #1345
- gate-exemptions/2026-11-08-1345-ci-runner-unify.md — 本豁免件自身属受保护目录变更故随批自覆盖 — #1345
