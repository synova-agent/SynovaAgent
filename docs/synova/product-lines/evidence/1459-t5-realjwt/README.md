# #1459 M1 — 真实登录复跑（真实 JWT 身份下的一次桌面提问）

> 2026-11-24 ｜ 执行者：coding session ｜ DEV DOC `.tmp-devdoc-1459-closeout-20261124.md` v1.1 §10.2
> 结论：**通过**——`run.started` 的身份来自登录会话（非 `dev-admin`），三件证据齐，桌面 `runStatus=done` 且假设卡片四要素非空。

## 1 这次跑的是什么

| 项 | 值 |
|---|---|
| 运行时源码 | 独立 worktree，base = `gitea/main` `a17fb9bfa`（含 T-A/T-B/T-C，#1477 之后） |
| 数据库 | `%TEMP%\1459-scan\synova.db`（T0 隔离库；**未碰主树 `data/synova.db`**） |
| API | `DEV_MODE=true` `PORT=18790` `SYNOVA_DB_PATH=<隔离库>` `SYNOVA_ORG_ID=org-a`；启动日志 `path` 实测等于隔离库（见 §4-①） |
| sidecar / DSH | **rc.5 实物**：`install\0.2.2-rc.5\node_modules\@deepseek-ai\dsh\lib\bin.js`（API 侧 `SYNOVA_DSH_INSTALL_DIR` 指向它，`assertInstalledDshVersion` 通过后才 spawn） |
| DSH home | 本次一次性 `dsh-home`（`profiles/` `sessions/` `storages/` 由 DSH 自建） |
| 桌面 | Electron dev 模式（vite 5173 + CDP 9222），`electron/main.cjs` 加载 vite 页面；后端探活 18790 命中即 `reused`（不自启第二个后端） |
| 账号 | `t5-admin@synth-1459.invalid`（用户名 `t5-admin`）｜`role=admin`｜`org-a`｜**经 `POST /api/auth/register` 由应用自身 `UserStore.createUser` bcrypt 落库**（未手写 hash） |
| 端口 | API 18790 ｜ vite 5173 ｜ CDP 9222 |

## 2 入口 → 动作 → 结果（用户可见行为）

- **入口**：桌面 "DSH 会话" 面板（DevMode 下显示「使用账号登录」入口）。
- **动作**：点「使用账号登录」→ 填 `t5-admin@synth-1459.invalid` + 20 位随机密码 → 点「登录」→ 面板 `data-auth` 变 `authenticated`（令牌只在本进程内存）→ 输入受控 prompt → 点「发起会话」。
- **结果**：`运行完成`；卡片「瓶颈假设」四要素非空，`objects` 指向真实 `node-105362c0…` / `node-8720cf4c…`，`relations` 为 `edge/team_executes_activity`，`evidence` 为 `delivery_batches.csv#L3` / `operator-statement.json`；`M1-desktop.png` 右上角身份角标为 `admin`。

## 3 三件证据

| 件 | 文件 | 关键读数 |
|---|---|---|
| ① SSE 帧（重放，原样字节） | `M1-sse.txt` | 10 帧：`run.started → session.created → egress.recorded → reasoning.delta → tool.started → tool.finished → reasoning.delta → text.delta → hypothesis.structured → run.completed` |
| ① 身份判据（唯一口径） | `M1-sse.txt` / `M1-meta.json` | `run.started.data`：`userId=node-e3fa8993-4715-469c-92f2-f2397a2d4fba`（**非 `dev-admin`**）｜`scope=admin`｜`enterpriseId=org-a` |
| ② DSH 会话（含 usage） | `M1-dsh-session-log.jsonl` ＋ `M1-dsh-session.json` ＋ `M1-dsh-session-report.json` | 2 条 `assistant/message`，均带 usage；合计 `inputTokens=9703` `outputTokens=712` `cacheReadTokens=11776` `totalTokens=22191`；`realModelRound=true` |
| ③ 桌面 DOM / 截图 | `M1-dom.json` ＋ `M1-desktop.png` | `data-auth=authenticated`、`data-run-status=done`、`data-hypothesis-structured=true`；四要素文本齐 |
| 旁证 | `M1-meta.json` | `runId=run_74c1d3453f3945b8894417f0b77c2352`、`sessionId=5f3bd755-b803-476f-bbee-f7f0b5fe0166`、提交/终态时间 |

**判定**：三件齐 ⇒ 全链 PASS（服务端链 ＋ 真实身份 ＋ 桌面可见）。与 T5 的差别仅一处：T5 是 `auth: devmode`、`userId=dev-admin`；本次 `auth: authenticated`、`userId=node-e3fa…`。

## 4 环境侧必须说清的三件事（不是产品改动，是运行前提）

1. **必须给 API 配 `JWT_SECRET`**：`src/middleware/auth.ts` 的 DevMode 分支是 `!secret && DEV_MODE==='true'` ⇒ 无 `JWT_SECRET` 时**先命中自动 admin**，Bearer 被无视。配了 `JWT_SECRET`（随机 64 hex，只存在本次一次性临时目录的密钥文件里，收尾删除）后 `/api/dsh/runs` 才走验签身份，DEV DOC §5 判据才成立。`DEV_MODE=true` 保持不变（`config.devMode` 为真）。
2. **Electron 需要 `--no-sandbox` ＋ 独立 `--user-data-dir`**：本机（Administrator 会话）下 `electron.exe` 起 Chromium 沙箱时以 `STATUS_BREAKPOINT` 退出（实测 `electron.exe --version` 非 0，加 `--no-sandbox` 才打印 `v33.4.11`）；默认 `%APPDATA%\Electron` 的 ProcessSingleton 锁创建失败（`Access is denied`）导致「已有实例运行」自退 ⇒ 用工作区内 `--user-data-dir` 规避。仅运行期参数，未改任何产品代码。
3. **未起独立 supervisor**：`createDefaultDshRunManager`（`src/runtime/dsh/session.ts:435`）在首次 run 时自己 spawn rc.5 的 `bin.js`（`buildDshInvocation`），`dsh-home/run/synova-sidecar.json` 不参与本次链路。所以本包的"sidecar"= rc.5 实物子进程，而非 `scripts/dsh-sidecar/start.ps1` 的 supervisor。

## 5 可复跑

```powershell
# 1) 隔离库 + 账号（密码随机会写两处，收尾删）
node docs/synova/product-lines/evidence/1459-t5-realjwt/runner/register-user.cjs --base http://127.0.0.1:18790 --email t5-admin@synth-1459.invalid `
     --role admin --org org-a --password-file <ops>/t5-admin-password.txt --password-file <tmp>/out/password.working.txt
# 2) API / 桌面 / 驱动
powershell -File docs/synova/product-lines/evidence/1459-t5-realjwt/runner/start-api.ps1 -Worktree <wt>        # DEV_MODE=true + JWT_SECRET(随机) + 隔离库 + rc.5
powershell -File docs/synova/product-lines/evidence/1459-t5-realjwt/runner/start-desktop.ps1 -Worktree <wt>    # vite 5173 + electron（--no-sandbox + 独立 user-data-dir）
node docs/synova/product-lines/evidence/1459-contract-sampling/runner/m1m2-drive.mjs --cdp-port 9222 --base http://127.0.0.1:18790 `
     --email t5-admin@synth-1459.invalid --password-file <tmp>/out/password.working.txt --evidence <ev> --phase M1
# 3) 会话日志 usage
node docs/synova/product-lines/evidence/1459-contract-sampling/runner/session-usage.mjs --session-zstd <sessions>/<sessionId>/session.v4.jsonl.zstd --evidence <ev> --id M1 `
     --decoder scripts/dsh-sidecar/r3-chain/session-decompress.mjs
```

## 6 边界与偏差

- **未改任何 `src/**` / `electron*` / 门禁 / `.gitea/**`**；本目录只有证据与运行脚本（`runner/`）。
- **未碰主树**：主树 HEAD 前后一致（见回执）；全部写入在本 worktree 与仓外一次性目录。
- **凭据**：模型 key 只以 `refs.DEEPSEEK_API_KEY` 单条写进一次性 `dsh-home/.credentials.yaml`，取值从不打印；收尾删除并记 `CREDENTIAL-CLEANUP`。一次性账号密码文件收尾删除。
- 偏差：DEV DOC §3 写的"后续事件与 T5 同构（tool → structured → completed）"本次成立；DEV DOC §2.1 提到的 `UV_HANDLE_CLOSING` / `start.ps1` 包装问题本次未复现（未走 supervisor 路径）。
