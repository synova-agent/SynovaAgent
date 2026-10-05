# 提案 · `RbacContext` 补 org/team 维度（1-7bis）

> 状态: **proposal（提案，不是 todo）** ｜ 执笔: 产品线（synova-product-lead）
> 日期: 2026-10-05 ｜ 基线: `origin/main` = `ade9f3c4f`
> 卡: 1-7bis（CTO 派单 K1 第 2 版 §一）｜ 关联: **#1051**（1-7）· BR-3 五角色 RBAC · CTO §四③ 飞书 401
> 判据（CTO 卡面）: `test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md` ⇒ exit 0
> ⚠️ **判据级别如实标注 = L1（文件存在）**。本件是**规格交付物**，其实质验收是**内容裁决**（CTO/K3），
>    不可机器判 ⇒ 不冒充 L3-真跑。
> 🔴 本件**不改任何代码**。冻结权在创始人/CTO。

---

## 〇、一句话

`RbacContext` **没有任何组织/部门/租户维度**，且 `department` 被刻意恒置 `undefined`
⇒ 「这个已认证用户是否有权碰这个 `:deptId` / 这个工作区」**今日在类型层就无法表达**。
本提案给出**一次冻结**的最小接口，供 1-7 / BR-3 / CTO §四③ 三处共用，省三次改。

---

## 一、问题（可复核，非推断）

### 1.1 接口现状（as_of `ade9f3c4f`）

| 位置 | 声明 |
|---|---|
| `src/middleware/auth.ts:26-33` | `JwtPayload = { sub: userId; role; orgId: tenant/org ID; iat; exp; jti }` |
| `src/middleware/auth.ts:35-40` | `AuthRequestContext = { role; userId; orgId }` |
| `src/middleware/rbac.ts:96-108` | `RbacContext = { role: WorkspaceRole; department?: string; userId: string; authenticated?: boolean; gaConstraints? }` |
| `src/middleware/rbac.ts:124-131` | `extractRbacContext()`：`req.auth` 存在 ⇒ 返回 `{ role, **department: undefined**, userId: req.auth.sub, authenticated: true }` |

**关键事实**：`extractRbacContext` **把 `req.auth.orgId` 整个丢弃**（`orgId` 在 JWT 里**有**，在 `RbacContext` 里**没有**）。
`department` 的 `undefined` 是 **D947/L-32 的刻意收窄**（注释原文：「双 undefined / 单侧 undefined / 空串均不得命中」
——为堵"部门判据恒过"而做的收紧），**不是遗漏**。后果是 `isSameDepartment(ctx.department, X)` 对**任何非 admin 角色恒假**。

### 1.2 后果（四姿态实测，2026-10-05，独立复核员 + 产品线）

`POST`/`GET` 工作台数据端点，用真实中间件链（挂载序照 `server.ts:344 → 366 → 379`）四姿态实测：

| 姿态 | 匿名结果 | 说明 |
|---|---|---|
| `DEV_MODE=false` + `JWT_SECRET` | **401** | JWT 层先拦，路由守卫不可达 |
| `DEV_MODE=true` + `JWT_SECRET` | **401** | 同上 |
| **`DEV_MODE=true` + 无 `JWT_SECRET`** | **200 + 真实工作台 JSON** | DevMode 自动授 `dev-admin` ⇒ `authenticated:true` ⇒ 守卫惰性 |
| 不挂 jwt 层（测试态） | 403 | 唯一能点火的形态 |

⇒ ① 现行"路由级身份守卫"在**出货姿态**下**净安全效果 = 0**（#1116 的复核结论，已登记进该 PR 正文）。
⇒ ② 曾试把 `canAccessWorkspace({visibility:'department', department: deptId})` 叠上去：因 `department` **恒 `undefined`**，
该判据**恒假** —— **连读自己部门也 403**。而 `app/js/dashboard.js:31,35`（`deptId = user?.orgId`，且
`app/js/api-client.js:61` 真带 `Bearer`）是真消费方 ⇒ **过度拒绝 = 功能回归**，已撤（#1116 正文 §1）。
⇒ ③ 结论：**"恒假"与"恒真"两种坏态都出现过**，因为**判据的输入维度根本不存在**。

### 1.3 三处撞同一接口（一次冻结省三次改）

| 撞点 | 为什么撞 |
|---|---|
| **#1051（1-7）** | 「未授权请求在**所有**工作区路由 403」—— 需要"该用户属哪个部门/租户"才可判 |
| **BR-3 五角色 RBAC** | 角色×岗位的授权矩阵需要租户/岗位维度作为第二轴 |
| **CTO §四③ 飞书 401** | 硬化姿态下真实飞书回调不可达、只有 DevMode 放行 ⇒ 与 1-7 同族（**DevMode 掩盖**） |

---

## 二、提案（to-be）

### 2.1 `RbacContext` 增加两个字段（**唯一来源 = 验签后的 `req.auth`**）

```ts
export interface RbacContext {
  role: WorkspaceRole;
  userId: string;
  authenticated?: boolean;
  gaConstraints?: GAConstraints;

  /** 🆕 租户/组织 ID —— 必填。来源 = req.auth.orgId（验签）。缺失 ⇒ 见 §2.3 fail-closed */
  orgId: string;
  /** 🆕 部门 ID —— 可选。来源 = JWT 新增 claim（本提案不预设 claim 名，见 §三 待决 D1） */
  departmentId?: string;

  /** ⚠️ 保留但**语义冻结**：见 §2.4 */
  department?: string;
}
```

### 2.2 `extractRbacContext()` 映射（唯一改动点）

```ts
if (req.auth) {
  return {
    role: req.auth.role as WorkspaceRole,
    userId: req.auth.sub,
    orgId: req.auth.orgId,          // 🆕 不再丢弃
    departmentId: req.auth.deptId,  // 🆕 JWT 有则填；无则 undefined（不猜）
    department: undefined,          // ⚠️ 冻结：不复活旧语义（见 §2.4）
    authenticated: true,
    gaConstraints: req.auth.gaConstraints,
  };
}
```

### 2.3 不变量（**这是本提案的承重部分**）

| # | 不变量 | 判据（可机器判） |
|---|---|---|
| **I1** | 身份维度**只能**来自验签后的 `req.auth`（L-4：路由不得重算身份） | `git grep -n "req\.auth" -- src/routes/` 只出现在 `middleware/auth.ts` 之外**零**处（既有基线除外） |
| **I2** | **缺席即拒绝**：`orgId` 不可得 ⇒ 一切跨租户判定 **fail-closed**（不得回退"放行"） | 单测：`extractRbacContext({})` ⇒ `orgId === ''` 且 `canAccessWorkspace` 对其返回 `false` |
| **I3** | **不得**以 `undefined` 表达"无限制" | 判据函数必须区分「不知」与「不限」：不知 ⇒ false |
| **I4** | 新维度**不得**引入第二身份通道（禁止新加 `req.userId` 这类影子字段） | `git grep -n "req\.userId\s*=" -- src/` ⇒ 零命中（0-9bis 已立的规矩） |
| **I5** | `department`（旧字段）**保持恒 `undefined`**，除非创始人另行裁决解除 L-32 | 单测锁：`extractRbacContext` 返回值 `department === undefined` 恒真 |

### 2.4 为什么**不**直接复活 `department`

旧 `department` 的语义从未被定义过由谁写入（历史上经 `x-synova-token` 自报，D947 已删）。
**直接把它填上 = 用一个人的猜测决定全仓授权语义**。故本提案：

- 新增 **`orgId`（必填）** —— 有现成真源（`req.auth.orgId`），**零风险**；
- 新增 **`departmentId`（可选）** —— 但**不预设**其 JWT claim 名与填充时机（见 §三 待决 D1）；
- 旧 `department` **语义冻结**（I5），避免"两个部门字段并存"的漂移病根。

### 2.5 迁移（分阶段，每阶段可独立回退）

| 阶段 | 动作 | 完成判据 |
|---|---|---|
| **P0（本提案）** | 只冻接口，不改代码 | 本文件存在（CTO 卡面判据） |
| **P1** | 加 `orgId` 字段 + `extractRbacContext` 映射 + I2/I3/I5 单测 | 新单测三态（正常/缺席/边界）全绿；**改坏即红**（撤映射 ⇒ 必红） |
| **P2** | 工作台读端点叠 **`orgId` 判据**（`ctx.orgId === ws.orgId` 且两侧非空） | `tests/security/rbac-all-routes.test.ts` 增列"异租户 ⇒ 403 / 同租户 ⇒ 非 403"两态 |
| **P3** | **#1051（1-7）** 收口：执法点从 1 处扩到多处 | `git grep -n "canAccessWorkspace" -- src/` 活跃调用点 > 1 |
| **P4** | **CTO §四③**：硬化姿态下飞书回调可达性（与 DevMode 掩盖同族） | 硬化姿态真 HTTP 回调 ≠ 401 |

---

## 三、待决（**给 CTO / K3 的裁决点**，本件不作答）

| D# | 待决 | 选项 | 产品线**倾向** | 代价 |
|---|---|---|---|---|
| **D1** | `departmentId` 的 JWT claim 名与签发方 | (a) 复用 `orgId`（= 单租户单部门，最省）(b) 新增 `deptId` claim（真多部门）(c) 暂不引入 | **(a)**：当前出货形态是单机单租户（D590 单机本地信任），先补 `orgId` 即可堵跨租户；真正多部门等有客户再说 | (a) 多部门场景下仍需二次冻结 |
| **D2** | `orgId` 缺失时 `extractRbacContext` 返回什么 | (a) `''` + I2 fail-closed (b) 抛错 | **(a)**：与现有 `authenticated:false` 同姿态，不引入新异常路径（铁律 24） | 无 |
| **D3** | DevMode 自动 admin 是否收窄 | (a) 维持（D590 单机信任）(b) DevMode 下也不授跨 `orgId` 访问 | **(b) 仅跨租户那一维**：DevMode 是"本机信任"，不该等于"跨租户可读" | 需同时动 §四③，建议合并立卡 |
| **D4** | 本提案是否作为 **BR-3 五角色 RBAC** 的接口前置 | 是 / 否 | **是**（三处撞同一类型，先冻一次） | 冻结期间 BR-3 不得自定义并行字段 |

---

## 四、风险与代价（如实列）

1. **回归风险**：`RbacContext` 加**必填**字段会打断所有直接构造它的调用点与夹具（`tsc` 会报）。
   ⇒ 缓解：P1 单独一支、先 `tsc --noEmit` 清点构造点；或先用 `orgId?: string` + I2 兜底，P2 再收紧。
2. **语义误用风险**：`orgId` 是**租户**，不是部门；`app/js/dashboard.js:31` 把 `orgId` 当 `deptId` 用
   ⇒ 若照抄进判据会把"同租户"误当"同部门"。**本提案明确要求 P2 的判据写成 `orgId` 对 `orgId`**，不得混用。
3. **DevMode 掩盖**（CTO §四③ 同族）：任何"守卫在 DevMode 下不点火 ⇒ 判据恒绿"的坑，
   本提案要求 P1–P3 的判据**必须在硬化姿态与 DevMode 姿态各跑一次**（裁决纪律 C）。
4. **不解决的事**：本提案**不**修 `department-workspace.ts` 的身份通道退役（D947/R6 已判「另立卡」）。

---

## 五、附录 · 复跑入口（证据链）

```bash
# 四姿态实测（复核员夹具，git-ignored .k1-review3/）
git grep -n "orgId" -- src/middleware/rbac.ts          # 现状：RbacContext 内零命中
sed -n '124,131p' src/middleware/rbac.ts               # department: undefined 的位置
git grep -n "req\.userId\s*=" -- src/                  # 影子身份通道：零命中（I4 基线）
git grep -n "isSameDepartment" -- src/                 # 恒假判据的调用面
```
