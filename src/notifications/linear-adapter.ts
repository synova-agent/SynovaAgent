/**
 * src/notifications/linear-adapter.ts — Linear 通知适配器
 *
 * 实现 NotificationAdapter 接口。从 task-integration.ts 提取 Linear GraphQL API 逻辑。
 * 幂等创建：先查后建，避免重复 Issue。
 *
 * v3.6 Batch 1 — 通知渠道文件化
 * K12-17（#200）引擎码归位：由 extensions/notifications/linear/adapter.ts 搬入（约束 4 边界物理可见）。
 */
import type { NotificationAdapter, Notification, NotificationResult } from './types';
import { createLogger } from '@synova/logger';

const log = createLogger('notifications/linear');

interface LinearConfig {
  apiKey: string;
  teamId: string;
}

function getConfig(): LinearConfig | null {
  const apiKey = process.env.LINEAR_API_KEY;
  const teamId = process.env.LINEAR_TEAM_ID;
  if (!apiKey) return null;
  return { apiKey, teamId: teamId ?? '' };
}

async function findExistingIssue(config: LinearConfig, title: string): Promise<string | null> {
  try {
    const query = `
      query SearchIssues($query: String!) {
        issues(filter: { search: $query }, first: 1) {
          nodes { id identifier }
        }
      }
    `;
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { query: title } }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { data?: { issues?: { nodes?: Array<{ identifier: string }> } } };
    return data.data?.issues?.nodes?.[0]?.identifier ?? null;
  } catch {
    // 查不到视为不存在 — 正常路径，不需要 warn
    return null;
  }
}

async function createIssue(config: LinearConfig, notification: Notification): Promise<string> {
  const query = `
    mutation CreateIssue($title: String!, $description: String!, $teamId: String!, $priority: Int) {
      issueCreate(input: {
        title: $title,
        description: $description,
        teamId: $teamId,
        priority: $priority
      }) {
        success
        issue { id identifier }
      }
    }
  `;
  const priorityMap: Record<string, number> = { P0: 1, P1: 2, P2: 3 };
  const variables = {
    title: `[Synova] ${notification.title}`,
    description: `${notification.description}${notification.reportId ? `\n\n诊断报告: ${notification.reportId}` : ''}`,
    teamId: config.teamId,
    priority: priorityMap[notification.priority] || 0,
  };

  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Linear API error ${resp.status}: ${errText}`);
  }
  const data = await resp.json() as { data?: { issueCreate?: { success: boolean; issue?: { identifier: string } } } };
  if (!data.data?.issueCreate?.success) {
    throw new Error('Linear issue creation returned success: false');
  }
  return data.data.issueCreate.issue!.identifier;
}

export const linearNotificationAdapter: NotificationAdapter = {
  channel: 'linear',

  shouldHandle(notification: Notification): boolean {
    return notification.targetSystem === 'linear';
  },

  async send(notification: Notification): Promise<NotificationResult> {
    const config = getConfig();
    if (!config) {
      return { success: false, error: 'Linear not configured (missing LINEAR_API_KEY)' };
    }

    try {
      const existingId = await findExistingIssue(config, notification.title);
      if (existingId) {
        log.info({ existingId, title: notification.title }, 'Linear issue already exists — skipped');
        return { success: true, externalId: existingId };
      }

      const extId = await createIssue(config, notification);
      log.info({ extId, title: notification.title }, 'Linear issue created');
      return { success: true, externalId: extId };
    } catch (err: any) {
      log.warn({ err, title: notification.title }, 'Linear issue creation failed');
      return { success: false, error: err.message };
    }
  },
};
