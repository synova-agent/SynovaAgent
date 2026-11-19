---
状态: implemented
日期: 2026-11-20
决策: 旧 Synova Provider 链（createOpenAICompatibleProvider）在 fetch 之前过 guardEgress 硬禁止拦截：敏感键/高敏键、四类值形态、端点不一致 ⇒ 抛 EgressGuardError（零请求）；同时 redirect:'error'、非 2xx 错误消息不回显响应体。
理由: 创始人《Synova 首客户模型外发与数据边界 v1》（2026-11-19）要求硬禁止（Secrets／银行卡/身份证等高敏字段）落到真实调用链；#1441 DEV DOC v3（评论 13694）定向终稿要求 token 配额等业务字段不得误伤、订单号不误伤、日志不记值。
---

# I-3 第一刀：旧 Provider 链发送前硬禁止拦截（#1441）

- **状态**: implemented（2026-11-20，Issue #1441；PR 待评审，不 merge）
- **依据**: Gitea #1441 评论 13694（DEV DOC v3）＋ 评论 13695（Mandate `synova-1441-egress-guard-v1`）＋ 创始人裁定《受控模型外发与数据边界 v1》。
- **基线**: `851b8900a83944b7544c59fa437020621d297f95`（分支 `feat/1441-egress-guard`，仓库外 worktree）。
- **现状（改前）**: `src/providers/base.ts` 的 `makeRequest()` 直接 `fetch(baseUrl+chatPath)`，请求体不扫描；非 2xx 的 `checkResponse()` 把响应体前 300 字拼进错误消息；fetch 未设 `redirect`（Node 默认 `follow`，3xx 会把请求带到新端点）。Ernie 为独立请求链（`getAccessToken()`/自有 fetch），本刀明确不覆盖（另票）。
- **决定**:
  1. 新增 `src/providers/egress-guard.ts`：`guardEgress({body, baseUrl, allowedBaseUrl})` 纯函数、只读递归扫描；无条件拒键 → `EGRESS_SECRET`（`card_number`/`bank_card`/`id_number`/`idCard` → `EGRESS_HIGH_SENSITIVE`）；歧义键 `token` 值为字符串拒、数字/布尔/null 放行；值形态仅四种（`sk-…`、`AKIA…`、PEM 私钥头、整串锚定的 18 位身份证）；端点不一致 → `EGRESS_ENDPOINT`；日志只记 `code`＋字段路径。
  2. `base.ts`：`makeRequest()` 在 fetch 前调用 guard（命中抛 `EgressGuardError`，零请求）；`healthCheck()` 同样过端点守卫；两处 fetch 均 `redirect:'error'`；`checkResponse()` 错误消息只留状态码；`finalizeAdapterFailure()` 对 `EgressGuardError` 原样透传（安全边界码可见，不被 INTERNAL 重试语义吞掉）。
  3. 不做：Ernie 链、DSH Sidecar 链、企业禁外发标记、跨企业/任务相关性、授权配置持久化、外发审计（均另票）。
- **证据**（本机 worktree，合成数据／fetch spy）:
  - `npx vitest run tests/security/egress-guard.test.ts tests/security/egress-guard.real-path.test.ts` ⇒ 2 files / 50 tests passed（31 单元 + 19 真实入口）。
  - `npx tsc --noEmit` ⇒ exit 0。
  - 改坏必红 6 条已逐条执行并恢复：①guard 挪到 fetch 后 ⇒ 11 failed（fetch 0→1）；②删键名判定 ⇒ 23 failed（password/apiKey 等放行）；③token 一律拒 ⇒ 5 failed（token:128000/0/true 误拦）；④16–19 位数字当卡号 ⇒ 2 failed（19 位 orderId 误伤）；⑤拦截日志写值 ⇒ 2 failed（log.warn 含 body）；⑥错误回显响应体 ⇒ 1 failed（message 含 `sk-…`）。
- **回滚**: 单 PR revert 即可；无迁移、无持久化格式、无门禁改动。`guardEgress` 未被其它调用方使用，`base.ts` 行为变化仅限新增拦截、`redirect:'error'` 与非 2xx 错误文案。
- **边界**: 未改 `src/providers/ernie.ts`、`message-sanitizer.ts`、`src/runtime/dsh/**`、`src/routes/**`、`llm-credential-store.ts`、`electron-renderer/**`、`scripts/dsh-sidecar/**`、`src/l4/**`、`src/sentinel/**` 与任何门禁/迁移。
