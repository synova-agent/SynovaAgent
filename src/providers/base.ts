/**
 * providers/base.ts — LLM Provider 基类 (P3: OpenAI-compatible 模板去重)
 *
 * 封装三个 Provider (deepseek/openai/gateway) 的 82 行重复代码:
 *   - HTTP POST 请求构建 (块 B)
 *   - SSE 流式读取器 (块 A)
 *   - 健康检查 (块 C)
 *   - 非 OK 错误处理 (块 D)
 *
 * 子类只需提供: name, baseUrl, model, apiKey, auth headers, 差异化逻辑。
 */

import type {
  LLMProvider, LLMMessage, ChatOptions, ChatResult,
  StreamCallback, HealthCheckResult, ProviderConfig, ChatCompletionResponse,
} from './types';
import { CircuitBreaker } from '../llm/circuit-breaker';
import { createLogger } from '@synova/logger';
import { PromptInjectionDetector, PolicyDeniedError } from '../security/prompt-injection-detector';
import { AuditService } from '../services/audit-service';
import {
  ClassifiedLlmError, ErrorCode, isRetryable,
  normalizeLlmFailure, isContextWindowExceededError, isQuotaExceededError,
} from '../errors/types';

const log = createLogger('providers/base');

/**
 * DSH B-01: adapter 最终 throw 边界 — 归一化 + 合一 detail 分类（真实路由接线）。
 * 任意 throw → normalizeLlmFailure（冻结 {message, code}，敌意值不逃逸）→
 * provider code+type+message 合一 detail 正则分类 → canonical 稳定码
 * （CONTEXT_OVERFLOW ≈ DSH CONTEXT_WINDOW_EXCEEDED；BILLING_EXCEEDED ≈ DSH QUOTA）。
 * 已分类错误（onError 产物）与安全错误原样透传（capability seam，ClassifiedLlmError
 * 既有消费方接口不变）。原始 throw 保留在 .cause 上。
 */
function finalizeAdapterFailure(err: unknown, provider: string, context: string): Error {
  if (err instanceof ClassifiedLlmError) return err;
  if (err instanceof PolicyDeniedError) return err;
  const failure = normalizeLlmFailure(err);
  const errType = err instanceof Error ? err.name : '';
  const detail = [failure.code, errType, failure.message].filter(Boolean).join(' ');
  const message = `${provider} ${context}: ${failure.message}`;
  if (isContextWindowExceededError(detail)) {
    return new ClassifiedLlmError({
      code: ErrorCode.CONTEXT_OVERFLOW, message, phase: 0,
      retryable: isRetryable(ErrorCode.CONTEXT_OVERFLOW), shouldCompress: true,
      cause: err, provider,
    });
  }
  if (isQuotaExceededError(detail)) {
    return new ClassifiedLlmError({
      code: ErrorCode.BILLING_EXCEEDED, message, phase: 0, retryable: false,
      shouldRotateCredential: true, shouldFallback: true,
      cause: err, provider,
    });
  }
  // 未知失败: Hermes Stage 8 语义 — unknown 默认可重试
  return new ClassifiedLlmError({
    code: ErrorCode.INTERNAL, message, phase: 0, retryable: true,
    cause: err, provider,
  });
}

/** D43: 在 LLM 调用前检查用户消息是否包含提示注入攻击 */
function checkPromptInjection(messages: LLMMessage[]): void {
  if (!messages || messages.length === 0) return;
  const detector = new PromptInjectionDetector();
  for (const msg of messages) {
    if (!msg.content) continue;
    const result = detector.detect(msg.content);
    if (result.injectionDetected) {
      log.warn({ patterns: result.patterns, severity: result.severity }, '检测到提示注入攻击 — 拒绝请求');
      AuditService.log({
        orgId: 'system',
        actorId: 'prompt_injection_detector',
        actorRole: 'system',
        action: 'prompt_injection_blocked',
        targetType: 'llm_request',
        targetId: `msg_${Date.now()}`,
        newValue: JSON.stringify({ patterns: result.patterns, severity: result.severity }),
      });
      throw new PolicyDeniedError({ reason: `Prompt injection detected: ${result.patterns.join(', ')}` });
    }
  }
}

// ═══ 子类需实现的配置接口 ═══

export interface ProviderAdapterConfig {
  name: string;
  baseUrl: string;
  model: string;
  /** API Key (gateway 可留空) */
  apiKey?: string;
  /** 额外请求头 (如 Authorization) */
  getHeaders(): Record<string, string>;
  /** Chat endpoint 路径 (默认 /chat/completions) */
  chatPath?: string;
  /** Models endpoint 路径 (默认 /models) */
  modelsPath?: string;
  /** 健康检查超时 ms (默认 10000) */
  healthTimeoutMs?: number;
  /** 流式消息发送前钩子 (如 sanitizeMessages) */
  beforeSend?(messages: LLMMessage[]): LLMMessage[];
  /** 响应后处理钩子 (如丰富 usage 信息) */
  afterResponse?(data: ChatCompletionResponse, opts?: ChatOptions): Partial<ChatResult>;
  /** 错误处理钩子 (如 ClassifiedLlmError 包装) */
  onError?(err: Error, context: string): Error;
}

// ═══ 共享工厂 — 创建完整 LLMProvider ═══

export function createOpenAICompatibleProvider(cfg: ProviderAdapterConfig): LLMProvider {
  const baseUrl = cfg.baseUrl;
  const model = cfg.model;
  const chatPath = cfg.chatPath ?? '/chat/completions';
  const modelsPath = cfg.modelsPath ?? '/models';
  const healthTimeout = cfg.healthTimeoutMs ?? 10_000;

  // 熔断器实例 — D5: 统一LLM调用保护 (threshold=5, cooldown=30s)
  const breaker = new CircuitBreaker({ threshold: 5, cooldownMs: 30_000 });

  /** D819: 上游未给 tool_call_id 时的确定性兜底序号（provider 实例内单调；禁随机 UUID） */
  let fallbackToolCallSeq = 0;

  /** 共享 HTTP POST 请求 — 消除 24 行重复 (块 B) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function makeRequest(messages: LLMMessage[] | LLMMessage[], opts?: ChatOptions, stream = false) {
    if (breaker.isOpen()) {
      throw new Error(`${cfg.name} CircuitBreaker OPEN — too many failures`);
    }
    if (cfg.apiKey !== undefined && !cfg.apiKey) {
      // DSH B-01: INVALID_CREDENTIAL 分类走 adapter 侧（api-key 路径）—
      // 供了但不可用的凭据（空值）: 修正存储值而非补供；永不重试，轮换+回退
      throw new ClassifiedLlmError({
        code: ErrorCode.AUTH_FAILED,
        message: `${cfg.name} API Key 未配置（INVALID_CREDENTIAL 语义 — 修正存储值而非补供）`,
        phase: 0, retryable: false,
        shouldRotateCredential: true, shouldFallback: true,
      });
    }
    const body: Record<string, unknown> = {
      model: opts?.model || model,
      messages: cfg.beforeSend ? cfg.beforeSend(messages) : messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4000,
    };
    if (opts?.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
    if (stream) body.stream = true;
    // D819: tools schema 进请求体（工具循环的生产接收入口 —— 此前在 provider 边界被丢弃）。
    // 空数组/未传 → 不写字段（与旧行为一致，provider 契约语义不变）。
    if (opts?.tools && opts.tools.length > 0) body.tools = opts.tools;

    return fetch(`${baseUrl}${chatPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cfg.getHeaders() },
      body: JSON.stringify(body),
      signal: opts?.signal ?? AbortSignal.timeout(120_000),
    });
  }

  /** 共享非 OK 错误处理 — 消除 12 行重复 (块 D) */
  async function checkResponse(res: Response, context: string): Promise<void> {
    if (res.ok) return;
    const t = await res.text().catch(() => '');
    const err = new Error(`${cfg.name} ${context} (${res.status}): ${t.slice(0, 300)}`);
    throw cfg.onError ? cfg.onError(err, context) : err;
  }

  /** 共享 SSE 流式读取器 — 消除 54 行重复 (块 A) */
  async function handleStream(res: Response, cb: StreamCallback, usedModel: string): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim();
          if (d === '[DONE]') continue;
          try {
            const c = JSON.parse(d);
            const tok = c?.choices?.[0]?.delta?.content;
            if (tok) { full += tok; cb.onToken(tok); }
          } catch { console.debug('SSE chunk parse — benign, high volume'); }
        }
      }
    } finally { reader.releaseLock(); }
    cb.onComplete?.({ content: full, model: usedModel });
  }

  /** 共享健康检查 — 消除 33 行重复 (块 C) */
  async function healthCheck(): Promise<HealthCheckResult> {
    if (cfg.apiKey !== undefined && !cfg.apiKey) {
      return { healthy: false, error: 'API Key 未配置' };
    }
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}${modelsPath}`, {
        headers: cfg.getHeaders(),
        signal: AbortSignal.timeout(healthTimeout),
      });
      const lat = Date.now() - start;
      if (res.ok) return { healthy: true, latencyMs: lat };
      return { healthy: false, error: `${cfg.name} 返回 ${res.status}`, latencyMs: lat };
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "网络请求失败");
      const msg = err instanceof Error ? err.message : String(err);
      return { healthy: false, error: `${cfg.name}: ${msg}`, latencyMs: Date.now() - start };
    }
  }

  return {
    name: cfg.name,
    baseUrl,

    async chat(messages, opts) {
      checkPromptInjection(messages); // D43: 提示注入检测 — 在 sanitize 前对原始消息检测
      try {
        const msgs = cfg.beforeSend ? cfg.beforeSend(messages) : messages;
        const res = await makeRequest(msgs, opts);
        await checkResponse(res, 'API 错误');
        const data = await res.json() as ChatCompletionResponse;
        const message = data?.choices?.[0]?.message;
        const content = message?.content ?? '';
        // D819 (D817-F1): 响应侧 tool_calls → ChatResult.toolCalls 映射。
        // 此前只取 content → toolCalls 恒 undefined → 工具循环在真实 provider 路径永不触发。
        const rawToolCalls = message?.tool_calls;
        let synthesizedIds = 0;
        const toolCalls = rawToolCalls && rawToolCalls.length > 0
          ? rawToolCalls.map((tc) => {
              let id = typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : '';
              if (id.length === 0) {
                // 非规范上游缺 id → 确定性兜底（禁随机 UUID）；配对仍合法，显式降级不留痕静默
                synthesizedIds += 1;
                fallbackToolCallSeq += 1;
                id = `call_resp_${fallbackToolCallSeq}`;
              }
              return {
                id,
                type: 'function' as const,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              };
            })
          : undefined;
        if (synthesizedIds > 0) {
          log.warn(
            { provider: cfg.name, synthesized: synthesizedIds, degraded: true },
            '上游 tool_calls 缺 id — 确定性兜底 id（配对仍合法；来源层需修）',
          );
        }
        if (content.length === 0 && !toolCalls) {
          // DSH B-01 assembler 侧分类: 正常完成但零内容 → EMPTY_RESPONSE
          // （产物为零，重试策略视为可安全重复）
          throw new ClassifiedLlmError({
            code: ErrorCode.EMPTY_RESPONSE,
            message: `${cfg.name} 返回缺少 content 且无 tool_calls（退化空响应 EMPTY_RESPONSE）`,
            phase: 0, retryable: true, shouldFallback: true,
          });
        }
        const extra = cfg.afterResponse ? cfg.afterResponse(data, opts) : {};
        breaker.recordSuccess();
        return { content, model: data.model || model, ...(toolCalls ? { toolCalls } : {}), ...extra };
      } catch (err) {
        breaker.recordFailure();
        throw finalizeAdapterFailure(err, cfg.name, 'chat');
      }
    },

    async stream(messages, cb, opts) {
      try {
        checkPromptInjection(messages); // D43: 提示注入检测 — 在 LLM 调用前对原始消息检测
        const res = await makeRequest(messages, opts, true);
        if (!res.ok) {
          await checkResponse(res, '流式错误').catch((err: Error) => {
            log.warn({ err }, '流式响应错误检查失败 — 转发 onError 回调');
            cb.onError?.(finalizeAdapterFailure(err, cfg.name, '流式错误'));
          });
          breaker.recordFailure();
          return;
        }
        await handleStream(res, cb, opts?.model || model);
        breaker.recordSuccess();
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "提示注入检测");
        const e = err instanceof Error ? err : new Error(String(err));
        cb.onError?.(finalizeAdapterFailure(cfg.onError ? cfg.onError(e, 'stream') : e, cfg.name, 'stream'));
        breaker.recordFailure();
      }
    },

    healthCheck,
    listModels() { return [model]; },
  };
}
