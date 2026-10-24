/**
 * l1-interaction/web-adapter.ts — Web ViewAdapter 实现 (Slice C / D590 复活接线)
 *
 * 通过 SSE 响应流与浏览器/桌面端通信。每个 ViewAdapter 方法对应一个 SSE 帧；
 * 帧载荷为自描述对象 `{type, ...}`（桌面端 sse-contract.applySSEEvent 直接可解，
 * 命名对齐 D527 SSEEventType）。帧语义借鉴 dsh-api-gateway open/item/end/error
 * + 心跳范式（零 import，G1 零依赖红线）。
 *
 * 契约（铁律 47）:
 *   @input    — express Response（SSE 目标流）；本类持有具体连接，路由每请求 new 一个
 *   @output   — SSE 帧 `event: <type>\ndata: {json}\n\n` + `: ping` 心跳注释帧（15s，
 *               close/end 后清除）
 *   @degraded — 客户端断开（res close）→ 置 closed 停写 + 停心跳 + abort 在途 signal +
 *               触发 onClosed 钩子；#915 Q-5 中断锚口径：断线 ⇒ 取消在途（signal abort），
 *               轮次 settle 时把「已生成前缀＋取消标记」落库（不变量『已见前缀 ⊆ 落库内容』保持，
 *               规格 §4.3）；写入异常仅 log 不抛（引擎流式管线不应因下游断开而崩溃，铁律 24 显式留痕）
 *
 * @since 0.2.0
 */
import type { ViewAdapter } from './types';
import type { Response } from 'express';
import type { DiagnosisEvent } from '../l2-interfaces/diagnosis-engine';
import { createLogger } from '@synova/logger';

const log = createLogger('l1/web-adapter');

/** 心跳注释帧间隔——本机单机无代理场景取 15s（dsh-api-gateway 用 2s 是多跳代理场景） */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** SSE 协议帧载荷（type 自描述；sendFrame 按 payload.type 写 event 行） */
export type SseFramePayload = { type: string } & Record<string, unknown>;

export class WebViewAdapter implements ViewAdapter {
  private res: Response;
  /** 断线/关闭后置 true——停写停心跳（写前检查，防止向已销毁 socket 写入） */
  private closed = false;
  private onClosedCallback: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /**
   * #915 Q-5: 断线 ⇒ 取消在途（signal abort('CLIENT_DISCONNECTED')）。
   * 路由经 get signal() 取消信号传给 processMessageStream —— 在途工具/LLM 收到取消后
   * 以「已生成前缀＋取消标记」settle（中断锚不变量不破，规格 §4.3）。
   */
  private readonly abortController = new AbortController();

  constructor(res: Response) {
    this.res = res;
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 心跳注释帧——防代理/负载均衡空闲断连（": " 开头为 SSE 注释，客户端忽略）
    this.heartbeat = setInterval(() => this.writeRaw(': ping\n\n'), HEARTBEAT_INTERVAL_MS);

    // 断线感知——路由经 setOnClosed 注册后续动作；#915 Q-5：同时 abort 在途 signal
    // （断线 ⇒ 取消在途，轮次以「已生成前缀＋取消标记」settle 后仍落库，⑩ 时序不变）
    res.on('close', () => {
      const wasClosed = this.closed;
      this.closed = true;
      this.clearHeartbeat();
      if (!this.abortController.signal.aborted) {
        this.abortController.abort(new Error('CLIENT_DISCONNECTED'));
      }
      if (!wasClosed) {
        log.debug('SSE 连接关闭 — 停写停心跳，abort 在途轮次（signal）');
        this.onClosedCallback?.();
      }
    });
    // 流错误不冒泡为 uncaughtException（半截写入等瞬态，铁律 24：显式记录不空吞）
    res.on('error', (err: Error) => {
      log.debug({ err }, 'SSE 流错误 — 客户端侧连接异常');
    });
  }

  /** 注册断线回调（路由用于感知客户端断开；close 后不再触发） */
  setOnClosed(fn: () => void): void {
    this.onClosedCallback = fn;
  }

  /**
   * #915 Q-5: 断线取消信号（只读访问器）——未断线 aborted=false；断线 ⇒ aborted=true 且
   * reason.message='CLIENT_DISCONNECTED'（S10）。路由把它传给 processMessageStream 第三参。
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private writeRaw(chunk: string): void {
    if (this.closed) return; // 断线停写（中断锚语义：在途轮次由路由继续 settle 落库）
    try {
      this.res.write(chunk);
    } catch (err) {
      log.debug({ err }, 'Web 适配器 SSE 写入失败 — 客户端断开');
    }
  }

  /** 通用协议帧写出（路由侧使用：open/complete/error/end 等；按 payload.type 写 event 行） */
  sendFrame(payload: SseFramePayload): void {
    this.writeRaw(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  /** 诊断事件 flat 透传（引擎 DiagnosisEvent 原样入流——桌面 sse-contract 既有类型零改动可解） */
  emitDiagnosisEvent(evt: DiagnosisEvent): void {
    // spread 出新字面量（interface 无隐式索引签名，直接传参会卡 Record<string, unknown>——零 as 断言写法）
    this.sendFrame({ ...evt, type: evt.type });
  }

  // ── ViewAdapter 七方法（帧载荷一律对象帧）──

  showAgentMessage(text: string): void {
    this.sendFrame({ type: 'agent_message', content: text });
  }

  showUserMessage(text: string): void {
    this.sendFrame({ type: 'user_message', content: text });
  }

  appendToken(token: string): void {
    this.sendFrame({ type: 'token', text: token });
  }

  showSystemMessage(text: string): void {
    this.sendFrame({ type: 'system_message', message: text });
  }

  showError(text: string): void {
    this.sendFrame({ type: 'error', code: 'ENGINE_ERROR', message: text });
  }

  setStatus(text: string): void {
    this.sendFrame({ type: 'status', message: text });
  }

  render(): void {
    // Web SSE — no explicit render needed, each event is flushed immediately
  }

  /** Close the SSE connection（终帧由路由发送；本方法只负责 end + 停心跳） */
  close(): void {
    this.clearHeartbeat();
    if (this.closed) return;
    this.closed = true;
    try {
      this.res.end();
    } catch (err) {
      log.warn({ err }, 'SSE 连接关闭失败 — already closed');
    }
  }
}
