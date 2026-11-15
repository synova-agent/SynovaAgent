---
状态: proposed
日期: 2026-11-15
决策: 两条既有红（#1405）只在测试侧修 —— 夹具透传 props；客户实例判据改为「不入库」不变式 + 静态合成夹具
理由: 红 A 是夹具缺陷（fake 丢 props 撞上桥接包装器），红 B 是测试前提被 #842 产品/合规决定推翻；两条都不需要改产品代码，改 src 反而会把测试缺陷伪装成产品缺陷
---

## 现状

1. **红 A**（`tests/l3/graphbridge-wiring.test.ts:79`，`expected +0 to be 1`）：该用例的 fakeStore 写成
   `createNodes(nodes) { return nodes.map(n => this.createNode(n.type)) }`，**丢掉 `props`**。
   `src/l4/graph-bridge.ts` 在 `createNode` 外层包装里写 `props.observed_at`（graph-bridge.ts:98），
   `undefined` 上取属性抛 `TypeError`，被 `upsertFromHONA` 的 `catch`（graph-bridge.ts:132-136）收成
   `degraded` ⇒ 成功模块也 0 节点。产品侧行为正确（降级可见、errors 可见），**缺陷在夹具**。

2. **红 B**（`tests/ontology/instance-loading.test.ts`，`inst.errors` 非空 + `TypeError ... reading 'props'`）：
   该 `describe` 自称「仓内真件（git 跟踪交付物）」，断言
   `customer-config/ontology-instances/wani-baby/activity-production.json` 在仓内。
   实测 `git ls-tree -r HEAD -- customer-config` = **0 项**；该实例按 Issue **#842**（裁 302-D3）
   「客户实例脱敏 ＋ 移出公开面」有意不入库。⇒ 测试前提已过期，不是遗漏。

3. 基线实测（干净 worktree，`abf3ef0d4`）：`2 failed (2) / 3 failed | 25 passed (28)` ——
   红 A 1 条、红 B 2 条，与 Issue 正文一致。

## 决定

**只在测试侧改，不动 `src/**`。**

- **红 A**：fakeStore 改为透传 `n.props`（与同文件第一条用例的既有写法一致），并补三条断言钉住夹具不能退化：
  `graphNodes[0].type === NodeType.RESOURCE_PERSON`、`props.name === 'hona'`、
  `typeof props.observed_at === 'string'`。后两条同时证明「夹具确实走 `store.createNode`（被桥接包装过）」，
  避免用「永远返回成功」式假夹具蒙过用例。用例仍断言 `graphNodes.length === 1` ⇒
  「失败模块不产生节点、成功模块产生节点」不变。

- **红 B**：把该 `describe` 拆成两件事，判据强度不降：
  1. **仓内真件**保留仍成立的两面 —— Schema 层 8 个 activity 类目（`schema.errors` 空、
     `categories.length === ACTIVITY_CATEGORIES.length`）＋ 扩展层非空（`ext.decls.length >= 1`）；
     `真件 Schema 层零评估属性`、`[L2] 生产 loader`、`平铺扫描不递归` 三条原样保留。
  2. **合规不变式**（新增）：仓内**不得**出现客户实例 ——
     `loadInstanceLayer(REPO_ROOT)` 找不到 `<客户 orgId>/activity/production`，且该目录 `existsSync === false`。
     把「实例在位」反过来钉死：仓内出现客户实例才是红（#842）。
  3. **实例面判据改由静态合成夹具承载**：新增 `tests/ontology/fixtures/synthetic-activity-production.json`
     （`graph: 'synthetic-org'`，名/产出均为「合成」，**无客户标识**）。测试把它落到 `os.tmpdir()` 下的
     「仓形」容器，仍走**同一** `loadInstanceLayer`（目录名 → orgId 不变式真实生效）＋**仓内真件**
     Schema/扩展层 `validateInstance`，零 violations；再逐条断言 9 个 number 字面相等与
     `agent_type_recommendation` 前缀 —— 与原断言逐条对应，一条未删。
     夹具是**静态**件（数值写死在仓内），不是从 `EXPECTED_INSTANCE` 生成 ⇒
     「改坏一个 number ⇒ 必红」有真实判别力（生成式夹具会退化成恒真断言）。

- 未选 (b) 里「只用隔离 fixture」的旁路：那会让 9 个 number 断言退化为恒真（夹具由同一常量生成）。
- `EXPECTED_INSTANCE.orgId` 是客户 org，`validateInstance` 的 `expected` 参数带 `as const` 字面量类型，
  合成实例不能冒用；因此 orgId 维度改由「目录名 == doc.graph == 合成 orgId」两条不变式覆盖，
  值/前缀维度仍逐条对 `EXPECTED_INSTANCE.values` / `agentTypeRecommendationPrefix` 断言。

## 依据

- 基线原始输出：`2 failed / 3 failed | 25 passed (28)`；改后：`2 passed / 30 passed`。
- 改坏必红（原始输出留 PR）：红 A 让 fakeStore 彻底不写节点 ⇒ `expected +0 to be 1`；
  红 B 把合成件 `headcount` 10 → 42 ⇒ `属性 headcount 字面值: expected 42 to be 10`。还原后复跑全绿。
- `npm run lint` rc=0；`SYNO_CI=1 npm run check:architecture` rc=0（「架构检查: 全部通过」）。
- `git ls-tree -r HEAD -- customer-config` = 0 项；`git diff --name-only abf3ef0d4..HEAD` 与写集精确一致。

## 生效时点

本 Note 随 #1405 分支 `fix/1405-latent-red` 的 PR 留痕；PR 停 review，不自行合并。
本票只解 1B CI 阻塞中的两条既有红，不改任何门禁判据、不动 `scripts/audit/**`、不做客户验收声明。
