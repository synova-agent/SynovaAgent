<!--
  SYNOVA-IMPL-D478: overflow 路由挂载 + graphStore 生产注入（D476 遗留①：D90 声称挂载实为仅 import）
  状态: dev doc | 2026-08-23 | 优先级 P1
  权威文档: docs/synova/audit-reports/2026-08-22-D338-org-audit.md（观察项）; D476 交付报告（遗留①「overflow 路由从未被 server.ts 挂载，D90 声称挂载实为仅 import；挂载缺口 + graphStore 生产注入建议另立任务」）; AGENTS.md 铁律 4/5/7（入口→交互→结果；后端能力≠用户可用功能——M3 接线类）
  依赖: D476（overflow 路由已加 requireAuth + 隔离——本任务把已建机制接到生产入口）
  并行: 写集=src/server.ts（Win 串行点，Claude 专属）+ tests/，与 DSH 线（scripts/、src/sentinel/）零重叠；当前无其他 Win 并行任务，若开并行须 worktree 隔离（D307）
-->

# SYNOVA-IMPL-D478 overflow 路由挂载 + graphStore 生产注入

## 1. 权威文档引用

* **D476 交付报告遗留①**：「overflow 路由从未被 server.ts 挂载（D90 声称挂载实为仅 import）——本任务为预防性硬化，挂载缺口 + graphStore 生产注入建议另立任务」。
* **铁律 4/5**（AGENTS.md）：交付不完整 = 写了代码没接线；后端能力 ≠ 用户可用的功能——overflow 三端点已实现 + 认证 + 隔离，但从未挂载 = 用户不可达，属 M3「机制建成未接线」。
* **注入/挂载先例**：src/server.ts L395 `setGraphBridge(graphStore)`（D231）；L311+ `app.use(gaDiagnosisRoutes)` 等挂载区。

## 2. 代码审计——现状（全部实测 file:line）

### 缺陷 A：overflow 路由只 import 未挂载（用户不可达）
* `src/server.ts` L68 `import overflowRoutes from './routes/overflow';` —— **全文件无 `app.use(overflowRoutes)`**（L311-340 挂载区实测无 overflow）。三个端点 `/api/overflow/dashboard/:enterpriseId`、`POST /api/overflow/simulate`、`GET /api/overflow/snapshots/:cycleId` 均不可达（404）。

### 缺陷 B：setOverflowGraphStore 从未被生产调用（graphStore 恒 null → 全部 503）
* `src/routes/overflow.ts` L23-24 `setOverflowGraphStore(store)` 定义存在，但 `src/server.ts` 无调用（`rg "setOverflowGraphStore" src/server.ts` 零命中）——即使挂载，graphStore 未注入也会 503「GraphStore 未就绪」。
* 生产 graphStore 可用：src/server.ts L120 `const graphStore = services.graphStore;`；L242 `app.locals.graphStore = graphStore;`；L395 `setGraphBridge(graphStore)`（注入先例）。

## 3. 实现方案

### 3.1 写集 (1 修改 + 1 新建)
| 文件 | 操作 | 说明 |
|------|------|------|
| src/server.ts | 修改 | ①挂载区（L311+，对齐 gaDiagnosisRoutes 等）加 `app.use(overflowRoutes)`；②graphStore 注入点（L395 setGraphBridge 同区）加 `setOverflowGraphStore(graphStore)`（graphStore 可为 null 时 fail-open：setter 接受 null 或调用前判空，与 overflow.ts 现有 `if (!graphStore) 503` 降级语义一致） |
| tests/routes/overflow-mount.test.ts | 新建 | 挂载断言用例：读取 src/server.ts 断言含 `app.use(overflowRoutes)` + `setOverflowGraphStore`（red=当前仅 import 零命中 → green=挂载+注入）——**独立新文件，与 D476 写集（tests/routes/overflow.test.ts）零重叠（verify-parallel 契约）** |

> 共享资源标注（S-8）：本写集不含 VERSION.md（接线修复，非门禁/工具行为变化，不 bump）；**src/server.ts 是 TASK-ROUTING 串行点（Claude 专属）**——DSH 不碰，本任务唯一改动文件；current-brief / 暂存区共享，串行触碰。

### 3.2 最终实现同 commit 回填（2026-08-23 交付）

> §3.1 方案两项决策（§4.5）均按结论落地；以下记录实现细节最终形态与增量说明（S-6）：

1. **挂载点**：挂载区末尾按现有顺序追加——`app.use(cockpitRoutes);`（D220-PHASE3）之后新增 `app.use(overflowRoutes); // D478`，位于 `/api/connector/sync` 内联路由与 404 兜底 handler 之前。与 §4.5 决策点 2 结论一致（挂载区追加，无偏离）。
2. **注入点与形态**：`setGraphBridge(graphStore); // D231` 之后同 try 块内新增 `if (graphStore) { setOverflowGraphStore(graphStore as import('./l4/graph-bridge').GraphStore); }`。与 §4.5 决策点 1 结论一致（setter，L395 同区，无偏离）。该 try 块位于 Promise executor 内、`app.listen` 之前——注入在 server 接受首个请求前同步完成（executor 同步执行先于 listen），无首请求 503 竞态；测试用例④静态守卫此顺序。
3. **判空守卫（§3.1 预留二选一，选「调用前判空」）**：`services.graphStore` 类型为 `unknown`（BootstrapServices `graphStore?: unknown`）且可缺席。选判空而非改 setter 签名：overflow.ts 属 D476 写集只读消费（§3.3/DS5 范围纪律），判空跳过注入时路由侧既有 `if (!graphStore) 503 degraded` 降级语义原样保持（铁律 31 降级信号传播）。
4. **类型收窄（§3.1 未展开的实现必要性）**：`unknown` 判空后不收窄，直接传参 `setOverflowGraphStore(store: GraphStore)` 必新增 tsc 错误（DS4 禁止；基线 28 个含 L394/L395 两条同型存量错误）。实现用 `as import('./l4/graph-bridge').GraphStore` 显式内联类型断言——类型源与 setter 形参同源（overflow.ts L23 同款内联类型先例），非 `as any`（铁律 38 合规）。L394/L395 既有存量错误不修（越界，DS5）；交付后 tsc 28=28，仅该两行行号 +1（挂载行插入位移）。
5. **测试交付形态（§4 表 +1 文件，实际 4 用例）**：tests/routes/overflow-mount.test.ts 新建 4 用例——①挂载存在（`app.use(overflowRoutes)`）②挂载先于 404 兜底（indexOf 顺序断言，防「挂在兜底后=静默失效」）③生产注入且实参 graphStore（`setOverflowGraphStore(graphStore`，带开括号匹配调用点而非 import 行）④注入先于 `app.listen(`（防首请求竞态）。RED 先行：修复前 4/4 失败（挂载/注入零命中实证缺陷 A/B）→ 修复后全绿。锚点字符串 `app.use((_req, res)`/`app.listen(` 在 server.ts 各唯一（grep -c 实测=1）。
6. **§4 集成可选用例不交付**：起全量 Bootstrap（DB/连接器/LLM）在单测环境不可行且脆弱；静态顺序断言已覆盖「挂载后置」「注入后置」两类接线失败模式，运行时可达性由部署后 checkpoint-deploy 验证。先例：静态接线断言 tests/routes/ga-enterprise.test.ts（D281 server.ts 断言）。
7. **回归证据**：tests/routes/ 全目录 26 文件 154 用例绿（含 D476 overflow.test.ts 6 用例只读回归）；vitest --changed 相关集 7 文件 50 用例具名单跑绿（首跑曾现 3 文件收集级失败、0 断言失败，复跑 3 次全绿——仓内已知 Windows 并行抖动模式，memory/parallel-session-stash-conflict 记录在案）；tsc 28=28 零新增。

### 3.3 不做的事
* 不改 overflow.ts 路由逻辑（D476 已交付认证+隔离，只读消费）。
* 不改 src/sentinel/、scripts/（DSH 地盘）。
* 不做溢出仪表盘前端（前端接入另排）。
* 不碰 客户A客户数据。

## 4. 测试要求（测试优先：先写 red → 再实现 green）

| 层 | 类型 | 数量 | 覆盖 |
|----|------|------|------|
| L2 | 静态/接线 tests/routes/overflow-mount.test.ts（新建） | +1 | 断言 server.ts 挂载 + 注入（grep 式静态断言）——**red=当前仅 import 无挂载 → green=app.use + setOverflowGraphStore 存在**；D476 的 overflow.test.ts 保持只读回归 |
| L2 | 集成（可选，能起 server 时） | +1 | 带 auth 请求 GET /api/overflow/dashboard/:orgId 不再 404（可达性） |

**RED 必须覆盖失败模式（S-5）**：用例①先以现状断言「server.ts 含 app.use(overflowRoutes) + setOverflowGraphStore」→ **修复前失败（零命中）** → 修复后通过。

## 4.5 决策参考（S-12）
* 决策点 1：graphStore 注入用 setter 还是 app.locals？
  * 参考系：第一性原理——overflow.ts 已暴露 setOverflowGraphStore（D476 就绪），setter 是最小改动；app.locals 需改路由读取逻辑扩大爆炸面。
  * 结论：`setOverflowGraphStore(graphStore)`（L395 setGraphBridge 同区）。
* 决策点 2：挂载位置？
  * 参考系：DeepSeek——最小侵入；overflow 路由已自带 requireAuth（D476），挂载在既有 auth 中间件（jwtAuthMiddleware L290）之后即可，与 gaDiagnosisRoutes 同区。
  * 结论：L311+ 挂载区按现有顺序追加。

## 5. 接线要求

| 新 export/函数 | 调用方 | 确认方式 |
|---------------|--------|---------|
| overflowRoutes 挂载 | src/server.ts `app.use(overflowRoutes)` | `grep -n "app.use(overflowRoutes)" src/server.ts` 命中 |
| setOverflowGraphStore 生产调用 | src/server.ts 注入点 | `grep -n "setOverflowGraphStore" src/server.ts` 命中且传 graphStore |

> 生产调用点（S-3）：server.ts 是唯一生产入口（启动装配）；测试调用不计入。

## 6. 完成标准

* **DS1 路由挂载**：`grep -n "app.use(overflowRoutes)" src/server.ts` 命中。
* **DS2 生产注入**：`grep -n "setOverflowGraphStore" src/server.ts` 命中且传 graphStore（`services.graphStore`）。
* **DS3 测试全绿**：`vitest run tests/routes/overflow-mount.test.ts tests/routes/overflow.test.ts` 全 pass（red 先行已证；D476 既有用例回归）。
* **DS4 零回归**：server 相关既有测试绿 + `tsc --noEmit` 零新增（28=28）。
* **DS5 范围一致**：`git diff --name-only HEAD^` 与 §3.1 写集一致（唯一文件 src/server.ts + 测试），无越界。
* **DS6 无绕过**：`grep -n "no-verify" .claude/bypass.log` 零命中。
* **DS7 推送 + CI**：`git push` 后 `git log origin/main..HEAD --oneline` 空 + CI 任务相关 job 绿（job 级）。

## 7. 自检清单

* [x] 每个代码审计 claim 有 file:line 证据（§2 全部 grep 实测，不是凭记忆）
* [x] 写集表标题后紧跟表格（无空行，devdoc_writeset.py 契约）
* [x] 测试 red→green 覆盖失败模式（仅 import 无挂载 → 挂载+注入；RED 4/4 失败已证）
* [x] 接线要求 ≥1 生产调用点（server.ts 启动装配：挂载 + 注入双落地）
* [x] DS verify 命令真实可执行、映射到实际用例
* [x] 版本编排：接线修复，非门禁/工具行为变化，不 bump VERSION.md
* [x] 不用 --no-verify

## 8. 交付声明（声称↔证据对照表，U4 D423）

| 声称 | 证据命令 | 预期 |
|------|---------|------|
| DS1 路由挂载 | grep -n "app.use(overflowRoutes)" src/server.ts | 命中 |
| DS2 生产注入 | grep -n "setOverflowGraphStore" src/server.ts | 命中且传 graphStore |
| DS3 测试全绿 | vitest run tests/routes/overflow-mount.test.ts tests/routes/overflow.test.ts | 全 pass |
| DS4 零回归 | vitest run 相关 + tsc --noEmit | 全绿 + 零新增 |
| DS5 范围一致 | git diff --name-only HEAD^ | 与写集一致（src/server.ts + 测试） |
| DS6 无绕过 | grep -n "no-verify" .claude/bypass.log | 零命中 |
| DS7 推送 + CI | git log origin/main..HEAD --oneline | 空（推送后） |

---

> 交付声明 DS 须与本文档 DS1-DS7 一一对应（S-10）；派发说明：src/server.ts 是串行点（Claude 专属），DSH 不碰；挂载后跑一次既有 server 相关测试防回归；暂存前查 session-registry（S-9）。
