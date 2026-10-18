# AGENTS.md · extensions/sentinels/（哨兵域）

> 归属：**产品线** ｜ 承载包：**K3**（与根件 §0 表逐字一致）｜ as_of `3ab277c44`（2026-10-18 真源核对）

## 是什么
哨兵内容半面主场：**48 个目录 / 46 个有效哨兵**（实测 `git ls-tree extensions/sentinels/` = 48 目录，减 `_extinct` 与 `shared` = 46；裁定 163）（各自 manifest，件粒度天然可分）＋阈值内容（`extensions/industries/`、`extensions/rules/`）。代码落点 `src/sentinel/**`、`src/store/**` 守则同本件（根件 §0 显式排除：不单独立份）。

## 谁改
- 加/改/退役哨兵＝**内容件**：加目录＋`content-reload` 重扫即生效（K12-15 已交付）。
- 🔴 **卸＝移 `_extinct/`＋重扫 —— 实测运行期不生效**：`content-reload.ts` **无 `unregister` 逻辑** ⇒ **必须重启**（裁定 167-U2）。**不许宣称"运行期可卸"。**
- `src/sentinel/**` 代码＝产品线，走 `check-architecture.sh`（代码层 L1–L5，只管 import 方向；≠宪章层）。

## 怎么算完成
- 新哨兵：manifest 齐 → 一次巡检 `expectExit 0` → `metric_readings` 近 1h 有行（块级现行判据 `expectRowsGt n:0` 为弱判据，目标判据=3-13…3-17 落地后替换）。
- 退役：`_extinct/` 迁移＋重扫＋时序数据**保留**（回滚不清时序，须声明）。

## 红线
禁碰 `scripts/audit/**`（K3 审计红线）｜ 静默降级禁止（catch 必 `degraded: true`）｜ 与根件零重复。

## 🔴 2026-10-18 增量（MVP 阶段事实）

- **bundle/桌面/容器形态下内容面不可装载**：同 SHA 只换形态 —— dev `registered=46/total=50` ｜ **bundle 5** ｜ **桌面 0** ｜ **容器 0**（裁定 161 复现矩阵）。
  ⇒ **"加目录就生效"只在 dev/源码形态成立**；客户形态需 C4 修法（阶段 1 已验收，裁 176）。
- **契约校验**：`src/sentinel/types.ts` 有 **85 条 `import type`**（编译期强制）；**指向 `_extinct/` 的 12 条已断**（裁 157 选②，PR #555）。

## 🔗 改本域涉及的包（双向清单 · 2026-10-18）

P1（决定哨兵内容）｜P2（装载器读它）｜P9（L1.5 包层）

> 口径：与 `handbook 包/交叉矩阵-12守则×10包.md` 一致；`👁`=只读不改
