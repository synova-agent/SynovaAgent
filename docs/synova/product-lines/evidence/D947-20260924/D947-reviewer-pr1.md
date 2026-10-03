# D947 PR-1 独立复核报告（reviewer / task-5）

> **角色**：reviewer（独立复核员，**最后环节**；非编码、非自验，**自写探针**）
> **结论形态**：见 §13（只给「自验结论」/「可提请独立审计」/「退回（附理由）」，**不判「通过」**）
> **基准**：worktree `.synova-wt-d947-middleware`｜HEAD = `db54b926`（仅 `.claude/bypass.log` 一行 auto-hook 登记，**非代码**）｜**PR-1 = `77e0d6aa`**（父 `f25e61eb`）
> **日期**：2026-09-24（20:33–20:56，本机时区 +08:00）
> **写集**：本报告是本轮唯一写入仓库的文件（`docs/synova/product-lines/evidence/D947-20260924/D947-reviewer-pr1.md`）

---

## §0 方法与独立性自证

| 项 | 事实 |
|---|---|
| 独立性 | **未读** `D947-verifier-pr1.md`；**未复用** task-1/task-4 的任何夹具或探针；编码者/自验者的措辞一律不采信，全部自跑 |
| 探针落点 | 全部落 `%TEMP%\d947-review\`（= Git Bash `/tmp/d947-review`），**零入仓**；仓库残留由 §10 的 `git status --porcelain` 证明 |
| 探针形态 | `npx tsx <绝对路径>.mts` + 绝对路径 `file://` import `src/**`（tsx 4.22.4 / vitest 4.1.8 已自证可用）；**不用仓库内测试目录** |
| 重型验证 | 全部串行，持 `/tmp/d947-heavy.lock`（mkdir 原子锁 + rmdir 释放），同一时间 ≤1 |
| 自写探针清单 | `probe-p0p1.mts`（P0/P1 + 判据层）· `probe-p2-filter.mts`（P2 运行时漏斗）· `probe-p5-failclosed.mts` × 8 场景（P5/L-20 留痕）· `probe-l20-whitelist.mts`（L-20 中间件层）· `probe-http-layer.mts`（L-20 + 可达性 HTTP 层）· `probe-n1-void.mts`（N1 必要性）· `probe-logchannel.mts`（日志通道自证） |

**探针判别力自证（防「探针恒红」伪证）**：每条判据探针都带**对照腿**，且改动前基线为红 —— 见 §2/§3 的「改动前基线」行。

---

## §1 基准与写集核对

```
--- git show --stat --oneline 77e0d6aa ---
 src/middleware/auth.ts                            | 140 +++++++++--
 src/middleware/rbac.ts                            |  64 ++++-
 tests/middleware/auth.test.ts                     | 278 ++++++++++++++++++++--
 tests/middleware/permission-filter.test.ts        | 169 +++++++++++++
 tests/middleware/rbac-default-deny.test.ts        | 172 +++++++++++++
 tests/middleware/rbac.test.ts                     |  90 +++++--
 tests/routes/diagnosis-report-persistence.test.ts |  75 +++++-
 tests/routes/ga-auth.test.ts                      |  49 +++-
 8 files changed, 953 insertions(+), 84 deletions(-)
FILE_COUNT=8   （name-only 逐行计数）
```

- **PR-1 = 恰好 8 文件 ≤ 12 ✅**；与 **L-18 写集迁移**（原 6 + 迁入 2）逐文件一致；总盘子 17（8+9）不变。
- `git diff --stat`（未暂存）= **空**；`git status --porcelain` = 仅 2 项**未跟踪治理产物**（`.claude/task-briefs/2026-09-24-D947-...md`、`docs/.../evidence/D947-20260924/`）⇒ **无越写集改动**。
- `db54b926` 只向 `.claude/bypass.log` 追加一行 auto-hook 的 `pre-commit PASS`（含 `HASH=77e0d6aa...`）⇒ **PR-1 本次提交未经 `--no-verify`**（该行由 pre-commit 通过后写入）。

---

## §2 P0（客户端自报身份完全失效）· P1（无凭据 ≠ admin）— **绿**

命令（worktree 根）：`npx tsx C:/Users/.../d947-review/probe-p0p1.mts` → **exit=0**
```
[PASS] P1.mw.无凭据.非admin :: next=true status=null threw=null role=staff userId=unauthenticated authed=false
[PASS] P1.judgment.无凭据.canAccessWorkspace(global)=false :: canAccess=false ctx={"role":"staff","userId":"unauthenticated","authenticated":false}
[PASS] P1.judgment.无凭据.canModifyWorkspace(global)=false :: canModify=false
[PASS] P0.mw.header(admin::x) :: next=true status=null threw=null role=staff userId=unauthenticated authed=false
[PASS] P0.mw.query(?token=admin::x) :: next=true status=null threw=null role=staff userId=unauthenticated authed=false
[PASS] P0.mw.header(manager:DEPT:user) :: next=true status=null threw=null role=staff userId=unauthenticated authed=false
[PASS] P0.mw.query(?token=ga::x) :: next=true status=null threw=null role=staff userId=unauthenticated authed=false
[PASS] P1.funnel.无凭据 :: raw={"role":"staff","userId":"unauthenticated","authenticated":false} err=null
[PASS] P0.funnel.header(admin::x) :: raw={"role":"staff","userId":"unauthenticated","authenticated":false} err=null
[PASS] P0.funnel.query(token=admin::x) :: raw={"role":"staff","userId":"unauthenticated","authenticated":false} err=null
[PASS] P0.extractAuth.header(admin::x) :: out=null err=null
[PASS] P0.extractAuth.header(manager:DEPT:user) :: out=null err=null
[PASS] P0.extractAuth.header(ga::x) :: out=null err=null
[PASS] 对照.合法JWT.staff放行 :: jwtNext=true rbacNext=true role=staff userId=u-staff authed=true
SUMMARY total=14 PASS=14 FAIL=0
HARD_CRITERIA: GREEN (硬判据失败数=0)
```
- **改动前基线（同一探针族，PR-1 落地前）**：`SUMMARY total=12 PASS=1 FAIL=11`（`P1...无凭据 :: 放行 role=admin`、`P0...header(admin::x) :: 放行 role=admin`、`extractAuth...out={"role":"admin",...}`），**对照腿仍绿**（`对照.合法JWT放行.staff :: role=staff userId=u-staff`）⇒ 探针非恒红、改动即由红转绿。
- **判据层纵深**：无凭据上下文（`authenticated:false`）在 `canAccessWorkspace` / `canModifyWorkspace` 上**实际返回 false**（不只是「角色名不是 admin」）。

---

## §3 P2（**仅 PR-1 部分**：漏斗不再恒空）— **绿（本轮不主张全局 =0，遵 L-12）**

命令：`npx tsx .../probe-p2-filter.mts` → **exit=0**（运行时执行，非 grep）
```
[PASS] P2.staff.getCurrentFilterClause.非空 :: nextCalled=true status=null cap={"conditions":[{"field":"access.sensitivity","operator":"IN","value":["normal"]}]} condLen=1 err=null
[PASS] P2.manager.getCurrentFilterClause.非空 :: cap={"conditions":[{"field":"access.sensitivity","operator":"IN","value":["normal"]}]} condLen=1 err=null
[PASS] 对照./health 白名单直达 :: nextCalled=true status=null
SUMMARY total=3 PASS=3 FAIL=0 ; HARD_CRITERIA: GREEN
```
- 改动前基线（同探针）：`cap={"conditions":[]} condLen=0` → FAIL ×2，`/health` 对照腿 PASS。
- 说明：本探针**穿真实 `jwtAuthMiddleware`**，在 `next()` 的 AsyncLocalStorage 上下文内调 `request-context.getCurrentFilterClause()` ⇒ 证明漏斗**被执行**（不是「接线了」）。

**L-15（注释改写 vs 消音凑绿）独立核对**（`git-evidence.sh`，BEFORE=`f25e61eb` / AFTER=`77e0d6aa`）：
```
--- BEFORE 侧 conditions 行 ---
355:          getPermissionFilter: async () => ({ conditions: [] }),      ← **实现位**（非注释）
--- AFTER 侧 conditions 行 ---
451:            conditions: [                                               ← 真实现体
```
- 判定：**实现位确实已改**（运行时探针独立佐证 conditions 非空）⇒ **不是**把判据躲过去；AFTER 侧 `conditions` 字面量仅 1 处（实现数组），**注释中无被判据针对的字面量**。
- `grep -rn --include=*.ts -- "conditions: \[\]" src/ | wc -l` 当前 = **3**，逐条：
```
src/routes/documents.ts:85:    const { results } = store.search('', { conditions: [] }, 100);
src/routes/documents.ts:112:    const { results } = store.search(id, { conditions: [] }, 50);
src/services/request-context.ts:41:  if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };
```
⇒ **三处全属 PR-2 写集**（`auth.ts` 已不在其列）。按 **L-12**，本轮**不主张全局 =0**。

---

## §4 P5（fail-closed + 三态可区分 + 留痕）— **绿**

命令：`bash run-p5b.sh <out> pr1`（每场景**独立进程**，使 fd2 上 pino 日志可按场景归因）→ **runner exit=0**
```
=== per-scenario keyword counts (grep -c; full set, all scenarios) ===
rbac-no-cred           | REJECT=3 UNAVAIL=0 ERROR=0 IGNORED=0 | code=none            | next=true status=null role="staff" authed=false judgmentDenied=true failClosed=yes
rbac-self-report       | REJECT=3 UNAVAIL=0 ERROR=0 IGNORED=0 | code=none            | next=true status=null role="staff" authed=false judgmentDenied=true failClosed=yes
rbac-headers-throws    | REJECT=3 UNAVAIL=0 ERROR=0 IGNORED=0 | code=none            | next=true status=null role="staff" authed=false judgmentDenied=true failClosed=yes
jwt-bad-token          | REJECT=1 UNAVAIL=0 ERROR=0 IGNORED=0 | code=AUTH_REJECTED   | next=false status=401 failClosed=yes
jwt-no-header          | REJECT=1 UNAVAIL=0 ERROR=0 IGNORED=0 | code=AUTH_REJECTED   | next=false status=401 failClosed=yes
jwt-bearer-no-secret   | REJECT=0 UNAVAIL=1 ERROR=0 IGNORED=0 | code=AUTH_UNAVAILABLE| next=false status=401 failClosed=yes
jwt-headers-throws     | REJECT=0 UNAVAIL=0 ERROR=1 IGNORED=0 | code=AUTH_ERROR      | next=false status=500 failClosed=yes
whitelist-invalid      | REJECT=0 UNAVAIL=0 ERROR=0 IGNORED=1 | code=AUTH_REJECTED   | next=true status=null whitelistStillPassed=true（按 L-20 语义，白名单不适用 fail-closed）
```
三态各一原始日志行（fd2 原始输出）：
```
{"code":"AUTH_REJECTED",   "reason":"missing_or_invalid_authorization_header","path":"/api/workspaces/mine","msg":"安全判据: 被拒绝 — 缺 Authorization/Bearer 头（HTTP 401，fail-closed）"}
{"code":"AUTH_UNAVAILABLE","reason":"JWT_SECRET not configured",              "path":"/api/workspaces/mine","msg":"安全判据: 不可用（系统异常）— JWT_SECRET 不可用，fail-closed 拒绝（HTTP 401）"}
{"code":"AUTH_ERROR",      "err":{...},                                       "msg":"安全判据: 出错 — jwtAuthMiddleware 异常（HTTP 500，degraded:true）"}
{"code":"RBAC_DENIED","reason":"no_authenticated_context","msg":"安全判据: 被拒绝 — 无认证上下文（fail-closed，不回退自报凭据/不回退 admin）"}
```
- **三态可区分**：`被拒绝`=AUTH_REJECTED / `不可用（系统异常）`=AUTH_UNAVAILABLE / `出错`=AUTH_ERROR，各自可被独立场景触发且**码与文案一一对应**。
- **诊断工具链自证**：`probe-logchannel.mts` 先证「pino → fd2 能被捕获」（否则「留痕」不可测）；已通过（`{"level":40,...,"msg":"D947-PROBE-LOGCHANNEL-WARN"}`）。
- **诚实披露 1**：场景 `rbac-headers-throws` **未真正触发异常路径** —— 改动后 `extractRbacContext` **不再读 `headers`**，故该场景等价于 `rbac-no-cred`（REJECT=3 两场景相同即证据）。异常路径的「出错」态由 `jwt-headers-throws` 覆盖。

---

## §5 N1（硬前置的**存在性**与**必要性**）

**存在性**（逐文件计数，`secret_refs`=`d947-test-secret-0123456789` 出现次数）：
```
tests/middleware/auth.test.ts                      secret_refs=1 devmode_set=5 devmode_expect=1
tests/middleware/permission-filter.test.ts         secret_refs=1 devmode_set=1 devmode_expect=1
tests/middleware/rbac-default-deny.test.ts         secret_refs=1 devmode_set=1 devmode_expect=1
tests/middleware/rbac.test.ts                      secret_refs=0 devmode_set=0 devmode_expect=0   ← 登记项 D-1
tests/routes/diagnosis-report-persistence.test.ts  secret_refs=2 devmode_set=3 devmode_expect=2
tests/routes/ga-auth.test.ts                       secret_refs=1 devmode_set=1 devmode_expect=1
```

**必要性（姿态级，独立探针）**：`npx tsx probe-n1-void.mts` → **exit=0**
```
env setting: JWT_SECRET.len=31 DEV_MODE=false
[生产姿态(DEV_MODE=false + JWT_SECRET>=16)] next=false status=401 req.auth=null → 角色=(无) 无凭据却未拿到 admin
env setting: JWT_SECRET=undefined DEV_MODE=true
[vitest 默认姿态(DEV_MODE=true + 无 JWT_SECRET)] next=true status=null req.auth={"sub":"dev-admin","role":"admin",...} → 角色=admin 无凭据却**拿到了 admin**
N1_NECESSITY: PROVEN
```
⇒ **vitest 默认姿态下「无凭据 ⇒ 不得 admin」判据必然失真**；N1 前置是判据有效性的**前提**，不只是形式要求。

**必要性（夹具级，变异体）**：删掉 `tests/middleware/auth.test.ts` 的 `beforeAll` 硬前置整块 → `npx vitest run tests/middleware/auth.test.ts` → `Test Files 1 passed (1) / Tests 34 passed (34)`，**仍全绿**（该文件另有逐用例 env 建立）。⇒ **登记 D-2**：该文件级前置对**结果**非必要（冗余护栏），N1 的必要性由上面的姿态探针证明。

---

## §6 L-20 白名单语义（「不要求认证」≠「忽略认证」）

**中间件层**：`npx tsx probe-l20-whitelist.mts` → **exit=0**
```
[PASS] L20.W1 白名单+合法Bearer → 注入且可被路由采纳 :: req.auth={"sub":"u-l20","role":"staff",...} extractAuthFromRequest={"role":"staff","userId":"u-l20","orgId":"org-l20"}
[PASS] L20.W2 白名单+无效Bearer → 不注入且仍放行 :: next=true status=null req.auth=null
[PASS] L20.W3 白名单+无凭据 → 不注入且仍放行 :: next=true status=null req.auth=null
[PASS] L20.W4 白名单+自报x-synova-token → 不注入 :: next=true status=null req.auth=null req.rbac=null
[PASS] L20.W5 白名单+?token=自报 → 不注入 :: next=true status=null req.auth=null
[PASS] L20.W6 非白名单+无凭据 → 401 :: next=false status=401
[PASS] L20.W7 白名单条目 23 条逐条直达 :: 全部 23 条 next() 且无 4xx
```
- W1 的「采纳」断言用的是**路由内同一调用**（`extractAuthFromRequest(req)`，= `solutions.ts:36/93` 的 requireAuth 路径）⇒ 不是间接覆盖。

**HTTP 层（真实 socket + 真实中间件 + 真实 solutions 路由）**：`npx tsx probe-http-layer.mts` → **exit=0**
```
[PASS] HTTP./health 直达 :: status=200
[PASS] HTTP.POST /api/auth/login 直达 :: status=200
[PASS] HTTP./api/status/budget 直达 :: status=200
[PASS] HTTP./api/knowledge/ask 直达 :: status=200
[PASS] HTTP.非白名单无凭据 → 401 :: status=401 body={"ok":false,"code":"UNAUTHORIZED",...}
[PASS] HTTP.非白名单合法JWT → 200 :: status=200 body={"ok":true}
[PASS] HTTP.L-20 /api/solutions + 真实JWT → 200 ok:true :: body={"ok":true,"solutions":[],"degraded":false}
[PASS] 对照.HTTP /api/solutions 无凭据 → 401 :: body={"ok":false,"code":"UNAUTHORIZED"}
[PASS] 对照.HTTP /api/solutions + x-synova-token → 401 :: body={"ok":false,"code":"UNAUTHORIZED"}
SUMMARY total=9 PASS=9 FAIL=0
```
**白名单列表未被改动（git 级取证）**：
```
before: lines=31 sha256=54c3851da8a55e01af2fef897edef093a0b99ec15856c04a0bb7b64803dca64d
after : lines=31 sha256=54c3851da8a55e01af2fef897edef093a0b99ec15856c04a0bb7b64803dca64d
--- diff -u ---（无输出） diff exit=0
before entries=8   after entries=8        （path === / startsWith / endsWith 计数）
```
⇒ 白名单函数**逐字节一致**（未加未减）。

---

## §7 L-16「中间件侧自报通道」的语义判据 — **绿**

```
$ grep -rn -- "x-synova-token" src/middleware/   → COUNT=5（与队长口径一致）
src/middleware/auth.ts:480: * 已删除 `x-synova-token` 自报分支——该 header 不经验签即可自封 `role`      ← 注释
src/middleware/auth.ts:501:  // D947: 原 x-synova-token 自报分支已删除——无验签的 `role:orgId:userId`    ← 注释
src/middleware/auth.ts:503:  if (req.headers?.['x-synova-token'] !== undefined) {                        ← **存在性判定**
src/middleware/auth.ts:506:      '安全判据: 被拒绝 — 忽略未验签的 x-synova-token 自报凭据（fail-closed）'  ← 留痕文案
src/middleware/rbac.ts:115: * 本函数**不再读取** `x-synova-token` / `query.token` 等自报凭据——此类字符串 ← 注释
```
- **语义判据**：`5 处中 1 处为实际读取，且仅判「存在性」（`!== undefined`）→ 返回 `null` + `被拒绝` 留痕**，无一处把该 header 的**值**当身份来源（对照：改动前 `parts[0] as WorkspaceRole`）。
- **L-16 硬要求（拒绝分支必须保留）✅**：`:503-508` 显式拒绝分支在，且**未**为凑 `grep=0` 而删除。
- 运行时佐证：§2 的 `P0.extractAuth.header(admin::x) :: out=null`。

---

## §8 L-18 迁移两件（断言强化 / N1 / 功能回退登记 / 措辞）

| 检查项 | `tests/routes/ga-auth.test.ts` | `tests/routes/diagnosis-report-persistence.test.ts` |
|---|---|---|
| 断言形态 | `expect(ok).toBe(false)` + `status→401` + `body().code==='UNAUTHORIZED'`（**精确**，非弱断言） | 真实 `signJwtToken` + `Authorization: Bearer` → `expect(status).toBe(200)` + `body.ok===true` + `Array.isArray(solutions)`（**提高**强度） |
| N1 | 文件级 `beforeAll`（:18-23） | `beforeAll`（:37-42）+ 用例 6 就地重设并自证（:358-362） |
| 功能回退登记 | §功能回退登记（:104-121，3 处字样） | §功能回退登记（:519-536，4 处字样） |
| 对照探针 | — | `GET /api/d593-probe`（非白名单）→ **401**（证明白名单未被放宽） |

**禁语扫描（UTF-8 直写安全版；此前一版用 ASCII 编码脚本导致模式被破坏，已作废重跑）**：
```
TOTAL_known_limit=0      （已知限制）
TOTAL_done=0             （已完成）
TOTAL_rollback=7         （功能回退：ga-auth 3 + diagnosis 4）
```
**弱断言扫描**：`grep -nE "not\.toBe\((401|403|200)\)"` 命中 3 行 = 2 行**注释** + 1 行**实现**
```
tests/routes/diagnosis-report-persistence.test.ts:348:  expect(res.status, `${method} ${path} 不应 401（D593 白名单五前缀）`).not.toBe(401);
```
→ 该行针对**四个既有白名单前缀**（`/api/diagnosis/reports`、`/api/notifications`、`/api/ga/clients`、`/api/ga/switch`），**不是** L-18 迁移的 `/api/solutions` 用例（后者已在 :372-375 强化）⇒ **登记 D-3**（既有弱断言，非本卡范围，供 K3 判定是否一并收紧）。

---

## §9 冲突扫描复核 + 附带破坏检查

**`grep -rn -- "x-synova-token" src/ tests/` 全量（完整输出，不截断）**：
```
TOTAL_HITS=39      SRC_HITS=9      TESTS_HITS=30      MIDDLEWARE_SRC_HITS=5      FILES=13
--- per-file counts ---
src/middleware/auth.ts:4        src/middleware/rbac.ts:1
src/routes/department-workspace.ts:2   src/routes/workspaces-api.ts:1   src/server.ts:1
tests/middleware/auth.test.ts:10       tests/middleware/permission-filter.test.ts:1
tests/middleware/rbac-default-deny.test.ts:3   tests/middleware/rbac.test.ts:6
tests/routes/department-workspace.test.ts:1    tests/routes/diagnosis-report-persistence.test.ts:3
tests/routes/ga-auth.test.ts:5    tests/routes/overflow.test.ts:1
```
（`src/routes/*` 与 `src/server.ts` 的命中属 **PR-2 写集**：`department-workspace.ts:13/75`、`workspaces-api.ts:178`、`server.ts:247` 硬编码 `'admin::dev'` + `:248/:249` 两处 `void` —— **本轮不判**。）

**附带破坏（6/8 文件 diff 查不出的盲区）**：`npx vitest run tests/middleware`（**整目录 7 文件**）+ L-18 两件，持锁串行：
```
### cmd: npx vitest run tests/middleware tests/routes/ga-auth.test.ts tests/routes/diagnosis-report-persistence.test.ts
 Test Files  9 passed (9)
      Tests  135 passed (135)
   Duration  5.05s
### vitest exit=0
```
⇒ **写集外的 3 个文件全绿**：`tests/middleware/auth.integration.test.ts`、`rate-limit.test.ts`、`rbac-ga-boundary.test.ts` —— **无写集外附带破坏** ✅

---

## §10 变异体（「删掉即报红」判别性证据）与还原三证

每处：**改坏 → 跑探针 + 跑提交的夹具 → 贴红 → `git checkout -- <file>` 还原 → 三证**。
（PR-1 已提交，故 `git checkout --` 安全；**未用** `git stash`。）

| 变异体 | 改法 | 探针红 | 提交夹具红 | 还原三证 |
|---|---|---|---|---|
| **M1** rbac 兜底改回 admin | `return { role:'admin', userId:'dev' }` | `HARD_CRITERIA: RED (硬判据失败数=10)` | `rbac-default-deny` 9 中 7 红 + `rbac.test` 36 中 9 红 = **16 failed / 29 passed (45)** | sha `c94e90a3…` == pristine；`git status` 无该文件 |
| **M2** 漏斗改回恒空 | `getPermissionFilter: async () => ({ conditions: [] })` | `P2 失败数=2`（`cap={"conditions":[]} condLen=0`） | `permission-filter` **4 failed / 2 passed (6)** | sha `9c286ae1…` == pristine；`git status` 无该文件 |
| **M5** 白名单吞掉合法 Bearer | `if (false) { auth = whitelistResult.payload }` | `L20.W1 :: req.auth=null extractAuthFromRequest=null`（1 FAIL） | `auth.test` 的 `L-20: 白名单 + 验签通过的 Bearer → 注入 req.auth…` 红（`expect(req.auth).toBeTruthy()`）+ `diagnosis…` 用例 6 红（`GET /api/solutions 携带真实 JWT 应 200`）= **2 failed / 44 passed (46)** | 同上 |
| **M6** 白名单对无效 Bearer 也注入 | `if (true) { auth = payload ?? {sub:'forged',role:'admin',...} }` | `L20.W2 :: req.auth={"sub":"forged","role":"admin",...}`（1 FAIL） | `auth.test` **2 failed / 41 passed (43)**（`L-20/P0: 无效 Bearer → 不注入`、`L-20: Bearer 但判据不可用 → 不注入`）；`rbac-default-deny` **9 passed**（变异体定向性，非连带全红） | 同上 |
| **N1** 删 `auth.test.ts` 的 beforeAll | 整块删除 | — | **34 passed（仍绿）** ⇒ 见 §5 D-2 | sha 与 `git show HEAD:…` 逐字节相同（`5c777c56…`）；`git diff HEAD -- <file>` 空；`git status --porcelain` 干净；全仓库 `grep -rn "D947-REVIEWER-MUTANT" src/ tests/` **exit=1 无输出** |

**红证不残留（本轮最终态）**：
```
$ git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
tracked modifications = 0
$ sha256sum src/middleware/auth.ts src/middleware/rbac.ts
9c286ae165721d21966b75318a56ae3f66ced3efaaec82611dd89bcb26471087 *src/middleware/auth.ts
c94e90a3480209fd0923a047139c7aefc5ad45832a0bb578cc9af4aef560b8e4 *src/middleware/rbac.ts
$ grep -rn "D947-REVIEWER-MUTANT" src/ tests/     → exit=1（无输出）
```
**如实登记一处我自己的操作瑕疵**：N1 变异体首次运行我向脚本传了**占位 sha**（非真值），故该行打印 `restored == pristine: NO` —— 属**入参错误**，非还原失败；随后以「当前文件 sha == `git show HEAD:` 版本 sha + `git diff` 空 + status 干净」三证重做（见上表末行）。

---

## §11 附带项：全量套件 **受控 A/B 归因**（独立归因，非 PR-1 判据）

- **B 相（HEAD = PR-1 在场）**：`npx vitest run`（持锁）
```
 Test Files  16 failed | 593 passed | 3 skipped (612)
      Tests  59 failed | 4354 passed | 66 skipped (4479)
   Duration  210.41s
```
- **A 相（`src/middleware/{auth,rbac}.ts` 回退到 `77e0d6aa^` = `f25e61eb`，逐字节校验 `git diff f25e61eb -- <2 files>` 空；同 16 文件批次重跑）**：
```
 Test Files  16 failed (16)
      Tests  58 failed | 30 passed | 40 skipped (128)
### A-phase vitest exit=1
### restore: git checkout HEAD -- 2 middleware files → sha 回 pristine（9c286ae1… / c94e90a3…）
```
⇒ **仍红 ⇒ 与 D947 无关**（域外/环境）。
- **唯一差异用例**（A/B 逐用例集合比对：`ONLY_IN_B=1`、`ONLY_IN_A=0`）：
```
tests/architecture/check-architecture-gate.test.ts > CT-64: … > 真实仓库：SYNO_CI=1 下存量仍 exit 0（基线棘轮…）
```
B 侧失败原文 = **`Error: Test timed out in 30000ms.`**（非断言失败）。**定向复核**：PR-1 在场单独重跑该用例 →
```
### cmd: npx vitest run tests/architecture/check-architecture-gate.test.ts -t 真实仓库
 Test Files  1 passed (1)       Tests  2 passed | 10 skipped (12)      Duration 17.01s
### vitest exit=0
```
⇒ 该例在**全量负载下超时**、单独跑通过 ⇒ **非 D947 引起，归因关闭**。
- 成因类分布（B 相原始行）：`Cannot find package 'zustand'`（electron-renderer 3 处）· `Cannot find package '@modelcontextprotocol/sdk/types.js'`（`src/mcp/tool-definitions.ts`）· `Hook timed out in 10000ms` · golden-scenarios 的 spawn 型 CLI 断言（`expected null to be +0`）· `mac-install-verify` 执行位（Windows）· 架构门禁 9 例（见上，1 例超时 + 8 例与 A 相同）。
- **A/B 运行副作用已用显式路径还原**（非 glob、非 `.`）：
```
$ git checkout -- docs/synova/product-lines/evidence/D817-capture-20260918.json docs/synova/product-lines/evidence/D819-capture-20260919.json extensions/industries/saas-tech/thresholds.json extensions/industries/test-write/thresholds.json synova_worker/connectors/__pycache__/__init__.cpython-313.pyc synova_worker/connectors/__pycache__/feishu.cpython-313.pyc
checkout exit=0 → 之后 `git status --porcelain` 仅剩 2 项未跟踪治理产物，tracked modifications = 0
```

---

## §12 未清项 / 形态差异登记（**不写成「已完成」**）

| # | 登记项 | 事实 | 我的判定 |
|---|---|---|---|
| **D-1** | `tests/middleware/rbac.test.ts` **无 N1 硬前置**（`secret_refs=0 devmode_set=0 devmode_expect=0`） | 其用例为纯函数级（显式构造 `RbacContext`），不读 env | 与 Ruling N1 字面「每个夹具文件」不一致；**不构成空转**（M1 证明该文件可被打红 9 例）。属**形态差异**，是否符合 Ruling 交 CTO/K3 裁定 |
| **D-2** | N1 文件级前置在 `auth.test.ts` 上**对结果非必要**（删后 34/34 仍绿） | 该文件另有逐用例 env 建立 | 冗余护栏；N1 的**必要性**改由姿态探针证明（§5）。非退回理由 |
| **D-3** | `diagnosis-report-persistence.test.ts:348` 保留 1 处 `not.toBe(401)` 弱断言 | 针对 4 个**既有**白名单前缀，非 L-18 迁移的 `/api/solutions` 用例 | 非本卡范围；供 K3 判定是否一并收紧 |
| **D-4** | **L-21 本轮未清**（白名单路径不经 `runWithContext` ⇒ `getCurrentFilterClause()` 落 `request-context.ts:41` 空集兜底 = fail-open） | 属 **PR-2b / code-c** | 按 L-21 第 5 条登记为**未清**，task-8 必须显式复验；本轮不作为退回理由 |
| **D-5** | HTTP 层证据的边界 | 我**未**跑 `createServer()` 真实装配（其 `Bootstrap.run()` 失败即 `process.exit(1)`）；改用「自建最小 app + 真实 `jwtAuthMiddleware` + 真实 `solutions` 路由 + 真实 socket」 | 覆盖「中间件 + 路由内采纳 + 可达性」；**server.ts 装配顺序**属 PR-2 射程，本轮不主张已验 |
| **D-6** | `login` 处理器 | 我的 HTTP 探针用**桩**挂 `/api/auth/login`（验证白名单可达性语义），未挂真实 handler | 可达性结论成立；真实 login 端到端不在本轮判据内 |

---

## §13 结论形态

**自验结论（PR-1 轮次，独立复现）**：
P0 · P1 · P2（PR-1 部分）· P5（三态 + 留痕）· N1（存在性 + 姿态必要性）· L-15 · L-16 · L-18 · L-20（含 HTTP 层）**逐条独立复现为绿**；5 个变异体（M1/M2/M5/M6/N1）均取得**指定目标变红**的证据，还原后**零残留**；PR-1 **恰好 8 文件**（L-18 迁移，≤12），**无写集外附带破坏**（`tests/middleware` 整目录 9 文件 135 tests 全绿）；全量套件 16 个失败文件经**受控 A/B** 归因为**域外**（含唯一差异用例的定向复核）。

**本轮内的硬判据未发现退回理由。** D-1–D-6 为**形态差异 / 跨批未清 / 覆盖边界**登记，**不**据以退回，也不得据此写成「已完成」。

**⇒ 可提请独立审计**（附本报告 + `%TEMP%\d947-review\` 原始日志：`out-pr1/*`、`out-mut/*`、`out-ab/*`；命令逐条可复跑）。
**通过与否归 CTO 收件闸 + K3 终审 —— 本报告不判「通过」。**

---
*本件由 reviewer 独立产出；探针与临时产物**零入仓**，仓库写入仅本文件。*
