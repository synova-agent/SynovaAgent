# R3 chain — DSH 最小真实复用证明链（Gitea #1455）· 实机证据

> **结论：R3 达成（Done 1–7 PASS、9/10 PASS、反例 PASS）。Done 8：**session close（真实产品路由）PASS**、**Sidecar stop（b）PASS**、**8(a) UNVERIFIED**（产品缺陷 #1456）。T6 收尾验证**未发出任何模型请求**，模型轮次仍为 **1/1**（主链那一次）。**
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
| 8 | close/stop 后进程退出 | **session close（产品路由）PASS / Sidecar stop（b）PASS / 8(a) UNVERIFIED** | ① **session close**：`13-session-close.json` —— `POST /api/dsh/sessions/0e8772b5-…/close` → **HTTP 200 `{"ok":true,"closed":true}`**（T6 独立失败路径 run，**不耗模型轮次**，§6.1）；② **Sidecar stop**：`02-acp-initialize.json` —— `stop.ps1` → supervisor 22680 + ACP 11060 双 PID 消失；③ **8(a)**：Electron 自起后端 → `before-quit` → `backendHandle.stop()` 不可达（§6，产品缺陷 #1456）。主链那次 run 自身的 close 未留证据，故 Done 8 的会话关闭判定**以 T6 的同一条产品路由证据**为准 |
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

- **T1**：`/api/healthz` 200；合成账号 register 201 + login 200（`role=admin`、`orgId=synth-org-1455`）；合成②走产品工具路径 `buildContextSnapshot` ⇒ `synthetic:false,count=2,layer=②,visibility=enterprise`（`T1-seed-output.log`——原始 stdout 含 pino 日志头 + JSON 体，**不是合法 JSON 文件**，故按 `.log` 提交）；准备用 server 停掉并记录 PID（`T1-server-pids.txt`，非产品停法）。
- **T2**：supervisor `start/status/stop` ⇒ `ready=true, protocolVersion=1, agentName=deepseek-harness-acp`，stop 后 supervisor+ACP 双 PID 消失（`02-acp-initialize.json`，**Done 8(b)**）；MCP 探针 11/11 断言（`11-mcp-tools-list.json`）+ 反例（`12-negative-domain-empty.json`）。

---

## 6 已知差距（非本票范围，CTO 已登记 #1456）

`electron/backend-spawn.cjs` 的 **dev 模式无法自起后端**：`buildCommand('dev')` = `spawn('npx', ['tsx','src/index.ts'], {shell:false})`，Windows 下 `spawn('npx')`=**ENOENT**、`spawn('npx.cmd')`=**EINVAL**（node 24 拒绝无 shell 起 `.cmd`）、`spawn(process.execPath,[npx-cli.js,…])`=exit 0。
⇒ **Done 8(a)（Electron 自起后端 → `before-quit` → `backendHandle.stop()`）结构性不可达，记 UNVERIFIED**（S1 §3 裁定）。
证据：`T3-BREAK-electron-dev-self-start-ENOENT.txt`（主进程 console 回放 + 三段最小复现）、`T3-electron-stdout-raw.txt`、`T3-desktop-no-backend.png`、`T4-cleanup-external-terminate.txt`（首次尝试的外部清理记录，明确不计入 Done 8）。

**T4 本次实际动作**：Electron 经 CDP browser 端点 `Browser.close` 退出（`10-process-exit.txt`）；在 reused 模式下产品 `before-quit` 本就无 `backendHandle.stop` 可调，故不构成进程回收证据。隔离 server 随后按**测试卫生**停止（`T4b-server-test-hygiene.txt`，**不计入 Done 8**，非外部 taskkill 冒充）。

### 6.1 会话关闭（Done 8 的另一半）：T6 补齐后 **PASS**（真实产品路由，0 模型轮次）

主链那次 run（`run_da2adbf821994bad8de96d30d0a174be`）的 close 调用**没有落盘为证据**，因此按"无证据不计通过"当时记 UNVERIFIED。
**T6 收尾验证**用同一条产品路由补齐（`13-session-close.json`）：

| 项 | 值 |
|---|---|
| 前提 | 两份凭据文件**均已删除** ⇒ DSH rc.5 **请求时**解析凭据 ⇒ prompt 在**发出模型请求前**失败 |
| 隔离 server | T1 同 env（`SYNOVA_DATA_DIR`/`SYNOVA_DSH_*`/`JWT_SECRET`/`PORT=18790`），pids `10180→18876`；起 `02:54:18`，停 `02:55:57`（测试卫生，见 `T6-server-test-hygiene.txt`，**不计入 Done 8**） |
| run（run 2） | `run_e048ff75308b4ac4b3b4692c0fcbd6f6`，prompt 15 字符「T6 收尾验证：只回答 OK。」 |
| run 终态 | **`run.failed`**，`code=SIDECAR_PROTOCOL_ERROR`（Synova 侧码），message 原文：`[-32603] Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service …` — 即"等价无凭据码" |
| stats | `{textDeltas:0, reasoningDeltas:0, toolCalls:0, chars:0}`；`run.started → run.failed` 仅 **~78 ms** |
| **close** | `POST /api/dsh/sessions/0e8772b5-5eb1-41b6-9c14-afc2a3c1f1cc/close` → **HTTP 200 `{"ok":true,"sessionId":"0e8772b5-…","closed":true}`** ⇒ **PASS** |
| DSH 侧无模型请求证明 | 两次 T6 run 的 DSH 会话记录（`T6-run1-session.jsonl` / `T6-run2-session.jsonl`，各 6 帧、字节覆盖通过）末段为 `assistant/attempt`(chunk.finish `reason=error`) + `turn/end`(error)；**0 个 `assistant/message`、0 个 usage chunk、0 个内容块、0 次 tool/call** |
| 结论 | **session close（真实产品路由）= PASS**；**本轮未发出任何模型请求，模型轮次仍为 1/1**（唯一一轮属于 R3 主链） |

补充说明（如实记录）：
- T6 的 **run 1** 因我的执行脚本序列化 bug（`ReferenceError`）**丢了 HTTP 层证据**，但其 DSH 会话记录保留（`T6-run1-session.jsonl`，同样的无凭据错误、同样 0 输出）⇒ 两轮互证；run 1 不计入任何通过判定。
- 该 run 属**失败路径**，单独标注 runId/时间，**不并入 R3 主链判定**。

### 6.2 CI 失败分类（PR #1457 / run 4607 / job 4837）：非产品代码失败

CI 结论：`core-gates / core` = **Failing after 1m52s**（commit `5ed8130ef`，combined=failure）。失败行原文（从 job 4837 日志逐字摘出）：

```
relevant changes produced no affected test files
CORE-TESTS RESULT rc=1 contract_passed=92 user_visible_passed=10 affected=ran affected_passed=0 reason=affected-no-tests
##[error]Process completed with exit code 1.
```

判读：
- `contract_passed=92` / `user_visible_passed=10` ⇒ **契约测试与用户可见测试全部通过**；红来自 `affected_passed=0`。
- `reason=affected-no-tests`：本 PR 含 3 个 `scripts/dsh-sidecar/r3-chain/*.ts`（`install-profile.ts` / `seed-synthetic.ts` / `mcp-probe.ts`），门禁把它们算作"代码面变更"，而 `vitest --changed` 找不到受影响测试 ⇒ 命中 `scripts/ci/core-tests.sh:349` 的 `fail_test "relevant changes produced no affected test files" "affected-no-tests"`。
- ⇒ **不是产品代码失败**（本票 `src/**` 0 行、`electron/**` 0 行改动）。
- **不为绕门禁做任何事**：不移动脚本位置、不加假测试、不改 `scripts/ci/**` 或 workflow；PR **保持 open、不 merge**，口径由 CTO 改判（例如 affected 集合口径，或证据脚本的豁免范围）。

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
| `07-dsh-session-log.decompress-report.json` | 解压/截断检测 8 项检查全 true + 逐帧明细。字段口径（#1458）：`codeSha` = **证据基线**（当时锁定的 base SHA，不是生产者）；`producer` = **实际产出该报告的代码**（`{path, sha256}`，指向 `scripts/dsh-sidecar/r3-chain/lib/frame-decompress.mjs`）。**本件早于 `producer` 字段存在，故无该字段**；重跑会多出它，其余字段逐字段不变（由 `tests/dsh-sidecar/frame-decompress.test.ts` golden 用例守着） |
| `08-desktop.png` | 桌面 DSH 面板：已登录 / 运行完成 / runId / 事件（工具+文本） |
| `09-desktop-console.txt` / `T3-cdp-result.json` | 渲染层 console + 面板 DOM 状态（`data-run-status=done`，2 条事件） |
| `10-process-exit.txt` | T4：Electron 退出（CDP `Browser.close`）+ reuse 三项证据 + 明确不主张 8(a) |
| `T4b-server-test-hygiene.txt` | 隔离 server 测试卫生停止（不计入 Done 8） |
| `13-session-close.json` | **T6**：真实产品关闭会话路由 —— 无凭据 `run.failed` + `POST /api/dsh/sessions/:id/close` → `{ok:true,closed:true}`；两轮 run、PID/时间、无模型请求证明 |
| `T6-run1-session.jsonl` / `T6-run2-session.jsonl`（+ `.decompress-report.json`） | 两次 T6 run 的 DSH 会话记录（帧感知解压，字节覆盖通过；末段 `turn/end`=error，0 个 assistant/usage/内容块） |
| `T6-server-test-hygiene.txt` | T6 隔离 server 测试卫生停止记录（不计入 Done 8） |
| `11-mcp-tools-list.json` / `12-negative-domain-empty.json` | MCP 工具面探针 + 反例 `DOMAIN_EMPTY` |
| `T1-*` / `T2-*` | 准备用 server PID 记录 + 合成②校验；supervisor start/status/stop（脱敏版）+ 脱敏对照 |
| `T3-BREAK-*` / `T3-electron-stdout-raw.txt` / `T3-desktop-no-backend.png` | **已知差距 #1456** 的原始证据（首次尝试） |
| `T3-drive-trace-transcribed.json` | 桌面驱动步骤转录（登录/提交/终态轮询） |
| `T5-secrets-scan.txt` / `hash-manifest.txt` / `CREDENTIAL-CLEANUP.txt` | 扫描 0 命中、全部产物 sha256、凭据删除记录 |

**仓外暂存（未提交）**：`_r3chain-20261123\evidence\T1-prep-server.log`、`07-dsh-session-log.{pre,post}-quit.jsonl.zstd`（与最终件同 sha256）、`08-desktop-failure.png`、首轮 `T2-status-*.json`（被晚到覆盖，具误导性）。

---

## 10 结论与后续

- **R3 = 达成**：`initialize → session/new → prompt → synova_context_get（真实 ②）→ run.completed` 在 rc.5 实物上端到端跑通，桌面端可见，DSH 侧原始记录可核，模型轮次只用 1 次。
- **未达成 2 项**：① Done 8(a)（Electron 自起后端 → `before-quit` → `backendHandle.stop()`）—— 产品缺陷 **#1456**；② CI `core-gates / core` —— `reason=affected-no-tests`（§6.2），非产品代码失败，PR 不 merge。
- **Done 8 的会话关闭部分已由 T6 补齐**（真实产品路由 `POST /api/dsh/sessions/:id/close` → `{ok:true,closed:true}`，0 模型轮次，§6.1）；主链那次的 close 未留证据，判定以 T6 同路由证据为准。
- 后续建议：修 #1456 后补一次 Done 8(a) 的**单点**验证（可用同一合成夹具，不需要再烧模型轮次：只需确认 `backendHandle.stop()` 结束后端树）。
