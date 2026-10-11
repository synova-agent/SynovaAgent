#CRITERIA: D

# Task Brief: #187 → K12-04 — 追问由本体缺口驱动

> 卡面真源: Gitea Issue **#187**（本件 = 该卡面的**任务卡面件**，`Q2 写集` 与行文以本件为准）
> 架构基准: 院方 `产品宪章.md` v8.1 **§0.4 ＋ §4.1**（② 本体层 ＝ 结构的电子病历；⓪-b 人侧入口）
> 机器真源: `docs/synova/coordination/施工项登记.ts` K12 块 id `K12-04`（issue 187）
> 判据命令（登记件 `3-4` 原文）: `npx vitest run tests/onboarding/gap-questioner.test.ts`（expectExit 0）
> 断面: `gitea/local-main = 437cc7236`（`git rev-parse gitea/local-main` 实测）
> 纪律: 缺字段问 Lead，不许猜；**不许靠改判据让它变绿**

## 〇、为什么要做这个（通俗版 · 先读这一节）

① **一句话** —— agent 只问「**这张图上还缺什么**」，缺什么问什么，**问完就停**。

② **解决什么问题** —— 通用 AI 助手做采集的通病是**没有边界**：要么无限追问（烦死客户），
   要么问不到点（漏关键信息）。原因很简单：**它没有"一家公司该长什么样"的图**。

③ **做完对项目的推动** —— 让建档**可终止、可复现**（同一份输入 ⇒ 同一组问题），
   并把本体从「存数据的地方」变成「**采集的导航图**」。

④ **不做行不行** —— **不行**。院方《02》§九 原则③原文：「**这是通用 AI 助手做不了的原因：
   没有本体，采集无处落、问询无边界**」——本卡就是相对通用助手的那道门槛。

⑤ **现在有什么基础** ——
   · ✅ 本体 29 节点 / 55 边已定义（`extensions/ontology/`，实测命令见 Q0b）
   · ✅ 建档通道六步已合（K12-03 `src/onboarding/onboarding-flow.ts:34,119-125`）——
     第 ③ 步 `gap-questions` 目前**只报缺口数**（`detail: 产出 N 条待追问`），并留了注释
     「具体追问表归 K12-04」
   · ❌ `src/onboarding/gap-questioner.ts` **不存在**（`ls` 实测）

⑥ **还需要做什么** —— 缺口计算（未实例化节点/边 → 问题集）＋「问题 → 来源 id」映射表 ＋
   有穷性/闭合保证 ＋ 配对测试（含反例）

⑦ **DSH 借鉴方式** —— **参考自研**（卡面 §⑦ 原文照录）
   · 可借：**声明"需要什么"→ 宿主满足**（`packages/compaction/compaction-basic/src/index.ts:114`）
     —— 同型：**问什么 = 声明本体缺口**
   · 可借：**判据由包自带**（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）
     —— 追问集完备性判据由**本体**提供（本卡落为「来源可追性 + 有穷性 + 闭合性」三条自检）
   · **自研**：问题生成逻辑完全自研（DSH 无"企业本体缺口"对应物）

⑧ **涉及代码文件** —— `src/onboarding/gap-questioner.ts`（新）｜`src/routes/onboarding.ts`（**接线一处**）｜
   `tests/onboarding/gap-questioner.test.ts`（新）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本卡在**架构块 ② 本体层（读方）＋ ⓪-b 人侧入口（写方）**：建档第 3 步把「本体＝期望形态」
与「企业图＝现状」比一次，差值就是追问表。**不碰数据库、不写内容面**（纯读 + 纯函数 ⇒ 可判据）。

与 K12-03 的分工（**别做重**）：K12-03 的第 ③ 步**只报「缺口数」**（一行 detail）；
本卡出**追问表本体** —— 每条问题的**文本 + 它对应的待实例化节点/边 id**。边界 = **"数" vs "表"**。

与 K12-02 的分工（**别做重**）：K12-02 的 `extensions/onboarding/what-to-ask.yaml` 是**人写的采集方法**；
本卡是**机器按本体缺口算出的待补清单**。前者属内容面（删掉引擎照常启动），后者属**引擎侧**。

### b) 文件审计（实测，as_of `gitea/local-main@437cc7236`）

| 件 | 实测 | 命令 | 处置 |
|---|---|---|---|
| `extensions/ontology/**` | **98 件** | `find extensions/ontology -type f \| wc -l` | 只读（K12-07 写集） |
| 节点类型 | **29**（resource 13 ＋ activity 8 ＋ outcome 8） | `find extensions/ontology/{resource,activity,outcome} -name '*.json' \| wc -l` | 追问来源（节点） |
| 边类型 | **55** | `find extensions/ontology/edge-types -name '*.json' \| wc -l` | 追问来源（边） |
| 本体 id 口径 | 节点 `$id` == 目录路径（`resource/money`）；边 `$id` 前缀是 `edge/`（目录 `edge-types/`），另有 **5 件** `-`/`_` 差异（`incentive-binds` / `locks-in` / `signal-transmits` / `decision-concentrates` / `external-assumption`） | `python3` 逐件比 `$id` 末段 vs 文件基名 | **只认 `$id`**，不用路径反推（否则 55 边全误判） |
| `src/onboarding/gap-questioner.ts` | **不存在** | `ls src/onboarding/` | **新建** |
| `src/onboarding/onboarding-flow.ts` | 已存在（第 ③ 步为占位） | `sed -n '119,125p'` | **不改**（K12-03 写集，已合） |
| `src/routes/onboarding.ts` | 已存在（K12-03 的 HTTP 入口；`git log --all --` 只有 `cf2d4e825` 一条） | `git log --oneline -- src/routes/onboarding.ts` | **改一处**（接线，见 c） |
| `src/l4/ontology-loader.ts` | 已存在（L4 职责：validator + 端点矩阵；**带 cache、根目录写死 cwd**） | `sed -n '43,75p'` | **不复用**（无注入点 ⇒ 反例不可复跑；理由写入代码头） |

### c) 决策
1. **新建**（无覆盖）：问题集**由本体缺口生成**，不写死问题列表（写死 = 无法随本体演进）。
2. **接线点选择**（本件与卡面 Q2 的**唯一差异**，如实标注）：
   - pre-commit 组 4a 是**硬阻断**（`scripts/pre-commit-check.sh:836-856`：新 export 必须在
     `src/` 有非 `export` 行、非同文件、非 `.test.` 的引用）⇒ 卡面原 3 件写集**无任何 src/ 消费者**，
     提交必被拒（`synova-commit:448` 强制跑该脚本）。
   - 真消费者只有两条路：① `onboarding-flow.ts` 第 ③ 步（**卡面明令禁改**）；
     ② `src/routes/onboarding.ts`（**采纳**）。
   - **只加字段、不加路由**：`POST /api/onboarding/start` 的响应 `data` 增 `gapQuestions`。
     实测约束：`tests/routes/onboarding.test.ts:85` 是 `expect(gets).toEqual(['/api/onboarding/steps'])`
     ⇒ **新增 GET 路由会打红 K12-03 已合的测试**；加字段该测试零破坏（只做属性访问）。
   - 代价（如实）：写集比卡面多 1 件；若 Lead 判越权，删该文件调用即可，`gap-questioner.ts` 与测试自足。

## Q1: 调研 — 依据 / 反例 / memory 教训

### a) 判据依据（卡面 §Q1 原文）
- 院方《02》§九 原则③：「**追问由本体定义，有穷** …… 没有本体，采集无处落、问询无边界」
- DSH `compaction-basic/src/index.ts:114`（`static inject` 按名声明）⇒ 同型：问什么 = 声明本体缺口
- DSH `dsh-invariants/lib/index.js:6-13`（判据由包自带）⇒ 追问集完备性判据由**本体**提供

### b) 反例自证（**改坏即红**，判据不自洽则本卡不成立）
| 改坏 | 期望 | 本卡落点 |
|---|---|---|
| 删掉来源节点 `resource/money.json`（**注入副本**，不动 `extensions/ontology/**`） | 追问表里该来源消失 / 必备落点判悬空 ⇒ **vitest exit 1** | V4 锚点用例 + V2 悬空用例 |
| 本体目录不存在 | **不抛** + `degraded:true` + 错误码 `ONTOLOGY_DIR_MISSING` + 空表 | 降级用例 |
| 单文件 JSON 坏 | 只降级该文件，其余类型照常产出 + `ONTOLOGY_JSON_INVALID` | 降级用例 |
| 缺 `$id`/`label` | 记 `ONTOLOGY_SHAPE_INVALID` 并跳过（**不静默通过**） | 降级用例 |
| 必备落点不在本体 | `ONTOLOGY_REQUIRED_MISSING` + `dangling` 非空 + `degraded` | 悬空用例 |

### c) memory / 同型教训
- 铁律 11/24/31：所有失败路径**不抛**，收成 `errors[]` + `degraded` + `log.warn`
- 铁律 47/48：JSDoc 三段齐（@input/@output/@degraded）＋ 测试真 `expect()`（17 例）
- 铁律 38：零 `as any`/`as never`/`as unknown as`（测试文件同样）
- 内容面规范 §2.2 判据：「删掉 X 引擎照常启动」⇒ 追问器属**引擎侧**，故**不进** `extensions/`

## Q2: 范围
做什么：
- src/onboarding/gap-questioner.ts
- src/routes/onboarding.ts
- tests/onboarding/gap-questioner.test.ts
- .claude/task-briefs/2026-10-11-187-gap-questioner.md

说明（非写集，供审读）：
`src/onboarding/gap-questioner.ts` 新建 —— 读本体（`extensions/ontology/**`，只读）→ 算缺口（未实例化节点/边）
→ 生成**有序追问表**：每条问题带 `id`/`order`/`text`/`sourceId`/`sourceKind`，另有「问题 → 来源」映射表
（逐行 `resolved`）与 `dangling`（健康本体恒空）。唯一对外函数 `buildQuestionTable()`（组 4a 只认被
`src/` 真实调用的 export，故导出面收窄到这一个）。
`src/routes/onboarding.ts` **改一处** —— `import { buildQuestionTable }` ＋ 在既有 `POST /api/onboarding/start`
的响应 `data` 里加 `gapQuestions`（建档期图未实例化 ⇒ 空图 ⇒ 全量追问）；**不加任何路由**、不动既有字段。
`tests/onboarding/gap-questioner.test.ts` 新建 —— 配对测试 17 例：正常（空图有序表/有穷性）｜V2 映射表
（悬空 = 0）｜V3 确定性＋闭合｜降级四例｜边界（悬空判定/label 命中/端点提示）｜V4 锚点反例。

不做什么：
- 不改 extensions/ontology — K12-07 写集，本卡**只读**（反例走注入副本，不删仓库本体文件）
- 不改 src/onboarding/onboarding-flow.ts — K12-03 写集（已合，第 ③ 步占位保持原样）
- 不改 extensions/onboarding — K12-02 写集（内容包只读参考，本模块不依赖它）
- 不改 tests/routes/onboarding.test.ts — K12-03 判据件（加字段已实测零破坏，不动它）
- 不改 scripts/pre-commit-check.sh — 门禁语义归 CTO
- 不改 src/l4/ontology-loader.ts — L4 职责，本模块不引 L4（避免跨层 + cache 干扰反例复跑）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`POST /api/onboarding/start`（建档第 ③ 步；生产入口，pre-auth 已由 K12-03 白名单）
处理：读本体 → 算缺口（未实例化节点/边）→ 生成有序追问表 + 「问题 → 来源」映射表
结果：
- **V1** `npx vitest run tests/onboarding/gap-questioner.test.ts` ⇒ **exit 0**（实测 17 passed）
- **V2** 每个问题**可追到一个待实例化节点/边**：`mapping` 逐行 `resolved`，`dangling = 0`
  （实测 84 问题 = 29 节点 + 55 边，`DANGLING=0 ERRORS=0 degraded=false`）
- **V3** **有穷且闭合**：同输入两次 ⇒ 问题集逐字相同（两次 `sha256` 相等）；
  `observed` 覆盖全部来源 ⇒ `gapCount = 0`（不再问）
- **V4** 反例（**硬要求**）：把某问题的来源节点从本体删掉 ⇒ **必红**
  （实测：`SYNO_ONTOLOGY_DIR=/tmp/onto-broken`（少了 `resource/money.json`）⇒ exit 1，3 例红；
  清掉注入 ⇒ exit 0）

## 架构层
**架构块 ② 本体层（缺口来源 / 只读）＋ ⓪-b 人侧入口（采集面）**；代码落点 = `src/onboarding/`（非 L1–L5 层），
接线点 = 代码层 **L1** `src/routes/onboarding.ts` → `src/onboarding/`（同向调用，无跨层违规）。

## 写集
| 文件 | 类别 |
|---|---|
| `src/onboarding/gap-questioner.ts` | task |
| `src/routes/onboarding.ts` | task（接线：本卡唯一 src/ 消费者，只加字段） |
| `tests/onboarding/gap-questioner.test.ts` | task |
| `.claude/task-briefs/2026-10-11-187-gap-questioner.md` | task（本件） |

## Done 标准
- [ ] verify: `npx vitest run tests/onboarding/gap-questioner.test.ts`（expectExit 0；登记件 `3-4`）
- [ ] verify: `npx vitest run tests/routes/onboarding.test.ts tests/onboarding/ tests/middleware/onboarding-whitelist.test.ts`（K12-03 已合判据零回归）
- [ ] verify: `npx tsc --noEmit`（基线存量 29 处，本卡文件 0 处；基线/变更后错误集逐行相同）
- [ ] verify: V2 映射表原始输出（悬空 = 0）
- [ ] verify: V4 改坏即红原始输出（注入副本删来源节点 ⇒ exit 1；清注入 ⇒ exit 0）
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` ⇒ exit 0
