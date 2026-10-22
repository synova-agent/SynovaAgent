# D537 控制塔并行污染 + 提交链摩擦根治 — 决策与教训

> 状态: implemented | 日期: 2026-08-26 | 任务: D537 | 决策: 并行污染检测前移 pre-commit + fastlane 扩展 + D521-2 恢复 + baseline 归因 | 理由: M8 变体第四次复发（D394→D481/482→D486）+ 每次合并 5-8 分钟门禁摩擦

## 决策记录

1. **#2 主树占用检测前移（活跃判定用 last_seen_at，非 pid）**：并行污染只拦"新开工"（task-start）不拦"存量"（已在主树工作的 session 直接提交）→ M8 第四次复发。检测前移到 pre-commit（物理门禁、每次提交强制）。关键设计：活跃 session 判定用 `last_seen_at` 在窗口内（synova-commit 每次 register 刷新），**不是 pid**——synova-commit 注册不带 `--pid`，主树 registry 实测 14 个 `pid=None` 僵尸 session；若按 `list --active` 计数会灾难性误拦所有主树提交。
2. **#3 fastlane 扩展三条快速通道**：纯 bypass.log（原 D515）+ merge commit（MERGE_HEAD，同 D328/D513 豁免）+ 纯补记组合（bypass.log + docs/task-state/memory 白名单）。证据白名单 = CT-34 doc 白名单 + `.claude/*.log`，**不含 `.synova/skills/`**（行为配置，防借道）。
3. **#4 D521-2 hook 层登记恢复**：D530（734ab32e CT-45 merge 豁免）重写 post-commit.sh 时覆盖丢失 D521-2 的 "bypass COMMITTED 登记" 段 → bypass-precommit.test.sh 红态（登记段缺失/HASH 未登记/仍脏/影子提交缺失）+ D451 补记循环。恢复该段（COMMITTED 成对登记 + 影子提交防递归）。
4. **#5 baseline 漂移归因（改动集归因）**：merge main 引入 mac 提交后 tsc 基线变化，人工确认"main 现状 vs 本分支引入"成本高。扩展 baseline-check.sh：新增"错误"按文件归属本分支改动集（vs origin/main）→ 本分支引入才拦，main 既有漂移自动归因不拦；归因不可用 → fail-closed 拦全部。

## 执行中的教训（滚动记录）

- **改共享脚本必须保留既有段（D530 覆盖 D521-2 的教训）**：post-commit.sh 是"所有 session 共用一份，修改即同步"的高危共享文件。D530 加 CT-45 merge 豁免时整段重写，丢失 D521-2 的 COMMITTED 登记段，而 synova-commit 的注释仍声称"由 post-commit hook 层统一完成"——文档-实现漂移（M7）静默存在，直到 bypass-precommit.test.sh 红态才暴露。教训：改共享 hook 脚本，先 `git log -p` 看全历史段落，逐段核对是否保留。
- **"活跃 session"的语义必须可靠（M8 误拦风险）**：registry 的 `list --active` 返回全部非 archived session（含 pid=None 僵尸）。硬拦前必须过滤"近期活跃"，否则僵尸 session 会让门禁灾难性误拦（主树 14 个僵尸，`>1` 硬拦 = 全线封锁）。
- **baseline-check.sh 的 `grep -oP` 是 Mac 杀手**：BSD grep 无 `-P`，baseline-check.sh 在 Mac 上全量失败（extract 函数 + 主流程计数）。修 9 处 `grep -oP` → `grep -oE`（`\d`→`[0-9]`、`\S`→`[^[:space:]]`）——windows-compat 模式库同型。
- **测试里跑全量 pre-commit 要认清 worktree 语义**：在链接 worktree（.wt-D537）里跑 pre-commit-check.sh，#2 的 worktree 放行分支会正确跳过主树占用检测。测"主树拦"不能在工作树里跑全量，只能隔离验证判定逻辑 + grep 接线。
