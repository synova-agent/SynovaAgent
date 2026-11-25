/**
 * components/NotificationCenter.tsx — 通知中心 (Phase 2.2 + 2.3 + D602 交互卡片)
 *
 * 标题栏铃铛图标点击展开。D602 数据源 = GET /api/sentinel/tickets（useNotifications）。
 * - error banner: 获取失败显示"通知获取失败：{msg}"（铁律 31——消灭"暂无通知"假空态）
 * - degraded 提示: memory-fallback 数据源诚实降级提示（数据照常渲染）
 * - 错误通知段: app-store.localNotifications（SSE error 帧 / main P0 push 落点）+ ✕ 关闭
 * - 工单卡片动作: open 工单渲染"确认收到"/"标记为误报" → actOnTicket → POST transition 落库
 *   （成功 → 刷新拿新状态；失败 → 项内错误提示，不抛，铁律 24）
 * 纯组件（NotifErrorBanner/LocalNotificationItem/TicketActions）导出供测试直调
 * （D593 SentinelDetailSections 先例——test-support/render 不执行 hook）。
 */
import React, { useState } from 'react';
import { useAppStore, type LocalNotification } from '../stores/app-store';
import { useNotifications, ticketStatusLabel, type AppNotification } from '../hooks/useNotifications';
// B3（#1481 T4b）：传输层原文只进「技术详情」，客户面主文案取客户说法
import { TechnicalDetails } from './TechnicalDetails';

const TYPE_ICONS: Record<string, string> = {
  critical: '🚨', warning: '⚠️', info: '🔔',
};

/** 工单动作项内反馈状态（pending 禁按钮防双击；error 项内提示文案） */
export interface TicketActionFeedback {
  state: 'pending' | 'error';
  message?: string;
}

/**
 * NotifErrorBanner — 获取失败错误条（铁律 31: 降级信号传播到 UI）
 * @input error: 服务端/传输层原文（只进「技术详情」；主文案固定为客户说法，不拼原文）
 * @output data-notif-error 标记条（「暂时读不到通知」＋技术详情入口）
 */
export function NotifErrorBanner({ error }: { error: string }): React.ReactElement {
  return (
    <div className="notif-error-banner" role="alert" data-notif-error="true">
      <span className="notif-error-icon">⚠️</span>
      <span className="notif-error-text">暂时读不到通知</span>
      <TechnicalDetails items={[{ label: '原文', value: error }]} />
    </div>
  );
}

/**
 * LocalNotificationItem — 本地通知项（SSE error / P0 push）
 * @output severity 图标 + 标题 + 正文 + 相对时间 + ✕ 关闭按钮（data-local-dismiss）
 */
export function LocalNotificationItem(
  { n, onDismiss }: { n: LocalNotification; onDismiss: (id: string) => void },
): React.ReactElement {
  return (
    <div className={`notif-item local priority-${n.severity}`} data-local-notification={n.id}>
      <div className="notif-item-icon">{TYPE_ICONS[n.severity] || '📌'}</div>
      <div className="notif-item-body">
        <div className="notif-item-title">{n.title}</div>
        <div className="notif-item-body-text">{n.body}</div>
        <div className="notif-item-time">{fmtRelative(n.createdAt)}</div>
      </div>
      <button
        className="notif-dismiss-btn"
        data-local-dismiss={n.id}
        onClick={() => onDismiss(n.id)}
      >✕</button>
    </div>
  );
}

/**
 * TicketActions — 工单动作按钮组（D602 交互卡片核心）
 * @input  status: 工单状态机状态；feedback: 项内反馈；onAct('confirm'|'dismiss')
 * @output status==='open' → "确认收到"/"标记为误报"两按钮（data-ticket-action 标记）+
 *         失败反馈文案；非 open → null（由项内状态标签呈现，按钮消失 = 动作已落库的可见反馈）
 */
export function TicketActions(
  { status, feedback, onAct }: {
    status: string;
    feedback?: TicketActionFeedback;
    onAct: (action: 'confirm' | 'dismiss') => void;
  },
): React.ReactElement | null {
  if (status !== 'open') return null;
  return (
    <div
      className="notif-ticket-actions"
      data-ticket-actions="true"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="notif-action-btn confirm"
        data-ticket-action="confirm"
        disabled={feedback?.state === 'pending'}
        onClick={() => onAct('confirm')}
      >确认收到</button>
      <button
        className="notif-action-btn dismiss"
        data-ticket-action="dismiss"
        disabled={feedback?.state === 'pending'}
        onClick={() => onAct('dismiss')}
      >标记为误报</button>
      {feedback?.state === 'error' && (
        <span className="notif-action-error" data-ticket-action-error="true">
          操作失败：{feedback.message}
        </span>
      )}
    </div>
  );
}

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ open, onClose }) => {
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const localNotifications = useAppStore((s) => s.localNotifications);
  const dismissLocalNotification = useAppStore((s) => s.dismissLocalNotification);
  // D602: error/degraded/actOnTicket 全量消费（error 弃用是旧缺陷——审计 §3.5.1 "error 未渲染"）
  const { notifications, unreadCount, markAsRead, markAllRead, loading, error, degraded, actOnTicket, refresh } = useNotifications();
  const [actionFeedback, setActionFeedback] = useState<Record<string, TicketActionFeedback>>({});

  // 按 severity 排序取前 20
  const PRIORITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = [...notifications]
    .sort((a, b) => (PRIORITY_ORDER[a.severity] ?? 9) - (PRIORITY_ORDER[b.severity] ?? 9))
    .slice(0, 20);

  const handleClick = (n: AppNotification) => {
    markAsRead(n.id);
    if (n.workspaceId) {
      setActiveWorkspaceId(n.workspaceId);
      onClose();
    }
  };

  const handleMarkAll = () => {
    markAllRead();
  };

  // D602: 卡片动作 → transition 落库（成功 → 刷新拿新状态、清反馈；失败 → 项内错误提示不抛）
  const handleAction = async (id: string, action: 'confirm' | 'dismiss') => {
    setActionFeedback((prev) => ({ ...prev, [id]: { state: 'pending' } }));
    const result = await actOnTicket(id, action);
    if (result.ok) {
      setActionFeedback((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void refresh();
    } else {
      setActionFeedback((prev) => ({ ...prev, [id]: { state: 'error', message: result.error ?? '未知错误' } }));
    }
  };

  if (!open) return null;

  return (
    <div className="notif-overlay" onClick={onClose}>
      <div className="notif-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notif-header">
          <span className="notif-title">通知{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
          {unreadCount > 0 && (
            <button className="notif-mark-all-btn" onClick={handleMarkAll}>
              全部已读
            </button>
          )}
          <button className="notif-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="notif-list">
          {/* D602: error banner——获取失败不再是"暂无通知"假空态（铁律 31） */}
          {error !== null && <NotifErrorBanner error={error} />}
          {!error && degraded && (
            <div className="notif-degraded-hint" data-notif-degraded="true">
              预警数据暂时读不到，当前显示缓存内容
            </div>
          )}

          {loading && sorted.length === 0 && localNotifications.length === 0 && !error && (
            <div className="notif-empty fade-in">
              <div className="notif-empty-text">加载中...</div>
            </div>
          )}

          {/* D602: 错误通知段（SSE error 帧 / main P0 push 落点） */}
          {localNotifications.length > 0 && (
            <div className="notif-section" data-notif-local-section="true">
              <div className="notif-section-title">错误通知</div>
              {localNotifications.map((n) => (
                <LocalNotificationItem key={n.id} n={n} onDismiss={dismissLocalNotification} />
              ))}
            </div>
          )}

          {sorted.map((n) => (
            <div
              key={n.id}
              className={`notif-item${n.read ? '' : ' unread'} priority-${n.severity}`}
              onClick={() => handleClick(n)}
            >
              <div className="notif-item-icon">{TYPE_ICONS[n.severity] || '📌'}</div>
              <div className="notif-item-body">
                <div className="notif-item-title">{n.title}</div>
                <div className="notif-item-body-text">{n.body}</div>
                <div className="notif-item-time">{fmtRelative(n.createdAt)}</div>
                {/* D602: 工单卡片动作（仅 open 工单渲染按钮） */}
                {n.ticketStatus && (
                  <TicketActions
                    status={n.ticketStatus}
                    feedback={actionFeedback[n.id]}
                    onAct={(action) => { void handleAction(n.id, action); }}
                  />
                )}
                {n.ticketStatus && n.ticketStatus !== 'open' && (
                  <span className="notif-ticket-status" data-ticket-status={n.ticketStatus}>
                    {ticketStatusLabel(n.ticketStatus)}
                  </span>
                )}
              </div>
              <div className={`notif-priority-dot priority-${n.severity}`} />
            </div>
          ))}

          {!loading && sorted.length === 0 && localNotifications.length === 0 && !error && (
            <div className="notif-empty fade-in">
              <div className="notif-empty-icon">🔔</div>
              <div className="notif-empty-text">暂无通知</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function fmtRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default React.memo(NotificationCenter);
