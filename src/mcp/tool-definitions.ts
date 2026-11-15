/**
 * mcp/tool-definitions.ts — MCP 工具定义 + 权限模型 + 纯函数处理器 (D595)
 *
 * L1 交互层（mcp/ 面）。index.ts 只做装配/模式解析/错误映射；本文件是工具契约单源。
 *
 * 数据源纪律（铁律 39，对齐 routes/sentinel.ts L1→L2 样本）:
 *   - 哨兵族 5 工具 → L2 agent/sentinel-service（listSentinels/runSentinelOnce/getSentinelFindings/
 *     getSentinelExpertReports/getSentinelTickets）——禁止直触 sentinel/ registry、runner、
 *     init/engine-context、adapters/sqlite-graph-store（D595 修复原 11 处跨层违规 + sentinel_run 语义 bug）
 *   - diagnose_organization → 进程内 L2 ConversationEngine（存量 D601 存储簇违规随代码原样迁移，
 *     修复归 D601 簇任务，本任务不扩_scope）
 *   - query_ontology / ingest_document / get_session / knowledge_ask → L1 HTTP 桥惯例
 *     （localhost fetch；auth.ts 白名单 D595 三前缀保证生产态非 401）
 *
 * 契约（铁律 47）——工具权限分级 + 模式过滤:
 *   @input  — TOOLS: ToolDef[]（含 permission: 'read' | 'write' 元数据）
 *             mode: 'full' | 'read-only'（env SYNOVA_MCP_MODE，默认 'full'）
 *   @output — filterToolsByMode(tools, mode): read-only 只返回 read 工具（tools/list 诚实广告——
 *             不广告调用不了的写工具，对标 dsh-acp :1143-1163 探测后广告）
 *             assertToolAllowed(name, mode): read-only 下调写工具 → 抛 McpError code -32000
 *             （JSON-RPC Server error 区间，message 含 PERMISSION_DENIED + 工具名 + 当前模式）；
 *             未知工具 → McpError -32601（SDK 标准映射）
 *             handleToolCall(name, args): 返回 JSON 文本（SDK content[0].text 载荷）
 *   @degraded — resolveMcpMode(): env 值非法（非 full/read-only）→ log.warn + 返回 'read-only'
 *             （安全控制显式设置但非法 → fail-closed，不静默回 full）
 *             各处理器降级路径: L2 ok:false / HTTP 不可达 → 结构化 JSON（ok:false + error），
 *             零静默 catch（铁律 24/31——degraded 标记随链传播）
 *   @error  — McpError（-32000 PERMISSION_DENIED / -32601 未知工具，SDK 标准映射）
 */
import { readFileSync } from 'node:fs';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '@synova/logger';
import {
  listSentinels,
  runSentinelOnce,
  getSentinelFindings,
  getSentinelExpertReports,
  getSentinelTickets,
} from '../agent/sentinel-service';
import { createProvider } from '../providers';
import { detectProvider } from '../providers/detect';
import { ConversationEngine } from '../agent/conversation-engine';
import { handleDomainToolCall } from '../runtime/dsh/tools';
// D487: 装配类型（type-only，零运行时加载）
import type { SessionManager } from '../orchestrator/session-manager';
import type { SessionStoreLike } from '../agent/diagnosis-launcher';
import type { TicketStatus } from '../agent/sentinel-service';

const log = createLogger('mcp/tool-definitions');

// ═══ 契约版本化预备（Stage 2 契约冻结挂点）═══

/** MCP 工具契约版本串——initialize instructions 机器可 grep，变更即 breaking */
export const MCP_CONTRACT = 'SYNOVA-MCP-CONTRACT: 1';
/** server 名称（模块内常量——buildServerInfo 单一消费点，不导出） */
const MCP_SERVER_NAME = 'synova-agent';

// ═══ Types ═══

export type McpToolPermission = 'read' | 'write';
export type McpMode = 'full' | 'read-only';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  permission: McpToolPermission;
}

/** 参数提取：args 取 string（缺参/类型不符 → undefined，由处理器决定降级形状） */
function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 工单状态参数：非法值按缺省处理（对齐 routes/sentinel.ts ?status= 白名单惯例） */
function ticketStatusArg(args: Record<string, unknown>): TicketStatus | undefined {
  const v = args.status;
  if (typeof v !== 'string') return undefined;
  const VALID: readonly string[] = ['open', 'acknowledged', 'resolved', 'dismissed'];
  return VALID.includes(v) ? (v as TicketStatus) : undefined;
}

// ═══ 12 工具元数据（name/description/inputSchema/permission——tools/list 单源）═══

export const TOOLS: ToolDef[] = [
  {
    name: 'sentinel_list',
    description: '列出所有哨兵 (ID/名称/层/优先级/模式)',
    inputSchema: { type: 'object', properties: {}, required: [] },
    permission: 'read',
  },
  {
    name: 'sentinel_run',
    description: '运行指定哨兵（单哨兵语义；走 runner 管线：聚合→专家→工单闭环）',
    inputSchema: {
      type: 'object',
      properties: { sentinelId: { type: 'string', description: '哨兵 ID（兼容带/不带 sentinel- 前缀）' } },
      required: ['sentinelId'],
    },
    permission: 'write',
  },
  {
    name: 'sentinel_run_all',
    description: '运行全量哨兵并返回逐哨兵结果（GS-05 工单闭环）',
    inputSchema: { type: 'object', properties: {}, required: [] },
    permission: 'write',
  },
  {
    name: 'sentinel_summary',
    description: '哨兵发现严重度汇总（critical/warning/info 计数 + overall 均值分；无数据返回 overall=null 不捏造）',
    inputSchema: { type: 'object', properties: {}, required: [] },
    permission: 'read',
  },
  {
    name: 'data_source_status',
    description: '数据源连接状态 + 字段覆盖度',
    inputSchema: { type: 'object', properties: {}, required: [] },
    permission: 'read',
  },
  {
    name: 'diagnose_organization',
    description: '对指定组织运行六阶段诊断分析，返回结构化诊断报告（触发 LLM 花费）',
    inputSchema: {
      type: 'object',
      properties: {
        orgName: { type: 'string', description: '组织名称' },
        initiatorRole: { type: 'string', description: '发起人角色 (CEO/Manager/HR等)', default: '管理者' },
      },
      required: ['orgName'],
    },
    permission: 'write',
  },
  {
    name: 'query_ontology',
    description: '查询组织的本体图（节点数、边数、实体类型分布）',
    inputSchema: {
      type: 'object',
      properties: { orgId: { type: 'string', description: '组织 ID' } },
      required: ['orgId'],
    },
    permission: 'read',
  },
  {
    name: 'ingest_document',
    description: '将文档录入本体图（支持 PRD、会议纪要、报告等；写本体）',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: '组织 ID' },
        name: { type: 'string', description: '文档名称' },
        type: { type: 'string', description: '文档类型 (prd/meeting_notes/report/contract/other)' },
        content: { type: 'string', description: '文档内容' },
      },
      required: ['orgId', 'name', 'type', 'content'],
    },
    permission: 'write',
  },
  {
    name: 'get_session',
    description: '获取历史诊断会话',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: '会话 ID（不提供则列出所有会话）' } },
    },
    permission: 'read',
  },
  {
    name: 'sentinel_reports',
    description: '查询哨兵专家报告（最近运行的分析产出）',
    inputSchema: { type: 'object', properties: {}, required: [] },
    permission: 'read',
  },
  {
    name: 'sentinel_tickets',
    description: '查询哨兵工单（GS-05 告警闭环产物；可按 status 过滤；degraded 标记随链传播）',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', description: '工单状态过滤 (open/acknowledged/resolved/dismissed)' } },
    },
    permission: 'read',
  },
  {
    name: 'knowledge_ask',
    description: '知识问答（PKB 检索 + 模板兜底；经本机 HTTP API）',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', description: '问题（至少 2 个字符）' } },
      required: ['q'],
    },
    permission: 'read',
  },
];

// ═══ 1A Sidecar 只读工具面（#1395）═══
//
// 为什么单列而不是追加进 TOOLS：`tests/mcp/tool-definitions.test.ts` 把 stdio 侧
// 12 工具/8 read/4 write 钉成冻结断言（该测试不在 1A 写集内）。Sidecar 用同一
// `ToolDef` 形状、同一 permission 语义、同一 `McpError` 错误码，但只广告 1 个
// 合成只读领域工具（默认最小工具面）。
export const SIDECAR_TOOLS: ToolDef[] = [
  {
    name: 'synova_context_get',
    description: '读取一个问题对应的合成只读 ContextSnapshot（②结构/③观测/④依据，带 $id/版本/证据状态）',
    inputSchema: {
      type: 'object',
      properties: { problemId: { type: 'string', description: '问题 ID（合成基线：problem-revenue-health-2026q3）' } },
      required: ['problemId'],
    },
    permission: 'read',
  },
];

/**
 * Sidecar 工具权限门（与 stdio 侧同一错误码语义）。
 * @error 写工具 ⇒ McpError -32000；未登记 ⇒ McpError -32601
 */
export function assertSidecarToolAllowed(name: string, mode: McpMode = 'read-only'): void {
  if (SIDECAR_TOOLS.some(tool => tool.name === name)) return;
  const legacy = TOOLS.find(tool => tool.name === name);
  if (legacy !== undefined && legacy.permission === 'write' && mode === 'read-only') {
    throw new McpError(-32000, `PERMISSION_DENIED: 工具 ${name} 为写操作，Sidecar 只读模式禁止调用`);
  }
  if (legacy !== undefined) return;
  throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
}

/** Sidecar MCP initialize instructions（信任模型 + 只读声明）。 */
export function buildSidecarInstructions(): string {
  return [
    'Synova Sidecar MCP — 回环 HTTP、只读、一次性 token（服务端注入身份，入参不得携带身份字段）。',
    '工具面：仅 synova_context_get（合成基线，synthetic=true）；写工具不广告且调用被拒（-32000）。',
    `契约: ${MCP_CONTRACT}`,
  ].join('\n');
}

// ═══ 权限模型（spec §5.3）═══

/**
 * resolveMcpMode — 解析 SYNOVA_MCP_MODE。
 * 契约:
 *   @input  — raw: env 原始值（undefined/'' = 未设置）
 *   @output — 'full' | 'read-only'
 *   @degraded — 非法值 → log.warn + 'read-only'（fail-closed：安全控制设错不放权）
 */
export function resolveMcpMode(raw: string | undefined): McpMode {
  if (raw === undefined || raw === '') return 'full';
  if (raw === 'full') return 'full';
  if (raw === 'read-only') return 'read-only';
  log.warn({ value: raw }, 'SYNOVA_MCP_MODE 非法 → fail-closed 降为 read-only（合法值: full / read-only）');
  return 'read-only';
}

/**
 * filterToolsByMode — tools/list 模式过滤（诚实能力广告）。
 * 契约:
 *   @output — 'full' → 全部；'read-only' → 仅 read 工具（不广告调用不了的写工具）
 */
export function filterToolsByMode(tools: ToolDef[], mode: McpMode): ToolDef[] {
  return tools.filter(t => mode === 'full' || t.permission === 'read');
}

/**
 * assertToolAllowed — tools/call 权限门。
 * 契约:
 *   @error  — 未知工具 → McpError -32601；read-only 下写工具 → McpError -32000
 *             （message 含 PERMISSION_DENIED + 工具名 + 当前模式）
 */
export function assertToolAllowed(name: string, mode: McpMode): void {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
  }
  if (mode === 'read-only' && tool.permission === 'write') {
    throw new McpError(
      -32000,
      `PERMISSION_DENIED: 工具 ${name} 为写操作，当前模式 read-only 禁止调用（设置 SYNOVA_MCP_MODE=full 开启）`,
    );
  }
}

// ═══ initialize 构造块（T9——版本单源 package.json，消 :321 双源）═══

/**
 * buildInstructions — initialize 响应 instructions（信任模型 + 权限分级 + 契约版本声明）。
 * 契约:
 *   @output — 机器可 grep（SYNOVA-MCP-CONTRACT: 1）+ 人类可读的信任模型说明
 */
export function buildInstructions(): string {
  return [
    'SynovaAgent MCP server — 组织数字孪生诊断 + 持续增长导航。',
    '信任模型: stdio 本机信任（无网络监听面；能启动本进程的本地用户即受信操作者，与 HTTP 侧单机本地信任裁决同源）。',
    '权限分级: 工具分 read/write 两级；SYNOVA_MCP_MODE=read-only 时仅广告并放行 read 工具，write 工具调用被拒（JSON-RPC -32000 PERMISSION_DENIED）。',
    `契约: ${MCP_CONTRACT}（Stage 2 契约冻结挂点）`,
  ].join('\n');
}

/** 从仓库 package.json 读版本（唯一真相源）。 */
function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && 'version' in parsed) {
      const v = (parsed as { version?: unknown }).version;
      if (typeof v === 'string' && v.length > 0) return v;
    }
    log.warn('package.json version 字段缺失或非字符串 — 版本降级为 0.0.0-unknown');
    return '0.0.0-unknown';
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'package.json 读取失败 — 版本降级为 0.0.0-unknown');
    return '0.0.0-unknown';
  }
}

/**
 * buildServerInfo — initialize 响应 serverInfo（name/version 单源 package.json）。
 * 契约:
 *   @output — { name: 'synova-agent', version: <package.json version> }
 *   @degraded — package.json 不可读 → '0.0.0-unknown' + log.warn（不静默、不硬编码）
 */
export function buildServerInfo(): { name: string; version: string } {
  return { name: MCP_SERVER_NAME, version: readPackageVersion() };
}

// ═══ 工具处理器（纯模块——单元测试直接 import，协议循环在 index.ts）═══

/** 本机 HTTP 桥基址（与 query_ontology/get_session 既有惯例一致） */
function httpBase(): string {
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** HTTP 桥降级（铁律 24：log.warn + 结构化 JSON，不抛） */
async function bridgeFetch(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    return await res.text();
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err), url }, 'HTTP 桥请求失败 — API 不可达降级');
    return null;
  }
}

/**
 * handleToolCall — 工具处理器总派发（返回 JSON 文本，SDK content[0].text 载荷）。
 * 契约:
 *   @input  — name: 工具名（assertToolAllowed 已放行）；args: 工具参数
 *   @output — JSON 文本；错误以 { ok: false, error } 结构化返回，不抛（协议层错误映射在 SDK）
 *   @degraded — 每个分支独立降级（L2 ok:false 透传 / HTTP 不可达 / 参数缺失），零静默
 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ─── 哨兵族：全部经 L2 agent/sentinel-service（D595 跨层修复）───
    case 'sentinel_list': {
      const resp = await listSentinels();
      return JSON.stringify(resp);
    }
    case 'sentinel_run': {
      // D595 缺陷 A 修复：单哨兵语义——sentinelId 传给 L2 runSentinelOnce（原实现误当
      // teamId 传 runSentinelForTeam，实际跑全量且丢 D577 阈值注入的 teamId 上下文）
      const sentinelId = strArg(args, 'sentinelId');
      if (!sentinelId) {
        return JSON.stringify({ ok: false, sentinelId: '', error: '缺少 sentinelId 参数' });
      }
      const resp = await runSentinelOnce(sentinelId);
      return JSON.stringify({
        ok: resp.ok,
        sentinelId: resp.sentinelId,
        findings: resp.result?.findings?.length ?? 0,
        // 铁律 31: loader check wrapper 的 degraded（SentinelCheckResult.degraded）随链上浮（spec §5.4 degraded? 位）
        ...(resp.result?.degraded ? { degraded: true } : {}),
        ...(resp.error !== undefined ? { error: resp.error } : {}),
      });
    }
    case 'sentinel_run_all': {
      const list = await listSentinels();
      if (!list.ok) {
        return JSON.stringify({ ok: false, total: 0, ran: 0, failed: 0, results: [], error: '哨兵清单不可用 — 全量运行降级' });
      }
      const settled = await Promise.allSettled(list.sentinels.map(s => runSentinelOnce(s.id)));
      const results = settled.map((r, i) => {
        const sentinelId = list.sentinels[i].id;
        if (r.status === 'fulfilled') {
          return {
            sentinelId,
            ok: r.value.ok,
            findings: r.value.result?.findings?.length ?? 0,
            ...(r.value.error !== undefined ? { error: r.value.error } : {}),
          };
        }
        return { sentinelId, ok: false, findings: 0, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
      });
      const ran = results.filter(r => r.ok).length;
      return JSON.stringify({ ok: true, total: results.length, ran, failed: results.length - ran, results });
    }
    case 'sentinel_summary': {
      // D595 决策 4：flywheel_speeds 诚实化改名——原实现空数据捏造 valueCreation:50 等
      // 三飞轮字段（从未真算）；现输出真实严重度汇总，无数据 overall=null 不伪造评分
      const resp = getSentinelFindings({ limit: 200 });
      const sevScore: Record<string, number> = { emergency: 0, critical: 0, warning: 50, info: 100 };
      let critical = 0;
      let warning = 0;
      let info = 0;
      let sum = 0;
      for (const f of resp.findings) {
        if (f.finding.severity === 'critical' || f.finding.severity === 'emergency') critical += 1;
        else if (f.finding.severity === 'warning') warning += 1;
        else if (f.finding.severity === 'info') info += 1;
        sum += sevScore[f.finding.severity] ?? 50;
      }
      const total = resp.findings.length;
      const overall = total > 0 ? Math.round(sum / total) : null;
      return JSON.stringify({ ok: resp.ok, total, critical, warning, info, overall });
    }
    case 'sentinel_reports': {
      const resp = getSentinelExpertReports();
      return JSON.stringify(resp);
    }
    case 'sentinel_tickets': {
      // degraded 标记随链传播（铁律 31）：source=memory-fallback 时输出含 degraded:true
      const resp = getSentinelTickets(ticketStatusArg(args));
      return JSON.stringify(resp);
    }
    // ─── D601 存量簇（原样迁移，修复归 D601 簇任务）───
    case 'data_source_status': {
      try {
        const { getDatabase, initEngineContext } = await import('../init/engine-context');
        try { getDatabase(); } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, '数据库未初始化 — 执行懒初始化');
          initEngineContext();
        }
        const db = getDatabase();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
        // 本体层覆盖情况
        let nodeTypes: Array<{ id: string; label: string; fields: number }> = [];
        try {
          const { loadOntology } = await import('../l4/ontology-loader');
          const { ontology } = loadOntology();
          nodeTypes = ontology.nodeTypes.map(n => ({
            id: n.$id, label: n.label,
            fields: Object.keys(n.optionalProps || {}).length + (n.requiredProps || []).length,
          }));
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, 'ontology 不可用 — nodeTypes 降级为空');
        }
        return JSON.stringify({ ok: true, connected: true, tables: tables.slice(0, 30).map(t => t.name), nodeTypes, nodeCount: nodeTypes.length });
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, '数据源状态查询失败 — degraded');
        return JSON.stringify({ ok: false, error: String(err), connected: false });
      }
    }
    case 'diagnose_organization': {
      const orgName = strArg(args, 'orgName');
      if (!orgName) {
        return JSON.stringify({ ok: false, error: '缺少 orgName 参数' });
      }
      const provider = createProvider(detectProvider(), {
        apiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
        gatewayHost: process.env.OPENCLAW_GATEWAY_HOST,
      });
      // D487: 会话事件装配 — db 可用时传 sessionManager+sessionStore（诊断事件落
      // session_events）；无 db 环境（独立 MCP 进程未初始化引擎上下文）→ 内存态降级
      let sessionManager: SessionManager | undefined;
      let sessionStore: SessionStoreLike | undefined;
      let mcpSessionId: string | undefined;
      try {
        const { getDatabase, initEngineContext } = await import('../init/engine-context');
        try { getDatabase(); } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, '数据库未初始化 — 执行懒初始化');
          initEngineContext();
        }
        const { SessionStore } = await import('../store/session-store');
        const { SessionManager: SessionManagerImpl } = await import('../orchestrator/session-manager');
        const store = new SessionStore(getDatabase());
        // D487: 每次 MCP 诊断独立会话——事件流按会话可回放
        const sess = store.createSession(orgName);
        sessionStore = store;
        sessionManager = new SessionManagerImpl({}, store);
        mcpSessionId = sess.id;
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, '会话事件装配失败 — 无 db 环境，内存态降级');
      }
      const initiatorRole = strArg(args, 'initiatorRole') ?? '管理者';
      const conv = new ConversationEngine(provider, { orgId: orgName, maxTurns: 3, sessionId: mcpSessionId, sessionManager, sessionStore });
      const result = await conv.processMessage(
        `我的组织"${orgName}"需要诊断。角色: ${initiatorRole}`,
      );
      return JSON.stringify({
        orgName,
        phase: conv.getPhase(),
        reply: result.reply.slice(0, 2000),
        messageCount: conv.getMessages().length,
      });
    }
    // ─── 1A Sidecar：合成只读领域工具（身份由回环 token 注入，入参校验在 runtime/dsh/tools）───
    case 'synova_context_get': {
      return handleDomainToolCall(name, args);
    }
    // ─── L1 HTTP 桥（localhost fetch 惯例；白名单 D595 三前缀保证生产态可达）───
    case 'query_ontology': {
      const orgId = strArg(args, 'orgId');
      if (!orgId) {
        return JSON.stringify({ error: '缺少 orgId 参数' });
      }
      const text = await bridgeFetch(`${httpBase()}/api/ontology/graph/${orgId}`);
      if (text === null) {
        return JSON.stringify({ error: '本体 API 不可达——请确保 SynovaAgent 服务已启动' });
      }
      return text;
    }
    case 'ingest_document': {
      const text = await bridgeFetch(`${httpBase()}/api/ontology/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (text === null) {
        return JSON.stringify({ error: '本体 API 不可达' });
      }
      return text;
    }
    case 'get_session': {
      const sessionId = strArg(args, 'sessionId');
      const text = await bridgeFetch(sessionId ? `${httpBase()}/api/sessions/${sessionId}` : `${httpBase()}/api/sessions`);
      if (text === null) {
        return JSON.stringify({ error: '会话 API 不可达' });
      }
      return text;
    }
    case 'knowledge_ask': {
      // D595 审计缺口②：知识问答暴露（GET /api/knowledge/ask 契约透传）
      const q = strArg(args, 'q');
      if (!q || q.length < 2) {
        return JSON.stringify({ ok: false, error: '问题太短（至少 2 个字符）' });
      }
      const text = await bridgeFetch(`${httpBase()}/api/knowledge/ask?q=${encodeURIComponent(q)}`);
      if (text === null) {
        return JSON.stringify({ ok: false, error: '知识问答 API 不可达——请确保 SynovaAgent 服务已启动' });
      }
      return text;
    }
    default: {
      // assertToolAllowed 已拦截未知工具——此分支为防御性兜底（不静默）
      log.warn({ tool: name }, 'handleToolCall 收到未知工具名 — 防御性兜底');
      return JSON.stringify({ ok: false, error: `未知工具: ${name}` });
    }
  }
}
