/**
 * connectors/feishu.ts — DomesticHub: 飞书数据连接器 (双轨策略 #5)
 *
 * 实现 DataConnector 接口。从飞书获取消息、成员、事件，
 * 映射为 SOG 本体事件。国内轨独立自研，不依赖 NemoClaw。
 */
import type { DataConnector, ConnectorMessage, ConnectorMember, ConnectorEvent, OntologyMapping } from './types';
import { NodeType, EdgeType } from '@synova/ontology';
import { createLogger } from '@synova/logger';
import { feishuHealthCheck } from './feishu-bridge';
import type { FeishuMember } from './feishu-bridge';

const log = createLogger('connectors/feishu');

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  tenantKey?: string;
}

/** 从环境变量加载飞书配置 (P0-2) */
export function loadFeishuConfig(): FeishuConfig {
  return {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  };
}

/**
 * 飞书数据连接器 (P0-2: 已激活真实 API)。
 * 对接飞书服务端 API（消息、通讯录、审批），映射为 SOG 本体事件。
 */
export class FeishuConnector implements DataConnector {
  readonly id = 'feishu-connector';
  readonly name = '飞书数据连接器';
  readonly platform = 'feishu';

  private config: FeishuConfig;

  constructor(config?: FeishuConfig) {
    this.config = config || loadFeishuConfig();
  }

  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    if (!this.config.appId || !this.config.appSecret) {
      return { healthy: false, error: '飞书 App ID 或 App Secret 未配置 (设置 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量)' };
    }
    const ok = await feishuHealthCheck(this.config.appId, this.config.appSecret);
    return ok ? { healthy: true } : { healthy: false, error: '飞书 API 连接失败 (检查 App ID/Secret 或网络)' };
  }

  async fetchMessages(orgId: string, since: string, until?: string): Promise<ConnectorMessage[]> {
    if (!this.config.appId || !this.config.appSecret) {
      log.warn('[feishu] 凭证未配置 — 返回空');
      return [];
    }
    try {
      const { getPythonBridge } = await import('../providers/python-bridge');
      const bridge = getPythonBridge();
      const result = await bridge.run<{ messages: ConnectorMessage[] }>(
        'connectors.feishu', 'connector_feishu_fetch_messages',
        { appId: this.config.appId, appSecret: this.config.appSecret, orgId, since, until },
      );
      log.info({ orgId, count: result.messages?.length || 0 }, '[feishu] 消息获取完成');
      return result.messages || [];
    } catch (err) {
      log.warn({ err, orgId }, '[feishu] 消息获取失败 — 返回空 (degraded)');
      return [];
    }
  }

  async fetchMembers(orgId: string): Promise<ConnectorMember[]> {
    if (!this.config.appId || !this.config.appSecret) {
      log.warn('[feishu] 凭证未配置 — 返回空');
      return [];
    }
    try {
      const { getPythonBridge } = await import('../providers/python-bridge');
      const bridge = getPythonBridge();
      const result = await bridge.run<{ members: FeishuMember[] }>(
        'connectors.feishu', 'connector_feishu_fetch_members',
        { appId: this.config.appId, appSecret: this.config.appSecret },
      );
      const members: ConnectorMember[] = (result.members || []).map(m => ({
        id: m.id, name: m.name, email: m.email, department: m.departmentIds?.[0] || '',
        title: m.title, status: m.status,
      }));
      log.info({ orgId, count: members.length }, '[feishu] 成员获取完成');
      return members;
    } catch (err) {
      log.warn({ err, orgId }, '[feishu] 成员获取失败 — 返回空 (degraded)');
      return [];
    }
  }

  async fetchEvents(orgId: string, since: string, until?: string): Promise<ConnectorEvent[]> {
    log.info({ orgId, since, until }, '[feishu] 获取事件 — 待激活');
    return [];
  }

  mapToOntology(
    messages: ConnectorMessage[],
    members: ConnectorMember[],
    events: ConnectorEvent[],
    orgId: string,
  ): OntologyMapping {
    const mapping: OntologyMapping = { nodes: [], edges: [] };

    // 1. 成员 → Person 节点
    for (const m of members) {
      mapping.nodes.push({
        type: NodeType.RESOURCE_PERSON,
        props: { name: m.name, email: m.email || undefined },
      });
      if (m.department) {
        // 部门 → Team 节点
        mapping.nodes.push({
          type: NodeType.RESOURCE_TEAM,
          props: { name: m.department, teamType: 'permanent' },
        });
      }
    }

    // 2. 消息 → INTERACTS_WITH 边
    // (需要节点 ID 映射——由 graph-store 在持久化时分配)
    for (const msg of messages) {
      mapping.edges.push({
        type: EdgeType.INFORMATION_FLOW,
        from: msg.senderId,
        to: msg.recipientIds?.[0] || msg.senderId,
        weight: 1,
        props: { channel: msg.channel },
      });
    }

    // 3. 事件 → Event 节点 + 关联边
    for (const evt of events) {
      mapping.nodes.push({
        type: NodeType.ACTIVITY_LEARNING /* ONTOLOGY-MIGRATION: NodeType.ACTIVITY_LEARNING has no direct match. Store as edge annotation. */,
        // #1384 V2b：补 requiredProps `name`（本体 schema）；**语义待核**（#1381 判其为局部先例）
        props: { name: evt.eventType || 'event', eventType: evt.eventType, timestamp: evt.timestamp },
      });
      for (const relatedId of evt.relatedEntityIds || []) {
        mapping.edges.push({
          type: EdgeType.INFORMATION_FLOW,
          from: evt.id,
          to: relatedId,
          weight: 0.7,
          props: { correspondenceType: 'related', confidence: 0.7 },
        });
      }
    }

    log.info({ nodes: mapping.nodes.length, edges: mapping.edges.length, orgId }, '[feishu] 本体映射完成');
    return mapping;
  }
}
