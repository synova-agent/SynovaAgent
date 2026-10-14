# AGENTS.md · .gitea/（CI 权威域）

> 归属：**治理线** ｜ 承载包：（治理域，无块）（与根件 §0 表逐字一致）｜ as_of `55ead6dec`（PR2/4）｜ 🔴 本件自 `.github/AGENTS.md`（pr948 草稿）**迁移改订**——`.github/**` 实测当前不点火（2026-10-02），CI 权威在本地 Gitea（裁定 079-④）

## 是什么
CI 权威面：`.gitea/workflows/local-gates.yml`（**`SYNO_CI=1` 时转硬阻断**）。GitHub 侧 `.github/workflows/` 6 件存续但非权威——改门禁**只认本目录**。

## 谁改
治理线。改门禁语义＝K3 红线相邻动作，须独立送审（K3 审计请求件流程），**禁与业务改动同 PR**。

## 怎么算完成
- workflow 改动：本地 `SYNO_CI=1` 复现器跑通（三态退出码）＋"改坏确实红"原始输出。
- 每个 workflow 显式 `permissions:` 最小集。

## 红线
- 门禁判别力自检：信号量==0 ⇒ exit 2（禁把"看不见"当"没问题"）。
- PR 必引 Issue（先软后硬）。
- 与根件零重复；`.github/` 不再新增守则（防双真源）。
