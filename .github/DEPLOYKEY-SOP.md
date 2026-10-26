# DeployKey 旁路 main 保护：轮换与取证 SOP（#1032 · 裁 421）

> 背景（K3 诊断 §4 P2-⑧）：GitHub ruleset `main-protect` 的唯一 `bypass_actors` 是
> `DeployKey / always` ⇒ 镜像同步通道**即**绕过通道。现状**接受**，但必须有取证与轮换。
> 取证工具：`bash scripts/control-tower/report-mirror-pushes.sh [N]`（只读，无 PR 即判"直推"）。

## 一、取证：最近一次绕过 main 保护的推送是谁／何时／推了什么

命令：
```bash
bash scripts/control-tower/report-mirror-pushes.sh 10
```
判定口径：GitHub 上**没有关联 PR** 的 main 提交 = 直推 = 绕过必需 checks。

2026-10-26 实测（最近 8 条全部为直推，因为镜像同步整体推送 Gitea 历史）：
| sha | 时间(UTC) | 操作身份 | 内容 |
|---|---|---|---|
| `fe55a018e` | 2026-10-26T05:57:40Z | `win-push`（部署键推送身份） | 镜像同步：合入 #1033（必需 context 收口） |
| `e474e3ddf` | 2026-10-26T05:53:56Z | `k12-batch5` | #1033 提交本体 |
| `0c42c4dc0` | 2026-10-26T04:45:36Z | `win-push` | 镜像同步：合入 #1031 |
| `b5d966b27` | 2026-10-26T04:41:50Z | `k12-batch5` | #1031 提交本体 |

⇒ **"谁"**：部署键（推送身份 `win-push`）；**"何时"**：每次镜像同步时间；**"推了什么"**：Gitea `local-main` 的同步快照。

## 二、轮换（每 90 天，或泄露即轮换）

1. **生成**：`ssh-keygen -t ed25519 -C "synova-mirror-$(date +%Y%m)" -f ~/.ssh/synova_mirror_ed25519 -N ''`
2. **加新键**（写权限）：
   `gh api -X POST repos/synova-agent/SynovaAgent/keys -f title="mirror-$(date +%Y%m)" -f key="$(cat ~/.ssh/synova_mirror_ed25519.pub)" -F read_only=false`
3. **切本地**：改 `~/.ssh/config`（Host github.com → IdentityFile 新键）或在仓库 remote 用 `GIT_SSH_COMMAND` 指定。
4. **验证新键**：`git ls-remote mirror refs/heads/main` 成功。
5. **吊销旧键**：
   `gh api repos/synova-agent/SynovaAgent/keys --jq '.[]|"\(.id) \(.title)"'` → `gh api -X DELETE repos/synova-agent/SynovaAgent/keys/<old_id>`
6. **验证旧键失效**：用旧键 `git ls-remote mirror` 必须失败。
7. **记录**：在本文件末尾追加一行 `YYYY-MM-DD rotated <old_id>→<new_id> by <人>`。

## 三、泄露应急（目标：1 小时内失效）

1. **立即吊销**（第 5 步，不等轮换窗口）；
2. **取证**：`report-mirror-pushes.sh 50`，导出全部"直推"记录，核对是否有非同步来源的提交；
3. **补保护**：若发现异常提交 ⇒ 立即 revert（在 Gitea 侧 revert 后同步），并在 Gitea 建卡记录；
4. **通知**：创始人与 K3；事件写入 `memory/notes/proposed/`。

## 四、告警面（最小可用，不新增门禁）

- **每次同步后**跑一次 `report-mirror-pushes.sh 3`，把输出追加到 `~/synova-ops/logs/mirror-push.log`；
- **异常判据**：出现"直推"且该 sha **不在**同步记录的最后一行为本次同步 sha ⇒ 人工核查；
- 该日志不进门禁（避免与变更无关的恒红，K3 §4 P0-② 教训）。

## 五、收紧为 PR 模式（可选终态）

若未来不再需要"整体镜像历史"，可改为：Gitea 侧每次合并后，由自动化**开 GitHub PR** 而非直推 —— 那时可把 `bypass_actors` 清空。这是终态方向，不在本批。
