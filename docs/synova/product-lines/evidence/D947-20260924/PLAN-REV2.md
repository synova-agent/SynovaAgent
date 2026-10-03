# D947 PLAN REV2 —— CTO GO 后按裁定修正

> 本件是 `PLAN.md`（第 0 阶段原版）的**修正件**。凡本件涉及的条目**以本件为准**；未涉及条目原版继续有效。
> 放行：**CTO 2026-09-24 GO**（"通过（经裁定修正）" + R4 清单 + 权限前置解 + 护栏批准）。
> 本件仍**不含任何产品代码改动**。

---

## REV-0 放行记录与裁定生效表

| 项 | CTO 裁定 | 生效形态 |
|---|---|---|
| **R1** | 扩写集 +1：`src/services/request-context.ts` | 写集总数 **17 文件**（见 REV-2）；该文件与 `auth.ts:355` 是同一漏斗两端，**同批改** |
| **R2** | 采纳方案 A；**禁止**给 rbac 第二份白名单；P4 改为「该行之前仅允许 {323,341,344,348,356}」+ **源码断言与运行时探针成对**；**P3 与 P4 成对验收** | REV-3 / REV-6 重写 |
| **R3** | 整条 P3 归 code-c | 责任表重排（REV-2） |
| **R4** | 拆两张 PR（PR-2 base = PR-1 合后 main），切割规则「**谁先把它打红，它就归谁**」，移动后各自 ≤12 | REV-2 |
| **R5** | 接受 deny + 另立卡；回执登记为**功能回退** | REV-8 |
| **R6** | 只删自报头 + 行内注明；功能下线另立卡 | code-c 实施说明 |
| **R7** | 本地留存 + 只读 `ls-remote` 证据 | 回执第 4 项 |
| **R8** | 按派单执行 + 回执注明纪律口径冲突 | 回执 |
| **N1** | 夹具强制前置（自设 `JWT_SECRET`≥16 + `DEV_MODE='false'`）**升为硬前置；缺即判空转、不算通过** | REV-3：升为夹具级 `expect` 断言（先于用例断言） |
| 护栏补充 | 切 full access 后**禁止任何指向仓库外目录的写操作**；证据只落 `docs/synova/product-lines/evidence/D947-20260924/` | 实施共享任务正文 |

**N1–N9**：CTO 全部采纳（P4「12→0」与 P2 写集两条根因已记 CT 账）。

---

## REV-2 逐文件写集（取代原 §2 与 §2.1）

### 2.1 两张 PR（零重叠）

**PR-1「中间件层」= 6 文件**（写者 code-a）
`src/middleware/rbac.ts`｜`src/middleware/auth.ts`｜`tests/middleware/rbac.test.ts`｜`tests/middleware/auth.test.ts`｜`tests/middleware/rbac-default-deny.test.ts`(新建)｜`tests/middleware/permission-filter.test.ts`(新建)

**PR-2「装配层 + 路由层 + 漏斗」= 11 文件**（写者 code-b / code-c，`src/server.ts` 单写者 = code-b）

| # | 文件 | 写者 | 覆盖 |
|---|---|---|---|
| 1 | `src/server.ts`（**单写者**） | code-b | P4 · P6 · P7(装配侧) |
| 2 | `tests/routes/middleware-order.test.ts`（新建） | code-b | P4 · P6 |
| 3 | `src/routes/workspaces-api.ts` | code-c | P0(路由侧) · **P3（整条）** · P7 |
| 4 | `tests/routes/workspace-access-write-endpoint.test.ts`（新建） | code-c | **P3（整条）** |
| 5 | `src/routes/department-workspace.ts` | code-c | P0 · P7 |
| 6 | `src/routes/documents.ts` | code-c | P2(收口) |
| 7 | `src/services/request-context.ts` | code-c | P2(漏斗兜底) |
| 8 | `tests/routes/department-workspace.test.ts` | code-c | P0 回归 |
| 9 | `tests/routes/ga-auth.test.ts` | code-c | P0 回归 |
| 10 | `tests/routes/diagnosis-report-persistence.test.ts` | code-c | P0 回归 |
| 11 | `tests/routes/overflow.test.ts` | code-c | P0 回归 |

### 2.2 清单算术差异（**已由 CTO 补充裁定关闭**）

过程登记：CTO 首份裁定正文写「总盘子 16 文件」，枚举清单实际为 **17 行**（PR-1 = 6 + PR-2 = 11）。
执行方处理：**按枚举清单执行**（枚举比概数具体），登记差异、**不自裁总盘子口径**。
**CTO 补充裁定（2026-09-24）**：「以 **17** 为准（PR-1=6 / PR-2=11），按枚举清单执行；『总盘子 16』为 CTO 口误，已登记 CTO 错，**口径不变、不剔行**。」
⇒ **口径冻结：17 文件**。PR-1 = 6 ≤ 12 ✅｜PR-2 = 11 ≤ 12 ✅。

### 2.3 顺序与 base 声明

1. **PR-1 先合**；PR-2 的 `base` 必须**声明为 PR-1 合并后的 main**（回执第 4 项附 base 证据）。
2. 两张**零重叠**（已逐文件校验：无文件同时出现在两表）⇒ 按 CTO 裁定**不强制栈式**。
3. 切割偏差自裁规则：「**谁先把它打红，它就归谁**」；移动后两张仍须 ≤12。

### 2.4 写集缺口 → 已闭合

原 §2.1 登记的 5 个缺口（`request-context.ts:41` + 4 个存量测试文件）**全部按 R1/R4 纳入**。原 §2.1 作废。
实测依据保留：`grep -rn "x-synova-token" tests/ | cut -d: -f1 | sort | uniq -c` = 7+3+1+2+3+1（共 17 处 / 6 文件）。

---

## REV-3 三路径 + 变异体（修订原 §3 的下列三处）

### 3.1 N1 升为**硬前置**（缺即判空转、不算通过）

每个 vitest 夹具文件在**用例之前**先跑环境断言（不许只在文档里写要求）：

```ts
beforeAll(() => {
  process.env.JWT_SECRET = 'd947-test-secret-0123456789';   // ≥16，auth.ts:52 先于 :54 生效
  process.env.DEV_MODE = 'false';
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(16);
  expect(process.env.DEV_MODE).toBe('false');
});
```
**判据**：若 env 前置不成立，用例**必须不进入断言体**（`beforeAll` 抛错即视为**无效判据**，回执中标"空转、不算通过"）。
**理由（实测）**：`vitest.config.ts:59 DEV_MODE:'true'` + 无 JWT_SECRET ⇒ `auth.ts:288-300` 自动 admin ⇒ 任何 P0/P1 用例空转。

### 3.2 P4 判据重述（R2）

| 位（方案 A） | rbac 行移至 **366 之前**（`rateLimitMiddleware`@353 之后） |
|---|---|
| 前移后允许在前 | **豁免集 = {323 setupGuideGoneRouter, 341 llmConfigRoutes, 344 uploadV2GoneRouter, 348 authRoutes, 356 内联 GET /api/status/budget}**（12 → **5**，全部为已文档化豁免：D716 / D575 / D590② / 登录入口 / 白名单 `/api/status`） |
| 硬禁止 | **不得**为 rbac 新增第二份白名单（保住 `auth.ts:82`「唯一源」不变量）；**不得**让 rbac 早于 `jwtAuthMiddleware`(345)（I4） |
| 判据形态 | 源码顺序断言（豁免集固定）**＋运行时探针**：无凭据打 `GET /api/workspaces/mine` → **403**，两者**成对**（禁 grep 型静态判据当验收） |
| 豁免路径回归 | 前移后仍须直达（非 401/403）：`/health`、`POST /api/auth/login`、`GET /api/status/budget`、`GET /api/knowledge/ask` |
| 变异体 | 把 `app.use(rbacMiddleware)` 移回 373 之后 → 源码断言 + 运行时探针**双红** |

### 3.3 P3 与 P4 **成对验收**（R2）

- P3 不再是独立判据：**P4 绿而 P3 未接线 = 判为未完成**（`req.rbac` 零消费者，前移本身是行为空操作 —— 实测 N2）。
- P3 整条归 **code-c**（R3）：守卫落在 `workspaces-api.ts` 写端点（`:55 POST`、`:77 PUT :id/status`、`:106 POST :id/messages`、`:144 POST :id/sub`、`:221 PUT :id/merge`），夹具 `tests/routes/workspace-access-write-endpoint.test.ts`。
- 成对口径：**同一次独立自验/复核轮次内**同时给出 P3 与 P4 的红→绿对照，缺一即退回。

### 3.4 P2 scope 更新（R1）

`grep -rn "conditions: \[\]" src/ --include=*.ts | wc -l` = **0**，覆盖三处实现位：`auth.ts:355`（A）· `documents.ts:85/:112`（C）· **`services/request-context.ts:41`（C，R1 新增）**。仍**排除 `tests/`**（自建反例夹具必须含空条件，派单 §八豁免）。

---

## REV-6 验收命令（修订原 §6 的 P2/P3/P4 三行）

| 判据 | 命令（在 `.synova-wt-d947-middleware` 内） | 期望 |
|---|---|---|
| **P2** | `grep -rn "conditions: \[\]" src/ --include=*.ts \| wc -l` + `npx vitest run tests/middleware/permission-filter.test.ts` | **0**；PASS；变异体（`auth.ts:355`/`request-context.ts:41` 任一改回恒空）→ FAIL |
| **P3+P4（成对）** | ① `L=$(grep -n "app.use(rbacMiddleware)" src/server.ts \| cut -d: -f1); awk -v L=$L 'NR<L && /app\.(use\|get\|post\|put\|patch\|delete)\(/ {print NR": "$0}' src/server.ts` ② `npx vitest run tests/routes/middleware-order.test.ts` ③ `npx vitest run tests/routes/workspace-access-write-endpoint.test.ts` | ① 前移后仅剩**豁免集 5 行**（323/341/344/348/356）② 源码断言 + 无凭据 `/api/workspaces/mine` → **403** ③ ga/跨部门/staff 写 → 403、本部门 → 200；三者在同一轮次内全绿，任一未接线即退回 |
| **P6** | `npx vitest run tests/routes/middleware-order.test.ts` | 断言①路由晚于中间件（豁免集固定）②零 `void` + 运行时探针；变异体（插回 `void`）→ FAIL |
| **PR** | ① PR-1：`git diff --stat`（6 文件）② PR-2：`git diff --stat`（11 文件）+ `base=PR-1 合后 main` 证据 | 各自 ≤12；零重叠（逐文件比对） |

其余判据（P0/P1/P5/P7/P8/门禁/全量）命令**不变**，原 §6 继续有效。

---

## REV-7 原 §7 阻塞项已全部关闭

R1 ✅ 扩写集 +1｜R2 ✅ 方案 A + 禁第二份白名单 + P4 重述 + P3/P4 成对｜R3 ✅ 整条归 code-c｜R4 ✅ 两张 PR（金额差异见 REV-2.2）｜R5 ✅ 接受 deny + 另立卡 + 回执登记功能回退｜R6 ✅ 只删自报头 + 行内注明｜R7 ✅ 本地留存 + 只读 `ls-remote`｜R8 ✅ 按派单执行 + 回执注明。**无遗留裁定项。**

**唯二未清**（CTO 已列）：① 派单件落 `origin/main`（等创始人加 Deploy Key 公钥）② R5 功能回退须在回执登记（本件 REV-8 已先登记）。

---

## REV-8 功能回退登记（R5，回执必带）

> **功能回退**：P0 删除客户端自报身份后，**JWT 用户的工作区部门级可见性恒为 deny**。

- 机制（实测）：`JwtPayload`（`src/middleware/auth.ts:26-33`）字段仅 `sub/role/orgId/iat/exp/jti`，**无 `department`**；`rbac.ts:104-105` JWT 分支返回 `department: undefined`；`rbac.ts:236-237` 的部门分支与 `workspaces-api.ts:186-188` 的 `w.department === dept` 因此**对 JWT 用户恒 false**。
- 判定：**fail-closed 正确**，但**功能回退**（此前由自报头 `parts[1]` 提供部门）。
- 处置：另立卡（扩 `JwtPayload` 增 `department` 属 **Mac 域登录链**）；本卡不修。
- **不得**在回执中写成"已知限制"或"已完成"。

---

## REV-9 执行状态（截至本件）

| 步骤 | 状态 |
|---|---|
| 1) 更新 PLAN（本件） | ✅ 完成 |
| 2) 重建小队（成员权限 spawn 时固定，不继承） | ⛔ **hold** |
| 3) PR-1 实施 → 自验 → 复核 → 4) PR-2 | ⛔ **hold** |
| 5) 回执七项 | ⛔ hold |

**hold 原因（实测证据，非推测）**：本会话权限**尚未切换**——默认策略下 `pwsh` 仍 `(no output)` + `[exit code: 3221225794]`（0xC0000142）。CTO 指定的宿主侧动作 `/permission danger-full-access` 未生效前，重建的小队成员会再次落到"无 shell、无提权通道"，实施必然退化为队长单干 ⇒ 会被退回。
**release 条件**：`/permission danger-full-access` 生效后，队长用同一条探针复测通过（`echo PERMISSION_PROBE` 正常输出、exit 0），即重建小队并进入 PR-1。

**护栏（CTO 批准，实施任务正文照抄）**：工作目录钉死 `.synova-wt-d947-middleware`｜**禁 `rm -rf` / 递归删除**（清理由 `git worktree remove` / `git checkout -- <file>` 完成）｜临时产物只落 `/tmp`｜**切 full access 后禁止任何指向仓库外目录的写操作**｜证据只落 `docs/synova/product-lines/evidence/D947-20260924/`｜写集互斥 + `src/server.ts` 单写者｜重型验证（vitest / 全量门禁）**串行 ≤1**｜实施任务另开新 id（`task-1`–`task-5` 保持 completed 不动）。
