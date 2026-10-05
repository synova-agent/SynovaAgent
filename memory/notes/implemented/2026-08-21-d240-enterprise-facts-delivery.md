# D240 企业事实治理 — 成品补交付（2026-08-21）

## 背景
D240（2026-07-27）原提交 062c73c 仅含 `.gitkeep` 占位（假交付）；实现文件曾存于本地工作树未入库，2026-08-21 从备份恢复并补齐为成品后正式交付。

## 决策记录（K3 可核）
- **存储介质**：企业事实以 `.codex/enterprise/facts/{category}/{key}.md` 文件为准（YAML front matter + Markdown），SQL agent_memory 为缓存 + 降级回退；客户数据不进 git（客户A等仅本地）。
- **双写**：`agent-memory-store.remember(type=enterprise_fact)` 同步写文件，status 默认 pending；文件写失败 → SQL 保留 + degraded 记录（不阻断主路径）。
- **状态权威**：status 以文件为准（审批/驳回改文件）；`list()` 先同步文件状态再按 status 过滤（避免 SQL stale）。
- **注入边界**：expert-file-loader 自包含读取 active 事实（不跨层 import scripts/control-tower），pending/conflicted/rejected 一律不注入专家 prompt。
- **入口**：管理员 CLI（`npx tsx scripts/control-tower/fact-approval-service.ts list|approve|reject|approve-all`）+ 冲突扫描 CLI + bootstrap cron（每日 04:00）。

## 验收
vitest tests/control-tower/enterprise-facts.test.ts 9/9 绿；tsc 28=28 零新增；as any=0；pre-commit 13 组全过；grep 接线：agent-memory-store→EnterpriseFactStore、bootstrap→ConflictScanner、loader→loadActiveEnterpriseFacts。
