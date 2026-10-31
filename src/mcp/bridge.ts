/**
 * mcp/bridge.ts — MCP 桥接层 (Task 1)
 *
 * 铁律 39: L5 组件。通过子进程 JSON-RPC 调用 MCP Server。
 * ToolRegistry 通过此桥接层将 MCP 工具暴露为 agent tools。
 *
 * 架构:
 *   ToolRegistry → MCPBridge → child_process (stdio) → MCP Server (vendor/mcp-servers/)
 *
 * 支持的 MCP Server:
 *   - Brave Search: 网页搜索
 *   - GitHub: 仓库/PR/Issue 访问
 *   - Filesystem: 文件操作 (受限 sandbox)
 *   - Memory: 知识图谱持久化
 */
import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '@synova/logger';
import { createInterface } from 'readline';
import { buildSubprocessEnv } from '../security/subprocess-env';

const log = createLogger('mcp/bridge');

/** Windows 需要 .cmd 后缀才能 spawn npm/npx */
function resolveCommand(cmd: string): string {
  if (process.platform === 'win32' && (cmd === 'npx' || cmd === 'npm')) {
    return cmd + '.cmd';
  }
  return cmd;
}

// ═══ Types ═══

export interface MCPToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MCPCallResult {
  content?: Array<{ type: string; text?: string }>;
  error?: string;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ═══ MCP Server Configs ═══

interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const MCP_SERVERS: Record<string, MCPServerConfig> = {
  'brave-search': {
    name: 'brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY || '' },
  },
  github: {
    name: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '' },
  },
  filesystem: {
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/synova-sandbox'],
  },
  memory: {
    name: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
};

// ═══ MCPBridge ═══

export class MCPBridge {
  private servers = new Map<string, { process: ChildProcess; tools: MCPToolDef[]; idSeq: number }>();
  private pendingRequests = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  /**
   * 可选的 server 配置表覆盖（#1209 U-5 的唯一动机：让判据能挂一个**假 server** 真跑 spawn，
   * 否则只能 grep 源码，属假判据）。
   *
   * 语义＝**替换不是合并**：传了就**只用**它（此时 `connect('<未声明的 server>')` 抛
   * `未知 MCP Server`，与不传时行为不同）；不传 ⇒ 逐字等价于 `MCP_SERVERS`（默认路径零变化）。
   *
   * 🔴 形参不得叫 `servers`：上面的 `private servers` 是**运行中进程表**，同名会让 tsc 直接红。
   */
  private serverConfigs?: Record<string, MCPServerConfig>;

  constructor(serverConfigs?: Record<string, MCPServerConfig>) {
    this.serverConfigs = serverConfigs;
  }

  /** Launch an MCP server and discover its tools */
  async connect(serverName: string): Promise<MCPToolDef[]> {
    if (this.servers.has(serverName)) {
      return this.servers.get(serverName)!.tools;
    }

    const config = (this.serverConfigs ?? MCP_SERVERS)[serverName];
    if (!config) throw new Error(`未知 MCP Server: ${serverName}`);

    log.info({ server: serverName }, '启动 MCP Server');

    const proc = spawn(resolveCommand(config.command), config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // #1209：不再把父进程 env 与 config.env 全量合并 —— 第三方 MCP server 不得继承
      // JWT_SECRET / CREDENTIAL_MASTER_KEY 等机密；`config.env`（server 自己声明的键）显式放行。
      // 见 src/security/subprocess-env.ts（declared 优先 ⇒ BRAVE_API_KEY 等仍可用）。
      env: buildSubprocessEnv({ parent: process.env, declared: config.env }),
      cwd: 'vendor/mcp-servers',
      shell: process.platform === 'win32', // Windows 需要 shell 来解析 .cmd
    });

    proc.on('error', (err) => {
      log.warn({ server: serverName, err: err.message }, 'MCP Server 启动失败（非阻断）');
      this.servers.delete(serverName);
    });

    const rl = createInterface({ input: proc.stdout! });
    let idSeq = 0;

    const entry = { process: proc, tools: [] as MCPToolDef[], idSeq: 0 };
    this.servers.set(serverName, entry);

    // Read JSON-RPC responses line by line
    rl.on('line', (line: string) => {
      try {
        const response: JSONRPCResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
          this.pendingRequests.delete(response.id);
        }
      } catch { log.debug('MCP bridge: 跳过非 JSON 行'); }
    });

    proc.stderr?.on('data', (d: Buffer) => {
      log.debug({ server: serverName, stderr: d.toString().slice(0, 200) }, 'MCP stderr');
    });

    proc.on('exit', (code) => {
      log.warn({ server: serverName, code }, 'MCP Server 退出');
      this.servers.delete(serverName);
    });

    // Step 1: Initialize
    await this.sendRequest(serverName, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'synova-agent', version: '0.1.0' },
    });

    // Step 2: Discover tools
    const result = await this.sendRequest(serverName, 'tools/list', {}) as { tools?: MCPToolDef[] };
    entry.tools = result?.tools || [];

    log.info({ server: serverName, toolCount: entry.tools.length }, 'MCP Server 就绪');
    return entry.tools;
  }

  /** Call an MCP tool */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`MCP Server ${serverName} 未连接`);

    const result = await this.sendRequest(serverName, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    return result as MCPCallResult;
  }

  /** Send a JSON-RPC request and wait for response */
  private sendRequest(serverName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const entry = this.servers.get(serverName);
    if (!entry) throw new Error(`MCP Server ${serverName} 未连接`);

    const id = ++entry.idSeq;
    const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      entry.process.stdin!.write(JSON.stringify(request) + '\n');

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP 调用超时: ${serverName}.${method}`));
        }
      }, 30_000);
    });
  }

  /** Get all tools from a connected server */
  getTools(serverName: string): MCPToolDef[] {
    return this.servers.get(serverName)?.tools || [];
  }

  /** List all connected servers */
  listServers(): string[] {
    return [...this.servers.keys()];
  }

  /** Shutdown all MCP servers */
  async shutdown(): Promise<void> {
    for (const [name, entry] of this.servers) {
      entry.process.kill();
      log.info({ server: name }, 'MCP Server 已关闭');
    }
    this.servers.clear();
  }
}

// ═══ Singleton ═══

let _bridge: MCPBridge | null = null;
export function getMCPBridge(inject?: MCPBridge): MCPBridge {
  if (inject) { _bridge = inject; return inject; }
  if (!_bridge) _bridge = new MCPBridge();
  return _bridge;
}
