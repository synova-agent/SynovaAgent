# D947 队长裁定集（RULINGS）— 冻结单一事实源

> 签发：D947 队长（synova-squad-lead）｜2026-09-24
> 性质：**治理产物**（不计入 PR 预算）。凡本件与派单原文/PLAN-REV2 字面不一致处，**以 CTO 裁定 R1–R8 为上位**；本件只在 CTO 未覆盖的空隙里做技术裁定（squad-discipline §9：技术决策队长自决）。
> 依据的实测证据：`D947-code-b-recon.md`（780 行）· `D947-code-c-recon.md`（892 行）· 队长前提冻结实测（F1–F8 + P2/P3/P4 基线）。

---

## L-1 P4 判别谓词冻结（取代 REV-6 命令① 的字面版）

```
PAT='app\.use\([A-Za-z0-9_]+(Router|Routes)\)|app\.(get|post|put|patch|delete)\('
grep -nE "$PAT" src/server.ts | grep -v 'res.redirect' | awk -F: -v L="$(grep -n 'app.use(rbacMiddleware)' src/server.ts | cut -d: -f1)" '$1<L {print $1": "$0}'
```
- 队长实测：**前移前 = 12**（= 11 个 Router/Routes 挂载 + 内联 `GET /api/status/budget`）；**前移后 = 5**（豁免集 `{setupGradeGoneRouter→setupGuideGoneRouter, llmConfigRoutes, uploadV2GoneRouter, authRoutes, /api/status/budget}`）。
- **`[A-Za-z]` 型正则会漏掉 `uploadV2GoneRouter`（含数字 `2`）→ 基线误得 11**。必须用 `[A-Za-z0-9_]`。
- REV-6 命令① 字面版（不带谓词）会把 `cors()` / `express.json()` / `express.static` / `res.redirect` 一并计入 → 不能当「仅剩 5 行」的判据。**登记为 CTO 侧口径修正项（F-5）**，不在本卡改 CTO 文本。

## L-2 rbac 插入位置（F-2）

`app.use(rbacMiddleware)` 必须落在 **L ∈ [357, 366]**：即内联 `app.get('/api/status/budget', …)` 块（355–365）**之后**、`app.use(homeRoutes)`（原 366）**之前**。
- `L ≤ 356` → 谓词点数变 4 且拦死 `/api/status/budget`（违反 REV-6 豁免路径回归）→ 退。
- `L ≥ 367` → `homeRoutes` 落到 rbac 之前（点数变 6 且语义变化）→ 退。
- 实施后**必须实测**报出 `L` 的实际值（区间断言 + 谓词点数 5 双证）。

## L-3 PR-2a 写集边界（F-3）

PR-2a = **① 顺序前移 + ② 删 `server.ts:247-249`（硬编码 `'admin::dev'` + 两处 `void`）+ ③ 收窄 `server.ts:19` import 为仅 `rbacMiddleware`**。
- **不得改 `rbacMiddleware` 语义**（保持「仅注入 `req.rbac` + next()」）。理由（F-3 实测）：REV-6「前移后仍须直达」清单含 `/health`(@378) 与 `GET /api/knowledge/ask`(@372)，二者都在 rbac 之后 —— 只有 rbac 不拦截时该清单才成立。
- **拦截责任在 P3 路由级守卫**（code-c），不在 rbacMiddleware。
- **不得**为 rbac 新增第二份白名单（R2 硬禁止，保住 `auth.ts:82`「唯一源」不变量）。
- `server.ts:244-245`（`buildInheritedContext` / `detectConflicts`）**不动**——它们不属 P7 的「自欺」射程。

## L-4 P3 取数路径 = 读 `req.rbac`（D-3，阻塞项裁定）

- 取 **(b) 读 `req.rbac`**，**不**照抄 `workspaces-api.ts:131` 的 `extractRbacContext(req)` 重算。
- 依据（R2/REV-3.3 原话）：「P4 绿而 P3 未接线 = 判为未完成（`req.rbac` 零消费者，前移本身是行为空操作）」。若 P3 重算，则 P3 与 P4 **无耦合**，前移永远是空操作，成对验收退化为形式。
- 实测支撑（code-b D-6）：`grep -rn 'req\.rbac' src/ tests/` → **共 0 处**。
- **缺 `req.rbac` 时必须 fail-closed（403）**，不得静默放行（P5：安全判据一律 fail-closed）。

## L-5 P4 运行时探针的「判别性」要求（关键裁定）

- 「无凭据打 `GET /api/workspaces/mine` → 403」保留，但其性质是**回归守卫**——它对「中间件是否前移」**不敏感**，**不得**单独充当 P4 的运行时证据。
- P4 的**判别性**运行时探针必须是**正路径**：合法身份（凭据齐备、满足 `canAccess*` 真值表的 `owner === userId`）访问依赖 `req.rbac` 的路由 → **200**。
  - 变异体：把 `app.use(rbacMiddleware)` 移回 :373 之后 → 该正路径因 `req.rbac` 缺失而 fail-closed → **403 ⇒ 红**。
  - 这就把 P3 与 P4 物理绑在一根链上，满足「删掉即报红」与「接线了 ≠ 被执行」。
- 若正路径在夹具层面**不可构造**（例如无法在测试内建立 `owner === userId` 的 workspace）：**不许伪造、不许改判据** → 立即报队长，登记为未清项，由队长决定是否退回 CTO。

## L-6 P3 夹具的期望值口径（D-6）

- 删自报身份 + PR-1 兜底改拒绝后，JWT 用户的 `ctx.department` **恒 undefined**（`JwtPayload` 无 `department`；`rbac.ts:105`）。⇒ `canModifyWorkspace` 的部门分支**恒 false**，**唯一通过路径 = `ws.owner === userId`**。
- 夹具「本部门 manager → 200」**不可写**（会红且非缺陷）。改为：
  1. **正路径**：`owner === userId` → 200；
  2. **负路径**：ga / 跨部门 / staff → 403；
  3. **显式登记**：`manager` 且部门本部门 → **deny（403）**，行内注明「R5/REV-8 已裁定为功能回退」，**不得**写成「已知限制」或「已完成」。

## L-7 `overflow.test.ts` 归因（D-4）

- 实测（code-c §R6-2）：`:72` 的 `x-synova-token` 仅在**注释**里，`:78` 是**显式不带头** ⇒ 该文件**不会被 P0 打红**。
- 裁定：归因 = **N1**（「全部夹具升为硬前置」）。即 `overflow.test.ts` 因需补 `beforeAll` 硬前置而**真实进入改动**，从而合法落在 PR-2 写集内。**不是**因为 P0。
- 总盘子仍 **17 文件**（CTO 已冻结口径，CTO 明示「口径不变、不剔行」）⇒ **不剔行**，只订正归因。
- 若某夹具实施后确认**无需任何改动**（既不打红、N1 亦不适用）→ 报队长，由队长按「不自裁总盘子口径」原则转 CTO。

## L-8 新文件存在性（F-1）

`tests/routes/workspace-access-write-endpoint.test.ts` 与 `tests/routes/middleware-order.test.ts` 在 main **均不存在**（实测零命中）⇒ REV-6 命令②③ 在**实施前必然失败**，属**预期**，不是判据失效。二者分别为 code-b / code-c **新建**，见 PLAN-REV2 §2.1 #2 / #4。

## L-9 `canModifyWorkspace` 的过渡态（F-4）

删 `server.ts:249` 后，该函数在 `src/` 内的调用方从 1（`void` 空操作）变 0 —— 这是**过渡态**：PR-2b 的写端点守卫落地后由生产代码消费 ⇒ **不触铁律 37**（函数本体未删、语义仍在、PR 内即被接线）。
但 `server.ts:19` 的 import **必须**收窄（否则 `rbacMiddleware` 以外的三个符号以「已 import 未使用」残留）。

## L-10 `department-workspace.ts:6` 自述与写集冲突（D-5）

CTO REV-0 的 **R6**（「只删自报头 + 行内注明」）已覆盖该冲突。按 REV-2 执行，**仅登记**，不因此扩大或缩小写集。

## L-11 无守护的行为变化（D-7，登记为未清项）

`department-workspace.ts:75` 的页内 JS 自发送自报头 **零测试覆盖**（`grep "manager:'+DEPT" tests/` → EXIT=1 无输出）⇒ 删头后的行为变化**无测试守护**，且 P0 回归面不含此点。**本卡不扩写集**，登记为未清项交 CTO。

## L-12 P2 判据的跨批达成（D-8）

`conditions: []` 全局 =0 **必须跨 PR-1 + PR-2 两批**才成立（`auth.ts:355` 在 PR-1；`:85/:112/:41` 在 PR-2）。⇒ **任一单 PR 不得声称「P2 已完成」**；自验与复核也只在两批齐备后判 P2 全局收敛。

## L-13 P3 期望值的冻结输入（D-2，前置）

P3 的期望值**由 PR-1 的实测契约决定**（改后 `rbac.ts` 兜底形态 + `canAccessWorkspace/canModifyWorkspace` 真值表）。
⇒ **PR-1 独立自验通过后**，由队长把该契约作为**冻结输入**下发给 code-c / verifier / reviewer。**在此之前 code-c 不进入 PR-2 实施**（与 CTO 执行序一致）。

---

## L-14 自验基准与还原方式（H1，高危）

- 裁定 **(A)**：**PR-1 先由队长提交（commit A），自验以「已提交 SHA」为基准**；`git checkout -- <file>` 只回退自验自己引入的变异体，**不会**触碰编码者未提交的工作。
- 理由（verifier 实测）：`git status --porcelain` 现为 ` M src/middleware/auth.ts` + ` M src/middleware/rbac.ts`，HEAD = f25e61eb ⇒ 在提交前执行 `git checkout -- <file>` 会**销毁 code-a 的 PR-1 工作**。
- 与 M6「收尾三件提交进仓库」的一致性：更早提交反而使证据更强（自验/复核都锚在不可变 SHA 上）。
- 副作用与处置：PR-1 若在自验/复核中被打红 → 走**增量修复 commit**（不 amend、不 rebase、不 force push），PR-1 相对 main 的**文件集合仍恒为 6**。
- **禁止** (B)（自建 sha256 备份写回）作为默认路径：它绕开了 git 的可核性；仅在 commit 被门禁硬阻断且 CTO 已知悉时，才由队长另行裁定。

## L-15 P2 判据与注释字面量冲突（H2）

- 裁定 **(B)**：**不改判据口径**，改注释措辞 —— 把 `src/middleware/auth.ts` 中记载旧行为的注释改为不含 `conditions: []` 字面量的等价表述（例：「原实现恒返空条件集」）。
- 理由：`grep -rn "conditions: \[\]" src/ --include='*.ts' | wc -l` = 0 是 **CTO 在 REV-6 冻结的原样命令**；把判据改成「代码行计数」属**判据变更**，须 CTO 追认，不是队长可自裁的范围。手稳如 (B) 可在不动判据的前提下达标。
- **登记要求（防「消音凑绿」之嫌）**：自验/复核证据中必须显式登记「注释曾被改写以避开判据字面量」的事实与改写前后原文，供 K3 核对 —— **不得**只贴 grep=0 的结果。

## L-16 「中间件侧自报通道清零」的判据形态（H3）

- 该条措辞出自**队长的任务卡**（非 CTO 冻结判据）⇒ 队长改判为：**① 语义判据**（无一处把该 header 的**值**当身份来源）+ **② 运行时穿入探针**（P0-f / P0-g）。
- **硬要求**：`auth.ts` 中**显式拒绝分支**（对 `x-synova-token` 的 `!== undefined` 判定 + `被拒绝` 留痕，实测 `:470`）**必须保留** —— 它正是 P5 所要求的留痕。**严禁**为凑 `grep = 0` 而删除该分支；凡出现「为满足 grep 而删拒绝逻辑」= 立即退回。

## L-17 探针入仓禁令（复核 verifier 做法，固化为通则）

自验/复核的探针、变异体脚本、配置**一律落 `/tmp`，永不入仓库**（否则污染 PR 写集与 PR 预算）。已实测可行的形态：`/tmp/<dir>/vitest.config.ts` 以 `root=/tmp/...` + alias 指向 worktree 绝对路径（探针内禁裸 import，否则 `/tmp` 下解析不到 `node_modules`）。
附实测坑（verifier 提供，全员适用）：**中文内容经 pwsh heredoc 会破坏 UTF-8**，导致 config 报 `stream did not contain valid UTF-8` ⇒ 落 `/tmp` 的文本文件一律用 write 工具，不经 pwsh 中转。

---

## L-18 PR-1 打红写集内 2 件路由测试 → **写集迁移**（非扩写集）+ 第 2 条功能回退

**触发**：code-a 实测——删 legacy 自报分支后，写集外转红 2 处：
① `tests/routes/ga-auth.test.ts:81`（legacy `ga:org:userId` 期望放行 → 实测 401）
② `tests/routes/diagnosis-report-persistence.test.ts:343`（桌面 seed 头打 `/api/solutions` → 实测 401）
根因：两条都编码「自报 `x-synova-token` 被信任为身份」这条**已退役契约**；调用方 `src/routes/solutions.ts:32/37/46`（`requireAuth`→401）与 `src/routes/ga-auth.ts:21`（`requireGa`→401）。

**归属纠正（重要）**：这 2 个文件**不是写集外**——它们是 **PLAN-REV2 §2.1 冻结的 17 文件写集第 9、10 行**（原 PR-2 / code-c，标注「P0 回归」）。code-a 看到的是 PR-1 的 6 文件边界，不是整卡边界。

**裁定（依据 CTO 给 R4 的切割规则「谁先把它打红，它就归谁；两张各自 ≤12」）**
- **采纳 A —— 迁移**：2 件迁入 PR-1 写集。
  · PR-1 = **8 文件**（原 6 + 2）≤12 ✅
  · PR-2 = **9 文件**（原 11 − 2）≤12 ✅
  · **总盘子仍 17 不变** ⇒ 属**写集迁移**，不属扩写集（迁移是 R4 明文授权，队长不擅自扩口径）。回执显著登记供 CTO 复核。
- **拒绝 B**（保留 legacy 分支 + degraded）：自报身份仍被信任，直接违反创始人决策 ① 与 P0。
- **C 无需新立卡**：派单件 **§六 遗留 2** 已预见并接受（「`electron-renderer` 的 dev-seed 旁路将失效…正确修法属 **Mac 域**，须另立卡」）。code-a 复核 `RightPanel.tsx:155-159` / `ga-collab.ts:44,92` 与之逐字一致。
  ⇒ **登记为第 2 条功能回退**（与 R5/REV-8 并列）；回执「未清项」要求 CTO 执行「另立卡」。

**第 2 条功能回退（回执必带，措辞固定）**
> **功能回退**：删除服务端对自报 `x-synova-token` 的信任后，**桌面端 GA 的 seed 身份通道整体断开** —— 桌面 GA 打 `/api/solutions`，以及全部走 `requireGa` 的 `/api/ga/*`（ga-annotations / ga-corrections / ga-admin）、audit / enterprise / ga-calibration / ga-corrections，一律 **401**。前置：`electron-renderer/src/components/RightPanel.tsx:155-159` + `stores/ga-collab.ts:44,92` 仍在发 legacy 头。处置：另立卡把桌面身份迁到正规登录（Mac 域）；**不得**写成「已知限制」或「已完成」。

**硬要求（防「把破坏藏进绿」）**
1. 改断言 = 按新语义**改写**，非删断言；`diagnosis-report-persistence.test.ts` 的用例意图是「P0-1 白名单收尾后 GA 仍可达 `/api/solutions`」⇒ 改用**真实 JWT Bearer**，保留断言强度，**不得**降级为弱断言。
2. 两处**必须行内注明**「自报头通道已断 = 已登记功能回退」。
3. 两件同样加 **N1 硬前置**（JWT_SECRET ≥16 + DEV_MODE='false'）。
4. 证据显式登记运行时后果（产品面行为变更，不是测试问题）。
5. `src/routes/solutions.ts`、`src/routes/ga-auth.ts` **不在任何写集内，一律不改** —— 它们在新姿态下的 401 是**正确**行为。

## L-19 两张 PR 的耦合度（登记给 CTO）

PR-1 与 PR-2 并非完全独立：身份语义（P0）与漏斗/守卫语义（P2/P3）在**路由级**相邻。本卡已用 R4 的迁移规则处理了第一处耦合（L-18）。
**若 PR-2 实施中再次打红 L-18 迁移后的同一批文件** → 不再二次迁移（同一文件归首打红者），由队长登记并转 CTO 裁定，不得自行放宽 ≤12 或合并两张 PR。

---

## L-20 白名单语义：「不要求认证」≠「忽略认证」（CTO 已准 A）

**触发（前提失效）**：`src/middleware/auth.ts:314-316` 的白名单分支**先于** auth 注入（注入在 `:386`）即 `return next();` ⇒ 白名单路径**永不注入 `req.auth`**。
`GET /api/solutions` 在白名单内（`auth.ts:126`），故 `solutions.ts:36/93` 的 `requireAuth`（走 `extractAuthFromRequest`）**即使携带合法 JWT 也不可能满足** ⇒ 删除自报通道后该端点对**全部客户端（含 DEV_MODE）恒 401**。
⇒ 派单件 **§六 遗留 2** 登记的修法路径（「改走正规登录」）对该端点**物理不成立** —— 属**派单件前提失效**，按前提冻结纪律**停手报 CTO**，不自裁。

**CTO 裁定（2026-09-24）：准方案 A。**

| 项 | 内容 |
|---|---|
| 改动落点 | **仅** `src/middleware/auth.ts`（PR-1 写集内） |
| 新语义 | 白名单 = **「不要求认证」**（非「忽略认证」）：分支内**尝试**解析 Bearer，**仅验签通过时**注入 `req.auth`；无/无效凭据一律照旧 `next()` 放行 |
| 硬禁止 | 不得改动白名单**列表**本身（不加不减条目）· 不得让白名单路径变成「要求认证」· 注入的**只能是验签身份**（自报值永不入 `req.auth`/`req.rbac`） |
| 留痕 | 白名单上「有 Bearer 但无效」须打 log（三态口径可区分）；**不得**因此改变放行结果（P5 的 fail-closed 只适用安全判据，白名单属「不要求」不适用拦截） |
| 可达性复验 | `/health`、`POST /api/auth/login`、`GET /api/status/budget`、`GET /api/knowledge/ask` 前移后仍直达（非 401/403）——A 只影响「有无 `req.auth`」 |
| 新增判别性夹具 | **M5** 白名单吞掉合法 Bearer → `/api/solutions` 带真实 JWT 必红；**M6** 白名单对无效 Bearer 也注入 → P0/P1 断言必红；并须有「验签通过注入 / 无效不注入 / 无凭据不注入」**直接断言**（不得只靠用例 6 间接覆盖） |

**登记（不因 A 而免除）**：第 1 条功能回退（桌面 dev-seed 旁路失效，派单 §六 遗留 2 / R5 并列）**照旧**；A 只恢复「正规登录客户端可达」，**不恢复 seed 旁路本身**。

**本裁定的性质**：CTO 已批准 = 卡面语义**扩展**（白名单行为变更超原卡面），已登记供 K3 核对，非队长自裁。

---

## L-21 漏斗兜底必须 fail-closed（verifier R-1，并入 PR-2 判据）

**触发（verifier 独立实测，PR-1 自验登记 R-1）**：白名单路径**不经过 `runWithContext`** ⇒ 即使 L-20 已注入 `req.auth`，该分支仍无 authProvider 上下文 ⇒ `getCurrentFilterClause()` 落回 `services/request-context.ts:41` 的兜底，返回 `{conditions: []}`。
而 `/api/knowledge/ask` **正在白名单内**（`auth.ts:126`）⇒ **知识检索可经白名单路径拿到空条件集 = fail-open**。

**裁定（并入 PR-2b / code-c）**
1. `src/services/request-context.ts:41` 的兜底**不得**返回 `{conditions: []}`（空条件 = 不过滤，实测 `l4/knowledge-store.ts:335` 在条件集长度为 0 时**完全跳过过滤**）。
2. 改为 **fail-closed 的非空条件**：无上下文 ⇒ 返回**拒绝型**条件集（使检索结果为空），**不得**是允许型或空集。具体形态由 code-c 定，但必须满足：**非空** 且 **deny-all 语义**。
3. 必须带**判别性夹具**（「删掉即报红」）：白名单路径 + 合法 JWT 调 `getCurrentFilterClause()` → **不得**得到空条件集；把兜底改回空集 → 必红。
4. 与 CTO 冻结的 P2 判据一致（`grep -rn "conditions: \[\]" src/ --include='*.ts' | wc -l` = 0），属该判据的**语义落点**而非新判据。
5. 登记：R-1 在 PR-1 轮次**未清**，不得写成「已完成」；PR-2 自验（task-8）必须显式复验此项。

---

## L-22 REV-6 命令② 的「403」实测不成立 → 期望值订正为 **401**（待 CTO 追认的口径修正）

**触发（code-b 实测，证据双条）**：
1. **读码**：`src/routes/workspaces-api.ts:176-192` 的 `GET /api/workspaces/mine` **全函数无任何 403 分支**（它原只读自报头推 role，恒 200）。
2. **链路**：`/api/workspaces/mine` **不在白名单** ⇒ 走 `jwtAuthMiddleware` 非白名单分支：`DEV_MODE=false` + 无 Authorization → `auth.ts:369-379` **401**；`DEV_MODE=true` 且无 secret → devMode 自动 admin → 200；`DEV_MODE=true` 且有 secret → 仍 **401**。
⇒ **三种配置下都拿不到 403**。而 N1 硬前置（JWT_SECRET≥16 + DEV_MODE=false）恰好把夹具钉在第一种。

**裁定（= code-b 提案 A，并由队长补两项硬要求）**
1. 该探针**保留**，期望值改为实测值 **401**，夹具行内注明「`jwtAuthMiddleware` 先于路由拦截；**403 出现在 P3 写端点**」。
2. **不得**采用「非 200 且 ∈ {401,403}」这类模糊期望（判别力更弱）。
3. **403 的断言必须仍在场**，由 **P3 写端点**承担（`tests/routes/workspace-access-write-endpoint.test.ts`，code-c）——**「在别处保留」不是取消**。
4. P4 的**判别性**运行时证据仍按 **L-5** = **正路径**（合法身份经 `req.rbac` → 200；把 rbac 移回 373 之后 → fail-closed ⇒ 红）。该 401 探针性质 = **回归守卫**，不承担判别性。

**口径修正登记（回执必带，待 CTO 追认）**：REV-6 命令② 字面期望「403」为**误期望**；实测 401，且 401 发生在 `jwtAuthMiddleware`（早于路由级 RBAC）。本订正**不放松**任何安全语义（401 与 403 同为 fail-closed，且 401 更早），但属对 CTO 冻结判据字面的修正 ⇒ 须与 L-18/L-20 并列在回执中显著登记，不得静默。

## L-23 外部漂移登记：origin/main 前进 13 commit

`git rev-list --left-right --count origin/main...HEAD` = **`13 2`**（task-2 时为 `0 0`）——`origin/main` 前进 13 commit（PR #740 B5 task-state backfill）。
code-b 已核：这 13 commit 对 `src/middleware/**`、`src/server.ts`、`tests/middleware/**`、`tests/routes/**` **零改动** ⇒ 对 PR-1/PR-2 写集**无冲突风险**。
⇒ 登记为外部漂移；本机无推送凭据，无法 rebase/推送（禁 force push）。「PR-2 的 base = PR-1 合后 main」在本地只能声明为**栈式 base = PR-1 commit SHA**（R7 本地留存）。

---

## L-24 变异体还原协议（全员级，取代一切「一律 `git checkout --`」措辞）

**同一病根第二次出现（code-b 实测上报）**：卡面写「还原用 `git checkout -- <file>`（PR-1 已提交，安全）」，但**该理由只对已提交的文件成立**。PR-2 的 `src/server.ts`（code-b）、`src/routes/workspaces-api.ts`（code-c）**尚未提交** ⇒ `git checkout -- <file>` 会回到 HEAD（= PR-1 前版本）并**整段销毁**未提交交付物。物理证据：`git show HEAD:src/server.ts` 的 rbac 仍在 **373**，工作树已 **366**。

**裁定（主路径 + 补充协议）**
1. **主路径（A）**：**PR-2 先由队长提交（commit B），task-8/task-9 一律以「已提交 SHA」为基准**执行变异体与还原。与 L-14 完全同构 ⇒ 还原动作落在不可变 SHA 上，且可自证是「还原」而非「销毁」。
2. **补充协议（对**任何**未提交文件的变异）**：变异前 `cp <file> /tmp/<name>.bak` + `sha256sum` 记指纹 → 改坏 → 跑红 → `cp` 还原 → `sha256sum -c` 校验字节一致 → `git status --porcelain` + `git diff --stat` 证明回到变异前形态。**该协议证据强于 `git checkout`（可证字节相同）**，且不动 HEAD 语义。
3. **禁令**：在**存在未提交改动**的文件上执行 `git checkout -- <file>` —— 视同「销毁交付物」，属退回级事故。
4. 登记要求：任何采用 (2) 的成员，须在证据里登记「快照路径 + 前后 sha256 + 还原校验结果」。

## L-25 夹具超时的据实设定

`vitest.config.ts` **未设 `hookTimeout`**（默认 10s），而本机 `createServer()` bootstrap 实测 **≈15s** ⇒ 任何起真服务的夹具都会以 hook 超时**假红**（verifier 已用 `--hookTimeout=120000` 决定性归因）。
⇒ **批准**夹具在 `beforeAll`/`beforeEach`/用例级**显式放宽超时**（如 120s），属**夹具层据实设定**、非判据变更。登记要求：回执须写明「超时值 + 实测依据（bootstrap 时长原始输出）」。

---

## L-26 重型锁协议升级（全队级，取代原始 mkdir/rmdir 版本）

**触发（code-b 实测事故，登记诚实）**：原始协议在锁目录**内**写 `owner` 文件后仍用 `rmdir` 释放 —— `rmdir` 对**非空目录静默失败**且被 `2>/dev/null` 吞错 ⇒ **锁泄漏约 6 分钟**，同时卡住 code-b 与 code-c（严格遵守「重型验证 ≤1」，双方都没抢跑，代价是等待）。仅涉及 `/tmp`，未触碰仓库。

**全员统一协议（task-8/task-9 及后续一律照此）**
```bash
LOCK=/tmp/d947-heavy.lock
for i in $(seq 1 240); do mkdir "$LOCK" 2>/dev/null && break; sleep 5; done
[ -d "$LOCK" ] || { echo HEAVY_LOCK_TIMEOUT; exit 3; }
echo "$(whoami) pid=$$ $(date -u +%FT%TZ)" > "$LOCK/owner"
cleanup() { rm -f "$LOCK/owner"; rmdir "$LOCK" 2>/dev/null && echo UNLOCK_OK || echo UNLOCK_FAIL; }
trap cleanup EXIT INT TERM
```
**三处修正**：① 释放前先 `rm -f "$LOCK/owner"`（不得对非空目录 `rmdir`）；② 释放后**显式打印 `UNLOCK_OK`/`UNLOCK_FAIL`**（禁 `2>/dev/null` 吞错）；③ `owner` 内含身份与 pid，便于**归属可查**。
**附加规则**：发现锁存在但 `owner` 时间戳超过 30 分钟 → **不得自行删除**（禁递归删除），报队长处置。

## L-27 P4 行号区间无夹具守护（设计取舍，登记）

夹具的源码顺序断言锚在**标识符/路径**（卡面硬要求「禁硬编码行号」——行号会漂移），故 **L ∈ [357,366]** 这一区间**无夹具级守护**：日后在 `:355-365` 区段增删行，L 可能漂出区间而夹具仍绿。
⇒ **明示为设计取舍**（标识符断言比行号断言更耐漂移，两者不可兼得）：区间约束由 P4 谓词命令 + 证据文件承担，供 K3 裁量是否另立守护。

---

## L-28 `GET /api/workspaces/mine` 被 `/:id` 遮蔽（code-c F-1）→ 本卡不修，另立卡 + 现状锁定断言

**实测（code-c）**：`router.get('/api/workspaces/:id')`（`workspaces-api.ts:126`）注册**先于** `mine`（`:264`）⇒ 经 HTTP 的 `/api/workspaces/mine` **恒 404 'workspace not found'**（`/conflicts`(:294) 同型）。
⇒ 队长在 L-5/L-22 要求的 `/mine` **HTTP 运行时判别探针在本卡范围内不可构造**（缺陷**先于本卡存在**）。

**裁定：(b) 另立卡，本卡不修 ordering。** 理由：
1. 属**本卡之前既有**的路由遮蔽缺陷，非 D947 引入；
2. 修 ordering 会让 `/api/workspaces/conflicts` 由 404 变**可达** = **可达面扩张**（安全相关），须 CTO 审；
3. 不在任何 P 判据内，也不在冻结写集语义内。

**本卡内的处置（已采纳 code-c 做法）**：以**直接 handler 运行时探针**给出判别性证据（code-c 的 M1 红证即在此路径打出），并加**登记性断言** `expect(404)` + 行内注明「**锁定现状，不代表期望行为**；缺陷已登记，另立卡」⇒ 使 F-1 **可见且不可静默漂移**。
**P4 的判别性探针不受影响**（code-b 用的是 `POST /api/workspaces` → 200，非 `/mine`）。
**回执必带**：F-1 列入未清项 + 要求 CTO 执行「另立卡」。

## L-29 `canModifyWorkspace` 在「双 undefined 部门」上 fail-open（code-c F-2）→ **本卡内修复**（PR-1 文件 fixup）

**实测（code-c）**：`canModifyWorkspace({role:'manager', department: undefined}, {department: undefined, owner:'m1'})` → **true**。
根因：`src/middleware/rbac.ts:288-290` 的部门分支在 `ctx.department` 与 `ws.department` **双 undefined** 时命中 `undefined === undefined` ⇒ 放行。
⇒ L-6 的「唯一通过路径 = `ws.owner === userId`」**仅对 `ws.department` 有值的工作区成立**；对**无部门工作区**，任意已认证 `manager` 均可改。

**裁定：修复（fail-closed），不采「接受为有意语义」。** 理由：
1. 这是 **fail-open 授权分支**，与本卡主题（默认拒绝 / 创始人决策 ②）**直接相悖**；发现了却只登记 = 把已知破坏留在绿腿里（正是本卡全程在防的模式）；
2. 落点在 `src/middleware/rbac.ts` —— **PR-1 已冻结写集内的文件** ⇒ **不扩写集**，以 **PR-1 fixup commit（A2）** 交付；
3. `code-c` 已核：其 P3 负路径构造在**有部门**工作区上 ⇒ 采纳本裁定**不会**打红 PR-2 夹具。

**实现要求**：部门分支必须要求**双方部门均有值**（`ws.department` 与 `ctx.department` 均非 undefined）才可能命中；双 undefined ⇒ **deny**。附**判别性夹具**（内部管理边界）：`{role:'manager', department: undefined}` + `{department: undefined, owner:'别人'}` → **false**；把修复改回原样 → **必红**。
**登记**：本条与 R5/REV-8「JWT 用户部门级可见性**恒 deny**」同源；修复后该恒 deny **保持不变**（本修复只收窄 manager 的越权面）。

## L-30 卡面 `L<366` 的过期口径（code-c 登记）

code-c 指出卡面字面写 `L < 366`，而 **L-2 冻结的是闭区间 `L ∈ [357,366]`**，实测 L=**366** ⇒ 卡面字面过期，**以 L-2 为准**。登记，不视为偏离。

---

## L-32 `canAccessWorkspace` 同型 twin 并入 A2（含空串收紧）

**触发（code-a 上报 §7②/§7③，代码读证）**：`src/middleware/rbac.ts:265-267`
```
if (ws.visibility === 'department') { return ws.department === ctx.department || role === 'admin'; }
```
对**已认证非 admin**（如 manager）且 `ctx.department === undefined` + `ws.department === undefined` → `undefined === undefined` ⇒ **true** = 与 L-29 **同型的 fail-open**（此次为**读取**面）。
且：**该已认证路径目前无夹具覆盖**（既有边界用例只覆盖未认证路径，被 `authenticated === false` 短路挡在前面）。

**裁定：并入 A2 立即修**（同一函数族 / 同一收窄规则 / 同一文件；留在线外 = 把已知 fail-open 留在无守护处）。
**修法**：部门分支命中条件收紧为 **双方均为「非空字符串」且相等**（`typeof x === 'string' && x.length > 0`）⇒ 双 undefined / 单侧 undefined / 双 `''` / 单侧 `''` **一律不命中**（一并收口 code-a §7③ 的空串语义问询）；`role === 'admin'` 旁路**保持原样**。
**夹具**：双 undefined + 非 admin → false；单侧 undefined → false；双 `''` → false；同非空部门 → true；跨部门 → false；admin → true；未认证 → 仍拒绝。**反向变异必红**。
**回归**：`npx vitest run tests/middleware` 整目录须全绿（改前 128/128）。
**登记**：本收窄与 **R5/REV-8「JWT 用户部门级可见性恒 deny」** 一致（JWT 无 department ⇒ 部门分支对读取面本就该 deny），**不产生新的功能回退**。

---

## L-31 F-2 登记性断言的时序冲突 → 采「甲」（断言随 A2 翻转）

**触发（code-c 上报）**：code-c 的 F-2 登记性断言 `workspace-access-write-endpoint.test.ts:448` 断的是**当时的现状** `canModifyWorkspace(ctx,{department:undefined,owner:'m1'})` → `toBe(true)`；L-29 裁定修复（A2）后该调用返回 `false` ⇒ **该断言必红**。

**裁定：采 (甲)** —— 把 `:448` 改为断 **post-A2 契约**（`toBe(false)`），用例名改为「非属主 manager + 无部门工作区 → deny（F-2 已裁定修复，A2 交付）」，**顺序 A2 → code-c 编辑 → commit B**。
理由：commit B 必须携带**裁定后的契约**，而不是「锁着一条已裁定要修的坏行为」的过期现状（否则 K3 必点名，且正是本卡全程在防的「把已知坏行为留在绿腿里」）。
**拒绝** (乙)（留到 B 的 fixup 翻转 → B 内含过期契约）与 (丙)（删断言 → 违反「不是删断言」原则）。
**附带**：同批批准 code-c 的 3 处**纯文字**修正（F-1 注释落位为裁定后措辞 + 补「缺陷已登记，另立卡」逐字短语 + 证据件 §7 改裁定后措辞）。
**已执行验证**：code-c 翻转后其 3 夹具 **39/39 绿**（含「未过度收紧」对照：属主经 owner 分支仍 200）。

---

## 附：本件的护栏与红线（逐条对照 CTO 护栏，不增不减）

工作目录钉死 `.synova-wt-d947-middleware` ｜ 禁 `rm -rf`/一切递归删除（清理由 `git worktree remove` / `git checkout -- <file>`）｜ 临时产物只落 `/tmp` ｜ 禁任何指向仓库外目录的写操作 ｜ 证据只落 `docs/synova/product-lines/evidence/D947-20260924/` ｜ 写集互斥 + `src/server.ts` 单写者 ｜ 重型验证（vitest / 全量门禁）串行 ≤1 ｜ 禁 `--no-verify` / `git stash` / force push ｜ **不判「通过」**（只给「自验结论」/「可提请独立审计」/「退回（附理由）」）｜ 禁 `scripts/audit/**`、不写审计标准、禁自我审计。
