---
状态: proposed
日期: 2026-10-11
决策: K12-09 (#192) 跨 orgId 隔离判定写在内核 `jwtAuthMiddleware`，且**认证路径 / DevMode 路径 / 白名单分支三处共用同一判定函数**；拒绝用 403 + `CROSS_ORG_FORBIDDEN` + 归属字段，不静默 404
理由: |
  ① 卡面 §0 b) 实测: `DEV_MODE=true` 且无 `JWT_SECRET` 时中间件**无条件**授予 admin ——
     「开发姿态下那道墙可能消失」。若隔离判定只挂在认证路径，DevMode 就是一条越权通道。
  ② 卡面 Q0 c) 决策: 隔离**必须在内核物理成立**（不靠配置），DevMode 只提升**单租户内**权限。
  ③ 一处判定、三处共用 ⇒ 「DevMode 不跨租户」是**结构事实**而非两处各自约定（防漂移）。
  ④ 响应码对齐本仓既有路由级先例（`routes/overflow.ts:52-129` 用 `FORBIDDEN`）与
     DSH `InvariantError{code,packageName}` 的"机器可读拒绝码 + 归属"取向 —— 静默 404 会让
     「越权」与「不存在」不可区分（不可观测 = 不可审计）。
  ⑤ 判据形态: 请求属性 `X-Org-Id` / `X-Tenant-Id`（命名空间实测零命中）**显式声明目标组织**，
     与**验签身份**的组织声明比对；声明存在而身份无组织 ⇒ 收窄为拒绝（fail-closed，拒绝 > 放行）。
---

# 触发场景

K12 第 12 批「企业级一致性」第 9 卡（原 RB-01）。创始人红线原话：
「**肯定是不能 A 客户读 B 客户数据**」；且已明确「DevMode 跨租户**不可放行**」。

# 分层归属（含实测到的既有边界，未改）

- **内核层（本卡落地）**: `src/middleware/auth.ts` —— 全局唯一认证挂载点 `server.ts:396`，
  覆盖全部路由（认证路径 + 白名单分支 + DevMode 分支）。
- **路由层（既有，未动）**: `routes/overflow.ts:52-129` 已有同型路由级判据（path/body/query 三源）。
  本卡**不**把路由级判据上提或改写（卡面 Q2 明令不改 `getPermissionFilter` / `isWhitelisted` 既有逻辑）。
- **未覆盖的边界（如实登记，另立卡）**: `body.orgId` 仍是**路由级**租户派生源
  （`routes/conversations.ts:167`、`src/server.ts:493`、`routes/admin-knowledge.ts:117`）——
  本卡**只**依据「验签身份 + `X-Org-Id` 头声明」判定；把 body 声明纳入内核判据属**判据变更**（须先改卡）。

# 判据与可复跑命令（机器可判）

```
npx tsx scripts/control-tower/probe-rbac-multitenant.ts --case cross-org   # expectExit 0（登记件 RB-01）
npx vitest run tests/security/cross-org-isolation.test.ts                # 22 例，含 DevMode 姿态
npx vitest run tests/security tests/middleware                            # 回归面（22 文件 355 例）
```

**反例（改坏即红）**: 让三处判定任一短路 ⇒ `10 failed | 12 passed (22)`、探针 `4/8`（exit 1）；
还原 ⇒ `22 passed (22)`、探针 `8/8`（exit 0）。

# 相关

- 卡面: `.claude/task-briefs/2026-10-11-192-k12-09-multitenant.md`（本卡交付）
- 共写声明: `src/middleware/auth.ts` 与 K12-11 / K12-12 共写 ⇒ 串行（卡面 §共写声明，本卡先）
- 已被完整实现的相邻卡: K12-03 (#186) 白名单窄口径 / K12-05 `getPermissionFilter`（本卡**只读**不改）
- 缘起（本件因 D395-a/D534 Note 引用门禁要求而落）: 本卡写集含 `scripts/control-tower/probe-*.ts`
  ⇒ 命中"治理脚本区"触发面。探针是卡面 Q2 明列的**判据测量件**，非治理规则变更。
