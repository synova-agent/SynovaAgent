# 2026-10-25 · #976 DOCS-REGISTRY 存活判据（`status: active` 的 path 必须存在）

## 现状（实测，锚 `local-main = 27e3433f1`）

1. **台账可长期指向不存在的文件**：`docs/authority/DOCS-REGISTRY.yaml` 138 条 entry 里
   **33 条 path 在树内不存在**，其中 **24 条 `status: active`**
   （如 `DOC-0121` 的 `docs/synova/coordination/CTO-派单规程.md`、`DOC-0190` 的
   `2-2-参数清单-v1-20261008.md`、`DOC-0259/0260` 两件 dispatch —— 文件均已不在树内）。
2. **门禁只查"新增是否登记"，不查"已登记的还在不在"**：`doc-registry-gate.sh` 的两个判据是
   ①未登记（新增面）②DOC id 重号（#942）。⇒ 删除/搬走一份文档时，台账这侧**零信号**。
3. 判别力现状：把 `status: active` 的一行 path 指向任意不存在的文件，改造前门禁 **rc=0**。

## 决定

- 在 `scripts/doc-system/doc-registry-gate.sh` 增第三条判据（**不新增门禁组号**）：
  `status: active` ∧ `path` 不在树内 ⇒ 逐条 `❌ 存活失配: DOC-<n> path 不存在: <path>` ＋
  汇总行 `── 存活: N 条 status=active，path 失配 M 个 ──` ＋ **exit 1**。
- 两个绕过面一并堵住：①`active` 但**无 path 字段** ⇒ 同红（否则删 path 行即绕过）；
  ②`path` 带通配（`WORKLOG-*.md`）⇒ 按**字面**判，通配不是"存在的文件"。
- **fail-closed**：台账里一条 `status` 字段都解析不到 ⇒ **exit 2**（「不可见」逐字打印），
  与 #942 F1「0 条 DOC id ⇒ exit 2」同口径。
- 存量处理：**只把 24 条 status 降 `archived`**，不删条目、不改 DOC id、不改 note（可追溯），
  再开门禁 —— 否则新判据一落地即恒红，等于门禁不可用。

## 依据

Issue #976（K3 #974 D2 实测）｜裁 399（CTO 开工令：本件第 1 件，轻量档）。

## 判据两态（原始输出留档于 PR 正文）

- 真红态：改造后跑**未降级的存量** ⇒ 24 条 `存活失配`、`exit 1`。
- 真绿态：存量降 archived 后跑真实仓 ⇒ `── 存活: 95 条 status=active，path 失配 0 个 ──`、`exit 0`。
- 改坏必红（真实数据）：把已归档的 `DOC-0121` 单独翻回 `active` ⇒ `exit 1` 且点名该条；还原 ⇒ `exit 0`。
- 判别力自证：变异实现（`st == "active"` ⇒ `st == "NEVER-MATCH"`）跑红态夹具 ⇒ `exit 0`
  ⇒ 证明红确实来自该判据本身（`K8`）。

## 生效时点

本 PR 合入 `local-main` 起：此后任何 `active` 条目的 path 被删除/搬迁而未同步降级 ⇒ 门禁硬红。
回滚＝`git revert`（判据回退为"不查存活"；24 条 archived 一并回退）。

## 已知限制

- `path` 判据是**工作树字面存在性**（`[ -e ]`），不区分"被删"与"改名"；判定是二值（存在/不存在）。
- 台账**整体缺失**时仍是既有降级语义（`⚠️ 跳过 exit 0`）：那是"台账未建立"，不是本判据范围。
- 只覆盖 `DOCS-REGISTRY.yaml`；其它注册表（`GATE-INVENTORY`／`WIRING-REGISTRY`）的路径/数量对账
  各由自己的判据承担，本件不扩面。
