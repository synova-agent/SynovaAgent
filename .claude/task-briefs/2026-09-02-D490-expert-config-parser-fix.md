# Task Brief: D490 expert-config-loader parseSimpleYaml 死分支修复

> 生成: 2026-09-01 09:47:43（2026-09-02 跨午夜改名，D358 先例）| 分支: feat/win-d490-yaml-parser-fix | as any: 0

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
本任务 = 纵向（改 L2 代码）。Synova 是驻扎企业的 AI 诊断 Agent（增长导航系统）：诊断是手段，增长才是目的。expert-registry.yaml（D282 v2.0）是声明式专家路由唯一源——加专家=加 yaml 条目+目录，不改代码。本任务在 L2 编排层 src/agent/expert-config-loader.ts：parseSimpleYaml() 负责「yaml 声明 → 专家参与集合」的翻译，是文件驱动扩展点的加载器。该层现有模块：expert-file-loader.ts（专家目录文件扫描）、l3/expert-dispatcher.ts:520-529（消费方）。本任务 = 修复（替换 L39 恒假分支 + regex 扩连字符），不新增模块。文件驱动承诺当前是坏的：yaml 声明 3 诊断+4 后台，实际 7 位全部参与主诊断——修复 = 让文件驱动承诺真实生效。
- [x] 纵向（改 L1-L5 代码/架构）

### b) 文件审计
grep 实证（2026-09-01，基线 7955aff1）：
- src/agent/expert-config-loader.ts:31 parseSimpleYaml（自研简易 parser，全仓唯一，无第二套 yaml 解析）→ 复用修复，不重建
- src/agent/expert-config-loader.ts:39 死分支 `/^  [a-z_]+:$/.test(line) && !line.includes(':')` 实测在案（:$ 锚定使 includes(':') 恒真，取反恒假→分支恒假）
- expert/expert-registry.yaml v2.0 实读：7 键，5 键含连字符（capital-cycle/customer-cycle/talent-cycle/finance-structure/competitive-strategy）→ [a-z_]+ 漏匹配；host/finance-structure/competitive-strategy 为 background:false，其余 4 键 background:true
- 消费方 3 处：src/l3/expert-dispatcher.ts:521/524/525、src/l2/expert-router.ts:54/55、src/orchestrator/subagent-coordinator.ts:90/91
- 测试现状 tests/agent/expert-config-loader.test.ts 仅 2 个类型断言（Array/Set），零解析断言 → 补强
- expert/ 目录与 expert-registry.yaml = D282 定稿只读，与本任务无冲突

### c) 决策
已有 parseSimpleYaml 覆盖 → 复用修复（1 行 regex + 同步补强测试），不引 js-yaml/yaml（node_modules 中仅传递依赖，package.json 无直接依赖，引传递依赖脆弱）。不新建硬编码。决策点已走 DECISION-REFERENCE 四步框架，结论见 Q1c 决策参考系。

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
  ② 测试 — 先写测试，测试 = 产品的一部分
  ③ 实现 — 刚好满足以下全部条件：
     - Done 标准中列出的所有完成项
     - 测试全部通过
     - 接线完整（新 export 有引用）
     - 错误路径有 log + degraded
     - tsc + vitest 零失败
  ④ 接线 — 端到端走通（入口可触达 + 链路完整 + 结果可见）
  ⑤ 验证 — 自检 6 问（接线/异常/类型/测试/残留/文件驱动）

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见
  - 铁律 24+31: 错误处理 + 降级信号
  - 铁律 33: 测试命名约定
  - memory/ 中的历史教训文件

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
根据决策链和本任务特点，提炼 2-3 条必须遵守的规则。每条 rule 必须包含 verify 命令。
  - rule: "parseSimpleYaml 死分支必须消除且 regex 必须匹配连字符键（capital-cycle 等 5 键）"
    verify: "grep -n 死分支模式与 a-z0-9_ 连字符扩展在 src/agent/expert-config-loader.ts 的命中数核对"
  - rule: "测试先行 red→green，RED 必须覆盖「死分支恒 0 专家」失败模式而非 happy-path"
    verify: "vitest run tests/agent/expert-config-loader.test.ts 预期 4/4 pass"
  - rule: "写集不越界（仅 2 文件 + brief 簿记），不碰消费方/registry/DSH 线"
    verify: "git diff --name-only HEAD^ 与 dev doc §3.1 写集逐项比对"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
决策点 1：修现有 parser vs 引 js-yaml？
  ① 第一性原理：1 行 regex 能解决就不引库；② Anthropic 工程基线：最小依赖、机器可验契约；③ 开源实证：js-yaml 在 node_modules 仅为传递依赖，package.json 直接依赖只有 @types/js-yaml（devDep），引传递依赖脆弱。
  参考：Anthropic/DeepSeek 第一性原理 + 结论 = 修 parseSimpleYaml 一行 regex，不引 js-yaml。
决策点 2：是否顺带修 model/tools 解析？
  参考：grep 实证 ExpertConfigEntry.model/tools 在 src/ 零消费方（dev doc §2 S-14）+ 结论 = 接口保留不扩面，未来有消费方再扩。
收敛检查：两决策点两参考系同指最小修复 → 收敛，大概率正确。

### d) 相关 Note 引用
- memory/2026-08-30-d488-v2-workflow-state-desync.md（D488 v2 首报此死分支，本任务为独立修复）；本任务交付后沉淀 proposed note（生产缺陷修复模式：自相矛盾条件恒假 + 消费方静默兜底放大）。

## Q2: 范围 — 正确的最简方案是什么？
做什么（写集 2 文件；S-8：不含 VERSION.md，业务代码修复非门禁变化不 bump）：
- src/agent/expert-config-loader.ts
- tests/agent/expert-config-loader.test.ts
不做什么（含文件路径）：
- 不改 src/l3/expert-dispatcher.ts（过滤逻辑已正确，缺陷在 parser 不在消费方）
- 不改 expert/expert-registry.yaml（D282 定稿只读）
- 不改 expert/ 目录下任何文件
- 不改 src/l2/expert-router.ts
- 不改 src/orchestrator/subagent-coordinator.ts
- 不改 src/agent/index.ts（re-export 面不变）
- 不改 src/agent/expert-file-loader.ts（上游文件扫描兜底不在本任务）
- 不引 node_modules/js-yaml、node_modules/yaml（传递依赖，脆弱）
- 不碰 scripts/ 与 src/sentinel/（DSH 审计线，铁律 0-5）

## Q3: 验收 — 入口 → 交互 → 结果
入口（用户从哪触发）：诊断请求进入 src/l3/expert-dispatcher.ts runAllExperts()（POST /api/diagnosis/consult → L2 ConversationEngine → L3 dispatcher）；dispatcher L524-525 调 getBackgroundExperts()/getEnabledDiagnosticExperts() 从 expert-config-loader 取配置。
处理（中间步骤）：loadExpertConfig() → parseSimpleYaml() 解析 expert/expert-registry.yaml → 7 专家键全解析（含 5 个连字符键）→ enabled/background 字段正确落入 config.experts → dispatcher 据此过滤。
结果（最终展示在哪）：主诊断只跑 host/finance-structure/competitive-strategy 3 位诊断专家；capital-cycle/customer-cycle/talent-cycle/tech 按 yaml 声明转入后台引擎角色，不再进主诊断并行执行；tests/agent/expert-config-loader.test.ts 4/4 断言此行为。行为变化如实声明：修复前回退分支使 7 专家全部参与主诊断；修复后 3 诊断+4 后台分离 = yaml v2.0（D282 定稿）声明的正确行为。

## 架构层: L2 — expert-config-loader 属 src/agent/（L2 编排），消费方 src/l3/（L3 洞察）
#CRITERIA: A（criteria-code-map.json：A=核心诊断逻辑，描述含「专家路由」，本任务是专家路由配置加载器）
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] 入口可触达: loadExpertConfig() 对真实 expert-registry.yaml 返回 7 专家（现状 0）。verify: vitest run tests/agent/expert-config-loader.test.ts → 4/4 pass
- [ ] 链路走通: L39 死分支消除 + regex 匹配连字符键。verify: grep -n "!line.includes" src/agent/expert-config-loader.ts = 0 命中 且 grep -n "a-z0-9_-" src/agent/expert-config-loader.ts 命中
- [ ] 结果可见: getEnabledDiagnosticExperts() 返回 host/finance-structure/competitive-strategy 3 位；getBackgroundExperts() 含 capital-cycle/customer-cycle/talent-cycle/tech 4 位。verify: 测试用例 ①② 断言
- [ ] 零回归: expert-router/expert-registry 测试绿 + tsc --noEmit 零新增。verify: vitest run tests/agent/expert-router.test.ts tests/expert-registry.test.ts
- [ ] 类型安全: as any 零存在。verify: grep -rn "as any" src/agent/expert-config-loader.ts = 0 命中

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D490-expert-config-parser-fix-20260901.md §2 缺陷 A/B、§3.1 写集、§4 测试要求、§6 DS1-DS8
- expert/expert-registry.yaml v2.0（D282 声明式唯一源）
- docs/synova/coordination/DECISION-REFERENCE.md（Q1c 已按四步框架记录）
- CLAUDE.md 铁律 0-2（测试先行）/24+31（降级显式）/38（as any=0）/47+48（契约+测试非空壳）

## 接口审计
- src/agent/expert-config-loader.ts: loadExpertConfig(configPath?: string): ExpertRegistryConfig（export，L68）
- src/agent/expert-config-loader.ts: parseSimpleYaml(content: string): ExpertRegistryConfig（私有，L31，本任务修复点）
- src/agent/expert-config-loader.ts: getEnabledDiagnosticExperts(config?): string[]（export，L96）
- src/agent/expert-config-loader.ts: getBackgroundExperts(config?): Set<string>（export，L108）
- src/agent/expert-config-loader.ts: clearExpertConfigCache(): void（export，L91，测试用例 ④ 缓存语义用）
