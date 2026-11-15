export type EnterpriseScanErrorCode =
  | 'VALIDATION_ERROR'
  | 'SCOPE_DENIED'
  | 'UNAUTHORIZED_PATH'
  | 'RUN_UNAVAILABLE'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'IDEMPOTENCY_KEY_UNAVAILABLE'
  | 'IDEMPOTENCY_REPLAY_SCOPE_CHANGED'
  | 'SOURCE_CHANGED_RERUN_REQUIRED'
  | 'FILE_CHANGED_BEFORE_COMMIT'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY_CONTENT'
  | 'SOURCE_VALIDATION_FAILED'
  | 'SCHEMA_MAPPING_FAILED'
  | 'SCAN_STORE_FAILED'
  | 'TRANSACTION_ABORTED';

const STATUS: Record<EnterpriseScanErrorCode, number> = {
  VALIDATION_ERROR: 400,
  SCOPE_DENIED: 403,
  UNAUTHORIZED_PATH: 403,
  RUN_UNAVAILABLE: 403,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  IDEMPOTENCY_KEY_UNAVAILABLE: 409,
  IDEMPOTENCY_REPLAY_SCOPE_CHANGED: 409,
  SOURCE_CHANGED_RERUN_REQUIRED: 409,
  FILE_CHANGED_BEFORE_COMMIT: 409,
  UNSUPPORTED_FORMAT: 415,
  EMPTY_CONTENT: 422,
  SOURCE_VALIDATION_FAILED: 422,
  SCHEMA_MAPPING_FAILED: 422,
  SCAN_STORE_FAILED: 500,
  TRANSACTION_ABORTED: 500,
};

export class EnterpriseScanError extends Error {
  readonly status: number;
  readonly code: EnterpriseScanErrorCode;
  readonly phase: 'request' | 'preflight' | 'parse' | 'mapping' | 'transaction' | 'report';
  readonly retryable: boolean;

  constructor(
    code: EnterpriseScanErrorCode,
    phase: EnterpriseScanError['phase'],
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = 'EnterpriseScanError';
    this.code = code;
    this.phase = phase;
    this.status = STATUS[code];
    this.retryable = retryable;
  }
}

export function asEnterpriseScanError(error: unknown, fallback: EnterpriseScanErrorCode = 'SCAN_STORE_FAILED'): EnterpriseScanError {
  if (error instanceof EnterpriseScanError) return error;
  return new EnterpriseScanError(
    fallback,
    fallback === 'TRANSACTION_ABORTED' ? 'transaction' : 'report',
    error instanceof Error ? error.message : String(error),
    fallback === 'SCAN_STORE_FAILED',
  );
}
