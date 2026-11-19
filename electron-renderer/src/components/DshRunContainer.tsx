/**
 * components/DshRunContainer.tsx — I-2 DSH 会话取数容器（唯一连接 store 与纯面板）
 *
 * 唯一职责：订阅 store、挂载时同步认证态、把 action 以无参回调交给纯展示面板。
 * 面板无 hook（受控），因此输入值/事件/错误全部经本容器从 store 透传。
 */
import React, { useEffect } from 'react';
import { useDshRunStore } from '../stores/dsh-run-store';
import DshRunPanel from './DshRunPanel';

const DshRunContainer: React.FC = () => {
  const state = useDshRunStore();
  const { setInput, submit, cancel, close, reconnect } = state;

  useEffect(() => {
    state.syncAuth();
  }, [state.syncAuth]);

  return (
    <DshRunPanel
      input={state.input}
      inputError={state.inputError}
      status={state.status}
      auth={state.auth}
      runId={state.runId}
      sessionId={state.sessionId}
      events={state.events}
      error={state.error}
      empty={state.empty}
      cancelPending={state.cancelPending}
      sessionClosed={state.sessionClosed}
      onInputChange={setInput}
      onSubmit={() => { void submit(); }}
      onCancel={() => { void cancel(); }}
      onClose={() => { void close(); }}
      onReconnect={reconnect}
    />
  );
};

export default DshRunContainer;
