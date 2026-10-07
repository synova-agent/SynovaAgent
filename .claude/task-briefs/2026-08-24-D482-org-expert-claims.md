# Task Brief: D482 org-expert-tools 连接器声称降级：manual 分支删除钉钉/企微自动拉取旧声称，非 manual 分支 dingtalk/wecom 降级为待接入文案，新建专属测试

> 生成: 2026-08-24 01:50:12 | 分支: main | as any: 0

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
本任务在纵向 L2 编排层：src/tools/org-expert-tools.ts 是 builtin-tools.ts 注册的 LLM 专家工具（build_org_graph 等 4 工具），供 agent 工具调用链消费。横向不动任何 Monorepo 包；非文件驱动扩展。该层现有模块：buildOrgGraphTool / scanCollaborationTool / assessDecisionFlowTool / identifyKeyPersonRiskTool（ORG_EXPERT_TOOLS L173-178）。本任务 = 声称对齐修复：handler 内两处文案与连接器物理现实（仅 FeishuConnector 已接入，src/connectors/index.ts L4 注释「钉钉/企微待接入」）不符，降级为真实声称。零新 export、零签名变化。

### b) 文件审计
grep 实测（2026-08-24）：
- `grep -rn "org-expert" tests/` 零命中 → org-expert-tools 无专属测试，需新建（dev doc §2 属实）。
- `grep -rn "授权飞书/钉钉/企微" src/ tests/` 仅 src/tools/org-expert-tools.ts:43 一处；`grep -rn "连接器已就绪" src/ tests/` 仅同文件 L49 一处 → 修这两处即全仓库旧声称清零。
- `grep -rln "org_expert" expert/ sentinel/ extensions/ knowledge/ theory/ skills/` 零命中 → 无文件驱动覆盖，正确路径就是改工具本体文案。
- 接线链实测：ORG_EXPERT_TOOLS(L173) → src/tools/index.ts:3 → src/agent/builtin-tools.ts:9 import → L299 registry.register（生产注册）+ src/agent/tool-profiles.ts:60（profile 字符串引用）。

### c) 决策
已有覆盖 → 复用：文案修复在既有 handler 分支内完成，不新建模块、不改参数契约（dataSource 枚举 feishu/dingtalk/wecom/manual 保持，dev doc §3.3 定案）。无冲突，不取消。



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
① SPEC = dev doc DS1-DS7（完成标准已定义，含 grep 物理证据命令）→ ② 测试先行：新建 tests/tools/org-expert-tools.test.ts，4 断言中用例①③先跑确认 red（铁律 0-2: spec → test → impl → wire → review → merge；铁律 48: 测试必须有真实断言）→ ③ 实现：两分支文案降级，零新 export、零签名变化 → ④ 接线：ORG_EXPERT_TOOLS → builtin-tools.ts L299 registry.register 生产注册链已存在且不变，接线守卫用例④固化（铁律 7: 入口可触达 + 链路走通 + 结果可见——入口=LLM 工具调用链已存在，本任务修的是链路返回声称的真实性）→ ⑤ 验证：自检 6 问 + vitest 新建套件全绿 + tool-registry/expert-tools-d234 零回归 + tsc 28=28。

引用依据：铁律 0-2（测试先行）、铁律 7（Done 标准）、铁律 33（*.test.ts 命名）、铁律 48（真实断言非空壳）。memory 教训：2026-08-23-d479-auth-orgid-delivery（Q2 路径 - 行格式、hook find|head -1 多同日 brief 误报）、2026-08-22-d470-ci-brief-visibility（CI G12 UTC 日期找 brief → 本 brief 用追踪名不用 auto 名）。

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: 旧声称全仓库清零，manual 分支 nextStep 与非 manual 分支 message 不得再出现「授权飞书/钉钉/企微」
  verify: grep -c "授权飞书/钉钉/企微" src/tools/org-expert-tools.ts 归零
- rule: 新声称两分支落地——manual nextStep 含「飞书」，dingtalk/wecom 分支 message 含「钉钉/企微连接器待接入」，status 保持 pending 不新造状态
  verify: grep -c "钉钉/企微连接器待接入" src/tools/org-expert-tools.ts 大于等于 2
- rule: dataSource 参数契约不变（枚举 feishu/dingtalk/wecom/manual 保留，降级提示而非拒绝）
  verify: grep -n "feishu/dingtalk/wecom/manual" src/tools/org-expert-tools.ts 命中参数描述
- rule: 新建测试与 impl 同 commit（铁律 2b 配对）
  verify: git show --stat HEAD 同时含 tests/tools/org-expert-tools.test.ts 与 src/tools/org-expert-tools.ts

### c) 决策参考系
决策点沿用 dev doc §4.5 已定案（K3 可核）：
1. 只降级声称 vs 顺带实现连接器？参考：第一性原理（能力真实存在仅推迟，本任务范围是文档=代码现实；实现连接器是部署后另一任务，混入扩写集）→ 只降级声称。
2. 降级提示 vs 参数校验拒绝？参考：Anthropic（fail-open 交互面——LLM 工具调用可能传 dataSource=dingtalk，拒绝破坏现有调用；降级文案保留 pending 状态，调用方可见待接入）→ 降级文案，不拒绝参数。
收敛检查：两参考系均指向「文案降级 + 契约不变」，收敛。参考：Anthropic/第一性原理 + 结论：只降级声称、不实现连接器、不拒绝参数。

### d) 相关 Note 引用
- memory/2026-08-19-d357-connector-descope.md（D357 连接器 descope：创始人裁决 B 直连推迟部署后——本任务收其附带发现）
- memory/2026-08-23-d479-auth-orgid-delivery.md（brief 门禁细节：Q2 路径 - 行格式、多同日 brief 误报）
- memory/2026-08-22-d470-ci-brief-visibility.md（CI G12 UTC 日期找 brief → 本 brief 用追踪名）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/tools/org-expert-tools.ts: manual 分支 L43 nextStep 降级——旧文案「或授权飞书/钉钉/企微连接器自动拉取」改为「或接入飞书连接器自动拉取，钉钉/企微连接器待接入」，删除旧声称
- src/tools/org-expert-tools.ts: 非 manual 分支按 dataSource 分支——feishu 维持「已就绪」文案；dingtalk/wecom/其他 message 改为「钉钉/企微连接器待接入，当前仅飞书可用，请通过手动模式或 POST /api/ontology/ingest 上传组织数据。」，status 保持 pending 不新造状态
- tests/tools/org-expert-tools.test.ts: 新建专属测试 4 断言——manual 文案不含旧声称且含飞书 / feishu 已就绪 / dingtalk 待接入 / ORG_EXPERT_TOOLS 长度 ≥4 接线守卫

不做什么：
- 不改 src/connectors/index.ts — 连接器本体现状 D357 已定
- 不改 src/routes/im.ts — wecom stub 现状 D357 已定
- 不改 src/agent/builtin-tools.ts — 生产注册链已存在且不变
- 不改 src/agent/tool-profiles.ts — profile 字符串引用与本任务无关
- 不改 src/tools/index.ts — export 链不变
- 不改 tests/tools/expert-tools-d234.test.ts — D234 既有测试不回归即可
- 不改 tests/tools/tool-registry.test.ts — 回归套件只读
- 不改 VERSION.md — 声称降级非门禁或工具行为变化，dev doc §3.1 S-8 定不 bump
- 不实现钉钉或企微连接器 — D357 创始人裁决 B 直连推迟部署后

## Q3: 验收 — 入口 → 交互 → 结果

入口：LLM agent 工具调用 build_org_graph（builtin-tools.ts L299 注册进 ToolRegistry，agent 对话中按参数 schema 传 orgId + dataSource=manual/feishu/dingtalk/wecom）。
处理：handler 按 dataSource 分支——manual 返回 manual_mode + 降级后 nextStep；feishu 返回 pending + 已就绪；dingtalk/wecom 返回 pending + 待接入降级文案。
结果：工具返回值 message/nextStep 直接作为 LLM 上下文呈现给用户，声称与连接器物理现实一致；tests/tools/org-expert-tools.test.ts 4 断言固化行为防回归。

## 架构层: L2
src/tools/org-expert-tools.ts 属 L2 编排层 agent 工具，只改 handler 内部文案，零跨层依赖变化。
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] 入口可触达: build_org_graph 经 builtin-tools.ts L299 registry.register 注册，LLM 工具调用链不变
  verify: grep -n "ORG_EXPERT_TOOLS" src/agent/builtin-tools.ts 命中
- [ ] 链路走通: handler 三分支（manual/feishu/dingtalk-wecom）返回与连接器现实一致的声称
  verify: grep -c "钉钉/企微连接器待接入" src/tools/org-expert-tools.ts 大于等于 2
- [ ] 结果可见: 新建专属测试全绿固化行为
  verify: npx vitest run tests/tools/org-expert-tools.test.ts 全 pass
- [ ] 旧声称清零
  verify: grep -c "授权飞书/钉钉/企微" src/tools/org-expert-tools.ts 等于 0
- [ ] 零回归: npx vitest run tests/tools/tool-registry.test.ts tests/tools/expert-tools-d234.test.ts 全绿 + npx tsc --noEmit 错误数等于基线 28
