/**
 * src/runtime/dsh/errors.ts — 1A Sidecar / ACP / run 边界的**单一错误词汇表**。
 *
 * 为什么单独成文件：ACP 子进程、Sidecar 生命周期、HTTP/SSE 路由三处都要把失败
 * 稳定地暴露给调用方（铁律 32：`.code` ＋ `.phase` ＋ `.retryable`）。若每处各自
 * 造字符串，调用方就无法稳定区分「可重试／不可重试／需人工」。本文件是唯一来源。
 *
 * 契约（铁律 47）:
 *   @input   任意 catch 到的 unknown ＋ 兜底 {code, phase}
 *   @output  DshError（code/phase/retryable/message/cause）｜ 可序列化错误体
 *   @degraded 无：错误不得吞成空成功；未知异常一律包成 DshError，保留 message 与 cause
 *   @error   本文件只定义错误类型与映射，不负责 HTTP 状态码以外的副作用
 */

/** 1A 错误码（稳定、机器可读；新增码必须同时进下方元数据表）。 */
export type DshErrorCode =
  // 认证 / 输入
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  // 伪造与越权
  | 'FORGED_IDENTITY'
  | 'FORGED_PATH'
  | 'TOOL_REJECTED'
  | 'EGRESS_DENIED'
  // profile / 进程 / 版本
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_INVALID'
  | 'DSH_VERSION_MISMATCH'
  | 'SIDECAR_NOT_RUNNING'
  | 'SIDECAR_SPAWN_FAILED'
  | 'SIDECAR_START_TIMEOUT'
  | 'SIDECAR_PROTOCOL_ERROR'
  | 'SIDECAR_SESSION_LOST'
  | 'SIDECAR_CONTROL_UNAVAILABLE'
  // 会话 / 运行
  | 'SESSION_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'RUN_TIMEOUT'
  | 'RUN_CANCELLED'
  | 'RUN_FAILED'
  // 工具 / 领域
  | 'TOOL_TIMEOUT'
  | 'TOOL_ERROR'
  | 'DOMAIN_EMPTY'
  | 'REAL_ADAPTER_NOT_CONFIGURED'
  // 持久化
  | 'PERSISTENCE_ERROR';

/** 错误发生在哪一段（phase 用于排障定位，不参与业务分支）。 */
export type DshErrorPhase =
  | 'request'
  | 'auth'
  | 'profile'
  | 'spawn'
  | 'initialize'
  | 'session'
  | 'run'
  | 'tool'
  | 'persist'
  | 'shutdown'
  | 'control';

interface CodeMeta {
  readonly retryable: boolean;
  readonly httpStatus: number;
}

/**
 * code → {retryable, httpStatus} 单源。
 * retryable 语义：调用方原样重试**可能**成功（不看业务前提）；不可重试的码
 * 重试只会得到同一结果，必须改输入或人工介入。
 */
const CODE_META: Record<DshErrorCode, CodeMeta> = {
  UNAUTHORIZED: { retryable: false, httpStatus: 401 },
  VALIDATION_ERROR: { retryable: false, httpStatus: 400 },
  FORBIDDEN: { retryable: false, httpStatus: 403 },
  FORGED_IDENTITY: { retryable: false, httpStatus: 403 },
  FORGED_PATH: { retryable: false, httpStatus: 403 },
  TOOL_REJECTED: { retryable: false, httpStatus: 403 },
  EGRESS_DENIED: { retryable: false, httpStatus: 403 },
  PROFILE_NOT_FOUND: { retryable: false, httpStatus: 500 },
  PROFILE_INVALID: { retryable: false, httpStatus: 500 },
  // 版本是被锁定的部署前置条件：409 表示「当前安装与期望版本冲突」，重试同样冲突。
  DSH_VERSION_MISMATCH: { retryable: false, httpStatus: 409 },
  SIDECAR_NOT_RUNNING: { retryable: false, httpStatus: 503 },
  SIDECAR_SPAWN_FAILED: { retryable: true, httpStatus: 503 },
  SIDECAR_START_TIMEOUT: { retryable: true, httpStatus: 504 },
  SIDECAR_PROTOCOL_ERROR: { retryable: false, httpStatus: 502 },
  SIDECAR_SESSION_LOST: { retryable: true, httpStatus: 503 },
  SIDECAR_CONTROL_UNAVAILABLE: { retryable: true, httpStatus: 503 },
  SESSION_NOT_FOUND: { retryable: false, httpStatus: 404 },
  RUN_NOT_FOUND: { retryable: false, httpStatus: 404 },
  RUN_TIMEOUT: { retryable: true, httpStatus: 504 },
  RUN_CANCELLED: { retryable: true, httpStatus: 499 },
  RUN_FAILED: { retryable: false, httpStatus: 500 },
  TOOL_TIMEOUT: { retryable: true, httpStatus: 504 },
  TOOL_ERROR: { retryable: false, httpStatus: 500 },
  DOMAIN_EMPTY: { retryable: false, httpStatus: 404 },
  REAL_ADAPTER_NOT_CONFIGURED: { retryable: false, httpStatus: 501 },
  PERSISTENCE_ERROR: { retryable: true, httpStatus: 500 },
};

/** 跨边界错误：携带稳定 code／phase／retryable，可安全序列化给调用方。 */
export class DshError extends Error {
  readonly code: DshErrorCode;
  readonly phase: DshErrorPhase;
  readonly retryable: boolean;

  constructor(
    code: DshErrorCode,
    phase: DshErrorPhase,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'DshError';
    this.code = code;
    this.phase = phase;
    this.retryable = options.retryable ?? CODE_META[code].retryable;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  /** HTTP 状态码映射（SSE 已开始后不再使用，由事件体透传 code）。 */
  get httpStatus(): number {
    return CODE_META[this.code].httpStatus;
  }

  /** 可直接写进 JSON 响应/SSE 事件的最小错误体。 */
  toPayload(): DshErrorPayload {
    return {
      ok: false,
      code: this.code,
      phase: this.phase,
      retryable: this.retryable,
      message: this.message,
    };
  }
}

/** 错误 JSON 形状（API 响应与 SSE `run.failed` 共用）。 */
export interface DshErrorPayload {
  ok: false;
  code: DshErrorCode;
  phase: DshErrorPhase;
  retryable: boolean;
  message: string;
}

/** 是否是本模块的错误（跨包边界用 instanceof 判定，不用字符串猜）。 */
export function isDshError(err: unknown): err is DshError {
  return err instanceof DshError;
}

/** 类型守卫：状态文件/控制口里读到的字符串是否是合法 DshErrorCode。 */
export function isDshErrorCode(value: unknown): value is DshErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODE_META, value);
}

/** 类型守卫：phase 字符串是否合法。 */
export function isDshErrorPhase(value: unknown): value is DshErrorPhase {
  return typeof value === 'string'
    && ['request', 'auth', 'profile', 'spawn', 'initialize', 'session', 'run', 'tool', 'persist', 'shutdown', 'control'].includes(value);
}

/**
 * 把任意异常收敛为 DshError。
 * @param err 捕获到的 unknown（DshError 原样返回；其它异常保留 message/cause）
 * @param fallback 兜底 code/phase（由调用点声明"这一段最可能是什么失败"）
 */
export function toDshError(
  err: unknown,
  fallback: { code: DshErrorCode; phase: DshErrorPhase },
): DshError {
  if (err instanceof DshError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new DshError(fallback.code, fallback.phase, message, { cause: err });
}

/**
 * JSON-RPC 错误 → DshError。ACP 子进程把协议错误放在 `error: {code, message}`。
 * ACP/JSON-RPC 的 -32601/-32602 属"调用方用法错"，不可重试；其它按协议错误处理。
 */
export function fromAcpRpcError(
  rpcError: { code?: unknown; message?: unknown },
  phase: DshErrorPhase,
): DshError {
  const detail = typeof rpcError.message === 'string' ? rpcError.message : 'ACP JSON-RPC error';
  const rpcCode = typeof rpcError.code === 'number' ? `[${rpcError.code}] ` : '';
  return new DshError('SIDECAR_PROTOCOL_ERROR', phase, `${rpcCode}${detail}`, { retryable: false });
}
