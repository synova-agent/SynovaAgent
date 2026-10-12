# K4 批 3 · 自建卡面索引（待 CTO 分配号）

> **来源**：CTO 2026-10-12 交付指令 §三「立卡（9 张，自建、自报号）」
> **自报号**：本目录 9 张卡由 K4 批 3 执行小队**自建**；**编号待 CTO 分配**
> （`scripts/control-tower/alloc-task-id.sh` 已 DEPRECATED，U5/创始人 2026-10-08 裁「改用 issue 号作身份」）
> **卡面格式**：六字段（Q0/Q1/Q2/Q3/架构层/写集）＋ §〇 七问 ＋ Done 标准（`line-audit-and-cards` §4.1/§4.3）
> **三条硬要求**（CTO §三）：① 挂对里程碑 + 执行态/未开工 标签；② 标题带前缀；③ 卡面必须含 §〇 七问
> **⚠️ PR 正文**：须写 `Closes #<本卡 issue 号>`（门禁 `check-board-truth` 依赖此信号）；
> **号未分配前用 `Refs` 占位 —— 禁 `Closes` 到一个不存在的号**（#345 误关事故）

---

## K4 · 本体/因果边/循环编号（5 张）

| 文件 | 标题 | 里程碑 | 执行态 | 阻塞源 |
|---|---|---|---|---|
| [01-K4-tags-registry.md](01-K4-tags-registry.md) | `[K4-A]` tags.json 缺 `first_order`/`second_order`（存量；CI strict 会红） | K4 | 未开工 | 无 |
| [02-K4-loader-calibration-state.md](02-K4-loader-calibration-state.md) | `[K4-B]` loader 的 `prose_formula` 测不出「已标定 vs 未标定」 | K4 | 未开工 | 无 |
| [03-K4-eid-landing.md](03-K4-eid-landing.md) | `[K4-C]` 权威表 7 个 E 号无 `$id` 落点（卡住 6 件循环 7 个阀位） | K4 | 未开工 | 无 |
| [04-K4-vocabulary-merge.md](04-K4-vocabulary-merge.md) | `[K4-D]` 两套本体词表合并（58 JSON ↔ 常量） | K4 | 未开工 | 无 |
| [05-K4-naming-n3n4.md](05-K4-naming-n3n4.md) | `[K4-E]` 边名 N3/N4 认领收口 | K4 | 未开工 | **库外**（名册不在本仓） |

## K2 · 写入门禁与工具治理（4 张）

| 文件 | 标题 | 里程碑 | 执行态 | 阻塞源 |
|---|---|---|---|---|
| [06-K2-gate-probe-wiring.md](06-K2-gate-probe-wiring.md) | `[gate]` probe-cycle-edges 无任何自动执行链（恒绿隐患；与 #346 同族） | K2 | 未开工 | 无（改门禁语义须 CTO 裁） |
| [07-K2-note-shape.md](07-K2-note-shape.md) | `[K2-C]` memory/notes/README 契约与 262 件实践形态漂移 | K2 | 未开工 | 无 |
| [08-K2-claim-repair.md](08-K2-claim-repair.md) | `[K2-B]` `claim_store --repair` 规则化（带 `--dry-run`；**转义 `\"` 而非删引号**） | K2 | 未开工 | **须 CTO 追认 R11** |
| [09-K2-criteria-discipline.md](09-K2-criteria-discipline.md) | `[K2-A]` 四元组 + 判据边界／命中打全文／反向造红 —— 入技能与门禁 | K2 | 未开工 | 无（入门禁须 CTO 裁） |

---

## 需 CTO 先裁的 4 处（否则卡会卡在第一步）

| 卡 | 须先裁的事 | 类别 |
|---|---|---|
| `[K4-A]` | `tags.json` 是**扩充**（补登记）还是**改边文件**（去标签） | 改门禁语义 |
| `[K4-D]` | 单一真源选**文件驱动**还是**常量**；`sog-core` 第三处同名物如何处置 | 架构取舍 |
| `[K2-B]` | **R11 追认**（越界修复转规则） | 追认 |
| `[K2-A]` / `[gate]` | 是否**入门禁**（改 `pre-commit-check.sh` / 新增 CI workflow） | 改门禁语义 |

---

## 与批 3 已交付件的关系（防重复立卡）

- `[K4-A]` 的根因在批 3 **U9**（impl-b 登记）；`[K4-B]` = **U10**；`[K4-C]` = **T4/T5/T3 的运行时后果**（#238/#239 已登记）；
  `[K4-D]` = 批 3 **W-8**（`ALL_EDGE_TYPES` 52→54 行为变化）＋ K4 定稿 §五「横向查重」；`[K4-E]` = 批 3 **W-4**。
- `[gate]` = verifier 批 3 **V-6**；`[K2-B]` = verifier **a-6 越界判定**（R11）；`[K2-A]` = 队长台账 **R18/R19/R20/R22**。
- ⇒ **均已核：无与批 3 卡重复**（批 3 六卡 + 本 9 卡交集 = ∅）。

## 未决：本目录是否应落仓

CTO §三 说「自建、自报号」。本队**已落仓**（`docs/synova/coordination/cards/K4-b3-proposed/`）以便**版本化 + 可引**（B4：仓内可引原件）。
若 CTO 另有落点（库外档案仓 / 面板 issue）⇒ 本目录可 `git mv` 或标记为"草稿源"。
