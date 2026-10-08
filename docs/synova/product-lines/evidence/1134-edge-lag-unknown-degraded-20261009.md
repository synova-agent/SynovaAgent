# WIN-1134 · `action_effect_lag` 越权威枚举（`unknown`）—— 乙路线落地 + 判据证据

> 卡：[#1134](https://github.com/synova-agent/SynovaAgent/issues/1134)（W3 时滞值侧 · 模块 K4）
> 执行人：`@k4-coder-b` ｜ 小队：WIN 侧 K4 ｜ 分支：`fix/1134-edge-lag-enum`
> 断面：`origin/main = 5a6591c4a3d4c9816895fb7f55a8a97b1c71a7e4` ｜ 工作树：`.synova-wt-1134`
> 路线：**乙**（不纳入枚举；标 `degraded` + 落审计）—— 队长裁定，依据见 §3
> 交付级别：**L2-真跑**（穿生产入口 `loadOntology()`；穿生产入口 = 真跑装载器，非 grep 静态计数）
> 🔴 判据等级：**L2-真跑（分辨力审计 CTO §三 A/B/C/D 定义缺失，待 CTO 补）** —— **不**自评 L3/L4，见 §9.1
> 状态：**`可提请独立审计`**（本件不作"通过"判定；通过归 CTO 收件闸 + K3 终审）

---

## 0. 结论速览

| # | 项 | 值 |
|---|---|---|
| 1 | 路线 | **乙** —— `unknown` 是**显式降级标记**，**不**纳入权威枚举 |
| 2 | 落地物 | `tests/l4/edge-lag-unknown-degraded-1134.test.ts`（新增，**穿生产入口**） |
| 3 | 判据形态 | **显式豁免面（6 值 ∪ {`unknown`}）+ 禁静默放宽 + `unknown` 计数棘轮 50 + 改坏即红** |
| 4 | 定向 vitest | **30 passed / 0 failed**，`exit=0` |
| 5 | 改坏即红 | 真值→`unknown` ⇒ **50 → 51**（原始输出见 §5），**零真仓写入** |
| 6 | 🔴 诚实边界 | 本件交付**防线/审计侧**；**读取侧 emitter 不存在、本卡不覆盖**（见 §9.2） |
| 7 | 触发点 | T1（枚举成员校验器上线）/ T2（权威01 第二章写入）/ T3（消费方验收件）—— 见 §8 |
| 8 | 卡面缺陷 | 卡面把「§3.4 Loader 交叉校验」当爆点；**实测它只比差异、不校枚举**（见 §8.2），已报 CTO |

---

## 1. 卡面前提复跑（逐条对照，**全部一致**）

| # | 卡面读数 | 我的复跑（命令见括号） | 判 |
|---|---|---|---|
| 1 | `"unknown" 50 · "3-6_months" 2 · "immediate" 1 · "1_month" 1 · "1-3_months" 1` | 完全一致（`git grep -h '"action_effect_lag"' origin/main -- extensions/ontology/edge-types/ \| sed 's/.*: //' \| sort \| uniq -c`） | ✅ |
| 2 | 边文件 **55** 件 | `git ls-tree -r --name-only origin/main -- extensions/ontology/edge-types/ \| wc -l` → `55` | ✅ |
| 3 | 权威文档15 第一章 §3.4 枚举 **6 值**、**不含 `unknown`** | 表内 6 行（`:184-193`），无 `unknown` | ✅ |
| 4 | 同文档称 Loader 将来「交叉校验并标记差异」（≈`:149`） | `第一章:149` 逐字命中 | ✅ |
| 5 | `transfer_function` = 52 TBD（#1350 评论口径） | `52 "TBD — to be defined in compute phase"` + 3 条散文公式 | ✅ |
| 6 | 与 #1350 同目录 ⇒ 本卡先行 | 目录级互斥；#1350 为**提案 carrier**，其 PR #1351 声明零 `edge-types` JSON 改动 | ✅ |

**⇒ 卡面与实测无一条对不上，前提冻结成立。**（唯一分歧在**触发件叙述**，见 §8.2 —— 我按实测分开陈述，不改写卡面原话。）

---

## 2. 关键实测事实（本卡新发现，卡面未载）

### 2.1 消费方：`action_effect_lag` 今天**零生产消费方**

```
$ for a in src packages extensions scripts tests expert knowledge schema .github; do
    n=$(git grep -l "action_effect_lag" origin/main -- "$a/" 2>/dev/null | wc -l); echo "  $a/ -> $n"; done
  src/        -> 0
  packages/   -> 0
  extensions/ -> 55      ← 纯数据面（edge-types JSON）
  scripts/    -> 1       ← 控制塔防线（见 2.2）
  tests/      -> 1       ← 该防线的夹具
  expert/ knowledge/ schema/ .github/ -> 0

$ git grep -l "action_effect_lag" origin/main | wc -l
72        # 55 数据面 + 17 非数据面（全为 docs / brief / skill / 两个防线件）
```
旁证：`src/l4/ontology-loader.ts` 的 `EdgeTypeDef` 接口（`:24-34`）**未声明** `action_effect_lag`
⇒ 该字段是**裸透传**，不是契约字段。

⇒ **今天没有任何生产代码"读到 `unknown`"，也没有任何地方产降级信号。** 这正是铁律 11/31 意义上的静默。

### 2.2 既有控制塔防线：**零枚举感知**（本卡**不**修改它）

`scripts/control-tower/check-ontology-fields.sh` 判据 = **字段存在 + 值为非空串**（自述 `:15-16`、`:17-18`），
`FIELDS="action_effect_lag transfer_function"`（`:33`）—— **无值域判定**。

```
$ bash scripts/control-tower/check-ontology-fields.sh
✅ 全部 55 件边类型关键字段齐全（action_effect_lag, transfer_function）
GUARD_EXIT=0
```
⇒ 50 条 `unknown` 判**通过**；连一个彻底非法的值也**不可见**（自验员 LEG 4 独立复现，见 §6.3）。

**职责边界（既有决策原文）**：`memory/notes/proposed/2026-10-07-d1174-ontology-field-guard.md:9`
> 「判据 = 每件 edge-type JSON 两字段**存在且值非空串**。**值内容（"unknown"/"TBD"）是数据质量，归产品线，不在本防线。**」

⇒ **本卡 = D1174 让渡给产品线的"值内容"那半边**，落点**另立**（`tests/l4/**`），
   **不触碰**该防线、**不**改其冻结判据（其自述「判据变更 ⇒ 提案 → K3 → CTO」）。

### 2.3 `$id` ≠ 文件名（5/55）—— 禁止从 `$id` 反推文件名

```
$ <逐件比对 $id 尾段 vs 真实文件名>
  MISMATCH  file=decision_concentrates.json    $id=edge/decision-concentrates
  MISMATCH  file=external_assumption.json      $id=edge/external-assumption
  MISMATCH  file=incentive_binds.json          $id=edge/incentive-binds
  MISMATCH  file=locks_in.json                 $id=edge/locks-in
  MISMATCH  file=signal_transmits.json         $id=edge/signal-transmits
  ---- 共 55 件，其中 5 件 $id 尾段 != 文件名 ----
```
真实文件名**字符集 = `[_a-z]`（不含连字符）**；`$id` **含连字符**。
⇒ 若用 `$id.replace('edge/','')+'.json'` 反推，**具名审计行会点一个不存在的文件 = 假证据**。
⇒ 实现改为：文件名**取自目录实况**（子进程内 `readdirSync` + 解析各文件 `$id` 建映射），
   并把该分歧作为**只报告不阻断**项（夹具 §F）。

### 2.4 「接线了 ≠ 被执行」—— 已排除（含口径关系，见 §7）

`tests/control-tower/check-ontology-fields.test.sh` **真在执行集内**（`sealed-tests.sh --list` 88 条含它，未进隔离台账）。

---

## 3. 乙的判据实现

### 3.1 路线裁定的证据链（四条）

| # | 事实（出处） | 指向 |
|---|---|---|
| 1 | `issue987-988-本体边时滞与因果强度-20261004.md:63` —— 其余 **50 条** = `"unknown"`（**显式未知，不留空、不猜数 —— 铁律 11/31**） | `unknown` 的存在理由 = **显式表达"未知"以避免静默** ⇒ 它是**降级/不可用信号**，不是"某个正常时滞档位" |
| 2 | 同件 `:41` —— 值域 = §3.4 六值「**外加 `unknown`**」 | `unknown` 被**有意置于规范值域之外**，作**异常态出口**。纳入枚举 = 把异常态**合法化为正常值** = **静默放宽**（卡面明文禁止） |
| 3 | doc15 第三章 `:526` —— `action_effect_lag` **未定义** ⇒ 默认值（min=3,max=6）+ **标注 `degraded: true`** | `degraded` 语义**早已写在权威文档**，缺的只是**实现** |
| 4 | §2.1 实测 —— `src/`+`packages/` 命中 **0** ⇒ **零消费方** | 「读到 `unknown` 干什么」**当前无人回答** = 静默降级。乙恰好补这一环 |

**⇒ 判：乙。** 一句话：**`unknown` 不是"第七个时滞档位"，它是"没有档位"的显式编码；把它写进枚举等于把"无数据"声明成"有数据"。**

**代价（照卡面要求写明）**：JSON 值 + 派生 `degraded` 标记**两处表达同一件事** ⇒ **需防漂移**。
**防漂移判据（可判、可执行）**：派生降级计数与 `action_effect_lag === "unknown"` 的实测件数**逐次相等**（棘轮 = 50）；漂移即红（§5）。

**甲不采纳**：需改权威文档15 §3.4（登记件域 / 越写集），且直接违反卡面「不许静默放宽枚举」「不许用「先加上 unknown 就行」」。

### 3.2 判据四条（队长收窄口径）

| ID | 判据 | 绿 | 红 |
|---|---|---|---|
| **J1** | **显式豁免面** = 权威 6 值枚举 **∪ {`unknown`}**，**恰为 7 项** | 集合恰 7、无重复 | 悄悄加第 8 项 ⇒ 夹具 C4b 红 |
| **J2** | 🔴 **禁静默放宽**：出现**第 3 类值**（既非 6 值、亦非 `unknown`）⇒ `specViolation > 0` | 真仓 `specViolation = 0` | 放 `2_months` / `NOT_IN_ENUM_AT_ALL` / `''` / 非字符串 ⇒ **必红**（C2/C3/C4/B5） |
| **J3** | **防漂移棘轮**：`unknown` 计数钉死 **50** | 真仓 = 50 | 真值→`unknown` ⇒ **51** ⇒ 必红；反向亦红（§5 / B2–B4） |
| **J4** | **具名审计行 + 派生 `degraded` 标记**（铁律 11/31 不静默） | 每个 `unknown` 一件一行，点名**真实文件名** + `$id`；`degradedFlag = true` | 删掉产审计行/标记的代码 ⇒ 行消失 ⇒ 红（A5/A6/A7） |

**另有两条"报告不阻断"**（防将来无法判"合法未用 vs 漏标/映射断裂"）：
- **枚举成员零出现**：真仓 `6-12_months` 与 `>12_months` 出现 **0 次** ⇒ 报告，不阻断（§E）
- **`$id` ↔ 文件名分歧**：5/55 ⇒ 报告，不阻断（§F）

### 3.3 落点与工程约束（为什么这样写）

- **穿生产入口**：经 `loadOntology()`（`src/l4/ontology-loader.ts:73`）真跑装载器取字段值，
  **不是** `git grep` 型静态判据（施工项登记 `1-8` 已明文否决 grep 型）。
- **子进程 + chdir 后动态 import**（唯一安全形态）：
  `ONTOLOGY_DIR` 是**模块级 const**（import 时以 `process.cwd()` 求值，`:43`）+ 模块内有 `cache`（`:46`）
  ⇒ 同进程二次 import 不重算路径、直接吃缓存。
  🔴 **实测教训（本卡探针 v1）**：静态 import + 事后 `process.chdir` ⇒ **沙箱被静默无视**，
    仍加载真仓 55 件（`nodes:29, edges:55`）而沙箱只有 5 件。
  ⇒ 夹具每沙箱一子进程（`node --import tsx --eval`，跨平台用 `process.execPath`）。
- **零真仓写入**：一切改坏在 `mkdtemp` 沙箱内进行，`finally` 清理；真仓全程 `git status` 洁净。

---

## 4. 交付物

| 文件 | 说明 |
|---|---|
| `tests/l4/edge-lag-unknown-degraded-1134.test.ts` | **新增**（唯一代码交付物）。30 用例：A 真仓基线 7 / B 改坏即红 5 / C 边界 8 / D 读取边界契约 3 / E 零出现报告 4 / F 映射完整性 3 |
| `docs/synova/product-lines/evidence/1134-edge-lag-unknown-degraded-20261009.md` | 本件 |

**未改动**：`extensions/ontology/edge-types/**`（**值与键一律未动** —— 同形保持）、`extensions/ontology/tags.json`、
`scripts/**`（含控制塔防线）、**权威文档**、`src/**`（含 `src/l4/ontology-loader.ts`）。

---

## 5. 判据原始输出

### 5.1 定向 vitest（单文件；**禁跑全量**，全量归自验员串行）

```
$ node_modules/.bin/vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts --reporter=verbose
 ✓ A1 生产装载器读到 55 件边类型（棘轮）
 ✓ A2 派生降级计数 = 50（`unknown` = 显式降级标记，棘轮）
 ✓ A3 枚举内真值 = 5（棘轮）
 ✓ A4 无规范违规、无字段缺失、无映射断裂（禁静默放宽枚举的底线）
 ✓ A5 读到 `unknown` ⇒ 必产 degraded 标记（铁律 11/31，不得静默）
 ✓ A6 具名审计行：每个 `unknown` 一件一行，且点名**真实文件名**与 `$id`
 ✓ A7 审计行点名的文件**真实存在**（抽样 5 条逐条核验）
 ✓ B1 沙箱基线（前 5 件，未改坏）：degraded=4 / inEnum=1
 ✓ B2 翻转 1 件 枚举值→unknown ⇒ 计数漂移被观测到
 ✓ B3 判别性：把「绿」断言施加到改坏输入上 ⇒ 必然抛（判据有分辨力）
 ✓ B4 还原即绿：flip → 红 → 恢复 → 回基线
 ✓ B5 改坏为**第 3 类值**（非 unknown）⇒ specViolation>0 ⇒ 必红
 ✓ C1…C7（字段缺失 / 空串 / 非字符串 / 自造第 7 值 / 豁免面恰 7 项 / 契约 / 映射断裂不伪造文件名）
 ✓ D1 对任意含 `unknown` 的输入：degradedFlag=true 且每个 unknown 都有审计行
 ✓ D2 🔴 棘轮：读取侧发射体状态必须显式声明为 NOT_IMPLEMENTED（本卡不覆盖读取侧）
 ✓ D3 生产装载器自身的 degraded 语义与本审计**无关**（防混淆）
 ✓ E1 真仓：`6-12_months` 与 `>12_months` 零出现 ⇒ 被报告出来
 ✓ E2 🔴 零出现**不阻断**：它不出现在 auditLines（违规面）里
 ✓ E3 六值全部出现 ⇒ 无零出现报告（报告面本身有分辨力）
 ✓ E4 零出现**不得**被误记为降级或违规（三态互不吞并）
 ✓ F1 55 件的 `$id` 均能映射到真实文件（无断裂）
 ✓ F2 审计行一律点名真实文件名，且文件确实存在
 ✓ F3 🔴 存量事实留档：5 件 `$id` 尾段 ≠ 文件名（报告不阻断，禁从 `$id` 反推）

 Test Files  1 passed (1)
      Tests  30 passed (30)
   Duration  11.60s
VITEST_EXIT=0
```

### 5.2 改坏即红 · 两腿原始输出（**零真仓写入**，tmpdir 沙箱，55 件全集）

命令：`bash .k4-publish/redproof.sh`（脚本全文随交付件；沙箱 = `mktemp -d` + 55 件逐字副本）

```
  [改坏动作] capital_acquisition.json: action_effect_lag 'immediate' -> 'unknown'

════════ 绿腿：55 件逐字副本（未改坏）════════
EDGE_TYPES_LOADED=55
LAG_UNKNOWN=50
LAG_IN_ENUM=5
LAG_MISSING_FIELD=0
DEGRADED=false
DERIVED_DEGRADED_COUNT=50

════════ 红腿：同上 + 1 件真值→unknown（改坏）════════
EDGE_TYPES_LOADED=55
LAG_UNKNOWN=51
LAG_IN_ENUM=4
LAG_MISSING_FIELD=0
DEGRADED=false
DERIVED_DEGRADED_COUNT=51

════════ 判别性判定（棘轮基线 = 夹具常量）════════
  夹具棘轮基线:  BASELINE_TOTAL=55  BASELINE_DEGRADED=50  BASELINE_IN_ENUM=5
  绿腿读数:      EDGE_TYPES_LOADED=55  LAG_UNKNOWN=50  LAG_IN_ENUM=5   ⇒ 与棘轮相等 ⇒ 断言通过（绿）
  红腿读数:      EDGE_TYPES_LOADED=55  LAG_UNKNOWN=51  LAG_IN_ENUM=4   ⇒ 偏离棘轮   ⇒ 断言必抛（红）

  ⇒ 判据有分辨力：改动 1/55 件（1.8%）即被观测到；真仓未被写入。
```

🔴 **注意红腿的 `DEGRADED=false`**：生产装载器自身的 `degraded` **只表"加载错误"、不表字段值**
（`src/l4/ontology-loader.ts:111` `degraded: errors.length > 0`）。
⇒ 即使 51 件未标定，装载器仍返回 `degraded=false` —— 这正是**字段级降级必须由本审计承载**的实测依据（夹具 §D3）。

---

## 6. 独立自验分歧（**必读 · 原文照贴，禁抹平**）

> **定位声明（自验员原文）**：
> 「以下为**独立自验员的「自验意见」**，不是结论。甲/乙的**裁定权在 CTO 收件闸 + K3 终审**，不在自验员，也不在编码员。队长已裁定「走乙」，**自验员接受该裁定并按其执行 Phase 2 判据**；本节仅存异议理由，供 K3 复核。」

### 6.1 【原文照贴 · 出处：`docs/synova/product-lines/evidence/k4-verify-baseline-20261009.md` §B.6】

**判定倾向：甲（把 `unknown` 纳入/显式豁免，并定义消费语义）**，理由三条：

1. **触发条件是"暂未标定"，不是"降级"**。卡面 §五 给甲的触发条件是「`unknown` **不是**降级标记（只是"暂未标定"）」。实测支持后者：`1-8` 条目标题原文即「落权威文档15 已给的 5 条预估值，**其余标 unknown**」；权威文档15 `:149` 自述该字段"**尚未全面写入**"，循环配置里的值代表"**预期生效延迟**"。这是**内容缺口**，不是运行态能力失败。
2. **乙的前置事实不存在**。乙要求"确认 `unknown` **就是**显式降级标记"→ §B.3/§B.4 实测：零消费者，无任何 degraded emit/receive 面。在零消费者上"加降级信号"没有落点（谁 emit？传给谁？）。
3. **D1174 既有决策已把值内容划归产品线**（`memory/notes/.../d1174:9`），与"甲=改权威文档枚举 + 定义消费语义（登记件/产品线域）"的落点一致；乙会把这件静态内容问题塞进运行态降级通道，与铁律 11/31 的语义（运行态能力失败）不符。

**但必须附两个强制项（否则甲会退化成 CTO 明令禁止的"先加上 unknown 就行"）**：

- 🔴 **M1｜甲 ≠ 只改枚举**：必须同时给出 `unknown` 的**消费语义**。而当前**零消费者**意味着"消费语义"目前无处落地 ⇒ 该落地判据**必须挂在触发点 `1-8` 上**（即：`1-8` 的 `tests/sentinel/edge-lag-consumed.test.ts` 与 `unknown` 语义定义**同批交付**，不得只制造消费者）。
- 🔴 **M2｜枚举缺值面须一并收口**：`6-12_months` / `>12_months` 在 55 文件中出现 **0 次**（§B.1 补充事实）。若只讨论 `unknown` 而不处理这两个"从未落地的枚举值"，严格校验器上线时它们的**缺席**同样无法判定是"合法未使用"还是"漏标"。此点卡面未涉及，建议 CTO 纳入范围。

**【原文结束】**

### 6.2 自验员的补充声明（原文照贴）

> 「我在 §B.6 里已写明「甲/乙的**裁定权不在自验员**」，且我的第 1 条理由**本身就引用了 `1-8` 条目标题原文**支持"暂未标定" —— 队长后来用 `issue987-988:63/41` + doc15 三章 `:526` 的语义轴裁乙，**证据我未复跑**（`issue987-988` 证据件我未独立核），故我**不主张我的判甲优先于该语义轴**；两条轴（语义轴 vs 可实施性轴）确实可能并存，如队长所说「语义=乙，落点=今天只在防线侧」。这点也请写入，免得 K3 以为我在主张"零消费者 ⇒ 语义也该是甲"。」

### 6.3 并列陈述（编码员侧，**不评判**自验员）

两条轴**不互斥**，各自的支撑如下 —— 均照贴事实，供 K3 裁量：

| 轴 | 立场 | 支撑事实（可核） |
|---|---|---|
| **语义轴**（判定 `unknown` 的**性质**） | **乙** | §3.1 四条证据链；其中 `issue987-988:63` 明文援引**铁律 11/31**、`:41` 明言值域为六值「**外加 `unknown`**」、doc15 三章 `:526` 已给 `degraded: true` 处置 |
| **可实施性轴**（判定**落点是否存在**） | **甲**（自验员） | §2.1 实测 `src/`+`packages/` 命中 **0** ⇒ 零消费者、零 emit 落点；自验员 LEG 4 独立复现「越枚举值不可见」（见下） |

**编码员侧的落点结论（与队长裁定一致）**：**语义 = 乙；落点 = 今天只在防线/审计侧。**
本件**不宣称**读取侧已降级（§9.2 棘轮 `READ_SIDE_EMISSION = 'NOT_IMPLEMENTED'`）。
**自验员所指出的"零消费者 ⇒ 无 emit 落点"这条事实，我完全采信并已写入本件 §2.1 与 §9.2。**

**自验员的独立复现（LEG 4，`$TEMP` 沙箱 + `SYNO_EDGE_TYPES_DIR` 注入缝，零改仓库）**：

```
[LEG 0] 真仓原样                               → ✅ 全部 55 件      GUARD_EXIT=0
[LEG 1] 沙箱逐字副本(对照)                     → ✅ 全部 55 件      GUARD_EXIT=0
[LEG 2] 删掉某条边的该字段(改坏即红)           → ❌ 汇总: 检查 55 件，违规 1 处   GUARD_EXIT=1
[LEG 3] 复原                                   → ✅ 全部 55 件      GUARD_EXIT=0
[LEG 4] 🔴 值越出权威枚举：
        action_effect_lag='unknown'            → ✅ 全部 55 件      GUARD_EXIT=0  ← 不可见
        action_effect_lag='NOT_IN_ENUM_AT_ALL' → ✅ 全部 55 件      GUARD_EXIT=0  ← 不可见
[LEG 5] 真仓 unknown 计数 = 50
```
⇒ **乙路线的 BEFORE 态 = 「越枚举值（含全部 50 条 `unknown`）不产任何 degraded、不产任何审计行」，且连彻底非法的值也完全不可见 ⇒ 该防线零枚举感知。**
本件的改坏即红即锚在此：**放一个越枚举值 ⇒ 必须产降级/审计；复原 ⇒ 必须干净**（§5.2）。

---

## 7. 🔴 CI 口径关系（**防 K3 误判"未接线"**）

`ci.yml:774` 与 `:1464` 两行 `# tests/control-tower/check-ontology-fields.test.sh` **确为注释行**，
但**这不等于"未接线"** —— 两种口径都对，关系如下：

| 口径 | 是什么 | 是否参与判定 |
|---|---|---|
| `ci.yml` 的 `SEALED-MANIFEST-BEGIN/END` 块（`:765-800` 与 `:1455-1490`） | **生成物**，块头自述：「执行集**不取自本块**（取自上面的发现制取数）⇒ **本块过期不影响判定**」；用途「① 兼容『接线 = 路径出现在 ci.yml 全文』类既有夹具；② 人读清单」 | ❌ **不参与判定** |
| `scripts/control-tower/sealed-tests.sh` 的**发现制**取数 | 执行集 = 发现面扫描 − 隔离台账；发现面唯一声明处 `SEALED_FACES="tests/control-tower tests/doc-system"` | ✅ **执行集真源** |

**实测**：
```
$ bash scripts/control-tower/sealed-tests.sh --list | grep ontology
tests/control-tower/check-ontology-fields.test.sh
$ bash scripts/control-tower/sealed-tests.sh --list | wc -l
88
$ grep -rn ontology tests/control-tower/gate-integrity-baseline.txt
(零命中 = 未进隔离台账)
```
⇒ 该防线件**真在 CI 执行集内**（未进隔离台账）⇒ 「接线了 ≠ 被执行」对此件**已排除**。

⚠️ **口径适用范围（自我订正，勿误引）**：上述"88 条发现制"**只覆盖 `tests/control-tower` + `tests/doc-system` 的 `.test.sh` / `.test.py`**。
本件落 **`tests/l4/edge-lag-unknown-degraded-1134.test.ts`** 属 **TS**，**不在**密封面内 ——
它由 **vitest job** 执行（`vitest.config.ts:28` `include: ['./tests/**/*.test.ts', …]`）。
**两条执行通道不同，两条都真跑**，但不可混引。

**旁证（D1174 自述的过渡态）**：`memory/notes/proposed/2026-10-07-d1174-ontology-field-guard.md:14-15` 自述
「接线前本防线为「手动可跑、CI 不跑」的过渡态」——该句写于 `#1198` 合入前；今日实测已进执行集（上）。**两处不矛盾，是时间断面差异**，本件以**今日实测**为准。

---

## 8. 「何时爆」—— 可判触发点（三条，各由一条命令回答）

### 8.1 触发点表

| ID | 触发点（文件 / 卡 / 版本指针） | 可判命令（今天即可跑） | 今日读数 | 会不会爆 |
|---|---|---|---|---|
| **T1** | `scripts/control-tower/check-ontology-fields.sh` 判据被升级为**值域枚举校验**（其自述「判据变更 ⇒ 提案 → K3 → CTO」） | `git grep -n '^FIELDS=' origin/main -- scripts/control-tower/check-ontology-fields.sh` | `FIELDS="action_effect_lag transfer_function"`（**仅字段名，无枚举**） | 🔴 **会一次爆 50** |
| **T2** | 权威文档01 **第二章下一版本**把 `action_effect_lag` 写入 42 边属性块（doc15 三章 `:440` 指定落点） | `git grep -c action_effect_lag origin/main -- <权威文档01第二章>` | **零命中**（该文件 1489 行，E-01..E-42 逐条属性块） | ❌ 单独不爆（见 8.2） |
| **T3** | 施工项登记 `1-8` 的消费方验收件落地 | `git ls-tree -r --name-only origin/main \| grep -c edge-lag-consumed` | **0**（`tests/sentinel/edge-lag-consumed.test.ts` 不存在） | ❌ 单独不爆；落地后 `unknown` 必须有消费语义 |

### 8.2 🔴 与卡面叙述的分叉（**按实测分开陈述，不改写卡面原话**）

**卡面原话**：同一文档称 Loader 将来会「交叉校验并标记差异」（≈`:149`）⇒ **严格校验器上线那一刻，50 条越枚举值会一次性爆**。

**实测**：这两件事**不是同一件**。
- doc15 第一章 §3.4 的"交叉校验"示意代码（`:602-609`）实际做的是
  `const officialLag = EDGE_REGISTRY.getActionEffectLag(edge.edgeId);`
  `if (officialLag && officialLag !== edge.actionEffectLag) { errors.push(…不一致) }`
  ⇒ 比较的是 **循环配置里的值 vs 42 边注册值**的**差异**，**不做枚举成员校验**
  ⇒ **单独上线不会因 `unknown` 而爆**。
- 且其依赖的 `EDGE_REGISTRY` / `getActionEffectLag` **全仓零实现**：
  `git grep -ln 'getActionEffectLag\|EDGE_REGISTRY' origin/main -- src/ packages/ extensions/ scripts/ | wc -l` → `0`
  （是文档里的示意代码）。

**⇒ 真正会一次爆 50 的是「枚举成员校验器」，它今天尚不存在。** 最可能的落点是 **T1**（现有防线的判据升级）。
**卡面方向正确**（"严格校验器上线前必须先收 unknown"），**触发件写错了**。本条已报队长 → CTO，**请 CTO 订正或确认**。
（自验员独立复现同一读数，**互相印证**。）

---

## 9. 未决项 / 不在本卡范围（**不宣称覆盖**）

### 9.1 判据等级与 §三 A/B/C/D

卡面完成标准第 4 条要求「判据已过**分辨力审计（CTO §三 A/B/C/D）**并在卡面标注」。
**实测：该定义在 `origin/main` 中不存在**，8 份卡面镜像（1031/1056/1057/1134/1350/1412/1436/1455）内亦无定义，
仅 #1134 自己引用它。可查到的近邻碎片只有：`D1160` brief 提及「**四条判据打勾表**」且判据 A =「**落本项写集内**」（其载体文档 `D1160-门禁提案-登记表追加型豁免与D708多命中分级.md` **不在 main**）；
另见「门禁质量通则：**先红后绿 + 反例**」。

⇒ **本件不自评 L3/L4；判据等级 = `L2-真跑（分辨力审计定义缺失，待 CTO 补）`。**
🔴 **未决项 U1**：请 CTO 提供 §三 A/B/C/D 原文，或裁定以本件 §3.2 的 J1–J4 自审表替代。**编码员不发明判据定义。**

### 9.2 🔴 读取侧 emitter（**本卡不覆盖**）

- 实测 `src/` + `packages/` 对 `action_effect_lag` 命中 **0** ⇒ **不存在可插桩的"读取侧"**。
- 因此本件交付的是 **审计 / 防线侧的可执行实现**（具名审计行 + 派生 `degraded` 计数 + 漂移即红）。
- **不是**「读取侧已产 degraded」。**严禁**将本件读成"读取侧已降级 / 已实现"。
- **未决项 U2**：「读取侧发射体」（真有人读 `action_effect_lag` 时必须 degraded）需要 `src/**`，
  **不在本卡写集** ⇒ 与 `施工项登记.ts:788` 条目 `1-8` 的验收件
  `tests/sentinel/edge-lag-consumed.test.ts`（实测**在 origin/main 上不存在**）**同批**交付。
- **本件内的可执行棘轮**：夹具 §D2 钉死 `READ_SIDE_EMISSION === 'NOT_IMPLEMENTED'`；
  读取侧落地者**必须显式改该常量** ⇒ 夹具转红 ⇒ 被迫同步更新契约与本件。

### 9.3 其他

- **未决项 U3**：控制塔防线的「枚举化」= **冻结判据变更**（其自述 `:15-16`「提案 → K3 → CTO」）
  ⇒ **不由本卡动**，已由队长立独立卡（提案 → K3 → CTO）。
- **未决项 U4**：`$id` ↔ 文件名 5 件分歧（§2.3）为**存量事实**；是否统一（改名 or 改 `$id`）**超出本卡范围**，仅登记 + 报告不阻断。
- **未决项 U5**：`6-12_months` / `>12_months` **零出现** —— 是"合法未用"还是"漏标"，**二义未决**，
  本件只**报告不阻断**（自验员 M2 强制项）。
- **未决项 U6**：`check-ontology-fields.sh:80` 硬要求 `transfer_function` 为非空**字符串**，
  与 G-3 的 `number|{param}` schema **互斥** ⇒ 非本卡范围，已由队长合并上报。
- **未决项 U7（前提来源）**：队长读数「136 个 open PR 中 `extensions/ontology/edge-types` 命中 **0 处**」
  依赖 GitHub API；**账号封禁期本件无法独立复跑** ⇒ **采信队长读数并标注来源**，**未据为己测**。

---

## 10. 诚实级别声明 + 自检

### 10.1 级别

| 级别 | 本件是否声称 |
|---|---|
| L1-静态可达（文件解析 + 字段存在 + 值非空） | ✅ 成立（且已有既有防线） |
| **L2-装载穿透（`loadOntology()` 真跑 + 断言数据穿透）** | ✅ **本件声称**（§5.1 A 组 7 例穿生产入口真跑） |
| L3 / L4 | ❌ **不声称**（§9.1 判据等级定义缺失，待 CTO 补） |
| 「字段已被业务消费」 | ❌ **不声称**（实测零生产消费方，§2.1；`1-8` 验收件不存在，§9.2） |

### 10.2 自检 5 问

1. **接线检查**：新 export（`auditEdgeLags` / `EDGE_LAG_ALLOWED_SET` 等）**调用方 = 本夹具自身**；
   夹具由 **vitest job** 自动纳入（`vitest.config.ts:28`）⇒ 真跑，非纸面接线。
2. **异常处理**：子进程失败 / 超时 / 输出不可解析 ⇒ **抛**（fail-closed，禁与"通过"混同）；沙箱失败 ⇒ 抛；无静默吞。
3. **类型安全**：`as any` = **0**；`as never` = **0**；`as unknown as` = **0**（用 `Record<string, unknown>` + 类型守卫）。
4. **测试质量**：**30 例**，覆盖正常（A 7）/ 改坏即红（B 5，含判别性与还原即绿）/ 降级（D 3）/ 边界（C 8）/ 报告面（E 4 / F 3）；断言非空壳。
5. **残留清理**：无死代码；不改任何既有文件；沙箱 `finally` 清理；真仓 `git status` 洁净。

---

## 11. 复跑命令清单（独立审计可直接重放）

```bash
WT=/d/novis-backup-20260526/Novis/.synova-wt-1134
export PATH="/c/Program Files/Git/bin:$PATH"   # Windows: 否则 .git/hooks 静默 fail-open
cd $WT

# ① 卡面 §② 前提
git grep -h '"action_effect_lag"' origin/main -- extensions/ontology/edge-types/ | sed 's/.*: //' | sort | uniq -c
git ls-tree -r --name-only origin/main -- extensions/ontology/edge-types/ | wc -l

# ② 零消费方
for a in src packages extensions scripts tests; do echo -n "$a/ -> "; git grep -l action_effect_lag origin/main -- $a/ | wc -l; done

# ③ 既有防线今日行为（零枚举感知）
bash scripts/control-tower/check-ontology-fields.sh; echo "GUARD_EXIT=$?"

# ④ 执行集（接线 != 被执行）
bash scripts/control-tower/sealed-tests.sh --list | grep ontology
bash scripts/control-tower/sealed-tests.sh --list | wc -l

# ⑤ 定向 vitest（**禁**加 --run 之外的全量；全量归自验员串行）
node_modules/.bin/vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts

# ⑥ 改坏即红（零真仓写入）
bash .k4-publish/redproof.sh

# ⑦ 触发点 T1/T2/T3
git grep -n '^FIELDS=' origin/main -- scripts/control-tower/check-ontology-fields.sh
git grep -c action_effect_lag origin/main -- "docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第二章-42条因果边权威定义-v1-0-20260714.md"
git ls-tree -r --name-only origin/main | grep -c edge-lag-consumed
```

---

## 12. 状态

**`可提请独立审计`** —— 本件不作"通过"判定。**通过与否归 CTO 收件闸 + K3 终审。**
本 PR **未合并、不自行合并**（小队红线：K3 复审通过前不得合并）。
