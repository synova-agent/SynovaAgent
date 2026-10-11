---
状态: proposed
日期: 2026-10-12
决策: D537 #2 主树判据收窄——旧「主树脏 + 活跃 session > 1」判据删除（A9 死条款），改为固定路径判据: 拦 = 在主树（pwd -P toplevel == SYNO_MAIN_TREE，默认 $HOME/SynovaAgent）提交；放行 = 非主树 或 SYNO_ALLOW_MAIN_TREE=1（强制留痕 degraded-events.log + bypass 台账）
理由: 旧判据拦"主树脏"拦不住"主树被 checkout"（不动工作区文件 ⇒ M/A=0 ⇒ 误判干净）；且活跃窗口判据实测为死条款（registry 全僵尸 0 活跃）＝给人"已有检测"错觉。判据落独立脚本 main-tree-guard.sh（三态 0/1/2），生效层双堵（pre-commit-check.sh + install-hooks.sh 钩子模板，A8 选 c）；SYNO_CI=1 显式跳过（主树判据为本地层门禁）
---

# Note: 主树提交禁止门禁收窄（D537r2）

## 触发场景

创始人 2026-10-12 令「禁止任何 session 在主树工作」。三次实证（P1 清单 / CT-65 / D537 #2 复发）
表明现有门禁存在但拦不住。

## 实测证据

- `git reflog` 24h 内主树被 checkout ≥10 次，均不产生 M/A ⇒ 旧判据放行
- session-registry 11 session、0 个 1800s 内活跃 ⇒ 旧判据实际不触发（死条款）
- `.git/hooks/pre-commit` 恒 exit 0（软提示）⇒ 裸 git commit 结构性拦不住（A8）

## 决策

判据由 CTO 裁定（派单 §三bis，照抄不许自改）:
- 拦 = 主树提交（pwd -P 比较固定路径，非 toplevel 自比较——治型 B 零判别力）
- 放行 = 非主树（worktree/独立克隆）｜ SYNO_ALLOW_MAIN_TREE=1（必须双留痕）
- 三态 exit 0/1/2（2 = 检查自身失败，同样阻断，fail-closed）
- 生效层: pre-commit-check.sh（synova-commit 路径）+ install-hooks.sh 钩子模板（裸 git commit 路径）双堵
