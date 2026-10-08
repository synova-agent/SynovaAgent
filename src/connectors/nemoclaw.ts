/** connectors/nemoclaw.ts — NemoClaw MCP 连接器 (Batch 3 #8) · 国际轨 */
import type { DataConnector, ConnectorMessage, ConnectorMember, ConnectorEvent, OntologyMapping } from './types';
import { NodeType, EdgeType } from '@synova/ontology';
import { createLogger } from '@synova/logger';

const log = createLogger('connectors/nemoclaw');

export class NemoClawConnector implements DataConnector {
  readonly id = 'nemoclaw-connector';
  readonly name = 'NemoClaw MCP 连接器';
  readonly platform = 'nemoclaw';

  async healthCheck() {
    return { healthy: true, error: undefined };
  }

  async fetchMessages(orgId: string, since: string, until?: string): Promise<ConnectorMessage[]> {
    log.info({ orgId, since, until }, '[nemoclaw] MCP 工具调用获取消息');
    return [];
  }

  async fetchMembers(orgId: string): Promise<ConnectorMember[]> {
    log.info({ orgId }, '[nemoclaw] MCP 工具调用获取成员');
    return [];
  }

  async fetchEvents(orgId: string, since: string, until?: string): Promise<ConnectorEvent[]> {
    log.info({ orgId, since, until }, '[nemoclaw] MCP 工具调用获取事件');
    return [];
  }

  mapToOntology(messages: ConnectorMessage[], members: ConnectorMember[], events: ConnectorEvent[], orgId: string): OntologyMapping {
    const mapping: OntologyMapping = { nodes: [], edges: [] };
    for (const m of members) {
      mapping.nodes.push({ type: NodeType.RESOURCE_PERSON, props: { name: m.name, email: m.email } });
      if (m.department) mapping.nodes.push({ type: NodeType.RESOURCE_TEAM, props: { name: m.department, teamType: 'permanent' } });
    }
    for (const msg of messages) {
      mapping.edges.push({ type: EdgeType.INFORMATION_FLOW, from: msg.senderId, to: msg.recipientIds?.[0] || msg.senderId, weight: 1, props: { channel: msg.channel } });
    }
    for (const evt of events) {
      // #1384 V2b：补 requiredProps `name`；**语义待核**（#1381 判其为局部先例）
      mapping.nodes.push({ type: NodeType.ACTIVITY_LEARNING /* ONTOLOGY-MIGRATION: NodeType.ACTIVITY_LEARNING has no direct match. Store as edge annotation. */, props: { name: evt.eventType || 'event', eventType: evt.eventType, timestamp: evt.timestamp } });
    }
    log.info({ nodes: mapping.nodes.length, edges: mapping.edges.length, orgId }, '[nemoclaw] 本体映射完成');
    return mapping;
  }
}
