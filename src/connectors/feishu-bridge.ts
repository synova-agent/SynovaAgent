/**
 * connectors/feishu-bridge.ts — TS → Python 飞书连接器桥接
 *
 * Day 3 T3.1: TS 侧通过 PythonBridge 调用 Python 飞书实现，
 * 将飞书通讯录+消息数据写入 SOG 本体图。
 */
import { getPythonBridge } from '../providers/python-bridge';
import { createLogger } from '@synova/logger';
import type { GraphStore } from '../l4/graph-bridge';

const log = createLogger('connectors/feishu-bridge');

export interface FeishuMember {
  id: string; name: string; email: string; mobile: string;
  departmentIds: string[]; title: string; employeeType: string; status: string;
}

export interface FeishuMessage {
  id: string; senderId: string; senderName: string; content: string;
  timestamp: string; channelId: string; threadId: string;
}

/** Fetch Feishu members via Python bridge and write to SOG graph */
export async function syncFeishuMembersToSOG(
  appId: string, appSecret: string, orgId: string, store: GraphStore,
): Promise<{ members: number; nodes: number }> {
  const bridge = getPythonBridge();
  const result = await bridge.run<{ members: FeishuMember[]; total: number }>(
    'connectors.feishu', 'connector_feishu_fetch_members',
    { appId, appSecret },
  );

  // Map to SOG nodes (兜底空值 — SOG Person 必填 name)
  let nodeCount = 0;
  for (const m of result.members) {
    // #1384 V2b：遗留轴 'Person' → 本体轴 resource/person（requiredProps `name` 已满足）
    store.createNode('resource/person', {
      name: m.name || `FeishuUser_${m.id}`,
      email: m.email || '',
      mobile: m.mobile || '',
      title: m.title || '',
      employeeType: m.employeeType || 'employee',
      status: m.status || 'active',
      sourceId: m.id, source: 'feishu',
    }, orgId);
    nodeCount++;

    for (const deptId of m.departmentIds) {
      store.createNode('resource/team', { name: `Department_${deptId}`, sourceId: deptId, source: 'feishu' }, orgId);
    }
  }

  log.info({ members: result.members.length, nodes: nodeCount, orgId }, '飞书成员同步到SOG完成');
  return { members: result.members.length, nodes: nodeCount };
}

/** Health check — is Feishu API reachable? */
export async function feishuHealthCheck(appId: string, appSecret: string): Promise<boolean> {
  try {
    const bridge = getPythonBridge();
    const result = await bridge.run<{ healthy: boolean }>(
      'connectors.feishu', 'connector_feishu_health_check',
      { appId, appSecret },
    );
    return result.healthy;
  } catch (err) {
    log.warn({ err }, '飞书连接器健康检查失败');
    return false;
  }
}
