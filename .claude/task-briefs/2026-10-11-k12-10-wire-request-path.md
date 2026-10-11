#CRITERIA: D

# K12-10-WIRE — 请求路径接入部门身份（`auth.ts` `runWithContext` 收口）

> 卡号：K12-10-WIRE ｜ 上游：K12-10（#193，已合入 local-main `68bf57598`）
> 授权：创始人 2026-10-11 逐字放行「② B2 请求路径接线卡（新立）—— 动 `auth.ts:599 runWithContext`」
> 🔴 **与 K12-09 同函数，须串行**：`evaluateCrossOrgAccess`（`:384`，调用点 `:482`/`:512`/`:587`）
> 与 `runWithContext`（`:599`）**同在 `jwtAuthMiddleware` 函数体内且相邻** ⇒ 本卡与 K12-09 任何后续改动**串行**，禁止并行同函数。
> 🔴 **本卡必须 rebase 到最新 `gitea/local-main`**（实测 BASE＝`68bf57598`）。

---

## 坐标系

```
总闸: 不适用
承重件: 不适用
批次: 第0批-止血
命名空间: 不适用
执行态: 未开工
验证级别: L2-真跑通
阻塞源: 无阻塞
```

---

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
本卡在【K12 企业级一致性】的**知识/权限一致性**支线上，直接补 **RB-02 部门轴**的**请求面接线缺口**。

实测现状（命令原始输出，本卡开工时重跑）：

```
$ git grep -n "runWithContext" gitea/local-main -- src/middleware/auth.ts
18:import { runWithContext } from '../services/request-context';
596:    // 同步注入 request-context（兼容 runWithContext 模式）
599:      runWithContext({
638:        log.warn({ err: ctxErr }, 'request-context runWithContext error, continuing with req.auth');
```

```
$ git grep -n "resolveContext" gitea/local-main -- src/
src/deploy/content-registry.ts:461:      init: 'resolveContext',
src/services/request-context.ts:299:export async function resolveContext(input: IdentityInput = {}): Promise<ResolvedContext> {
```

⇒ **缺口定性（上一卡遗留，非缺陷）**：`resolveContext` 的真触发点**只有 boot**
（`server.ts` → `bootstrap.ts` Phase 3b → `initContentTypes()`），**不在请求路径**
⇒ 部门轴在生产上**只在启动时被验证、不在请求时被使用**：
`runWithContext` 只塞 `user` ＋ `authProvider`，**不塞 `resolved`**
⇒ 请求内 `getCurrentDepartmentIds()` 恒返 `[]`。

**基线实测（本卡开工时真跑，非推断）**：

```
$ npx vitest run tests/_probe/baseline-probe.test.ts     # 真 express + 真中间件 + 真 HTTP
BASELINE-RESULT: {"userSeen":"u-baseline","depts":[]}
```

读法：`userSeen` 非空 ⇒ **请求上下文本身是通的**（`runWithContext(async () => next())` 能透传到下游，
AsyncLocalStorage 在 `fn()` 同步帧内建的续延链**确实**携带存储 —— 这一条与直觉相反，故实测）；
`depts: []` ⇒ **部门轴未进请求路径**，缺口成立。

### b) 文件审计
grep `departmentIds|departmentId|departments` 全仓：
- `src/services/request-context.ts` — 部门轴**解析侧**（K12-10 已交付：`resolveContext` / `IdentityInput` / `ResolvedContext` / `getCurrentDepartmentIds`）
- `src/deploy/content-registry.ts:441` — **boot 触发点**（`initArgs: [{ departmentIds: [] }]`），本卡**不动**
- `src/middleware/auth.ts:599` — **请求触发点，本卡接线处**（当前只传 `user` ＋ `authProvider`）
- `tests/security/department-axis.test.ts` — 解析侧判据（18 例），本卡**不动**
- `extensions/departments/*.yaml` — 部门定义真源（4 部门 ＋ manifest），本卡**不动**

### c) 决策
已有覆盖（解析侧）⇒ **复用**，零重写。请求侧无覆盖 ⇒ **接线**（唯一改动点 `auth.ts`）。
**冲突检查：无** —— 上一卡卡面明令「不改 `src/middleware/auth.ts`」，故本卡是该文件的**唯一写者**。

---

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

**决策参考系：第一性原理（身份可信度分层）＋ 本项目既有实证 D947。**

1. **部门身份从哪来？——只能是验签载荷，不能是请求头。**
   既有实证（`src/middleware/auth.ts` 模块头注释 `:461-462`）：
   > "P0 不变量：注入的只能是**验签身份**；任何自报值（header/query 里的 `role`/`userId`）永不进入 `req.auth` / `req.rbac`。"
   即：`x-org-id` 族头**只表达"我要访问哪个组织"**（`declaredOrgIdOf`），**不参与身份判定**
   ⇒ 部门身份若走未验签的请求头，就是**自报身份**，与 D947 的 P0 不变量直接冲突，且可被任意客户端伪造。
   **结论：部门身份取"受签名保护的 JWT 载荷"**（与 `role`/`orgId` 同信任级）。

2. **为什么必须 `await` 在 `runWithContext` 之外（不是风格问题，是机制问题）。**
   `runWithContext(ctx, fn)` ＝ `storage.run(ctx, fn)`；AsyncLocalStorage 的存储
   **沿 `fn()` 同步帧内新建的续延链传播**。
   `resolveContext` 是 **async**，若把 `resolveContext(identity)` 写在 `runWithContext` 的**入参对象字面量里**
   （即 `resolved: await resolveContext(...)`），该 Promise 的续延是在 `storage.run` 之外创建并已有的
   ⇒ **`await` 之后的那一帧已脱离存储** ⇒ 必须**先 await、后 run**。
   （与上文基线实测一致：`next()` 在 `fn` 同步帧内调用 ⇒ 续延在存储内 ⇒ 透传成功。）

3. **异步化边界。** 把 `jwtAuthMiddleware` 改为 `async` 后，`waitUntilCommit` 类错误必须收敛在
   既有 `try/catch`（`:452`/`:645`）内：**新增的 await 不得产生新的 500 路径**
   ⇒ 解析失败按**降级**处理（`log.warn` ＋ 空部门集，不抛、不阻断认证）。

4. **历史教训引用**：
   - 铁律 0-2 / 铁律 4 / 铁律 5 / 铁律 12：**"接线了"≠"被执行"**（4 次接线失败事故）⇒ 判据必须**穿真请求路径**，禁 grep 型。
   - 判例 V-02：grep 型不得作验收依据。
   - 铁律 24 / 31：降级**不静默** —— `resolveContext` 的 `degraded` / `degradedReasons` 必须被**真消费**（log.warn 携带 reason）。
   - 铁律 38：`as any` / `as never` / `as unknown as` 零容忍；边界收窄用类型守卫。
   - 铁律 47 / 48：新增导出/函数先写契约（JSDoc）；测试覆盖正常 ＋ 降级 ＋ 边界，每例真 `expect()`。

---

## Q2: 范围 — 正确的最简方案

做什么：
- src/middleware/auth.ts
- src/services/request-context.ts
- tests/security/department-request-path.test.ts
- tests/middleware/auth.test.ts
- .claude/task-briefs/2026-10-11-k12-10-wire-request-path.md

不做什么：
- 不改 `src/middleware/auth.ts` 的 `isWhitelisted()` — K12-03（#186）已合，含 `path === '/api/onboarding/start'` 判据
- 不改 `src/middleware/auth.ts` 的 `evaluateCrossOrgAccess` 及调用点 `:482` / `:512` / `:587` — K12-09 隔离判定归它，本卡零触碰
- 不改 `src/routes/self-ops.ts` — 路由面不属本卡写集
- 不改 `tests/security/department-axis.test.ts` — K12-10 解析侧判据（18 例），本卡不动
- 不改 `tests/security/cross-org-isolation.test.ts` — K12-09 判据，本卡以它**未被打红**为验收项
- 不改 `src/deploy/content-registry.ts` — boot 触发点，本卡不碰
- 不改 `scripts/audit/audit-ledger.py` — 审计域红线
- 不改 `scripts/control-tower/brief_parser.py` — 控制塔域，非本卡授权

### 改动逐件说明（why，非范围声明）

**① `src/services/request-context.ts`** — 加一处**边界归一**（"裸路径"守卫），why：
JWT 载荷是**外部输入**（`JSON.parse` 后即 `JwtPayload`），`departmentIds` 在运行时**可能是任意类型**
（人手造 token、旧客户端、将来别的签发方）。`IdentityInput.departmentIds` 声明为 `readonly string[]`，
而 `requestedDepartmentIds` 只在 `Array.isArray` 时遍历、逐元素再过 `optionalString`
⇒ **运行时安全**，但**类型系统看不见** ⇒ `auth.ts` 处会需要写断言。加守卫即可**零断言**接上，
且把"外部载荷不可信"这件事写在**一个**地方（单一入口纪律的延伸：归一也只在解析侧做）。

**② `src/middleware/auth.ts`** — 唯一接线点，两件事：
- `JwtPayload` 增**可选**字段 `departmentIds?: string[]`（签发端已在办：`signJwtToken` 的形参是
  `Omit<JwtPayload,'iat'|'jti'|'exp'>` 且实现是 `{...payload, ...}` ⇒ 声明即可透传，**改签名零行**）；
- `:599` 处：**先 await 解析、再 `runWithContext`**，把 `resolved` 塞进上下文；
  解析失败/降级 ⇒ `log.warn`（带 `degradedReasons`）＋ 空部门集，**不阻断认证**。

**③ `tests/security/department-request-path.test.ts`** — 新建判据（真 express ＋ 真中间件 ＋ 真 HTTP）。

**④ `tests/middleware/auth.test.ts`** — **一处**测试同步（非源改动），why：
`jwtAuthMiddleware` 由 `void` 改 `async` 后，**唯一**走到认证路径（`next()` 在 `await` 之后）
的用例「有效 JWT → 注入 auth + 调用 next」在同步读完 `nextCalled` 时读到 `false` ⇒ 必红。
处置 = 该用例改 `async` ＋ `await` 中间件返回的 promise（express 本身丢弃该 promise，
生产行为不变）；注释写明改动原因。**其余 33 例零改动**（多为 401/白名单路径，不经过该 await）。

附：`src/services/request-context.ts` 若有**新导出**方可被 `src/` 消费（组 4）——本卡不新增导出
（`resolveContext` 已存在且已被 `content-registry.ts` 真消费）⇒ **组 4 不适用**。

---

## Q3: 验收 — 入口 → 交互 → 结果

**入口**：真 HTTP 请求，`Authorization: Bearer <JWT，载荷含受签名保护的 departmentIds>`
→ 真 express app → 真 `jwtAuthMiddleware`（生产挂载顺序）
**处理**：验签 →（K12-09 隔离判定，本卡零触碰）→ `await resolveContext(identity)`
→ 结果经 `runWithContext` 进请求级存储（`resolved`）
**结果**：**在该请求上下文内**下游 `getCurrentDepartmentIds()` 拿到部门 id（非空且等于载荷声明 ∩ 真源已知）

**判据（每条含"改坏即红"）**：

| # | 判据 | 手法（**禁词法扫描**） |
|---|---|---|
| **V1** | **请求路径真带部门身份** | 真 HTTP ⇒ 断言**该请求上下文内** `getCurrentDepartmentIds()` 非空且＝预期集合 |
| **V2** | **复数并集**（一人 2 部门） | 载荷 2 部门 ⇒ 断言两部门**都在**（非覆盖/非首个） |
| **V3** | **失败路径：未验证载荷不入身份** | 头里自报部门（无签名覆盖）⇒ 断言**不被采纳**（仍为空集）——防"从头取部门"的错实现 |
| **V4** | **降级不静默** | 真源不可用 ⇒ `degraded:true` 被**真消费**（log.warn 含 reason）＋ 部门集为空 ＋ **请求仍 200 不阻断** |
| **V5** | **`exp` 边界**（边界条件，铁律 48） | 已过期 token ⇒ 401 且**不进入**上下文（`next()` 零调用） |
| **V6** | **改坏即红（每条反例留原始输出＋具体失败点）** | 摘掉接线 ⇒ V1/V2 **必红**；改回 ⇒ 全绿 |

**反例（必须逐条留「改坏后确实红」的原始输出，含具体失败点，不是笼统 exit 1）**：
- **R1 摘掉接线**：`runWithContext({user, authProvider})` 去掉 `resolved` ⇒ V1 **必红**（`depts` 回到 `[]`）
- **R2 覆盖型实现**：`resolved: { ...r, departments: [r.departments[0]] }`（只留首个）⇒ V2 **必红**
- **R3 从头取部门**：改成从 `req.headers['x-department-ids']` 取 ⇒ V3 **必红**
- **R4 降级静默**：吞掉 `degraded`（不 log、不区分）⇒ V4 **必红**
- **🔴 R1-R4 必须给出「改坏后确实红」的原始输出且含具体失败点** ——
  反例第一次跑就 PASS ⇒ 可能是**永远绿的假反例**（实证教训：K12-10 探针初版观测窗口有 bug，
  覆盖型实现照样"看起来像并集" ⇒ 假绿，是反例实测逼出真 bug）。

**可复跑验收命令**逐条登记在下文 `## Done 标准` 段（本段只定判据语义，不重复列命令）。

**⚠️ 判定失败的期望形态（供复核者核对，非笼统 exit 1）**：
V1/V2 的失败点必须是 `getCurrentDepartmentIds()` 实测值与预期集合的**逐元素差异**；
V3 的失败点必须是"自报头被采纳"的那次断言，不是 4xx/5xx 状态码。

---

## 架构层: ⓪-b 连接器（人侧 · 身份输入）＋ K12 企业级一致性（权限）
代码层：**L1**（`src/middleware/**` 请求入口 ＋ `src/routes/**` 消费面）＋ **L1/L2 侧服务**（`src/services/request-context.ts`）。
依赖方向：`middleware → services`（同层/向下），**无跨层 import**，不触 L3/L4/L5。

## 写集
- src/middleware/auth.ts — 接线（`JwtPayload.departmentIds` 可选字段 ＋ `:599` 先 await 解析再 `runWithContext` 注入 `resolved`）
- src/services/request-context.ts — 边界归一（`departmentIds` 运行时类型守卫 ⇒ 调用点零断言）
- tests/security/department-request-path.test.ts — 新建判据测试（真 express ＋ 真中间件 ＋ 真 HTTP，V1-V5）
- tests/middleware/auth.test.ts — 一处测试同步（async 化后 `next()` 延后 ⇒ 该用例 await 中间件 promise）
- .claude/task-briefs/2026-10-11-k12-10-wire-request-path.md — 本件（卡面）

**越界声明：无。** `src/middleware/auth.ts` 本卡是**唯一写者**（上一卡卡面明令不改该文件）。
`tests/middleware/auth.test.ts` 属**接口变更的连带测试同步**（`void` → `async`），只动 1 例，
且已按组 12 要求登记进 Q2 写集（未登记会被判"不在 Q2 范围内"硬阻断）。
**与 K12-09 的串行约束（硬）**：`evaluateCrossOrgAccess`（`:384`）与 `runWithContext`（`:599`）
同在 `jwtAuthMiddleware` 函数体内且相邻（`:587` vs `:599`）⇒ 任何 K12-09 后续改动**必须与本卡串行**，
不得并行改同一函数。

**不在本写集**（防误认领）：`src/routes/**`（K12-09/K12-19 面）｜`src/deploy/content-registry.ts`（K12-10 boot 面）｜
`tests/security/department-axis.test.ts`（K12-10 解析侧判据）｜`tests/security/cross-org-isolation.test.ts`（K12-09 判据）｜
`scripts/control-tower/probe-department-axis.ts`（K12-10 测量件）｜`scripts/control-tower/probe-ladder.ts`（K12-21 #205）。

## Done 标准
- [ ] verify: `npx vitest run tests/security/department-request-path.test.ts`（expectExit 0；V1-V5 全绿）
- [ ] verify: `npx vitest run tests/security`（expectExit 0；**含** `cross-org-isolation.test.ts` 与 `department-axis.test.ts` ⇒ 与 K12-09 未互相打红）
- [ ] verify: `npx vitest run tests/middleware/onboarding-whitelist.test.ts`（expectExit 0；K12-03 未被打红）
- [ ] verify: `npx tsc --noEmit`（**零新增**：与 BASE 逐行对比，错误行数不得增加）
- [ ] verify: `bash scripts/pre-commit-check.sh`（expectExit 0）
- [ ] 反例（改坏必红）：R1-R4 逐条留原始输出（含具体失败点）＋ 改回后全绿

