/**
 * components/DshLoginPanel.tsx — I-2 登录入口（受控纯展示，无 hook）
 *
 * 为什么单成一件：`test-support/render.ts` 的静态渲染桥不执行 hook，且零新依赖（不引 react-dom/testing-library）
 * ⇒ 登录表单必须与 `DshRunPanel` 同型：只画 props，取数与身份写入归 `DshRunContainer` → `lib/auth-session`。
 *
 * 契约（铁律 47）:
 *   @input  email/password（受控值）｜pending（提交中）｜error（服务端失败：code/message/httpStatus）
 *           ｜expired（上一次会话已过期，需重新登录）｜canCancel（DevMode 下可返回运行面板）
 *   @output 登录表单：邮箱 `id=dsh-login-email`、密码 `id=dsh-login-password`（type=password）、
 *           提交 `id=dsh-login-submit`；失败主文案为词典 §5.2 客户说法，原始码/状态码/服务端原文
 *           只进「技术详情」（默认收起；`data-error-code` 仍在 DOM 上供排障与断言）
 *   @degraded 无（不取数、无网络、无存储）
 *   @error   — 不吞：错误来自 props，按钮与错误块同屏可见
 *   @not-here 不调用 login()、不读写 token（身份写入只在 auth-session 模块内存）、
 *             不落盘（无 localStorage/sessionStorage/indexedDB/文件）、不把凭据写日志
 */
import React from 'react';
// B3（#1481 T4b）：客户说法取 lib/words；原始码/服务端原文只进「技术详情」（词典 §5.2）
import { runtimeErrorMessage } from '../lib/words';
import { TechnicalDetails, type TechnicalDetailsItem } from './TechnicalDetails';

/** 面板可见的登录失败（服务端 code 原样透出，便于对账与排障） */
export interface DshLoginErrorView {
  code: string;
  message: string;
  httpStatus: number | null;
}

/**
 * 失败原值 → 「技术详情」条目（词典 §0.3／§5.2：错误码与 HTTP 码只在这里出现）。
 * @input  error — 服务端失败（code/message/httpStatus）
 * @output 三条原值；`httpStatus` 为 null 时该条为空串，由 TechnicalDetails 自动略去
 * @degraded 无（纯拼装）
 * @error   不抛
 * @not-here 不决定客户主文案（主文案取 lib/words）
 */
function errorDetails(error: DshLoginErrorView): TechnicalDetailsItem[] {
  return [
    { label: '错误码', value: error.code },
    { label: '状态码', value: error.httpStatus === null ? '' : String(error.httpStatus) },
    { label: '服务端原文', value: error.message },
  ];
}

export interface DshLoginPanelProps {
  email: string;
  password: string;
  pending: boolean;
  error: DshLoginErrorView | null;
  expired: boolean;
  canCancel: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const DshLoginPanel: React.FC<DshLoginPanelProps> = (props) => {
  const { email, password, pending, error, expired, canCancel, onEmailChange, onPasswordChange, onSubmit, onCancel } = props;
  const submitDisabled = pending || email.trim().length === 0 || password.length === 0;

  return (
    <section className="dsh-login-panel" data-testid="dsh-login-panel" data-expired={expired ? 'true' : 'false'}
      data-pending={pending ? 'true' : 'false'} style={{ padding: 24, overflow: 'auto' }}>
      <header>
        <h2>登录</h2>
        <p>用 Synova 账号登录后即可发起本次分析；登录凭证只保存在本机本次运行期间，不写磁盘、不进日志。</p>
      </header>

      {expired ? <div className="dsh-login-expired" role="alert">登录已过期，请重新登录</div> : null}

      <label className="dsh-input-label" htmlFor="dsh-login-email">邮箱</label>
      <input
        id="dsh-login-email"
        data-testid="dsh-login-email"
        className="dsh-input"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="you@example.com"
      />

      <label className="dsh-input-label" htmlFor="dsh-login-password">密码</label>
      <input
        id="dsh-login-password"
        data-testid="dsh-login-password"
        className="dsh-input"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
      />

      {error !== null ? (
        <div className="dsh-login-error" role="alert" data-error-code={error.code} data-http-status={error.httpStatus ?? undefined}>
          <strong>登录失败（原因见技术详情）</strong>
          <div>{runtimeErrorMessage(error.message)}</div>
          <TechnicalDetails items={errorDetails(error)} />
        </div>
      ) : null}

      <div className="dsh-actions">
        <button id="dsh-login-submit" data-testid="dsh-login-submit" type="button" className="dsh-btn"
          disabled={submitDisabled} onClick={onSubmit}>
          {pending ? '登录中…' : '登录'}
        </button>
        {canCancel ? (
          <button id="dsh-login-cancel" type="button" className="dsh-btn" onClick={onCancel}>返回</button>
        ) : null}
      </div>
    </section>
  );
};

export default React.memo(DshLoginPanel);
