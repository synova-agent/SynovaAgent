# src/runtime — 运行时端口（−1 运行时）

## Summary

把「工具派发 ＋ 审批」抽成**端口**（Contract），真实现与替身是两个 **Provider**，MCP server 只依赖端口：

```
Contract:  src/runtime/port.ts          （RuntimePort / ToolDispatcher / RuntimeApprovalPort / resolveRuntimeProvider）
Provider:  src/runtime/impl/real.ts     （真宿主：dispatch 透传 ＋ 审批原样委托）
Provider:  src/runtime/impl/stub.ts     （假宿主：只支持 sentinel_list，其余工具 typed 未支持）
Consumer:  src/mcp/index.ts             （只 import 端口，不 import L3）
```

目的：把宪章 **P11**「复用宿主能力，核心不依赖宿主 —— 换掉宿主，领域层一行不改」从一句声明变成**可复跑装置**。

## Use this package

### When to choose it

- **生产 / 开发（缺省）**：不设置 `SYNOVA_RUNTIME_PROVIDER` ⇒ `real`。工具派发走既有 `handleToolCall`，审批走既有 `approval-seam`。
- **全链路验证「假宿主」**：`SYNOVA_RUNTIME_PROVIDER=stub` ⇒ 只支持 `sentinel_list` 的替身宿主；用于证明同一套领域断言换宿主仍成立（M9 客户形态段的预演装置）。

### Minimal configuration

```bash
# 真宿主（缺省；等价于 SYNOVA_RUNTIME_PROVIDER=real）
npx tsx src/mcp/index.ts

# 假宿主（MCP 全链路测试用：必须 full 模式，否则写工具被权限门先拦）
SYNOVA_MCP_MODE=full SYNOVA_RUNTIME_PROVIDER=stub npx tsx src/mcp/index.ts
```

唯一的开关是 `SYNOVA_RUNTIME_PROVIDER`（本批为可测性引入）；它**只接受** `real` / `stub` / 未设置。

### What success and failure look like

- **成功**：`sentinel_list` ⇒ `{"ok":true,"total":E,"sentinels":[…E 条]}`；real 与 stub 两个 Provider 下**同一组断言都绿**（`tests/runtime/port.test.ts`）。
- **失败（启动期，fail loud）**：`SYNOVA_RUNTIME_PROVIDER=smoke` ⇒ 进程 **exit 1**，stderr 含 `RUNTIME_PROVIDER_INVALID`；**不降级 real**（防「以为在跑 stub」的假绿）。
- **失败（工具面，结构化）**：stub 下调用 `sentinel_run` / 其它工具 ⇒ `{"ok":false,"error":"RUNTIME_TOOL_UNSUPPORTED","tool":"sentinel_run","degraded":true}`（JSON-RPC 层不崩）。
- **失败（审批，fail-closed）**：无 `ask` 应答 ⇒ `decision:'rejected' ∧ allowed:false ∧ degraded:false`（政策定义的**确定的拒**，不伪装成降级）。

## Understand the implementation

### Design philosophy — 一个分离 ＋ 三条承诺

**一个分离**：宿主能力（工具派发 ＋ 审批）与领域实现的分离。Consumer（`src/mcp/index.ts`）只依赖 `RuntimePort` 契约；换 Provider 不改 Consumer，也不改领域层（`src/agent/**`、`src/sentinel/**`）。

**三条承诺**（每条都有可判据，不是口号）：

1. **换宿主不改领域** —— `tests/runtime/port.test.ts` 用 `describe.each` 在 real / stub 上跑**同一套断言**；S8「假宿主全链路」用真 stdio 子进程再验一次（`sentinel_list total===E`）。
2. **假宿主不造假** —— stub 对未支持工具返回 typed `RUNTIME_TOOL_UNSUPPORTED` ＋ `degraded:true`；不静默吞、不返回空成功、不抛协议崩溃。
3. **审批语义不随 Provider 变** —— 两个 Provider 的 `requestApproval` 都委托 `src/runtime/approval-seam.ts`；stub 只是把「没有人应答」显式注入（缺省 `() => undefined`），fail-closed 常开。

### Source map

| File | Role |
|---|---|
| `src/runtime/port.ts` | **Contract**：`RuntimeProviderId` / `ToolDispatcher` / `RuntimeApprovalPort` / `RuntimePort` / `RuntimePortError` / `resolveRuntimeProvider`（只 `import type` 自 `./approval-seam`） |
| `src/runtime/impl/real.ts` | **Provider（real）**：`createRealPort({ dispatch })`；`callTool === dispatch`；审批原样委托 |
| `src/runtime/impl/stub.ts` | **Provider（stub）**：`createStubPort({ ask? })`；`sentinel_list` 复用 L2 出口 `listSentinels()`；其余工具 typed 未支持 |
| `src/runtime/approval-seam.ts` | 既有审批缝（**只读复用**，本批一行未改）：`requestApproval` / `HIGH_RISK_ACTIONS` |
| `src/mcp/index.ts` | **Consumer**：启动期 `mode → provider → bootstrap → port → connect`；`tools/call` 在权限门之后走 `port.callTool` |
| `tests/runtime/port.test.ts` | 契约 ＋ 两 Provider 同套断言（7 条） |
| `tests/runtime/impl/real.test.ts` | real Provider 配对测试（3 条） |
| `tests/runtime/impl/stub.test.ts` | stub Provider 配对测试（3 条） |
| `tests/mcp/server-smoke.test.ts` | 全链路：S4（真宿主正判据）／S8（假宿主全链路）／S9（自举失败负例） |

### 实现节

**Provider 解析（`resolveRuntimeProvider`）**：`undefined ⇒ 'real'`；`'real'` / `'stub'` **精确匹配**（区分大小写、不 trim）；其余值（含 `''`、`' smoke'`、`'REAL'`）⇒ `RuntimePortError`。刻意不归一化 —— 归一化会把拼写错误变成"看起来成功"的静默降级。

**MCP 装配顺序**（`src/mcp/index.ts`）：

```
resolveMcpMode(mode) → resolveRuntimeProvider(provider，失败 ⇒ exit 1) → ensureSentinelRegistryLoaded() → createPort → server.connect
```

`tools/call` 的顺序是：`assertToolAllowed(name, mode)`（权限门，位置不变）→ `sentinel_list` 自举失败守卫（卡1，**先于 port**）→ `port.callTool(name, args)`。

**错误码表**：

| code | 场景 | 行为 |
|---|---|---|
| `RUNTIME_PROVIDER_INVALID` | `SYNOVA_RUNTIME_PROVIDER` 非法 | 启动期 stderr ＋ log.error ＋ exit 1（不降级） |
| `RUNTIME_TOOL_UNSUPPORTED` | stub 收到未支持工具 | 结构化 `ok:false` 文本（协议层不崩） |
| `SENTINEL_BOOTSTRAP_FAILED` | 自举失败后的 `sentinel_list` 响应 | 结构化 `ok:false`（进程不退出） |
| `SENTINEL_BOOTSTRAP_NOT_RUN` | 忘了调自举（fail-closed 默认值） | 反例②指纹（看 `total` 必红） |

**失败条件（何时可撤本设计）**：出现第二个**真实**宿主（bundle／桌面运行时选择）时，`SYNOVA_RUNTIME_PROVIDER` env 应改为构造注入／运行时注册表选择并删除此 env；stub Provider 不撤（M9 需要「假宿主跑领域」的装置）。

## Known Limitations

1. **stub 不是全功能替身**：只支持 `sentinel_list`；其余 11 个工具返回 `RUNTIME_TOOL_UNSUPPORTED`。双 Provider 同套断言**只覆盖 `sentinel_list`** —— 不得宣称"12 个工具都双 Provider 验证过"。
2. **不覆盖运行时版本代际 / 插件装载 / 沙箱**：本包只是 Host Capability 的接线面；不借任何第三方运行时机制（DSH 的 Cordis 生命周期明确不借）。
3. **审批语义没有新增**：端口只做委托；`HIGH_RISK_ACTIONS` 清单与 fail-closed 判定的唯一真源仍是 `src/runtime/approval-seam.ts`（改审批语义＝另一张卡的裁决）。
4. **自举仍依赖 cwd**：`extensions/sentinels` 由既有 loader 的 `process.cwd()` 解析 ⇒ MCP 必须在仓库根启动（既有约束，本批未改）。
5. **常驻进程内不重扫**：自举只在 MCP 启动时调用一次；运行期新增/删除哨兵仍需重启（U2/N1 未解）⇒ 不宣称"运行期可卸"。
6. **stub 的 `ask` 由构造参数注入**：MCP 全链路测试里 stub **没有**注入 `ask`（＝无人应答 ⇒ 拒），所以 S8 不覆盖"假宿主 + 人类批准"路径；该路径由 `tests/runtime/impl/stub.test.ts` 单测覆盖。
