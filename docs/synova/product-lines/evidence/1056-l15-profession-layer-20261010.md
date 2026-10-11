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

---

# 六、批 2 变更（CTO 2026-10-11「甲」裁定：接线改为经 content-registry 声明）

> 本节为**第二次交付**（rebase 到当刻 local-main 后）的取证。§一–§五 为第一次交付（`4d004a5d`）原文，保留不动。

## 6.1 rebase 与冲突解（原始输出）

```
$ lanfetch.bat D:\synova-wt-b2-1056
FETCH_EXIT=0
LOCAL_MAIN_TIP: dc5ce093c37f6cf8ef069431b3192a390637f88d
（上一批取证基准 e52499dd 此后由 PR #343 推进到 dc5ce093；本卡关心的两组路径下一节证明未被触碰）

$ git diff --stat e52499dd dc5ce093 -- src/init/file-driven-loaders.ts src/deploy/content-registry.ts \
      tests/deploy/content-registry.test.ts extensions/ src/deploy/bootstrap.ts
（空输出 ⇒ 该两组路径在 e52499dd→dc5ce093 间未被改）
```
```
$ git rebase origin/local-main
Rebasing (1/1)Auto-merging src/init/file-driven-loaders.ts
CONFLICT (content): Merge conflict in src/init/file-driven-loaders.ts
error: could not apply 4d004a5d... feat(1056): 新增 L1.5 专业包层（四层覆盖 custom>profession>industry>builtin）
REBASE_EXIT=1

$ git ls-files -u src/init/file-driven-loaders.ts
100644 549cad011ca23508c5e265304c3c6dbb750c465b 1	src/init/file-driven-loaders.ts
100644 6e0e1e6b0756eef2b71bd84347f8667c599582fb 2	src/init/file-driven-loaders.ts   ← ours = local-main 侧 88 行版
100644 caec99a9415fce79dcb7214c8decb6aa0b4a6ccf 3	src/init/file-driven-loaders.ts   ← theirs = 分支 176 行版
```
**解冲突做法（禁 `--ours/--theirs` 一把过，逐文件裁定后显式取 main 侧）**：
```
$ git checkout HEAD -- src/init/file-driven-loaders.ts
CHECKOUT_EXIT=0
$ git diff origin/local-main -- src/init/file-driven-loaders.ts
（空输出 ⇒ 与 local-main 逐字节一致）
$ git hash-object src/init/file-driven-loaders.ts
6e0e1e6b0756eef2b71bd84347f8667c599582fb     ← 与 :2 阶段（ours）blob 相同
$ find /c /v "" src\init\file-driven-loaders.ts
---------- SRC\INIT\FILE-DRIVEN-LOADERS.TS: 88
$ git rebase --continue
[detached HEAD 91dc6a07] feat(1056): 新增 L1.5 专业包层（四层覆盖 custom>profession>industry>builtin）
 9 files changed, 1288 insertions(+)
CONTINUE_EXIT=0
```
**⇒ 分支原 45 行尾插块被丢弃**（其职责改由 registry 声明承接，见 §6.2），**main 侧 88 行真源被完整保留**。

## 6.2 接线改落点：registry 按名声明（落地形态）

`src/deploy/content-registry.ts` 新增项（照 `department` 项同形：按名声明 ＋ 零参 init）：

```ts
  {
    type: 'profession',
    dir: 'professions',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../extensions/layer-resolver',
      init: 'initProfessionLayer',
    },
  },
```
`MODULE_IMPORTS` 加键：`'../extensions/layer-resolver': () => import('../extensions/layer-resolver'),`
项数硬钉：`CONTENT_TYPES.length !== 24` ⇒ `!== 25`。
测试计数：`tests/deploy/content-registry.test.ts` `total 24→25` / `reachable 19→20`。

**语义边界（如实声明）**：registry 表七元（`type/dir/face/status/loader/readers/reason`）**无 order/precedence
字段位** ⇒ **层序语义不由该表承载**，仍在 `layer-resolver.ts` 的 `CONTENT_LAYER_ORDER`；该表只声明
「`professions` 目录由谁承接口径」。核验：`initProfessionLayer()` 零参、包名一律来自目录扫描
（`loadProfessionPackages()`）⇒ 「加一个专业包 = 加一个目录」的 P1 性质**未被接线方式破坏**。

## 6.3 改名落地与引用面改净（全量 grep，不截断）

改名：`src/extensions/profession-layer.ts` ⇒ `src/extensions/layer-resolver.ts`（`git mv`，`MV_EXIT=0`）。

```
$ git grep -c "profession-layer"        # 全仓受控文件（含治理产物）
.claude/claims/1056.yaml:5
.claude/task-briefs/2026-10-09-1056-l15-profession-layer.md:4
docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md:10
src/extensions/layer-resolver.ts:1
tests/extensions/profession-layer.test.ts:2
C_EXIT=0

$ git grep -n "profession-layer" -- src tests extensions     # 代码面
src/extensions/layer-resolver.ts:6: * 🔴 文件改名（CTO 2026-10-11 裁定）：`src/extensions/profession-layer.ts` ⇒ 本文件名。
tests/extensions/profession-layer.test.ts:2: * tests/extensions/profession-layer.test.ts — L1.5 专业包层单元测试（#1056）
tests/extensions/profession-layer.test.ts:4: * ⚠️ 文件名保留 `profession-layer`（本次改名只动**模块路径**：`src/extensions/profession-layer.ts`
SRC_TESTS_EXT_EXIT=0
```
**汇总口径（禁手写数字，逐条来自上面原始输出）**：
- **功能引用（import / entryPoint / logger 名）＝ 0 处**；
- 剩余 3 处全为**说明性载荷**：① `layer-resolver.ts:6` 改名注记；②③ `profession-layer.test.ts:2,4` 测试文件名注记
  （测试文件本体保留原名，理由已写在文件头：本卡只裁定**模块路径**改名，重命名测试文件会额外扩大写集）；
- 治理产物 16 处（claim 5 ＋ brief 4 ＋ 本证据件 10 行含历史记录）＋ 分支名 1 处
  （`feat/1056-l15-profession-layer` 是**分支名**，不随模块改名而变，属历史载荷）。

非 TS 引用一并改净：`extensions/professions/manifest.json`
`entryPoint` `"../../src/extensions/profession-layer.ts"` ⇒ `"../src/extensions/layer-resolver.ts"`
（**原值本身有 bug**：manifest 位于 `extensions/professions/`，`../../` 会指到仓库外）；
`exportKey` `loadProfessionPackages` ⇒ `initProfessionLayer`（与 registry 声明**同一符号**，避免两处口径漂移）。

## 6.4 判据件新增：V7 接线组（"接线了 ≠ 被执行了"）

`tests/extensions/layer-precedence.test.ts` 新增 V7 组 5 用例（真跑，非 grep 静态判据）：
① registry 登记 professions 项 ＋ `loader.module/init` 按名指向 ＋ `moduleKeys` 含该键 ＋ `integrityProblems` 为空；
② `initContentTypes({types:['profession']})` ⇒ `attempted=1 / loaded=1 / verified 含 'initProfessionLayer'`；
③ `initProfessionLayer()` ⇒ 真实包 `chain-retail-expansion` 被发现且 `unwired=[]`；
④ 判别性：临时造「有 manifest 无 thresholds.json」的包 ⇒ 该包进 `unwired`、`degraded=true`、errors 含「未参与层叠」；
⑤ 降级信号经 registry 上抛（`report.errors=[]` / `degraded=false`，锁通路存在）。

### 6.4.1 红证（真删真跑 · 原始输出）

因实现与测试在同一提交落地，**补造判别性红证**（做法：把导出名 `export function initProfessionLayer(`
改为 `function initProfessionLayer_DISABLED(`，跑完立即从备份恢复；**未用 `git stash`／`reset --hard`／`checkout -f`**）：

```
=== [0] hash of ORIGINAL ===
2b500edf715e021803ec42c04eed003e11302a99
=== [1] RED MUTATION: rename export symbol ===
MUTATION-APPLIED
520:function initProfessionLayer_DISABLED(): ProfessionLayerInitResult {
=== [2] VITEST under mutation (expect RED) ===
 ❯ tests/extensions/layer-precedence.test.ts (13 tests | 4 failed) 235ms
       × ② boot 装配真调 layer-resolver：initProfessionLayer 被执行且该项 ok（非静态判据） 15ms
       × ③ boot 自检覆盖真实专业包，且每个包的内容都参与层叠（unwired 为空） 1ms
       × ④ 判别性：层叠自检对「发现到但叠不进去」真报警（构造 unwired 真值） 4ms
       × ⑤ registry 装配报告把降级信号往上传（不静默吞） 6ms
 FAIL … ② AssertionError: expected +0 to be 1   ❯ tests/extensions/layer-precedence.test.ts:284:29
 FAIL … ③ TypeError: initProfessionLayer is not a function   ❯ :294:19
 FAIL … ④ TypeError: initProfessionLayer is not a function   ❯ :316:21
 FAIL … ⑤ AssertionError: expected [ Array(1) ] to deeply equal []
        - []
        + [ "profession: 导出缺失或非函数: initProfessionLayer" ]
 Test Files  1 failed (1) ｜ Tests  4 failed | 9 passed (13)
VITEST_RED_EXIT=1
=== [3] restore ===
=== [4] hash after restore (must equal [0]) ===
2b500edf715e021803ec42c04eed003e11302a99
```
**⇒ 非恒真非恒假**：删掉接线面 ⇒ V7 必红（且红在**行为**上：`loaded=0`、registry 报「导出缺失或非函数」）；
恢复后 hash 逐字节回到原值，`git status` 仅剩预期的 6 处改动（无变异残留）。

## 6.5 绿灯复跑（原始输出，四文件同跑）

```
$ npx vitest run tests/extensions/layer-precedence.test.ts tests/extensions/profession-layer.test.ts \
      tests/deploy/content-registry.test.ts tests/init/file-driven-loaders.test.ts
 ✓ tests/deploy/content-registry.test.ts (18 tests) 3501ms
 ✓ tests/init/file-driven-loaders.test.ts (3 tests) 3986ms
 Test Files  4 passed (4)
      Tests  44 passed (44)
   Duration  4.92s
VITEST_EXIT=0
```
boot 实测日志（同一轮，节选自原始 stdout）：
```
{"service":"extensions/layer-resolver","layers":"builtin < industry < profession < custom","packages":1,
 "fragmentation":0,"unwired":0,"msg":"L1.5 专业包层已初始化"}
{"service":"deploy/content-registry","type":"profession","verified":1,"msg":"内容项已装配"}
{"service":"init/file-driven-loaders","attempted":12,"loaded":12,"msg":"内容面 loader 已初始化（content-registry 驱动）"}
{"service":"init/file-driven-loaders","total":25,"reachable":20,"retired":2,"pendingCto":3,
 "msg":"内容面注册表已加载（20 项状态分布）"}
```
⇒ **接线真实生效**：`initFileDrivenLoaders()` 的装配面由 11 项变 12 项（新增 profession），
且 `profession` 项的 `verified=1` 证明 `initProfessionLayer` 被真调（非静态声明）。

## 6.6 其他门禁与检查（原始结论）

| 检查 | 命令 | 结果 |
|---|---|---|
| 架构边界（铁律 39） | `bash scripts/check-architecture.sh` | `架构检查: 全部通过 ✅`（exit 0；存量告警同基线） |
| 增量边界 | `bash scripts/workflow/check-boundaries-incremental.sh` | exit 0 |
| 文件驱动架构完整性 | `bash scripts/check-file-driven.sh` | 6 组全 ✅（含 manifest 必填字段、硬编码类型回归） |
| 登记件不变量 | `npx tsx scripts/control-tower/check-registry-invariants.ts` | `RESULT=PASS`（exit 0） |
| 类型检查 | `npx tsc --noEmit` | exit 2；**输出 38 行，命中本卡改动文件 0 行**（全为存量：`extensions/sentinels/_extinct/**`、`src/mcp/**`、`src/server.ts`、`src/connectors/ima.ts`） |
| 判据探针（**未修，仅登记**） | `npx tsx scripts/control-tower/probe-content-registry.ts` | `SUMMARY: sections=4 failures=1`，唯一失败 = `注册表应为 20 项，实测 25`；③ RESOLVE 段打印 `profession ../extensions/layer-resolver exports=[initProfessionLayer]`；④ CALL 段 `模块边界计数 = [initProfessionLayer:1]` |

## 6.7 遗留 / 未决项（批 2）

1. 🔴 **`probe-content-registry.ts:103` 计数钉 20 未修**（控制塔域 + 属批 1/K12-21 写集，CTO 裁定本卡不碰）。
   本卡只登记：该探针在 local-main 上已 FAIL（20 vs 24），本卡后为 20 vs 25。
2. 🔴 **`src/init/file-driven-loaders.ts` 本卡零改动**（`git diff origin/local-main --` 为空）。
   PR 正文须显式声明：第一次交付形态（+45 行尾插）已被「甲」裁定**撤销**，接线改落 registry。
3. ⚠️ **写集超卡面 +2 项**（`src/deploy/content-registry.ts` / `tests/deploy/content-registry.test.ts`）——
   CTO 2026-10-11 书面放行（理由：改表必须同改其项数硬钉与其判据测试，否则 rebase 落地即红）。
4. ℹ️ **测试文件名保留 `profession-layer.test.ts`**：本卡只裁定模块路径改名；若 CTO 要求连测试文件一并改名，
   属写集再扩一项（`git mv` ＋ 引用改净），请示后再做。
5. ℹ️ `extensions/professions/manifest.json` 的 `type` 由 `profession-package-layer` 改为 `profession`
   （与 registry 项 type 对齐；`content-registry.ts` 自述该字段为「manifest.type 值」）。实测 main 全仓
   `profession-package` 零引用、`manifest.type` 仅作日志/过滤显示 ⇒ 无消费端受影响。
6. ℹ️ 第一次交付的遗留 1–7（§5.3）**仍然有效**，其中「GitHub 封禁 ⇒ 接线点冲突扫描未覆盖」一条在批 2 仍适用
   （本批冲突扫描改由本地 `git ls-tree origin/local-main` / `git grep` 完成，覆盖 local-main 侧；**不覆盖 136 个 open PR**）。

## 6.8 交付语义（批 2）

- 标 `可提请独立审计`；**K3 复审通过前不得合并**；**推分支 / 开 PR 由队长统一执行**（本席未 push）。

