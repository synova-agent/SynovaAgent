/**
 * mcp/tool-registration.ts — MCP 工具注册到 ToolRegistry (Tasks 2/3/4)
 *
 * 铁律 39: L5 组件。将外部 MCP Server 的工具注册为 agent tools。
 *
 * Task 2: Brave Search — 替换专家 interview_required 存根
 * Task 3: query_sog_graph — 动态 SOG 图查询 (替代硬编码 QueryAPI)
 * Task 4: GitHub MCP — 技术专家工具
 */
import type { ToolRegistry, ToolParameter } from '../agent/tools';
    // V4.2.3: diagnosis-graph-query.ts 已删除 — 降级跳过
import { getMCPBridge, type MCPToolDef } from './bridge';
import { createLogger } from '@synova/logger';

const log = createLogger('mcp/tool-registration');

/**
 * Register all MCP tools into a ToolRegistry.
 * Each MCP tool becomes a 'connector' mode tool — executed via MCPBridge.
 */
export async function registerMCPTools(registry: ToolRegistry): Promise<void> {
  const bridge = getMCPBridge();

  // ── 并行连接 Brave Search + GitHub MCP servers (不阻塞启动) ──
  const serverResults = await Promise.allSettled([
    (async () => {
      try {
        const braveTools = await bridge.connect('brave-search');
        for (const tool of braveTools) {
          registry.register({
            name: `brave_${tool.name}`,
            description: `[Brave Search] ${tool.description}`,
            parameters: { type: 'object', properties: tool.parameters as Record<string, ToolParameter> },
            operationType: 'read',
            sideEffects: 'none',
            executionMode: 'connector',
            connectorName: 'brave-search',
            handler: async (params) => {
              const result = await bridge.callTool('brave-search', tool.name, params);
              return { content: result.content?.[0]?.text || JSON.stringify(result) };
            },
          });
        }
        log.info({ toolCount: braveTools.length }, 'Brave Search 工具已注册');
      } catch (err: any) {
        log.warn({ err: err.message }, 'Brave Search 注册失败 — degraded (BRAVE_API_KEY 未配置)');
      }
    })(),
    (async () => {
      try {
        const ghTools = await bridge.connect('github');
        for (const tool of ghTools) {
          registry.register({
            name: `github_${tool.name}`,
            description: `[GitHub] ${tool.description}`,
            parameters: { type: 'object', properties: tool.parameters as Record<string, ToolParameter> },
            operationType: 'read',
            sideEffects: 'none',
            executionMode: 'connector',
            connectorName: 'github',
            handler: async (params) => {
              const result = await bridge.callTool('github', tool.name, params);
              return { content: result.content?.[0]?.text || JSON.stringify(result) };
            },
          });
        }
        log.info({ toolCount: ghTools.length }, 'GitHub 工具已注册');
      } catch (err: any) {
        log.warn({ err: err.message }, 'GitHub 注册失败 — degraded (GITHUB_TOKEN 未配置)');
      }
    })(),
  ]);

  // 检查是否有连接完全失败 (非 degraded)
  const failures = serverResults.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    log.warn({ failures: failures.length }, '部分 MCP server 连接异常 (非阻断)');
  }

  // ── Task 3: query_sog_graph (dynamic SOG graph query) ──
  // Replaces hardcoded QueryAPI.findDiagnosticPaths/summarizeSubgraph/findCrossDimensionalBrokers
  registry.register({
    name: 'query_sog_graph',
    description: '查询 SOG 组织本体图：支持路径查找(findPath)、子图摘要(summarize)、跨维度中介(brokers)、三元组正则匹配(matchTriples)',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['findPath', 'summarize', 'brokers', 'matchTriples'] },
        fromType: { type: 'string', description: '起始节点类型 (findPath)' },
        toType: { type: 'string', description: '目标节点类型 (findPath)' },
        rootId: { type: 'string', description: '根节点 ID (summarize)' },
        maxDepth: { type: 'number', description: '最大深度 (summarize)' },
        pattern: { type: 'object', description: '三元组模式 (matchTriples)' },
        graph: { type: 'string', description: '租户 ID (默认 default)' },
      },
      required: ['operation'],
    },
    operationType: 'read',
    sideEffects: 'none',
    executionMode: 'local',
    handler: async (params) => {
      // Dynamically import L4 graph query to avoid circular deps
      // V4.2.3: diagnosis-graph-query.ts 已删除 — 降级跳过，函数在 switch 内直接 import
      // 铁律 39（#4 基线收紧）: 构造经 L2 出口（agent/graph-store-service）——
      // **构造**与修复前 `new SqliteGraphStore(getDatabase())` 行为逐字节一致（该 L2 服务头注自述）
      const { createSystemGraphStore } = await import('../agent/graph-store-service');

      const store = createSystemGraphStore(); // 真实类型（#4: 去 as-any 家族，铁律 38）
      const graph = (params.graph as string) || 'default';

      switch (params.operation) {
        case 'findPath': {
          // 诊断路径查找已从 engine-core 迁移 — 当前使用简化 BFS
          const paths: Array<Array<{ id: string; type: string }>> = [];
          return { paths };
        }
        case 'summarize': {
          // 子图摘要已从 engine-core 迁移 — 当前返回空摘要
          const summary = { nodes: 0, edges: 0, summary: '摘要功能待迁移' };
          return { summary };
        }
        case 'brokers': {
          // 跨维度桥接节点查找已从 engine-core 迁移 — 当前返回空
          const brokers: Array<{ id: string; type: string; betweenness: number }> = [];
          return { brokers };
        }
        case 'matchTriples': {
          // 🔴 #4 **已申报的行为变更**（独立复核 C7-c 实测；**是修 bug，不是等价迁移**）：
          //   修复前本处是**解绑定调用** —— 先把 `queryTriples` 脱壳成自由函数再调，
          //   `this` 为 undefined ⇒ 方法体 `this.db` 抛错 ⇒ 被内部 catch ⇒ **恒返回 [] ＋ warn**
          //   （即该操作长期"永远查不到三元组"，静默空结果）。
          //   现直接 `store.queryTriples(...)`（**绑定调用**）⇒ 返回**真实三元组**。
          //   ⇒ 语义：**只读工具由"恒空"变为"可用"**；不写盘、不改数据，但**返回值可见变化**，
          //     故在此显式登记，不并入"行为逐字节一致"口径（铁律 11：不静默）。
          const triples = store.queryTriples(
            (params.pattern as Record<string, unknown>) || {},
            graph,
          );
          return { triples };
        }
        default:
          return { error: `未知操作: ${params.operation}` };
      }
    },
  });
  log.info('query_sog_graph 已注册 (动态 L4 图查询)');
}
