# 状态: proposed
# 日期: 2026-10-07
# 决策: gen-cto-health 迁移期显式降级（E4 六条之第 6 条，前置 #1268 已解）
# 理由: K3 R6 禁静默空白 —— task-state 缺席 ≠ 无任务；裸 return 会让健康报告"看着干净"

## 决策内容

`analyze_task_state()` 在 `TASK_STATE_DIR` 缺席时原样 `return tasks, {...}`。
D-C 迁移期新任务声明落在 `.claude/claims/`（不进 task-state）⇒ 该 return 会让健康报告
**漏掉全部新任务却显示为正常**（静默空白，铁律 11）。改法（与其余 5 条消费者同构）：

- 探测 `.claude/claims/*.yaml`（仅 `<数字>.yaml` 计数）；
- 显式暴露 `migration_period` / `migration_claims` / `migration_note` 三字段 + `degraded`；
- **stderr 打显式迁移期行**（可见，不静默）；
- 目录不可读 → stderr 显式 degraded（铁律 24/31），**不静默当 0**。

## 代价与已知边界

- 迁移期健康报告**仍未派生** claim 任务的 spec/impl/audit —— 只是**不再静默**。
  「可见地缺」优于「静默地绿」；真正派生留待 status 语义迁到 issue 号之后。
- 该脚本用 `git log --all` 派生历史计数 ⇒ 分支集合变化会改产物内容（line-d-own 已提示）；
  夹具因此**直调分析函数 + 注入 REPO/TASK_STATE_DIR**，不依赖真实产物。

## 关联

卡 #1267（E4）／#1224；前置 #1268（配对测试存量红，line-d-own 已修，PR #1274 已合）。
夹具：`tests/control-tower/gen-cto-health-migration.test.sh`（12 项，含反假标记 + 改坏即红）
