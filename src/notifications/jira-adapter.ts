/**
 * src/notifications/jira-adapter.ts — Jira 通知适配器
 *
 * 实现 NotificationAdapter 接口。从 task-integration.ts 提取 Jira REST API 逻辑。
 * 幂等创建：先查后建，避免重复 Issue。
 *
 * v3.6 Batch 1 — 通知渠道文件化
 * K12-17（#200）引擎码归位：由 extensions/notifications/jira/adapter.ts 搬入（约束 4 边界物理可见）。
 */
import type { NotificationAdapter, Notification, NotificationResult } from './types';
import { createLogger } from '@synova/logger';

const log = createLogger('notifications/jira');

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueTypeId?: string;
}

function getConfig(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return { baseUrl, email, apiToken, projectKey };
}

async function findExistingIssue(config: JiraConfig, title: string): Promise<string | null> {
  try {
    const jql = encodeURIComponent(`project=${config.projectKey} AND summary~"${title.replace(/"/g, '\\"')}"`);
    const url = `${config.baseUrl}/rest/api/3/search?jql=${jql}&maxResults=1`;
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json() as { issues?: Array<{ key: string }> };
    return data.issues?.[0]?.key ?? null;
  } catch {
    // 查不到视为不存在 — 正常路径，不需要 warn
    return null;
  }
}

async function createIssue(config: JiraConfig, notification: Notification): Promise<string> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const body: Record<string, unknown> = {
    fields: {
      project: { key: config.projectKey },
      summary: `[Synova] ${notification.title}`,
      description: {
        type: 'doc', version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: notification.description }] },
          ...(notification.reportId
            ? [{ type: 'paragraph', content: [{ type: 'text', text: `诊断报告: ${notification.reportId}` }] }]
            : []),
        ],
      },
      issuetype: { id: config.issueTypeId || '10002' }, // default: Task
      ...(notification.priority === 'P0' ? { priority: { name: 'Highest' } }
        : notification.priority === 'P1' ? { priority: { name: 'High' } }
        : {}),
    },
  };
  const resp = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Jira API error ${resp.status}: ${errText}`);
  }
  const data = await resp.json() as { key: string };
  return data.key;
}

export const jiraNotificationAdapter: NotificationAdapter = {
  channel: 'jira',

  shouldHandle(notification: Notification): boolean {
    return notification.targetSystem === 'jira';
  },

  async send(notification: Notification): Promise<NotificationResult> {
    const config = getConfig();
    if (!config) {
      return { success: false, error: 'Jira not configured (missing JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/JIRA_PROJECT_KEY)' };
    }

    try {
      const existingId = await findExistingIssue(config, notification.title);
      if (existingId) {
        log.info({ existingId, title: notification.title }, 'Jira issue already exists — skipped');
        return { success: true, externalId: existingId };
      }

      const extId = await createIssue(config, notification);
      log.info({ extId, title: notification.title }, 'Jira issue created');
      return { success: true, externalId: extId };
    } catch (err: any) {
      log.warn({ err, title: notification.title }, 'Jira issue creation failed');
      return { success: false, error: err.message };
    }
  },
};
