---
状态: implemented
日期: 2026-11-16
决策: 从暂存区 diff 自动生成 claim 骨架，保留既有 check/resolve 语义与三态退出码。
理由: 写集声明继续承担认领与范围对账，机械 writeset 由 Git 真源生成，避免纯文档任务手写遗漏。
---

# claim scaffold 自动生成（#1402）

- **现状**：claim 的 writeset 需要手工枚举，容易漏掉 claim 自身或配套镜像，完成后才被范围门禁退回。
- **决定**：新增 `--scaffold <issue>`，以 `git diff --cached --name-only -z` 为唯一写集来源，自动补入 `.claude/claims/<issue>.yaml`；已有文件默认 exit 1 拒绝覆盖，仅显式 `--force` 重建。骨架 done 包含自身 `--check` 与待按任务替换的标准检查。
- **依据**：Issue #1402 的 CTO 裁定；暂存区是提交前写集真源，复用现有 YAML 子集解析和 ClaimError 三态映射，不另建格式或依赖。
- **生效时点**：本 Note 随 #1402 实现提交后生效。
- **证据**：`claim-scaffold.test.sh` 21/21（含去 verify 前缀必红）；`claim_store.test.sh` 46/46；完整 pre-commit 全部 11 组通过；技能同步与文档登记门禁通过。
- **边界**：不改 `--check/--resolve` 既有分支，不改门禁组数与预算，不写产品代码，不自行合并 PR。
