# D947 PR-2b 就绪侦察 — 路由层冲突扫描（M2）

> **任务**：`task-3`（写者 code-c）｜**阶段**：PR-2 开工前只读侦察，**未改任何 src/ 或 tests/ 文件**
> **工作树**：`D:\novis-backup-20260526\Novis\synova-agent\.synova-wt-d947-middleware`（钉死，未复用他人工作树）
> **分支 / HEAD**：`feat/d947-middleware-default-posture` @ `f25e61eb105690359dbe13baf64695e5ff1748f0`
> **shell 事实**：pwsh 的 PATH **无** grep/awk/wc（`which grep awk wc` 全空）；全部命令经
> `& "C:\Program Files\Git\bin\bash.exe" <脚本>` 执行，脚本先 `-replace "\r\n","\n"` 去 CRLF + 去 BOM 再落 `$env:TEMP`。
> **本件性质**：**侦察证据**，非自验结论、非「通过」判定。所有数字为命令原始输出，禁 head 截断。

## 0. 只读性证明

```
$ git rev-parse --abbrev-ref HEAD
feat/d947-middleware-default-posture
$ git rev-parse HEAD
f25e61eb105690359dbe13baf64695e5ff1748f0
$ git diff --stat
(空 — 零 tracked 改动)
EXIT=0
$ git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
```

证据目录侦察前已有 3 件（他人产出，未触碰）：`D947-T-V-verifier-raw-evidence.md` · `PLAN-REV2.md` · `PLAN.md`。

---

## R1｜自报头 / query.token 扫掠（src/routes/ + src/services/）

命令（**派单指定口径**）：
```bash
grep -rn 'x-synova-token' src/routes/ src/services/
```
```
src/routes/department-workspace.ts:13:  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
src/routes/department-workspace.ts:75:  try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
src/routes/workspaces-api.ts:178:  const token = String(req.headers['x-synova-token'] || '');
```
```
EXIT=0 ｜ COUNT=3
```

命令：
```bash
grep -rEn 'query\?*\.token' src/routes/ src/services/
```
```
src/routes/department-workspace.ts:13:  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
```
```
EXIT=0 ｜ COUNT=1
```

**合取口径**（`x-synova-token | query?.token`）：
```bash
grep -rEn 'x-synova-token|query\?*\.token' src/routes/ src/services/
```
```
src/routes/department-workspace.ts:13:  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
src/routes/department-workspace.ts:75:  try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
src/routes/workspaces-api.ts:178:  const token = String(req.headers['x-synova-token'] || '');
```
```
EXIT=0 ｜ COUNT=3
```

| # | 位点 | 性质 | 归谁 |
|---|---|---|---|
| 1 | `department-workspace.ts:13` | **服务端读自报头**（+ `_req.query.token` 第二通道） | code-c（PR-2 #5） |
| 2 | `department-workspace.ts:75` | 页内 client JS **自发送** `'manager:'+DEPT+':user'` | code-c（PR-2 #5） |
| 3 | `workspaces-api.ts:178` | **服务端读自报头**（`GET /api/workspaces/mine`，无 query 通道） | code-c（PR-2 #3） |

**⚠️ 前提订正（对队长派单件）**：派单 R1 把 `request-context.ts:41` 列在本条已知位点内 —— **该位点在本命令口径下不出**；`request-context.ts:41` 是 `conditions: []` 位点（属 R2），不是自报头位点。两条口径不可混。

**扩展面（超出 R1 指定目录，仅登记不认领）**：
```bash
grep -rn "x-synova-token" src/
```
```
src/middleware/auth.ts:378: *   2. x-synova-token header（向下兼容旧格式）
src/middleware/auth.ts:394:  // 向下兼容 x-synova-token 格式
src/middleware/auth.ts:395:  const token = req.headers?.['x-synova-token'] as string | undefined;
src/middleware/rbac.ts:110:  const token = String((req.headers?.['x-synova-token'] as string) || (req.query?.token as string) || '');
src/routes/department-workspace.ts:13:  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
src/routes/department-workspace.ts:75:  try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
src/routes/workspaces-api.ts:178:  const token = String(req.headers['x-synova-token'] || '');
src/server.ts:247:  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
```
```
EXIT=0 ｜ COUNT=8
```
⇒ **「读客户端自报身份」代码位恰 6 处**（与 `PLAN.md` F4 一致）：`auth.ts:395`（PR-1）· `rbac.ts:110`（PR-1）· `department-workspace.ts:13`（code-c）· `department-workspace.ts:75`（code-c）· `workspaces-api.ts:178`（code-c）· `server.ts:247`（code-b）。另 2 处为注释（`auth.ts:378/394`）。

**关键子发现（rbac.ts:110 是自报头 + query 双通道，且含 fail-open 兜底）**：
```ts
// src/middleware/rbac.ts:110-120
  const token = String((req.headers?.['x-synova-token'] as string) || (req.query?.token as string) || '');
  if (token && token.includes(':')) {
    const parts = token.split(':');
    return {
      role: (parts[0] as WorkspaceRole) || DEFAULT_ROLE,
      department: parts[1] || undefined,
      userId: parts[2] || DEFAULT_USER,
    };
  }
  return { role: 'admin', userId: DEFAULT_USER };   // ← 无凭据 = admin（fail-open）
```
该 `role: 'admin'` 兜底**不在 code-c 写集**（`rbac.ts` = PR-1 / code-a）。

---

## R2｜空过滤条件扫掠（`conditions: []`）

命令：
```bash
grep -rn 'conditions: \[\]' src/ --include='*.ts'
```
```
src/middleware/auth.ts:355:          getPermissionFilter: async () => ({ conditions: [] }),
src/routes/documents.ts:85:    const { results } = store.search('', { conditions: [] }, 100);
src/routes/documents.ts:112:    const { results } = store.search(id, { conditions: [] }, 50);
src/services/request-context.ts:41:  if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };
```
```
EXIT=0 ｜ COUNT=4  （基线 4 成立 ✅）
```
宽松口径 `conditions:\s*\[\]` 复核：**同为 4 处**（无遗漏）。

| # | 位点 | 归谁 |
|---|---|---|
| A | `auth.ts:355` | PR-1 / code-a |
| B | `documents.ts:85` | **code-c**（PR-2 #6） |
| C | `documents.ts:112` | **code-c**（PR-2 #6） |
| D | `request-context.ts:41` | **code-c**（PR-2 #7，R1 扩入） |

⇒ 归 code-c 的 **3 处**（B/C/D）✅ 与派单一致。

**漏斗两端（谁调用谁）实测**：
```bash
grep -rn 'getPermissionFilter' src/
```
```
src/middleware/auth.ts:355:          getPermissionFilter: async () => ({ conditions: [] }),
src/services/request-context.ts:13:interface AuthProvider { getPermissionFilter(ctx: UserContext, resourceType: string, action: string): Promise<FilterClause>; }
src/services/request-context.ts:42:  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
```
```
COUNT=3
```
**生产侧 `getPermissionFilter` 实现只有 1 个：`auth.ts:355`（恒返回空条件）。** `request-context.ts:42` 是唯一消费者，且 `action` **硬编码 `'read'`**（写动作无法表达）。

---

## R3｜workspaces-api.ts 写端点（P3 目标位）

命令：
```bash
grep -nE 'router\.(post|put|patch|delete)\(' src/routes/workspaces-api.ts
```
```
55:router.post('/api/workspaces', (req: Request, res: Response) => {
77:router.put('/api/workspaces/:id/status', (req: Request, res: Response) => {
106:router.post('/api/workspaces/:id/messages', (req: Request, res: Response) => {
144:router.post('/api/workspaces/:id/sub', (req: Request, res: Response) => {
221:router.put('/api/workspaces/:id/merge', (req: Request, res: Response) => {
```
```
EXIT=0 ｜ COUNT=5  ✅ 与派单期望 5/5 完全一致（:55 :77 :106 :144 :221）
```
全端点数（含 GET）：**共 11 处** —— `48 GET · 55 POST · 70 GET :id · 77 PUT :id/status · 106 POST :id/messages · 126 GET :id/context · 144 POST :id/sub · 167 GET by-dept/:dept · 176 GET mine · 195 GET conflicts · 221 PUT :id/merge`。

**写端点守卫现状（0 个守卫）**：
```bash
grep -n "extractRbacContext\|canAccessWorkspace\|canModifyWorkspace\|req.auth\|requireAuth\|requireGa" src/routes/workspaces-api.ts
```
```
12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
131:  const ctx = extractRbacContext(req);
132:  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
```
```
COUNT=3
```
⇒ 仅 **GET :id/context（126）** 有 `canAccessWorkspace`；**5 个写端点（55/77/106/144/221）零守卫**。`canModifyWorkspace` 在 workspaces-api.ts **零引用**（import 行 :12 也未导入）。
⇒ 与 `server.ts:248-249` 的关系：`canAccessWorkspace`/`canModifyWorkspace` 在 server.ts 的**唯一出现是 startup 期 `void` 丢弃的空操作**（见 R9 补充）。

---

## R4｜漏斗两端调用图（auth.ts:355 ↔ request-context.ts:41）

命令：
```bash
grep -rEn 'getPermissionFilter|request-context' src/ tests/
```
```
src/l1/qa-router.ts:8: * 权限: 根据用户角色过滤知识 (L1→request-context)
src/l1/qa-router.ts:14:import { getCurrentFilterClause } from '../services/request-context';
src/l3/knowledge-agent.ts:19:import { getCurrentFilterClause } from '../services/request-context';
src/l3/knowledge-agent.ts:289:          const user = (await import('../services/request-context')).getCurrentUser();
src/middleware/auth.ts:18:import { runWithContext } from '../services/request-context';
src/middleware/auth.ts:278: * 与 request-context.ts 的 runWithContext 配合使用。
src/middleware/auth.ts:334:    // 同步注入 request-context（兼容 runWithContext 模式）
src/middleware/auth.ts:335:    // request-context 不可用时至少有 req.auth
src/middleware/auth.ts:355:          getPermissionFilter: async () => ({ conditions: [] }),
src/middleware/auth.ts:360:        log.warn({ err: ctxErr }, 'request-context runWithContext error, continuing with req.auth');
src/middleware/auth.ts:364:        log.warn({ err: ctxErr }, 'request-context not available, using req.auth only');
src/routes/im.ts:12:import { runWithContext } from '../services/request-context';
src/routes/knowledge.ts:13:import { getCurrentFilterClause } from '../services/request-context';
src/routes/permissions.ts:15:import { getCurrentUser } from '../services/request-context';
src/services/request-context.ts:2: * services/request-context.ts — 请求级上下文 (M2 权限透传)
src/services/request-context.ts:13:interface AuthProvider { getPermissionFilter(ctx: UserContext, resourceType: string, action: string): Promise<FilterClause>; }
src/services/request-context.ts:42:  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
```
```
EXIT=0 ｜ COUNT=17
```

**调用图（实测，非推断）**：

```
生产方（唯一）  auth.ts:337 runWithContext({ user, authProvider })
                        └── authProvider.getPermissionFilter = auth.ts:355 恒 { conditions: [] }

兜底方          request-context.ts:41  !ctx?.user || !ctx?.authProvider → { conditions: [] }

消费者          request-context.ts:42  → ctx.authProvider.getPermissionFilter(user, resourceType, 'read')
                        上游 4 个调用点（共 5 次调用）:
                          src/routes/knowledge.ts:35     getCurrentFilterClause('KnowledgeChunk')
                          src/l1/qa-router.ts:84         getCurrentFilterClause('KnowledgeChunk')
                          src/l3/knowledge-agent.ts:69   getCurrentFilterClause('KnowledgeChunk')
                          src/l3/knowledge-agent.ts:113  getCurrentFilterClause('KnowledgeChunk')
                          src/l3/knowledge-agent.ts:204  getCurrentFilterClause('KnowledgeChunk')

旁路注入        src/routes/im.ts:53  runWithContext({ user })  ← **无 authProvider**
                ⇒ 经 request-context.ts:41 兜底分支
```
命令：
```bash
grep -rn 'getCurrentFilterClause' src/ tests/
```
```
src/l1/qa-router.ts:14:import { getCurrentFilterClause } from '../services/request-context';
src/l1/qa-router.ts:84:    const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;
src/l3/knowledge-agent.ts:19:import { getCurrentFilterClause } from '../services/request-context';
src/l3/knowledge-agent.ts:69:          const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;
src/l3/knowledge-agent.ts:113:          const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;
src/l3/knowledge-agent.ts:204:          const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;
src/routes/knowledge.ts:13:import { getCurrentFilterClause } from '../services/request-context';
src/routes/knowledge.ts:35:    const filter = await getCurrentFilterClause('KnowledgeChunk') as FilterClause;
src/services/request-context.ts:39:export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
```
```
EXIT=0 ｜ COUNT=9  （1 定义 + 8 引用；**5 次实际调用**）
```
```bash
grep -rn 'runWithContext' src/ tests/
```
```
src/middleware/auth.ts:18:import { runWithContext } from '../services/request-context';
src/middleware/auth.ts:278: * 与 request-context.ts 的 runWithContext 配合使用。
src/middleware/auth.ts:334:    // 同步注入 request-context（兼容 runWithContext 模式）
src/middleware/auth.ts:337:      runWithContext({
src/middleware/auth.ts:360:        log.warn({ err: ctxErr }, 'request-context runWithContext error, continuing with req.auth');
src/routes/im.ts:12:import { runWithContext } from '../services/request-context';
src/routes/im.ts:53:    const result = await runWithContext({ user: { userId: senderId, identity: {...}, auth: {...}, permissions: {...} } }, async () => {
src/services/request-context.ts:24:export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
```
```
COUNT=8  （2 处为注释/文档串；实际调用点 = auth.ts:337 + im.ts:53，**共 2 处**）
```

**`documents.ts:85/:112` 消费面（P2 收口目标）**：两处 **完全不调用** `getCurrentFilterClause`（`documents.ts` 全文零 import `request-context`，见 R7b）—— 即"空条件是写死的"，不是兜底漏出来的。

---

## R5｜写端点守卫现状 + 存量断言面

命令（**派单指定**）：
```bash
grep -rn 'canAccessWorkspace\|canModifyWorkspace' src/routes/ tests/
```
全量输出 **共 35 处**（`TOTAL=35`，命令原始计数）。逐文件计数（`grep -rc ... | grep -v ':0$'` 原始输出）：
```
src/routes/workspaces-api.ts:2
tests/middleware/auth.integration.test.ts:2
tests/middleware/rbac-ga-boundary.test.ts:7
tests/middleware/rbac.test.ts:24
```
（2+2+7+24 = 35 ✅ 自洽）
⇒ `src/routes/` **只有 workspaces-api.ts 一个文件**引用（2 处 = :12 import + :132 调用）；`tests/routes/` **零处** —— **P3 写端点守卫在存量路由测试中没有任何断言**（新建夹具 `tests/routes/workspace-access-write-endpoint.test.ts` 为唯一覆盖来源）。

命令（全仓，含定义 + server.ts）：
```bash
grep -rn 'canAccessWorkspace\|canModifyWorkspace' src/ tests/
```
```
src/middleware/rbac.ts:201:export function canAccessWorkspace(ctx: RbacContext, ws: {
src/middleware/rbac.ts:243:export function canModifyWorkspace(ctx: RbacContext, ws: {
src/routes/workspaces-api.ts:12:import { extractRbacContext, canAccessWorkspace } from '../middleware/rbac';
src/routes/workspaces-api.ts:132:  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
src/server.ts:19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
src/server.ts:248:  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
src/server.ts:249:  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
tests/middleware/auth.integration.test.ts:26:import { rbacMiddleware, canModifyWorkspace } from '../../src/middleware/rbac';
tests/middleware/auth.integration.test.ts:57:    if (!canModifyWorkspace(ctx, { department: 'default' })) {
tests/middleware/rbac-ga-boundary.test.ts:9:  canAccessWorkspace, canModifyWorkspace, canDownloadRawData,
tests/middleware/rbac-ga-boundary.test.ts:19:  it('isFrozen=true → canAccessWorkspace false', () => {
tests/middleware/rbac-ga-boundary.test.ts:21:    expect(canAccessWorkspace(ctx, {})).toBe(false);
tests/middleware/rbac-ga-boundary.test.ts:26:    expect(canAccessWorkspace(ctx, {})).toBe(true);
tests/middleware/rbac-ga-boundary.test.ts:36:  it('过期合同 → canAccessWorkspace false', () => {
tests/middleware/rbac-ga-boundary.test.ts:38:    expect(canAccessWorkspace(ctx, {})).toBe(false);
tests/middleware/rbac-ga-boundary.test.ts:43:    expect(canAccessWorkspace(ctx, {})).toBe(true);
tests/middleware/rbac.test.ts:2:import { extractRbacContext, canAccessWorkspace, canModifyWorkspace, derivePermissions, BUILTIN_TEMPLATES, type RbacContext } from '../../src/middleware/rbac';
tests/middleware/rbac.test.ts:41:describe('canAccessWorkspace', () => {
tests/middleware/rbac.test.ts:45:    expect(canAccessWorkspace(r('admin'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:46:    expect(canAccessWorkspace(r('admin'), { visibility: 'department', department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:47:    expect(canAccessWorkspace(r('admin'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:51:    expect(canAccessWorkspace(r('liaison'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:52:    expect(canAccessWorkspace(r('liaison'), { visibility: 'department', department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:53:    expect(canAccessWorkspace(r('liaison'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:57:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:61:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'department', department: 'sales' })).toBe(false);
tests/middleware/rbac.test.ts:65:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'global' })).toBe(false);
tests/middleware/rbac.test.ts:69:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'u' })).toBe(true);
tests/middleware/rbac.test.ts:73:    expect(canAccessWorkspace(r('manager', 'marketing'), { visibility: 'private', owner: 'bob' })).toBe(false);
tests/middleware/rbac.test.ts:77:describe('canModifyWorkspace', () {
tests/middleware/rbac.test.ts:81:    expect(canModifyWorkspace(r('admin'), { department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:85:    expect(canModifyWorkspace(r('manager', 'marketing'), { department: 'marketing' })).toBe(true);
tests/middleware/rbac.test.ts:89:    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'u' })).toBe(true);
tests/middleware/rbac.test.ts:93:    expect(canModifyWorkspace(r('manager'), { department: 'sales', owner: 'bob' })).toBe(false);
tests/middleware/rbac.test.ts:97:    expect(canModifyWorkspace(r('liaison'), { department: 'marketing' })).toBe(false);
tests/middleware/rbac.test.ts:109:    expect(canAccessWorkspace(r('ga'), { visibility: 'global' })).toBe(true);
tests/middleware/rbac.test.ts:110:    expect(canAccessWorkspace(r('ga'), { visibility: 'department', department: 'sales' })).toBe(true);
tests/middleware/rbac.test.ts:111:    expect(canAccessWorkspace(r('ga'), { visibility: 'private', owner: 'bob' })).toBe(true);
tests/middleware/rbac.test.ts:115:    expect(canModifyWorkspace(r('ga'), { department: 'marketing' })).toBe(false);
tests/middleware/rbac.test.ts:116:    expect(canModifyWorkspace(r('ga'), { department: 'sales', owner: 'ga_001' })).toBe(false);
```
```
EXIT=0 ｜ COUNT=40
```

### R5 补充：`canModifyWorkspace` 语义（rbac.ts:243-255 原文）
```ts
export function canModifyWorkspace(ctx: RbacContext, ws: {
  visibility?: string; department?: string; owner?: string;
}): boolean {
  const role = ctx.role as string;
  if (role === 'admin') return true;
  if (role === 'manager') {
    return ws.department === ctx.department || ws.owner === ctx.userId;
  }
  if (role === 'ga') return false;
  return false;                     // liaison / staff ⇒ 恒 false
}
```
⇒ **staff / liaison 写操作恒 false**（对 P3 而言：负路径天然成立；可用性风险在 manager 且 `ctx.department` 恒 `undefined`，见 R5-附）。

### R5 附：`extractRbacContext` 原文（rbac.ts:97-120，**JWT 分支 department 恒 undefined**）
```ts
export function extractRbacContext(req: {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  auth?: { sub: string; role: string; orgId: string; gaConstraints?: GAConstraints };
}): RbacContext {
  if (req.auth) {
    return {
      role: req.auth.role as WorkspaceRole,
      department: undefined,          // ← JWT 无部门
      userId: req.auth.sub,
      gaConstraints: req.auth.gaConstraints,
    };
  }
  const token = String((req.headers?.['x-synova-token'] as string) || (req.query?.token as string) || '');
  ...
  return { role: 'admin', userId: DEFAULT_USER };   // ← fail-open 兜底
}
```
命令：
```bash
grep -rn 'department' src/middleware/auth.ts
```
```
COUNT=0
```
```bash
grep -rn "interface JwtPayload" -A 14 src/middleware/auth.ts
```
```
26:export interface JwtPayload {
27-  sub: string;   // userId
28-  role: string;  // WorkspaceRole | 'ga'
29-  orgId: string; // tenant/org ID
30-  iat: number;   // issued at (Unix seconds)
31-  exp: number;   // expires at (Unix seconds)
32-  jti: string;   // JWT ID (唯一，用于撤销)
33-}
```
⇒ **R5「JWT 用户部门级可见性恒 deny」前提成立 ✅**（`JwtPayload` 无 `department`；`auth.ts` 全文 `department` 命中 0）。
⇒ 连带效应（P3 直接受影响的可用性事实）：JWT `manager` 打写端点时 `ctx.department === undefined` ⇒ `canModifyWorkspace` 的 `ws.department === ctx.department` 恒 false ⇒ **manager 仅剩 `ws.owner === ctx.userId` 一条通过路径**。

---

## R6｜tests/routes/ 依赖自报头的构造点（**逐条实测**）

命令（**tests/routes/** 派单口径）：
```bash
grep -rn 'x-synova-token' tests/routes/
```
```
tests/routes/department-workspace.test.ts:29:    const req = { headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} };
tests/routes/diagnosis-report-persistence.test.ts:337:    // （extractAuthFromRequest）。桌面 GA 实际形态 = D556 seed 的 x-synova-token 头
tests/routes/diagnosis-report-persistence.test.ts:341:      headers: { 'x-synova-token': 'ga:org-d593:u1' },
tests/routes/ga-auth.test.ts:7: *   - legacy x-synova-token header 向下兼容路径（middleware/auth 既有语义，提取不回改验证）
tests/routes/ga-auth.test.ts:77:  it('legacy x-synova-token header 路径: ga:org:userId 放行（middleware/auth 既有语义不回改）', async () => {
tests/routes/ga-auth.test.ts:80:    const ok = requireGa(makeReq(undefined, { 'x-synova-token': 'ga:org-d551:ga-legacy' }), res);
tests/routes/overflow.test.ts:72:/** 构造带 JWT auth 的 mock 请求（headers 无 x-synova-token，auth 走 JWT 注入路径） */
```
```
EXIT=0 ｜ COUNT=7
```
**逐文件计数**：
```
tests/routes/department-workspace.test.ts:1
tests/routes/diagnosis-report-persistence.test.ts:2
tests/routes/ga-auth.test.ts:3
tests/routes/overflow.test.ts:1
```
⇒ `tests/routes/` **共 7 处 / 4 文件**（其中 **3 处为注释/用例名**，**4 处为真构造点**）。

命令（**tests/** 全树，复核冻结前提）：
```bash
grep -rn 'x-synova-token' tests/
```
```
tests/middleware/auth.test.ts:383:  it('支持 x-synova-token 向下兼容', () => {
tests/middleware/auth.test.ts:384:    const req = { headers: { 'x-synova-token': 'admin:dev:user1' } };
tests/middleware/auth.test.ts:391:  it('x-synova-token 格式不对时返回 null', () => {
tests/middleware/auth.test.ts:392:    const req = { headers: { 'x-synova-token': 'not-a-valid-format' } };
tests/middleware/auth.test.ts:397:  it('legacy x-synova-token 缺 orgId 段 + SYNOVA_ORG_ID 已配置 → orgId 取配置值（D479）', () => {
tests/middleware/auth.test.ts:402:      const req = { headers: { 'x-synova-token': 'admin::user1' } };
tests/middleware/auth.test.ts:411:      const fallback = extractAuthFromRequest({ headers: { 'x-synova-token': 'admin::user2' } } as never);
tests/middleware/rbac.test.ts:8:  return { headers: { 'x-synova-token': token }, query: {} };
tests/middleware/rbac.test.ts:119:  it('extractRbacContext: JWT auth takes priority over x-synova-token', () => {
tests/middleware/rbac.test.ts:121:      headers: { 'x-synova-token': 'admin:dev:user1' },
tests/routes/department-workspace.test.ts:29:    const req = { headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} };
tests/routes/diagnosis-report-persistence.test.ts:337:    // （extractAuthFromRequest）。桌面 GA 实际形态 = D556 seed 的 x-synova-token 头
tests/routes/diagnosis-report-persistence.test.ts:341:      headers: { 'x-synova-token': 'ga:org-d593:u1' },
tests/routes/ga-auth.test.ts:7: *   - legacy x-synova-token header 向下兼容路径（middleware/auth 既有语义，提取不回改验证）
tests/routes/ga-auth.test.ts:77:  it('legacy x-synova-token header 路径: ga:org:userId 放行（middleware/auth 既有语义不回改）', async () => {
tests/routes/ga-auth.test.ts:80:    const ok = requireGa(makeReq(undefined, { 'x-synova-token': 'ga:org-d551:ga-legacy' }), res);
tests/routes/overflow.test.ts:72:/** 构造带 JWT auth 的 mock 请求（headers 无 x-synova-token，auth 走 JWT 注入路径） */
```
```
EXIT=0 ｜ COUNT=17 ｜ FILES=6
```
**逐文件计数**：
```
tests/middleware/auth.test.ts:7
tests/middleware/rbac.test.ts:3
tests/routes/department-workspace.test.ts:1
tests/routes/diagnosis-report-persistence.test.ts:2
tests/routes/ga-auth.test.ts:3
tests/routes/overflow.test.ts:1
```
⇒ **共 17 处 / 6 文件 ✅ 冻结前提成立。**

### R6-1｜4 个存量路由测试的**身份构造方式**（逐个实证）

| 测试文件 | 构造方式 | 证据 |
|---|---|---|
| `tests/routes/department-workspace.test.ts` | **mock req**（手搓普通对象 + 直取 router stack handler） | `:11-17` `const mod = await import(...)`；`:15` `(router as any).stack?.find(s => s.route?.path === '/dept')`；`:16` `handler = route.route.stack[0].handle`；`:26-29` `const res = { send }; const req = { headers: {...}, query: {} }`；`:30` `await handler(req, res)`。**全程无 express app、无 fetch、无 HTTP** |
| `tests/routes/ga-auth.test.ts` | **mock req**（`makeReq(auth?, headers?)`）+ 直接调 `requireGa(req,res)` | `:13-16` `const mod = await import('../../src/routes/ga-auth'); return mod.requireGa`；`:27-31` `function makeReq(auth?, headers?) { const req = { headers: headers ?? {} }; if (auth !== undefined) req.auth = auth; ... }`；`:18-25` `makeRes()` 手搓 res 捕获 status/json；`:36` `requireGa(makeReq(), res)`。**无 express app、无 fetch** |
| `tests/routes/diagnosis-report-persistence.test.ts` | **createServer + app.listen(0) + 真实 fetch** | `:182-198` `beforeAll(async () => { ... server = app.listen(0); ... })`；`:332` `await fetch(\`${authUrl}${path}\`, { method })`；`:339-342` `await fetch(\`${authUrl}/api/solutions\`, { method:'GET', headers: { 'x-synova-token': 'ga:org-d593:u1' } })`。**真实 HTTP 全链路**（铁律 12） |
| `tests/routes/overflow.test.ts` | **mock req**（`makeReq(overrides)`）+ 直取 handler 调用 | `:77-79` `function makeReq(overrides = {}) { return { headers: {}, params: {}, query: {}, body: {}, ...overrides }; }`；`:92` `findHandler(overflowRoutes, '/api/overflow/simulate', 'post')`；`:94` `handler(makeReq({ body: {...} }), res)`；`:73-75` `makeAuth(orgId)` 直接注入 `auth`。**无 express app、无 fetch**。`:72` 的 `x-synova-token` 仅出现在**注释**中 |

### R6-2｜4 个测试的真实自报头构造点（逐条）

| # | 位点 | 类型 | 是否依赖自报头路径 |
|---|---|---|---|
| 1 | `department-workspace.test.ts:29` | **真构造点** — `req.headers['x-synova-token']='manager:marketing:alice'`（无 `auth`） | **依赖 `department-workspace.ts:13` 的服务端读头**（§R8） |
| 2 | `diagnosis-report-persistence.test.ts:341` | **真构造点** — 真实 HTTP 请求头 `x-synova-token: ga:org-d593:u1`（无 Authorization） | **依赖 `middleware/auth.ts:395`**（PR-1 面；`solutions.ts:32/37/46 → extractAuthFromRequest`） |
| 3 | `ga-auth.test.ts:80` | **真构造点** — `makeReq(undefined, {'x-synova-token': 'ga:org-d551:ga-legacy'})`（显式 `undefined` = 不注入 auth） | **依赖 `middleware/auth.ts:395`**（PR-1 面；`ga-auth.ts:21 → extractAuthFromRequest`） |
| 4 | `overflow.test.ts:72` | **仅注释**（`/** ... headers 无 x-synova-token ... */`）；`:78` 的 `headers: {}` 是**显式不带头** | **不依赖**（断言走 `auth` 注入路径） |

⇒ 派单 §一 对 `tests/routes/` 的「4 文件」属实，但其中**只有 3 处是真构造点**（第 4 处 `overflow.test.ts` 为注释）。
⇒ 归 code-c 的 PR-2 回归面（`PLAN-REV2` §2.1 #8/#9/#10）对应 **3 个真构造点 + 1 个注释位（#11）**。

---

## R7｜将被改路由的「改前」原文（逐块，file:line）

### R7-1 `src/routes/workspaces-api.ts`（写端点 5 处 + 自报头读 1 处）

**① `:55-68` POST `/api/workspaces`（零守卫）**
```ts
router.post('/api/workspaces', (req: Request, res: Response) => {
  const { title, type = 'manual' } = req.body as { title?: string; type?: 'diagnostic' | 'manual' };
  if (!title) return res.status(400).json({ ok: false, error: 'title is required' });

  const id = `ws_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const ws: Workspace = {
    id, title, type, status: 'pending', priority: 'medium',
    visibility: 'global', createdAt: now, updatedAt: now,
  };
  store.set(id, ws);
  log.info({ id, title }, '工作区已创建');
  res.json({ ok: true, workspace: ws });
});
```

**② `:77-104` PUT `/api/workspaces/:id/status`（零守卫）**
```ts
router.put('/api/workspaces/:id/status', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });

  const { status, priority } = req.body as { status?: Workspace['status']; priority?: Workspace['priority'] };
  if (status) {
    // V4.2.3: 状态流转验证 — PRD §8 工作区生命周期
    const validTransitions: Record<string, string[]> = {
      pending: ['analyzing'], analyzing: ['confirmed', 'pending'],
      confirmed: ['executing', 'analyzing'], executing: ['resolved', 'shelved', 'confirmed'],
      shelved: ['pending', 'resolved'], resolved: [],
    };
    const allowed = validTransitions[ws.status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: `无效状态流转: ${ws.status} → ${status}` });
    }
    ws.status = status;
  }
  if (priority) ws.priority = priority;
  ws.updatedAt = new Date().toISOString();
  store.set(id, ws);
  log.info({ id, status }, '工作区状态已更新');
  res.json({ ok: true, workspace: ws });
});
```

**③ `:106-123` POST `/api/workspaces/:id/messages`（零守卫）**
```ts
router.post('/api/workspaces/:id/messages', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });

  const { content } = req.body as { content?: string };
  if (!content) return res.status(400).json({ ok: false, error: 'content is required' });

  // v3.3: 基于工作区上下文的真实回复（替代echo空壳）
  const contextSummary = `工作区"${ws.title}"（类型: ${ws.type}, 状态: ${ws.status}, 优先级: ${ws.priority}）。`;
  let reply: string;
  if (ws.type === 'diagnostic') {
    reply = `${contextSummary}\n\n我分析了你在诊断工作区中的问题"${content.slice(0, 100)}"。...`;
  } else {
    reply = `${contextSummary}\n\n关于"${content.slice(0, 100)}"——...`;
  }
  res.json({ ok: true, reply, workspaceId: ws.id });
});
```

**④ `:144-164` POST `/api/workspaces/:id/sub`（零守卫）**
```ts
router.post('/api/workspaces/:id/sub', (req: Request, res: Response) => {
  const parentId = String(req.params.id);
  const parent = store.get(parentId);
  if (!parent) return res.status(404).json({ ok: false, error: 'parent workspace not found' });

  const { department, title } = req.body as { department?: string; title?: string };
  if (!department || !title) return res.status(400).json({ ok: false, error: 'department and title required' });

  const id = `ws_sub_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const subWs: Workspace = {
    id, title, type: 'manual', status: 'pending', priority: parent.priority,
    department, parentWsId: parentId, owner: 'agent', visibility: 'department',
    source: req.body.agentSuggested ? 'agent_suggested' : 'boss_assigned',
    inheritedContext: `从全局方案"${parent.title}"分配。目标: ${parent.title}。状态: ${parent.status}。`,
    createdAt: now, updatedAt: now,
  };
  store.set(id, subWs);
  log.info({ id, department, parentId }, '子工作区已创建');
  res.json({ ok: true, workspace: subWs });
});
```

**⑤ `:221-234` PUT `/api/workspaces/:id/merge`（零守卫）**
```ts
router.put('/api/workspaces/:id/merge', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws || !ws.parentWsId) return res.status(400).json({ ok: false, error: 'not a sub-workspace' });

  const parent = store.get(ws.parentWsId);
  if (!parent) return res.status(404).json({ ok: false, error: 'parent not found' });

  ws.status = 'resolved';
  ws.updatedAt = new Date().toISOString();
  store.set(id, ws);
  log.info({ id, parentId: ws.parentWsId }, '子工作区方案已汇入全局');
  res.json({ ok: true, workspace: ws, parentTitle: parent.title });
});
```

**⑥ `:176-192` GET `/api/workspaces/mine` — 自报头读点（P0 路由侧）**
```ts
router.get('/api/workspaces/mine', (req: Request, res: Response) => {
  // Phase 1: 从 token 获取角色 (Phase 2: JWT)
  const token = String(req.headers['x-synova-token'] || '');
  const role = token.includes('admin') ? 'admin' : token.includes('liaison') ? 'liaison' : 'manager';
  const dept = token.split(':')[1] || '';

  let list: Workspace[];
  if (role === 'admin' || role === 'liaison') {
    list = Array.from(store.values());
  } else {
    list = Array.from(store.values()).filter(w =>
      w.department === dept || w.owner === token.split(':')[2] || w.visibility === 'global',
    );
  }
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ ok: true, workspaces: list, role, department: dept });
});
```
**注意**：`:179` 的角色判定是**未认证默认 `manager`**（非 deny）；`:180` 部门直接取自报串第 2 段。

**⑦ 现存唯一守卫位 `:126-139` GET `/api/workspaces/:id/context`**（作为 P3 守卫写法的**现有参照**）
```ts
router.get('/api/workspaces/:id/context', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ws = store.get(id);
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' });
  // RBAC: 验证请求者是否有权限访问此工作区
  const ctx = extractRbacContext(req);                     // ← 直接重算，不读 req.rbac
  if (!canAccessWorkspace(ctx, { visibility: ws.visibility, department: ws.department, owner: ws.owner })) {
    return res.status(403).json({ ok: false, error: 'access denied' });
  }
  ...
});
```

### R7-2 `src/routes/department-workspace.ts`（全文 121 行；仅 3 行涉事）

**改前 `:1-15`**（文件头自述 + 自报头读点）
```ts
/**
 * department-workspace.ts — 部门独立工作区 (PRD v1.6 Slice 7)
 * GET /dept → 部门总监视角的独立工作区列表 + 对话
 *
 * @deprecated — D74 工作台数据 API (routes/workspace-data.ts) 已替代此路由。
 *   旧代码保留不动，D77b 时统一删除。不修改此文件。
 */
import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/dept', (_req: Request, res: Response) => {
  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
  const d = token.includes(':') ? token.split(':')[1] : '';
  const dept = d || 'dept';
```
**⚠️ R6 冲突**：文件头 `:6` 明写 **「不修改此文件」**，但 `PLAN-REV2` §2.1 #5 把它列为 code-c 写集。CTO 裁定（REV-0 R6）= **只删自报头 + 行内注明**，未裁掉该文件 ⇒ 按 REV-2 执行；本侦察**不改文件**，仅登记冲突已由 CTO 裁定覆盖。

**改前 `:72-76`**（页内 client JS 自发送自报头）
```
<script>
const API='';const DEPT='${dept}';let current=null;
async function loadWs(){
  try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
```
⇒ `:75` 是**「自发 manager 身份打自己 API」**（`PLAN.md` F6 已登记）。删自报头后此行的头**同时失效**（`/api/workspaces/mine` 不再读头，见 R7-1⑥）。

### R7-3 `src/routes/documents.ts`（`:82-104` / `:108-129`，两处空条件）

**改前 `:82-104` GET `/api/documents/list`**
```ts
router.get('/api/documents/list', (_req: Request, res: Response) => {
  try {
    const store = getStore();
    const { results } = store.search('', { conditions: [] }, 100);     // ← :85 空条件
    // 按 source_id 去重，每个文档只返回一条
    const seen = new Set<string>();
    const docs = results.filter(r => {
      const docId = r.sourceId.split('#')[0];
      if (seen.has(docId)) return false;
      seen.add(docId);
      return true;
    }).map(r => ({ docId: r.sourceId.split('#')[0], sourceType: r.sourceType, createdAt: r.createdAt }));

    res.json({ ok: true, documents: docs, count: docs.length });
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文档存储获取");
    res.json({ ok: true, documents: [], count: 0 });                   // ← 降级（非 degraded:true 标记）
  }
});
```
**改前 `:108-129` GET `/api/documents/:id`**
```ts
router.get('/api/documents/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const store = getStore();
    const { results } = store.search(id, { conditions: [] }, 50);      // ← :112 空条件
    const chunks = results
      .filter(r => r.sourceId.startsWith(id))
      .map(r => ({ chunkId: r.id, index: parseInt(r.sourceId.split('#')[1] || '0', 10),
                   text: r.text.slice(0, 500), createdAt: r.createdAt }))
      .sort((a, b) => a.index - b.index);

    if (chunks.length === 0) return res.status(404).json({ ok: false, error: '文档未找到' });
    res.json({ ok: true, docId: id, chunkCount: chunks.length,
               totalBytes: chunks.reduce((s, c) => s + c.text.length, 0), ... });
```
**关键**：`documents.ts` **全文零 import `services/request-context`**（imports 仅 3 行，见 `:1-14`）⇒ P2 收口需**新增 import** `getCurrentFilterClause` 并把它替换为 `{ conditions: [] }`。两处 handler 均为 `try/catch` + `log.warn`（符合铁律 24 的 log 要求，但降级体**未带 `degraded: true` 字段**，属存量）。

**改前 `:1-14`**（imports，证明零漏斗引用）
```ts
/**
 * routes/documents.ts — 文档管理 API (KnowledgeAgent ④ 文档规范化)
 * POST /api/documents/upload — 上传文档 → 规范化 → 分块 → FTS5索引
 * GET  /api/documents/list   — 列出已索引文档
 * GET  /api/documents/:id    — 获取文档详情和分块
 */
import { Router, type Request, type Response } from 'express';
// D603 跨层修复（簇3）: KnowledgeStore 构造下沉 L2 桥接服务——不直触 init/engine-context（铁律 39）
import { createSystemKnowledgeStore, type KnowledgeStore } from '../agent/knowledge-bridge-service';
import { createLogger } from '@synova/logger';
```

### R7-4 `src/services/request-context.ts`（全文 43 行，一次贴全）

**改前 `:38-43`**
```ts
/** L3 调用: 生成当前用户的权限过滤条件 */
export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
  const ctx = storage.getStore();
  if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };      // ← :41 空条件兜底
  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
}
```
**上下文（`:23-43` 全部导出面，供 P2 契约核对）**
```ts
/** L1 调用: 设置当前请求的上下文 */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> { return storage.run(ctx, fn); }
/** L3 调用: 获取当前请求的用户身份 */
export function getCurrentUser(): UserContext | undefined { return storage.getStore()?.user; }
/** L3 调用: 获取当前请求的 AuthProvider */
export function getCurrentAuthProvider(): AuthProvider | undefined { return storage.getStore()?.authProvider; }
```
`RequestContext`/`AuthProvider`/`FilterClause` 均为**文件内联类型**（`:11-21`，注释明写「避免跨包 tsc 路径解析问题」）⇒ 改 `FilterClause` 形态会**同时约束 `auth.ts:355` 与 `auth.ts:13`(接口)**。

---

## R8｜`department-workspace.ts` 自报头下线后**会变红的现有断言**（逐条 file:line）

被测文件：`tests/routes/department-workspace.test.ts`（全 44 行）。构造方式 = **mock req + 直取 handler**（R6-1）。

| 用例 | 断言（file:line） | 现状 | 下线后 | 判定 |
|---|---|---|---|---|
| `:23` `it('GET /dept 返回HTML含部门名')` | `:29` 构造 `req = { headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} }` | `dept='marketing'`（走 `:13` 读头 → `:14` 取第 2 段） | `:13` 删头后 `dept` 不再从自报串取（回落 `'dept'`） | **构造点失效** |
| 同上 | **`:32` `expect(html).toContain('marketing')`** | 绿（HTML 内 `marketing部`） | **红** — HTML 内将无 `marketing` | **🔴 预测变红（唯一）** |
| 同上 | `:31` `expect(html).toContain('<!DOCTYPE html>')` | 绿 | 绿（与身份无关） | 不变 |
| 同上 | `:33` `expect(html).toContain('workspace-list')` | 绿 | 绿（与身份无关） | 不变 |
| `:36` `it('GET /dept 默认department为dept')` | `:40` 构造 `req = { headers: {}, query: {} }` | `dept='dept'`（`d=''` → 回落） | `dept='dept'`（同一回落） | 不变 |
| 同上 | `:42` `expect(html).toContain('dept')` | 绿 | **绿**（该用例本就无自报头） | 不变 |
| `:19` `it('模块导出Router')` | `:20` `expect(router).toBeDefined()` | 绿 | 绿 | 不变 |

**结论**：`department-workspace.ts` 自报头下线后，现有测试中**恰 1 条断言变红 —— `tests/routes/department-workspace.test.ts:32`**（另 `:29` 的构造点随之失效，但其断言 `:31/:33` 仍绿）。
⇒ 该文件已在 `PLAN-REV2` §2.1 **#8（code-c 写集）**内，红腿有主。**修复方向不由本侦察裁定**（属实施内容）。

**附：`department-workspace.ts:75`（页内 JS 自发送）无任何测试覆盖** —— `grep -rn "manager:'+DEPT" tests/` 零命中（见下方 R8-附命令输出为空）。

### R8-附｜补充命令原始输出

```bash
grep -rn "manager:'+DEPT" tests/
```
```
(无输出)
EXIT=1
```
```bash
grep -rn "manager:marketing:alice" tests/ src/
```
```
tests/middleware/rbac.test.ts:19:    const ctx = extractRbacContext(mockReq('manager:marketing:alice') as any);
tests/routes/department-workspace.test.ts:29:    const req = { headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {} };
```
```
EXIT=0 ｜ COUNT=2  （另 1 处在 tests/middleware/rbac.test.ts:19，归 PR-1 / code-a）
```

---

## 9｜装配顺序（P3 的实施前置，load-bearing 实测事实）

命令：
```bash
grep -n "rbacMiddleware\|jwtAuthMiddleware\|app.use" src/server.ts
```
（**共 63 处**，全文已捕获；下述为与 P3/P4 直接相关的位点）

```
  19:import { rbacMiddleware, extractRbacContext, canAccessWorkspace, canModifyWorkspace } from './middleware/rbac';
  20:import { jwtAuthMiddleware } from './middleware/auth';
 345:  app.use(jwtAuthMiddleware);
 370:  app.use(workspacesApiRoutes);
 373:  app.use(rbacMiddleware);
 374:  app.use(deptWorkspaceRoutes);
```

⇒ **实测顺序：`jwtAuthMiddleware`(345) → `workspacesApiRoutes`(370) → `rbacMiddleware`(373) → `deptWorkspaceRoutes`(374)。**

**两条直接结论（供 PR-2 实施，均为物理事实非推断）**：
1. **`workspaces-api.ts` 今天拿不到 `req.rbac`** —— 它挂在 `rbacMiddleware`(373) **之前**。所以 `workspaces-api.ts:131` 只能自己 `extractRbacContext(req)` 重算。P3 若照抄该写法（R7-1⑦），守卫语义**完全等于 PR-1 后 `extractRbacContext` 的 JWT 分支 + 兜底分支** —— 与 `rbacMiddleware` 前移（P4）**无耦合**。
2. **`deptWorkspaceRoutes`(374) 挂在 `rbacMiddleware`(373) 之后** ⇒ 该路由**已有** `req.rbac` 可读。（但它是 `@deprecated` 文件，R6 裁定只删自报头。）

`src/server.ts:244-249`（P7 目标：硬编码 `'admin::dev'` 自欺块，**结果被 `void` 丢弃 ⇒ 净生产行为 = 0**）：
```ts
  // PRD v1.6 Slice 7: workspace-service 接线
  buildInheritedContext({ parentId: 'init', department: 'dept', title: 'init', source: 'boss_assigned', parentSummary: 'init' });
  detectConflicts([]); // Slice 7 冲突检测初始化
  const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
  void canAccessWorkspace(rbacCtx, { visibility: 'global' });
  void canModifyWorkspace(rbacCtx, { visibility: 'global' });
```
⇒ `server.ts` = **code-b 单写者**（`PLAN-REV2` §2.1 #1），**不属 code-c 写集**。

---

## 10｜侦察发现汇总（**供 CTO / 队长裁定，本件不自裁**）

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| **D-1** | 派单 R1 把 `request-context.ts:41` 列为「自报头已知位点」，实测**该位点是 `conditions: []` 位点**，R1 命令下不出 | §R1（COUNT=3，无 request-context.ts）+ §R2（COUNT=4，含 :41） | 口径混记；**不影响写集**（两条都在 code-c 内） |
| **D-2** | `rbac.ts:110` 自报头 + `query.token` **双通道**，且 `:119` 无凭据兜底 = **`role:'admin'`（fail-open）** | §R1 扩展面 + §R5-附原文 | `rbac.ts` = **PR-1 / code-a 写集**。P3 若照抄 `workspaces-api.ts:131` 的 `extractRbacContext(req)`，守卫强度**被 PR-1 的兜底形态直接决定** ⇒ P3 的期望值必须与 PR-1 契约对齐 |
| **D-3** | `workspacesApiRoutes`(370) **早于** `rbacMiddleware`(373) ⇒ `workspaces-api.ts` 内 **`req.rbac` 不存在** | §9 | P3 写守卫时**不能**依赖 `req.rbac`（除非 P4 前移生效）；两条实现路径（重算 vs 读 `req.rbac`）语义不同，**需队长/CTO 明确** |
| **D-4** | `tests/routes/` 的「4 文件」中，`overflow.test.ts:72` 是**注释**、`:78` 是**显式不带头** ⇒ 真构造点 3 处非 4 处 | §R6-2 | `PLAN-REV2` §2.1 #11（`overflow.test.ts`）**不会被 P0 打红**；归因需澄清（是预防性纳入还是另有红了的原因） |
| **D-5** | `department-workspace.ts:6` 自述「**不修改此文件**」，但 `:374` 仍挂载且列 code-c 写集 | R7-2 + §9 | CTO REV-0「R6 ✅ 只删自报头 + 行内注明」已裁定；登记冲突已被覆盖 |
| **D-6** | JWT `manager` 写工作区时 `ctx.department === undefined` ⇒ `canModifyWorkspace` 部门分支恒 false，**仅剩 owner 一条通过路径** | §R5-附 + R5 补充 | 与 REV-8 登记的「部门级可见性恒 deny」**同源**；P3 夹具若期望「本部门 manager → 200」，需以 `owner === userId` 构造，否则**会红且非缺陷** |
| **D-7** | `department-workspace.ts:75` 页内 JS 自发送自报头 **零测试覆盖** | §R8-附（`grep` EXIT=1，无输出） | 删头后有**无测试守护的静默行为变化**；P0 回归面不含此点 |
| **D-8** | `request-context.ts:42` 的 `action` **硬编码 `'read'`**；`:13` 接口 3 参，但生产实现 `auth.ts:355` 忽略全部入参 | §R2 漏斗两端 | P2 收口（`:41`）若只改兜底分支而不动 `auth.ts:355`，**`conditions: []` 仍在**（P2 判据要求 `src/` 全零）⇒ **P2 达成必须跨 PR-1/PR-2 两批** |

## 11｜冻结前提复核表（逐条）

| 前提（队长实测） | 本侦察复核 | 结论 |
|---|---|---|
| F8 `documents.ts:85/:112` 两处空过滤条件 | §R2 `:85`/`:112` 命中 | ✅ 成立 |
| `services/request-context.ts:41` 存在 | §R2 `:41` 命中（原文 `if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };`） | ✅ 成立 |
| P3 五个写端点行号 | §R3 `:55`/`:77`/`:106`/`:144`/`:221` 5/5 | ✅ 成立 |
| `tests/` 中 `x-synova-token` 共 17 处 / 6 文件 | §R6 COUNT=17 FILES=6 | ✅ 成立 |
| R5「JWT 用户部门级可见性恒 deny」 | §R5-附：`JwtPayload` 无 `department`；`auth.ts` `department` 命中 0；`rbac.ts:105 department: undefined` | ✅ 成立（功能回退登记见 `PLAN-REV2` REV-8） |

## 12｜产出与护栏回执

- **本件**：`docs/synova/product-lines/evidence/D947-20260924/D947-code-c-recon.md`（唯一写集，已被 `task-3` 的 `writeScopes` 声明）
- **收尾回执（写完后复测，命令原始输出）**：
```bash
wc -l docs/synova/product-lines/evidence/D947-20260924/D947-code-c-recon.md
```
```
861 docs/synova/product-lines/evidence/D947-20260924/D947-code-c-recon.md
```
```bash
git diff --stat
```
```
(空)
DIFF_EXIT=0
```
```bash
git status --porcelain
```
```
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
```
```
EXIT=0
```
- **未改**：`src/**` 0 文件 · `tests/**` 0 文件 · `git diff --stat` 空（§0）
- **未执行**：`git add` / `git commit` / `git push`（0 次）
- **未跑**：`vitest`（PR-1 期间重型验证由 code-a 占用，遵守「同一时间 ≤1」）· 未跑 `tsc` · 未跑门禁
- **临时产物**：仅 `$env:TEMP\d947c_r*.sh`（脚本本体）+ 去 CRLF/BOM 副本；**无仓内临时产物**
- **本件性质**：**侦察证据**。**不构成自验结论，不判「通过」**。`可提请独立审计` / `退回` 归队长与 CTO 收件闸。

### 建议的下一步（待队长 go 信号）
1. 消除 **D-2 / D-3** 两条口径歧义（P3 守卫写法的取数路径）—— 属**接口裁决**，需队长与 PR-1 侧（code-a）对齐后再开工。
2. `PLAN-REV2` §2.1 #11（`overflow.test.ts`）归因澄清（**D-4**）。
3. P3 夹具期望值设计需吸收 **D-6**（JWT manager 无部门）以避免「红而非缺陷」。
