---
状态: proposed
日期: 2026-10-08
决策: #980（0-6）取 (b') 形态——降级信号挂在既有返回载体（ValidationError 元素 degraded 标记）+ 去重聚合可见清单，不改 validateNodeProps/validateAndLog 签名、不扩写集到 graph-bridge.ts
理由: 卡面 §③ 约束 2 推荐 (b)（铁律 31 降级信号传播），但 (b)/(b'') 都要改签名或动 L4 桥接契约。第一性原理（最少机制）+ Anthropic（机器可验契约/失败可见）+ 铁律 31 收敛于：把标记挂到**已经存在的**返回载体上，零签名变更、零第二写者面。同时用模块级聚合器把「未覆盖类型 N 个」做成去重清单（非逐条刷屏），满足命名权威 N4「无 schema 必须显式」与登记件 C4 门禁输入。
---

# #980 / 0-6 本体 Schema 校验器静默放行 → 可见降级

## 触发场景

- 坏点 4：`src/l4/sog-schema-validator.ts:141` 对无 schema 类型 `return []` 静默放行。
- 实测：8 个大写遗留 schema 键与 40 个斜杠本体类型**交集 = 0**（不是"39 个不校验"，是**全部**不校验）。校验器**已接线**（`graph-bridge.ts:20` import + `:82` 调用）但恒不生效 —— 典型"看起来在工作"。

## 决策点与参考系

| 决策点 | 选项 | 参考系 | 结论 |
|---|---|---|---|
| degraded 落点 | (a) 仅 log.warn / (b) 扩返回类型 / (b') 元素标记 | 第一性原理（最少机制）+ Anthropic（失败可见、机器可验）+ 铁律 31 | **(b')** |
| 告警量 | 逐条 warn / 去重聚合 + 边沿触发 | 运营现实（一次诊断数千条 warn 会淹没日志，卡面 §③ 约束 3 明文） | 边沿触发 + 每 20 种汇总 |
| 是否补 Schema | 本卡补 `pool/*`15 + `external/*`16 / 另立卡 | 防范围膨胀（CTO 裁定 R6 同族） | 另立卡（本卡只做可见） |
| 是否改名 | 改 `ValidationError`（与 @synova/error-types 同名异义） | 一类一机制、不扩范围 | 不改，登记为 N4 收敛注意项 |

## 落地形态

- `ValidationError` 增可选 `degraded?: boolean`；未覆盖类型 → 返回单条降级元素（`errors.length !== 0`）。
- `validateAndLog` 判据保持 `errors.length === 0 → true` ⇒ 未覆盖类型**仍不阻断**（写入行为不变）。
- 新增 `getUncoveredTypeStats()` / `resetUncoveredTypeStats()`；消费者 = `scripts/control-tower/probe-diagnosis.ts`（判据交付物）。

## 相关 D#

- 本卡 = #980（0-6，批次 第0批-止血，模块 K8）。
- 裁定依据：#1317 R26（真库路径须有 integration 覆盖）、R28（探针地雷纪律）、R29（必需检查现查）。
- 判据源：`docs/synova/coordination/施工项登记.ts`（id `0-6`，`block: K8`，`dependsOn: []`）。

## 状态迁移预告

- 本 Note 现为 `proposed`（计划阶段）。
- 实现落地并经独立复核后 → `git mv` 到 `implemented/`（README D534 门槛：task-state 对应状态 ∈ {impl_done, audited}）。
