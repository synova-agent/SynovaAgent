/**
 * mcp/index.ts — SynovaAgent MCP Server (双轨策略 #2, D595 SDK 化)
 *
 * 以 stdio 协议暴露 12 个工具（哨兵/诊断/本体/知识/会话——清单与权限单源见 tool-definitions.ts）。
 *
 * D595 变更:
 *   - 协议由 @modelcontextprotocol/sdk 承担（notifications/initialized、protocolVersion 协商、
 *     JSON-RPC 错误映射），消除手写 readline 实现的协议漂移
 *   - 信任模型显式声明（stdio 本机信任——替代隐式无认证，对齐 D590 单机本地信任裁决；
 *     启动 stderr 一行 + initialize instructions 广告）
 *   - 权限分级: SYNOVA_MCP_MODE（full | read-only，非法值 fail-closed 降 read-only）+
 *     tools/list 诚实过滤 + tools/call 写工具 -32000 拒绝
 *   - serverInfo.version 读 package.json（消原 :321 硬编码双源）
 *
 * M5 卡1（#704）变更:
 *   - 启动期自举：mode → `ensureSentinelRegistryLoaded()` → `server.connect`
 *     ⇒ `sentinel_list` 从 `{ok:true,total:0}` 变为**全部哨兵**（46 目录 ＋ 4 内置）
 *   - fail-closed 默认值（未自举 ⇒ code='SENTINEL_BOOTSTRAP_NOT_RUN'，永不读成绿）
 *   - 自举失败 ⇒ 进程不退出（read-only 工具仍服务），`sentinel_list` 由守卫返回结构化 `ok:false`
 *
 * 用法: npm run mcp  （等价 npx tsx src/mcp/index.ts）
 * 接入: README「安全模型」节 mcpServers 配置片段
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '@synova/logger';
import {
  TOOLS,
  filterToolsByMode,
  resolveMcpMode,
  assertToolAllowed,
  handleToolCall,
  buildInstructions,
  buildServerInfo,
  MCP_CONTRACT,
} from './tool-definitions';
import { ensureSentinelRegistryLoaded, type SentinelBootstrapResult } from '../agent/sentinel-service';

const log = createLogger('src.mcp.index');

/**
 * fail-closed 自举默认值（M5 卡1 / #704）。
 *
 * 契约: 未调用 `ensureSentinelRegistryLoaded()` 时 bootstrap 恒为此值 ⇒ "忘了调自举"
 * **永远不会被读成绿**（`ok:false` ＋ `code='SENTINEL_BOOTSTRAP_NOT_RUN'` 即反例②指纹）。
 * 判别力：把 `ok: false` 改成 `ok: true` 后，未自举时 `sentinel_list` 仍必红于 `total===E`。
 */
const FAIL_CLOSED: SentinelBootstrapResult = {
  ok: false, code: 'SENTINEL_BOOTSTRAP_NOT_RUN',
  alreadyLoaded: false,
  total: 0,
  dirCount: 0,
  builtinCount: 0,
  errors: [],
  degraded: true,
};

async function main(): Promise<void> {
  const mode = resolveMcpMode(process.env.SYNOVA_MCP_MODE);

  // D595 信任模型显式声明（三件套之一，对标 dsh-acp :1143-1163 能力广告）
  process.stderr.write(
    `[mcp] 信任模型: stdio 本机信任（无网络监听）| 模式: ${mode} | 契约: ${MCP_CONTRACT}\n`,
  );

  // M5 卡1: 启动期自举（顺序 mode → bootstrap → connect）；自举失败不阻断进程
  let bootstrap: SentinelBootstrapResult = FAIL_CLOSED;
  bootstrap = await ensureSentinelRegistryLoaded();
  process.stderr.write(
    `[mcp] sentinel bootstrap ok=${bootstrap.ok} total=${bootstrap.total} dir=${bootstrap.dirCount} builtin=${bootstrap.builtinCount}\n`,
  );
  if (!bootstrap.ok) {
    // 铁律 24/31：降级显式可观测（read-only 工具仍服务；sentinel_list 诚实报错）
    process.stderr.write(
      `[mcp] degraded: sentinel-bootstrap ${bootstrap.code ?? 'SENTINEL_BOOTSTRAP_FAILED'} ${bootstrap.errors.join('; ')}\n`,
    );
  }

  const server = new Server(buildServerInfo(), {
    capabilities: { tools: {} },
    instructions: buildInstructions(),
  });

  // 协议层错误可见（铁律 24 不静默——非法 JSON 行等经此落 stderr，stdout 纯度保持）
  server.onerror = (err: Error) => {
    log.warn({ err: err.message }, 'MCP 协议层错误');
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: filterToolsByMode(TOOLS, mode),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name: string = request.params.name;
    const args: Record<string, unknown> = request.params.arguments ?? {};
    // 权限门: read-only 下写工具 → McpError -32000；未知工具 → -32601（SDK 标准映射）
    assertToolAllowed(name, mode);
    // M5 卡1: 自举失败时 sentinel_list 在进入领域层之前被守卫拦截 ——
    // 结构化 ok:false（不把"0 哨兵"当结果；real/stub 一致，卡2 亦复用本守卫）
    if (name === 'sentinel_list' && !bootstrap.ok) {
      const degradedList = {
        ok: false,
        total: 0,
        sentinels: [],
        error: 'SENTINEL_BOOTSTRAP_FAILED',
        degraded: true,
      };
      return { content: [{ type: 'text', text: JSON.stringify(degradedList) }] };
    }
    const text = await handleToolCall(name, args);
    return { content: [{ type: 'text', text }] };
  });

  await server.connect(new StdioServerTransport());
  log.info({ mode }, 'MCP server 已连接 stdio transport');
}

main().catch((err: unknown) => {
  log.error({ err: err instanceof Error ? err.message : String(err) }, 'MCP 主进程致命错误 — 退出');
  process.stderr.write(`MCP Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
