/**
 * components/DshRunPanel.tsx — I-2 DSH 会话面板（受控纯展示，无 hook）
 *
 * 面板只画 props：输入值、状态、事件项、错误全部由 DshRunContainer／store 提供。
 * 事件白名单投影：text.delta 显示文本；tool.* 只显示 title/kind/status/isError（事件里没有入参/结果，不得虚构）；
 * hypothesis.* 画结构化卡片（对象/关系/依据（可回来源）/不确定性）；载荷不合格 ⇒ 显式标「未结构化」，不猜补。
 * 失败可见（无空成功）：401/403/404/409/5xx/网络断/断流各有可诊断文案；空成功显示「无结果」而不是完成。
 */
import React from 'react';
import type { DshAuthState } from '../lib/auth-session';
import type { DshRunError, DshRunEventItem, DshRunStatus } from '../stores/dsh-run-store';

export interface DshRunPanelProps {
  input: string;
  inputError: string | null;
  status: DshRunStatus;
  auth: DshAuthState;
  runId: string | null;
  sessionId: string | null;
  events: DshRunEventItem[];
  error: DshRunError | null;
  empty: boolean;
  cancelPending: boolean;
  sessionClosed: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onClose: () => void;
  onReconnect: () => void;
}

function authText(auth: DshAuthState): string {
  if (auth === 'devmode') return '开发模式（DevMode）：服务端按开发模式自动身份处理，不发真实登录令牌';
  if (auth === 'unauthenticated') return '未登录，请先登录';
  if (auth === 'expired') return '登录已过期，请重新登录';
  return '已登录（令牌只在内存）';
}

function statusText(status: DshRunStatus, empty: boolean): string {
  if (status === 'idle') return '尚未发起会话';
  if (status === 'starting') return '正在发起…';
  if (status === 'running') return '运行中';
  if (status === 'done') return empty ? '无结果：本轮运行没有产生任何可见输出' : '运行完成';
  if (status === 'cancelled') return '已取消';
  if (status === 'expired') return '认证已失效';
  return '运行失败';
}

function errorText(error: DshRunError): string {
  if (error.code === 'STREAM_INTERRUPTED') return '连接中断，可重连';
  if (error.httpStatus === 401) return `认证失败，请重新登录：${error.message}`;
  if (error.httpStatus === 403) return `无权访问（403）：${error.message}`;
  if (error.httpStatus === 404) return `运行不存在（404）：${error.message}`;
  if (error.httpStatus === 409) return `状态冲突（409）：${error.message}`;
  if (error.httpStatus !== null && error.httpStatus >= 500) return `服务端错误（${error.httpStatus}）：${error.message}`;
  return `网络或服务异常：${error.message}`;
}

function HypothesisField({ label, field, values }: { label: string; field: string; values: string[] }): React.ReactElement {
  return (
    <div className="dsh-hypothesis-field" data-hypothesis-field={field}>
      <span className="dsh-hypothesis-label">{label}</span>
      <ul className="dsh-hypothesis-values">
        {values.map((value, index) => <li key={`${field}-${index}`}>{value}</li>)}
      </ul>
    </div>
  );
}

/**
 * 结构化瓶颈假设卡片（#1459 T-B）。
 * 四要素齐全才画卡片；缺字段/服务端判 invalid ⇒ 显式标「未结构化」＋原因，**不猜补**任何要素。
 */
function HypothesisItem({ item }: { item: Extract<DshRunEventItem, { kind: 'hypothesis' }> }): React.ReactElement {
  const view = item.hypothesis;
  if (!view.structured) {
    return (
      <li className="dsh-event dsh-event-hypothesis" data-event-seq={item.seq} data-event-kind="hypothesis"
        data-hypothesis-structured="false">
        <strong>瓶颈假设（未结构化）</strong>
        <div className="dsh-hypothesis-unstructured">未结构化：{view.invalidReason ?? '载荷字段缺失'}</div>
        {view.rawText !== null ? <div className="dsh-hypothesis-raw">{view.rawText}</div> : null}
      </li>
    );
  }
  return (
    <li className="dsh-event dsh-event-hypothesis" data-event-seq={item.seq} data-event-kind="hypothesis"
      data-hypothesis-structured="true">
      <strong>瓶颈假设</strong>
      {view.claim !== null ? <div className="dsh-hypothesis-claim">{view.claim}</div> : null}
      <HypothesisField label="对象" field="objects" values={view.objects} />
      <HypothesisField label="关系" field="relations" values={view.relations} />
      <HypothesisField label="依据（可回来源）" field="evidence" values={view.evidence} />
      <HypothesisField label="不确定性" field="uncertainty" values={view.uncertainty} />
    </li>
  );
}

function EventItem({ item }: { item: DshRunEventItem }): React.ReactElement {
  if (item.kind === 'tool') {
    return (
      <li className="dsh-event dsh-event-tool" data-event-seq={item.seq} data-event-kind="tool"
        data-tool-call-id={item.toolCallId ?? undefined} data-tool-status={item.status ?? undefined}>
        <span className="dsh-tool-title">{item.title ?? '工具调用'}</span>
        {item.toolKind !== null ? <span className="dsh-tool-kind">类型 {item.toolKind}</span> : null}
        {item.status !== null ? <span className="dsh-tool-status">状态 {item.status}</span> : null}
        {item.isError ? <span className="dsh-tool-error">失败</span> : null}
      </li>
    );
  }
  if (item.kind === 'hypothesis') {
    return <HypothesisItem item={item} />;
  }
  return (
    <li className="dsh-event dsh-event-text" data-event-seq={item.seq} data-event-kind="text">
      <span>{item.text}</span>
    </li>
  );
}

export const DshRunPanel: React.FC<DshRunPanelProps> = (props) => {
  const {
    input, inputError, status, auth, runId, sessionId, events, error, empty, cancelPending, sessionClosed,
    onInputChange, onSubmit, onCancel, onClose, onReconnect,
  } = props;
  const authReady = auth === 'devmode' || auth === 'authenticated';
  const submitDisabled = !authReady || input.trim().length === 0 || status === 'starting' || status === 'running';
  const running = status === 'running';

  return (
    <section className="dsh-run-panel" data-testid="dsh-run-panel" data-run-status={status} data-auth={auth}
      style={{ padding: 24, overflow: 'auto' }}>
      <header>
        <h2>DSH 会话</h2>
        <p>用真实账号发起一轮会话，观察会话事件与工具轨迹；失败、断流与取消都可在此看见。</p>
      </header>

      <div className="dsh-auth" data-auth={auth}>{authText(auth)}</div>

      <label className="dsh-input-label" htmlFor="dsh-run-input">会话输入</label>
      <textarea
        id="dsh-run-input"
        data-testid="dsh-run-input"
        className="dsh-input"
        rows={4}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="输入要交给 DSH 会话的任务…"
      />
      {inputError !== null ? <div className="dsh-input-error" role="alert">{inputError}</div> : null}

      <div className="dsh-actions">
        <button id="dsh-run-submit" type="button" className="dsh-btn" disabled={submitDisabled} onClick={onSubmit}>
          发起会话
        </button>
        {running ? (
          <button id="dsh-run-cancel" type="button" className="dsh-btn" disabled={cancelPending} onClick={onCancel}>
            {cancelPending ? '正在取消…' : '取消'}
          </button>
        ) : null}
        {sessionId !== null && !sessionClosed ? (
          <button id="dsh-run-close" type="button" className="dsh-btn" onClick={onClose}>
            关闭会话
          </button>
        ) : null}
        {error !== null && error.canReconnect ? (
          <button id="dsh-run-reconnect" type="button" className="dsh-btn" onClick={onReconnect}>
            重连
          </button>
        ) : null}
      </div>

      <div className="dsh-run-meta">
        <div className="dsh-status" data-run-status={status}>{statusText(status, empty)}</div>
        {runId !== null ? <div className="dsh-run-id">运行编号：{runId}</div> : null}
        {sessionId !== null ? <div className="dsh-session-id">会话编号：{sessionId}</div> : null}
        {sessionClosed ? <div className="dsh-session-closed">会话已关闭</div> : null}
      </div>

      {error !== null ? (
        <div className="dsh-error" role="alert" data-error-code={error.code}>
          <strong>运行未完成</strong>
          <div>{errorText(error)}</div>
        </div>
      ) : null}

      <ol className="dsh-events" data-testid="dsh-run-events">
        {events.map((item) => <EventItem key={`${item.seq}-${item.kind}`} item={item} />)}
      </ol>
    </section>
  );
};

export default React.memo(DshRunPanel);
