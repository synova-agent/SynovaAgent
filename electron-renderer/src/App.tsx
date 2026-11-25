/**
 * App.tsx — Synova Desktop 根组件 (Phase 2.2)
 *
 * 集成: panels, Composer, CommandPalette, NotificationCenter, 快捷键
 *
 * T5a/B2（#1481 / #1480-B2）：左栏开合＝唯一 UI 真值 `leftPanelCollapsed`；
 * 宽度交给 `.panel-left.open/.closed` 的既有令牌，过渡 ≤200ms、reduced-motion 不动画。
 */
import React, { useEffect, useMemo, useCallback, useState } from 'react';
import TitleBar from './components/TitleBar';
import StatusBar from './components/StatusBar';
import LeftPanel from './components/LeftPanel';
import CenterPanel from './components/CenterPanel';
import ScanContainer from './components/ScanContainer';
import DshRunContainer from './components/DshRunContainer';
import RightPanel from './components/RightPanel';
import ResizeHandle from './components/ResizeHandle';
import CommandPalette from './components/CommandPalette';
import NotificationCenter from './components/NotificationCenter';
import { useAppStore } from './stores/app-store';
import { useConversationStore } from './stores/conversation-store';
import { fetchLlmConfigStatus } from './stores/llm-config';
import { useKeyboard } from './hooks/useKeyboard';
import { isElectron, getAppVersion, updateTrayState, onPushNotification, onNotificationClick, onNavigate } from './ipc/bridge';
import { getApiBase } from './lib/api';

/**
 * usePrefersReducedMotion — T5a/B2：跟随系统「减弱动态效果」
 * @input  无（读 matchMedia('(prefers-reduced-motion: reduce)')）
 * @output boolean（true＝不动画；matchMedia 不可用的环境 → false）
 * @degraded 无 window/matchMedia（非浏览器/测试环境）→ false，不抛
 */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const read = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [reduced, setReduced] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

const App: React.FC = () => {
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);
  const setOnlineStatus = useAppStore((s) => s.setOnlineStatus);
  const theme = useAppStore((s) => s.theme);
  const activeView = useAppStore((s) => s.activeView);
  const alertCount = useAppStore((s) => s.alertCount);
  const leftPanelWidth = useAppStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const leftPanelCollapsed = useAppStore((s) => s.leftPanelCollapsed);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const setLeftPanelWidth = useAppStore((s) => s.setLeftPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);
  const prefersReducedMotion = usePrefersReducedMotion();

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const handleLeftResize = useCallback((w: number) => setLeftPanelWidth(w), [setLeftPanelWidth]);
  const handleRightResize = useCallback((w: number) => setRightPanelWidth(w), [setRightPanelWidth]);

  const handlers = useMemo(() => ({
    toggleLeftPanel,
    toggleRightPanel: () => useAppStore.getState().toggleRightPanel(),
    openCommandPalette: () => { setNotifOpen(false); setCmdPaletteOpen((p) => !p); },
  }), [toggleLeftPanel]);

  useKeyboard(handlers);

  // 健康检测
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${getApiBase()}/health`);
        setOnlineStatus(res.ok ? 'connected' : 'disconnected');
      } catch { setOnlineStatus('disconnected'); }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [setOnlineStatus]);

  // D575: boot LLM 配置判定（spec §5.3 首启向导状态机）
  // configured（source=stored/env）→ 直接进主界面（已配置用户跳过向导）；
  // 未配置 / 状态拉取降级（null）→ firstLaunch 向导保留 + 黄条预备（llmUnconfigured=true）。
  // 注意: 向导内「保存并进入」成功会置 llmUnconfigured=false，黄条随之消失（结果可见）。
  useEffect(() => {
    const checkLlmConfig = async () => {
      const status = await fetchLlmConfigStatus();
      if (status !== null && status.configured) {
        useConversationStore.getState().setWelcomeState('ready');
      } else {
        useAppStore.getState().setLlmUnconfigured(true);
      }
    };
    void checkLlmConfig();
  }, []);

  // sync alert count to tray
  useEffect(() => {
    if (!isElectron()) return;
    if (alertCount > 0) updateTrayState('unread', alertCount);
    else updateTrayState('normal');
  }, [alertCount]);

  useEffect(() => {
    if (isElectron()) getAppVersion().then((v) => console.log(`[Synova] v${v}`));
  }, []);

  // ── D602: main → renderer 推送订阅（挂载一次 + cleanup 退订——preload on* 返回退订函数，
  //    防 effect 重挂载双订阅双通知；spec §5.1 App.tsx 行） ──

  // main P0 轮询推送 → 本地通知（通知中心"错误通知"段 + 系统通知旁路）
  useEffect(() => {
    if (!isElectron()) return;
    return onPushNotification((n) => {
      useAppStore.getState().pushLocalNotification({
        title: n.title,
        body: n.body,
        severity: 'critical',
        id: n.id,
      });
    });
  }, []);

  // 系统通知被点击 → main 已 show+focus 窗口，renderer 打开通知面板
  useEffect(() => {
    if (!isElectron()) return;
    return onNotificationClick(() => setNotifOpen(true));
  }, []);

  // 托盘菜单导航 → chat 视图 / 通知面板
  useEffect(() => {
    if (!isElectron()) return;
    return onNavigate((view) => {
      if (view === 'chat') useAppStore.getState().setActiveView('chat');
      else if (view === 'notifications') setNotifOpen(true);
    });
  }, []);

  const rightW = rightPanelOpen ? rightPanelWidth : 0;
  // T5a/B2: 过渡 ≤200ms（global.css 的 --transition-speed 是 0.3s、属另一线 ⇒ 组件内联覆盖）；
  // reduced-motion 时不动画，只换最终宽度。
  const panelTransition = prefersReducedMotion ? 'none' : 'width 200ms ease';
  // T5a/B2: 展开态用可拖拽宽度；收起态交给 `.panel-left.closed`
  // （global.css: `width: var(--left-panel-collapsed)`）——组件内不写死令牌数值。
  const leftPanelStyle: React.CSSProperties = {
    width: leftPanelCollapsed ? undefined : leftPanelWidth,
    minWidth: leftPanelCollapsed ? undefined : leftPanelWidth,
    transition: panelTransition,
  };

  return (
    <div className={`app-layout${theme === 'light' ? ' theme-light' : ''}`}>
      <TitleBar
        onToggleNotifications={() => { setCmdPaletteOpen(false); setNotifOpen((n) => !n); }}
        onToggleLeftPanel={toggleLeftPanel}
      />
      <div className="app-body">
        <nav className={`panel-left ${leftPanelCollapsed ? 'closed' : 'open'}`} style={leftPanelStyle}>
          <LeftPanel />
        </nav>
        {!leftPanelCollapsed && (
          <ResizeHandle side="left" panelWidth={leftPanelWidth} onWidthChange={handleLeftResize} />
        )}
        <main className="panel-center">{
          activeView === 'scan'
            ? <ScanContainer />
            : activeView === 'dsh'
              ? <DshRunContainer />
              : <CenterPanel />
        }</main>
        {rightPanelOpen && (
          <ResizeHandle side="right" panelWidth={rightPanelWidth} onWidthChange={handleRightResize} />
        )}
        {rightPanelOpen && (
          <aside className="panel-right open"
            style={{ width: rightW, minWidth: rightW, transition: 'width 0.3s ease' }}>
            <RightPanel />
          </aside>
        )}
      </div>
      <StatusBar />

      {/* Overlays */}
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
};

export default React.memo(App);
