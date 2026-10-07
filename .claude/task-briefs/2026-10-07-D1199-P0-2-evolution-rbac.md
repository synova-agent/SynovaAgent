# Task Brief: D1199 P0-2 evolution 10 端点补 RBAC 守卫

> 生成: 2026-10-07 | 任务号: D1199 | 流前缀: WIN-K6 | 派单依据: CTO《P0 三项·K6 终审修复》§一 P0-2（K3 终审 e19ccb7 发现）
> 基线 ref: origin/main = f56d67bd5089343c4d7f558015923ca9a9a40f9e

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
`src/routes/evolution.ts` 曾**整文件零授权守卫**（实测 `rg -c rbac` = 0），10 个端点（含写类的
`proposals/approve`、`federation/import`）对任何能发起 HTTP 的调用者开放。对照同层已合规文件：
`actions-api.ts` 21 处 / `knowledge.ts` 6 处 / `workspace-data.ts` 29 处 rbac 消费。

### b) 文件审计（实测）
- `rg -c rbac src/routes/evolution.ts` ⇒ 0
- 端点数：6 个 `router.post` + 4 个 `router.get` = 10（与派单清单一致）
- 既有合规形态（照抄对象）：`src/routes/actions-api.ts:57-83` 的 `readRbac` / `denyRbac` /
  `requireAuthenticatedRbac`（消费 `req.rbac`，403 + `code:'RBAC_DENIED'`）
- 🔴 **无既有"更高角色"判定写法**：actions-api / workspace-data 均只做 `authenticated` 一档

### c) 决策
10 个端点统一按 `authenticated` fail-closed 收口；**不发明**角色分级（派单 §四②"不要自创"），
并在代码注释与 PR 正文里显式标注"角色分级待 CTO 裁定另立卡"这一诚实边界。

## Q1: 调研 — 最佳实践 / 历史教训
- D1155 判据：路由必须**消费** `req.rbac`（由鉴权中间件注入），**绝不重算身份**；
  客户端自报凭据（x-synova-token / query.token）永不进入 `req.rbac`。
- 仓库直证手法：裸 express + 只挂 `rbacMiddleware`（不挂 jwt）⇒ `authenticated:false` ⇒ 守卫必须 403
  （先例 `tests/security/rbac-all-routes.test.ts`）。
- 历史教训：我上一批新增的两个 evolution 端点沿用了该文件既有的"零守卫"风格 ⇒ 授权面被扩大；
  教训 = 新增端点前先查该文件的守卫基线，不照抄邻居。

## Q2: 范围 — 正确的最简方案

做什么：
- src/routes/evolution.ts
- tests/routes/evolution-rbac.test.ts
- .claude/task-briefs/2026-10-07-D1199-P0-2-evolution-rbac.md
- task-state/D1199.json

不做什么：
- 不改 src/routes/actions-api.ts — 只是照抄其形态的样板来源
- 不改 src/middleware/rbac.ts — 身份来源不由本卡改动
- 不改 src/growth/feedback-collector.ts — 跨租户写归 D1197（写集隔离）
- 不改 packages/evolution/src/global-analyzer.ts — 读侧泄漏归 D1198（写集隔离）
- 不改 .github/workflows/ci.yml — 门禁语义裁权在 CTO

## Q3: 验收 — 入口 → 交互 → 结果
入口：10 个端点各自的 HTTP 入口（裸 express + rbacMiddleware）
处理：守卫消费 `req.rbac`；`authenticated !== true` ⇒ 403 + `code:'RBAC_DENIED'` + `log.warn` 留痕
结果：10/10 端点无认证上下文一律 403

## 架构层: L1 交互层（src/routes/evolution.ts）

## Done 标准
- [x] 判据：`npx vitest run tests/routes/evolution-rbac.test.ts` exit 0（11 passed） verify: npx vitest run tests/routes/evolution-rbac.test.ts
- [x] 改坏即红：删掉 federation/import 的守卫 ⇒ 该端点返回 400 而非 403（夹具必红） verify: npx vitest run tests/routes/evolution-rbac.test.ts
- [x] 端点覆盖计数：夹具自带"清单恰好 10 个"断言（防静默漏测） verify: npx vitest run tests/routes/evolution-rbac.test.ts
- [x] tsc 零新增：`npx tsc --noEmit` 中被改文件 0 error verify: npx tsc --noEmit

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-07-D1199-P0-2-evolution-rbac.md | task |
| src/routes/evolution.ts | task |
| task-state/D1199.json | task |
| tests/routes/evolution-rbac.test.ts | task |
