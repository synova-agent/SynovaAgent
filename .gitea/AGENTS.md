# AGENTS.md · .gitea/（CI 权威域）

> 归属：**治理线** ｜ 承载包：（治理域，无块）（与根件 §0 表逐字一致）｜ as_of `55ead6dec`（PR2/4）｜ 🔴 本件自 `.github/AGENTS.md`（pr948 草稿）**迁移改订**——`.github/**` 实测当前不点火（2026-10-02），CI 权威在本地 Gitea（裁定 079-④）

## 是什么
Gitea 唯一权威合并门＝`core-gates / core (pull_request_target)`（`.gitea/workflows/core-gates.yml` 的 `core` job）。本地 pre-commit 只是软提示，不进 required context、不是合并阻断腿；旧 `.gitea/workflows/local-gates.yml` 仅 `workflow_dispatch`，不自动触发、不阻断、非必需 context。GitHub 侧检查与 ruleset 不是 Gitea 合并权威，本任务不改其配置。

## 谁改
治理线。改门禁语义时，独立审计仅由创始人／CTO／任务明确要求触发；禁止自审，**禁与业务改动同 PR**。

## 怎么算完成
- workflow 改动：本地复现器跑通（三态退出码）＋"改坏确实红"原始输出；合并有效性只看上述核心门。
- 每个 workflow 显式 `permissions:` 最小集。

## 红线
- 门禁判别力自检：信号量==0 ⇒ exit 2（禁把"看不见"当"没问题"）。
- PR 必引 Issue（先软后硬）。
- 与根件零重复；`.github/` 不再新增守则（防双真源）。

## 🔗 改本域涉及的包（双向清单 · 2026-10-18）

P4（主）｜P10｜P2👁｜P7👁

> 口径：与 `handbook 包/交叉矩阵-12守则×10包.md` 一致；`👁`=只读不改
