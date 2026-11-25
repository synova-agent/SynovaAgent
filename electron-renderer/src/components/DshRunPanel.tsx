/**
 * components/DshRunPanel.tsx — I-2 分析会话面板（受控纯展示，无 hook）
 *
 * 面板只画 props：输入值、状态、事件项、错误全部由 DshRunContainer／store 提供。
 * 事件白名单投影：text.delta 显示文本；tool.* 只显示人类可读标题/状态/isError（事件里没有入参/结果，不得虚构）；
 * hypothesis.* 画结构化卡片（业务对象/业务关系/依据/还不确定的部分）；载荷不合格 ⇒ 显式标「未结构化」，不猜补。
 * 失败可见（无空成功）：401/403/404/409/5xx/网络断/断流各有客户可读文案；空成功显示「无结果」而不是完成。
 *
 * B3（#1480）：客户面不出现内部字段/枚举原文；编号、错误码、工具原名、原始关系谓词等一律进
 * 「技术详情」折叠层（components/TechnicalDetails，默认收起），文案取自 lib/words 单一真源。
 */
import React from 'react';
import type { DshAuthState } from '../lib/auth-session';
import type { DshRunError, DshRunEventItem, DshRunStatus } from '../stores/dsh-run-store';
import { TechnicalDetails, type TechnicalDetailsItem } from './TechnicalDetails';
import {
  CUSTOMER_TEXT,
  TOOL_TITLE,
  evidenceText,
  objectValueText,
  relationLabel,
  statusLabel,
} from '../lib/words';

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
  if (auth === 'devmode') return '演示模式：服务端直接按演示身份处理，不签发真实登录凭证';
  if (auth === 'unauthenticated') return '未登录，请先登录';
  if (auth === 'expired') return '登录已过期，请重新登录';
  return '已登录（登录凭证只保存在本机当前会话中）';
}

function statusText(status: DshRunStatus, empty: boolean): string {
  if (status === 'idle') return '尚未开始本次分析';
  if (status === 'starting') return '正在发起…';
  if (status === 'running') return '运行中';
  if (status === 'done') return empty ? '无结果：本轮运行没有产生任何可见输出' : '运行完成';
  if (status === 'cancelled') return '已取消';
  if (status === 'expired') return '认证已失效';
  return '运行失败';
}

/** 主文案只给客户说法；原始码/状态/服务端原文由调用方放进「技术详情」 */
function errorText(error: DshRunError): string {
  if (error.code === 'STREAM_INTERRUPTED') return CUSTOMER_TEXT.connectionInterrupted;
  if (error.httpStatus === 401) return CUSTOMER_TEXT.loginExpired;
  if (error.httpStatus === 403) return CUSTOMER_TEXT.forbidden;
  if (error.httpStatus === 404) return CUSTOMER_TEXT.recordMissing;
  if (error.httpStatus === 409) return CUSTOMER_TEXT.stateChanged;
  return CUSTOMER_TEXT.serviceUnavailable;
}

function errorDetails(error: DshRunError): TechnicalDetailsItem[] {
  return [
    { label: '错误码', value: error.code },
    { label: '状态码', value: error.httpStatus === null ? '' : String(error.httpStatus) },
    { label: '阶段', value: error.phase ?? '' },
    { label: '服务端原文', value: error.message },
  ];
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
 * B3：对象/关系/依据的原始值只进「技术详情」；客户面显示业务说法。
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
  const rawItems: TechnicalDetailsItem[] = [
    ...view.objects.map((value, index) => ({ label: `对象原文 ${index + 1}`, value })),
    ...view.relations.map((value, index) => ({ label: `关系原文 ${index + 1}`, value })),
    ...view.evidence.map((value, index) => ({ label: `依据原文 ${index + 1}`, value })),
  ];
  return (
    <li className="dsh-event dsh-event-hypothesis" data-event-seq={item.seq} data-event-kind="hypothesis"
      data-hypothesis-structured="true">
      <strong>瓶颈假设</strong>
      {view.claim !== null ? <div className="dsh-hypothesis-claim">{view.claim}</div> : null}
      <HypothesisField label="涉及的对象" field="objects" values={view.objects.map(objectValueText)} />
      <HypothesisField label="对象之间的关系" field="relations" values={view.relations.map(relationLabel)} />
      <HypothesisField label="依据" field="evidence" values={view.evidence.map(evidenceText)} />
      <HypothesisField label="还不确定的部分" field="uncertainty" values={view.uncertainty} />
      <TechnicalDetails items={rawItems} />
    </li>
  );
}

function EventItem({ item }: { item: DshRunEventItem }): React.ReactElement {
  if (item.kind === 'tool') {
    const details: TechnicalDetailsItem[] = [
      { label: '工具名称', value: item.title ?? '' },
      { label: '工具类型', value: item.toolKind ?? '' },
      { label: '状态原文', value: item.status ?? '' },
    ];
    return (
      <li className="dsh-event dsh-event-tool" data-event-seq={item.seq} data-event-kind="tool"
        data-tool-call-id={item.toolCallId ?? undefined} data-tool-status={item.status ?? undefined}>
        <span className="dsh-tool-title">{TOOL_TITLE}</span>
        {item.status !== null ? <span className="dsh-tool-status">状态 {statusLabel(item.status)}</span> : null}
        {item.isError ? <span className="dsh-tool-error">失败</span> : null}
        <TechnicalDetails items={details} />
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
  const metaDetails: TechnicalDetailsItem[] = [
    { label: '运行标识', value: runId ?? '' },
    { label: '会话标识', value: sessionId ?? '' },
  ];

  return (
    <section className="dsh-run-panel" data-testid="dsh-run-panel" data-run-status={status} data-auth={auth}
      style={{ padding: 24, overflow: 'auto' }}>
      <header>
        <h2>本次分析</h2>
        <p>用真实账号发起一次分析，观察分析过程与数据核对；失败、断流与取消都可在此看见。</p>
      </header>

      <div className="dsh-auth" data-auth={auth}>{authText(auth)}</div>

      <label className="dsh-input-label" htmlFor="dsh-run-input">本次分析输入</label>
      <textarea
        id="dsh-run-input"
        data-testid="dsh-run-input"
        className="dsh-input"
        rows={4}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        placeholder="输入要交给本次分析的任务…"
      />
      {inputError !== null ? <div className="dsh-input-error" role="alert">{inputError}</div> : null}

      <div className="dsh-actions">
        <button id="dsh-run-submit" type="button" className="dsh-btn" disabled={submitDisabled} onClick={onSubmit}>
          开始本次分析
        </button>
        {running ? (
          <button id="dsh-run-cancel" type="button" className="dsh-btn" disabled={cancelPending} onClick={onCancel}>
            {cancelPending ? '正在取消…' : '取消'}
          </button>
        ) : null}
        {sessionId !== null && !sessionClosed ? (
          <button id="dsh-run-close" type="button" className="dsh-btn" onClick={onClose}>
            结束本次分析
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
        <TechnicalDetails items={metaDetails} />
        {sessionClosed ? <div className="dsh-session-closed">本次分析已结束</div> : null}
      </div>

      {error !== null ? (
        <div className="dsh-error" role="alert" data-error-code={error.code}>
          <strong>本次分析未完成</strong>
          <div>{errorText(error)}</div>
          <TechnicalDetails items={errorDetails(error)} />
        </div>
      ) : null}

      <ol className="dsh-events" data-testid="dsh-run-events">
        {events.map((item) => <EventItem key={`${item.seq}-${item.kind}`} item={item} />)}
      </ol>
    </section>
  );
};

export default React.memo(DshRunPanel);
