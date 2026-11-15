# 1A-T2 · 认证 API 与 SSE（离线证据）

> 本文件 = T2-offline 交付证据。**只用 fake ACP／合成事件，不读凭据、不外发、不调用真实模型。**
> 工作树：`D:\novis-backup-20260526\Novis\.synova-wt-1395-1a`（base `8abdaa7cf`）

## 0. 交付面与契约

| 件 | 路径 |
|---|---|
| 会话/运行适配 | `src/runtime/dsh/session.ts`（`DshRunManager`：create/run/cancel/resume/close） |
| 事件 | `src/runtime/dsh/events.ts`（`AgentEvent`：`run.started/session.created/session.resumed/text.delta/reasoning.delta/tool.started/tool.finished/egress.recorded/run.completed/run.failed/run.cancelled`） |
| 路由 | `src/routes/dsh.ts`（工厂；生产挂载在 `src/server.ts`，JWT/rbac 之后） |
| 运维驱动 | `scripts/dsh-sidecar/turn.ps1` |
| 测试 | `tests/runtime/dsh/session-events.test.ts`、`tests/routes/dsh.test.ts` |

端点（真实入口；**本批无可见 UI**）：

```
POST /api/dsh/runs                     # 认证后发起一轮；服务端注入 enterpriseId/userId/scope/runId
GET  /api/dsh/runs/:runId/events       # SSE（快照重放 + 实时；终态即结束；支持 Last-Event-ID）
GET  /api/dsh/runs/:runId              # 快照（turn.ps1 轮询；含 stats 与 proposalDraft）
POST /api/dsh/runs/:runId/cancel       # 取消该轮（不停止 Sidecar）
POST /api/dsh/sessions/:sessionId/close# 关闭会话（不停止进程）
```

安全边界：身份只取 `req.auth`（缺失一律 401）；跨企业访问同 runId 返回 404（不泄露存在性）；SSE 只回本企业 run 的事件。

## 1. 测试结果（命令 + 原始摘要 + exit code）

```
CMD=npx vitest run tests/routes/dsh.test.ts tests/runtime/dsh/session-events.test.ts
EXIT=0
Test Files  2 passed (2)
Tests       21 passed (21)     # session-events 12 + routes 9
```

事件序列断言（session-events 正常路径）：

```
run.started → session.created → egress.recorded → reasoning.delta → text.delta → run.completed
stats={textDeltas:1, chars:6}   terminal.data.stopReason=end_turn   empty=false
```

失败/边界路径（每条都断言稳定 code/phase/retryable，不空成功）：

| 场景 | 断言 |
|---|---|
| 模型失败（fake 抛 `SIDECAR_PROTOCOL_ERROR`） | `run.failed`，`code=SIDECAR_PROTOCOL_ERROR`，`phase=run`，`retryable=false` |
| 断流（fake 抛 `SIDECAR_SESSION_LOST`） | `run.failed`，`code=SIDECAR_SESSION_LOST`，`retryable=true` |
| 超时（fake 挂起，`runTimeoutMs=300`） | `run.failed`，`code=RUN_TIMEOUT`，`retryable=true`，且已主动 `cancel` 该轮 |
| 取消（`POST …/cancel`） | `run.cancelled`；取消后无新增 `text.delta`；`cancelRequested=true` |
| 空数据（fake 只回 end_turn） | `run.completed` **显式 `empty=true`**（零对象不算成功） |
| 拒绝回答（`stopReason=refusal`） | `run.failed`，`code=RUN_FAILED`（不伪装成完成） |
| 恢复（带 sessionId） | 走 `session/resume`，事件含 `session.resumed`，`sessionCreated=false` |
| runId 幂等 | 二次 POST 返回 `replayed=true`（202→200），事件不翻倍 |
| close ≠ stop process | close 会话后 fake 未 dispose，新会话继续完成 |
| 401 | POST/SSE/GET 三条路径一致 `UNAUTHORIZED` |
| 输入校验 | 空 input / 非法 runId ⇒ 400 `VALIDATION_ERROR` |
| 跨企业 | 404 `RUN_NOT_FOUND`（SSE 同样 404） |
| 断流重放 | 首连断开后重连，快照包含全部事件（首帧 `run.started`，末帧 `run.completed`，`id` 单调） |

## 2. 事件与身份口径

- `egress.recorded` 只记录 `sha256 + chars + purpose + destination`，**不落原文**；
- 运行事件是「这一轮发生了什么」的可观察记录，**不是事实/权限/决策账本**（决策仍归 Synova 领域层）；
- `run.completed` 携带 `stats` 与 `empty`，`run.failed/cancelled` 携带 `{code,phase,retryable,message}`；
- SSE 心跳为注释帧（默认 15s；测试 100ms），客户端断开只取消订阅、不杀 Sidecar。

## 3. 四态结论

| 项 | 状态 | 依据 |
|---|---|---|
| API + SSE（fake ACP） | **PASS（离线）** | 21 测试 + 原始输出 |
| 失败/超时/取消/断流可见 | **PASS（离线）** | 上表逐条断言 |
| 真实模型一轮（ACP `session/prompt` → 真实 provider） | **UNVERIFIED（停点）** | 需模型凭据与外发授权；本批禁止 |
| rc.2 的 `session/prompt` 行为 | **UNVERIFIED** | rc.2 实物缺失 |
| 可见 UI 面板 | **NOT DONE（写集外）** | 过渡 Mandate：入口 = 认证 API+SSE |
