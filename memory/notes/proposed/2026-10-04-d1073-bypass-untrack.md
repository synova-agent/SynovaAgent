# D1073 · bypass 证据账本停跟踪 —— 126/136 PR 冲突的单一来源根治

- **状态**: proposed
- **日期**: 2026-10-04
- **背景**: `.claude/bypass.log` 是 append-only 运行期证据账本，却**受版本控制**。post-commit hook
  每次提交追加一行并立刻派生一条影子登记提交（D521）——二者合起来使**每个提交都改这个文件**。
  实测：126/136 个 open PR 都改它；#946/#947「13/13 全绿但 CONFLICTING」，冲突文件**只有它**；
  9 月 1199 个提交里 327 条（27%）是"bypass COMMITTED 登记"这类机械提交。
- **决定**:
  1. **停跟踪**（CTO 裁决 D3：否掉"移到 .codex/"，那只是把冲突换个位置）——`.gitignore` 收口 +
     `git rm --cached`；`.gitattributes` 的 `merge=union` 声明随之移除（GitHub 服务端本就不执行自定义
     驱动，判例 M-06：靠合并策略兜冲突结构上不成立）。
  2. **账本权威化**：per-session 落点 `.sessions/<sid>/bypass.log`（D735 Stage 1 已建）升为权威；
     `.claude/bypass.log` 降为**本地兼容镜像**，仅为未迁移的读者保留（Stage 2b 再切）。
  3. **删影子提交段**：其存在理由（"让树保持干净"）随停跟踪消失 ⇒ 净减一个机制。
  4. **幂等判据替换**：原靠"上一条提交 message 是登记提交"防递归 —— 本质是借影子副作用当锁；
     影子移除后同一 HASH 会被迟到/重复的 post-commit 再登记（实测 S6b +1 行）⇒ 改为
     **`_ledger_has_hash`：按 HASH 幂等**（与迟到、amend、并发无关）。
  5. **fail-closed 判据收紧面**：check-bypass-log 的"单文件存在"改为"全部来源皆空"才 exit 1
     （旧路径在新 clone/CI 不存在属正常态）。
- **代价**: 该文件不再进 git ⇒ 绕过史的 git 侧留痕由"文件内容"转为"账本 + 归档副本"；
  停跟踪前内容已归档库外 `~/Synova-过程档案/2026-10-04-D1073-bypass.log-停跟踪前归档.txt`（2023 行）。
- **证据**: `tests/control-tower/bypass-untracked.test.sh`（改坏即红：回退停跟踪 ⇒ 两分支必冲突重现 rc=1；
  停跟踪 ⇒ merge 干净 rc=0）；`post-commit.test.sh` 15/0；`clone-shadow-commit.test.sh` 13/0；
  `post-commit-marker.test.sh` 18/0；CI 密封清单 58 条全 0。
- **后续（Stage 2b，另卡）**: `pre-commit-check.sh` GATEKEEPER/7c、`gen-cto-health.py`、`ci/verify-d703.sh`
  三个读者切换到账本来源；届时 `.claude/bypass.log` 镜像可彻底下线。
