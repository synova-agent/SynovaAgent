# D1002 派单件 — 工作区路由遮蔽修复（W2/F-1）+ 错误码顺序（E-2）+ `/conflicts` 守卫补齐

> 出件：Win-Codex-CTO ｜ 2026-09-25
> 号段：**Win 段 `D1000–D1099`**（Mac-CTO 2026-09-25 授予）。本卡 = **D1002**
> **改号留痕**：本卡原号 **D950**，与 Mac 侧 D950（116 卡归一）撞号 → Mac-CTO 2026-09-25 裁定 D950 → **D1002**。旧号不得再用于本卡。
> 归属基线：`docs/synova/coordination/ownership.yaml`（写集实测全 win ⇒ `domain: "win"` + `owner_side: "win"`，无需跨域特批）
> 来源：`D947-RULINGS.md:253`（L-28「本卡不修 ordering，另立卡」）+ D948 PLAN §1-补 2 运行时探针 + K3 D947 审计 §一.5（E-2）
> **性质升级**：F-1 原被当作"装饰性清理"，D948 证明它是**承重件**——不修则 D948 的用户可见目标永远不可达。

---

## 一、问题（实测，非推断）

```
$ git grep -n "router.get\|router.post\|router.put" ef5c8caa -- src/routes/workspaces-api.ts
126: router.get('/api/workspaces/:id', ...)        ← 先注册，吃掉所有单段路径
255: router.get('/api/workspaces/by-dept/:dept', ...)
264: router.get('/api/workspaces/mine', ...)       ← 被 :id 遮蔽
294: router.get('/api/workspaces/conflicts', ...)  ← 同病

$ 运行时探针（D948 PLAN §1-补 2）
STACK[2] /api/workspaces/:id
STACK[8] /api/workspaces/mine
PROBE /api/workspaces/mine      -> STATUS=404 BODY={"ok":false,"error":"workspace not found"}
PROBE /api/workspaces/conflicts -> STATUS=404 BODY={"ok":false,"error":"workspace not found"}
```

**后果链**：`/mine` 恒 404 → 部门工作区页对 `undefined.length` 抛错被 `console.warn` 吞掉 → 页面永久停在「加载中…」。

---

## 二、⚠️ 本卡的安全核心：先补守卫，再放开遮蔽

`/conflicts` 现在是 `router.get('/api/workspaces/conflicts', (_req, res) => ...)` —— **无任何身份守卫**。把它从"恒 404"变成"可达"，等于**新增一个未认证读端点**。因此顺序是硬的：

> **必须先给 `/conflicts` 加 `requireVerifiedRbac`（fail-closed），再调注册序。两步在同一 commit，不得拆。**

`/mine` 已有 `requireVerifiedRbac`（D947 P0 加），无需补。

---

## 三、写集（单域 win，4 件）

| 文件 | 动作 | 写者 |
|---|---|---|
| `src/routes/workspaces-api.ts` | 改：① `/mine`、`/conflicts` 提到 `/:id` **之前** ② `/conflicts` 加 `requireVerifiedRbac` ③ E-2：`/merge` 的 `canModifyWorkspace` 前移到形状校验之前 | code-a |
| `tests/routes/workspaces-mine-conflicts.test.ts` | 新建：F 判据的判别性夹具（含运行时探针 + 路由序源码断言） | code-a |
| `tests/routes/workspace-access-write-endpoint.test.ts` | 改：其"锁定现状 404"断言已过时，改为锁新语义（注释同步） | code-a |
| `task-state/D1002.json` | 卡片 | 队长 |

**不做（明确排除）**：

- **不碰 `src/middleware/auth.ts`** —— 该文件由 **D1000** 切片 A 持有（`JwtPayload +department`），本卡若碰即同文件双写者。K3 审计提的 `auth.ts:82` 陈旧注释（写「挂载于 server.ts:315」，实测 344）**移出本卡写集**，登记为待办。
- 不修 `GET /api/workspaces`（`:92`，`_req` 无守卫）的既有缺口 —— 那是 F-5，另立卡；本卡只保证"新变可达的端点必须有守卫"。
- 不碰 `src/routes/department-workspace.ts`（已 `@deprecated`，功能下线另立卡）。
- 不碰 `electron-renderer/**`、`scripts/**`、`docs/synova/coordination/**`。

---

## 四、base 与顺序（硬）

| 项 | 值 |
|---|---|
| base | **D947 合入后的 `main`**（#754 → #755 合并完成之后） |
| 理由 | `src/routes/workspaces-api.ts` 会被 D947 PR-2（`2ea4df10`）改写；基于旧 main 开卡必冲突 |
| 分支 | `fix/d1002-workspaces-route-order` |
| 前置 | D1001 与 D1000 切片 A 与本卡**可并行**（域不同、文件不重叠） |

---

## 五、完成标准（可执行判据）

| # | 判据 | 反例（改坏即红） |
|---|---|---|
| F1 | `GET /api/workspaces/mine` 带合法 JWT → **≠404**，manager 响应含本部门工作区 | 把 `/mine` 移回 `/:id` 之后 → 必红（404） |
| F2 | `GET /api/workspaces/conflicts` **无身份** → 403/401（**不得 200**）；带合法 JWT → 200 | 去掉 `requireVerifiedRbac` → 必红（无身份拿到 200） |
| F3 | 路由序**源码断言 + 运行时探针成对**：`/mine`、`/conflicts`、`/by-dept/:dept` 三者的注册下标均小于 `/:id` | 调错顺序 → 必红 |
| F4 | E-2：已认证低权用户 `PUT /api/workspaces/:id/merge` 打**非子工作区** id → **403**（原为 400） | 把权限检查移回形状校验之后 → 必红（400） |
| F5 | 三路径夹具：正常 / 降级（无 `JWT_SECRET` → 401 + 留痕）/ 边界（空 id、不存在 id、非子工作区、存在且无权限） | — |
| F6 | 变异体：至少对 F1、F2 各做 1 个「改坏即红」并给**原始输出 + 真实退出码 + 还原后 `git status` 空** | — |
| F7 | 现状锁定更新：`workspace-access-write-endpoint.test.ts` 内「锁定 404」注释与断言同步改写（**不得只改断言留旧注释**） | — |

**长度门禁**（研究院 P2 第 7 项）：实测 `workspaces-api.ts` = **344 行**，改完必须仍 **<500**；`server.ts`（530 行）与 `auth.ts`（512 行）已触线——**严禁顺手往那两个文件塞东西**。

---

## 六、执行形态（硬字段）

- Agent Teams 组队；队长**不下场写码**；1 独立自验 + 1 独立复核（不得由编码兼任）
- 单域 win 单 PR；≤12 文件；重型验证串行 ≤1
- 工作目录钉死本卡 worktree；禁 `rm -rf`；临时产物只落 `/tmp`
- 回执含**团队成员运行记录**（成员名 · 运行状态 · token · 共享任务 id 与状态）

---

## 七、回执格式

1. F1–F7 逐条原始输出（含变异体红态与还原后 `git status` 空）
2. 三路径夹具输出
3. 团队成员运行记录
4. `git diff --stat` + `ls-remote`（**基准写合后 main 的确切 SHA，禁用本地 main**）
5. 未清项（诚实登记）
6. 派单件指纹对账（三条坐标 × 三方值）

---

## 八、红线与退回

- 禁 `--no-verify` / `git stash` / force push；不碰 `scripts/audit/**`
- 单 PR 单域：只许动 win 文件（含 `task-state/**` 豁免）
- **先加守卫后放开遮蔽**，两步同 commit；顺序颠倒 = 退回
- 执行方**不判通过**；终审归 K3

---

## 九、未清项预登记

| # | 项 | 归属 | 处置 |
|---|---|---|---|
| 1 | `auth.ts:82` 陈旧注释（`server.ts:315` → 实测 344） | Win | 移出本卡（D1000 A 持有该文件）；D1000 A 合后随下一张改 |
| 2 | `GET /api/workspaces`（`:92`）无守卫无过滤 = 部门隔离 HTTP 旁路（F-5） | Win | 另立卡 |
| 3 | `department-workspace.ts:89-98` catch 无 degraded、前端不呈现（铁律 24/31 存违规）+ 该页已 `@deprecated` | Win | 功能下线另立卡 |
| 4 | 渲染层 15 个 fetch 点身份覆盖面 | **mac** | 本卡不碰；D1000 出白名单对照表后另立卡 |
| 5 | W1（`department` 无生产写入者）、W3（桌面无部门工作区消费点）、W4（读端零守卫）、W5（聚合是桩） | **产品/安全** | 待新号段立卡（Win 段从 D1003 起） |
