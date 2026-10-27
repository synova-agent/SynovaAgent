# #1089 / W1：门禁三分类登记（GATE-INVENTORY 纯追加 classification）

- **状态**: proposed（待 L1 收件闸 ＋ K3 抽检后转 implemented）
- **日期**: 2026-10-28
- **批次**: 门禁治理 v2.0 · W1 ｜分支 `feat/1089-gate-inventory`（base `0569f2d4b`）
- **依据**: Issue #1089 ｜ 创始人规格 v2.0 §3 W1 / §4 G1 / §5 M-9（sha256/16 `e13b4ecc2e5929a3`，未入库件）

## 一、现状（做之前是什么样）

`docs/authority/GATE-INVENTORY.yaml` 有 952 行（锚 `6e5f321`，checkers 32），但
**class/owner/review_after/entrypoint/required_ci 五字段零存在**；盘上 `check/verify` 件已长到 **36**（+4 未入册），
在册的 `check-citations.py` 已不在盘上（幽灵行）。⇒ 门禁既**不可退役**（无分类、无复核期），也**不可对账**（册与盘两张皮）。

## 二、决定（做了什么）

1. **纯追加** `classification:` 段（37 条），不改上方任何登记行 —— 绕开"append-only 中枢被改写"的争点（规格 D3）。
   每条：`id / class(P0|P1|P2) / owner / review_after / entrypoint / required_ci / confirmed_by`。
2. 新增 `scripts/control-tower/check-gate-inventory.sh`：三态校验器，**双向对齐**（盘上件必须入册；在册件必须在盘）＋
   `required_ci` 账实一致（true ⇔ CI/pre-commit/pre-push 真引用）＋ **P0 计数棘轮**（默认下限 8）。
3. 分类口径 = 创始人规格 §2：P0 安全/守卫/强制力 8 件；P1 质量/强制力 17 件；P2 文书/账目 12 件。
   `owner` 默认 P4、`confirmed_by: pending-cto` —— **不编造归属**（域专属件以 CTO 确认为准）。

## 三、依据（为什么这样）

- **append-only 是硬约束**：`check-merge-conditions.sh` 把 GATE-INVENTORY 列为共享追加中枢，改写判硬重叠 ⇒ 全行加字段会锁死他人的 PR。
- **"双向对齐"才是防漂移**：只查"每件有分类"会漏掉盘上新增件；只查"在册件存在"会漏幽灵行。
- **`required_ci` 账实一致**：声明"在强制腿上"却零引用 = 自欺；声明"不在"却被引用 = 账实不符。两者都红。
- **P0 棘轮只保计数**（已知限制 2 明写）：id 级降级追踪需 history，本批不做；故只保证 P0 面不整体缩水。

## 四、生效时点

PR 合入 `local-main` 后生效。校验器尚未接 CI 腿（WIRING 登记 declared-only），故当前只在地面手跑/CI 外可用 —— **不算"已接线"**。
