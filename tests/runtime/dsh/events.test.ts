/**
 * tests/runtime/dsh/events.test.ts — 1A AgentEvent 流与 SSE 帧单测。
 *
 * 配对对象：src/runtime/dsh/events.ts
 * 覆盖：seq 单调、订阅/退订、终态识别、快照、SSE 帧格式与可解析性、内容指纹。
 */
import { describe, expect, it } from 'vitest';
import {
  AgentEventStream,
  contentDigest,
  formatSseFrame,
  formatSseHeartbeat,
  isTerminalEvent,
  type AgentEvent,
} from '../../../src/runtime/dsh/events';

function collect(stream: AgentEventStream): AgentEvent[] {
  const seen: AgentEvent[] = [];
  stream.subscribe(event => seen.push(event));
  return seen;
}

describe('events: AgentEventStream', () => {
  it('append：seq 单调、runId/type/data/at 结构稳定', () => {
    const stream = new AgentEventStream('run_events_0001');
    const first = stream.append('run.started', { runId: 'run_events_0001' });
    const second = stream.append('text.delta', { text: 'hi' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.runId).toBe('run_events_0001');
    expect(second.runId).toBe('run_events_0001');
    expect(second.type).toBe('text.delta');
    expect(second.data).toEqual({ text: 'hi' });
    expect(typeof second.at).toBe('string');
    expect(Number.isNaN(Date.parse(second.at))).toBe(false);
    expect(stream.size).toBe(2);
  });

  it('subscribe/unsubscribe：订阅者按序收到，退订后不再收到', () => {
    const stream = new AgentEventStream('run_events_0002');
    const received: string[] = [];
    const unsubscribe = stream.subscribe(event => received.push(event.type));
    stream.append('run.started');
    stream.append('text.delta');
    unsubscribe();
    stream.append('run.completed', { empty: false });

    expect(received).toEqual(['run.started', 'text.delta']);
    expect(stream.snapshot().map(event => event.type)).toEqual(['run.started', 'text.delta', 'run.completed']);
  });

  it('terminal：只认 run.completed/run.failed/run.cancelled 终态事件', () => {
    const stream = new AgentEventStream('run_events_0003');
    stream.append('run.started');
    expect(stream.terminal).toBeNull();
    stream.append('text.delta', { text: 'x' });
    expect(stream.terminal).toBeNull();
    const failed = stream.append('run.failed', { code: 'RUN_TIMEOUT' });
    expect(stream.terminal).toBe(failed);
    expect(isTerminalEvent(failed)).toBe(true);
    expect(isTerminalEvent(stream.snapshot()[0])).toBe(false);
  });

  it('快照是副本：外部修改不影响后续 append 的 seq', () => {
    const stream = new AgentEventStream('run_events_0004');
    stream.append('run.started');
    const snapshot = stream.snapshot();
    snapshot.push({ seq: 99, runId: 'x', type: 'text.delta', at: 'x', data: {} });
    expect(stream.size).toBe(1);
    expect(stream.append('text.delta').seq).toBe(2);
  });
});

describe('events: SSE 序列化与指纹', () => {
  it('formatSseFrame：id/event/data 三行且 data 可回解为原事件', () => {
    const event: AgentEvent = {
      seq: 7,
      runId: 'run_events_0005',
      type: 'text.delta',
      at: '2026-11-15T00:00:00.000Z',
      data: { text: 'hello' },
    };
    const frame = formatSseFrame(event);
    expect(frame.startsWith('id: 7\n')).toBe(true);
    expect(frame).toContain('event: text.delta\n');
    expect(frame.endsWith('\n\n')).toBe(true);

    const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse((dataLine ?? '').slice('data: '.length)) as AgentEvent;
    expect(parsed).toEqual(event);
  });

  it('formatSseHeartbeat 是注释帧（客户端可忽略）', () => {
    const heartbeat = formatSseHeartbeat();
    expect(heartbeat.startsWith(': heartbeat ')).toBe(true);
    expect(heartbeat.endsWith('\n\n')).toBe(true);
  });

  it('contentDigest：sha256 与字符数稳定且不含原文', () => {
    const digest = contentDigest('abc');
    expect(digest.chars).toBe(3);
    expect(digest.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(JSON.stringify(digest)).not.toContain('abc');
    expect(contentDigest('').sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
