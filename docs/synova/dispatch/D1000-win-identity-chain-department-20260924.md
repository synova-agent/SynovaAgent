# D1000 派单件 — 身份链补全：部门可见性恢复（服务端签发/接收 + 桌面端身份通道切换）

> 出件：Win-Codex-CTO ｜ 2026-09-24 ｜ 状态：**PLAN 已复核，切片 A 放行实施；切片 B hold**
> 号段：**Win 段 `D1000–D1099`**（Mac-CTO 2026-09-25 授予）。本件 = **D1000**
> 归属基线：`docs/synova/coordination/ownership.yaml`（现行表，机器可读唯一源）
> 依赖前置：**D947 必须先合 main**（本件切片 A 的 base = D947 分支 tip）
> 派单即规格。凡本件与任何旧基线冲突，**以本件 + ownership.yaml + 下方改号说明为准**。

---

## 〇之二、改号与字段说明（Mac-CTO 2026-09-25 裁定，效力优先于本文其余处）

**一、改号留痕**

| 旧号 | 新号 | 说明 |
|---|---|---|
| **D948** | **D1000** | 本件。原因：与 Mac 侧 D948（队列看板每日自动化）撞号 |
| D949 | **D1001** | 表缺口收口（渲染层测试归属改判 mac）。与 Mac 侧 D949（N8 卡）撞号 |
| D950 | **D1002** | 工作区路由遮蔽修复（W2/F-1）+ E-2。与 Mac 侧 D950（116 卡归一）撞号 |

> **本件正文内所有 `D948` 引用一律按 `D1000` 读；`D949` 按 `D1001` 读；`D950` 按 `D1002` 读。** 旧号不得再用于本方任何新产物。
> **D947 为历史保留号**（Mac-CTO 2026-09-25 §二 书面特批）：K3 报告、代码内 `// D947:` 锚点、PR #754/#755 命名均保留 D947，**不视为不一致**。

**二、卡片字段规范（同裁定 §四，机器语义）**

- `domain` = 单值枚举的真实域，只能取 `mac` / `win` / `k3`，**禁自然语言**
- 新增 `owner_side` = 执行侧（`win` / `mac`）
- 跨域执行须 CTO 逐件特批，并在卡里写明 `cross_domain_reason`

**三、⚠️ 本件前置 P0 的范围变更（覆盖本文 §四）**

原 §四 把「改 `ownership.yaml`」当作本件切片 B 的前置，由 Win 小队执行。**该写法作废**：

- `docs/synova/coordination/ownership.yaml` 是 **Mac-CTO 单写者**，**Win 方不得直接改**；
- 该前置已独立成卡 **D1001**，其交付物改为「**改判建议 + 证据**」，由 Mac-CTO 执行改表；
- **D1001 的建议件被采纳并改表落地之前，本件切片 B 不得开工**（硬依赖不变）。

---

## 〇、取号与板面核对（原文口径，2026-09-24）

| 核对项 | 命令 | 结果 |
|---|---|---|
| task-state 占用 | `git ls-tree --name-only origin/main task-state/` | main 上最大为 **D942**；D943–D951 无卡 |
| 远端分支占用 | `git for-each-ref --format="%(refname:short)" refs/remotes/origin` | `origin/feat/d943-mechanism`、`origin/docs/d943-cto-a-items`（D943 = CTO 已占）；**无 d948** |
| 本地 worktree | `git worktree list` | 无 `d948` 命名；本件新建 `.synova-wt-d948-dispatch` |
| D947 是否已合 | `git merge-base --is-ancestor ef5c8caa origin/main` | `IN_MAIN=no` |

→ D948 无冲突，取用合法。

---

## 一、这张卡解决什么（客户现场视角）

某 800 人制造企业装了 Synova 桌面端，老板（admin）先开通。市场部总监（manager，部门 = marketing）登录后打开 **"部门工作区"**，应该看到**市场部**的目标、方案、数据；生产部总监看到**生产部**的；两个人互相看不到对方的——这是企业里最敏感也最刚性的诉求。

**D947 之后实际发生的是：**

| 环节 | 现状 | 为什么会这样（实测坐标） |
|---|---|---|
| 登录 | 能登录，拿到 JWT | `src/routes/auth.ts:134` 签发时只带 `sub/role/orgId` |
| 服务端认身份 | 认，但**不知道你是哪个部门的** | `JwtPayload` 无 `department` 字段；`rbac.ts` JWT 分支写死 `department: undefined` |
| 打开部门工作区 | **恒"无权限/空列表"** | 部门判据要求 `ctx.department` 与 `ws.department` 双方非空且相等 → `undefined` 必不命中 → fail-closed 拒绝 |
| 桌面端请求 | **连身份都没有**（HTTP 401） | 桌面端仍在发 `x-synova-token` 自报头，而 D947 已把它删掉（服务端忽略 + 留痕） |

**目标（用户可见行为，三环节）**

1. **入口**：用户在桌面端提供账号密码并登录（不再依赖任何"自报我是谁"的机制）。
2. **交互**：登录后打开部门工作区，前端用**验签后的** JWT 访问接口。
3. **结果**：看到**本部门**的工作区；换一个部门的账号登录，看到的是**另一个部门的**，两边互相看不到；admin 仍可全局。

**对整体的推动**：这是"多用户企业部署"的第一块地基。没有真实身份链，产品只能停在单机单用户；有了它，部门隔离、GA 客户切换、审计留痕才有承载体。同时它也是 D947 能不能真正上生产的前提——否则等于用"谁都进不来"换来了"谁都动不了"。

---

## 二、创始人三条决策 → 本卡落点（不得改写语义）

| # | 决策（2026-09-24） | 本卡怎么落 |
|---|---|---|
| 1 | 客户端自报身份**完全不允许** | 服务端不读自报头（D947 已完成）＋**客户端不再发**（切片 B）＋**签发端是唯一授权来源**（切片 A：只有登录/刷新端点能决定 `role`/`orgId`/`department`） |
| 2 | 安全判据**默认拒绝** | 无 `department` 的合法 JWT，访问部门工作区**依然 deny**（不得为了让功能"能用"而放宽 `isSameDepartment`，也不得给 admin 以外开旁路） |
| 3 | **提交时就该拦** | 判据必须能在提交前拦住"签发漏带 department"：夹具**直接解码 token payload 断言 `department`**，而不是断言 HTTP 200／断言响应体 |

---

## 三、实测现状（口径：`ref=feat/d947-middleware-default-posture @ ef5c8caa`，读于 2026-09-24）

| 坐标 | 实测事实 |
|---|---|
| `src/middleware/auth.ts:26-33` | `JwtPayload = { sub, role, orgId, iat, exp, jti }` —— **无 `department`** |
| `src/middleware/auth.ts:35-39` | `AuthRequestContext = { role, userId, orgId }` —— **无 `department`** |
| `src/middleware/auth.ts:146-148` | `signJwtToken(payload: Omit<JwtPayload,'iat'\|'jti'\|'exp'>)` —— 类型决定：`JwtPayload` 加字段即签发链自动带上 |
| `src/middleware/auth.ts:501-508` | 自报头分支已删；带头只 `log.warn(AUTH_REJECTED / self_reported_token_header_ignored)` 后 `return null` |
| `src/middleware/rbac.ts:104-105` | JWT 分支返回 `department: undefined` ← **断点本体** |
| `src/middleware/rbac.ts`（D947/L-32 `isSameDepartment`） | 双方均为**非空字符串**且相等才 true；任一缺失一律 false |
| `src/middleware/rbac.ts`（`canAccessWorkspace` 部门分支） | `isSameDepartment(ctx.department, ws.department) \|\| role === 'admin'` |
| `src/middleware/rbac.ts`（`canModifyWorkspace` manager 分支） | 同上，共用同一判据 |
| `src/routes/workspaces-api.ts`（`GET /api/workspaces/mine`，D947 后） | `dept = rbac.department`（恒 `undefined`）→ 非 admin 用户只见 `owner===自己` 或 global |
| `src/routes/auth.ts:97` / `:134` | register / login 均 `signJwtToken({ sub, role, orgId })` —— 无 `department` |
| `src/growth/user-store.ts` | `UserRecord` 有 `department` 字段（注册时由 `extra.department` 落库）→ **签发侧数据源已存在，不是零基础** |
| `electron-renderer/src/components/RightPanel.tsx:159` | `if (seedToken) baseHeaders['x-synova-token'] = seedToken;` |
| `electron-renderer/src/stores/ga-collab.ts:60` | `getSeedToken()` 组装 `ga:<orgId>:<userId>` 自报串 |
| `git grep -n Bearer -- electron-renderer` | **零命中** |
| `git grep -n login -- electron-renderer` | **零命中** → 桌面端**没有任何登录能力** |

**结论**：服务端缺"字段"，客户端缺"通道"。两半是同一条身份链的两端，必须同批收口（这正是把两者放进同一张卡的理由）。

---

## 四、⚠️ 前置 P0（表缺口，必须先裁）——影响切片 B

实测（`python scripts/control-tower/check-ownership.py`，2026-09-24）：

```
win  tests/electron/right-panel-report-sentinel.test.ts
win  tests/ga-collab-ui.test.ts
win  tests/ga-collab-logic.test.ts
mac  electron-renderer/src/lib/api.ts
❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域
```

`ownership.yaml` 里 `electron/**`、`electron-renderer/**` 明确判 mac，但**没有 `tests/electron/**` 规则** → 落 `**` 兜底判 win。而根 `vitest.config.ts` 的收集范围是 `include: ['./tests/**/*.test.ts', ...]`，**渲染层测试只能住在 `tests/` 下**。二者叠加 =

> **任何一次桌面端改动（源码 mac + 测试 win）在今天都必然被判「变更跨域」，D734 门禁硬阻断（本地软提示、CI strict 硬阻断）。这不是 D948 特有，是表缺口**（同族：D782 tests/doc-system、D806 tests/project、D914 三类文档）。历史原样：D538/D544 把 `electron-renderer/` + `tests/electron/` 写成同一个写集，在今天的门禁下过不去。

**处置（三条路，CTO 选一条，本卡按选中的执行）**

| 选项 | 内容 | 代价 |
|---|---|---|
| **P0-a（推荐）** | `ownership.yaml` 增一条 `tests/electron/** → mac`（依据「测试跟随被测模块」：被测主体 `electron/**`、`electron-renderer/**` 均 mac）→ 重跑 `--emit-codeowners`，`tests/control-tower/check-ownership.test.sh` 逐字节断言必须全绿 | 动 mac 域治理件，须 Mac-CTO 收件；`tests/electron/dual-guide-packaging-guard.test.ts`（D716 Win 建的）会随之改判 mac，需 CTO 一句裁定 |
| P0-b | 只把 `tests/electron/d948-*.test.ts` 登记进 `domain_neutral` 豁免 | 打补丁不治病，下次桌面改动照旧撞 |
| P0-c | 切片 B 的测试改放 `electron-renderer/src/**` 并扩 vitest include | 扩 include 要改根 `vitest.config.ts`（判 win）→ 变成新的跨域，更绕 |

**在 P0 裁定前：切片 B 不实施；切片 A（纯 win）不受影响，可立即开工。**

---

## 五、写集（两个切片，各自单域）

### 切片 A —— 服务端身份链（PR-1，单域 win）

| 文件 | 动作 | 写者 |
|---|---|---|
| `src/middleware/auth.ts` | 改：`JwtPayload` + `AuthRequestContext` 增 `department?: string`；验证/签发链透传 | code-a |
| `src/middleware/rbac.ts` | 改：JWT 分支 `department: req.auth.department`（删掉写死的 `undefined`） | code-a |
| `src/routes/auth.ts` | 改：login / register / refresh 三处签发带 `department`（来源 `UserStore` 记录） | code-a |
| `tests/middleware/auth.test.ts` | 改：签发/验签含 `department` | code-a |
| `tests/middleware/rbac.test.ts` | 改：`extractRbacContext` 返回真实部门；无部门仍 fail-closed | code-a |
| `tests/routes/auth.test.ts` | 改：登录响应 token 的 payload 含 `department`（**解码断言，不看 HTTP 码**） | code-a |
| `task-state/D948.json` | 本卡状态 | 队长 |

预算 7 文件 ≤ 12。**不含** `src/server.ts`、`src/routes/workspaces-api.ts`（后者已按 `rbac.department` 消费，无需改；若实做中发现确需改动，**先报 CTO 扩写集**）。

### 切片 B —— 桌面端身份通道（PR-2，单域 mac；受 P0 约束）

| 文件 | 动作 | 写者 |
|---|---|---|
| `electron-renderer/src/stores/auth-session.ts` | 新建：token 存取 / 登录调用 / 过期处理 / `degraded` 标记（契约 JSDoc 先行） | code-b |
| `electron-renderer/src/stores/ga-collab.ts` | 改：**删 `getSeedToken()` 与 `DevSeedIdentity`**，身份改由 auth-session 提供 | code-b |
| `electron-renderer/src/components/RightPanel.tsx` | 改：附 `Authorization: Bearer <token>`；无 token 不附任何身份 | code-b |
| `electron-renderer/src/components/LoginPanel.tsx` | 新建：最小登录入口（账号+密码+提交+错误呈现+登录态可见） | code-b |
| `electron-renderer/src/lib/api.ts` | 改（按需）：统一 `authHeaders()` 帮助函数，避免三处各写一遍 | code-b |
| `tests/electron/d948-*.test.ts`（P0-a 落地后随 mac 域） | 新建：上表每条判据的断言 | verifier 复跑 |

预算 ≤ 6 文件（含测试）。

**不做**：不改 `src/**`（切片 A 已覆盖）；不碰 `scripts/**`、`electron/**`（主进程）、`package.json`、`vitest.config.ts`；不碰 `scripts/audit/**`（K3 红线）。

---

## 六、完成标准（全部为可执行判据，非形容词）

### N1 夹具级硬前置（缺即判空转，不算通过）

每个涉身份夹具的 `beforeAll` 内先断言：

```ts
expect(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16).toBe(true);
expect(process.env.DEV_MODE).not.toBe('true');
```

`DEV_MODE=true` 会走 dev-admin 逃生口，判据静默失效——**这是"空转"而非"通过"**。

### 切片 A 判据

| # | 判据（可执行） | 反例（改坏即红，须给原始输出） |
|---|---|---|
| A1 | 登录返回的 token **解码后** `payload.department === 该用户记录的部门` | 把 `signJwtToken` 调用改回 `{sub, role, orgId}` → 必红 |
| A2 | `extractRbacContext({ auth: { sub, role:'manager', orgId, department:'marketing' } }).department === 'marketing'` | 把该行改回 `department: undefined` → 必红 |
| A3 | 同部门 manager 的 JWT 访问 `GET /api/workspaces/mine` → 结果含本部门工作区 | 同 A2 反例 → 必红 |
| A4 | **异部门** manager 的 JWT 访问同一端点 → **不含**该部门工作区（隔离不回退） | 把 `isSameDepartment` 改成 `ctxDept === wsDept`（去掉非空检查）→ 必红 |
| A5 | 默认拒绝不回退：合法 JWT 但**无** `department` + `visibility:'department'` 工作区 → `canAccessWorkspace === false` 且 `canModifyWorkspace === false` | 在部门分支加 `|| role === 'manager'` 旁路 → 必红 |
| A6 | 自报头零复活：请求带 `x-synova-token: admin:marketing:u1` 且无 Bearer → 角色**不等于** `admin`（且留痕 `log.warn`） | 恢复任一自报分支 → 必红 |
| A7 | `refresh` 端点签发的新 token 仍带原 `department`（不得刷新即丢部门） | 把 refresh 的 payload 改回三字段 → 必红 |

### 切片 B 判据

| # | 判据（可执行） | 反例 |
|---|---|---|
| B1 | `grep -rn "x-synova-token" electron-renderer/src` → **0 命中** | 恢复附头一行 → 必红 |
| B2 | 有 token 时请求头含 `Authorization: Bearer <jwt>`（桩 fetch 断言实收头） | 改发 `x-synova-token` → 必红 |
| B3 | **无** token 时：不附任何身份头 + UI 呈现"需要登录"（不得静默降级、不得伪造身份） | 无 token 时回退 dev/seed 身份 → 必红 |
| B4 | 登录成功后 token 落存储，后续请求自动带 Bearer（用桩服务端夹具走通） | 登录成功但不落存储 → 必红 |

### 三路径夹具（每条修复都要三路径）

正常（有验签身份 + 有部门 → 放行）/ 降级（`JWT_SECRET` 不可用或用户记录无 `department` → `log.warn` + `degraded:true`，前端显性呈现）/ 边界（空串部门、`undefined` 部门、部门大小写或空白差异 → 一律 fail-closed，不得命中）。

---

## 七、执行形态（硬字段，缺一不派）

| 字段 | 要求 |
|---|---|
| 组队 | **必须用 Agent Teams**（预设已挂：`agent-team` / `tool-agent-team` / `ui-agent-team`） |
| 编制 | 队长（**不下场写码**）+ 编码 code-a（切片 A）+ 编码 code-b（切片 B）+ 1 独立自验 + 1 独立复核 |
| 共享任务 | 每成员一份：写集 + 验收命令 + 写者；**写集两两不重叠**；`src/routes/auth.ts` 单写者 |
| 串行 | 两个切片**串行**（A 合了再开 B）；重型验证（vitest / 全量门禁 / 黄金门禁）**串行 ≤1** |
| 工作目录 | 钉死各自 worktree，禁止任何指向仓库外的路径参数 |
| 禁项 | 禁 `rm -rf` / 递归删除（清理由 `git worktree remove` / `git checkout -- <file>`）；临时产物只落 `/tmp` |
| 自验 | 自验不得由编码兼任；**每条修复各带 1 个"改坏即红"变异体反例**，自验须给原始输出 |
| 回执 | 必须含**团队成员运行记录**（成员名 · 运行状态 · token · 共享任务 id 与状态）。**只有队长在跑、成员未运行 = 交付退回**（M3 型「机制建成未接线」） |

### 第 0 阶段：先做 PLAN，停 CTO 复核

开工第一件事不是写码，是交 **PLAN**（含：逐判据的实现落点、夹具设计、两条 PR 的 base 与顺序、P0 选项取舍的影响面、未清项预登记）。**PLAN 未经 CTO 复核放行，不得开始写产品代码。**

### 分支与 base

| 切片 | 分支 | base |
|---|---|---|
| A | `feat/d948-identity-chain-server` | **`feat/d947-middleware-default-posture` tip `ef5c8caa`**（栈式：D947 未合 main） |
| B | `feat/d948-identity-chain-desktop` | 切片 A 合后 main（若 A 走栈式合并，则 base = A 的链尾） |

---

## 八、回执格式（缺项视为未完成）

1. 逐判据：`file:line` + 改前/改后 + **反例夹具原始输出**（A1–A7 / B1–B4）
2. 三路径夹具输出（正常 / 降级 / 边界）
3. 团队成员运行记录（成员名 · 运行状态 · token · 共享任务 id 与状态）
4. `git diff --stat` + `ls-remote` 回执
5. **未清项清单**（诚实登记，不许写成"已完成"；含 P0 裁定结果、桌面端登录入口的最小范围声明）
6. 派单件指纹对账（三条 fetch 坐标三方值）
7. 功能回退/新增回退的显式登记（如属回退，**必须写"功能回退"，不得写"已知限制"**）

---

## 九、红线

- 禁 `--no-verify` / `git stash` / force push 共享分支
- 跨机提交走 PR，保留 `Synova-Win` 身份，不匿名
- 计数与引用必须带「命令 + 口径 + 截至时刻」；执行方**不判"通过"**，只给自验结论 / 可提请独立审计 / 退回
- 不碰 `scripts/audit/**`（K3 红线）、不碰 `scripts/**`
- 单 PR 单域：切片 A 只许动 win 文件，切片 B 只许动 mac 文件（P0 裁定前 B 不开工）

---

## 十、退回规则

退回只退本切片；切片 A 退回不影响切片 B 的 PLAN 编写，但 **B 不得在 A 通过前开工**。独立复核未通过 = 未完成，不得进 CTO 收件闸。

---

## 十一、未清项预登记（出件时已知）

| # | 项 | 处置 |
|---|---|---|
| 1 | **P0 表缺口**（`tests/electron/**` 判 win vs 被测 mac） | 待 CTO 在 P0-a/b/c 中裁定；本件推荐 P0-a |
| 2 | 桌面端**完整**注册/邀请/找回流程 | 不在本卡；本卡只要**最小登录入口**能走通。若创始人要求完整登录产品化，另立卡 |
| 3 | D947 REV-8 措辞错标（写成「Mac 域登录链」，实际 `JwtPayload`/`rbac`/`routes/auth` 全判 win） | 已在 K3 往返答复中作更正登记；本件即为该错标的实体纠正 |
| 4 | `src/routes/department-workspace.ts` 部门来源仍为常量 `'dept'`（D947 R6 功能下线） | 另立卡，**不在本件** |
| 5 | D947 自身未合 main | D948 切片 A 以栈式 base 规避，不阻塞 PLAN |
