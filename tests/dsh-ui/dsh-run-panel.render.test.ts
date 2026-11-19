/**
 * tests/dsh-ui/dsh-run-panel.render.test.ts — #1429 I-2 DshRunPanel 纯展示渲染
 *
 * 渲染桥不执行 hook（electron-renderer/src/test-support/render.ts）⇒ 本面板必须受控：
 *   输入值/状态/事件全部来自 props，面板只画不取数。
 * 覆盖：未登录／过期／DevMode 文案；输入框＋提交/取消/关闭按钮；工具只显示 title/kind/status；
 *   401/403/404/409/5xx/网络断各自可见；断流不完成；空成功显示无结果；取消/已关闭。
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { DshRunPanel, type DshRunPanelProps } from '../../electron-renderer/src/components/DshRunPanel';

function props(overrides: Partial<DshRunPanelProps> = {}): DshRunPanelProps {
  return {
    input: '',
    inputError: null,
    status: 'idle',
    auth: 'devmode',
    runId: null,
    sessionId: null,
    events: [],
    error: null,
    empty: false,
    cancelPending: false,
    sessionClosed: false,
    onInputChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<DshRunPanelProps> = {}): string {
  return renderToStaticMarkup(React.createElement(DshRunPanel, props(overrides)));
}

function buttonTag(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
}

function toolEvent(seq: number, overrides: Record<string, unknown> = {}): DshRunPanelProps['events'][number] {
  return {
    seq,
    kind: 'tool',
    toolCallId: 'call_1',
    title: '读取清单',
    toolKind: 'read',
    status: 'completed',
    isError: false,
    ...overrides,
  };
}

describe('#1429 DshRunPanel 认证态与输入（受控、无 hook）', () => {
  it('DevMode 文案可见；含输入框 id=dsh-run-input 与提交按钮 id=dsh-run-submit', () => {
    const html = render({ auth: 'devmode' });
    expect(html).toContain('开发模式');
    expect(html).toContain('id="dsh-run-input"');
    expect(html).toContain('<textarea');
    expect(html).toContain('id="dsh-run-submit"');
    expect(html).toContain('发起会话');
  });

  it('未登录：显示「未登录」，提交按钮 disabled（无 token 不可发起）', () => {
    const html = render({ auth: 'unauthenticated' });
    expect(html).toContain('未登录');
    expect(buttonTag(html, 'dsh-run-submit')).toContain('disabled');
  });

  it('登录过期：显示「登录已过期」，提交按钮 disabled', () => {
    const html = render({ auth: 'expired', status: 'expired' });
    expect(html).toContain('登录已过期');
    expect(buttonTag(html, 'dsh-run-submit')).toContain('disabled');
  });

  it('空输入时提交 disabled；本地输入错误可见', () => {
    expect(buttonTag(render({ auth: 'authenticated', input: '   ' }), 'dsh-run-submit')).toContain('disabled');
    const html = render({ auth: 'authenticated', input: '你好', inputError: '输入超过 100000 字符上限' });
    expect(html).toContain('输入超过 100000 字符上限');
    expect(buttonTag(html, 'dsh-run-submit')).not.toContain('disabled');
  });
});

describe('#1429 DshRunPanel 事件与工具轨迹（只显示 title/kind/status）', () => {
  it('文本增量与工具行按序渲染；工具只出现标题/类型/状态/失败标记', () => {
    const html = render({
      auth: 'authenticated', status: 'running', runId: 'run_abc12345', sessionId: 'sess_abc12345',
      events: [
        { seq: 1, kind: 'text', text: '已读取清单' },
        toolEvent(2, { status: 'pending', isError: false }),
        toolEvent(3, { toolCallId: 'call_2', title: '写入报告', toolKind: 'write', status: 'failed', isError: true }),
      ],
    });
    expect(html).toContain('已读取清单');
    expect(html).toContain('读取清单');
    expect(html).toContain('read');
    expect(html).toContain('pending');
    expect(html).toContain('写入报告');
    expect(html).toContain('write');
    expect(html).toContain('failed');
    expect(html).toContain('data-event-seq="2"');
    expect(html).toContain('data-event-seq="3"');
    // B2：不承诺也不渲染入参/结果摘要（事件体里没有这些字段）
    expect(html).not.toContain('入参');
    expect(html).not.toContain('结果摘要');
    expect(html).not.toContain('参数摘要');
  });

  it('运行中显示「运行中」与取消按钮；cancelPending 时取消按钮 disabled', () => {
    const html = render({ auth: 'authenticated', status: 'running', runId: 'run_abc12345', sessionId: 'sess_abc12345' });
    expect(html).toContain('运行中');
    expect(html).toContain('id="dsh-run-cancel"');
    expect(buttonTag(html, 'dsh-run-cancel')).not.toContain('disabled');
    expect(buttonTag(render({ auth: 'authenticated', status: 'running', cancelPending: true }), 'dsh-run-cancel')).toContain('disabled');
  });

  it('有 sessionId 时可见关闭按钮；关闭成功后显示「会话已关闭」', () => {
    const open = render({ auth: 'authenticated', status: 'running', sessionId: 'sess_abc12345' });
    expect(open).toContain('id="dsh-run-close"');
    const closed = render({ auth: 'authenticated', status: 'done', sessionId: 'sess_abc12345', sessionClosed: true });
    expect(closed).toContain('会话已关闭');
    expect(closed).not.toContain('id="dsh-run-close"');
  });
});

describe('#1429 DshRunPanel 失败可见（无空成功）', () => {
  it.each([
    { httpStatus: 401, status: 'expired' as const, expected: '请重新登录' },
    { httpStatus: 403, status: 'failed' as const, expected: '无权访问' },
    { httpStatus: 404, status: 'failed' as const, expected: '运行不存在' },
    { httpStatus: 409, status: 'failed' as const, expected: '状态冲突' },
    { httpStatus: 500, status: 'failed' as const, expected: '服务端错误' },
    { httpStatus: null, status: 'failed' as const, expected: '网络或服务异常' },
  ])('HTTP $httpStatus ⇒ $expected（状态 $status）', ({ httpStatus, status, expected }) => {
    const html = render({
      auth: status === 'expired' ? 'expired' : 'authenticated',
      status,
      error: { httpStatus, code: 'RUN_ERROR', phase: 'run', retryable: false, message: '服务端说明', canReconnect: false },
    });
    expect(html).toContain(expected);
    expect(html).toContain('服务端说明');
    expect(html).not.toContain('运行完成');
  });

  it('断流：显示「连接中断，可重连」＋重连按钮，绝不显示完成', () => {
    const html = render({
      auth: 'authenticated', status: 'failed',
      error: { httpStatus: null, code: 'STREAM_INTERRUPTED', phase: 'stream', retryable: true, message: '连接中断，可重连', canReconnect: true },
    });
    expect(html).toContain('连接中断');
    expect(html).toContain('id="dsh-run-reconnect"');
    expect(html).not.toContain('运行完成');
    expect(html).not.toContain('无结果');
  });

  it('空成功（done 且 empty）：显示「无结果」，不显示「运行完成」', () => {
    const html = render({ auth: 'authenticated', status: 'done', empty: true });
    expect(html).toContain('无结果');
    expect(html).not.toContain('运行完成');
  });

  it('正常完成：显示「运行完成」；取消：显示「已取消」且不显示完成', () => {
    expect(render({ auth: 'authenticated', status: 'done', empty: false })).toContain('运行完成');
    const cancelled = render({ auth: 'authenticated', status: 'cancelled' });
    expect(cancelled).toContain('已取消');
    expect(cancelled).not.toContain('运行完成');
  });
});
