# 主树文档治理审计 — 对标 DeepSeek Harness

> 版本 v1.0 ｜ 2026-10-29 ｜ 审计基准 `gitea/main @ b8edf9860`（= `local-main`，两票等价）
> 目的：学习 DSH 文档规范 → 盘点我方主树文档 → 判定留 / 改 / 撤 → 给出不影响主树的留存方案

---

## 〇、结论先行

| 项 | 数据 | 判定 |
|---|---|---|
| 主仓文件总数 | **5,820** | — |
| 其中 Markdown | **1,873 份 / 15.5 MB** | 严重超标 |
| 文件名带日期戳的 md | **1,310 份（70%）** | 过程产物，非文档 |
| `docs/` 目录 | 997 文件，其中 md 545 份 / 9.6 MB | 占 md 总体积 62% |
| DSH 对照：`docs/` | **330 文件**，根目录仅 7 个 md | 差 ~3 倍 |

**核心判断：我方主树不是"文档多"，是"把做过的事当成了文档存起来"。**
70% 的 Markdown 文件名里带日期戳 —— 这是流水账的特征，不是文档的特征。
DSH 同样保留了 2,220 份过程记录，但全部放在**隐藏命名空间 `.agents/`**，主树 `docs/` 因此能保持 330 份的精干。

**建议处置：撤离约 1,400 份（75%），主树保留约 470 份。**

---

## 一、DSH 的文档规范（学什么）

源码位于 `D:/deepseek-harness`，规范主文件 `docs/AGENTS.md`。提炼 8 条可迁移的规范：

### 规范 1：一事实一归属（One home per fact）

DSH 用一张表钉死每个层级"该装什么"和"**不该**装什么"，每条事实只有一个家，其余地方只留链接。

| 层级 | 职责 | 明确不属于这里 |
|---|---|---|
| 根 `AGENTS.md` | 常驻指令，每条 1–3 行 + 链接归属地 | 故事、案例、临时流程 |
| `docs/architecture.md` | 有序地图：组成、主循环、扩展点 | 类型定义、决策理由、实现状态 |
| `docs/subsystems/` | 每子系统一页：类型定义 + 语义 | 行为叙述 |
| `.agents/notes/` | **活跃决策记录**：为什么、放弃了什么、怎么验证 | 迁移计划、验收清单、spec 腔 |
| `docs/postmortem/` | **事故故事**——唯一允许战争叙事的地方 | — |
| `docs/cookbook/` | 步骤式 how-to，带编号验证步骤 | 设计理由 |
| `docs/user/` | 产品面文档 | 生成表格、贡献者流程、决策史 |

> 我方可直接复用这张表。`docs/authority/` 已有雏形（27 份），但缺"不该装什么"的负面清单。

### 规范 2：只写当前状态，不写变更史

> 原文：**Document current state, not change history.**

禁用 `previously` / `now` / `no longer` / `used to` / PR 号 / commit 号。
变更故事归 commit、PR、Agent Notes、postmortem。
另设 **slop checklist**（8 项）机器化巡检：同一规则多处重复、叙述历史、"implemented!" 状态标注、手写清单、推理过程转录、强调通胀等。

> 这一条直接命中我方病灶：1310 份带日期戳的文件，本质就是变更史。

### 规范 3：过程产物进隐藏命名空间，但**永久保留**

DSH `.agents/notes/` 共 **2,220 份，全部入库**，结构是「四态 × 类型」双维：

```
.agents/notes/
├── proposed/     78    待决
├── implemented/  1678  已落地（用现在时描述已发布的事实）
├── rejected/     33    被否决 ← 错误的东西也要留着
└── archived/     431   冻结历史（永不作为现行权威）
    按类型：feature 735 / architecture 501 / bug-fix 342
           process 303 / simplification 264 / testing 72
```

**这正是你要的效果：什么都留，但主树看不见。** `.agents/` 是点号开头的隐藏目录，不参与"文档"语义，新人浏览 `docs/` 不会被淹没。

### 规范 4：常驻文档有字数预算 + 机器门禁

`scripts/doc-budgets.manifest.json` 只给 **9 份**文件设上限，`pnpm run verify-doc-budgets` 拒绝超标：

```
AGENTS.md 1950 词 ｜ docs/AGENTS.md 1320 ｜ architecture.md 2400
cordis-primer 600 ｜ defensive-patterns 550 ｜ testing 1150
examples/AGENTS.md 310 ｜ packages/AGENTS.md 675 ｜ packages/README.md 994
```

超标时的处置顺序是硬规定：**① 搬迁 → ② 压缩 → ③ 才考虑提额**。
（实测 DSH 根 `AGENTS.md` = 1,936 词，刚好卡在 1950 上限内。）

> 对照：我方根 `AGENTS.md` = 23,181 字节 / 361 行，约为 DSH 上限的 2 倍体量。

### 规范 5：目录按"读者 + 用途"分，不按"产生时间"分

DSH `docs/` 8 个子目录：**subsystems 141 / user 43 / cookbook 27 / cordis-tutorial 24 / cordis-api 16 / postmortem 15 / i18n 9**。
**没有任何一个目录名含日期。** 我方 `docs/synova/research/` 下有 266 个形如 `A线-产品完整性缺口审计-20260801/` 的日期目录。

### 规范 6：事故复盘编号永久保留

`docs/postmortem/0001-acp-default-export-drops-inject.md` —— 序号 + slug，双语 + `.i18n.yaml`。
事故单独成族，**不和决策混放**，因为读者不同：决策给"要改代码的人"看，事故给"要避坑的人"看。

### 规范 7：交叉引用必须机器可校验

一律相对 Markdown 路径，禁止裸文件名；`verify-md-links` 拒绝死链与失效锚点。

### 规范 8：多语变体由元数据驱动

`X.md`（英文源）+ `X.zh.md`（中文）+ `X.i18n.yaml`（元数据）三件套，配对更新，中文不手改英文源。

---

## 二、我方主树现状盘点

### 2.1 全局分布（md 数量 / 体积）

| 目录 | md 份数 | 体积 | 性质判定 |
|---|---:|---:|---|
| `docs/` | 545 | 9.6 MB | 混合：约 70% 是过程产物 |
| `.claude/` | 518 | 3.3 MB | **纯过程**：task-briefs 514 + claims 132 |
| `memory/` | 379 | 1.2 MB | 决策记录（四态：proposed 192 / implemented 166 / rejected 1 / archived 21）|
| `expert/` | 96 | 0.2 MB | 专家定义，需人工甄别 |
| `gate-exemptions/` | 94 | 0.1 MB | **纯过程**：门禁豁免流水 |
| `skills/` | 46 | 0.2 MB | 保留 |
| `.synova/` `.dsh/` | 27 / 27 | 0.4 MB | 配置，保留 |
| 根目录 | 21 | 0.1 MB | 需瘦身（现 21 个 md）|
| `extensions/` | 44 | — | 代码，保留 |
| `task-state/` | 1 | — | **468 个 json 运行时状态，本不该入库** |

### 2.2 `docs/` 内部（997 文件）

| 子目录 | 文件数 | 说明 |
|---|---:|---|
| `docs/synova/product-lines/` | 326 | 其中 **evidence/ 305 份**为验收证据流水 |
| `docs/synova/research/` | 300 | 一手研究，266 个日期目录 |
| `docs/synova/audit-reports/` | 60 | 审计报告 + `.json` 建议稿 + 日志 |
| `docs/synova/coordination/` | 59 | CTO 派单件、看板、履职总账 |
| `docs/synova/reviews/` | 47 | 评审记录（`.json`）|
| `docs/plans/codex/` | 34 | 实施方案 |
| `docs/authority/` | 27 | **权威源（应保留）** |
| `docs/specs/` | 22 | **规格（应保留）** |
| `docs/archive/` | 12 | 归档 |

### 2.3 三个必须点名的问题

1. **`docs/` 里混进了非文档文件**：176 个 `.txt`、158 个 `.json`、20 个 `.ts`、11 个 `.sh`、另有 `.pptx`/`.docx`/`.py`/`.mjs`/`.cjs` 各若干。
   证据日志、脚本、二进制文件不该住在文档目录。

2. **`task-state/` 468 个 json 是运行时产物入库**：形如 `D1000.json`，是任务执行状态，不是文档也不是代码，应进 `.gitignore`。

3. **根目录 21 个 md，含 7 个 `WORKLOG-*.md` + `loop-run-log.md` + `CHRONICLE.md`(20KB) + `LOOP-ENGINEERING-CHANGELOG.md`(18.8KB)**：全是日志体。
   DSH 根目录只有 7 个 md（README / CONTRIBUTING / BRAND_GUIDELINES / THIRD_PARTY_NOTICES / BENCHMARK / AGENTS × 双语）。

---

## 三、判定法：三问定去留

给 Agent 和新人共用的判定规则（对齐 DSH 规范 2）：

> **Q1. 它描述"现在是什么"，还是"我们做了什么"？** → 后者不进主树
> **Q2. 半年后新人读到它，是有用还是困惑？** → 困惑的不进主树
> **Q3. 它还会被下一个事件追加更新吗？** → 会（日志/台账/流水）的不进主树

三问全"是/前者" → **留**；任一为"后者/困惑/会" → **撤或改**。

---

## 四、处置总表

### A 类 · 留在主树（约 470 份）

| 对象 | 数量 | 处置 |
|---|---:|---|
| `docs/specs/` | 22 | 原位保留（本体层规范 v2.11 等） |
| `docs/authority/` | 27 | 原位保留 → 升级为"权威源"，补负面清单 |
| `skills/` `.synova/` `.dsh/` `expert/` | 116+96 | 保留 |
| `docs/synova/runbooks/` | 8 | 保留 → 并入 `docs/cookbook/` |
| `docs/synova/architecture/` | 4 | 保留 → 并入 `docs/architecture/` |
| `docs/synova/product-lines/` 的 `product-lines.yaml` / `preconditions.yaml` / `核件清单` | ~5 | 保留（现状配置）|
| 根 `README.md` `AGENTS.md` `SPEC.md` `VERSION.md` `CHANGELOG.md` `TECH_DEBT.md` `INDEX.md` | 7 | 保留，`AGENTS.md` 压缩至 ~12KB |
| `memory/notes/` **迁移到** `.agents/notes/` | 382 | 换位置（见 B 类）|

### B 类 · 换格式 / 换位置保留（约 390 份）

| 对象 | 数量 | 新位置 | 理由 |
|---|---:|---|---|
| `memory/notes/` → **`.agents/notes/`** | 382 | 主树隐藏目录（DSH 规范 3）| 新人要懂"为什么这么定"，决策史必须可达；但放 `memory/` 会被当成"记忆垃圾"，放 `.agents/` 语义正确。<br>⚠️ 需同步改 `commit-msg` 门禁（铁律 49 引用路径）|
| `docs/synova/research/` 结论提炼 | 300 → ~30 | 结论进 `docs/research/`，原文进过程仓 | 一手研究过程（266 个日期目录）是流水；结论才是有用知识 |
| `docs/synova/coordination/` 派单件 | 59 | → handbook 仓 `派单件/`（已有惯例）| 主树只留结论指针 |
| `docs/` 内的 `.ts`/`.sh`/`.py` | 34 | → `scripts/`、`tests/` | 代码不住文档目录 |
| `docs/` 内的 `.pptx`/`.docx` | 2 | → 过程仓 `assets/` | 二进制不住主树 |
| `gate-exemptions/` | 94 | **拆分**：当前有效 → `docs/authority/ACTIVE-EXEMPTIONS.md` 索引；已过期 → 过程仓 | 有效豁免必须可见（否则护栏失效），过期的是流水 |
| HTML 全景件（`SYNOVA-ROADMAP.html` 等）| ~5 | → `docs/authority/` 或过程仓 | 视是否现行 |

### C 类 · 撤离主树 → 独立过程仓（约 1,010 份）

| 对象 | 数量 | 说明 |
|---|---:|---|
| `.claude/task-briefs/` | 514 | 任务简报，任务完即死 |
| `.claude/claims/` + 各类 `*-msg.txt` | ~142 | 认领/回填消息 |
| `docs/synova/product-lines/evidence/` | 305 | 验收证据流水 |
| `docs/synova/research/` 原文 | ~270 | 一手研究过程 |
| `docs/synova/audit-reports/` | 60 | 审计报告 + json 建议稿 + 日志 |
| `docs/synova/reviews/` | 47 | 评审 json |
| `docs/plans/codex/` | 34 | 实施方案（已执行完）|
| `gate-exemptions/` 过期部分 | ~80 | 豁免流水 |
| 根 `WORKLOG-*.md` ×7 + `loop-run-log.md` + `CHRONICLE.md` + `LOOP-ENGINEERING-CHANGELOG.md` | 10 | 日志体 |
| `task-state/*.json` | 468 | **不入过程仓，直接 `.gitignore`**（机器产物）|
| 根目录残留脚本（`_patch_d66.cjs` `mvp-server.cjs` `jtbd_overlap.py` `build-synova.js`）| ~6 | 施工残留 |

---

## 五、目标主树（撤离后）

```
SynovaAgent/
├── AGENTS.md              ~12KB（压缩后，对齐 DSH 1950 词预算思路）
├── README.md  SPEC.md  VERSION.md  CHANGELOG.md  TECH_DEBT.md  INDEX.md
├── docs/
│   ├── AGENTS.md          ← 新增：文档规范本体（对标 DSH docs/AGENTS.md）
│   ├── architecture/      ← 并入 synova/architecture
│   ├── authority/         27 份权威源 + ACTIVE-EXEMPTIONS.md
│   ├── specs/             22 份规格
│   ├── cookbook/          ← 并入 runbooks
│   ├── research/          ~30 份结论页（原文在过程仓）
│   ├── postmortem/        ← 新增：0001-xxx 事故复盘（永久编号）
│   └── user/              产品面文档
├── .agents/notes/         382 份决策四态（隐藏命名空间，DSH 做法）
├── src/ extensions/ tests/ scripts/ packages/ expert/ skills/
└── .gitignore  +=  task-state/
```

**撤离后预估：md 从 1,873 → 约 470 份，`docs/` 从 997 → 约 200 文件。**

---

## 六、独立过程仓设计

仓名建议：**`SynovaAgent-Chronicle`**（编年仓）—— 意为"这个项目是怎么过来的"。

```
SynovaAgent-Chronicle/
├── README.md              # 本仓是什么、为什么存在、怎么检索
├── 00-TIMELINE.md         # 时间线总索引（按 YYYY-MM 倒排）
├── decision-notes/        # 决策四态镜像（proposed/implemented/rejected/archived）
├── task-briefs/           # 514
├── evidence/              # 305
├── research/              # 270（一手研究原文，按原目录名保留）
├── audit-reports/         # 60
├── reviews/               # 47
├── plans/                 # 34
├── gate-exemptions/       # ~80（过期豁免）
├── worklogs/              # WORKLOG-* + loop-run-log + CHRONICLE
└── _provenance/
    └── MOVE-MANIFEST.csv  # 原路径 → 新路径 → 撤离日期 → 撤离理由 → 决策编号
```

**三条写入纪律：**

1. **只增不改，永不删除。** 错误的东西照原样留着，包括被否决的决策、失败的方案。
2. **每个撤离文件保留原路径元数据**（写在 `_provenance/MOVE-MANIFEST.csv`），新人能反查"它当初在主树哪个位置"。
3. **主树留一行指针**：被撤走的关键文档，在其原属领域的权威文档中留一行"历史详见 Chronicle `路径`"。DSH 规范 2 说主树不写历史，但允许"链接到拥有者"。

---

## 七、执行分批建议

| 批次 | 内容 | 风险 | 建议 |
|---|---|---|---|
| **第 0 批**（先做，零风险）| `task-state/` 入 `.gitignore`；`docs/` 内 `.ts/.sh/.py/.pptx/.docx` 归位 | 低 | 立即可做 |
| **第 1 批** | 根 `WORKLOG-*` / `CHRONICLE` / `loop-run-log` / 残留脚本 → 过程仓 | 低 | 立即可做 |
| **第 2 批** | `.claude/task-briefs` + `claims` → 过程仓 | 低 | 需确认无门禁引用 |
| **第 3 批** | `memory/notes` → `.agents/notes`（**换位置**）| **中** | ⚠️ 必须先改 `commit-msg` 门禁（铁律 49）与相关脚本引用，否则提交阻断 |
| **第 4 批** | `product-lines/evidence` + `audit-reports` + `reviews` → 过程仓 | 中 | 需先确认无 CI 引用这些路径 |
| **第 5 批** | `research/` 提炼结论 → `docs/research/`（30 页），原文 → 过程仓 | **高** | 需人工/Agent 逐份判断哪些有持久价值 |
| **第 6 批** | `gate-exemptions/` 拆分：有效 → 索引，过期 → 过程仓 | 中 | 需先判定哪些仍有效 |
| **第 7 批** | 新增 `docs/AGENTS.md` 规范 + `docs/postmortem/` + 字数预算门禁 | — | 结构定型后做 |

---

## 八、两个必须先知道的技术前提

### 8.1 删文件不会让仓库变小

Git 的历史里仍保留全部旧版本。**主树会"看起来干净"，但 `.git` 体积不变**，clone 依然慢。

| 方案 | 效果 | 代价 |
|---|---|---|
| **A. 温和（推荐）** | 目录干净、新人看不到噪声 | `.git` 体积不变；DSH 自己就是这么做的（2,220 份 notes 全在库里）|
| **B. 激进 `git filter-repo`** | 仓库真正变小 | 重写全部 commit hash，**所有人必须重新 clone**，已推送的分支/PR 全废。风险高，不建议在有多机协作（Mac / Win / Gitea）的情况下做 |

**建议选 A。** 你要的"不影响主树"是**认知层面**的（新人打开仓库不被淹没），不是磁盘字节层面的 —— A 方案完全满足。

### 8.2 门禁脚本会跟着断

`memory/notes`、`gate-exemptions`、`docs/synova/...` 这些路径很可能被 pre-commit / pre-push / CI 脚本硬编码引用。
**每撤一批前必须先 `grep` 全仓确认零引用**，否则门禁会在下次提交时炸。这正是我方 AGENTS.md 铁律 9（关键变更 grep 全仓库传播）。

---

## 九、给新人的一句话

> 主树里的每一份文档，都在回答"**现在该怎么做事**"。
> 想知道"**我们当初怎么走到这里**"，去 `SynovaAgent-Chronicle`。
> 想知道"**为什么这么定**"，看 `.agents/notes/`。

---

*本件为审计结论件，非执行件。执行需按第七批分批推进，每批前先做引用面 grep。*
