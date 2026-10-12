# Task Brief: #189 → K12-06 — 标准一致（输出契约 · 可机器校验）

> **卡面来源**：库外档案仓同名片（CTO 亲撰）｜本件 = 实施件（执行侧交付物，非裁决）
> **架构基准**：产品宪章 v8.1（P9 只能追加不能覆盖）｜纪律：缺字段问 CTO，不许猜
> **坐标**：总闸 `不适用` ｜ 承重件 `不适用` ｜ 批次 `第8批-K12` ｜ 命名空间 `不适用`
> ｜ 执行态 `已开工` ｜ 验证级别 **L2-真跑通** ｜ 阻塞源 `无阻塞`

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：产出（一页纸 / KPI 表 / 周报 / 诊断报告）**提交时自动体检**——缺字段就报错，
不是"给你个模板建议"。

**② 解决什么问题**：院方《02》§三 机制 3 原文：「**"给格式"不等于"保障一致"—— 要给可校验的格式**」。
没有校验 ⇒ 每个人交出来的"一页纸"字段顺序、口径、必填项都不一样 ⇒ **无法复核，也就无法比较**。

**③ 做完对项目的推动**：一致性**第③层（标准一致）的载体**；而且它有**第二职务**：
每次不合格**自动成为"下次预设更新"的输入**（院方 §四 飞轮）—— **校验器同时是反馈采集器**。

**④ 不做行不行**：**不行**。第③层明文要求"同一类判断用同一把尺子"；没有校验器，那把尺子只是建议。

**⑤ 现在有什么基础（实测，命令见 Q0-b）**：
· ✅ 模板侧已有：`extensions/reports/` **3 件**，且**已接线**（`src/init/file-driven-loaders.ts:35`
  → `content-registry.ts:190-200` 登记为 `report-template` / `status: reachable`）
· ❌ 校验器侧**不存在**：`src/output/contract-validator.ts` 无；`extensions/reports/contracts/` 无
⇒ 结论：**模板在、校验器不在**——差的就是"提交时自动检查"这一步

**⑥ 本件做了什么**：四类产出契约（`one-pager` / `kpi-table` / `weekly` / `diagnosis-report`）
＋ 校验器（`src/output/contract-validator.ts`）＋ 测试（含"缺字段必被拒"的反例面）。

**⑦ DSH 借鉴方式**：**参考自研**（两采一不采，见 Q1）。

## Q0: 定位

### a) 项目拼图
宪章 §2.7 **第③层**：同一类判断用同一把尺子。**"给格式"≠"保障一致"—— 要给可校验的格式**（院方 §三 机制 3）。
本件在架构图里属**交付面（⑤ 导航 → 交付）· 横切校验**：不改任何产出的**生成**逻辑，
只在**提交口**加一道**可机器判**的闸。

### b) 文件审计（实测，命令原始输出）
```
$ cd /private/tmp/k12b8-t189 && git fetch gitea local-main -q && git rev-parse gitea/local-main
ba1b22a8b5ff75833704bac22fcfcb47295dc970          # = 工位 HEAD，= 卡面锚

$ git ls-tree -r --name-only HEAD -- extensions/reports
extensions/reports/default.hbs
extensions/reports/executive-summary.hbs
extensions/reports/manifest.json                  # 3 件（卡面口径一致）

$ git ls-tree -r --name-only HEAD -- extensions/reports/contracts | wc -l | tr -d ' '
0                                                 # 契约目录：不存在
$ git ls-tree -r --name-only HEAD -- src/output/contract-validator.ts | wc -l | tr -d ' '
0                                                 # 校验器：不存在
$ git ls-tree -r --name-only HEAD -- tests/output
tests/output/expert-quality-cross-industry.json
tests/output/expert-quality-report.json
tests/output/expert-test-results.json             # 只有 3 个 .json 报告，无 .test.ts
```
**生产渲染器实测**（契约的章名/格式从哪来 —— 不是手写猜的）：
```
$ git grep -n "renderOnePager" -- 'src/**'
src/routes/diagnosis.ts:552:          const { renderOnePager } = await import('../agent/report-assembler');
src/routes/diagnosis.ts:556:          onePager = renderOnePager(
src/routes/diagnosis.ts:812:async function renderOnePagerOnDemand(...)
```
⇒ 一页纸的**真实生产入口** = `src/routes/diagnosis.ts`（按需渲染路径）。
其四个槽位章名实测在 `src/l3/report-templates.ts:211/231/232/233`
（`### 结论` / `### 关键证据` / `### 各维度循环结论` / `### 行动建议`）——
契约 `sections` 逐字抄自此实测（逐条比对命令见 Q3 的 V7）。

### c) 决策
**复用** `extensions/reports/`（不新建根），只加 `contracts/` 子目录 + 校验器。
契约 schema **内联在各自的 yaml 里**（DSH package-owned：判据随包走，宿主不统一校验）
⇒ 加一类产出 = 加一个 yaml，**不改校验器代码**。

## Q1: 调研

- **院方《02》§三 机制 3**（逐字）：一页纸＝固定字段（缺字段→报错）｜KPI 表＝固定口径｜
  周报＝固定结构 + 必填｜诊断报告＝固定章节 + 引用；「**产出提交时自动检查**，这才叫保障」。
  ⇒ 四类契约逐条对应上表，**不做第五类**，也不把四类揉成一条（尺子按类给）。
- **院方《02》§四**：输出契约有**第二职务** —— 每次不合格自动成为下次预设更新的输入（→ K12-08）。
- **DSH 依据**（卡面 §Q1 已给，本件逐条落到代码）：

  | 采纳/不采纳 | file:line | 落到哪 |
  |---|---|---|
  | ✅ 采纳：**schema 强校验 + 早失败** | `packages/settings/settings/src/index.ts:7`（`Config = z.object(...)`） | 契约以**声明式 schema** 描述形状；不合法即失败，不"尽量解析" |
  | ✅ 采纳：**失败可归因（机器可读）** | `@deepseek-ai/dsh-invariants/lib/index.js:11-13`（`InvariantError{code, packageName}`） | 每条错误带**稳定 code** `<contractId>.<kind>.<fieldPath>` + 契约版本 + 字段路径 |
  | ❌ 不采纳：宿主统一校验 | 同上 `:6-8`（package-owned） | schema **内联在各自 yaml**；`contract-validator.ts` **不内置任何契约知识** |

- **memory 教训 / 宪章 P9（只能追加不能覆盖）** ⇒ 契约带 `version`；`ValidationResult.contractVersion`
  让**产物记录用了哪版**（V6）。契约解析时 `contract.version` 缺失 ⇒ **拒绝加载**（`contract.load_failed`），
  不给"没版本也能跑"的缝。
- **决策参考系**：参考 第一性原理（"给格式"与"保障一致"的差别是**有没有可执行判据**）
  ＋ DSH 工程基线（schema 早失败 / 失败可归因）＋ 院方《02》三机制 ⇒ **结论**：
  把"格式"表达为**声明式契约文件** + **一个通用校验器**，使"加一类产出"不需要改代码。

## Q2: 范围

做什么：
- extensions/reports/contracts/one-pager.yaml
- extensions/reports/contracts/kpi-table.yaml
- extensions/reports/contracts/weekly.yaml
- extensions/reports/contracts/diagnosis-report.yaml
- src/output/contract-validator.ts
- src/agent/report-assembler.ts
- tests/output/contract-validator.test.ts
- .claude/task-briefs/2026-10-11-189-output-contract.md

不做什么：
- 不改 extensions/reports/default.hbs
- 不改 extensions/reports/executive-summary.hbs
- 不改 extensions/reports/manifest.json
- 不改 src/l4/decision-capture.ts
- 不改 extensions/presets/manifest.json

## 写集

| 文件 | 类别 |
|---|---|
| `extensions/reports/contracts/one-pager.yaml` | task（内容面） |
| `extensions/reports/contracts/kpi-table.yaml` | task（内容面） |
| `extensions/reports/contracts/weekly.yaml` | task（内容面） |
| `extensions/reports/contracts/diagnosis-report.yaml` | task（内容面） |
| `src/output/contract-validator.ts` | task |
| `src/agent/report-assembler.ts` | task（**接线** —— 见下方「写集扩权」） |
| `tests/output/contract-validator.test.ts` | task |
| `.claude/task-briefs/2026-10-11-189-output-contract.md` | task（本件） |

### 写集扩权说明（`src/agent/report-assembler.ts`）

**扩权来源**：team-lead 在令牌批准时**裁 ②**（原方案 ①「只交付 + 登记例外」被否）。
**否 ① 的理由（本批存在的理由本身）**：K12 第 7 批留档「#335 接上但暂无生产消费方」
（`getCurrentDepartmentIds()` 生产调用方 = 0）—— **没有生产消费方的交付 = 下一个 #335**。
本卡红线原文：「`contract-validator.ts` 是新 export ⇒ 必须 `git grep` 确认**生产调用方 > 0**」。
**否 ③（留成 K12-08 消费位）的理由**：K12-08 卡面 `:49/:84` 逐字预留的是**"失败记录"的消费位**，
**不是"触发校验"的调用位** ⇒ 触发校验无人接，走 ③ 同样落进"无消费方"。

**代价 Y（如实登记）**：
- ① 该文件 533 行、被 `src/routes/diagnosis.ts:552` **按需 import** ⇒ 属"动别人也碰的文件"，写集冲突面变大
- ② 必须保持 whole-body 语义：**校验器永不抛出、绝不阻断渲染**
  （`validateOutputContract` 自身 whole-body catch：`@output void`，产出方**无权**据结论改变产出）
- ③ 与 K12-08 的边界：本卡**只做"触发校验 + 落账调用"**，不改决策台账本身（#191 写集）

**为什么接线不破坏既有回归**：`renderOnePager` 的**返回值一字未改**（新增仅 1 行调用 + 1 行 import），
`tests/agent/report-assembler.test.ts` 的既有断言（含字节级确定性）不受影响。

## Q3: 验收 — 入口 → 交互 → 结果

入口：产出**提交时**经 `contract-validator.validateOutput(contractId, subject)` 处理：
按产出类型加载契约（`extensions/reports/contracts/<id>.yaml`）→ 校验字段/章节/口径/引用 →
不合格则 `ok:false` + **逐条点名**（`code` + `fieldPath`）+ **自动落账**。

判据（逐条命令原始输出见交付回件 R3）：
- V1 `npx vitest run tests/output/contract-validator.test.ts` ⇒ exit 0
- V2 `npx vitest run tests/output tests/reports`（回归面）⇒ exit 0
- V3 `npx tsc --noEmit` ⇒ exit 0
- V4 反例（改坏必红）：校验器短路（跳过必填检查）⇒ V2 必红，留原始输出 + **具体失败点**，还原后 sha256 逐字相同
- V5 V4 原始输出：**一次失败记录落账的原始行**（第二职务要有真载体）
- V6 穿生产入口：提交缺字段的一页纸 ⇒ **被拒 + 点名缺哪个字段**
- V7 契约章名 vs 真实渲染器逐字比对（`sections` 不许手写猜）
- V8 **接线实测**：`git grep -n "validateOutputContract" -- 'src/**'` ⇒ 生产调用方 > 0，
  且命中**不是注释**；**摘掉接线行 ⇒ 接线用例点名必红**

## 架构层: 交付面（⑤ 导航 → 交付）· 横切校验
#CRITERIA: D
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL）｜A 诊断 / B 导航 / C 接入与权限 / D 基建兜底 -->

## Done 标准
- [ ] verify: `npx vitest run tests/output/contract-validator.test.ts`（expectExit 0；登记件 `K12-06`）
- [ ] verify: `npx vitest run tests/output tests/reports`（回归面）
- [ ] verify: `npx tsc --noEmit`
- [ ] 反例（改坏必红）：校验器短路 ⇒ 留原始输出 + sha256 还原校验
- [ ] V4 原始输出：一次失败记录落账的原始行
- [ ] 卡上【读卡确认】+【交付】

## 边界（本件不做的判断，不夸大能力）
- 🔴 **不判数字是否真确**：契约校验形状/口径，无原始数据源可比。这是契约的**边界**，非缺陷。
- 🔴 **不判被引用对象是否存在**：`[src:finding:F-xxx]` 的**形态**可判，"该 finding 真存在"需 findings
  注册表 —— 跨模块引用完整性，已列入回件 R4 承接项。
- 🔴 **不判措辞话术**："越用越准/自我进化"类红线属**文档审查域**，不是输出契约域
  （写进契约会造出"契约能管话术"的假象）。
- 🔴 **接线已接**：`contract-validator.validateOutputContract` 在 `renderOnePager` 返回前调用
  （真实生产入口链 `diagnosis.ts:552/812` → `renderOnePager` → 提交口自检）。
  仍**不在**本卡写集内的后续面（见回件 R4，非阻塞）：KPI 表 / 周报 / 诊断报告三类契约
  **已声明、可被调用、暂无生产调用点** —— 只有一页纸接了提交口自检。
