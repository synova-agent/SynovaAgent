/**
 * errors.ts — 类型化错误层次 (Slice 2.1, 铁律 #32)
 *
 * 每个错误子类带 .code (字符串常量), .phase (诊断阶段, 0=基础设施),
 * .retryable (boolean)。调用方根据 error.code 做差异化恢复。
 *
 * 禁止: bare catch(err) { return null } — 必须包装再抛出或返回
 * 禁止: new Error('something') — 必须用具体子类
 */

// ═══ Base ═══

/**
 * 所有诊断 Agent 错误的基类 —— **全仓唯一的错误层次根**（Q-3 单基类）。
 *
 * 设计哲学：**按 `code` 路由，永不解析 `message`**（DSH `HarnessError` 锚：
 * "route on this, never by parsing message"）。`message` 只给人读，路由只认稳定 `code`。
 */
export class DiagnosticAgentError extends Error {
  readonly code: string;
  readonly phase: number;
  readonly retryable: boolean;

  /**
   * @param code - 稳定失败码（调用方按它路由，禁作展示之外的判断）
   * @param message - 人读消息（只用于日志/展示，禁作路由依据）
   * @param phase - 诊断阶段（0 = 基础设施）
   * @param retryable - 是否可重试
   * @param options - 原生 `ErrorOptions`：`cause` 原样透传给 `Error`（ES2022 原生 cause 链）；
   *   不传 ⇒ `err.cause === undefined`（不伪造）；其余 9 个子类构造保持 4 参不变
   */
  constructor(code: string, message: string, phase: number, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiagnosticAgentError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
  }
}

// ═══ LLM Errors ═══

/** LLM 请求超时 — 可重试 1 次 */
export class LLMTimeoutError extends DiagnosticAgentError {
  constructor(message = 'LLM 请求超时', phase = 0) {
    super('LLM_TIMEOUT', message, phase, true);
    this.name = 'LLMTimeoutError';
  }
}

/** LLM 认证失败 (API Key 无效) — 不可重试 */
export class LLMAuthError extends DiagnosticAgentError {
  constructor(message = 'LLM 认证失败, 请检查 API Key', phase = 0) {
    super('LLM_AUTH', message, phase, false);
    this.name = 'LLMAuthError';
  }
}

/** LLM 网络错误 — 可重试带退避 */
export class LLMNetworkError extends DiagnosticAgentError {
  constructor(message = 'LLM 网络连接失败', phase = 0) {
    super('LLM_NETWORK', message, phase, true);
    this.name = 'LLMNetworkError';
  }
}

/** LLM 速率限制 — 可重试带退避 */
export class LLMRateLimitError extends DiagnosticAgentError {
  readonly retryAfterMs: number;

  constructor(message = 'LLM 速率限制', retryAfterMs = 60000, phase = 0) {
    super('LLM_RATE_LIMIT', message, phase, true);
    this.name = 'LLMRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** LLM 返回无效内容 (JSON 解析失败等) — 可重试 1 次 */
export class LLMInvalidResponseError extends DiagnosticAgentError {
  constructor(message = 'LLM 返回无效响应', phase = 0) {
    super('LLM_INVALID_RESPONSE', message, phase, true);
    this.name = 'LLMInvalidResponseError';
  }
}

// ═══ Tool Errors ═══

/** 工具执行失败 — 不可重试 (工具本身出错) */
export class ToolExecError extends DiagnosticAgentError {
  readonly toolName: string;

  constructor(toolName: string, message: string, phase = 0) {
    super('TOOL_EXEC', `${toolName}: ${message}`, phase, false);
    this.name = 'ToolExecError';
    this.toolName = toolName;
  }
}

/** 工具未找到 — 不可重试 */
export class ToolNotFoundError extends DiagnosticAgentError {
  constructor(toolName: string, phase = 0) {
    super('TOOL_NOT_FOUND', `工具未注册: ${toolName}`, phase, false);
    this.name = 'ToolNotFoundError';
  }
}

// ═══ Storage Errors ═══

// ═══ Pipeline Errors ═══

/** 证据不足 — 不可重试 (需补充数据) */
export class EvidenceInsufficientError extends DiagnosticAgentError {
  constructor(dimension: string, phase = 3) {
    super('EVIDENCE_INSUFFICIENT', `维度证据不足: ${dimension}`, phase, false);
    this.name = 'EvidenceInsufficientError';
  }
}

/** 门禁检查未通过 — 不可重试 */
export class GateCheckFailedError extends DiagnosticAgentError {
  constructor(gate: string, details: string, phase = 0) {
    super('GATE_CHECK_FAILED', `${gate}: ${details}`, phase, false);
    this.name = 'GateCheckFailedError';
  }
}

/** 权限拒绝 — 不可重试 */
export class PermissionDeniedError extends DiagnosticAgentError {
  constructor(resource: string, phase = 0) {
    super('PERMISSION_DENIED', `权限不足: ${resource}`, phase, false);
    this.name = 'PermissionDeniedError';
  }
}

/** 恢复次数耗尽 — 不可重试 */
export class RecoveryExhaustedError extends DiagnosticAgentError {
  constructor(operation: string, attempts: number, phase = 0) {
    super('RECOVERY_EXHAUSTED', `${operation} 已重试 ${attempts} 次仍未恢复`, phase, false);
    this.name = 'RecoveryExhaustedError';
  }
}

/** 会话状态损坏 — 不可重试 */
export class SessionCorruptedError extends DiagnosticAgentError {
  constructor(sessionId: string, phase = 2) {
    super('SESSION_CORRUPTED', `会话状态损坏: ${sessionId}`, phase, false);
    this.name = 'SessionCorruptedError';
  }
}

/** 模块执行失败 — 取决于具体原因 */
export class ModuleFailedError extends DiagnosticAgentError {
  constructor(moduleName: string, reason: string, phase = 0, retryable = false) {
    super('MODULE_FAILED', `${moduleName}: ${reason}`, phase, retryable);
    this.name = 'ModuleFailedError';
  }
}

/** 工具超时 — 可重试 1 次 */
export class ToolTimeoutError extends DiagnosticAgentError {
  constructor(toolName: string, timeoutMs: number, phase = 0) {
    super('TOOL_TIMEOUT', `${toolName} 超时 ${timeoutMs}ms`, phase, true);
    this.name = 'ToolTimeoutError';
  }
}

/** 子 Agent 失联 — 可重试 1 次 */
export class SubAgentLostError extends DiagnosticAgentError {
  constructor(agentId: string, phase = 0) {
    super('SUBAGENT_LOST', `子 Agent 失联: ${agentId}`, phase, true);
    this.name = 'SubAgentLostError';
  }
}

/** 存储操作失败 — 取决于具体原因 */
export class StorageError extends DiagnosticAgentError {
  constructor(operation: string, message: string, retryable = false) {
    super('STORAGE', `${operation}: ${message}`, 0, retryable);
    this.name = 'StorageError';
  }
}

// ═══ Validation Errors ═══

/** 输入校验失败 — 不可重试 */
export class ValidationError extends DiagnosticAgentError {
  constructor(field: string, message: string) {
    super('VALIDATION', `${field}: ${message}`, 0, false);
    this.name = 'ValidationError';
  }
}

// ═══ Utility ═══

/**
 * 根据 HTTP status code 创建对应的 LLM 错误。
 * 用于 Provider 适配器层统一错误转换。
 */
export function llmErrorFromHttpStatus(status: number, message?: string, phase = 0): DiagnosticAgentError {
  if (status === 401 || status === 403) {
    return new LLMAuthError(message || `LLM API 认证失败 (HTTP ${status})`, phase);
  }
  if (status === 429) {
    return new LLMRateLimitError(message || `LLM API 速率限制 (HTTP ${status})`, undefined, phase);
  }
  if (status >= 500) {
    return new LLMNetworkError(message || `LLM API 服务器错误 (HTTP ${status})`, phase);
  }
  return new LLMInvalidResponseError(message || `LLM API 返回异常状态码 (HTTP ${status})`, phase);
}
