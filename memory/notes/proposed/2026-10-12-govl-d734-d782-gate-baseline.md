# 状态: proposed
# 日期: 2026-10-12
# 决策: D734/D782 门禁基线与扫描范围口径 —— 基线链 gitea/local-main → local-main 前置；D782 untracked 源降为仅警告
# 理由: CTO 2026-10-12 P0 裁定。origin/local-main 是 GitHub 侧陈旧引用（停于 28ae513dc，落后 gitea 侧 111 提交），取它作 PR 预算基线 ⇒ 任何 PR 恒红（实测 2 件 PR 报 108 件）；D782 全仓 untracked 扫描无法区分"本 PR 的"与"别人/历史的"（实例：a4cc8fd5f 已提交件被索登记）。修门禁不绕门禁：两处均改判定口径，配对测试全绿 + 改坏即红夹具（H7b/H7c/H8 + SYNO_PR_BUDGET_BASE 陈旧基线红例）随卡交付。代价：untracked 新文档本地不再被硬拦（staged-new 与 base..HEAD 仍硬拦）。
