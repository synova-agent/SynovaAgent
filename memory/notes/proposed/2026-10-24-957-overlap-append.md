# #957 效率 1/4：登记表纯追加白名单（裁 376）

## 改了什么
`check-merge-conditions.sh` ② 重叠判定：
- 共享追加白名单：`DOCS-REGISTRY.yaml` → 再加 `WIRING-REGISTRY.yaml`、`GATE-INVENTORY.yaml`；
- **两态**：两 PR 对该文件**都是纯追加**（additions>0 且 deletions==0）⇒ 共享追加（不计硬重叠）；
  任一侧含删除/改写 ⇒ **仍判硬重叠**。
- 新增测试 case K（一侧删一行 ⇒ `②=no`）；套件 14 判定点，`--selfcheck` 仍 13/13。

## 为什么
4 个在飞 PR 全部因"登记表追加"互相锁死（实测 #955 从 ②=no → ②=ok(shared:1)）。

## 已知限制
1. 只覆盖"文件级纯追加"，不判"两 PR 追加到完全同一位置"的语义冲突（由串行 ④ 兜）；
2. 二进制/重命名仍按原口径判硬重叠。
