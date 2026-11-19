---
状态: proposed
日期: 2026-11-19
决策: R1/R2 文档编号形态与 commit 首行 Conventional Commits 格式从硬阻断降为提示；未登记、DOC id 重号、active path 失配、认领一致性仍为硬判据。
理由: 纯措辞形态问题不产生真相价值，却造成提交/登记摩擦；CTO 2026-11-19 裁定只降噪，不新增门禁、不改 CI 接线。
---

# 门禁纯格式降噪（#1436）

- **现状**：`doc-registry-gate.sh` 的 R1/R2（新 DOC id 形态、Issue 来源）与 `commit-msg-check.sh` 首行格式原本直接 exit 1；前者只在本地 pre-commit 链，后者在 commit-msg hook。
- **决定**：R1/R2 与首行格式改为**可见报告/警告，不参与退出码**；`commit-msg-check.sh` 提示后继续执行认领一致性与 Note 引用检查，不整份跳过。
- **保留**：未登记文档、DOC id 重号、status=active 的 path 失配仍 exit 1；fail-closed 的 exit 2（解析不到 DOC id / status 字段）不变；R1/R2 存量冻结口径不变。
- **依据**：CTO 2026-11-19 裁定；配对测试覆盖非常规首行可继续、真实认领冲突仍 exit 1、重号/存活失配仍红；真实 git commit 入口前后对照。
- **生效时点**：PR 合并后生效。
- **边界**：不改 core-gates、core-tests、required context、hooks 安装方式、文档入库白名单；不改 `scripts/audit/**`；不新增说明报告。
