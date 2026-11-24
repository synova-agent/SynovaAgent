# #1459 T5 证据包（一次真实模型轮次，DevMode）

来源：仓外一次性目录 `_r3chain-20261123\t5-20261124-1405`（已整体复制，37 件）。
本目录 = **证据记录**，不是代码。原始 `hash-manifest.txt` 保留，用于逐件核对。

## 这证明什么

单次真实模型轮次下，**扫描②结构 → DSH 取上下文 → 服务端结构化瓶颈假设 → 桌面可见**这条链可达：

- `05-sse-events.txt`：10 帧，顺序 `run.started → session.created → egress.recorded → reasoning.delta → tool.started → tool.finished → reasoning.delta → text.delta → hypothesis.structured → run.completed`
- `07-dsh-session-log.jsonl`：24 行，`assistant/message` ×2，`usage` 6 处 ⇒ 确实打到模型（非桩）
- `08-desktop-dom.json` / `08-desktop.png`：`runStatus=done`，runId/sessionId 与 SSE 同值，卡片四要素齐
- `10-evidence-summary.json`：三件证据汇总
- `11-secret-scan.txt`：精确 key 0 命中；`11-residue-scan.txt`：18790/5173/9222 均未监听
- `CREDENTIAL-CLEANUP.txt`：一次性凭据与 key 文件已删（只记路径与时间，不含值）

## 三条限定（读证据前必须先看）

1. **桌面是 DevMode**（`auth: "devmode"`，无真实 JWT/企业身份）⇒ 证明的是 DevMode 下可达，**不等于**带真实登录的桌面验收。
2. **prompt 是受控脚本化的**（`08-drive-result.json` 中要求单次工具调用 + 只输出契约 JSON）⇒ 证明契约可满足、链路可通，**不证明自由提问下的假设质量**。
3. 工具层面两处偏差已如实登记：驱动脚本收尾触发一次 `UV_HANDLE_CLOSING`（exit 1，工具收尾异常非轮次失败）；`start.ps1` 包装不退出，改用分离启动 + 轮询状态文件。**未重跑模型**。

## 本目录做了哪些入库前处理（可复核）

- **脱敏**：`08-drive-result.json` 与 `09-desktop-console.txt` 各 1 处 `token=<redacted-local-dev-token>`（原值是回环 Vite HMR 令牌，非凭据）。
- **未脱敏**：其余文件原样；`sk-` 形态在整目录 **0 命中**（入库前扫描）。
- 因脱敏，上述两文件的 sha256 与 `hash-manifest.txt` 中记录**不再相同**——这是有意为之，不是证据被篡改。

## 禁止外推

T5 PASS ≠ 企业诊断价值已证明 ≠ 带真实客户数据/真实登录的验收 ≠ DSH 整体复用或锁版完成（锁版与 R4 运维验收属 #1434）。
