/**
 * tests/mcp/server-smoke.test.ts — D595 MCP server stdio 全链路冒烟（S1–S9）
 *
 * 铁律 12: 不 mock 协议管线——spawn 真实 `tsx src/mcp/index.ts` 子进程，
 *          经真实 stdio JSON-RPC 帧收发（initialize → tools/list → tools/call）。
 * 铁律 33: 命名为 *.test.ts（spec §5.1 明示文件名；语义为集成冒烟，随 vitest 全量跑）。
 *
 * 平台兼容（bridge.ts:23-28 同款关注点）: 不经 shell、不依赖 npx/.cmd——
 * 直接 spawn `node <node_modules/tsx/dist/cli.mjs> src/mcp/index.ts`（tsx 官方 CLI 入口），
 * process.execPath 在 win32/mac/linux 均为绝对路径，天然跨平台。
 *
 * 契约:
 *   @input  — src/mcp/index.ts（真实 server 进程）；env SYNOVA_MCP_MODE
 *             （＋ S9 的 SENTINELS_FIXTURE_DIR；＋ S8 的 SYNOVA_RUNTIME_PROVIDER=stub）
 *   @output — S1 信任声明/契约广告、S2 read-only 诚实过滤、S3 写工具 -32000 拒绝、
 *             S4 全链路正判据（sentinel_list 经启动期自举取全部哨兵：ok:true ∧ total===E）、
 *             S5 full 模式 12 工具全广告、S6 边界（未知工具/非法 JSON/缺参 → SDK 标准错误码，
 *             进程不崩 + stdout 纯度）、S7 非法模式 fail-closed（stderr warn + 行为=read-only）、
 *             S8 假宿主全链路（SYNOVA_RUNTIME_PROVIDER=stub ⇒ 领域断言仍绿 ∧ 未支持工具 typed）、
 *             S9 全链路负例（fixture 目录不可用 ⇒ 自举失败 ⇒ sentinel_list 结构化 ok:false）
 *   @degraded — S8 断言假宿主的结构化降级（RUNTIME_TOOL_UNSUPPORTED 而非崩溃）；
 *               S9 主动制造自举降级并断言（进程不退出，诚实报错）
 *   @error  — 子进程 10s 内未响应 → 测试失败（含 stderr 尾部便于排查）
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SERVER_ENTRY = path.join(REPO_ROOT, 'src', 'mcp', 'index.ts');
const SENTINELS_ROOT = path.join(REPO_ROOT, 'extensions', 'sentinels');
const ADAPTERS_DIR = path.join(REPO_ROOT, 'src', 'sentinel', 'adapters');

/**
 * E 独立派生（SPEC §9.3）：目录哨兵 = extensions/sentinels 下有效目录数（跳过 shared／`_` 前缀），
 * 内置 = src/sentinel/adapters 下 *-sentinel.{ts,js} 文件数 ⇒ E = 46 ＋ 4（as_of，不写死）。
 */
const E_DIR = readdirSync(SENTINELS_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'shared' && !d.name.startsWith('_')).length;
const E_BUILTIN = readdirSync(ADAPTERS_DIR).filter((f) => /-sentinel\.(ts|js)$/.test(f)).length;
const E = E_DIR + E_BUILTIN;

/** 单条 JSON-RPC 响应/请求（测试视角最小形状） */
interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  method?: string;
  params?: Record<string, unknown>;
}

const WRITE_TOOLS = ['sentinel_run', 'sentinel_run_all', 'diagnose_organization', 'ingest_document'];
const READ_ONLY_TOOL_COUNT = 8;
const FULL_TOOL_COUNT = 12;

/** 真实 stdio MCP 子进程客户端（不 mock 协议——逐行收发 JSON-RPC） */
class McpSmokeClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, (msg: JsonRpcMessage) => void>();
  private buffer = '';
  readonly stderrChunks: string[] = [];
  /** stdout 全量行（保真留证 + 纯度断言） */
  readonly stdoutLines: string[] = [];

  constructor(env: Record<string, string>) {
    this.proc = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        this.stdoutLines.push(line);
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (typeof msg.id === 'number') {
            const resolve = this.pending.get(msg.id);
            if (resolve) {
              this.pending.delete(msg.id);
              resolve(msg);
            }
          }
        } catch {
          // 非 JSON 行：留存在 stdoutLines 中供纯度断言，不在此抛（S6 负责断言）
        }
      }
    });
    this.proc.stderr.on('data', (chunk: string) => this.stderrChunks.push(chunk));
  }

  /** 发任意消息（通知或请求） */
  send(msg: Omit<JsonRpcMessage, 'jsonrpc'> & { id?: number }): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  }

  /** 发请求并等待同 id 响应 */
  request(method: string, params: Record<string, unknown>, timeoutMs = 10_000): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const p = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求 ${method} (id=${id}) ${timeoutMs}ms 未响应。stderr 尾部: ${this.stderrTail()}`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
    this.send({ id, method, params });
    return p;
  }

  /** 发裸行（非法 JSON 用） */
  sendRaw(line: string): void {
    this.proc.stdin.write(line + '\n');
  }

  stderrTail(max = 400): string {
    return this.stderrChunks.join('').slice(-max);
  }

  async initialize(): Promise<JsonRpcMessage> {
    const resp = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'd595-smoke', version: '0.0.0' },
    });
    // 协议纪律：initialize 后发 initialized 通知（SDK 消费）
    this.send({ method: 'notifications/initialized', params: {} });
    return resp;
  }

  async listTools(): Promise<Array<{ name: string; [k: string]: unknown }>> {
    const resp = await this.request('tools/list', {});
    expect(resp.error).toBeUndefined();
    const tools = (resp.result?.tools ?? []) as Array<{ name: string }>;
    return tools;
  }

  kill(): void {
    this.proc.kill();
  }
}

const clients: McpSmokeClient[] = [];
function startClient(env: Record<string, string>): McpSmokeClient {
  const c = new McpSmokeClient(env);
  clients.push(c);
  return c;
}

afterAll(() => {
  for (const c of clients) c.kill();
});

// ═══ 场景组 1: read-only 模式（S1-S4 共用一进程）═══

describe('S1-S4: SYNOVA_MCP_MODE=read-only（stdio 全链路）', () => {
  const client = startClient({ SYNOVA_MCP_MODE: 'read-only' });

  it('S1: initialize → serverInfo.name=synova-agent + instructions 含 SYNOVA-MCP-CONTRACT: 1（DS2/DS6）', async () => {
    const resp = await client.initialize();
    expect(resp.error).toBeUndefined();
    const serverInfo = (resp.result?.serverInfo ?? {}) as { name?: string; version?: string };
    expect(serverInfo.name).toBe('synova-agent');
    expect(typeof serverInfo.version).toBe('string');
    expect((serverInfo.version ?? '').length).toBeGreaterThan(0);
    const instructions = String(resp.result?.instructions ?? '');
    expect(instructions).toContain('SYNOVA-MCP-CONTRACT: 1');
    expect(instructions).toContain('stdio 本机信任');
  });

  it('S2: tools/list → 全部为 read 工具（8 个，零 write 工具广告——诚实能力广告）', async () => {
    const tools = await client.listTools();
    expect(tools).toHaveLength(READ_ONLY_TOOL_COUNT);
    const names = tools.map(t => t.name);
    for (const w of WRITE_TOOLS) expect(names).not.toContain(w);
    // 每个广告工具都带 inputSchema（客户端可调用性契约）
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('S3: tools/call sentinel_run（write）→ JSON-RPC error -32000（DS1 权限拒绝指纹）', async () => {
    const resp = await client.request('tools/call', { name: 'sentinel_run', arguments: { sentinelId: 'F1' } });
    expect(resp.error).toBeDefined();
    expect(resp.error?.code).toBe(-32000);
    expect(resp.error?.message).toContain('PERMISSION_DENIED');
    expect(resp.error?.message).toContain('sentinel_run');
  });

  it('S4 全链路正判据：sentinel_list ⇒ ok===true ∧ total===E ∧ sentinels.length===E（启动期自举，真数据）', async () => {
    const resp = await client.request('tools/call', { name: 'sentinel_list', arguments: {} });
    expect(resp.error).toBeUndefined();
    const content = (resp.result?.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text ?? '{}') as {
      ok: boolean;
      total: number;
      sentinels?: Array<{ id: string }>;
    };
    // 业务真判据（E 由测试侧独立 FS 派生；不是 total>=0 的恒真断言）
    // 诊断消息带应答原文 ＋ stderr 尾部：撤自举时必红，且红态点名 ok/total 与 fail-closed 指纹
    // （stderr 含 `[mcp] degraded: sentinel-bootstrap SENTINEL_BOOTSTRAP_NOT_RUN`）
    expect(parsed.ok, `sentinel_list 应答=${content[0].text} ｜ stderr 尾部=${client.stderrTail(800)}`).toBe(true);
    expect(parsed.total, `total=${parsed.total} 应为独立的 E=${E}`).toBe(E);
    expect(parsed.sentinels).toHaveLength(E);
  });
});

// ═══ 场景组 2: full 模式（S5 + S6 边界共用一进程）═══

describe('S5-S6: SYNOVA_MCP_MODE=full（12 工具 + 边界）', () => {
  const client = startClient({ SYNOVA_MCP_MODE: 'full' });

  it('S5: tools/list → 12 工具全广告（含 4 个 write 工具）', async () => {
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toHaveLength(FULL_TOOL_COUNT);
    const names = tools.map(t => t.name);
    for (const w of WRITE_TOOLS) expect(names).toContain(w);
    // permission 元数据随 tools/list 下发（客户端可据此预判权限）
    for (const t of tools) {
      expect(['read', 'write']).toContain(t.permission);
    }
  });

  it('S6a: 未知工具 → SDK 标准错误码 -32601（MethodNotFound）', async () => {
    const resp = await client.request('tools/call', { name: 'no_such_tool', arguments: {} });
    expect(resp.error).toBeDefined();
    expect(resp.error?.code).toBe(-32601);
  });

  it('S6b: 缺参调用（无 name）→ JSON-RPC 标准错误码（-32602/-32603 区间），进程不崩', async () => {
    const resp = await client.request('tools/call', {});
    expect(resp.error).toBeDefined();
    expect([-32600, -32602, -32603]).toContain(resp.error?.code);
  });

  it('S6c: 非法 JSON 行 → 不产生响应、不崩进程；后续合法请求照常应答；stdout 纯度保持', async () => {
    const linesBefore = client.stdoutLines.length;
    client.sendRaw('this is not json {{{');
    // 给协议层留出处理窗口
    await new Promise(r => setTimeout(r, 300));
    // 进程仍存活并应答合法请求
    const resp = await client.request('tools/list', {});
    expect(resp.error).toBeUndefined();
    // stdout 纯度：全部行均为合法 JSON（协议面无污染——日志必须走 stderr）
    for (const line of client.stdoutLines.slice(linesBefore)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // stderr 有日志（协议层错误可见，铁律 24 不静默）
    expect(client.stderrChunks.join('').length).toBeGreaterThan(0);
  });
});

// ═══ 场景组 3: 非法模式 fail-closed（S7，独立进程）═══

describe('S7: SYNOVA_MCP_MODE=bogus（DS11 fail-closed）', () => {
  const client = startClient({ SYNOVA_MCP_MODE: 'bogus' });

  it('启动 stderr 含 fail-closed warn；行为=read-only（tools/list 无 write 工具）', async () => {
    const resp = await client.initialize();
    expect(resp.error).toBeUndefined();
    const tools = await client.listTools();
    const names = tools.map(t => t.name);
    for (const w of WRITE_TOOLS) expect(names).not.toContain(w);
    expect(tools).toHaveLength(READ_ONLY_TOOL_COUNT);
    // stderr 有 fail-closed 警告（resolveMcpMode log.warn 经 pino → fd2）
    expect(client.stderrChunks.join('')).toContain('fail-closed');
  });
});

// ═══ 场景组 4: 全链路负例（S9，独立进程；自举失败 ⇒ 诚实报错）═══

describe('S9: 全链路负例（自举失败，D751 fixture 缝）', () => {
  // 不存在的 fixture 目录（既有注入缝 SENTINELS_FIXTURE_DIR ⇒ loader 自报「目录不存在」）
  const missingFixture = path.join(os.tmpdir(), `synova-m5-missing-${randomUUID()}`);
  const client = startClient({
    SYNOVA_MCP_MODE: 'read-only',
    SENTINELS_FIXTURE_DIR: missingFixture,
  });

  it('S9 全链路负例：fixture 不可用 ⇒ sentinel_list ok:false ∧ error=SENTINEL_BOOTSTRAP_FAILED ∧ sentinels.length===0', async () => {
    await client.initialize();
    const resp = await client.request('tools/call', { name: 'sentinel_list', arguments: {} });
    expect(resp.error).toBeUndefined();
    const content = (resp.result?.content ?? []) as Array<{ type: string; text?: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text ?? '{}') as {
      ok: boolean;
      error?: string;
      sentinels?: unknown[];
      degraded?: boolean;
    };
    // 诚实报错：不把「自举失败」读成「0 哨兵成功」；**不断言 total**（SPEC §9.4）
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('SENTINEL_BOOTSTRAP_FAILED');
    expect(parsed.degraded).toBe(true);
    expect(Array.isArray(parsed.sentinels)).toBe(true);
    expect(parsed.sentinels ?? []).toHaveLength(0);
  });
});

// ═══ 场景组 5: 假宿主全链路（S8，独立进程；换宿主领域不改的实链路判据）═══

describe('S8: 假宿主全链路（SYNOVA_RUNTIME_PROVIDER=stub）', () => {
  // 必须 full：否则写工具（sentinel_run）被权限门先以 -32000 拦，测不到 stub 的未支持工具路径
  const client = startClient({ SYNOVA_MCP_MODE: 'full', SYNOVA_RUNTIME_PROVIDER: 'stub' });

  it('S8 假宿主全链路：tools/list=12 ∧ sentinel_list total===E（领域不改）∧ sentinel_run ⇒ RUNTIME_TOOL_UNSUPPORTED', async () => {
    const initResp = await client.initialize();
    expect(initResp.error).toBeUndefined();
    // 假宿主不改工具面口径：full 模式下仍是 12 个工具全广告
    const tools = await client.listTools();
    expect(tools).toHaveLength(FULL_TOOL_COUNT);

    // 承诺①「换宿主不改领域」：同一 sentinel_list 领域断言在假宿主下仍成立（真 stdio 子进程）
    const listResp = await client.request('tools/call', { name: 'sentinel_list', arguments: {} });
    expect(listResp.error).toBeUndefined();
    const listContent = (listResp.result?.content ?? []) as Array<{ type: string; text?: string }>;
    expect(listContent.length).toBeGreaterThan(0);
    const listed = JSON.parse(listContent[0].text ?? '{}') as {
      ok: boolean;
      total: number;
      sentinels?: unknown[];
    };
    expect(listed.ok, `假宿主 sentinel_list 应答=${listContent[0].text} ｜ stderr 尾部=${client.stderrTail(800)}`).toBe(true);
    expect(listed.total).toBe(E);
    expect(listed.sentinels).toHaveLength(E);

    // 承诺②「假宿主不造假」：未支持工具返回 typed 结构化错误（不是 JSON-RPC 崩溃，也不是空成功）
    const runResp = await client.request('tools/call', { name: 'sentinel_run', arguments: { sentinelId: 'F1' } });
    expect(runResp.error).toBeUndefined();
    const runContent = (runResp.result?.content ?? []) as Array<{ type: string; text?: string }>;
    const unsupported = JSON.parse(runContent[0].text ?? '{}') as {
      ok: boolean;
      error?: string;
      tool?: string;
      degraded?: boolean;
    };
    expect(unsupported.ok).toBe(false);
    expect(unsupported.error).toBe('RUNTIME_TOOL_UNSUPPORTED');
    expect(unsupported.tool).toBe('sentinel_run');
    expect(unsupported.degraded).toBe(true);
  });
});
