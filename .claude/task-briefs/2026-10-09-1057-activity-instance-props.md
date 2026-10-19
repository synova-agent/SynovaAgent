# 1057 — 作业单元缺两件（实例 + 评估属性）

#CRITERIA: A

> 卡：GitHub issue #1057（本地镜像 `D:\novis-backup-20260526\Novis\.k4-cards\card-1057.md`；封禁期只读镜像、不发布）
> 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1057`｜分支 `fix/1057-activity-instance-props`｜基线 `origin/main=5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`
> 执行人：`k4-coder-c`（小队 k4，队长 lead）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 组织诊断 Agent。本任务在最 **L4 本体层** 的**内容面**（`extensions/ontology/`，文件驱动扩展载体，施工图 §3.6 🟢 死守）。本体层三件：Schema（形状）/ **实例（每客户）** / 扩展（行业+专业）——作业单元（activity）缺的正是「实例 + 评估属性」。**既有 8 个 `activity/*` 类目已在生产链加载**（`src/l4/ontology-loader.ts:80` `ENTITY_DIRS`；除 loader 自身外 4 个装配点：`src/init/file-driven-loaders.ts:96`、`src/mcp/tool-definitions.ts:394`、`src/routes/ontology-admin.ts:17`、`src/sentinel/sentinel-loader.ts:219`）。**扩展既有类型 + 加实例**，不替换、不新建。

### b) 文件审计
- `grep -rn 'ontology/activity' src tests` ⇒ **0 处**（除 loader 的目录常量）⇒ 改动零调用方破坏。
- `extensions/ontology/activity/` = 8 文件；`production.json` 顶层键 = `$id/label/tags/requiredProps/optionalProps/description`，`optionalProps` 7 个键，**卡面 10 个属性一个都不在**（实测）。
- `data/synova.db`（真机 dev 库）`graph_nodes` = **0 行**；列 = `props_json`（**无 `props`**）、**无 `schema_version` 表** ⇒ 旧形态库。
- `src/l4/ontology-loader.ts:59-68` `scanDir` = **平铺扫描**（不递归）⇒ 实例放子目录不会被加载成类型。
- 结论：**复用/扩展既有 8 个类目 + 新建实例文件（子目录）**；无覆盖冲突、无死代码风险。

### c) 决策
已有覆盖（8 类目）→ **扩展 optionalProps**；实例无既有载体 → 新建 `activity/instances/*.json`（子目录，避免第 9 个伪类型）；**不新建节点类型**（宪章 P4）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **Anthropic 基线**：① 先定义验证标准再实现（本卡先写 `tests/l4/activity-instance-1057.test.ts` 与判据口径，再改 JSON）；② 物理强制优于自律（判据用真实 SQLite 写入路径，不用 grep 静态判据）；③ 失败必须可见（旧库缺列 ⇒ 真跑一次断言它抛错）。
- **业界**：本体工程惯例把「类型（TBox）」与「实例（ABox）」分离存放；实例不应污染类型扫描路径 ⇒ 子目录分层，与 `scanDir` 平铺语义吻合。
- **memory/ 历史教训**：① 铁律 47/48 契约先行 + 测试非空壳（本卡测试 ≥3 expect 且含正常/降级/边界三路）；② 「接线了 ≠ 被执行了」（#1057 的判据必须真跑写入路径；故加**判别性反证**：未迁移旧库上同一 INSERT 必抛 `no such column: props`）；③ 铁律 0-4 数据资产（真机库只读，快照到工作树内）。
- **决策参考系**：参考：Anthropic 工程基线（先验后码 + 物理强制）/ 本体工程 TBox-ABox 分离 / 第一性原理（判据必须能红） + 结论：平铺 schema 扩属性 + 子目录实例 + 真实写入路径判据。

## Q2: 范围 — 正确的最简方案

做什么：
- extensions/ontology/activity/acquisition.json
- extensions/ontology/activity/compliance.json
- extensions/ontology/activity/coordination.json
- extensions/ontology/activity/governance.json
- extensions/ontology/activity/innovation.json
- extensions/ontology/activity/learning.json
- extensions/ontology/activity/maintenance.json
- extensions/ontology/activity/production.json
- extensions/ontology/activity/instances/activity-production-wani-baby-001.json
- tests/l4/activity-instance-1057.test.ts
- docs/synova/product-lines/evidence/1057-activity-instance-props.md
- .claude/task-briefs/1057-activity-instance-props.md
- .k4-publish/read-card-confirm.md
- .k4-publish/WIN-1057-delivery.md
- .k4-publish/PUBLISH.sh

不做什么（含文件路径）：
- 不改 src/adapters/sqlite-graph-store.ts（写入路径已存在，本卡只消费）
- 不改 src/l4/ontology-loader.ts（平铺扫描够用，子目录即隔离）
- 不改 src/l4/sog-schema-validator.ts（`activity/*` 未覆盖类型降级属 #980/#1436 域）
- 不改 data/synova.db（数据资产，只读快照）
- 不改 extensions/ontology/tags.json（本卡不新增标签）
- 不改 extensions/ontology/manifest.json（不符节点类型计数口径，避免数字漂移）
- 不改 extensions/ontology/edge-consumption-map.json（#1134 在飞）
- 不改 extensions/ontology/edge-types/edge-consumption-map.json（#1134 域）
- 不改 extensions/skills/SKILL.md（3-6 域）

## Q3: 验收 — 入口 → 交互 → 结果

- **入口**：`extensions/ontology/activity/*.json`（类型面）+ `activity/instances/*.json`（实例面）——文件驱动，加文件即可。
- **处理**：`loadOntology()` 加载 8 类目（含 10 属性）→ `SqliteGraphStore.createNode(type, props, graph)` 走真实 `INSERT INTO graph_nodes (... props)` 落实例。
- **结果**：`graph_nodes` 出现 `activity/*` 节点，且 10 个评估属性经 `queryNodes` 原样读回。
- **可见性说明（诚实）**：本卡**无用户可见 UI 变化**（卡面 §⑪ 已声明）；消费者是 §4.7「Agent 化机会识别」矩阵与下游 3-6/3-8。

## 架构层: L4

## Done 标准

1. `npx vitest run tests/l4/activity-instance-1057.test.ts` exit 0（含 8 类目 10 属性覆盖断言 + 真实写入路径回读断言 + 判别性反证）。
2. 旧形态库上同一 `INSERT INTO graph_nodes (... props)` 必抛 `no such column: props`（判别性夹具，未迁移即红）。
3. 真机口径：`SYNOVA_1057_REAL_DB=<真机 data/synova.db> npx vitest run tests/l4/activity-instance-1057.test.ts` ⇒ 快照上 `SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'` = 1（原件只读、零写入）。
4. 删实例文件 ⇒ 判据 1 必红（证据件贴两次原始输出）。

- [ ] `npx vitest run tests/l4/activity-instance-1057.test.ts` exit 0；verify: bash scripts/pre-commit-check.sh
- [ ] 旧形态库上同一 INSERT 必抛 `no such column: props`（判别性夹具）；verify: bash scripts/pre-commit-check.sh
- [ ] 删实例文件 ⇒ 判据 1 必红；verify: bash scripts/pre-commit-check.sh
<!-- Done 补记：历史件原验收无法复跑，verify 取全量门禁 -->
