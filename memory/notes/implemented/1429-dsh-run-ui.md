---
状态: implemented
日期: 2026-11-19
决策: renderer 以「auth-session 双模式（DevMode 默认／真实 token 仅内存）＋ dsh-run-api 四调用与 SSE 事件源 ＋ dsh-run-store 状态机 ＋ 受控无 hook 面板」接通 DSH 会话可见面；后端 src/** 零改动。
理由: I-1 已让工具读到真实结构，但用户既无法用真实身份发起会话，也看不到工具轨迹与失败态；最小闭环只需补齐真实导航、认证头、SSE 消费与失败可见，服务端仍是身份与终态的唯一权威。
---

## 现状

固定 base 为 `d0312a0057a91f0924f478c691a48eda4557b723`（= 派单时远端 main 实测 tip），分支 `feat/1429-dsh-run-ui`，独立 worktree 在仓库外 `D:\novis-backup-20260526\Novis\.synova-wt-1429-dsh-run-ui`。执行依据 = Gitea #1429 评论 13511（DEV DOC v1）＋13512（CTO 裁定 B1–B7）＋13517（v2 增量）＋13518（Mandate）。

现状证据（base 实测）：`electron-renderer/src/**` 零 `Authorization`；`useStreaming.ts` 只接 `/api/conversations` 与 `/api/diagnosis/consult`；后端 `src/routes/dsh.ts` 五端点与 `POST /api/auth/login` 已齐；`App.tsx` 只有 scan/chat 两分派。

## 决定

- **auth-session 双模式**：默认 `devmode`（不发 Authorization，沿用服务端 DevMode 自动身份）；`login()` 成功后进入 `token` 模式，token 只存模块级内存，`authHeader()` 精确产出 `Authorization: Bearer <jwt>`。401 统一 `expireSession()`（清 token、标记过期）；登录失败保持「未登录」而不回退 DevMode（避免登录失败后静默发未认证请求）；`logout()` 清 token 并回到默认 DevMode。
- **dsh-run-api 四调用＋事件源**：`startRun`（POST `/api/dsh/runs`，body 恰为 `{input}`，本地先校验空/超 100,000 字符）、`cancelRun`、`closeSession`、`openRunEvents`（fetch + ReadableStream 消费 SSE，支持 `last-event-id`；不用浏览器 EventSource，因其无法携带 Bearer）。所有调用永不抛：4xx ⇒ error（保留 code/phase/retryable/message）、5xx/网络/形状非法 ⇒ degraded＋`console.warn`。
- **dsh-run-store 状态机**：`idle/starting/running/done/cancelled/failed/expired`；`lastEventId` 取最大 seq、`seen` 集合保证同 seq 不重复追加；`tool.finished` 归并到同 toolCallId 的 `tool.started`；`run.completed`（含 `data.empty`）／`run.failed`／`run.cancelled` 是唯一终态来源。
- **断流与取消口径**：事件流 `onEnd` 但未见终态 ⇒ `failed`＋`STREAM_INTERRUPTED`（「连接中断，可重连」），绝不 `done`；重连带最后 seq，重放不重复。`cancel()` 只把 `cancelPending` 置真并发 POST，状态保持 `running`，直到 SSE `run.cancelled` 到达才转 `cancelled`。
- **面板受控无 hook**：`DshRunPanel` 全部输入来自 props（textarea＋提交／取消／关闭／重连按钮、事件列表、错误块），取数只在 `DshRunContainer`。事件白名单投影：只显示文本增量与工具 title/kind/status/isError（事件里没有入参/结果，不虚构、不承诺）。
- **空成功可见**：`run.completed.data.empty === true` ⇒ 状态 `done` 且 `empty` 标记，面板显示「无结果」而不是「运行完成」。
- **导航接线**：`LeftPanel` 新增「DSH 会话」入口 → `activeView='dsh'` → `App` 双视图分派挂载唯一 `DshRunContainer`；`tests/scan-ui/scan-wiring.test.ts` 按双视图更新断言（写集内，B3）。

## 依据

- 定向验收（本分支实测）：`npx vitest run tests/dsh-ui tests/scan-ui` → 8 files / 247 tests 全通过（dsh-ui 67：api 24、store 19、panel.render 16、wiring 8；scan-ui 180 回归）；`npx tsc -p electron-renderer/tsconfig.json` → exit 0。
- 失败路径逐条有测试：401→expired／403／404／409／5xx／网络断各自可见；断流不完成且可重连；取消以事件为准；空成功显示无结果；未登录零请求（store gate，startRun 0 次）。
- 请求级精确断言：runs/events/cancel/close 的 URL、method、`Authorization: Bearer <jwt>` 精确匹配；重连 `last-event-id` == 已收最后 seq。
- token 不落盘静态否定断言（仿 scan-wiring）：I-2 五个新源码文件不含 `localStorage/sessionStorage/indexedDB`、写文件 API、`console.*(token)`、DSH 内部面（sidecar/acp/pinned-version/SYNOVA_DSH）。
- 变异实跑（改坏必红，恢复后绿，原始输出见本会话回执）：①摘 LeftPanel 入口 ②摘 App dsh 分派 ③摘 store→startRun 调用 ④401 当成功 ⑤断流当完成 ⑥token 写 localStorage — 四项变体在对应测试上分别红，恢复后 247 passed。
- 全量回归抽样：`tests/electron`、`tests/ga-collab-ui.test.ts`、`tests/llm-config-frontend.test.ts`、`tests/acceptance/mvp1-m3-domain-chain.test.ts`、`mvp1-m4-output-face.test.ts`、`mvp1-m9-one-pass.test.ts` 共 278 tests（268 passed／6 skipped／4 failed）；4 个失败与本次改动无关，已用 base `d0312a00` 临时 worktree 复跑同一 3 个文件得到完全相同的 4 个失败（mac 脚本执行位、Windows 进程组回收、M9 冻结对照/metric 行），属既有环境失败，不扩大写集修复。

## 生效时点

本 Note 随 #1429 实现分支提交生效；PR 只开 review，不代表已合并、独立复核、实机验收或部署。

**NOT DONE（如实标注）**：未做真实登录端到端（种子用户＋JWT_SECRET 常开，按 B5 另立切片）；未在实机 Electron 点击验证（测试≠实机点击，渲染桥不执行 hook）；未对真实运行中的服务端跑 SSE 端到端（本轮以 fetch/ReadableStream 注入断言请求与帧消费，请求形状取自 `src/routes/dsh.ts` 与 `src/runtime/dsh/session.ts` 实况）。停点保持：真实模型外发（I-3）、rc.2/rc.5 安装（I-4／#1430）、真实客户数据、生产部署均未触碰；`src/**` 零改动，未碰 `src/runtime/dsh/**`。
