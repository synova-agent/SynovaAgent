# #732 / 裁 425-B1+B2：capital-health 阈值单源（ccc / 债务期限结构）＋ 缺参缺键加严

- **状态**: proposed（待 L1 收件闸 ＋ K3 审计追认为 implemented）
- **日期**: 2026-10-27
- **批次**: P3-M7-裁425返工批（#825）· 活3／3 · 分支 `ct/p3m7-732-thresholds`（base `1ca0d4dfc`）
- **依据**: CTO 裁定 425-B1（阈值透传＝方案 A）＋ 425-B2（缺参/缺键 fail-loud 加严）｜ 卡 `task-3` 正文
  ｜ 队长裁定（本文件"三、不拥有"逐条对应）

## 一、拥有什么（本卡只改这一块）

| 面 | 内容 |
|---|---|
| 阈值来源 | capital-health 的 **ccc 与债务期限结构两对**阈值，只取 loader 注入的 **check 第 4 参**（`sentinel-loader.ts` 是 D577 的**唯一生产解析点**：manifest 基线 ＋ memStore 覆写） |
| 解析点归属 | **解析在 loader、消费在 aggregate**（L1 裁 B″）：aggregate **不 import 引擎**（K12-13 CC1 exit 0）、不自建第二个解析点；两 compute 调用点只消费注入结果 |
| 传参形态 | 两 compute 新增**必传** `thresholds: SentinelThresholdPair`；`compute*` 保持**同步纯函数**（禁 await／禁 IO） |
| 字面阈值 | 两个 compute 内**零**阈值字面量（`> 120`／`> 90`／`> 0.7`／`> 0.5` 全部移除） |
| manifest | 追加 `cash_conversion_cycle_days{90,120}`、`short_term_debt_ratio{0.5,0.7}` **在尾部**（覆写目标仍为首键 `roic_wacc_spread`）；`version 1.0.0 → 1.1.0`；已有 6 键与 `computes[]` **不动** |
| 加严① | compute 缺参／任一档非有限数 ⇒ 抛 typed error（`.code` = `CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING` ／ `DEBT_STRUCTURE_THRESHOLDS_MISSING`，`.phase`／`.retryable=false`，铁律 32）；**禁字面回落/默认值** |
| 加严② | manifest 缺这两键 ⇒ `ThresholdKeyMissingError`（`.code=CAPITAL_HEALTH_THRESHOLD_KEY_MISSING`）→ `check()` 外层 catch 出 `ch-error` finding，**description 逐键点名** ＋ `log.error`；禁静默取默认 |

## 二、为什么这样设计（第一性原理 ＋ 边界）

阈值是「判断来源」（宪章 §4.4 ④），不是算法常量。原实现里 ccc/债务结构两对阈值**硬编码在 compute 内部**
⇒ manifest 改了不生效、`getThreshold`/`applyThreshold` 的单源承诺对这两个指标**恒假**（第二把尺子）。

**为什么解析点在 loader 而不在 aggregate（改自方案 A）**：`sentinel-loader` 早就是 D577 的**唯一生产解析点**
（`:279-280` 解 `resolveThresholds` → `:294-306` 以第 4 参注入）；aggregate 自己再 `import` 引擎解析一次 =
**多造一个解析点** ＋ 违反 K12-13 CC1「内容面不得钻引擎」（实测 `SYNO_CI=1 check-content-coupling.sh` 由
`new=3` 降到 `new=1` 后再降到 **new=0 / exit 0** 的只有删掉那条 import 的路径）。⇒ 内容面只吃注入结果。

## 二bis、原「为什么」（历史，方案 A 的动机）

阈值是「判断来源」（宪章 §4.4 ④），不是算法常量。原实现里 ccc/债务结构两对阈值**硬编码在 compute 内部**
⇒ manifest 改了不生效、`getThreshold`/`applyThreshold` 的单源承诺对这两个指标**恒假**（第二把尺子）。
一支哨兵只要还有一处字面阈值，就不能对外称"阈值可由 manifest 配置"。

## 三、不拥有什么（越界即退回）

- 另外 **6 对**阈值的字面/默认值清算（`roic_wacc_spread` 等仍走 aggregate 自有 `DEFAULT_THRESHOLDS` 回退）——
  队长裁：本卡只归一 ccc/debt 两处已实测旁路，全哨兵字面阈值清算是另一张清账卡。
- `manifest.computes[]`（只列 6 个、实际调用 9 个）——不改，记未决。
- 阈值「档位方向」校验（`warning < critical` 之类）——不做，见已知限制。
- 其它 44 个哨兵的同类问题。

## 四、失败形态（怎么坏、坏了看得见吗）

| 触发 | 现象 | 可观测面 |
|---|---|---|
| compute 漏传 thresholds | **throw** `CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING`／`DEBT_STRUCTURE_THRESHOLDS_MISSING` | 调用栈即现场；不会静默按 120 判 |
| 两档之一 NaN/Infinity | 同上 throw（禁"半截默认值"） | 同上 |
| manifest 删键 | `ch-error` finding，id 固定、description 含 `cash_conversion_cycle_days`／`short_term_debt_ratio` | `log.error` ＋ finding 双通道；**不再**产出 `f5-ccc-crit`（无静默默认值结论） |
| 阈值解析器自身失败（loader 降级返回空表） | 走同一条缺键路径 ⇒ fail-loud（不被降级掩盖） | 同上 |
| 第 4 参未注入（既有 2 参直调，如 `tests/sentinel/capital-health-degraded.test.ts`） | `ch-error` 点名「第 4 参 thresholds 未注入」；**只**跳过 ccc/ds 两指标，其余 6 指标照常，**不外抛**（保调用方契约） | `log.error` ＋ finding；该文件 5 tests 仍全绿 |
| 数据不可算（cogs/revenue/total_debt ≤ 0） | 仍走原有 `degraded:true` ＋ warnings（不 throw） | 与配置错误**分离**：配置错 fail-loud，数据错降级 |

## 五、上限（能力边界）

- 只是把"两对阈值的来源"归一，**不改变任何算法**（`>` 边界语义逐字保留：等于线值不越级）。
- memStore 覆写仍只打 manifest **首个 key**（`roic_wacc_spread`）；本卡把新键追加在尾部正是为了**不改变覆写目标**。
- 早返回路径（无 Financial 节点／入口必填字段组缺失）**不解析阈值**——无可判定对象，不构成单源缺口。

## 六、已知限制（禁写"暂无"）

- **全哨兵其他 computes 的字面阈值未清算**（另张清账卡）。本卡只保证 capital-health 这两对单源。
- `DEFAULT_THRESHOLDS` 6 键**按裁定原样保留**为 `th()` 自用回退（本卡不动）；该回退只在 `this.manifest` 缺省时生效，
  且**严禁**把 ccc/债务结构两键加进去（否则缺键 fail-loud 会被字面默认值架空——裁 425 B2 禁的形状）。
- 阈值档位方向不校验：若 manifest 写成 `warning > critical`，判定仍按 `> critical → critical` 逐字执行（会得到更保守/更宽松的单调结果，但不会报错）。
- 本卡不动 `tests/e2e/p0-wane-baby.test.ts`（基线已红，存量缺陷，不认领）。

## 七、借用边界（复用既有机制，不新建）

- **阈值解析**：loader 的 D577 唯一生产解析点（`resolveThresholds` ＋ 第 4 参注入）—— 本卡只消费 **第 4 参**，不改 `src/sentinel/**`。
- **夹具缝**：`SENTINELS_FIXTURE_DIR`（`sentinel-loader.ts:51`，D751 注入缝）＋ `clearSentinelCache()`（公开 API）＋
  阈值解析的 `deps.memoryStore` 测试缝（其 JSDoc 明载）。**未改 `src/sentinel/**`**。
  夹具内 `aggregate.ts` 用**相对路径 re-export 垫片**（仅 tmp 内、不入库）—— 实测 vite-node 不按 realpath 解析 symlink。
- **输入有效性**：`checkFiniteInputs`（`src/sentinel/assert-finite-inputs.ts`，#1408）——原样调用。
- **反例取证法**：临时改 → 跑红 → `git checkout -- <file>` → `git status --porcelain` 归零（禁 stash，铁律 0-3）。

## 八、实测原始输出（本会话）

- 红态（新测试 vs 未改实现）：`Tests  13 failed | 4 passed (17)`
  - (a) `130 > 121 ⇒ 不得 critical；实得: f2-ds-warn,f5-ccc-crit` ⇒ 行为不随 manifest 变
  - (b) `缺键必须 fail-loud；实得: f2-ds-warn,f5-ccc-crit` ⇒ 静默取默认
  - (c) `expected '' to be 'CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING'` ⇒ 缺参不抛
- 绿态（定向）：`Test Files 18 passed (18) ｜ Tests 86 passed (86)`
- 受签名变更影响的既有 sentinel 测试 6 件：`Test Files 6 passed (6) ｜ Tests 50 passed (50)`
- 全量回归：`Test Files 242 passed (242) ｜ Tests 1532 passed | 4 skipped (1536)`
- 判据④（重写）：`grep -c resolveThresholds aggregate.ts` = **0**；aggregate 的 `src/sentinel` 行**全是 `import type`**（值依赖 0）
  ⇒ `SYNO_CI=1 bash scripts/check-content-coupling.sh` = `CONTENT-COUPLING: OK` / exit **0**
- 类型面（三改件，临时 tsconfig 扩 `extensions/`）：`tsc -p` exit 0；`npm run lint` 无输出；`npm run check:architecture` `架构检查: 全部通过 ✅`
