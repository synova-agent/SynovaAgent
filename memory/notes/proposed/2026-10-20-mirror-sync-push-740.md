---
状态: proposed
日期: 2026-10-20
决策: 镜像每日同步改由「执行器（产品仓、可测）＋ 薄壳（synova-ops 仓调用）＋ 既有 launchd 10:00」承担；判据只用探针/门禁 0-2/--verify-mirror-sync 三件，失败必开/评 Gitea issue；禁用逃生舱；Gitea 侧 cron 承认从不起火、只留 workflow_dispatch。
理由: 三天连续红且无人被通知（日志实证）。根因三条：① 从陈旧主树推（HEAD ba1b22a8b），② 主树门禁是旧版（`grep -c SYNO_MIRROR_REMOTE`=0，mirror 推送落进 main 保护分支），③ 脚本用 `SYNO_ALLOW_MAIN_PUSH=1` 逃生舱且核 SHA 行 `${(NEW:-空)}` 是 zsh 写法会崩。Gitea 侧 cron 从不起火（action_schedule 无本件登记、event='schedule' 计数 0；默认分支=audit/k3-…）。
---

# 决策 Note — #740 双仓镜像每日自动推送

## 现状（实测，非推测）
```
~/Library/Logs/synova-mirror-sync.launchd.log
2026-10-18T10:00 | ❌ 推送失败（3 次）⇒ 停手上报
2026-10-19T10:00 | ❌ 推送失败（3 次）⇒ 停手上报
2026-10-20T10:00 | ❌ 推送失败（3 次）⇒ 停手上报
（同期 symova-mirror-sync.log 内层：❌ 门禁 0-1: 远端有 169／307 个本机没有的 commit — 本地已过期
                            ⚠️ 门禁 0-2: SYNO_ALLOW_MAIN_PUSH=1 逃生舱生效 — 直推 main）
```
⇒ 机制「看起来有」（plist 每日触发），实质「每天必失败且只写日志」——恰好是判据纪律⑨ 的 ③ 失守。

## 决定
1. **判据不新造**：一致/落后/分叉＝`check-dual-repo-sync.sh`；ff 放行＋留痕＋pending＝`scripts/pre-push-check.sh` 门禁 0-2；推后核 SHA＝`--verify-mirror-sync`。执行器只做编排。
2. **新增执行器** `scripts/control-tower/mirror-sync-push.sh`（三态退出码＋JSON＋Gitea issue 信号），**禁**逃生舱/`--force`/`--no-verify`。
3. **每日触发沿用既有 launchd**（`com.synova.mirror-sync`，10:00，plist 零改动）；synova-ops 的 `mirror-sync.sh` 改为薄壳（取新鲜树→调执行器→退出码透传）。
4. **Gitea workflow 如实降级**：保留 `workflow_dispatch` 供人工复跑，头部写明 `on.schedule` 从不起火及原因；permissions 加 `issues: write`。
5. 信号：失败开/评单（标题 `[AUTO] 双仓镜像同步失败`），恢复自动评论并关单。

## 依据
- Issue #740（创始人令 2026-10-20「一天做一次」）｜裁 223（判据纪律⑨）｜裁 231（镜像只读）
- Gitea 侧证据：`action_schedule` 仅 1 行（`product-progress.yml`、ref=`audit/k3-…`）；`action_run` 全历史 `event='schedule'` = 0；仓库 `default_branch = audit/k3-20260904-line1-desktop`
- 夹具：`tests/control-tower/mirror-sync-push.test.sh` 12/12 绿，含五个变异体（①无脑收工 ②跳过推 ③分叉放行 ④不等就成功 ⑤只写log）全部被判红

## 影响面
- 产品仓：1 新脚本＋1 新测试＋1 workflow＋1 豁免＋1 registry＋本 Note＋1 brief
- 仓外：synova-ops 薄壳 1 件（plist 与 deploy key 不动）
- 不动：门禁本体、ruleset、默认分支、`.github/**`、`scripts/audit/**`、客户实例

## 已知限制
- Gitea 原生 cron 仍未活（要改默认分支＋会带起 `.github` 三个 cron）⇒ 后续 CTO 裁。
- 执行器不判「滞后是否可接受」（lag>0 且 ff 必推）。
- ②③ 的真实世界证据要等下一个合并后的 10:00；今日只证 ①（两仓同 sha）。
