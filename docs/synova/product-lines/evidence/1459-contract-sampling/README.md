# #1459 M2 — 契约合格率两段抽样（M2a 生产现状 / M2b 内容质量）

> 2026-11-24 ｜ 执行者：coding session ｜ DEV DOC v1.1 §10.1（**优先于 §3/§5/§6 的 M2**）
> 一句话产品判断：**契约必须由系统级指令承载，并且必须同时解决「合法 `problemId`/上下文对象的发现与注入」——否则自然提问下形状合格率 0%、即使加格式引导也只到形状 60% 且内容回指 0%，两者都不能当生产可用。**

## 1 结论表（逐条可回溯到 runId）

见 `pass-rate.md`（生成物）与 `runs.json`（原始记录）。两种口径**分列、禁止混用**：

| 段 | run | 有文本 run（分母） | 形状合格 | 形状合格率 | 内容回指 | 内容回指率 |
|---|---|---|---|---|---|---|
| **M2a** 自然提问、零格式要求 | 5 | 5 | 0 | **0%** | 0 | **0%** |
| **M2b** 同题 ＋ T5 形状要求 | 5 | 5 | 3 | **60%** | 0 | **0%** |

- **形状合格** = 服务端适配器判 `hypothesis.structured`（四要素非空且类型正确）。
- **内容回指** = 四要素**逐项**命中隔离库真实存在的 `$id` / `predicate` / `source_ref`（`runs.json.referents` 列出全部真实指代）。
- 分母 = **有文本的 run**（10 条全有文本，空文本 run = 0）。
- 失败码：M2a 全部 `NOT_JSON`（5/5）；M2b 为 `MISSING_FIELDS`（2/5，缺 objects/relations/evidence 三项**空数组**）。

## 2 两段分别回答了什么

**M2a —「没有系统级契约指令时，模型会产出可解析的假设吗？」**
不会。5/5 是**散文 Markdown**（`## 先说结论…`），`parseHypothesis` 判 `NOT_JSON`。**这是结论，不是失败**：当前契约只由一次性 prompt 携带（T5 就是这样做的），真实用户不会自带格式要求。

**M2b —「格式被引导时，内容是否指向真实对象/关系？」**
形状被引导后 3/5 通过适配器，但**内容回指 0/5**：3 条 `structured` 的 objects/relations/evidence 是**占位散文**（如「未获取：problemId 无法解析，条目 $id 不可得（DOMAIN_EMPTY）」），不是真实 `$id`/`predicate`/`source_ref`；另 2 条直接给**空数组** ⇒ 适配器判 `MISSING_FIELDS`。
⇒ **M2b 的 60% 只能证明"形状可被引导"，不能当生产可用**（DEV DOC v1.1 明确禁止这种读法）。

## 3 抽样中观察到的两条产品事实（不是本次抽样目标，但会影响读数）

1. **`problemId` 不可发现 ⇒ 工具必然空手而归**：隔离库只登记了 `team:delivery-a`。自然提问下模型只能猜（`growth-slowdown`、`growth-2026`、`*`、`我们的增长为什么慢下来了`、`PROB-001`…），全部返回 `DOMAIN_EMPTY`；10 条 run 里没有一条拿到真实 `ContextSnapshot`。
2. **猜错会放大成本**：M2a-Q4 一次 run 里 `synova_context_get` 被猜调 **65 次**、`usage.totalTokens=374,799`；M2a-Q2 27 次 / 169,758；M2a 五条合计 **750,034** tokens，M2b 五条合计 167,293。契约缺失不只是"没输出 JSON"，还会烧 token。
3. 模型在拿不到数据时**没有编造**（如实写 `DOMAIN_EMPTY` 并把 objects/relations/evidence 留空/写占位）——这是**好的失败姿态**；但当前适配器把"空数组"判 `MISSING_FIELDS`、把"占位散文"判 `structured`，两种读数都离"内容可用"很远。

## 4 与 DEV DOC 的偏差（必须由 CTO 知情）

- **§6 M2 停点 vs §10.1**：§6 写「连续 3 条 `NOT_JSON` ⇒ 停」，§10.1 写「预期多数 `NOT_JSON`，低合格率是结论，不是失败」并明确 **v1.1 优先于 §3/§5/§6 的 M2**。
  **本次执行**：M2a 第 1–3 条即连续 `NOT_JSON`，**未停、也未改 prompt/加约束**，按 §10.3 把 5 条各问一次记满（否则 M2a 分母只有 3、表不可用）。停点原意（禁止加约束硬凑）已遵守：**全程零重试、零 prompt 调参、零追加提示**。
  若 CTO 认为仍应硬停，请裁定；本包不隐藏该冲突。
- **M2b 的"T5 格式要求"取的是形状块**：保留「只调用一次 `synova_context_get`、只输出 JSON、五个字段非空」的形状约束，**刻意剔除** T5 prompt 里的 `参数 problemId = team:delivery-a`（那是喂数据/提示答案，§10.1 明确禁止）。
- 抽样共用同一次环境启动（同一 API/桌面/DSH home），M1 与 M2 串行。

## 5 证据清单（本目录）

| 文件 | 内容 |
|---|---|
| `M2a-Q{1..5}-*` / `M2b-Q{1..5}-*` | 每 run：`-sse.txt`（SSE 原样字节）、`-dom.json`（桌面 DOM 读数）、`-desktop.png`（截图）、`-meta.json`（runId/sessionId/时间线）、`-dsh-session.json`（usage）、`-dsh-session-log.jsonl`＋`-dsh-session-report.json`（帧感知解压与不变量报告） |
| `runs.json` | 逐条记录 ＋ 真实指代集合 ＋ 三段汇总（本目录唯一数据源） |
| `pass-rate.md` | 合格率表（M2a/M2b 分列）＋ 失败码分布 ＋ 逐条行 |
| `runs-summary.json` | 汇总（机器可读） |

## 6 可复跑

```powershell
node docs/synova/product-lines/evidence/1459-contract-sampling/runner/m1m2-drive.mjs --cdp-port 9222 --base http://127.0.0.1:18790 `
     --email t5-admin@synth-1459.invalid --password-file <tmp>/out/password.working.txt `
     --evidence <ev> --phase M2a --skip-login true     # M2b 同理，--phase M2b
node docs/synova/product-lines/evidence/1459-contract-sampling/runner/consolidate.mjs --m1-evidence <M1 ev> --m2-evidence <this dir> `
     --dsh-home <dsh-home> --decoder scripts/dsh-sidecar/r3-chain/session-decompress.mjs `
     --session-usage docs/synova/product-lines/evidence/1459-contract-sampling/runner/session-usage.mjs --db %TEMP%\1459-scan\synova.db
```

## 7 边界

- 未改任何 `src/**` / `electron*` / 门禁；未碰主树、未碰真实客户数据；证据里无任何凭据值。
- 合格率数字全部由 `consolidate.mjs` 从 SSE/会话日志/DOM/隔离库计算，无手写。
