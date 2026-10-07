# Task Brief: D488 full-pipeline Stage 5b 专家数断言修复 v2（动态读 expert-registry.yaml）

> 生成: 2026-08-30 03:42:46 | 分支: main | as any: 0

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
  L3 洞察: l3/ sentinel/ expert-platform/ expert/ (8位文件驱动专家: strategy org finance tech marketing action business_model knowledge)
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
本任务属于扩展解耦（文件驱动）的消费侧验证修复：tests/e2e/full-pipeline.integration.test.ts Stage 5b 断言。D282（2026-07-30）专家清单 9→7 迁移定稿于 expert/expert-registry.yaml v2.0（声明式单一事实源），但该 e2e 测试 L201 标题与 L207 断言仍硬编码 9 → expert/ 实测 7 个真实专家目录（_deprecated/_template 被既有 L206 过滤器排除）→ 断言恒失败（D480 交付报告已上报未修）。本任务不改生产代码，只把测试断言对齐声明式源。架构层归属：基础设施（测试），不触生产五层。v2 重做：旧分支 feat/win-d488-stage5b-fix 是空壳（创始人定），本分支 feat/win-d488-stage5b-fix-v2 基于最新 main f8dadf7b。

### b) 文件审计（2026-08-30 实测 grep，不是凭记忆）
- tests/e2e/full-pipeline.integration.test.ts L201/L207 — 硬编码 9，本任务唯一修改点；L206 过滤器 !e.name.startsWith('_') 实测在。
- expert/expert-registry.yaml — enabled: true 计数 grep -c = 7，D282 定稿，只读。
- expert/ 目录 — 7 真实专家 + _deprecated/_template + registry.yaml，实测 ls。
- git log --follow 该测试文件 = D99/D99-FIX/D317 三提交，无 D282 后更新（dev doc §2 claim 复核成立）。
- vitest.config L33 'tests/e2e/**' 排除（CI 不跑 e2e，本地验收）。
- src/agent/expert-config-loader.ts L39 死分支仍在（/^  [a-z_]+:$/ && !includes(':') 自相矛盾）→ 对 v2.0 嵌套格式恒解析 0 专家（2026-08-28 tsx 探针 expertCount:0 实证，上游 expert-file-loader 静默兜底）→ 本任务不复用不修改，缺陷维持单独上报。
- package.json 无 yaml/js-yaml 库 → dev doc §4.5 决策点 2「不新增重型依赖」成立。
关系: 复用无（解析器坏）、扩展无、新建无、冲突无；唯一写集 = 测试文件。

### c) 决策
已有覆盖→复用：无可复用生产解析（死分支实证）。无覆盖→测试内轻量解析（dev doc §4.5 决策点 2 结论路径）。冲突→取消。
决策点 1/2/3 结论见 Q1c。
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
  ① SPEC / Done 标准 — 定义「怎么算做完」
  ② 测试 — 先写测试，测试 = 产品的一部分（RED 先行：9 断言失败证据先留档）
  ③ 实现 — 刚好满足 Done 全部条件 + 测试全过 + 接线完整 + tsc/vitest 零失败
  ④ 接线 — 端到端走通（无新 export；grep expert-registry 命中即 yaml 读取接线）
  ⑤ 验证 — 自检 5 问（接线/异常/类型/测试/残留）

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge
  - 铁律 47: 声称"已修复"必须 grep 物理证明（DS1/DS2）
  - 铁律 48: 测试必须有真实 expect() 断言
  - 铁律 38: as any 零容忍（新增行 0）
  - memory/2026-08-28-d488-stage5b-delivery.md: 死分支实证 + clone 模型三坑

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "Stage 5b 断言必须动态读 expert-registry.yaml，禁止硬编码 7 或 9"
    verify: "grep -n 'expert-registry' tests/e2e/full-pipeline.integration.test.ts"
  - rule: "yaml 解析用测试内轻量解析（enabled: true 计数 + 专家键集合双比对），不新增依赖不复用死分支的 loadExpertConfig"
    verify: "grep -n 'enabled:' tests/e2e/full-pipeline.integration.test.ts"
  - rule: "expert/ 目录与 expert-registry.yaml 零改动（D282 定稿）"
    verify: "git diff --name-only HEAD -- expert/"

### c) 决策参考系
决策点 1: 硬编码 7 vs 动态读 yaml — 参考：第一性原理 + 结论：yaml 是声明式唯一源，动态读防再漂移（9→7 已踩一次）。
决策点 2: 解析方式 — 参考：Anthropic（机器可验契约/最小依赖）+ DeepSeek（最少机制）+ dev doc §4.5 结论：测试内轻量解析。2026-08-28 首轮曾试复用 loadExpertConfig，实证 parseSimpleYaml 死分支恒解析 0 专家（expected 7 to be +0；2026-08-30 复核 src/agent/expert-config-loader.ts L39 死分支仍在）→ 维持轻量解析；生产缺陷单独上报派单（修复涉及 L3 专家路由运行时行为变更，须独立 dev doc + 行为评审），修复后本测试切回 loadExpertConfig 同源。
决策点 3: toBe(N) 精确断言 + 目录名集合 toEqual 双比对 — 参考：Anthropic（精确断言强于宽松）+ 结论：计数相等但名单漂移也须拦下；yaml 缺失 → readFileSync 抛错 = fail-closed。
收敛检查：两参考系同向，收敛。

### d) 相关 Note 引用
- [x] memory/2026-08-28-d488-stage5b-delivery.md（首轮发现与死分支实证沉淀，本 v2 复用其结论并复核）

## Q2: 范围 — 正确的最简方案是什么？
做什么：
- tests/e2e/full-pipeline.integration.test.ts
不做什么：
- 不修改 expert/expert-registry.yaml
- 不修改 expert/ 目录下任何专家子目录
- 不修改 src/agent/expert-config-loader.ts
- 不修改 src/ 全部生产代码
- 不修改 scripts/ 与 src/sentinel/（DSH 线禁区）
- 不修改 docs/plans/codex/implementation/SYNOVA-IMPL-D488-stage5b-expert-fix-20260828.md

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
npx vitest run tests/e2e/full-pipeline.integration.test.ts（本地运行态；该测试自 mock LLM 无需真实 API，CI 排除 tests/e2e/**）
处理（中间经过哪些步骤）：
Stage 5b 读 expert/expert-registry.yaml 取 enabled: true 专家数 N 与专家键集合 → 扫描 expert/ 真实目录 → expect(目录数).toBe(N) + expect(目录名集合).toEqual(yaml键集合) → 逐专家 manifest.json + PROMPT.md 校验循环保持
结果（最终展示在哪）：
vitest 全绿（Stage 5b pass）；未来专家数变化只改 yaml → 测试自动跟随，不再漂移

## 架构层: 基础设施 — 测试断言修复，不触生产五层
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] DS1 动态断言接线: 测试读取 expert-registry.yaml。verify: grep -n "expert-registry" tests/e2e/full-pipeline.integration.test.ts
- [ ] DS2 断言对齐: 旧硬编码 9 零残留 + 动态断言在场。verify: grep -c "toBeGreaterThanOrEqual(9)" tests/e2e/full-pipeline.integration.test.ts
- [ ] DS3 测试全绿: full-pipeline 10/10 pass。verify: npx vitest run tests/e2e/full-pipeline.integration.test.ts
- [ ] DS4 零回归: customer-flow + diagnosis-session-events 绿 + tsc 30=30 零新增。verify: npx vitest run tests/e2e/customer-flow.e2e.test.ts tests/agent/diagnosis-session-events.test.ts
- [ ] DS5 范围一致: 净变更与写集一致。verify: git diff --name-only origin/main...HEAD
- [ ] DS6 无绕过: 全程不用 --no-verify。verify: grep -c "no-verify" .claude/bypass.log

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D488-stage5b-expert-fix-20260828.md — §1 权威文档 / §2 代码审计（L207 硬编码 9 实测）/ §3.1 写集 1 文件 / §4 测试要求（red→green）/ §4.5 决策参考 / §6 完成标准 DS1-DS7 / §8 交付声明对照表
- expert/expert-registry.yaml v2.0 — D282 9→7 定稿，声明式单一事实源（只读）
- memory/2026-08-28-d488-stage5b-delivery.md — 首轮交付记录 + parseSimpleYaml 死分支实证 + clone 模型三坑

## 接口审计
- src/agent/expert-config-loader.ts: parseSimpleYaml — 复用评估对象，非本任务写集。2026-08-28 tsx 探针实证其对 v2.0 嵌套 yaml 恒解析 0 专家（L39 死分支自相矛盾），故本测试不复用、不修改，采用测试内轻量解析（dev doc §4.5 决策点 2）；修复后可切回生产同源（测试注释已留钩子）。

## Q4: 历史教训 — 上次做类似的事犯过什么错
- memory/2026-08-28-d488-stage5b-delivery.md：首轮同任务——L207 硬编码 9 恒失败（expected 7 to be >= 9，9/10 绿仅 Stage 5b 红）；复用 loadExpertConfig 得 expectedExperts=0（死分支）→ 改轻量解析。本轮已先取 RED 基线证据再动手。
- 增长导航对齐：full-pipeline 是持续增长导航系统的诊断管线 e2e 基座——专家路由这环断言漂移会让"诊断→增长行动"链路的回归失真；本任务保障该基座绿且防再漂移。
