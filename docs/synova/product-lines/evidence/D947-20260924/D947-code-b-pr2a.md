# D947 · code-b · PR-2a 实施证据（P4 前移 + P7 零自欺 + P6 夹具）

> **任务**：`task-6`（owner `code-b`）· **阶段**：PR-2a 实施（CTO 执行序第 4 步）
> **工作树**：`D:\novis-backup-20260526\Novis\synova-agent\.synova-wt-d947-middleware`
> **分支**：`feat/d947-middleware-default-posture`
> **HEAD（开工时）**：`db54b926`（= PR-1 commit A `77e0d6aa` + post-commit 钩子登记提交）
> **栈式 base 声明**：本机无推送凭据 ⇒ PR-2 base 只能声明为 **PR-1 commit SHA `77e0d6aa`**（队长 L-23 已登记）
> **与 origin/main 同步回执**：`git rev-list --left-right --count origin/main...HEAD` → `13	2`
> （main 前进 13 commit = PR #740 B5 task-state backfill；已核这 13 commit 对 `src/server.ts` /
> `tests/routes/middleware-order.test.ts` / `src/middleware/**` **零改动** ⇒ 无冲突风险。登记见 L-23。）
> **本任务写集（2 文件）**：`src/server.ts` · `tests/routes/middleware-order.test.ts`（新建）
> **结论形态**：**自验结论 / 可提请独立审计**——本文**不判「通过」**（判定权在 CTO 收件闸 + K3 终审）。

**口径声明**：本文所有数字来自命令原始输出；`[[共 N 处]]` / 计数由脚本 `wc -l` 自动产生，非手写。
原始输出**不截断**（`head` 未使用）；引用的完整日志另附行数 / 字节数 / sha256。

---

## A. A/B/C 三件落地（file:line 改前 / 改后）

### A-1 P4 中间件前移 —— `src/server.ts`

| | 内容 |
|---|---|
| **改前** | `:373  app.use(rbacMiddleware);`（位于 `app.use(knowledgeAskRoutes);` 与 `app.use(deptWorkspaceRoutes);` 之间，即 **`workspacesApiRoutes` 之后**） |
| **改后** | `:366  app.use(rbacMiddleware);`（位于内联 `app.get('/api/status/budget', …)` 块 `:355-365` **之后**、`app.use(homeRoutes);` **之前**） |

改动方式：删除原 `:373` 那一行，并在 `app.use(homeRoutes);` 之前插入**同一字面量** + 10 行 provenance 注释
（注释在 `rbac` 行之后，不改变 `L`）。落点实测：

```
$ grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1
366
$ grep -nE 'app\.use\((jwtAuthMiddleware|rateLimitMiddleware|homeRoutes)\)' src/server.ts
344:  app.use(jwtAuthMiddleware);
352:  app.use(rateLimitMiddleware);
376:  app.use(homeRoutes);
```

⇒ **L = 366 ∈ [357,366]**（L-2 冻结区间）；**I4 成立**（jwtAuth@344 < rbac@366）；rateLimit@352 < rbac；
rbac@366 < homeRoutes@376；rbac 亦 < `workspacesApiRoutes`（P3 取 `req.rbac` 的物理前提）。
**未新增第二份白名单**；`rbacMiddleware` 本体语义未动（保持「仅注入 `req.rbac` + `next()`」）。

### A-2 P7 装配侧零自欺 —— `src/server.ts`

| | 内容 |
|---|---|
| **改前（`:247-249`）** | `const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } });`<br>`void canAccessWorkspace(rbacCtx, { visibility: 'global' });`<br>`void canModifyWorkspace(rbacCtx, { visibility: 'global' });` |
| **改后** | 三行**整段删除**，替换为 2 行 provenance 注释（见 C 节 L-15 登记） |

`:244-246`（`buildInheritedContext` / `detectConflicts`）**未动**（L-3）。

### A-3 收窄 import —— `src/server.ts:19`

| | 内容 |
|---|---|
| **改前** | `import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';` |
| **改后** | `import { rbacMiddleware } from './middleware/rbac'; // D947: 仅保留中间件；装配期空调用已删（见 244 区注释）` |

### A-4 完整 diff（`git diff -- src/server.ts`，不截断）

> 注：紧随其后的**原始输出块**是脚本一次性产出的逐字命令回执，内含脚本内的分区标记
> `════ B-1/B-2/B-3/B-4`（= 本文件 **B 节 判据实测**：rbac 落点 L、I4 邻居行号、P4 冻结谓词、零 `void`／零字面量）
> 与 `════ C`（= 本文件 **C 节 注释措辞改写落地现场**）与 `════ H/I`（= 最终工作树与快照指纹，对应本文件 **H/I 节** 叙述）。
> 这些标记是**脚本原始输出的字样**，为保原样未重命名；与下文编号一一对应。

```
════════════════ A-4  src/server.ts 完整 diff（git diff，不截断）════════════════
$ git diff -- src/server.ts
diff --git a/src/server.ts b/src/server.ts
index 2fcf2a2a..5ece78c2 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -16,7 +16,7 @@ import { initFileDrivenLoaders } from './init/file-driven-loaders'; // v3.6 Batc
 import { ToolRegistry } from './agent/tools';
 import { KnowledgeInjector, KnowledgeConflictHandler, AtomicWriter } from './agent/index';
 import { BossMailbox } from './agent/boss-mailbox';
-import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
+import { rbacMiddleware } from './middleware/rbac'; // D947: 仅保留中间件；装配期空调用已删（见 244 区注释）
 import { jwtAuthMiddleware } from './middleware/auth';
 import authRoutes from './routes/auth';
 import { buildInheritedContext, detectConflicts } from './agent/workspace-service';
@@ -244,9 +244,8 @@ export async function createServer(): Promise<Server> {
   // PRD v1.6 Slice 7: workspace-service 接线
   buildInheritedContext({ parentId: 'init', department: 'dept', title: 'init', source: 'boss_assigned', parentSummary: 'init' });
   detectConflicts([]); // Slice 7 冲突检测初始化
-  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
-  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
-  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
+  // D947/P7: 装配期 RBAC「自欺块」（原 :247-249 —— 硬编码管理员身份字面量 + 两处 `void` 丢弃判定结果）已删除；
+  // 真实责任在 rbacMiddleware 注入 req.rbac（下方路由区）+ 路由级守卫消费 req.rbac（P3）。
 
   const app = express();
 
@@ -363,6 +362,17 @@ export async function createServer(): Promise<Server> {
       res.status(500).json({ ok: false, error: msg, degraded: true });
     }
   });
+  // D947/P4: RBAC 注入点前移（原 :373 → 此处；仍晚于 jwtAuthMiddleware 与 rateLimitMiddleware）
+  app.use(rbacMiddleware);
+  // ── D947/P4 前移理由与不变量（供 K3 核对）─────────────────────────────
+  // ① 前移前 rbac 位于 workspacesApiRoutes 之后 ⇒ 该路由组永远拿不到 req.rbac ⇒ 路由级守卫必然 fail-closed。
+  // ② 前移后本行之前仅剩 5 个路由注册（豁免集，均有既有文档依据）：
+  //    setupGuideGoneRouter(D716 410) · llmConfigRoutes(D575 首启向导) · uploadV2GoneRouter(D590② 410) ·
+  //    authRoutes(登录入口) · 内联 GET /api/status/budget。判据 = P4 判别谓词（非 REV-6 字面 awk）。
+  // ③ 不变量 I4：rbac 不得早于 jwtAuthMiddleware —— 唯一可信来源是 req.auth（验签后注入）。
+  // ④ rbacMiddleware 本体语义不变（仅注入 req.rbac + next()，不做拦截）：/api/knowledge/ask(:372→本行后)、
+  //    /health 与 /api/healthz 均在本行之后，只有「不拦截」时其直达语义才成立；
+  //    拦截责任在路由级守卫（P3），本文件不新增第二份白名单（auth.ts:82 唯一源）。
   app.use(homeRoutes);
   app.use(chatRoutes);
   app.use(workspaceRoutes);
@@ -370,7 +380,6 @@ export async function createServer(): Promise<Server> {
   app.use(workspacesApiRoutes);
   app.use(gaDiagnosisRoutes);
   app.use(knowledgeAskRoutes);
-  app.use(rbacMiddleware);
   app.use(deptWorkspaceRoutes);
   app.use(actionsApiRoutes);
   app.use(dataRoutes);
[exit=0]

════════════════ B-1  rbac 落点 L（L-2 判据）════════════════
$ grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1
366
[exit=0]   ← 须落在 [357,366]；若 <=356 谓词点数变 4 且拦死 /api/status/budget；若 >=367 homeRoutes 落到 rbac 之前

════════════════ B-2  I4 不变量与相邻挂载行号 ════════════════
$ grep -nE 'app\.use\((jwtAuthMiddleware|rateLimitMiddleware|homeRoutes|workspacesApiRoutes)\)' src/server.ts
344:  app.use(jwtAuthMiddleware);
352:  app.use(rateLimitMiddleware);
376:  app.use(homeRoutes);
380:  app.use(workspacesApiRoutes);
[exit=0]

════════════════ B-3  P4 冻结谓词（前移后须 = 5 处）════════════════
PAT=app\.use\([A-Za-z0-9_]+(Router|Routes)\)|app\.(get|post|put|patch|delete)\(
$ grep -nE "$PAT" src/server.ts | grep -v 'res.redirect' | awk -F: -v L=$(grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1) '$1<L {print $1": "$0}'
322: 322:  app.use(setupGuideGoneRouter);
340: 340:  app.use(llmConfigRoutes);
343: 343:  app.use(uploadV2GoneRouter);
347: 347:  app.use(authRoutes);
355: 355:  app.get('/api/status/budget', (req, res) => {
[exit=0]
共 5 处

════════════════ B-4  P6 零自欺判据 ════════════════
$ grep -nE 'void +(canAccessWorkspace|canModifyWorkspace)' src/server.ts
[exit=1]  （exit=1 = 零命中）

$ grep -rn "'admin::dev'" src/
[exit=1]  （exit=1 = 零命中）

$ sed -n '19p' src/server.ts   （import 收窄）
import { rbacMiddleware } from './middleware/rbac'; // D947: 仅保留中间件；装配期空调用已删（见 244 区注释）

════════════════ C  注释措辞改写（L-15 先例）落地现场 ════════════════
$ sed -n '244,248p' src/server.ts
  // PRD v1.6 Slice 7: workspace-service 接线
  buildInheritedContext({ parentId: 'init', department: 'dept', title: 'init', source: 'boss_assigned', parentSummary: 'init' });
  detectConflicts([]); // Slice 7 冲突检测初始化
  // D947/P7: 装配期 RBAC「自欺块」（原 :247-249 —— 硬编码管理员身份字面量 + 两处 `void` 丢弃判定结果）已删除；
  // 真实责任在 rbacMiddleware 注入 req.rbac（下方路由区）+ 路由级守卫消费 req.rbac（P3）。

════════════════ H  最终工作树状态（PR-2 文件集合）════════════════
$ git status --porcelain
 M src/routes/department-workspace.ts
 M src/routes/documents.ts
 M src/routes/workspaces-api.ts
 M src/server.ts
 M src/services/request-context.ts
 M tests/routes/department-workspace.test.ts
 M tests/routes/overflow.test.ts
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
?? tests/routes/middleware-order.test.ts
?? tests/routes/workspace-access-write-endpoint.test.ts
[exit=0]

$ git diff --stat
 src/routes/department-workspace.ts        |  22 +++++-
 src/routes/documents.ts                   |  17 +++-
 src/routes/workspaces-api.ts              | 125 +++++++++++++++++++++++++++---
 src/server.ts                             |  19 +++--
 src/services/request-context.ts           |  48 +++++++++++-
 tests/routes/department-workspace.test.ts | 105 ++++++++++++++++++++-----
 tests/routes/overflow.test.ts             |  18 ++++-
 7 files changed, 308 insertions(+), 46 deletions(-)

$ git diff --stat -- src/server.ts tests/routes/middleware-order.test.ts
 src/server.ts | 19 ++++++++++++++-----
 1 file changed, 14 insertions(+), 5 deletions(-)

$ git rev-parse --short HEAD
db54b926

════════════════ I  快照指纹（变异体还原锚点）════════════════
$ sha256sum src/server.ts
62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784 *src/server.ts
$ wc -l < src/server.ts
529
```

---

## D. 前提失效上报（卡面「无凭据 `GET /api/workspaces/mine` → 403」）与队长裁定 L-22

卡面 D 与 REV-6 均写「无凭据打 `GET /api/workspaces/mine` → **403**」。开工前实测（前提冻结纪律）**不成立**，
按「实测不成立 → 停、报队长」上报，**未自行改判据**。两条独立证据：

**证据 1（读码）**：`src/routes/workspaces-api.ts:176-192` 的 `GET /api/workspaces/mine` **全函数无任何 403 分支**
——它只读自报头（PR-1 已退役的通道）后恒 `res.json({ ok: true, workspaces, role, department })`（**200**）。

**证据 2（链路推演，`src/middleware/auth.ts` 逐行）**：该路径**不在白名单**（`auth.ts:103-133`），
故走 `jwtAuthMiddleware` 非白名单分支：

| 配置 | 结果 | 依据 |
|---|---|---|
| `DEV_MODE=false` + 无 Authorization | **401** | `auth.ts:369-379`（HTTP 401，fail-closed） |
| `DEV_MODE=true` 且无 JWT_SECRET | **200** | `auth.ts:350-364` devMode 自动 admin → 到达路由 |
| `DEV_MODE=true` 且 JWT_SECRET 已设 | **401** | `auth.ts:350` 要求 `!secret`，不成立 |

⇒ **三种配置都拿不到 403**。而 N1 硬前置（JWT_SECRET ≥16 + `DEV_MODE=false`）恰好把夹具钉在第一种
⇒ 实测值为 **401**。403 只可能出现在**路由级守卫**（P3 写端点），该 GET 读端点不在 P3 清单内。

**队长裁定 L-22 = 采纳 (A)**：探针**保留**、期望值改 **401**、行内注明偏离原因；
**禁用** (B)「∈{401,403}」（判别力更弱）；403 断言**由 P3 写端点承担**（不得取消）；
P4 判别性仍归**正路径**（L-5）；此口径修正作为**待 CTO 追认项**与 L-18/L-20 并列写进回执，**不静默**。
夹具已按 (A) 落地（见 E-3、F 节原始输出）。

### D-1 关联事实：`/api/workspaces/mine` 被 `/:id` 遮蔽（code-c 独立发现 F-1，我方已复核）

code-c（`D947-code-c-pr2b.md` F-1）指出该路径被参数路由遮蔽。**我方独立复核成立**：

```
$ grep -nE "^router\.get\('/api/workspaces" src/routes/workspaces-api.ts
92:router.get('/api/workspaces', …)
126:router.get('/api/workspaces/:id', …)        ← 先注册
255:router.get('/api/workspaces/by-dept/:dept', …)
264:router.get('/api/workspaces/mine', …)      ← 后注册，被 :126 先匹配（id='mine'）
294:router.get('/api/workspaces/conflicts', …)  ← 同型遮蔽
```

⇒ **带凭据**经 HTTP 打 `/mine` 会命中 `:id` 分支 → **404**（workspace not found），**不是 403**。
**但本夹具的探针不受影响**：本夹具断言的是**无凭据**情形，该请求在**进入路由之前**就被
`jwtAuthMiddleware` 以 **401** 拒绝（`auth.ts:369-379`）—— 遮蔽发生在路由匹配阶段，位于其**之后**。
两轮绿跑实测均为 **401**（F 节原始输出），与上表第一种配置一致 ⇒ **L-22(A) 的断言保留、无需改动**。
（此事实之所以记录：它解释「为何带凭据也拿不到 403」，与 D 节的 401 结论互补而非矛盾；
  该遮蔽不属本卡写集，已作为**未清项**交 CTO，见 I-1。）

---

## E. P6 夹具设计 —— 判据 → 用例映射

文件：`tests/routes/middleware-order.test.ts`（新建，**本卡唯一新文件**）。共 **12 个用例 / 12 个 `expect()`**（≥3 达标）。

| # | 用例 | 类型 | 判据落点 | 变异体下 |
|---|---|---|---|---|
| 1 | P4-1 rbac 之前的路由注册**恰好等于**豁免集 5 项 | 源码 | `registrationsBeforeRbac()` 逐行镜像冻结谓词（含 `grep -v res.redirect` 口径） | **红** ✅ |
| 2 | P4-2 计数恒为 5 | 源码 | 同上（显式 `toHaveLength(5)`，便于红时读数） | **红** ✅ |
| 3 | I4 顺序三重不等式 | 源码 | `indexOf` 比较（**无硬编码行号**）：jwtAuth / rateLimit < rbac < homeRoutes，且 rbac < workspacesApiRoutes | **红** ✅ |
| 4 | P6-1 关键判据函数零 `void` | 源码 | `not.toMatch(/void\s+(canAccessWorkspace|canModifyWorkspace)/)` | 绿（不受 A 影响） |
| 5 | P6-2 无硬编码身份字面量 | 源码 | `not.toContain("'admin::dev'")` | 绿 |
| 6 | P6-3 `middleware/rbac` import 已收窄 | 源码 | 正向 exact-match + 反向排除三符号 | 绿 |
| 7 | N1 有效性：无凭据 → 非白名单路径 **401** | 运行时 | `GET /api/workspaces/mine` → 401 + `code=UNAUTHORIZED`（**L-22(A)**） | 绿（判别力归用例 8） |
| 8 | **P4 判别性正路径**：合法 admin JWT → `POST /api/workspaces` → **200** + `owner==='d947-admin'` | 运行时 | `req.rbac` 被 P3 消费（L-4/L-5） | **红**（403） ✅ |
| 9 | 豁免回归 `/health` 非 401/403 | 运行时 | whitelist 直达 | 绿 |
| 10 | 豁免回归 `POST /api/auth/login` **400 VALIDATION_ERROR** | 运行时 | 强判据：401=被全局中间件拦死；400=路由真的执行 | 绿 |
| 11 | 豁免回归 `GET /api/status/budget` → 200 | 运行时 | rbac 之前的白名单内联路由 | 绿 |
| 12 | 豁免回归 `GET /api/knowledge/ask` 非 401/403 | 运行时 | rbac **之后**仍直达 ⇒ 证明 rbac 未拦截（不变量 ④） | 绿 |

### E-1 无硬编码行号（卡面硬要求）
源码断言全部经**标识符/路径**：`EXEMPT_REGISTRATIONS` 为标识符数组；`REGISTRATIONS` 由
`MOUNT_RE = /app\.use\(([A-Za-z0-9_]+(?:Router|Routes))\)/` 与
`INLINE_RE = /app\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/` 逐行提取；行号**只出现在行内注释与本文档**。

### E-2 据实设超时（**非改判据**，落盘前登记）
`vitest.config.ts:20-38` **未设 `hookTimeout`**（vitest 默认 **10s**），而本机 `createServer()` 的
真实 Bootstrap **实测 ≈15s**（本次运行日志：`Phase 2 完成 durationMs=8793` → … → `Phase 5 完成 durationMs=1120`，
端到端 `Duration 16.26s`）。⇒ 若不放宽，每个用例都会以 **hook 超时假红**。
处置：`beforeAll(fn, 120_000)` / `afterAll(fn, 30_000)` 显式放宽，**不改任何判据、不改 `vitest.config.ts`**。
依据 = 本次绿跑实测 `Duration 16.26s (… tests 10.98s)`；变异体跑 `Duration 16.55s`。

### E-3 N1 硬前置与**有效性**证明
`beforeAll` 先于用例设置并断言：
```
process.env.JWT_SECRET = 'd947-test-secret-0123456789';   // 27 chars ≥ 16
process.env.DEV_MODE   = 'false';
expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
expect(process.env.DEV_MODE).toBe('false');
```
必要性（`auth.ts` 逐行）：`DEV_MODE=true` 且无 JWT_SECRET ⇒ `auth.ts:350-364` 走「devMode 自动 admin」，
无凭据请求也会被注入 admin 身份 ⇒ 用例 7/8 的 401/403 断言全部**空转**；
且 `getSecret()`（`auth.ts:50-65`）要求 `JWT_SECRET.length >= 16` 才当可用密钥。
`vitest.config.ts:58-63` 的 `env` 设 `DEV_MODE='true'` 且**该文件不在写集内（禁改）** ⇒ 只能在夹具自身内解决。
用例 7 即**有效性判别**：若 N1 未生效（devMode 自动 admin），该请求会变 **200** ⇒ 用例红。

### E-4 运行时探针骨架（铁律 12，真实 `createServer()` + `PORT=0` + 真实 `fetch`）
环境隔离（对照先例 `tests/routes/llm-config.test.ts`）：存原值到 `savedEnv` → `PORT='0'` ·
`SYNOVA_DB_PATH=':memory:'` · `SYNOVA_DATA_DIR=mkdtempSync(...)`（**严禁写真实 `data/`**）→
`const server = await createServer()` → `BASE = http://127.0.0.1:${(server.address() as AddressInfo).port}`
→ 全部断言走真实 `fetch`（**不 mock fetch / 不 mock 管线**）→ `afterAll` 里 `server.close()` + `rmSync(tmp)` + 还原 `savedEnv`。
**分流设计**：`beforeAll` 末尾先打一条 `/health` 并把 `status < 500` 作为断言，
以便把「bootstrap 挂 → `process.exit(1)` 杀进程」与「rbac 前移后断言不符」两类红**区分开**
（`createServer()` 内 Bootstrap 失败走 `server.ts:130-142` 的 `process.exit(1)`，是杀进程而非抛异常）。

---

## F. 原始输出 · 绿跑（改动完成后，`VITEST_EXIT=0`）

```
### 全量日志指纹（绿跑 · 最终确认轮）
lines=353  bytes=74543
1eaf40af3b722694632e8906a5876bcb3c8ef7b0d969b5a87392ddec1b463ee5 */c/Users/Administrator/AppData/Local/Temp/d947-cb-vitest-final.out

$ grep -vE '^\{"level"' d947-cb-vitest-final.out   （剔除 bootstrap 逐行 JSON 日志，其余逐字不截断）
=== ENV ===
pwd=/d/novis-backup-20260526/Novis/synova-agent/.synova-wt-d947-middleware
HEAD=db54b926
LOCK_ACQUIRED after 5 tries (~25s)
$ sha256sum src/server.ts
62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784 *src/server.ts

$ npx vitest run tests/routes/middleware-order.test.ts

 RUN  v4.1.8 D:/novis-backup-20260526/Novis/synova-agent/.synova-wt-d947-middleware

 ✓ tests/routes/middleware-order.test.ts (12 tests) 10544ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  21:08:40
   Duration  15.78s (transform 5.59s, setup 0ms, import 4.74s, tests 10.54s, environment 0ms)

[VITEST_EXIT=0]

=== 放锁 ===
UNLOCK_OK
end=2026-09-24T13:08:56Z

### 判别性运行时服务端日志（逐字）
$ grep -nE 'RBAC_DENIED|AUTH_REJECTED|工作区已创建|"port":0' d947-cb-vitest-final.out
18:{"level":30,"time":1790255325659,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"config","port":0,"devMode":false,"dbPath":":memory:","model":"deepseek-chat","llmConfigured":false,"msg":"配置加载完成"}
19:{"level":30,"time":1790255325660,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"deploy/bootstrap","port":0,"devMode":false,"msg":"配置已加载"}
25:{"level":30,"time":1790255325662,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"config","port":0,"devMode":false,"dbPath":":memory:","model":"deepseek-chat","llmConfigured":false,"msg":"配置加载完成"}
335:{"level":30,"time":1790255336005,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","port":0,"msg":"Synova-Agent → http://localhost:0"}
336:{"level":40,"time":1790255336051,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"middleware/rbac","code":"RBAC_DENIED","reason":"no_authenticated_context","msg":"安全判据: 被拒绝 — 无认证上下文（fail-closed，不回退自报凭据/不回退 admin）"}
337:{"level":40,"time":1790255336096,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"auth","code":"AUTH_REJECTED","reason":"missing_or_invalid_authorization_header","path":"/api/workspaces/mine","msg":"安全判据: 被拒绝 — 缺 Authorization/Bearer 头（HTTP 401，fail-closed）"}
338:{"level":30,"time":1790255336146,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"routes/workspaces-api","id":"ws_mufjsy4y","title":"D947 P4 判别性探针","owner":"d947-admin","msg":"工作区已创建"}
339:{"level":40,"time":1790255336152,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"middleware/rbac","code":"RBAC_DENIED","reason":"no_authenticated_context","msg":"安全判据: 被拒绝 — 无认证上下文（fail-closed，不回退自报凭据/不回退 admin）"}
340:{"level":40,"time":1790255336176,"pid":14464,"hostname":"PC-202605261327","name":"synova-agent","service":"middleware/rbac","code":"RBAC_DENIED","reason":"no_authenticated_context","msg":"安全判据: 被拒绝 — 无认证上下文（fail-closed，不回退自报凭据/不回退 admin）"}
```

---

## G. 原始输出 · 变异体双红证（L-5 判别性）

**变异体**：把 `app.use(rbacMiddleware);` 从「`homeRoutes` 之前（L=366）」移回「`knowledgeAskRoutes` 之后」
——即回到前移前的**语义位置**（`workspacesApiRoutes` 之后）。

**跨成员安全设计**：整轮「快照 → 变异 → 跑 → 还原」**全部在持有 `/tmp/d947-heavy.lock` 期间完成**，
⇒ code-c 不可能在变异态下跑验证（原子性）。变异脚本：`%TEMP%\d947_cb_mutation.sh`（临时产物，不入库）。

```
### 全量日志指纹
lines=490  bytes=81151
28a0af54d20141a675d4e88a7737e96f6c8e92d971f0e7423a7c9099021429d9 */c/Users/Administrator/AppData/Local/Temp/d947-cb-mutation.out

### 结构化骨架（剔除 bootstrap 的 JSON 逐行日志，其余逐字不截断）
=== ENV ===
pwd=/d/novis-backup-20260526/Novis/synova-agent/.synova-wt-d947-middleware
HEAD=db54b926
LOCK_ACQUIRED after 1 tries (~5s)

════════ 变异体：把 app.use(rbacMiddleware) 从「homeRoutes 之前」移回「knowledgeAskRoutes 之后」════════
$ cp src/server.ts <snapshot>
$ sha256sum src/server.ts  （变异前 = 期望等于 62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784）
62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784 *src/server.ts
BEFORE_SHA=62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784
变异前 rbac 行号 = 366

$ awk '删除 ^  app.use(rbacMiddleware);$ 行，并在 app.use(knowledgeAskRoutes); 之后插入同字面量' src/server.ts > <mutated>
变异后 rbac 行号 = 382
变异后 knowledgeAskRoutes 行号 = 381
变异后 homeRoutes 行号 = 375
$ git diff --stat -- src/server.ts
 src/server.ts | 17 +++++++++++++----
 1 file changed, 13 insertions(+), 4 deletions(-)

════════ npx vitest run tests/routes/middleware-order.test.ts （变异体下必须双红）════════

 RUN  v4.1.8 D:/novis-backup-20260526/Novis/synova-agent/.synova-wt-d947-middleware

 ❯ tests/routes/middleware-order.test.ts (12 tests | 4 failed) 11147ms
     × P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项 23ms
     × P4-2 前移后计数值恒为 5（与 P4-1 同源的显式计数，便于红时读数） 7ms
     × I4 rbac 晚于 jwtAuthMiddleware 与 rateLimitMiddleware，早于 homeRoutes 与 workspacesApiRoutes 2ms
     ✓ P6-1 关键判据函数零 void（判定结果不得被丢弃） 1ms
     ✓ P6-2 装配期硬编码身份字面量已清除 0ms
     ✓ P6-3 middleware/rbac import 已收窄为仅 rbacMiddleware（装配期空调用已删） 1ms
     ✓ N1 有效性：无凭据访问非白名单路径 → 认证层 fail-closed 401（N1 若未生效则 devMode 自动 admin → 200） 19ms
     × P4 判别性正路径：合法 admin JWT → POST /api/workspaces → 200（变异体：rbac 移回 → req.rbac 缺失 → 403 红） 38ms
     ✓ 豁免路径回归：/health 仍直达（非 401/403） 8ms
     ✓ 豁免路径回归：POST /api/auth/login 仍直达（路由自身执行 → 400 VALIDATION_ERROR，而非认证层 401） 7ms
     ✓ 豁免路径回归：GET /api/status/budget 仍直达（200） 7ms
     ✓ 豁免路径回归：GET /api/knowledge/ask 仍直达（非 401/403） 7ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/routes/middleware-order.test.ts > D947 P4 — 装配顺序源码断言（标识符口径，无硬编码行号） > P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项
AssertionError: expected [ 'setupGuideGoneRouter', …(11) ] to deeply equal [ 'setupGuideGoneRouter', …(4) ]

- Expected
+ Received

@@ -2,6 +2,13 @@
    "setupGuideGoneRouter",
    "llmConfigRoutes",
    "uploadV2GoneRouter",
    "authRoutes",
    "/api/status/budget",
+   "homeRoutes",
+   "chatRoutes",
+   "workspaceRoutes",
+   "workspaceDataRoutes",
+   "workspacesApiRoutes",
+   "gaDiagnosisRoutes",
+   "knowledgeAskRoutes",
  ]

 ❯ tests/routes/middleware-order.test.ts:143:42
    141|
    142|   it('P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项', () => {
    143|     expect(registrationsBeforeRbac(src)).toEqual([...EXEMPT_REGISTRATI…
       |                                          ^
    144|   });
    145|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  tests/routes/middleware-order.test.ts > D947 P4 — 装配顺序源码断言（标识符口径，无硬编码行号） > P4-2 前移后计数值恒为 5（与 P4-1 同源的显式计数，便于红时读数）
AssertionError: expected [ 'setupGuideGoneRouter', …(11) ] to have a length of 5 but got 12

- Expected
+ Received

- 5
+ 12

 ❯ tests/routes/middleware-order.test.ts:147:42
    145|
    146|   it('P4-2 前移后计数值恒为 5（与 P4-1 同源的显式计数，便于红时读数）', () => {
    147|     expect(registrationsBeforeRbac(src)).toHaveLength(5);
       |                                          ^
    148|   });
    149|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  tests/routes/middleware-order.test.ts > D947 P4 — 装配顺序源码断言（标识符口径，无硬编码行号） > I4 rbac 晚于 jwtAuthMiddleware 与 rateLimitMiddleware，早于 homeRoutes 与 workspacesApiRoutes
AssertionError: expected 17626 to be less than 17408
 ❯ tests/routes/middleware-order.test.ts:159:20
    157|     expect(at('app.use(jwtAuthMiddleware);')).toBeLessThan(rbacAt); //…
    158|     expect(at('app.use(rateLimitMiddleware);')).toBeLessThan(rbacAt);
    159|     expect(rbacAt).toBeLessThan(at('app.use(homeRoutes);'));
       |                    ^
    160|     // P3 能拿到 req.rbac 的物理前提
    161|     expect(rbacAt).toBeLessThan(at('app.use(workspacesApiRoutes);'));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  tests/routes/middleware-order.test.ts > D947 P4 — 运行时探针（真实 createServer + 真实 fetch） > P4 判别性正路径：合法 admin JWT → POST /api/workspaces → 200（变异体：rbac 移回 → req.rbac 缺失 → 403 红）
AssertionError: expected 403 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 403

 ❯ tests/routes/middleware-order.test.ts:201:24
    199|       body: JSON.stringify({ title: 'D947 P4 判别性探针' }),
    200|     });
    201|     expect(res.status).toBe(200);
       |                        ^
    202|     const body = (await res.json()) as { ok?: boolean; workspace?: { o…
    203|     expect(body.ok).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed | 8 passed (12)
   Start at  21:05:43
   Duration  16.55s (transform 5.97s, setup 0ms, import 4.96s, tests 11.15s, environment 0ms)

[VITEST_EXIT=1]

════════ 还原（cp 快照 + sha256 校验；**不用** git checkout —— 会销毁未提交的 A/B/C）════════
$ cp <snapshot> src/server.ts
AFTER_SHA=62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784
RESTORE_OK — sha256 与变异前逐字节一致
还原后 rbac 行号 = 366

$ git status --porcelain
 M src/routes/department-workspace.ts
 M src/routes/documents.ts
 M src/routes/workspaces-api.ts
 M src/server.ts
 M src/services/request-context.ts
 M tests/routes/department-workspace.test.ts
 M tests/routes/overflow.test.ts
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
?? tests/routes/middleware-order.test.ts
?? tests/routes/workspace-access-write-endpoint.test.ts

$ git diff --stat
 src/routes/department-workspace.ts        |  22 +++++-
 src/routes/documents.ts                   |  17 +++-
 src/routes/workspaces-api.ts              | 125 +++++++++++++++++++++++++++---
 src/server.ts                             |  19 +++--
 src/services/request-context.ts           |  48 +++++++++++-
 tests/routes/department-workspace.test.ts | 105 ++++++++++++++++++++-----
 tests/routes/overflow.test.ts             |  18 ++++-
 7 files changed, 308 insertions(+), 46 deletions(-)

════════ 放锁（显式校验，不静默）════════
UNLOCK_OK
end=2026-09-24T13:06:02Z
```

---

## H. 还原与「红证不残留」证明

| 项 | 结果 |
|---|---|
| 变异前 sha256 | `62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784` |
| 变异后 → 还原 → sha256 | `62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784` |
| 判定（脚本自动） | `RESTORE_OK — sha256 与变异前逐字节一致` |
| 还原后 rbac 行号 | `366`（回到前移后位置） |
| 还原方式 | **`cp` 快照 + sha256 校验**（**非** `git checkout --`，见 H-1） |
| 放锁 | `UNLOCK_OK`（显式校验，不静默） |
| 复跑后的工作树 | 见 G 节 `git status --porcelain` / `git diff --stat`（无任何变异体痕迹） |

### H-1 ⚠️ 卡面还原指令（`git checkout -- <file>`）对 PR-2a **不安全** —— 已报队长、已裁定 L-24

卡面【变异体】写「还原用 `git checkout -- <file>`（**PR-1 已提交，安全**）」。该理由**只对 PR-1 的文件成立**：
`src/server.ts` 在 PR-2a 中**尚未提交** ⇒ `git checkout -- src/server.ts` 会回到 **HEAD（rbac@373 的 PR-1 前版本）**，
**整段销毁** A/B/C 三件。物理证据（开工实测）：

```
$ git diff --quiet -- src/server.ts ; echo $?      # 非 0 ⇒ 工作树与 HEAD 不同
不同 ⇒ git checkout -- src/server.ts 会销毁未提交的 A/B/C 工作
$ git show HEAD:src/server.ts | grep -n 'app.use(rbacMiddleware)' | cut -d: -f1
373
$ grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1
366
```

**处置**：改用**字节级快照 + 指纹校验**还原（证据强于 `git checkout`：可证字节相同，且不动 HEAD 语义）。
**队长裁定 L-24**：采纳 (A) —— PR-2 先提交（commit B = 9 文件），task-8/task-9 再以**不可变 commit B SHA** 为基准
自验/复核（与 L-14 同构）；我的快照协议**批准并保留为补充协议**。本件同时登记「同类第二次出现 ⇒ 升级全员」。

### H-2 ⚠️ 我自己的事故：重型锁泄漏（已修复，全队通报）

**事实**：我的取锁脚本在锁目录内写入 `owner` 文件，释放用 `rmdir` —— **`rmdir` 对非空目录静默失败**
（我又 `2>/dev/null` 吞了错误）⇒ `/tmp/d947-heavy.lock` 泄漏约 6 分钟（20:58:16 → 21:04:5x），
**同时阻塞了我与 code-c 两个 runner**（`Get-CimInstance bash.exe` 实测：`d947c_run_p3.sh` PID 16780/19652
与 `d947_cb_mutation.sh` PID 17232 双双阻塞；期间无任何 node/vitest 存活 ⇒ 陈旧锁）。
**修复**：① 杀我自己的等待者并清锁；② 释放前 `rm -f "$LOCK/owner"`；③ 释放后**显式校验**目录已消失
（`UNLOCK_OK` / `UNLOCK_FAIL` 打出来，不再静默）；④ `owner` 内容改为 `code-b pid=$$ <UTC>` 使其**可归属**
（原为字面量 `owner`，泄漏后无从追责 —— 这是我未第一时间自证的原因）。
**影响面**：事故只涉及 `/tmp` 锁目录，**未触碰任何仓库文件**；已向 code-c 通报并建议升级为全队锁协议修正。

---

## I. 未清项 / 边界 / 交付指纹

### I-1 未清项（交 CTO / K3）
1. **REV-6 命令② 的「403」为误期望**（实测 401）——队长已裁定 L-22 采 (A)，并**登记为待 CTO 追认的口径修正**（不静默，与 L-18/L-20 并列）。
2. **403 断言在别处保留**（L-22 第 3 条）：由 P3 写端点 `tests/routes/workspace-access-write-endpoint.test.ts`（code-c）承担，task-8/task-9 显式复核。
3. **锁协议缺陷**（H-2）建议升级为全队修正：`mkdir` 原子取锁 + **清空内层文件后** `rmdir` + 释放后显式校验；**禁止**把释放错误 `2>/dev/null` 吞掉。
4. **`origin/main` 漂移 `13 2`**（L-23 已登记）：main 前进 13 commit（PR #740，纯 docs/task-state），对写集零改动；本机无推送凭据 ⇒ 栈式 base = `77e0d6aa`。
5. **R7 的 P4 判据锚在行号区间 [357,366]**：本卡实测 L=366（区间上界）。若后续任何改动在 `:355-365` 区段增减行，L 会漂出区间而**夹具源码断言仍绿**（其锚在标识符而非行号）⇒ 区间断言只能由 P4 谓词 + 证据文件承担。**夹具不断言行号，属设计取舍**，明示于此。
6. **`/api/workspaces/mine`（`:264`）与 `/api/workspaces/conflicts`（`:294`）被 `/:id`（`:126`）遮蔽**（D-1，code-c F-1 独立发现，我方已复核）⇒ 带凭据经 HTTP 恒 **404**。**不属本卡写集**（`src/routes/workspaces-api.ts` 归 code-c），登记交 CTO/K3：本夹具的**无凭据 401** 断言不受影响，但该遮蔽使 `/mine` 经 HTTP **不可达** —— 与 R5「JWT 用户部门级可见性恒 deny」同属功能面回退候选，需 CTO 判定是否另立卡。
7. **`src/server.ts:473-474` 的 tsc 报错为 PR-2a 之前既有，非本次引入**（供 K3 排除误归因）：
   我的 diff 仅 4 个 hunk（`@@ -16,7 +16,7` / `@@ -244,9 +244,8` / `@@ -363,6 +362,17` / `@@ -370,7 +380,6`），均**不覆盖**该区段；且逐行比对证明该两行与 HEAD 对应行**逐字节相同**：
   ```
   $ diff <(git show HEAD:src/server.ts | sed -n '464,465p') <(sed -n '473,474p' src/server.ts)
   IDENTICAL ⇒ 文本与 HEAD 相同 ⇒ 报错在 PR-2a 之前既已存在
   $ git diff -- src/server.ts | grep -c "setGraphBridge"
   0
   ```
   （偏移 +9 行即本卡净增行数：A/B/C 三件 `14 insertions(+), 5 deletions(-)`。报文所指两行 = `setMainAgent(mainAgent);` / `setGraphBridge(graphStore); // D231`，其 `graphStore` 来自 `BootstrapServices` 的 `unknown`，与本次改动无因果。）
8. **写集指纹（供 verifier/reviewer 对齐）**：`md5sum src/server.ts` → `57dd989a940ace866154fc00e393b60a`；
   `md5sum tests/routes/middleware-order.test.ts` → `ba43384ee8ef360ec52c1935aab57c97`。
   （code-c 侧 md5 见其 `D947-code-c-pr2b.md`。）

### I-2 边界与未验证项（诚实边界）
- **未跑全量套件**：本卡只跑 `tests/routes/middleware-order.test.ts`（1 文件 / 12 用例，两轮：绿跑 + 变异体跑）。
  按你的提示，全量套件会污染 6 个无关 tracked 文件 ⇒ **主动规避**；因此本文不含全量门禁结论，
  也**不声称** PR-2 整体绿。
- **未做 tsc / oxlint 单独跑**：本卡的判据是 P4/P6/P7 + 运行时探针；类型检查与 lint 归队长提交时的门禁链。
- **判别性正路径对 P3 的依赖已在夹具注释中显式声明**：若 code-c 后续改动 `workspaces-api.ts` 的守卫语义，
  本夹具用例 8 需同步复核（这是 P3/P4 成对验收的**设计意图**，不是缺陷）。
- **两轮运行时结果对应的工作树状态不同**（绿跑 20:58 / 最终确认轮 21:08）：最终确认轮在 code-c 的
  `workspaces-api.ts`（+125 行）落地后重跑，**仍 12/12 绿** ⇒ 对 P3 最新实现成立。变异体轮在同一锁持有期内完成，期间无他人改动。

### I-3 交付指纹
```
$ sha256sum src/server.ts
62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784   (529 行)
```
| 产物 | 落点 | 是否入库 |
|---|---|---|
| `src/server.ts`（A/B/C 三件） | 工作树 | 由队长 commit B |
| `tests/routes/middleware-order.test.ts`（新建，12 用例） | 工作树 | 由队长 commit B |
| 本文 | `docs/synova/product-lines/evidence/D947-20260924/` | 治理产物（不计 PR 预算） |
| 原始日志 `/tmp/d947-cb-vitest.out` / `-final.out` / `-mutation.out` | `%TEMP%` | **否**（临时产物，指纹见 F/G 节） |
| 变异脚本 / 变体源 / 快照 `d947_cb_*.sh` · `d947-server-*.ts` | `%TEMP%` | **否** |

**临时产物指纹（供复核）**
| 文件 | lines | bytes | sha256 |
|---|---|---|---|
| `d947-cb-vitest.out`（首轮绿跑） | 350 | 74448 | `92d3e40f9f058b0d53bfcee3cf3a70062a47df32ca3939ab939c0a018a8a268c` |
| `d947-cb-mutation.out`（变异体） | 490 | 81151 | `28a0af54d20141a675d4e88a7737e96f6c8e92d971f0e7423a7c9099021429d9` |

---

**结论形态**：本件为 **自验结论**（编码者自验，非独立自验）⇒ 定性 **`可提请独立审计`**。
**本文不判「通过」**；是否通过归 **CTO 收件闸 + K3 终审**。独立自验（task-8）与独立复核（task-9）应在
**commit B 的不可变 SHA** 上进行，并显式复核：① P4 谓词点数 5 + L ∈ [357,366]；② 判别性**正路径**（本件用例 8）；
③ 403 断言在 P3 夹具中**在场**（L-22 第 3 条）；④ 本件 H-1/H-2 两项事故登记属实。
