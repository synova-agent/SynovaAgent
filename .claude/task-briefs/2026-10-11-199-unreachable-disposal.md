> **卡面来源**：库外档案仓同名片（CTO 亲撰）｜架构基准：产品宪章 v8.1｜纪律：缺字段问 CTO，不许猜
> **本件**＝#199 / K12-16 的实施 brief（登记件 `1-11`）。交付指针与判据原始输出见 PR 正文。

# Task Brief: #199 → K12-16（登记件 `1-11`）— 四项生产不可达处置 ＋ policies/data-access

## 〇、为什么做这个（通俗版 · 先读这一节）

**① 一句话**：把「**注册了、但根本没人读**」的内容**要么接线、要么删掉** —— 不留第三态。

**② 病根**：这不是"浪费文件"。真正的危害是**假信号**：有人以为改了文件就生效，而实际零读者、**且不报错**。
  院方《extensions内容面规范》点名的"最坏体验：他以为自己配好了"，本卡要杀的正是这个。

**③ 判据二元化的由来**：规范 §3.2 逐项裁定表给 5 项处置面，§七-2 明写取舍是**产品判断**（需 CTO/创始人裁）。
  本卡按「**接线 or 删除**」二元收口 ⇒ 本批结束时**不允许存在**「登记着但不可达」的项。

**④ 完成后**：内容面可达性成为**可验证事实**（llm-providers / engine / tools / data-access 四笔不可达清零），
  并顺手**消解两处"两套并行"**（llm-providers 死文件驱动系 vs 活 `src/providers`；data-access 自称替代 L0 但零读者）。

**⑤ DSH 借鉴**：**参考自研**。可借 = 宪章 约束 2「加了吗/接上了吗/生效了吗」＋`@deepseek-ai/dsh-invariants/lib/index.js:6-13`
  的"宿主保证**不生效就报错**"；⚠️ **取舍本身不可从 DSH 推**（规范 §七-2）。

## Q0: 定位 清掉「注册了但没人读」的内容（院方称作**第四处两套并行**的同一族病）。
### a) 项目拼图
本卡在【−1 运行时（装配）】＋【⓪ 连接器（provider 面）】：改的是**内容面 ↔ 装配面**的耦合，不碰引擎逻辑。
### b) 文件审计（**本件实跑，锚 ba1b22a8b**）
```
· llm-providers：21 文件 = 10 个 adapter.ts（**整文件一行注释**，`grep -c "^export"` ×10 全 0 ⇒ 不可被宿主 import）
                 ＋ 11 manifest.json ⇒ 侧 A「零资产空壳」；侧 B `src/providers/**` 是活的（4 真实现，本卡一字未动）
· business-models：经 content-registry 装配（loader `src/l3/business-model-loader.ts`）⇒ **已接线**（见 Q3 V4 证据）
· engine：2 文件，零读者（唯一命中是本表注释）⇒ 无 loader 可接
· tools：1 文件（仅 manifest.json，零内容）⇒ 无内容可接
· policies/data-access.yaml：零读者；其自称替代目标 `packages/engine-core/**` 已清零（实测 0 文件）
```
### c) 决策（逐项二元，**每项都已落执行**）
| # | 项 | 判定 | 依据 |
|---|---|---|---|
| 1 | `extensions/business-models/**` | **已接线** | 经 content-registry 装配；`loadBusinessModels` 模块边界计数 = 1（独立观测） |
| 2 | `extensions/engine/**` | **已删除** | 规范 §3.2 #15 零读者；建消费端属架构变更 ⇒ 走 §5.4 删路径 |
| 3 | `extensions/tools/**` | **已删除** | 规范 §3.2 #20 孤儿（零内容）；规范原文即「删或实现」 |
| 4 | `extensions/llm-providers/**` | **已删除**（退役空壳） | CTO 2026-10-09 案B 二选一之「退役空壳」；侧 A 无资产可搬 |
| 5 | `extensions/policies/data-access.yaml` | **已删除** | 零读者 ＋ 替代目标已死 ＋ 与 L0 词汇表**实质不相交**（接线=设计变更，见 Q1） |

## Q1: 调研
- **规范 §5.4（删路径的法定步骤）**：`删＝删目录＋C2 保无 type 残留＋requires 显式失败`。本卡实测三条：
  `src/**` 对 4 个目标目录的 import **= 0**（C2 满足）；4 份 manifest **均无 `requires` 键**（第 3 条空转）⇒ **0 宿主改动**。
- **规范 §七-1 前置（engine/tools 的历史意图）**：要求"一次全分支排查"。本件实跑：
  ① 在途 PR 排查（Gitea API，open=3：PR#442/#416/#224）⇒ **无一件**触碰 4 个目标目录或本卡 4 个扩张文件；
  ② 全历史考古 `git log --all -- extensions/engine` = 2 提交、`-- extensions/tools` = 1 提交，
     均为"建目录 ＋ 装 manifest"的**文件驱动迁移半成品**（`docs/plans/codex/FILE-DRIVEN-EXEC-TASKS.md` D1/E 组），
     且该计划自述「组 E 低优先级…目前先建目录结构 ＋ manifest」⇒ **无在途实现在建消费端**。
- **🔴 data-access 为什么不选「接线」**（三条硬证，CO/I 复核过）：
  (a) 其自称替代对象 `packages/engine-core/src/pipeline/diagnosis/expert-data-policy.ts` **物理不存在**
      （`git ls-tree -r HEAD packages/engine-core/ | wc -l` = **0**，已按铁律 46 清零）；
  (b) 两套 `allowedDimensions` 词汇表**实质不相交**：yaml 8 词（风险域分类）∩ L0 40 词（哨兵证据 dtype）
      = **仅 `risk` 1 条**；
  (c) 真件判据 `src/l3/expert-dispatcher.ts:202-204` 是**精确成员**判据（`includes`，非通配）⇒
      **逐字接线 ⇒ 7/7 专家主维度证据被滤空 ⇒ 命中 :243-249 ⇒ 每位专家 degraded「无可用证据」**
      = **整条诊断链静默降级**（比原病更大）。⇒ 「接线」实为"统一两套词汇表"＝**设计变更**，不属本卡。
- **memory 教训**：铁律 37（Dead code 入仓库即违规）⇒ 删除须**连带**清注册表条目与 manifest 描述（已做）。

## Q2: 范围
做什么

- .claude/task-briefs/2026-10-11-199-unreachable-disposal.md
- extensions/engine/diagnosis.json
- extensions/engine/manifest.json
- extensions/llm-providers/deepseek/adapter.ts
- extensions/llm-providers/deepseek/manifest.json
- extensions/llm-providers/ernie/adapter.ts
- extensions/llm-providers/ernie/manifest.json
- extensions/llm-providers/gateway/adapter.ts
- extensions/llm-providers/gateway/manifest.json
- extensions/llm-providers/glm/adapter.ts
- extensions/llm-providers/glm/manifest.json
- extensions/llm-providers/kimi/adapter.ts
- extensions/llm-providers/kimi/manifest.json
- extensions/llm-providers/manifest.json
- extensions/llm-providers/minimax/adapter.ts
- extensions/llm-providers/minimax/manifest.json
- extensions/llm-providers/openai/adapter.ts
- extensions/llm-providers/openai/manifest.json
- extensions/llm-providers/qwen/adapter.ts
- extensions/llm-providers/qwen/manifest.json
- extensions/llm-providers/step/adapter.ts
- extensions/llm-providers/step/manifest.json
- extensions/llm-providers/yi/adapter.ts
- extensions/llm-providers/yi/manifest.json
- extensions/policies/data-access.yaml
- extensions/policies/manifest.json
- extensions/tools/manifest.json
- src/deploy/content-registry.ts
- tests/deploy/content-registry.test.ts
不做什么
- 不改 src/orchestrator/subagent-coordinator.ts
- 不改 src/providers/llm-provider-loader.ts
- 不改 scripts/check-content-coupling.sh
- 不改 scripts/control-tower/probe-content-registry.ts
- 不改 extensions/adapters/feishu/adapter.ts
- 不改 extensions/locales/manifest.json

## Q3: 验收
入口：`src/server.ts` → `src/deploy/bootstrap.ts:972-973` → `src/init/file-driven-loaders.ts:30 initFileDrivenLoaders()` → `initContentTypes()`
处理：`src/deploy/content-registry.ts` 的 `CONTENT_TYPES` 逐项声明 ⇒ loader / readers 解析
结果：注册表项集 ↔ `extensions/` 顶层目录集**双向相等**（主动枚举磁盘的机械约束）⇒ 不可达项清零

- V1 逐项二元判定表（5 项，无第三态）：见 §Q0 c)
- V2/V4 接线项（business-models）**穿生产入口**证据：见 §接线证据
- V3 删除项 `git ls-tree` 零残留 ＋ 无引用：见 §删除证据
- V5 反例（没人读的 `manifest.type` ⇒ CC3 必红）：见 §反例证据
- V6 统一 CC 口径 `SYNO_CI=1 bash scripts/check-content-coupling.sh`：见 §CC 门禁

## 接线证据（V2/V4 · business-models「已接线」）
判据是**独立观测**（模块边界计数），**不以被检模块自报为据**：
```
$ npx tsx scripts/control-tower/probe-content-registry.ts
  [ok]   business-model   模块边界计数 = [loadBusinessModels:1]
  [ok]   business-model 接活生效：模块边界计数 = 1（独立观测，非自报）
  [ok]   business-model 副作用产出真实：models=6（产出真实性，非调用证据）
```
file:line 链路（**生产**，非测试/非注释）：
- `src/deploy/bootstrap.ts:972-973` `await initFileDrivenLoaders()`
- `src/init/file-driven-loaders.ts:58` `await initContentTypes()`
- `src/deploy/content-registry.ts` 表项 `type: business-model` → `loader.module: ../l3/business-model-loader` / `init: loadBusinessModels`
- `src/l3/business-model-loader.ts:17` `export function loadBusinessModels()`（真执行，计数 = 1）

⚠️ **能力边界（如实标注，不夸大）**：加载结果 `models` 由 `initContentTypes()` 取走后**只用于 `errors[]` 降级判断**，
  本卡未发现其它生产消费者 ⇒ 本项「已接线」的准确含义是「**装配期被真实执行且产出真实**」，
  而非「产出被下游业务消费」。后者属另一问题（business-model 与哨兵/专家的消费面），**不在本卡写集**。

## 删除证据（V3 · 4 项）
```
$ git ls-files -- extensions/engine extensions/tools extensions/llm-providers extensions/policies/data-access.yaml
  （零输出 = 工作树/index 零残留）
$ git ls-tree -r HEAD -- <被删路径>   # HEAD 侧残留数即为"待提交删除数"（随提交归零）
```
无引用核验（**零 import 语句**，命中全是注释）：
```
$ git grep -n "extensions/llm-providers" -- src/    # 2 命中，全为注释（content-registry:277 / llm-provider-loader:3 JSDoc）
$ git grep -n "engine-config" -- src/ packages/ scripts/   # 仅本表旧注释
$ git grep -n "tools-manifest" -- src/ packages/ scripts/  # 仅本表旧注释
$ git grep -n "data-access" -- src/                # 仅本表旧注释
```
manifest `requires` 条件（规范 §5.4 第 3 条）：4 份目标 manifest **均无 `requires` 键** ⇒ 空转。

## 反例证据（V5 · 改坏必红）
```
$ mkdir -p extensions/_probe199_orphan
$ cat > extensions/_probe199_orphan/manifest.json <<'EOF'
{"type":"no-such-type-anyone-reads","name":"_probe199_orphan","version":"1.0.0"}
EOF
$ SYNO_CI=1 bash scripts/check-content-coupling.sh
  CC3 可达: 顶层 manifest 23 个 —— 违规 1
  ── 新增违规（基线外）──
    CC3 NEW extensions/_probe199_orphan — type='no-such-type-anyone-reads' 在 content-registry 未登记（boot 不装配）
  CONTENT-COUPLING: VIOLATION new=2      rc=1        ← **红**（改坏即红成立）
（还原后 sha256 与基线逐字相同，见 §CC 门禁）
```
🔴 **型 C 自查**：反例**首跑即红**（不是"永远绿"的假反例）—— 如实报，未掩盖。

## CC 门禁（V6 · 本批统一口径）
```
$ SYNO_CI=1 bash scripts/check-content-coupling.sh
  ① new=1 ✓
  ② ── 新增违规（基线外）── 段**有且只有一行**：
       CC2 NEW src/deploy/content-registry.ts:129 '../extensions/layer-resolver' (值)   ✓
  ③ 该段无其它坐标行 ✓          rc=1
```
🔴 该 `new=1` **是锚上既有**（`ba1b22a8b` 上就红）—— 归因两条既有缺陷（门禁 `:394` 子串误判 ＋ `BASELINE_TEXT` 陈旧），
  均属门禁语义（治理线/CTO 域）⇒ **本卡不改**，按 lead 统一口径验收。

## 既有红（**非本卡回归**，登记备查）
```
$ npx tsx scripts/control-tower/probe-content-registry.ts
  SUMMARY: sections=4 failures=1
  FAILURES:
    - 注册表应为 20 项，实测 25          ← 锚上即红（脚本硬编码 20，注册表真值 25）
```
本卡删 3 项后该探针变为「应为 20，实测 **22**」—— **仍红**，且**不是本卡造成的回归**，
是 `scripts/control-tower/probe-content-registry.ts:103` 硬编码 20 自身陈旧（与 CC 门禁基线陈旧**同族**）。
该路径属 `scripts/control-tower/**` ＝**非本卡写集**（治理线）⇒ 本卡不动，已由 lead 并入上报 CTO。

## 架构层: −1 运行时（装配）＋ ⓪ 连接器（provider 面）
#CRITERIA: D

## 写集
| 文件 | 类别 |
|---|---|
| `extensions/engine/diagnosis.json` | task（删除：二元化之「已删除」） |
| `extensions/engine/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/deepseek/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/deepseek/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/ernie/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/ernie/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/gateway/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/gateway/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/glm/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/glm/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/kimi/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/kimi/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/minimax/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/minimax/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/openai/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/openai/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/qwen/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/qwen/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/step/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/step/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/yi/adapter.ts` | task（删除：二元化之「已删除」） |
| `extensions/llm-providers/yi/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/policies/data-access.yaml` | task（删除：二元化之「已删除」） |
| `extensions/tools/manifest.json` | task（删除：二元化之「已删除」） |
| `extensions/policies/manifest.json` | task（🔴 写集扩张；登记见「写集扩张登记」） |
| `src/deploy/content-registry.ts` | task（🔴 写集扩张；登记见「写集扩张登记」） |
| `tests/deploy/content-registry.test.ts` | task（🔴 写集扩张；登记见「写集扩张登记」） |
| `.claude/task-briefs/2026-10-11-199-unreachable-disposal.md` | task（本件） |

## 写集扩张登记（**4 文件，非卡面原始写集**）
🔴 按纪律三件齐登记（**扩张清单 / 理由 / 代价 Y**）。四项均为**删除分支的物理必要条件**，不是图方便。

**扩张清单（4）**
```
① src/deploy/content-registry.ts          （本表是 extensions 顶层目录唯一真源；删目录必删条目）
② tests/deploy/content-registry.test.ts   （:42 dir 集双向相等 / :45 total 25→22 / :114 notWired 5→2）
③ extensions/policies/manifest.json       （:7 description ＋ :14 knownGaps 逐字提到 data-access.yaml ⇒ 删后成假陈述）
④ （无第 4 项：目录删除未牵动其它文件 —— 实测 `src/**` 对 4 个目标目录 import = 0）
```
**理由**：`tests/deploy/content-registry.test.ts:32` 的 `extensionDirsOnDisk()` **主动枚举磁盘**，
  且 `:42` 断言"注册表 dir 集 ↔ 磁盘目录集**双向相等**"⇒ "删目录不改注册表"**机械上不可能通过**（不是"忘了改"）；
  注册表 `:557` 另有 `CONTENT_TYPES.length !== 22` 硬校验，与测试断言**同源同义**，两处必须同改。
**代价 Y**：PR 件数 +4（29 件变更）；`src/deploy/content-registry.ts` 与其它 K12 卡存在**理论交叉面** ⇒
  实测 3 个在途 PR（#442/#416/#224）变更集**零重叠**；若后续有卡也改本表 ⇒ **必须串行**。

## 代价 Y 存档（删除 `data-access.yaml` 丢失的内容，**逐字**，不许静默丢）
被删文件全文（`git show ba1b22a8b:extensions/policies/data-access.yaml`）：
```yaml
# V4.2.1 数据访问策略 (替代 DEFAULT_POLICIES)
strategy: {allowedDimensions: [strategic, financial, marketing], sensitiveAccess: read, prohibitedFields: [salary, personal_email]}
org: {allowedDimensions: [organizational, technical], sensitiveAccess: read, prohibitedFields: [personal_email]}
finance: {allowedDimensions: [financial, operational], sensitiveAccess: read, prohibitedFields: [person_name]}
tech: {allowedDimensions: [technical, operational], sensitiveAccess: read}
marketing: {allowedDimensions: [marketing, financial], sensitiveAccess: read, prohibitedFields: [salary]}
action: {allowedDimensions: [strategic, organizational, financial, technical, marketing], sensitiveAccess: read}
business_model: {allowedDimensions: [strategic, organizational, financial, marketing, operational], sensitiveAccess: read}
knowledge: {allowedDimensions: [strategic, organizational, financial, technical, marketing, operational, risk, compliance], sensitiveAccess: read}
```
**L0（`src/orchestrator/subagent-coordinator.ts:48-55`）没有的两项**（⇒ 删除的信息损失，需另立卡决定是否并入 L0）：
```
① 每专家的 `sensitiveAccess: read`（8 条）
② `knowledge` 专家条目（施工单 FILE-DRIVEN-EXEC-TASKS.md:168 记「L0 缺 knowledge」，此行本是补该缺口）
```
**本卡不迁**（避免把"清不可达"变成"改数据边界策略"）；同文已登记进 `extensions/policies/manifest.json` 的 `knownGaps`。

## Done 标准
- [ ] verify: SYNO_CI=1 bash scripts/check-content-coupling.sh
- [ ] verify: npx vitest run tests/deploy/content-registry.test.ts
- [ ] verify: npx tsc --noEmit
- [ ] V1 五项判定表（二元，无"不可达"）已出原始输出
- [ ] V5 反例"改坏即红"已出原始输出 ＋ 还原后 sha256 逐字相同
- [ ] 扩张清单（4 文件）＋ 代价 Y 已落 PR 正文与 brief

