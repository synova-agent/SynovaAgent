# Task Brief: #1350 本体边体系提案（目标层级边 + 计划边 ⇒ 词表 55→57）

> 生成: 2026-10-08 | 工作树: `.synova-wt-edge-prop` | 分支: `docs/edge-vocab-proposal` | 基线: `origin/main 400124b00`
> 角色: 提案执笔（卡面补全小队 writer-c）｜ 结论口径: 执行方自验，**不称审计**；判据原始输出入 PR 正文
> 卡: `gh issue 1350`（提案 carrier）｜ 上游裁定: **R8 / R17 / R23**（`#1317` CTO 裁定台账）
> 性质: **本任务只写提案文档**（送审件 · 未裁不落地）——不改代码、不改 `edge-types` JSON、不改门禁脚本

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本体层 = 企业知识图谱的**类型声明面**（`extensions/ontology/**` + `packages/ontology/src/**`），
「**本体是护城河核心**」（`docs/synova/research/DSH迁移施工图-20260820/DSH迁移施工图-20260820.md:68-69`）。
本任务落 **L4 声明面**，但**不落任何类型文件**——只产出提案文档（`docs/synova/coordination/提案/`），
供 **K3 → CTO** 裁；真正的落地是 `#1290`（目标层级边）/ `#1316`（⑤ 计划节点）的活。

- 纵向解耦：**零代码**。不碰 `src/**`、`packages/**`、`extensions/**`。
- 横向解耦：不新增包。
- 扩展解耦：本件**定义**扩展点（新增边类型 = 加 JSON 文件），**不实施**。

现状定性（实测，as_of origin/main@400124b00）：
1. **R23 串行链当前位置**：`#1322` 已合入 main（`90eb2c687 ∈ main` ⇒ YES）⇒ 下一环 = 本提案；
2. **词表基线 55**：`extensions/ontology/edge-types/*.json` = 55 件；K4 判据脚本实跑
   `✅ 全部 55 件边类型关键字段齐全（action_effect_lag, transfer_function）` exit 0；
3. **两条新边名零命中**：`git grep "GOAL_DECOMPOSES_TO|PLAN_COMMITS_TO|goal_decomposes_to|plan_commits_to"` ⇒ exit 1；
4. 🔴 **本件最贵的一条实测**：既有 55 条边里 **18 个 `tags` 取值不在 `extensions/ontology/tags.json`**
   （`first_order`×30 / `second_order`×12 / `stage_2`×10 …）⇒ **照抄既有边 JSON 的 tags 会被
   `scripts/check-file-driven.sh`（pre-commit 组 8；CI `SYNO_CI=1` 严格模式）硬阻断**；
5. **本体节点词表无 goal/plan**（45 键，`:14-68` 零命中 goal/plan）⇒ 新边端点声明方式须裁（提案 §2.5）。

### b) 文件审计（实测，as_of origin/main@400124b00）
| 目标 | 实测 | 结论 |
|---|---|---|
| `extensions/ontology/edge-types/*.json` | 55 件；命名约定 `filename == label.toLowerCase()`（54/55 成立，例外 `external_assumption.json` ↔ `EXTERNAL_ASSUMPTION_BINDS`） | **只新增 2 件**，不改既有 |
| `extensions/ontology/tags.json` | 54 个合法标签值 | 新边 tags **必须**取自此处 |
| `extensions/ontology/edge-consumption-map.json` | 55 条（`consumed_by` 追踪） | 建议同步（无门禁强制） |
| `extensions/ontology/manifest.json` | 声明 `edgeTypes: 16` / `nodeTypes: 29`（**实测 55 / 45，已漂移**） | 待裁（提案 §十-5） |
| `packages/ontology/src/edge-types.ts` | `EdgeType` 常量 + `ALL_EDGE_TYPES` = 51 条；头注 `:1-21` 记录 42→51→55 关系 | 🔴 **必须同步**（否则 `data-exporter.ts:185` / `data-purger.ts:268` / `entity-resolver.ts:215` 静默漏） |
| `packages/ontology/src/node-types.ts` | 45 键（activity/outcome/resource/pool/external） | 无 goal/plan（§2.5 待裁） |
| `packages/sog-core/src/sog-core-schema.ts` | 第三套词表：`SOGNodeType.GOAL`(`:32`) + `SOGEdgeType.ALIGNS_WITH` GOAL↔GOAL(`:264`) | **不复用的四重理由**（提案 §3.2） |
| `src/l4/ontology-loader.ts` | `scanDir('edge-types')`(`:85`) ＋ 动态 `EDGE_ENDPOINT_MAP`(`:100-106`) ＋ `validateEdgeEndpoints`(`:137-142`) | 加文件即加载（零代码改动） |
| `src/loops/direction-monitor.ts` | `EDGE_CLASSIFICATION` 34 条（snake 键）；`CATEGORY_EDGES = Object.keys(...)`(`:127`) | 新边不加入 = 不参与方向监测（声明性） |
| `scripts/control-tower/check-ontology-fields.sh` | 实跑 exit 0 / 55 件；必查字段集**冻结** | **K4 判据**（本任务指定） |
| `scripts/check-file-driven.sh` | §b tags 硬阻断；`STAGED=git diff --cached --diff-filter=ACMR`(`:42`) 含新增文件 | 🔴 tags 陷阱（实测见上） |
| `scripts/control-tower/ci-signal-classify.sh` | `RULES` 9 条，**无 `extensions/`** | 🔴 K4 判据**不会自动跑**（提案 §十-8） |
| `scripts/check-integrity-startup.sh` | 端点闭合检查依赖 `extensions/ontology/node-types/`（**该目录不存在**） | dormant，登记即可 |

### c) 决策
已有覆盖 → **复用现有机制**（词表 = 加 JSON 文件；加载器已支持零代码新增）；
无覆盖 → **新增两条边类型**（R8 已裁：**不复用**既有边，避免污染下游 `consumed_by`）；
冲突 → 不动既有 55 条、不动 42 边体系、不碰 SOG 词表（只登记）。
**重写还是复用**：**新增**（R8 明裁）；**本任务只写文档，不新增任何文件到 `extensions/`**。
**决策参考系**：第一性原理（本体词表 = 护城河资产，可回滚性优先）+ 本仓先例
（`#1015 G-1` 的字段回归防线、`提案/判据变更-W3时滞-987-988.md` 的判据口径纪律、
`命名权威登记册` N3「代码本体为权威：`$id`(edge/snake) + `label`(UPPER)」）+ Anthropic 工程基线
（契约/判据先行，改动可回滚）。

## Q1: 调研 — 权威件 / 先例 / 历史教训
- 裁定件：`gh issue view 1317 --json body` ⇒ **R8**（:`32` 新增边类型不复用，走提案→K3→CTO）、
  **R17**（:`41` 串行：提案 → #1290 → ⑤）、**R23**（:`47` 串行含 #1322 首位）。
- 卡面：`#1290`（§③-3 边谓词取值二选一 + 禁止第三路）、`#1316`（§③-2 与 #1290 同族、不得各造同义边）。
- 权威件（库外）：`产品宪章.md:193`（§4.2 GOAL 与【计划】均为图节点）、`:382`（§8.1⑤ 定承诺）、
  `:129`（**P14** 改与退必须同一份数据）、`命名权威登记册.md:65-74`（N3 边编号权威形态）。
- 本仓先例：`scripts/control-tower/check-ontology-fields.sh`（字段回归防线，夹具 `tests/control-tower/check-ontology-fields.test.sh`）、
  `tests/acceptance/zero-code-industry.test.ts:82`（`edgeTypes.length >= 15`，加边不破）、
  `scripts/audit/check-gates-v2.py:818`（`edge_count >= 42`，加边不破）。
- 历史教训：① 判据纪律（`unknown` 曾零分辨力 ⇒ `提案/判据变更-W3时滞-987-988.md`）；
  ② 口径统一（「42 边」= 历史口径，工件是 55 个 JSON，`CTO-DSH派单台账.md:89`）；
  ③ 命名在交接处对不上（`命名权威登记册` 八条坏点五条同源）；
  ④ 门禁"该跑没跑"比多跑贵（`ci-signal-classify.sh` 注释 `:42`）。

## Q2: 范围 — 正确的最简方案
做什么（**只产出一份文档，零代码零 JSON 改动**）：
- 写 `docs/synova/coordination/提案/本体边体系-目标层级边与计划边-20261008.md`：两条新边逐字段定义
  （`$id`/`label`/语义/方向/`requiredProps`/`optionalProps`/`action_effect_lag`/`transfer_function`/`tags`）、
  为什么不复用（含 SOG `ALIGNS_WITH` 逐条否证）、下游触达清单（D1–D14，全部实测）、影响面实测（命令+原始输出）、
  改动清单（C1–C8）、回滚（P14，含 `graph_triples.predicate` 无外键的完整回滚）、
  判据（V1–V5，穿生产入口 + 反例）、K3 预判三问、**待裁清单 9 项**、附录（证据索引 + JSON 草案）。
- 建本 brief 与 claim `.claude/claims/1350.yaml`（**身份载体**；`alloc-task-id.sh` 已 DEPRECATED
  ⇒ 按 U5 以 **issue 号**作身份）。
（上列即本任务最终写集，逐条供 pre-commit 组 12 解析）
- docs/synova/coordination/提案/本体边体系-目标层级边与计划边-20261008.md
- .claude/claims/1350.yaml
- .claude/task-briefs/2026-10-08-1350-edge-vocab-proposal.md

不做什么（含文件路径）：
- 不新增/不修改 `extensions/ontology/edge-types/*.json`（**落地是 #1290/#1316 的活**）
- 不改 `extensions/ontology/tags.json`、`edge-consumption-map.json`、`manifest.json`
- 不改 `packages/ontology/src/edge-types.ts`（`EdgeType` 常量留给落地卡）
- 不改 `src/**`（含 `src/l4/ontology-loader.ts`、`src/loops/direction-monitor.ts`、`src/growth/**`）
- 不改 `scripts/**` 任何脚本（含 `check-ontology-fields.sh`、`check-file-driven.sh`、`ci-signal-classify.sh`）
- 不碰 `scripts/audit/**`（红线）｜不改 `.github/**`
- 不做：`#1290` 层级边实现、`#1316` 计划节点实现、42 边体系重写、SOG 词表收敛（仅登记）

## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`docs/synova/coordination/提案/本体边体系-目标层级边与计划边-20261008.md` + 本 PR。
**交互**：K3 依据提案内 **逐条可复跑命令**独立复核（§五 影响面实测 / §八 判据 / 附录 A 证据索引）；
CTO 依 §十 待裁清单 9 项裁定。
**结果**：① 提案可被 K3 以"命令 → 原始输出"逐条对照通过；② 待裁项全部落到 CTO 决策面；
③ **本 PR 合入后 `extensions/ontology/edge-types/` 仍为 55 件**（证本件未越界落地）。

## 架构层: 文档层（零代码）；所涉声明面 = 本体类型层（`extensions/ontology/**`，条件 B）

## Done 标准
- [x] V1 提案文档存在且含提案要求 7 项（逐字段定义 / 为什么不复用 / 下游触达 / 回滚 / 判据 / 不做什么 / K3 预判）
      verify: `test -f "docs/synova/coordination/提案/本体边体系-目标层级边与计划边-20261008.md"`
- [x] V2 **零越界**：本 PR 不含任何 `extensions/ontology/edge-types/*.json` 新/改文件
      verify: `git diff --name-only origin/main...HEAD | grep -c '^extensions/ontology/edge-types/' || true`
- [x] V3 K4 判据基线在本分支上仍 exit 0 且计数仍 55（证未动词表）
      verify: `bash scripts/control-tower/check-ontology-fields.sh`
- [x] V4 文档内引用的每条实测命令可复跑（附录 A 索引逐条）
      verify: `git grep -c "GOAL_DECOMPOSES_TO" origin/main || true`
- [x] V5 回滚可执行：删本文件即复原（P14：改与退同一份数据 —— 本 PR 只增一份文档）
      verify: `git diff --stat origin/main...HEAD`
#CRITERIA: B
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 消费 -->
<!-- 归属理由: 本件主题 = 本体边类型（`extensions/ontology/edge-types/*.json` 属条件 B「增长导航体系」，
     见 .codex/criteria-code-map.json）。**本 PR 零 src/extensions 改动 ⇒ G10 条件区域告警预期为 0**。 -->
