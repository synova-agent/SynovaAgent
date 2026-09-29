# 决策 Note — merge-writeset-gate 内置豁免 audit-reports/** + archive/**（D964，2026-09-25）

**状态**：implemented（K3 审前；门禁语义变更 ⇒ 必过 K3，K3 前不合并）
**落点**：`scripts/control-tower/merge_writeset_gate.py` BUILTIN_EXEMPT（两条，附理由）+ 匹配逻辑从精确相等升级 fnmatch glob；
测试 `tests/control-tower/merge_writeset_gate.test.sh` ⑨（豁免绿 + 改坏即红反证）。
**为什么**：K3 报告改指针式——全文留 K3 独立仓，本仓只落 `docs/synova/audit-reports/INDEX.md` 一行一条索引。
索引由任意任务交付时追加，天然不在该任务声明写集内 → 被判夹带（改前实测复现：INDEX.md 被点名）。
判据从「报告全文在本仓」改为「INDEX.md 里有一行」（机器可判）。
`archive/**` 为文档减负归档移动统一收口（历史文档无单一属主任务）。
**替代方案否决**：PR 正文声明级豁免每 PR 手写、易漏且不可复用（阶段 2 将去掉正文豁免改用内置豁免）。
**K3 可核点**：改前夹带原始输出（INDEX.md 点名）vs 改后豁免输出（打印理由）；33 测试全绿；去掉豁免键后同场景必须红（测试 ⑨ 反证）。
