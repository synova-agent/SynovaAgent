# Claude Code 控制塔 V5.2.0 同步说明（独立 clone 模型）

> 写给：Claude Code 实现 session | 2026-08-28 | 来源：Win 侧 Codex（统筹）
> 性质：**行为契约变更 + skill 修改指引**——请按本文更新你的 skill，并从此按新工作流开工。

---

## 一、V5.2.0 核心变更（与你直接相关）

| # | 变更 | 旧行为 | 新行为 |
|---|---|---|---|
| 1 | **隔离模型：worktree → 独立 clone** | 任务在共享 worktree 开工（同一 .git） | **每个任务独立 clone**（`git clone --local <主工作区> .sessions/<sid>/repo`），.git 完全隔离 |
| 2 | **主工作区 Codex 专用** | 各 session 可在主工作区 checkout/改 | 主工作区只做 dev doc/台账/协调；**任务 session 禁止在主工作区写代码** |
| 3 | **verify-parallel 迁 CI/PR** | 本地 pre-push 跑 `--scan-today` 拦并行写集 | 本地不再强制；CI/PR 阶段由 `ci.yml` 调 `--ci-pr` 权威拦截 |
| 4 | **install-hooks 自动初始化 clone** | clone 后需手动配置 | `install-hooks.sh` 自动设 user.name/email、quotepath=false、credential（影子提交前置） |
| 5 | **铁律 47 正则收窄** | "迁移"字样误伤 | 仅"已迁移/迁移完成/完成迁移"触发——brief 描述工作不用躲词 |
| 6 | **CI 红点名组名** | 失败信息模糊 | CI 红直接 ❌ 点名组名（失败可见性） |

---

## 二、新工作流（替代 git-sync-pr 的"开工 5 步"）

### 开工（每个任务）

```bash
# 1. 独立 clone（任务隔离，秒级——本地硬链接）
git clone --local <主工作区路径> .sessions/<session-id>/repo
#   例: git clone --local /d/novis-backup-20260526/Novis/synova-agent .sessions/DXXX/repo

# 2. 初始化 hooks + 身份（自动完成 user.name/email/quotepath/credential）
cd .sessions/<session-id>/repo && bash scripts/install-hooks.sh

# 3. 基于 origin/main 建 feature 分支
git checkout -b feat/win-<任务简称>

# 4. 确认基线
git status -sb && git log --oneline -1
```

> **禁止**：在主工作区 checkout 分支、改代码、跑 synova-commit。主工作区 = Codex 专用。

### 开发中

- **本地零拉平**（.git 独立，不依赖他人中间状态）
- 提交走 feature 分支 + 本地门禁（pre-commit 13 组本地软提示、CI 权威）
- 影子提交由 post-commit hook 自动生成（随 feature 分支进 main，bypass 证据链闭合）

### 收工

```bash
git push origin feat/win-<任务简称>
# CI/PR 阶段 verify-parallel --ci-pr 做写集对账（本地不再跑）
# 合并后检查无未提交/未推送 → 删除 clone（.sessions/<sid>/）
```

---

## 三、需修改的 skill 清单

| Skill | 优先级 | 改什么 |
|---|---|---|
| **git-sync-pr** | 🔴 核心 | "开工 5 步"整体替换为"开工 clone 流程"（见 §二）；"收工 5 步"补 clone 清理；"冲突处理"适配 clone 场景（本地 merge origin/main 即可，无共享污染） |
| **brief-compose** | 🟡 建议 | 格式不变（G12/Q2 仍是硬门禁），补一条提醒：任务开工前确认自己在 `.sessions/<sid>/` clone 内（不在主工作区） |
| **claim-verifier** | 🟡 建议 | 核对逻辑不变；补"交付需声明在独立 clone 完成"（.sessions/ 痕迹），主工作区无代码改动 |
| **pr-review** | 🟢 可选 | PR 描述可加"clone 完成"声明；审查时确认写集与 dev doc 一致（verify-parallel CI 已兜底） |
| **north-star-guard / synova-audit / synova-verify / cto-handover / ctrl-tower-change / windows-compat** | 🟢 不涉及 | 逻辑与隔离模型无关，无需改 |

---

## 四、skill 修改指引（git-sync-pr 具体改法）

### 4.1 "开工 5 步" → "开工 clone 5 步"

替换为：

```bash
# 开工 clone 5 步（物理命令，逐条执行并确认 exit 0）
git clone --local <主工作区> .sessions/<session-id>/repo   # 1. 独立 clone
cd .sessions/<session-id>/repo                             # 2. 进入任务仓库
bash scripts/install-hooks.sh                              # 3. hooks + identity + credential
git checkout -b feat/win-<任务简称>                        # 4. feature 分支（基于 origin/main）
git status -sb && git log --oneline -1                     # 5. 确认基线 clean
```

关键判断：**如果当前不在 `.sessions/<sid>/` 路径下 → 未按新规开工，先 clone 再继续**（禁止在主工作区 `git checkout -b`）。

### 4.2 "收工 5 步" 适配

```bash
git push origin feat/win-<任务简称>     # CI/PR 阶段 verify-parallel --ci-pr 兜底
# 合并后：
git status -sb                          # 必须 clean
git log origin/main..HEAD --oneline     # 必须空
cd .. && rm -rf .sessions/<session-id>  # 删除 clone（每周还有自动清理兜底）
```

### 4.3 冲突处理（clone 场景）

```bash
# 本地 merge origin/main 即可（.git 独立，无共享污染）
git fetch origin && git merge origin/main
# 冲突解决后 commit → push
```

---

## 五、新旧行为对照（避免踩坑）

| 场景 | 旧（worktree） | 新（clone） |
|---|---|---|
| 开工 | 主工作区 checkout -b | `.sessions/<sid>/repo` clone + install-hooks |
| 拉平 | 任务边界 + 无数次确认/清理 | **任务边界一次**（clone 时基于 origin/main） |
| 提交 | 共享 .git，可能撞 index/对象库 | 独立 .git，本地零竞争 |
| push | 本地 verify-parallel --scan-today 可能误拦 | 本地不再强制；CI/PR --ci-pr 权威 |
| bypass | 主树补记协议 | 影子提交随 feature 分支进 main（自动） |
| 清理 | worktree 手动删 | clone 用完即删（+ 每周自动清理） |

---

## 六、验收（确认 skill 改对）

1. `grep -n "git clone --local" .claude/skills/git-sync-pr/SKILL.md` → 命中（开工流程含 clone）
2. `grep -n "\.sessions/" .claude/skills/git-sync-pr/SKILL.md` → 命中（路径规范）
3. `grep -n "worktree" .claude/skills/git-sync-pr/SKILL.md` → 除"已退役"说明外零残留
4. 下一个任务：开工时确认在 `.sessions/<sid>/repo` 内操作（不在主工作区）

---

> 本文档为行为契约：改完 skill 后，**每个任务的开工/收工按 §二 执行**。主工作区 = Codex 专用，任务 session 禁止进入。任何疑问找 Win 侧 Codex（统筹）或 CTO。
