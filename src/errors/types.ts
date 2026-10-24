/**
 * errors/types.ts — 类型化错误 + 分类流水线 + 恢复策略
 *
 * 铁律 32: 每个 catch 块必须返回带 .code 的类型化 Error 子类。
 * 参考 Hermes error_classifier.py: 8 阶段优先级分类流水线 + 模式匹配 + 恢复动作提示。
 *
 * Hermes 关键设计:
 *   - 分类流水线: 提供者特定 → HTTP 状态码 → 错误码 → 消息模式 → SSL → 断连 → 传输 → 兜底
 *   - 恢复动作提示: retryable / shouldCompress / shouldRotateCredential / shouldFallback
 *   - 模式匹配: 30+ 模式库，消息感知区分 billing vs rate_limit vs context_overflow
 *   - Jittered backoff: 去抖退避防止雷群效应
 */
import * as crypto from 'crypto';
import { createLogger } from '@synova/logger';
import { assertNever, DiagnosticAgentError as BaseDiagnosticAgentError } from '@synova/error-types';
const log = createLogger('src.errors.types');

// ═══ Error Codes (Hermes FailoverReason 对齐) ═══

export const ErrorCode = {
  // Transport
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  DNS: 'DNS',

  // Auth (Hermes: auth / auth_permanent)
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_PERMANENT: 'AUTH_PERMANENT',

  // Rate / Billing
  RATE_LIMITED: 'RATE_LIMITED',
  BILLING_EXCEEDED: 'BILLING_EXCEEDED',

  // Server-side
  OVERLOADED: 'OVERLOADED',               // Hermes: 503/529
  SERVER_ERROR: 'SERVER_ERROR',           // Hermes: 500/502
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',

  // Input / Format
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FORMAT_ERROR: 'FORMAT_ERROR',           // Hermes: 400 malformed → 不回退重试

  // Context
  CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW',   // Hermes: context too large → compress
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE', // Hermes: 413 → compress

  // Model / Provider
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  CONTENT_POLICY_BLOCKED: 'CONTENT_POLICY_BLOCKED', // Hermes: safety filter → fallback
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',       // DSH B-01 对齐: 正常完成但零内容 → 产物为零，可安全重试

  // Engine
  ENGINE_UNAVAILABLE: 'ENGINE_UNAVAILABLE',
  ENGINE_TIMEOUT: 'ENGINE_TIMEOUT',
  MODULE_FAILED: 'MODULE_FAILED',

  // Data
  DB_ERROR: 'DB_ERROR',
  CORRUPTED_DATA: 'CORRUPTED_DATA',

  // Catch-all
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ═══ Classified Error (Hermes ClassifiedError dataclass) ═══

/** `ClassifiedLlmError` 的 options 对象构造入参（推荐形式；positional 4 参仍兼容） */
export interface ClassifiedLlmErrorOptions {
  code: ErrorCodeType;
  message: string;
  phase: number;
  retryable: boolean;
  shouldCompress?: boolean;
  shouldRotateCredential?: boolean;
  shouldFallback?: boolean;
  cause?: unknown;
  statusCode?: number;
  provider?: string;
  model?: string;
}

/**
 * 全仓唯一错误层次（`@synova/error-types` 的 `DiagnosticAgentError`）里的 **LLM 专用子类**。
 *
 * 设计哲学：**按 `code` 路由，永不解析 `message`**（DSH `HarnessError` 锚：
 * "route on this, never by parsing message"）—— `message` 只给人读，路由只认稳定码。
 *
 * 与包基类的分工：基类只承载 code/message/phase/retryable ＋ 原生 `cause`；
 * Hermes 恢复动作提示（compress/rotate/fallback）与上游 status/provider/model 留在此子类，
 * 因此搬进 package、合并两套码表另立 A 类卡（#951），本类不搬。
 */
export class ClassifiedLlmError extends BaseDiagnosticAgentError {
  /** 收窄失败码为 `ErrorCodeType`（`declare` 只做类型收窄、不 emit：基类构造已赋值，无需断言转写） */
  declare readonly code: ErrorCodeType;
  /** Hermes: should trigger context compression before retry */
  readonly shouldCompress: boolean;
  /** Hermes: should rotate to next credential in pool */
  readonly shouldRotateCredential: boolean;
  /** Hermes: should fallback to alternative provider/model */
  readonly shouldFallback: boolean;
  readonly statusCode?: number;
  readonly provider?: string;
  readonly model?: string;

  /**
   * options 对象构造（推荐）：失败事实 ＋ 恢复动作提示。
   * @param opts - `opts.cause` 经包基类第 5 参 `ErrorOptions.cause` 原生透传（可链）；
   *   缺省或显式 `undefined` ⇒ `err.cause === undefined`（不伪造）
   */
  constructor(opts: ClassifiedLlmErrorOptions);
  /**
   * positional 4 参构造（向后兼容；无 cause ⇒ `err.cause === undefined`）。
   * @param code - 稳定失败码
   * @param message - 人读消息（禁作路由依据）
   * @param phase - 诊断阶段（0 = 基础设施）
   * @param retryable - 是否可重试
   */
  constructor(code: ErrorCodeType, message: string, phase: number, retryable: boolean);
  constructor(
    codeOrOpts: ErrorCodeType | ClassifiedLlmErrorOptions,
    message?: string, phase?: number, retryable?: boolean,
  ) {
    let code: ErrorCodeType; let msg: string; let ph: number; let retry: boolean;
    let compress = false; let rotate = false; let fallback = false;
    let cause: unknown; let status: number | undefined; let prov: string | undefined; let mod: string | undefined;

    if (typeof codeOrOpts === 'object') {
      code = codeOrOpts.code; msg = codeOrOpts.message; ph = codeOrOpts.phase; retry = codeOrOpts.retryable;
      compress = codeOrOpts.shouldCompress ?? false; rotate = codeOrOpts.shouldRotateCredential ?? false;
      fallback = codeOrOpts.shouldFallback ?? false; cause = codeOrOpts.cause; status = codeOrOpts.statusCode;
      prov = codeOrOpts.provider; mod = codeOrOpts.model;
    } else {
      code = codeOrOpts; msg = message!; ph = phase!; retry = retryable!;
    }

    super(code, msg, ph, retry, { cause });
    this.name = 'ClassifiedLlmError';
    this.shouldCompress = compress; this.shouldRotateCredential = rotate; this.shouldFallback = fallback;
    this.statusCode = status; this.provider = prov; this.model = mod;
  }
}

/**
 * 向后兼容别名 —— 历史消费者仍从本文件 import `DiagnosticAgentError`（tests/agent、tests/errors、
 * tests/llm 三处 ＋ 旧 provider 代码）。别名指向**同一个类**（`ClassifiedLlmError`），
 * **不新增类定义**：全仓该类定义仍唯一（在 `@synova/error-types`）。
 * 保留别名的收益：`instanceof DiagnosticAgentError`（包名）与 `instanceof ClassifiedLlmError`
 * 落在**同一个类**上 —— 这正是本批要修的缺陷（运行时判包类、管线抛本地类，Q-3 的 E2）。
 */
export { ClassifiedLlmError as DiagnosticAgentError };

// ═══ Pattern Banks (Hermes 消息感知模式匹配) ═══

const BILLING_PATTERNS = [
  'insufficient credits', 'insufficient_quota', 'insufficient balance',
  'credit balance', 'credits exhausted', 'credits have been exhausted',
  'no usable credits', 'top up your credits', 'payment required',
  'billing hard limit', 'exceeded your current quota',
  'account is deactivated', 'plan does not include',
  'out of funds', 'run out of funds', 'balance_depleted',
  'model_not_supported_on_free_tier', 'not available on the free tier',
  'key limit exceeded', 'spending limit',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit', 'rate_limit', 'too many requests', 'throttled',
  'requests per minute', 'tokens per minute', 'requests per day',
  'try again in', 'please retry after', 'resource_exhausted',
  'throttlingexception', 'too many concurrent requests',
  'servicequotaexceededexception',
];

const USAGE_LIMIT_PATTERNS = [
  'usage limit', 'quota', 'limit exceeded', 'key limit exceeded',
];

const USAGE_LIMIT_TRANSIENT_SIGNALS = [
  'try again', 'retry', 'resets at', 'reset in', 'wait',
  'requests remaining', 'periodic', 'window',
];

const CONTEXT_OVERFLOW_PATTERNS = [
  'context length', 'context size', 'maximum context', 'token limit',
  'too many tokens', 'reduce the length', 'exceeds the limit',
  'context window', 'prompt is too long', 'prompt exceeds max length',
  'max_tokens', 'maximum number of tokens', 'exceeds the max_model_len',
  'max_model_len', 'prompt length', 'input is too long',
  'maximum model length', 'context length exceeded',
  'slot context', 'n_ctx_slot',
  '超过最大长度', '上下文长度',
  'input is too long', 'max input token', 'input token',
];

const MODEL_NOT_FOUND_PATTERNS = [
  'is not a valid model', 'invalid model', 'model not found',
  'model_not_found', 'does not exist', 'no such model',
  'unknown model', 'unsupported model',
];

const AUTH_PATTERNS = [
  'invalid api key', 'invalid_api_key', 'authentication',
  'unauthorized', 'forbidden', 'invalid token', 'token expired',
  'token revoked', 'access denied',
];

const CONTENT_POLICY_BLOCKED_PATTERNS = [
  'flagged for possible cybersecurity risk',
  'violates our usage policies',
  'violates openai\'s usage policies',
  'your request was flagged by',
  'prompt was flagged by our safety',
  'content_filter',
  'responsibleaipolicyviolation',
];

const TIMEOUT_MESSAGE_PATTERNS = [
  'timed out', 'turn timed out', 'request timed out',
  'deadline exceeded', 'operation timed out', 'upstream timed out',
];

const TRANSPORT_ERROR_TYPES = new Set([
  'ReadTimeout', 'ConnectTimeout', 'PoolTimeout',
  'ConnectError', 'RemoteProtocolError',
  'ConnectionError', 'ConnectionResetError',
  'ConnectionAbortedError', 'BrokenPipeError',
  'TimeoutError', 'ReadError', 'ServerDisconnectedError',
  'SSLError', 'SSLZeroReturnError', 'SSLWantReadError',
  'SSLWantWriteError', 'SSLEOFError', 'SSLSyscallError',
  'APIConnectionError', 'APITimeoutError',
]);

const SERVER_DISCONNECT_PATTERNS = [
  'server disconnected', 'peer closed connection',
  'connection reset by peer', 'connection was closed',
  'network connection lost', 'unexpected eof', 'incomplete chunked read',
];

// ═══ Classification Pipeline (Hermes classify_api_error) ═══

export interface ClassifyInput {
  error: Error;
  provider?: string;
  model?: string;
  approxTokens?: number;
  contextLength?: number;
  numMessages?: number;
}

/**
 * Hermes 8-stage priority classification pipeline.
 *
 * Stage 1: Provider-specific patterns
 * Stage 2: HTTP status code + message-aware refinement
 * Stage 3: Structured error code from body
 * Stage 4: Message pattern matching
 * Stage 5: SSL/TLS transient → timeout
 * Stage 6: Server disconnect + large session → context overflow
 * Stage 7: Transport error heuristics
 * Stage 8: Fallback → unknown (retryable)
 */
export function classifyApiError(input: ClassifyInput): ClassifiedLlmError {
  const { error, provider = '', model = '', approxTokens = 0, contextLength = 200_000, numMessages = 0 } = input;
  const statusCode = extractStatusCode(error);
  const errorType = error.constructor.name;
  const body = extractErrorBody(error);
  const errorCode = extractErrorCode(body);
  const errorMsg = buildErrorMessage(error, body);
  const providerLower = provider.toLowerCase();

  const diag = (code: ErrorCodeType, overrides: Partial<{
    retryable: boolean; shouldCompress: boolean;
    shouldRotateCredential: boolean; shouldFallback: boolean;
    message: string;
  }> = {}) => new ClassifiedLlmError({
    code, phase: 0,
    message: overrides.message || errorMsg || error.message,
    retryable: overrides.retryable ?? true,
    shouldCompress: overrides.shouldCompress ?? false,
    shouldRotateCredential: overrides.shouldRotateCredential ?? false,
    shouldFallback: overrides.shouldFallback ?? false,
    cause: error, statusCode, provider, model,
  });

  // ── Stage 1: Content policy block (before status check) ──
  if (matchAny(errorMsg, CONTENT_POLICY_BLOCKED_PATTERNS)) {
    return diag(ErrorCode.CONTENT_POLICY_BLOCKED, { retryable: false, shouldFallback: true });
  }

  // ── Stage 2: HTTP status code + message-aware refinement ──
  if (statusCode != null) {
    const classified = classifyByStatus(statusCode, errorMsg, errorCode, approxTokens, contextLength, numMessages, diag);
    if (classified) return classified;
  }

  // ── Stage 3: Structured error code ──
  if (errorCode) {
    const classified = classifyByErrorCode(errorCode, diag);
    if (classified) return classified;
  }

  // ── Stage 4: Message pattern matching ──
  const classified = classifyByMessage(errorMsg, errorType, approxTokens, contextLength, diag);
  if (classified) return classified;

  // ── Stage 5: SSL/TLS transient → timeout ──
  if (matchAny(errorMsg, ['bad record mac', 'ssl alert', 'tls alert', 'ssl handshake failure',
    'bad_record_mac', 'ssl_alert', 'tls_alert', '[ssl:'])) {
    return diag(ErrorCode.TIMEOUT);
  }

  // ── Stage 6: Server disconnect + large session → context overflow ──
  const isDisconnect = matchAny(errorMsg, SERVER_DISCONNECT_PATTERNS);
  if (isDisconnect && !statusCode) {
    const isLarge = approxTokens > contextLength * 0.6
      || (contextLength <= 256_000 && (approxTokens > 120_000 || numMessages > 200));
    if (isLarge) return diag(ErrorCode.CONTEXT_OVERFLOW, { shouldCompress: true });
    return diag(ErrorCode.TIMEOUT);
  }

  // ── Stage 7: Transport heuristics ──
  if (TRANSPORT_ERROR_TYPES.has(errorType) || error instanceof Error && error.name === 'TimeoutError' ||
      (typeof error === 'object' && error !== null &&
       (error instanceof TypeError || /connect|timeout/i.test(String(error))))) {
    return diag(ErrorCode.TIMEOUT);
  }

  // ── Stage 8: Unknown ──
  return diag(ErrorCode.INTERNAL);
}

// ── Status code classification (Hermes _classify_by_status) ──

function classifyByStatus(
  statusCode: number, errorMsg: string, errorCode: string,
  approxTokens: number, contextLength: number, numMessages: number,
  diag: (code: ErrorCodeType, o?: Partial<{ retryable: boolean; shouldCompress: boolean; shouldRotateCredential: boolean; shouldFallback: boolean; message: string }>) => ClassifiedLlmError,
): ClassifiedLlmError | null {
  if (statusCode === 401) {
    return diag(ErrorCode.AUTH_FAILED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
  }
  if (statusCode === 403) {
    if (matchAny(errorMsg, BILLING_PATTERNS)) {
      return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    }
    return diag(ErrorCode.AUTH_FAILED, { retryable: false, shouldFallback: true });
  }
  if (statusCode === 402) {
    const r402 = _classify402(errorMsg); return diag(r402.code, { retryable: r402.retryable, shouldRotateCredential: r402.shouldRotateCredential, shouldFallback: r402.shouldFallback });
  }
  if (statusCode === 429) {
    return diag(ErrorCode.RATE_LIMITED, { shouldRotateCredential: true, shouldFallback: true });
  }
  if (statusCode === 413) {
    return diag(ErrorCode.PAYLOAD_TOO_LARGE, { shouldCompress: true });
  }
  if (statusCode === 404) {
    if (matchAny(errorMsg, BILLING_PATTERNS)) {
      return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    }
    if (matchAny(errorMsg, MODEL_NOT_FOUND_PATTERNS)) {
      return diag(ErrorCode.MODEL_NOT_FOUND, { retryable: false, shouldFallback: true });
    }
    return diag(ErrorCode.INTERNAL);
  }
  if (statusCode === 400) {
    if (matchAny(errorMsg, CONTEXT_OVERFLOW_PATTERNS)) {
      return diag(ErrorCode.CONTEXT_OVERFLOW, { shouldCompress: true });
    }
    if (matchAny(errorMsg, MODEL_NOT_FOUND_PATTERNS)) {
      return diag(ErrorCode.MODEL_NOT_FOUND, { retryable: false, shouldFallback: true });
    }
    if (matchAny(errorMsg, RATE_LIMIT_PATTERNS)) {
      return diag(ErrorCode.RATE_LIMITED, { shouldRotateCredential: true, shouldFallback: true });
    }
    if (matchAny(errorMsg, BILLING_PATTERNS)) {
      return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    }
    // Generic 400 + large session → probable context overflow
    const isLarge = approxTokens > contextLength * 0.4
      || (contextLength <= 256_000 && (approxTokens > 80_000 || numMessages > 80));
    if (isLarge && errorMsg.length < 50) {
      return diag(ErrorCode.CONTEXT_OVERFLOW, { shouldCompress: true });
    }
    return diag(ErrorCode.FORMAT_ERROR, { retryable: false, shouldFallback: true });
  }
  if (statusCode === 500 || statusCode === 502) {
    return diag(ErrorCode.SERVER_ERROR);
  }
  if (statusCode === 503 || statusCode === 529) {
    return diag(ErrorCode.OVERLOADED);
  }
  // Other 4xx
  if (statusCode >= 400 && statusCode < 500) {
    return diag(ErrorCode.FORMAT_ERROR, { retryable: false, shouldFallback: true });
  }
  // Other 5xx
  if (statusCode >= 500 && statusCode < 600) {
    return diag(ErrorCode.SERVER_ERROR);
  }
  return null;
}

// ── 402 disambiguation (Hermes _classify_402) ──

function _classify402(errorMsg: string): { code: ErrorCodeType; retryable: boolean; shouldRotateCredential: boolean; shouldFallback: boolean } {
  const hasUsageLimit = matchAny(errorMsg, USAGE_LIMIT_PATTERNS);
  const hasTransient = matchAny(errorMsg, USAGE_LIMIT_TRANSIENT_SIGNALS);
  if (hasUsageLimit && hasTransient) {
    return { code: ErrorCode.RATE_LIMITED, retryable: true, shouldRotateCredential: true, shouldFallback: true };
  }
  return { code: ErrorCode.BILLING_EXCEEDED, retryable: false, shouldRotateCredential: true, shouldFallback: true };
}

// ── Error code classification (Hermes _classify_by_error_code) ──

function classifyByErrorCode(
  errorCode: string,
  diag: (c: ErrorCodeType, o?: any) => ClassifiedLlmError,
): ClassifiedLlmError | null {
  const c = errorCode.toLowerCase();
  if (['resource_exhausted', 'throttled', 'rate_limit_exceeded'].includes(c)) {
    return diag(ErrorCode.RATE_LIMITED, { shouldRotateCredential: true });
  }
  if (['insufficient_quota', 'billing_not_active', 'payment_required', 'insufficient_credits', 'no_usable_credits', 'balance_depleted'].includes(c)) {
    return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
  }
  if (['model_not_found', 'model_not_available', 'invalid_model'].includes(c)) {
    return diag(ErrorCode.MODEL_NOT_FOUND, { retryable: false, shouldFallback: true });
  }
  if (['context_length_exceeded', 'max_tokens_exceeded'].includes(c)) {
    return diag(ErrorCode.CONTEXT_OVERFLOW, { shouldCompress: true });
  }
  return null;
}

// ── Message pattern classification (Hermes _classify_by_message) ──

function classifyByMessage(
  errorMsg: string, errorType: string,
  approxTokens: number, contextLength: number,
  diag: (c: ErrorCodeType, o?: any) => ClassifiedLlmError,
): ClassifiedLlmError | null {
  // Usage limit disambiguation (same as 402)
  const hasUsageLimit = matchAny(errorMsg, USAGE_LIMIT_PATTERNS);
  if (hasUsageLimit) {
    const hasTransient = matchAny(errorMsg, USAGE_LIMIT_TRANSIENT_SIGNALS);
    if (hasTransient) {
      return diag(ErrorCode.RATE_LIMITED, { shouldRotateCredential: true, shouldFallback: true });
    }
    return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
  }
  if (matchAny(errorMsg, BILLING_PATTERNS)) {
    return diag(ErrorCode.BILLING_EXCEEDED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
  }
  if (matchAny(errorMsg, RATE_LIMIT_PATTERNS)) {
    return diag(ErrorCode.RATE_LIMITED, { shouldRotateCredential: true, shouldFallback: true });
  }
  if (matchAny(errorMsg, CONTEXT_OVERFLOW_PATTERNS)) {
    return diag(ErrorCode.CONTEXT_OVERFLOW, { shouldCompress: true });
  }
  if (matchAny(errorMsg, AUTH_PATTERNS)) {
    return diag(ErrorCode.AUTH_FAILED, { retryable: false, shouldRotateCredential: true, shouldFallback: true });
  }
  if (matchAny(errorMsg, MODEL_NOT_FOUND_PATTERNS)) {
    return diag(ErrorCode.MODEL_NOT_FOUND, { retryable: false, shouldFallback: true });
  }
  if (matchAny(errorMsg, TIMEOUT_MESSAGE_PATTERNS)) {
    return diag(ErrorCode.TIMEOUT);
  }
  return null;
}

// ── Extractors (Hermes _extract_status_code / _extract_error_body / _extract_error_code) ──

function extractStatusCode(error: unknown): number | undefined {
  let current: any = error;
  for (let i = 0; i < 5; i++) {
    if (typeof current?.status_code === 'number') return current.status_code;
    if (typeof current?.status === 'number' && current.status >= 100 && current.status < 600) return current.status;
    current = current?.cause || current?.__cause__ || current?.__context__;
    if (!current || current === error) break;
  }
  return undefined;
}

type ErrorLike = { body?: unknown; response?: { json?: () => unknown }; message?: string };
type ErrorPayload = { code?: unknown; type?: unknown; message?: unknown };

function extractErrorBody(error: unknown): Record<string, unknown> {
  const e = error as ErrorLike;
  if (e?.body && typeof e.body === 'object' && !Array.isArray(e.body)) return e.body as Record<string, unknown>;
  try { const r = e?.response?.json?.(); if (r && typeof r === 'object' && !Array.isArray(r)) return r as Record<string, unknown>; } catch (err) {
    log.warn({ err }, '错误响应体 JSON 解析失败 — not JSON');
  }
  return {};
}

function extractErrorCode(body: Record<string, unknown>): string {
  const err = body?.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const payload = err as ErrorPayload;
    const code = payload.code || payload.type;
    if (typeof code === 'string' && code.trim() && code.trim() !== '400') return code.trim();
  }
  const code = body?.code || body?.error_code;
  if (typeof code === 'string' && code.trim() && code.trim() !== '400') return code.trim();
  return '';
}

function buildErrorMessage(error: unknown, body: Record<string, unknown>): string {
  const e = error as ErrorLike;
  const parts: string[] = [String(e?.message || error || '')];
  const errObj = body?.error;
  if (errObj && typeof errObj === 'object' && !Array.isArray(errObj)) {
    const payload = errObj as ErrorPayload;
    if (typeof payload.message === 'string') parts.push(payload.message);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function matchAny(msg: string, patterns: readonly string[]): boolean {
  return patterns.some(p => msg.includes(p));
}

// ═══ Retry Strategy (Hermes jittered_backoff + retry_utils) ═══

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

/** Determine if an error is retryable */
export function isRetryable(code: ErrorCodeType): boolean {
  switch (code) {
    case ErrorCode.TIMEOUT:
    case ErrorCode.NETWORK:
    case ErrorCode.DNS:
    case ErrorCode.RATE_LIMITED:
    case ErrorCode.ENGINE_TIMEOUT:
    case ErrorCode.DB_ERROR:
    case ErrorCode.OVERLOADED:
    case ErrorCode.SERVER_ERROR:
    case ErrorCode.CONTEXT_OVERFLOW:
    case ErrorCode.PAYLOAD_TOO_LARGE:
    case ErrorCode.EMPTY_RESPONSE:
    case ErrorCode.AUTH_FAILED:
      return true;
    case ErrorCode.AUTH_PERMANENT:
    case ErrorCode.BILLING_EXCEEDED:
    case ErrorCode.MODEL_NOT_FOUND:
    case ErrorCode.INVALID_INPUT:
    case ErrorCode.VALIDATION_FAILED:
    case ErrorCode.FORMAT_ERROR:
    case ErrorCode.CONTENT_POLICY_BLOCKED:
    case ErrorCode.PROVIDER_UNAVAILABLE:
    case ErrorCode.ENGINE_UNAVAILABLE:
    case ErrorCode.MODULE_FAILED:
    case ErrorCode.CORRUPTED_DATA:
    case ErrorCode.INTERNAL:
      return false;
    // #914 Q-4: 穷尽断言——新增 ErrorCode 成员 ⇒ 编译期 TS2345 红；
    // 运行时逃逸值 ⇒ 抛 UnreachableVariantError（fail-loud，禁静默 return false）
    default:
      return assertNever(code, 'isRetryable');
  }
}

/**
 * Jittered exponential backoff (Hermes jittered_backoff).
 * Decorrelates concurrent retries to prevent thundering-herd.
 */
export function jitteredBackoff(
  attempt: number,
  baseDelayMs = 5000,
  maxDelayMs = 120_000,
  jitterRatio = 0.5,
): number {
  const exp = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  const jitter = exp * jitterRatio * Math.random();
  return Math.min(exp + jitter, maxDelayMs);
}

/** Get recommended backoff based on error type */
export function getBackoffForError(code: ErrorCodeType, attempt: number): number {
  switch (code) {
    case ErrorCode.RATE_LIMITED:
      return jitteredBackoff(attempt, 5000, 120_000);
    case ErrorCode.OVERLOADED:
      return jitteredBackoff(attempt, 2000, 30_000);
    case ErrorCode.SERVER_ERROR:
      return jitteredBackoff(attempt, 1000, 15_000);
    default:
      return jitteredBackoff(attempt, 1000, 30_000);
  }
}

/** Execute a function with retry + jittered backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY, ...config };
  let lastError: unknown;

  for (let attempt = 1; attempt <= cfg.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "错误分类流水线执行");
      lastError = err;
      const diagErr = err instanceof ClassifiedLlmError ? err : null;
      const code = diagErr?.code || ErrorCode.INTERNAL;

      // CONTEXT_OVERFLOW: caller should compress and retry — don't loop here
      if (code === ErrorCode.CONTEXT_OVERFLOW) throw err;
      // AUTH_PERMANENT / BILLING / CONTENT_POLICY: abort immediately
      if (code === ErrorCode.AUTH_PERMANENT || code === ErrorCode.BILLING_EXCEEDED
        || code === ErrorCode.CONTENT_POLICY_BLOCKED) throw err;
      // FORMAT_ERROR: not retryable without changing request
      if (code === ErrorCode.FORMAT_ERROR) throw err;

      if (attempt > cfg.maxRetries) break;

      const retryable = diagErr?.retryable ?? false;
      if (!retryable) throw err;

      const delay = getBackoffForError(code, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

// ═══ API Error Normalizer (unwrap SDK exceptions → ClassifiedLlmError) ═══

/**
 * Normalize any thrown error into a ClassifiedLlmError using the classification pipeline.
 * Call this at every API call boundary.
 */
export function normalizeError(
  error: unknown,
  opts: { provider?: string; model?: string; phase?: number; approxTokens?: number; contextLength?: number } = {},
): ClassifiedLlmError {
  if (error instanceof ClassifiedLlmError) return error;

  const err = error instanceof Error ? error : new Error(String(error));
  const classified = classifyApiError({
    error: err, provider: opts.provider, model: opts.model,
    approxTokens: opts.approxTokens, contextLength: opts.contextLength,
  });
  // Preserve the original phase if specified
  if (opts.phase != null) {
    return new ClassifiedLlmError({
      code: classified.code, message: classified.message, phase: opts.phase,
      retryable: classified.retryable, shouldCompress: classified.shouldCompress,
      shouldRotateCredential: classified.shouldRotateCredential,
      shouldFallback: classified.shouldFallback,
      cause: classified.cause, statusCode: classified.statusCode,
      provider: classified.provider, model: classified.model,
    });
  }
  return classified;
}

// ═══ DSH B-01 借鉴: 归一化边界 + 合一 detail 分类（读源码自研，零代码依赖 G1）═══
// 借鉴锚点: DSH 0.1.1-rc.2 packages/llm/llm/lib/types/error.js + adapter-failure.js
// canonical 词汇表对齐（DSH 4 码 → Synova）:
//   CONTEXT_WINDOW_EXCEEDED → CONTEXT_OVERFLOW（既有码，压缩后重试语义一致）
//   QUOTA                   → BILLING_EXCEEDED（既有码，终态配额/余额耗尽）
//   EMPTY_RESPONSE          → EMPTY_RESPONSE（本次新增: 正常完成但零内容 → 产物为零 → 可安全重试）
//   INVALID_CREDENTIAL      → 不新增码，分类走 adapter 侧（AUTH_FAILED + shouldRotateCredential；
//                             语义: 凭据已供但不可用，修正存储值而非补供，永不重试）

/** normalizeLlmFailure 的返回 — 可序列化 provider-neutral 失败事实（冻结） */
export interface NormalizedLlmFailure {
  readonly message: string;
  /** 稳定可路由失败类；非自有类错误一律 'UNKNOWN'（第三方 SDK 码不属于本 taxonomy） */
  readonly code: string;
  readonly status?: number;
  readonly providerRetryAfterMs?: number;
  readonly requestId?: string;
}

/** 非 Error throw 的消息渲染，敌意 toString 不逃逸归一化（DSH thrownMessage 范式） */
function thrownMessage(value: unknown): string {
  try {
    const message = String(value);
    return message.length > 0 ? message : 'LLM adapter failed';
  } catch (_hostileThrownValue) {
    return 'LLM adapter failed';
  }
}

/** 读取自有数据属性 code，不触发 SDK 定义的访问器（DSH ownErrorCode 范式） */
function ownErrorCode(error: object): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch (_sdkPropertyTrap) {
    return undefined;
  }
}

/** 快照自有数据属性 failure，不触发 SDK 定义的访问器（DSH ownFailureSnapshot 范式） */
function ownFailureSnapshot(error: object): NormalizedLlmFailure | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'failure');
    return descriptor !== undefined && 'value' in descriptor
      ? toFailureSnapshot(descriptor.value)
      : undefined;
  } catch (_sdkPropertyTrap) {
    return undefined;
  }
}

/** 校验并剥离任意可序列化失败载荷（DSH failureSnapshot 范式: 字段全部合法才信任） */
function toFailureSnapshot(value: unknown): NormalizedLlmFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const candidate = value as Record<string, unknown>;
    const message = candidate.message;
    const code = candidate.code;
    const status = candidate.status;
    const providerRetryAfterMs = candidate.providerRetryAfterMs;
    const requestId = candidate.requestId;
    const statusValid = status === undefined
      || (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599);
    const retryAfterValid = providerRetryAfterMs === undefined
      || (typeof providerRetryAfterMs === 'number' && Number.isFinite(providerRetryAfterMs) && providerRetryAfterMs > 0);
    const requestIdValid = requestId === undefined
      || (typeof requestId === 'string' && requestId.length > 0);
    if (typeof message !== 'string' || message.length === 0
      || typeof code !== 'string' || code.length === 0
      || !statusValid || !retryAfterValid || !requestIdValid) {
      return undefined;
    }
    const snapshot: {
      message: string; code: string;
      status?: number; providerRetryAfterMs?: number; requestId?: string;
    } = { message, code };
    if (typeof status === 'number') snapshot.status = status;
    if (typeof providerRetryAfterMs === 'number') snapshot.providerRetryAfterMs = providerRetryAfterMs;
    if (typeof requestId === 'string') snapshot.requestId = requestId;
    return Object.freeze(snapshot);
  } catch (_sdkFailureGetter) {
    return undefined;
  }
}

/** 读取 Error 的 message 而不让敌意访问器替换主失败（DSH errorMessage 范式） */
function errorMessage(error: Error): string {
  try {
    const message = error.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch (_sdkMessageGetter) {
    return 'LLM adapter failed';
  }
  return 'LLM adapter failed';
}

/**
 * DSH B-01 归一化边界（adapter-failure.js 范式，读源码自研零依赖）:
 * 把 LLM adapter 边界抛出的任意值（Error / 非 Error / 敌意值 / 跨包拷贝）归一化为
 * 冻结的可序列化失败事实。跨包拷贝保留 own 数据但丢失类身份——只有 own failure
 * 快照与 own code 一致（且字段全部通过校验）时才信任携带事实，否则回落
 * {message, code}（自有类 ClassifiedLlmError 的码可信，其余一律 'UNKNOWN'）。
 * 原始值由调用方作为 cause 保留（见 src/providers/base.ts 最终 throw 边界）。
 */
export function normalizeLlmFailure(value: unknown): NormalizedLlmFailure {
  if (value instanceof Error) {
    const carried = ownFailureSnapshot(value);
    if (carried !== undefined && carried.code === ownErrorCode(value)) return carried;
    return Object.freeze({
      message: errorMessage(value),
      code: value instanceof ClassifiedLlmError ? value.code : 'UNKNOWN',
    });
  }
  return Object.freeze({ message: thrownMessage(value), code: 'UNKNOWN' });
}

// ── DSH B-01 合一 detail 正则分类（error.js 范式）──
// 分类只在 adapter 边界发生一次: provider 的 code/type/message 合一为一个 detail 字符串，
// thrown 与 in-band 两种投递风格共享同一个分类器；下游一律路由稳定码，不解析 message。

/** 结构化短语: 明确点名 context 上限被超出（context_length_exceeded / context window overflowed） */
const STRUCTURED_CONTEXT_OVERFLOW = /(?:^|[^a-z0-9])context[\s_-]+(?:length|window|size)[\s_-]+(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]+exceeded)(?:$|[^a-z0-9])/i;
/** 把 too large/long 直接绑定到模型上下文容量的请求尺寸措辞 */
const TOO_LARGE_FOR_CONTEXT = /\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?(?:model(?:'s)?\s+)?context(?:\s+window)?\b/i;
/** "exceeds" 类措辞仅当宾语明确是模型 context 时才命中 */
const EXCEEDS_MODEL_CONTEXT = /\b(?:input|prompt|request|messages?)\b.{0,40}\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b/i;
/** 中文 context 超限措辞（与既有 CONTEXT_OVERFLOW 词汇库对齐） */
const CJK_CONTEXT_OVERFLOW = /超过最大长度|上下文长度(?:超出|超限|过长|超过)/;

/**
 * 识别 OpenAI 兼容 provider 与库适配器的 context 超限措辞（DSH isContextWindowExceededError 范式）。
 * @param detail — provider error 的 code/type/message 文本合一字符串。
 * @returns true 表示该请求因超出模型上下文窗口被拒（应压缩后重试）。
 */
export function isContextWindowExceededError(detail: string): boolean {
  return STRUCTURED_CONTEXT_OVERFLOW.test(detail)
    || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail)
    || TOO_LARGE_FOR_CONTEXT.test(detail)
    || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail)
    || EXCEEDS_MODEL_CONTEXT.test(detail)
    || CJK_CONTEXT_OVERFLOW.test(detail);
}

/**
 * 识别终态配额/余额/额度耗尽措辞（区别于瞬态请求限速；DSH isQuotaExceededError 范式）。
 * @param detail — provider error 的 code/type/message 文本合一字符串。
 * @returns true 仅当措辞为终态 quota/balance/credit/budget 耗尽（不重试，轮换或回退）。
 */
export function isQuotaExceededError(detail: string): boolean {
  return /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail)
    || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail)
    || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail)
    || /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail)
    || /\bout[\s_-]+of[\s_-]+(?:credits?|budget|funds?)\b/i.test(detail);
}
