# 全角字符（Unicode 混淆字符）清单 — 分支 `ct/p3m7-pr5`（cron/cycle 范围）

> 生成时间：2026-10-28 ｜ 扫描方式：本地 Windows 经 gitea 拉取分支、只读分析，未改动任何文件
> 扫描脚本：`.workbuddy/scan_fw_classify.py`

---

## 一、结论先行（给你的一句话）

这波"模棱两可 Unicode 字符"警告，**不是 bug、不是攻击，是"中文文档被直接粘贴进代码"留下的标点污染**。
在受查范围内：

- **0 个**全角字符落在**变量名**里 → 排除"特洛伊源码攻击"（最危险那种）。
- **0 个**全角字符落在**裸代码语法**里 → 不会让程序解析报错。
- 302 个在**字符串字面量**里、1039 个在**注释**里 → 绝大多数是中文标点（`（）：；，—`）。
- **最危险的 `cron-config.ts` 里的定时任务表达式经逐行复核是纯 ASCII（`*` `/`），干净** → "定时任务静默不执行"最坏情况在此分支**不成立**。

> 英语对照：full-width char = 全角字符 ｜ homoglyph / confusable = 同形字/可混淆字符 ｜ Trojan Source = 特洛伊源码攻击（用长得像的字符冒充变量名）

---

## 二、精确分类数据（范围：55 个 cron/cycle 相关 `.ts` 文件）

| 类别 | 数量 | 含义 | 风险 |
|---|---:|---|---|
| 注释区 | 1,039 | 中文文档/说明里的中文标点 | 纯观感，零运行影响 |
| 字符串内 | 302 | 报错信息、日志标签、UI 文案里的中文标点 | 仅观感；若该字符串会被当代码解析才有风险（见下） |
| **变量名内** | **0** | — | 无（已排除攻击） |
| **裸代码内** | **0** | — | 无 |
| **合计** | **1,341** | | |

---

## 三、逐文件清单（注释 / 字符串 / 变量名 / 裸代码）

| 注释 | 字符串 | 变量名 | 裸代码 | 文件 |
|---:|---:|---:|---:|---|
| 43 | 53 | 0 | 0 | tests/cron/cron-config.test.ts |
| 66 | 43 | 0 | 0 | scripts/control-tower/probe-cycle-valves.ts |
| 56 | 43 | 0 | 0 | tests/cron/parse-cron-field.test.ts |
| 93 | 32 | 0 | 0 | scripts/control-tower/probe-cycle-edges.ts |
| 25 | 31 | 0 | 0 | tests/cycles/valve-mapping.test.ts |
| 145 | 25 | 0 | 0 | src/agent/cycle-conclusion-service.ts |
| 39 | 19 | 0 | 0 | tests/agent/cycle-conclusion-service.test.ts |
| 23 | 10 | 0 | 0 | src/cycles/cycle-loader.ts |
| 0 | 8 | 0 | 0 | extensions/sentinels/_extinct/market-lifecycle/aggregate.ts |
| 61 | 8 | 0 | 0 | src/growth/goal-lifecycle.ts |
| 12 | 5 | 0 | 0 | src/cycles/cross-scale-validator.ts |
| 13 | 5 | 0 | 0 | tests/sentinels/capital-health/cash-conversion-cycle.test.ts |
| 74 | 4 | 0 | 0 | src/cron/cron-config.ts |
| 1 | 4 | 0 | 0 | tests/growth/goal-lifecycle.test.ts |
| 12 | 3 | 0 | 0 | src/cycles/investment-advisor.ts |
| 20 | 3 | 0 | 0 | tests/agent/cycle-snapshot-service.test.ts |
| 3 | 2 | 0 | 0 | extensions/sentinels/_extinct/market-lifecycle/computes/lifecycle-stage.ts |
| 105 | 2 | 0 | 0 | src/cron/scheduler.ts |
| 1 | 2 | 0 | 0 | tests/cron/scheduler.test.ts |
| 22 | 0 | 0 | 0 | extensions/sentinels/capital-health/computes/cash-conversion-cycle.ts |
| 1 | 0 | 0 | 0 | extensions/sentinels/org-repairability/computes/compute-problem-action-cycle.ts |
| 11 | 0 | 0 | 0 | src/agent/cycle-snapshot-service.ts |
| 4 | 0 | 0 | 0 | src/agent/data-lifecycle-service.ts |
| 2 | 0 | 0 | 0 | src/cycles/cycle-registry.ts |
| 65 | 0 | 0 | 0 | src/cycles/cycle-types.ts |
| 73 | 0 | 0 | 0 | src/cycles/overflow-compute.ts |
| 5 | 0 | 0 | 0 | src/cycles/overflow-dashboard.ts |
| 18 | 0 | 0 | 0 | src/cycles/overflow-graph-bridge.ts |
| 9 | 0 | 0 | 0 | src/growth/goal-sentinel-lifecycle.ts |
| 6 | 0 | 0 | 0 | src/l3/data-lifecycle-service.ts |
| 16 | 0 | 0 | 0 | src/l3/pkb-lifecycle.ts |
| 5 | 0 | 0 | 0 | src/routes/data-lifecycle.ts |
| 2 | 0 | 0 | 0 | tests/cycles/cycle-loader.test.ts |
| 2 | 0 | 0 | 0 | tests/cycles/cycle-registry.test.ts |
| 2 | 0 | 0 | 0 | tests/integration/goal-lifecycle.integration.test.ts |
| 2 | 0 | 0 | 0 | tests/routes/data-lifecycle.test.ts |
| 2 | 0 | 0 | 0 | tests/sentinels/capital-turnover/cash-conversion-cycle.test.ts |

---

## 四、为什么 cron 表达式被判定"安全"（人工复核记录）

`src/cron/cron-config.ts` 第 41–46 行的实际表达式值：

```
'loop-1-diagnosis':    '0 9 1 */3 *'   // 季度（原值）
'loop-2-navigation':   '0 9 * * 1'     // 周一
'loop-3-ga-evolution': '0 9 * * *'     // 本卡唯一变更：季度→日频
'loop-4-self-check':   '0 0 * * *'     // 每日
'loop-5-knowledge':    '0 0 * * 0'     // 周日
'loop-6-overflow':     '0 9 1 * *'     // 每月 1 日
```

- 所有 `*` `/` 均为 ASCII。**全角 `＊`（U+FF0A）、全角 `／`（U+FF0F）均不存在于表达式值内。**
- 该文件 78 个全角字符全部位于 `//` 行尾注释（`原值（季度）— 未获批变更`）与中文 `log.warn(...)` 文案中，属观感类。

---

## 五、唯一残留风险（需人工点名的 1 件事）

302 个"字符串内"字符里，绝大多数是中文文案。**理论上**若某个全角字符落在"会被当代码解析的字符串值"里（如 `JSON.parse` 的内容、`new RegExp(...)` 的源串、SQL 语句、URL、或含 `*` `/` 的 cron 串），才可能出问题。本范围已确认 cron 串安全；其余多为报错/日志中文，风险极低。

**建议补一道保险**：在合并前，用编辑器"显示编码点"功能对 `scripts/control-tower/probe-*.ts` 与 `src/agent/cycle-conclusion-service.ts`（这两个文件字符串内字符最多）扫一眼，确认没有全角字符混进真正会被解析的串值即可。

---

## 六、处置建议（四步，按性价比排序）

1. **不用手改 1341 处。** 全部是观感污染，不影响功能，不值得逐个人肉改、也不值得盲目全局转 ASCII（会和进行中分支冲突、产生海量无意义改动）。
2. **合并前做一次轻量人工点名**（见第五节），重点看"字符串内"的 302 处是否含可解析串值。cron 已确认安全。
3. **低优先级一次性规范化：** 后续可对整个仓库做一次"注释/文案里的全角标点→半角"的规范化脚本清理，但必须人工 review，别盲转（避免误伤真正的全角需求）。
4. **切断源头（根因治理）：** 污染来自"富文本/中文文档直接粘贴进代码"。建议在门禁/pre-commit 加一道 **Unicode 同形字检查**，拦截"新增"的混淆字符，防止再犯。

---

## 七、与"门禁验收"的边界（不混淆）

你让我盯的那件事 = **核验 W1–W9 门禁有没有真正生效**（DEV DOC 已批、DSH 出了 PR #1088/#1090 但仍是 declared-only 未生效）。

本文档的"加一道 Unicode 同形字门禁"是**另一件、新的**事，属于门禁体系的扩展项，**不在当前验收范围**。等你说"去验收"时，我仍只按那套核验口径出结论。
