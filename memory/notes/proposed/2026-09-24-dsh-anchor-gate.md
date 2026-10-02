# DSH 断面唯一源 + 一致性门禁 + 已作废口径表

- 状态：proposed ｜ 提出：2026-09-24 ｜ 提出人：synova-cto ｜ 卡：D943

## 决策

1. **`docs/synova/coordination/DSH-断面.json` 是 DSH 断面的唯一事实源**（version / head / tag / 绝对路径 / 记录时间 + superseded 列表 + known_versions + policy）。
2. **新增门禁 `scripts/control-tower/check-dsh-anchor.py`**，三态语义：
   - `OK(0)`：事实源可读且 `git rev-parse --short HEAD` 与事实源一致，且被扫描文档无违规；
   - `VIOLATION(1)`：文档出现"未登记版本串"或**把 superseded 的 (version, head) 当现状引用**（点名 file:line）；
   - `DEGRADED(2)`：事实源不可读/非法，或**真实树 HEAD ≠ 事实源**（树已移动 ⇒ 所有绑旧 HEAD 的结论自动降级『待复核』）。**fail-closed，绝不等同通过**。
3. **`docs/synova/coordination/已作废口径表.md`**：只增不删；每条含"作废日期 + 依据 + 替代口径"。**派单件/卡必须引用本表；在交付物中把作废口径当现状引用 → K3 判 FAIL。**
4. **引用格式强制**：凡写 DSH 断面，必须 `版本 @ HEAD`（并写绝对路径）。

## 为什么（今天的三起同根事故）

| 事故 | 形态 |
|---|---|
| 预设修复写在 `~/.dsh/.agent-presets/`（rc.1 只读 bundle 声明行） | 做了，但接在**没人读的层** |
| D919 引用门禁从未被 pre-commit/CI 调用 | 做了，但**没接线** |
| pre-commit 组 7a 非法 ERE 致检查恒过（31 天） | 接了，但**判据坏了** |

共同根因：**"机制在场性"无人强制**。此外本轮还发现锚点漂移（`00102833` → `46a7f68b`）导致 `Win侧同步包:94/:109` 的"唯一判据"会**误判两侧同步状态**——本 Note 所属的提交已一并修正。

## 自证（提交时实测）

```
python3 scripts/control-tower/check-dsh-anchor.py --repo .
  正常 → DSH-ANCHOR: OK [0.1.7-rc.1 @ 46a7f68b ｜ 扫描 210 份]  exit=0
  事实源 head 改成 deadbeef → DEGRADED（树已移动）              exit=2
  文档写 0.1.7-alpha.2 @ 00102833 → VIOLATION(1) 点名 file:line  exit=1
```

## 待办（后续卡）

- 接进 CI/pre-commit（按 M9 三件套：模式自检＋判别夹具＋CI 清单登记）
- 把"机制在场性三问"（消费者是谁／在哪一层／哪条命令证明它在跑）写进派单模板必填字段
- D919 接线（`pre-dispatch` 在 pre-commit/pre-push/settings.json 命中 0/0/0）
