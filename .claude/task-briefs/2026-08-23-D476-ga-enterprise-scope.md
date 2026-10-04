# Task Brief: D476 GA 上游 enterpriseId 断点 + overflow 隔离收紧（D338 审计移交 O7/O8）

> 生成: 2026-08-23 02:13:20 | 分支: feat/win-d476-ga-enterprise-scope | as any: 0
> 来源 dev doc: docs/plans/codex/implementation/SYNOVA-IMPL-D476-ga-enterprise-scope-20260823.md

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。组织数字孪生诊断 + 持续增长导航系统。
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
本任务属于三层解耦的哪一层？
- [x] 纵向（改 L1-L5 代码/架构）
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于 GA 诊断系统。收 D338 多租户隔离审计的移交项 O7（overflow 路由无认证）+ O8（GA 反馈上游 enterpriseId 'default' 硬编码断点），优先级 P1。触及三层：
- **L1 交互**：src/routes/overflow.ts —— 三端点零认证 + 字面 'default' 回退，对齐 ga-corrections.ts 的 fail-closed 模式（该模块已由 D338 交付，只读消费其形态）
- **L2 编排**：src/agent/interactive-card.ts —— L173 构建 GA 反馈 action 时硬编码 enterpriseId 'default'
- **L3 洞察**：src/l3/ga-collaboration.ts —— recordCorrection 签名无 orgId 参数 + L211 再次写死 'default'

本任务为缺陷修复（鉴权 + 上下文透传），不改动专家/哨兵结构。GA 反馈链是「卡片交互 → GAFeedbackHandler → collectFeedback → AgentMemoryStore」写入链。

### b) 文件审计
grep 本任务关键词在 expert/ sentinel/ extensions/ knowledge/ theory/ skills/ 中。列出已有文件驱动模块。关系: 复用 / 扩展 / 新建 / 冲突
- `enterpriseId` / `orgId` 在 expert/ extensions/ knowledge/ skills/ 中零命中——GA 反馈组织上下文无文件驱动模块覆盖，本任务为代码缺陷修复，不新建硬编码，无冲突。
- overflow 路由消费 src/cycles/ 四个模块（cycle-registry / overflow-dashboard / investment-advisor / overflow-graph-bridge）——本任务只改 routes 层鉴权，不触碰 cycles/ 业务逻辑。
- 复用：src/middleware/auth.ts 的 extractAuthFromRequest（ga-corrections.ts L14-21 已用同款，本任务沿用该模式）。
- 写集与 D477（data-ingest-service.ts + tags.json）、DSH 线（sentinel/、scripts/）文件级零交集，worktree 隔离并行。

### c) 决策
已有覆盖→复用，不准新建硬编码。无覆盖→新建走文件驱动（属扩展解耦）。冲突→取消任务，复用已有。
复用 ga-corrections 的 fail-closed 鉴权模式（401 UNAUTHORIZED / 400 ORG_REQUIRED / 403 FORBIDDEN），不新建认证体系（dev doc §3.3「不做 GA 认证体系重设计」）。本任务不涉及文件驱动扩展，无新建硬编码类型。
冲突取舍/多选项/架构选择 → 走 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md），结论写入 Q1c 决策参考系。



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
  ① SPEC / Done 标准 — dev doc DS1-DS8 + 本 brief Done 标准
  ② 测试 — 先写 red（D(b/d/e) + E 全部用例）→ 记录失败证据 → 实现 → green
  ③ 实现 — 修改 A/B/C（interactive-card / ga-collaboration / overflow），满足 Done 标准 + 测试全绿 + 接线完整 + 错误路径有 log + degraded
  ④ 接线 — recordCorrection 第 4 参被 handleCorrect 透传；overflow 三端点 requireAuth 守卫；interactive-card action.enterpriseId 源头
  ⑤ 验证 — 自检 6 问 + 铁律复核 + dev doc DS1-DS8 全跑

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见
  - 铁律 24+31: 错误处理 + 降级信号（401/400/403 守卫对齐 ga-corrections 形态，非新增 catch）
  - 铁律 33: 测试命名约定 *.test.ts
  - 铁律 38: as any 零容忍（mock 注入用 as unknown as）
  - 铁律 47: 契约优先（recordCorrection JSDoc 更新）
  - memory/2026-08-22-d338-org-isolation-session.md: 主树并行 session 污染 → worktree 隔离；Q2 排除项路径紧跟动词
  - memory/2026-08-22-d475-loop-handlers-delivery.md: registry 簿记 + 他人补记行备份恢复
  - memory/2026-08-16-d363-llm-failover-delivery.md: gh/GCM 凭据双失效 PR 无法自动建
  - memory/2026-08-22-d470-ci-brief-visibility.md: CI G12 用 runner UTC 日期找今日 brief、*-auto 被 gitignore → 追踪名 brief
  - memory/2026-08-06-D316-dev-doc-verification.md: dev doc 声明须独立核验（本任务已 3 Explore + 1 对抗性审查全部 file:line 实测）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "overflow.ts 不得出现 || 'default' 字面回退（租户=认证身份，零回落）"
    verify: "grep -n \"|| 'default'\" src/routes/overflow.ts"（零命中）
  - rule: "recordCorrection 新增第 4 参 enterpriseId 必须被 handleCorrect 调用处透传 action.enterpriseId"
    verify: "grep -n 'recordCorrection' src/l3/ga-collaboration.ts"（调用处含 enterpriseId）
  - rule: "interactive-card.ts 不得出现 enterpriseId: 'default' 字面硬编码"
    verify: "grep -n \"enterpriseId: 'default'\" src/agent/interactive-card.ts"（零命中）

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档声称冲突时）
按 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md）执行，并将结论记录在本字段：
  ① 第一性原理 — 问题的最简本质是什么？最少机制能解决吗？
  ② Anthropic 工程基线 — 隔离/失败即关闭/脚本验证/机器可验契约，哪条适用？
  ③ 开源实证 — 有可克隆的代码/架构参考吗？clone 下来看实际做法
  ④ 收敛检查 — 两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖

决策记录：
1. **overflow 租户权威**：dev doc §3.1 写「enterpriseId 优先 body/query，其次 auth.orgId」——强制 auth 后 body/query 优先 = org-a 认证用户可跨租户读/写 org-b 命名空间。参考：第一性原理（租户身份=认证身份，单实例内 orgId 逐表覆盖）+ Anthropic fail-closed（D338 审计报告 L5「绝不回落全局命名空间」）+ 开源实证（仓内 ga-corrections.ts L14-21 只用 auth.orgId）。收敛结论：auth.orgId 权威，显式 enterpriseId 不一致 → 403 FORBIDDEN；config.orgId 第三跳删除（强制 auth 下不可达死代码 + 潜在 fail-open）。
2. **不加 role 检查**：O7 只要求「overflow 纳入认证体系」，且前端 dashboard.js 用户为 workspace 角色非 ga/admin——加 role 会 403 打爆现有前端。参考：DeepSeek 最小侵入 + 第一性原理（本任务收 O7 而非重做 RBAC）。结论：只做 401/400/403（跨租户），无 role 门槛。
3. **`||` vs `??`**：dev doc 写 `enterpriseId ?? config.orgId`。空串 '' 也是非法租户标识，`||` 连空串一起兜底，fail-closed 更彻底。参考：Anthropic fail-closed。结论：用 `||`，§3.2 回填说明。
4. **模块级 config 缓存**：loadConfig 每次调用有文件 I/O + 日志，orgId 是启动期常量。参考：Anthropic 工程基线（避免 per-request 开销）。结论：模块级 `const config = loadConfig()` + 注释说明（仓内 per-call 惯例的例外，§3.2 记录）。
5. **interactive-card 兜底链**：action.enterpriseId（源头）→ config.orgId（实例默认）。GA 链不做 auth 重设计（dev doc §3.3 明示）。参考：第一性原理（上下文从源头带起）+ 收敛。结论：`action.enterpriseId || config.orgId`。

### d) 相关 Note 引用
- [x] 本任务决策沉淀至 dev doc §3.2 回填（S-6）+ Q1c 本字段 + 交付报告。无需新建 memory/notes（决策已入 tracked 文档，K3 可核）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/agent/interactive-card.ts L173 字面 'default' → action.enterpriseId || config.orgId（模块级 config 缓存 + 注释）
- src/l3/ga-collaboration.ts recordCorrection 加第 4 参 enterpriseId 可选 + L211 兜底 config.orgId + handleCorrect L106 透传 + JSDoc 契约更新
- src/routes/overflow.ts 三端点 requireAuth 守卫（401 UNAUTHORIZED / 400 ORG_REQUIRED / 跨租户 403 FORBIDDEN）+ 删除 || 'default' 回退 + 业务函数一律 auth.orgId
- tests/l3/ga-collaboration.test.ts 修改，新增 4 用例（b 环境变量缺省 red / d 透传 red / a 直传 green / e 端到端卡片 red）
- tests/routes/overflow.test.ts 新建，6 用例（401 / 400 / 同租户绿 / 跨租户 403×2 / 快照 auth.orgId red）
- docs/plans/codex/implementation/SYNOVA-IMPL-D476-ga-enterprise-scope-20260823.md §3.2/§4/§5/§7 按实回填（S-6，同 commit）

不做什么：
- 不改 src/routes/ga-annotations.ts 和 src/routes/ga-corrections.ts（D338 已交付 fail-closed，只读消费其形态）
- 不改 src/sentinel/、scripts/（DSH 地盘）
- 不改 src/agent/data-ingest-service.ts、extensions/ontology/tags.json（D477 写集，worktree 隔离）
- 不 bump VERSION.md（S-8 隔离强化，非门禁/工具行为变化）
- 不改 src/server.ts（overflowRoutes 未挂载 404 与 graphStore 生产注入缺口为 D90 遗留独立缺陷，§3.2 记录并建议另立任务）
- 不碰 客户A客户数据

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- GA 用户在交互卡片点击反馈按钮 → InteractiveCardHandler.handleAction 构建 GAFeedbackAction
- HTTP 请求 POST /api/overflow/simulate、GET /api/overflow/snapshots/:cycleId、GET /api/overflow/dashboard/:enterpriseId（带 Bearer token）

处理（中间经过哪些步骤）：
- 卡片构建 action 时 enterpriseId 取调用方上下文或 config.orgId 兜底，不再写死 'default'
- GAFeedbackHandler.processFeedback → handleCorrect → recordCorrection 第 4 参透传 → collectFeedback 写入实例 org 命名空间
- overflow 三端点先 requireAuth 校验（401 无认证 / 400 缺 orgId / 403 跨租户），业务函数一律使用 auth.orgId，零回落

结果（最终展示在哪）：
- GA 反馈写入正确 org 的 AgentMemoryStore（ga_correction 记忆带正确 orgId）
- overflow 各端点返回企业作用域数据，或 401/400/403 拒绝；测试断言可见（collectFeedback 捕获 orgId、模拟投资第 1 参 orgId）

## 架构层: L1（routes/overflow）+ L2（agent/interactive-card）+ L3（l3/ga-collaboration）
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [x] 入口可触达: interactive-card.ts 零 enterpriseId: 'default' 字面；overflow 三端点 requireAuth 首行守卫。verify: grep -n "enterpriseId: 'default'" src/agent/interactive-card.ts 零命中 + grep -n "requireAuth" src/routes/overflow.ts 命中
- [x] 链路走通: recordCorrection 第 4 参被 handleCorrect 调用处透传 action.enterpriseId。verify: grep -n "recordCorrection" src/l3/ga-collaboration.ts 调用处含 action.enterpriseId
- [x] 结果可见: RED 先行证据 + 目标测试全绿 + 回归套件绿 + tsc 28=28。verify: npx vitest run tests/l3/ga-collaboration.test.ts tests/routes/overflow.test.ts 全绿
