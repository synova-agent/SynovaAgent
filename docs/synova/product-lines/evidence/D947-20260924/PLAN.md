# D947 第 0 阶段 PLAN（待 CTO 复核放行）

> 执行方：DSH 小队（synova-squad-lead 队长 + 编码 A/B/C + 独立自验 + 独立复核，共 6 人）
> 卡片：`task-state/D947.json`（`status=claimed`）｜分支：`feat/d947-middleware-default-posture`｜worktree：`.synova-wt-d947-middleware`
> 基线：`origin/main f25e61eb`（本地 main `1a1cccc8`，落后 29）
> **本件未提交、未写任何产品代码**（证明见 §0.4）。放行前不进入实施。

---

## §0 回执前置

### 0.1 派单件指纹对账（三方）

| 来源 | 字节 | 行数 | sha256 前 16 |
|---|---|---|---|
| 启动指令值 | 14505 | 177 | `1f74c0703d279de6` |
| 队长复算（`wc -c` / `wc -l` / `sha256sum`） | **14505** | **177** | **`1f74c0703d279de6`** |
| 独立自验（verifier） | 无法复算（其 session 无 shell）→ 登记 degraded，**拒绝抄写** | 读得 177 行（reader 口径） | 无法复算 |

sha256 全值：`1f74c0703d279de6956a6072443d1d0f06cd6b2338ef5c0260f095e4f1b3794c`。
落 main 判定：`git cat-file -e origin/main:docs/synova/dispatch/D947-win-middleware-default-posture-20260924.md`
→ `fatal: path ... exists on disk, but not in 'origin/main'`，`exit=128` ⇒ **确认未落 origin/main**（按 §〇.3 本地优先例外执行）。
落 main 后复核义务：由队长在下一轮比对本地版 vs main 版指纹，不一致 → 立即停手报 CTO。

### 0.2 环境事实（实测，影响所有成员的取证形态）

| 项 | 实测 | 含义 |
|---|---|---|
| 默认沙箱下 `pwsh` | 空输出 + `exit 3221225794`（0xC0000142 STATUS_DLL_INIT_FAILED），4/4 复现 | 队长与 5 名成员全部遇阻 |
| 队长提权后 `pwsh` | 可用（但 Management 模块损坏：`cd`/`Get-Item`/`Test-Path`/`Resolve-Path` 报模块加载失败） | 队长可取证 |
| **成员 session 提权通道** | **不可用**（runtime 明示 approval prompts disabled，成员为委派子代理、权限启动时固定） | ⇒ **5 名成员的取证全部为 read/grep/glob 静态等价取证，无退出码、无行为级红证**（已显式登记 degraded，未静默降级） |
| Git Bash | `C:\Program Files\Git\bin\bash.exe`（bash 5.3.9 / python3 3.13.13 / node v24.16.0） | 队长走此路 |
| SSH 远端 | `git@github.com: Permission denied (publickey)` | Win 侧无写凭据（与派单 §六 遗留 4 一致） |
| HTTPS 只读 | `git -c http.sslBackend=openssl ls-remote --heads https://github.com/tangbaobao520/SynovaAgent.git` → exit 0 | 只读回执走此路；`git fetch`（smart protocol）被 reset |

### 0.3 环境前置判据（§〇.2）

| 判据 | 结果 |
|---|---|
| 专属 worktree `.synova-wt-d947-middleware` | ✅ 已建（`git worktree add -b <branch> <path> origin/main`），HEAD `f25e61eb`，`git status --porcelain` = **0** |
| worktree 被主树忽略 | ✅ `.gitignore:85 .synova-wt-*`；主树 `git status` 中 `.synova-wt-d947-middleware` 命中 **0** |
| 分支名含 `d947` | ✅ `feat/d947-middleware-default-posture`（**已按卡片 `D947.json` 的 `branch` 字段校准**） |
| 技能同步 | ✅ `bash scripts/workflow/sync-dsh-skills.sh --check` → `SYNC-OK: 技能一致（16 个技能）`，exit 0 |
| 门禁基线 | ✅ `bash scripts/pre-commit-check.sh`（worktree 内）→ `✅ 全部 13 组通过`，exit 0，`⚠️ 1 项警告（不阻断）` + V5 软提示 1 项 |
| 基线代码同一性 | ✅ 12 文件写集中 8 个已存在文件在主树与 worktree **sha256 逐一相同**（SAME ×8）⇒ 成员在主树取的行号对 worktree 有效 |
| 远端回执 | `git ls-remote --heads <https> refs/heads/*d947*` → **空**（`receipt_exit=0`）⇒ origin 上无 d947 分支 |

### 0.4 未写码证明

`git status --porcelain=v1` 行数 = **0**；`git diff --stat` 行数 = **0**。
本阶段仅落两件证据文件（本 PLAN + verifier 原始取证转存），**零产品代码改动**。

### 0.5 团队成员运行记录

| 成员 | 状态 | 共享任务 id / 状态 | 交付 |
|---|---|---|---|
| lead（队长，不下场写码） | running | —（本人） | 本 PLAN + 全部数值原始输出 |
| code-a（编码 A） | 完成 | `task-1` / completed | F2/F3/F4/F7 复跑、P0/P1/P2/P5 改动点、4 变异体草案 |
| code-b（编码 B） | 完成 | `task-2` / completed | F1/F4/F5/F6 + P6 现状、P4 可达性分析、12 组影响面 |
| code-c（编码 C） | 完成 | `task-3` / completed | F4/F6/F8 + 双口径、P2 漏斗全链、P0 入口与请求构造 |
| verifier（独立自验） | 完成 | `task-4` / completed | 指纹对账（退回：无通道）、F1–F8 独立复跑、P0–P8 可执行性预审 |
| reviewer（独立复核） | 完成 | `task-5` / completed | 自写探针 16 条、改前红证基线、5 处判据勘正 |

token：5 名成员各 1 个委派 session（`deepseek-flash`，fresh 上下文）；成员间无共享上下文，复核者声明未读自验/编码回执。

---

## §1 依赖图

### 1.1 内部依赖链（实测 file:line）

```
jwtAuthMiddleware  src/middleware/auth.ts:280   挂载 server.ts:345
   ├─ 白名单短路   auth.ts:283-284  isWhitelisted(path) → next()（不写 req.auth）
   ├─ DEV_MODE 分支 auth.ts:288-300  !JWT_SECRET && DEV_MODE==='true' → req.auth={role:'admin'} → next()
   └─ JWT 校验     auth.ts:332      req.auth = result.payload
        ↓（写入 req.auth）
rbacMiddleware     src/middleware/rbac.ts:258   挂载 server.ts:373
   ├─ rbac.ts:102-108  req.auth 优先（可信通道）
   ├─ rbac.ts:110-118  x-synova-token / ?token= → role=parts[0]（自报通道）
   ├─ rbac.ts:119      无凭据 → { role:'admin', userId:'dev' }
   └─ rbac.ts:259      req.rbac = extractRbacContext(req) → next()   ← 纯注入，永不 401/403
        ↓（写 req.rbac）
   【实测 E2】`grep -rn "\.rbac\b" src/ | grep -v middleware/rbac.ts` → 0 命中（exit 1）
   ⇒ req.rbac 全仓库零消费者 ⇒ P4 单独前移 = 行为空操作（"接线了 ≠ 被执行"）

权限漏斗（P2）:
  auth.ts:354-356  getPermissionFilter: async () => ({ conditions: [] })   ← 唯一实现，恒空
      ↑ runWithContext 包裹 next()（auth.ts:337-362）
  src/services/request-context.ts:39-42  getCurrentFilterClause()
      ├─ :41  !ctx?.user || !ctx?.authProvider → return { conditions: [] }  ← 第二处 fail-open
      └─ :42  ctx.authProvider.getPermissionFilter(...)
  消费方 9 处：l3/knowledge-agent.ts:19/69/113/204、l1/qa-router.ts:14/84、routes/knowledge.ts:13/35
  ⇒ documents.ts 不在消费方名单 = F8「第二条路径」成立
```

### 1.2 硬顺序不变量（4 条，均有源码注释 + 测试锁定，**实测原文**）

| # | 不变量 | 出处（实测） | 依据 |
|---|---|---|---|
| I1 | `setupGuideGoneRouter`(323) < `/app` static(325) | server.ts:319-322 注释 | D716；`tests/routes/setup-guide-retired.test.ts:137-152` 锁行号 |
| I2 | `llmConfigRoutes`(341) < `jwtAuthMiddleware`(345) | server.ts:337-340 注释 | D575：首启向导无用户系统时必须可用 |
| I3 | `uploadV2GoneRouter`(344) < `jwtAuthMiddleware`(345) | server.ts:342-343 注释 | D590 裁决②：410 对未认证客户端显式 |
| I4 | `rbacMiddleware` **必须晚于** `jwtAuthMiddleware` | rbac.ts:102 读 `req.auth` | 若 rbac 先于 jwt → `req.auth` 恒 undefined → 100% 请求落 rbac.ts:110 自报通道（P0 恶化）或 P1 落地后全站 403 |

**I4 是 P4 的承重约束**：把 rbac 移到 jwt 之前可让 P4 字面达成（前面 0 条），但同时把 P0 从"部分可穿"变成"全量可穿"，且与 P1 fail-closed 组合会全站锁死。

### 1.3 前移后 12 组路由的行为变化（P4 影响面）

口径（本人实测）：`rbacMiddleware` 在 `server.ts:373`；其前 **20 次挂载** = 5 全局中间件(329/330/334/345/353) + 3 静态/重定向(325/326/327) + **余额 12** = 323/341/344/348/356/366/367/368/369/370/371/372。
文件内总挂载 65 条（`20 + 1(rbac 自身) + 44(其后)` = 65 闭合）。

| # | 行 | 组 | 现在的行为 | P0/P1 落地 + 前移后的变化 | 风险 |
|---|---|---|---|---|---|
| 1 | 323 | setupGuideGoneRouter | 410 | 若留在 rbac 前 → 无变化；若被罩 → **410→403，D716 回归** | 高 |
| 2 | 341 | llmConfigRoutes | 免 JWT 可达 | 同上 → **D575 首启向导回归** | 高 |
| 3 | 344 | uploadV2GoneRouter | 410 | 同上 → **D590② 回归** | 高 |
| 4 | 348 | authRoutes | 含 `/api/auth/login`、`/api/auth/register` | 若被罩 → **登录/注册被拦死（chicken-and-egg）**；须 rbac 白名单或让其留在前 | 阻塞级 |
| 5 | 356 | 内联 `GET /api/status/budget` | 免 JWT（白名单 `/api/status`） | 若被罩 → 桌面预算面板 403 | 中 |
| 6 | 366 | homeRoutes | 认证可达 | 落 rbac 后 → 未认证 403（P4 预期效果） | — |
| 7 | 367 | chatRoutes | 同上 | 同上 | — |
| 8 | 368 | workspaceRoutes | 同上 | 同上 | — |
| 9 | 369 | workspaceDataRoutes | 同上 | 同上 | — |
| 10 | 370 | workspacesApiRoutes（= **P3 写端点所在**） | 未认证可达 + 文件内 `:131-132` 自报身份自判权 | 落 rbac 后未认证 403，**但其自报身份不受 rbac 约束** ⇒ P4 ≠ P3 | 中 |
| 11 | 371 | gaDiagnosisRoutes | 与白名单交叉（`/api/diagnosis/consult`、`/api/diagnosis/reports`） | 若被罩 → **D590/D593 回归** | 高 |
| 12 | 372 | knowledgeAskRoutes | 白名单 `/api/knowledge/ask`（D595 MCP HTTP 桥） | 若被罩 → **MCP `knowledge_ask` 断链** | 高 |

**白名单交叉（实测，`awk '/^function isWhitelisted/,/^}/' src/middleware/auth.ts | grep -cE ...` = 23 条）**：`/health`、`/`、`/api/auth/login`、`/api/auth/register`、`/api/enterprise/register`、`/api/enterprise/invitation/`、`/api/status`、`/assets/`、`/cockpit`、`/api/healthz`、`/api/sentinel/`、`/api/cockpit/`、`/api/diagnosis/consult`、`/api/diagnosis/reports`、`/api/conversations`、`/api/sessions`、`/api/notifications`、`/api/solutions`、`/api/ga/clients`、`/api/ga/switch`、`/api/ontology/graph/`、`/api/ontology/ingest`、`/api/knowledge/ask`。
auth.ts:82 明文声明「唯一源 = 本文件 isWhitelisted()（server.ts 无第二份白名单）」⇒ **给出 rbac 第二份白名单会破坏该不变量**。

### 1.4 对外影响面

- **D595 MCP HTTP 桥**（`/api/ontology/graph|ingest`、`/api/knowledge/ask`）：必须保持直达，否则 MCP 断链。
- **electron-renderer dev-seed 旁路**（`RightPanel.tsx` / `stores/ga-collab.ts` 发 legacy 头）：删服务端信任后失效 → Mac 域另立卡（派单 §六 遗留 2）。
- **`src/routes/department-workspace.ts`**：文件头自述 `@deprecated … 不修改此文件`（实测行 5-6），但 `server.ts:374` 仍挂载、且在派单写集内 → 写集与文件自述冲突（§7 R6）。
- 上游 W0-3 旧判据已作废，本单不引用。

---

## §2 逐文件写集（两两不重叠，`src/server.ts` 单写者）

| 写者 | 文件 | 性质 | 覆盖判据 |
|---|---|---|---|
| **code-a** | `src/middleware/rbac.ts` | 删自报分支；兜底改拒绝；fail-closed + 三态 | P0/P1/P5 |
| | `src/middleware/auth.ts` | 删 legacy 自报分支；`getPermissionFilter` 返回真实条件 | P0/P2 |
| | `tests/middleware/rbac.test.ts` | 存量修订 | P0/P1 |
| | `tests/middleware/auth.test.ts` | 存量修订 | P0 |
| | `tests/middleware/rbac-default-deny.test.ts` | **新建** | P1/P5 |
| | `tests/middleware/permission-filter.test.ts` | **新建** | P2 |
| **code-b** | `src/server.ts` | **单写者**；删 244-249 自欺块；前移 rbac；收窄 import | P4/P7 |
| | `tests/routes/middleware-order.test.ts` | **新建** | P4/P6 |
| **code-c** | `src/routes/documents.ts` | 两处空条件改走漏斗 | P2 |
| | `src/routes/workspaces-api.ts` | 删自报头；写端点接 `canModifyWorkspace(req.rbac)` | P0/P3/P7 |
| | `src/routes/department-workspace.ts` | 删自报头 + 内部 fetch 自报 | P0/P7 |
| | `tests/routes/workspace-access-write-endpoint.test.ts` | **新建** | P3 |

互斥校验：三组**零共享文件**（`tests/middleware/**` 归 A、`tests/routes/**` 中 3 个新建/收口文件按上表分属 B/C——`middleware-order.test.ts` 归 B，`workspace-access-write-endpoint.test.ts` 归 C）。
**禁写**：`scripts/**`、`scripts/audit/**`、`electron-renderer/**`、`src/l3|l4|l5|sentinel|store|agent|orchestrator/**`。

### 2.1 写集缺口（**须 CTO 裁定，见 §7 R1/R4**）

| 缺口文件 | 为何需要 | 现状 |
|---|---|---|
| `src/services/request-context.ts:41` | P2 要求 `conditions: []` 在 `src/` = 0，此文件是第 4 处（fail-open） | **不在 12 文件写集**，也不在派单 §一 |
| `tests/routes/department-workspace.test.ts:29` | 以自报 token 为期望，P0 后必红 | 不在写集（P0 后有红腿无人有权改） |
| `tests/routes/ga-auth.test.ts`（3 处 legacy 头） | 同上 | 同上 |
| `tests/routes/diagnosis-report-persistence.test.ts`（2 处） | 同上 | 同上 |
| `tests/routes/overflow.test.ts`（1 处） | 同上 | 同上 |

实测 `grep -rn "x-synova-token" tests/ --include=*.ts | cut -d: -f1 | sort | uniq -c` =
`7 tests/middleware/auth.test.ts｜3 tests/middleware/rbac.test.ts｜1 tests/routes/department-workspace.test.ts｜2 tests/routes/diagnosis-report-persistence.test.ts｜3 tests/routes/ga-auth.test.ts｜1 tests/routes/overflow.test.ts`（共 17 处 / 6 文件）。
⇒ 12 文件预算下**必然出现"改后红腿无写权"**。卡片 `write_set` 是目录 glob（`tests/routes/**` 在内），与派单 §一 的 12 文件枚举**口径不同** → 需 CTO 明确以哪一份为准（§7 R4）。

---

## §3 三路径 + 变异体夹具设计

口径：安全判据（P0/P1/P3/P4/P5）**一律 fail-closed，无"降级放行"位**；P8 的"降级"仅取业务判据（审计写入失败等）。**降级路径一律要求 `log.warn/error` + 显式 degraded 标记（铁律 11/24/31）。**

**环境前置（对所有 vitest 夹具强制）**：`vitest.config.ts:59` 注入 `DEV_MODE:'true'` 且无 `JWT_SECRET` → `auth.ts:288-300` 自动 admin，任何 P0/P1 用例会空转。夹具必须自设 `JWT_SECRET`（≥16 字符，`auth.ts:52` 先于 `:54` 生效）+ `DEV_MODE='false'`（先例 `tests/routes/conversations.test.ts:176-179`）。
**断言顺序强制**：先断 `res.status`，再断身份字段 —— 否则 401 响应上 `role !== 'admin'` **空转通过**（绿腿）。

| 判据 | 正常路径 | 降级/不可用路径 | 边界 | 变异体（改坏即红） |
|---|---|---|---|---|
| **P0** 自报身份失效 | `Authorization: Bearer <JWT role=manager>` **＋** `x-synova-token: admin::x` → 200 且 `role !== 'admin'` | 安全判据 ⇒ 无降级；`extractRbacContext` 抛错 → 403 + `log.warn` + degraded 标记 | `?token=admin::x`（query 载体）· header+query 冲突 · 无冒号 token · 空串 · 白名单路径无凭据 | 恢复 `rbac.ts:110-118` 任一自报分支 → 必红 |
| **P1** 无凭据 ≠ admin | 非白名单路径无凭据 → 401/403（`role` 不为 admin，且 `req.rbac` 不含 admin） | 同上（fail-closed） | 白名单路径 → 显式匿名身份（**不得** admin）· `DEV_MODE=false`+`JWT_SECRET` 下无凭据 → 拒绝 · 白名单 23 条逐类抽样 | 把 `rbac.ts:119` 改回 `role:'admin'` → 必红 |
| **P2** 唯一漏斗 | 注入真实 `AuthProvider`（返非空 conditions）→ `getCurrentFilterClause('KnowledgeChunk')` 返回**非空**；`documents.ts:85/:112` 经漏斗 | 无 `ctx.user`/`authProvider` → **不得**返回 `{conditions:[]}` 放行（须 deny 哨兵或抛错由调用方 fail-closed） | `ctx` 三字段全真值表（`!ctx?.user \|\| !ctx?.authProvider`）· 空结果集保持 `{ok:true,documents:[],count:0}` | `auth.ts:355` 改回 `() => ({conditions:[]})` → 必红 |
| **P3** 写端点生效 | 本部门 manager / admin 身份 → `PUT /api/workspaces/:id/status` 200 且状态已变 | 判据不可用 → 403 + `log.warn` + degraded（**不得放行**） | `role='ga'` → 403（rbac.ts:253）· 跨部门且非 owner → 403 · `role='staff'` → 403（rbac.ts:254） | 删掉写端点 `canModifyWorkspace` 守卫 → 必红 |
| **P4** 中间件前零业务路由 | 源码顺序断言（豁免集固定）+ **运行时探针**：无凭据打 `GET /api/workspaces/mine` → 403 | 源码断言必须**成对**运行时探针，否则"删掉 rbac 行"也能过（禁 grep 型静态判据当验收） | 豁免集路径仍须直达：`/health`、`POST /api/auth/login`、`GET /api/status/budget`、`GET /api/knowledge/ask` → **非 401/403** | 把 `app.use(rbacMiddleware)` 移回 373 之后 → 源码断言 + 运行时探针双红 |
| **P5** fail-closed + 三态可分 | 判据可用且通过 → 注入 + next() 一次 | 判据不可用 → 拒绝 + 留痕；内部异常 → 拒绝 + `degraded:true` | 三态机读可辨：`被拒绝` / `不可用（系统异常）` / `出错` 各 ≥1 断言（不得靠人读日志） | 把"查不出来"改成 `next()` → 必红 |
| **P6** 测试层必红 | 断言①「任何路由注册晚于鉴权中间件」（豁免集固定）②「关键判据函数零 `void`」 | —（测试层无降级） | 源码顺序断言形态照抄 `tests/routes/setup-guide-retired.test.ts:137-152`；**必须配运行时探针** | 重新插入 `void canAccessWorkspace(...)` → 断言②红；把业务 router 挂到 rbac 之前 → 断言①红 |
| **P7** 生产零自欺 | `grep -rn "admin::dev" src/` = 0；`department-workspace.ts` 自发串 = 0 | —（静态判据） | 删 `server.ts:244-249` 后 `extractRbacContext`/`canAccessWorkspace`/`canModifyWorkspace` 在 server.ts 全零引用 ⇒ **import 必须同步收窄为仅 `rbacMiddleware`**（铁律 37） | 恢复任一处硬编码 → 命中 ≥1 → 红 |
| **P8** 每修复 1 变异体 + 三路径 | 见上 8 行 | 同左 | 同左 | 红证**不残留仓库**：变异体仅在夹具内临时实现并 `afterAll` 清理（形态对齐 `setup-guide-retired.test.ts:88-97`） |

---

## §4 失效条件（无失效条件的规则不许进仓库）

| 规则 | 失效（可撤）条件 | 撤销前置证据 |
|---|---|---|
| R-P0 删除客户端自报身份（header + query 双载体） | 全部 legacy 客户端改走正规登录，且 `x-synova-token` 在 `src/` 与 `electron-renderer/` 零发送方 | `grep -rn "x-synova-token" src/ electron-renderer/` = 0；Mac 域卡关闭 |
| R-P1 无凭据 fail-closed | 出现可信的显式匿名身份协议（会话级鉴权，施工图 §5.5），且白名单 23 条迁入该协议 | 会话级鉴权上线 + 白名单条数归零 |
| R-P2 唯一漏斗（`conditions: []` = 0） | 权限过滤下推到 L5 行级安全（store 层强制），漏斗不再是唯一收口 ⇒ 判据改写为 store 层断言 | store 层 RLS 落地并覆盖 documents/knowledge 两族 |
| R-P4 「鉴权中间件之前仅允许豁免集」 | 中间件顺序模型被**路由级声明的守卫元数据**取代（顺序不再承载语义） | 路由守卫声明机制落地并覆盖全部 65 条挂载 |
| R-P5 三态日志可辨 | 统一错误中间件 + 错误分类（`.code/.phase/.retryable`，铁律 32）落地，三态由类型系统承载 | 统一 error middleware 上线 |
| R-P6 测试层必红 | 派单 §六 遗留 3 的 **pre-commit 门禁脚本**（Mac 域）落地并把两条断言前移到提交时刻 | 门禁脚本在 CI 与本地双端生效，且已用变异体验证必红 |
| R-P7 生产零自欺 | 判据函数真正进入请求级调用链（P3 完成）后，该静态扫描降级为回归哨兵 | P3 绿 + `req.rbac` 有真实消费者 |

---

## §5 前置冻结清单（F1–F8 复跑，工作树内实测）

> 全部命令在 `.synova-wt-d947-middleware`（`f25e61eb`）内执行；下表「实测」列即原始输出摘要，多命中已标「共 N 处」。

| # | CTO 声称 | 我方实测（原始输出） | 判定 |
|---|---|---|---|
| **F1** | `rbacMiddleware` 之前 12 组（该行前 20 次挂载：+5 全局中间件 +3 静态/重定向） | `rbac_line=373`；前 20 行挂载**逐行列出**（323/325/326/327/329/330/334/341/344/345/348/353/356/366-372）；文件内总挂载 **65**；20 = 5+3+**12** | ✅ **12 可复现**，但口径必须写死为"余额口径（含 1 条内联路由 356）"；严格 Router 口径为 11 |
| **F2** | 无凭据 → `{role:'admin', userId: DEFAULT_USER}` | `rbac.ts:15 DEFAULT_ROLE='staff'`、`:16 DEFAULT_USER='dev'`、`:119 return { role: 'admin', userId: DEFAULT_USER };`（`DEFAULT_ROLE` 在无凭据路径**从未被使用**） | ✅ 一致 |
| **F3** | `extractAuthFromRequest` 把 role 直接取自客户端字符串（默认 `staff`） | `auth.ts:395` 读 `x-synova-token`；`:396-404`；`:399 role: (parts[0] as WorkspaceRole\|'ga') \|\| 'staff'`；`:406 return null` | ✅ 一致；补充：`:406` 之后无"匿名身份"概念，只有 null |
| **F4** | 6 处信任客户端自报身份 | `grep -rn "x-synova" src/` = **9 处**（2 条注释 + 1 条异构头 `x-synova-scope`），**自报身份代码位恰 6 处**：`rbac.ts:110`、`auth.ts:395`、`workspaces-api.ts:178`、`department-workspace.ts:13`、`department-workspace.ts:75`、`server.ts:247` | ✅ **6 处成立**；⚠️ 派单给的命令 `grep -n "headers\["` **口径有缺陷**（`rbac.ts:110` 用可选链 `headers?.[`，该命令只出 1 处）→ 正确命令已写入 §6 |
| **F5** | 两处判据被 `void` 丢弃（原文符号/行号混写） | `server.ts:248 void canAccessWorkspace(...)`、`server.ts:249 void canModifyWorkspace(...)`；`grep -c "void " src/server.ts` = **2**（无第三处） | ✅ **§二 P3 更正版属实**：canAccessWorkspace@248 + canModifyWorkspace@249 |
| **F6** | 自欺：`server.ts` 硬编码 `admin::dev`；`department-workspace.ts` 自发 manager | `server.ts:247 'x-synova-token': 'admin::dev'`；`department-workspace.ts:75 'x-synova-token':'manager:'+DEPT+':user'` | ✅ 一致（且该块结果被 `void` 丢弃 ⇒ 净生产行为 = 0） |
| **F7** | `rbac.test.ts` 3 处"无 token → admin"；`auth.test.ts` 2 处 legacy 头可用 | `rbac.test.ts` `toBe('admin')` = **4 处**（14/32/37/151），其中"无 token"字面 **2 处**（32/37），P0 影响面 **3 处**（14/32/37）；`auth.test.ts` "legacy 头可用" = **2 处**（383-389、397-417） | ⚠️ **口径依赖**：字面口径 2 ≠ 3；须冻结为"P0 影响面口径 = 3"（14/32/37）。auth.test.ts ✅ 一致 |
| **F8** | `documents.ts` 两处空过滤条件 | `documents.ts:85`、`:112` = **2 处** ✅；`src/` 全量 `conditions: []` = **4 处**（+`auth.ts:355`、`src/services/request-context.ts:41`）；含 `tests/` = 7 处 | ✅ 两处一致；🔴 **P2 判据在现写集下不可达**（第 4 处在写集外，见 §7 R1） |

### 5.1 复跑中发现的、派单未登记的事实（均已实测）

| # | 事实 | 原始证据 | 影响 |
|---|---|---|---|
| N1 | **P1 的真实首因还有 `auth.ts:288-300`**：`!JWT_SECRET && DEV_MODE==='true'` → 自动 admin；而 `vitest.config.ts:59 DEV_MODE:'true'` | `sed -n '283,300p'` + `grep -n DEV_MODE vitest.config.ts` → `59: DEV_MODE: 'true'` | P1 夹具必须自控 env，否则测的不是被测目标；变异体若只改 `rbac.ts:119` 会**指错位置** |
| N2 | **`req.rbac` 全仓库零消费者** | `grep -rn "\.rbac\b" src/ \| grep -v middleware/rbac.ts` → 0 命中，exit 1 | P4 单独前移 = 纯顺序变更、零安全增益；P4 必须与 P3 成对验收 |
| N3 | **`rbacMiddleware` 结构性无拒绝路径** | `rbac.ts:258-261`：`_res` 未使用 + 仅 `next()`；全文件中无 `res.status(` | P5 三态需在此新建 |
| N4 | **`canModifyWorkspace` 生产调用点 = 0** | `grep -rn canModifyWorkspace src/` → rbac.ts:243 定义 / server.ts:19 import / server.ts:249 void | P3 是"从零接线"，不是修 bug |
| N5 | **P0 功能连带**：`JwtPayload` 无 `department` 字段 | `auth.ts:26-33`（sub/role/orgId/iat/exp/jti）；rbac.ts:104-105 / 236-237 依赖 department | 删自报后 JWT 用户部门级可见性**恒 deny** → 需裁定（§7 R5） |
| N6 | **第三处漏斗旁路（grep 抓不到）** | `knowledge-ask.ts:43-48` 手工 `conditions: [access_level=public/team]`（非 `[]`）；`:55 catch { }` 空 catch 无 log/degraded | 违反铁律 24/31；该文件不在写集 → 另立卡 |
| N7 | **`department-workspace.ts` 自述不可修改却在写集** | 文件头 5-6 行 `@deprecated … 不修改此文件`；`server.ts:374` 仍挂载 | 需 CTO 明示（§7 R6） |
| N8 | 行号漂移已复现 | `auth.ts:82` 注释写 `server.ts:315`，实测 jwt 挂载于 `server.ts:345` | 实施阶段所有 `path:line` 当场复核 |
| N9 | P3 夹具契约缺口 | `documents.ts:82/:108` handler 非 async（漏斗是 Promise）；`documents.ts` 头部无 request-context import | 改动面大于 F8 字面描述 |

---

## §6 可复制验收命令（每条判据 1 条 + 期望输出）

运行环境：`& 'C:\Program Files\Git\bin\bash.exe' -lc "<script>"`（本机默认 pwsh 不可用），`cd .synova-wt-d947-middleware`。

| 判据 | 命令 | 期望输出 |
|---|---|---|
| **P0** | `grep -rn "x-synova-token" src/ --include=*.ts \| grep -v "^src/middleware/auth.ts:37[8]\|394"` → 另配夹具 `npx vitest run tests/middleware/rbac-default-deny.test.ts -t "self-report"` | grep：**0 处**自报读取；vitest：PASS，且**变异体**（恢复 `rbac.ts:110`）→ FAIL |
| **P1** | `npx vitest run tests/middleware/rbac-default-deny.test.ts -t "no credential"` + `grep -c "role: 'admin'" src/middleware/rbac.ts` | vitest PASS（含"无凭据→非 admin"与"白名单→显式匿名"）；grep = **0**；变异体（兜底改回 admin）→ FAIL |
| **P2** | `grep -rn "conditions: \[\]" src/ --include=*.ts \| wc -l`（不含 tests/）+ `npx vitest run tests/middleware/permission-filter.test.ts` | **0**（须先解决 §7 R1）；vitest PASS；变异体（`auth.ts:355` 改回恒空）→ FAIL |
| **P3** | `npx vitest run tests/routes/workspace-access-write-endpoint.test.ts` | ga/跨部门/staff 写请求 403，本部门 manager/admin 200；变异体（删守卫）→ FAIL |
| **P4** | `L=$(grep -n "app.use(rbacMiddleware)" src/server.ts \| cut -d: -f1); awk -v L=$L 'NR<L && /app\.(use\|get\|post\|put\|patch\|delete)\(/ {print NR": "$0}' src/server.ts` + `npx vitest run tests/routes/middleware-order.test.ts` | 前移后剩余挂载 = **豁免集（按 §7 R2 选定 A=5 / B=3）**；运行时探针：无凭据 `GET /api/workspaces/mine` → **403**；变异体（移回 373 之后）→ 双红 |
| **P5** | `npx vitest run tests/middleware/rbac-default-deny.test.ts -t "fail-closed"` + `grep -c "res.status(" src/middleware/rbac.ts` | PASS（三态机读可辨：被拒绝 / 不可用（系统异常）/ 出错）；grep ≥ **1**；变异体（"查不出来"→`next()`）→ FAIL |
| **P6** | `npx vitest run tests/routes/middleware-order.test.ts` | 两条断言绿 + 运行时探针绿；变异体（插回 `void` / 把业务 router 挂到 rbac 前）→ FAIL |
| **P7** | `grep -rn "admin::dev" src/ --include=*.ts \| wc -l; grep -rn "manager:'+DEPT" src/routes/department-workspace.ts \| wc -l` | **0** / **0**；变异体（恢复任一处）→ ≥1 红 |
| **P8** | 逐条跑上列"变异体"列 | 每个变异体必须**由对应夹具判红**，且红证不残留（`git status --porcelain` 事后为 0） |
| **门禁** | `bash scripts/pre-commit-check.sh` | 13 组通过，exit 0（基线同值，不得新增硬阻断） |
| **全量** | `npx vitest run`（**串行 ≤1，队列执行**） | 零失败（铁律 36） |
| 交付 | `git diff --stat` + `git -c http.sslBackend=openssl ls-remote --heads https://github.com/tangbaobao520/SynovaAgent.git refs/heads/*d947*` | diff 仅含 12（+裁定扩展）文件；远端分支存在（**依赖 push 凭据，见 §7 R7**） |

---

## §7 须 CTO 裁定（阻塞项，未裁定不得进实施）

| # | 议题 | 事实 | 选项 | 我的建议 |
|---|---|---|---|---|
| **R1** | **P2 判据不可达** | `conditions: []` 在 `src/` = 4 处，第 4 处 `src/services/request-context.ts:41` **不在写集**（派单 §一 与卡片 write_set 均未覆盖） | ① 扩写集 +1 文件（13 > 12 文件/PR 红线的**口径问题**：是否按治理产物不计入）② 把 P2 scope 收到 `src/middleware src/routes`（绕开真正的 fail-open 源）③ P2 判据改写为"漏斗两端（provider + 兜底）都不得恒空"并在写集内验证 | **①**（该行与 `auth.ts:355` 是同一漏斗的两端，只改一端等于没修）；若预算硬性 12 → 拆 PR |
| **R2** | **P4「12 → 0」不可达** | 唯一字面达成路径（rbac 置于 jwt 之前）破坏 I4 → P0 全量可穿 / P1 落地后全站锁死；I1/I2/I3 均由注释 D716/D575/D590② + 测试锁定 | A：rbac 移至 **366 之前**（前移后余 323/341/344/348/356 = **5 组**，全部为已文档化豁免；登录不进 rbac）B：rbac 移至 **346**（余 **3 组**，但 authRoutes 落 rbac 之后 → 需 rbac 第二份白名单，破坏"唯一白名单源"不变量） | **A**：判据重述为「该行之前只允许豁免集 {323,341,344,348,356}」，并要求 P4 与运行时探针成对 |
| **R3** | **P3 跨写集** | 判据 P3 派给编码 B，但其真实落点是 `workspaces-api.ts`（**code-c 写集**），`void` 位在 `server.ts:248-249`（code-b）；新建夹具 `tests/routes/workspace-access-write-endpoint.test.ts` 在 code-c | ① 判据整条归 code-c（B 只负责 server.ts 删块，计入 P7）② 硬拆成 B/C 两半 | **①**：判据不可分（守卫在路由层、夹具同域），按判据归属划分更诚实 |
| **R4** | **回归面超出 12 文件预算** | P0/P1 会打红 **4 个不在派单 12 文件清单内**的存量测试文件（department-workspace/ga-auth/diagnosis-report-persistence/overflow），共 7 处 legacy 头期望 | ① 扩写集到 16 文件（超 PR ≤12）② 拆 PR：PR-1 = middleware+server（A/B），PR-2 = routes+回归测试（C）③ 只改到"不红"的最小面 | **②**：拆 PR，既不开口子也不留无人有权改的红腿；卡片 write_set 与派单 §一 的口径差须由 CTO 明确 |
| **R5** | **P0 功能连带：部门可见性恒 deny** | `JwtPayload`（auth.ts:26-33）无 `department`；删自报后 JWT 用户 `department=undefined` → `canAccessWorkspace` 部门分支恒 false | ① 接受 deny（fail-closed 正确但功能退化）+ 另立卡 ② 扩 `JwtPayload` 增 department ③ orgId↦department 映射 | **①**（本单是安全姿态卡，扩 JwtPayload 属 Mac 域登录链，另立卡；须在实施前登记为已知功能退化） |
| **R6** | **`department-workspace.ts` 自述"不修改此文件"** | 文件头 5-6 行 `@deprecated … 不修改此文件`，但 `server.ts:374` 仍挂载且在写集内 | ① 按写集改（删自报）② 移出写集 + 另立卡（改为下线该路由） | **② 的变体**：本单**只删自报头**（安全必需），不顺手下线路由；行内注明"仅安全删改，功能下线另立卡" |
| **R7** | **push 无凭据** | SSH `Permission denied (publickey)`；卡片 blocked ③ 已登记 | 创始人配置 token | 保持本地留存；交付回执附 `ls-remote` 只读证据，push 待凭据 |
| **R8** | **纪律口径冲突（登记）** | `squad-discipline` 第 16 条「成员 ≤4」+ 队长 persona「不组第 5 人」vs 派单 §三 要求 6 人 | — | 本单按派单（创始人 2026-09-24 指示）执行 6 人编制；纪律条款同步另走 PR + K3（派单 §六 遗留 1） |

---

## §8 遗留清单（诚实登记，不得写成"已完成"）

1. `src/services/request-context.ts:41` fail-open 兜底（P2 依赖但无写集）— R1。
2. `src/routes/knowledge-ask.ts:43-48` 第三处漏斗旁路 + `:55 catch { }` 空 catch 无 log/degraded（违反铁律 24/31）→ 另立卡。
3. `src/routes/documents.ts:100-103 catch` 返回 `{ok:true,documents:[]}` 无 degraded 标记 → 改走漏斗时一并修。
4. 4 个存量测试文件因 P0/P1 必红但不在 12 文件清单 — R4。
5. `electron-renderer` dev-seed 旁路将失效（Mac 域，派单 §六 遗留 2）。
6. 「提交那一刻就拦」的 pre-commit 门禁脚本未建（Mac 域，派单 §六 遗留 3）——本单交付的是**测试层必红**（pre-push/CI 生效）。
7. P0 部门级可见性退化（JwtPayload 无 department）— R5。
8. 派单件未落 `origin/main`（本地优先例外）；落 main 后须复核指纹。
9. 成员 session 无 shell ⇒ 本 PLAN 中"成员取证"部分**无行为级红证**，行为级证据留待实施阶段由队长/有执行面的成员在 worktree 内补跑（串行 ≤1）。

---

**执行方状态**：`自验结论 = 可提请独立复核（PLAN 层面）`；**实施未启动**（零代码写入）；**不判"通过"** —— 放行与否归 CTO 收件闸 + K3。
