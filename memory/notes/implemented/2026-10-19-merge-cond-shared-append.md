---
状态: implemented
日期: 2026-10-19
决策: 四条件 ②「零写集重叠」对**共享追加文件**（`docs/authority/DOCS-REGISTRY.yaml`）不判硬重叠，改由 ④ 的 S2（队列头）＋合并前 rebase 保证**一次只合一个**（创始人 2026-10-19 裁 A）。
理由: 登记表是追加型中枢 —— 任何需 D2 登记的新文档 PR 都会碰它 ⇒ 严格 ② 下**在飞期间所有持有方互相锁死**。实测同一晚 8 个 PR（#632/#631/#630/#629/#628/#622/#619/#416）同时持有该文件，其中 #622/#628 已 `mergeable=True` 仍无法合并；#416 更是 6 天前、落后 205 提交、`mergeable=False` 的死 PR。硬重叠的本意是防两个 PR 改同一份代码/契约；登记表是追加型，用串行即可保证安全。
---

# #627 四条件 ②：共享追加白名单

## 改了什么

- `check-merge-conditions.sh` `cond2_overlap`：新增 `SHARED_APPEND_PATHS` ＋ `is_shared_append()`；
  白名单文件的重叠**不计 ②**（逐条打印「② 共享追加（不计重叠，须串行合）」），非白名单照旧 fail。
- selfcheck 新增子例 **J**（PR#100 与 #101 同改 registry ⇒ 仍 `CAN-自合并`）⇒ **13/13**。
- 配对测试同步 13 判定点。

## 判据（实跑）

- `--selfcheck` ⇒ `SELFCHECK-OK: 13/13`（exit 0）
- 配对测试 ⇒ `结果: 12 通过, 0 失败`（exit 0）
- **改坏必红**：把 `is_shared_append` 改成恒 `return 1` ⇒ `SELFCHECK-FAIL: J`（`NO: ② 零写集重叠`）
- 豁免：并入已登记的 `gate-exemptions/2026-10-20-gate-exempt-217.md`（不产生新文档 ⇒ 不动 registry，避免自锁）

## 边界

白名单只装**追加型中枢**；代码/契约/守则**不白名单**。新增白名单条目必须走 CTO 裁定（本条＝创始人 2026-10-19 裁 A）。
