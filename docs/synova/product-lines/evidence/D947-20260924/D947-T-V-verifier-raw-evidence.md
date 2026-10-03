# D947-T-V 独立自验 · 原始证据与对账结论（verifier）

> 角色：独立自验（非编码成员兼任）｜只读，本文件写在仓库外临时目录
> 会话执行面：**degraded**（见 §0）——所有 shell 通道全灭，全部取证走 read/grep/glob 静态工具
> 结论口径：只给「自验结论 / 可提请独立审计 / 退回」；**不写「审计通过」**

---

## §0 环境事实独立复现（含失败登记）

| # | 声称 | 我的实测 | 判定 |
|---|---|---|---|
| E1 | 默认沙箱 pwsh 起不来（空输出 + exit 3221225794） | 复现 4/4：`Write-Output HI`、`cmd /c "echo CMD_OK"`、带 workdir、不带 workdir → **全部 `(no output)` + `[exit code: 3221225794]`**（0xC0000142 = STATUS_DLL_INIT_FAILED，进程级 DLL 初始化失败） | **复现成功** |
| E2 | Git Bash 全路径 `'C:\Program Files\Git\bin\bash.exe' -lc` 可用 | **无法复现**。该命令同样 `(no output)` + `[exit code: 3221225794]`——因为 pwsh 本体无法启动，本 session **没有任何进程启动通道**（不是路径问题，是执行面全灭） | **未复现（degraded）** |
| E3 | SSH 不可用 + HTTPS openssl 只读可用 | **未复现**（无执行面，连 git 都跑不了） | **未复现（degraded）** |
| E4 | 本地 main 落后 origin/main 29 commit（1a1cccc8 → f25e61eb） | **refs 独立复现成功**（绕开 git，直读 ref 文件）：<br>`.git/HEAD` → `ref: refs/heads/main`<br>`.git/refs/heads/main` → `1a1cccc8f3d40b93e1d32cf881352ff25850c394`<br>`.git/refs/remotes/origin/main` → `f25e61eb105690359dbe13baf64695e5ff1748f0`<br>`.git/packed-refs` grep `f25e61eb\|1a1cccc8\|origin/main` → 0 命中（故 refs 取自 loose ref 文件，非 packed） | **哈希一致；「落后 29 commit」未验证**（需 `git rev-list --count`，无执行面） |

**本 session 审批提示已禁用，且我是被委派的子代理（权限在启动时固定）→ 不得设置 `sandbox_permissions` 提权。故执行面无法恢复，属不可自行解除的受限项，在此显式登记 degraded。**

---

## §1 派单件指纹三方对账 → **无法给出一致结论**

派单件：`D:\novis-backup-20260526\Novis\synova-agent\docs\synova\dispatch\D947-win-middleware-default-posture-20260924.md`

| 口径 | 启动指令值 | 队长实测值 | **我的独立复算值** |
|---|---|---|---|
| 字节 | 14505 | 14505 | **无法复算** |
| 行数 | 177 | 177 (LF) | **177（reader 口径，见下）** |
| sha256 前 16 | 1f74c0703d279de6 | 1f74c0703d279de6 | **无法复算** |

- 行数：用 read 工具读全文，末行 `(End of file - total 177 lines)` → **177**。此值来自读取器的行划分，**不等于 `wc -l`**：若文件无末尾换行符，`wc -l` 会报 176。**我无法判定末尾换行** → 我的 177 与两方一致，但口径存疑（派单 §0.3 自定口径是「文件字节 + sha256 前16」，未含行数）。
- **字节数 14505 与 sha256 前 16 `1f74c0703d279de6`：我没有任何通道可以计算**（sha256sum / wc -c 均需 shell）。按纪律「数字必须来自命令原始输出，禁手写」→ **我不写这两个数，也不得抄两方的值当作我算出的一致**。
- **判定：三方对账中「我」这一方缺失 → 不能给「一致」，只能给「不可复算」。** 两位独立方（启动指令、队长）互值一致这一事实成立，但不构成我的独立验证。

### 1.1 该件是否已落 origin/main

`git cat-file -e origin/main:<路径>` **无法执行**。静态替代取证（含判别性对照）：

1. **对照实验（证明否定结果有判别力，非二进制跳过）**：
   我 grep 工具 target=`D:\...\.git\index` 与路径无关的已知跟踪文件：
   ```
   pattern: src/server\.ts  → Found 1 match, .git\index Line 721: (line is not valid UTF-8)
   ```
   → grep 确实能命中 `.git/index` 内容（该文件是二进制，行被判 invalid UTF-8 但仍产出命中）。
2. **目标路径 grep**：
   ```
   pattern: D947-win-middleware-default-posture-20260924
   target:  D:\...\.git\index
   → No matches found
   ```
   → 该派单件**不在本地 git 索引**（既未跟踪、也未暂存）→ 在本地 HEAD `1a1cccc8` 的树中不可达。
3. 派单 §0.3 自述：「**本件尚未落 `origin/main`**（Win 侧无写凭据…）」。

**判定**：只能给「**本地未跟踪/未暂存**」+「派单自述未落 origin/main」。**不能给「未落 origin/main」的独立判定**——origin/main 领先 29 commit，理论上该件可在其中被加入，`.git/index` 证不了这一层。**§0.3 第 3 条「落 main 后复核」的判据在本 session 不可执行。**

---

## §2 F1–F8 逐条独立复跑 + 对账

### F1｜`rbacMiddleware` 之前挂载的路由组数 — 声称 **12 组** → **一致（但口径需收紧）**

命令：grep `app\.(use|get|post|put|patch|delete)\(` on `src/server.ts` → 65 命中。`rbacMiddleware` 实测在 **server.ts:373**。该行**之前**的挂载共 **20 处**：

```
323 app.use(setupGuideGoneRouter);          325 app.use('/app', express.static(...));
326 app.get('/', redirect)                   327 app.get('/login', redirect);
329 app.use(cors())                          330 app.use(express.json({limit:'10mb'}))
334 app.use(sanitizeCheckMiddleware)         341 app.use(llmConfigRoutes)
344 app.use(uploadV2GoneRouter)              345 app.use(jwtAuthMiddleware)
348 app.use(authRoutes)                      353 app.use(rateLimitMiddleware)
356 app.get('/api/status/budget', ...)       366 app.use(homeRoutes)
367 app.use(chatRoutes)                      368 app.use(workspaceRoutes)
369 app.use(workspaceDataRoutes)             370 app.use(workspacesApiRoutes)
371 app.use(gaDiagnosisRoutes)               372 app.use(knowledgeAskRoutes)
```

20 − 5 全局中间件（cors@329 / json@330 / sanitize@334 / jwtAuth@345 / rateLimit@353）− 3 静态重定向（static@325 / '@'326 / '/login'@327）= **12**。CTO 的「20 次挂载 = 5+3+12」分解**可复现**。
**但**：12 是**分类派生数**，不是可直数的量。**P4 的文字判据（「该行之前不得有任何 `app.use(router)` / `app.get|post|...`」）机械执行会数到 20 而非 12** → 基线与判据口径不一致（见 §3-P4）。

### F2｜无凭据角色兜底 — 声称 `rbac.ts` 返回 `{ role: 'admin', userId: DEFAULT_USER }` → **一致**

```
src\middleware\rbac.ts
Line 119:   return { role: 'admin', userId: DEFAULT_USER };
```
补充实测（派单未提）：`Line 16: const DEFAULT_USER = 'dev';`、`Line 15: const DEFAULT_ROLE: WorkspaceRole = 'staff';`

### F3｜legacy 自报通道 — 声称 `auth.ts` 的 `extractAuthFromRequest` 把 role 直接取自客户端字符串（默认 `staff`）→ **一致**

```
src\middleware\auth.ts
Line 395:   const token = req.headers?.['x-synova-token'] as string | undefined;
Line 399:       role: (parts[0] as WorkspaceRole | 'ga') || 'staff',
```
另实测 `rbac.ts:114` 同款：`role: (parts[0] as WorkspaceRole) || DEFAULT_ROLE`（DEFAULT_ROLE='staff'）。

### F4｜服务端信任客户端自报身份 — 声称 **6 处** → **一致，且穷举成立**

穷举命令：grep `x-synova-token` in `src/**/*.ts` → 8 命中（5 文件）：

| file:line | 是否计入 6 处 | 说明 |
|---|---|---|
| `server.ts:247` | ✔ 1 | 硬编码 `'admin::dev'` |
| `rbac.ts:110` | ✔ 2 | 角色取自头 |
| `auth.ts:395`（:378/:394 为注释） | ✔ 3 | 同上 |
| `department-workspace.ts:13` | ✔ 4 | 读取自报头 |
| `department-workspace.ts:75` | ✔ 5 | **自发** `'manager:'+DEPT+':user'` |
| `workspaces-api.ts:178` | ✔ 6 | `token.includes('admin') ? 'admin' : ...`（:179） |

→ **6 处，穷举无第 7 处**（src/ 内另无其他文件引用 `x-synova-token`）。**这是 D316 那种「grep 无其他」类声称，已独立穷举核实：成立。**

### F5｜两处判据被 `void` 丢弃 — 声称 `canAccessWorkspace`@248 + `canModifyWorkspace`@249 → **一致，行号精确**

```
src\server.ts
Line 248:   void canAccessWorkspace(rbacCtx, { visibility: 'global' });
Line 249:   void canModifyWorkspace(rbacCtx, { visibility: 'global' });
```
全仓库 grep `void canAccessWorkspace|void canModifyWorkspace` → **仅这 2 处**（其余 `void` 命中全是 TS 返回类型标注 `: void` 或 `init/file-driven-loaders.ts` 的 `void reloadLocale;` 保留导入标记，非判据丢弃）→ 判据「关键判据函数零 void」是**干净可数的 2→0**。

### F6｜生产代码自欺 — 声称 `server.ts` 硬编码 `'admin::dev'` + `department-workspace.ts` 自发 `manager:+DEPT` → **一致**

```
src\server.ts:247   const rbacCtx = extractRbacContext({ headers: { 'x-synova-token': 'admin::dev' } }); // Slice 7 RBAC
src\routes\department-workspace.ts:75  fetch(API+'/api/workspaces/mine',{headers:{'x-synova-token':'manager:'+DEPT+':user'}})
```

### F7｜存量测试固化不安全行为 — 声称 `rbac.test.ts` **3 处**「无 token → admin」+ `auth.test.ts` **2 处** legacy → **不一致（3 ≠ 2）+ 漏计**

**不一致 ①：`rbac.test.ts` 实测 2 处，非 3 处。**
`describe('extractRbacContext')` 内全部 5 个用例：

```
:12  it('admin token → role=admin')        mockReq('admin::dev')   → 带 token（自报 admin，非「无 token」）
:18  it('manager token with department')   mockReq('manager:marketing:alice')
:25  it('liaison token → role=liaison')
:30  it('empty token → default admin in dev')   :32 expect(ctx.role).toBe('admin')   ← 无 token #1
:35  it('token without colon → default admin')  :37 expect(ctx.role).toBe('admin')   ← 无 token #2
```
→ 严格按「**无 token** → admin」定义 = **2 处（:30-33、:35-38）**，不是 3 处。
→ 若 CTO 的第 3 处指 `:12-14`（`'admin::dev'` → admin），那它属于**另一类不安全**（自报 token 即认 admin），**不是「无 token」**。两方定义不同 → 登记为不一致。

**不一致 ②：`auth.test.ts` 的 2 处 legacy 成立，但整个 F7 的漏计严重。**
`auth.test.ts` legacy 2 处 ✅ `:383-387`（'支持 x-synova-token 向下兼容' → `expect(result!.role).toBe('admin')`）、`:397-406`（legacy 缺 orgId 段 → admin）。
**但全仓库 `x-synova-token` 断言/依赖实际分布在 5 个测试文件，其中 3 个不在派单 F7 也基本不在写集：**

```
tests\routes\ga-auth.test.ts:77-80        'legacy x-synova-token header 路径: ga:org:userId 放行（…既有语义不回改）'   ← 写集外
tests\routes\diagnosis-report-persistence.test.ts:337-341  headers: { 'x-synova-token': 'ga:org-d593:u1' }            ← 写集外
tests\routes\department-workspace.test.ts:29   headers: { 'x-synova-token': 'manager:marketing:alice' }, query: {}    ← 写集外
```
外加 `auth.test.ts:328-351` 断言 **DEV_MODE 自动 admin**（`nextCalled=true`、`req.auth` 存在）——这是 **P1 明文禁止的行为被固化为期望**，F7 未计。

### F8｜唯一漏斗的第二条路径 — 声称 `documents.ts` 两处直接传空过滤条件 → **一致**

```
src\routes\documents.ts
Line 85:     const { results } = store.search('', { conditions: [] }, 100);
Line 112:    const { results } = store.search(id, { conditions: [] }, 50);
```

### 派单已声明的行号漂移 — **复现成功**

派单 §七：「`src/middleware/auth.ts` 内注释写 jwt 挂载于第 315 行，**实测已是 345 行**」。
```
src\middleware\auth.ts:82:  …（server.ts 无第二份白名单，jwtAuthMiddleware 全局挂载于 server.ts:315）。
src\server.ts:345:   app.use(jwtAuthMiddleware);
```
→ 注释 315 vs 实际 **345**，**独立复现一致**。（旁证：`task-state/D556.json:50` 亦写「server.ts L291」，同为陈旧行号。）

---

## §3 P0–P8 判据可执行性预审 + 派单未覆盖的阻断项

### 3.0 先说三条会直接阻断 P0/P1/P2 的**派单未列**事实

**N1（最高优先级）｜`auth.ts:289-300` DEV_MODE 自动 admin —— P1 的直接反例，且 F2 的修点修不好它。**
```
src\middleware\auth.ts
Line 288:   const secret = process.env.JWT_SECRET;
Line 289:   if (!secret && process.env.DEV_MODE === 'true') {
Line 290:     log.warn('DEV_MODE: JWT_SECRET not set, auto-assigning admin role');
Line 293:       role: 'admin',
```
而 **`vitest.config.ts:59` 的 test env 里 `DEV_MODE: 'true'`**，且仓库内**没有**任何全局注入 JWT_SECRET 的 vitest setup（JWT_SECRET 只在个别测试文件内 `process.env.JWT_SECRET = ...` 设置）。
现成旁证（不是我推的，是仓库自述）：`tests/routes/conversations.test.ts:176` 原文——
> `// 生产态鉴权语义（用例 ③）：DEV_MODE 必须为 false（vitest env 默认 true 会让 JWT 中间件 auto-admin，白名单用例就空转了）+ 无 JWT_SECRET`

后果：测试环境下**任何无凭据请求经 jwtAuthMiddleware 即为 `role:'admin'`**；而 `rbac.ts:102 if (req.auth) { return { role: req.auth.role … } }` 会**直接采信**它。
→ **只修 F2 的 `rbac.ts:119` 兜底，P1 仍会红（上游已把 admin 灌进 req.auth）**。
→ F1–F8 前置冻结清单**漏掉这条**；`auth.ts` 虽在写集内（编码 A），但 P1 的变异体设计（「兜底改回 admin → 必红」）**指错了位置**。
→ 且存量 `auth.test.ts:328-351` 正是断言该行为**必须放行**，P1 落地必然要改它（在写集内，可做）。

**N2｜P2 的 `=0` 在声明写集内**不可达**。**
`grep -rn "conditions: []" src/ --include='*.ts'` 实测 **4 命中**（正则 `conditions:\s*\[\s*\]` 复核亦为同样 4 个，无空格变体漏网）：

| file:line | 在 12 文件写集内？ |
|---|---|
| `src/middleware/auth.ts:355` | ✔ 编码 A |
| `src/routes/documents.ts:85` | ✔ 编码 C |
| `src/routes/documents.ts:112` | ✔ 编码 C |
| **`src/services/request-context.ts:41`** | ✘ **不在写集** |

```
src\services\request-context.ts:41:   if (!ctx?.user || !ctx?.authProvider) return { conditions: [] };
```
→ **P2 要求 = 0，但声明写集覆盖不了第 4 处 → P2 按字面不可达。** 要么扩写集（须报 CTO），要么 P2 判据改为显式白名单/正则收窄。**这是判据与写集的自相矛盾。**

**N3｜「唯一漏斗」当前恒放行，且泄漏端点根本没调它。**
- `getPermissionFilter` 全仓库 grep：**实现仅 1 处 = `auth.ts:354-356`**，且是**恒真空条件桩**：
  ```
  authProvider: { getPermissionFilter: async () => ({ conditions: [] }) },
  ```
  调用方仅 `request-context.ts:42` 一处。
- 空条件的语义**由代码自己注释确认**为「放行」：
  ```
  src\l4\knowledge-store.ts:195-197:
    const filtered = filter.conditions.length === 0
      ? rows  // admin: 无过滤
      : rows.filter(row => this.matchFilter(row, filter));
  ```
- `documents.ts` 中 **`getPermissionFilter` 零命中** → 两个泄漏端点**根本不是通过漏斗**取的条件，是各自写死 `{conditions: []}`。
→ 「唯一漏斗真的唯一」（P2）隐含前提不成立：漏斗**既是唯一、又恒放行、又没人用**。P2 需要先定义「漏斗」的可执行语义，否则判据空转。

**N4｜`documents.ts` 两个端点连 req 都不读。**
```
src\routes\documents.ts:82:   router.get('/api/documents/list', (_req: Request, res: Response) => {
src\routes\documents.ts:108:  router.get('/api/documents/:id',   (req: Request, res: Response) => {
```
`:82` 签名是 `_req`（完全忽略请求）→ 「改走唯一漏斗」不是换一个条件对象，而是要**改处理函数签名并拿到身份**；F8 的「两处空条件」描述低估了改动面。

### 3.1 P0–P8 逐条预审

| # | 我的独立验收命令 | 期望输出 | 变异体是否真必红 | 判据问题 |
|---|---|---|---|---|
| **P0** | 穿入口用例：`x-synova-token: admin::x` + `?token=admin::x` → 断言 `role !== 'admin'`。**注意 `rbac.ts:110` 同时读 `req.headers['x-synova-token']` 与 `req.query?.token`** → 两条注入通道都在，命令可写 | `role !== 'admin'` | 是（恢复 `rbac.ts:110-117` 任一分支即红） | **但会被 N1 掩盖**：DEV_MODE 下 `req.auth` 已=admin，`rbac.ts:102` 优先采信 → 只测 `role!=='admin'` 时**可能因上游而被误判红/绿**。必须同时断 `req.auth` 与 env |
| **P1** | 无 token → 断言拒绝或明确匿名，且 `role !== 'admin'` | `401`/匿名 且 `role!=='admin'` | 是 | ✘ **当前必然红且红在 N1（auth.ts:289-300），非 rbac.ts:119**。且 `vitest.config.ts:59 DEV_MODE:'true'` 是默认态 → 不显式设 `DEV_MODE=false`+`delete JWT_SECRET`，用例在测 N1 而非被测目标。**判据未规定 env 前置** |
| **P2** | `grep -rn "conditions: []" src/ --include='*.ts'`（排除 tests/） | `0` | 是 | ✘ **不可达（N2）**：`request-context.ts:41` 在写集外。另：**派单 §八 说排除 tests/ 的理由是「否则命中本单自建夹具」——不实**：实测 tests/ 内 3 处命中全在**既有** `tests/e2e/ima-knowledge-e2e.test.ts:118,133,187`，本单自建的两个夹具文件**尚未存在**（tests/middleware 现仅 rate-limit / rbac-ga-boundary / rbac.test / auth.integration.test / auth.test 5 个文件） |
| **P3** | grep `void canAccessWorkspace|void canModifyWorkspace` in src/ | `0`（现 2：server.ts:248/249） | 是 | ✔ 判据干净可数。仅需补 env 前置说明 |
| **P4** | 前移后统计 `app.use(` on server.ts before rbacMiddleware 行 | 路由挂载 `0` | 是 | ✘ **口径矛盾（F1）**：文字判据数到 20，基线却写 12。且**有设计冲突**：`app.use(authRoutes)`@348 里含 `/api/auth/login`（`src/routes/auth.ts:113`），而 `rbacMiddleware` **无白名单**（`rbac.ts:258-261` 仅注入 + `next()`）→ 一旦 P1/P5 把它改成 fail-closed，**登录端点会被自己拦死**（chicken-and-egg）。判据未排除 auth/health 类**必须**前置的挂载 |
| **P5** | 判据失败 → 拒绝 + 三态日志可分 | 拒绝 + 三态可区分 | 是 | ⚠ 与现网 fail-open 降级冲突：`auth.ts:359-366` 两个 catch 都 `next()`（:360『continuing with req.auth』/:364『using req.auth only』）——**方向是 fail-open**。P5 要求 fail-closed → 这两处也要改，但 F 清单未列。另 `getSecret()` :54/:58 无密钥时**返回 null 而非拒绝** |
| **P6** | 「断言任何路由注册晚于鉴权中间件」+「关键判据函数零 void」 | 绿 | ⚠ **「路由注册顺序」这一半很可能是不可执行的运行时断言** | 要断言 Express 挂载顺序，只能 (a) import `server.ts` 拿 app（重，且 `server.ts` 启动副作用大），或 (b) **读源码文本做静态断言**。若走 (b)，就正是纪律明令禁止的「**grep 型静态判据当验收**」。**判据未给可执行形态**，且「key判据函数零 void」（server.ts:248/249 那 2 处）本身也只能静态 grep |
| **P7** | 扫描硬编码 admin（server.ts:247）+ 自发 manager（department-workspace.ts:75） | `0`（现 2） | 是（恢复任一即红） | ✔ 可执行。建议显式给扫描命令，否则「扫描命中」无口径 |
| **P8** | 每条修复各带 1 变异体 + 三路径夹具 | 三路径各 1 组输出 | 是 | ⚠ 「降级仅适用业务判据；安全判据一律 fail-closed」与 **铁律 11/24/31（catch 必须 log + degraded:true）** 存在张力：安全判据 fail-closed 时是否仍要 `degraded:true` 返回体？判据未定义 fail-closed 的**响应契约**（状态码/body/degraded 标记），执行方会各自发挥。**建议 PLAN 阶段补契约**（铁律 47 要求先定契约再实现） |

### 3.2 P5 三态可区分性

判据要求日志中 `被拒绝` / `不可用（系统异常）` / `出错` 三态**可区分**。我实测 `auth.ts` 现有日志：`log.warn('DEV_MODE: JWT_SECRET not set, auto-assigning admin role')`（:290）、`log.error({err},'jwtAuthMiddleware 异常')`（:368）、`log.warn(...,'request-context runWithContext error, continuing with req.auth')`（:360）、`log.warn(...,'request-context not available, using req.auth only')`（:364）——**无一处含「被拒绝」字样，也无稳定可机读的态字段**。「三态可区分」需先定义**可机读字段**（如 `denyReason`/`degraded`），否则验收退化为人工读日志。

---

## §4 不一致清单（显式登记，不淡化）

| ID | 项 | 声称 | 实测 | 性质 |
|---|---|---|---|---|
| **D-1** | F7 `rbac.test.ts` 处数 | 3 处「无 token → admin」 | **2 处**（`:30-33`、`:35-38`）；第 3 处若算 `:12-14` 则定义不同（带自报 token） | **数字不一致** |
| **D-2** | F7 覆盖范围 | 2 个文件（rbac/auth test） | 仓库内 legacy `x-synova-token` 依赖实际跨 **5 个测试文件**：+`tests/routes/ga-auth.test.ts:77-80`、`tests/routes/diagnosis-report-persistence.test.ts:337-341`、`tests/routes/department-workspace.test.ts:29`（**三者均不在 12 文件写集**） | **漏计 → 写集覆盖不足风险** |
| **D-3** | F7 未计 | — | `auth.test.ts:328-351` 断言 **DEV_MODE 自动 admin 必须放行**，与 P1 直接对立 | **漏计** |
| **D-4** | P1/P0 修点 | 隐含在 rbac.ts 兜底 + 自报分支 | 真实首因是 **`auth.ts:289-300` DEV_MODE 自动 admin**，且 `vitest.config.ts:59 DEV_MODE:'true'` 使其成为**测试默认态** | **前提不完整（阻断级）** |
| **D-5** | P2 可达性 | `conditions: []` = 0（排除 tests/） | 现 4 处，其中 **`src/services/request-context.ts:41` 不在写集** → 按字面**不可达** | **判据自相矛盾** |
| **D-6** | P2 排除 tests/ 的理由 | 「否则命中本单自建夹具」 | 实测 tests/ 命中全在**既有** `tests/e2e/ima-knowledge-e2e.test.ts:118,133,187`；本单自建夹具**尚不存在** | **理由不实（结论侥幸正确）** |
| **D-7** | F1/P4 口径 | 基线「12 组」→ 必须 0 | 该行前**可数挂载 = 20**；12 是 5+3 分类后的派生数。P4 文字判据会数到 20 | **基线与判据口径不一致** |
| **D-8** | P4 设计冲突 | 前移后该行前零路由 | `rbacMiddleware` 无白名单（`rbac.ts:258-261` 仅注入 + next），而 `authRoutes`（含 `/api/auth/login`，`routes/auth.ts:113`）当前在其前 → fail-closed 化后**登录会被拦死** | **判据未设例外** |
| **D-9** | P6 可执行性 | 「断言任何路由注册晚于鉴权中间件」 | 无给可执行形态；运行时断言需 import `server.ts`（重），静态断言则触犯「禁 grep 型静态判据当验收」 | **可执行性未定义** |
| **D-10** | 漏斗语义 | 「唯一漏斗真的唯一」 | `getPermissionFilter` 唯一实现**恒返回空条件**（`auth.ts:354-356`），语义=放行（`knowledge-store.ts:195-197` 自注释「admin: 无过滤」）；且 `documents.ts` **零调用** | **前提不成立** |
| **D-11** | 指纹三方对账 | 一致 | **我无法独立复算字节数与 sha256** → 三方缺一 | **未完成（执行面受限）** |
| **D-12** | 落 main 判据 | `git cat-file -e origin/main:<path>` 退出码 | **不可执行**；仅能证「本地未跟踪（`.git/index` 0 命中，含对照实验）」+ 派单自述未落 main | **判据不可执行** |
| **D-13** | F5 原文混写 | 已自我披露 | **复核一致**：248=canAccessWorkspace、249=canModifyWorkspace，与派单 §二 P3 更正一致 | 无问题（记录） |

**行号漂移复核**：`auth.ts:82` 注释写 `server.ts:315`，实测 `server.ts:345` → **漂移确认成立**（与派单 §七自述一致）。派单内其余引用行号抽查（server.ts:247/248/249/373、rbac.ts:110/119/258、auth.ts:399、documents.ts:85/112、department-workspace.ts:13/75、workspaces-api.ts:178）**均未漂移**。

---

## §5 自验结论

- **§1 派单件指纹三方对账：退回（理由 = D-11）**——不是「一致」，也**不是「不一致」**，而是**我这一方无法复算**。缺字节数与 sha256 的独立值，两方互值一致不能替代我的独立验证。落 main 判据亦不可执行（D-12）。**建议：CTO 在可执行环境补一次 `wc -c` / `sha256sum`，或接受「二方一致 + 自验方受限登记」并明确记录。**
- **F1–F8：可提请独立审计，但带 4 处不一致与 1 处阻断级前提缺口。** F2/F3/F4/F5/F6/F8 **独立复现一致**（其中 F4 的「6 处」经穷举成立；F5 行号精确；auth.ts 行号漂移复现）。**F7 不一致（D-1）+ 漏计（D-2/D-3）**；**F 清单整体漏掉阻断 P0/P1 的 N1（D-4）**。
- **P0–P8 判据：可提请独立审计（附条件）。** P3/P7 可直接执行；P0/P1 需补 env 前置；**P2 按字面不可达（D-5）**；**P4 口径矛盾 + 登录自锁风险（D-7/D-8）**；**P6 可执行性未定义（D-9）**；P5/P8 需补 fail-closed 的响应/日志契约。
- **环境事实：E1 复现成功；E2/E3 未复现（degraded，不可自行解除）；E4 refs 复现成功、「29 commit」未验证。**
- **本阶段未跑 vitest（遵约束），未改仓库内任何文件，未执行任何 git 写操作。**
- 我**不判「通过」**。以上为自验结论，通过与否归 CTO 收件闸 + K3 终审。

---

## §6 建议 CTO 在 PLAN 复核时处置

1. **扩 F 清单**：把 `auth.ts:289-300`（DEV_MODE 自动 admin）+ `vitest.config.ts:59` 纳入前置冻结，并明确 P1 的 env 前置（`DEV_MODE=false` + `delete JWT_SECRET`）。
2. **P2 改判据**：要么把 `src/services/request-context.ts:41` 纳入写集，要么判据收窄为「写集内 3 处 → 0」+ 对 request-context.ts 单列一条（该处本身是 fail-open 兜底，与 P5 冲突，建议另立卡）。
3. **P4 补例外清单**：明确哪些前置挂载（auth/health/static/jwt/rateLimit）不计入「零路由」，并解决 login 自锁。
4. **F7 重数并补写集**：3 处 → 2 处（定义写清）；把 3 个写集外的 legacy 测试文件纳入影响面（否则 P0/P1 实施后它们会红而无人有权改）。
5. **补 P5/P8 契约**（铁律 47）：fail-closed 的状态码 / body / 可机读态字段。
6. **P6 给可执行形态**：若必须静态，则显式声明「本条为静态判据」并**另配一个运行时可判别夹具**（否则「接线了 ≠ 被执行」）。
