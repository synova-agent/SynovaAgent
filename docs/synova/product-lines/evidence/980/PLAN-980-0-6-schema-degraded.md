# #980 / 0-6 实施计划（Win 侧 DSH · 待 CTO 放行）

> 坐标系：模块 K8 知识与图谱权限 ｜ 总闸 不适用 ｜ 承重件 不适用（本卡解 N4 命名错位；护城河承重件 W4 属 2-6）｜ 批次 第0批-止血 ｜ 命名空间 N4-本体类型键 ｜ 执行态 计划待放行 ｜ 验证级别 L2-真跑通 ｜ 阻塞源 = 治理线窗排期（见 §8）
> 基线：`origin/main = 9e9e4bd9d3c5844c51de48e2c42f25d2d2e904ea`（2026-10-08 本机 fetch 实测）
> 分支 / 工作树：`feat/win-0-6-schema-degraded` @ `D:\novis-backup-20260526\Novis\.synova-wt-980`（独立工作树，不复用他人）
> 裁定核对：与本件冲突的以 #1317 为准（R1–R31、M1–M7 已逐条读）

---

## 0. 前提冻结（开工前实测，禁凭记忆）

| # | 前提（卡面声称） | 命令 | 输出摘要 | 判 |
|---|---|---|---|---|
| P1 | 静默放行点在 `src/l4/sog-schema-validator.ts:141` | `git show origin/main:src/l4/sog-schema-validator.ts \| sed -n '141p'` | `  if (!schema) return []; // 未知类型 — 不校验（允许扩展）` | ✅ 行号未漂 |
| P2 | schema 块 = `:36-98`，共 8 个大写键 | `grep -nE "^const NODE_SCHEMAS\|^\};"` + 逐行取 `^  [A-Z_]+: \{` | `36:const NODE_SCHEMAS…` / `98:};`；8 键 = FINANCIAL/PERSON/CLIENT/RISK/GOAL/AGENT/TEAM/DOCUMENT | ✅ |
| P3 | 8 个大写键与 40 个斜杠类型**无一重合** | 卡面 C7 交集实测 | 交集 = 0（不是 39/1）⇒ 40 个斜杠类型**全部**走静默放行 | ✅ |
| P4 | 校验器**已接线**，非零调用 | `git grep -n "validateNodeProps\|validateAndLog" origin/main -- src packages tests` | 定义 `:139`/`:168`；调用 `graph-bridge.ts:20`（import）+ `:82`（`validateAndLog(type, props);` **忽略返回值**） | ✅ 接了但恒不生效 |
| P5 | 判据交付物 `scripts/control-tower/probe-diagnosis.ts` **不存在** | `git ls-tree -r --name-only origin/main -- scripts/control-tower/ \| grep probe` | 空（该目录 92 个文件零 `probe*`） | ✅ 须本卡新建 |
| P6 | `validateNodeProps` 返回类型**无 degraded** | `sed -n '139p'` | `export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {` | ✅ |
| P7 | 写集与在飞 #1322 **零重叠** | `git diff --stat origin/main...origin/feat/1322-goal-creation-entry` | 13 文件：`src/growth/{goal-store,proposal-engine,proposal-store,proposal-types,workspace-builder,workspace-types}.ts`、`src/routes/workspace-data.ts`、`tests/{growth,routes,security}/**`、`.claude/claims/1322.yaml` | ✅ 互斥成立 |
| P8 | 我的写集无在飞写者 | `git grep -n "sog-schema-validator" origin/main` | 仅 `graph-bridge.ts:20` + 本文件 + 审计基线 txt + 登记件 | ✅ 单写者 |
| P9 | 真 GraphStore 现成可装配 | `git show origin/main:src/adapters/sqlite-graph-store.ts` | `export class SqliteGraphStore { constructor(db: Database.Database) … const id = \`node-${uuid()}\` }`；工厂 `createSystemGraphStore()`（`src/agent/graph-store-service.ts`） | ✅ 探针可接真库 |
| P10 | 必需检查 live 口径（R29） | `gh api repos/synova-agent/SynovaAgent/branches/main/protection --jq '.required_status_checks.contexts[]'` | 9 条：Architecture Check / Checker Review (maker/checker) / Control Tower Gate Tests (ubuntu-latest) / Golden Case F1 Gate / Integration Contract Check / Test-Kit Architecture Tests (ubuntu-latest) / TypeScript + Lint + Iron Laws / Vitest (1/2) / Vitest (2/2)；`enforce_admins=true` | ✅ 现查，不引旧清单 |
| P11 | 工具地雷（R28）在本卡范围内的曝光面 | 6 个 `extensions/industries/*/thresholds.json` 取 SHA256 基线 | 已记（financial-services/general-enterprise/manufacturing/retail-ecommerce/saas-tech/test-write） | ✅ 跑前记、跑后比对 |

**前提不成立项：无。** 卡面 §② 的"39/40"表述与本次 C7 实测分歧（实为 40/40 全放行）已在卡面 §②「原文数字的订正」标注，不作为本计划前提。

---

## 1. 冲突扫描（M2；完整输出，禁截断）

`bash scripts/workflow/grep-refs.sh "validateNodeProps" "validateAndLog" "sog-schema-validator" "ValidationError" "NODE_SCHEMAS" "createGraphBridge"`
⇒ **共 61 处引用**，落 `.claude/reference-map.md`（工作树内），门禁文件 `.claude/grep-verified` 已生成。

关键结论（完整贴见 `.claude/reference-map.md`）：

| 符号 | 全仓引用分布 | 对本计划的影响 |
|---|---|---|
| `validateNodeProps` | `sog-schema-validator.ts:139`（定义）、`:169`（唯一内部调用） | **只 1 个调用方**，在文件内 ⇒ 改返回内容零外部破坏 |
| `validateAndLog` | `graph-bridge.ts:20`（import）、`graph-bridge.ts:82`（**唯一外部调用，忽略返回值**）、定义 `:168` | 不改签名 ⇒ **`graph-bridge.ts` 无需改** |
| `sog-schema-validator` | `graph-bridge.ts:20`、本文件 `:2`/`:10` | 无第三消费方 |
| `NODE_SCHEMAS` | 本文件 `:36`、`:140` | 模块私有 |
| `ValidationError` | 本文件 `:27/:102/:139/:143`；**同名异义 3 处**：`src/errors.ts:16`、`src/routes/agent-observer.ts:25`、`packages/error-types/src/index.ts:173` | ⚠️ 命名撞车（本卡不改名，登记为注意项，属 N4 收敛另卡） |
| `createGraphBridge` | L2 `conversation-engine.ts`/`engine-context.ts`/`post-diagnosis-processor.ts`、`l4/index.ts:4` re-export、7 个测试文件 | 本卡不碰 |

**冲突扫描判：无写集冲突、无第二写者。** 唯一外部协调项 = `scripts/control-tower/**` 单写者线窗（§8）。

---

## 2. 要改哪一行 / 为什么

**改动点（唯一）**：`src/l4/sog-schema-validator.ts` —— 把 `:141` 的**静默放行**改为**可观测的显式降级**（不阻断）。

```ts
// 现状（:140-141）
const schema = NODE_SCHEMAS[nodeType];
if (!schema) return []; // 未知类型 — 不校验（允许扩展）
```

**为什么**（卡面 §① + 命名权威 N4 + 登记件 C4）："无 schema"必须是**显式状态**；现状是 40 个斜杠类型 100% 静默放行（P3），属"接了但恒不生效"。改后：写入行为**不变**（仍放行），但缺口变成**可被门禁读的声明**（"未覆盖类型 N 个"是声明式清单形态）。

---

## 3. 设计决策（执行方裁，此处给出裁定与依据）

### 3.1 选 (b) 而非 (a)：`degraded` 落在 `ValidationError` 元素上

卡面 §③ 约束 2 给两条路。**裁定选 (b)**，但**选一条"不改签名、不改 `graph-bridge.ts`"的 (b) 形态**：

- `ValidationError` 增加**可选**字段 `degraded?: boolean`（对已有 8 个 schema 的报错元素零影响）。
- 未覆盖类型时 `validateNodeProps` 返回**一条降级元素** `{ nodeType, field: '*', value: null, expected: 'schema 未覆盖 — 放行 (degraded)', degraded: true }`。
- 返回值语义：`errors.length === 0` ⇔ 无错误且**无降级**。`validateAndLog` 判 `errors.length === 0 → return true` **保持原判据** ⇒ 未覆盖类型**仍返回 true（不阻断）**，且元素上的 `degraded` 可被读。
- `graph-bridge.ts:82` 忽略返回值的行为**不变**（V4"不阻断"由它保证）⇒ **该文件不进写集**。

**多路对比（为什么不是 (a)）**：

| 路线 | 满足铁律 31 | 写集 | 风险 | 判 |
|---|---|---|---|---|
| (a) 只加 log.warn | ❌ 降级不外传 | 最小 | 最低 | 不选（与铁律 31 张力，K3 必挑） |
| **(b') 元素携带 degraded + 聚合告警**（本节） | ✅ 双载体（日志 + 返回值） | **仅 validator** | 低（签名不变、调用方不变） | **选** |
| (b'') 改 `validateNodeProps` 返回 `{errors, degraded}` | ✅ | validator + 调用方 | 中（签名破坏性变更） | 不选（超最小） |
| (b''') 改 `validateAndLog` 返回对象 | ✅ | validator + `graph-bridge.ts` + 其契约测试 | 高（动到 L4 桥接契约，撞 `04-graphstore-compatibility` 家族） | 不选（超最小） |

**决策参考系**：参考 第一性原理（梁文峰：最少机制）+ Anthropic（机器可验契约、失败可见）+ 本仓铁律 31 ⇒ **收敛**：把降级信号挂在一个**已经存在的返回载体**上（元素数组），比新增返回通道更少机制、且不破坏契约。

### 3.2 聚合计数与"不刷屏"（卡面 §③ 约束 3）

- 模块级聚合器：`Map<string, number>`（键 = nodeType），`observedAt` 时间戳。
- **边沿触发**告警：某类型**首次**命中 → 立即 `log.warn({ nodeType, uncoveredTypes: N }, '未覆盖类型 — 静默放行 (degraded)')`；之后**每新增 20 种**再汇总一条 ⇒ 一次诊断的日志量 = O(去重类型数 / 20)，不会逐条刷屏。
- **显式清单导出**（供探针/门禁读取，免去"只报数无从定位"）：`getUncoveredTypeStats(): { uncoveredTypes: string[]; count: number }`。
- **测试/诊断隔离**：`resetUncoveredTypeStats()`（探针与测试的确定性入口）。

### 3.3 报警文案（判据原文对齐）

判据 V1 的 grep 目标 = **`未覆盖类型`**，判定原文要求出现 **`未覆盖类型 N 个`**。因此告警的 `msg` 固定为：
- 首次：`未覆盖类型 — 静默放行 (degraded)`（含 `nodeType`，满足 V3）
- 汇总：`未覆盖类型 N 个`（N = 一次诊断内去重聚合数，满足 V2）
两行都含判据子串 ⇒ `grep -q '未覆盖类型'` 稳定命中。

### 3.4 契约（铁律 47，写前定义）

| 函数 | @input | @output | @degraded / @error |
|---|---|---|---|
| `validateNodeProps` | `nodeType: string`, `props: Record<string, unknown>` | `ValidationError[]`；未覆盖类型 → 含 `degraded:true` 的单元素数组；**绝不抛** | `@degraded` 未覆盖类型（元素标记 + 聚合计数 + 边沿告警）；`@error` 无 |
| `validateAndLog` | 同上 | `boolean`（`true` = 无校验错误，**含未覆盖类型**） | `@degraded` 同上（透传）；语义不变 |
| `getUncoveredTypeStats` | — | `{ uncoveredTypes: string[]; count: number }`（按首次命中序） | 空态 → `count: 0` |
| `resetUncoveredTypeStats` | — | `void` | — |
| `probe-diagnosis.ts`（新建） | 命令行参数：`--json`（可选） | **stdout 输出诊断运行报告**（含 `未覆盖类型 N 个` 行 + 类型清单）；退出码 0 = 跑通 | `@degraded` 真库不可用 → 显式打 `log.warn` + 非 0 退出（**不静默**） |

---

## 4. 写集（逐文件声明）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/l4/sog-schema-validator.ts` | 修改 | 唯一产品代码改动（§2/§3） |
| `scripts/control-tower/probe-diagnosis.ts` | **新建** | 判据交付物（卡面 §③ 约束 6）。⚠️ 治理线窗（单写者序列）— §8 |
| `tests/l4/sog-schema-validator.test.ts` | 新建 | 单元：正常/降级/边界 + 聚合去重 + 文案（mock logger） |
| `tests/l4/sog-schema-validator.integration.test.ts` | 新建 | 真 SQLite（`/tmp` tmpdir）⇒ R26「凡真库路径至少一条 integration 覆盖」 |
| `docs/synova/product-lines/evidence/980/**` | 新建 | 证据落点（M5） |

**明确不碰**：`src/l4/graph-bridge.ts`（§3.1 裁定后无需）、`packages/ontology/src/node-types.ts`（卡面 §③ 约束 7）、`extensions/ontology/**`（补 Schema 属后续卡）、`scripts/audit/**`、`.github/workflows/**`、`src/growth/**` + `src/routes/workspace-data.ts`（#1322 写集）。

**PR 预算核对**：产品/测试文件 4 个 ≤ 12 ✅；单域 = L4 本体层 ✅；治理产物（evidence）不计入 ✅。

---

## 5. 测试计划（先测试后实现：spec → test → impl → wire → review）

### 5.1 单元测试 `tests/l4/sog-schema-validator.test.ts`（铁律 48：正常/降级/边界三路径）

| # | 用例 | 断言（有 expect） |
|---|---|---|
| U1 正常 | 已知 8 键（如 `GOAL`）合法 props | `errors.length === 0`；**无** `degraded` 元素 |
| U2 正常/降级分界 | 已知键 + 违规 props | 返回错误元素，且**不含** `degraded:true`（两态互斥，防"一改就全标降级"） |
| U3 降级 | 未覆盖类型（如 `resource/money`） | `errors.length === 1` 且 `errors[0].degraded === true`；`getUncoveredTypeStats().count === 1` |
| U4 聚合去重 | 同一未覆盖类型写 5 次 + 另一未覆盖类型 1 次 | `count === 2`、`uncoveredTypes` 长度 2（**不是 6**） |
| U5 告警文案 | mock logger 捕获调用 | 恰好出现含 `未覆盖类型 N 个` 的汇总行；首行含 `nodeType` |
| U6 不刷屏（边界） | 40 种未覆盖类型各写 1 次 | `log.warn` 调用数 ≤ 1 + ceil(40/20) = 3（上界断言） |
| U7 隔离（边界） | `resetUncoveredTypeStats()` 后再写 | 计数归零后重新计数 |

### 5.2 集成测试 `tests/l4/sog-schema-validator.integration.test.ts`（真库）

- 夹具：`better-sqlite3` 打开 `/tmp/<rand>/probe.db` → `new SqliteGraphStore(db)` → `createGraphBridge(store, 'org-980')`。
- I1：写 1 个未覆盖类型节点 ⇒ **`createNode` 返回非空 nodeId**（V4 不阻断）且 store 内可读回。
- I2：写 40 个 distinct 斜杠类型（取自 `@synova/ontology` 常量）⇒ 统计 `count === 40`，且 `'GOAL'` 类型**不在**未覆盖清单（负例对照）。
- I3（**判别性夹具**）：mock `createLogger` 的 warn 计数 = 0 时断言红 ⇒ 证明"告警真的被调用"，而非只断言数组长度。
- I4：临时库清理 + 断言 `extensions/industries/**` 6 个 thresholds.json 哈希未变（R28 地雷自查，见 §7）。

### 5.3 探针 `scripts/control-tower/probe-diagnosis.ts`

- 行为：`resetUncoveredTypeStats()` → 在 `/tmp` 建真 SQLite 库 → `SqliteGraphStore` + `createGraphBridge` → 逐类型写节点（覆盖 40 个斜杠类型 + 8 个大写键）→ **stdout 打印**：
  - 行1：`写入 N 个节点，全部返回 nodeId（未阻断）`
  - 行2：`未覆盖类型 N 个`（N 取自 `getUncoveredTypeStats()`）
  - 行3：类型清单（V3 可核）
  - 可选 `--json` 输出机器可读形态
- 退出码：跑通 0；真库不可用 → `log.warn` + 非 0（铁律 24 不静默）。
- **判据 V1 即**：`bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q '未覆盖类型'"` ⇒ exit 0。

---

## 6. 判据怎么跑 + 反例怎么红（卡面 §⑥ 逐条对齐）

| 判据 | 怎么跑 | 期望 |
|---|---|---|
| V1 | `bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 \| grep -q '未覆盖类型'"`（原始输出全量落 evidence） | exit 0 |
| V2 | 同上，人工核一行内出现 `未覆盖类型 N 个`，N = 去重聚合数与 U4/I2 一致 | 出现 |
| V3 | 核告警/清单含 `nodeType`（或类型清单行） | 可定位 |
| V4 | I1：命中 `:141` 路径下 `store.createNode` 仍返回 nodeId；改动前后各跑一次对照 | 行为不变 |
| V5（反例·必红） | 把 `:141` 改回 `if (!schema) return [];`（无日志无计数）⇒ 跑 V1 | **必红**（grep 空 + 探针无汇总行） |
| V6（反例·必红） | 把降级元素上的 `degraded` 去掉（或不写回返回值）⇒ 跑 U3 | **必红**（铁律 31 传播断言失败） |
| 反例留痕 | 变异 → 跑 → 原文留档 → 还原 → 再跑 → 原文留档（**前后两段都进 evidence**） | 齐全 |

**变异测试文件放置**：临时变异只在工作树内做，**不留残骸**（改回后 `git diff --stat` 必须只剩预期改动）。红证不残留 ⇒ 提交前用 `git diff` 复核。

---

## 7. 安全与副作用纪律

1. **探针只写 `/tmp`（Windows = `%TEMP%`）**：跑前记 `git status --porcelain` 基线 + 6 个 thresholds.json SHA256；跑后**逐字比对**（R28 地雷：`batch0a-probes.ts` 曾改写真仓库 `extensions/industries/*/thresholds.json` 206 行）。本卡探针**禁止**在仓库根写任何行业配置。
2. **不碰**：`scripts/audit/**`（红线）、`.github/workflows/**`（治理线窗）、`packages/ontology/src/node-types.ts`。
3. **禁**：`--no-verify` / `--admin` / force push / `git stash`。
4. **量真值**：一律 `git show origin/main:<path>` / `git grep ... origin/main`，**禁读工作树**当权威。
5. **新 export 接线**：`getUncoveredTypeStats` / `resetUncoveredTypeStats` 的**生产消费者 = `probe-diagnosis.ts`**（同 PR 内落地）；若 pre-commit 组 4 只扫 `src/`，PR 正文写明该消费方在 `scripts/`（避免"写了没接"误判为未接线）。

---

## 8. ⚠️ 治理线窗（必须先报 CTO 的排期项）

卡面 §⑧ 原文：**改 `scripts/control-tower/**` 须并入治理线窗（单写者序列）**。本卡判据交付物 `scripts/control-tower/probe-diagnosis.ts` **正是该目录**（目录内 92 文件；`probe*` 零命中 ⇒ 无同名冲突）。

- **请求**：在治理线窗为该文件（新建）插入一个单写者时隙；在未获时隙前，我**不写**该文件。
- **可替代方案（供 CTO 选）**：若线窗排期紧，可把探针第 1 版落 `tests/`（不在治理线窗）并在 PR 正文标注"判据命令路径偏差"，待线窗开放再迁移——**但此属判据路径变更，须 CTO 裁**（R31：指令与门禁冲突时以门禁为准 + 上报 + 写明偏离；本项属"判据路径"而非门禁，故先请示不自行改）。
- 相邻卡（#986 `probe-skills.ts`、#985 `probe-tool-policy.ts`、#978 涉治理线窗）**各自独立文件名**，与我无同名冲突；但**同目录单写者** ⇒ 建议 CTO 统一排期（本批 4 张卡中 3 张要落该目录）。

---

## 9. 小队编成（待放行后启动；本阶段仅计划）

| 角色 | 人数 | 写集 | 备注 |
|---|---|---|---|
| 队长（我） | 1 | 不写码 | 只协调 / 判前提 / 验证据 / 汇总 |
| 编码 A（executor） | 1 | `src/l4/sog-schema-validator.ts` + `tests/l4/sog-schema-validator*.test.ts` | 单写者 |
| 编码 B（probe owner） | 1 | `scripts/control-tower/probe-diagnosis.ts`（**须先获线窗时隙**） | 与 A 写集互斥；若线窗未开则该席不启动 |
| 自验员（verifier） | 1 | 只读（仅 `/tmp` 可写） | **不得由编码兼任**；产出「自验结论」不作"通过"判定 |

- 成员总数 ≤ 4 ✅；重型验证（tsc / vitest / 门禁）**串行**，同一时间 ≤ 1 个在跑（本机 8GB）。
- 队内只产出「自验结论 / 可提请独立审计 / 退回（附理由）」；**通过与否归 CTO 收件闸 + K3 终审**。

---

## 10. 验证与门禁（放行后执行；串行）

| 步骤 | 命令 | 说明 |
|---|---|---|
| 依赖安装（先量后加负载） | `bash scripts/control-tower/install-deps.sh`（工作树内） | 工作树现无 `node_modules`；CI 同款入口 |
| 类型 | `npx tsc --noEmit` | 铁律 38（`as any` 零容忍） |
| 单元+集成 | `npx vitest run tests/l4/sog-schema-validator.test.ts tests/l4/sog-schema-validator.integration.test.ts` | 先红后绿：先写测试确认红 ⇒ 实现 ⇒ 绿 |
| 架构 | `bash scripts/check-architecture.sh` | 本卡不新增跨层 import |
| 门禁 | `bash scripts/pre-commit-check.sh` | 13 组；**CI 为权威** |
| 提交 | `bash scripts/control-tower/synova-commit --task-id 2026-10-08-win-0-6-schema-degraded --agent DSH --message "..."` | ⚠️ 该工具**自带 push** ⇒ 禁手工再推（M4） |
| PR | `feat/` 前缀，正文含**回执三信号**：改了什么(含 SHA)｜判据原始输出｜未解决项；**声明 base = main** | 不推 main |
| 交付回执 | `git ls-remote --heads origin \| grep feat/win-0-6-schema-degraded` 原始输出 | 工作书要求 |

**Done 每条带 verify 命令**（写进卡面 §⑦ 回填时逐条挂命令）：

| Done | verify 命令 |
|---|---|
| D1 未覆盖类型可见 | `npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 \| grep -n "未覆盖类型"` |
| D2 计数为去重聚合 | 同上输出中 `未覆盖类型 N 个` 的 N 与 I2 的 40 一致 |
| D3 不阻断 | I1 断言 + 改动前后 `createNode` 返回值对照原文 |
| D4 降级信号可传播（铁律 31） | `npx vitest run tests/l4/sog-schema-validator.test.ts -t "degraded"` |
| D5 真库路径有覆盖（R26） | `npx vitest run tests/l4/sog-schema-validator.integration.test.ts` |
| D6 无红证残留 | `git diff --stat`（仅 4 个预期文件）+ `git status --porcelain` 干净 |
| D7 无副作用 | 6 个 thresholds.json 跑前/跑后 SHA256 相同（原文对照） |

---

## 11. 待裁项（提请 CTO）

1. **§3.1 选型 (b')**：不改签名、不改 `graph-bridge.ts` —— 请确认（卡面 §③ 约束 2 推荐 (b)；本计划给出**不扩写集的 (b)** 形态，属对卡面的**收窄**，需 CTO 知悉）。
2. **§8 治理线窗时隙**：`scripts/control-tower/probe-diagnosis.ts` 何时可写（或是否批准改落 `tests/`）。
3. **`pool/*`(15) + `external/*`(1) 无 JSON Schema 源**（卡面 §③ 约束 5）：本卡只做"可见"；是否立新卡补源，请 CTO 裁。
4. **命名撞车**：本文件 `ValidationError` 与 `@synova/error-types` 的 `ValidationError`（`packages/error-types/src/index.ts:173`）同名异义 ⇒ 属 N4 收敛，本卡**不改名**，建议登记（不自行扩范围）。

---

## 12. 本计划自身的证据落点（M5）

- 本文件：`docs/synova/product-lines/evidence/980/PLAN-980-0-6-schema-degraded.md`
- 引用扫描全文：工作树 `.claude/reference-map.md`（61 处；**该文件是本机产物，按 D539 主树只读纪律不提交**，关键结论已摘入 §1）
- 前提实测原始输出：见 §0 表 + 本会话命令记录；放行后逐条重跑并全量落 `evidence/980/`
