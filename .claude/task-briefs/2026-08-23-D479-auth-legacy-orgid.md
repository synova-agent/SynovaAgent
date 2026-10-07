# Task Brief: D479 auth legacy orgId 字面 'default' 收敛（D476 遗留③）

> 生成: 2026-08-23 15:22 | 分支: feat/win-d479-auth-legacy-orgid | worktree: .claude/worktrees/d479-auth-legacy-orgid（主树被并行 D478 session 占用，按 dev doc 要求 worktree 隔离）
> dev doc: docs/plans/codex/implementation/SYNOVA-IMPL-D479-auth-legacy-orgid-20260823.md（权威，已全文阅读，§2 代码审计逐条核实与代码一致）

## 项目身份（每次重读）

SynovaAgent 是驻扎企业的 AI 诊断 + 持续增长导航系统。诊断是手段，增长才是目的。
Agent 不是 ChatBot：驻扎企业，持续观测，主动发现，自动诊断，行动建议，跟踪执行。
五层架构 L1 交互 → L2 编排 → L3 洞察 → L4 本体 → L5 存储，只能向下依赖相邻层。
文件驱动扩展：新专家/哨兵/行业 = 加文件不改代码。本任务是基础设施收敛，不触及文件驱动层。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务在纵向 L1 交互层，src/middleware/auth.ts 是全部 HTTP 路由共用的认证中间件。横向不动任何 Monorepo 包；非文件驱动扩展（expert/sentinel/extensions 零相关）。该层现有模块：jwtAuthMiddleware（JWT 主路径 + DEV_MODE 降级）、extractAuthFromRequest（JWT→RBAC 桥 + legacy x-synova-token 兼容）。本任务 = 修改收敛：2 处硬编码字面 'default' 改为与 config.ts L96 同源的表达式，不新增模块、不新增 export。

### b) 文件审计
grep "SYNOVA_ORG_ID" 全仓库实测：src/config.ts:96（唯一权威定义点）、src/agent/interactive-card.ts:18 与 src/l3/ga-collaboration.ts:20（仅 D476 O8 注释，非逻辑）。expert/ sentinel/ extensions/ 零命中——org 实例身份是基础设施概念，无文件驱动覆盖，正确路径就是改 src/middleware/auth.ts 本体。grep 字面 'default' src/middleware/auth.ts 仅 L260（DEV_MODE 自动 admin）+ L366（legacy token 缺 orgId 段回退）两处，已通读全文件 372 行核实，无第三处。

### c) 决策
已有覆盖 → 复用：与 config.ts L96 同源表达式 `process.env.SYNOVA_ORG_ID || 'default'`，直接内联，不 import config（auth.ts 位于中间件层，import config 会引入启动期配置耦合；dev doc §3.1 已定案）。无冲突，不取消。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = dev doc DS1-DS7（完成标准已定义）→ ② 测试先行：先写 2 个 red 用例并实跑确认失败（铁律 0-2: spec → test → impl → wire → review → merge）→ ③ 实现：两处表达式收敛，刚好满足 Done 标准，零新 export → ④ 接线：中间件内部收敛，jwtAuthMiddleware + extractAuthFromRequest 调用链与全部消费方不变（铁律 7: 入口可触达 + 链路走通 + 结果可见——入口/链路已存在，本任务修的是链路上的租户归属正确性）→ ⑤ 验证：自检 6 问 + vitest 相关套件 + tsc 零新增。

### b) 本任务执行约束
- rule: auth.ts 不得 import config（防循环依赖与启动期耦合），收敛表达式与 config.ts L96 保持同源
  verify: grep -c "from '../config'" src/middleware/auth.ts 归零
- rule: 两处收敛后 auth.ts 内 SYNOVA_ORG_ID 恰好命中 2 处
  verify: grep -c "SYNOVA_ORG_ID" src/middleware/auth.ts 等于 2
- rule: 新增测试用例结束必须 restore 环境变量（SYNOVA_ORG_ID/DEV_MODE/JWT_SECRET），防污染同文件其他用例
  verify: npx vitest run tests/middleware/auth.test.ts 全绿含既有用例

### c) 决策参考系
简单决策（单一路径，dev doc 已定案，无多选项冲突）：参考：Anthropic（同源收敛 + fail-safe 最终兜底 'default'）+ 第一性原理（最少机制：两处内联表达式收敛，不抽 helper、不引 import）。

### d) 相关 Note 引用
- memory/2026-08-23-d476-ga-enterprise-scope.md（D476 交付：auth.orgId 权威原则 + worktree 会话操作要领）
- memory/2026-08-22-d338-org-isolation-session.md（D338 多租户隔离：Q2 排除项路径紧跟动词等门禁细节）
- memory/2026-08-22-d470-ci-brief-visibility.md（CI 用 UTC 日期找今日 brief → 本 brief 用追踪名不用 auto 名）

## Q2: 范围 — 正确的最简方案

做什么：
- src/middleware/auth.ts: L366 legacy 回退收敛 parts[1] || 'default' 改为 parts[1] || process.env.SYNOVA_ORG_ID || 'default'，L260 DEV_MODE 自动 admin orgId 'default' 改为 process.env.SYNOVA_ORG_ID || 'default'，两处与 config.ts L96 同源
- tests/middleware/auth.test.ts: 新增 2 用例（legacy token 缺 orgId 段 + SYNOVA_ORG_ID=org-x 断言 orgId 为 org-x 含兜底回落断言；DEV_MODE 下断言 orgId 为 org-x），两用例结束 restore env 防污染

不做什么（排除项，均不在本任务范围）：
- 不改 src/server.ts — 属 D478 写集
- 不改 src/l3/report-assembler.ts — 属 D480 写集
- 不改 src/routes/diagnosis.ts — 属 D480 写集
- 不改 src/config.ts — orgId 定义点 L96 已是正确形态
- 不改 src/middleware/rbac.ts — WorkspaceRole 类型与本任务无关
- 不改 VERSION.md — 隔离收敛非门禁/工具行为变化，dev doc §3.1 S-8 已定

## Q3: 验收 — 入口 → 交互 → 结果

入口：HTTP 请求携带 legacy 格式 x-synova-token（role:orgId:userId 且缺 orgId 段），或 DEV_MODE=true 且未设 JWT_SECRET 的开发机请求。
处理：extractAuthFromRequest 解析 legacy token / jwtAuthMiddleware 落 DEV_MODE 会话时，orgId 回退取 process.env.SYNOVA_ORG_ID，仅 env 缺失时最终兜底 'default'——与 config.ts 实例身份同源。
结果：配置 SYNOVA_ORG_ID=org-x 的实例，未带 orgId 的 legacy token 与 DEV_MODE 会话的 auth.orgId === 'org-x'，租户归属正确不再落入旁路 'default' 命名空间；由 tests/middleware/auth.test.ts 新增断言呈现（red 先行已证）。verify: npx vitest run tests/middleware/auth.test.ts

## 架构层: L1（middleware/auth 认证中间件，服务全部 routes 入口）
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D479-auth-legacy-orgid-20260823.md — dev doc 权威（§2 审计/§3 写集/§4 测试/§6 DS1-DS7）
- docs/synova/audit-reports/2026-08-22-D338-org-audit.md — 隔离原则来源（D338 组织审计）
- docs/synova/coordination/DECISION-REFERENCE.md — Q1c 决策参考系框架

## 接口审计（从代码 grep，非记忆）
- src/middleware/auth.ts: jwtAuthMiddleware — L246 定义，L255-266 DEV_MODE 分支为缺陷 B 现场
- src/middleware/auth.ts: extractAuthFromRequest — L346 定义，L360-368 legacy 分支为缺陷 A 现场
- src/config.ts: loadConfig — L96 orgId 唯一权威定义点

## Done 标准
- [ ] DS1 legacy 收敛: verify: grep -n "SYNOVA_ORG_ID" src/middleware/auth.ts 命中 L366 附近
- [ ] DS2 DEV_MODE 收敛: verify: grep -c "SYNOVA_ORG_ID" src/middleware/auth.ts 等于 2（含 L260 附近）
- [ ] DS3 测试全绿: verify: npx vitest run tests/middleware/auth.test.ts 全 pass（red 先行已证）
- [ ] DS4 零回归: verify: npx vitest run tests/routes/auth.test.ts 全绿（9/9）+ tests/middleware/auth.integration.test.ts 失败数与基线 main 完全一致（7=7，revert→run→restore 单命令实证，属 login 路由契约重写后的既有测试腐烂，非本任务回归；CI 对未改动文件既有失败显式容忍）+ npx tsc --noEmit 错误数 28=28（基线已实测 28）
- [ ] DS5 范围一致: verify: git diff --name-only main...HEAD 仅 src/middleware/auth.ts 与 tests/middleware/auth.test.ts 与本 brief 文件（追踪名供 CI 可见，D470 惯例）
- [ ] DS6 无绕过: verify: 全程不用 --no-verify
- [ ] DS7 推送+CI: verify: git push 后 git log origin/main..HEAD --oneline 为空 + CI 相关 job 绿
