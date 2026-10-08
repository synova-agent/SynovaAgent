# #1056 证据件 — 3-11 专业包层（L1.5）机制

- 卡：`#1056`（3-11 专业包层 L1.5 机制；模块 K4；第 3 批）
- 执行：`@k4-coder-e`（WIN 侧 K4 小队）｜队长：`lead`
- 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1056`
- 分支：`feat/1056-l15-profession-layer`
- 基线：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4`（`git rev-list --count HEAD..origin/main` = **0**）
- as_of：2026-10-10
- 状态：**未合并**，待 GitHub 通路恢复 + CTO/K3 放行

> ⚠️ **本件不宣称「审计通过」**。执行方只给「自验结论 / 可提请独立审计」；通过与否归 CTO 收件闸 + K3 终审。

---

## 一、前提冻结复跑（as_of origin/main@5a6591c4a）

| # | 命令 | 原始读数 | vs 卡面 |
|---|---|---|---|
| C1 | `git grep -rn "profession" origin/main -- src/ extensions/ tests/` | `exit=1`（零命中） | ✓ 一致 |
| C2 | `git grep -rn -e "L1\.5" -e "l1\.5" origin/main -- src/ extensions/` | `exit=1`（零命中） | ✓ 一致 |
| C3 | `git grep -cE "builtin\|industry\|custom\|layer\|precedence" origin/main -- packages/extension-registry/src/` | `exit=1`（零命中） | ✓ 一致 |
| C4 | `git ls-tree -r --name-only origin/main -- src/extensions/` | `src/extensions/registry.ts`、`src/extensions/types.ts`（2 文件，均 `@synova/extension-registry` re-export 代理） | ✓ 一致 |
| C5 | `git ls-tree -r --name-only origin/main -- extensions/industries/` | 12 文件；顶层 = **6 目录 + `manifest.json` = 7 项**（`test-write/` 只有 `thresholds.json`，无 `manifest.json`） | ⚠️ 卡面「6 个目录」为**计数口径瑕疵**，非实质偏差（卡面同格自列 7 项） |
| C6 | `git ls-tree --name-only origin/main -- extensions/` | 20 项；`grep -E '^extensions/(profession\|professions)'` → `exit=1` | ✓ 一致 |
| C7 | `git show origin/main:src/playbook/playbook-loader.ts` L24-29 | `PLAYBOOK_ROOTS = [custom, industry, builtin]` | ✓ 一致 |
| C8 | 同件 L80-89 | 重复 id 原位替换（`playbooks[idx] = playbook`） | ✓ 一致 |
| C9 | `git show origin/main:src/config/config-layers.ts` L25-29 | `LayerName = default\|industry\|customer\|workspace`；`LAYER_ORDER` 同序 | ✓ 一致 |
| C10 | `git ls-tree -r --name-only origin/main -- tests/extensions/` / `git cat-file -e …` | 0 行；`cat-file` → **exit 128** `does not exist in 'origin/main'` | ✓ 一致 |

---

## 二、🔴 卡面 §③ 约束 6「先把已有三层的优先级验出来」——真跑实测

### 2.1 系统 A：playbook 三层（卡面 C7/C8 称「唯一的三层先例」）——**实测与声明相反**

手法：`process.chdir()` 到临时 fixture，令 `PLAYBOOK_ROOTS`（由 `process.cwd()` 派生）指向 fixture，
走**真实 `loadPlaybooks()`**。**未创建/修改 `extensions/playbooks/**` 任何字节**，跑完删除 fixture。

```
投放层 [builtin]                     →  胜出者 = builtin-version (marker=builtin)
投放层 [industry , builtin]          →  胜出者 = builtin-version (marker=builtin)
投放层 [custom , industry , builtin] →  胜出者 = builtin-version (marker=builtin)
投放层 [custom , builtin]            →  胜出者 = builtin-version (marker=builtin)
投放层 [custom , industry]           →  胜出者 = industry-version (marker=industry)

=== 声明口径 vs 实测 ===
源码注释: PLAYBOOK_ROOTS 按优先级排列 custom > industry > builtin
源码注释: "后扫描到的（higher priority）覆盖先扫描到的"
数组实际顺序: custom → industry → builtin
```

判定：**声明 `custom > industry > builtin`；实测 `builtin > industry > custom`（完全相反）**。
根因：数组把**最高**优先级排在最前，而替换逻辑是「后扫描者覆盖先扫描者」⇒ 最后扫描的 `builtin` 胜。

> 独立复现：同一结论由第二自验员独立跑出（S1 胜者 = `{"who":"BUILTIN"}`、S2 败者独有键未保留），
> 与上表逐条一致 ⇒ **两方独立复现**，证据可入 K3。
> 处置（lead 裁定 三.4/三.5）：**另立卡修 playbook**；本件**不以测试形式入库**（断言既有 bug 会冻结 bug，
> 断言声明值会红）；本卡机制**不照抄**该实现。
> 现有测试非判别性佐证：`tests/playbook/playbook-loader.test.ts:262-267` 只断言「总数不变 / 不报错」，
> 在优先级完全倒置的今天**仍然通过**。

### 2.2 系统 B：`src/config/config-layers.ts`——健康（本卡复用的归并内核）

```
LAYER_ORDER = ["default","industry","customer","workspace"]
resolveLayers 全四层 → {"a":"workspace","d":"default-only","nested":{"x":1,"y":2},"b":"industry-only","c":"customer-only"}
移除 workspace  → {"a":"customer",...}
再移除 customer → {"a":"industry",...}
再移除 industry → {"a":"default",...}
dumpLayers 每层 owner 键 → [{"layer":"default","contributedKeys":["d"]},{"layer":"industry","contributedKeys":["b","nested"]},{"layer":"customer","contributedKeys":["c"]},{"layer":"workspace","contributedKeys":["a"]}]
mergeLayers({a:1,b:2},{a:9})     → {"a":9,"b":2}      ← 下层独有键保留
mergeLayers({a:1},{a:undefined}) → {"a":1}            ← 稀疏 patch 不删键
mergeLayers({arr:[1,2,3]},{arr:[9]}) → {"arr":[9]}    ← 数组整值替换
```

判定：**四层逐层落、稀疏 patch 保留下层键、数组整值替换 ⇒ 正是卡面 P2 要的「覆盖非替换」归并内核**。

---

## 三、交付物（10 文件；治理产物 brief/claim/evidence 不计入 PR 预算 ⇒ 代码/内容 7 文件）

| # | 文件 | 性质 |
|---|---|---|
| 1 | `extensions/professions/manifest.json` | 新建（L1.5 域索引） |
| 2 | `extensions/professions/chain-retail-expansion/manifest.json` | 新建（专业包声明，字段从简） |
| 3 | `extensions/professions/chain-retail-expansion/thresholds.json` | 新建（专业包内容，纯内容面） |
| 4 | `src/extensions/profession-layer.ts` | 新建（L1.5 层机制） |
| 5 | `src/init/file-driven-loaders.ts` | **修改**（仅新增 1 节接线，`git diff --stat` = 45 insertions, 0 deletions） |
| 6 | `tests/extensions/layer-precedence.test.ts` | 新建（卡面点名判据交付物，V0–V6 + P1） |
| 7 | `tests/extensions/profession-layer.test.ts` | 新建（单元/降级路径） |
| 8 | `docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md` | 本件（治理产物） |
| 9 | `.claude/task-briefs/2026-10-09-1056-l15-profession-layer.md` | 治理产物（组 12 写集声明载体·legacy brief） |
| 10 | `.claude/claims/1056.yaml` | 治理产物（组 12 写集声明载体·claim；`claim_store.py --check 1056` ⇒ `{"status":"ok","writeset":10,"done":4}`） |

> claim 载体与 brief **并列**提交：legacy brief 依赖文件名 ±1 天窗口（跨日合并会掉出窗口 ⇒ CI 组 12 假红），
> claim 载体不依赖日期 ⇒ 二者并存取并集（lead 全队授权：治理产物不计入 PR 预算，D1174 先例同款装备）。

### 3.1 层根目录约定（**一律沿用既有约定，未新造顶层目录**）

| 层 | 根目录 | 依据 |
|---|---|---|
| `builtin`（L0） | `extensions/industries/general-enterprise/` | 既有 L0 基线行业包 |
| `industry`（L1） | `extensions/industries/<industry>/` | 既有 L1 行业包 |
| `profession`（L1.5） | `extensions/professions/<profession>/` | **本卡新建，卡面 §④ 授权** |
| `custom`（L2） | `customer-config/<orgId>/` | **既有约定**：`src/config/customer-config-package.ts` 的 `DEFAULT_ROOT_NAME = 'customer-config'`（决策点 2），本卡**直接 import 该常量**避免两处漂移 |

> 裁定依据（lead 二.2）：先实测是否已有 L2 客户内容根约定 —— **有**（`grep -n "customers/" origin/main -- src/ extensions/` ⇒ exit 1 零命中；
> 而 `customer-config-package.ts` 明写载体 `customer-config/{orgId}/config.yml`）⇒ **用既有的**，不静默发明新顶层目录。
> 内容文档名沿用既有内容包形状 `thresholds.json`（`extensions/industries/<行业>/thresholds.json`）。
> ⚠️ 本卡**不把 `config-layers` 的四层当宪章 5.2 的四层**（卡面 §③.2）：只复用 `mergeLayers` 归并内核，**不引用其 `LAYER_ORDER`**。

---

## 四、判据 ↔ 原始输出

### V2（卡面原文命令）

```
$ npx vitest run tests/extensions/layer-precedence.test.ts
EXIT=0

 RUN  v4.1.8 D:/novis-backup-20260526/Novis/.synova-wt-1056

 ✓ tests/extensions/layer-precedence.test.ts (8 tests) 128ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  1.20s
```

附：单元套件与接线文件既有测试

```
$ npx vitest run tests/extensions/profession-layer.test.ts
EXIT=0      Test Files 1 passed (1)      Tests 10 passed (10)

$ npx vitest run tests/init/file-driven-loaders.test.ts      ← 被改文件的既有测试，未改测试迁就
EXIT=0      Test Files 1 passed (1)      Tests 3 passed (3)
```

### V1（施工单原文：一个专业包装到**两个客户都生效**）— 真实路径原始输出

真实包 = 仓库内 `extensions/professions/chain-retail-expansion/`；两个客户 = 两个真实临时目录（非 mock）。

```
orgId=org-alpha
  profession.present = true
  profession.root    = D:\novis-backup-20260526\Novis\.synova-wt-1056\extensions\professions\chain-retail-expansion
  layers             = builtin:true | industry:true | profession:true | custom:true
  contributedKeys    = ["displayName","expansionGate","profession","thresholdOverrides"]
  resolved           = {"industry":"retail-ecommerce","aggregatedAt":"2026-07-15T00:00:00.000Z",
                        "thresholdOverrides":{"F1_KZ":{"warning":1.6,"critical":1.2},
                                             "F2_runway":{"warning":12,"critical":6},
                                             "F3_revenue_quality":{...},"F4_profit_quality":{...},
                                             "F5_cash_conversion":{...},"O1_info_distortion":{...},
                                             "O2_explore_exploit":{...},"T1_software_health":{...},
                                             "T2_connector_coverage":{"warning":0.35,"critical":0.55},
                                             "inventory-turnover":{"warning":4,"critical":2},
                                             "channel-roi":{"warning":1.5,"critical":0.8},
                                             "customer-ltv-cac":{"warning":3,"critical":1.5}},
                        "profession":"chain-retail-expansion","displayName":"连锁零售门店扩张方法论",
                        "expansionGate":{"minStoresForStandardization":8,"singleStorePaybackMonths":18},
                        "customer":"org-alpha","shared":"alpha"}
  degraded=false errors=[]
orgId=org-beta
  profession.present = true
  profession.root    = D:\novis-backup-20260526\Novis\.synova-wt-1056\extensions\professions\chain-retail-expansion
  layers             = builtin:true | industry:true | profession:true | custom:true
  contributedKeys    = ["displayName","expansionGate","profession","thresholdOverrides"]
  resolved           = {…同上，但 "customer":"org-beta","shared":"beta"}
  degraded=false errors=[]
```

读法（逐条挂证据）：
- **同一包、两个 orgId 都命中**：两次 `profession.present = true`，`profession.root` **逐字相同** ⇒ 专业包与 orgId **无耦合**（＝「跨客户复用」的物理保证）。
- **包内容两处都生效**：`F1_KZ = {1.6, 1.2}`（覆盖 L0 的 `{1.5, 2.0}`）、`T2_connector_coverage = {0.35, 0.55}`（覆盖 L0 的 `{0.3, 0.5}`）、`expansionGate`/`displayName` 生效。
- **不是「装一次给一个客户」**：`customer` / `shared` 两处不同（`org-alpha`/`alpha` vs `org-beta`/`beta`）。
- **叠加非替换（真实路径）**：L0 独有键 `F2_runway`/`F3`/`F4`/`F5`/`O1`/`O2`/`T1` **保留**；L1 独有键 `inventory-turnover`/`channel-roi`/`customer-ltv-cac` **保留**；`industry` 被 L1 覆盖为 `retail-ecommerce`。

### V3（覆盖顺序 `custom > profession > industry > builtin`，逐层断言胜出者身份）

测试用例（判别性写法，非「总数不变」）：

```
投放 [builtin,industry,profession,custom] → 胜出者 = custom
投放 [builtin,industry,profession]        → 胜出者 = profession
投放 [builtin,industry]                   → 胜出者 = industry
投放 [builtin]                            → 胜出者 = builtin
```
provenance：`winner` 的 owner = `custom`；`only_builtin`/`only_industry`/`only_profession`/`only_custom` 各自 owner 正确（每键恰一个 owner）。
结果：**8/8 绿**（见 V2 原始输出）。

### V4（叠加 = 覆盖非替换）

- 同名键 `shared`：`builtin`+`profession` 两层投入 ⇒ 胜出者为 `profession`。
- 低层独有顶层键 `builtinOnly` **保留**；低层独有嵌套子键 `nested.x` **保留**；`nested.y` 被高层覆盖。
- 数组 `list` 整值替换（`[1,2,3]` + `[9]` ⇒ `[9]`，不逐元素混合）。
结果：**绿**（见 V2 原始输出）。

### V5 / V6（反例：**真删真改真跑**，非静态判据）

```
==================== V5：把 L1.5 层从加载顺序中【真删】 ====================
命令: sed -i "s/<四层常量>/<三层常量>/" src/extensions/profession-layer.ts
改后实际内容:
68:export const CONTENT_LAYER_ORDER = ['builtin', 'industry', 'custom'] as const;
--- V5 运行 tests/extensions/layer-precedence.test.ts : 真实退出码 = 1 ---
 ❯ tests/extensions/layer-precedence.test.ts (8 tests | 7 failed)
   × V3 四层同名键 → custom 胜；逐层移除 → 依次落到 profession → industry → builtin
      AssertionError: 投放 [builtin,industry,profession] 的胜出者应是 profession: expected 'industry' to be 'profession'
   × V3 层序常量把 profession 夹在 industry 与 custom 之间
      AssertionError: expected [ 'builtin', 'industry', 'custom' ] to deeply equal [ 'builtin', 'industry', …(2) ]
   × V3 provenance：同名键的 owner 是最高层
   × V4 高层同名键整值胜出；低层独有键（含嵌套子键）保留
   × V4 数组是整值替换
   × V1 真实包在两个 orgId 下均被命中且内容生效
   × P1 运行时新建专业包目录 → 被发现且参与层叠
 Test Files  1 failed (1)      Tests  7 failed | 1 passed (8)
已还原:
68:export const CONTENT_LAYER_ORDER = ['builtin', 'industry', 'profession', 'custom'] as const;

==================== V6：把叠加语义改成【整文档替换】 ====================
命令: sed -i "s/const merged = mergeLayers(acc, doc);/const merged = doc;/" src/extensions/profession-layer.ts
改后实际内容:
230:    const merged = doc;
--- V6 运行 tests/extensions/layer-precedence.test.ts : 真实退出码 = 1 ---
 ❯ tests/extensions/layer-precedence.test.ts (8 tests | 2 failed)
   × V4 高层同名键整值胜出；低层独有键（含嵌套子键）保留
      AssertionError: expected undefined to be 'keep'     ← 下层独有键消失
   × V1 真实包在两个 orgId 下均被命中且内容生效
      AssertionError: expected undefined to be 1.2
 Test Files  1 failed (1)      Tests  2 failed | 6 passed (8)
已还原:
230:    const merged = mergeLayers(acc, doc);

==================== 还原后复跑（两文件，须全绿） ====================
RESTORED_EXIT=0      Test Files  2 passed (2)      Tests  18 passed (18)
```

### P1（补充判据，**不得单独作为完成判据**）：加文件即生效

测试在 `extensions/professions/` 下**运行时新建** `zz-k4-1056-probe/{manifest.json,thresholds.json}` ⇒
`loadProfessionPackages()` 发现该包、`resolveContentLayers()` 命中其内容（`probeOnly === 'yes'`、`F1_KZ.critical === 9`），
**全程未改任何宿主 TS**；跑完删除并断言目录不存在。`git status --porcelain` 无残留（见 §五）。

---

## 五、收尾三件

### 5.1 diff

```
$ git diff --stat
 src/init/file-driven-loaders.ts | 45 +++++++++++++++++++++++++++++++++++++++++
 1 file changed, 45 insertions(+)
```
（新增文件不计入 `git diff --stat`；`git status --porcelain` = ` M src/init/file-driven-loaders.ts`、
`?? extensions/professions/`、`?? src/extensions/profession-layer.ts`、`?? tests/extensions/`；**无探针残留**。）

### 5.2 自验结论

**可提请独立审计**（执行方不自判「通过」）。逐条：

| 判据 | 结果 | 证据锚点 |
|---|---|---|
| V1 两个 orgId 都命中 | 绿 | §四 V1 原始输出（两段 `profession.present = true` + root 逐字相同） |
| V2 原文命令 exit=0 | 绿 | §四 V2（`EXIT=0`，8 passed） |
| V3 覆盖顺序逐层可证 | 绿 | §四 V3（四档胜出者身份逐层断言） |
| V4 叠加=覆盖非替换 | 绿 | §四 V4 + V1 真实路径保留键清单 |
| V5 删 L1.5 ⇒ 必红 | 红（真实退出码 1，7 failed） | §四 V5 |
| V6 整文档替换 ⇒ 必红 | 红（真实退出码 1，2 failed） | §四 V6 |
| P1 加文件即生效（补充） | 绿 | §四 P1 |

补充对照：
- `tsc --noEmit` —— **本次改动文件零错误**（`grep -E "profession-layer|file-driven-loaders"` ⇒ 无输出）；
  全仓库既有存量错误 **34** 行（`extensions/sentinels/_extinct/**`、`src/mcp/**`、`src/server.ts`、`src/connectors/ima.ts`），非本次引入。
- 被改文件 `src/init/file-driven-loaders.ts` 的既有测试 `tests/init/file-driven-loaders.test.ts` **未改动**且仍绿（3 passed）。

### 5.3 遗留 / 未决项

1. 🔴 **playbook 三层优先级倒置**（§二.1）——写集外（`src/playbook/playbook-loader.ts`），本卡**不碰**，已报 lead ⇒ 请另立卡修。
2. ⚠️ **接线点冲突扫描未覆盖，因 GitHub 不可达**：GitHub 账号级封禁（API 403 / SSH `exit 128 ERROR: Your account is suspended`），
   无法重拉 136 个 open PR 的文件面 ⇒ **无法声明** `src/init/file-driven-loaders.ts` 与 `extensions/professions/**`
   这两个接线点在飞冲突为零。**本条不假装扫过**（lead 一.⚠️ 要求登记）。
3. ℹ️ `src/init/file-driven-loaders.ts` 引用面（grep 共 5 处）：`src/deploy/bootstrap.ts`、`src/init/file-driven-loaders.ts`、
   `src/notifications/notification-loader.ts`、`src/server.ts`、`tests/init/file-driven-loaders.test.ts`。
4. ℹ️ **manifest 字段从简 vs 门禁的取舍**（须 K3 知悉）：卡面 §⑥/派单要求 manifest「字段少而准」，
   而 `scripts/check-file-driven.sh` 检查 (a) 对**任何暂存 `manifest.json`** 硬要求字面含
   `"$schema"` `"name"` `"version"` `"type"` `"entryPoint"` ⇒ 专业包 manifest 取**该门禁允许的最小集 + `displayName`**（共 6 字段），
   未再增字段。本卡**未改门禁脚本**（改门禁语义须走 提案→K3→CTO）。
5. ℹ️ 内容文档形状沿用既有 `thresholds.json`（plain object）；更丰富 schema 归《extensions内容面规范-v0.1》——**该件不在 main**
   （`git ls-tree -r --name-only origin/main -- docs/ | grep 内容面规范` 无命中），故本卡不擅自扩 schema。
6. ℹ️ 本卡**未引入 feature flag**（`check-file-driven.sh` 检查 f 的触发模式未命中）：L1.5 是**新增层**，
   不存在「旧路径」可回退，flag 无对象。若 K3 认为须有回滚开关，请在复审中提出（属改门禁语义，走提案→K3→CTO）。
7. ⚠️ **未合并**：GitHub 封禁期，分支仅本地 commit；PR / 卡评论 / 板回填均未执行。

### 5.4 交付语义

- 标 `可提请独立审计`；**K3 复审通过前不得合并**。
- 本卡不提「越用越准 / 自我进化」等口径（卡面 ⑪ 话术红线）。
