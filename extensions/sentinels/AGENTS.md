# AGENTS.md · extensions/sentinels/（哨兵域）

> 归属：**产品线** ｜ 承载包：**K3**（与根件 §0 表逐字一致）｜ as_of `38d77034b`（PR1/7）

## 是什么
哨兵内容半面主场：47 个哨兵目录（各自 manifest，件粒度天然可分）＋阈值内容（`extensions/industries/`、`extensions/rules/`）。代码落点 `src/sentinel/**`、`src/store/**` 守则同本件（根件 §0 显式排除：不单独立份）。

## 谁改
- 加/改/退役哨兵＝**内容件**：加目录＋`content-reload` 重扫即生效（K12-15 已交付）；卸＝移 `_extinct/`＋重扫。
- `src/sentinel/**` 代码＝产品线，走 `check-architecture.sh`（代码层 L1–L5，只管 import 方向；≠宪章层）。

## 怎么算完成
- 新哨兵：manifest 齐 → 一次巡检 `expectExit 0` → `metric_readings` 近 1h 有行（块级现行判据 `expectRowsGt n:0` 为弱判据，目标判据=3-13…3-17 落地后替换）。
- 退役：`_extinct/` 迁移＋重扫＋时序数据**保留**（回滚不清时序，须声明）。

## 红线
禁碰 `scripts/audit/**`（K3 审计红线）｜ 静默降级禁止（catch 必 `degraded: true`）｜ 与根件零重复。
