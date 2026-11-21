---
状态: implemented
日期: 2026-11-19
决策: renderer 以「auth-session 双模式（DevMode 默认／真实 token 仅内存）＋ dsh-run-api 四调用与 SSE 事件源 ＋ dsh-run-store 状态机 ＋ 受控无 hook 面板」接通 DSH 会话可见面；后端 src/** 零改动。
理由: I-1 已让工具读到真实结构，但用户既无法用真实身份发起会话，也看不到工具轨迹与失败态；最小闭环只需补齐真实导航、认证头、SSE 消费与失败可见，服务端仍是身份与终态的唯一权威。
---

## 现状

固定 base 为 `d0312a0057a91f0924f478c691a48eda4557b723`（= 派单时远端 main 实测 tip），分支 `feat/1429-dsh-run-ui`。执行依据 = Gitea #1429 评论 13511（DEV DOC v1）＋13512（CTO 裁定 B1–B7）＋13517（v2 增量）＋13518（Mandate）；B1/B2 为复核退回后的 CTO 裁定 A（补最小登录入口，写集 15 → 17）。

现状证据（base 实测）：`electron-renderer/src/**` 零 `Authorization`；`useStreaming.ts` 只接 `/api/conversations` 与 `/api/diagnosis/consult`；后端 `src/routes/dsh.ts` 五端点与 `POST /api/auth/login` 已齐；`App.tsx` 只有 scan/chat 两分派。

## 决定

- **auth-session 双模式**：默认 `devmode`（不发 Authorization，沿用服务端 DevMode 自动身份）；`login()` 成功后进入 `token` 模式，token 只存模块级内存，`authHeader()` 精确产出 `Authorization: Bearer <jwt>`。401 统一 `expireSession()`（清 token、标记过期）；登录失败保持「未登录」而不回退 DevMode（避免登录失败后静默发未认证请求）；`logout()` 清 token 并回到默认 DevMode。
- **dsh-run-api 四调用＋事件源**：`startRun`（POST `/api/dsh/runs`，body 恰为 `{input}`，本地先校验空/超 100,000 字符）、`cancelRun`、`closeSession`、`openRunEvents`（fetch + ReadableStream 消费 SSE，支持 `last-event-id`；不用浏览器 EventSource，因其无法携带 Bearer）。所有调用永不抛：4xx ⇒ error（保留 code/phase/retryable/message）、5xx/网络/形状非法 ⇒ degraded＋`console.warn`。
- **dsh-run-store 状态机**：`idle/starting/running/done/cancelled/failed/expired`；`lastEventId` 取最大 seq、`seen` 集合保证同 seq 不重复追加；`tool.finished` 归并到同 toolCallId 的 `tool.started`；`run.completed`（含 `data.empty`）／`run.failed`／`run.cancelled` 是唯一终态来源。
- **断流与取消口径**：事件流 `onEnd` 但未见终态 ⇒ `failed`＋`STREAM_INTERRUPTED`（「连接中断，可重连」），绝不 `done`；重连带最后 seq，重放不重复。`cancel()` 只把 `cancelPending` 置真并发 POST，状态保持 `running`，直到 SSE `run.cancelled` 到达才转 `cancelled`。
- **面板受控无 hook**：`DshRunPanel` 全部输入来自 props（textarea＋提交／取消／关闭／重连按钮、事件列表、错误块），取数只在 `DshRunContainer`。事件白名单投影：只显示文本增量与工具 title/kind/status/isError（事件里没有入参/结果，不虚构、不承诺）。
- **空成功可见**：`run.completed.data.empty === true` ⇒ 状态 `done` 且 `empty` 标记，面板显示「无结果」而不是「运行完成」。
- **导航接线**：`LeftPanel` 新增「DSH 会话」入口 → `activeView='dsh'` → `App` 双视图分派挂载唯一 `DshRunContainer`；`tests/scan-ui/scan-wiring.test.ts` 按双视图更新断言（写集内，B3）。
- **登录入口（B1）**：新增受控无 hook 的 `DshLoginPanel`（邮箱／密码／提交／错误块／过期提示／可返回；只画 props，不取数）；`DshRunContainer` 在 `unauthenticated`／`expired` 时挂登录面板，提交走 `lib/auth-session.login()`（`POST /api/auth/login`），成功后 token 已写入 auth-session 模块内存（不落盘）并 `syncAuth()` 把认证态同步进 store，运行面板随即可用（`startRun()` 经 `authHeader()` 带 `Authorization: Bearer <jwt>`）；失败保留服务端 `code`/`message` 在面板可见，认证态留在未登录（不回退 DevMode）；DevMode 下运行面板照旧并保留「使用账号登录」入口（否则默认态下登录表单不可达）。401 后 `expireSession()` ⇒ `state='expired'` ⇒ 登录面板显示「登录已过期」。

## 依据

- 定向验收（本分支实测）：`npx vitest run tests/dsh-ui tests/scan-ui` → 9 files / 258 tests 全通过（dsh-ui 78：api 24、store 19、panel.render 16、wiring 8、login-panel 11；scan-ui 180 回归）；`npx tsc -p electron-renderer/tsconfig.json` → exit 0。
- B2 真实 HTTP（对真实服务 `PORT=3971`，临时库与临时 JWT_SECRET／CREDENTIAL_MASTER_KEY，`DEV_MODE=false`，只监听本机，取完证据即终止；token 在回执中截断）：`POST /api/auth/register` → **201**；`POST /api/auth/login` → **200**（token 304 字符）；`GET /api/auth/validate` 带 Bearer → **200**；`POST /api/dsh/runs` 无 Authorization → **401** `UNAUTHORIZED`；带 Bearer → **202**（`runId=run_2626a2fc86de41598b2732bd4d82047f`，`eventCount=2`）；`GET /api/dsh/runs/:id/events` 无 Authorization → **401**；带 Bearer → **200** `Content-Type: text/event-stream; charset=utf-8`，SSE 首帧 `id: 1 / event: run.started`，次帧 `id: 2 / event: run.failed`（`code=SIDECAR_SPAWN_FAILED`：默认安装目录缺 `0.2.2-rc.2` 的 `@deepseek-ai/dsh/package.json`），随后 `<<stream end>>`。
- B2 客户端链路（用本分支真实模块 `login()`＋`startRun()`＋`openRunEvents()` 打同一真实服务，非桩）：`LOGIN kind=ok` → `SNAPSHOT mode=token state=authenticated tokenLen=304` → `START {"kind":"ok","runId":"run_0d3c012264ab40ccb371925d61b3645e"}` → `SSE_EVENT seq=1 type=run.started` → `SSE_EVENT seq=2 type=run.failed` → `SSE_END`（exit 0）。
- 失败路径逐条有测试：401→expired／403／404／409／5xx／网络断各自可见；断流不完成且可重连；取消以事件为准；空成功显示无结果；未登录零请求（store gate，startRun 0 次）；登录失败保留服务端码且不发 Authorization。
- 请求级精确断言：runs/events/cancel/close 的 URL、method、`Authorization: Bearer <jwt>` 精确匹配；重连 `last-event-id` == 已收最后 seq。
- token 不落盘静态否定断言（仿 scan-wiring）：I-2 六个新增/修改源码文件（含本轮 `DshLoginPanel.tsx`／`DshRunContainer.tsx`）不含 `localStorage/sessionStorage/indexedDB`、写文件 API、`console.*(token|password)`、DSH 内部面（sidecar/acp/pinned-version/SYNOVA_DSH）。
- 变异实跑（改坏必红，恢复后绿，原始输出见本会话回执）：①摘 LeftPanel 入口 ②摘 App dsh 分派 ③摘 store→startRun 调用 ④401 当成功 ⑤断流当完成 ⑥token 写 localStorage — 四项变体在对应测试上分别红，恢复后 247 passed；本轮 B1 另跑 ⑦摘登录成功后 `syncAuth()` ⑧摘面板 `data-error-code` ⑨`needsLogin` 不再含 `expired` — 三项分别在对应用例上红，恢复后 258 passed。
- 全量回归抽样：`tests/electron`、`tests/ga-collab-ui.test.ts`、`tests/llm-config-frontend.test.ts`、`tests/acceptance/mvp1-m3-domain-chain.test.ts`、`mvp1-m4-output-face.test.ts`、`mvp1-m9-one-pass.test.ts` 共 278 tests（268 passed／6 skipped／4 failed）；4 个失败与本次改动无关，已用 base `d0312a00` 临时 worktree 复跑同一 3 个文件得到完全相同的 4 个失败（mac 脚本执行位、Windows 进程组回收、M9 冻结对照/metric 行），属既有环境失败，不扩大写集修复。

## 生效时点

本 Note 随 #1429 实现分支提交生效；PR 只开 review，不代表已合并、独立复核、实机验收或部署。

**NOT DONE（如实标注）**：① 未在实机 Electron 点击验证（测试≠实机点击，渲染桥不执行 hook）；② 未跑通一轮**成功完成**的模型运行 —— B2 在真实服务上 `POST /api/dsh/runs` 已 202 并消费到 SSE（`run.started`→`run.failed`），`run.failed` 的 `SIDECAR_SPAWN_FAILED` 是环境事实：默认安装目录 `%LOCALAPPDATA%\Synova\dsh-sidecar\install\0.2.2-rc.2` 缺 `@deepseek-ai/dsh`；补齐＝I-4／#1430，且真实模型外发是 I-3 停点；③ 真实登录端到端只在临时库＋临时 JWT_SECRET／CREDENTIAL_MASTER_KEY 下对真实服务完成（B2 证据），未用真实客户数据、生产库或生产部署。停点保持：真实模型外发（I-3）、rc.2/rc.5 安装（I-4／#1430）、真实客户数据、生产部署均未触碰；`src/**` 零改动，未碰 `src/runtime/dsh/**`。
