 # Loop Engineering �?SynovaAgent
 
 > 我们跑了哪些自动化循环？每个循环做什么、多频繁、谁触发、产出什么�?
> V5.2.7 | 2026-09-15 | 版本轴同步自 CLAUDE.md/AGENTS.md（check-doc-truth.sh C3：三文档版本一致）
 > 最后更�? 2026-07-05
 
 ---
 
 ## 活跃循环
 
 | 循环 | 频率 | 触发方式 | 产出 | 状�?|
 |------|------|---------|------|------|
 | **Task Start** | 每次新任�?| 手动 `bash scripts/workflow/task-start.sh` | `.claude/task-briefs/` + `STATE.md` 状态更�?| active |
 | **Verify Incremental** | 每次代码保存 | PostToolUse hook 自动 | L1 oxlint �?L2 tsc �?L3 vitest �?L4 接线审计, 最�?5 �?| active |
 | **Pre-Commit Gate** | 每次 `git commit` | `.git/hooks/pre-commit` | 12 组硬阻断（本地软提示/CI 权威；类型安全/测试/Secrets/接线/架构/Task Brief/架构合规/文件驱动) | active |
 | **Pre-Push Gate** | 每次 `git push` | `.git/hooks/pre-push` | tsc + vitest 全量 + secrets 终扫 | active |
 | **Commit Message** | 每次 `git commit` | `.git/hooks/commit-msg` | Conventional Commits 格式强制 | active |
 | **Post-Commit** | 每次 `git commit` | `.git/hooks/post-commit` | 决策流程建议 (decide-next.sh) | active |
 | **Post-Deploy Verify** | 每次部署 | 手动 `bash scripts/workflow/checkpoint-deploy.sh` | curl 外部 URL + 核心端点 + 进程重启验证 | active |
 | **Runtime Monitor** | �?30 分钟 | Cron `checkpoint-runtime.sh` | 错误�?/ 降级状�?/ 内存磁盘 / 调度任务 | active |
 
 ## 设计决策
 
 - **不跑 CI Sweeper** �?CI 失败频率�?(<1�?�?，人工修比维�?Agent 自动修脚本更经济
 - **不跑 PR Babysitter** �?单人项目，无 PR review 流程
 - **不跑 Dependency Sweeper** �?`npm audit` 纳入 pre-push，人工决策大版本升级
 - **不跑 Issue Triage** �?无公开 Issue 队列
 - **不跑 Changelog Drafter** �?手动维护 `CHANGELOG.md` �?`LOOP-ENGINEERING-CHANGELOG.md`
 - **Post-Merge Cleanup** �?由铁�?26/37 (删除旧文�? + pre-commit �?5 �?(架构边界 + 桥接文件) 覆盖，见 `scripts/workflow/verify-incremental.sh` L4
 
 ## Loop 基础设施
 
 | 文件 | 用�?| 状�?|
 |------|------|------|
 | `LOOP.md` | 本文�?�?循环描述 | active |
 | `STATE.md` | 免疫警告 + 错误模式追踪 + 活跃任务 | active |
 | `AGENTS.md` | Agent 指令 (Loop Engineering V5.2.7 设计) | active |
 | `MEMORY.md` | 历史教训持久�?| active |
 | `scripts/pre-commit-check.sh` | 12 组硬阻断门禁 | active |
 | `scripts/workflow/verify-incremental.sh` | 四层增量验证 | active |
 | `scripts/workflow/task-start.sh` | 任务启动 3 �?| active |
 | `.claude/loop-state.json` | 循环轮次计数 (临时, verify-incremental 管理) | active |
 | `loop-budget.md` | Token 预算 (暂无 �?五轮硬上限已覆盖) | deferred |
 | `loop-run-log.md` | 每次循环执行日志 | **新增 2026-07-05** |
 | `scripts/workflow/loop-sync.sh` | STATE.md �?LOOP.md 漂移检�?| **新增 2026-07-05** |
 | `scripts/workflow/loop-context.sh` | 长运行熔断器 | **新增 2026-07-05** |
| `scripts/workflow/check-brief-vs-code.sh` | Brief vs Code һ����������֤ (Q2 �ļ���Χ / ���� / verify) | **���� 2026-07-05** |
 | `scripts/workflow/post-merge-cleanup.sh` | Post-Merge Cleanup | **新增 2026-07-05** |
 | `scripts/workflow/loop-score.sh` | Loop Ready Score 自评 | **新增 2026-07-05** |
 
 ## 版本
 
 **Loop Engineering V5.2.7** — 47 条铁律 + 12 组 pre-commit + 四层增量验证 + 免疫警告系统 + Plan-aware 门禁 + grep 物理门禁 + 侧翼修复自动化。
 详见 [AGENTS.md](./AGENTS.md) Loop Engineering 章节�?
