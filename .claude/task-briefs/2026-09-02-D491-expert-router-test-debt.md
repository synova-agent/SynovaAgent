# Task Brief: D491 expert-router 测试债修复 selectExpert 映射加测试对齐 7 位专家

> 生成: 2026-09-02 22:05:34 | 分支: feat/win-d491-expert-router | as any: 0

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

### 三层解耦体系

**纵向解耦：五层物理隔离**
代码按 L1-L5 架构分层，每层只与相邻层通信。L1 交互层不知道 L4 用什么数据库，L3 洞察层不知道 L5 数据存在哪。换底层存储，上层零改动。pre-commit 物理阻断跨层 import——L2→L4 的代码提交不进去。

**横向解耦：11 个独立 Monorepo 包**
五层内部拆为独立包：@synova/sog-core（本体图类型）、@synova/sentinel-engine（哨兵调度）、@synova/expert-platform（专家加载）、@synova/connector-registry（数据连接器）。每个包接口边界明确，拆卸一个不影响其余 19 个。核心包已落地运行；已存在的功能规划从 src/ 迁移到独立包；未来新增须遵循此结构。

**扩展解耦：文件驱动，不改代码**
新增能力靠文件，不靠改代码：
- 新 AI 专家 = 新建目录 + 10 个 Markdown 文件 → 自动注册到 ExpertDispatcher
- 新诊断哨兵 = 加 xxx-sentinel.ts → builtins 自动扫描加载
- 新行业 = 加行业目录（基准数据+阈值+案例库）→ 1-2 天上线，零 TypeScript 改动
- 新本体实体类型 = 加 JSON Schema 文件

流程约束: V4.5.0 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查。

数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
        反馈闭环: GA评审/客户反馈 → 记忆层 → 数据层
        Sentinel Finding[] → 诊断引擎 Phase 2 → 8 位文件驱动专家解读

L1 入口: POST /api/diagnosis/consult (GA诊断) / Cron→Sentinel.check() (哨兵) / GET /chat (Web) / MCP
五层架构 (只能向下依赖相邻层):
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/ expert/ (7 位文件驱动专家: host capital-cycle customer-cycle talent-cycle tech finance-structure competitive-strategy)
  L4 本体: l4/ evidence/ 企业事实层: AgentMemoryStore (enterprise_fact, 版本化+superseded_by链)
  L5 存储: store/ cron/
三层粒度: 专家→哨兵→计算。哨兵=可独立告警的最小子领域。compute=纯数学函数。
L0 进化: evolution/ 两路反馈→候选池→确认/执行验证→写入知识库
文件化扩展: expert/ knowledge/shared/ theory/ skills/ — 新增=加文件,不改代码
数据安全: L0公开摘要→L1聚合信号→L2脱敏证据→L3原始数据(仅客户内Agent可见,GA不可见)
引擎: packages/engine-core/ (Novis遗产,逐步迁移)。禁止src/新增engine-core引用(铁律46)。
安全: security/ (PIIScrubber, DataBoundary)
LLM: providers/ (DeepSeek, OpenAI, Gateway)

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = 组织数字孪生诊断 + 持续增长导航系统，本任务修的是 L2 编排层 src/agent/expert-router.ts 的专家路由算法（D8c）与对应单测。该层现有模块: ExpertRouter（MVP 关键词映射路由）+ expert-dispatcher.ts（yaml 驱动，D490 已修）。本任务是替换/修复: selectExpert 仍返回 D282 已删除的 7 个旧专家名（finance/marketing/org/strategy/action/business_model/knowledge），与 expert-registry.yaml v2.0 的 7 位新专家脱节；测试同债。不新增模块，不建新包，不碰文件驱动 expert/ 目录。

### b) 文件审计
grep selectExpert 全仓库: 仅定义处 src/agent/expert-router.ts:165 与单测引用，零生产调用（死代码但须修一致性）。grep ExpertRouter 生产调用方: src/agent/cross-validator.ts:155-156 与 src/agent/task-decomposer.ts:247-248（动态 import 后调 dispatch）。expert/ 目录实测 7 位新专家（host capital-cycle customer-cycle talent-cycle tech finance-structure competitive-strategy）+ _deprecated + _template；expert-registry.yaml v2.0 为 D282 定稿唯一源。同名异类 src/l2/expert-router.ts 是 L2 协调者 ExpertRouter，非本任务对象。关系: 复用现有 ExpertRouter 骨架，只修映射与测试，不新建文件。

### c) 决策
已有覆盖→复用: expert-registry.yaml v2.0 7 位专家名为唯一权威，selectExpert 映射对齐它，不新建硬编码专家清单之外的名字。无覆盖→不需要文件驱动新增（纯改名映射）。冲突→无冲突，dev doc §4.5 已给默认映射表，实现按表执行，若按 tools 语义微调则在 dev doc §3.2 同 commit 回填。映射取舍属单一路径决策，参考系见 Q1c。

## 注入上下文
### DECISION-REFERENCE

> D333 决策参考框架全文（创始人 2026-08-13 定）:

# 决策参考框架（双参考系）

> 2026-08-13 创始人定 | 用途：遇到难决策/多选项/最佳实践选择时，强制走四步参考，并记录所用参考系
> 触发条件：①多选项需取舍 ②设计/架构方案选择 ③优先级排序 ④"最佳实践是什么"类问题 ⑤实现与文档声称冲突时

## 四步框架

```
① 第一性原理（DeepSeek/梁文峰）：这个问题的最简本质是什么？最少机制能解决吗？
② Anthropic 工程基线：隔离/失败即关闭/脚本验证/机器可验契约——哪条适用？
③ 开源实证（DeepSeek）：有可克隆的代码/架构参考吗？clone 下来看实际做法（成本/效率/结构）
④ 收敛检查：两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
```

## 双参考系边界

| 参考系 | 适用 | 不适用 |
|--------|------|--------|
| **Anthropic 工程实践** | agent 隔离、门禁/fail-closed、脚本化验证、机器可验契约、并行协作 | 成本/产品定位/模型选择 |
| **DeepSeek 第一性原理 + 开源实证** | 产品哲学、成本/效率/架构取舍、反内卷、开源参考（clone 仓库） | 工程流程细节（其仓库是模型/推理代码，非 agent 协作） |

## 梁文峰原则摘要（DeepSeek 参考时使用）

- **第一性原理**：不做无意义的炫技，回到问题本质
- **极致成本**：能用最少机制解决就不用多的（这正好支持"worktree 隔离 = 最少机制"而非 N 个门禁）
- **开源开放**：能参考开源实证就不闭门造车
- **反内卷**：机制是为了减少摩擦，不是为了增加流程

## 记录要求（可验证，不靠记忆）

- Codex 决策：在 dev doc / 本会话回复中**明确写"参考：Anthropic/DeepSeek/第一性原理 + 结论"**
- Claude Code 决策：dev doc 要求完成报告含**决策记录**（决策点 + 参考系 + 理由），K3 审计可核

## 已用案例

| 日期 | 决策 | 参考系 | 结论 |
|------|------|--------|------|
| 2026-08-13 | 并行 agent 冲突（串行 vs 并行） | Anthropic（隔离基线）+ DeepSeek（最少机制） | 收敛：worktree 隔离（D307）优先解锁并行 |


## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — dev doc docs/plans/codex/implementation/SYNOVA-IMPL-D491-expert-router-test-debt-20260902.md §6 DS1-DS8 已定义怎么算做完
  ② 测试 — 先改 tests/agent/expert-router.test.ts 用 7 位专家名跑红，测试 = 产品的一部分
  ③ 实现 — selectExpert 映射刚好满足: 现状 4 failed 归零 + dispatch/loadExpertManifest 用新名非 degraded/null + tsc vitest 零失败
  ④ 接线 — 无新 export; 修 selectExpert 返回值 + 测试断言对齐; dispatch 生产调用方 cross-validator 与 task-decomposer 不回归
  ⑤ 验证 — 自检 6 问（接线/异常/类型/测试/残留/文件驱动）+ DS1-DS8 逐条机器可验

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge; 本任务 red→green 严格先行
  - 铁律 9: 关键变更 grep 全仓库传播 — selectExpert 旧名返回值改动须 grep 确认零生产调用方破坏
  - 铁律 24+31: dispatch/loadExpertManifest 已 fail-closed 返回 degraded/null + log.warn，本任务不新增 catch
  - 铁律 33: tests/agent/expert-router.test.ts 命名符合 *.test.ts 单元约定
  - memory/2026-09-01-d490 记录: D490 交付上报本测试债（4 个基线失败指向 D282 已删专家）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "selectExpert 返回值只允许 expert-registry.yaml v2.0 的 7 位专家名, fallback 必须是 host"
    verify: "grep -n \"'finance'\\|'strategy'\\|'org'\\|'marketing'\" src/agent/expert-router.ts 返回 0 命中"
  - rule: "旧专家名分支 action business_model knowledge 必须删除, 语义并入无对应专家时回退 fallback"
    verify: "grep -n \"business_model\\|'action'\\|'knowledge'\" src/agent/expert-router.ts 返回 0 命中"
  - rule: "测试必须真跑红再跑绿, 不得只改断言不改实现, 不得改 dispatcher/expert 目录"
    verify: "npx vitest run tests/agent/expert-router.test.ts 全 pass + git diff --name-only 仅 2 个写集文件"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
决策点: 旧专家名到新专家名的映射表。① 第一性原理 — 最简本质是"sentinel 命名关键词 → 在册专家"，7 位专家的语义域已由 expert-registry.yaml 各专家 tools 定义，映射只需让关键词命中语义相同的在册专家，无对应专家的旧名（action/business_model/knowledge）回退 fallback 即可，不需新建专家。② Anthropic 工程基线 — 机器可验契约: 映射表写进 dev doc §4.5 + 单测断言每个映射，fail-closed 由既有 dispatch degraded 路径承担。③ 开源实证 — 无需克隆外部仓库，仓库内 expert-dispatcher.ts 的 yaml 关键词表（D490 已修）即同域实证，selectExpert 与它的语义分组对齐。④ 收敛检查 — 两参考系都指向"按 dev doc §4.5 默认映射表执行、不微调、不扩面"。
参考：Anthropic/DeepSeek/第一性原理 + 结论: 按 dev doc §4.5 默认映射表逐条执行（finance/cash/margin/cost/revenue/break/dol/npv→finance-structure; capital→capital-cycle; market/customer/churn/brand/channel→customer-cycle; competition/hhi/position/strategy/governance/risk/seven/power→competitive-strategy; talent/hr/people/org/culture→talent-cycle; tech 族→tech; fallback→host; action/business_model/knowledge/learn/skill 分支删除），不按 tools 语义微调，故 dev doc §3.2 无需回填。

### d) 相关 Note 引用
- [x] memory/2026-09-01-d490-expert-config-parser-fix 记录了 D490 交付上报的 4 个基线失败，即本任务修复对象；本任务完成后该测试债闭环，决策沉淀写入本会话交付报告（memory 新条目），不另建 proposed Note。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/expert-router.ts: selectExpert 旧专家名映射改为 7 位新专家名, fallback org 改 host, 删除 action business_model knowledge 三个旧名分支
- tests/agent/expert-router.test.ts: 4 个失败用例与 selectExpert 全部用例改用 7 位专家名, 断言新映射 finance-structure competitive-strategy talent-cycle customer-cycle

不做什么（排除项）：
- 不修改 src/agent/expert-dispatcher.ts — D490 已修, yaml 驱动不重复
- 不修改 src/agent/expert-config-loader.ts — D490 已修
- 不修改 expert/expert-registry.yaml — D282 定稿只读
- 不修改 src/l2/expert-router.ts — 同名异类 L2 协调者非本任务范围
- 不重写 src/agent/expert-router.ts 的 selectExpert 为 yaml 驱动 — 死代码 MVP 修名即可
- 不新增 src/ 下任何新文件与新 export — 纯映射修复

整个 expert/ 目录（registry 除外）全部只读, 含 7 位专家目录与 _deprecated/_template。

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
测试入口 npx vitest run tests/agent/expert-router.test.ts; 生产入口为 GA 诊断链路 task-decomposer.executeSubTask 与 cross-validator 经 ExpertRouter.dispatch 派发子任务。

处理（中间经过哪些步骤）：
selectExpert 按 sentinel/id 关键词映射到 7 位在册专家 → dispatch 加载 expert/<新名>/manifest.json 与 PROMPT.md → buildAnalysis 产出分析。旧名输入不再出现在任何分支。

结果（最终展示在哪）：
vitest 全绿（red 4 failed → green）; 诊断子任务对 finance-structure 等新专家返回非 degraded ExpertResponse; DS1-DS8 逐条命令证据写入交付报告。

本任务在哪一层: L2（src/agent 编排层）

## 架构层: L2
L2 编排层 src/agent/，向下不触 L4/L5，本任务不新增跨层依赖
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [x] 入口可触达: verify: npx vitest run tests/agent/expert-router.test.ts 全 pass
- [x] 链路走通: verify: npx vitest run tests/agent/task-decomposer.test.ts tests/agent/cross-validator.test.ts tests/agent/expert-config-loader.test.ts 全绿零回归
- [x] 结果可见: verify: grep -n "'finance'\|'strategy'\|'org'\|'marketing'\|'business_model'\|'action'\|'knowledge'" src/agent/expert-router.ts 零命中 + git diff --name-only HEAD^ 与写集 2 文件一致
- [x] 零绕过: verify: grep -n "no-verify" .claude/bypass.log 零命中

## 文档引用
- dev doc: docs/plans/codex/implementation/SYNOVA-IMPL-D491-expert-router-test-debt-20260902.md 全部 8 节（§2 代码审计 file:line 实测 / §3.1 写集 / §4.5 映射表 / §6 DS1-DS8）
- 权威源: expert/expert-registry.yaml v2.0（D282 9→7 声明式唯一源）
- 代码事实: src/agent/expert-router.ts、tests/agent/expert-router.test.ts、src/agent/cross-validator.ts、src/agent/task-decomposer.ts

## Q4: 历史教训
- 铁律 38 as any 零容忍: 本任务不引入断言
- 铁律 9 grep 传播: selectExpert 返回值改动已 grep 全仓库确认零生产调用方（仅测试），dispatch 调用方不回归
- memory/2026-09-01-d490 教训: CRLF 根因 autocrlf=true 下 $ 锚定恒假 — 本任务测试断言不用行尾锚定正则
- memory/2026-08-23-d479 教训: hook 多同日 brief 取 ls -t 最新 — 本 brief 写入后即为主 workspace 最新 brief
- memory/2026-08-24-d481 教训: 同 checkout 并行会话污染 — 本任务全程在独立 clone 内提交, 主工作区零代码改动

## 接口审计
src/agent/expert-router.ts: ExpertRouter.selectExpert
src/agent/expert-router.ts: ExpertRouter.dispatch
src/agent/expert-router.ts: ExpertRouter.loadExpertManifest
