# Task Brief: D481 auth.integration.test.ts 契约对齐修复（D479 审计遗留）

> 生成: 2026-08-24 01:39:28 | 分支: feat/win-d481-auth-integration-fix | as any: 0

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

流程约束: V4.5.0 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查.

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
- 纵向: 否（不改 L1-L5 生产代码）
- 横向: 否（不迁移/新建包）
- 扩展: 否（非文件驱动内容）
- **本任务 = 测试层契约对齐修复**：tests/middleware/auth.integration.test.ts 对齐 D102/D479 确立的新 login 契约（email/phone/wechatId + password bcrypt）。写集仅 1 个测试文件。现状 main 基线 7 failed / 3 passed（D479 诚实上报 #1，dev doc §2 已实测）。

### b) 文件审计
grep `registerAndLogin` tests/ → 零命中（不存在同类 helper，无冲突）。
grep `api/auth/register` tests/ → 零命中（整个测试仓库无 register 用例先例）。
grep `body: JSON.stringify({ userId` tests/middleware/auth.integration.test.ts → 6 处旧契约请求体（L73/L89/L114/L203/L227/L235，实测核实）。
关系: 复用（保留既有挂载结构/失败模式用例）+ 修改（login 请求体改走新契约）。

### c) 决策
已有覆盖→复用：login 路由新契约正确（src/routes/auth.ts L114-146 实测：email/phone/wechatId + password，bcrypt.compare），unit 测试 auth.test.ts 23/23 绿（D479）——integration 跟随对齐，不新建、不改生产。
冲突→无。
关键新发现（实现时验证后回填 dev doc §3.2）: /api/auth/register 不在 jwtAuthMiddleware 白名单（src/middleware/auth.ts L83-99 实测，仅 /api/auth/login 在列），而测试挂载 jwtAuthMiddleware→authRoutes 与生产 server.ts L290-293 同构 → register 请求预期被 401 拦。处理方案见 Q1c。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC: dev doc SYNOVA-IMPL-D481 DS1-DS7（docs/plans/codex/implementation/SYNOVA-IMPL-D481-auth-integration-contract-fix-20260824.md）
② 测试: 先跑 RED 基线（7 failed / 3 passed 已由 dev doc 2026-08-24 实测，本任务开工复核），修复后 10/10 绿
③ 实现: registerAndLogin(role, tag) helper + 6 处旧契约请求体替换 + 3 个失败模式用例原样保留
④ 接线: helper 被 ≥6 用例调用（grep -n "registerAndLogin" ≥6 命中）
⑤ 验证: 自检 6 问 + DS1-DS7 verify 全过

引用依据:
- 铁律 0-2: spec → test → impl → wire → review → merge（先红后绿）
- 铁律 7: Done 标准 = 入口可触达 + 链路走通 + 结果可见（= 测试链路真实挂载真实路由）
- 铁律 12: 集成测试 cover 真实路由，不 mock 管线（保持真实 express 挂载 + 真实 fetch）
- 铁律 33: *.integration.test.ts 命名（文件已符合，不改名）
- memory 教训: 2026-08-22-d471（写集纪律）、2026-08-23-d479（before-brief 空文件也拦须 rm）

### b) 本任务执行约束
- rule: "旧格式 login 请求体必须全部清除"
  verify: "grep -n \"body: JSON.stringify({ userId\" tests/middleware/auth.integration.test.ts → 零命中"
- rule: "registerAndLogin 必须被 ≥6 用例调用"
  verify: "grep -c registerAndLogin tests/middleware/auth.integration.test.ts"
- rule: "不触碰生产代码"
  verify: "git diff --name-only main -- src/ → 零输出"

### c) 决策参考系
决策点: register 请求被 jwtAuthMiddleware 401 拦（register 不在白名单）时如何建立用户前置？
① 第一性原理: 测试要验证的是 login/JWT/RBAC 契约，不是 register 白名单策略；用户前置是 fixture，不是被测对象。最少机制 = 让 register 请求通过认证层。
② Anthropic 基线: 脚本验证/机器可验——不绕过真实挂载（保持 server.ts 同构顺序），用真实 signJwtToken 签发 bootstrap token 使请求通过中间件，register 路由逻辑 100% 真实执行；白名单缺口如实上报（生产 register 端点不可匿名到达，属 D102 遗留，另立任务决策）。
③ 开源实证: supertest 社区惯例 = 真实 app 挂载 + 真实签发函数造 fixture token。
④ 收敛: 两参考系一致——不改挂载、不 mock、用真实签发函数，缺口上报不越界修。
参考：Anthropic/DeepSeek/第一性原理 + 结论：helper 用 signJwtToken 真实签发 bootstrap token 供 register 请求过认证层，白名单缺口上报。

### d) 相关 Note 引用
- memory/notes/ 本任务无新 Note（纯测试对齐，无架构决策沉淀价值；白名单缺口上报走交付报告）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- tests/middleware/auth.integration.test.ts：新增 registerAndLogin(role, tag) helper（register 唯一 email + password + role + orgId → login → 返回 {token, userId}），6 处旧契约 login 请求体改走 helper，断言 userId 取自注册响应
- 保留 3 个失败模式用例（无 token/无效 token/过期 token）原样

不做什么：
- 不修改 src/routes/auth.ts
- 不修改 src/middleware/auth.ts
- 不修改 src/middleware/rbac.ts
- 不修改 tests/middleware/auth.test.ts
- 不修改 tests/routes/auth.test.ts
- 不修改 src/server.ts

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）: vitest run tests/middleware/auth.integration.test.ts（CI + 本地）
处理（中间经过哪些步骤）: 真实 express 挂载（jwtAuthMiddleware → authRoutes → rbacMiddleware → 测试端点）→ helper 真实 register（bcrypt 哈希）→ 真实 login（bcrypt.compare + JWT 签发）→ 各用例走真实 HTTP fetch 断言
结果（最终展示在哪）: 10/10 用例 pass（vitest 报告）；DS1-DS7 verify 命令全绿；CI auth 相关 job 绿

## 接口审计（从代码 grep，非凭记忆）

- src/middleware/auth.ts:jwtAuthMiddleware（L246 全局中间件，白名单 L83-99）
- src/middleware/auth.ts:signJwtToken（L112 签发）/ verifyJwtToken（L140 验证）/ revokeToken（L212 撤销）
- src/routes/auth.ts:register（L67）/ login（L114）/ refresh（L152）/ revoke（L210）/ validate（L253）
- src/middleware/rbac.ts:canModifyWorkspace（删除工作区端点用）
- tests/middleware/auth.integration.test.ts:registerAndLogin（本任务新增 helper，8 个用例调用）

## 架构层: 基础设施
L1/L2/L3/L4/L5（测试修复，不触生产层；写集仅 tests/middleware/auth.integration.test.ts）
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: vitest run tests/middleware/auth.integration.test.ts 10/10 pass
- [ ] 链路走通: verify: grep -c "registerAndLogin" tests/middleware/auth.integration.test.ts ≥6
- [ ] 结果可见: verify: grep -n "body: JSON.stringify({ userId" tests/middleware/auth.integration.test.ts 零命中 && vitest run tests/middleware/auth.test.ts tests/routes/auth.test.ts 全绿 && tsc --noEmit 零新增
