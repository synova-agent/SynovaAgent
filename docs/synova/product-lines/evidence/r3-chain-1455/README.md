# R3 chain — DSH 最小真实复用证明链（Gitea #1455）· 实机证据

> **结论：R3 达成（Done 1–7 PASS，8(b) PASS，**8(a) UNVERIFIED**（产品缺陷，见 §6），9/10 PASS）。**
> 链在 **rc.5 实物**上真实跑通：桌面端登录 → 输入合成 prompt → 发起 → **DSH 调 `synova_context_get` 拿到真实 ② 数据** → 模型复述条目数 → 桌面收到 `run.completed`。
> 依据：DEV DOC **v3**（评论 14384）＋ **v3.1 勘误**（评论 14395）＋ 关卡 A（评论 14394）＋ Mandate（14396）＋ **CTO 补充裁定 S1（评论 14400：T3 走"复用隔离 server"，Done 8(a) 记 UNVERIFIED）**。

| 项 | 值 |
|---|---|
| 票号 | Gitea Issue **#1455** |
| CodeSha | `caf61fcdeb3e00c79abe9211546690ca963549a2`（Gitea main，merge #1453；全程未漂移） |
| 分支 / 工作树 | `feat/1455-r3-chain` @ `D:\novis-backup-20260526\Novis\.synova-wt-1455-r3-chain` |
| 任务根（仓外） | `D:\novis-backup-20260526\Novis\_r3chain-20261123\`（install / dsh-home / instance / data / evidence / ops） |
| rc.5 | `0.2.2-rc.5`，`INSTALL_OK`，integrity 与钉死值逐字一致 |
| **runId** | **`run_da2adbf821994bad8de96d30d0a174be`** |
| **sessionId** | **`6f9a803d-c6e7-41bc-aa2e-ea2cafc168c7`** |
| 模型轮次 | **1 / 1 已用**（唯一一轮，未重试） |
| 运行时刻 | 2026-11-23 02:33–02:40 (+08:00)；`run.completed` @ 18:35:53.957Z |

---

## 1 目标链（实际发生，逐帧可核）

`05-sse-events.txt`（8 帧原文）+ `07-dsh-session-log.jsonl`（DSH 侧会话记录）双面吻合：

| # | SSE 帧 | 时间 | 关键内容 |
|---|---|---|---|
| 1 | `run.started` | 18:35:48.268Z | userId=`node-d5954723-…`、enterpriseId=`synth-org-1455`、scope=`admin` ⇒ **真实 JWT 身份（非 DevMode `dev-admin`）** |
| 2 | `session.created` | 18:35:52.182Z | sessionId=`6f9a803d-c6e7-41bc-aa2e-ea2cafc168c7`（ACP `session/new` 返回的真实会话） |
| 3 | `egress.recorded` | 18:35:52.182Z | sha256=`e9175075…`、chars=**187**（与 `04-prompt.json` 的 prompt 逐字节相符） |
| 4 | `reasoning.delta` | 18:35:52.949Z | 模型思考：要用 problemId=`synth-problem-1455-q3` 调工具 |
| 5 | **`tool.started`** | 18:35:52.950Z | `title=mcp__synova-sidecar__synova_context_get`、callId=`call_00_QFR4A…` |
| 6 | **`tool.finished`** | 18:35:52.970Z | `status=completed`、`isError=false` |
| 7 | `text.delta` | 18:35:53.955Z | 模型复述：**count=2**、两个 `$id`、每个条目的 `period=2026-Q3`/`defVersion=v1` |
| 8 | **`run.completed`** | 18:35:53.957Z | `stopReason=end_turn`、`stats={textDeltas:1,reasoningDeltas:1,toolCalls:1,chars:304}`、**`empty=false`** |

**DSH 侧原始记录**（`07-dsh-session-log.jsonl`，帧感知解压 11 帧 / 7154 B → 16930 B / 25 行，**Σ帧字节 == 文件字节数**）：

- 第 1 行 header：`{"type":"session","version":4,"id":"6f9a803d-…","cwd":"…\_r3chain-20261123\instance"}`
- 第 2 行：`permission/preset = read-only`（profile 安全姿态在真机生效）
- L17 `tool/call`：`name=mcp__synova-sidecar__synova_context_get`，`arguments={"problemId": "synth-problem-1455-q3"}`
- L18 `tool/result`：`{"synthetic":false,"problemId":"synth-problem-1455-q3","count":2,…}` ⇒ **真实 ② 数据，不是合成快照**

**桌面端**（`08-desktop.png`、`T3-cdp-result.json`）：面板显示 **"已登录（令牌只在内存）"**、**"运行完成"**、运行编号/会话编号与上表一致；事件列表 2 条（工具 `mcp__synova-sidecar__synova_context_get` 状态 completed + 模型文本）；底部状态 **"在线"**。

---

## 2 R3 逐项判定（Done 1–10）

| # | 判据 | 判定 | 证据 |
|---|---|---|---|
| 1 | rc.5 实物与来源 | **PASS** | `01-install.out.json`（INSTALL_OK + lock + 独立 version/integrity 复核）、`00-env.txt` |
| 2 | initialize 成功 | **PASS** | `02-acp-initialize.json`：`ready=true, protocolVersion=1, agentName=deepseek-harness-acp`（同一 rc.5 安装/同一 profile；T3 成功隐含 run 路径 initialize 成功） |
| 3 | 非空 sessionId | **PASS** | `03-session.json`：run 快照 / `session.created` 帧 / DSH header **三方同值**，且 DSH 会话目录存在（`…/sessions/--D--novis…instance--/6f9a803d-…/session.v4.jsonl.zstd`） |
| 4 | prompt 真实请求与完成 | **PASS** | `04-prompt.json`：prompt 187 字符、sha256 与 `egress.recorded` **逐字相同**；`06-run-snapshot.json` status=`completed` |
| 5 | DSH 侧工具调用与返回 | **PASS** | `07-dsh-session-log.jsonl` 含 `tool/call`(name=`synova_context_get`) + `tool/result`(`synthetic:false`,`count=2`)；`11-mcp-tools-list.json` 证明 Synova 侧只广告该只读工具 |
| 6 | DSH 产事件 | **PASS** | `05-sse-events.txt` 的 `reasoning.delta`/`tool.*`/`text.delta` 与 `07` 的 DSH 记录时间与内容一一对应（非 Synova 自造） |
| 7 | 桌面收到 run.completed | **PASS** | `08-desktop.png` + `T3-cdp-result.json`（DOM `data-run-status=done`、运行编号=runId、事件 2 条）+ `09-desktop-console.txt` |
| 8 | close/stop 后进程退出 | **(b) PASS / (a) UNVERIFIED** | (b) `02-acp-initialize.json`：`stop.ps1` → supervisor 22680 + ACP 11060 双 PID 消失；(a) 见 §6（产品缺陷 #1456，S1 裁定不做） |
| 9 | 同 CodeSha / runId / 时间窗 | **PASS** | 全产物 `codeSha=caf61fcd`；runId/sessionId 贯穿 03–10；时间窗 02:33–02:40 (+08) 内 |
| 10 | 无 Secrets / 数据边界明确 | **PASS** | `T5-secrets-scan.txt`（0 命中）、`CREDENTIAL-CLEANUP.txt`、§7 边界声明 |

**反例（必跑，不耗模型轮次）**：**PASS** —— `12-negative-domain-empty.json`：不存在的 problemId ⇒ HTTP 200 + 结构化 `DOMAIN_EMPTY`（`isError:true`），不是空成功。

---

## 3 T3 路径：复用隔离 server（CTO 裁定 S1）

| 事实 | 值 |
|---|---|
| 隔离 server | `npx tsx src/index.ts`，T1 任务 env（`SYNOVA_DSH_*`/`SYNOVA_DATA_DIR`/`JWT_SECRET`/`DEV_MODE=true`/`PORT=18790`），**由本任务先起并保持运行** |
| 18790 owner | 启动 Electron **前 = 11940**，启动**后 = 11940**，退出**后 = 11940**（同一进程；healthz uptime 持续增长） |
| Electron | `npx electron electron/main.cjs --remote-debugging-port=9222 --inspect=9223`（同一 env，`ELECTRON_RUN_AS_NODE` 已移除） |
| reused 判定 | Electron 主进程 console **只有** `boot mode=dev server=http://localhost:18790` + `preload-check OK`，**没有** `backend-spawn` 失败/降级行（与 `T3-BREAK-*` 的失败输出形成对照）；Electron 子进程只有 gpu/utility/renderer，**0 个 `src/index.ts` 后端子进程** |
| 桌面登录 | devmode → 点"使用账号登录" → 合成账号 → `auth=authenticated`；run 的 `userId/enterpriseId` 是真实 JWT 身份（DevMode 会是 `dev-admin`/`default`）⇒ 登录步骤真实发生 |
| 桌面发起 | `#dsh-run-input` 填入 187 字符 prompt → 点"发起会话"（`T3-drive-trace-transcribed.json` 逐步记录） |

---

## 4 rc.5 六项契约复核（T0 实机，全部通过）

`lib/bin.js` ✔｜`--profile` 参数族 ✔｜`agentInfo.name=deepseek-harness-acp`（`dsh-acp/lib/index.js:1123,1295`）✔｜**17/17 条 disable id 被 rc.5 接受**（`--dump-config` 逐条 `disabled:true`）✔｜`sandbox-policy(read-only)`+`approval(ask)` ✔｜凭据层 `<DSH_HOME>/.credentials.yaml`（**文件优先于继承 env**；rc.5 首读把 flat 布局迁移成 `version:1`，54B→73B）✔｜会话记录 `<DSH_HOME>/sessions/<projectKey>/<sessionId>/session.vN.jsonl.zstd`（本次实测 `session.v4`）✔

原始输出：`00-env.txt`、`T0-dump-default-config.txt`、`T0-dump-config-patched.txt`。

---

## 5 T1/T2 已取得（沿用本次提交）

- **T1**：`/api/healthz` 200；合成账号 register 201 + login 200（`role=admin`、`orgId=synth-org-1455`）；合成②走产品工具路径 `buildContextSnapshot` ⇒ `synthetic:false,count=2,layer=②,visibility=enterprise`（`T1-seed-output.json`）；准备用 server 停掉并记录 PID（`T1-server-pids.txt`，非产品停法）。
- **T2**：supervisor `start/status/stop` ⇒ `ready=true, protocolVersion=1, agentName=deepseek-harness-acp`，stop 后 supervisor+ACP 双 PID 消失（`02-acp-initialize.json`，**Done 8(b)**）；MCP 探针 11/11 断言（`11-mcp-tools-list.json`）+ 反例（`12-negative-domain-empty.json`）。

---

## 6 已知差距（非本票范围，CTO 已登记 #1456）

`electron/backend-spawn.cjs` 的 **dev 模式无法自起后端**：`buildCommand('dev')` = `spawn('npx', ['tsx','src/index.ts'], {shell:false})`，Windows 下 `spawn('npx')`=**ENOENT**、`spawn('npx.cmd')`=**EINVAL**（node 24 拒绝无 shell 起 `.cmd`）、`spawn(process.execPath,[npx-cli.js,…])`=exit 0。
⇒ **Done 8(a)（Electron 自起后端 → `before-quit` → `backendHandle.stop()`）结构性不可达，记 UNVERIFIED**（S1 §3 裁定）。
证据：`T3-BREAK-electron-dev-self-start-ENOENT.txt`（主进程 console 回放 + 三段最小复现）、`T3-electron-stdout-raw.txt`、`T3-desktop-no-backend.png`、`T4-cleanup-external-terminate.txt`（首次尝试的外部清理记录，明确不计入 Done 8）。

**T4 本次实际动作**：Electron 经 CDP browser 端点 `Browser.close` 退出（`10-process-exit.txt`）；在 reused 模式下产品 `before-quit` 本就无 `backendHandle.stop` 可调，故不构成进程回收证据。隔离 server 随后按**测试卫生**停止（`T4b-server-test-hygiene.txt`，**不计入 Done 8**，非外部 taskkill 冒充）。

---

## 7 数据 / 安全边界（声明）

- 只用**合成企业**（`synth-org-1455`）、**合成 problemId**（`synth-problem-1455-q3`）、最小合成②；**未读、未发**真实客户数据或生产 DB（`data/synova.db`、`%LOCALAPPDATA%\Synova\data` 未触碰）。
- **未读** `~/.dsh/**` 或个人配置；DSH_HOME 全程指向任务根内隔离目录。
- 一次性模型凭据只从 `<任务根>\secrets\deepseek.key` 读入并写入 `dsh-home\.credentials.yaml`（ACL 仅当前用户），**值从不打印/记录/提交/进 prompt**；运行后已删除两份文件（`CREDENTIAL-CLEANUP.txt`）。
- 模型请求只含完成该轮的最小合成内容（187 字符，含 sha256 绑定）；DSH 会话记录只含合成文本。
- 证据提交前 secrets 扫描：**0 命中**（`T5-secrets-scan.txt`）。
- 未 merge / 未 close / 未 deploy；未改任何门禁、`scripts/audit/**`、`src/**`、`electron/**`。

---

## 8 与 DEV DOC / Mandate 的偏差（全部留证）

| # | 偏差 | 为什么 | 影响 |
|---|---|---|---|
| D1 | `install-dsh-runtime.ps1` 经**调用方作用域** `ConvertFrom-Json` shim 执行 | 本机只有 Windows PowerShell **5.1**（无 pwsh 7），5.1 解析不了 npm v11 `lockfileVersion=3` 的空根键 | 脚本正文/integrity/版本检查/lock 写入**一字未改**；失败原文 `T0-install-attempt1-failure.txt`，另用 node 独立复核 |
| D2 | `node_modules/electron/dist` 由缓存 zip 手工解压 + 写 `path.txt` | `npm ci` 后 dist 不完整、`install.js` 静默 exit 0 | 纯构建产物（`node_modules` 不入库） |
| D3 | Electron 启动加 `--inspect=9223` | 原为 T4 的 `app.quit()` 预留 | 本次 `app.quit()` 在主进程 inspector 里不可达（无 `require`/`process.mainModule`），改用 CDP `Browser.close`；未用于任何验收判定 |
| D4 | 启动 App 前移除继承的 `ELECTRON_RUN_AS_NODE=1` | 父 shell 带该变量会让 `electron.exe` 以纯 node 跑 | 只影响 App 进程本身 |
| D5 | T3 改走**复用隔离 server**（`reused:true`） | **CTO 裁定 S1 §2 显式授权**（取代 Mandate 的"必须自起后端"） | Done 8(a)→UNVERIFIED；其余验收口径不变 |
| D6 | supervisor 原始 JSON 提交件 `controlToken` 替换为 `<redacted>` | 回环控制 token 不入库 | 原件留任务根 + 双 sha256 对照：`T2-raw-redaction.txt` |
| D7 | T2 跑了 3 轮（定位 2 + 取证重采 1） | 首轮 stdout 被自身进程树占住管道等 | 证据统一取 cycle 2（`T2-*-2.redacted.json`），`02-acp-initialize.json` 已注明 |
| D8 | `T3-drive-trace-transcribed.json` 是**转录件**（非机器写入） | 成功那轮 `run-drive.mjs` 的 stdout JSON 随后被 `--capture-only` 重写覆盖 | 文件内已写明出处；其余 05/06/07/08/09/03/04 全部机器写入 |
| D9 | 驱动脚本首版事件选择器写错（`#dsh-run-events` vs `[data-testid="dsh-run-events"]`） | 面板用 `data-testid` | 已修复并用 `--capture-only` 重读真实 DOM（2 条事件）；运行本身未受影响（server 侧 toolCalls=1） |

---

## 9 文件索引

| 文件 | 内容 |
|---|---|
| `00-env.txt` | 机器/版本/路径 + rc.5 六项契约复核 + 包取件事实（v3.1 勘误项） |
| `01-install.out.json` / `T0-*` | 安装两次尝试（含失败原文）、lock、独立复核；rc.5 默认配置与 patched 配置（17 条 disable 依据） |
| `03-session.json` | sessionId 三方同值 + DSH 会话目录/文件/帧覆盖/解压检查 + header |
| `04-prompt.json` | prompt 原文 + sha256 + `egress.recorded` 逐字比对 + 工具帧/终态帧 |
| `05-sse-events.txt` / `T3-sse-meta.json` | 原始 SSE 8 帧 + 帧统计 |
| `06-run-snapshot.json` | run 快照（status/sessionId/stats/terminal） |
| `07-dsh-session-log.jsonl.zstd` | DSH 会话记录**原样副本**（7154 B，sha256 见 03） |
| `07-dsh-session-log.jsonl` | **帧感知**解压副本（11 帧 / 16930 B / 25 行，Σ帧字节==文件字节数） |
| `07-dsh-session-log.decompress-report.json` | 解压/截断检测 8 项检查全 true + 逐帧明细 |
| `08-desktop.png` | 桌面 DSH 面板：已登录 / 运行完成 / runId / 事件（工具+文本） |
| `09-desktop-console.txt` / `T3-cdp-result.json` | 渲染层 console + 面板 DOM 状态（`data-run-status=done`，2 条事件） |
| `10-process-exit.txt` | T4：Electron 退出（CDP `Browser.close`）+ reuse 三项证据 + 明确不主张 8(a) |
| `T4b-server-test-hygiene.txt` | 隔离 server 测试卫生停止（不计入 Done 8） |
| `11-mcp-tools-list.json` / `12-negative-domain-empty.json` | MCP 工具面探针 + 反例 `DOMAIN_EMPTY` |
| `T1-*` / `T2-*` | 准备用 server PID 记录 + 合成②校验；supervisor start/status/stop（脱敏版）+ 脱敏对照 |
| `T3-BREAK-*` / `T3-electron-stdout-raw.txt` / `T3-desktop-no-backend.png` | **已知差距 #1456** 的原始证据（首次尝试） |
| `T3-drive-trace-transcribed.json` | 桌面驱动步骤转录（登录/提交/终态轮询） |
| `T5-secrets-scan.txt` / `hash-manifest.txt` / `CREDENTIAL-CLEANUP.txt` | 扫描 0 命中、全部产物 sha256、凭据删除记录 |

**仓外暂存（未提交）**：`_r3chain-20261123\evidence\T1-prep-server.log`、`07-dsh-session-log.{pre,post}-quit.jsonl.zstd`（与最终件同 sha256）、`08-desktop-failure.png`、首轮 `T2-status-*.json`（被晚到覆盖，具误导性）。

---

## 10 结论与后续

- **R3 = 达成**：`initialize → session/new → prompt → synova_context_get（真实 ②）→ run.completed` 在 rc.5 实物上端到端跑通，桌面端可见，DSH 侧原始记录可核，模型轮次只用 1 次。
- **未达成 1 项**：Done 8(a)（Electron 自起后端 → `before-quit` → `backendHandle.stop()`）—— 产品缺陷 **#1456**，本票不改，按 S1 记 UNVERIFIED。
- 后续建议：修 #1456 后补一次 Done 8(a) 的**单点**验证（可用同一合成夹具，不需要再烧模型轮次：只需确认 `backendHandle.stop()` 结束后端树）。
