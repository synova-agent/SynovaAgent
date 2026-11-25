/**
 * components/TitleBar.tsx — 标题栏 (Phase 2.2)
 *
 * 显示企业名、在线状态、维度覆盖度、通知铃铛（未读计数 + 点击开/关通知中心）。
 *
 * T5a/B2（#1481 / #1480-B2）：左侧「窗口栏座位」（DSH 契约 §2.1 shell.leading）承载左栏
 * 开合控件——**收起后仍在原位可见**（恢复入口不随左栏收起而卸载/隐藏），且与 Ctrl+B
 * 共用 app-store 的 `toggleLeftPanel`（唯一 action，不得两套逻辑）。
 */
import React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAppStore } from '../stores/app-store';

interface TitleBarProps {
  onToggleNotifications: () => void;
  /** T5a/B2: 左栏开合（App 透传 store 的 toggleLeftPanel——与 Ctrl+B 是同一个 action） */
  onToggleLeftPanel: () => void;
}

const TitleBar: React.FC<TitleBarProps> = ({ onToggleNotifications, onToggleLeftPanel }) => {
  const onlineStatus = useAppStore((s) => s.onlineStatus);
  const alertCount = useAppStore((s) => s.alertCount);
  const dimensionCovered = useAppStore((s) => s.dimensionCovered);
  const dimensionTotal = useAppStore((s) => s.dimensionTotal);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const leftPanelCollapsed = useAppStore((s) => s.leftPanelCollapsed);

  const dimPercent = dimensionTotal > 0
    ? Math.round((dimensionCovered / dimensionTotal) * 100) : 0;

  const statusLabels: Record<string, string> = {
    connected: '连接正常', disconnected: '已断开', connecting: '连接中...',
  };

  // T5a/B2: 同一文案供 aria-label 与 tooltip 用（收起态说「打开」、展开态说「收起」）
  const leftPanelToggleLabel = leftPanelCollapsed ? '打开侧边栏' : '收起侧边栏';
  const LeftPanelToggleIcon = leftPanelCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-logo">
          <span className={`status-dot ${onlineStatus}`} />
          <span>Synova</span>
        </div>
        {/* T5a/B2: 左栏开合控件住在窗口栏（不在 .panel-left 内）⇒ 收起态仍挂载且可见；
            aria-expanded 随态变化，键盘可 Tab 聚焦 + Enter/Space 激活（原生 button） */}
        <button
          type="button"
          className="titlebar-btn"
          data-sidebar-toggle="left"
          aria-expanded={!leftPanelCollapsed}
          aria-label={leftPanelToggleLabel}
          title={leftPanelToggleLabel}
          onClick={onToggleLeftPanel}
        >
          <LeftPanelToggleIcon size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="titlebar-center">
        <div className="dimension-bar">
          <span style={{ color: 'var(--dim)' }}>维度</span>
          <span className="dimension-count">{dimensionCovered}/{dimensionTotal}</span>
          <div className="dimension-track">
            <div className="dimension-fill" style={{ width: `${dimPercent}%` }} />
          </div>
        </div>
        <span style={{ color: 'var(--dim)', fontSize: 11 }}>
          {statusLabels[onlineStatus]}
        </span>
      </div>

      <div className="titlebar-right">
        <button className="titlebar-btn" title="通知" onClick={onToggleNotifications}>
          🔔
          {alertCount > 0 && (
            <span className="notification-badge">
              {alertCount > 99 ? '99+' : alertCount}
            </span>
          )}
        </button>
        <button className="titlebar-btn" title="切换主题" onClick={toggleTheme}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
};

export default React.memo(TitleBar);
