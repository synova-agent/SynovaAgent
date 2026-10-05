# D947 PR-2b 实施证据 — 路由层收口 + P3 写端点守卫 + 漏斗 fail-closed

> **任务**：`task-7`（写者 code-c）｜**阶段**：PR-2b 实施（CTO 执行序第 4 步）
> **工作树**：`D:\novis-backup-20260526\Novis\synova-agent\.synova-wt-d947-middleware`（钉死，未复用他人工作树）
> **分支 / HEAD**：`feat/d947-middleware-default-posture` @ `db54b926dde6cf42d02ded2d293c8caf579b8dc4`
> **前置**：PR-1 = commit `77e0d6aa`（8 文件）已闭环；冻结事实源 = `D947-RULINGS.md`（全文已读）
> **本件性质**：**实施完成 + 局部自验证据**。给「**可提请独立审计**」并附未清项；**不判「通过」**。

---

## 0. 写集与产出（7 文件，逐文件声明）

| # | 文件 | 状态 | diff |
|---|---|---|---|
| 1 | `src/routes/workspaces-api.ts` | M | +125 / −? |
| 2 | `src/routes/department-workspace.ts` | M | +22 |
| 3 | `src/routes/documents.ts` | M | +17 |
| 4 | `src/services/request-context.ts` | M | +48 |
| 5 | `tests/routes/workspace-access-write-endpoint.test.ts` | **新建** | 528 行 |
| 6 | `tests/routes/department-workspace.test.ts` | M | +105 |
| 7 | `tests/routes/overflow.test.ts` | M | +18 |

```bash
git diff --stat -- <我的 6 个存量文件>
```
```
 src/routes/department-workspace.ts        |  22 +++++-
 src/routes/documents.ts                   |  17 +++-
 src/routes/workspaces-api.ts              | 125 +++++++++++++++++++++++++++---
 src/services/request-context.ts           |  48 +++++++++++-
 tests/routes/department-workspace.test.ts | 105 ++++++++++++++++++++-----
 tests/routes/overflow.test.ts             |  18 ++++-
 6 files changed, 294 insertions(+), 41 deletions(-)
```

**写集外零改动证明**（`src/server.ts` 的 `M` = code-b 单写者，非我）：
```bash
git status --porcelain
```
```
 M src/routes/department-workspace.ts
 M src/routes/documents.ts
 M src/routes/workspaces-api.ts
 M src/server.ts                      ← code-b（单写者，我 0 行触碰）
 M src/services/request-context.ts
 M tests/routes/department-workspace.test.ts
 M tests/routes/overflow.test.ts
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
?? tests/routes/middleware-order.test.ts                          ← code-b
?? tests/routes/workspace-access-write-endpoint.test.ts           ← 我的新建
```
⇒ **无写集外改动、无污染、无残留**（污染坑规避：只跑显式路径，未跑全量套件）。

**最终 md5（供 K3 核对）**：
```
4dae5c19960096a6a0763272f6faed9d *src/routes/workspaces-api.ts
30a115c4ec837055ecf06148af968a81 *src/routes/department-workspace.ts
20e469eeeececd915440c97e0c8afdef *src/routes/documents.ts
c102fa98efedbddf82fd06c026488b15 *src/services/request-context.ts
afba95e05d8cbb587f400bc45b721d57 *tests/routes/workspace-access-write-endpoint.test.ts
0bcd7ffb4ba30f38df14380cbf4d9ca6 *tests/routes/department-workspace.test.ts
20845d7acd8074f8fe5d395bd54d4266 *tests/routes/overflow.test.ts
```

---

## 1. 前置复核（自测，非转述）

```bash
grep -n 'app.use(rbacMiddleware)' src/server.ts
```
```
366:  app.use(rbacMiddleware);
```
```bash
grep -nE 'app\.use\((jwtAuthMiddleware|rateLimitMiddleware|rbacMiddleware|homeRoutes|workspacesApiRoutes)\)' src/server.ts
```
```
344:  app.use(jwtAuthMiddleware);  352:  app.use(rateLimitMiddleware);  366:  app.use(rbacMiddleware);
376:  app.use(homeRoutes);  380:  app.use(workspacesApiRoutes);
```
⇒ **L=366 ∈ [357,366]（L-2 冻结区间）成立**；I4 成立（jwtAuth 344 < rbac 366）；rbac 早于 `workspacesApiRoutes`(380) ⇒ 我的 P3 守卫可读到 `req.rbac`。

⚠️ **卡面字面 vs 裁定字面的不一致（登记）**：task-7 卡面写「`L < 366`」，而 `RULINGS` L-2 的冻结区间是**闭区间 [357,366]**（并给出 `L ≥ 367 → homeRoutes 落到 rbac 之前 → 退`）。实得 `L = 366` ⇒ **满足 L-2，不满足卡面字面**。按「凡本件与派单原文不一致处以 CTO 裁定为上位」判定为**卡面字面过期**，不阻塞；登记供 CTO 校正卡面。

```bash
grep -nE 'void +(canAccessWorkspace|canModifyWorkspace)' src/server.ts   # exit=1，共 0 处
grep -rn "'admin::dev'" src/                                            # exit=1，共 0 处
```
P4 判别谓词（前移后）：
```
322:  app.use(setupGuideGoneRouter);  340:  app.use(llmConfigRoutes);  343:  app.use(uploadV2GoneRouter);
347:  app.use(authRoutes);            355:  app.get('/api/status/budget', ...
COUNT=5
```

---

## 2. 改动逐条（改前 / 改后 + 行号）

### 2.1 `src/routes/workspaces-api.ts` — P0（路由侧）+ P3（整条）

**① 新增守卫基建（:21-59）**：`readRbac(req)`（**只**读 `req.rbac`，契约 JSDoc 见文件）、`denyWorkspaceWrite(res, reason, rbac)`（403 + `log.warn` 三态留痕）、`requireVerifiedRbac(req, res)`（无验签身份 → 写 403 并返回 `undefined`，令调用方 `if (!rbac) return;` ⇒ 判据**从不被丢弃**，且 TS 正确收窄）。

**② 5 个写端点全部落守卫**（`grep -c "canModifyWorkspace(rbac"` = **5**）：

| 端点 | 改前行 | 改后行 | 判据绑定 |
|---|---|---|---|
| `POST /api/workspaces` | 99 | 101-107 | `{ owner: rbac.userId }`（无既有目标） |
| `PUT /api/workspaces/:id/status` | 133 | 135-146 | `{ department: ws.department, owner: ws.owner }` |
| `POST /api/workspaces/:id/messages` | 170 | 172-183 | 同上（目标工作区） |
| `POST /api/workspaces/:id/sub` | 219 | 221-232 | `{ parent.department, parent.owner }`（改的是**父**） |
| `PUT /api/workspaces/:id/merge` | 320 | 322-333 | `{ ws.department, ws.owner }`（被汇入的**子**） |

**③ owner 来源改为验签身份（P0/P3 所必需）**
- `POST /api/workspaces`：`ws.owner` 由**无**（原实现下 `owner` 根本未赋值）改为 `owner: rbac.userId`。
- `POST /api/workspaces/:id/sub`：`owner: 'agent'`（字面量）→ `owner: rbac.userId`。
- 理由（行内已注明）：字面量 owner 无法被任何验签身份匹配 ⇒ `canModifyWorkspace` 的 `ws.owner === userId` 分支对该资源恒不成立 ⇒ 资源创建即成"只有 admin 能碰"的死资源；且 `/mine` 的非管理员过滤（`w.owner === userId`）同样失去判据。

**④ `GET /api/workspaces/mine`（P0 活越权读）— 改前 / 改后**
```ts
// 改前（workspaces-api.ts:176-189 @ HEAD 之前的树）
const token = String(req.headers['x-synova-token'] || '');
const role = token.includes('admin') ? 'admin' : token.includes('liaison') ? 'liaison' : 'manager';
const dept = token.split(':')[1] || '';
...
  list = Array.from(store.values()).filter(w =>
    w.department === dept || w.owner === token.split(':')[2] || w.visibility === 'global');
```
```ts
// 改后（workspaces-api.ts:274-290）
const rbac = requireVerifiedRbac(req, res);
if (!rbac) return;                       // 无验签身份 → 403 fail-closed（不默认 manager）
const role = rbac.role;
const dept = rbac.department;            // R5/REV-8: JWT 无 department ⇒ 恒 undefined
const userId = rbac.userId;
...
  list = Array.from(store.values()).filter(w =>
    w.department === dept || w.owner === userId || w.visibility === 'global');
```
**此改动为写集内新增的 P0 活越权读实例**（由 code-a 上报、队长指定必须一并修，单列见 §5 红证）。

### 2.2 `src/services/request-context.ts` — P2 漏斗兜底（L-21）

```ts
// 改前（:39-43）
export async function getCurrentFilterClause(resourceType: string): Promise<FilterClause> {
  const ctx = storage.getStore();
  if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };      // ← fail-open
  return ctx.authProvider.getPermissionFilter(ctx.user, resourceType, 'read');
}
```
```ts
// 改后（:63-84）
const DENY_ALL_FIELD = '__d947_no_authenticated_context';
const DENY_ALL_SENTINEL = '__d947_deny_all__';
...
  if (!ctx?.user || !ctx?.authProvider) {
    log.warn({ code: 'RBAC_DENIED', resourceType, reason: 'no_request_context' },
      '安全判据: 被拒绝 — 无请求上下文（漏斗兜底 fail-closed，返回拒绝型非空条件集）');
    return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] };
  }
```
**deny-all 机制**：字段名不存在于任何知识块的权限列 ⇒ `l4/knowledge-store.ts:712` 的 `row[col]` 恒 `undefined`，`EQ` 与哨兵值比较恒 false ⇒ 每行判 false（检索结果为空）；且**非空** ⇒ 不会命中 `:195/:335` 的 `length===0` 短路。

**附带类型收窄（`FilterClause.operator`）**：`string` → `'IN' | 'EQ' | 'NOT_EQ' | 'CONTAINS'`（与 `l4/knowledge-store.FilterClause` **结构等价**）。
触发原因（tsc 实证）：不改则 `documents.ts` 出现
```
src/routes/documents.ts(91,42): error TS2345: Argument of type 'FilterClause' is not assignable to
  parameter of type '...knowledge-store".FilterClause
```
⇒ 类型级漏斗失守（必须在调用点写断言才能过）。收窄后该错误消失，`documents.ts` **零断言**直通 L4 引擎。（守卫端 `auth.ts:450` 的 `operator: 'IN'` 经上下文类型收窄，未产生新错误 — 见 §4 tsc。）

### 2.3 `src/routes/documents.ts` — P2 收口（两处）

```ts
// 改前
const { results } = store.search('', { conditions: [] }, 100);   // :85
const { results } = store.search(id, { conditions: [] }, 50);    // :112
```
```ts
// 改后（handler 改 async；过滤条件来自唯一漏斗）
import { getCurrentFilterClause } from '../services/request-context';       // :14
const filter = await getCurrentFilterClause('KnowledgeChunk');              // :90 / :119
const { results } = store.search('', filter, 100);                          // :91
const { results } = store.search(id, filter, 50);                           // :120
```

### 2.4 `src/routes/department-workspace.ts` — P0（R6：只删自报头 + 行内注明）

```ts
// 改前（:12-15）
router.get('/dept', (_req: Request, res: Response) => {
  const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
  const d = token.includes(':') ? token.split(':')[1] : '';
  const dept = d || 'dept';
```
```ts
// 改后（:18-24）
router.get('/dept', (_req: Request, res: Response) => {
  // D947 R6: 原自报身份读取已删除（不得从 x-synova-token / query.token 派生部门）。
  //   删除前: const token = String(_req.headers['x-synova-token'] || _req.query.token || '');
  //   删除后: 仅保留常量兜底（JWT 载荷无部门字段，见 R5 / REV-8 已登记功能回退）。
  const dept = 'dept';
```
```js
// 改前（:75，页内 client JS 自发送自报头）
try{const r=await fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}});const d=await r.json();
```
```js
// 改后（:89）
try{const r=await fetch(API+'/api/workspaces/mine');const d=await r.json();
```
未重启设计；文件头「不修改此文件」的自述冲突按 L-10 登记在案。

---

## 3. 夹具与 N1 硬前置

### 3.1 N1（硬前置，缺即判空转）
`workspace-access-write-endpoint.test.ts` / `department-workspace.test.ts` / `overflow.test.ts` **各**在 `beforeAll` 首部：
```ts
process.env.JWT_SECRET = 'd947-test-secret-0123456789';
process.env.DEV_MODE = 'false';
expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
expect(process.env.DEV_MODE).toBe('false');
```
`department-workspace.test.ts` 与 `overflow.test.ts` 的 N1 **仅起环境断言作用**（两者均非 HTTP 夹具，不依赖 JWT）——按要求「你碰的每个夹具都加」，非空转凑数。

### 3.2 P3 夹具形态（禁 grep 型静态判据）
`createServer()` + `server.listen(0)` + **真实 fetch**（先例 `tests/routes/llm-config.test.ts`）；身份 = `signJwtToken` 真实签名 JWT；夹具自带 `owner`/`department` 属性前置自证（避免静默构造错）。
**显式 `hookTimeout`**：`beforeAll(..., 60_000)` —— 本机 `createServer()` bootstrap 实测 ≈10–12s > vitest 默认 10s ⇒ 否则 `Hook timed out` 假红（实测已复现一次，见 §6 过程记录）。超时是**执行预算**，N1 与全部用例断言未削弱。

### 3.3 用例矩阵（28 例，全绿）
- **P3 写端点**（真打 HTTP）：`POST /api/workspaces` staff/ga→403、admin→200（owner 验签）、无凭据→401；`:id/status` owner manager→**200**（L-6 唯一通过路径）、非属主 manager 打部门级→**403**（R5/REV-8 已裁定功能回退）、ga→403、staff→403、无凭据→401；`:id/messages` staff→403、owner→200；`:id/sub` staff/ga→403、父属主→200（子 owner 取验签身份）；`:id/merge` staff/ga→403、子属主→200。
- **P0 `/mine`**（直接 handler 运行时探针，见 F-1）：低权 + 自报 `admin` 头 → `role='staff'` 且**不含**任何部门级工作区；无自报头 → `role='staff'`（**不得** manager）；对照 admin → 含部门级；无 `req.rbac` → **403**；`authenticated=false` → **403**；HTTP 无凭据 → 401。
- **L-21 漏斗兜底**：无上下文 → 条件集**非空**；喂入真实 `KnowledgeStore`（真 SQLite + 真 `matchFilter`）→ `totalHits=2 / filteredOut=2 / results=0`（**deny-all**）；对照（`runWithContext` + 真 authProvider 形态）→ `filteredOut=1`、仅 `normal` 放行。
- **F-2 裁定后契约断言**（L-31 采 (甲)）：见 §7。

---

## 4. 验证证据（命令 + 退出码 + 完整输出）

### 4.1 vitest（最终轮）
```bash
npx vitest run tests/routes/workspace-access-write-endpoint.test.ts \
  tests/routes/department-workspace.test.ts tests/routes/overflow.test.ts
```
```
VITEST_EXIT=0
 ✓ tests/routes/department-workspace.test.ts (5 tests) 382ms
 ✓ tests/routes/overflow.test.ts (6 tests) 31ms
 ✓ tests/routes/workspace-access-write-endpoint.test.ts (28 tests) 11787ms

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Duration  17.61s
```
（重型验证互斥：全程 `/tmp/d947-heavy.lock`（`mkdir` 原子锁 + 跑完 `rm -f owner` 后 `rmdir` 释放）；同一时间 ≤1。）

### 4.2 tsc（型检）
```bash
npx tsc --noEmit
```
```
TSC_EXIT=2 ｜ total_error_lines=33
--- 我的写集 + tests 的错误 --- (无输出)  myerrors_grep_exit=1
--- 涉及文件（去重）---
extensions/sentinels/_extinct/{adaptation-velocity,capital-efficiency,capital-structure,capital-turnover,
  competitive-dynamics,competitive-moat-perceptual,competitive-moat-structural,connector-coverage,
  market-lifecycle,structural-change}/aggregate.ts   (10 文件)
src/connectors/ima.ts
src/mcp/index.ts
src/mcp/tool-definitions.ts
src/server.ts
```
⇒ **我的 7 文件 + tests 零错误**。剩余 33 行全部落在域外（`_extinct` 存量 / MCP SDK 缺失 / `ima.ts` / `server.ts:473-474`）。
`src/server.ts:473-474` 的**预存在性证明**：该两行区域在 HEAD 与工作树**逐字节相同**（code-b 的 diff hunk 仅在 19/247/365/373 四处）⇒ 与本卡无关的基线错误。

### 4.3 判据 grep（CTO/RULINGS 冻结口径）
```
P2  conditions: [] in src/ --include=*.ts   → 共 0 处   （P2_COUNT=0）
P7  "admin::dev" in src/ --include=*.ts     → 共 0 处   （exit=1）
P7  "manager:'+DEPT" in department-workspace.ts → 共 0 处（exit=1）
P0  自报身份代码位（值当身份来源）routes/ + services/ → 共 0 处（仅注释，见 §5.3）
L-4 "rbac?: RbacContext" in workspaces-api.ts → 命中（req.rbac 单一取数口）
P3  canModifyWorkspace(rbac 调用 = 5（＝5 个写端点）
     requireVerifiedRbac(req, res) 调用点 = 6（5 写 + /mine；第 7 处命中是 JSDoc 文本）
```
⇒ **P2 全局 = 0 已达成**（PR-1 清 `auth.ts` 1 处 + 本批清 `:85/:112/:41` 3 处）—— 依 **L-12**：该结论**跨两批**才成立，任一批**不得单独**声称 "P2 已完成"。

### 4.4 无残留 / 无污染
```bash
grep -rn "MUTANT" src/ tests/     → exit=1（共 0 处）
git status --porcelain            → 见 §0（无写集外改动、无新污染文件）
md5sum（7 文件）                    → 见 §0
```

### 4.5 L-15 登记：注释被改写以避开判据字面量（防「消音凑绿」之嫌，**必带**）
| 位置 | 改写前（原文） | 改写后 |
|---|---|---|
| `documents.ts:12` | `//   修复前本文件两处读端点写死 \`{ conditions: [] }\`；实测 …` | `//   修复前本文件两处读端点写死空条件集字面量；实测 …` |
| `department-workspace.ts:84` | `// … 原页内 fetch 自带自报头 headers:{'x-synova-token':'manager:'+DEPT+':user'} 已删除` | `// … 原页内 fetch 自带的自报头（自封 manager 身份 + 拼接本页部门常量）已删除` |

**事实登记**：以上两条注释的改写**唯一动机**是避免 P2/P7 冻结判据（原样 grep 命令）被注释字面量污染；**代码行为未因此改变**，且改写前后语义等价。原文见 git 历史。按 L-15 要求显式登记，**不得**只贴 `grep=0` 的结果。
（`department-workspace.ts:20` 与 `workspaces-api.ts:266` 的"删除前原文"注释**保留** —— 它们不含 P2/P7 判据字面量，且是 P0 溯源所必需；L-16 已裁定该类判据为「语义 + 运行时探针」而非 `grep=0`。）

### 4.6 变异体基线声明（**偏离 L-14 默认路径，已登记**）
L-14 裁定自验/复核以「已提交 SHA」为基准、用 `git checkout -- <file>` 还原。**本批不适用**：PR-2b 的 7 文件**尚未提交**（队长统一提交），`git checkout --` 会**销毁在建工作**。
⇒ 采取的替代：变异前把 7 文件各复制一份到 `/tmp/d947-*.pristine.ts`，变异后 `cp` 还原，并以 **md5 双值相等 + `diff` 无差异 + `grep MUTANT` 零残留 + 复跑转绿** 四证闭合。**未使用** `git stash`（D312 禁令）、未 `--no-verify`、未 force push、未 amend。
⇒ **登记给 K3**：此处为方法偏离，理由与四证已附；建议 PR-2 提交后由 verifier/reviewer 以已提交 SHA 重做变异体。

---

## 5. P0 活越权读 —— 改前/改后 + **红证**（单列，按队长要求）

### 5.1 改前（file:line）
`src/routes/workspaces-api.ts:176-189`（HEAD 树）—— 见 §2.1④。

### 5.2 改后
`src/routes/workspaces-api.ts:264-291` —— 身份**只**来自 `req.rbac`；无验签身份 → 403；自报头零参与。

### 5.3 自报身份代码位清零
```bash
grep -rn "headers\['x-synova-token'\]\|headers?.\['x-synova-token'\]\|query.token" src/routes/ src/services/
```
```
src/routes/department-workspace.ts:9   *   删除从 `x-synova-token` 头 / `query.token` 派生部门名的自报身份读取。   ← 注释
src/routes/department-workspace.ts:19  // D947 R6: 原自报身份读取已删除（…）                                      ← 注释
src/routes/department-workspace.ts:20  //   删除前: const token = String(_req.headers['x-synova-token'] || …)      ← 注释（溯源）
src/routes/workspaces-api.ts:27        *   客户端自报凭据（`x-synova-token` / `query.token`）在 PR-1 后…           ← 注释
src/routes/workspaces-api.ts:266       //   const token = String(req.headers['x-synova-token'] || '');            ← 注释（溯源）
```
⇒ **代码位 0 处**（仅 5 行注释）。判据形态按 **L-16**：语义判据（无一处把该 header 的**值**当身份来源）+ 运行时探针（§5.4），**不**以 `grep=0` 收口。

### 5.4 判别性红证（变异体 M1：把 `/mine` 恢复为自报头子串判定）
```
VITEST_EXIT=1 ｜ Tests 5 failed | 19 passed (24)
× 已认证低权用户 + 自报 admin 头 → role 取自验签身份，且拿不到部门级工作区
    AssertionError: expected 'admin' to be 'staff'
× 不带自报头 → role 取自验签身份，**不得**默认 manager
    AssertionError: expected 'manager' to be 'staff'
× 对照: admin 身份确实可见部门级工作区
    AssertionError: expected 'manager' to be 'admin'
× 判别性: 无 req.rbac → 403 fail-closed
    AssertionError: expected 200 to be 403          ← 无身份被放行
× 判别性: req.rbac.authenticated=false（匿名上下文）→ 403
    AssertionError: expected 200 to be 403
```
⇒ 这正是 **「自报头 `admin` ⇒ role=admin ⇒ 全量可见」+「无头 ⇒ 默认 manager」+「无身份放行」** 三条活越权读行为的**当场复现**，且被本夹具捕获。还原后 md5 回到 `4dae5c19…`（§4.6）。

---

## 6. P3 守卫 + L-21 的红证

### 6.1 M2（摘掉 `PUT /:id/status` 的写守卫）
```
VITEST_EXIT=1 ｜ Tests 3 failed | 21 passed (24)
× 负路径: 非属主 manager 打部门级工作区 → 403      AssertionError: expected 200 to be 403   ← 越权写**成功**
× 负路径: ga → 403                                AssertionError: expected 400 to be 403
× 负路径: staff → 403                             AssertionError: expected 400 to be 403
```
⇒ 「摘掉任一写端点守卫 → P3 必红」成立；首条即"未授权写被放行"（200），是 P3 失效的直接证据。还原后 md5 回到 `4dae5c19…`。

### 6.2 M3（L-21 兜底改回空条件集）
```
VITEST_EXIT=1 ｜ Tests 2 failed | 25 passed (27)
× 无请求上下文 → 兜底条件集非空（不得为空集）
    AssertionError: expected 0 to be greater than 0
× 判别性（引擎级）: 兜底条件集喂入真实 KnowledgeStore → 全部行被过滤（deny-all）
    AssertionError: expected +0 to be 2             ← filteredOut 归 0 = 引擎"完全跳过过滤"
```
⇒ 空条件集 ⇒ `filteredOut=0` ⇒ **fail-open 的引擎级复现**。还原后 md5 回到 `c102fa98…`。

### 6.3 P3 与 P4 成对（R2 / REV-3.3）
本夹具的 P3 正路径（`owner===userId` → 200）**消费 `req.rbac`**；把 `app.use(rbacMiddleware)` 移回 :373 之后 ⇒ `req.rbac` 缺失 ⇒ 两个 `判别性: 无 req.rbac → 403` 与全部 5 个正路径（200）**同时红**，且 P4 谓词点数变 12 ⇒ 源码断言同时红 ⇒ **双红**。**P3/P4 在同一次独立验证轮次内成对成立**（本轮已达成；P4 侧源码断言由 code-b 的 `tests/routes/middleware-order.test.ts` 承担，其首轮 12/12 绿）。

### 6.4 过程记录（如实登记，不隐）
1. 首轮夹具 `beforeAll` 触 `Hook timed out in 10000ms`（bootstrap ≈15s）⇒ 修：显式 `60_000`。**性质：执行预算，非判据放宽。**
2. 第二轮 `/mine` 组 3 例红，根因为**我夹具的 mock 缺陷**（未对 `res.status()` 未调用即 200 的路径记状态，`status` 恒 0），非产品缺陷 ⇒ 修 `callMine`（默认 200 + `wroteJson` 断言"判据不得被丢弃"）。
3. 期间 `/tmp/d947-heavy.lock` 被 code-b 的释放脚本（`rmdir` 遇非空目录失败且吞错）泄漏 ≈6 分钟，我的一轮白等；code-b 已自证并修复。**我的释放脚本同型缺陷已修**（`rm -f owner` 后再 `rmdir`，且不再吞错）——已在收尾确认 `LOCK_ALREADY_GONE/LOCK_RELEASED` 可见。

---

## 7. 未清项 / 新发现（**F-1/F-2 均已裁定；本节为裁定后措辞**）

> 裁定出处：`D947-RULINGS.md` **L-28**（F-1）· **L-29**（F-2）· **L-30**（卡面 `L<366`）· **L-31**（F-2 断言翻转采 (甲)）· **L-24**（未提交工作不得用 `git checkout --` 还原）· **L-26**（全队锁协议）。

### F-1（前提订正）`GET /api/workspaces/mine` 与 `/conflicts` 被 `/:id` 遮蔽 —— **CTO 裁定 (b)：另立卡，本卡不修 ordering**
**实测**（HTTP 真打）：
```
GET /api/workspaces/mine  （带合法 JWT）→ 404  {"ok":false,"error":"workspace not found"}
```
**根因（file:line）**：`src/routes/workspaces-api.ts` 中 `router.get('/api/workspaces/:id')`（**:126**）注册**先于** `router.get('/api/workspaces/mine')`（**:264**）⇒ Express 以 `:id='mine'` 命中前者；`router.get('/api/workspaces/conflicts')`（**:294**）同型。
**后果**：① P0 的 `/mine` 修复在 **HTTP 面不可达**（缺陷**先于本卡存在**）⇒ 队长要求的「HTTP 运行时判别探针」**在本卡范围内不可构造**（依 L-5 同型处置：不伪造、不改判据），故本批以**直接 handler 运行时探针**给出判别性证据（§3.3 / §5.4）；② 该路径原本可能被 `department-workspace.ts` 的页内 JS 调用（L-11 未清项）——实际也一直是 404。
**裁定 (b) 理由**：遮蔽缺陷先于本卡存在、非 D947 引入；修 ordering 会使 `/api/workspaces/conflicts` 由 404 变**可达** = **可达面扩张**（安全相关），须 CTO 审；且不在任何 P 判据与冻结算判据内。
**本卡处置（裁定后保留）**：夹具以**登记性断言**锁定现状（`expect(404)` + 「锁定现状，不代表期望行为」+「**缺陷已登记，另立卡**」），并保留**直接 handler 运行时探针**作为 P0 判别性证据。
⇒ **未清项（回执必带）**：F-1 要求 CTO 执行「**另立卡**」；另立卡落地前，`/mine` 与 `/conflicts` 的 HTTP 可达性维持 404。
**关联（非冲突）**：code-b 的 P4 探针断言的是**无凭据 → 401（中间件层，早于路由匹配）**，与遮蔽（路由匹配层）**不同层、不互相覆盖** ⇒ 其断言保留正确。

### F-2（前提订正 · L-6）`canModifyWorkspace` 部门分支对「无部门工作区」恒真 —— **CTO 裁定 (a)：本卡内修复（fail-closed）**
**L-6 原文**称「JWT 用户 `ctx.department` 恒 undefined ⇒ 部门分支**恒 false**，唯一通过路径 = `ws.owner === userId`」。
**实测订正**（真函数真参数；**A2 落地前**实测值）：
```
canModifyWorkspace({role:'manager', userId:'m2', department: undefined, authenticated:true},
                   { department: undefined, owner: 'm1' }) → true     ← 非属主 manager 通过「undefined === undefined」（fail-open 授权分支）
canModifyWorkspace(同一 ctx, { department: 'sales', owner: 'm1' })     → false
```
⇒ 「唯一通过路径 = owner」**仅对 `ws.department` 有值的工作区成立**；对无部门工作区，**任何** manager 都可通过部门分支（无需是 owner）。落点 = `rbac.ts:288-290`（**PR-1 冻结写集，不在我的写集内，我一行未改**）。
**裁定 (a) 理由**：这是 **fail-open 授权分支**，与本卡主题（默认拒绝 / 创始人决策 ②）直接相悖；只登记不修 = 把已知破坏留在绿腿里。
**落点与交付**：不扩写集 ⇒ 以 **PR-1 fixup commit（A2）** 交付，写者 **code-a（task-11）**；判据 = 部门分支须**双方部门均有值**才可能命中，双侧 undefined ⇒ deny，带判别性夹具 + 反向变异红证。**我未动 `rbac.ts`**（`git diff --stat -- src/middleware/rbac.ts` 空）。
**我对夹具的配套改动（L-31 采 (甲)）**：F-2 断言已按**裁定后契约**改写 —— `toBe(false)`（原为 `true`），并新增对照组 2（属主本人 `owner===userId` 仍通过 ⇒ **修复未过度收紧，P3 正路径不受影响**）。顺序 **A2 → 本夹具 → commit B**；A2 未落地时该组为红，属**预期的跨 PR 依赖**，不得静默放宽。
**P3 用例不受影响（已核）**：P3 负路径构造在**有部门**工作区（`department:'sales'`）⇒ post-fix 仍 403；正路径经 `owner` 分支 ⇒ post-fix 仍 200。

### 其余未清（登记，不阻塞）
- **L-11**：`department-workspace.ts:75` 页内自报删除后的行为变化**无测试守护**（`grep "manager:'+DEPT" tests/` 在改写前为 exit=1 无输出）——本卡不扩写集。
- **L-12**：P2 全局 =0 是**跨 PR-1+PR-2 两批**结论；任一批不得单独声称「P2 已完成」。
- **L-15**：见 §4.5（注释改写事实登记）。
- **L-30（卡面字面 vs L-2）**：见 §1（卡面 `L < 366` 字面**过期**；以 **L-2 闭区间 [357,366]** 为准，实测 **366**）。
- **L-14 / L-24 偏离**：见 §4.6（未提交工作不能用 `git checkout --` 还原）。
- **L-26 锁协议**：我原释放脚本与 code-b **同型缺陷**（`rmdir` 遇非空目录失败且吞错）已自查修复（`rm -f owner` → `rmdir` → 显式校验 → 不吞错 → `owner` 带身份+pid），口径与全队协议一致。
- **`overflow.test.ts` 归因**：按 **L-7** 归 **N1**（补硬前置），**不是** P0；总盘子 **17 不变**；文件确实发生了改动（+18 行）。
- **反爬口径**：`readRbac` 以 `(req as Request & { rbac?: RbacContext }).rbac` 取数 ⇒ `grep -rn 'req\.rbac' src/` **不会**命中该消费点（文本为 `).rbac`）。**请勿以该 grep 判定 P3 未接线**；正确口径见 §4.3（`rbac?: RbacContext` 命中 / 5 处 `canModifyWorkspace(rbac` / **6 个真实调用点 + 1 处 JSDoc 文本 ⇒ grep 读数 7**）+ 运行时夹具。

---

## 8. 自验结论

- **P3（整条）**：5 个写端点均落守卫；负路径（ga / 跨部门 / staff）403、正路径（`owner===userId`）200、无凭据 401、无 `req.rbac` 403；变异体 M2 三例红 ⇒ 「删掉即报红」成立。**P3/P4 成对**（见 §6.3）。
- **P0（路由侧）**：`workspaces-api.ts` 自报身份代码位清零；`department-workspace.ts` 自报读点与页内自发送删除；变异体 M1 五例红（含三条活越权读行为当场复现）。**但** `/mine` 的 HTTP 可达性受 F-1 影响（已裁定 **另立卡**，本卡不修 ordering）。
- **P2（漏斗）**：`documents.ts` 两处 + `request-context.ts:41` 均收口到唯一漏斗；`conditions: []` 全局 **0**；漏斗类型与 L4 引擎**结构等价**（零断言直通）。
- **L-21**：兜底改为**非空 deny-all**；判别性夹具（形状 + 引擎级 + 对照）三者在同一轮次成立；变异体 M3 两例红。
- **验证（两轮，不得混记）**：
  · **A2 前基线轮**（§6.2 之后的最终绿跑）：`vitest` 3 文件 / **39 例全绿**，`VITEST_EXIT=0`。此轮中 F-2 组 1 例断言的是**当时现状**（`true`）。
  · **A2 后**（L-31 采 (甲)）：F-2 断言已翻转为**裁定后契约**（`toBe(false)`）⇒ 该组在 **A2 落地后**方为绿；绿跑原始输出以本轮为准附于回执。
  · `tsc` 我的写集 **零错误**；无残留 / 无污染 / 无写集外改动（两轮同）。

**结论：`可提请独立审计`**（未清项：**F-1 已裁定另立卡** —— 要求 CTO 执行「另立卡」；**F-2 已裁定修复**，交付在 **A2 / task-11**。二者均**非本批遗留**。§7 其余为登记项。）
**不判「通过」** —— 通过与否归 CTO 收件闸 + K3 终审。
**不得**据此声称「P2 已完成」（L-12）、不得把 R5/REV-8 的部门级可见性恒 deny 写成「已知限制」或「已完成」（功能回退，另立卡）。

---

## 9. A2 落地后最终轮（L-31 采 (甲)）—— 原始输出 + 冻结指纹

**前置确认（自测，非转述）**：A2 已落 `src/middleware/rbac.ts`（`git diff --stat -- src/middleware/rbac.ts` → `1 file changed, 8 insertions(+), 1 deletion(-)`）：
```ts
// rbac.ts:288-296（A2）
if (role === 'manager') {
  // D947/L-29: 部门分支要求**双方部门均有值**才可能命中——`ctx.department` 与
  // `ws.department` 双 undefined 时不得因 `undefined === undefined` 命中（fail-closed）。owner 路径并行保留。
  const sameDepartment =
    ctx.department !== undefined && ws.department !== undefined && ws.department === ctx.department;
  return sameDepartment || ws.owner === ctx.userId;
}
```
⇒ 与 L-29 裁定逐字一致；我的 F-2 翻转断言（`toBe(false)`）在其上为绿，且**对照 2**（`owner===userId` → `true`）证明**未过度收紧**（P3 正路径不受影响）。

```bash
npx vitest run tests/routes/workspace-access-write-endpoint.test.ts \
  tests/routes/department-workspace.test.ts tests/routes/overflow.test.ts
```
```
VITEST_EXIT=0
 ✓ tests/routes/department-workspace.test.ts (5 tests) 344ms
 ✓ tests/routes/overflow.test.ts (6 tests) 28ms
 ✓ tests/routes/workspace-access-write-endpoint.test.ts (28 tests) 11702ms

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Duration  17.04s
```
（锁按 **L-26**：`mkdir` 原子取锁 → 跑完 `rm -f owner` → `rmdir` → 校验 → 打 **`UNLOCK_OK`**，**未吞错**。）

**改后冻结指纹**：
```
59cbf6424f2f425673ed288482838357 *tests/routes/workspace-access-write-endpoint.test.ts   ← 本轮改后
0bcd7ffb4ba30f38df14380cbf4d9ca6 *tests/routes/department-workspace.test.ts             ← 未变
20845d7acd8074f8fe5d395bd54d4266 *tests/routes/overflow.test.ts                          ← 未变
4479c7b9444718f1caf02b9708f7cd70 *docs/.../D947-code-c-pr2b.md                           ← 本件（§9 写入前的中间态）
```
（**本件自身不列 md5 判据**：自引用数值写入即失效，属恒不稳的判据；以 §0 的 7 文件表 + 上面 3 行夹具指纹为准。）
`src/**` 四个源文件的 md5 与 §0 表**完全一致**（仅夹具与证据件随裁定更新）：
`workspaces-api.ts 4dae5c19960096a6a0763272f6faed9d` ｜ `department-workspace.ts 30a115c4…` ｜ `documents.ts 20e469ee…` ｜ `request-context.ts c102fa98…`。

```bash
git status --porcelain
```
```
 M src/middleware/rbac.ts                  ← A2 / code-a（我 0 行触碰）
 M src/routes/department-workspace.ts      ← code-c
 M src/routes/documents.ts                 ← code-c
 M src/routes/workspaces-api.ts            ← code-c
 M src/server.ts                           ← code-b 单写者
 M src/services/request-context.ts         ← code-c
 M tests/middleware/rbac.test.ts           ← A2 / code-a
 M tests/routes/department-workspace.test.ts ← code-c
 M tests/routes/overflow.test.ts           ← code-c
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
?? tests/routes/middleware-order.test.ts  ← code-b
?? tests/routes/workspace-access-write-endpoint.test.ts ← code-c（新建）
```
⇒ 本轮我的改动**只落在** `tests/routes/workspace-access-write-endpoint.test.ts` + 本证据件；**`rbac.ts` 一行未动**；无写集外改动、无污染。
