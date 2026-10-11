<!-- 🔴 本件是**镜像**（新会话/双端可读用）
     权威源（唯一）：院方 `~/山河研究院/04-技术研究/专题研究/extensions内容面/extensions内容面规范-v0.md`
     为什么镜像：**新开会话没有 CTO 的上下文**，且 Win 侧只能读远程仓库 ⇒ 不镜像就断了
     冲突时：**以院方原件为准**；本镜像不得单独修改
     被谁引用：产品宪章 §5.6/§5.7 ｜ K12/K4 多张卡面 ｜ AGENTS.md「内容面与扩展点」节 -->

# extensions/ 内容面规范 v0.1 · 定位与形态（内容面 vs 引擎面）

> **2026-10-09 ｜ 山河研究院技术研究线 ｜ 受派：CTO《研究院派单-extensions内容面定位补充研究》（v2）**
> **as_of：`origin/main = 8ae14590d`**（本地 `git fetch` 被沙箱拒绝写 `.git/FETCH_HEAD`，本地 `origin/main` 已指该锚，成立；若远端此后有新提交需重新锚定）
> **架构基准**：#1448（OPEN）＋ 本地件 `decisions/implemented/architecture/2026-10-09-权威架构总图.md`（已读全文）
> **v0.1 = v0 经创始人指令复核后的修正版**：修正 **4 处实质错误 ＋ 1 处过期数字**（§一一列举）；**DSH 机制由转述改为源码亲证**（§3.4）
> **边界遵守**：产品仓零改动；未碰 `scripts/audit/**`、`.github/**`；宪章只出修订建议

---

## 〇、派单事实复核结果（v2 全部成立）

| 派单断言 | 复跑结果 | 判定 |
|---|---|---|
| 20 项 / 695 文件，逐项数 | 20 项 / 695，逐项全同（sentinels 319…tools 1） | ✅ |
| 45/45 manifest 含 17 字段 | `45/45` | ✅ |
| dependsOn 仅 4/45 | `4/45` | ✅ |
| extensions/ 全域 0 个 package.json | `0` | ✅ |
| 索引 entryPoint 反指 `../src/sentinel/sentinel-loader.ts` | 原文确认（且 v0.1 深挖出**语义破损**，见 §5.2） | ✅＋新发现 |
| 钻入 175（sentinels 口径）/ 194（全域）/ 154（剔 _extinct） | 175 / 194 / 154 | ✅（口径辨析见 §3.1） |
| check-architecture.sh 零 extension 命中 | `0` | ✅ |
| check-file-driven.sh §d/§e 存在且 hard_check | `:99-115 / :118-150` 确认 | ✅ |
| 宪章提 extensions 仅 2 处且均为现状举证 | `grep -c = 2`（`:304/:305`，行号与派单一致） | ✅ |

---

## 一、v0 → v0.1 修正记录（复核产物，**全部由本轮二遍复核核出**）

| # | v0 写的 | 复核实测 | 修正 |
|---|---|---|---|
| **E-1** | 「169 条 import，141 type / 28 值；值含 6+1 sentinel-loader」 | **语句级解析（含多行）＝141 条**：**113 type ＋ 28 值**；值 import 真实构成＝**27× assert-finite-inputs ＋ 1× l3/key-person-risk**——sentinel-loader 的 6+1 条**实为 type-only**，v0 的行级 grep 把多行 type 误计为值 | §3.1 已重写 |
| **E-2** | 「locales 自包含（loader 随内容走），形态可作范本」 | 🔴 **`extensions/locales/locale-loader.ts` 在 origin/main 根本不存在**——真实加载器是 `src/locale/locale-loader.ts`（`file-driven-loaders.ts:24` 接线，读 `extensions/locales/{lang}/`）；manifest 的 `./locale-loader.ts` 是**双口径皆悬空的死指针**。v0 把 manifest 自述当事实，未验文件存在 | Q2 行已改判 |
| **E-3** | 「business-models 加载方＝business-model-loader ✓」 | **该 loader 全仓零调用**（除自身定义）；business-models 的唯一读者就是这个死 loader ⇒ **生产不可达** | Q2 行已改判 |
| **E-4** | 「llm-providers 加载方＝llm-provider-loader ✓」 | **该 loader 全仓零调用**；生产 provider 走 `src/providers/` 硬编码类 ⇒ **第四处「两套并行系统」**（死：文件驱动 provider 系｜活：硬编码类） | Q2 行已改判 |
| **E-5** | C2 判据引「src→extensions 94 条 type import（10-03 审计）」 | **本锚下剩 27 条**（全部在 `src/sentinel/types.ts`）——上游已部分修复，v0 引了过期数字 | §3.3 已更正 |

**复核方法升级**：v0 用行级 grep；v0.1 用**语句级 python 解析**（剥注释＋多行 import＋inline type 辨析）＋**全仓文件集存在性核查**（5526 个受控文件）＋**双口径路径解析**。

---

## 二、Q1 · 内容面与引擎面的边界（第一性原理）

### 2.1 CTO 推论的裁定：**成立，且需补第三面**

CTO 推论：「引擎（怎么跑）用层组织，内容（跑什么）用包组织，两者是两维不是层套层」——**成立**。推导：

```
北极星「加文件即可，不改代码」（CLAUDE.md，宪章 2.5 文件驱动）
 ⇒ 必然存在一个"只靠加文件就能改变系统行为"的变更集合 C
 ⇒ 消费 C 的解释器必须先于 C 存在、且在 C 增长时保持稳定 —— 记为 E（引擎）
 ⇒ 边界判据 = 【变更回避的方向】：
    · 内容 =「随客户/行业/领域变化，而引擎不变」的东西
    · 引擎 =「内容变化时，必须不变」的东西
 ⇒ 耦合性质确实两维：
    · 引擎耦合是纵向调用图（谁能调谁）→ 用层（B 套 L1–L5）组织，可被方向门禁执法
    · 内容耦合是声明式的（我需要什么能力）→ 用包组织，可被清单校验执法
```

**但二分不够，必须补第三面：配置。** 实测 20 项里有 4–5 项不是业务语义——它们回答的不是"跑什么业务"，而是**"引擎以什么参数跑"**。三分判据：

| 面 | 回答 | 变化维度 | 例子（实测） |
|---|---|---|---|
| **内容** | 跑什么（业务语义） | 客户 / 行业 / 专业 | sentinels、ontology、frameworks、skills、playbooks、industries、rules、reports、policies、context-strategies、implementation-patterns |
| **引擎** | 怎么跑（解释与管道） | 架构演进 | adapters 与 notifications 的 .ts、src/** 与 packages/** |
| **配置** | 以什么参数跑 | 部署 / 环境 / 运营 | llm-providers、locales、security、engine、evolution(阈值) |

### 2.2 更重要的发现：**`extensions/` ≉ 内容面**

内容面的物理载体**不止 extensions/ 一个根**（实测）：

| 根 | 内容 | 证据 |
|---|---|---|
| `extensions/` | 20 项（本件研究对象） | — |
| `cycles/*.cycle.json` | 循环层①的内容 | 架构总图自记「cycles/*.cycle.json（配置）+ src/cycles/」 |
| `expert/` | 专家域内容（5 专业域+host） | 我方 10-03 审计 D5：加专家要改 ≥4 处宿主映射 |
| `knowledge/`、`skills/`（根目录） | 知识/技能方法论 | 我方 10-03 审计：46 个 .md **恒不加载** |
| `customer-config/` | L2 客户层 | 10-03 审计：「完全为空」 |

**同时 extensions/ 内部也不纯**：含引擎码（adapters/notifications 的 .ts）、配置（llm-providers/locales/security/engine）、**4 项生产不可达**（见 §3.5）。

**⇒ 结论（Q1 的最终边界定义）**：
> **内容面是一个逻辑维度（正交于 A 套架构块与 B 套五层），不是某个目录。** `extensions/` 是内容面**最大但既不充分也不必要**的载体。
> **规范表述**：`X 属于内容面 ⇔ 删掉 X 引擎照常启动 ∧ 引擎升级不需要改 X ∧ X 承载业务语义`。

### 2.3 对架构总图 §三 CTO 建议 (a)/(b)/(c) 的裁定

**支持 (a)「内容贴层」，否决 (b)「新加一维」**：(b) 会让三套编号变四套；(a) 的准确表述＝**"extensions/** 是各架构块内容载体的默认根"，架构门禁扩到 extensions/****；(c) 维持盲区，否决。

---

## 三、Q2＋Q3 · 逐项裁定与耦合契约

### 3.1 钻入的准确画像（v0.1 语句级重测，E-1 修正后）

**口径先辨析**（三个数不是一回事）：
- 派单的 **175/194** ＝ `git grep -o` **出现次数**，**含 `_extinct`**（剔后全域 154）
- 本节口径 ＝ **在役 233 个 .ts 的 import 语句数**（剥注释、多行归一、inline-type 辨析）

```
在役 .ts 233 个 ｜ import 语句总数 → ../src/** 共 141 条：
  import type（编译期契约，运行时擦除）    113 条（80.1%）
    ├─ 57 × src/l4/graph-traversal（图查询 API 类型）
    ├─ 45 × src/sentinel/types（哨兵类型）
    ├─  5 × src/sentinel/sentinel-loader（类型）
    ├─  4 × src/notifications/types ← 来自 notifications 项
    └─  2 × src/connectors/types   ← 来自 adapters 项
  值 import（运行时真依赖）                  28 条（19.9%）
    ├─ 27 × src/sentinel/assert-finite-inputs（checkFiniteInputs/
    │      checkRequiredFields，#1408 输入守卫）
    └─  1 × src/l3/key-person-risk（checkKeyPersonRisk）

非 sentinels 项的钻入：仅 6 条 type（adapters 2＋notifications 4）
llm-providers 的 10 个 stub 与 ontology 的 registry.ts：对 src 零 import
```

**同批实测（对契约设计有利）**：extensions 的 .ts 里已有 **49 条 `@synova/*` 包 import**（如 `@synova/logger`）——**包导入通道已在用**，契约化不是新发明。

**⇒ 判定**：所谓"175 次钻入"的实质是 **③ 个契约点**：一个图查询类型面（57）、一个哨兵类型面（45+5）、一个守卫函数（27+1）。治理完全可行。

### 3.2 Q2 · 20 项逐项裁定表（E-2/E-3/E-4 修正后）

| # | 项 | 构成（实测） | 生产通道（实测） | **裁定** | 处置 |
|---|---|---|---|---|---|
| 1 | sentinels | 58 json + 261 ts（compute 纯函数，DB 句柄 0） | `file-driven-loaders.ts:71` | **内容（混合）**→③ | 保留；按 §3.3 契约治理 |
| 2 | ontology | 97 json + 1 ts | `:95` | **内容（声明式）**→② | 保留 |
| 3 | frameworks | 87 json | `:46` | **内容** | 保留 |
| 4 | skills | 42 json + 41 md | bootstrap Phase 2b | **内容** | 保留 |
| 5 | playbooks | 21 yaml + manifest | `src/playbook/playbook-loader`＋bootstrap | **内容** | 保留 |
| 6 | llm-providers | 11 json + 10 ts stub | 🔴 **loader 零调用**；生产走 `src/providers` 硬编码类 | **配置 ＋ 第四处两套并行**（死文件驱动系 vs 活硬编码） | **二选一**：接线或删除（见 §七-2） |
| 7 | industries | 12 json | 直读者×3：`packages/evolution`×2、`src/growth/context-loader` | **内容**＝C 套 L1 载体 | 保留 |
| 8 | rules | 11 json | `:84` | **内容** | 保留 |
| 9 | notifications | 5 json + 4 ts adapter | `:58-59`＋`sentinel/runner.ts:37` | **拆**：json=配置；ts=引擎管道码 | adapter.ts 搬 `src/notifications/` |
| 10 | business-models | 7 json | 🔴 **唯一读者是其自身死 loader** | **内容（生产不可达）** | 接线或删（见 §七-2） |
| 11 | locales | 7 json（**无 loader.ts**） | `:24 → src/locale/locale-loader`（读 `{lang}/`） | **配置**（v0"自包含范本"**撤回**，E-2） | 保留 json；manifest 死指针修（§5.2） |
| 12 | adapters | 3 json + 2 ts | `:107` | **引擎**（⓪连接器适配码，import `src/connectors/types`） | adapter.ts 搬 `src/connectors/`；json 留 |
| 13 | evolution | 3 json | `packages/evolution` | **内容（参数类）**——参数层④前身 | 保留 |
| 14 | reports | 3 | `:35` | **内容（模板）** | 保留 |
| 15 | engine | 2（engine-config） | 🔴 零读者（构造路径口径复查仍 0） | **配置（孤儿）** | 接线或删 |
| 16 | policies | 2 | escalation-rules←`escalation-engine`；data-access.yaml 🔴 零读者 | **内容（半孤儿）** | data-access 接线或删 |
| 17 | context-strategies | 1 json | `src/orchestrator/context-engine` | **内容** | 保留；**补 manifest**（§5.4） |
| 18 | implementation-patterns | 1 json | `src/services/pattern-matcher` | **内容** | 保留；补 manifest |
| 19 | security | 1 json | `pre-upload-validator.ts:128`（cwd 拼接） | **配置** | 保留；路径契约化 |
| 20 | tools | 1（tools-manifest） | 🔴 零读者 | **孤儿** | 删或实现 |

**汇总（修正后）**：内容 12 ＋ 参数类内容 1 ｜ 配置 4 ｜ 引擎 1 ｜ 拆分 1 ｜ **生产不可达 4**（llm-providers、business-models、engine、tools）＋ 半孤儿 1（policies 之半）。**16/20 生产可达。**

### 3.3 耦合接口契约（Q3 答案，v0.1 修正 E-5）

```
┌─ ① 类型契约（编译期）：内容读引擎的数据形状
│    现状 113 条 import type 钻 src（graph-traversal 57 / sentinel-types 45 / loader 5 …）
│    目标：抽共享契约包（建议 packages/contracts/ ＝ @synova/contracts）
│         内容改 import type from '@synova/contracts/graph'
│    【DSH 亲证同型】：DSH 插件全部走包名 type import——
│         import type { Session } from '@deepseek-ai/dsh-session'（零相对钻入）
│    反向同治：src→extensions 的 type 网（本锚 27 条，全在 src/sentinel/types.ts；
│    10-03 时为 94 条，上游正在修）同样改走 contracts ⇒ 双向解耦
│
├─ ② 能力契约（运行时）：内容调引擎的工具函数
│    现状 28 条值 import ＝ 27× assert-finite-inputs 守卫 ＋ 1× key-person-risk
│    目标（学 DSH inject，见 §3.4）：值依赖改两种形态之一——
│      (a) 守卫函数入 @synova/contracts 包（纯函数，零状态，最适合）
│      (b) 或声明为能力（manifest.requires capability），宿主注入
│    白名单执法：extensions/** 的值 import 只允许 @synova/* ＋ contracts ＋
│      显式 ALLOWLIST 文件（初始为空——28 条全部迁移后归零）
│
└─ ③ 声明契约（加载期）：manifest 即契约本体
     哨兵 17 字段（45/45）为准；version/dependsOn 见 §四
```

### 3.4 DSH 做法的源码亲证（创始人指令项，v0 为转述、v0.1 为亲证）

**证据源**：`/Users/wane/src/deepseek-harness-020`（git 树 `dsh-v0.2.0-rc.2` @ `639ed0153972`，本院《DSH 断面登记表》定的唯一借鉴基准）。

**① inject 机制（运行时能力注入）——全域范式，8+ 插件同型**：
```ts
// packages/compaction/compaction-basic/src/index.ts:114
static inject = ['llm', 'tokenMeter', 'sessions'];
// 其余同型抽样（grep 'static inject' 全仓）：
//   settings:224          ['configEditor', 'profileContext']
//   schedule:101          ['agents','sessions','tools','storageDomain','sessionController','sessionPersistence']
//   token-meter:106       ['sessionProjections']
//   file-reference-local:45 ['agents']
//   session-reference:86  ['sessionQuery']
```
**机制读法**：插件**按名声明**所需宿主服务（字符串数组）；`@deepseek-ai/cordis` 框架解析并**注入实现**——插件**不 import 宿主源码**，运行时依赖是"声明→注入"方向，与我们的 28 条值 import（"内容主动 import 引擎"）**方向相反**。这正是宪章 5.3「反向声明依赖」的原文出处。

**② 类型走包名（编译期）**：DSH 插件的类型全部 `import type { X } from '@deepseek-ai/dsh-session'` 式**包导入**；全仓插件**零相对路径钻入引擎源码**（对照我们 113 条）。

**③ 技能声明极简**：官方技能 frontmatter 实测＝`name` ＋ `description`（＋可选 `disable-model-invocation` 等调用控制，由 `SkillInvocationPolicy` 承载）——对照我们哨兵 manifest 17 字段。**"字段少而准"不是口号，是它的实证形态**。

**④ 对本契约的采纳方式（严谨声明）**：
- **采纳**：类型走包名（§3.3-①）；值依赖最小化＋白名单（§3.3-②）；声明字段少而准（§四）；
- **不照搬 inject 全套**：Cordis 的 inject 服务于**在线插件生命周期**（激活/退役/代际）；我们的内容是**静态文件、boot 时装配**（§5.1 裁定），只需其"按名声明、宿主满足"的**方向**，不需要其代际机制。**判据形态因此比 DSH 简单**——这是有意收敛，不是遗漏。

### 3.5 可机器校验判据（新门禁）＋ 与既有门禁分工

**建议名**：`check-content-coupling.sh`（或并入 check-architecture.sh 新组，补其 extensions 零覆盖——实测 `grep -c extensions = 0`）：

| 判据 | 内容 | 违规样例（现存量） |
|---|---|---|
| **CC1 方向** | extensions/**/*.ts 的 import 目标 ∈ {包名, contracts 包, ALLOWLIST}；**值 import 尤严** | 现 113 type + 28 值全部违规（迁移完成后归零） |
| **CC2 对称** | src/** 不得 `import type` FROM extensions/** | 现 27 条（src/sentinel/types.ts） |
| **CC3 可达** | 顶层 manifest.type 必须有注册 loader；entryPoint 若存在必须双口径可解析 | 现违规：engine、tools（无 loader）；locales（死指针）；llm-providers、business-models（loader 死） |
| **CC4 结构** | 顶层目录必须有 manifest.json | 现违规：context-strategies、implementation-patterns、policies、security（§d 门禁只查 staged 新增，存量漏网） |

**与既有门禁分工（正交不重复）**：§d 管**结构（新目录须有 manifest）**｜§e 管**可载性（pizza-chain）**｜pre-commit 组 2 管**质量（测试配对）**｜**本门禁管耦合方向与可达性**。

---

## 四、Q4 · 版本与依赖模型

（v0 原文经复核无修正，要点重录）

- `requires` 三类依赖（ontology / content / capability），**字段少而准**（宪章 5.3-①；DSH 技能 frontmatter 的极简形态是同源实证）；
- `version` 参与：加载时兼容检查（不满足 ⇒ **degraded：留清单、拒新绑定、不阻断启动**——DSH preset 文档亲证语义，与铁律 31 一致）＋ 升级拓扑序；**不参与**自动迁移；
- 与宪章 5.2 对接：manifest 加 `layer` 字段；运行时按 `custom > profession > industry > builtin`；「≥2 客户 ⇒ 提升」是治理动作不进门禁；
- 阶段化：Phase 1 只强制 `ontology` 读声明（它同时喂参数层标定与 C1），Phase 2 开 content-content。

---

## 五、Q5 · 发现与装配机制（v0.1 大幅强化）

### 5.1 装配现状（生产接线全图，实测 `src/init/file-driven-loaders.ts`）

**已接线 9 路**：locale(:24→src/locale)、report-template(:35)、framework(:46)、notifications(:58-59)、sentinels(:71)、rules(:84)、ontology(:95)、adapters(:107)、field-mappings(:118-119)；另有 skills（bootstrap Phase 2b）、playbooks（playbook-loader+bootstrap）、industries（直读者×3：packages/evolution×2、growth/context-loader）、evolution（packages/evolution）、context-strategies/implementation-patterns/security/policies-escalation（各自 service 直读）。

**⇒ 16/20 生产可达；4 项不可达**（llm-providers、business-models＝loader 零调用；engine、tools＝路径零读者）。

### 5.2 🔴 entryPoint 字段的语义破损（本轮复核最深的一口）

**双口径存在性审计**（全仓 5,526 受控文件为判据）：

| 口径 | 解析规则 | 结果 |
|---|---|---|
| **文件相对**（manifest 路径约定的唯一标准解） | `extensions/sentinels/../src/…` → `extensions/src/…` | **10 个反指全部解析失败**（`extensions/src/` 不存在） |
| **extensions 根相对**（作者心智中的解） | `extensions/../src/…` → `src/…` | 10 个全部存在 |
| locales `./locale-loader.ts` | 两种解 | **双口径皆悬空**（该文件从未在库） |

**且顶层 entryPoint 零运行时消费者**（全 src/packages grep：只有**逐项级** entryPoint 被消费——`notification-loader.ts:43`、`skill-installer`、`extension-registry`，后两者本身未接线）。

**⇒ 判定**：顶层 entryPoint 是**语义破损的"文档即配置"**——反指方向错（内容声明引擎）＋解析基准错（差一级）＋一处纯悬空＋无人消费。**修法（不变）**：建引擎侧 `src/deploy/content-registry.ts`（唯一 type→loader 表）；顶层 manifest 删除该字段或改名 `loader` 降为纯文档。

### 5.3 设计裁定：**宿主扫目录（否决内容自注册）**

- 北极星"加文件即可"与 host-scan 匹配；自注册需可写注册表＝运行时状态＝DSH 代际机制的由来（其 preset 文档亲证：编辑释放 Loader 会撤销运行中 Agent 工具 ⇒ 注册表拥有代际）——**我们无在线编辑内容需求，不继承该复杂度**；
- 采纳 DSH 三机制：**早激活**（boot 全量解析，选择前暴露失败）、**失败隔离**（degraded 留清单拒新绑定）、**标识持久化**（会话记录内容项版本，供⑥进化读）。

### 5.4 增删步骤（目标态）与结构补漏

加＝建目录＋manifest＋内容＋过 C1/C4（＋compute 配测试）；删＝删目录＋C2 保无 type 残留＋requires 显式失败。**0 宿主改动**（哨兵路径 10-03 已实证 3 文件 0 宿主）。
**补漏**：4 个存量目录无顶层 manifest（C4 违规），§d 门禁只查 staged 新增——需一次性补齐。

---

## 六、Q6 · 建档：预设 vs 内容包（创始人特别要求）

（v0 原文经复核无修正，要点重录；DSH 侧依据已从文档升格为源码级亲证）

- **学 DSH 三机制（注册表管装配/早激活/失败隔离），不学其声明载体**——DSH 弃目录 preset 因其有 Cordis profile 补丁体系（其 preset 决策文档亲证：「普通 profile 配置已提供所需持久化和分层，因此 preset 不再有独立路径」）；**我们没有等价物**，统一内容形态恰是"目录＋manifest"（16/20 有 manifest，§d 门禁按此执法）；
- 落点：`extensions/presets/roles/{role-id}/` 五件套（manifest＋knowledge-scope＋context-manifest＋output-template.ref＋acceptance-criteria）；
- **建档内容包＝过程输入（L0/L1 方法：问什么/什么算齐/行业差异）**，落 `extensions/onboarding/`；**建档配置包＝过程输出（L2 实例）**（宪章 2.7.3/:387）——前者喂后者，方向不可倒；
- 两层分工成立（预设答"用哪些能力"＝引用；内容答"能力说什么"＝本体）；合一则跨岗位复用死。已考虑并否决的替代：预设当引擎配置（随客户变化的是内容）、进 DB（违反文件驱动）。

---

## 七、无法裁定清单（判不了 ＋ 原因；v0.1 更新）

| # | 项 | 原因 | 需要什么 |
|---|---|---|---|
| 1 | `engine/diagnosis.json`、`tools/manifest.json` 的历史意图 | 需 git 考古＋在途分支排查（fetch 被沙箱拒） | 一次全分支排查 |
| 2 | llm-providers / business-models 的死活取舍（接线 vs 删除） | **事实已清（生产不可达）**，但取舍是产品判断 | CTO/创始人裁 |
| 3 | notifications 4 个 adapter 与 skill-installer 的**运行时**动态装配 | 静态已证接线（:58-59）；运行时行为需真跑 | 一次真跑 |
| 4 | 宪章是否采纳"内容贴层＋附录补内容载体列" | 裁定权在创始人 | 创始人裁定 |
| 5 | 根 `skills/`（46 md 恒不加载）最终归属 | 两案都成立 | 产品线裁 |

（v0 的"llm-providers stub 动态加载"一项**已销**——其 loader 本身零调用，问题升格为 §七-2 的死活取舍。）

---

## 八、与宪章第四条/第五条的对齐声明 ＋ 修订建议

对齐状态与 v0 相同（5.2/5.3/4.5 一致且互证；2.5 存张力属现状非冲突）。修订建议更新为 6 条：
1. 第四条架构图每块补「内容载体」列（采纳建议 (a)）；
2. 4.5 轴一引用本规范作落点定义（三分判据）；
3. 5.3-② 引用口径改 **type/值 分列（113/28，语句级）**，并注明派单 175/194 是含 _extinct 的出现次数；
4. 附录写入：三套编号表 ＋ 内容面物理根清单（6 根）；
5. 新施工项：0-13 check-content-coupling（CC1–CC4）｜1-9 content-registry ＋ entryPoint 字段处置｜1-10 reload 重扫 extensions/｜1-11 四项不可达处置＋data-access｜1-12 adapters/notifications 引擎码归位｜**1-13 locales 死指针修复**；
6. （新增）**登记第四处两套并行**：llm-providers 死文件驱动系 vs 活 src/providers 硬编码——建议并入宪章 4.7 现状栏"两套并行系统"清单（前三处：循环矩阵、skills 双目录、专家注册）。

---

## 九、复跑命令清单（v0.1 新增部分；v0 原有命令仍有效）

```bash
cd /Users/wane/SynovaAgent && M=origin/main
# E-1 修正：语句级 import 解析（剥注释/多行/inline-type）
#   见本件 §3.1（python 语句级解析：141 = 113 type + 28 值；
#   值 = 27×assert-finite-inputs + 1×key-person-risk）
git grep -h -E "from '(\.\./)+src/" $M -- 'extensions/sentinels/**/*.ts' | wc -l   # 169 行（含多行尾行与 _extinct？否——此口径 169，出现次数 175）
# E-5 修正：反向网本锚计数
git grep -h -E "import type .* from '(\.\./)+extensions/" $M -- 'src/**/*.ts' | wc -l   # 27
# E-2/E-3/E-4 修正：loader 死活
git grep -rn "business-model-loader|loadBusinessModels" $M -- src packages | grep -v '\.test\.' | wc -l   # 0（除自身）
git grep -rn "llm-provider-loader|loadLLMProviders"    $M -- src packages | grep -v '\.test\.' | wc -l   # 0（除自身）
git ls-tree -r --name-only $M extensions/locales        # 无 locale-loader.ts
# 5.2 双口径 entryPoint 审计（全仓 5526 文件集）
git ls-tree -r --name-only $M | wc -l                   # 5526
# DSH 亲证
R=/Users/wane/src/deepseek-harness-020
grep -rn "static inject" $R/packages --include="*.ts" | grep -v test | head -8
sed -n '114p' $R/packages/compaction/compaction-basic/src/index.ts
head -6 $R/packages/skill/skill-office/assets/office-docx/SKILL.md
# 生产接线全图
git show $M:src/init/file-driven-loaders.ts | grep -n "await import" | head -14
```

## 修订记录

- **v0.1 2026-10-09**：创始人指令复核版。修正 4 实错＋1 过期数（E-1～E-5，§一）；DSH 机制由转述升格为源码亲证（§3.4：inject 按名声明/类型走包名/frontmatter 极简）；新发现：entryPoint 双口径语义破损＋零消费者（§5.2）、4 项生产不可达（§3.2/5.1）、第四处两套并行（llm-providers）；门禁增至 CC1–CC4。
- v0 2026-10-09：首版。
