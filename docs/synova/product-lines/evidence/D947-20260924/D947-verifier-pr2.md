# D947 PR-2 独立自验报告（verifier）

> 自验员：**verifier**（独立于 code-a/b/c；只读交付物，可写 `/tmp`；唯一写例外 = 变异体，已还原）
> 基准（**L-24 主路径 A：全部已提交 ⇒ `git checkout --` 还原安全**）：
> PR-1 = `77e0d6aa` ｜ **A2（PR-1 fixup）= `313150bf`** ｜ **PR-2 = commit B = `2ea4df10`** ｜ 自验期 HEAD = `8c5c3ec8`（钩子自动 `chore: bypass COMMITTED`，非代码改动）
> 工作树：`.synova-wt-d947-middleware` ｜ 裁定集：`D947-RULINGS.md`（L-1…L-32）｜ **本报告不判「通过」**

---

## 〇、自验结论

**「可提请独立审计」**——PR-2 的 12 项判据在本轮全部自验达成，**P3 与 P4 在同一次轮次内**给出红→绿对照（缺一即退的成对要求满足）；变更面 9 个代码文件（+1 治理产物）；全量套件失败面与 PR-1 **完全一致（0 新增 / 0 消失）**且失败信息区**零引用** PR-2 改动面。

### 登记项（不构成退回，须随件上报 CTO/K3）

| # | 登记项 | 性质 |
|---|---|---|
| **E-1** | **卡面文件数口径过期**：task-8 正文写「PR-2 恰好 **11 文件**」，实测 PR-2 = `2ea4df10` 相对 A2 的 diff 共 **10 条**，其中 `.claude/bypass.log` 为**治理产物**（钩子自动写） ⇒ **代码/测试文件 = 9**，与队长 GO 报文一致。属 L-30 同类（卡面字面过期，以实测 + 队长报文为准） | 口径登记 |
| **E-2** | **merge 端点的判据顺序**：`PUT /:id/merge` 首层「无验签身份 → 403」在最前；其后是**形状校验**（非子工作区 → 400、父缺失 → 404），**再**才是 `canModifyWorkspace` → 403。⇒ 已认证低权用户对**非子工作区** id 得到 400 而非 403。判据结果对**合法形态请求**正确（403），且不构成越权；登记为**顺序观察（低危）**供 K3 裁量 | 低危观察 |
| **E-3** | **我的首轮探针 setup 错**（已自查修正并登记）：首轮 P3-i 用**非子工作区**打 merge ⇒ 得到 400；经读码确认 400 是形状校验、非守卫缺失。修正为「属主先建子工作区 → staff merge → 403 / 属主 merge → 200」，全绿 | 自验自查 |
| **E-4** | **M7 首轮驱动参数错位**（已自查修正并登记）：驱动脚本未给含空格的过滤器加引号 ⇒ 参数右移，导致运行探针**未跑**且「交付夹具红证」为**伪红**（NO test files found ⇒ exit 1）。已改为整串加引号并**重跑 M7**，本轮所引 M7 证据全部来自修正后的重跑 | 自验自查（防伪红） |
| **E-5** | 全量套件 16 个失败文件本轮**未做前置版本对照跑**（沿用 PR-1 R-3 归因：失败信息零引用 + 隔离复现 + 环境错误原文）；**新增**：本轮失败面与 PR-1 **逐文件相同**，进一步排除 PR-2 引入 | 残余不确定性 |
| **E-6** | R-1（PR-1 登记的白名单漏斗空条件）**本轮已收口并复验**（见 §八）——按 L-21 第 5 条，**PR-1 轮次登记为未清**，此处只报 PR-2 复验结果，不改写 PR-1 报告 | 状态流转 |

---

## 一、基准冻结

```
$ git log --oneline -6
8c5c3ec8 chore: bypass COMMITTED 登记 (auto hook, D521)
2ea4df10 fix(d947): 路由层默认拒绝 + 鉴权中间件前移 + 唯一漏斗收口（PR-2，9 文件）
d11146af chore: bypass COMMITTED 登记 (auto hook, D521)
313150bf fix(d947): 收窄部门判据 fail-open（PR-1 fixup A2 — 双 undefined 与空串一律不命中）
db54b926 chore: bypass COMMITTED 登记 (auto hook, D521)
77e0d6aa fix(d947): 服务端停止信任客户端自报身份（PR-1 middleware 默认安全姿态）
```

**文件面算术（治理产物单列，逐条）**：

```
$ git diff --name-only 313150bf 2ea4df10
.claude/bypass.log                                   ← 治理产物（钩子自动写）
src/routes/department-workspace.ts
src/routes/documents.ts
src/routes/workspaces-api.ts
src/server.ts
src/services/request-context.ts
tests/routes/department-workspace.test.ts
tests/routes/middleware-order.test.ts
tests/routes/overflow.test.ts
tests/routes/workspace-access-write-endpoint.test.ts
总行数 = 10 ｜ 治理产物 = 1 ｜ **代码/测试文件 = 9**（≤12 ✅）
$ git diff --stat 313150bf 2ea4df10 | tail -1
 10 files changed, 1085 insertions(+), 46 deletions(-)

$ git diff --name-only 77e0d6aa 313150bf        # A2
.claude/bypass.log / src/middleware/rbac.ts / tests/middleware/rbac.test.ts
总行数 = 3 ｜ 治理产物 = 1 ｜ **代码文件 = 2** ✅（与队长报文一致）

# 累计（PR-1+A2+PR-2 相对 main，剔除治理产物）= 17 个代码文件 ← 与冻结口径 17 一致
```

自验起点工作树：`git status --porcelain` 仅 `?? .claude/task-briefs/…` 与 `?? docs/synova/product-lines/evidence/D947-20260924/`；`git diff --stat` 空。

---

## 二、探针与工具（落 `/tmp/d947v2`，永不入仓库；L-17）

| 文件 | 例数 | sha256（前 16） |
|---|---|---|
| `60-p4-source.probe.test.ts`（**自实现**冻结谓词 + I4/L-2 + P6/P7） | 4 | `98e3d00dbff2eef8` |
| `65-rbac-dept.probe.test.ts`（L-29/L-32 + R5 单元探针） | 17 | `ce7772531a655270` |
| `70-p3p4-runtime.probe.test.ts`（真实 `createServer()` + `PORT=0` + 真实 `fetch`） | 21 | `6df1ae2b185835a9` |
| `80-l21-funnel.probe.test.ts`（L-21 漏斗兜底） | 5 | `46d3a6a136b5ac2a` |
| `vitest.config.ts`（root=/tmp + 9 个 `@synova/*` 别名对齐仓内配置 + `hookTimeout:120000`） | — | `129e89765308f917` |
| `mut3.js` / `mut3.sh`（**多目标逐目标重读** + find 唯一命中强制 + CRLF 感知 + sha256 台账 + L-26 锁） | — | `951ed6e3b423be5e` / `d826c166134d18e6` |

**L-26 锁协议照做并实测**：`mkdir` 抢锁 → 写 `owner`（`whoami pid=$$ UTC时间`）→ 释放前 `rm -f "$LOCK/owner"` → `rmdir` → **显式打印 `UNLOCK_OK`/`UNLOCK_FAIL`**（本轮全部为 `UNLOCK_OK`，无锁泄漏）。

**主轮全绿**：`bash /tmp/d947v2/run-probes.sh go-pr2`

```
 Test Files  4 passed (4)
      Tests  47 passed (47)
```

---

## 三、P4 中间件前移（源码断言 + I4/L-2 + 运行时判别性）

### 3.1 源码断言（冻结谓词，逐字符照抄；**禁硬编码行号当判据**）

```
$ L=$(grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1); echo $L
366
$ PAT='app\.use\([A-Za-z0-9_]+(Router|Routes)\)|app\.(get|post|put|patch|delete)\('
$ grep -nE "$PAT" src/server.ts | grep -v 'res.redirect' | awk -F: -v L=$L '$1<L {print $1": "$0}'
322:  app.use(setupGuideGoneRouter);
340:  app.use(llmConfigRoutes);
343:  app.use(uploadV2GoneRouter);
347:  app.use(authRoutes);
355:  app.get('/api/status/budget', (req, res) => {
rbac 之前的路由注册计数 = 5          ← 恰好 5 行 = 冻结豁免集 ✅
```

我的**独立实现**（`60-p4-source`，不复制夹具逻辑）读同一文件得同解：

```
[P4-s] rbac 之前注册 = ["setupGuideGoneRouter","llmConfigRoutes","uploadV2GoneRouter","authRoutes","/api/status/budget"]
[L-2/I4] jwtAuth=344 rateLimit=352 rbac=366 homeRoutes=376 workspacesApiRoutes=380
```

⇒ **L-2 区间**：`366 ∈ [357,366]` ✅；**I4 不变量**：`jwtAuth(344) < rateLimit(352) < rbac(366) < homeRoutes(376) < workspacesApiRoutes(380)` ✅（不得早于 jwtAuth、必须早于路由组）。
⇒ **L-27 登记照旧**：区间 `[357,366]` 由谓词命令 + 本证据承担（夹具锚标识符，无夹具级守护）。

### 3.2 运行时探针（真实服务器）

```
[P4-r1] status=200 body={"ok":true,"workspace":{"id":"ws_mufkh7jd",…,"owner":"v-admin",…}}   ← 判别性正路径 ✅
[P4-r2] status=401 body={"code":"UNAUTHORIZED"}      ← 无凭据打 /api/workspaces/mine（L-22 订正口径）✅
[P4-r3] /health status=200
[P4-r4] POST /api/auth/login status=400 body={"code":"VALIDATION_ERROR"}   ← 路由真的执行（非被认证层拦死）✅
[P4-r5] /api/status/budget status=200
[P4-r6] /api/knowledge/ask status=200
```

**口径说明（照 L-22 登记，非静默改判据）**：卡面字面「无凭据 → **403**」经实测**不成立**——`/api/workspaces/mine` 非白名单 ⇒ `jwtAuthMiddleware` 在**路由之前** 401，路由级 403 无机会产生。⇒ 该探针性质 = **回归守卫**（不承担判别性）；**403 断言仍在场**，由 P3 写端点承担（见 §四）。
**L-28 影响**：`/mine` 与 `/conflicts` 被 `/:id` 遮蔽 ⇒ HTTP 恒 404（我的独立复现见 §九），故 P4 判别性正路径改用 `POST /api/workspaces`（与 L-28 明示一致）。

---

## 四、P3 写端点守卫（5 端点 · 负路径 403 · 正路径 200）

实现接线（`src/routes/workspaces-api.ts`，逐条）：

| 端点 | 首层（验签身份） | 授权判据（消费 `req.rbac`，**不重算**） |
|---|---|---|
| `:99 POST /api/workspaces` | `:102 requireVerifiedRbac` | `:104 canModifyWorkspace(rbac,{owner: rbac.userId})` |
| `:133 PUT /:id/status` | `:135` | `:142 canModifyWorkspace(rbac,{department,owner})` |
| `:170 POST /:id/messages` | `:172` | `:179 同上` |
| `:219 POST /:id/sub` | `:221` | `:228 canModifyWorkspace(rbac,{parent.department,parent.owner})` |
| `:320 PUT /:id/merge` | `:322` | `:332 canModifyWorkspace(rbac,{ws.department,ws.owner})` |
| （读端点对照）`:198 GET /:id/context` | — | `:207 canAccessWorkspace(...)` |

**反爬口径复核（队长坑 1 已实测确认）**：

```
$ grep -rn 'req\.rbac' src/ | wc -l
9        ← 9 处**全部是注释**（workspaces-api:25/27/29/205/272 · auth:322 · server:248/368/373）
$ grep -rn ')\s*\.rbac' src/
src/middleware/rbac.ts:321:  (req as Request & { rbac: RbacContext }).rbac = extractRbacContext(req);   ← 写入方
src/routes/workspaces-api.ts:33:  return (req as Request & { rbac?: RbacContext }).rbac;               ← 唯一消费者（readRbac）
$ grep -n 'readRbac' src/routes/workspaces-api.ts
32:function readRbac(...) {  55:  const rbac = readRbac(req);
```

⇒ 消费点是**类型断言形态**；**不得**据 `grep 'req.rbac'` 判"未接线"（据其判会得到"9 处全是注释"的假结论）。

**我的独立运行时矩阵**（真实服务器 + 真实 JWT，全部实测）：

```
[P3-a] staff → POST /api/workspaces            = 403 ✅
[P3-b] ga    → POST /api/workspaces            = 403 ✅
[P3-c] owner===userId 的 manager → POST        = 200（L-6 唯一通过路径）✅ wsId=ws_mufkh7lp
[P3-d] 属主 manager → PUT /:id/status          = 200 ✅
[P3-e] 非属主 manager → PUT /:id/status        = 403 ✅
[P3-f] staff → PUT /:id/status                 = 403 ✅
[P3-g] staff → POST /:id/messages = 403 ；属主 → = 200 ✅
[P3-h] staff → POST /:id/sub                   = 403 ✅
[P3-i] staff → PUT /:id/merge（子工作区）      = 403 ；属主 → = 200 ✅
[P3-j] 无凭据 → POST /api/workspaces           = 401（≠200；不默认 manager、不放行）✅
```

**403 断言在 P3 夹具在场（L-22 第 3 条）**：`tests/routes/workspace-access-write-endpoint.test.ts` — `toBe(403)` = **12 处**、`toBe(200)` = **13 处**、`toBe(404)` = 1 处；含判别性用例「**无 req.rbac → 403 fail-closed**」（`:405`，直接 handler 调用形态）与「`authenticated=false` → 403」（`:411`）。

---

## 五、P3 × P4 **成对**验收（同轮红→绿，R2/REV-3.3）

同一轮次内同时给出二者：

| 变异体 | 改坏点 | P4 源码断言 | P4 运行时（判别性正路径） | P3 守卫 | 交付夹具 |
|---|---|---|---|---|---|
| **M7** `app.use(rbacMiddleware)` 移回 `workspacesApiRoutes` 之后 | 2 目标（删 :366 + 插到 :380 后） | ❌ 红：`[P4-s] rbac 之前注册 = [5 豁免项 + homeRoutes + chatRoutes + workspaceRoutes + workspaceDataRoutes + workspacesApiRoutes]`（10 项）；`[L-2/I4] rbac=380 > homeRoutes=375` | ❌ 红：`[P4-r1] status=403 body={"ok":false,"error":"access denied"}` | ❌ 红：P3-c/d/e/f/g/h/i/i2 连带红（`req.rbac` 缺失 ⇒ 全部 fail-closed） | ❌ 红 4 例（P4-1/P4-2/I4/运行时正路径） |
| **M8** 摘除 `PUT /:id/status` 权限判据 | 1 目标 | — | — | ❌ 红：P3-e（非属主 manager 期望 403）、P3-f（staff 期望 403） | —（未跑） |

**M7 红证原文（节选）**：

```
 Tests  12 failed | 13 passed (25)   ← 我的 60+70 探针
 FAIL 60-p4-source > P4-s rbac 之前的注册集合 = 冻结豁免集 5 项（顺序敏感）
 FAIL 60-p4-source > L-2 区间：rbac 行号 ∈ [357,366]；I4：jwtAuth < rbac < homeRoutes/workspacesApiRoutes
 FAIL 70-p3p4-runtime > P4-r1 判别性正路径：admin JWT → POST /api/workspaces → 200 且 owner 取自验签身份
   （+ P3-c…P3-i2 共 8 例连带红）
 Tests  4 failed | 8 passed (12)     ← **交付夹具** tests/routes/middleware-order.test.ts
 FAIL … > P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项
 FAIL … > P4-2 前移后计数值恒为 5
 FAIL … > I4 rbac 晚于 jwtAuthMiddleware 与 rateLimitMiddleware，早于 homeRoutes 与 workspacesApiRoutes
 FAIL … > P4 判别性正路径：合法 admin JWT → POST /api/workspaces → 200
```

**M8 红证原文**：

```
 Tests  2 failed | 19 passed (21)
 FAIL 70-p3p4-runtime > P3-e PUT /:id/status 非属主 manager → 403
 FAIL 70-p3p4-runtime > P3-f PUT /:id/status staff → 403
```

⇒ **P3 与 P4 物理绑在同一根链上**（前移是 P3 生效的前提；摘除 P3 判据则写守卫失去拒绝能力）：**成对达成** ✅

---

## 六、P6 零 void · P7 装配侧零自欺

```
$ grep -rnE 'void +(canAccessWorkspace|canModifyWorkspace)' src/ | wc -l
0
$ grep -rn "'admin::dev'" src/ | wc -l
0
$ grep -rn "manager:'+" src/ | wc -l
0
$ grep -n "middleware/rbac" src/server.ts
19:import { rbacMiddleware } from './middleware/rbac'; // D947: 仅保留中间件；装配期空调用已删（见 244 区注释）
```

我的独立探针（`60-p4-source`）同解：`void 命中行 = []`、`admin::dev 计数 = 0`、`extractRbacContext 计数 = 0`。
**夹具自身的源码断言 + 运行时探针都在**：`middleware-order.test.ts` 有源码断言段（`:139-176`，6 例）+ 运行时段（`:182-238`，6 例）⇒ P6 达成 ✅

---

## 七、P2 全局收敛（跨两批达成，L-12）

```
$ grep -rn "conditions: \[\]" src/ --include='*.ts'
(无匹配)
count = 0          ← PR-1 时 = 3（documents.ts:85/:112 · request-context.ts:41）✅
```

四处改后状态（逐条）：

| 位置 | 改后形态 |
|---|---|
| `src/middleware/auth.ts:355`（原恒空实现） | 返回**由认证身份派生**的条件：`{field:'access.sensitivity', operator:'IN', value: allowedSensitivities(role, sensitivity)}`（PR-1 交付） |
| `src/routes/documents.ts:85` | `const filter = await getCurrentFilterClause('KnowledgeChunk'); store.search('', filter, 100)` |
| `src/routes/documents.ts:112` | 同上（`store.search(id, filter, 50)`） |
| `src/services/request-context.ts:41` | 兜底改为**非空 deny-all**（见 §八） |

---

## 八、L-21 漏斗兜底 fail-closed（**R-1 复验**）

实现（`src/services/request-context.ts:63-84`）：`DENY_ALL_FIELD='__d947_no_authenticated_context'`、`DENY_ALL_SENTINEL='__d947_deny_all__'`；无上下文 → `log.warn('安全判据: 被拒绝 — 无请求上下文（漏斗兜底 fail-closed，返回拒绝型非空条件集）')` + `return { conditions: [{ field: DENY_ALL_FIELD, operator: 'EQ', value: DENY_ALL_SENTINEL }] }`。

我的独立探针（`80-l21-funnel`，5 例全绿）：

```
[L-21-a] 观测 = {"conditions":[{"field":"__d947_no_authenticated_context","operator":"EQ","value":"__d947_deny_all__"}]}   ← 非空 ✅
[L-21-b] 首条条件 = {"field":"__d947_no_authenticated_context","operator":"EQ","value":"__d947_deny_all__"}   ← 形状可核 ✅
[L-21-c] 白名单(/api/knowledge/ask) + 真实 JWT：观测 = {"nextCalled":true,"providerPresent":false,"clause":{"conditions":[…deny-all…]}}
          ← **PR-1 R-1 的复现路径已收口：不再得空条件集** ✅
[L-21-d] 对照：非白名单 + 真实 JWT ⇒ providerPresent=true，条件 = access.sensitivity IN ['normal']（按角色派生）✅
```

**变异体 M9（兜底改回空集）⇒ 3 例红**（L-21-a/-b/-c）⇒ 「删掉即报红」成立 ✅
引擎级 deny-all（真实 `KnowledgeStore` 过滤）由交付夹具 `workspace-access-write-endpoint.test.ts:497` 覆盖，我已整文件运行并见其绿（§十三）。

---

## 九、L-28 现状锁定（F-1 遮蔽缺陷）

```
$ grep -c '缺陷已登记，另立卡' tests/routes/workspace-access-write-endpoint.test.ts
2                     ← 与队长要求 grep -c = 2 一致 ✅
$ grep -c '另立卡' = 4 ｜ grep -c '锁定现状' = 3 ｜ grep -c 'toBe(404)' = 1
```

我的独立 HTTP 复现（admin JWT，真实服务器）：

```
[L-28-a] GET /api/workspaces/mine      status=404 body={"ok":false,"error":"workspace not found"}
[L-28-b] GET /api/workspaces/conflicts status=404
```

⇒ 遮蔽缺陷**可见且被锁定为现状断言**，行内注明「锁定现状，不代表期望行为；缺陷已登记，另立卡」；**本卡未修 ordering**（与 CTO 裁定 (b) 一致）✅

---

## 十、L-29 / L-32 部门判据收窄（A2 交付物）

实现（`src/middleware/rbac.ts:231-237`，`canAccessWorkspace:287` 与 `canModifyWorkspace:313` 共用**唯一事实源** `isSameDepartment`）：

```
function isSameDepartment(ctxDept, wsDept) {
  return (
    typeof ctxDept === 'string' && ctxDept.length > 0 &&
    typeof wsDept === 'string' && wsDept.length > 0 &&
    wsDept === ctxDept
  );
}
```

我的独立单元探针（`65-rbac-dept`，17 例全绿，逐条实测）：

| 用例 | 观测 | 期望 |
|---|---|---|
| L-29-a 双 `undefined` + 非属主（canModify） | `false` | deny（修复前 fail-open=true）✅ |
| L-29-b 双 `''` + 非属主 | `false` | deny ✅ |
| L-29-c 单侧 `undefined` | `false` | deny ✅ |
| L-29-d 单侧 `''` | `false` | deny ✅ |
| L-29-e 同非空部门 | `true` | allow ✅ |
| L-29-f 跨部门 | `false` | deny ✅ |
| L-29-g owner 路径（双 undefined 部门） | `true` | **不受收窄影响** ✅ |
| L-29-h admin 旁路 | `true` | 不变 ✅ |
| L-32-a 双 `undefined` + 非 admin（canAccess） | `false` | deny ✅ |
| L-32-b 双 `''` | `false` | deny ✅ |
| L-32-c 单侧 `undefined` | `false` | deny ✅ |
| L-32-d/e 同部门 / 跨部门 | `true` / `false` | 不变 ✅ |
| L-32-f admin 旁路 | `true` | 不变 ✅ |
| L-32-g private + owner | `true` / `false` | 不受影响 ✅ |
| R5：JWT 用户（department 恒 undefined）打部门级工作区 | `false`（读写两面） | **恒 deny** ✅ |
| 未认证（`authenticated=false`） | `false`（先于 admin 分支） | 仍拒绝 ✅ |

**变异体 M10（`isSameDepartment` 改回 `ctxDept === wsDept`）⇒ 双红**：我的探针 4 例红（L-29-a/-b、L-32-a/-b）+ **交付夹具红 1 例**：

```
 Tests  4 failed | 13 passed (17)      ← 我的 65-rbac-dept
 FAIL … > L-29-a 双 undefined + 非属主 → deny（修复前 fail-open=true）
 FAIL … > L-29-b 双空串 '' + 非属主 → deny
 FAIL … > L-32-a 双 undefined + 非 admin（已认证 manager）→ deny（修复前 fail-open=true）
 FAIL … > L-32-b 双空串 → deny
 Tests  1 failed | 27 passed (28)      ← 交付夹具 tests/routes/workspace-access-write-endpoint.test.ts
 FAIL … > F-2 · 非属主 manager + 无部门工作区 → deny（F-2 已裁定修复，A2 交付）
```

**A2 回归**：`npx vitest run tests/middleware` ⇒ 7 文件全绿（`rbac.test.ts` 由 PR-1 时 36 例增至 **58 例**，含 A2 新增 L-29/L-32 用例）。

---

## 十一、R5 / REV-8 功能回退「如实体现在场」

```
$ grep -rn "R5/REV-8|功能回退" src/routes/workspaces-api.ts tests/routes/workspace-access-write-endpoint.test.ts
src/routes/workspaces-api.ts:278:  const dept = rbac.department;   // R5/REV-8: JWT 载荷无 department ⇒ 恒 undefined（已登记功能回退）
tests/routes/workspace-access-write-endpoint.test.ts:235:  it('负路径: 非属主 manager 打部门级工作区 → 403（R5/REV-8 已裁定为功能回退，非缺陷）' …)
tests/routes/workspace-access-write-endpoint.test.ts:238:  // 「manager 且部门级工作区 → deny」路径：**功能回退已登记（R5/REV-8）**，不得读作已修复。
```

**禁用措辞扫描（PR-2 改动面 9 文件逐文件）**：`已知限制` / `已完成` 合计 = **0** ✅（§十四 同项复核）
⇒ 功能回退如实体现在场，未被写成「已知限制」或「已完成」；本卡未修（另立卡）✅

---

## 十二、N1 硬前置（在场 + **必要性**）

**在场性**（我纳入的 4 个 PR-2/A2 夹具）：

| 夹具 | `beforeAll` | `JWT_SECRET` | `DEV_MODE` | `expect(process.env…` 自证 |
|---|---|---|---|---|
| `tests/routes/middleware-order.test.ts` | 4 | 6 | 5 | 2 |
| `tests/routes/workspace-access-write-endpoint.test.ts` | 2 | 4 | 3 | 2 |
| `tests/routes/department-workspace.test.ts` | 2 | 2 | 2 | 2 |
| `tests/routes/overflow.test.ts` | 2 | 2 | 2 | 2 |

**必要性（HTTP 层反证，我的独立实验）**：

```
[N1-H]  清空 JWT_SECRET + DEV_MODE=true ⇒ 无凭据 POST /api/workspaces status=200
        body={"ok":true,"workspace":{…,"owner":"dev-admin",…}}
        stderr: {"code":"AUTH_DEV_MODE_GRANT","reason":"jwt_secret_not_configured","msg":"安全判据: 开发姿态放行…"}
        ⇒ 无前置时一切请求被自动 admin 放行：**"无凭据必须被拒"类断言在该环境下失去判别力**
[N1-H2] 复原 env 后同一请求：staff → 403（fail-closed 回来）
```

⇒ 前置**必要**，不只是存在 ✅；且夹具显式放宽超时（**L-25**）：`middleware-order.test.ts` / `workspace-access-write-endpoint.test.ts` 的 `beforeAll` 设 **120_000**（依据：本机 `createServer()` bootstrap ≈15s > vitest 默认 10s，误差已由 PR-1 long-hook 实验决定性归因）。

---

## 十三、交付夹具定向运行（PR-2 + A2 全量面）

```
$ npx vitest run tests/middleware tests/routes/middleware-order.test.ts \
    tests/routes/workspace-access-write-endpoint.test.ts tests/routes/department-workspace.test.ts \
    tests/routes/overflow.test.ts tests/routes/ga-auth.test.ts tests/routes/diagnosis-report-persistence.test.ts
EXIT=0
 ✓ tests/routes/ga-auth.test.ts (6)              ✓ tests/middleware/permission-filter.test.ts (6)
 ✓ tests/routes/department-workspace.test.ts (5) ✓ tests/middleware/auth.test.ts (34)
 ✓ tests/middleware/rbac.test.ts (58)            ✓ tests/routes/overflow.test.ts (6)
 ✓ tests/middleware/rbac-ga-boundary.test.ts (14)✓ tests/middleware/rate-limit.test.ts (8)
 ✓ tests/middleware/rbac-default-deny.test.ts (9)✓ tests/middleware/auth.integration.test.ts (10)
 ✓ tests/routes/diagnosis-report-persistence.test.ts (12)
 ✓ tests/routes/middleware-order.test.ts (12)    ✓ tests/routes/workspace-access-write-endpoint.test.ts (28)
 Test Files  13 passed (13)
      Tests  208 passed (208)
```

---

## 十四、全量套件（PR-2 是否引入新失败）

```
$ npx vitest run
 Test Files  16 failed | 595 passed | 3 skipped (614)
      Tests  58 failed | 4419 passed | 66 skipped (4543)
   Duration  190.43s
```

**与 PR-1 失败面逐文件对照（基线由 PR-1 原始输出机械提取，非手写）**：

```
PR-2 新增（PR-1 无） = 0 条
PR-1 有而 PR-2 无（消失） = 0 条
失败文件计数 = 16（与 PR-1 同为 16，集合完全相同）
```

**失败信息区零引用改动面**（`Failed Tests` → `Test Files` 区间，696 行）：

```
grep -c 'server.ts'           = 3   ← 逐条核验：均为 **'routes/agent-observer.ts:1' 的子串命中**
                                        （架构门禁脚本测试的期望串），**非** src/server.ts
grep -c 'workspaces-api'      = 0
grep -c 'request-context'     = 0
grep -c 'rbacMiddleware'      = 0
grep -c 'canModifyWorkspace'  = 0
grep -c 'canAccessWorkspace'  = 0
grep -c 'getCurrentFilterClause' = 0
grep -c 'middleware-order'    = 0
grep -c 'workspace-access'    = 0
```

**污染与还原（显式路径，非 glob/非 `.`）**：全量运行改动 **6 个无关 tracked 文件**（与队长坑 3 完全一致），逐条 `git checkout -- <path>`（`RESTORE-PATH:` ×6）：

| 文件 | 运行前 sha256 | 运行后 | 还原后 | 一致 |
|---|---|---|---|---|
| `D817-capture-20260918.json` | `a605dad2…` | `9ac30947…` | `a605dad2…` | ✅ |
| `D819-capture-20260919.json` | `95cdefd1…` | `99926ab6…` | `95cdefd1…` | ✅ |
| `extensions/industries/saas-tech/thresholds.json` | `226580f6…` | `e0ea8617…` | `226580f6…` | ✅ |
| `extensions/industries/test-write/thresholds.json` | `43ec789b…` | `4390b8ee…` | `43ec789b…` | ✅ |
| `__pycache__/__init__.cpython-313.pyc` | `6a5ba32f…` | `82d00d7f…` | `6a5ba32f…` | ✅ |
| `__pycache__/feishu.cpython-313.pyc` | `43de78cc…` | `a72989f5…` | `43de78cc…` | ✅ |

`RESTORE_SHA256_IDENTICAL=YES`；还原后 `git status --porcelain` = 仅 2 个未跟踪治理产物、`git diff --stat` 空、HEAD 未变。
（未改域外文件、未回退在途工作、未 `git stash`。）

---

## 十五、变异体汇总（M7–M10，全部还原 + 无残留）

| 变异体 | 目标 | 我的探针红 | 交付夹具红 | 还原 |
|---|---|---|---|---|
| **M7** rbac 移回路由之后 | `src/server.ts`（2 目标：删 :366 + 插 :380 后） | 12 failed / 25（源码 2 + 运行时 10） | 4 failed / 12 | `CHECKOUT_EXIT=0` · `VERIFY-OK sha256 62926230e1370a10 == 变异前` · `STATUS_IDENTICAL=YES` |
| **M8** 摘除 `PUT /:id/status` 权限判据 | `src/routes/workspaces-api.ts` | 2 failed / 21（P3-e、P3-f） | 未跑 | `VERIFY-OK c4dbf41fdcef224b` · `STATUS_IDENTICAL=YES` |
| **M9** 漏斗兜底改回空集 | `src/services/request-context.ts` | 3 failed / 5（L-21-a/b/c） | 未跑 | `VERIFY-OK dfa488d5e7e14b8c` · `STATUS_IDENTICAL=YES` |
| **M10** 撤销部门判据收窄 | `src/middleware/rbac.ts` | 4 failed / 17（L-29-a/b、L-32-a/b） | 1 failed / 28（F-2） | `VERIFY-OK 287838852775a4f2` · `STATUS_IDENTICAL=YES` |

工具自检：`find` 不唯一命中 → `ABORT`（exit 2）不写文件；多目标 spec 逐目标重读（v3 修正 v2 的快照覆盖缺陷）。
结束态：`git status --porcelain` 仅 2 个未跟踪治理产物；`git diff --stat` 空 ⇒ **红证零残留** ✅

---

## 十六、未清项 / 登记项清单（诚实登记）

| # | 项 | 状态 | 去向 |
|---|---|---|---|
| 1 | **F-1 `/mine`、`/conflicts` 被 `/:id` 遮蔽（恒 404）** | 未修（CTO 裁定 (b)） | **CTO 执行「另立卡」**（可达面扩张须审） |
| 2 | **R5/REV-8 + L-18 第 2 条功能回退**（JWT 用户部门级恒 deny；桌面 seed 通道断） | 已登记、**本卡不修** | CTO 执行「另立卡」（桌面身份迁正规登录，Mac 域） |
| 3 | **E-1 卡面 11 文件口径过期**（实测 9 代码文件） | 已登记 | 队长/CTO 复核口径 |
| 4 | **E-2 merge 端点判据顺序**（形状校验先于授权判据；首层 403 仍在最前） | 低危观察 | K3 裁量 |
| 5 | **E-3/E-4 自验自查**（探针 setup 错 / 驱动参数错位致伪红） | 已修正并登记 | 本报告事实留痕 |
| 6 | **E-5 全量 16 失败文件未做前置版本对照跑** | 未清（残余不确定性） | 沿用 PR-1 R-3；本轮补充「失败面与 PR-1 逐文件相同」 |
| 7 | **L-27 P4 行号区间无夹具级守护** | 设计取舍（照旧） | K3 裁量 |
| 8 | 治理产物 `.claude/bypass.log` 进入 diff | 登记（不计入 PR 预算口径） | 队长/CTO 知晓 |

---

## 十七、方法与边界声明

1. **独立性**：全部结论来自我自跑的探针与命令；**未采信**编码者的完成声明；**未复制**夹具逻辑（P4 谓词与 L-29/L-32 判据均自实现，脚本与探针 sha256 见 §二）。
2. **口径纪律**：数字取自命令原始输出，需计数处给「共 N 处」；引用失败面时区分「子串命中」与「真实引用」（§十四 的 `agent-observer.ts`）；行尾/标记量等易误测量项以 node 读字节或源码判定为准。
3. **未做之事**：未改产品代码（除变异体 + 立即还原）；未 `git add/commit/push`；未碰 `scripts/audit/**`；未写审计标准；未用 `git stash` / `--no-verify` / force push；未新建工作树（E-5 对照实验因此未做）。
4. **判据归属**：P0 中间件侧 / P1 / P2-PR1 / L-20 / L-18 属 **PR-1 轮次**（见 `D947-verifier-pr1.md`）；本报告判 PR-2 轮次 + A2；跨批判据（P2 全局）按 L-12 在**两批齐备后**判。
5. **结论形态**：只给「自验结论」形态——**「可提请独立审计」**，附 §〇 六项登记与 §十六 未清项；**通过与否归 CTO 收件闸 + K3 终审**；本报告不判「通过」，也不宣称"产品被验证"。
