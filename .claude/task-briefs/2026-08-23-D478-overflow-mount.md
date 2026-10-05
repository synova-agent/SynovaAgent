# Task Brief: D478 overflow 路由挂载 + graphStore 生产注入（server.ts app.use + setOverflowGraphStore，接线 D476 已建机制到生产入口）

> 生成: 2026-08-23 15:49:31 | 分支: feat/win-d478-overflow-mount | as any: 0

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
        Sentinel Finding[] → 诊断引擎 Phase 2 → 8 位文件驱动专家解读 Finding → 产出分析

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

本任务属于基础设施/接线系统。收 D476 交付报告遗留①（overflow 路由 D90 声称挂载实为仅 import，三端点 404 不可达）+ graphStore 生产注入缺口。触及：
- **L1 交互**：src/server.ts —— 唯一生产入口（启动装配）。L68 已 import overflowRoutes 但全文件零 app.use；setOverflowGraphStore 全仓库零生产调用 → 即使挂载也恒 503「GraphStore 未就绪」。
- 只读消费：src/routes/overflow.ts（D476 已交付认证+隔离，本任务不改其逻辑）；注入先例 setGraphBridge（routes/import.ts D231）。

M3 接线类任务：机制已建成（D476 认证+隔离）但未接生产入口 = 用户不可达（铁律 4/5）。

### b) 文件审计
grep 本任务关键词在 expert/ sentinel/ extensions/ knowledge/ theory/ skills/ 中。列出已有文件驱动模块。关系: 复用 / 扩展 / 新建 / 冲突
- `overflowRoutes` / `setOverflowGraphStore` 在 expert/ sentinel/ extensions/ knowledge/ theory/ skills/ 中零命中——纯代码接线修复，无文件驱动模块涉及，无冲突。
- 复用：src/server.ts L68 既有 import；src/routes/overflow.ts L23 setOverflowGraphStore setter（D476 就绪）；src/server.ts L395 setGraphBridge 注入先例（D231）。
- 不新建任何模块/类型/硬编码。

### c) 决策
已有覆盖→复用，不准新建硬编码。无覆盖→新建走文件驱动（属扩展解耦）。冲突→取消任务，复用已有。
已有覆盖→复用：setOverflowGraphStore setter 已存在，最小改动接线（dev doc §4.5 决策点 1 结论）；不新建注入机制、不改 app.locals 读取路径。本任务无文件驱动扩展，无新建硬编码类型。
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
| **Anthropic 工程实践** | agent 隔离、门禁/fail-closed、脚本验证、机器可验契约、并行协作 | 成本/产品定位/模型选择 |
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
  ① SPEC / Done 标准 — dev doc DS1-DS7 + 本 brief Done 标准
  ② 测试 — 先写 red（tests/routes/overflow-mount.test.ts 静态接线断言：现状仅 import 零挂载/零注入 → 必须失败）→ 记录失败证据 → 实现 → green
  ③ 实现 — 修改 src/server.ts 两处（挂载区 app.use(overflowRoutes) + 注入区 setOverflowGraphStore(graphStore)），满足 Done 标准 + 测试全绿 + tsc 28=28 零新增
  ④ 接线 — 挂载在 404 兜底之前；注入在 app.listen 之前（Promise executor 内同步执行，请求可达前完成）
  ⑤ 验证 — 自检 6 问 + 铁律复核 + dev doc DS1-DS7 全跑 + §3.2 回填核对

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge
  - 铁律 4/5: 交付不完整=写了代码没接线；后端能力≠用户可用的功能（本任务正是 M3 修复）
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见（三端点从 404 → 可达）
  - 铁律 33: 测试命名约定 *.test.ts
  - 铁律 38: as any 零容忍（类型收窄用显式内联类型，非 as any）
  - memory/2026-08-23-d476-ga-enterprise-scope.md: Q2 排除项紧跟动词具体文件名 + Done 项须 verify: 格式 + synova-commit 新签名
  - memory/2026-08-23-d477-standardkey-tags-delivery.md: synova-commit --task-id/--agent + 消息大写 D478
  - memory/2026-08-22-d470-ci-brief-visibility.md: CI G12 用 runner UTC 日期找今日 brief → 名字含日期的 tracked brief 已满足

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
  - rule: "server.ts 必须挂载 overflowRoutes 且挂载点在 404 兜底 handler 之前"
    verify: "grep -n 'app.use(overflowRoutes)' src/server.ts"（命中）
  - rule: "server.ts 必须生产调用 setOverflowGraphStore 且实参为 graphStore（判空守卫）"
    verify: "grep -n 'setOverflowGraphStore' src/server.ts"（命中且传 graphStore）
  - rule: "不改 src/routes/overflow.ts / tests/routes/overflow.test.ts（D476 写集，只读回归）"
    verify: "git diff --name-only main -- src/routes/overflow.ts tests/routes/overflow.test.ts"（零输出）

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
按 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md）执行，并将结论记录在本字段：
  ① 第一性原理 — 问题的最简本质是什么？最少机制能解决吗？
  ② Anthropic 工程基线 — 隔离/失败即关闭/脚本验证、机器可验契约，哪条适用？
  ③ 开源实证 — 有可克隆的代码/架构参考吗？clone 下来看实际做法
  ④ 收敛检查 — 两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖

决策记录：
1. **graphStore 注入用 setter 还是 app.locals**（dev doc §4.5 决策点 1）：setter。参考：第一性原理（setOverflowGraphStore 已存在，setter 是最小改动；app.locals 需改 overflow.ts 读取逻辑扩大爆炸面）+ 开源实证（仓内 setGraphBridge D231 同款先例）。收敛：setOverflowGraphStore(graphStore)，L395 setGraphBridge 同区。
2. **挂载位置**（dev doc §4.5 决策点 2）：挂载区（L311+）末尾按现有顺序追加（cockpitRoutes 之后、404 兜底之前）。参考：DeepSeek 最小侵入 + 仓内挂载区顺序惯例。overflow 路由自带 requireAuth 双守卫（D476），全局 jwtAuthMiddleware（L290）在前即可。
3. **graphStore 可空处理——判空守卫 vs 改 setter 签名**（本 brief 新增决策点，dev doc §3.1 预留"setter 接受 null 或调用前判空"二选一）：选调用前判空 `if (graphStore)`。参考：第一性原理（写集 §3.1 只含 server.ts + 测试，改 overflow.ts 签名越界违反 DS5；判空跳过注入 → 路由侧既有 `if (!graphStore) 503 degraded` 降级语义原样保持 = Anthropic fail-open 到显式降级路径而非崩溃）+ Anthropic（降级信号传播，铁律 31）。收敛：判空守卫，不注入时路由 503 degraded，语义与 dev doc 一致。
4. **类型收窄写法——graphStore 是 `unknown`（BootstrapServices L94 `graphStore?: unknown`）**：直接传参必新增 tsc 错误（DS4 禁止；现状 28 个含 L395 setGraphBridge 同型存量错误）。判空不收窄 unknown。参考：Anthropic 机器可验契约（tsc 零新增是硬标准）+ 仓内先例（overflow.ts L21-23 内联 `import('../l4/graph-bridge').GraphStore` 类型；server.ts L228-231 `as never` 惯例）。结论：守卫后 `as import('./l4/graph-bridge').GraphStore` 显式内联类型断言（非 as any，铁律 38 合规；类型源与 setter 形参同源，非凭空捏造）。不修 L395 存量错误（越界，DS5）。
5. **集成测试（可选项）不做的判断**：起全量 Bootstrap（DB/连接器/LLM）在单测环境不可行且脆弱。参考：DeepSeek 最少机制（静态接线断言已覆盖挂载+注入+顺序两类失败模式）+ dev doc §4 已标注"可选，能起 server 时"。结论：交付静态接线测试 4 用例，集成可达性由 CI/部署后 checkpoint-deploy 验证。

### d) 相关 Note 引用
- [x] 本任务决策沉淀至 dev doc §3.2 回填（S-6，同 commit）+ Q1c 本字段。无需新建 memory/notes（决策已入 tracked 文档，K3 可核）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/server.ts：挂载区末尾追加 app.use(overflowRoutes)，位于 cockpitRoutes 之后、404 兜底之前
- src/server.ts：setGraphBridge 同区加判空守卫 + setOverflowGraphStore(graphStore) 生产注入
- src/server.ts：L68 import 行扩展 setOverflowGraphStore 具名导入
- tests/routes/overflow-mount.test.ts：新建静态接线断言 4 用例，挂载存在 / 挂载在 404 兜底前 / 生产注入传 graphStore / 注入先于 app.listen，red=当前仅 import 零命中 → green
- docs/plans/codex/implementation/SYNOVA-IMPL-D478-overflow-mount-wiring-20260823.md：§3.2 按实回填，S-6 同 commit

不做什么：
- 不改 src/routes/overflow.ts：D476 已交付认证+隔离，只读消费其路由逻辑与 setter 签名
- 不改 tests/routes/overflow.test.ts：D476 写集，只读回归
- 不改 src/sentinel/：DSH 地盘
- 不改 scripts/：DSH 地盘
- 不修 tsc 存量错误：server.ts L394/L395 既有错误修复越界，DS5 范围一致，28=28 零新增即可
- 不做溢出仪表盘前端接入：另排任务
- 不 bump VERSION.md：S-8 接线修复，非门禁/工具行为变化
- 不碰 客户A客户数据

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- 带认证的 HTTP 请求 GET /api/overflow/dashboard/:enterpriseId、POST /api/overflow/simulate、GET /api/overflow/snapshots/:cycleId（前端 dashboard.js / 外部 MCP 调用方）

处理（中间经过哪些步骤）：
- 请求 → server.ts 挂载链（jwtAuthMiddleware L290 → … → app.use(overflowRoutes) 挂载点 → overflow 路由 requireAuth 双守卫）→ graphStore 已由启动装配注入（setOverflowGraphStore，先于 app.listen）→ generateOverflowDashboard / simulateInvestment / getCycleSnapshots 业务函数
- graphStore 缺席（Bootstrap 降级）→ 判空守卫跳过注入 → 路由 503 degraded（既有降级语义不变）

结果（最终展示在哪）：
- 三端点从 404 NOT_FOUND（不可达）→ 200 JSON 业务数据 / 401/400/403 认证隔离拒绝 / 503 degraded——API 对消费方可达，链路完整
- 静态接线测试 tests/routes/overflow-mount.test.ts 4 用例全绿守卫此接线不回退

## 架构层: L1
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [x] 入口可触达: server.ts 挂载 overflowRoutes 且在 404 兜底前。verify: grep -n "app.use(overflowRoutes)" src/server.ts 命中 → L358 命中 ✓
- [x] 链路走通: 生产注入 setOverflowGraphStore(graphStore) 判空守卫，先于 app.listen。verify: grep -n "setOverflowGraphStore" src/server.ts 命中且传 graphStore → L401 生产调用 + L68 具名导入 ✓
- [x] 结果可见: RED 先行证据 + overflow-mount.test.ts 4 用例全绿 + overflow.test.ts 回归绿 + tsc 28=28。verify: npx vitest run tests/routes/overflow-mount.test.ts tests/routes/overflow.test.ts → 2 文件 10/10 全绿 ✓；tsc 28=28 零新增（仅存量 2 错行号 +1）✓；routes 全目录 26 文件 154 用例绿 ✓；--changed 相关集 7 文件 50 用例具名单跑绿 ✓
