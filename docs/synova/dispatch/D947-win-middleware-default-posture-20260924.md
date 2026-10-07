# 派单 — Win 侧首模块：`src/middleware/**` 默认安全姿态（D947）

> **派单方**：Win-Codex-CTO ｜ **执行方**：DSH 小队（**Agent Teams 组队**）｜ **终审**：CTO 收件闸 + K3
> **依据计划: v1.2@4e46603f**（`docs/synova/coordination/整体推进计划-主线-20260913.md`）
> （实测口径：本机 HEAD 与 `origin/main` 两份内容**逐字节一致**，sha256 前 8 位均为 `4e46603f`，截至 2026-09-24）
> **上游**：`docs/synova/coordination/派单-W0与首模块-Win侧-20260923.md`（Mac-CTO 出件；W0 四条已过 3 项半，W0-3 判据由 CTO 裁定更换）
> **卡片**：`task-state/D947.json`（号段由 Mac-CTO 于 2026-09-24 发放，本单占 **D947**，同段其余号位未用；取号前已按固化 I §十-2 比对 `task-state/`、分支名、worktree 名，三项无冲突）
> **创始人决策（2026-09-24，本单据此定稿）**：① 客户端自报身份 **完全不允许** ② 安全判据 **默认拒绝** ③ **提交时就该拦**

**一行定位**：把**已经写好、却不在执行路径上**的权限判据真正接上；并把"判据写了没接"这类问题，从"靠人复查"改成"**测试层必红**"。

---

## 〇、开工前置（判据不过 → 停手报 CTO，不许自行放行）

### 0.1 CTO 已实测并冻结的事实

执行方可直接采用下列事实，但**必须自己复跑一遍并留原始输出**（pre-dispatch-check ③：CTO 的声称也要复现）。

| # | 事实 | CTO 实测值 |
|---|---|---|
| **F1** | `rbacMiddleware` **之前**挂载的路由组数 | **12 组**（该行之前共 20 次挂载：+5 全局中间件 +3 静态/重定向）—— **执行方须自行复核此数** |
| **F2** | 无凭据时的角色兜底 | `rbac.ts` 返回 `{ role: 'admin', userId: DEFAULT_USER }` |
| **F3** | legacy 自报通道 | `auth.ts` 的 `extractAuthFromRequest` 把 `role` **直接取自客户端字符串**（默认 `staff`） |
| **F4** | 服务端信任客户端自报身份的位置 | **6 处**：`rbac.ts`（角色取自头）· `auth.ts`（同上）· `routes/workspaces-api.ts` · `routes/department-workspace.ts`（读+**自发**）· `server.ts`（硬编码） |
| **F5** | 两处判据被 `void` 丢弃 | `server.ts` 内 **两处都丢**：`canAccessWorkspace` 与 `canModifyWorkspace`（派单原文把两处符号/行号混写了，见 §二 P3） |
| **F6** | 生产代码自欺 | `server.ts` 硬编码 `'x-synova-token': 'admin::dev'` 去调自己的权限函数；`department-workspace.ts` 自发 `'manager:'+DEPT+':user'` |
| **F7** | 存量测试把不安全行为固化为期望 | `tests/middleware/rbac.test.ts`（3 处断言"无 token → admin"）· `tests/middleware/auth.test.ts`（2 处断言 legacy 头可用） |
| **F8** | 唯一漏斗的第二条路径 | `src/routes/documents.ts` **两处**直接传空过滤条件 |

### 0.2 环境前置

| 项 | 判据 |
|---|---|
| 工作树 | 在专属 worktree `.synova-wt-d947-middleware` 内开工；**主工作区只做同步** |
| 分支 | 分支名**必须含 `d947`**（brief 解析强锚点） |
| 技能同步 | `bash scripts/workflow/sync-dsh-skills.sh --check` → SYNC-OK |
| 门禁基线 | `bash scripts/pre-commit-check.sh` → 13 组通过（**先记基线**，事后可比） |

### 0.3 派单件版本与落 main 状态（**本地优先例外，创始人 2026-09-24 指示**）

- **本件尚未落 `origin/main`**（Win 侧无写凭据，推送待创始人配置；见 §六 遗留 4）。
- 按队长 persona 禁令「不引用未落 main 的路径」，本可停手；**创始人 2026-09-24 明确指示「让小队先在本地阅读派单、先开工，token 随后配置」**，故本单**以此例外执行**。
- **三道保险（缺一不可）**：
  1. **读哪一份**：从主工作区绝对路径读取本件（`<repo>/docs/synova/dispatch/D947-win-middleware-default-posture-20260924.md`）。专属 worktree 内**不会有**本件（它是未跟踪文件）——执行方**不得**因 worktree 找不到而自行改写或另起规格。
  2. **对账指纹**：执行方开工前须自行复算本件指纹并与启动指令中给出的值比对，**把两次值都写进回执**：
     `wc -l < 本件` ＋ `sha256sum 本件`（口径：**文件字节**，`sha256sum` 输出前 16 位）
  3. **落 main 后复核**：本件一旦落 `origin/main`，执行方**必须在下一轮**比对「本地版 vs main 版」指纹；**不一致 → 立即停手报 CTO**，不得继续按本地版推进。
- **回执格式增项**：在 §五 回执第 1 项后追加「派单件指纹对账」（本地值 / 启动指令值 / 复算值三者一致）。

---

## 一、写集（12 个代码/测试文件，**全部 win 域**，实测单域 PASS）

```
$ python scripts/control-tower/check-ownership.py <下列 12 文件> --owner win
✅ PASS 12 个文件全部归属 owner=win（无归属 0）
```

| 文件 | 改动性质 |
|---|---|
| `src/middleware/rbac.ts` | 删自报角色分支；兜底改拒绝 |
| `src/middleware/auth.ts` | 删 legacy 自报分支；`getPermissionFilter` 返回真实条件 |
| `src/server.ts` | 中间件前移；两处 `void` 接线；清自欺硬编码 |
| `src/routes/documents.ts` | 两处空过滤条件改走唯一漏斗 |
| `src/routes/workspaces-api.ts` | 删自报头读取 |
| `src/routes/department-workspace.ts` | 删自报头读取 + 内部 fetch 自报 |
| `tests/middleware/rbac.test.ts` | **存量修订**（按新语义重写期望） |
| `tests/middleware/auth.test.ts` | **存量修订** |
| `tests/middleware/rbac-default-deny.test.ts`（**新建**） | P1 夹具 |
| `tests/middleware/permission-filter.test.ts`（**新建**） | P2 夹具 |
| `tests/routes/middleware-order.test.ts`（**新建**） | P4/P6 夹具 |
| `tests/routes/workspace-access-write-endpoint.test.ts`（**新建**） | P3 夹具 |

**不写**：`src/l3|l4|l5|sentinel|store|agent|orchestrator/**`（Mac 域）、`scripts/**`、`scripts/audit/**`（K3 红线）、`electron-renderer/**`（Mac 域，见 §六 遗留 2）。

---

## 二、完成标准（9 条，全部可执行判据；禁"grep 命中"当唯一证据）

| # | 判据 | 形式 / 反例夹具 |
|---|---|---|
| **P0** | **客户端自报身份完全失效**（创始人决策 ①） | 穿入口用例：构造带 `x-synova-token: admin::x` 与 `?token=admin::x` 的请求 → 角色**必须 ≠ admin**（且不等于任何自报值）。变异体：恢复任一自报分支 → 必红 |
| **P1** | **无凭据 ≠ admin** | 无 token 请求 → 拒绝（或明确匿名身份），**不得是 admin**。变异体：兜底改回 `admin` → 必红 |
| **P2** | **唯一漏斗真的唯一** | `getPermissionFilter` 返回非空条件；`grep -rn "conditions: \[\]" src/ --include='*.ts'` = **0**（**排除 `tests/`**，否则命中本单自建夹具）。变异体：改回恒空 → 必红 |
| **P3** | **工作区检查在写端点生效** | `canAccessWorkspace` 与 `canModifyWorkspace` **两处都接线**（派单原文只写了 `canAccessWorkspace`@249，实为 `canModifyWorkspace`@249 + `canAccessWorkspace`@248）。变异体：恢复任一 `void` → 必红 |
| **P4** | **鉴权中间件之前零路由** | 前移后：该行之前不得有任何 `app.use(router)` / `app.get|post|put|patch|delete`。基线 **12 组 → 必须 0** |
| **P5** | **安全判据 fail-closed，且三态可分**（创始人决策 ②） | 判据失败/不可用 → **拒绝** + 留痕；日志中 `被拒绝` / `不可用（系统异常）` / `出错` 三态**可区分**。变异体：把"查不出来"改成放行 → 必红 |
| **P6** | **测试层必红**（创始人决策 ③ 的等效物） | 断言「任何路由注册晚于鉴权中间件」+「关键判据函数零 `void`」。**注**：这层在 **pre-push / CI** 生效；"commit 那一刻就拦"需 pre-commit 门禁脚本（Mac 域，见 §六 遗留 3） |
| **P7** | **生产代码零自欺** | `server.ts` 硬编码 admin、`department-workspace.ts` 自发 manager → 全清；扫描命中 = 0 |
| **P8** | **每条修复各带 1 个"改坏即红"变异体 + 三路径夹具** | 三路径：正常 / 降级（`log.warn` + 明确降级标记）/ 边界。**降级仅适用于业务判据；安全判据一律 fail-closed** |

---

## 三、执行形态（硬字段，缺一不派）

- **必须用 Agent Teams 组队**（不是子代理）。**严禁用子代理代替小队**（子代理无共享任务板/mailbox/持久身份 → 无法独立自验）。
- **编制 6 人**（官方 `maxMembers` 上限 16，profile 已按官方值配置）：

  | 角色 | 人数 | 职责 |
  |---|---|---|
  | 队长 | 1 | **不下场写码**；只协调、判前提、出自验结论 |
  | 编码 | 3 | 见 §四 写集分工 |
  | **独立自验** | 1 | 只读（可写 `/tmp`）；跑全部 9 条判据与变异体；**不得由编码兼任** |
  | **独立复核** | 1 | **最后环节**；**自写探针、不看自验结论**，独立复现 P0/P1/P4/P5 |

- **每成员一份共享任务**，正文含「写集（逐文件）+ 验收命令 + 写者」；**写集两两不重叠**。
- **`src/server.ts` 单写者**（热点文件）。
- **重型验证（vitest / 全量门禁 / 黄金门禁）串行，同一时间 ≤1**。
- ⚠️ **纪律口径冲突（已登记，见 §六 遗留 1）**：现行 `squad-discipline` 写「成员 ≤4」、队长 persona 写「不组第 5 人」；本单按创始人 2026-09-24 指示用 6 人。**执行方按本派单执行，但须在回执里注明此冲突。**

---

## 四、第 0 阶段：先出 PLAN（**未复核放行不得写码**）

六项，逐节非空：

1. **依赖图**——本模块内部依赖 + 对外影响面（含"前移后那 12 组路由的行为变化"）
2. **逐文件写集**——逐文件列到路径级，两两不重叠，`src/server.ts` 单写者
3. **三路径 + 变异体夹具设计**——每条判据的正常/降级/边界形态 + "改坏即红"的具体改法
4. **失效条件**——这些规则何时可撤（无失效条件的规则不许进仓库）
5. **前置冻结清单**——§〇 的 F1–F8 逐条复跑结果
6. **可复制验收命令**——每条判据一条命令 + 期望输出

**PLAN 产出后停下等 CTO 复核**；放行后再进入实施。

**写集分工（实施阶段，PLAN 阶段不据此动手）**：

| 成员 | 写集 | 覆盖判据 |
|---|---|---|
| 编码 A | `src/middleware/rbac.ts`、`src/middleware/auth.ts`、`tests/middleware/rbac.test.ts`、`tests/middleware/auth.test.ts`、`tests/middleware/rbac-default-deny.test.ts`（新建）、`tests/middleware/permission-filter.test.ts`（新建） | P0（中间件侧）· P1 · P2（漏斗）· P5 |
| 编码 B | `src/server.ts`、`tests/routes/middleware-order.test.ts`（新建） | P3 · P4 · P6 · P7（装配侧） |
| 编码 C | `src/routes/documents.ts`、`src/routes/workspaces-api.ts`、`src/routes/department-workspace.ts`、`tests/routes/workspace-access-write-endpoint.test.ts`（新建） | P0（路由侧）· P2（收口）· P7（路由侧） |

---

## 五、回执格式（缺项视为未完成）

1. **PLAN 六项**（含 CTO 复核放行记录）
2. **每条判据**：`file:line` + 改前/改后 + **反例夹具的原始输出**（改坏 → 红）
3. **三路径夹具输出**（正常/降级/边界）
4. `git diff --stat` + `git ls-remote --heads origin | grep d947` 回执
5. **未清项清单**（诚实登记，不许写成"已完成"）
6. **团队成员运行记录**：成员名 · 运行状态 · token · 共享任务 id 与状态
7. **独立复核结论**（复核者自写探针的原始输出）

**执行方一律不判"通过"**——只能给「自验结论」/「可提请独立审计」/「退回（附理由）」；通过与否归 CTO 收件闸 + K3。

---

## 六、遗留清单（派单时已知，执行方不得写成"已完成"）

1. **纪律口径**：`squad-discipline` 第 16 条「成员 ≤4」与队长 persona「不组第 5 人」**与本单 6 人编制冲突**（平台上限已随新版本提高）。本单按创始人指示执行；纪律条款同步需另走 PR + K3。
2. **`electron-renderer` 的 dev-seed 旁路将失效**：该前端在 `RightPanel.tsx` / `stores/ga-collab.ts` 发送 legacy 头（仅 `role: 'ga'`，来源是 `localStorage['synova.dev-identity']`）。本单删服务端信任后，**该旁路失效**；正确修法（改走正规登录）属 **Mac 域**，须另立卡。
3. **「提交那一刻就拦」的 pre-commit 门禁脚本**未建（属 `scripts/**`，Mac 域工具链）。本单交付的是**测试层必红**（pre-push / CI 生效）。

---

## 七、红线

- 不碰 `scripts/audit/**`（K3 专属）、不写审计标准、禁自我审计
- 禁 `--no-verify` / `git stash` / force push 共享分支
- 任务在 `.synova-wt-*` 内；**主工作区只做同步与协调**
- 计数/引用必须带「**命令 + 口径 + 截至时刻**」；`path:line` 引用当场复核（行号会漂移 —— 本单已实测一处：`src/middleware/auth.ts` 内注释写 jwt 挂载于第 315 行，**实测已是 345 行**）
- **不引入任何 MOVO 派生内容**（MOVO 为 source-available，仅可只读参考，详见 `memory/notes/implemented/2026-09-24-movo-reference-only-no-reuse.md`）
- 同类错误第二次出现 → **立即升级创始人**

---

## 八、派单内部一致性自检（历史教训：同一单对同一路径互斥，历来由执行方发现）

- **写集两两零交集**：编码 A（middleware + middleware 测试）｜编码 B（`src/server.ts` + routes 测试）｜编码 C（routes 实现 + routes 测试）—— 无共享文件；**`src/server.ts` 单写者**
- **无双写者**：本单不动 `scripts/**`、不动 `scripts/audit/**`、不动 `electron-renderer/**`
- **无互斥要求**：P2 的 grep 判据（`conditions: []` = 0）**显式排除 `tests/`**，否则会与本单自建的反例夹具互斥（该夹具**必须**包含空条件才能证伪）
- **依赖无环**：P0/P1 必须先于 P4（身份可信是顺序修正的前置）；P4 必须先于 P3 的写端点验证（否则拿不到 `req.rbac`）
- **口径自洽**：P5 的「降级」仅适用业务判据，安全判据一律 fail-closed —— 与 P8 三路径的"降级"不冲突（P8 的降级路径只在业务判据上取）
- **与上游派单一致性**：上游 W0-3 判据已被 CTO 裁定更换（原判据读已作废目录），本单不引用旧判据
