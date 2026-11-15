# 1A-T1 · synova-sidecar profile 与 Sidecar 生命周期（离线证据）

> 本文件 = T1-offline 交付证据。**没有执行 rc.2 官方安装、没有停止任何既有 DSH 进程、没有读取凭据、没有模型外发。**
> 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1395-1a`（分支 `feat/1395-1a-dsh-sidecar`，base `8abdaa7cf9e11ef27f49682e77e86c0d12ffed12`）

## 0. 交付面

| 件 | 路径 | 说明 |
|---|---|---|
| profile 四件 | `deploy/dsh/profiles/synova-sidecar/{package.json,cordis.yml,cordis.patch.yml,pnpm-workspace.yaml}` | 官方 `dsh-base` + `dsh-acp-app` 两个 bundle；patch 层只做安全姿态 |
| 生命周期代码 | `src/runtime/dsh/{sidecar,acp-client,errors,profile}.ts` | 启动/停止/状态/日志 + ACP ndjson 客户端 + typed error + profile 断言 |
| PS 薄包装 | `scripts/dsh-sidecar/{start,stop,status,logs}.ps1` | 调同一 CLI action；不安装、不读凭据 |
| 测试 | `tests/runtime/dsh/sidecar-lifecycle.test.ts` | 5 个用例（profile 姿态 / 改坏必红 / 真实 CLI 生命周期 / 超时 / 协议错） |
| 实物核验 | `docs/synova/product-lines/evidence/1A-T1-DSH实物核验.md` | 版本/包/源码/commit 逐项取证（rc.2 NOT_AVAILABLE） |
| 历史盘点 | `docs/synova/product-lines/evidence/1A-T1-历史运行时盘点.md` | 可复用/需适配/历史参考/可清理 四类 |

## 1. profile 安全姿态（静态断言）

`tests/runtime/dsh/sidecar-lifecycle.test.ts`（命令与退出码）：

```
CMD=npx vitest run tests/runtime/dsh/sidecar-lifecycle.test.ts
EXIT=0
Test Files  1 passed (1)
Tests       5 passed (5)
```

断言内容（全部来自 `loadSidecarProfile` + `assertSidecarProfile`，实现见 `src/runtime/dsh/profile.ts`）：

1. bundles 恰为 `['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app']`；命中 `desktop|dshmarket|sidebar|synova|dsh-web|dsh-headless` 任一片段即违规；
2. `sandbox-policy.mode = read-only`，`workspaceRoot: !!js process.cwd()`（与启动 cwd 契约绑定）；
3. `approval.policy = ask`（不继承 desktop 的 `never`）；
4. **17 条**显式 `disabled: true`（DEV DOC §5.2 的 15 条 + 过渡 Mandate 明确要求的 `web-deepseek-api`/`web-fetch-http`）；
5. `cordis.yml` 根层只允许 `[]`；patch 内不得出现 `danger-full-access` / `policy: never` / `mode: workspace-write`。

**改坏必红（M1，实测）**：把 `mode: read-only` 改成 `mode: danger-full-access` 后

```
MUTATION=M1-profile-mode CHANGED=True EXIT=1 EXPECT_MATCH=True
```

失败点为 `FORBIDDEN_TOKEN_PRESENT`（`tests/runtime/dsh/sidecar-lifecycle.test.ts` 红），随后文件已恢复原文（`git status` 无该文件改动）。同文件另两例：删 `tool-pwsh` 的 disable ⇒ `REQUIRED_DISABLE_MISSING`；`policy: ask` → `never` ⇒ `APPROVAL_POLICY_NOT_ASK`。

## 2. 固定版本 dsh 的实物口径（重要：rc.2 不在本机）

见 `1A-T1-DSH实物核验.md`。要点（本机实测）：

| 身份 | 实测 | 命令 |
|---|---|---|
| 已安装 DSH | `0.2.2-rc.1` | `<install>\resources\runtime\cli\bin\dsh.cmd --version` → `0.2.2-rc.1`，exit 0 |
| 内置 Node | `24.21.0` | `<install>\resources\runtime\primary-runtime\runtime.json` 的 `node` 字段 |
| PATH 全局 dsh | `0.2.1-alpha.2`（`D:\Program Files\npm-global`，另一套安装） | `dsh --version` |
| 候选 rc.2 安装包 | **NOT_AVAILABLE**（DEV DOC 记录的 updater/pending、TEMP、Downloads、D: 深度 3 搜索均无） | 见核验文件 §4 |
| rc.2 SHA512 / 包内 runtime.json | **NOT_AVAILABLE**（无实物即不冒充） | — |
| rc.2 源码断面 / commit `ddac9676…` | **SOURCE_NOT_AVAILABLE / COMMIT_UNVERIFIED** | 见核验文件 §6 |
| 仓外源码断面 `D:\dsh-ref` | `0.2.1-rc.2`（`687f282e…`），**不是** rc.2 | `git -C D:\dsh-ref rev-parse HEAD` |

结论：**T1 的 rc.2 实物核验无法完成**（包已不在本机）；本文件的运行期证据一律用**已安装 rc.1** 标注，禁止当作 rc.2 证据。

## 3. profile 运行期核对（rc.1，`--dump-config`）

```
CMD=(cwd=instance) "…\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile synova-sidecar --dump-config
EXIT=0
LINES=412
sandbox-policy@L140:     mode: read-only |     workspaceRoot: !!js process.cwd()
approval@L155:     policy: ask
disabled_true_count=21
```

- `21 = 17（本 profile 显式禁用）+ 4（bundle 默认禁用）`；
- 首行有一条 **rc.1 特有 warning**：`dsh: [...cordis.patch.yml] patch: entry "tool-agent-team" not found` —— rc.1 的 shipped bundles 没有该 id；本 profile 以**锁定目标 rc.2** 为准保留该条，rc.2 是否含该 id **UNVERIFIED**（rc.2 实物缺失）。本项未导致启动失败。
- `workspaceRoot` 在 dump 中保持未求值的 `!!js process.cwd()`（dump 不求值表达式），其运行期解析由 §4 的 cwd 契约证明。

## 4. 真实生命周期（已安装 rc.1 实物 + 真实 supervisor 子进程）

镜像：`scripts/dsh-sidecar/{start,status,logs,stop}.ps1`，DSH_HOME 与 instance 均为临时目录（`%TEMP%\synova-1a-probe2`），**未碰 `~/.dsh`、未停既有 DSH 宿主（PID 23856 保持运行）**。

**start**（exit 0，5.3s）：

```
{"schemaVersion":1,"profile":"synova-sidecar",
 "dshHome":"…\\synova-1a-probe2\\home","instanceDir":"…\\synova-1a-probe2\\instance",
 "workspaceRoot":"…\\synova-1a-probe2\\instance",
 "installDir":"C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness",
 "supervisorPid":33904,"acpPid":40008,"controlPort":62262,
 "ready":true,"protocolVersion":1,"agentName":"deepseek-harness-acp",
 "ok":true,"running":true,"controlReachable":true,"action":"start"}
```

- 就绪判据 = ACP `initialize` 返回 `protocolVersion=1` 且 `agentInfo.name=deepseek-harness-acp`（取自真实 rc.1 ACP 服务端）；
- **cwd 契约**：子进程 `cwd = instanceDir`（日志 `sidecar spawning acp app ... cwd=<instance>`），`workspaceRoot` 状态值 = `path.resolve(instanceDir)`，二者逐字符一致。

**status**（exit 0）：`ready=true, running=true, controlReachable=true, sessions=0`。

**logs**（exit 0，末 6 行含）：

```
2026-11-15T02:28:23.337Z INFO acp out initialize
{"time":"…","level":"info","component":"acp","id":1,"message":"out initialize"}
2026-11-15T02:28:25.569Z INFO acp in
{"time":"…","level":"info","component":"acp","id":1,"message":"in"}
2026-11-15T02:28:25.571Z INFO sidecar ready
{"time":"…","level":"info","component":"sidecar","protocolVersion":1,"agent":"deepseek-harness-acp","workspaceRoot":"…\\instance","controlPort":62262,"message":"ready"}
```

**stop**（exit 0）：

```
{"ok":true,"stopped":true,"supervisorPid":33904,"action":"stop"}
supervisorPid=33904 alive=False | acpPid=40008 alive=False | stateFileExists=False
```

**status after stop**（exit 1，错误可见）：

```
{"ok":false,"code":"SIDECAR_NOT_RUNNING","phase":"control","retryable":false,
 "message":"Sidecar 未运行（无状态文件: …\\run\\synova-sidecar.json）"}
```

补充断言（测试内，fake ACP 但真实 CLI + 真实 supervisor 进程）：

```
CMD=npx vitest run tests/runtime/dsh/sidecar-lifecycle.test.ts
EXIT=0  5 passed
```

- start → ready → status → logs → stop 全链；stop 后 supervisor 进程消失、状态文件删除、`status` exit 1；
- ACP 不应答 initialize ⇒ `SIDECAR_START_TIMEOUT`（retryable=true），不留进程；
- initialize 返回非 dsh ACP 服务端 ⇒ `SIDECAR_PROTOCOL_ERROR`（retryable=false），不冒充就绪。

## 5. 边界与不做

- 未执行 rc.2 官方安装/升级；未停止任何 DSH 进程；未实机回滚；未读 `~/.dsh/.credentials.yaml`；
- `close session ≠ stop process`：`stop` 先 ACP dispose 再杀子进程，并**验证 PID 消失**；
- 启动失败一律写 `failure` 到状态文件，父进程抛同一 `code/phase/retryable`（不笼统报 spawn failed）。

## 6. 四态结论

| 项 | 状态 | 依据 |
|---|---|---|
| profile 安全姿态 | **PASS（离线）** | 5 测试 + dump-config（rc.1） |
| start/stop/status/logs（rc.1 实物） | **PASS（rc.1）** | §4 原始输出 + exit code |
| rc.2 profile/ACP 运行期 | **UNVERIFIED** | rc.2 安装包不在本机（NOT_AVAILABLE） |
| rc.2 `workspaceRoot` 解析值 | **UNVERIFIED** | 同上；cwd 契约已由 rc.1 + fake ACP 证明 |
| 官方安装/停机窗口/回退演练 | **NOT DONE**（停点） | 过渡 Mandate §5 硬停点 |
