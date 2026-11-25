/**
 * components/StatusBar.tsx — 状态栏
 *
 * 显示在线状态、告警计数、上次诊断时间。
 */
import React from 'react';
import { useAppStore } from '../stores/app-store';

const StatusBar: React.FC = () => {
  const onlineStatus = useAppStore((s) => s.onlineStatus);
  const alertCount = useAppStore((s) => s.alertCount);
  const lastDiagnosisTime = useAppStore((s) => s.lastDiagnosisTime);
  // D575: LLM 未配置黄条（铁律 31 不静默——「暂不配置」进主界面后常驻提示）
  const llmUnconfigured = useAppStore((s) => s.llmUnconfigured);

  const statusColors: Record<string, string> = {
    connected: 'var(--green)',
    disconnected: 'var(--red)',
    connecting: 'var(--orange)',
  };

  const statusLabels: Record<string, string> = {
    connected: '在线',
    disconnected: '离线',
    connecting: '连接中',
  };

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-item">
          <span
            className="dot"
            style={{ background: statusColors[onlineStatus] }}
          />
          {statusLabels[onlineStatus]}
        </span>
        <span className="statusbar-item">
          {alertCount > 0
            ? `${alertCount} 条告警`
            : '无告警'}
        </span>
        {llmUnconfigured && (
          <span className="statusbar-item statusbar-llm-warning">
            ⚠ 分析模型未配置，暂时不能分析——请在设置中配置
          </span>
        )}
      </div>
      <div className="statusbar-right">
        <span className="statusbar-item">
          上次诊断: {lastDiagnosisTime || '--'}
        </span>
      </div>
    </footer>
  );
};

export default React.memo(StatusBar);
