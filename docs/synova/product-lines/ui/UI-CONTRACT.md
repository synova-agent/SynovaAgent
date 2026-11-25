# UI-CONTRACT v1

> **落库与双署名**（落库 2026-11-25；原稿 `.tmp-UI-CONTRACT-v1-20261124.md` 内容逐字保留，仅补双署名、§3.1 核对结果与 §4.3 客户语言词典）
>
> · **数据侧（L1/L2 ＋ L3 数据形状）＝ 已冻结**：由数据侧 CTO 定稿，`contractBase: 712b1e418`。
> · **UI 侧（L4 客户语言 ＋ 展示派生）＝ 本线补入 §4.3 客户语言词典**，其余条款按本契约执行。
> · 权威顺序不变：创始人最新裁定 ＞ 产品宪章 ＞ 本契约 ＞ 各线内部规范。
> · 原稿标题中的「（修订稿，待创始人确认）」保留在下方原文，本落库不改其状态字段。

> **总原则（首要）**：本契约只负责**双线接口**，不替代产品宪章，**也不把当前仓库实现自动追认为正确设计**。
> 当前实现与创始人已确认的产品方向冲突时，**登记差距并修正实现**。
> 权威顺序：创始人最新裁定 ＞ 产品宪章 ＞ 本契约 ＞ 各线内部规范。

---

## §0 范围与契约基线

### 0.1 适用范围（**仅此一处，不得外推**）
本契约**只适用**于「**企业分析会话／瓶颈假设**」这一输出面（DSH 运行事件 → 假设卡片 → 其空态/失败态）。

**不覆盖**：企业扫描、目标跟踪、工单、设置、登录与权限管理等其他界面 —— 它们**另立契约**，不受本表字段完备性限制，也不受本契约 §6 双签约束。

### 0.2 契约基线

```
status: v1 定稿（2026-11-24，创始人确认方向 + 10 条修订已落）
contractBase: 712b1e418（gitea/main tip，定稿时实测；后续引用一律钉此 SHA 或其后的明确 merge_commit）
```
**规则**：§1 表中每一行都必须标 `existing`（已在 main）／`approved_pending`（已批准未合入）／`proposed`（提案未批）；
**禁止**把"计划中的"写成"已存在的"。

---

## §1 L1 数据与协议（技术线维护，UI 只读消费**

| 项 | 形状 | status | 来源/说明 |
|---|---|---|---|
| `hypothesis.structured` | `{hypothesis, objects[], relations[], evidence[], uncertainty[], schemaVersion}` | `existing` | `src/runtime/dsh/hypothesis-adapter.ts` |
| `hypothesis.invalid` | `{reason:{code,missing[],message}, text, truncated}` | `existing` | 同上 |
| `run.completed` | `{stopReason, stats, empty}` | `existing` | **协议终态，不等于业务成功**（见 §2） |
| `run.failed` / `run.cancelled` | 错误载荷（code/phase/retryable） | `existing` | 同上 |
| `run.started` | `{userId, scope, enterpriseId, problemId?}` | `problemId` 为 `approved_pending`（#1489 已合入则为 `existing`，定稿时按 SHA 核） | `src/routes/dsh.ts` |
| 域上下文 `insufficient` | `{code:'INSUFFICIENT_CONTEXT', reason, missing[]}` | `existing` | **是 `synova_context_get` 的返回字段，不是 SSE 事件**。若要桌面直接消费，必须由技术线明确"谁把它转成什么事件"（当前未定义 ⇒ `proposed`） |
| `synova_context_get` | `count` + `items[]`（`$id`/`businessKey`/`relation`/`evidence`） | `existing` | `domain-context.ts` |
| `metric_observations` 阈值语义 | `thresholdSource: config→可成信号｜default→演示性（`demonstrationOnly:true`, `fired:null`, `severity:unrated`）` | `approved_pending`（ingest v0 起用） | 技术票 |

**schemaVersion 规则**
- **新生产的事件必须填 `schemaVersion`**（不再长期可选，避免以后无法演进）；
- **兼容规则**：遇到未知**主版本** ⇒ **不猜解析**，界面显示「不支持的结果版本」+ 技术详情入口；不得降级猜字段。

**UI 消费边界**：UI **只能依据契约字段推导展示**，**不得读取未声明字段推导业务真值**；
纯展示字段（本地化文案、图标、折叠状态、排序偏好）由 **UI 自决**，无需技术线加字段。

---

## §2 L2 真值语义：**传输状态 与 业务结果 必须分开**

### 2.1 两个状态位（由技术线在后端给出，UI 不得自行拼）

```
transportStatus: running | stream_ended | disconnected | cancelled
outcomeStatus  : success | partial | failed | insufficient_data | invalid_output | no_output
```

- **界面主状态只以 `outcomeStatus` 为准**；
- **`transportStatus` 与协议终态（`run.completed`/`stopReason`）只放"技术详情"**，不作主文案；
- 工具 `isError=true` ⇒ `outcomeStatus` **必须是 `partial` 或 `failed`**，不得为 `success`；
- `count=0`／`INSUFFICIENT_CONTEXT` ⇒ `insufficient_data`；有文本但 `hypothesis.invalid` ⇒ `invalid_output`；无文本 ⇒ `no_output`。

> 现状：后端**尚未**统一给这两个字段 ⇒ 标记 `proposed`；在补齐前，UI **不得**用零散事件自行推断最终结论并当作真值展示（可展示为"暂无法判定"）。

### 2.2 判定表（UI 必须如实表达）

| 事实 | 必须表达 | 禁止表达 |
|---|---|---|
| 工具失败 | 部分完成 / 失败 + 人话原因 | "运行完成" |
| 数据不足 | 数据不足，无法形成瓶颈假设 + 缺什么/怎么补 | 渲染成"瓶颈假设"并填占位四要素 |
| 输出不合格 | 输出未按约定成型（详情入口） | 静默丢弃 / 假装成功 |
| 本轮未产出 | 本轮未产出假设 | 与"能力缺失"混同 |
| 阈值 default | 演示性计算，不可作诊断结论 | 当作真实异常 |
| 本体/哨兵未跑 | 明确状态位 + 原因 + 下一步 | "暂无数据" |
| 部分来源缺失 | 显示已有依据 + 明确缺口 | 补全 / 隐去缺口 |

### 2.3 其余状态（补）

| 状态 | 必须表达 |
|---|---|
| 未选择企业/对象 | 先选择分析对象，**不发请求** |
| 正在读取资料 | 真实进行状态；**不显示假进度百分比** |
| 未配置模型/运行时不可用 | 当前不能分析 + 原因 + 处理入口 |
| 无权限 | 无权查看；**不泄露对象是否存在** |
| SSE 断流 | 连接中断、可重连；**不得显示完成** |
| 哨兵未配置阈值 | 未评级 / 未运行；**不显示"正常"** |
| 请求被取消 | 已取消；**不等同失败或完成** |

---

## §3 文件级分权（**按文件，不按同一文件里的句子**）

| 文件 | 所有者 | 职责 |
|---|---|---|
| `electron-renderer/src/stores/dsh-run-store.ts`（或重构后的 `contracts.ts`） | **技术线** | 事件归约 + **稳定数据形状**（类型导出） |
| `electron-renderer/src/stores/selectors.ts`、`view-model.ts`、`presentation/**` | **UI 线** | 把稳定数据映射成展示模型 |

**规则**：
- **UI 不改归约语义**（不得在同一 store 里加业务判断）；
- **技术线不改展示派生**（不得决定文案/图标/折叠）；
- 若 UI 需要展示派生，**新建文件**，不改 store。

### 3.1 阻断批定义（此前缺失，现补齐）

```
名称：现场阻断修复批（6 项客户可用性阻断）
Issue：**#1480（正本）** —— 【现场阻断】客户界面 6 个可用性阻断
      注（**R12**，2026-11-25，数据侧 CTO 裁定）：`#1482` 为**重复票误关**（body 与 #1480 逐字相同，同日 00:49 由 UI 侧 CTO 关为重复）。
      **不据其状态判断完成度**；完成度一律看 #1480 与本文件 §3.1 的核对结果。
⚠️ **定稿核对项（必须由 UI CTO 在首个 PR 里回报）**：#1482 实测 state=**closed**。
   若为"已修复关闭" ⇒ §3.1 的"未合入前禁改 components/**"自动解除，UI 可直接接手；
   若为误关或已被合并到别的票 ⇒ CTO 重开票后本批恢复独立执行。
   **在核实前，不得默认阻断批已完成**（否则会以"已完成"为由跳过 B1/B3/B4/B5 的验收）。
> **【核对结果 · 2026-11-25，UI CTO 实测】**
> `#1482` 的 `state=closed` 是**误关**，不是"已修复关闭"：
> · `closed_at = 2026-11-25T00:49`，关闭动作由 **UI 侧 CTO 本人**执行，关闭理由写在票内首条评论：
>   「重复票：与 `#1480` **逐字相同**（body SHA256 一致），同分钟双发（2026-11-24 21:14，疑似建票重试）」。
> · **正本 `#1480` 至今 `state=open`**（评论 2 条：接管声明 ＋ B1 已修）。
> · 实际完成度：**B1 已修并合入 main**（PR `#1496`，merge `9d35b2383`，T2 控件基座）；**B2/B3/B4/B5/B6 均未修**。
> ⇒ **判定：阻断批未完成，§3.1 的「未合入前禁改 `components/**`」继续有效。**
⚠️ 另注：UI 重做侧已有既存线（#1483 / #1485 / #1481，均 closed；#1494 为 UI 重做文档面 v1.17）。
   本契约**不与那些文档冲突**：它们管"语言与视觉"，本契约管"双线接口与真值语义"。
   若两者表述不一致，**以本契约的 §2 真值语义与 §4.1 禁用词为准**（这是底线，其余以 UI 线文档为准）。
范围：B1 白底白字 / B3 技术字段泄漏 / B4 假成功 / B5 空态包装 / B2 边栏 / B6 空转状态
文件范围：electron-renderer/src/components/**、样式/主题、以及 §3 表内"技术线"文件的必要改动
合入 base / merge commit：<合入后填 merge_commit SHA>
Done 条件：B1 对比度 ≥ WCAG AA(4.5:1) 脚本可证；B3 禁用词 grep 为空；B4 isError→非成功态；
          B5 数据不足不渲染假设卡；B2 可收起且状态保持；B6 未加载/未运行有状态位
未合入前 UI 线可改（完全独立）：docs/**、文案词表、审计报告、图标/主题 token 设计稿、可访问性规范文档
未合入前禁止的**只是「UI 重做实施」**（导航结构重排、信息架构重排、换皮）动 components/**；
**不禁止"修阻断项本身"** —— B2–B6 各批**只在自己阻断项范围内**改 components/** 属阻断批施工，合法（R9，2026-11-24）。
机器判（每 PR 必带）：① 标题/正文标明所属 B 项（B2/B3/B4/B5/B6 之一）；② diff 触及的组件与文件能归到该 B 项，
归不进去的**单独拆 PR**；③ 越界即驳回，不算"顺手优化"。
```

---

## §4 禁用词（三层区分，避免与"技术详情"自相矛盾）

### 4.1 默认客户界面：**禁用**
```
DSH ｜ mcp__ ｜ sidecar ｜ ACP ｜ JSON-RPC ｜ DOMAIN_EMPTY ｜ problemId ｜ $id
｜ relation.type ｜ evidence.sources ｜ sessionId ｜ stopReason
```
`runId` 例外：**仅允许出现在"支持/诊断"区**，不得成为主要用户内容。

### 4.2 技术详情
仅在**明确授权的开发者/实施模式**下可见，**默认收起**；该区域内可展示原始协议内容（含上述词）。

### 4.3 源码扫描范围（避免验收自相矛盾）
只检查 **可见文案 + 默认渲染结果**（快照/DOM）；**不扫描**类型名、测试夹具、开发者日志、注释。

**客户语言词典**（UI 线填写，须覆盖本契约范围内全部可见字段）
| 内部字段/概念 | 客户说法 | 备注 |
|---|---|---|
| `hypothesis.structured` | 瓶颈假设（结构化结果） | 只在成型时出现 |
| `hypothesis`（文本） | 瓶颈假设 | 一句话结论，不出现字段名 |
| `objects[]` | 涉及的对象 | 业务名词；按客户命名展示 |
| `relations[]` | 对象之间的关系 | 不出现 `relation.type` |
| `evidence[]` | 依据 | 「依据 1/2/3」编号可接受 |
| `uncertainty[]` | 还不确定的部分 | 必须可见，不得隐藏缺口 |
| `schemaVersion` | （不出现） | 仅技术详情 |
| `hypothesis.invalid` | 输出未按约定成型 | 给技术详情入口，不丢内容 |
| `reason.code` / `missing[]` | 缺什么 / 怎么补 | code 只进技术详情 |
| `run.completed` / `stopReason` | （不作主文案） | 只进技术详情（§2.1） |
| `transportStatus` | （不作主文案） | 只进技术详情 |
| `outcomeStatus = success` | 分析完成 | — |
| `outcomeStatus = partial` | 部分完成（有工具未成功） | 必须给原因 |
| `outcomeStatus = failed` | 分析失败 | 人话原因 ＋ 可重试提示 |
| `outcomeStatus = insufficient_data` | 数据不足，无法形成瓶颈假设 | 列缺什么、怎么补（§2.2） |
| `outcomeStatus = invalid_output` | 输出未按约定成型 | 技术详情入口 |
| `outcomeStatus = no_output` | 本轮未产出假设 | 与「能力缺失」严格区分（§2.2） |
| `INSUFFICIENT_CONTEXT` | 资料不足 | code 只进技术详情 |
| `count = 0` / `items[]` | 没有查到可用的资料 | 不得渲染成结论 |
| `$id` / `businessKey` | （不出现） | 用客户可读的对象名 |
| `sessionId` / `runId` | （不出现；`runId` 仅支持/诊断区） | 按 §4.1 例外条款 |
| 模型未配置 / 运行时不可用 | 当前不能分析 ＋ 原因 ＋ 处理入口 | §2.3 |
| 阈值 `thresholdSource=default` | 演示性计算，不可作诊断结论 | §2.2 |

> **本表是 §4.1 的补充，不是替代**：§4.1 是下限（可加不可减）。本表与《客户语言词典-v1.0》（`docs/synova/ui-redo/客户语言词典-v1.0.md`）一致；冲突时**以本契约 §4.1 为底线、本表为客户说法来源**。

**底线**：§4.1 是**下限**，UI 可加词、可细化，**不得减少**。

---

## §5 变更流程（跨界唯一通道）

1. 提**契约变更请求**（PR/Issue 评论），格式：`目标层 | 现状 | 期望 | 为什么必须 | 影响面`；
2. L1/L2 及 L3 的**数据形状** ⇒ **CTO 裁定**；L4 与展示派生 ⇒ UI 线自决；
3. 裁定后 L1/L2 由技术线开票实现；UI **不得在前端自行推导业务真值**（例：`outcomeStatus` 由后端给，不由 UI 猜）；
4. **并行规则（修订）**：等待期间**只停止依赖该变更的部分**；其余主题、布局、导航、可访问性工作**可继续**。
   **不得**用假字段/占位逻辑交付或合入。

---

## §6 验收：机器判 + **真实界面判**（两者不可互替）

### 6.1 机器判（触及本契约范围的 PR）
- **UI 线 PR**：① 默认渲染文案过禁用词检查（§4.3 范围）② `git diff` 断言未改 §3"技术线"文件的数据形状 ③ 空态/失败态 DOM 断言与 §2 逐条对应
- **技术线 PR**：① 不引入视觉决策（不改组件/布局）② 不把禁用词换成另一种技术词（`DOMAIN_EMPTY`→`EMPTY_DOMAIN`）③ 新增状态位须同步字段说明给 UI

### 6.2 真实界面判（**截图与 DOM 不能替代**）
- **明/暗两套主题**都检查文字对比度（≥4.5:1），给计算脚本与结果；
- **左右侧栏**收起/展开 + 状态保持；
- **常见窗口宽度**下无遮挡、无横向失控；
- **至少一次真实 Electron 点击**走通（不是只截图）；
- 明确：**截图不证明交互完整、DOM 不证明像素可读**；
- **渲染桥不执行 hook** ⇒ 容器接线必须有真实入口或集成验证，不得以"组件单测绿"代替。

---

## §7 停点（必须回来找 CTO/创始人）

1. UI 要改 L1/L2（哪怕"只加一个字段"）；
2. UI 认为某条禁用词"客户能懂"想放行；
3. 两边写集落在同一文件（**按文件分权后仍撞 = 立即停**）；
4. UI 发现某状态**界面上无法如实表达**（这是数据缺口，不是文案问题）；
5. 阻断批未合入就想动 `electron-renderer/src/components/**`；
6. 发现"当前实现与已确认产品方向冲突" ⇒ 登记差距、修正实现，**不得以本契约追认现状**。

---

## 附录：文件级归属总表

```
src/runtime/dsh/**            → 技术线
src/mcp/**                    → 技术线
src/sentinel/**               → 技术线
src/l4/**                     → 技术线
electron-renderer/src/stores/dsh-run-store.ts | contracts.ts → 技术线（数据形状）
electron-renderer/src/stores/selectors.ts | view-model.ts | presentation/** → UI 线
electron-renderer/src/components/**、样式/主题、文案资源 → 阻断批合入后归 UI 线
docs/synova/product-lines/ui/** → UI 线（本契约双署名）
electron-renderer/src/stores/app-store.ts → UI 线（只放 UI 状态：导航/折叠/主题；**不得推导业务真值**）  [R11]
electron-renderer/src/hooks/**          → UI 线（**不得复制 store 的归约逻辑**；若实质封装事件归约，归技术线并拆分）  [R11]
electron-renderer/src/lib/words/**      → UI 线（客户语言词典**单一真源**；技术线引用做禁用词检查，不反向修改）  [R11]
scripts/ingest-v0/**          → 技术线（V2+）
```
