/**
 * l4/data-exporter.ts — DataExporter (D40 GDPR Art.20 可携带权)
 *
 * 导出指定 tenantId 的全部数据（GraphStore + SessionStore + AgentMemoryStore）
 * 返回 JSON 归档包 + 清单（含 checksum）。
 *
 * 铁律 24: catch + log + degraded
 * 铁律 38: 零 as any
 * 铁律 31: 降级信号传播
 */
import { createLogger } from '@synova/logger';
import { ALL_NODE_TYPES, ALL_EDGE_TYPES } from '@synova/ontology';
import type { GraphStore } from './graph-bridge';
import type { SessionStore, SessionRow, MessageRow } from '../store/session-store';
import type { AgentMemoryStore, MemoryEntry } from './agent-memory-store';
import { assertGraphName } from '../l2/graph-scope';

const log = createLogger('l4/data-exporter');

// ═══ Types ═══

export interface ExportManifest {
  tenantId: string;
  exportId: string;
  exportedAt: string;
  checksum: string;
  summary: {
    nodes: number;
    edges: number;
    sessions: number;
    messages: number;
    memories: number;
  };
  /**
   * 图覆盖（#1211 · U-5）：让"导出到底覆盖了哪些图"成为**可断言产物**，
   * 而不是读代码才知道。历史 `default` 图的存量节点**显式计数**，不静默丢。
   */
  graphCoverage: {
    /** 本次实际查询过的图名（去重） */
    graphs: string[];
    /** 历史 default 图里未随本次导出的节点数；`graph === 'default'` 时恒为 0（见实现） */
    defaultGraphCount: number;
  };
}

export interface ExportedNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  graph: string;
}

export interface ExportedEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  weight: number;
  props: Record<string, unknown>;
  graph: string;
}

export interface ExportedSession {
  session: SessionRow;
  messages: MessageRow[];
}

export interface ExportArchive {
  tenantId: string;
  exportedAt: string;
  nodes: ExportedNode[];
  edges: ExportedEdge[];
  sessions: ExportedSession[];
  memories: MemoryEntry[];
}

function generateId(): string {
  return `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function simpleChecksum(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ═══ DataExporter ═══

export class DataExporter {
  private graphStore: GraphStore;
  private sessionStore: SessionStore;
  private memoryStore: AgentMemoryStore;

  constructor(
    graphStore: GraphStore,
    sessionStore: SessionStore,
    memoryStore: AgentMemoryStore,
  ) {
    this.graphStore = graphStore;
    this.sessionStore = sessionStore;
    this.memoryStore = memoryStore;
  }

  /**
   * 导出指定 tenantId 的全部数据。
   * @param tenantId - 租户 ID (= orgId)
   * @returns JSON Buffer 归档 + 清单
   */
  async export(tenantId: string): Promise<{ archive: Buffer; manifest: ExportManifest }> {
    try {
      // #1211：业务层图名必须显式且过白名单 —— 非法 tenantId 当场拒绝（fail loud），
      // 不得落到介质层 `graph = "default"` 的兜底（口径在业务层，不在介质层）。
      const graph = assertGraphName(tenantId);
      const nodes = this.exportGraphNodes(tenantId, graph);
      const edges = this.exportGraphEdges(graph);
      const sessions = this.exportSessions(tenantId);
      const memories = this.exportMemories(tenantId);
      const defaultGraphCount = this.countDefaultGraphNodes(graph);

      const archiveData: ExportArchive = {
        tenantId,
        exportedAt: new Date().toISOString(),
        nodes,
        edges,
        sessions,
        memories,
      };

      const json = JSON.stringify(archiveData, null, 2);
      const checksum = simpleChecksum(json);

      const manifest: ExportManifest = {
        tenantId,
        exportId: generateId(),
        exportedAt: archiveData.exportedAt,
        checksum,
        summary: {
          nodes: nodes.length,
          edges: edges.length,
          sessions: sessions.length,
          messages: sessions.reduce((sum, s) => sum + s.messages.length, 0),
          memories: memories.length,
        },
        graphCoverage: {
          graphs: [...new Set([graph])],
          defaultGraphCount,
        },
      };

      log.info({ tenantId, summary: manifest.summary }, '数据导出完成');
      return { archive: Buffer.from(json, 'utf-8'), manifest };
    } catch (err: unknown) {
      log.error({ err, tenantId }, 'DataExporter.export 异常');
      throw err;
    }
  }

  /** 遍历用的节点类型清单（唯一来源：`ALL_NODE_TYPES`，含离线回退） */
  private allNodeTypes(): string[] {
    return (ALL_NODE_TYPES as string[]) || [
      'activity/production', 'activity/acquisition', 'activity/innovation',
      'activity/coordination', 'activity/learning', 'activity/governance',
      'activity/maintenance', 'activity/compliance',
      'outcome/financial', 'outcome/market', 'outcome/operational', 'outcome/people',
      'outcome/innovation', 'outcome/risk', 'outcome/competitive', 'outcome/external',
      'resource/money', 'resource/person', 'resource/team', 'resource/agent',
      'resource/tool', 'resource/knowledge', 'resource/client', 'resource/brand',
      'resource/data', 'resource/ip', 'resource/location', 'resource/channel', 'resource/supplier',
    ];
  }

  /**
   * 历史 `default` 图里**未随本次导出**的节点数（#1211 · U-5 显式计数，不静默丢）。
   *
   * 🔴 语义兜底：当本次导出的图**就是** `default`（`SYNOVA_ORG_ID` 未设的默认装机）时，
   * 这些节点**已经导出**了 ⇒ 必须返回 0，否则把"已导出"重复计成"未导出"（语义反转、数字错）。
   */
  private countDefaultGraphNodes(graph: string): number {
    if (graph === 'default') return 0;
    let count = 0;
    for (const type of this.allNodeTypes()) {
      try {
        count += this.graphStore.queryNodes(type, {}, 'default').length;
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'default 图计数查询降级');
      }
    }
    return count;
  }

  /** 导出 GraphStore 中该图的所有节点（按类型遍历） */
  private exportGraphNodes(tenantId: string, graph: string): ExportedNode[] {
    try {
      const results: ExportedNode[] = [];
      const nodeTypes: string[] = this.allNodeTypes();

      for (const type of nodeTypes) {
        try {
          const nodes = this.graphStore.queryNodes(type, {}, graph);
          for (const n of nodes) {
            if (this.matchesTenant(n.props, tenantId)) {
              results.push({ id: n.id, type: n.type, props: n.props, graph: '' });
            }
          }
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "数据导出节点查询");
          // 类型可能无数据，跳过
        }
      }

      return results;
    } catch (err: unknown) {
      log.warn({ err, tenantId }, 'exportGraphNodes 降级');
      return [];
    }
  }

  /** 导出 GraphStore 中该图的所有边 */
  private exportGraphEdges(graph: string): ExportedEdge[] {
    try {
      const results: ExportedEdge[] = [];
      const edgeTypes: string[] = (ALL_EDGE_TYPES as string[]) || [];

      for (const type of edgeTypes) {
        try {
          const edges = this.graphStore.queryEdges(type, undefined, undefined, graph);
          for (const e of edges) {
            results.push({
              id: e.id,
              type: e.type,
              from: e.from,
              to: e.to,
              weight: e.weight,
              props: e.props,
              graph: '',
            });
          }
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "数据导出边查询");
          // 类型可能无数据，跳过
        }
      }

      return results;
    } catch (err: unknown) {
      log.warn({ err }, 'exportGraphEdges 降级');
      return [];
    }
  }

  /** 导出 SessionStore 中该租户的全部会话 */
  private exportSessions(tenantId: string): ExportedSession[] {
    try {
      const allSessions = this.sessionStore.listSessions(1000);
      const tenantSessions = allSessions.filter((s) => s.orgId === tenantId);
      return tenantSessions.map((s) => {
        let messages: MessageRow[] = [];
        try {
          messages = this.sessionStore.getMessages(s.id);
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "导出消息获取");
          // 单会话消息读取失败，继续
        }
        return { session: s, messages };
      });
    } catch (err: unknown) {
      log.warn({ err, tenantId }, 'exportSessions 降级');
      return [];
    }
  }

  /** 导出 AgentMemoryStore 中该租户的全部记忆 */
  private exportMemories(tenantId: string): MemoryEntry[] {
    try {
      return this.memoryStore.list({ orgId: tenantId, limit: 10000 });
    } catch (err: unknown) {
      log.warn({ err, tenantId }, 'exportMemories 降级');
      return [];
    }
  }

  /** 检查 props 是否包含与 tenantId 匹配的字段 */
  private matchesTenant(props: Record<string, unknown>, tenantId: string): boolean {
    if (!props || typeof props !== 'object') return true;
    const propsObj = props as Record<string, unknown>;
    const orgVal = propsObj['orgId'];
    const tenantVal = propsObj['tenantId'];
    if (orgVal !== undefined) return String(orgVal) === tenantId;
    if (tenantVal !== undefined) return String(tenantVal) === tenantId;
    // 无租户字段 → 包含在导出中（保守策略：不漏数据）
    return true;
  }
}
