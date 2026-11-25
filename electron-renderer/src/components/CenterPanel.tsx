/**
 * components/CenterPanel.tsx — 中栏对话面板
 *
 * Phase 0.5: 空状态占位
 * Phase 1.1: 欢迎页 + 消息 + 模拟回复
 * Phase 1.2: Composer + useStreaming SSE 流式
 * D591: conversation 模式接线（缺省主链路 /api/conversations）、会话恢复（§5.2-C 时序）、
 *       快速行动意图消费（待发送条）与空态快速行动（可达性，见完成报告偏差 D-1）
 */
import React, { useRef, useEffect } from 'react';
import WelcomeScreen, {
  WELCOME_QUICK_ACTIONS,
  applyQuickAction,
  type QuickActionKind,
} from './WelcomeScreen';
import MessageItem from './MessageItem';
import Composer from './Composer';
import { useConversationStore, readLastSessionId, restoreMessages } from '../stores/conversation-store';
import { useStreaming } from '../hooks/useStreaming';
import { getApiBase } from '../lib/api';
import { TechnicalDetails } from './TechnicalDetails';
import { runtimeErrorMessage } from '../lib/words';

/**
 * restoreLastSession — D591 会话恢复（spec §5.2-C 时序；铁律 47 契约）
 *
 * @input  无 — 读 localStorage['synova:last-session-id']（readLastSessionId）
 *         + GET {getApiBase()}/api/sessions/:id（D590 白名单前缀，零凭证）
 * @output 'restored' — 投影成功: store.restoreMessages(投影) + setCurrentSessionId(id)（续轮锚）
 *         'empty'    — 无本地锚（首次使用）: 零副作用
 *         'degraded' — 404/网络/解析失败: console.warn 留痕 + 清锚（setCurrentSessionId(null)）
 *                      + 消息区保持空
 * @degraded 全程不抛、不阻断主界面进入（铁律 24/31: 历史不可得是可接受降级，但必须留痕）；
 *           恢复后首条新消息经 useStreaming 携带 sessionId 续轮（服务端 fromState，D590 已备）。
 */
export async function restoreLastSession(): Promise<'restored' | 'empty' | 'degraded'> {
  const id = readLastSessionId();
  if (!id) return 'empty';
  const store = useConversationStore.getState();
  try {
    const res = await fetch(`${getApiBase()}/api/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload: unknown = await res.json();
    store.restoreMessages(restoreMessages(payload));
    store.setCurrentSessionId(id);
    return 'restored';
  } catch (err) {
    console.warn('[CenterPanel] 会话恢复失败 — 清除本地锚点进入空态（不阻断）:',
      err instanceof Error ? err.message : String(err));
    useConversationStore.getState().setCurrentSessionId(null);
    return 'degraded';
  }
}

const CenterPanel: React.FC = () => {
  const messages = useConversationStore((s) => s.messages);
  const welcomeState = useConversationStore((s) => s.welcomeState);
  const phase = useConversationStore((s) => s.phase);
  // D527: 六阶段进度 + 降级错误条（铁律 24/31 前端侧）
  const phaseIndex = useConversationStore((s) => s.phaseIndex);
  const phaseLabel = useConversationStore((s) => s.phaseLabel);
  const phaseTotal = useConversationStore((s) => s.phaseTotal);
  const errorMessage = useConversationStore((s) => s.errorMessage);
  // D591: 快速行动意图（待发送条渲染源）
  const draftPrefill = useConversationStore((s) => s.draftPrefill);
  const pendingIntent = useConversationStore((s) => s.pendingIntent);
  const { isStreaming, thinkingExperts, sendMessage, cancelStreaming } = useStreaming();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // D591: 会话恢复——welcomeState 'ready' 首次成立时执行一次（含启动 boot 与向导完成两条路径）
  useEffect(() => {
    if (welcomeState !== 'ready' || restoredRef.current) return;
    restoredRef.current = true;
    void restoreLastSession();
  }, [welcomeState]);

  const handleSend = (text: string) => {
    const storeNow = useConversationStore.getState();
    if (storeNow.pendingIntent === 'diagnosis') {
      // D591: 欢迎页/空态「诊断我的公司」→ 首条消息走 consult 显式诊断
      //（GA 按需诊断桌面入口保留，spec §5.4 决策 1；用例 8 回归锁定）
      storeNow.setPendingIntent(null);
      void sendMessage(text, { mode: 'diagnosis' });
      return;
    }
    void sendMessage(text); // D591: 缺省 conversation 模式（/api/conversations，token 帧真流式）
  };

  // D591: 预填待发送条一键发送（消费后清空，走 conversation 模式）
  const handleSendDraft = () => {
    const storeNow = useConversationStore.getState();
    const text = storeNow.draftPrefill;
    if (!text) return;
    storeNow.setDraftPrefill(null);
    handleSend(text);
  };

  // Welcome 视图
  if (welcomeState !== 'ready') {
    return (
      <main className="panel-center">
        <WelcomeScreen
          onStartDiagnosis={() => useConversationStore.getState().setWelcomeState('ready')}
          onEnterDemo={() => useConversationStore.getState().setWelcomeState('ready')}
        />
      </main>
    );
  }

  // Chat 视图
  return (
    <main className="panel-center">
      {/* Header */}
      <div className="center-header">
        <span className="center-header-title">
          {isStreaming ? '诊断中...' : '对话'}
        </span>
        <div className="center-header-right">
          {isStreaming && (
            <>
              <span className="center-header-status">
                {thinkingExperts.length > 0
                  ? `${thinkingExperts.join('/')} 分析中`
                  : '处理中...'}
              </span>
              <button className="center-cancel-btn" onClick={cancelStreaming}>
                中断
              </button>
            </>
          )}
          {phase === 'done' && (
            <span className="center-header-done">✅ 诊断完成</span>
          )}
        </div>
      </div>

      {/* D527: 六阶段进度条（phase_started 0-5 推进；done 后由 header 显示完成态）。内联样式：写集不含 global.css */}
      {phaseIndex >= 0 && phaseIndex < phaseTotal && phase !== 'done' && (
        <div role="status" style={{ padding: '6px 16px', borderBottom: '1px solid var(--border, #2a3348)', fontSize: 11, color: 'var(--dim, #94a3b8)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>阶段 {phaseIndex + 1}/{phaseTotal} · {phaseLabel}</span>
          <progress value={phaseIndex + 1} max={phaseTotal} style={{ flex: 1, height: 6 }} />
        </div>
      )}

      {/* D527: 降级错误条（LLM 不可用/后端未就绪 → 用户可见，不静默不白屏，铁律 24/31） */}
      {phase === 'error' && errorMessage && (
        <div role="alert" style={{ padding: '8px 16px', background: 'rgba(239, 68, 68, 0.12)', color: 'var(--red, #ef4444)', fontSize: 12, borderBottom: '1px solid rgba(239, 68, 68, 0.3)' }}>
          ⚠ {runtimeErrorMessage(errorMessage)}
          <TechnicalDetails items={[{ label: '原始错误', value: errorMessage }]} />
        </div>
      )}

      {/* Messages */}
      <div className="center-messages">
        {messages.length === 0 ? (
          <div className="empty-state fade-in">
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-text">
              描述你的组织问题，Synova 将进行智能诊断分析
            </div>
            {/* D591: 空态快速行动——spec §4.2"用户进主界面后面对空消息区不知道该说话"的可达解。
                与欢迎页共用 WELCOME_QUICK_ACTIONS/applyQuickAction 单源（偏差 D-1：欢迎页
                ready 门控在现路由生产不可达，空态为可达落点）。 */}
            {!isStreaming && (
              <div className="welcome-quick-actions">
                {WELCOME_QUICK_ACTIONS.map((qa) => (
                  <button
                    key={qa.kind}
                    className="welcome-qa-btn"
                    onClick={() => applyQuickAction(qa.kind)}
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageItem key={msg._id ?? idx} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* D591: 快速行动待发送条——预填文本一键发送 / 诊断意图可视化，消费后清空 */}
      {(draftPrefill !== null || pendingIntent === 'diagnosis') && !isStreaming && (
        <div role="status" style={{ padding: '8px 16px', borderTop: '1px solid var(--border, #2a3348)', fontSize: 12, color: 'var(--dim, #94a3b8)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {draftPrefill !== null ? (
            <>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ✍️ {draftPrefill}
              </span>
              <button className="welcome-qa-btn" onClick={handleSendDraft}>发送</button>
              <button className="welcome-qa-btn" onClick={() => useConversationStore.getState().setDraftPrefill(null)}>取消</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>🔍 已选择「诊断我的公司」— 下一条消息将启动全面诊断</span>
              <button className="welcome-qa-btn" onClick={() => useConversationStore.getState().setPendingIntent(null)}>取消</button>
            </>
          )}
        </div>
      )}

      {/* Composer */}
      <Composer
        onSend={handleSend}
        disabled={isStreaming}
        placeholder={isStreaming ? '等待诊断完成...' : '描述你的组织问题...'}
      />
    </main>
  );
};

export default React.memo(CenterPanel);
