# D947 PR-2 独立复核报告（reviewer / task-9）

> **角色**：reviewer（独立复核员，**最后环节**；非编码、非自验，**自写探针**）
> **结论形态**：见 §16（只给「自验结论」/「可提请独立审计」/「退回（附理由）」，**不判「通过」**）
> **基准**：worktree `.synova-wt-d947-middleware`｜**PR-2 = commit B `2ea4df10`（9 文件）**｜HEAD `8c5c3ec8`（仅 `.claude/bypass.log` auto-hook 登记，**非代码**）
> **上游**：PR-1 主体 `77e0d6aa`（8 文件）· PR-1 fixup **A2 `313150bf`**（`rbac.ts` + `rbac.test.ts`，L-29/L-32）
> **日期**：2026-09-24（21:30–21:45，+08:00）
> **写集**：本报告是本轮唯一写入仓库的文件（`docs/synova/product-lines/evidence/D947-20260924/D947-reviewer-pr2.md`）

---

## §0 方法与独立性自证

| 项 | 事实 |
|---|---|
| 独立性 | **未读** `D947-verifier-pr2.md`；**未复用** task-8/task-6/task-7 的任何探针或夹具；编码者/自验者措辞一律不采信，全部自跑 |
| 探针落点 | 全部落 `%TEMP%\d947-review\`（Git Bash `/tmp/d947-review`），**零入仓**；残留由 §13 的 `git status --porcelain` 证明 |
| 自写探针 | `probe-pr2-source.mts`（源码级 13 项）· `probe-pr2-runtime.mts`（运行时 38 项：真实 express + 真实中间件 + 真实路由 + 真实 socket）· 复用 PR-1 轮的 `probe-p2-filter.mts` / `probe-n1-void.mts`（同源同题） |
| 重型验证 | L-26 协议（`owner` 文件 + **`UNLOCK_OK`/`UNLOCK_FAIL` 显式打印**）；实测输出 `UNLOCK_OK`；串行 ≤1 |
| 锁状态 | 全部运行结束复核：`LOCK_FREE` |

---

## §1 基准与写集核对

```
$ git show --name-only --format= 2ea4df10
src/routes/department-workspace.ts
src/routes/documents.ts
src/routes/workspaces-api.ts
src/server.ts
src/services/request-context.ts
tests/routes/department-workspace.test.ts
tests/routes/middleware-order.test.ts          (A 新建)
tests/routes/overflow.test.ts
tests/routes/workspace-access-write-endpoint.test.ts  (A 新建)
FILE_COUNT=9
```
- **PR-2 = 恰好 9 文件**（= 17 − PR-1 的 8，与 L-18 写集迁移一致）；≤12 ✅；`src/server.ts` 单写者 ✅。
- `git status --porcelain` = 仅 2 项**未跟踪治理产物**；`tracked_mods=0`（全部运行结束后复核，含重型跑动）⇒ **无越写集改动、无污染残留**。

---

## §2 P4 —— 源码断言 + **判别性**运行时探针

**源码级（我自写，`probe-pr2-source.mts`）→ exit=0，13/13 PASS**：
```
[PASS] S1.P4 豁免集恰好 5 项且顺序一致 : rbac 行号(1-based)=366 before_count=5
       before=["app.use(setupGuideGoneRouter);","app.use(llmConfigRoutes);","app.use(uploadV2GoneRouter);","app.use(authRoutes);","app.get('/api/status/budget', (req, res) => {"]
[PASS] S1b.L-2 区间 L∈[357,366] :: L=366
[PASS] S2.I4 rbac 晚于 jwtAuth/rateLimit，早于 homeRoutes/workspacesApiRoutes
       :: jwt@15960 rateLimit@16212 rbac@16768 homeRoutes@17435 workspacesApiRoutes@17560
```
- 断言锚在**标识符/路径**（无硬编码行号）；**L=366** 落在 L-2 冻结闭区间内（L-30 的卡面字面 `L<366` 已登记为过期口径，以 L-2 为准）。
- **I4 成立**：rbac(366) 晚于 `jwtAuthMiddleware`(344) 与 `rateLimitMiddleware`(352)。

**运行时判别性（L-5 正路径）—— 我做的是 L-5 的正路径 + 反证双证**：
```
[PASS] R1.P4 正路径 admin JWT → POST /api/workspaces → 200 且 owner=验签身份 :: status=200 owner=u-admin wsId=ws_mufkvkta
[PASS] R10.P4 反证：路由前无 rbacMiddleware（req.rbac 缺失）⇒ admin 写请求 403（前移非空操作）
       :: status=403 body={"ok":false,"error":"access denied"}
```
- R10 是**同进程 A/B 双 app**（A 挂 rbac、B 不挂），把「前移不是行为空操作」直接物理化 —— 不依赖任何夹具自报。
- **边界（诚实登记）**：R10 的反证对象是**「路由前是否有 rbacMiddleware」**；「`server.ts` 里这一行被移走」由 §2-S1/S2（源码断言）与**提交夹具的 createServer 运行时探针**覆盖（见 §13 变异体双红）。我的 runtime app 由我按 server.ts 次序自装配，故对后者不敏感。

---

## §3 P3 —— 五个写端点 + **403 断言在 P3 夹具在场**

**我的运行时探针（真实 socket；`probe-pr2-runtime.mts`）→ exit=0，38/38 PASS**，五写端点逐个：
```
[PASS] R2.P3  staff → POST /api/workspaces        → 403  :: status=403 body={"ok":false,"error":"access denied"}
[PASS] R3.P3  ga    → POST /api/workspaces        → 403  :: status=403
[PASS] R6.P3  ga    → PUT  /:id/status            → 403  :: status=403 id=ws_mufkvkta
[PASS] R7.P3  staff → POST /:id/messages          → 403  :: status=403
[PASS] R8.P3  ga    → POST /:id/sub               → 403  :: status=403
[PASS] R9.P3  ga    → PUT  /:id/merge（子工作区） → 403  :: status=403 subId=ws_sub_mufkvkv5
正路径对照（防「一律拒绝」伪绿）：
[PASS] R6b admin → PUT /:id/status → 200 ; R7b admin → POST /:id/messages → 200
[PASS] R8b admin → POST /:id/sub → 200 ; R9b admin → PUT /:id/merge → 200
```
**403 断言确实在 P3 夹具里**（复核 lead 口径 2）：
```
P3 fixture tests/routes/workspace-access-write-endpoint.test.ts  toBe(403)=12  toBe(200)=13  toBe(401)=3  toBe(404)=1  （28 it / 63 expect / 537 行）
P4 fixture tests/routes/middleware-order.test.ts                 toBe(403)=2   toBe(401)=3
```
**写端点守卫接线（L-4：消费 `req.rbac`，不重算）** —— **反爬口径复核（lead 坑 1）**：
```
$ grep -rn 'req\.rbac' src/ → count=9  ⇒ 9 行**全部是注释**（无一处是消费语句）
$ grep -n 'readRbac(' src/routes/workspaces-api.ts → 32:function readRbac(req…){ return (req as Request & { rbac?: RbacContext }).rbac; }  ;  55:  const rbac = readRbac(req);
$ grep -nE 'canModifyWorkspace|canAccessWorkspace' src/routes/workspaces-api.ts → 104/142/179/207/228/332（守卫调用点）
```
⇒ 若据 `grep 'req\.rbac'` 判「未接线」即为误判（**坑 1 已核实，未据此判**）；真实消费点是 `readRbac(req)`(55) → `requireVerifiedRbac` → 各端点守卫。

---

## §4 P3×P4 成对（L-5/L-22）

- **P4 绿而 P3 未接线 = 未完成**这条，本轮由两处**同一轮次内的独立证据**满足：§2 的 R1/R10（前移有效性）+ §3 的五端点 403/200 + §13 的两个变异体（M-P4 ⇒ 源码+运行时双红；M-P3 ⇒ 403 红）。**前移不是行为空操作**已由 R10 物理证明。
- **L-22 401 口径复核**：
```
[PASS] R4.L-22 无凭据 → 401（认证层先于路由守卫） :: status=401 body={"ok":false,"code":"UNAUTHORIZED","message":"Missing or invalid Authorization header…"}
```
⇒ 无凭据在 `jwtAuthMiddleware` 层被拦（**401**），**403 只出现在 P3 写端点** —— 与 L-22 订正一致；未采用「非 200 且 ∈{401,403}」模糊期望。

---

## §5 P6（零 `void` + 装配期零自欺 + import 收窄）

```
[PASS] S3.P6  关键判据零 void（src/ 全量扫描）  :: hits=0 []
[PASS] S3b.P7 无硬编码 admin::dev               :: hits=0 []
[PASS] S3c.P6 import 已收窄为仅 rbacMiddleware  :: import={rbacMiddleware}
```
（`src/server.ts:19` 实测 = `import { rbacMiddleware } from './middleware/rbac';`）

---

## §6 P2 全局收敛 = 0

```
[PASS] S4.P2 src/**/*.ts 中 conditions: [] 共 0 处 :: total=0 []
```
（我的探针在 Node 侧**递归遍历 `src/` 全部 `.ts`** 统计，不依赖 grep 口径；与 §3 的运行时 P2 探针合读。）
**L-12 跨批判据 ⇒ 本轮已可主张全局收敛**：PR-1 清 `auth.ts`、PR-2 清 `documents.ts:85/:112` + `request-context.ts:41`，四处齐备后 = 0。

---

## §7 P0（路由侧）/ P7（路由侧）

```
[PASS] S5.P0 路由侧无「活」自报头读取（全部命中均在注释） :: mentions=6 offenders=0
[PASS] R5.P0 仅自报头 → POST /api/workspaces → 401（自报身份不成立） :: status=401
```
- `src/routes/` 中 `x-synova-token` 共 6 处命中，**逐条均为注释**（`department-workspace.ts:9/19/20`、`workspaces-api.ts:27/266/269`）⇒ 无一处把该 header 的**值**当身份。
- P7 装配侧 `admin::dev` = 0（§5）；`department-workspace.ts` 的**自发送自报头**（原 `:75` 内部 fetch）已删（源码命中只剩注释）。

---

## §8 L-21（漏斗兜底 fail-closed）—— 运行时证

```
[PASS] S6.L-21  兜底返回非空 deny-all 条件集（源码形态）   :: denyConsts=true returnsNonEmpty=true
[PASS] S6b.L-21 源码中已无空集返回                        :: emptyReturnPresent=false
[PASS] R11.L-21 白名单路径 + 真实 JWT → 条件集非空且为 deny-all（不得为空集）
       :: status=200 condLen=1 field=__d947_no_authenticated_context
          body={"ok":true,"filter":{"conditions":[{"field":"__d947_no_authenticated_context","operator":"EQ","value":"__d947_deny_all__"}]}}
```
- R11 走**真实 socket + 白名单路径**（`/api/knowledge/ask` 在 `isWhitelisted` 内，因而不经 `runWithContext`）⇒ 直接命中兜底分支；**实测非空、deny-all**，`L-21` 的 fail-open 已闭合。
- 兜底同时 `log.warn` 留痕（`code: RBAC_DENIED, reason: no_request_context`，文案「被拒绝」）。

---

## §9 L-28 / F-1（`/mine`、`/conflicts` 被 `/:id` 遮蔽）

```
[PASS] S7.L-28 遮蔽现状确认（/:id 先于 /mine 与 /conflicts）:: iId=4539 iMine=10393 iConflicts=11681
[PASS] S7b.L-28 夹具含登记性 404 断言 + 「另立卡/不代表期望行为」字样 :: toBe404=true wording=true
[PASS] R13.L-28 现状锁定：/mine 无凭据 401；带合法 JWT 仍 404（被 /:id 遮蔽，已登记另立卡）
       :: anon=401 adminJWT=404 adminBody={"ok":false,"error":"workspace not found"}
```
- 夹具 `workspace-access-write-endpoint.test.ts:425` 具名「**登记性断言（F-1 未清）** … **锁定现状，不代表期望行为**」，行内 `:428` 明写「**F-1 已裁定 (b) 另立卡，本卡不修 ordering ⇒ 缺陷已登记，另立卡**」——**可见且不可静默漂移** ✅（`tests/` 内「另立卡」共 8 处）。
- 我的运行时探针独立复现同一 404 事实（admin JWT 亦 404）⇒ **登记为未清项**（§15 D-3）。

---

## §10 L-29 / L-32（部门判据收紧 + 空串 + owner 路径）

函数级独立复核（不读夹具结论，直接调用导出函数）：
```
[PASS] R14. L-29 双 undefined → deny            got=false        [PASS] R14b 仅 ctx 有值 → deny     got=false
[PASS] R14c 仅 ws 有值 → deny                   got=false        [PASS] R14d 双空串 → deny         got=false
[PASS] R14e 单侧空串(ctx) → deny                got=false        [PASS] R14f 单侧空串(ws) → deny   got=false
[PASS] R14g 同非空部门 → allow                  got=true         [PASS] R14h 跨部门 → deny         got=false
[PASS] R14i **owner 路径不受影响**（双 undefined 但 owner=自己） → allow  got=true
[PASS] R14j admin 旁路不变 → allow              got=true         [PASS] R14k staff/ga → deny      staff=false ga=false
[PASS] R15. L-32 twin 双 undefined / 单侧 undefined / 双空串 → deny    [PASS] R15d 同非空部门 → allow  got=true
[PASS] R15e twin admin 旁路不变 → allow         [PASS] R15f twin 未认证仍拒绝  [PASS] R15g owner 路径（private+owner=自己）→ allow
```
⇒ L-29 修复与 L-32 twin 收窄**均在场**，且 **owner 路径与 admin 旁路未被误伤**（这是 L-6/L-29 的关键不变量）。R14k/R15 也顺带证 `staff`/`ga` 未被放宽。

---

## §11 N1 必要性 + R5/REV-8 + 禁语

```
(a) N1 逐文件（PR-2 夹具）
tests/routes/department-workspace.test.ts            secret=1 devmode_set=1 assert=2 hookTimeout=0
tests/routes/middleware-order.test.ts                secret=1 devmode_set=1 assert=2 hookTimeout=2
tests/routes/overflow.test.ts                        secret=1 devmode_set=1 assert=2 hookTimeout=0
tests/routes/workspace-access-write-endpoint.test.ts secret=1 devmode_set=1 assert=2 hookTimeout=1
```
**N1 必要性**（复用 PR-1 轮同源设备级证据，本轮同姿态适用）：
```
[生产姿态(DEV_MODE=false + JWT_SECRET>=16)] 无凭据 → 401，未拿到 admin
[vitest 默认姿态(DEV_MODE=true + 无 JWT_SECRET)] 无凭据 → req.auth={"sub":"dev-admin","role":"admin",…} **拿到了 admin**
N1_NECESSITY: PROVEN
```
另：P4 夹具自带**有效性用例**「N1 有效性：无凭据访问非白名单路径 → 认证层 fail-closed 401（N1 若未生效则 devMode 自动 admin → 200）」——与我的姿态探针同义。
**L-25 合规**：P4 夹具 `beforeAll` 显式 `}, 120_000);`（实测依据 = 本机 `createServer()` bootstrap ≈15s > vitest 默认 hookTimeout 10s）。

```
(b) 禁语（9 个 PR-2 文件，UTF-8 hex 模式扫描）
TOTAL_known_limit=0（已知限制）  TOTAL_done=0（已完成）  TOTAL_rollback=5（功能回退）
(c) R5/REV-8 恒 deny 在场（5 处）
department-workspace.ts:23 · workspaces-api.ts:278「R5/REV-8: JWT 载荷无 department ⇒ 恒 undefined（已登记功能回退）」
department-workspace.test.ts:85 · workspace-access-write-endpoint.test.ts:235「403（R5/REV-8 已裁定为功能回退，非缺陷）」· :238
```

---

## §12 豁免路径回归（HTTP 层）+ I4

```
[PASS] R12a /health 直达 :: 200
[PASS] R12b POST /api/auth/login 直达 :: 200
[PASS] R12c /api/status/budget 直达 :: 200
[PASS] R12d /api/knowledge/ask 直达 :: 200
```
- 白名单条目在**中间件层**逐条直达（PR-1 轮 W7：23 条 `next()` 且无 4xx）与 **HTTP 层**（本节）双证 ⇒ **前移未把登录入口/白名单打死** ✅
- **I4**：源码 S2（rbac 晚于 jwtAuth/rateLimit）+ 运行时 R1（admin JWT 能拿到 `req.rbac` → 200）双证 ⇒ rbac 未早于 jwtAuth。

---

## §13 变异体（两处「删掉即报红」）+ 还原

**M-P4：把 `app.use(rbacMiddleware)` 移回 `workspacesApiRoutes` 之后**（改 `src/server.ts`，`git checkout --` 还原）
```
### mutated sha256 : 9bedd58e6c1090b74881e03c8f86c1ee19faa093a2f1ec4b4051bc2f97d82b60  （pristine 62926230…）
[FAIL] S1.P4 豁免集恰好 5 项 … :: rbac 行号(1-based)=381 before_count=**10**
[FAIL] S1b.L-2 区间 L∈[357,366] :: L=381
[FAIL] S2.I4 rbac 晚于 jwtAuth/rateLimit，早于 homeRoutes/workspacesApiRoutes :: rbac@17640 晚于 homeRoutes@17483/workspacesApiRoutes@17608
SUMMARY total=13 PASS=10 FAIL=3 → HARD_CRITERIA: RED
--- 提交夹具（真实 createServer + 真实 fetch）---
 FAIL  tests/routes/middleware-order.test.ts > P4-1 rbac 之前的「路由注册」恰好等于冻结豁免集 5 项
 FAIL  tests/routes/middleware-order.test.ts > P4-2 前移后计数值恒为 5
 FAIL  tests/routes/middleware-order.test.ts > I4 rbac 晚于 jwtAuthMiddleware 与 rateLimitMiddleware…
 FAIL  tests/routes/middleware-order.test.ts > P4 判别性正路径：合法 admin JWT → POST /api/workspaces → 200（变异体：rbac 移回 → req.rbac 缺失 → 403 红）
 Test Files  1 failed (1)      Tests  4 failed | 8 passed (12)
```
⇒ **源码断言 + 运行时探针双红 ✅**（3 项源码 + 1 项 `createServer` 运行时）。

**M-P3：摘掉 `POST /api/workspaces` 的写守卫**（改 `src/routes/workspaces-api.ts`，同上还原）
```
### mutated sha256 : 086e9d094caf91fa12370b0b49f6eaf16e087be940eb0c2812df975a461d5331  （pristine c4dbf41f…）
[FAIL] R2.P3 staff → POST /api/workspaces → 403 :: status=**200** body={"ok":true,"workspace":{…,"owner":"u-staff"…}}
[FAIL] R3.P3 ga    → POST /api/workspaces → 403 :: status=**200**
SUMMARY total=38 PASS=36 FAIL=2 → HARD_CRITERIA: RED
--- 提交夹具 ---
 FAIL  tests/routes/workspace-access-write-endpoint.test.ts > P3 · POST /api/workspaces — 写守卫 > staff → 403（含判据结果不得被丢弃）
 FAIL  tests/routes/workspace-access-write-endpoint.test.ts > P3 · POST /api/workspaces — 写守卫 > ga → 403（canModifyWorkspace 对 ga 恒 false）
 Test Files  1 failed (1)      Tests  2 failed | 26 passed (28)
```
⇒ **P3 必红 ✅**，且我的独立探针与提交夹具**同时**打红。

**还原与无残留三证（两次变异体均满足，L-24 主路径 A）**：
```
### restored sha256: 62926230e1370a103190fefc0bbdcf88240cced4edc2541aa6127f9b55dbf784   restored == pristine: YES
### restored sha256: c4dbf41fdcef224b276714dd268d1240c73750f58f6c773c5564f855f87676e3   restored == pristine: YES
### git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
### 锁：UNLOCK_OK（两次均显式打印）
```
（未用 `git stash`；未用 `--no-verify`。）

---

## §14 重型验证（L-26 锁内串行）+ 附带破坏

```
### cmd: npx vitest run tests/middleware tests/routes
### lock owner: Administrator pid=1862 2026-09-24T13:40:18Z
 Test Files  1 failed | 45 passed (46)
      Tests  444 passed | 21 skipped (465)
### vitest exit=1 ；UNLOCK_OK
 FAIL  tests/routes/llm-config.test.ts [ tests/routes/llm-config.test.ts ]  ← 唯一失败文件
```
- 唯一失败 = `tests/routes/llm-config.test.ts`，原文 **`Error: Hook timed out in 10000ms.`**（环境类，非断言失败）。
- **域外归因（独立交叉引用，未建 pristine 基线）**：该文件在 **PR-1 轮次的全量 B 相**（`out-ab/B-full-suite-current.log:10412`）**已是同一失败条目**，且属 lead 给出的 16 个域外失败文件之一 ⇒ **PR-2 未新增失败面**。
- 该文件**不在 PR-2 写集** ⇒ 按 lead 指示**不改**（L-25 允许的放宽只授给本卡夹具；借它改域外文件属越界）。
- **写集内目录全绿**：`tests/middleware`(7) 与 `tests/routes` 中除该域外文件外 **45 个文件全过** —— 含两个新建夹具 `middleware-order.test.ts`（12 tests）、`workspace-access-write-endpoint.test.ts`（28 tests）。
- **写集外附带破坏**：无（无新增红；`tests/middleware/auth.integration.test.ts`、`rate-limit.test.ts`、`rbac-ga-boundary.test.ts` 均在 45 通过之列）。

---

## §15 未清项 / 登记项 / 我的覆盖边界

| # | 项 | 事实 | 判定 |
|---|---|---|---|
| **D-1** | **L-22 口径订正**（REV-6 命令② 字面期望 403 → 实测 401） | 我独立复现：无凭据 → **401**（`jwtAuthMiddleware` 先于路由）；403 只在 P3 写端点（P3 夹具 12 处） | 复核**支持**该订正；属**对 CTO 冻结判据字面的修正** ⇒ 须在回执显著登记（**待 CTO 追认**） |
| **D-2** | **L-27**：P4 源码断言锚标识符 ⇒ **L∈[357,366] 区间无夹具守护** | 我实测 L=366 在区间内；夹具只断言「rbac 之前恰好 5 项」+ 相对次序 | 明示为设计取舍（L-27 已登记）；区间约束由本报告 §2 承担，供 K3 裁量是否另立守护 |
| **D-3** | **F-1 / L-28 未清**：`/mine`、`/conflicts` 被 `/:id` 遮蔽 ⇒ HTTP 恒 404（**先于本卡存在**） | 我独立复现（admin JWT → 404 'workspace not found'）；夹具含登记性断言 + 「另立卡」字样 | **未清项**；须 CTO 执行「另立卡」；不得写成「已完成」 |
| **D-4** | **L-23 外部漂移**：`origin/main` 前进 13 commit | 本机无推送凭据 ⇒ PR-2 base 只能声明为**栈式 base = PR-1 commit SHA**（R7 本地留存） | 登记；本机无法 rebase/push（禁 force push） |
| **D-5** | 我的 runtime 探针**不覆盖** `server.ts` 装配本体 | 我按 server.ts 次序自装配 app；对「server.ts 里 rbac 被移走」的敏感性由**源码断言 + 提交夹具的 createServer 运行时探针**承担（§13 已双红） | 覆盖边界（已在 §2 显著登记） |
| **D-6** | `/api/auth/login` 在我的探针中是**桩** | 白名单可达性语义已验；真实 login 端到端由 P4 夹具的 `createServer` 用例覆盖 | 覆盖边界 |
| **D-7** | **我自己的两次操作瑕疵（如实登记）** | ① 首版 runtime 探针把响应体截断到 160 字符后再 `JSON.parse` ⇒ R1 解析失败、R6–R9 链式 404（**探针 bug，非产品缺陷**）；已修（全文保留、仅显示截断）后重跑 38/38 PASS。② 我误用 pwsh `Get-Content/Set-Content` 往返改写 `/tmp` 探针（含中文）⇒ 编码损坏（`invalid UTF-8`，探针一度输出为空）；已用 write 工具重写。**两次均只影响 `/tmp` 探针，仓库零写入** | 披露以保可核性；不构成判据证据 |
| **D-8** | **L-31 未见于裁定集** | `grep -nE '^## L-'` 实测序列 L-1…L-30、L-32（**无 L-31 小节**） | 仅登记（不自行解释编号） |

---

## §16 结论形态

**自验结论（PR-2 轮次，独立复现）**：
P3（五写端点 403/200 正负双路径）· P4（源码断言 + 判别性运行时正路径 + 同进程反证）· **P3×P4 成对** · P6 · **P2 全局 = 0** · P0/P7（路由侧）· **L-21**（白名单路径非空 deny-all）· **L-28**（现状锁定 + 登记字样）· **L-29/L-32**（含空串四面 + owner 路径不受影响 + admin 旁路不变）· **N1 必要性** · **R5/REV-8**（恒 deny 在场）· 豁免路径 HTTP 回归 —— **逐条独立复现为绿**。
两处「删掉即报红」均取得**指定目标变红**的证据（M-P4 源码+运行时**双红**；M-P3 P3 必红），还原后**零残留**（sha256 逐字节相同 + `git status` 干净 + `UNLOCK_OK`）；PR-2 **恰好 9 文件**（≤12）；重型跑动**无新增失败面**（唯一失败文件为域外 hook 超时，PR-1 轮次同条目已红）。

**本轮内的硬判据未发现退回理由。** D-1/D-2/D-3 为**口径订正 / 设计取舍 / 跨卡未清**，D-4–D-8 为**漂移登记 / 覆盖边界 / 自身瑕疵披露**；**不**据以退回，亦**不得**写成「已完成」。

**⇒ 可提请独立审计**（附本报告 + `%TEMP%\d947-review\out-pr2\*`、`out-mut2\*`、`out-ab\*` 原始日志；命令逐条可复跑）。
**通过与否归 CTO 收件闸 + K3 终审 —— 本报告不判「通过」。**

---
*本件由 reviewer 独立产出；探针与临时产物**零入仓**，仓库写入仅本文件。*
