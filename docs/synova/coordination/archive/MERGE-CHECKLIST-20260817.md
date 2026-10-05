# 创始人合并清单（2026-08-17 终版）

> 给创始人：你只需要做一件事——去 GitHub 把下面这些分支按顺序合并进 main。
> 每个分支都有 PR 链接 + 测试全绿。合并 = 点几下按钮，不用懂代码。
> 合并完，最后让 K3 做一次独立审计兜底。

---

## 一句话现状

- **线① 控制塔门禁**：U1-U7 全部施工完成（物理门禁 + 降误伤 + 文档豁免）。
- **线② 创始人零信任控制台**：测谎 MVP + 三问面板全部完成（任务真相 / 诚信账本 / 北星对齐 / CI / 主动告警）。
- **还剩**：U8（审计三层模型，需你 + K3 拍板）→ 你合并 → K3 终审。

---

## 合并顺序（建议照抄）

### 第 1 步：设计文档（先看，理解全局）

| 分支 | 内容 |
|---|---|
| `docs/founder-control-system-20260817` | 3 份设计文档（评估 + 控制塔 spec + 控制台设计） |

### 第 2 步：控制塔门禁（线①，按序）

| 顺序 | 分支 | 改了什么 |
|---|---|---|
| 1 | `feat/u3-artifact-reproducibility` | U3：仪表盘假数据根治（产物必须真进 git） |
| 2 | `feat/u7-ct-test-gate` | U7：控制塔脚本必须有配对测试 |
| 3 | `feat/u1-bypass-reconcile` | U1：绕过证据链入库 |
| 4 | `feat/u2-writeset-reconcile` | U2：写集双向对账 |
| 5 | `feat/u5-secrets-failopen` | U5b：secrets 门禁 git 不可用不再静默豁免 |
| 6 | `feat/u6-sop-gate` | U6：Mac DSH 写时约束卡点 |
| 7 | `feat/u5a-marker-tristate` | U5a：并发/amend 误报根治（消除死锁） |
| 8 | `feat/u5c-verify-parallel-tristate` | U5c：并行判定三态化 |
| 9 | `feat/u4-claims-table` | U4：交付方"声称↔证据"自证表（格式版） |

### 第 3 步：审计报告 + 控制台（线②）

| 顺序 | 分支 | 内容 |
|---|---|---|
| 10 | `audit/product-lines-verification` | K3 产品线验证评审（26 线/163 点） |
| 11 | `feat/console-panels` | 控制台三问面板（**已包含** founder-truth-mvp，合并它即可，不用单独合并 founder-truth-mvp） |
| 12 | `feat/u8-pre-audit-summary` | U8 工程侧：机器预审汇总脚本（第0层，聚合 U1-U4/U7 + risk 分级）——只读汇总，不碰审计口径，可安全合并 |

---

## 合并时的注意（避免冲突）

- **`feat/console-panels` 已经包含 `feat/founder-truth-mvp`** —— 只合并 console-panels，跳过 founder-truth-mvp。
- **第 7 步 `u5a` 和第 9 步 `u4` 都改了 `pre-commit-check.sh`**（不同位置）—— 按 7→9 顺序合并，git 会自动合并；若提示冲突，让 K3/DSH 处理，不要自己硬合并。
- 每合并一个，等 GitHub 的 CI 变绿，再合并下一个。

---

## 合并完之后

1. 跑一次：`python3 scripts/control-tower/founder-truth.py --html`
2. 双击打开 `docs/synova/founder-console.html` —— 你会看到三问面板（红绿灯 + 可点证据）。
3. 让 K3 做最后独立审计（范围见 `docs/review-handover-20260817` §五）。

---

*这份清单是终版。之前那份 `docs/review-handover-20260817` 是过程交接（9 分支），本清单补上了本次新施工的 4 个分支（u5a/u5c/u4/console-panels）。*
