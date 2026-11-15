---
状态: proposed
日期: 2026-11-15
决策: 三条既有红（#1405）只在测试侧修 —— 夹具透传 props；客户实例判据改为「不入库」不变式 + 静态合成夹具；bcrypt 降级用例改为真跑产品降级路径
理由: 红 A 是夹具缺陷（fake 丢 props 撞上桥接包装器），红 B 是测试前提被 #842 产品/合规决定推翻，红 C 是断言写在永不执行的 catch 里（CI 零断言判据现形）；三条都不需要改产品代码，改 src 反而会把测试缺陷伪装成产品缺陷
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

3. **红 C**（CTO 评论 12545 追加，`tests/routes/enterprise.test.ts > D103 — degraded paths > bcrypt hash failure
   returns degraded info`，CI 报 `Error: CORE_ZERO_ASSERTIONS <测试名>`）：
   - CI 原始日志（run 4164 / job 4306，本地存档 `ci-job-4306.log`）显示失败来自
     `../core-tests.126Hrl/assertions.mjs:17:11` —— 即门禁自带的**零断言判据**
     （`scripts/ci/core-tests.sh:158-178`：每个已执行用例在 `afterEach` 比对
     `expect.getState().assertionCalls`，未增加即抛），**不是产品代码抛错**；
     同一文件其余 21 条（含真实 bcrypt 的 D102 用例）在 CI 全部通过 ⇒ bcrypt 原生模块在 Linux 加载正常。
   - 用例原文把**唯一断言**放在 `catch` 里（`await bcrypt.hash('test', 0)` 期待「invalid rounds」抛错），
     而 bcrypt 6.0.0 把 `rounds=0` 当「默认 10 轮」：本机实测 `resolved`，返回 `$2b$10$…` 长 60 ⇒
     `catch` 永不执行 ⇒ 该用例零断言。本机没有该 hook，所以「全绿」是假绿。
   - 归因 = **测试缺陷（断言被跳过）**，不是 Linux 下产品行为不同 ⇒ 本票修，退回条件未触发。

4. 基线实测（干净 worktree，`abf3ef0d4`）：`2 failed (2) / 3 failed | 25 passed (28)` ——
   红 A 1 条、红 B 2 条，与 Issue 正文一致。红 C 在本机需加载 CI 同款零断言 hook 才现形，
   加载后本地复现为 `1 failed | 21 passed (22)`（与 CI 同一错误文本）。

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

- **红 C**：把「等真原生模块对非法入参抛错」改成「显式注入 hash 失败」，然后**真调**产品路由：
  `vi.spyOn(bcrypt, 'hash').mockRejectedValueOnce(...)` → `POST /api/enterprise/register` →
  断言 `500 / ok:false / code=INTERNAL_ERROR / degraded:true`（产品降级路径：
  `src/growth/user-store.ts:89` 抛 → `src/routes/enterprise.ts:121-125` catch）。
  这样四条断言无条件执行（零断言判据不再触发），且判据跨平台确定 ——
  不再依赖各平台 bcrypt 对 `rounds=0` 的宽容度。`hashSpy.mockRestore()` 放在 `finally`，不泄漏到后续用例。
  用例名与 describe 保持原位（1 例进、1 例出，未删除/未合并）。

## 依据

- 基线原始输出：`2 failed / 3 failed | 25 passed (28)`；改后：`2 passed / 30 passed`。
- 改坏必红（原始输出留 PR）：红 A 让 fakeStore 彻底不写节点 ⇒ `expected +0 to be 1`；
  红 B 把合成件 `headcount` 10 → 42 ⇒ `属性 headcount 字面值: expected 42 to be 10`。还原后复跑全绿。
- 红 C 归因证据链（全部原始输出随 PR）：
  1. CI（run 4164 / job 4306）`FAIL ... bcrypt hash failure returns degraded info` →
     `Error: CORE_ZERO_ASSERTIONS ...` 栈顶 `assertions.mjs:17:11`＝门禁零断言 hook，非产品抛错；
  2. 同文件其余 21 例在 CI 通过（含 D102 真 bcrypt 用例）⇒ Linux 下 bcrypt 原生模块正常；
  3. 本机同版本 bcrypt 6.0.0 实测 `bcrypt.hash('test', 0)` → `resolved`（`$2b$10$…`，cost 默认 10）；
  4. 本地加载 CI 同款 hook（复制 `core-tests.sh:158-178`）跑该文件 ⇒ 修前同样 `CORE_ZERO_ASSERTIONS`，
     修后 22 passed；抽掉失败注入 ⇒ `expected 200 to be 500`（证明用例真跑降级路径）。
- 三条修复后合并复跑：`tests/l3/graphbridge-wiring.test.ts` + `tests/ontology/instance-loading.test.ts` +
  `tests/routes/enterprise.test.ts` = **3 files / 52 passed**；`npm run lint` rc=0。
- `npm run lint` rc=0；`SYNO_CI=1 npm run check:architecture` rc=0（「架构检查: 全部通过」）。
- `git ls-tree -r HEAD -- customer-config` = 0 项；`git diff --name-only abf3ef0d4..HEAD` 与写集精确一致。

## 登记不修（本票写集外）

CI job 4306 里另有 4 条既有红同源：`tests/l4/ontology-loader-param-bridge-1031.test.ts`
（`#1031 V5(L2-真跑)` 3 条 + `两笔账棘轮` 1 条）。与红 A/B/C 不同根因，属**第四条既有红**，
按票面停点「可登记、不要顺手修」处理，未在本票改动。
（同 job 里的 `tests/contract/basic.test.ts` 5 条与 `tests/unit/empty.test.ts` 1 条是
`tests/control-tower/core-tests.test.sh` 的**门禁自测夹具**，故意失败，非既有红。）

## 生效时点

本 Note 随 #1405 分支 `fix/1405-latent-red` 的 PR 留痕；PR 停 review，不自行合并。
本票只解 1B CI 阻塞中的三条既有红（A/B/C），不改任何门禁判据、不动 `scripts/audit/**`、不做客户验收声明。
