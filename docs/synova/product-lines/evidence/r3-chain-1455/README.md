# R3 chain — DSH 最小真实复用证明链（Gitea #1455）· 实机证据

> **结论（先读）：`T3 阻塞，R3 未证明`。** 本目录是 rc.5 实机执行到 **T3** 的原始证据 + 一个**产品缺陷**的最小复现。
> 链的桌面段（initialize → session/new → prompt → `synova_context_get` → `run.completed`）**没有跑起来**，原因不是 DSH、也不是本票代码，而是**桌面端 dev 模式无法自起后端**（`spawn npx` 在 Windows 上 ENOENT）。
> **模型轮次消耗：0 / 1**（从未发出 `POST /api/dsh/runs`）。Done 3–7 与 8(a) 一律 **NOT REACHED**，不是"通过"。

| 项 | 值 |
|---|---|
| 票号 | Gitea Issue **#1455**（DEV DOC v3 = 评论 14384；v3.1 勘误 = 评论 14395；Mandate = 评论 14396） |
| CodeSha（唯一） | `caf61fcdeb3e00c79abe9211546690ca963549a2`（Gitea main，merge #1453） |
| 分支 / 工作树 | `feat/1455-r3-chain` @ `D:\novis-backup-20260526\Novis\.synova-wt-1455-r3-chain` |
| 任务根（仓外） | `D:\novis-backup-20260526\Novis\_r3chain-20261123\`（install / dsh-home / instance / data / evidence） |
| rc.5 安装 | `INSTALL_OK`，`0.2.2-rc.5`，integrity 与钉死值逐字一致 |
| 本次实际推进 | T0 全绿 → T1 全绿 → T2 全绿（含反例）→ **T3 阻塞** → T4/T5 未进入 |
| 运行时刻 | 2026-11-23 01:49 ~ 02:25 (+08:00) |

---

## 1 断点（唯一阻塞项）

**现象（Electron 主进程原始输出，见 `T3-electron-stdout-raw.txt` / `T3-BREAK-electron-dev-self-start-ENOENT.txt`）**

```
[electron] boot mode=dev server=http://localhost:18790
[backend-spawn] spawn 失败: spawn npx ENOENT
[backend-spawn] 后端自启降级 — 重启 1 次未恢复: spawn npx ENOENT
[electron] 后端自启 degraded — spawn npx ENOENT
[preload-check] OK: electronAPI 已暴露, serverUrl=http://localhost:18790
```

- 桌面 UI 本身是**正常**的（`http://localhost:5173` 已加载，preload 契约 OK，见 `T3-desktop-no-backend.png`：界面在，但显示"已断开/离线"）。
- 唯一失败点：`electron/backend-spawn.cjs` 的 `buildCommand('dev')` = `{ bin: 'npx', args: ['tsx', 'src/index.ts'] }`，而 `spawn()` 用 `shell:false`。Windows 上 `npx` 只有 `npx.cmd`（POSIX 的 `npx` 是 shell 脚本），libuv 解析不到 ⇒ **ENOENT**。
- 同一缺陷的**最小复现**（`T3-BREAK-…` §[3]）：

| 变体 | 结果 |
|---|---|
| `spawn("npx", [...], {shell:false})`（**产品现状**） | `ERROR ENOENT spawn npx ENOENT` |
| `spawn("npx.cmd", [...], {shell:false})` | `SYNC_THROW EINVAL`（node 24 拒绝无 shell 起 .cmd） |
| `spawn(process.execPath, [npx-cli.js, "tsx", "src/index.ts"], {shell:false})` | `EXIT code=0` ✅ |

- **后果**：`ensureBackend()` 返回 `{started:false, degraded:true, error:'spawn npx ENOENT'}` ⇒ 没有后端、也没有 `backendHandle.stop`；Mandate 要求的"Electron 必须自起后端（`started:true`）"结构性不可达；`reused:true` 是 Mandate 明写的停点。⇒ **停报**。
- **修复不在本票写集内**（`electron/**` 既不在 §4.1 写集、也不在条件写集 A/B）⇒ 需 CTO 授权一行改动（建议上面第三行那种 shell-free 写法）。

---

## 2 R3 逐项判定（Done 1–10，逐条挂证据）

| # | 判据 | 判定 | 证据 |
|---|---|---|---|
| 1 | rc.5 实物与来源（version/integrity/source + 安装根 package.json） | **PASS** | `01-install.out.json`、`T0-install-attempt1-failure.txt`（首次尝试的原始失败）、`00-env.txt` |
| 2 | initialize 成功（ready / protocolVersion / agentName） | **PASS（supervisor 路径）** / run 路径 **UNVERIFIED** | `02-acp-initialize.json`：`ready=true, protocolVersion=1, agentName=deepseek-harness-acp`；run 路径的 initialize 需要 T3 |
| 3 | sessionId 非空（run 快照 + session/list + 会话目录） | **NOT REACHED** | 无 run（模型轮次 0） |
| 4 | prompt 真实请求与完成（status=completed） | **NOT REACHED** | 同上 |
| 5 | DSH 侧 `tool/call` + `tool/result`（`synthetic:false`,`count>=1`） | **NOT REACHED（DSH 侧）**；Synova 侧工具面 **PASS** | `11-mcp-tools-list.json`（tools/list 只广告 1 个工具；positive `count=2`、`synthetic:false`）、`12-negative-domain-empty.json` |
| 6 | DSH 产事件（`text.delta`/`tool.*`） | **NOT REACHED** | 无 SSE（无 run） |
| 7 | 桌面收到 `run.completed`（截图 + console 同 runId） | **NOT REACHED** | `T3-desktop-no-backend.png` 只能证明 UI 起来了 |
| 8 | close/stop 后进程退出 | **(b) PASS / (a) NOT REACHED** | (b) `02-acp-initialize.json`：`stop.ps1` → supervisor 22680 + ACP 11060 双 PID 消失、状态文件删除；(a) 无 `backendHandle.stop` 可用（见 §1） |
| 9 | 全产物同一 CodeSha / runId / 时间窗 | **PARTIAL** | 全部证据同一 CodeSha；**无 runId**（无 run） |
| 10 | 无 Secrets / 数据边界明确 | **PASS** | `T5-secrets-scan.txt`（0 命中）、`CREDENTIAL-CLEANUP.txt`（凭据文件已删） |

**反例（必跑，不耗模型轮次）**：PASS —— `12-negative-domain-empty.json`：不存在的 `problemId` ⇒ HTTP 200 + 结构化 `DOMAIN_EMPTY`（`isError:true`），不是空成功。

---

## 3 已完成的实机证据（T0 / T1 / T2）

### T0（安装与契约复核）
- rc.5 从 npm registry 装到 `install\0.2.2-rc.5`，`dsh-install-lock.json` 与 `node_modules/@deepseek-ai/dsh/package.json` 均 `0.2.2-rc.5`，integrity 与 Mandate 钉死值逐字一致（独立 `node` 复核，不只依赖脚本）。
- **契约复核清单（rc.5 实物）**：`lib/bin.js` ✔｜`--profile` 参数族 ✔｜`agentInfo.name="deepseek-harness-acp"` ✔（`dsh-acp/lib/index.js:1123,1295`）｜**17 条 disable id 全部被 rc.5 接受**（`--dump-config` 逐条 `disabled:true`）✔｜`sandbox-policy(read-only)` + `approval(ask)` ✔｜凭据层 = `<DSH_HOME>/.credentials.yaml`（**文件优先于继承 env**，与 DEV DOC §2.3 记载相反，非阻塞）✔｜会话记录 = `<DSH_HOME>/sessions/<projectKey>/<sessionId>/session.vN.jsonl.zstd` ✔。原始输出：`T0-dump-default-config.txt`、`T0-dump-config-patched.txt`、`00-env.txt`。
- 凭据落盘：`dsh-home\.credentials.yaml`（`DEEPSEEK_API_KEY: <value>`，ACL 仅当前用户，值从不打印）。rc.5 **自动把 flat 布局迁移成 `version: 1` + `refs:`**（首读后文件 54 B → 73 B），证明它确实被 DSH 读取。

### T1（准备用 server + 合成②）
- `GET /api/healthz` → **200**（`llm_connectivity` degraded 属预期：Synova 侧未配 LLM key，本链模型走 DSH）。
- 合成账号 `synth-1455@example.invalid`（`role=admin`、`orgId=synth-org-1455`）：register 201 + login 200，JWT 由服务端签发。
- 播种最小合成②：root `synth-problem-1455-q3` + 2 个 `metric` 邻接（都带 `period=2026-Q3`、`defVersion=v1`）⇒ **走产品工具路径** `buildContextSnapshot` 校验：`synthetic:false`、`count=2`、`layer=②`、`visibility=enterprise`。见 `T1-seed-output.json`。
- 准备用 server 已停（进程树 PID 记录在 `T1-server-pids.txt`，**非产品停法，不计入 Done 8**；18790 listener 归零、DB 与安装目录保留）。

### T2（supervisor 生命周期 + MCP 工具面）
- `start.ps1` → `ready=true, protocolVersion=1, agentName=deepseek-harness-acp, installedVersion=0.2.2-rc.5`，`supervisorPid=22680 / acpPid=11060`（`T2-start-2.json`、`T2-status-2.json`、`T2-status-installdir-2.json`）。
- `stop.ps1` → `stopped=true`，两 PID 双消失、状态文件删除（`T2-stop-2.json`）。**Done 8(b) 成立**。
- MCP `tools/list` 探针（直连回环，不耗模型轮次）：`initialize → notifications/initialized → tools/list` ⇒ **只广告 1 个工具** `synova_context_get`（入参仅 `problemId`）；positive 调用 `count=2`/`synthetic:false`；negative 调用结构化 `DOMAIN_EMPTY`。11 条断言全 true（`11-mcp-tools-list.json`）。

---

## 4 与 DEV DOC v3 / v3.1 的偏差（全部留证，不静默）

| # | 偏差 | 为什么 | 影响 |
|---|---|---|---|
| D1 | `install-dsh-runtime.ps1` 经**调用方作用域 shim** 执行（只替换 `ConvertFrom-Json`） | 本机只有 Windows PowerShell **5.1**（无 pwsh 7）；5.1 无法解析 npm v11 `lockfileVersion=3` 的 `packages` 空根键 `""` ⇒ 脚本第 129 行抛 PSArgumentException | 脚本正文/钉死 integrity/版本检查/写 lock 一字未改；失败原始输出见 `T0-install-attempt1-failure.txt`，另用 node 独立复核 version/integrity |
| D2 | Electron 二进制由**缓存 zip 手工解压**到 `node_modules/electron/dist` 并写 `path.txt` | `npm ci` 后 `node_modules/electron/dist` 只剩 `LICENSES.chromium.html`，`install.js` 静默 exit 0 不修复 | 纯构建产物（`node_modules` 不入库）；解压后 `electron --version` = 33.4.11 |
| D3 | Electron 启动加了 `--inspect=9223`（原命令只有 `--remote-debugging-port=9222`） | 为 T4 的 `app.quit()`（产品 `before-quit → backendHandle.stop()` 链）预留主进程入口 | 本次 T3 已阻塞，该 flag 未被用于任何验收判定 |
| D4 | 启动 App 前**移除继承的 `ELECTRON_RUN_AS_NODE=1`** | 父 shell（DSH 宿主）带着该变量，会让 `electron.exe` 以纯 node 身份跑、根本不进入 App | 只影响 App 进程本身；后端子进程由产品代码自行决定 |
| D5 | T2 跑了 3 轮（2 轮定位 + 1 轮取证重采） | 第 1 轮 `start.ps1` 的 stdout 被自身进程树占住管道、第 3 轮前一次 `status` 因 supervisor 已停被覆盖成 NOT_RUNNING | 证据统一取 cycle 2（文件名 `T2-*-2.redacted.json`），`02-acp-initialize.json` 内已注明 |
| D6 | supervisor 原始 JSON 的 `controlToken` 值在**提交件**里被替换为 `<redacted>` | 该字段是回环 supervisor 的瞬时控制 token，按本票数据边界不提交任何 token 值 | 未脱敏原件留在任务根（仓外）+ 两份 sha256 对照见 `T2-raw-redaction.txt`；除该字段外逐字节一致 |

---

## 5 数据 / 安全边界（声明）

- 只用**合成企业**（`synth-org-1455`）、**合成 problemId**（`synth-problem-1455-q3`）、最小合成②；**未读、未发**任何真实客户数据或生产 DB（`data/synova.db`、`%LOCALAPPDATA%\Synova\data` 均未触碰）。
- **未读** `~/.dsh/**` 或个人配置；DSH_HOME 全程指向任务根内隔离目录。
- 一次性模型凭据：只从 `secrets\deepseek.key` 读入内存并写入 `dsh-home\.credentials.yaml`（ACL 仅当前用户），**值从不打印/记录/提交**；运行结束已删除两份文件（`CREDENTIAL-CLEANUP.txt`）。本次**未实际发起任何模型请求**（模型轮次 0）。
- 证据提交前 secrets 扫描（`sk-`/Bearer/`*_API_KEY`/JWT_SECRET/合成口令/supervisor controlToken）：**0 命中**（`T5-secrets-scan.txt`）。
- 证据中 `controlToken` 一律 `<redacted>`（回环 supervisor 瞬时控制 token，非模型凭据）。
- 未 merge / 未 close / 未 deploy；未改任何门禁、`scripts/audit/**`、`src/**`。

---

## 6 文件索引

| 文件 | 内容 |
|---|---|
| `00-env.txt` | 机器/版本/路径 + rc.5 六项契约复核结论 + 包取件事实（v3.1 勘误项） |
| `01-install.out.json` | 安装两次尝试（含失败原文定位）、install-lock、独立版本/integrity 复核、凭据落盘方式 |
| `T0-install-attempt1-failure.txt` | 首次安装的原始失败（PS 5.1 ConvertFrom-Json） |
| `T0-host-probe.txt` | pwsh 7 缺失证据 + 5.1 缺陷现场复现 |
| `T0-dump-default-config.txt` / `T0-dump-config-patched.txt` | rc.5 bundle 层 / 加 patch 后的 #1455 组合配置（17 条 disable 逐条核对依据） |
| `T1-seed-output.json` | 合成②播种 + 产品工具路径校验快照 |
| `T1-server-pids.txt` | 准备用 server 的 PID 树、停后核验 |
| `T2-start-2.redacted.json` / `T2-status-2.redacted.json` / `T2-status-installdir-2.redacted.json` / `T2-stop-2.redacted.json` | supervisor start/status(×2)/stop 原始 JSON（**仅 `controlToken` 值替换为 `<redacted>`**，见 `T2-raw-redaction.txt`） |
| `T2-start-raw.redacted.json` / `T2-stop-raw.redacted.json` | 第 1 轮 cycle 的 start/stop 原始 JSON（同上脱敏口径） |
| `T2-raw-redaction.txt` | 未脱敏原始件（留在任务根、未提交）与提交件的 sha256 对照 + 变换说明 |
| `11-mcp-tools-list.json` | MCP 探针全量（init → tools/list → 正例 → 反例，含 11 条断言） |
| `12-negative-domain-empty.json` | 反例：不存在 problemId ⇒ 结构化 `DOMAIN_EMPTY` |
| `T3-BREAK-electron-dev-self-start-ENOENT.txt` | **断点记录**：主进程 console 回放 + spawn 三变体复现 + 后果 |
| `T3-electron-stdout-raw.txt` | Electron 进程 stdout 原文 |
| `T3-desktop-no-backend.png` | 桌面 UI 已加载但"已断开/离线"（后端未起） |
| `T4-cleanup-external-terminate.txt` | 外部终止清理记录（**明确不计入 Done 8(a)**） |
| `CREDENTIAL-CLEANUP.txt` | 凭据文件删除路径 + 时间 + 核验 |
| `T5-secrets-scan.txt` / `hash-manifest.txt` | 扫描结果（0 命中）与全部产物 sha256 |

**仓外暂存**（未提交）：`_r3chain-20261123\evidence\T1-prep-server.log`（107 KB pino 运行日志）、`T2-status-raw.json` / `T2-status-with-installdir.json`（被晚到的 NOT_RUNNING status 覆盖，具误导性故不提交）。

---

## 7 要继续这条链需要什么（**需 CTO 裁定**）

1. **授权一行修复**（推荐，已实测 exit 0）：`electron/backend-spawn.cjs` 的 dev 命令改为
   `{ bin: process.execPath, args: [<npm>/bin/npx-cli.js, 'tsx', 'src/index.ts'] }`（或 `shell:true`）。
   该文件不在 DEV DOC §4.1 写集，也不在条件写集 A/B ⇒ 本票未动。
2. 修复后从 **T3** 续跑：T0–T2 的产物（rc.5 安装、合成 user/org/②、隔离 DSH_HOME）仍在任务根，可直接复用；模型轮次仍是 **1 次未用**。
3. 若 CTO 选择"先起后端再让 Electron 复用"（`reused:true`），按 Mandate 属明写停点，且 Done 8(a) 结构性不可达 —— 需要显式改判，本票不自行采取该路径。
