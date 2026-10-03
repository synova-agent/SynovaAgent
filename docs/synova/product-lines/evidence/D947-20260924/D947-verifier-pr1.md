# D947 PR-1 独立自验报告（verifier）

> 自验员：**verifier**（独立于 code-a/b/c；只读交付物，可写 `/tmp`；唯一写例外 = 变异体，已按 L-14 还原）
> 基准：**commit A = `77e0d6aa`**（PR-1），其父 = `f25e61eb`（原 HEAD）；自验期 HEAD = `db54b926`（钩子自动追加的 `chore: bypass COMMITTED 登记`，非代码改动）
> 工作树：`.synova-wt-d947-middleware` ｜ 派单件：`docs/synova/dispatch/D947-win-middleware-default-posture-20260924.md` ｜ 裁定集：`D947-RULINGS.md`
> 自验时点：2026-09-24 20:14–20:40 ｜ 本报告**不判「通过」**

---

## 〇、自验结论（形态要求：只给三种之一）

**「可提请独立审计」**——PR-1 的 6 条 PR-1 轮次判据（P0 · P1 · P2-PR1 部分 · P5 · P8 变异体 · N1）在本轮全部自验达成，且**每条都有「改坏即红」的判别性证据**；变更面恰 8 文件；全量套件 16 个失败文件**无一引用本次改动面**（机械证明 + 隔离实验 + 长超时对照）。

**附 4 项登记（不构成退回，但须随件上报 CTO/K3）**：

| # | 登记项 | 性质 | 归属 |
|---|---|---|---|
| R-1 | **白名单路径上的漏斗空条件仍可达**：白名单 + 合法 JWT → `req.auth` 已注入，但该分支**不经过 `runWithContext`** ⇒ `getCurrentFilterClause()` 走 `services/request-context.ts:41` 兜底返回 `{conditions:[]}`；`/api/knowledge/ask` 正是白名单内的知识检索端点 | 安全相关残留（fail-open 面）；**非 PR-1 冻结判据**，且兜底位在 PR-2 写集 | **PR-2（code-c）** 建议优先收敛 |
| R-2 | `diagnosis-report-persistence.test.ts:348` 保留 1 处 `expect(...).not.toBe(401)` | 该行属「四前缀可达性」循环（语义正确：只断言"非 401"），与 L-18 要求加强的 `/api/solutions` 用例（已精确 `200 + ok:true + 数组`）不是同一断言 | PR-1，**判定：不构成降级**，登记供 K3 复核 |
| R-3 | 「16 个失败文件**非 D947 引起**」中，4 个 hook 超时类已用**长超时对照实验**证明为环境（bootstrap > 10s）；其余 6 类给出错误原文但**未做 `f25e61eb` 前置版本对照跑** | 残余不确定性（诚实登记）：对照跑需第二工作树或临时回退 PR-1 文件，均超出我的写例外 | 如需绝对归因，请队长/CTO 另行裁定 |
| R-4 | 命令口径纠错登记：本机 `grep -c $'\r' <file>` **不是可靠的行尾测量**（实测对 LF 文件 `src/middleware/rbac.ts` 报 299/299 全命中，与 node 读字节结果矛盾） | 口径纪律（数字必可核）：本报告行尾结论一律以 node 读字节为准 | 全员适用 |

---

## 一、基准冻结（自验起点）

命令与原始输出：

```
$ git -C .synova-wt-d947-middleware rev-parse --abbrev-ref HEAD
feat/d947-middleware-default-posture

$ git log --oneline -4
db54b926 chore: bypass COMMITTED 登记 (auto hook, D521)
77e0d6aa fix(d947): 服务端停止信任客户端自报身份（PR-1 middleware 默认安全姿态）
f25e61eb Merge pull request #735 from tangbaobao520/docs/d937-five-cards

$ git diff --stat 77e0d6aa^ 77e0d6aa
 src/middleware/auth.ts                            | 140 +++++++++--
 src/middleware/rbac.ts                            |  64 ++++-
 tests/middleware/auth.test.ts                     | 278 ++++++++++++++++++++--
 tests/middleware/permission-filter.test.ts        | 169 +++++++++++++
 tests/middleware/rbac-default-deny.test.ts        | 172 +++++++++++++
 tests/middleware/rbac.test.ts                     |  90 +++++--
 tests/routes/diagnosis-report-persistence.test.ts |  75 +++++-
 tests/routes/ga-auth.test.ts                      |  49 +++-
 8 files changed, 953 insertions(+), 84 deletions(-)
文件计数 = 8        ← L-18 迁移后口径（原 6 + 迁移 2），≤12 ✅
```

自验起点工作树（**无 tracked 改动**）：

```
$ git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
```

**写集越界检查**：PR-1 相对 main 的文件集合**恰 8 个**（上表逐条），`src/server.ts`、`src/routes/**`、`scripts/**` 均**未被 PR-1 触碰** ⇒ P3/P4/P6/P7 属 PR-2，本报告**不判**。

---

## 二、探针与工具（一律落 `/tmp`，永不入仓库；L-17）

| 文件 | 作用 | sha256（前 16） |
|---|---|---|
| `/tmp/d947v/vitest.config.ts` | 探针专用配置（root=/tmp + alias 指向 worktree 绝对路径） | `d1456ca58b701a42` |
| `/tmp/d947v/10-p0p1.probe.test.ts`（21 例） | P0/P1 + P8 边界 + `extractAuthFromRequest` 侧 legacy | `5c9710e40c9686c0` |
| `/tmp/d947v/20-n1-counterproof.probe.test.ts`（3 例） | N1 有效性反证 A/B/C | `cd98c6115a9b636c` |
| `/tmp/d947v/30-p2-funnel.probe.test.ts`（6 例） | P2 运行时漏斗 + 登记观察 | `6ef715251551ef8f` |
| `/tmp/d947v/40-p5-failclosed.probe.test.ts`（12 例） | P5 对抗输入 + 三态在线触发 | `c96c74f35019cdf7` |
| `/tmp/d947v/50-l20-whitelist.probe.test.ts`（15 例） | L-20 白名单语义（中间件层） | `65154b9559f37b10` |
| `/tmp/d947v/51-l20-http.probe.test.ts`（7 例） | L-20（HTTP 层：node:http + 真实 fetch） | `8be84978a1808ad0` |
| `/tmp/d947v/mut2.js` / `mut2.sh` | 变异体工具（find 唯一命中强制 + CRLF 感知 + sha256 台账） | `851f0e1edbdb767a` / `5c17265a17029424` |
| `/tmp/d947v/spec-M1..M6.json` | 6 个变异体规格 | `9e51e6f3…` `aa4369fe…` `841dbcf6…` `57aabfe2…` `f6269180…` `b785e23f…` |

**探针独立性**：
- 探针文件**不由 code-a/b/c 提供**，也**不复制其夹具**；全部经 `npx vitest run --config /tmp/d947v/vitest.config.ts` 由我自跑。
- 配置形态（L-17 实测可行）：`root` 指向 `/tmp` 探针目录 + alias `@d947src`/`@synova/logger` 指向 worktree 绝对路径；**探针内不 import 任何裸模块**（否则 `/tmp` 向上解析不到 `node_modules`），`describe/it/expect` 走 `globals`。
- 重型验证全程串行：每次 vitest 前后 `mkdir`/`rmdir` `/tmp/d947-heavy.lock`，同一时间 ≤1。

### 2.1 探针判别力**在修复前**已被实测证明（对照基线）

修复前（`f25e61eb` 代码）同一套探针：

```
$ bash /tmp/d947v/run-probes.sh baseline-rev2     # 输出 /tmp/d947v/out-baseline-rev2.txt
 Test Files  4 failed | 1 passed (5)
      Tests  25 failed | 13 passed (38)
```

代表性红证（修复前观测值）：
- `[P0-a] 观测值= {"role":"admin","userId":"x"}`（自报头 `x-synova-token: admin::x`）
- `[P0-c] 观测值= {"role":"ga","department":"marketing","userId":"alice"}`
- `[P0-g] 观测值 = {"role":"admin","userId":"x","orgId":"default"}`
- `[P1-a] 观测值= {"role":"admin","userId":"dev"}`（完全无凭据）
- `[P2-runtime-a] … "clause":{"conditions":[]}`

⇒ 探针**不是恒绿夹具**：同一份测试在修复前红、修复后绿。

### 2.2 自验期自查并修正的探针设计缺陷（透明登记）

`30-p2-funnel` 原设计用「同角色、异 `orgId` 两个用户 → 条件必须可区分」作为判别性断言。自验期读实现发现：漏斗条件由 `allowedSensitivities(payload.role, ctx.auth.sensitivity)` 派生，**与 orgId 无关** ⇒ 该断言在**正确实现**下也会假红。已改为 **admin vs staff** 判别（`length 3 vs 1`），并保留"同角色异 org 条件相同"为**登记观察**（非判据）。

---

## 三、N1 有效性反证（证明前置**必要**，不只是存在）

命令：`npx vitest run --config /tmp/d947v/vitest.config.ts 20-n1`（随 `go-pr1` 轮次，`/tmp/d947v/out-go-pr1.txt`）

```
✓ 20-n1-counterproof.probe.test.ts (3 tests) 18ms

[N1-A] 无前置观测 = {"status":200,"nextCalled":true,"injectedAuth":{"sub":"dev-admin","role":"admin","orgId":"default",...},"rbacRole":"admin","rbacUserId":"dev-admin"}
[N1-B] 有前置观测 = {"status":401,"nextCalled":false,"injectedAuth":null,"rbacRole":"staff","rbacUserId":"unauthenticated"}
[N1-C] A={"status":200,...,"rbacRole":"admin"} / B={"status":401,...,"rbacRole":"staff"}
```

原始 stderr 佐证（同轮捕获）：

```
{"level":40,...,"service":"auth","code":"AUTH_DEV_MODE_GRANT","reason":"jwt_secret_not_configured","msg":"安全判据: 开发姿态放行（DEV_MODE=true 且无 JWT_SECRET）——非生产路径；生产须 DEV_MODE=false 并配置 JWT_SECRET"}
```

**判定**：前置缺失（`JWT_SECRET` 未设 + `DEV_MODE='true'`）时 `jwtAuthMiddleware` **自动注入 admin 并放行**（`/tmp/d947v/vitest.config.ts:59` 的 `DEV_MODE:'true'` 即此形态）⇒ 任何"自报头 → 角色 ≠ admin"的断言在该环境下**观测不到被测代码的真实行为**（A 组恒 admin）。**N1 前置是必要的**：B 组已实测 `401` + `rbacRole='staff'`（非 admin）。

---

## 四、PR-1 轮次判据逐条（命令 + 退出码 + 原始输出）

主轮命令：`bash /tmp/d947v/run-probes.sh go-pr1`（`/tmp/d947v/out-go-pr1.txt`）

```
EXIT=0
 ✓ 00-smoke.probe.test.ts (1 test) 30ms
 ✓ 10-p0p1.probe.test.ts (21 tests) 35ms
 ✓ 20-n1-counterproof.probe.test.ts (3 tests) 18ms
 ✓ 30-p2-funnel.probe.test.ts (6 tests) 39ms
 ✓ 40-p5-failclosed.probe.test.ts (12 tests) 36ms
 ✓ 50-l20-whitelist.probe.test.ts (15 tests) 42ms
 ✓ 51-l20-http.probe.test.ts (7 tests) 245ms
 Test Files  7 passed (7)
      Tests  65 passed (65)
```

### P0 客户端自报身份完全失效

| 用例 | 命令口径 | 修复前 | 修复后（实测观测值） |
|---|---|---|---|
| P0-a 自报头 `admin::x` | `extractRbacContext` + 真实请求对象 | `{"role":"admin","userId":"x"}` ❌ | `{"role":"staff","userId":"unauthenticated","authenticated":false}` ✅ |
| P0-b `?token=admin::x` | 同上 | `{"role":"admin","userId":"x"}` ❌ | 同上 ✅ |
| P0-c `ga:marketing:alice` | 同上 | `{"role":"ga","department":"marketing"}` ❌ | 角色 ≠ `ga`、department ≠ `marketing` ✅ |
| P0-d 正常路径 | `req.auth`（验签注入） | `manager` ✅ | `{"role":"manager","userId":"alice"}` ✅（防过度纠正） |
| P0-e 中间件穿入口 | `rbacMiddleware(req)` | `req.rbac={"role":"admin"}` ❌ | `req.rbac.role ≠ admin`、`authenticated=false` ✅ |
| P0-f auth 侧 | 仅自报头、无 Bearer | 401（**基线即绿，非判别项**，见下） | 401 ✅ |
| **P0-g auth legacy 分支** | `extractAuthFromRequest({x-synova-token})` | `{"role":"admin","userId":"x","orgId":"default"}` ❌ | `null` ✅ |
| **P0-h 正常路径** | `extractAuthFromRequest({auth})` | `{"role":"manager","userId":"alice"}` ✅ | 同上 ✅ |

**诚实标注（判别性枚举）**：`P0-f`/`P1-d` 在修复前**即绿**（它们走 `jwtAuthMiddleware` 的 Bearer 分支，不覆盖 `extractAuthFromRequest` 的 legacy 分支）⇒ 它们是**回归护栏、非判别项**；legacy 自报分支的判别性由 **P0-g** 承担（修复前红 → 修复后绿，见上表与第七节 M3）。

### P1 无凭据 ≠ admin

| 用例 | 修复前 | 修复后 |
|---|---|---|
| P1-a 完全无凭据 `extractRbacContext({})` | `{"role":"admin","userId":"dev"}` ❌ | `{"role":"staff","userId":"unauthenticated","authenticated":false}` ✅ |
| P1-b 空 header/query | `{"role":"admin"}` ❌ | 同上 ✅ |
| P1-c `rbacMiddleware` 无凭据 | `req.rbac.role='admin'` ❌ | 非 admin + `authenticated=false` ✅ |
| P1-d auth 中间件无 Bearer | 401 ✅（护栏） | 401 ✅ |

### P2 唯一漏斗（**PR-1 部分**；全局 =0 见 L-12，跨 PR-1+PR-2）

静态判据（逐条 + 标注注释/实现，`bash /tmp/d947v/static-evidence.sh`，`EXIT=0`）：

```
$ grep -rn "conditions: \[\]" src/ --include='*.ts'
src/routes/documents.ts:85:    const { results } = store.search('', { conditions: [] }, 100);   ← 实现（PR-2）
src/routes/documents.ts:112:    const { results } = store.search(id, { conditions: [] }, 50);    ← 实现（PR-2）
src/services/request-context.ts:41:  if (!ctx?.user || !ctx?.authProvider) return { conditions: [] }; ← 实现（PR-2）
count = 3      ← 修复前 = 4；`src/middleware/auth.ts:355` 的恒空实现**已不在其列** ✅
```

**运行时主判据**（禁 grep 型静态判据当验收；走真实调用链 `signJwtToken → jwtAuthMiddleware → AsyncLocalStorage → getCurrentFilterClause`）：

```
[P2-runtime-a] … "providerPresent":true,"clause":{"conditions":[{"field":"access.sensitivity","operator":"IN","value":["normal"]}]}
[P2-runtime-c] admin 条件 = {…"value":["normal","sensitive","restricted"]}
[P2-runtime-c] staff 条件 = {…"value":["normal"]}
[P2-runtime-d] staff values = [["normal"]]   admin values = [["normal","sensitive","restricted"]]
```

⇒ 条件**非空**、形状可核、**按角色派生**（admin 全量 / staff 仅 normal，未放宽）。**P2 全局 =0 不在 PR-1 判据内**（L-12：须跨两批），本轮记「PR-1 部分达成」。

### P5 fail-closed + 三态可分

对抗输入（`rbacMiddleware` 穿入口；全部 fail-closed）：

```
[P5:未知角色 root::hacker] threw=null rbac={"role":"staff","userId":"unauthenticated","authenticated":false}
[P5:未知角色 superuser:dept:u] threw=null rbac={"role":"staff",…,"authenticated":false}
[P5:畸形 token（仅冒号）] threw=null rbac={"role":"staff",…,"authenticated":false}
[P5:非法 header 类型（数组）] threw=null rbac={"role":"staff",…,"authenticated":false}
[P5:headers 为 null] threw=null rbac={"role":"staff",…,"authenticated":false}
[P5:headers 缺失] threw=null rbac={"role":"staff",…,"authenticated":false}
[P5-fallback] 观测 = {"role":"staff","userId":"unauthenticated","authenticated":false}
```

**三态在线触发 + 原始 stderr 捕获**（区分「日志行」与「用例名回显」）：

| 态 | 触发 | 原始日志（逐条） | 计数 |
|---|---|---|---|
| `被拒绝` | 无 Bearer → 401 | `{"level":40,...,"service":"auth","code":"AUTH_REJECTED","reason":"missing_or_invalid_authorization_header","path":"/api/workspaces/mine","msg":"安全判据: 被拒绝 — 缺 Authorization/Bearer 头（HTTP 401，fail-closed）"}` | 总 36 / **日志行 35** |
| `不可用（系统异常）` | `JWT_SECRET` 不可用 + `DEV_MODE=false` + 有 Bearer → 401（**不放行**） | `{"level":50,...,"code":"AUTH_UNAVAILABLE","reason":"JWT_SECRET not configured",...,"msg":"安全判据: 不可用（系统异常）— JWT_SECRET 不可用，fail-closed 拒绝（HTTP 401）"}` | 总 2 / **日志行 1** |
| `出错` | 中间件内部异常（`headers` getter 抛） → **500 + `degraded:true`** | `{"level":50,...,"code":"AUTH_ERROR","err":{},"msg":"安全判据: 出错 — jwtAuthMiddleware 异常（HTTP 500，degraded:true）"}` | 总 2 / **日志行 1** |

⇒ 三态在**同一份原始 stderr** 中可区分；「不可用」与「出错」均 **fail-closed**（401/500 + degraded），无静默放行。

### P8 三路径 + 变异体

三路径（以 PR-1 四处修复的并集计）：**正常**（`req.auth` 验签身份仍生效：P0-d/P0-h/w1/w9）· **拒绝/边界**（无凭据、空串、仅冒号、大小写、双通道、数组型 header、`headers:null`）· **降级**（`不可用（系统异常）`/`出错` 两态的留痕与 fail-closed；安全判据不适用"业务降级"，故以 500+degraded 与 401 覆盖）。变异体红证见第七节（M1–M6）。

### 变更面与「中间件侧自报通道清零」（L-16 口径）

```
$ grep -rn "x-synova-token" src/middleware/ --include='*.ts'
src/middleware/auth.ts:480: * 已删除 `x-synova-token` 自报分支——该 header 不经验签即可自封 `role`     ← 注释
src/middleware/auth.ts:501:  // D947: 原 x-synova-token 自报分支已删除——无验签的 `role:orgId:userId` ← 注释
src/middleware/auth.ts:503:  if (req.headers?.['x-synova-token'] !== undefined) {                    ← 实现（显式拒绝分支）
src/middleware/auth.ts:506:      '安全判据: 被拒绝 — 忽略未验签的 x-synova-token 自报凭据（fail-closed）',   ← 实现（留痕）
src/middleware/rbac.ts:115: * 本函数**不再读取** `x-synova-token` / `query.token` 等自报凭据——…        ← 注释
count = 5      ← 预期值（非 0），与 L-16 裁定一致
```

**语义判据（H3 改判后的主判据）**：`auth.ts:503-508` 是**显式拒绝 + 留痕**分支（不据其放行），`rbac.ts` 侧注释声明不再读取该类凭据；**运行时穿入探针** P0-e/P0-f/P0-g/w5 全绿且 M1/M3 改坏即红 ⇒ **无一处把该 header 的值当身份来源** ✅。拒绝分支**必须保留**（L-16 硬要求），本轮未见"为凑 grep=0 而删拒绝逻辑"。

---

## 五、L-20 白名单语义（「不要求认证」≠「忽略认证」）

### 5.1 ④ 白名单列表未被改动（git 级取证，自取）

```
$ git diff 77e0d6aa^ 77e0d6aa -- src/middleware/auth.ts | grep -n "isWhitelisted"
58:     if (isWhitelisted(req.path)) {        ← 唯一命中，且为 diff 中的**上下文行**（前缀为空格，非 +/−）
count = 1

$ git show 77e0d6aa^:src/middleware/auth.ts | sed -n '/^function isWhitelisted/,/^}/p' > before.txt
$ git show 77e0d6aa:src/middleware/auth.ts  | sed -n '/^function isWhitelisted/,/^}/p' > after.txt
before 行数 = 31 / after 行数 = 31
WHITELIST_BODY_IDENTICAL=YES (diff 退出码 0，无差异)
白名单条目数：before = 27 / after = 27        ← 不加不减 ✅
```

### 5.2 ①②③⑤ 行为验证（中间件层 15 例 + HTTP 层 7 例全绿）

中间件层（`50-l20-whitelist.probe.test.ts`）：

```
[L20-w1]  GET /api/solutions + 真实 JWT → nextCalled=true req.auth={"sub":"u1","role":"ga",…}
          extractAuthFromRequest = {"role":"ga","userId":"u1","orgId":"org-d593"}      ← 路由内 requireAuth 可采纳 ✅
[L20-w1b] 白名单 + 真实 JWT → req.rbac = {"role":"manager","userId":"u2","authenticated":true} ✅
[L20-w2]  伪造 JWT（异密钥签名）→ nextCalled=true status=200 req.auth=undefined     ← 不注入且仍放行 ✅
[L20-w3]  篡改 payload（签名不匹配）→ nextCalled=true req.auth=undefined ✅
[L20-w4]  无凭据 → nextCalled=true req.auth=undefined ✅
[L20-w5]  仅自报 x-synova-token:admin::evil → nextCalled=true req.auth=undefined；extractAuthFromRequest = null ✅
[L20-w6]  Bearer 空/`a.b.c`/`not-a-jwt` → 三者均 req.auth=undefined + nextCalled=true + status=200 ✅
[L20-w7]  可达性矩阵（无凭据）: /health · /api/auth/login · /api/status/budget · /api/knowledge/ask · /api/solutions → nextCalled=true status=200 ✅
[L20-w8]  回归：非白名单无凭据 → nextCalled=false status=401 ✅
[L20-w9]  回归：非白名单 + 真实 JWT → 注入 + 放行 ✅
```

HTTP 层（`51-l20-http.probe.test.ts`，node:http 真服务 + 真实 `fetch`，路由处理器与 `src/routes/solutions.ts:36/93` 的 `requireAuth` 同型）：

```
[L20-h1] status=200 body={"ok":true,"solutions":[],"role":"ga","userId":"u1"}     ← ① 端到端可达 ✅
[L20-h2] status=401 body={"ok":false,"code":"UNAUTHORIZED"}                        ← 无凭据 → 路由内拒绝 ✅
[L20-h3] status=401 body={"ok":false,"code":"UNAUTHORIZED"}                        ← 伪造 JWT → 不注入 → 拒绝 ✅
[L20-h4] status=401                                                                ← 仅自报头 → 拒绝 ✅
[L20-h5] GET /health → 200 · POST /api/auth/login → 200 · GET /api/status/budget → 200 · GET /api/knowledge/ask → 200 ✅
[L20-h6] 非白名单无凭据 → 401 ✅
```

**留痕**：白名单上「有 Bearer 但无效」→ 原始 stderr `grep -c '白名单路径携带 Bearer 但未被采纳' = 6`（例：`{"level":40,...,"service":"auth","code":"AUTH_REJECTED","whitelist":true,"reason":"Invalid signature","path":"/api/solutions","msg":"白名单路径携带 Bearer 但未被采纳 — 照旧放行（白名单=不要求认证，不拦截）"}`），且**放行结果不变** ✅。

### 5.3 补充：HTTP 层交叉印证（跑 PR-1 自己迁移的用例 6）

`tests/routes/diagnosis-report-persistence.test.ts` 的「用例 6」以**真实 JWT Bearer** 打 `/api/solutions` 并断言精确 `200 + ok:true + solutions 为数组`，同时用非白名单 `/api/d593-probe` 对照 `401`（见 §六 与 §九 运行结果）。这是"白名单没有因此被放宽"的**真实服务器**侧证据。

---

## 六、L-18 复核：2 个迁移文件（防「把破坏藏进绿」）

命令：`bash /tmp/d947v/static-evidence.sh`（D 段），`EXIT=0`

| 检查项 | `tests/routes/ga-auth.test.ts` | `tests/routes/diagnosis-report-persistence.test.ts` |
|---|---|---|
| N1 硬前置 `beforeAll` | ✅ 文件级 `beforeAll`（`:18-23`：自设 `JWT_SECRET`≥16 + `DEV_MODE='false'` + 就地 `expect` 自证） | ✅ 文件级 `beforeAll`（`:37-42`，同上）；用例 6 内**再就地重设并自证**（`:358-362`） |
| legacy 断言强度 | ✅ **反转为精确拒绝**：`ok=false` ∧ `status=401` ∧ `code='UNAUTHORIZED'`（`:93-100`），非弱断言 | ✅ 用例 6 由弱断言**升级**：`status=200` ∧ `ok=true` ∧ `Array.isArray(solutions)` ∧ 对照探针 `401`（`:372-382`） |
| 弱断言扫描 | 0 处 `not.toBe(401/200)` | **1 处**：`:348 not.toBe(401)`，属「四前缀可达性」循环（语义正确）→ 见 R-2 登记 |
| 禁用措辞（`已知限制`/`已完成`） | 0 处 ✅ | 0 处 ✅ |
| 功能回退登记 | ✅ 文件末 `§功能回退登记`（`:104-120`），并写明受影响客户端与「另立卡」去向 | ✅ 文件末 `§功能回退登记`（`:519-534`） |

⇒ 断言为**按新语义改写/加强**，未见静默删弱；两文件均含 N1；均含功能回退登记；无禁用措辞。**L-18 复核：达成（附 R-2 登记）**。

---

## 七、变异体 M1–M6（改坏即红 + 还原 + 无残留）

工具纪律（`/tmp/d947v/mut2.sh`）：`find` 必须**恰好命中 1 处**否则 `ABORT`（不写文件）；apply 前逐字节备份 + sha256 台账；跑完用 **`git checkout -- <file>`**（L-14 裁定 A）还原；再用 sha256 **交叉核对**是否回到变异前；最后比对 `git status --porcelain` 前后。

**工具自检**（负向）：`find` 不存在 → `ABORT: find 无唯一命中（要求恰好 1）… 各变体命中数=as-written:0,lf:0,crlf:0`，`APPLY_EXIT=2`，**不写任何文件** ✅

**实测坑（登记）**：本仓**混用行尾**——`src/middleware/auth.ts` 为 **CRLF**（511/511 行，blob 亦 CRLF），`src/middleware/rbac.ts` 为 **LF**（node 读字节：CRLF=0 / LF=299，blob 同）。首轮 harness 用 LF 多行 `find` 匹配 CRLF 文件 ⇒ M3–M6 全部 `ABORT`（**未产生任何变异，零残留**）；harness 已改为「原文 / LF / CRLF」三变体择一，替换文本行尾随文件既有约定。

| 变异体 | 改坏点（`git diff -U1` 摘） | 期望变红 | 实测红证 | 还原 |
|---|---|---|---|---|
| **M1** 恢复自报角色分支 | `+ const _sr = String((req.headers?.['x-synova-token'] …)` 于 `rbac.ts` 兜底前插入 | P0 | `Tests 8 failed | 13 passed (21)`；FAIL：P0-a/-b/-c/-e + P8 边界×4（`AssertionError: expected 'admin' not to be 'admin'`、`expected 'ga' not to be 'ga'`、`expected true to be false`） | `CHECKOUT_EXIT=0` / `VERIFY-OK sha256 c94e90a3480209fd` / `STATUS_IDENTICAL=YES` |
| **M2** 兜底回 admin | `- return { role: ANONYMOUS_ROLE, userId: ANONYMOUS_USER, authenticated: false };`<br>`+ return { role: 'admin', userId: 'dev', authenticated: true };` | P1 + P5 | `Tests 21 failed | 12 passed (33)`；FAIL：P1-a/-b/-c + P0-a/-b/-e + P8×8 + P5 对抗输入×6 + P5-fallback | `VERIFY-OK` / `STATUS_IDENTICAL=YES` |
| **M3** auth legacy 分支改回信任自报头 | `- log.warn(… 被拒绝 — 忽略未验签的 x-synova-token …)`<br>`+ const _t = String(req.headers['x-synova-token']); if (_t.includes(':')) { … return { role: _p[0] …` | P0-g + w5 | `Tests 2 failed | 34 passed (36)`；FAIL：`P0-g`（`expected 'admin' not to be 'admin'`）、`w5`（`expected { role: 'admin', userId: 'evil', …(1) } to be null`） | `VERIFY-OK` / `STATUS_IDENTICAL=YES` |
| **M4** `getPermissionFilter` 改回恒空 | `- getPermissionFilter: async (ctx) => ({ conditions: [ { field: 'access.sensitivity', … } ] })`<br>`+ getPermissionFilter: async () => ({ conditions: [] })` | P2 运行时 | `Tests 4 failed | 2 passed (6)`；FAIL：P2-runtime-a/-b/-c/-d（`expected 0 to be greater than 0`、`expected '{"conditions":[]}' not to be '{"conditions":[]}'`、`expected '[]' to be '[["normal"]]'`） | `VERIFY-OK` / `STATUS_IDENTICAL=YES` |
| **M5** 白名单吞掉合法 Bearer | `- if (whitelistResult.payload) {`<br>`+ if (false) {` | L-20 ①+可达性 | `Tests 3 failed | 19 passed (22)`；FAIL：`w1`（`expected undefined to be 'u1'`）、`w1b`（`expected 'staff' to be 'manager'`）、`h1`（`expected 401 to be 200` — HTTP 层端到端红） | `VERIFY-OK` / `STATUS_IDENTICAL=YES` |
| **M6** 白名单对无效 Bearer 也注入伪造身份 | `- if (whitelistResult.payload) { …auth = whitelistResult.payload;`<br>`+ if (true) { …auth = whitelistResult.payload ?? ({ sub: 'forged-admin', role: 'admin', … } as JwtPayload);` | L-20 ②③ | `Tests 4 failed | 18 passed (22)`；FAIL：`w2`/`w3`/`w6`（`expected { sub: 'forged-admin', …(5) } to be null`）、`h3`（`expected 200 to be 401`） | `VERIFY-OK` / `STATUS_IDENTICAL=YES` |

**无残留（硬要求）**：6 个变异体全部 `CHECKOUT_EXIT=0` + `VERIFY-OK … == 变异前（备份原文）` + `STATUS_IDENTICAL=YES`；全部结束后工作树：

```
$ git status --porcelain
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
$ git diff --stat
(空 = 无 tracked 改动)
```

⇒ **红证零残留**。全程未用 `git stash` / `--no-verify` / force push。

---

## 八、H2/L-15 登记：注释字面量改写（防「消音凑绿」之嫌）

**必须登记的事实**：`src/middleware/auth.ts` 的**注释**曾被改写以避开 P2 判据字面量（L-15 裁定 B）。

改前（`77e0d6aa^`，旧实现 + 旧注释）：

```
$ git show 77e0d6aa^:src/middleware/auth.ts | grep -n "conditions: \[\]"
355:          getPermissionFilter: async () => ({ conditions: [] }),     ← 恒空实现（真代码位）
```

改后（`77e0d6aa`）：

```
$ grep -rn "conditions: \[\]" src/ --include='*.ts'      → 不再命中 auth.ts
$ sed -n '441,450p' src/middleware/auth.ts
        authProvider: {
          /**
           * D947: 权限过滤唯一漏斗——返回的条件由**认证身份**派生，绝不返回空条件集。
           * …
           * 原实现恒返空条件集 ⇒ 所有知识检索绕过权限判定。     ← 等价表述（"空条件集"），不含判据字面量
           */
          getPermissionFilter: async (ctx) => ({
```

diff 侧证据：

```
$ git diff 77e0d6aa^ 77e0d6aa -- src/middleware/auth.ts | grep -nE "^[-+].*(恒返|conditions:|原实现)"
149:-          getPermissionFilter: async () => ({ conditions: [] }),      ← 删除恒空实现（这是本次修复的一部分）
156:+           * 原实现恒返空条件集 ⇒ 所有知识检索绕过权限判定。          ← 注释改写后的等价表述
159:+            conditions: [                                            ← 新的非空实现
```

**判定**：改写的**动机包含**「避开判据字面量」，但其**语义未变**（仍记载旧行为），且**真正的修复**（`:450-458` 返回真实条件）有独立运行时证据（§四 P2 运行时 + M4 变异体红）⇒ **不以注释改写替代修复**。登记供 K3 核对，请勿仅以 `grep = 0/4` 判断 P2。

---

## 九、PR-1 交付夹具定向运行（交付物自身是否绿）

```
$ npx vitest run tests/middleware tests/routes/ga-auth.test.ts tests/routes/diagnosis-report-persistence.test.ts
EXIT=0
 ✓ tests/routes/ga-auth.test.ts (6 tests) 240ms
 ✓ tests/middleware/rbac-default-deny.test.ts (9 tests) 16ms
 ✓ tests/middleware/rbac.test.ts (36 tests) 38ms
 ✓ tests/middleware/auth.test.ts (34 tests) 42ms
 ✓ tests/middleware/permission-filter.test.ts (6 tests) 151ms
 ✓ tests/middleware/rbac-ga-boundary.test.ts (14 tests) 19ms
 ✓ tests/middleware/rate-limit.test.ts (8 tests) 22ms
 ✓ tests/middleware/auth.integration.test.ts (10 tests) 2461ms
 ✓ tests/routes/diagnosis-report-persistence.test.ts (12 tests) 3588ms
 Test Files  9 passed (9)
      Tests  135 passed (135)
```

⇒ PR-1 的 4 个 middleware 夹具（含 2 新建）+ 2 个迁移文件 + 3 个存量同域夹具**全绿**；其中 `diagnosis-report-persistence`（12 例）作为 HTTP 层交叉印证。

---

## 十、全量套件归因（16 失败文件是否与 D947 相关）

```
$ npx vitest run            # 仓内 vitest.config.ts
 Test Files  16 failed | 593 passed | 3 skipped (612)
      Tests  58 failed | 4355 passed | 66 skipped (4479)
   Duration  195.14s
```

（对比队长转述的 code-a 观测 `17 failed | 592 passed | 3 skipped (612)`：**用数不同**——本轮实测 16/593/3，属不同时点的独立观测，本报告以我的原始输出为准。）

### 10.1 机械证明：失败信息**零引用**改动面

```
$ awk '/Failed Tests/{f=1} /^ Test Files/{f=0} f' out-fullsuite.plain.txt > failed-tests-section2.txt
区行数 = 696
grep -c 'middleware/auth'        = 0
grep -c 'middleware/rbac'        = 0
grep -c 'extractRbacContext'     = 0
grep -c 'extractAuthFromRequest' = 0
grep -c 'jwtAuthMiddleware'      = 0
grep -c 'x-synova-token'         = 0
grep -c 'rbacMiddleware'         = 0
grep -c 'permission-filter'      = 0
grep -c 'rbac-default-deny'      = 0
```

（全文 `middleware/rbac` 的 43 处命中已逐条核验：**39 条 `{"level":40…}` + 1 条 `{"level":30…}` 日志行 + 3 条 `✓ tests/…` 通过行**，无一条位于失败信息中；`middleware/auth` 的 2 处命中亦全为 `✓ tests/middleware/auth*.test.ts` 通过行。）

### 10.2 逐失败文件：是否引用改动面

`D947surface_refs`（auth/rbac/jwtAuthMiddleware/extractAuth*/x-synova-token/rbacMiddleware）与 `src_server_refs`：

| 失败文件 | surface_refs | src/server | 首因（错误原文） |
|---|---|---|---|
| tests/acceptance/zero-code-industry.test.ts | 0 | 0 | `AssertionError: expected undefined to be defined`（`:62` ontology `'厨房设备'` 节点）／`expected 0 to be greater than or equal to 1`（`:69`） |
| tests/architecture/check-architecture-gate.test.ts | 0 | 0 | `expected '…架构边界检查 (铁律 39)…' to contain 'routes/new-violation.ts:1'` 等 8 条（门禁脚本输出断言） |
| tests/electron/mac-install-verify.test.ts | 0 | 0 | `AssertionError: expected +0 not to be +0` |
| tests/electron/notification-center.test.ts | 0 | 0 | 用例 6b/6d/7b/8/9a/9c/10b/11a/11c 断言失败 |
| tests/electron/right-panel-report-sentinel.test.ts | 0 | 0 | `Cannot find package 'zustand' imported from …/electron-renderer/src/stores/app-store.ts` |
| tests/electron/use-streaming-conversation.test.ts | 0 | 0 | `Cannot find package 'zustand' imported from …/electron-renderer/src/stores/conversation-store.ts` |
| tests/golden-scenarios/gss-common.test.ts | 0 | 0 | `AssertionError: expected null to be +0/+2`（多条）+ `Error: spawn EINVAL` |
| tests/l3/graphbridge-wiring.test.ts | 0 | 0 | `AssertionError: expected +0 to be 1` |
| tests/llm-config-frontend.test.ts | 0 | 0 | `Cannot find package 'zustand' imported from …/conversation-store.ts` |
| tests/loops/ga-calibration-evolution.test.ts | 0 | 0 | `Error: EPERM, Permission denied: \\?\C:\Users\…\Temp\d556-agent-mem-*.db` |
| tests/mcp/server-smoke.test.ts | 0 | 0 | `请求 initialize/tools/list (id=…) 10000ms 未响应。stderr 尾部: …CJS loader…` |
| tests/mcp/tool-definitions.test.ts | **5**（含 `import { jwtAuthMiddleware }`） | 0 | **`Error: Cannot find package '@modelcontextprotocol/sdk/types.js' imported from …/src/mcp/tool-definitions.ts`**（加载期模块解析失败，`tests 0ms`，**0 个用例被执行**） |
| tests/metrics.test.ts | 0 | 1 | `Error: Hook timed out in 10000ms.`（`beforeAll:13` 内 `createServer()`） |
| tests/routes/llm-config.test.ts | 0 | 1 | `Error: Hook timed out in 10000ms.`（`beforeAll` 内 `createServer()`） |
| tests/sessions-api.test.ts | 0 | 1 | `Error: Hook timed out in 10000ms.` |
| tests/smoke.test.ts | 0 | 1 | `Error: Hook timed out in 10000ms.` |

### 10.3 隔离实验（区分「并行/环境」与「代码行为」）

逐个隔离运行 9 个代表文件（全部失败 + 首因与全量一致）：

```
EXIT=1 tests/metrics.test.ts        Tests 5 skipped  / Error: Hook timed out in 10000ms.
EXIT=1 tests/routes/llm-config.test.ts  Tests 21 skipped / Hook timed out
EXIT=1 tests/sessions-api.test.ts   Tests 6 skipped  / Hook timed out
EXIT=1 tests/smoke.test.ts          Tests 8 skipped  / Hook timed out
EXIT=1 tests/acceptance/zero-code-industry.test.ts  2 failed | 3 passed
EXIT=1 tests/l3/graphbridge-wiring.test.ts          1 failed | 2 passed
EXIT=1 tests/loops/ga-calibration-evolution.test.ts 2 failed | 7 passed（EPERM 临时 db）
EXIT=1 tests/architecture/check-architecture-gate.test.ts 8 failed | 4 passed（90.18s）
EXIT=1 tests/mcp/tool-definitions.test.ts  Cannot find package '@modelcontextprotocol/sdk/types.js'（0 用例执行）
```

⇒ **非并行竞争所致**（隔离下同样失败）。

### 10.4 长超时对照（决定性归因 4 个 hook 超时文件）

```
$ npx vitest run tests/metrics.test.ts            --hookTimeout=120000 --testTimeout=60000
EXIT=0    Test Files 1 passed (1)    Tests 5 passed (5)     Duration 15.11s
$ npx vitest run tests/routes/llm-config.test.ts  --hookTimeout=120000 --testTimeout=60000
EXIT=0    Test Files 1 passed (1)    Tests 21 passed (21)   Duration 15.79s
$ npx vitest run tests/sessions-api.test.ts       --hookTimeout=120000 --testTimeout=60000
EXIT=0    Test Files 1 passed (1)    Tests 6 passed (6)     Duration 15.46s
$ npx vitest run tests/smoke.test.ts              --hookTimeout=120000 --testTimeout=60000
EXIT=0    Test Files 1 passed (1)    Tests 8 passed (8)     Duration 15.46s
```

⇒ 该 4 例的失败成因 = **本机 `createServer()` bootstrap 用时（≈15s）超过 vitest 默认 `hookTimeout` 10s**，与身份/白名单行为无关（用例在钩子放行后**全部通过**）。

### 10.5 归因结论

- **无一失败信息引用 D947 改动面**（§10.1，696 行失败信息区 9 个模式全 0）。
- **4 例 hook 超时**：决定性证明为环境（§10.4）。
- **3 例 `zustand` / 1 例 MCP SDK 缺失 / 1 例 EPERM 临时 db / 1 例 `spawn EINVAL` / 1 例 MCP JSON-RPC 子进程加载失败**：依赖缺失与 Windows 环境，错误原文已列（§10.2）。
- **1 例 `tests/mcp/tool-definitions.test.ts` 虽 import `jwtAuthMiddleware`**，但其失败是**加载期模块解析失败、0 用例执行**，不可能由中间件行为引起。
- **6 例域外断言失败**（acceptance 本体节点 / architecture 门禁脚本 / electron 通知与右栏 / golden-scenarios / l3 graphbridge / loops evolution）：失败域与身份/鉴权无结构关联，且文件不引用改动面（§10.2）。
- **残余不确定性**：上述 6 例未做 `f25e61eb` 前置版本对照跑（见 R-3 登记）——不采信"预先存在"的转述，也不宣称"已证明预先存在"。

### 10.6 全量套件污染与还原（显式路径，非 glob/非 `.`）

全量运行**污染 6 个 tracked 文件**（与队长转述的 5 个面一致，另有第二个 `.pyc`）：

```
$ git status --porcelain（运行后）
 M docs/synova/product-lines/evidence/D817-capture-20260918.json
 M docs/synova/product-lines/evidence/D819-capture-20260919.json
 M extensions/industries/saas-tech/thresholds.json
 M extensions/industries/test-write/thresholds.json
 M synova_worker/connectors/__pycache__/__init__.cpython-313.pyc
 M synova_worker/connectors/__pycache__/feishu.cpython-313.pyc
count = 6
```

还原方式 = **逐条显式路径** `git checkout -- <file>`（脚本内 `RESTORE-PATH: <path>` 打印 6 行，`git checkout 退出码 = 0`），并以 sha256 逐文件对照：

| 文件 | 运行前 sha256 | 还原后 sha256 | 一致 |
|---|---|---|---|
| `D817-capture-20260918.json` | `a605dad2471f1b6b…` | `a605dad2471f1b6b…` | ✅ |
| `D819-capture-20260919.json` | `95cdefd1c3209f39…` | `95cdefd1c3209f39…` | ✅ |
| `saas-tech/thresholds.json` | `226580f686c30c4d…` | `226580f686c30c4d…` | ✅ |
| `test-write/thresholds.json` | `43ec789b79a3f5ac…` | `43ec789b79a3f5ac…` | ✅ |
| `__pycache__/__init__.cpython-313.pyc` | `6a5ba32ff32632a3…` | `6a5ba32ff32632a3…` | ✅ |
| `__pycache__/feishu.cpython-313.pyc` | `43de78cc6a0a8334…` | `43de78cc6a0a8334…` | ✅ |

```

$ git status --porcelain（还原后）
?? .claude/task-briefs/2026-09-24-D947-middleware-default-posture.md
?? docs/synova/product-lines/evidence/D947-20260924/
$ git diff --stat
(空)
```

⇒ 回到干净态，**未回退任何在途工作**（全程未 `git stash`、未改他人工作树）。

---

## 十一、未清项 / 登记项清单（诚实登记，不写"已完成"）

| # | 项 | 状态 | 去向 |
|---|---|---|---|
| 1 | **R-1 白名单路径漏斗空条件**（§〇） | 未清（本轮实测复现） | PR-2（`request-context.ts:41` 兜底 + 白名单分支是否注册 provider）——属 PR-2 写集 |
| 2 | **P2 全局 `conditions: []` = 0** | **未达**（当前 = 3，全在 PR-2 面） | PR-2（L-12：跨两批才可声称） |
| 3 | **P3 / P4 / P6 / P7** | **本轮不判**（PR-1 未触碰 `src/server.ts`、`src/routes/**`） | PR-2（task-6/7），届时另行自验（task-8） |
| 4 | **R-3 6 例失败文件未做前置版本对照跑** | 未清（残余不确定性） | 队长/CTO 决定是否要求对照实验 |
| 5 | **R-2 残留 1 处 `not.toBe(401)`** | 已判定不构成降级，登记 | K3 复核 |
| 6 | **功能回退（R5/REV-8 + L-18 第 2 条）** | 已在两文件内登记；**本卡不修** | CTO 执行「另立卡」（桌面身份迁正规登录） |
| 7 | 纪律口径冲突（6 人 vs ≤4） | 已由 R8 登记为按派单执行 | 队列（PR + K3） |
| 8 | 全量套件 16 失败文件（环境/域外） | 未清（非 D947 引起，见 §十） | 域外队列 / Mac 域 |

---

## 十二、自验方法与边界声明

1. **独立性**：本报告全部结论来自我自跑的探针与命令；**未采信** code-a/b/c 的完成声明与措辞，也未复用其夹具文件。
2. **数字口径**：所有数字取自命令原始输出；未用 `head` 截断关键证据（需要计数处均给出「共 N 处」）；行尾等易误测量项改用 node 读字节并以 blob 交叉核对（R-4）。
3. **未做之事**：未改产品代码（除变异体 + 立即还原）；未 `git add/commit/push`；未触碰 `scripts/audit/**`；未写审计标准；未使用 `git stash` / `--no-verify` / force push；未建第二工作树（故 R-3 对照实验未做）。
4. **判据归属**：P3/P4/P6/P7 属 PR-2；P2 全局属跨批；本轮只判 PR-1 轮次判据（P0/P1/P2-PR1/P5/P8/N1 + L-20 + L-18 + 变更面 + 全量归因）。
5. **结论形态**：本报告只给「自验结论」形态——**「可提请独立审计」**，并附 §〇 的 4 项登记与 §十一 的未清项。**通过与否归 CTO 收件闸 + K3 终审**；本报告不判「通过」，也不宣称"产品被验证"。
