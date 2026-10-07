---
north-star:
  服务用户: 企业主（老板）+ GA——他们只做一件事：双击安装包
  服务场景: 装好 SynovaAgent → 双击 → 开窗 → 首次使用引导（配 LLM → 进入主界面）；任何"还有另一个引导页面"的可能性都不该存在
  模块终态: 桌面端首诊页是唯一引导入口；旧 Web 安装引导（D283 四步向导）从仓库与路由两个层面退场，旧 URL 返回显式 410 而非静默 404；打包产物不含任何 Web 引导页；有回归守卫阻止它复活
  对齐北星: PRODUCT-BRIEF.md §二（最终受益者=企业主，部署后自己看信号和报告）+ §六（P0 没有这些不能给 GA 用：装机即可用）；线 1 done_definition「创始人双击安装包 → 装好 → 服务自启 → 开窗即用」
  完成标准: 在**最坏形态**（后端 cwd = 仓库根）下 `curl /app/setup.html ` 返回 410、三个旧引导文件不存在、仓库零残留引用；打包形态下包内无 app 目录且包内唯一引导为渲染层首诊页；守卫测试能拦住"重新放进一个引导文件/路由"
  当前进度: 打包形态实测**已无**旧引导（今日 14:36 在跑的真实安装版 `GET /app/setup.html ` = 404）；但旧引导三文件仍在仓库、静态挂载随 cwd 漂移、无任何回归守卫、runbook 只有文档声明（D603 型"文档声称有收敛、物理零执法"）
---

# SYNOVA-IMPL-DSH-D716-1-5：安装引导单一入口（1-5 双引导收敛）

> ⚠️ **本 spec 已实施完毕，由《DSH 权威手册 v1（2026-09-17）》取代**（`docs/synova/research/DSH权威手册-v1-20260917.md`，见其 §6.5）。
> **被取代的部分（实测证据）**：
> ① 「**但旧引导三文件仍在仓库**」→ **三文件已全部删除**（`app/setup.html` / `app/js/setup.js` / `app/css/setup.css` 均 `不存在`）——即写集「3 删除」已执行。
> ② 「**无任何回归守卫**」→ **两个守卫生成**：`tests/routes/setup-guide-retired.test.ts`、`tests/electron/dual-guide-packaging-guard.test.ts` 均存在。
> ③ 「src/server.ts 的 **L300** 仍 `app.use('/app', express.static(...))`」→ **L300 现为 `app.locals.agentMemory = agentMemory;`**，静态挂载已不在该行（行号漂移）。
> ④ 写集「2 修改 + 2 新建 + 3 删除」**全部完成**；`setupGuideGoneRouter` 在 `src/server.ts` 命中 **2** 处（定义 + 挂载）。
> **本 spec 仅存的阅读价值**：410 显式下线路由的**设计形态**（挂载顺序必须早于静态挂载）、以及「缺陷 C/D（P2，登记不修）」两条——这两条**未在本轮复核，状态未知**。
> **不要再引用本文的「现状材料」**（`file:line` 已全部漂移）。现状请按 `git ls-files app/` + `grep -n setupGuideGoneRouter src/server.ts` 现查。

> 状态: dev doc（spec） | 2026-09-13 | 优先级 P0 | 证明层级: L1 交互层（HTTP 路由）+ 构建期（Electron 打包配置）
> 验收点: `docs/synova/product-lines/product-lines.yaml` 线 1 **1-5「安装引导单一入口（双引导收敛）」**（当前 `uncommitted`，D712 场景证据判 `fail`）
> 归属警示: src/server.ts = **Claude 专属**（`.github/CODEOWNERS` 串行点表）→ 本 spec 由 DSH dev-doc 写，**实施归 Win 线**（Claude Code）
> 上游: D518 收敛声明（runbook）、D590 410 下线先例、A-G2 偏差登记、D712 证据（1-5 = fail）

## 1. Authority Doc Verification

**权威 ① — 派单**（`docs/synova/coordination/派单-下一批四线并行-20260913.md` §D716）:

> 现状（实测）：src/server.ts 的 L300 仍 `app.use('/app', express.static(...))`，且 app/setup.html + app/js/setup.js 仍在仓库 → 打包态出现**双安装引导入口**（原文行号引用按本文档体例规范化为 L 形式，语义不变）
> 必答：收敛到哪个入口？另一入口如何退场（删除 or 重定向）？对既有用户的书签/URL 兼容怎么处理？验收怎么物理证明"只有一个入口"？

**权威 ② — D518 收敛声明（runbook，只有文档层）**（`docs/synova/runbooks/desktop-dev-prod.md` §一）:

> **用户唯一路径 = 安装包双击。** 命令行路径全部标注「仅开发」。
> dev/prod 判定唯一事实源：`app.isPackaged`（Electron 官方标准；`SYNOVA_ELECTRON_*` env 仅供测试注入）。

**权威 ③ — 410 显式下线先例**（src/server.ts L89-92，D590 裁决②）:

> `// ═══ D590 裁决②: upload-v2 下线 — 410 Gone 显式（非静默 404），指路替代入口 ═══`
> `export const uploadV2GoneRouter: Router = Router().all(...)`

**权威 ④ — 验收点与偏差台账**:
- `docs/synova/product-lines/product-lines.yaml` 线 1：`1-5 desc: "安装引导单一入口（双引导收敛）"`、`note: "S3-6：双引导并存未收敛"`
- `docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v1.md`：「A-G2 双引导入口并存 │ P2 │ 仍成立（setup.html/setup.js 与 admin.js onboarding 共存）」

**权威 ⑤ — 铁律**（`AGENTS.md` / `CLAUDE.md`）: 4/5（入口→交互→结果；追调用链）、11/24（降级显式，禁静默）、37（dead code 入仓库即违规：删除旧文件 + grep 零引用）、38（`as any` 零容忍）、39（五层边界）。

> **D603 教训（本 spec 的核心动机）**：`CLAUDE.md` 明文记载——4 条铁律"文档声称有执法、实际零执法"（scripts/ 全目录 grep 零执法逻辑）。1-5 的现状同型：runbook 声明了收敛，但没有任何物理机制保证它；本 spec 的交付物必须**含可执行的守卫**，否则只是第二份声明。

## 2. Problem Statement

**要解决的问题**：安装引导有两个可能入口，收敛只做了一半。

- **旧入口（D283 客户自安装引导）**：app/setup.html + app/js/setup.js （4 步向导：Welcome → Configure → Test → Done），由 src/server.ts L300 的 `app.use('/app', express.static(path.join(process.cwd(), 'app')))` 提供。它问的是"配置服务器连接"（localStorage 里的 serverUrl），而 D518 §三 已裁定桌面端**不做远程外连配置**（本机自 spawn）——即这个向导问的问题在产品上已经作废。
- **新入口（唯一目标）**：桌面端 Electron 壳加载渲染层首诊页（`electron/main.cjs` L129 `loadFile(...renderer/index.html)`），首启走 LLM 配置卡片（D575）。

**关键的实测纠正（先于设计）**：派单原文写"打包态出现双安装引导入口"——**该表述不成立**。今日 2026-09-13 14:36 在本机运行中的**真实安装版**（`/Applications` 下已安装的 SynovaAgent，后端日志 `devMode=false`）+ `curl` 实测：

| 请求 | 实测 | 说明 |
|---|---|---|
| `GET /api/healthz` | 200 | 后端活着（可对照） |
| `GET /app/setup.html ` | **404** | 包内 `Contents/Resources/app` 目录不存在（静态目录空 → Express 落空） |
| `GET /app/index.html ` | **404** | 同上（整个旧 Web UI 在打包态都不可达） |
| `GET /` | **302** | 重定向到 `/app/index.html ` → 下游 404（悬挂重定向，见 §4.4-E） |

根因：静态挂载用 `process.cwd()`，而打包态后端 cwd = `Contents/Resources`（`electron/main.cjs` L254 传 `cwd: process.resourcesPath`），且 `build-synova.cjs` 的 `files` / `extraResources` **不包含** app/ → 目录不存在。**双引导在当前仓库形态下是"潜伏"的，不是已发生的**：任何 cwd = 仓库根的场景（开发 `npm run dev`、服务端部署形态、未来 spawn 配置变化）都会把它复活；D712 的 200 证据正来自"在仓库根起 `dist/backend.mjs`"这种形态。

**所以真正要修的是三件事**（而不是"删掉一个能打开的页面"）：

1. **退场**：旧引导资源（三个文件）与它的 URL 一起退场——退场必须**与 cwd 无关**（显式 410 路由 + 文件删除），不能靠"目录恰好不存在"。
2. **收敛**：唯一引导入口落到渲染层首诊页，并有生产调用点证据（不是文档声称）。
3. **守卫**：加回归守卫——任何人重新放回引导文件/路由、或把 app/ 打进安装包，测试必须红（否则这次收敛会和 D518 一样只是一句话）。

**为什么现在做**：1-5 是线 1 唯一 failed 点，卡住整条桌面端线的"机器绿"（其余点已机器绿待 K3）；也是 A-G2/S3-6 的存量缺口。

## 3. Q0-Q4

### Q0: 定位 — 项目拼图 + 文件审计

**a) 项目拼图**：Synova = 装机即可用的 AI 诊断 Agent。本任务在 **L1 交互层**（HTTP 路由退场）+ **构建期**（打包配置只读守卫）：把"用户唯一路径 = 安装包双击"从文档声明变成物理事实。不新增功能，只做退场 + 守卫。

**b) 文件审计**（2026-09-13 实测）：

| 对象 | 现状 | 结论 |
|---|---|---|
| app/setup.html | 存在（标题 `Synova — Setup`；D283 四步向导骨架） | **删除** |
| app/js/setup.js | 存在（D283 向导逻辑：步骤状态机 + serverUrl localStorage + healthz 测试） | **删除**（仅被 setup.html 引用） |
| app/css/setup.css | 存在（向导样式；全仓仅 app/setup.html 引用） | **删除** |
| src/server.ts L300 静态挂载 | 存在（`process.cwd()` 依赖） | **保留**（旧 Web UI 的其他页面属线 2 交互域，不在本任务收敛范围）；只在其**前面**插入 410 |
| src/server.ts L89-92 的 410 先例 | 存在（upload-v2 下线） | **复用该模式**（形态对齐，不另造机制） |
| app/js/admin.js 的 onboarding（D246，5 步 Register/Invite/Import/Diagnose/View） | 存在 | **不属"安装引导"**（是产品内管理台的使用引导）→ 明确排除，见 §6 |
| 其他 app/ 页面（登录/控制台/报告/驾驶舱等 14 个 html） | 存在 | **不动**（线 2 交互域；打包态本就不出货） |
| `electron/main.cjs` 的 prod/dev 分支 | 存在（prod `loadFile` 渲染层；dev 三分支） | **本 spec 不改**（属 Mac 域；dev 回退加载 `/app/login.html ` 登记为边界事实，见 §6） |
| `build-synova.cjs` 的 `files` / `extraResources` | 不含 app/ （本 spec 的**只读**断言对象） | **不改**，加守卫测试防回归 |
| 1-5 的物理验证机制 | 无（D712 靠人工 curl + 手写 txt） | **新建**：vitest 路由断言 + 打包形状断言（机器可重跑） |

**c) 决策**：只出 spec + 让 Win 实施；不动 electron 域；不做跨域重写；退场用"删除 + 410"而非重定向。

### Q1: 调研 — 业界最佳实践 / 顶尖团队 / memory 历史教训

**a) 业界最佳实践（下线一个入口的标准做法）**：显式"已下线"信号（HTTP 410 Gone）优于静默 404 —— 客户端/书签使用者能区分"暂时坏了"与"永久搬走了"；同时**不要**用 301/302 把旧入口自动送到新入口之外的地方（会把用户带进另一个未预期界面）。参考（公开文档，取模式）：

- MDN HTTP 410 Gone（永久不可用，语义强于 404）：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/410>
- 浏览器/爬虫对 404 vs 410 的处理差异（gooogle 官方搜索文档：410 表示永久移除，加速索引清理）：<https://developers.google.com/search/docs/crawling-indexing/http-network-errors>

**b) 本仓先例（优先于外部）**：
- D590 裁决②：`uploadV2GoneRouter` 用 410 + "指路替代入口"，且**挂载在 JWT 之前**（让未认证客户端也看到显式下线，而不是 401 混淆）——本 spec 沿用同一形态与同一挂载纪律。
- D518 runbook：prod/dev 判定唯一事实源 `app.isPackaged`；用户唯一路径 = 安装包双击。
- D283 spec（`docs/plans/codex/implementation/SYNOVA-IMPL-D283-Setup-Guide-20260730.md`）：该向导的原始设计里"Electron 首次启动检测后加载 setup.html"从未实现（该 doc 自述"main.cjs 没有此逻辑"）→ 这就是它成为僵尸入口的根因（M3 型：页面在、链没接）。

**c) memory 历史教训**：
- **D603 执法拉平**：文档声称有机制 ≠ 有机制；本 spec 的 Done 必须含可执行守卫（§7 T-guard 组）。
- **M2 声称 vs 事实**：本 spec 主动纠正派单原文的错误表述（"打包态双引导"不成立），并把"已 404"与"已收敛"严格区分开——前者是环境巧合，后者才是产品属性。
- **铁律 37**：dead code 入仓库即违规（删文件 + grep 零引用）——旧引导三件套（app/ 目录下的 setup 页 + 向导 js + 向导 css）是活代码但在产品里已无消费者，同样按退场处理。
- **铁律 11/24**：410 的响应体必须是**人话**（不是空 body），否则仍是"静默失败"的变体。

> **参考：第一性原理（退场要与 cwd 无关、收敛要有生产调用点、声明必须有守卫）+ 本仓 D590 410 先例 + D603 教训 → 结论：删除旧引导三件套 + 410 显式下线 + 渲染层首诊页为唯一入口 + 守卫测试。**
> 本轮为对外检索（1 轮 2 查询，取模式与链接）；结论以本仓实测为准。

### Q2: 范围 — 正确的最简方案

**做什么**（实现在 Win 线）：

1. src/server.ts 新增退场路由：`setupGuideGoneRouter`（410 Gone + 人话 HTML 指路），**挂载在静态挂载 L300 之前**（顺序即优先级；与 D590 同纪律）
2. 删除旧引导三件套：app/setup.html 、app/js/setup.js 、app/css/setup.css 
3. 新增测试（vitest）：① 410 行为断言（状态码 + body 含指路）② 挂载顺序断言（410 先于静态）③ 引导唯一性守卫（app/ 下不得存在 setup* 文件）④ 打包形状守卫（只读断言 `build-synova.cjs` 的 `files`/`extraResources` 不含 app/ ）
4. 更新 runbook `docs/synova/runbooks/desktop-dev-prod.md`：把"声明"补成"机制 + 旧 URL 锚 + 守卫测试名"（消 M7 文档-实现漂移）
5. 交付证据（curl 输出 + 测试输出），供 1-5 判定

**不做什么**（含文件路径，逐条见 §6）：不收敛 GA 控制台/登录页/驾驶舱（app/ 其余 14 个页面，线 2 交互域）；不改 `electron/main.cjs`（Mac 域）；不改 `build-synova.cjs`（只读断言）；不改 `electron-renderer/` 渲染层（D575 首诊页已成立）；不改 D246 管理台 onboarding（app/js/admin.js ）；不改 `docs/synova/product-lines/product-lines.yaml`（台账归产品线维护者/CTO）。

### Q3: 验收 — 入口 → 交互 → 结果

| 环节 | 内容 |
|---|---|
| **入口** | 用户：双击安装包（唯一路径）；开发者：`/app/setup.html ` 这一旧书签 URL |
| **交互** | 打包态：渲染层首诊页（LLM 配置卡片）→ 主界面；旧 URL：410 页面（人话说明已下线 + 指路唯一入口） |
| **结果** | ① 旧 URL 在任何 cwd 形态下都是 410（不是 200、也不是静默 404）② 仓库无旧引导文件（grep 零引用，除退场路由定义）③ 包内无引导页（`Resources` 无 app 目录）④ 守卫测试红/绿可复现 |

### Q4: 契约与测试（铁律 47/48，写码前定义）

- **路由契约**：`setupGuideGoneRouter` 的输入（HTTP 请求）/输出（410 + `Content-Type: text/html` + body 含唯一入口指路）/降级（无——纯静态响应，无 IO，不抛）。
- **删除契约**：三文件删除后，app/ 目录仍存在（其他页面在）→ `express.static` 仍挂载，不报错；`/app/setup.html ` 命中 410 路由（更早）而非 static。
- **测试契约**：见 §7（L1 单元 / L2a 接线 / L2b 降级 / L2c 边界 + T-guard 组）。

## 4. Current State（2026-09-13 实测，全部 grep/read/curl 当场验证）

### 4.1 双入口的物理事实

| # | 事实 | 证据 |
|---|---|---|
| A | 静态挂载点（`process.cwd()` 依赖） | src/server.ts L300 `app.use('/app', express.static(path.join(process.cwd(), 'app')))` |
| B | 旧引导三件套在仓库 | app/setup.html 、app/js/setup.js 、app/css/setup.css 三文件均在（`git ls-files` 可验） |
| C | `setup.css` / `setup.js` 唯一引用者是 `setup.html` | 全仓 grep 命中仅 app/setup.html （css L8、js L20）+ 自身注释 + 一处历史研究工具 |
| D | 无任何代码/CI 引用 `/app/setup.html ` | `.github/workflows/` grep 零命中；`scripts/` 零命中（`scripts/deploy/smoke-test.sh` 只探 `/app/login.html ` 等 4 个页面，不含 setup） |
| E | 历史审计工具引用（已被取代，非门禁） | `docs/synova/research/A线-产品完整性缺口审计-20260801/_tools/audit-grep.sh` L42 以 app/js/setup.js 作为 A1 向导存在的证据（基线 commit 431e16b；不被 CI 执行） |
| F | 目标入口（唯一引导）在渲染层 | `electron/main.cjs` L128-129（prod `loadFile(...renderer/index.html)`）；首诊卡片 `LlmSetupCard` 被 `WelcomeScreen` 引用（electron-renderer 下 components 目录） |
| G | app/ 下唯一带 Setup 语义的页面就是 setup.html | 15 个 html 的 `<title>` 全量核对：仅 `Synova — Setup` 是引导；其余为 Login/Dashboard/GA/Report/Import/Loops/Chat/Admin/Control Tower/驾驶舱 |

### 4.2 打包形态实测（今天 14:36，真实安装版在跑）

| # | 事实 | 证据 |
|---|---|---|
| H | 运行中的安装版后端：`devMode=false`，dbPath = `~/Library/Application Support/synova-agent/data/synova.db` | `~/Library/Application Support/synova-agent/logs/backend.log`（packaged app 日志，cwd 指向 `…/SynovaAgent.app 的 Contents/Resources`） |
| I | `GET /app/setup.html ` → **404**（当前实时） | `curl -s -i http://127.0.0.1:18790/app/setup.html `（HTTP/1.1 404，`Content-Type: application/json`） |
| J | `GET /app/index.html ` → **404**；`GET /` → **302**（指向不存在的页面） | `curl -o /dev/null -w '%{http_code}'` 三条 |
| K | 包内 `Contents/Resources` **无 app 目录** | `ls release/mac-arm64/SynovaAgent.app 的 Contents/Resources`（只有 dist / extensions / node_modules / renderer / app.asar 等；`release/mac` 同） |
| L | 打包配置不携带 app/ | `build-synova.cjs` 的 `files` 白名单（electron/main.cjs 等）+ `extraResources`（dist、dist/renderer、extensions、node_modules 原生模块） |

### 4.3 D712 证据链的读法（为什么 1-5 判 fail 是对的）

D712 的 1-5 证据（`docs/synova/product-lines/evidence/D712-mac-20260913/1-5-dual-guide-check.txt`）记录：

> `## curl /app/setup.html （旧 Web 引导仍可达）` → `HTTP 200` … `## 静态挂载点（src/server.ts ）` → `300: app.use('/app', express.static(...))` … `## 旧引导文件仍存在`

其 `source` 字段写明是"起 `dist/backend.mjs` 后 curl"——即在**仓库根**启动后端（cwd = 仓库根）→ app/ 目录在 → 200。**判 fail 的核心理由不是"200 本身"，而是**：① 退场依赖 cwd 巧合（同一份代码在打包态 404、在仓库根 200）；② 旧引导资源仍在仓库（随时可复活）；③ 无守卫（任何人再放一个引导页不会有任何信号）；④ runbook 只有文档声明（D603 型）。这四条在打包形态实测 404 之后**依然全部成立** → 1-5 维持 fail 是正确的，本 spec 收敛后才有资格翻绿。

### 4.4 缺陷与相邻发现

- **缺陷 A（P0，本任务）**：退场不成立——app/ 目录依赖 cwd；三件套在仓库；无守卫。
- **缺陷 B（P1，本任务同批修）**：runbook 的收敛声明无物理机制（`docs/synova/runbooks/desktop-dev-prod.md` §一），doc 说"用户唯一路径=安装包双击"，代码事实未收敛 → M7 型漂移。
- **缺陷 C（P2，登记不修）**：src/server.ts L301-302 的 `/` 与 `/login` 恒重定向到 `/app/ *.html`；打包态下游 404 → 用户手工打开 `127.0.0.1:PORT` 会看到"302 后 404"（悬挂重定向）。不是引导入口问题（本任务不修），但登记（归属：线 2 交互 / Win）。
- **缺陷 D（P2，登记不修）**：`electron/main.cjs` L140 的 dev 回退分支加载 `/app/login.html `（仓库根 cwd 下可达）——dev-only 且是登录页非引导页；但它使"dev 形态下渲染层入口可被旧 Web UI 替代"，属 Mac 域（`electron/`），另起任务处理。
- **相邻事实 E（不改）**：app/js/admin.js 的 D246 onboarding（5 步：Register/Invite/Import/Diagnose/View）是**产品内管理台使用引导**，与"安装/首配引导"不同维度；A-G2 把它与本项并列登记，本 spec 明确排除并说明判据（§6），避免"顺手删掉别人的功能"。

## 5. What We Build

### 5.1 写集 (2 修改 + 2 新建 + 3 删除)

| 文件 | 操作 | 说明 |
|------|:---:|------|
| src/server.ts | 修改 | 新增 `setupGuideGoneRouter`（410 + 人话 HTML 指路，形态对齐 L89-92 的 D590 先例）并**挂载在 L300 静态挂载之前**；不动 `/`、`/login` 重定向与 `/app` 静态挂载（非目标，§6） |
| app/setup.html | 删除 | D283 旧安装引导页面（4 步向导骨架）——退场（URL 由 410 承接） |
| app/js/setup.js | 删除 | D283 向导逻辑（仅被 setup.html 引用，实测） |
| app/css/setup.css | 删除 | 向导样式（仅被 setup.html 引用，实测） |
| tests/routes/setup-guide-retired.test.ts | 新建 | 410 行为 + 挂载顺序 + 引导唯一性守卫（真实 express app + `listen(0)` + fetch，铁律 12）。精确文件名声明（**不**用目录级：目录级会与已合 spec 的同目录文件误判重叠 → CI verify-parallel 假阳，本次实测 D309 先例） |
| tests/electron/dual-guide-packaging-guard.test.ts | 新建 | **只读**断言 `build-synova.cjs` 的 `files`/`extraResources` 不含 app/ （防把旧 Web UI 打进包 → 打包态重造双引导）。精确文件名声明同上 |
| docs/synova/runbooks/desktop-dev-prod.md | 修改 | §一 收敛声明补三行：退场机制（410 路由名 + 挂载顺序）、旧 URL 锚、守卫测试文件名（消 M7 漂移；表述与代码事实一致） |

> **证据落盘不在本写集（跨线交付物）**：evidence 由 Mac/CTO 写入 docs/synova/product-lines/evidence/ 目录（Win 侧原始输出贴 PR 描述，见 §5.5 / §10 DS9）——本写集表只列 Win 将实际改动的文件，避免与 spec 1 的写集表重叠（verify-parallel 口径）。

### 5.2 关键实现契约

**A. 退场路由（src/server.ts ）**

```ts
// ═══ D716/1-5: D283 旧 Web 安装引导下线 — 410 Gone 显式（非静默 404），指路唯一入口 ═══
// 形态对齐 L89-92 的 D590 先例；挂载点必须早于 /app 静态挂载（L300），否则 static 命中胜出。
export const setupGuideGoneRouter: Router = Router().all('/app/setup.html', (_req, res) => {
  res.status(410).type('html').send('<h1>此安装引导已下线</h1>...');
});
```

契约（铁律 47 三段）：
- `@input` — 任意方法/任意查询串的 `/app/setup.html `（`all` 覆盖 GET/POST/HEAD）
- `@output` — HTTP **410** + `Content-Type: text/html` + body = 人话三段：① 此页已下线 ② 唯一入口 = 双击安装包（桌面端）③ 开发者路径见 runbook `docs/synova/runbooks/desktop-dev-prod.md`
- `@degraded` — 无（纯静态响应，无 IO，不抛）
- 挂载位置：`app.use(setupGuideGoneRouter)` 必须在 L300 `app.use('/app', express.static(...))` **之前**（顺序 = 优先级；实现后由测试断言，不靠注释约定）

**B. 为什么 410 而不是 302 重定向（必答项：书签/URL 兼容）**

| 选项 | 结论 | 理由 |
|---|---|---|
| 删除文件、无路由 | ✗ | 静默 404：用户无法区分"坏了"与"搬走了"；且与"已收敛"无法区分（打包态本来就 404 = 无法验收） |
| 302 → `/` 或 `/app/index.html ` | ✗ | 会把书签用户送进**另一个旧 Web 页面** → 实质上制造第三个入口，与收敛目标相反；且打包态下游 404（悬挂） |
| **删除文件 + 410 + 人话指路** | ✅ | 显式、可机器验证（状态码 410 唯一）、零歧义；与 D590 先例同形态 |

**兼容性事实依据（决定"不必做重定向兼容"）**：
- 无存量生产用户：本仓无客户部署记录，首个客户（客户A）仍在作战手册阶段（`docs/plans/codex/SYNOVA-客户A-第一曲线作战手册-20260804.md`）；安装版只在开发机装过 → 旧 URL 的书签只可能存在于开发机。
- 开发机书签的"兼容"= 410 页面里写清楚去哪（人话指路），而不是自动跳转（跳转反而误导）。

**C. 删除的物理后果（必须显式声明，防臆测）**
- `express.static` 仍挂载 app/ （其余 14 个页面与 js/css 不动）→ 目录存在，静态中间件不报错；`/app/setup.html ` 命中更早的 410 路由。
- app/setup.html 删除后，app/js/setup.js 、app/css/setup.css 成为零引用死文件（铁律 37）→ 一并删除；grep 校验见 §8。

**D. 守卫测试断言清单（防复活；这是"声明变物理"的关键）**

| 守卫 | 断言 | 防的是什么 |
|---|---|---|
| G-1 410 行为 | `GET /app/setup.html ` → 410 且 body 含"唯一入口/安装包"字样 | 退场被静默改回 static 提供或 404 |
| G-2 挂载顺序 | 源码顺序断言：`setupGuideGoneRouter` 的 `app.use` 出现在 `/app` static 之前（读 src/server.ts 文本，正则定位行号比较） | 有人把新路由挂到 static 之后（行为等价于没挂） |
| G-3 引导唯一性 | app/ 目录下不得存在文件名匹配 `setup*` 的文件（`fs.readdirSync`） | 有人把旧引导文件放回来 |
| G-4 打包形状 | 读 `build-synova.cjs` 文本：`files` 白名单与 `extraResources` 中不得出现 app/ 条目 | 有人把整个 app/ 打进安装包 → 打包态重造双引导 |
| G-5 唯一入口在渲染层 | 断言 `electron/main.cjs` 含 prod `loadFile(...renderer/index.html)`，且 `LlmSetupCard` 被 `WelcomeScreen` 引用（读文件断言，不引入 2 个组件的渲染测试） | 有人把首诊页拆掉，导致"退场了但没有新入口" |

> G-4/G-5 只读断言 electron 域文件（不修改）→ 不产生跨域写（§5.5）。

### 5.3 删除清单

| 文件 | 原因 | 引用核验 |
|---|---|---|
| app/setup.html | D283 旧安装引导（产品已改桌面端双击路径） | grep 全仓：仅自身 + 历史研究工具 |
| app/js/setup.js | 仅被 setup.html 引用 | 同上（唯一引用 = 被删页面） |
| app/css/setup.css | 仅被 setup.html 引用 | 同上 |

### 5.4 决策参考（S-12/D333）

| 决策点 | 选项 | 参考系 | 结论 |
|---|---|---|---|
| 1. 收敛到哪个入口 | A 桌面端渲染层首诊页 / B 旧 Web setup.html / C 两个都留（改文案） | D518 已裁"用户唯一路径 = 安装包双击"；实测打包态只出货渲染层（`Resources` 有 renderer、无 app）；产品定位（老板双击安装包，零命令行） | **A** |
| 2. 退场方式 | A 只删文件 / B 只加 410 / C 删除 + 410 / D 302 重定向 | 第一性原理（退场必须与 cwd 无关）；D590 先例（410 显式 + 指路）；诊断"坏了 vs 搬走了"的可区分性要求 | **C** |
| 3. 书签兼容 | A 302 自动跳转 / B 410 + 人话指路 / C 不管（404） | 无存量生产用户（§5.2-B 证据）→ 兼容成本≈0；A 会制造第三个入口；C 不可验收 | **B** |
| 4. "引导"定义与排除集 | A 仅安装/首配引导 / B 含登录页与所有首屏 / C 含 D246 管理台 onboarding | 1-5 原文"安装引导单一入口"；实测 app/ 下仅 setup.html 是 Setup 语义（§4.1-G）；登录页是鉴权入口、控制台是产品界面、D246 是产品内使用引导——三者与"安装引导"不同维度 | **A** |
| 5. `/` 与 `/login` 悬挂重定向 | A 本批一并修（打包态显式 410/park 页） / B 登记不修 | 不是引导入口（决策 4）；改它要判"服务端部署形态是否仍需要 Web 控制台"（产品级问题）→ 不在本批；但必须登记（§4.4-C） | **B**（登记） |
| 6. dev 回退加载旧 Web 登录页 | A 本批改 / B 登记不修 | `electron/` = Mac 域（跨域写会撞车）；dev-only；非引导 | **B**（登记，§4.4-D） |
| 7. 守卫归属 | A 改 `build-synova.cjs` 加断言 / B 只读测试断言 | 跨域写（electron 域=Mac）；只读断言已能拦住"打进包"这一类 | **B** |
| 8. 证据落盘归属 | A Win 写 evidence 目录 / B Mac/CTO 写 | `docs/synova/product-lines/` = Mac 域（CODEOWNERS）+ 1-5 状态推进由产品线维护者执行；Win 在 PR 贴原始输出 | **B**（Win 产出原始输出 → Mac/CTO 复核落盘） |

> 收敛检查：八项决策两参考系（第一性原理 + 本仓 D518/D590 先例 + CODEOWNERS 边界）均指向同一答案，无分歧。**参考：第一性原理 + 本仓 D518/D590 先例 + 跨域边界**。

### 5.5 跨线边界（写集到文件级，硬约束）

| 内容 | 归属 | 文件 |
|---|---|---|
| 410 路由 + 挂载顺序 | **Win（Claude Code）** | src/server.ts |
| 旧引导三件套删除 | **Win** | app/ （三个文件） |
| 守卫测试 | **Win** | `tests/` 下新建两个测试文件 |
| runbook 措辞更新 | **Win** | `docs/synova/runbooks/desktop-dev-prod.md` |
| evidence 落盘 + 1-5 状态推进 + 台账绑定 | **Mac/CTO**（产品线域） | `docs/synova/product-lines/` |
| 不改（只读断言） | — | `electron/main.cjs`、`build-synova.cjs`、`electron-renderer/` |

- **共享资源**：无（Win 写代码/测试/runbook；Mac/CTO 写证据与台账；两组文件零交集）。
- **D712 证据保留不动**：`docs/synova/product-lines/evidence/D712-mac-20260913/` 是 red 基线（历史事实），不得改写。
- **撞车协议**：若 Win 侧发现需要动 `electron/`（Mac 域）→ **停手，报 CTO/创始人**（多 Agent 协作协议 + CODEOWNERS）。

## 6. What We Don't Do

| 不做 | 原因 | 归属/触发 |
|---|---|---|
| 收敛 GA 控制台/登录页/报告页/驾驶舱（app/ 其余 14 个 html） | 1-5 是"安装引导"单一入口；这些是线 2 交互域的产品界面，打包态本就不出货 | 线 2（Win）；若产品决定"桌面态一律不提供 Web 控制台"→ 另起任务 |
| 修 `/` 与 `/login` 的悬挂重定向（src/server.ts L301-302） | 非引导入口；是否保留 Web 控制台是产品级问题（服务端部署形态尚未定） | **登记**（§4.4-C）→ 线 2 / CTO |
| 改 `electron/main.cjs` 的 dev 回退（L140 加载 `/app/login.html `） | `electron/` = Mac 域（跨域写撞车）；dev-only；非引导页 | **登记**（§4.4-D）→ Mac 线另起任务 |
| 改 `build-synova.cjs`（打包配置） | 本 spec 只做只读守卫（§5.4 决策 7）；配置本身已正确（不含 app/ ） | — |
| 改 `electron-renderer/` 渲染层（D575 首诊页） | 目标入口已成立（§4.1-F），本任务不动它 | — |
| 改 app/js/admin.js 的 D246 onboarding | 产品内管理台使用引导（Register/Invite/Import/Diagnose/View），与安装引导不同维度；A-G2 的并列登记以本 spec §5.4 决策 4 为收口口径 | 线 2（Win） |
| 改 `docs/synova/product-lines/product-lines.yaml`（1-5 状态/证据绑定） | 验收点状态由证据/裁决驱动，不由文档声称 | CTO / 产品线维护者 |
| 改 D712 证据（含 `1-5-dual-guide-check.txt`） | 历史 red 基线，改它=污染证据链 | — |
| 改写 `docs/synova/research/A线-产品完整性缺口审计-20260801/` 的历史审计工具与结论 | 点时间研究快照（基线 commit 431e16b），非活门禁；其 A1 向导结论被本任务取代（事实变化已在 §4.1-E 记录） | — |
| 删除 app/ 整个目录 | 线 2 交互域仍在用（登录/控制台/报告/导入等） | 线 2 |
| 把 `data/`、`node_modules` 等打包进安装包"补齐"旧 Web UI | 与收敛目标相反 | — |

## 7. Test Requirements（测试先行——铁律 0-2/48；先 red，再 green）

**测试文件**（新建）：`tests/routes/setup-guide-retired.test.ts`（L1 + L2a + L2b + L2c）、`tests/electron/dual-guide-packaging-guard.test.ts`（只读守卫；文件名不含 app/ 前缀避免与既有 desktop-build.test.ts 撞车，沿其只读文本断言模式）。
**模式**：真实 express app + `listen(0)` + `fetch`（铁律 12：不 mock 管线）；挂载顺序断言用源码文本正则（与 `tests/electron/desktop-build.test.ts` 的静态断言同型）。

**L1 单元契约**：

| # | 用例 | red（现状） | green（实现后） |
|---|---|---|---|
| T1 | 410 路由对象存在且为 Router | 无该 export | `setupGuideGoneRouter` 可 import + 挂载后行为一致 |
| T2 | `GET /app/setup.html ` → 410（非 200/302/404） | 现状 200（仓库根 cwd） | 410 + `Content-Type: text/html` |
| T3 | body 含唯一入口指路（"安装包"或"双击"字样）+ 非空（禁空 body） | 现状是旧向导 HTML | 断言正则命中 + `body.length > 0` |

**L2a 接线**（生产调用点真实传递——S-3）：

| # | 用例 | red | green |
|---|---|---|---|
| T4 | src/server.ts 中存在 `app.use(setupGuideGoneRouter)`（生产挂载，测试不计） | 无该路由 | 源码断言命中 |
| T5 | 挂载顺序：410 的 `app.use` 行号 < `/app` static 的 `app.use` 行号 | — | 行号断言 |
| T6 | 真实挂载两个中间件后，`/app/setup.html ` 命中 410 而**非** static（即使物理文件存在） | — | 临时目录造 app/setup.html 假文件 → 仍 410（证明优先级而非文件缺失） |

**L2b 降级**：

| # | 用例 | red | green |
|---|---|---|---|
| T7 | app/ 目录整体缺失（模拟打包形态）→ 服务启动不抛、`/app/setup.html ` 仍 410、其他 `/app/ *` 404 | — | 三断言 |
| T8 | 410 路由对 HEAD 请求同样返回 410（无 body，不抛） | — | 状态码断言 |

**L2c 边界**：

| # | 用例 | red | green |
|---|---|---|---|
| T9 | `/app/setup.html ?x=1` 与 `//app/setup.html `、`/APP/SETUP.HTML`（大小写/斜杠边界）——`all('/app/setup.html')` 的匹配语义按 Express 实际行为断言并记录（若大小写不敏感路径未命中 → 记录为已知边界，不假装覆盖） | — | 断言 + 诚实记录 |
| T10 | 目录遍历尝试（在 /app/ 路径中插入相对段指向其他页面）不因新路由产生越权/异常 | — | 状态码属于 {200,301,302,404,410} 且无 500 |
| T11 | 守卫 G-3：用临时目录造 app/setup.html → 守卫测试必须**红**（反向验证：证明守卫能拦住复活） | — | 反向验证通过（红→移除→绿） |
| T12 | 守卫 G-4：在 `build-synova.cjs` 文本中注入 `'app'` 条目（临时副本）→ 守卫测试红 | — | 反向验证通过 |

**verify 命令**（交付时逐条跑，输出贴 evidence）：

```bash
npx vitest run tests/routes/setup-guide-retired.test.ts tests/electron/dual-guide-packaging-guard.test.ts
# 退场物理核验（最坏形态：仓库根 cwd 起后端）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:PORT/app/setup.html      # 期望 410
test ! -e app/setup.html && test ! -e app/js/setup.js && test ! -e app/css/setup.css && echo GONE
grep -rn "setup\.html" src/ app/ --include=*.ts --include=*.html                  # 仅退场路由定义
ls release/mac-arm64/SynovaAgent.app 2>/dev/null                                   # 存在则核验包内无 app 目录
```

## 8. Wiring Verification

**规则**：新 export 必须有**生产**调用点（测试调用不计，S-3）；删除项必须 grep 零引用。

| 对象 | 生产调用点（实现后应命中） | 定位命令 |
|---|---|---|
| `setupGuideGoneRouter`（新 export） | src/server.ts 的 `app.use(setupGuideGoneRouter)`，位置早于 L300 的 `/app` static | `grep -rn "setupGuideGoneRouter" src/ ` |
| 410 路由优先级 | `/app/setup.html ` 的请求不再由 `express.static` 提供 | `grep -n "app.use('/app'\|setupGuideGoneRouter" src/server.ts ` |
| app/setup.html （删除） | 零引用（除退场路由的字面量与历史文档） | `grep -rn "setup\.html" src/ app/ tests/ --include=*.ts --include=*.html` |
| app/js/setup.js （删除） | 零引用 | `grep -rn "js/setup\.js" src/ app/ tests/` |
| app/css/setup.css （删除） | 零引用 | `grep -rn "css/setup\.css" src/ app/ tests/` |
| 唯一入口（渲染层首诊页） | `electron/main.cjs` L129 prod `loadFile(...renderer/index.html)`；`LlmSetupCard` 被 `WelcomeScreen` 引用 | `grep -rn "loadFile" electron/main.cjs`；`grep -rn "LlmSetupCard" electron-renderer/` |
| 守卫测试（回归拦截） | 两个测试文件在 `npx vitest run` 全量中被执行 | `npx vitest run tests/routes/setup-guide-retired.test.ts` |

**接线纪律**：① 410 路由的挂载位置靠**测试**保证，不靠注释；② 删除文件后必须 grep 复查（铁律 37）；③ 不得用测试文件冒充生产调用点。

## 9. Architecture Layer

**层**：
- 退场路由 = **L1 交互层**（HTTP 路由，src/server.ts 的既有路由区）——与 `uploadV2GoneRouter`（D590）同址同型。
- 410 无 IO/无 db/无跨层 import → 零架构风险（不触 L3/L4/L5）。
- 打包形状守卫 = **构建期只读断言**（测试读 `build-synova.cjs` 文本），不改构建链、不改 `electron/` 域。

**为何不是别处**：把退场做成"显式路由"而不是"删文件了事"，是因为**路由才是入口的权威定义**（cwd 无关）；把守卫放测试而不是 `build-synova.cjs`，是因为跨域写会撞车（§5.4 决策 7）。

**挂载顺序（架构纪律）**：`setupGuideGoneRouter` 与 `uploadV2GoneRouter` 同属"下线拦截器"，都在静态挂载/JWT 之前——保持与 D590 一致的三段顺序：**静态挂载 → 410 家族（静态之后会失效！因此 410 家族必须在静态之前）→ JWT**。实现时必须复核既有顺序（L300 static / L316 llmConfigRoutes / L319 uploadV2GoneRouter / L320 jwtAuth）：新路由插在 **L300 之前**。

## 10. Completion Standard（DS 与本 doc 一一对应，禁重编号/跳号/静默缺项——S-10）

| # | 完成标准（可证伪） | 验证命令 | 归属 |
|---|---|---|---|
| DS1 | 旧 URL 在最坏形态（仓库根 cwd）返回 410 且 body 人话指路 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:PORT/app/setup.html ` → `410` | Win |
| DS2 | 三件套已删除，且全仓零引用（除退场路由字面量） | `test ! -e app/setup.html && test ! -e app/js/setup.js && test ! -e app/css/setup.css && echo GONE`；`grep -rn "setup\.html" src/ app/ ` 仅退场路由 | Win |
| DS3 | 挂载顺序由测试保证（410 早于 static），且"文件存在时仍 410"（优先级而非缺失） | `npx vitest run tests/routes/setup-guide-retired.test.ts` | Win |
| DS4 | 打包形状守卫：`build-synova.cjs` 不含 app/ 条目（只读断言） | `npx vitest run tests/electron/dual-guide-packaging-guard.test.ts` | Win |
| DS5 | 守卫可逆验证：人为放回 app/setup.html / 注入 app/ 打包条目 → 守卫红（红→移除→绿，两段贴出） | 同上两文件（临时目录/临时副本注入，见 §7 T11/T12） | Win |
| DS6 | 唯一入口仍在渲染层（prod `loadFile` + `LlmSetupCard` 被 `WelcomeScreen` 引用） | `grep -rn "loadFile" electron/main.cjs`；`grep -rn "LlmSetupCard" electron-renderer/` | Win |
| DS7 | runbook 措辞与代码事实一致（退场机制 + 旧 URL 锚 + 守卫测试名） | `grep -n "410\|setupGuideGoneRouter" docs/synova/runbooks/desktop-dev-prod.md` ≥ 2 | Win |
| DS8 | 全量测试零失败 + pre-commit 全过（禁 `--no-verify`）+ 提交走 `git synova-commit` | `npx vitest run`；`git log --oneline -1` | Win |
| DS9 | 原始证据（curl 输出/测试输出/包内 Resources 清单）落盘到产品线证据目录，**1-5 转 `pending_k3`**，K3 复核后转 `verified` | evidence 目录文件存在；`git show origin/main:docs/synova/product-lines/product-lines.yaml \| grep -A 3 '"1-5"'` | Mac/CTO |
| DS10 | 相邻发现登记（§4.4-C 悬挂重定向、§4.4-D dev 回退）进 CTO 台账 | 台账含对应 file:line | CTO |

**Done 判定（入口 → 交互 → 结果）**：入口＝旧书签 URL（或用户双击安装包）；交互＝410 人话页 / 渲染层首诊页；结果＝"只有一个引导入口"在**任何 cwd 形态**下成立，且被守卫测试锁住（可反向验证）。

**1-5 判绿口径（防 overclaim，必读）**：
- ❌ 不得以"打包态本来就 404"作为 1-5 的通过证据（那是环境巧合，且仓库根形态是 200）；
- ✅ 判绿需同时满足：DS1（410，最坏形态）+ DS2（资源退场）+ DS3/DS4（守卫在）+ DS9（证据落盘 + K3 复核）。
- 本 spec 不预设 1-5 会 pass：判定权在证据 + K3。

## 11. Auth Doc References

| 引用 | 路径 | 用途 |
|---|---|---|
| 派单（本批次） | docs/synova/coordination/派单-下一批四线并行-20260913.md | §D716 spec 2 要求与必答项 |
| D518 收敛声明 runbook | docs/synova/runbooks/desktop-dev-prod.md | 目标形态（唯一路径 = 安装包双击）+ 本次要补的机制 |
| D590 410 先例 | src/server.ts | 退场路由形态（L89-92）与挂载纪律 |
| 静态挂载与重定向现状 | src/server.ts | L300 static / L301 `/` / L302 `/login` / L316 / L319 / L320 |
| 桌面端启动链 | electron/main.cjs | prod `loadFile` 渲染层（L129）+ dev 分支（L140）+ cwd 注入（L254） |
| 打包配置（只读断言对象） | build-synova.cjs | `files` / `extraResources` 不含 app/ |
| D283 旧引导设计（历史） | docs/plans/codex/implementation/SYNOVA-IMPL-D283-Setup-Guide-20260730.md | 旧入口的来源与"从未接线"事实 |
| D575 首启向导（目标入口） | docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D575-llm-first-run-config-20260904.md | 渲染层首诊页契约 |
| 验收点与偏差台账 | docs/synova/product-lines/product-lines.yaml；docs/synova/research/AUTHORITY-DEVIATION-REGISTRY-v1.md | 1-5 / S3-6 / A-G2 原文 |
| D712 证据（red 基线） | docs/synova/product-lines/evidence/D712-mac-20260913/1-5-dual-guide-check.txt | 现状 200 的取得形态（仓库根起后端） |
| 边界归属 | .github/CODEOWNERS | src/server.ts = Claude 专属；`electron/` = Mac DSH |
| 铁律 | AGENTS.md、CLAUDE.md | 4/5/11/24/37/38/39 + D603 教训 |
| 决策框架 | docs/synova/coordination/DECISION-REFERENCE.md | S-12 决策参考四步 |

## 12. 交付声明（声称 ↔ 证据对照表）

| 声称 | 证据命令 | 预期 |
|---|---|---|
| 打包态旧引导**不可达**（实时实测） | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18790/app/setup.html ` | `404` |
| 仓库根形态旧引导**可达**（D712 取证形态） | `grep -n "dist/backend.mjs" docs/synova/product-lines/evidence/D712-mac-20260913/1-5-dual-guide-check.txt` | 命中来源说明行 |
| 包内无 app 目录 | `ls release/mac-arm64/SynovaAgent.app 的 Contents/Resources` | 无 app 目录 |
| 打包配置不含 app | `grep -n "app" build-synova.cjs` | 仅注释/asar 相关，无 app/ 条目 |
| 旧引导三件套仍在仓库（收敛前） | `git ls-files app/setup.html app/js/setup.js app/css/setup.css ` | 3 行 |
| setup.css/js 唯一引用者是 setup.html | `grep -rn "setup\.css\|js/setup\.js" app/ src/ --include=*.html --include=*.ts` | 仅 setup.html 两行 |
| 无代码/CI 引用旧引导 URL | `grep -rn "setup\.html" .github/ scripts/ --include=*.yml --include=*.sh` | 0 |
| 410 先例存在（形态对齐对象） | `grep -n "uploadV2GoneRouter" src/server.ts ` | ≥2 命中（定义 + 挂载） |

## 13. 自检清单

- [x] 北星 front-matter 六键齐；"当前进度"写的是实测事实（打包态 404 / 潜伏残留）
- [x] 11 节齐 + 交付声明 + 自检清单
- [x] 声称即引用：§4 每条带 file:line 或 curl 实测；**主动纠正派单原文**（"打包态双引导"不成立）并给出实测三条
- [x] 写集表 D381 格式（`### 5.1 写集 (2 修改 + 2 新建 + 3 删除)`，标题下一行即表头）；新文件目录级声明（C2 假阳规避，D580/D590/D593 先例）
- [x] 必答四项齐：收敛方向（§5.4-1）/ 退场方式（§5.4-2 + §5.2-A/B）/ 书签兼容（§5.2-B 含无存量用户证据）/ 物理验收（§10 DS1-DS5 + §7 verify）
- [x] 跨线边界到文件级（§5.5 + §6）：Win 写 src/server.ts + app/ + `tests/` + runbook；Mac/CTO 写 evidence/台账；electron 域只读
- [x] 守卫可反向验证（§7 T11/T12 红→绿）+ 1-5 判绿口径含"禁以打包态 404 冒充收敛"（§10）
- [x] 决策参考 §5.4（S-12，八决策点 + 收敛检查）；不做清单含文件路径与归属
- [x] 铁律核对：铁律 37（删除 + grep 零引用）、11/24（410 人话 body，非空）、39（L1 层退场路由）、零 `as any`、不改 `scripts/audit/`
- [x] 只写 spec 不写实现代码；src/server.ts 虽为 Claude 专属，本 doc 只作契约与验收定义
