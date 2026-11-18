/**
 * src/mcp/http.ts — 1A 的**回环 HTTP MCP**（只读、一次性 token、服务端身份注入）。
 *
 * 与既有 `src/mcp/index.ts`（stdio，12 工具）的关系：
 *   · 同一份 `tool-definitions.ts` 类型/权限语义（`ToolDef`／`filterToolsByMode`／`McpError` 码）；
 *   · 但 Sidecar 只暴露 **1 个合成只读领域工具**（默认最小工具面），4 个写工具永远不在列表里，
 *     调用写工具 ⇒ `-32000 PERMISSION_DENIED`；未登记工具 ⇒ `-32601`。
 *
 * 传输：MCP Streamable HTTP（stateless，JSON response），只监听 `127.0.0.1`。
 * 安全：
 *   · 每个请求必须带 `Authorization: Bearer <一次性 token>`；
 *   · token 由路由按 run 签发（绑定 enterpriseId/userId/scope/runId），run 终态即撤销；
 *   · 身份只来自 token，工具入参出现身份/路径字段 ⇒ 拒绝（FORGED_IDENTITY / FORGED_PATH）。
 *
 * 契约（铁律 47）:
 *   @input   HTTP（POST /mcp，JSON-RPC）＋ Bearer token
 *   @output  MCP JSON-RPC 响应；工具结果 `content[0].text` 为结构化 JSON
 *   @degraded 无：无 token ⇒ 401；非法 JSON ⇒ 400；内部错误 ⇒ JSON-RPC error（不空成功）
 *   @error   UNAUTHORIZED / VALIDATION_ERROR / TOOL_ERROR（映射为 MCP error 或结构化 content）
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { isDshError } from '../runtime/dsh/errors';
import { handleDomainToolCall, ToolTokenStore, type ToolCallContext } from '../runtime/dsh/tools';
import {
  SIDECAR_TOOLS,
  assertSidecarToolAllowed,
  buildSidecarInstructions,
  buildServerInfo,
  filterToolsByMode,
  type McpMode,
} from './tool-definitions';

/** 请求体上限（1MB：MCP 工具参数不该更大）。 */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Sidecar 强制模式：**唯一**的只读声明点（改坏必红判据）。
 * 改成 'full' ⇒ 写工具不再被 -32000 拒绝、`readonly-tool.test.ts` 必红。
 */
const SIDECAR_MODE: McpMode = 'read-only';

/** 对外暴露的只读 MCP 服务句柄。 */
export interface ReadonlyMcpServer {
  /** 仅回环地址（`http://127.0.0.1:<port>/mcp`）。 */
  url: string;
  /** 一次性 token 存储（路由按 run 签发/撤销）。 */
  tokens: ToolTokenStore;
  /** 关闭监听（不影响 Domain 计算）。 */
  close(): Promise<void>;
}

/** 从 header 取 bearer token。 */
function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9]+)$/.exec(header.trim());
  return match === null ? null : match[1];
}

/** 读取并解析 JSON 请求体。 */
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new DshHttpError(413, 'VALIDATION_ERROR', '请求体超过 1MB'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) { resolveBody(undefined); return; }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err: unknown) {
        rejectBody(new DshHttpError(400, 'VALIDATION_ERROR', `请求体不是合法 JSON: ${String(err)}`));
      }
    });
    request.on('error', rejectBody);
  });
}

/** HTTP 层错误（在 JSON-RPC 之前失败）。 */
class DshHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 把工具错误映射成 MCP 错误码（写工具/越权 = -32000；参数错 = -32602；其余 -32000）。 */
function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) return err;
  if (isDshError(err)) {
    if (err.code === 'VALIDATION_ERROR') {
      return new McpError(ErrorCode.InvalidParams, `${err.code}: ${err.message}`);
    }
    return new McpError(-32000, `${err.code}: ${err.message}`);
  }
  return new McpError(ErrorCode.InternalError, `TOOL_ERROR: ${err instanceof Error ? err.message : String(err)}`);
}

/** 构造一个请求级 MCP Server（stateless：每请求一个实例，工具上下文闭包绑定 token 身份）。 */
function buildRequestServer(context: ToolCallContext): McpServer {
  const server = new McpServer(buildServerInfo(), {
    capabilities: { tools: {} },
    instructions: buildSidecarInstructions(),
  });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    // 强制 read-only：Sidecar 只广告 1 个只读领域工具；写工具不出现在列表里。
    tools: filterToolsByMode(SIDECAR_TOOLS, SIDECAR_MODE),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // 权限门：写工具 -32000 / 未登记 -32601（与 stdio 侧同一错误语义）
    assertSidecarToolAllowed(name, SIDECAR_MODE);
    try {
      // 身份只来自本请求的 token→ctx（闭包绑定，不经过工具入参）；缺 ctx ⇒ runtime 层 UNAUTHORIZED
      const text = handleDomainToolCall(name, args, context);
      return { content: [{ type: 'text', text }] };
    } catch (err: unknown) {
      // DOMAIN_EMPTY 是「显式空」而不是协议错误：以结构化 content 返回，调用方能看到 code。
      if (isDshError(err) && err.code === 'DOMAIN_EMPTY') {
        return { content: [{ type: 'text', text: JSON.stringify(err.toPayload()) }], isError: true };
      }
      throw toMcpError(err);
    }
  });
  return server;
}

/** 单个 HTTP 请求：验 token → JSON-RPC 处理 → 释放 server。 */
async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  tokens: ToolTokenStore,
): Promise<void> {
  if (request.url !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: `unknown path: ${request.url ?? ''}` }));
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    response.end(JSON.stringify({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'MCP 回环口只接受 POST' }));
    return;
  }
  const token = bearerToken(request);
  const context = token === null ? null : tokens.resolve(token);
  if (token === null || context === null) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', phase: 'tool', retryable: false, message: '无效或已撤销的回环 MCP token' }));
    return;
  }

  const body = await readJsonBody(request);
  const server = buildRequestServer(context);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } finally {
    response.on('close', () => { void server.close().catch(() => { /* 连接已结束：关闭失败不影响已写出的响应 */ }); });
  }
}

/**
 * 启动回环只读 MCP 服务（随机端口，只监听 127.0.0.1）。
 * @output {url, tokens, close}
 * @error 端口监听失败原样抛（不静默降级到 stdio 或关掉鉴权）
 */
export async function startReadonlyMcpServer(): Promise<ReadonlyMcpServer> {
  const tokens = new ToolTokenStore();
  const httpServer: Server = createServer((request, response) => {
    void handleMcpRequest(request, response, tokens).catch((err: unknown) => {
      if (response.headersSent) { response.end(); return; }
      if (err instanceof DshHttpError) {
        response.writeHead(err.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, code: err.code, phase: 'tool', retryable: false, message: err.message }));
        return;
      }
      const error = toMcpError(err);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, code: 'TOOL_ERROR', phase: 'tool', retryable: false, message: error.message }));
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = httpServer.address();
  if (address === null || typeof address !== 'object') {
    httpServer.close();
    throw new McpError(ErrorCode.InternalError, '回环 MCP 端口分配失败');
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    tokens,
    close: () => new Promise<void>(resolveClose => httpServer.close(() => resolveClose())),
  };
}
