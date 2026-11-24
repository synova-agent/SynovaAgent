/**
 * src/runtime/dsh/events.ts — 1A 的 `AgentEvent` 与 SSE 序列化（**不承载领域权威**）。
 *
 * 边界：事件只是「这一轮运行发生了什么」的可观察记录（模型流、工具调用、终态、
 * 外发回执）。它不是事实账本、不是权限决定、不是经营决策——那些留在 Synova 领域层。
 *
 * 契约（铁律 47）:
 *   @input   runId ＋ 事件类型 ＋ data
 *   @output  AgentEvent {seq, runId, type, at, data}；SSE 帧（event + data + id）
 *   @degraded 无：事件追加失败只可能来自内存/写入异常，由调用方抛 typed error
 */
import { createHash } from 'node:crypto';
import { systemClock } from '../../services/clock';

/** 1A 覆盖的事件类型（DEV DOC §3.1／§7.1 的固定词汇）。 */
export type AgentEventType =
  | 'run.started'
  | 'session.created'
  | 'session.resumed'
  | 'text.delta'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.finished'
  | 'egress.recorded'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  /** #1459 T-C：服务端把模型文本校验成结构化瓶颈假设后发出（合格）。 */
  | 'hypothesis.structured'
  /** #1459 T-C：假设不合格（不可解析/缺字段/类型错），带机器可读原因。 */
  | 'hypothesis.invalid';

/** 终态事件：SSE 收到任意一个即结束本次流。 */
const TERMINAL_EVENT_TYPES: readonly AgentEventType[] = ['run.completed', 'run.failed', 'run.cancelled'];

/** 单条事件。seq 单调递增（同 runId 内），供 SSE `id:` 与断线重放定位。 */
export interface AgentEvent {
  seq: number;
  runId: string;
  type: AgentEventType;
  at: string;
  data: Record<string, unknown>;
}

/** 是否是终态事件。 */
export function isTerminalEvent(event: AgentEvent): boolean {
  return TERMINAL_EVENT_TYPES.includes(event.type);
}

/** 计算外发内容指纹（只记 hash 与长度，不落原文）。 */
export function contentDigest(text: string): { sha256: string; chars: number } {
  return { sha256: createHash('sha256').update(text, 'utf8').digest('hex'), chars: text.length };
}

/** 事件流：按 runId 追加、重放、订阅。内存实现（1A 明确不建第二套持久账本）。 */
export class AgentEventStream {
  private readonly events: AgentEvent[] = [];
  private readonly subscribers = new Set<(event: AgentEvent) => void>();
  private readonly runId: string;
  private seq = 0;

  constructor(runId: string) {
    this.runId = runId;
  }

  /** 追加一条事件并广播给订阅者。 */
  append(type: AgentEventType, data: Record<string, unknown> = {}): AgentEvent {
    this.seq += 1;
    const event: AgentEvent = { seq: this.seq, runId: this.runId, type, at: systemClock.nowIso(), data };
    this.events.push(event);
    for (const subscriber of this.subscribers) subscriber(event);
    return event;
  }

  /** 已发生事件快照（SSE 重放用）。 */
  snapshot(): AgentEvent[] {
    return [...this.events];
  }

  /** 订阅后续事件；返回取消订阅函数。 */
  subscribe(handler: (event: AgentEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  /** 是否已有终态事件。 */
  get terminal(): AgentEvent | null {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (isTerminalEvent(this.events[index])) return this.events[index];
    }
    return null;
  }

  /** 事件计数（防「零对象成功」：终态必须能报出至少一条事件）。 */
  get size(): number {
    return this.events.length;
  }
}

/** SSE 帧（`event:` 用稳定类型名，`data:` 是完整事件 JSON）。 */
export function formatSseFrame(event: AgentEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** SSE 心跳帧（注释行，客户端忽略、防代理超时）。 */
export function formatSseHeartbeat(): string {
  return `: heartbeat ${systemClock.nowIso()}\n\n`;
}
