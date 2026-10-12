/** 飞书审批通知适配器 — K12-17（#200）由 extensions/notifications/feishu-approval/adapter.ts 搬入（约束 4） */
import type { NotificationAdapter, Notification, NotificationResult } from './types';
export const feishuApprovalAdapter: NotificationAdapter = {
  channel: 'feishu-approval',
  shouldHandle(n: Notification) { return n.targetSystem === 'feishu-approval'; },
  async send(n: Notification): Promise<NotificationResult> {
    console.log('[feishu-approval] would create approval:', n.title);
    return { success: true, externalId: 'feishu-' + n.id };
  },
};
