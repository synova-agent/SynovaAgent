---
状态: implemented
日期: 2026-11-21
决策: 旧 Synova Provider 链（createOpenAICompatibleProvider）在 fetch 之前过 guardEgress 硬禁止拦截：敏感键/高敏键、四类值形态 ⇒ 抛 EgressGuardError（零请求）；EgressGuardError 在 chat 与 stream 两条错误路径原样透传（保留原始 EGRESS_* code，不落入 ClassifiedLlmError(INTERNAL)）；两处 fetch 保持 redirect:'error'，真实 3xx 不跟随。端点相等校验按 CTO 裁定 R3 从本刀移除（不做假安全），端点白名单/企业授权配置另票。
理由: 创始人《Synova 首客户模型外发与数据边界 v1》（2026-11-19）要求硬禁止（Secrets／银行卡/身份证等高敏字段）落到真实调用链；#1441 DEV DOC v3（评论 13694）定向终稿要求 token 配额等业务字段不得误伤、订单号不误伤、日志不记值；PR #1444 评论 13928（CTO 裁定 R2/R3）要求透传必须被真实入口测试证明，并移除 EGRESS_ENDPOINT 与自比自测试、改用真实 3xx 证据。
---

# I-3 第一刀：旧 Provider 链发送前硬禁止拦截（#1441）

- **状态**: implemented（2026-11-21，Issue #1441；PR #1444 评审中，不 merge）
- **依据**: Gitea #1441 评论 13694（DEV DOC v3）＋ 评论 13695（Mandate `synova-1441-egress-guard-v1`）＋ 创始人裁定《受控模型外发与数据边界 v1》＋ PR #1444 评论 13928（CTO 裁定 R2/R3）。
- **基线**: PR head `3cae3c02396f59aa704f4a809a32f90d66904236`（分支 `feat/1441-egress-guard`）；R2/R3 在该分支追加提交（不 force）。
- **现状（改前）**: `src/providers/base.ts` 的 `makeRequest()` 直接 `fetch(baseUrl+chatPath)`，请求体不扫描；非 2xx 的 `checkResponse()` 把响应体前 300 字拼进错误消息；fetch 未设 `redirect`（Node 默认 `follow`，3xx 会把请求带到新端点）。Ernie 为独立请求链（`getAccessToken()`/自有 fetch），本刀明确不覆盖（另票）。
- **决定**:
  1. 新增 `src/providers/egress-guard.ts`：`guardEgress({body})` 纯函数、只读递归扫描；无条件拒键 → `EGRESS_SECRET`（`card_number`/`bank_card`/`id_number`/`idCard` → `EGRESS_HIGH_SENSITIVE`）；歧义键 `token` 值为字符串拒、数字/布尔/null 放行；值形态仅四种（`sk-…`、`AKIA…`、PEM 私钥头、整串锚定的 18 位身份证）；日志只记 `code`＋字段路径。**不含端点判定**。
  2. `base.ts`：`makeRequest()` 在 fetch 前调用 guard（命中抛 `EgressGuardError`，零请求）；两处 fetch 均 `redirect:'error'`；`checkResponse()` 错误消息只留状态码；`finalizeAdapterFailure()` 对 `EgressGuardError` 原样透传；`stream` 的 catch 对 `EgressGuardError` 跳过 adapter `onError`（否则 deepseek 适配器会先把它包成 `ClassifiedLlmError(INTERNAL)`，原始 `EGRESS_*` code 丢失）。
  3. **R3（不做假安全）**: 移除 `EGRESS_ENDPOINT` 契约与实现分支——`const allowedBaseUrl = baseUrl` 是拿自己跟自己比、永远成立、无独立授权来源；端点白名单／企业授权配置待企业级配置来源、权限与持久化边界确定后另票。保留 `redirect:'error'`，新增真实 302/307 双端点测试证明不跟随。
  4. 不做：Ernie 链、DSH Sidecar 链、企业禁外发标记、跨企业/任务相关性、外发审计（均另票）。
- **证据**（本机 worktree，合成数据／fetch spy；同一 head）:
  - `npx vitest run tests/security/egress-guard.test.ts tests/security/egress-guard.real-path.test.ts` ⇒ 2 files / **54 tests passed**（30 单元 + 24 真实入口）。
  - `npx tsc --noEmit` ⇒ exit 0。
  - **R2 四条**：chat 抛 `EgressGuardError`（原始 `EGRESS_SECRET` / `EGRESS_HIGH_SENSITIVE`）；stream 的 `onError` 收到同一类型与 code；两者均不是 `ClassifiedLlmError(INTERNAL)`；上述两条路径 fetch 均 **0 次**。
  - **R3**：真实 302/307 指向第二端点 ⇒ A 端点恰 1 次请求、B 端点 0 次（断言两端命中路径）；测试与实现均无 `EGRESS_ENDPOINT`、无端点相等校验。
  - 正例保留：合法业务内容 fetch 恰 1 次；`{"token":128000}` 放行；19 位订单号不误伤。
  - **改坏必红**：① 删 chat fetch 的 `redirect:'error'` ⇒ 3xx 用例红（`expected [ '/captured' ] to deeply equal []`，第二端点被请求）；② 删 `finalizeAdapterFailure` 的 `EgressGuardError` 透传 ⇒ R2 5 条红（`ClassifiedLlmError: deepseek chat: …`）；③ stream 不跳过 adapter `onError`（修复前原始 head）⇒ stream 3 条红（`ClassifiedLlmError: DeepSeek stream: …`）。
- **回滚**: 单 PR revert 即可；无迁移、无持久化格式、无门禁改动。`guardEgress` 仅被 `base.ts` 调用；行为变化仅限新增拦截、`redirect:'error'` 与非 2xx 错误文案。
- **边界**: 未改 `src/providers/ernie.ts`、`message-sanitizer.ts`、`src/runtime/dsh/**`、`src/routes/**`、`llm-credential-store.ts`、`electron-renderer/**`、`scripts/dsh-sidecar/**`、`src/l4/**`、`src/sentinel/**` 与任何门禁/迁移。
