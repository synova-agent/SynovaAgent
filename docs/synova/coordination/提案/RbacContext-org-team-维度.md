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
⇒ 「这个已认证用户是否有权碰这个 `:deptId` / 这个工作区」**在执法侧无法表达**。

🔴 **精确化（勿夸大）**：**租户维度本身今日已可表达** —— `src/middleware/auth.ts:35-40` 的
`AuthRequestContext = { role, userId, orgId }` 由 `:492-505` 的 `extractAuthFromRequest()`
从验签的 `req.auth.orgId` 产出（`:501`）。缺口是**投影**：执法消费的 `RbacContext` 没接这一维，
而 L-4 禁止路由重算身份 ⇒ **不是数据类型不存在，是没有从数据到执法的合法通路**。

本提案给出**一次冻结**的最小接口，供 1-7 / BR-3 / CTO §四③ 三处共用，省三次改。

---

## 一、问题（可复核，非推断）

### 1.1 接口现状（as_of `ade9f3c4f`）

| 位置 | 声明 |
|---|---|
| `src/middleware/auth.ts:26-33` | `JwtPayload = { sub: userId; role; orgId: tenant/org ID; iat; exp; jti }` |
| `src/middleware/auth.ts:35-40` | `AuthRequestContext = { role; userId; orgId }` ← **租户维度已有载体** |
| `src/middleware/auth.ts:492-505` | `extractAuthFromRequest()`：`:501 orgId: req.auth.orgId` —— **最近的既有先例**，本提案 §2.2 与之同构 |
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
该判据**恒假** —— **连读自己部门也 403**。而 `app/js/dashboard.js:29`（`const deptId = user?.orgId || 'default'`）
+ `:35`（`apiFetch('/api/workspace/' + deptId)`）是真消费方，且 `app/js/api-client.js:61` 真带 `Bearer`
⇒ **过度拒绝 = 功能回归**，已撤（#1116 正文 §1）。
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
    orgId: req.auth.orgId,          // 🆕 不再丢弃（与 auth.ts:501 extractAuthFromRequest 同构）
    departmentId: <待裁 —— 见 §三 D1>,  // 🆕 **本件不预设**其来源；`JwtPayload`(auth.ts:26-33) 今日无该 claim
    department: undefined,          // ⚠️ 冻结：不复活旧语义（见 §2.4）
    authenticated: true,
    gaConstraints: req.auth.gaConstraints,
  };
}
```
> ⚠️ **D1 未裁之前，`departmentId` 不得落码**：`JwtPayload` 今日**没有** `deptId` 字段，
> 任何写 `req.auth.deptId` 的样例都**编译不过**（`TS2339`）。本件把该映射留成**显式占位**，
> 是为了不把「待裁项」伪装成「已定案」。

### 2.3 不变量（**这是本提案的承重部分**）

| # | 不变量 | 判据（可机器判） |
|---|---|---|
| **I1** | 身份维度**只能**来自验签后的 `req.auth`（L-4：路由不得重算身份） | `git grep -nE 'req\.auth' -- src/routes/ \| grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*\|//\|/\*)'` ⇒ **期望 0**。⚠️ 现值 = **7 命中**（`actions-api.ts:52` · `im.ts:122,127` · `workspace-data.ts:29,66` · `workspaces-api.ts:26,203`），**全部是注释** ⇒ 判据**必须过滤注释行**，否则今天就是红的（原写法「`middleware/auth.ts` 之外零处」自相矛盾：`auth.ts` 本就不在 `src/routes/` 下） |
| **I2** | **缺席即拒绝**：`orgId` 不可得 ⇒ 一切跨租户判定 **fail-closed**（不得回退"放行"） | 单测：`extractRbacContext({})` ⇒ `orgId === ''` 且 `canAccessWorkspace` 对其返回 `false` |
| **I3** | **不得**以 `undefined` 表达"无限制" | **具名测试**（P1 交付）：`canAccessWorkspace({role:'manager', userId:'u', authenticated:true, orgId:''}, {visibility:'department', department:'d1'})` ⇒ **`false`**；且同一函数对 `orgId:'d1'`+`department:'d1'` ⇒ `true`。**「不知」与「不限」必须走不同返回**（原表述无可执行判据，已补） |
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
| ⚠️ **P2 的前置（本件必须明说）** | — | `ws.orgId` **今日不存在**：`canAccessWorkspace` 的 ws 形参只有 `{visibility?, department?, owner?, sensitivity?}`（`rbac.ts:240-245`），`interface Workspace`（`workspaces-api.ts:61-77`）**无 `orgId`**，真调用点传的是 `{visibility,department,owner}`（`workspaces-api.ts:207`）。⇒ **P2 不是"叠一个判据"，而是一次工作区数据模型变更**（接口 + 持久化 + 调用点）。**本件不含该变更，且它未列在 §四 风险里 —— 现补为风险 5。** |
| **P3** | **#1051（1-7）** 收口：执法点从 1 处扩到多处 | `git grep -n "canAccessWorkspace" -- src/` 活跃调用点 > 1 |
| **P4** | **CTO §四③**：硬化姿态下飞书回调可达性（与 DevMode 掩盖同族） | 硬化姿态真 HTTP 回调 ≠ 401 |

---

## 三、待决（**给 CTO / K3 的裁决点**，本件不作答）

| D# | 待决 | 选项 | 产品线**倾向** | 代价 |
|---|---|---|---|---|
| **D1** | `departmentId` 的 JWT claim 名与签发方 | (a) **只补 `orgId`，不引入 `departmentId`**（单租户单部门，最省）(b) 新增 `deptId` claim（真多部门）(c) 暂不引入任一 | **(a)**：当前出货形态是单机单租户（D590 单机本地信任），先补 `orgId` 即可堵跨租户；真正多部门等有客户再说。🔴 **注意读法**：(a) 是「**不引入部门轴**」，**不是**「把租户 ID 当部门 ID 用」—— 后者正是 §四 风险 2 明令禁止的混用。若创始人的意思偏向"用 orgId 充当部门"，请**显式改判**，本件不代劳 | (a) 多部门场景下仍需二次冻结；且 §2.1 新加的 `departmentId` 在 (a) 下**空置**（field 存在但无来源）⇒ 若裁 (a)，建议 §2.1 **删掉该字段**，避免出现「两个部门语义字段都不知该读哪个」 |
| **D2** | `orgId` 缺失时 `extractRbacContext` 返回什么 | (a) `''` + I2 fail-closed (b) 抛错 | **(a)**：与现有 `authenticated:false` 同姿态，不引入新异常路径（铁律 24） | 无 |
| **D3** | DevMode 自动 admin 是否收窄 | (a) 维持（D590 单机信任）(b) DevMode 下也不授跨 `orgId` 访问 | **(b) 仅跨租户那一维**：DevMode 是"本机信任"，不该等于"跨租户可读" | 需同时动 §四③，建议合并立卡 |
| **D4** | 本提案是否作为 **BR-3 五角色 RBAC** 的接口前置 | 是 / 否 | **是**（三处撞同一类型，先冻一次） | 冻结期间 BR-3 不得自定义并行字段 |

---

## 四、风险与代价（如实列）

1. **回归风险**：`RbacContext` 加**必填**字段会打断所有直接构造它的调用点与夹具（`tsc` 会报）。
   ⇒ 缓解：P1 单独一支、先 `tsc --noEmit` 清点构造点；或先用 `orgId?: string` + I2 兜底，P2 再收紧。
2. **语义误用风险**：`orgId` 是**租户**，不是部门；`app/js/dashboard.js:29`（`const deptId = user?.orgId || 'default'`）
   把 `orgId` 当 `deptId` 用 ⇒ 若照抄进判据会把"同租户"误当"同部门"。
   **本提案明确要求 P2 的判据写成 `orgId` 对 `orgId`**，不得混用。
3. **DevMode 掩盖**（CTO §四③ 同族）：任何"守卫在 DevMode 下不点火 ⇒ 判据恒绿"的坑，
   本提案要求 P1–P3 的判据**必须在硬化姿态与 DevMode 姿态各跑一次**（裁决纪律 C）。
4. **不解决的事**：本提案**不**修 `department-workspace.ts` 的身份通道退役（D947/R6 已判「另立卡」）。
5. **🆕 P2 隐含工作区数据模型变更**（复核员发现，本件初版漏列）：`ws.orgId` 今日不存在（见 §2.5 P2 前置）
   ⇒ **P2 的真实工作量远大于一行判据**（接口 + 持久化 + 调用点 + 回归）。请在裁 P2 时按**一张独立卡**估。
6. **证据provenance（如实标注）**：§1.2 的四姿态结论，本件初版由**独立复核员真 HTTP 实测 + 产品线**得出；
   但**本件这一版没有重跑四姿态**（复核员指出其自身也只做到代码级复核）。⇒ 四姿态结论**可信但未在本版复跑**，
   若 K3/CTO 要作为 P1 立项依据，建议**先复跑一次**再冻结。

---

## 五、附录 · 复跑入口（证据链）

```bash
# 四姿态实测（复核员夹具，git-ignored .k1-review3/）
git grep -n "orgId" -- src/middleware/rbac.ts          # 现状：RbacContext 内零命中
sed -n '124,131p' src/middleware/rbac.ts               # department: undefined 的位置
git grep -n "req\.userId\s*=" -- src/                  # 影子身份通道：零命中（I4 基线）
git grep -n "isSameDepartment" -- src/                 # 恒假判据的调用面
```

---

## 六、本版更正（**复核驱动**，2026-10-05 第 2 版）

> 独立复核（fresh context / 非作者）对本件第 1 版判 **建议**，点出 6 处**事实级**缺陷。
> 产品线（本件执笔）**逐条回查源码后全部采纳**并改，清单如下 —— 留档是为了让下一位读者知道**哪几句曾经错过**。

| # | 复核指出的错 | 本版改法 | 回查依据 |
|---|---|---|---|
| 1 | `app/js/dashboard.js:31` 被引为 `deptId` 赋值处 | 改为 **`:29`**（`:31` 其实是 `try {`） | `sed -n '27,37p' app/js/dashboard.js` 实测 |
| 2 | §〇「**类型层**无法表达」夸大 | 改为「**执法侧**无法表达」，并新增 `AuthRequestContext`(`auth.ts:35-40`) + `extractAuthFromRequest`(`:492-505`) 两行 —— **租户维度今日已有载体**，缺的是到 `RbacContext` 的**投影** | `grep -n "export function extractAuthFromRequest" -A 14 src/middleware/auth.ts` |
| 3 | §2.2 样例写 `req.auth.deptId` ⇒ **编译不过**，且与「不预设 claim 名」自相矛盾 | 改为**显式占位** `<待裁 —— 见 §三 D1>`，并加注「D1 未裁前不得落码」 | `JwtPayload`(`auth.ts:26-33`) 无 `deptId` |
| 4 | P2 的 `ws.orgId` **不存在** | 新增「P2 的前置」行 + §四 风险 5：P2 实为**一次工作区数据模型变更** | `rbac.ts:240-245` 形参无 `orgId`；`workspaces-api.ts:61-77` `Workspace` 无 `orgId` |
| 5 | I1 的判据**自相矛盾且今天就是红的**（7 命中）；I3 **没有可执行判据** | I1 改为过滤注释行的可跑命令 + 标注现值 7（全注释）；I3 补**具名测试** | `git grep -nE 'req\.auth' -- src/routes/` 实测 7 命中 |
| 6 | D1(a)「复用 `orgId`（= 单租户单部门）」与 §四 风险 2「不得混用」**冲突** | D1(a) 改写为「**只补 `orgId`，不引入部门轴**」并加红字警示「不是把租户 ID 当部门 ID」 | 本件自洽性检查 |

**另**：§四 新增风险 6，如实标注 —— §1.2 四姿态结论**本版未复跑**（复核员亦只做到代码级复核），
若作为 P1 立项依据建议先复跑。

**本版未再经同一复核员复核** —— 上述 6 条即其原话所指，产品线已逐条回查源码，但**内容裁决权仍在 CTO/K3**。
