/**
 * components/DshRunContainer.tsx — I-2 DSH 会话取数容器（唯一连接 store 与纯面板）
 *
 * 唯一职责：订阅 store、挂载时同步认证态、把 action 以无参回调交给纯展示面板。
 * 面板无 hook（受控），因此输入值/事件/错误全部经本容器从 store 透传。
 *
 * B1 登录入口接线（本轮）：未登录／登录过期 ⇒ 挂载 `DshLoginPanel`；
 * 提交走 `lib/auth-session.login()`（`POST /api/auth/login`），
 * 成功后 token 已写入 auth-session 模块内存（不落盘），随后 `syncAuth()` 把认证态同步进 store，
 * 运行面板随即可用，`startRun()` 由 `authHeader()` 带出 `Authorization: Bearer <jwt>`。
 * 登录失败保留服务端 code/message（面板可见），认证态留在「未登录」，不回退 DevMode。
 * DevMode 下运行面板照旧，并保留一个「使用账号登录」入口（否则登录表单在默认态不可达）。
 */
import React, { useEffect, useState } from 'react';
import { login, type LoginError } from '../lib/auth-session';
import { useDshRunStore } from '../stores/dsh-run-store';
import DshLoginPanel from './DshLoginPanel';
import DshRunPanel from './DshRunPanel';

const DshRunContainer: React.FC = () => {
  const state = useDshRunStore();
  const { setInput, submit, cancel, close, reconnect } = state;

  // 登录表单的受控状态（token 不在这里：只由 lib/auth-session 模块内存持有）
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);

  useEffect(() => {
    state.syncAuth();
  }, [state.syncAuth]);

  const needsLogin = state.auth === 'unauthenticated' || state.auth === 'expired';
  const showLogin = needsLogin || (state.auth === 'devmode' && loginRequested);

  const handleLogin = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    const result = await login(email, password);
    setPending(false);
    if (result.kind === 'ok') {
      // 登录成功：token 已在 auth-session 内存；清空密码并撤销表单入口
      setPassword('');
      setLoginError(null);
      setLoginRequested(false);
    } else {
      // 失败：保留服务端 code/message 供面板显示；认证态保持未登录（login() 已切到 token 模式）
      setLoginError(result);
    }
    state.syncAuth();
  };

  const cancelLogin = (): void => {
    setLoginRequested(false);
    setLoginError(null);
    setPassword('');
  };

  if (showLogin) {
    return (
      <DshLoginPanel
        email={email}
        password={password}
        pending={pending}
        error={loginError}
        expired={state.auth === 'expired'}
        canCancel={state.auth === 'devmode'}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={() => { void handleLogin(); }}
        onCancel={cancelLogin}
      />
    );
  }

  return (
    <>
      {state.auth === 'devmode' ? (
        <div className="dsh-login-entry">
          <button id="dsh-login-entry" data-testid="dsh-login-entry" type="button" className="dsh-btn"
            onClick={() => setLoginRequested(true)}>
            使用账号登录
          </button>
        </div>
      ) : null}
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
    </>
  );
};

export default DshRunContainer;
