---
name: git-sync-pr
description: 多机协作 git 同步与 PR 流程（D334 定；V5.2.0 起为独立 clone 隔离模型）。任何涉及 git commit/push/分支操作、或接到任务准备开工时使用。开工 = .sessions/ 独立 clone；主工作区 Codex 专用，任务 session 禁入。规范全文: docs/synova/coordination/MULTI-MACHINE-PR-WORKFLOW.md
---

# git-sync-pr — 多机 PR 工作流（V5.2.0 独立 clone 模型）

## 隔离模型（2026-08-28 起，替代 worktree）

- **每个任务独立 clone**：`git clone --local`（秒级硬链接），.git/index/HEAD 完全隔离，本地零竞争。
- **主工作区 = Codex 专用**（dev doc/台账/协调唯一写者）。任务 session 禁止在主工作区 checkout 分支、改代码、跑 synova-commit。
- **worktree 任务隔离已退役**——不要再建 `.claude/worktrees/` 任务工作区，存量 worktree 仅作历史参照。
- **verify-parallel 写集对账已移 CI/PR**：本地 pre-push 不再跑 `--scan-today`；CI/PR 阶段 `--ci-pr` 权威拦截。
- **bypass 证据链**：影子提交由 post-commit hook 自动生成，随 feature 分支进 main（不再走主树手工补记协议）。

## 开工 clone 5 步（物理命令，逐条执行并确认 exit 0）

```bash
# 0. 关键判断：当前路径含 .sessions/ → 已在专属 clone，直接跳第 4 步。
#    不含 → 未按新规开工。在主工作区的【父目录】执行以下命令（禁止在主工作区内部操作）：
git clone --local <主工作区路径> .sessions/<session-id>/repo   # 1. 独立 clone
#    Win 例: cd /d/novis-backup-20260526/Novis && git clone --local synova-agent .sessions/<任务号>/repo
cd .sessions/<session-id>/repo                                 # 2. 进入任务仓库
git remote set-url origin git@github.com:tangbaobao520/SynovaAgent.git  # 2b. ★必做：local clone 的 origin 指向本地路径，不修正 = push 打进主工作区
bash scripts/install-hooks.sh                                  # 3. hooks + user.name/email + quotepath + credential（自动、幂等）
git fetch origin && git checkout -b feat/<mac|win>-<任务简称> origin/main  # 4. feature 分支（基于 GitHub 最新 main）
git status -sb && git log --oneline -1                         # 5. 确认基线 clean
```

关键判断：**当前不在 `.sessions/<session-id>/repo` 路径下 → 未按新规开工，先 clone 再继续**。禁止在主工作区 `git checkout -b`。

## 收工 5 步

```bash
synova-commit --task-id <Dxxx> --agent <claude|codex|dsh> --message "feat(Dxxx): 任务描述" --files <改动文件...>
git push origin feat/<mac|win>-<任务简称>    # 本地不再跑 verify-parallel；写集对账由 CI/PR --ci-pr 权威兜底
# 完成后给创始人 PR 链接:
# https://github.com/tangbaobao520/SynovaAgent/compare/main...<分支名>
```

创始人点 Merge 后：

```bash
git fetch origin && git status -sb            # 必须 clean
git log origin/main..HEAD --oneline           # 必须空
cd .. && rm -rf .sessions/<session-id>        # 删除 clone（另有每周自动清理兜底）
```

## 冲突处理（clone 场景）

```bash
# .git 独立，无共享污染：本地 merge origin/main 即可，不依赖他人中间状态
git fetch origin && git merge origin/main
# 解冲突 → git add → git commit → 重新 push
```

## 硬规则（违反 = 事故）

1. 禁止 `git stash`（铁律 0-3）
2. 禁止 push 到 main（合并只走 PR）
3. 禁止 force push 到任何共享分支
4. 禁止在主工作区 checkout/改代码/commit/push——主工作区 = Codex 专用
5. 任务开工必须在 `.sessions/<sid>/repo` clone 内；不在 → 回"开工 clone 5 步"
6. 禁止两台机器共用同一分支并行工作（每任务独立 clone + 独立分支）
7. local clone 后 push 前必须 `git remote set-url origin` 指回 GitHub（否则 push 打进主工作区）

## 新旧对照（避免踩坑）

| 场景 | 旧（worktree，已退役） | 新（clone） |
|---|---|---|
| 开工 | 主工作区 `checkout -b` | `.sessions/<sid>/repo` clone + install-hooks |
| 拉平 | 任务边界 + 无数次确认/清理 | **任务边界一次**（clone 时基于 origin/main） |
| 提交 | 共享 .git，可能撞 index/对象库 | 独立 .git，本地零竞争 |
| push | 本地 verify-parallel `--scan-today` 可能误拦 | 本地不再强制；CI/PR `--ci-pr` 权威 |
| bypass | 主树补记协议 | 影子提交随 feature 分支进 main（自动） |
| 清理 | worktree 手动删 | clone 用完即删（+ 每周自动清理） |

## 历史事故

2026-08-11~13: Mac/Win 双机在 feat/prompt-architecture 上交替 push，Mac 4 天未 fetch，
tracking ref 过期导致 git status 误报 ahead，真实落后 11 commit。教训：git status 的
ahead/behind 是相对**本机缓存的远端引用**，不是远端真身——判断同步状态前必须先 fetch。

worktree 时代的共享 .git 中间态事故（D320 暂存区劫持、并行 stash 冲突、tracking ref
过期误报）由独立 clone 根治；但禁 stash / 禁 force push / PR-only / 单分支单任务仍然
全部有效，不因模型切换而豁免。
