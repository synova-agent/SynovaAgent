/** Email 通知适配器 — K12-17（#200）由 extensions/notifications/email/adapter.ts 搬入（约束 4） */
import type { NotificationAdapter, Notification, NotificationResult } from './types';
export const emailNotificationAdapter: NotificationAdapter = {
  channel: 'email',
  shouldHandle(n: Notification) { return n.targetSystem === 'email' || !n.targetSystem; },
  async send(n: Notification): Promise<NotificationResult> {
    console.log('[email] would send:', n.title, 'to org', n.orgId);
    return { success: true, externalId: 'email-' + n.id };
  },
};
