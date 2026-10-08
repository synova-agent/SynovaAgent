# VERIFY-980-acceptance — #980 / 施工项 0-6「SOG schema 可见降级」判据 V1–V6b 独立复现 + 真变异

| 项 | 值 |
|---|---|
| 任务 | `task-5`（共享板）「自验β · #980 判据 V1–V6 独立复现 + 真变异」 |
| 执行人 | `verifier-980-accept`（独立自验员 β，非编码方） |
| 工作树 | `D:\novis-backup-20260526\Novis\.synova-wt-980` |
| HEAD | `c231d80e813a687526ac57085de285bb11be3424`（分支 `feat/win-0-6-schema-degraded`） |
| 窗口 | 2026-10-08 02:11 → 02:16（+0800） |
| 本席写过的仓库文件 | ① 本报告；② `src/l4/sog-schema-validator.ts`（仅变异窗口内，已 `cp` 还原至冻结值） |
| 结论用词 | 只给「自验结论 / 可提请独立审计 / 退回」——**不判"通过"** |

---

## 0. 冻结版本核对（开工第一件事）

命令（工作树根）：

```bash
sha256sum src/l4/sog-schema-validator.ts docs/synova/product-lines/evidence/980/probe-diagnosis.ts docs/synova/product-lines/evidence/980/capture-980-probe.sh
```

原始输出（开工 02:11）：

```
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
759a115ae3f96ecfd0dad0ffdbfada053d46dae4054a3c8758f6d1cb3cd89ae5 *docs/synova/product-lines/evidence/980/probe-diagnosis.ts
6181e7c9ed8739983490375b0e5f549779c38b108e61e4f3c57f377d4b6f5c9b *docs/synova/product-lines/evidence/980/capture-980-probe.sh
```

| 文件 | 卡面冻结 sha256 | 实测 sha256 | 判定 |
|---|---|---|---|
| `src/l4/sog-schema-validator.ts` | `741f671b…5167` | `741f671b…5167` | 一致 |
| `docs/…/probe-diagnosis.ts` | `759a115a…9ae5` | `759a115a…9ae5` | 一致 |
| `docs/…/capture-980-probe.sh` | `6181e7c9…5c9b` | `6181e7c9…5c9b` | 一致 |

→ 三个冻结 sha256 全部一致，**未触发"停手"条件**，继续执行。

`HEAD = c231d80e813a687526ac57085de285bb11be3424` 与卡面 `c231d80e8` 一致。

**还原锚点**（变异前建立，纪律 §1）：

```bash
mkdir -p /tmp/synova-980-verify && cp src/l4/sog-schema-validator.ts /tmp/synova-980-verify/validator.frozen.ts
sha256sum /tmp/synova-980-verify/validator.frozen.ts
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 */tmp/synova-980-verify/validator.frozen.ts
```

（`/tmp` 实测映射到 `C:\Users\Administrator\AppData\Local\Temp`。）

### 0.1 并发快照（纪律 §3：变异/重型验证窗口内不得有他人跑 vitest）

`tasklist | grep -i node` 原始输出（全窗口一致）：

```
node.exe                      7304 Console                    1     27,976 K
node_repl.exe                 5900 Console                    1      8,900 K
node.exe                      4624 Console                    1     29,180 K
node.exe                     15572 Console                    1     30,084 K
node_repl.exe                  536 Console                    1      8,928 K
```

`Get-CimInstance Win32_Process` 核对其 CommandLine：5 个进程全部为 `OpenAI\Codex\runtimes\cua_node\…`（Codex 运行时 / `cua-repl` / `server.mjs`），**无 vitest / tsx 进程**。每次 vitest 跑前均重拍此快照（见 §V6/V6b 原文）。

---

## V1-登记原文 / V1-加固

命令（逐字照卡面）：

```bash
npx tsx docs/synova/product-lines/evidence/980/probe-diagnosis.ts 2>&1 | grep -q '未覆盖类型'
npx tsx docs/synova/product-lines/evidence/980/probe-diagnosis.ts 2>&1 | grep -qE '未覆盖类型 [1-9]'
```

原始输出（探针完整 stdout+stderr，未截断）：

```
{"level":30,"time":1791396698380,"pid":11116,"hostname":"PC-202605261327","name":"synova-agent","service":"store/schema-migration","version":2,"name":"graph-nodes-props","msg":"执行迁移 2: graph-nodes-props"}
{"level":30,"time":1791396698381,"pid":11116,"hostname":"PC-202605261327","name":"synova-agent","service":"store/schema-migration","version":2,"msg":"迁移 2 完成"}
{"level":40,"time":1791396698382,"pid":11116,"hostname":"PC-202605261327","name":"synova-agent","service":"l4/sog-schema-validator","nodeType":"activity/production","uncoveredTypes":["activity/production"],"uncoveredTypesCount":1,"msg":"未覆盖类型 — 静默放行 (degraded)"}
{"level":40,"time":1791396698386,"pid":11116,"hostname":"PC-202605261327","name":"synova-agent","service":"l4/sog-schema-validator","nodeType":"resource/agent","uncoveredTypes":["activity/production","activity/acquisition","activity/innovation","activity/coordination","activity/learning","activity/governance","activity/maintenance","activity/compliance","outcome/financial","outcome/market","outcome/operational","outcome/people","outcome/innovation","outcome/risk","outcome/competitive","outcome/external","resource/money","resource/person","resource/team","resource/agent"],"uncoveredTypesCount":20,"msg":"未覆盖类型 20 个"}
{"level":40,"time":1791396698389,"pid":11116,"hostname":"PC-202605261327","name":"synova-agent","service":"l4/sog-schema-validator","nodeType":"external/baseline","uncoveredTypes":["activity/production","activity/acquisition","activity/innovation","activity/coordination","activity/learning","activity/governance","activity/maintenance","activity/compliance","outcome/financial","outcome/market","outcome/operational","outcome/people","outcome/innovation","outcome/risk","outcome/competitive","outcome/external","resource/money","resource/person","resource/team","resource/agent","resource/tool","resource/knowledge","resource/client","resource/brand","resource/data","resource/ip","resource/location","resource/channel","resource/supplier","pool/capital","pool/human_capital","pool/equipment_capacity","pool/knowledge","pool/brand","pool/reputation","pool/data","pool/revenue","pool/sensing","pool/activity","external/baseline"],"uncoveredTypesCount":40,"msg":"未覆盖类型 40 个"}
写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK
未覆盖类型 40 个
- activity/production
- activity/acquisition
- activity/innovation
- activity/coordination
- activity/learning
- activity/governance
- activity/maintenance
- activity/compliance
- outcome/financial
- outcome/market
- outcome/operational
- outcome/people
- outcome/innovation
- outcome/risk
- outcome/competitive
- outcome/external
- resource/money
- resource/person
- resource/team
- resource/agent
- resource/tool
- resource/knowledge
- resource/client
- resource/brand
- resource/data
- resource/ip
- resource/location
- resource/channel
- resource/supplier
- pool/capital
- pool/human_capital
- pool/equipment_capacity
- pool/knowledge
- pool/brand
- pool/reputation
- pool/data
- pool/revenue
- pool/sensing
- pool/activity
- external/baseline
```

退出码原文：

```
probe_exit=0
V1_registry_pipeline_exit=0        ← V1-登记原文，命中
V1_hardened_pipeline_exit=0        ← V1-加固，命中
grep_n_exit=0
```

**V1-登记原文 = exit 0 ✅；V1-加固 = exit 0 ✅**

留存原文：`/tmp/synova-980-verify/v1-run1.txt`（3153 字节）。

---

## V2-文本计数 N=40 / V2-`--json` 交叉核对

命令：

```bash
npx tsx docs/synova/product-lines/evidence/980/probe-diagnosis.ts --json
grep -oE '未覆盖类型 [0-9]+ 个' /tmp/synova-980-verify/v1-run1.txt
```

人读形态里 `未覆盖类型 N 个` 的原始命中（全文 3 处，均列出）：

```
未覆盖类型 20 个     ← log.warn 边沿汇总（第 20 种 distinct）
未覆盖类型 40 个     ← log.warn 边沿汇总（第 40 种 distinct）
未覆盖类型 40 个     ← stdout 终值行（探针读取 getUncoveredTypeStats().count）
```

`--json` stdout 原文（单行 JSON，完整）：

```
{"written":40,"readBackOk":40,"count":40,"uncoveredTypes":["activity/production","activity/acquisition","activity/innovation","activity/coordination","activity/learning","activity/governance","activity/maintenance","activity/compliance","outcome/financial","outcome/market","outcome/operational","outcome/people","outcome/innovation","outcome/risk","outcome/competitive","outcome/external","resource/money","resource/person","resource/team","resource/agent","resource/tool","resource/knowledge","resource/client","resource/brand","resource/data","resource/ip","resource/location","resource/channel","resource/supplier","pool/capital","pool/human_capital","pool/equipment_capacity","pool/knowledge","pool/brand","pool/reputation","pool/data","pool/revenue","pool/sensing","pool/activity","external/baseline"],"nodeIds":["node-cd162648-1274-4434-f569-be62c8dcc8c3","node-c3fc50f0-48d6-4335-6d41-1107b02bcfa9","node-55be1511-54e6-4a75-c1c1-3dbc7501cf4c","node-3d230365-f3c0-43ce-d117-da2496d53586","node-ca027b3b-0e25-475c-9e25-9da0844ad27d","node-bb79c235-d314-422c-bba2-53a7ec39ad6b","node-176949b9-06e3-47b5-af8d-8b6639367181","node-d0d9a537-ac5a-4d3f-b64c-12684aad1d96","node-918da522-de31-4b21-ec2b-ba3837ced4c7","node-bc29e81e-5206-455f-7b74-4fa3e43afb0b","node-ff25e5aa-666a-4173-4500-8c5a72702762","node-deb7523f-f437-4f61-ee32-5b0d3c934413","node-b9bc6080-74ec-4ec8-196c-81bea181f6d4","node-20598b17-062b-4593-b21c-ecf12a19558f","node-bc7b7c11-2c33-431f-257c-a33960dce4c9","node-26513569-35f3-49c1-1f52-da725a20274f","node-2f90ce1b-a9ce-4250-1220-3819da691218","node-46faa56c-64f4-4d2b-5a17-ebd13b72aed7","node-6c01e94d-20cb-468b-7744-5900edb4ec51","node-c6f5b025-7db1-4279-3409-1aabf41d5a13","node-fce4d9b2-e07e-4cd5-b2de-6b12425e02a2","node-7a03e198-2776-4d73-f8e4-2d3804eb960a","node-4f9ebfb8-6b01-4c1b-1eef-a3867404d31c","node-f4cb3021-5a0b-454f-ed5f-29721de4ae81","node-6bd01d2d-33dc-48e5-49eb-003e4fb3dd3a","node-5df20241-5a00-4696-c34f-9c5c78fa4547","node-dcc35c3f-dde2-4e2f-ee63-11bb5653b6a7","node-a0c149b7-4bfa-426f-06f3-a762ce546fab","node-f4a28975-a1dc-42c8-1c6d-04f0e0a98ff6","node-5b155d7c-b527-46d1-d98a-482edc8047c4","node-959cfc1c-3705-40c2-4b35-100bd91fa1fc","node-62c7ca59-5cb7-420b-7f3d-f643c3e60470","node-3038d543-545d-454d-b0e6-4ce900073a36","node-b1ce6643-7200-4aee-473c-6caa7d74b140","node-f263f005-91df-4009-d599-44f3f676dcc9","node-d74a0bbd-4d5b-48b6-23e6-f7e4bb8070ed","node-9f3204cb-977c-4308-f589-34ef033d86f5","node-9fbc3d43-ca3d-474f-036c-c5a6b1626071","node-7689ee4d-6989-4524-0e83-a06fcbf4926f","node-dde465dc-7090-45bf-cb85-09cab38b28b3"]}
```

字段严格比对（本席自写 node 解析器，非编码方脚本；`json_exit=0`）：

```
json_lines_in_stdout=1
written=40
readBackOk=40
count=40
uncoveredTypes.length=40
nodeIds.length=40
distinct(nodeIds)=40
ASSERT written===40 -> true
ASSERT readBackOk===40 -> true
ASSERT count===40 -> true
ASSERT written===readBackOk===40 -> true
ASSERT uncoveredTypes.length===count -> true
ASSERT nodeIds 40 个且两两不同且非空 -> true
node_parse_exit=0
```

**V2 = 满足**：文本 `未覆盖类型 40 个`（终值行）；JSON `count === 40` 且 `written === readBackOk === 40`。

> 备注（原文留档，不作扣分）：文本形态还会出现 `未覆盖类型 20 个` —— 这是设计内的边沿汇总（`UNCOVERED_SUMMARY_EVERY = 20`，每新增 20 种 distinct 汇总一次）。**终值行 = 40**，与 JSON `count=40` 自洽。

---

## V3-可定位性（`nodeType` / 类型清单）

命令与原始输出：

```bash
grep -o '"nodeType":"[^"]*"' /tmp/synova-980-verify/v1-run1.txt
"nodeType":"activity/production"
"nodeType":"resource/agent"
"nodeType":"external/baseline"
V3_nodeType_grep_exit=0

grep -o '"uncoveredTypes":\[[^]]*\]' /tmp/synova-980-verify/v1-run1.txt | cut -c1-200
"uncoveredTypes":["activity/production"]
"uncoveredTypes":["activity/production","activity/acquisition","activity/innovation","activity/coordination","activity/learning","activity/governance","activity/maintenance","activity/compliance","out
"uncoveredTypes":["activity/production","activity/acquisition","activity/innovation","activity/coordination","activity/learning","activity/governance","activity/maintenance","activity/compliance","out
V3_uncoveredTypes_grep_exit=0
```

人读清单（stdout 第 7 行起，逐类型可定位）：

```
未覆盖类型 40 个
- activity/production
- activity/acquisition
- activity/innovation
- activity/coordination
- activity/learning
```

**V3 = 满足**：告警 JSON 载荷同时含 `nodeType`（触发者）与 `uncoveredTypes` 全量清单；stdout 另逐行列出 40 个类型。

---

## V4-`store.createNode` 命中 `:141` 路径仍返回 nodeId 且可 `getNode` 读回；改动前后行为一致（自跑对照）

**`:141` 锚点核对**（确认卡面指的就是改造前那行静默放行）：

```bash
git show HEAD:src/l4/sog-schema-validator.ts | awk 'NR==141 {printf "HEAD:141 = %s\n", $0}'
HEAD:141 =   if (!schema) return []; // 未知类型 — 不校验（允许扩展）
awk 'NR==141 {printf "WT:141   = %s\n", $0}' src/l4/sog-schema-validator.ts
WT:141   =     uncoveredTypesCount: distinct,                 // N = 当前 distinct 数
```

即：`:141` = **改造前**（HEAD / pre-#980）的 `if (!schema) return []` 静默放行行；改造后该分支被移入 `if (!schema) { … degraded … }`。

**生产接线路径确认**（`src/l4/graph-bridge.ts`，`createGraphBridge` 包装 `store.createNode` → `validateAndLog`）：

```
79:   const _createNode = store.createNode.bind(store);
81:   store.createNode = (type: string, props: Record<string,unknown>, g: string): string => {
82:     validateAndLog(type, props);
…
121:    return _createNode(type, props, g);
```

**自跑 A/B 对照**（同一探针、同一命令，仅校验器状态不同；探针 40 次 `store.createNode` + 40 次 `getNode` 读回）：

| 状态 | 探针输出（stdout 原文） | 退出码 |
|---|---|---|
| A：冻结态（#980 可见降级，`degraded` 元素） | `写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK` | 0 |
| B：变异态 = HEAD `:141` 静默放行形态（见 V5） | `写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK` | 0 |

`OK` 后缀由探针内 `M === K && idFormOk && idUniqueOk` 判定（`M`=写入类型数 40，`K`=读回成功数 40，`idFormOk`=id 非空且≠类型串，`idUniqueOk`=两两不同）；JSON 形态另证 `nodeIds.length = 40`、`distinct = 40`。

**V4 = 满足**：`:141` 静默放行形态（B）与 #980 可见降级形态（A）下，`createNode` 均返回 nodeId 且均可由 `getNode(返回值)` 读回，行为逐字一致（40/40/OK）。

---

## V5-真变异（必红）→ `cp` 锚点还原（必绿）

**变异内容**：把 `validateNodeProps` 里 `if (!schema) {`
起的降级分支整段还原为 HEAD 形态 `if (!schema) return []; // 未知类型 — 不校验（允许扩展）`。

**变异 diff 原文**（`diff -u <frozen 锚点> <变异态>`，`diff_exit=1`）：

```diff
--- /tmp/synova-980-verify/validator.frozen.ts	2026-10-08 02:11:08.130657100 +0800
+++ src/l4/sog-schema-validator.ts	2026-10-08 02:12:59.363014700 +0800
@@ -197,17 +197,7 @@
  */
 export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {
   const schema = NODE_SCHEMAS[nodeType];
-  if (!schema) {
-    // #980 / 0-6: 原 `return []` 为静默放行 —— 现改为「放行 + 可见降级」（不阻断写入）
-    recordUncoveredType(nodeType);
-    return [{
-      nodeType,
-      field: '*',
-      value: null,
-      expected: 'schema 未覆盖 — 放行 (degraded)',
-      degraded: true,
-    }];
-  }
+  if (!schema) return []; // 未知类型 — 不校验（允许扩展）
 
   const errors: ValidationError[] = [];
 
```

**变异态跑探针（完整原文）**：

```
probe_exit_in_mutation=0
{"level":30,"time":1791396790183,"pid":2768,"hostname":"PC-202605261327","name":"synova-agent","service":"store/schema-migration","version":2,"name":"graph-nodes-props","msg":"执行迁移 2: graph-nodes-props"}
{"level":30,"time":1791396790184,"pid":2768,"hostname":"PC-202605261327","name":"synova-agent","service":"store/schema-migration","version":2,"msg":"迁移 2 完成"}
写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK
未发现未覆盖的类型（count=0）
WARN: 未覆盖的类型计数 0 ≠ 写入类型数 40 — 原样上报，未修改任何计数
```

（注意：`未发现未覆盖的类型（count=0）` 与 `未覆盖的类型计数 …` 两行**均不含**子串 `未覆盖类型` —— 子串判别力成立。）

**变异态两条判据（必红）**：

```bash
npx tsx $PROBE 2>&1 | grep -q '未覆盖类型'
V5_V1_registry_exit(期望 1 = 红)=1

npx tsx $PROBE 2>&1 | grep -qE '未覆盖类型 [1-9]'
V5_V1_hardened_exit(期望 1 = 红)=1
```

**还原（`cp` 锚点，禁用 `git checkout --`）**：

```
cp "$OUT/validator.frozen.ts" "$F"
cp_exit=0
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
diff -u <frozen 锚点> <还原后>
diff_exit_after_restore(期望 0 = 零差异)=0
```

**还原后复跑 V1（完整原文，含 3 条 warn + 40 行清单）**：

```
probe_exit_after_restore=0
{"level":30,...,"msg":"执行迁移 2: graph-nodes-props"}
{"level":30,...,"msg":"迁移 2 完成"}
{"level":40,...,"nodeType":"activity/production","uncoveredTypes":["activity/production"],"uncoveredTypesCount":1,"msg":"未覆盖类型 — 静默放行 (degraded)"}
{"level":40,...,"nodeType":"resource/agent","uncoveredTypes":[... 20 项 ...],"uncoveredTypesCount":20,"msg":"未覆盖类型 20 个"}
{"level":40,...,"nodeType":"external/baseline","uncoveredTypes":[... 40 项 ...],"uncoveredTypesCount":40,"msg":"未覆盖类型 40 个"}
写入 40 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = 40 OK
未覆盖类型 40 个
- activity/production
- activity/acquisition
…（40 行，完整原文见 /tmp/synova-980-verify/v5-restored-probe.txt，3153 字节；
  机器比对：剥掉 pino 日志行后与 V1 冻结态原文 diff = 0 差异 → `IDENTICAL（非 pino 日志行逐行一致）`）
- external/baseline

V5_V1_registry_exit_after_restore(期望 0 = 绿)=0
```

**V5 = 满足**：变异态 V1-登记原文 **红（exit 1）**、V1-加固 **红（exit 1）**；`cp` 还原后 V1 **绿（exit 0）**，且与 frozen 锚点零差异。

---

## V6-真变异（必红）→ 还原（必绿）

**变异内容**：`validateAndLog` 内 `const hardErrors = errors.filter(e => !e.degraded);` → `const hardErrors = errors;`
（施加方式：单脚本内 node 定点替换，替换前断言锚点命中数 === 1，否则拒绝变异并 abort：`MUTATED ok (anchor 命中 1 次)`。）

**变异 diff 原文**（`diff_exit=1`）：

```diff
--- /tmp/synova-980-verify/validator.frozen.ts	2026-10-08 02:11:08.130657100 +0800
+++ src/l4/sog-schema-validator.ts	2026-10-08 02:13:37.734918300 +0800
@@ -242,7 +242,7 @@
 export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {
   const errors = validateNodeProps(nodeType, props);
   // #980 / 0-6: 显式区分「硬错误」与「未覆盖降级」—— degraded 元素不得触发阻断或假失败文案
-  const hardErrors = errors.filter(e => !e.degraded);
+  const hardErrors = errors;
   if (hardErrors.length === 0) return true;
 
   for (const e of hardErrors) {
```

**基线绿（变异前，冻结态；单元 + 集成一起跑）**：

```
npx vitest run tests/l4/sog-schema-validator.test.ts tests/l4/sog-schema-validator.integration.test.ts
vitest_exit=0
 ✓ tests/l4/sog-schema-validator.test.ts (7 tests) 16ms
 ✓ tests/l4/sog-schema-validator.integration.test.ts (4 tests) 119ms
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

**变异态（必红）**——原始输出完整：

```
npx vitest run tests/l4/sog-schema-validator.test.ts
vitest_exit_in_mutation(期望非 0)=1

 RUN  v5.0.2 D:/novis-backup-20260526/Novis/.synova-wt-980

 ❯ tests/l4/sog-schema-validator.test.ts (7 tests | 1 failed) 18ms
   ✓ #980 SOG schema 校验器 — 已知 schema 路径（正常/违规） (2)
     ✓ U1 已知 schema + 合法 props ⇒ 0 错误 / validateAndLog true / 无 degraded 元素 / 零告警 4ms
     ✓ U2 已知 schema + 违规 props ⇒ 有错误 / 元素不含 degraded 字段 / validateAndLog false / warn 含 校验失败 1ms
   ❯ #980 SOG schema 校验器 — 未覆盖类型路径（降级） (5)
     × U3 未覆盖类型 ⇒ 单元素 degraded / validateAndLog true（E2 关键）/ 登记聚合器 / 无假失败告警 8ms
     ✓ U4 去重聚合 ⇒ 同类型 ×5 + 另 1 种 = count 2（不是 6）/ 首见序 1ms
     ✓ U5 文案与假失败守卫 ⇒ 出现模板插值的 "未覆盖类型 20 个" 且"校验失败"出现 0 次 1ms
     ✓ U6 不刷屏上界 ⇒ 40 种 distinct 各 1 次 = 恰好 3 条 warn（1 + ceil(40/20)） 1ms
     ✓ U7 隔离 ⇒ reset 后计数归零、类型清单清空、再次写入从 1 重新开始 0ms

⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/l4/sog-schema-validator.test.ts > #980 SOG schema 校验器 — 未覆盖类型路径（降级） > U3 未覆盖类型 ⇒ 单元素 degraded / validateAndLog true（E2 关键）/ 登记聚合器 / 无假失败告警
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/l4/sog-schema-validator.test.ts:91:50
     89|
     90|     // E2 关键断言：未覆盖类型必须放行（true），不得被判为"校验失败"而阻断
     91|     expect(validateAndLog('resource/money', {})).toBe(true);
       |                                                  ^
     92|     expect(countMessages('校验失败')).toBe(0);
     93|

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**还原 + 复跑（必绿）**：

```
cp "$OUT/validator.frozen.ts" "$F"
cp_exit=0
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
diff_exit_after_restore(期望 0)=0

npx vitest run tests/l4/sog-schema-validator.test.ts
vitest_exit_after_restore(期望 0)=0
 ✓ tests/l4/sog-schema-validator.test.ts (7 tests) 19ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**V6 = 满足**：变异必红（U3 在 `:91` 断言 `validateAndLog(...) === true` 失败 → `expected false to be true`）；还原后必绿（7/7）。

> 观察（原样上报，不作扩写）：本次变异只打红 U3。卡面提到"U3 的 `validateAndLog === true` **或** U5 的『校验失败文案 = 0』应失败"——实测 U3 已足以判别；U5 之所以未红，是因为 U5 只调用 `validateNodeProps`（不调用 `validateAndLog`），而"校验失败"文案产生于 `validateAndLog`。

---

## V6b-补充真变异（必红）→ 还原（必绿）

**变异内容**：去掉未覆盖元素上的 `degraded: true`（改为不设该字段）。
（施加方式：DSH `edit` 工具定点删除该行；还原仍走 `cp` 锚点。）

**变异 diff 原文**（`diff_exit=1`）：

```diff
--- /tmp/synova-980-verify/validator.frozen.ts	2026-10-08 02:11:08.130657100 +0800
+++ src/l4/sog-schema-validator.ts	2026-10-08 02:14:13.659467200 +0800
@@ -205,7 +205,6 @@
       field: '*',
       value: null,
       expected: 'schema 未覆盖 — 放行 (degraded)',
-      degraded: true,
     }];
   }
 
```

**变异态（必红）**——原始输出完整：

```
npx vitest run tests/l4/sog-schema-validator.test.ts
vitest_exit_in_mutation(期望非 0)=1

 RUN  v5.0.2 D:/novis-backup-20260526/Novis/.synova-wt-980

 ❯ tests/l4/sog-schema-validator.test.ts (7 tests | 1 failed) 19ms
   ✓ #980 SOG schema 校验器 — 已知 schema 路径（正常/违规） (2)
     ✓ U1 … 5ms
     ✓ U2 … 1ms
   ❯ #980 SOG schema 校验器 — 未覆盖类型路径（降级） (5)
     × U3 未覆盖类型 ⇒ 单元素 degraded / validateAndLog true（E2 关键）/ 登记聚合器 / 无假失败告警 8ms
     ✓ U4 … 1ms
     ✓ U5 … 1ms
     ✓ U6 … 1ms
     ✓ U7 … 0ms

⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯

 FAIL  tests/l4/sog-schema-validator.test.ts > #980 SOG schema 校验器 — 未覆盖类型路径（降级） > U3 未覆盖类型 ⇒ 单元素 degraded / validateAndLog true（E2 关键）/ 登记聚合器 / 无假失败告警
AssertionError: expected undefined to be true // Object.is equality

- Expected:
true

+ Received:
undefined

 ❯ tests/l4/sog-schema-validator.test.ts:88:32
     86|     expect(errors[0].value).toBeNull();
     87|     expect(errors[0].expected).toBe('schema 未覆盖 — 放行 (degraded)');
     88|     expect(errors[0].degraded).toBe(true);
       |                                ^
     89|
     90|     // E2 关键断言：未覆盖类型必须放行（true），不得被判为"校验失败"而阻断

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**还原 + 复跑（必绿）**：

```
cp "$OUT/validator.frozen.ts" "$F"
cp_exit=0
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
diff_exit_after_restore(期望 0)=0

npx vitest run tests/l4/sog-schema-validator.test.ts
vitest_exit_after_restore(期望 0)=0
 ✓ tests/l4/sog-schema-validator.test.ts (7 tests) 12ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**V6b = 满足**：变异必红（U3 在 `:88` 断言 `errors[0].degraded === true` 失败 → `expected undefined to be true`）；还原后必绿（7/7）。

---

## 变异前后 sha256 对照（证明还原干净）

| # | 文件状态 | 快照落点 | sha256 |
|---|---|---|---|
| 0 | **冻结值**（开工实测 = 卡面） | 工作树 + `/tmp/synova-980-verify/validator.frozen.ts` | `741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167` |
| 1 | V5 变异态 | `/tmp/synova-980-verify/validator.mutated-v5.ts` | `270a34e5b767728d801f04e7a043f016e2d002ec6908822bd9055cf2269c1923` |
| 2 | V6 变异态 | `/tmp/synova-980-verify/validator.mutated-v6.ts` | `5d9ab256166d00a10c8498b96e73784607389e2b4edc31092042a4877bbd29e5` |
| 3 | V6b 变异态 | `/tmp/synova-980-verify/validator.mutated-v6b.ts` | `94791959b812755edd1fe6d06dfad36c6f3bd5c7ea43712de5b70ec923249ec9` |
| 4 | **还原后终值**（V5 后 / V6 后 / V6b 后 / 收尾） | 工作树 | `741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167`（4 次复核全部相同） |

终检原始输出（`sha256sum` 三冻结文件，收尾）：

```
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
759a115ae3f96ecfd0dad0ffdbfada053d46dae4054a3c8758f6d1cb3cd89ae5 *docs/synova/product-lines/evidence/980/probe-diagnosis.ts
6181e7c9ed8739983490375b0e5f549779c38b108e61e4f3c57f377d4b6f5c9b *docs/synova/product-lines/evidence/980/capture-980-probe.sh
```

**还原手段声明**：全程只用 `cp /tmp/synova-980-verify/validator.frozen.ts src/l4/sog-schema-validator.ts`（4 次），**从未使用 `git checkout --`**；未用 `git stash`；未 `commit` / `push`；未加 `--no-verify`；未触碰 `scripts/**`、`extensions/**`。

---

## R28 地雷纪律（跑前 / 跑后基线）

**6 个 `thresholds.json` sha256** —— 跑前（02:11）与跑后（02:15）逐字一致：

```
2e71fae85f1674ed326dc22f8829a99930c3435163438d9ed3727a853613e7a7 *extensions/industries/financial-services/thresholds.json
e788884b942858b66b856a1fe83b62f476331254c4b2ffd5cb021332b92cbb72 *extensions/industries/general-enterprise/thresholds.json
424e913e2dd3c7724e117a17e736e2900d5c4492a3bf7b71ba54a1a749e6316d *extensions/industries/manufacturing/thresholds.json
32e52162a40036100e18ddefe177242e5ba3ae24aba538a330f1e335e06d4d0c *extensions/industries/retail-ecommerce/thresholds.json
226580f686c30c4ddb6700f83b3bc8825855442dbe25bf179520eaf1585344bc *extensions/industries/saas-tech/thresholds.json
43ec789b79a3f5ac91794d36f81b9f7afd1565d81ff7b49ff5a6206474083aea *extensions/industries/test-write/thresholds.json
```

**`git status --porcelain`** —— 跑前（02:11）与跑后（02:15）两次原文均列于本报告（跑前见 §V5 前置快照节、跑后见下），**人工逐行比对**：唯一新增为 `.claude/.g12-excl.tsv`、`.claude/.g12-scope.tsv` 两条 untracked（**非本席写入**，见「未解决项 U-2」）。

跑后原文：

```
 M .claude/reference-map.md
M  .claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md
M  src/l4/sog-schema-validator.ts
A  tests/l4/sog-schema-validator.integration.test.ts
A  tests/l4/sog-schema-validator.test.ts
?? .claude/.g12-excl.tsv
?? .claude/.g12-scope.tsv
?? docs/synova/product-lines/evidence/980/ENV-980-better-sqlite3-workaround.md
?? docs/synova/product-lines/evidence/980/VERIFY-980-env-verifier-980-env.md
?? docs/synova/product-lines/evidence/980/assemble-evidence.sh
?? docs/synova/product-lines/evidence/980/capture-980-probe.sh
?? docs/synova/product-lines/evidence/980/evidence-980-probe-run.txt
?? docs/synova/product-lines/evidence/980/probe-diagnosis.ts
```

（`?? docs/…/VERIFY-980-acceptance-verifier-980-accept.md` 即本报告，写入发生在上述快照之后。）

**会话窗口内 mtime 变化的仓库文件**（`find . -type f -newermt '2026-10-08 02:10:00'`，排除 `.git` / `node_modules`）原始输出：

```
./.claude/.g12-excl.tsv
./.claude/.g12-scope.tsv
./.claude/.precommit-par/acceptance-ci.captured
./.claude/.precommit-par/acceptance-ci.code
./.claude/.precommit-par/acceptance-ci.out
./.claude/.precommit-par/deprecated-mapping.code
./.claude/.precommit-par/deprecated-mapping.out
./.claude/.precommit-par/file-driven.code
./.claude/.precommit-par/file-driven.out
./.claude/.precommit-par/hardcoded.code
./.claude/.precommit-par/hardcoded.out
./.claude/.precommit-par/plan-integrity.captured
./.claude/.precommit-par/plan-integrity.code
./.claude/.precommit-par/plan-integrity.out
./.claude/.precommit-par/secrets.code
./.claude/.precommit-par/secrets.out
./.claude/.precommit-par/verifiable-done.captured
./.claude/.precommit-par/verifiable-done.code
./.claude/.precommit-par/verifiable-done.out
./.claude/bypass.log
./.claude/gate-hits.log
./.claude/task-briefs/2026-10-08-win-0-6-schema-degraded.md
./.codex/checkpoints/cp3-commit-check.json
./.codex/control-tower/health.json
./.codex/control-tower/session-registry.json
./.codex/settings/gatekeeper/.dashboard-signal
./.codex/settings/gatekeeper/.health-check
./.codex/settings/gatekeeper/degraded-events.log
./docs/synova/product-lines/evidence/980/ENV-980-better-sqlite3-workaround.md
./docs/synova/product-lines/evidence/980/assemble-evidence.sh
./docs/synova/product-lines/evidence/980/evidence-980-probe-run.txt
./src/l4/sog-schema-validator.ts
```

其中**本席确认写入的只有** `./src/l4/sog-schema-validator.ts`（变异 + `cp` 还原，终值 = 冻结 sha256）；其余为门禁/控制塔台账文件（`.claude/.precommit-par/*`、`.codex/*`、`gate-hits.log` 等），非本席命令产生（详见 U-2）。

**无并发提交**：`git log -3` / `git reflog -5` 显示 HEAD 全程停在 `c231d80e8`（reflog `HEAD@{0}` = 01:51:53 的 merge，早于本窗口）——**变异窗口内没有任何 commit 落盘**。

---

## 未解决 / 无法证实项

- **U-1（限制，非缺陷）**：本报告 §R28 的 `git status` 前后比对是**人工逐行比对**（两份原文都留），不是机器 `diff`。开工时未把跑前 `git status` 落盘为文件，事后无法补机器 diff —— 不为了好看去"重跑一次当跑前"。可机器复核的替代证据：① 6 个 thresholds sha256 前后逐字一致（原文都在）；② 文件 mtime 扫描（原文在）；③ `git log/reflog` 无新提交。
- **U-2（并发，需队长关注）**：本席窗口内**另一会话**在共享工作树跑过 pre-commit 门禁（`.claude/.precommit-par/` mtime 02:13:34 → 02:14:42；`.claude/.g12-*.tsv` 02:15:06）。两个后果：① `git status` 里多出 `.g12-*` 两条 untracked（非本席写入）；② **02:13:34–02:14:05 那一段与我 V6 变异窗口（02:13:37 施加 → 02:13:57 还原）重叠**。源码文件当时**在索引里仍是冻结内容**（`M ` 已暂存态未被本席改动），但若该门禁有读**工作树**（而非索引）的检查项，其结论可能受变异态影响。**建议**：队长在提交前，于本席还原之后（02:14:34 之后）重跑一次门禁取结论——`acceptance-ci.captured`(02:14:42) 等已晚于还原，但 02:13:34–02:14:05 那一批不作数。
- **U-3（未独立构造）**：V4 只复现了卡面所指的 `:141` 路径（未覆盖类型放行）。本席**未**另行构造"已覆盖类型 + 硬校验失败"（如 `GOAL.progress=150`）时的 `createNode` 返回/读回对照——卡面 V4 未要求，属口径外，如需下轮补。
- **U-4（口径登记，非本席改判）**：探针文件头自陈的"措辞偏离卡面"（卡面要求 count=0 时打印 `未发现未覆盖类型（count=0）`，同时又硬约束 count=0 时不得出现子串 `未覆盖类型`；探针按"判据意图"落字为 `未发现未覆盖的类型（count=0）`）。本席实测：**按现落字，V1/V5 判别力成立**（变异态两条 grep 皆红）；但"逐字照卡面"与"保留 V1 判别力"物理上不可兼得，仍属 CTO 裁决范围。
- **U-5（不在本席写集，仅登记）**：探针自陈 `SqliteGraphStore` 未实现 `GraphStore` 全量成员（缺 `createNodes/createEdges/traverse/findPaths/getNodeAtTime/queryByTags`），故 tsx/vitest 走类型剥离、`tsc` 语义下为 TS2345；探针不在 `tsconfig` 的 `src/**` include 内。本席只复现运行期行为，**未**对该类型层缺口做任何验证。
- **U-6（依赖借用）**：`better-sqlite3` 为跨版本借用（见 `ENV-980-better-sqlite3-workaround.md`）。本次全部探针/vitest 运行未出现 `DEGRADED: better-sqlite3 不可用`，实跑真 SQLite 文件库（库落 `%TEMP%`，仓库内零建库）——但借用方式本身的风险面不在本席写集，不作结论。

---

## 自验结论

- **V1-登记原文 / V1-加固**：独立复现 **exit 0 / exit 0**（冻结态）；变异态两条 **exit 1 / exit 1**（判别力成立）。
- **V2**：`count === 40`、`written === readBackOk === 40`、`uncoveredTypes.length === 40`、`nodeIds` 40 个且两两不同（独立解析器全部断言 `true`）。
- **V3**：告警含 `nodeType` + `uncoveredTypes` 清单；stdout 逐行类型清单，可定位。
- **V4**：`:141`（HEAD 静默放行形态）与 #980 可见降级形态下，`createNode` 均返回 nodeId 且 `getNode(返回值)` 均可读回——自跑 A/B 逐字一致（`40 OK`）。
- **V5 / V6 / V6b 真变异**：三条变异**全部必红**（V5：V1 两条 grep 均红；V6：U3 于 `:91` 红；V6b：U3 于 `:88` 红），`cp` 锚点还原后**全部复绿**。
- **还原干净**：`src/l4/sog-schema-validator.ts` 收尾 sha256 = `741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167` = 冻结值；三个冻结文件 sha256 全部等于卡面值；变异副本（3 份）与全部原始输出留档于 `/tmp/synova-980-verify/`。
- **未解决项**：U-1 至 U-6（其中 U-2 建议队长在还原后重跑门禁取结论）。

**可提请独立审计**（K3 终审）；本席**不判"通过"**，也无"退回"（未发现判据与实现不符之处；上述 U 项为限制/并发/口径登记，均附原始证据）。

### 收尾核对原文（报告写入后）

```
[C-1] 非日志行 diff：V1 冻结态 vs V5 还原后
IDENTICAL（非 pino 日志行逐行一致）

[C-2] sha256
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
8074a57107faf52ad077e45d1cc75b49b909443bfd977c51a882827d61d0b6a4 *docs/synova/product-lines/evidence/980/VERIFY-980-acceptance-verifier-980-accept.md   ← 本报告初版（36196 字节时）
※ 报告自身的 sha256 **不写死在正文**（自指哈希每改一次就失效，必成假数字）。请由读方现算：
  `sha256sum docs/synova/product-lines/evidence/980/VERIFY-980-acceptance-verifier-980-accept.md`

[C-3] git status
?? docs/synova/product-lines/evidence/980/VERIFY-980-acceptance-verifier-980-accept.md

[C-4] 报告 662 行 / 36196 字节（写入时初始版本）

[C-5] frozen 复核（锚点 vs 工作树）
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 */tmp/synova-980-verify/validator.frozen.ts
741f671bba3f66d650763fef2a8e2bbb042e7516851352c12f7b3fb37e0f5167 *src/l4/sog-schema-validator.ts
```

---

## 附：原始输出留档索引（`/tmp/synova-980-verify/`，会话本地，未入仓库）

| 文件 | 内容 |
|---|---|
| `validator.frozen.ts` | 冻结锚点原件（sha256 `741f671b…`） |
| `validator.mutated-v5.ts` / `-v6.ts` / `-v6b.ts` | 三次变异态原件（sha256 见上表） |
| `v1-run1.txt` | V1 探针完整 stdout+stderr（冻结态） |
| `v2-json-stdout.txt` / `v2-json-stderr.txt` | V2 `--json` 形态 stdout / stderr 分离原文 |
| `v5-mutated-probe.txt` | V5 变异态探针完整原文（count=0 分支） |
| `v5-restored-probe.txt` | V5 还原后探针完整原文 |
| `v6a-baseline-green.txt` | V6 基线绿（单元 7 + 集成 4 = 11 passed） |
| `v6-mutated-red.txt` / `v6-restored-green.txt` | V6 红 / 绿 完整 vitest 原文 |
| `v6b-mutated-red.txt` / `v6b-restored-green.txt` | V6b 红 / 绿 完整 vitest 原文 |
| `v1.sh` `v2.sh` `v2b.sh` `v5.sh` `v6a.sh` `v6b.sh` `v6c.sh` `final.sh` | 本席跑过的命令脚本（可复跑） |
| `status-final.txt` | 收尾 `git status --porcelain` 原文 |
