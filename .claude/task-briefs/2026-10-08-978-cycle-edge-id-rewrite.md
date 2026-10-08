# Task Brief — #978 0-4 循环编号映射（cycles/ E-x.y → 代码边 $id）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

**项目拼图**：本任务在**本体层数据洁净度**面（非五层依赖图内、非 src 代码）。0-4 是「第0批-止血」收尾件：`cycles/**/*.cycle.json` 里写着 `E-N.M` 形态的边引用（17 条 distinct / 45 处出现），而代码本体边已迁到新体系（`$id` = `edge/<snake>` 55 条 + `label` UPPER 55 条）⇒ **本体迁了、循环没迁**。
**文件审计**（grep 实测）：`src/cycles/cycle-loader.ts:25-29` 扫 `cycles/{custom,industry,builtin}`（本卡数据正被它加载）；`:64/:69` 跳过 `_` 前缀文件；`cycle-types.ts:29` 有 `edgeRefs` 类型声明但**零消费者**（`git grep -n "edgeRefs" -- src/` = 1 命中，仅该声明）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/第一性原理 + 结论=**编号体系的价值是两侧能被第三方对上**，保留私有第三套编号会永久制造语义分裂 ⇒ 取路线 (b) 重写，不写映射层。
历史教训引用：① 本仓「grep 型静态判据禁当验收」⇒ 本卡用**反例证伪**（改坏即红 / 漏改即红）；② 「接线了 ≠ 被执行」⇒ 本卡如实标 **L1 静态可达**（`edgeRefs`/`mapping` 零消费者，非运行时契约）；③ 「验证了错误目录就宣布清零」⇒ 本卡所有真值一律 `git show origin/main:<path>` / `git grep … origin/main` 口径，不读后备工作树。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- cycles/builtin/cash-cycle.cycle.json
- cycles/builtin/customer-cycle.cycle.json
- cycles/builtin/product-cycle.cycle.json
- cycles/builtin/talent-cycle.cycle.json
- cycles/industry/retail-ecommerce/store-replication.cycle.json
- cycles/industry/saas-tech/arr-growth.cycle.json
- scripts/control-tower/probe-cycle-edges.ts（判据交付物，新建；三态 exit 0/1/2、词表缺失 fail-closed）
- docs/synova/product-lines/evidence/D978-cycle-id-map-20261008.md（证据件）
- memory/notes/proposed/2026-10-08-0-4-cycle-edge-id-rewrite.md（决策 Note，D395-a 门禁要求）
- .claude/task-briefs/2026-10-08-978-cycle-edge-id-rewrite.md（本件）

不做什么（含文件路径）：
- 不碰 `src/cycles/cycle-loader.ts`、`src/cycles/overflow-compute.ts`、`src/agent/loop-handlers.ts`（卡面 §四.4：本卡只做配置洁净度，不改计算逻辑）
- 不碰 `scripts/workflow/system-registry.json`（跨基 35 条 `E-x.y`，卡面 §四.5 明令本卡不动）
- 不碰 `scripts/audit/**`（审计红线，全卡批红线）
- 不改产品代码（本卡纯配置 + 判据脚本）

## 写集

| 文件 | 类别 |
|---|---|
| `cycles/builtin/cash-cycle.cycle.json` | task |
| `cycles/builtin/customer-cycle.cycle.json` | task |
| `cycles/builtin/product-cycle.cycle.json` | task |
| `cycles/builtin/talent-cycle.cycle.json` | task |
| `cycles/industry/retail-ecommerce/store-replication.cycle.json` | task |
| `cycles/industry/saas-tech/arr-growth.cycle.json` | task |
| `scripts/control-tower/probe-cycle-edges.ts` | task |
| `docs/synova/product-lines/evidence/D978-cycle-id-map-20261008.md` | task |
| `memory/notes/proposed/2026-10-08-0-4-cycle-edge-id-rewrite.md` | task |
| `.claude/task-briefs/2026-10-08-978-cycle-edge-id-rewrite.md` | task |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`git grep -ohE "E-[0-9]+\.[0-9]+" -- cycles/ | wc -l`
处理：把 6 个 `.cycle.json` 的 45 处 `E-x.y` 逐条重写为代码边 `$id`；新建 probe 复算
结果：计数 **45 → 0**；`npx tsx scripts/control-tower/probe-cycle-edges.ts` ⇒ **exit 0**（`legacy_occurrences=0` / `$id=55` / `label=55` / `unknown=0`）；两条反例（改坏 / 漏改）⇒ **必 exit 1**

## 架构层

治理/数据洁净度（`cycles/**` 配置 + `scripts/control-tower/**` 判据件）；不触五层依赖图，不动 `src/**`。**L1 静态可达**（卡面自认零消费者，禁填 L2/L3/L4）。

## Done 标准

- [ ] `git grep -ohE "E-[0-9]+\.[0-9]+" origin/main -- cycles/ | wc -l` 由 **45 → 0**
- [ ] `npx tsx scripts/control-tower/probe-cycle-edges.ts` ⇒ exit 0，且断言明确
- [ ] 反例成立：改坏任一 `edgeRefs` ⇒ 必红；只改 `edgeRefs` 不改 `mapping[].edgeId` ⇒ 必红（残留 23）
- [ ] 17 条定稿表齐（现引用 / 目标 `$id` / 依据 / 等级），**unknown 显式标注不猜**
- [ ] 红证不残留（夹具复原后 6 文件 SHA256 逐字一致）
- [ ] `git ls-remote --heads origin | grep 978` 回执
