# Task Brief: P10 · #740 双仓镜像每日自动推送（对账→推送→核 SHA→可见信号）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 每日 10:00 的镜像同步**连续三天失败且无人被通知**（`~/Library/Logs/synova-mirror-sync.launchd.log` 10-18/19/20）。
- 现存件：`scripts/control-tower/check-dual-repo-sync.sh`（对账探针，只读）｜`scripts/pre-push-check.sh`（门禁 0-2 mirror 通道＋`--verify-mirror-sync`）｜`/Users/wane/synova-ops/handbook/scripts/mirror-sync.sh`（每日入口，含逃生舱＋zsh 语法坏行）｜`~/Library/LaunchAgents/com.synova.mirror-sync.plist`（10:00，不动）。
- 红线现场：现脚本用 `SYNO_ALLOW_MAIN_PUSH=1`；从陈旧主树（HEAD `ba1b22a8b`、旧版门禁）推 ⇒ 三天全被门禁拒。

## Q1: 调研（决策链 / 既有基础）
- 复用（不另造判据）：探针＝一致/落后/分叉的唯一判据源；门禁 0-2 mirror 分支＝ff 放行＋`mirror-sync.log` 留痕＋`pending`；`--verify-mirror-sync`＝推后核 SHA。
- 触发器：Gitea 侧 cron 实测**从不起火**（`action_schedule` 无本件登记、`event='schedule'` 全历史 0；默认分支＝`audit/k3-…`）⇒ 每日由既有 launchd 承担；workflow 仅留人工复跑（如实标注，不放假 cron）。
- 依据：Issue #740（创始人令 2026-10-20「一天做一次」）｜裁 223 判据纪律⑨｜裁 231 镜像只读。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/control-tower/mirror-sync-push.sh
- tests/control-tower/mirror-sync-push.test.sh
- .gitea/workflows/dual-repo-sync.yml
- gate-exemptions/2026-10-20-p10-740-mirror-push.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-mirror-sync-push-740.md
- .claude/task-briefs/2026-10-20-740-mirror-sync-push.md
- /Users/wane/synova-ops/handbook/scripts/mirror-sync.sh（仓外薄壳；由创始人执行或提权，L2 不得扩）
不做什么：
- scripts/pre-push-check.sh（门禁本体归治理线）
- scripts/audit/**
- .github/workflows/**
- scripts/control-tower/check-dual-repo-sync.sh（探针保持只读）
- ~/Library/LaunchAgents/com.synova.mirror-sync.plist（零改动）
- 仓库默认分支 / Gitea ruleset / bypass 名单

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/mirror-sync-push.test.sh`（夹具，零网络）｜本机 `launchctl kickstart -k gui/$(id -u)/com.synova.mirror-sync`
- 交互：一致→NOOP exit 0；落后且 ff→自动推＋核 SHA；分叉→拒推 exit 1；核 SHA 不等→exit 2＋信号；失败→Gitea issue 可见
- 结果：测试 12/12 绿（含五个变异体改坏必红）；`mirror-sync.log` 有 ALLOW/VERIFIED；失败时 issue 出现

## Q4: 契约与测试
- 执行器契约：`@input` 环境缝（REPO/GITEA_URL/MIRROR_SSH_CMD/VERIFY_TRIES/OUT/SIGNAL…）｜`@output` JSON `syno-mirror-push/v1`｜`@exit` 0/1/2｜`@degraded` 写 JSON 且发信号｜`@error` E_* 定集（见脚本头）。
- 测试：`tests/control-tower/mirror-sync-push.test.sh`（①-⑧ 判据 ＋ ⑨ 五个变异体；判别力自检：非法 sha ⇒ exit 2）。

## 本任务在哪一层
- 治理线 / 平台交付与运维（−1 运行时之外的运维面）；不涉产品运行时、不改门禁语义。

## Done 标准（至少一条可验证）
- [ ] 夹具测试全绿 → `verify: bash tests/control-tower/mirror-sync-push.test.sh`
- [ ] 受保护路径豁免合规 → `verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/local-main`
- [ ] 真实一致场景不推 → `verify: bash scripts/control-tower/mirror-sync-push.sh --dry-run`（exit 0 / NOOP）
- [ ] 每日触发器真跑 → `verify: launchctl print gui/$(id -u)/com.synova.mirror-sync | grep -A2 'last exit code'`
