# Task Brief: P10 · #740 每日自动跑暴露的 GitHub 读取缺陷（launchd 下 token 直连）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 每日 10:00 的镜像同步自动跑了两天，两次都不是同步失败，而是**读 GitHub 的通道在 launchd 里不可用**：
  - 10-21 10:01 → 推送成功（26 提交）→ `CI_UNKNOWN reason=等满 900s 仍未出结论` → exit 2
  - 10-22 10:05 → `DEGRADED reason=E_PROBE_DEGRADED`，`github.sha` 为空 → exit 2
- 根因：`gh` 在 launchd 会话里依赖 keychain（不可靠）。实测同 token 下：`GH_TOKEN=… gh api …` 可用；`curl -H "Authorization: token …"` 返回 200。
- 相关件：`scripts/control-tower/mirror-sync-push.sh`（执行器的 `ci_query`/`gh_token`）｜`gate-exemptions/2026-10-20-p10-740-mirror-push.md`（受保护路径豁免）。

## Q1: 调研（决策链 / 既有基础）
- 既有：`check-dual-repo-sync.sh` 的 `gh_read` 有 curl 匿名回退；`mirror-sync-push.sh` 的 `ci_query` 原先**只走 gh**（无回退）⇒ 这就是 10-21 等不出结论的直接原因。
- GitHub token 已有落盘：`~/.dsh/.credentials.yaml` 的 `GITHUB_TOKEN`（实测 headless 可用，`curl` 200）。
- 红线：不改门禁判据、不新增别处凭据、不把 token 写进仓库。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/control-tower/mirror-sync-push.sh
- tests/control-tower/mirror-sync-push.test.sh
- gate-exemptions/2026-10-20-p10-740-mirror-push.md
不做什么：
- scripts/pre-push-check.sh
- scripts/control-tower/check-dual-repo-sync.sh
- scripts/audit/**
- ~/Library/LaunchAgents/com.synova.mirror-sync.plist

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/mirror-sync-push.test.sh`｜`bash scripts/control-tower/mirror-sync-push.sh --dry-run`
- 交互：`ci_query` 改为 python3 直连 GitHub API（token 取自 `GH_TOKEN`/`GITHUB_TOKEN` 或 `~/.dsh/.credentials.yaml`），不依赖 gh/keychain；失败 job 名单由同一次响应携带
- 结果：拿不到 token／请求失败 ⇒ 显式 `unknown`（仍 exit 2，不当通过）；拿到结论 ⇒ `green` / `red`
- 附带：状态历史改共享位置（`~/Library/Logs/synova-mirror-sync-history.jsonl`）、同 `verdict+reason` 不重复评论

## Q4: 契约与测试
- 契约不变（`@input/@output/@exit/@degraded` 见脚本头），仅换取数通道；新增 `SYNO_PUSH_GH_TOKEN_FILE` 缝。
- 测试：`SYNO_PUSH_CI_CMD` 注入缝保留（零网络）；夹具 16 项须全绿。

## 本任务在哪一层
- 治理线 / 平台交付与运维（镜像通道）；不涉产品运行时、不改门禁语义。

## Done 标准（至少一条可验证）
- [ ] 夹具全绿 → `verify: bash tests/control-tower/mirror-sync-push.test.sh`
- [ ] token 直连可用 → `verify: GH_TOKEN=<file> bash scripts/control-tower/mirror-sync-push.sh --dry-run`
- [ ] 真实 CI 结论可读（不再是 unknown）→ `verify: bash scripts/control-tower/mirror-sync-push.sh --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["ci"])'`
