---
状态: implemented
日期: 2026-10-31
任务: "#1209"
决策: 把「子进程 env 构造」收口到单一纯函数 `buildSubprocessEnv({parent, declared})`，三处 spawn/exec 全部改用它；敏感名用**单一后缀规则**，`declared` 显式放行优先。
理由: 三处子进程全量继承 `process.env`（`src/providers/python-bridge.ts:24`／`src/mcp/bridge.ts:110`／`src/routes/cockpit.ts:52`），其中 MCP 那处起的是 `vendor/mcp-servers/` **第三方代码**，可直接读到 `JWT_SECRET`／`CREDENTIAL_MASTER_KEY`。交接件只写 1 处，实测 3 处 —— 只修一处留两个洞。
---

## 现象
- 147 个 spawn/exec 生产调用点里，**3 处**用 `...process.env` 全量继承。
- 最危险的是 `src/mcp/bridge.ts:110`：spawn 的是 `vendor/mcp-servers/`（第三方），却拿到全量父进程环境。
- 交接件 S0 清单只点名 `mcp/bridge.ts`，**漏 2 处**。

## 根因
1. "传给子进程什么"散落在每个调用点各写一遍 ⇒ 没人负责统一口径。
2. 敏感名清单如果靠"具名列举"，会漏（实测：`_TOKEN$` 漏 `ENGINE_TOKENS`、`_PASSWORD$` 漏 `EMAIL_PASS`）。

## 处置
1. 新建 `src/security/subprocess-env.ts`：`buildSubprocessEnv({parent, declared})` —— 剥敏感名 → 合并 `declared`（显式放行优先）→ 返回新对象（不改入参）。
2. 敏感名**单一条后缀规则**：`/(_KEY|_TOKENS?|_SECRET|_PASS|_PASSWD|_PASSWORD|_CREDENTIALS?|_WEBHOOK_URL)$/i`（`_TOKENS?` 覆盖 `ENGINE_TOKENS`、`_PASS` 覆盖 `EMAIL_PASS`、`_WEBHOOK_URL` 覆盖 `FEISHU_WEBHOOK_URL`）。
3. 三处接线：`src/providers/python-bridge.ts:26`／`src/mcp/bridge.ts:128`／`src/routes/cockpit.ts:53`。
4. `MCPBridge` 新增**可选**构造注入 `serverConfigs`（**不是** `servers` —— 与运行中进程表同名会 tsc 红），只为让「假 server 真 spawn」这条判据可写；不传时逐字等价。

## 防线
- 判据：`tests/security/subprocess-env.test.ts` **16 例**（纯函数六格边界 ＋ 真 spawn 走 `MCPBridge`）。
- **U-5 必须真走 bridge**：若测试绕开 bridge 直接 spawn，则 U-6-1（把 `mcp/bridge.ts` env 改回全量继承 ⇒ U-5 必红）失去判别力 ⇒ 判据作废。
- 改坏必红（K3 独立复现）：env 改回全量继承 ⇒ U-5 红；禁用后缀规则 ⇒ 6 红。
- 回归：`npx vitest run tests/security/ tests/mcp/`（**不列 `tests/providers/`——该目录不存在，列它等于判据空转**，K3 观察项①）。

## 已知限制
1. **名单法不是白名单**：无敏感后缀的机密名（如 `MYCRED`）拦不住；能力白名单列 T1-10。
2. **伪阳性**：`JIRA_PROJECT_KEY` 一类 `*_KEY` 非机密配置会被误删（可用 `declared` 救回）。
3. `config.env` 的 `declared` 内容不受审：MCP server 自己声明的键一律放行。
4. 只覆盖"传下去什么"，不审"父进程里本来有什么"。
