# 提案 · `RbacContext` 补 org/部门/权限项 维度（1-7bis）— **v3（Grants 模型）**

> 状态: **proposal（提案，不是 todo）** ｜ 执笔: 产品线（synova-product-lead）
> 日期: 2026-10-05 ｜ 基线: `origin/main` = `707dd946b`（v3 重写基线）
> 卡: 1-7bis ｜ **本件 ≡ K11 的两项**：
>   - **RB-01 多租户隔离** → **[#1140]**（跨 `orgId` 读必被拒，含 DevMode 姿态）
>   - **RB-02 部门轴** → **[#1141]**（`departmentIds` 复数 + 文件驱动 + `resolveContext` 入口）
>   相邻：**[#1142]** RB-03 权限项模型 · **[#1143]** RB-04 BR-3 重构 ｜ 父 Issue **[#1139]**
> 关联: **#1051**（1-7）· BR-3 · CTO §四③ 飞书 401
> 判据: `test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md` ⇒ exit 0（**L1**，实质验收 = 内容裁决）
> 🔴 本件**不改任何代码**。冻结权在创始人/CTO。
>
> ## 🔴 v3 方向级更正（创始人 2026-10-05 裁决 · 必须最先读）
>
> **v1/v2 的「冻五档 RBAC」方向是错的，已废弃。**
> 创始人要点：「同是市场总监，A 客户能看财务、B 客户不能」——**这不是 RBAC 能表达的**：
> - **RBAC**：角色 → 权限（**档位决定**）
> - **我们要的**：**权限项是一长串可选清单，角色只是预设的一组勾选**（飞书式）
>
> ⇒ **决策：做 Grants（ACL）模型，不做 RBAC 档位模型。**
> ⇒ **五档仍保留为出厂默认，但不在类型里** —— 它是**配置的初值**，不是类型的一部分。

---

## 〇、一句话

`RbacContext` **没有任何组织/部门/权限项维度**，且 `department` 被刻意恒置 `undefined`
⇒ 「这个已认证用户是否有权碰这个 `:deptId` / 这个工作区」**在执法侧无法表达**。

🔴 **v3 追加（Grants 模型下更精确）**：现状连「**权限项**」这一轴都没有 —— `RbacContext` 只有 `role`（**单值**）。
而创始人裁定的模型里，**授权的基本单位是权限项**，角色只是"一组预设勾选"。
⇒ 缺口是**两轴**：**组织轴**（`orgId` / `departmentIds`）＋ **权限项轴**（`PermissionId[]`）。

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

### 2.1 冻结的是**契约形状**（**不冻实现**，CTO §二④）

```ts
/** 🆕 v3：权限项标识 —— **授权的基本单位**（Grants）。角色不再直接决定权限。 */
export type PermissionId = string;   // 值域 = 文件驱动的权限清单（§2.6）

export interface RbacContext {
  userId: string;
  authenticated?: boolean;
  gaConstraints?: GAConstraints;

  /** 🆕 租户/组织 ID —— **必填**。来源 = 验签 `req.auth.orgId`。不可得 ⇒ `''` + fail-closed（I2） */
  orgId: string;

  /** 🆕 部门 ID —— **复数**（创始人：「中层就会涉及多个部门」；单数装不下，且将来改单复数会打断所有构造点）。
   *      来源 = **文件驱动**（§2.6）。语义：`[]` = **无部门**，**不是**"全部"（I3） */
  departmentIds: string[];

  /** 🆕 权限项清单 —— **授权真源**。由 `role → permissions` **可配映射**解析而出（§2.6） */
  permissions: PermissionId[];

  /** ⚠️ **保留但降格**：`role` 只是「**出厂默认包的选择器**」，**不再是授权判据本身**。
   *      五档不进类型语义 —— 它是配置初值（创始人 v3 裁决） */
  role: WorkspaceRole;

  /** ⚠️ 冻结（I5）：不复活旧语义，见 §2.4 */
  department?: string;
}
```

### 2.2 入口：`resolveContext(identity)`（**唯一投影点**，CTO §二③）

🔴 **为什么必须立这个入口**：现状 `src/` 里 `teamId` / `department` 已散落 —— 🔴 不给手写数（CTO 纪律：数量一律以脚本实况为准）。三方口径实测分歧：
**428（CTO）/ 346（K3）/ 397（产品线，含子串匹配）**；涉及文件数三方一致 = 71。
枚举命令：`git grep -lE "teamId|department" origin/main -- src/ | wc -l` ⇒ 71—— 不立单一入口 ⇒ **74 个文件各写各的**（分叉）。

```ts
/**
 * 契约（铁律 47：输入 / 输出 / 降级）:
 *   @input  identity —— **验签后**的 `req.auth`（`JwtPayload`，唯一可信来源；L-4 禁止路由重算身份）
 *   @output { orgId, departmentIds, permissions[] } —— **授权判定只许读这四样（含 `version`）**
 *   @降级   `orgId` 不可得 ⇒ 返回 `orgId: ''` 且 `permissions: []` ⇒ 下游一律 fail-closed（I2）
 *   @不做什么 不查库、不猜、不用 `undefined` 表达"无限制"（I3）
 */
export function resolveContext(identity: JwtPayload): {
  orgId: string;
  departmentIds: string[];
  permissions: PermissionId[];
  /** v3.1（K3 P0 修复）：权限配置版本 —— 见 §8.3。
   *  必须在此冻结：旧决策的审计要能指向「当时那版权限」。 */
  version: string;
};
```

`extractRbacContext()` 改为**薄壳**（消费 `resolveContext`，自身不再拼装语义）：
```ts
if (req.auth) {
  const { orgId, departmentIds, permissions } = resolveContext(req.auth);
  return { userId: req.auth.sub, role: req.auth.role as WorkspaceRole,
           orgId, departmentIds, permissions,
           authenticated: true, gaConstraints: req.auth.gaConstraints,
           department: undefined /* I5 冻结 */ };
}
```
> ⚠️ **`departmentIds` 的来源是"待定"而不是"已定"**：`JwtPayload`(`auth.ts:26-33`) 今日**没有**部门 claim。
> 本件**不预设** claim 名 —— 见 §2.6（文件驱动）与 §三 **D1（已裁：复数 + 文件驱动）**。
> 任何写 `req.auth.deptId` 的样例都**编译不过**（`TS2339`）。

### 2.3 不变量（**这是本提案的承重部分**）

| # | 不变量 | 判据（可机器判） |
|---|---|---|
| **I1** | 身份维度**只能**来自验签后的 `req.auth`（L-4：路由不得重算身份） | `git grep -nE 'req\.auth' -- src/routes/ \| grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*\|//\|/\*)'` ⇒ **期望 0**。⚠️ 现值 = **9 命中**（🔴 2026-10-05 K3 审计纠正：v2 写的 7 是 ade9f3c4f 基线时点的数，v3 换基线未刷新 ⇒ 教训：判据里的现值必须随基线刷新，或干脆不写数只给命令）（`actions-api.ts:52` · `im.ts:122,127` · `workspace-data.ts:29,66` · `workspaces-api.ts:26,203`），**全部是注释** ⇒ 判据**必须过滤注释行**，否则今天就是红的（原写法「`middleware/auth.ts` 之外零处」自相矛盾：`auth.ts` 本就不在 `src/routes/` 下） |
| **I2** | **缺席即拒绝**：`orgId` 不可得 ⇒ 一切跨租户判定 **fail-closed**（不得回退"放行"） | 单测：`extractRbacContext({})` ⇒ `orgId === ''` 且 `canAccessWorkspace` 对其返回 `false` |
| **I3** | **不得**以 `undefined` 表达"无限制" | **具名测试**（P1 交付）：`canAccessWorkspace({role:'manager', userId:'u', authenticated:true, orgId:''}, {visibility:'department', department:'d1'})` ⇒ **`false`**；且同一函数对 `orgId:'d1'`+`department:'d1'` ⇒ `true`。**「不知」与「不限」必须走不同返回**（原表述无可执行判据，已补） |
| **I4** | 新维度**不得**引入第二身份通道（禁止新加 `req.userId` 这类影子字段） | `git grep -n "req\.userId\s*=" -- src/` ⇒ 零命中（0-9bis 已立的规矩） |
| **I5** | `department`（旧字段）**保持恒 `undefined`**，除非创始人另行裁决解除 L-32 | 单测锁：`extractRbacContext` 返回值 `department === undefined` 恒真 |

### 2.4 为什么**不**直接复活 `department`

旧 `department` 的语义从未被定义过由谁写入（历史上经 `x-synova-token` 自报，D947 已删）。
**直接把它填上 = 用一个人的猜测决定全仓授权语义**。故本提案：

- 新增 **`orgId`（必填）** —— 有现成真源（`req.auth.orgId`），**零风险**；
- 新增 **`departmentIds`（复数，文件驱动）** —— 真源按创始人第 ⑤ 条落**文件**，**不预设** JWT claim 名；见 §三 **D1（已裁）**；
- 旧 `department` **语义冻结**（I5），避免"两个部门字段并存"的漂移病根；
- 新增 **`permissions: PermissionId[]`** —— Grants 模型的**授权真源**；`role` 降格为**默认包选择器**。

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

### 2.6 授权来源 = **文件驱动** + `role → permissions` **可配映射**（CTO §二①）

按创始人第 ⑤ 条与 Grants 模型：

| 件 | 内容 | 谁能改 |
|---|---|---|
| **权限清单**（值域） | **文件驱动**：权限项定义（`id` / 中文名 / 所属域）落文件，不落代码 | 出厂（不可配） |
| **`role → permissions` 映射** | **文件驱动**：每个角色 = 一组 **预设勾选**（出厂默认包） | ✅ **可配** ← 这正是 Grants 与 RBAC 的**分界** |
| **用户授权** | 用户的 `permissions[]` = 其角色默认包 **±** 逐项增删 | ✅ 可配 |

🔴 **不冻"五档"** —— 五档 = 出厂默认包，**不进类型**（创始人 v3 裁决）。

---

## 三、待决 D1–D4 —— **CTO 2026-10-05 已全部裁定（最终口径，以此为准）**

| D# | 裁定 | 落地要求 |
|---|---|---|
| **D1** | **`departmentId`（单数）作废 ⇒ `departmentIds: string[]`**。依据：创始人「**中层就会涉及多个部门**」⇒ 单数装不下，且将来改单复数会**打断所有构造点**。**部门真源 = 文件驱动**（创始人第 ⑤ 条）。**读法 = 甲**（只补组织轴；**禁**"拿 `orgId` 当部门"）。§2.1 里那个单数字段**已删**（不留空置语义字段） | 类型复数 + 文件驱动 + 禁二次单复数迁移 |
| **D2** | `orgId` 不可得 ⇒ 返回 **`''`** + **I2 fail-closed** | 🔴 **硬约束**：`''` **必须同时让下游 fail-closed**；须有「`orgId` 缺失 ⇒ 拒」的**改坏即红**夹具 |
| **D3** | **DevMode 收窄（堵）** —— 创始人原话「**这个肯定是不允许的**」。范围**扩到多租户**：不许跨 `orgId` **且** 不许跨 `departmentIds`。🔴 判据**在【硬化姿态】与【DevMode 姿态】各跑一次**（**不依赖"真有第二个租户"**） | CTO 已自我纠正：「今天不可验 ⇒ 推迟」是**错的** |
| **D4** | 本提案是 **BR-3 接口前置** ⇒ 但按 **Grants 模型**冻结；冻结期间 BR-3 **不得自定义并行字段** | 与 #1142 / #1143 的先后由 CTO 定 |

### 附：v2 时期的待决表（**已被上方最终裁定覆盖**，留档不删）

## 三（附）、v2 待决表 —— 历史留档

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

---

## 七、v3 改动清单（**CTO §二 指定的四处 + §一 裁定**，逐条可核）

| # | CTO 要求（§二） | 本版落地 | 位置 |
|---|---|---|---|
| ① | **不冻"五档"** ⇒ 冻 `PermissionId[]` 类型 + 授权来源（文件驱动）+ `role → permissions` **可配映射** | 新增 `PermissionId` 类型 + `permissions` 字段；`role` **降格为默认包选择器**；新增 **§2.6 授权来源表** | §2.1 · §2.6 · 抬头 v3 横幅 |
| ② | `departmentId`（单数） ⇒ **`departmentIds: string[]`** | 单数字段**已删**；改复数；语义写明 **`[]` = 无部门，不是"全部"**（I3） | §2.1 · §2.4 · §三 D1 |
| ③ | 接口须含 **`resolveContext(identity) → { orgId, departmentIds, permissions[] }`** | 新增 **§2.2**（契约 JSDoc 三件套 + "授权判定只许读这三样"）；`extractRbacContext` 降为**薄壳** | §2.2 |
| ④ | **不冻实现** ⇒ 只冻**契约形状**（类型 + 签名 + 授权来源），分批实现 | §2.1 标题改为「冻结的是**契约形状**」；§2.5 迁移表保留分阶段 | §2.1 · §2.5 |

**§一 裁定落地**：D1 复数+文件驱动+读法甲 · D2 `''`+fail-closed+改坏即红夹具 · D3 DevMode 收窄且**两姿态各跑一次** · D4 Grants 下作 BR-3 前置。四条已写入 §三 **最终口径**表；v2 旧表留档（§三（附）），不删。

**§三 K11 归位**：本件 ≡ **RB-01 [#1140]** + **RB-02 [#1141]**（父 [#1139]），相邻 [#1142] [#1143]。已在抬头标注。

### 🔴 本版**主动标注**的两处 provenance（防转抄）

1. 「`src/` 里 `teamId`/`department` 散落 **428 处 / 74 文件**」= **CTO 实测**，**本版未复跑**。
2. §1.2 的四姿态结论 = 独立复核员真 HTTP 实测 + 产品线，**本版仍未复跑**（见 §四 风险 6）。

### 未做（如实列）

- **未改任何代码**（本件是提案）。
- §2.5 迁移表 P1–P4 的**卡号**仍写的是旧编号（P3 指 #1051、P4 指 §四③）；**未重编为 #1140–#1143** —— 因为 P1–P4 的**切分**是否与 RB-01~04 一一对应**应由 CTO 定**，我不代劳。

---

## 八、§2.x · DSH 蓝本映射（CTO 裁决令 §一 · 创始人点名"要写细，一点不能跑偏"）

> 🔴 **换轴一句话**：DSH 的旋钮回答「**这一个 agent 自己能干什么**」（沙箱/审批）；
> 我们的旋钮要回答「**这家企业的谁能看什么、能做什么**」（角色/部门/租户）。
> ⇒ **结构照抄**（策略与执行分离 + 单点解析 + 盖章到调用）；**语义换轴** ——
> 否则会把 agent 沙箱旋钮照到多租户上（**两个不同的轴**）。
> 🔴 **换轴点 = 数据边界是「集合」不是「枚举」＋ 多一个 `version`**（§8.4）。

### 8.1 五处映射（逐条对）

| DSH（源码已核） | 我们的对应物 | **不许照抄的地方** |
|---|---|---|
| `dsh-permission-presets`：只管选择与默认 —— `lib/index.js:9-15`「A switch records the selected preset, then **writes changed knobs through their canonical setters**」；`:71` 默认是「**default for future sessions**」 | **岗位包**（例：市场总监·标准 / 市场总监·可读财务） | DSH 预设是**用户自己选**；我们的岗位包是**客户管理员配**（配给自己员工，不是员工自选） |
| `dsh-sandbox-policy`：单一入口 `ctx.sandboxPolicy.resolve()`，`lib/index.js:15-16`「**stamps the mode together with the calling session's workspace root onto each**〔capability call〕」 | **`resolveContext(identity)`**（已写进 §2.2） | DSH 盖「模式 + 工作区根」；我们盖「**orgId + departmentIds + permissions + `version`**」 |
| `sandbox-mode`（read-only / workspace-write / danger-full-access）**三档枚举** | **数据边界**：`orgId` + `departmentIds` | 🔴 **不是三档** —— 我们的边界是**集合**（多租户 + 多部门） |
| `dsh-user-approval`：`lib/index.js:25-26`「Service Definition for the **approval capability seam**, covering requests, cancellation, audit, and per-session policy. **Missing answerers fail closed; grants apply only to the requested action.**」 | **动作边界**：`permissions`（`PermissionId[]`） | 🔴 DSH 审批是**运行时问人**；我们的 grants 是**事前配置** ⇒ **两者都要**（RB-05 见 §8.5） |
| `effective = fold(events) ?? the deployment default`（**事件折叠 + 部署默认，无外部配置存储**） | **文件驱动 + 可配**（创始人第 ⑤ 条） | 🔴 我们**要有外部真源**（文件），因为客户管理员要改 ⇒ **折叠加文件**（不是纯事件） |

### 8.2 三条不变量（**照抄，并标出处** —— 不许只说"我们要求"）

| # | DSH 原文出处 | 我们的判据 |
|---|---|---|
| ① | `dsh-user-approval/lib/index.js:26`「**Missing answerers fail closed**」 | `resolveContext` 拿不到 identity / 拿不到 `orgId` ⇒ **拒**（不是放行）—— 对应 **D2（`''` + I2 fail-closed）** |
| ② | 同句「**grants apply only to the requested action**」 | 人在环的"允许"**只对该一个动作有效**，下一动作**重新问**（RB-05） |
| ③ | 「two sessions can never see each other's state」（**本版未回溯到具体 file:line，见 §8.6 待办**） | 两个 `orgId` / 两个 `departmentIds` 的上下文**绝不互见** —— 这正是 **RB-01** 的 DSH 出处 |

### 8.3 🔴 我们比 DSH 多的一样（**换轴的关键，不许漏**）

DSH `resolve()` 盖的章是「mode + workspace root」—— **两个字段，都不会变**。
**我们的章必须多一个 `version`**：
- 理由：客户的权限配置**会变**（管理员今天给市场总监开了财务、明天关了）
- ⇒ 若盖章**不带 `version`** ⇒ **一次决策用了哪版权限，事后无法追溯**
- ⇒ 而我们的产品要求**审计可归属**（RB-01 / 本件 §2.2 的血缘）

⇒ **冻结件的 `resolveContext` 输出 = `{ orgId, departmentIds, permissions[], version }`**
⇒ 🔴 **验收须有**：「**改了权限之后，旧决策的审计仍指向旧 version**」的判据。

### 8.4 结论（写进 K11 冻结件的一句话）

**结构照抄、语义换轴。换轴点 = 数据边界是「集合」不是「枚举」＋ 多一个 `version` 字段。**

### 8.5 RB-05（人在环）引本节

RB-05 是 §8.2 ①② 的实现，前置 **RB-03**（"批准什么"要落到具体动作）。
🔴 **不照抄的一点**：DSH 的审批人 = 用户本人；**我们的审批人分两层** ——
**客户侧**（客户员工被要求批准某动作）审批人**必须是客户方的人**（CTO **不得**代客户批准：越权 + 污染审计）；
**我们侧**（派单/合并/门禁语义变更）审批人 = CTO，**且排在客户侧之后**（属内部治理效率，非客户交付面）。

### 8.6 本节的 provenance 与待办（如实标）

- 「428 处 / 74 文件」= **CTO 实测，as_of main@`707dd946b`**，**本版未复跑**。
- §1.2 四姿态 = 独立复核员真 HTTP 实测，**本版未复跑**。
- 🔴 **待办**：§8.2 ③ 的原文出处**未回溯到 file:line**（本版只拿到转述）⇒ 引它之前须先在
  `dsh-user-approval` / `dsh-sandbox-policy` 里 grep 到原句，**否则不得标注出处**。

### 8.7 🔴 包名勘误（**双向**，两边都错过）

| 说法 | 事实（`ls` + `package.json` 实测） |
|---|---|
| ❌ CTO 裁决令称「`dsh-authorization` **不存在**，真包是 `dsh-user-approval`」 | **两包都存在**：<br>`dsh-authorization` = 「Authorization seam (`ctx.authorization`): plugin-owned flows that **obtain a credential** through a conversation with the human」<br>`dsh-user-approval` = 「User-approval seam (`ctx.approval`): **one-shot permission decisions** dispatched to composed answerers over the approval/request waterfall, **fail-closed by default**」 |
| ❌ 产品线 v1 把 `dsh-authorization` 放进「人在环**审批**」一格 | **不精确**：它是**凭据获取**（sign-in / code entry / question，三态 `authorized`/`cancelled`/error），**不是审批** |

⇒ **两边各对一半**：CTO 的**归属**正确（审批不变量出自 `dsh-user-approval`，已回溯到
`dsh-user-approval/lib/index.js:25-26` 与 `lib/types/index.js:2`）；CTO 的**存在性判断**错误（`dsh-authorization` 存在）。
⇒ 本件**已按正确归属改写**（§8.1 第 4 行）**并保留两包的区别**（审批 ≠ 凭据获取）。

---

## 九、引用三元组补正（CTO 纪律 §一 · 2026-10-05）

> **纪律**：引用必须回查，且必须写**三元组** —— **① 版本/ref ② 绝对路径 ③ 取数时刻**。
> **缺任一项 ⇒ 该引用不得进入判据 / 冻结件 / 结论。**
> 起因：CTO 与产品线就 `dsh-authorization` 存在与否**各执一词且都对** —— 因为**量的不是同一份 DSH**（缺①）。

### 9.1 本件所有 DSH 引用的三元组（一次写全，覆盖 §8 全部引用）

| 项 | 值 |
|---|---|
| **① 版本/ref** | `deepseek-harness-pkg` **`0.1.6-alpha.1`**（读自该树 `package.json` 的 `version`） |
| **② 绝对路径** | `/Users/wane/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/node_modules/@deepseek-ai/` |
| **③ 取数时刻** | **2026-10-05T17:21:00Z** |

🔴 **版本冲突的事实（必须在件里留档，否则下一个人继续踩）**：工作机上有**三棵 DSH 树**，权限族包数与内容不同：

| 树 | 版本 | 权限族包数 | `dsh-authorization` | `dsh-client-ui-approval` |
|---|---|---|---|---|
| app-support `dependencies/dsh`（**本件引用源**） | **`0.1.6-alpha.1`** | **12** | ✅ 有 | ✅ 有 |
| `~/.dsh-pre-upgrade-015rc1-…/dsh-0.1.2-install` | `0.1.2` | 12 | ✅ 有 | ✅ 有 |
| CTO 所测「当前安装」 | `0.2.0-rc.2` | 11 | ❌ **无** | — |

⇒ **"`dsh-authorization` 是否存在"没有唯一答案，只有"哪棵树"的答案。**
⇒ 本件全部结论**只对上面 ① 那棵树成立**；换树须重跑（§9.4 给命令）。

### 9.2 §8.2 ③ 的出处**已回溯**（原标注"未回溯到 file:line"作废 —— 见 §9.3 更正）

| 项 | 值 |
|---|---|
| **真包** | `dsh-sandbox-policy`（**不是** `dsh-user-approval` —— 产品线原先搜错了包） |
| **原句** | 「survives restart by replay, **two sessions can never see each other's state**」 |
| **file:line** | `dsh-sandbox-policy/lib/index.js:11` · `lib/types/session-mode.d.ts:6` · `lib/invariant.js:7` · `README.md:54,76`（四份逐字一致） |
| **两版都有?** | ✅ **0.1.6-alpha.1 与 0.1.2 都存在** ⇒ **CTO 假设的"旧版有新版无"不成立**；我上一版回溯不到的真原因是**搜错了包**（我把它归在审批包名下搜） |

🔴 **语义边界（不许照抄的地方，这正好是"换轴"的又一例）**：该句的语境是 **sandbox 会话模式隔离**
（「each session keeps its own mode」）——**不是多租户权限隔离**。
⇒ 我们引它只取**机制**（"每会话自持解析结果、互不串"）；**语义换成 orgId/departmentIds**。
⇒ **不得**写成"DSH 规定租户隔离"。

### 9.3 更正（本节点名作废 §8.2③ 的原标注）

- §8.2 ③ 原写「**本版未回溯到具体 file:line，见 §8.6 待办**」⇒ 🔴 **已回溯，该标注作废**，正确出处见 §9.2。
- §8.6 待办第 3 条（"引它之前须先 grep 到原句"）⇒ **已执行**，可关闭。
- **§8.6 保留的待办**：「428 处/74 文件」与「四姿态」两处 **provenance 标注**仍有效（那两条是**别人**的实测，本版仍未复跑）。

### 9.4 换树重跑的命令（下一个人别凭印象）

```bash
D="<你要引的那棵 DSH 树>/dsh"
python3 -c "import json;print(json.load(open('$D/package.json'))['version'])"   # ① 版本
ls "$D/node_modules/@deepseek-ai" | grep -E "permission|sandbox|approval|authorization"  # ② 包清单
date -u +%Y-%m-%dT%H:%M:%SZ                                                     # ③ 取数时刻
```
