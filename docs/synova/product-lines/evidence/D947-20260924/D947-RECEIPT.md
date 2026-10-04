# D947 回执（七项 + CTO 增项）— Win 侧首模块：`src/middleware/**` 默认安全姿态

> 执行方：DSH 小队（Agent Teams 组队，队长 + 3 编码 + 自验 + 复核 = **6 人**）｜队长：synova-squad-lead
> 工作目录（钉死）：`.synova-wt-d947-middleware`｜分支：`feat/d947-middleware-default-posture`
> 日期：2026-09-24
> **本件的结论形态：`可提请独立审计`（附未清项）。执行方一律不判「通过」** —— 通过与否归 CTO 收件闸 + K3 终审。

---

## 〇、探针自证（命令 + 退出码 + 原始输出）

```
$ echo PERMISSION_PROBE; $PSVersionTable.PSVersion.ToString()
PERMISSION_PROBE
5.1.26100.9444
[退出码 0]

$ cmd /c "exit 7"; "LASTEXITCODE_probe=$LASTEXITCODE"
LASTEXITCODE_probe=7

$ cmd /c "ver"; "LASTEXITCODE_ver=$LASTEXITCODE"
Microsoft Windows [Version 10.0.26200.9457]
LASTEXITCODE_ver=0
```
**判定：环境已解。** 无 0xC0000142；退出码可正常传播（7 与 0 均如实回传）。
**诚实登记**：本会话 `$PSVersionTable.PSVersion` = **5.1.26100.9444**（Windows PowerShell 5.1），非 pwsh 7 —— 与前会话「0xC0000142 完全无输出」相比已恢复正常，但**与「pwsh」名义不符**，登记供 CTO 判。
**关键工具链事实（全员实测）**：pwsh 的 PATH **无 `grep`/`awk`/`wc`** ⇒ 全部取证经 Git Bash `C:\Program Files\Git\bin\bash.exe`；`C:\WINDOWS\system32\bash.exe`（WSL）已避开。worktree 内**无 `node_modules`**，由父仓库解析（vitest 4.1.8 可用）。

---

## 一、派单件指纹三方对账

| 来源 | 字节 | 行数 | sha256（前 16） |
|---|---|---|---|
| **启动指令给定值** | 14505 | 177 | `1f74c0703d279de6` |
| **队长复算值** | 14505 | 177 | `1f74c0703d279de6` |
| **本地读取路径** | 主工作区绝对路径 `D:\novis-backup-20260526\Novis\synova-agent\docs\synova\dispatch\D947-win-middleware-default-posture-20260924.md`（worktree 内 **不存在**本件，按派单 §〇.3 保险 1 从主工作区读） |

队长复算原始输出：
```
path=D:\novis-backup-20260526\Novis\synova-agent\docs\synova\dispatch\D947-win-middleware-default-posture-20260924.md
bytes=14505
lines=177
sha256=1f74c0703d279de6956a6072443d1d0f06cd6b2338ef5c0260f095e4f1b3794c
sha256_first16=1f74c0703d279de6
```
**⇒ 三方一致（逐值相等）。** 落 main 状态：**仍未落 `origin/main`**（Win 侧无写凭据）⇒ 按派单 §〇.3 **本地优先例外**执行；§〇.3 保险 3（落 main 后复核）**未触发**（截至本件仍未落）。

---

## 二、前提冻结：F1–F8 逐条实测（队长自跑，不采信 CTO 转述）

| # | 派单件声称 | 队长实测 | 判定 |
|---|---|---|---|
| **F1** | rbac 之前挂载的**路由组数 12**（之前共 20 次挂载：+5 全局中间件 +3 静态/重定向） | `app.use(rbacMiddleware)` @ **373**；路由注册（谓词口径）之前 **12**；总挂载 regex 命中 **20** = 12 + 5 全局中间件 + 3 静态/重定向 | ✅ 成立（逐项吻合） |
| **F2** | 无凭据兜底 `{role:'admin', userId:DEFAULT_USER}` | `rbac.ts:119` `return { role: 'admin', userId: DEFAULT_USER };`；`DEFAULT_USER='dev'`@:16 | ✅ |
| **F3** | legacy `extractAuthFromRequest` 的 `role` **直接取自客户端字符串**（默认 `staff`） | `auth.ts:399` `role: (parts[0] as WorkspaceRole \| 'ga') \|\| 'staff'` | ✅ |
| **F4** | 服务端信任自报身份 **6 处** | `rbac.ts:110` · `auth.ts:395` · `routes/workspaces-api.ts:178` · `routes/department-workspace.ts:13` + `:75`（读+自发）· `server.ts:247`（硬编码） = **6 处** | ✅ |
| **F5** | 两处判据被 `void` 丢弃（符号/行号原文混写） | `server.ts:248` `void canAccessWorkspace(...)`、`:249` `void canModifyWorkspace(...)` ⇒ 与 PLAN-REV2 §3.3 的订正（canAccess@248 / canModify@249）**一致** | ✅ |
| **F6** | 生产代码自欺 | `server.ts:247` 硬编码 `'x-synova-token':'admin::dev'`；`department-workspace.ts:75` 自发 `'manager:'+DEPT+':user'`；`src/` 内 `x-synova-token` **8 处** | ✅ |
| **F7** | 存量测试固化不安全行为 | `tests/` 内 `x-synova-token` **17 处 / 6 文件**（逐文件 7+3+1+2+3+1，与 PLAN-REV2 §2.4 逐值吻合） | ✅ |
| **F8** | `documents.ts` 两处直接传空过滤条件 | `documents.ts:85`、`:112` `{ conditions: [] }` | ✅ |

**P2 基线（队长实测）**：`grep -rn "conditions: \[\]" src/ --include='*.ts'` = **4**（`auth.ts:355` · `documents.ts:85` · `:112` · `services/request-context.ts:41`）。
**P3 端点基线（队长实测）**：`workspaces-api.ts` 写端点 **:55 · :77 · :106 · :144 · :221**（与 PLAN-REV2 逐行一致）。
**写集存在性（队长实测）**：17 文件中 **13 EXIST + 4 ABSENT**（4 个新建件正是 PLAN-REV2 标注「新建」的 4 件）。

**⇒ 前提冻结结论：派单件事实性前提 F1–F8 全部成立，无一条失效。** 但执行中**另有三处 PLAN-REV2/卡面的「派生前提」失效**（见 §七 口径修正）——均已按前提冻结纪律**停手报 CTO**或裁定后显著登记。

---

## 三、逐文件写集 / 归属 / PR 划分（实施后终态）

| # | 文件 | 写者 | PR | 改动性质 |
|---|---|---|---|---|
| 1 | `src/middleware/rbac.ts` | code-a | PR-1 + fixup A2 | 删自报分支；兜底改拒绝；`authenticated` 标记 + 未认证前置短路；**A2：两处部门判据收窄**（L-29/L-32） |
| 2 | `src/middleware/auth.ts` | code-a | PR-1 | 删 legacy 自报分支；`getPermissionFilter` 由空条件集 → 验签身份派生；P5 三态留痕；**L-20 白名单语义** |
| 3 | `tests/middleware/rbac.test.ts` | code-a | PR-1 + A2 | 存量断言反转 + N1；A2 增 58 例（含 L-29 13 / L-32 9） |
| 4 | `tests/middleware/auth.test.ts` | code-a | PR-1 | N1 + 日志捕获；legacy 契约反转；P5 三态；L-20 白名单注入 6 例 |
| 5 | `tests/middleware/rbac-default-deny.test.ts`（新建） | code-a | PR-1 | P1 六形态可见性穷举 + 中间件注入探针 |
| 6 | `tests/middleware/permission-filter.test.ts`（新建） | code-a | PR-1 | P2 形状 + **真实 KnowledgeStore 引擎判别** |
| 7 | `tests/routes/ga-auth.test.ts` | code-a | PR-1（L-18 迁入） | legacy 路径 → 精确 401 + 错误码 + 功能回退登记 |
| 8 | `tests/routes/diagnosis-report-persistence.test.ts` | code-a | PR-1（L-18 迁入） | seed 头 → 真实 JWT Bearer（断言**加强**） |
| 9 | `src/server.ts` | code-b（**单写者**） | PR-2 | 中间件前移；删自欺块（硬编码身份 + 两处 `void`）；import 收窄 |
| 10 | `tests/routes/middleware-order.test.ts`（新建） | code-b | PR-2 | P4/P6：标识符级顺序断言 + 零 `void` + **真运行时判别性正路径** |
| 11 | `src/routes/workspaces-api.ts` | code-c | PR-2 | 删自报身份派生子串（**活越权读**）；P3 五写端点守卫；`/mine` 守卫 |
| 12 | `tests/routes/workspace-access-write-endpoint.test.ts`（新建） | code-c | PR-2 | P3：403×12 + 正路径 + F-1 登记性断言 |
| 13 | `src/routes/department-workspace.ts` | code-c | PR-2 | R6：只删自报头（读 + 页内自发送）+ 行内注明 |
| 14 | `src/routes/documents.ts` | code-c | PR-2 | P2 收口（:85/:112 走唯一漏斗） |
| 15 | `src/services/request-context.ts` | code-c | PR-2 | P2 兜底 + **L-21 非空 deny-all** |
| 16 | `tests/routes/department-workspace.test.ts` | code-c | PR-2 | P0 回归改写 + N1 |
| 17 | `tests/routes/overflow.test.ts` | code-c | PR-2 | **N1 归因**（L-7）+ N1 硬前置 |

**写集算术**：**PR-1 = 8 文件**（6 + L-18 迁入 2）≤12 ✅｜**PR-2 = 9 文件**（11 − L-18 迁出 2）≤12 ✅｜**总盘子 17**（**与 CTO 冻结口径逐值一致**，L-18 为 R4 授权的**迁移**而非扩张）。
**写集互斥**：逐文件核对，**无文件同时属于两张 PR**；`src/server.ts` **单写者 = code-b**（code-c 与其余成员 0 行触碰，由 code-a 逐文件扫描 diff 标识核验）。

---

## 四、提交与 diff（收尾三件之一）

| 提交 | SHA | 内容 | `git diff --stat` |
|---|---|---|---|
| **A（PR-1）** | **`77e0d6aa`** | middleware 层默认安全姿态 | `8 files changed, 953 insertions(+), 84 deletions(-)` |
| **A2（PR-1 fixup）** | **`313150bf`** | 部门判据 fail-open 收窄（L-29/L-32） | `2 files changed, 174 insertions(+), 3 deletions(-)` |
| **B（PR-2）** | **`2ea4df10`** | 路由层默认拒绝 + 中间件前移 + 唯一漏斗收口 | `9 files changed, 1084 insertions(+), 46 deletions(-)` |
| **C（治理/证据）** | **`e01d1345`** | 本证据目录全部报告 + task brief | `14 files changed, 5905 insertions(+)`（不计入 PR 预算） |

- **PR-1 文件集合恒 8**（A 与 A2 同集合，无扩张）｜**PR-2 = 9**。
- **口径注（防误读）**：`git diff --name-only` 在相邻提交间会多出 **`.claude/bypass.log`** —— 它是 **post-commit 钩子（D521 `bypass COMMITTED 登记`）自动写入**的治理产物，非任何成员所改。剔除后逐段为：**A2 = 2 · PR-2 = 9 · 相对基线合计 = 17**（队长实测：`git diff --name-only f25e61eb 2ea4df10` = **18 条 = 17 代码/测试 + 1 治理**）。
- **PR-2 的 `base` 声明**：CTO 要求「= PR-1 合后 main」。**本机无推送凭据（见 §九），无法合并/推送** ⇒ 按 **R7 本地留存**，PR-2 实际为**栈式 base = PR-1 链尾 `313150bf`**（已显式声明，符合「栈式 PR 必须声明 base」）。
- 每次提交本地门禁输出：**A2 与 B 均「全部 13 组通过」**。

---

## 五、判据总览（P0–P8 + N1；判据原文见派单 §二与 PLAN-REV2 REV-3/REV-6）

| 判据 | 结果 | 关键证据（原始输出摘要） |
|---|---|---|
| **P0** 客户端自报身份完全失效 | ✅ 自验 + 复核 | 自报 header/query 四形态 → `{role:'staff',userId:'unauthenticated',authenticated:false}`；`extractAuthFromRequest(自报头)` → `null`（修复前 `{role:'admin'}`）；路由侧 offenders **0**（`src/routes/` 6 处 `x-synova-token` 全为注释） |
| **P1** 无凭据 ≠ admin | ✅ | 无 token / 空 header / 中间件兜底 全部非 admin + `authenticated=false` |
| **P2** 唯一漏斗真的唯一 | ✅（跨两批） | `grep -rn "conditions: []" src/ --include='*.ts' \| wc -l` = **0**（基线 4）；复核方另以 **Node 递归遍历 `src/**/*.ts`** 独立统计 = 0 |
| **P3** 工作区检查在写端点生效 | ✅（R3 整条归 code-c） | 5 写端点守卫在场；staff/ga/非属主 manager → **403**；`owner===userId` → **200**；P3 夹具内 `toBe(403)` **×12**；`canModifyWorkspace` 接线 5 处 |
| **P4** 鉴权中间件之前零路由 | ✅ | rbac@**366** ∈ [357,366]；谓词口径之前**恰好 5 行** = 冻结豁免集；I4 次序 `jwtAuth@344 < rateLimit@352 < rbac@366 < homeRoutes@376 < workspacesApiRoutes@380` |
| **P5** fail-closed + 三态可分 | ✅ | `被拒绝`(AUTH_REJECTED) / `不可用（系统异常）`(AUTH_UNAVAILABLE→401) / `出错`(AUTH_ERROR→**500 + degraded:true**) 三态可独立触发且码与文案一一对应 |
| **P6** 测试层必红 | ✅ | 夹具含源码顺序断言 + 运行时探针；`grep -nE 'void +(canAccessWorkspace\|canModifyWorkspace)' src/` = **0** |
| **P7** 生产代码零自欺 | ✅ | `'admin::dev'` **0**；`manager:'+DEPT` **0**；`server.ts:19` import 收窄 |
| **P8** 每条修复带变异体 + 三路径 | ✅ | 变异体 M1–M10 全红证（见 §六） |
| **N1** 夹具硬前置（升为硬前置） | ✅ **在场 + 必要性双证** | 各夹具 `beforeAll` 断言齐；**必要性反证**：清空 `JWT_SECRET` + `DEV_MODE=true` ⇒ 无凭据请求 **200 + owner=dev-admin**（自动 admin 放行）⇒ 前置**必要**（非仅存在） |

**裁定追加项（本卡执行中新增，全部已实测）**：**L-21**（`request-context.ts:41` 非空 deny-all；白名单 + 真实 JWT 不再得空条件集）✅｜**L-22**（无凭据 `/mine` = **401**）✅｜**L-28/F-1**（`/mine`、`/conflicts` 被 `/:id` 遮蔽恒 **404**；登记性断言 + 「缺陷已登记，另立卡」字样 `grep -c` = **2**）✅｜**L-29/L-32**（部门判据：双 undefined / 单侧 undefined / 双 `''` / 单侧 `''` 一律 deny；admin 旁路与 **owner 路径不变**）✅｜**L-20**（白名单「不要求认证」≠「忽略认证」；`isWhitelisted` 函数体**逐字节未改**，条目 27/27）✅｜**R5/REV-8**（JWT 用户部门级恒 deny 如实体现在场；禁语「已知限制/已完成」合计 **0**）✅

### P3 × P4 成对（R2/REV-3.3）
**同一轮次内**同时给出红→绿对照（自验 + 复核**各自独立**做到）：
- **M7（把 `app.use(rbacMiddleware)` 移回路由之后）** ⇒ 源码断言红（before-set 变 10 项 / rbac 落到 homeRoutes 之后）+ **运行时红**（判别性正路径由 200 → **403**）+ 交付夹具红 4 例。
- 绿态：正路径 admin JWT → `POST /api/workspaces` → **200**（`owner` 取自**验签身份**，落日志 `"owner":"d947-admin"`）；**复核方另用同进程 A/B 双 app 反证**（挂 rbac → 200 / 不挂 rbac → 403）。
- ⇒ **「接线了 ≠ 被执行」已被物理证伪**：`req.rbac` 缺失时写端点 fail-closed 403。

---

## 六、变异体红证清单（全部：改坏 → 跑红 → 还原 → 指纹核对 → 无残留）

| 变异体 | 改法 | 红证（原始断言片段） |
|---|---|---|
| M1/M2（自验） | rbac 恢复自报分支 / 兜底回 admin | 8 failed / 21 failed；`expected 'admin' to be 'staff'` 等 |
| M3/M4（自验） | auth 信任自报头 / 漏斗回恒空 | `{"role":"admin",...}` 复现；`expected +0 to be 1` |
| M5/M6（自验） | 白名单吞合法 Bearer / 对无效 Bearer 也注入 | `expected 401 to be 200`；`expected {sub:'forged-by-mutant'} to be undefined` |
| M7/M8（code-a，A2） | 部门分支改回原样（`canModifyWorkspace` / `canAccessWorkspace`） | `expected true to be false`（双 undefined / 双 `''`） |
| M1–M3（code-c） | `/mine` 恢复自报头 / 摘 status 守卫 / 兜底回空集 | `'admin'≠'staff'`、`200≠403`、`filteredOut 0≠2` |
| M5/M6（code-b） | 白名单吞合法 Bearer / 注入伪造身份 | 夹具 2 failed / 2 failed |
| **M7（成对本体）** | rbac 移回 373 之后 | 源码断言 + **运行时 `expected 403 to be 200`** 双红 |
| M7–M10（verifier PR-2） | 移回 / 摘判据 / 兜底回空集 / 撤销收窄 | 12 failed / 2 failed / 3 failed / 4 failed（另使交付夹具红 1 例） |
| M-P4/M-P3（reviewer PR-2） | 移回 / 摘写守卫 | 源码探针 3 项红 + 夹具 4 failed；探针 2 FAIL + 夹具 2 failed |

**还原纪律**：PR-1 轮次以已提交 SHA 为基准用 `git checkout --`；PR-2 未提交期间改用 **`cp` 快照 + `sha256sum -c`**（L-24）——全员零 `git stash`；每次还原后 `git status --porcelain` 证明 **tracked_mods = 0**、全仓 `grep MUTANT` 零命中（**红证不残留**）。

---

## 七、口径修正与卡面订正（**待 CTO 追认**，不静默）

| # | 项 | 事实 | 处置 |
|---|---|---|---|
| **L-18** | L-18「改用 JWT 即恢复 `/api/solutions` 可达」的使能机制**不存在** | 白名单分支 `return next()` **先于** `req.auth` 注入（`auth.ts:314-316` vs `:386`）⇒ 恒 401 | **报 CTO → 裁 L-20 方案 A**（白名单语义改「不要求认证」）；已实施 |
| **L-22** | REV-6 命令② 字面期望 **403** | `/mine` **无 403 分支**，`jwtAuthMiddleware` 在路由匹配前拦 ⇒ 实测 **401**（三配置推演均无 403） | 裁定期望值订正为 **401**；**403 断言仍在 P3 写端点在场**（「在别处保留」≠ 取消） |
| **L-29/L-32** | L-6「唯一通过路径 = owner」**不完整** | `canModifyWorkspace` / `canAccessWorkspace` 部门分支在**双 undefined**（及双 `''`）时命中 `undefined === undefined` ⇒ **fail-open** | **本卡内修复**（A2，PR-1 文件 fixup，**不扩写集**），带判别性夹具 + 反向变异 |
| **L-18 迁移** | PLAN-REV2 §2.1 把两件路由测试归 PR-2，但**先被 PR-1 打红** | `ga-auth.test.ts` / `diagnosis-report-persistence.test.ts` | 按 **R4「谁先把它打红就归谁」** 迁入 PR-1；**总盘子 17 不变**（迁移非扩张） |
| **E-1** | task-8 卡面字面「PR-2 = 11 文件」 | 实测 **9** 代码文件（L-18 迁出 2） | 登记为卡面口径过期（L-30 同类），**以 17 总盘子为准** |
| **L-15** | 两处注释为避免判据字面量被**注释**污染而改写 | `auth.ts`（"原实现恒返空条件集"）、`code-c` 的 `documents.ts:12` / `department-workspace.ts:84` | **改注释不改判据**；改写前后原文均落证据件，供 K3 核「消音凑绿」 |
| **D947-RULINGS** | L-1…L-32（**无 L-31 缺失已补**） | 本卡全部裁定 | 单一事实源，随本件提交 |

---

## 八、四道独立关卡结论（`自验结论` / `复核结论`，**非**「通过」）

| 轮次 | 角色 | 证据件 | 结论 |
|---|---|---|---|
| PR-1 自验 | verifier（task-4） | `D947-verifier-pr1.md`（551 行 / sha256 `b7abe77c…`） | **可提请独立审计**（附 R-1~R-4 登记） |
| PR-1 复核 | reviewer（task-5） | `D947-reviewer-pr1.md`（27,602 B） | **可提请独立审计**，未发现退回理由；**A/B 归因关闭**（PR-1 在场/回退两态同红） |
| PR-2 自验 | verifier（task-8） | `D947-verifier-pr2.md`（483 行 / sha256 `15ab4460…`） | **可提请独立审计**；**P3×P4 成对达成** |
| PR-2 复核 | reviewer（task-9） | `D947-reviewer-pr2.md`（22,189 B） | **可提请独立审计**，未发现退回理由 |

**独立性证据**：复核方**未读**自验报告、探针**自写**（落 `%TEMP%`，零入仓）；自验/复核**均非编码兼任**（角色分离，编制 6 人）。

---

## 九、未清项清单（诚实登记，**不得读作「已完成」**）

1. **派单件未落 `origin/main`** —— 等创始人配置 Deploy Key 公钥（派单 §六 遗留 4）。
2. **无法推送 / 无法开 PR**：`git ls-remote --heads origin` → **退出码 128**，原始 stderr `git@github.com: Permission denied (publickey).` ⇒ 全部交付**本地留存**（R7）；PR-2 的 `base` 只能声明为**栈式 base = PR-1 链尾**。
3. **功能回退①（R5/REV-8）**：JWT 用户**部门级可见性恒 deny**。
4. **功能回退②（L-18）**：桌面 dev-seed 旁路失效 —— `/api/ga/*`（requireGa）、`/api/audit`、`/api/enterprise`、`/api/ga/calibration`、`/api/ga/corrections` **返 401**；`RightPanel.tsx:155-159` / `ga-collab.ts:44,92` 仍在发 legacy 头。**须 CTO 执行「另立卡」**（Mac 域：桌面身份迁正规登录）。
5. **F-1（L-28）未清**：`GET /api/workspaces/mine` 与 `/conflicts` 被 `router.get('/api/workspaces/:id')` 遮蔽 ⇒ HTTP **恒 404**（**先于本卡存在**）。CTO 已裁 (b) **本卡不修**（修之使 `/conflicts` 由 404 变**可达** = 可达面扩张）⇒ **须 CTO 执行「另立卡」**；现以登记性断言锁定现状。
6. **全量套件未全绿（16 个失败文件）**：`16 failed | 595 passed | 3 skipped (614)`；已双重归因为环境/域外（`zustand` 缺失、`@modelcontextprotocol/sdk/types.js` 缺失、`Hook timed out in 10000ms`（本机 bootstrap ≈15s > 默认 10s，`--hookTimeout=120000` 下 4 例全绿）、架构门禁基线棘轮全量负载超时等）。**失败面与 PR-1 轮次逐文件相同（新增 0 / 消失 0）**，失败信息区 696 行扫 9 个改动面模式**全 0**。
   **残余不确定性（诚实登记）**：非 hook 类失败**未做 `f25e61eb` 前置版本对照跑**（对照需第二工作树或临时回退，超出成员写例外）⇒ 只证明「未引用改动面 + 隔离复现 + 错误原文属环境/域外」，**不宣称「已证明预先存在」**。
7. **存量 `tsc --noEmit` 36 行**（`extensions/**`、`src/mcp/**`、`src/connectors/ima.ts`、`src/server.ts:473-474`）—— 域外，**只登记不改**（`server.ts:473-474` 已证与 HEAD 逐字节相同）。
8. **L-27 设计取舍**：P4 源码断言锚**标识符**（卡面硬要求「禁硬编码行号」）⇒ **L ∈ [357,366] 区间无夹具守护**（实测 366 在区间内）。
9. **L-11**：`department-workspace.ts:75` 页内自发送自报头**零测试覆盖** ⇒ 删头后的行为变化**无守护**（P0 回归面不含此点）。
10. **E-2（低危）**：merge 端点判据顺序 = 首层验签 403 → 形状校验 400/404 → 授权 403；合法形态结果正确，仅「非子工作区 id」先得 400。
11. **纪律口径冲突（R8 已登记）**：`squad-discipline` §16「成员 ≤4」与队长 persona「不组第 5 人」**与本单 6 人编制冲突**；本单按创始人指示执行，纪律条款同步需另走 PR + K3。
12. **B/C 级告警**：D2 文档登记门禁 ⚠️ 8 份 evidence 未登记 `docs/authority/DOCS-REGISTRY.yaml`（V5 软提示，CI 为权威）；`plan.principles` 无 Done verify（存量警告）。
13. **P2 归属**：=0 系**跨 PR-1+PR-2 两批**达成 ⇒ **任一单 PR 不得单独声称「P2 已完成」**（L-12）。

---

## 十、团队成员运行记录（成员名 · 状态 · token · 共享任务 id 与状态）

| 成员（target） | 角色 | 状态 | token | 共享任务（id → 状态） |
|---|---|---|---|---|
| `lead`（队长） | 协调 / 判前提 / 提交 | running | **未采集**（平台未向队长暴露 token 计量） | task-10（收尾/回执）in_progress |
| `code-a` | 编码（middleware） | inactive（已交付） | 未采集 | task-1 → **completed**；task-11 → **completed** |
| `code-b` | 编码（装配层，`server.ts` 单写者） | inactive（已交付） | 未采集 | task-2 → **completed**；task-6 → **completed** |
| `code-c` | 编码（路由层 + 漏斗） | inactive（已交付） | 未采集 | task-3 → **completed**；task-7 → **completed** |
| `verifier` | **独立自验**（非编码兼任，只读 + /tmp） | inactive（已交付） | 未采集 | task-4 → **completed**；task-8 → **completed** |
| `reviewer` | **独立复核**（非编码兼任，自写探针） | inactive（已交付） | 未采集 | task-5 → **completed**；task-9 → **completed** |

- **开板状态**：本会话开工时共享任务板为**空**（前会话 task-1~task-5 未跨会话留存）⇒ 本卡实施任务**另开新 id**：**task-1…task-11**（符合 CTO「实施任务另开新 id」）。
- **每人原始命令 + 退出码**：见各成员证据件与回执正文（队长**未代跑任何成员命令** —— 全部命令的原始输出与退出码由成员本人回传，本件只做引用与汇总）。
  - `code-a`：`npx vitest run`（8 文件）`exit=0 / 116 passed`；A2 后 `tests/middleware exit=0 / 139 passed`；`npx tsc --noEmit`（其文件零命中）；变异体 M1–M8 均 `VITEST_EXIT=1` + `sha256sum -c OK`。
  - `code-b`：夹具 `[VITEST_EXIT=0] / 12 passed`；变异体 `[VITEST_EXIT=1]`（4 failed）；`sha256` 变异前后同值 `62926230…bf784`；`UNLOCK_OK`。
  - `code-c`：`VITEST_EXIT=0 / 3 files / 39 passed`；A2 后重跑仍 `39 passed`；三条变异体 `vitest exit=1`；md5 四证。
  - `verifier`：PR-1 `npx vitest run <8+1>` → 9 files / 135 passed；全量 `16 failed | 593 passed`；PR-2 → 13 files / 208 passed；全量 `16 failed | 595 passed`；变异体 M1–M10。
  - `reviewer`：PR-1 `probe-p0p1.mts` 14/14、`tests/middleware` 135 passed；PR-2 `probe-pr2-source.mts` 13/13、`probe-pr2-runtime.mts` 38/38、`tests/middleware tests/routes` 46 files / 444 passed（1 环境类失败）。

---

## 十一、护栏执行情况（逐条对照 CTO 批准护栏，**不增不减**）

| 护栏 | 执行 |
|---|---|
| 工作目录钉死 `.synova-wt-d947-middleware` | ✅ 全员；主工作区只读派单件与同步 |
| 禁 `rm -rf` / 一切递归删除 | ✅ 零发生；清理一律 `git worktree remove` / `git checkout -- <file>`；锁释放用 `rm -f` 单文件 + `rmdir` |
| 临时产物只落 `/tmp` | ✅ 探针/脚本/快照全在 `/tmp`（`%TEMP%`），**零入仓** |
| 禁指向仓库外目录的写操作 | ✅ 除 `/tmp` 无任何仓库外写 |
| 证据只落 `docs/synova/product-lines/evidence/D947-20260924/` | ✅ 全部证据件在该目录 |
| 写集互斥 + `src/server.ts` 单写者 | ✅ 逐文件核对无重叠；`server.ts` 仅 code-b 触碰 |
| 重型验证串行 ≤1 | ✅ `/tmp/d947-heavy.lock` 原子锁（**L-26 升级版**）；成员多次等锁（未抢跑）；code-b/c 各泄漏过一次锁已自修并升级为全队协议 |
| 禁 `--no-verify` / `git stash` / force push | ✅ 零使用（3 次提交均走完整门禁；还原全程零 `git stash`） |
| 不判「通过」 | ✅ 全件只给「自验结论 / 可提请独立审计 / 退回（附理由）」 |
| 不碰 `scripts/audit/**`、不写审计标准、禁自我审计 | ✅ 零触碰 |

**门禁基线对比**：改前（2026-09-24 19:53:03 → 19:54:03，60s）`bash scripts/pre-commit-check.sh` → **13 组全部通过 / exit 0**（1 项警告 + 2 项软提示）；改后 **A2 与 B 两次提交均「全部 13 组通过」**。
**技能同步**：`bash scripts/workflow/sync-dsh-skills.sh --check` → **SYNC-OK**（16 个技能）。
**`git ls-remote` 回执**：`git ls-remote --heads origin` → **exit 128**，stderr `git@github.com: Permission denied (publickey).`｜`| grep -i d947` → 无输出（本机无凭据，见 §九-2）。

---

## 十二、结论形态

**`可提请独立审计`**（附 §七 待 CTO 追认的口径修正 + §九 未清项）。

执行方**不判「通过」**，**不宣称「产品被验证」**；通过与否归 **CTO 收件闸 + K3 终审**。
