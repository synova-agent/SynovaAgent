> 🔴 **施工在 Gitea（内网 `http://MacBook-Pro-2.local:3000`）；本仓为镜像与对外展示。**
> 本仓**只接收单向 fast-forward 镜像**，不接受 PR／提交；要改代码请到 Gitea 开卡。（裁 231）

# SynovaAgent

**Powered by NemoClaw, Brain by Synova** — 组织诊断智能体。

独立进程，配置 LLM 即用。通过结构化访谈了解你的组织，运行六阶段诊断分析，构建 SOG-Core v1.0 本体图，持续监控组织健康。

双轨部署：国际 NemoClaw 生态集成（MCP 工具 + 机密计算 + GPU 加速） / 国内自主可控（DomesticHub + 国产 TEE）。

## 快速开始

### Docker
```bash
docker run -p 3000:3000 -e LLM_API_KEY=sk-your-key synova-agent
```

### 一键安装 (macOS/Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/nousresearch/synova-agent/main/scripts/install.sh | bash
```

### 一键安装 (Windows)
```powershell
iwr -useb https://raw.githubusercontent.com/nousresearch/synova-agent/main/scripts/install.ps1 | iex
```

### 开发模式
```bash
git clone https://github.com/nousresearch/synova-agent
cd synova-agent
npm install
DEV_MODE=true LLM_API_KEY=sk-your-key npx tsx src/index.ts
```

## 配置

### 必选（二选一）

| 环境变量 | 说明 |
|---------|------|
| `LLM_API_KEY` | LLM API Key（通用，所有兼容 OpenAI API 的服务） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（与 LLM_API_KEY 等效） |

### 国产大模型接入

SynovaAgent 通过 OpenAI 兼容协议支持所有国产大模型。修改 `LLM_BASE_URL` 和 `LLM_MODEL`。

> 模型名称对照 Hermes 开源项目的实际配置，已验证 API 兼容性。

| 厂商 | LLM_BASE_URL | LLM_MODEL | Key 环境变量 |
|------|-------------|-----------|-------------|
| **DeepSeek**（默认） | `https://api.deepseek.com/v1` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| **通义千问**（阿里云百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `DASHSCOPE_API_KEY` |
| **智谱 GLM** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` | `GLM_API_KEY` |
| **月之暗面 Kimi** | `https://api.moonshot.cn/v1` | `kimi-k2-turbo-preview` | `KIMI_API_KEY` |
| **MiniMax** | `https://api.minimax.chat/v1` | `abab6.5s-chat` | `MINIMAX_API_KEY` |
| **阶跃星辰 StepFun** | `https://api.stepfun.com/v1` | `step-3.5-flash` | `STEPFUN_API_KEY` |
| **零一万物** | `https://api.lingyiwanwu.com/v1` | `yi-large` | — |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o` | — |

> 注：百度文心 ERNIE 使用非标准 API 协议，暂不支持。MiniMax 国际版使用 Anthropic Messages API，国内版使用 OpenAI 兼容协议。

启动示例：
```bash
# DeepSeek（默认）
$env:LLM_API_KEY="sk-your-key"; npx tsx src/index.ts

# 通义千问
$env:LLM_API_KEY="sk-your-key"; $env:LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"; $env:LLM_MODEL="qwen-plus"; npx tsx src/index.ts

# Kimi
$env:LLM_API_KEY="sk-your-key"; $env:LLM_BASE_URL="https://api.moonshot.cn/v1"; $env:LLM_MODEL="kimi-k2-turbo-preview"; npx tsx src/index.ts
```

### 可选

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `LLM_BASE_URL` | LLM API 地址 | `https://api.deepseek.com/v1` |
| `LLM_MODEL` | 模型名称 | `deepseek-chat` |
| `PORT` | HTTP 端口 | `3000` |
| `SYNOVA_DB_PATH` | 数据库路径 | `./data/synova.db` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `DEV_MODE` | 开发模式（跳过 LLM Key 校验） | `false` |

## 接口

### HTTP API
```
GET  /health                         → 健康检查
GET  /api/status                     → LLM 配置状态
POST /api/ontology/ingest            → 文档摄取
GET  /api/ontology/graph/:orgId      → 图查询
GET  /api/ontology/graph/:orgId.html → HTML 可视化
POST /api/diagnosis/consult          → SSE 流式诊断
POST /api/conversations              → 对话 SSE 端点（多轮对话，D590）
GET  /api/sessions                   → 会话列表
```

## 安全模型（D590/D593，单机本地信任声明）

本进程的部署形态是**单 GA 本地桌面/内网单机**：信任边界是机器本身，不是 HTTP 凭证。
以下端点族免 JWT 直达（`src/middleware/auth.ts` 白名单，对齐 /api/sentinel/* 先例），
这是"配置完 LLM 即可对话"（D575 承诺）的承重设计：

- `POST /api/conversations`、`POST /api/conversations/:id/messages` — 对话 SSE
- `POST /api/diagnosis/consult*` — SSE 六阶段诊断
- `GET /api/diagnosis/reports` — 诊断报告列表（D593，桌面刷新恢复）
- `GET|POST /api/sessions*` — 会话读回/管理
- `GET /api/notifications*` — 通知（D593）
- `GET|POST /api/solutions*` — 方案（D593）
- `GET|POST /api/ga/clients`、`POST /api/ga/switch/:orgId` — GA 客户与切换（D593）
- `GET /api/ontology/graph/:orgId`、`POST /api/ontology/ingest`、`GET|POST /api/knowledge/ask` — MCP HTTP 桥（D595，见下）
- 其余既有免认证面（/health、/api/auth/login、邀请直达等）不变

其余全部端点仍走 JWT 认证（DEV_MODE=false + 无 Authorization → 401）。
**多用户 / 公网部署前必须按施工图 §5.5 重构为会话级鉴权**（能力广告诚实化：
当前版本不承诺多租户隔离，勿暴露到公网）。

## MCP 接入（D595，stdio 本机信任声明）

SynovaAgent 通过 **stdio MCP server** 把哨兵/诊断/本体/知识/会话能力暴露给企业已有
AI agent（codex、workbuddy 等）。启动：

```bash
npm run mcp        # 等价 npx tsx src/mcp/index.ts
```

**信任模型（显式声明）**：stdio transport 无网络监听面，信任边界 = 能启动本进程的
本地用户——与 HTTP 侧"单机本地信任"裁决（D590）同源，替代隐式无认证。启动时 stderr
输出一行声明，initialize 响应的 instructions 字段含机器可检索的契约版本串
`SYNOVA-MCP-CONTRACT: 1`。**不适用远程/多用户场景**（远程部署需 HTTP transport +
认证语义，属施工图 §5.5 重构范围）。

**权限分级（SYNOVA_MCP_MODE）**：

| 模式 | 行为 |
|------|------|
| `full`（缺省） | 12 个工具全部广告，读写均可调用 |
| `read-only` | 只广告 8 个 read 工具（诚实能力广告）；写工具调用返回 `-32000 PERMISSION_DENIED` |
| 非法值 | **fail-closed 降为 read-only**（stderr 有 warn，不静默回 full） |

写工具（4 个）：`sentinel_run`、`sentinel_run_all`（触发哨兵+工单闭环）、
`diagnose_organization`（触发 LLM 花费）、`ingest_document`（写本体）。

**客户端接入配置（mcpServers 片段，复制后改 cwd 为本仓库检出路径即可用）**：

```json
{
  "mcpServers": {
    "synova-agent": {
      "command": "npx",
      "args": ["tsx", "src/mcp/index.ts"],
      "cwd": "/path/to/SynovaAgent",
      "env": { "SYNOVA_MCP_MODE": "read-only" }
    }
  }
}
```

**12 工具清单**：

| 工具 | 权限 | 说明 |
|------|:---:|------|
| sentinel_list | read | 哨兵清单（ID/名称/层/优先级/模式） |
| sentinel_summary | read | 哨兵发现严重度汇总（原名 flywheel_speeds，D595 诚实化） |
| sentinel_reports | read | 哨兵专家报告 |
| sentinel_tickets | read | 哨兵工单（GS-05 闭环产物） |
| data_source_status | read | 数据源连接状态 |
| query_ontology | read | 本体图查询（HTTP 桥） |
| get_session | read | 历史诊断会话（HTTP 桥） |
| knowledge_ask | read | 知识问答（HTTP 桥） |
| sentinel_run | write | 运行指定哨兵（单哨兵语义 + 工单闭环） |
| sentinel_run_all | write | 运行全量哨兵 |
| diagnose_organization | write | 六阶段组织诊断（LLM 花费） |
| ingest_document | write | 文档录入本体（HTTP 桥） |

### CLI 对话
```bash
npx tsx src/cli.ts
```

### Web 界面
```
http://localhost:3000
```

## 项目结构

```
synova-agent/
├── src/
│   ├── index.ts            ← 入口
│   ├── cli.ts              ← 终端对话
│   ├── setup.ts            ← LLM 配置向导
│   ├── config.ts           ← 配置读取
│   ├── server.ts           ← HTTP 服务
│   ├── agent/              ← Agent 对话运行时
│   │   ├── conversation.ts ← 对话状态机
│   │   ├── tools.ts        ← 工具注册引擎
│   │   └── builtin-tools.ts← 内置工具
│   ├── providers/          ← LLM Provider 适配层
│   ├── store/              ← 持久化层
│   │   └── session-store.ts← SQLite 会话存储
│   ├── init/               ← 初始化
│   └── routes/             ← HTTP 路由
├── tests/                  ← 测试 (53 tests)
├── scripts/                ← 安装脚本
├── Dockerfile
└── docker-compose.yml
```

## 测试

```bash
npm test                    # vitest run (53 tests)
```

## 许可

MIT
