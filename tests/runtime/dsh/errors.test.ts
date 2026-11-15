/**
 * tests/runtime/dsh/errors.test.ts — 1A 错误词汇表单测（DshError 契约）。
 *
 * 配对对象：src/runtime/dsh/errors.ts
 * 覆盖：code/phase/retryable 契约、HTTP 映射、序列化、unknown→DshError 收敛、
 * 类型守卫、JSON-RPC 错误映射。不依赖任何进程/文件。
 */
import { describe, expect, it } from 'vitest';
import {
  DshError,
  fromAcpRpcError,
  isDshError,
  isDshErrorCode,
  isDshErrorPhase,
  toDshError,
} from '../../../src/runtime/dsh/errors';

describe('errors: DshError 契约', () => {
  it('code/phase/retryable/httpStatus/toPayload 单源一致', () => {
    const error = new DshError('SIDECAR_NOT_RUNNING', 'control', 'not running');
    expect(error.code).toBe('SIDECAR_NOT_RUNNING');
    expect(error.phase).toBe('control');
    expect(error.retryable).toBe(false);
    expect(error.httpStatus).toBe(503);
    expect(error.toPayload()).toEqual({
      ok: false,
      code: 'SIDECAR_NOT_RUNNING',
      phase: 'control',
      retryable: false,
      message: 'not running',
    });
  });

  it('构造函数可覆盖 retryable（缺省仍取元数据表）', () => {
    const overridden = new DshError('SIDECAR_SPAWN_FAILED', 'spawn', 'missing install', { retryable: false });
    expect(overridden.retryable).toBe(false);
    const defaulted = new DshError('SIDECAR_SPAWN_FAILED', 'spawn', 'transient');
    expect(defaulted.retryable).toBe(true);
    expect(new DshError('RUN_TIMEOUT', 'run', 't').httpStatus).toBe(504);
    expect(new DshError('UNAUTHORIZED', 'auth', 'a').httpStatus).toBe(401);
  });

  it('toDshError：DshError 原样返回；其它异常保留 message 与 cause', () => {
    const original = new DshError('RUN_FAILED', 'run', 'boom');
    expect(toDshError(original, { code: 'PERSISTENCE_ERROR', phase: 'persist' })).toBe(original);

    const cause = new Error('raw failure');
    const wrapped = toDshError(cause, { code: 'PERSISTENCE_ERROR', phase: 'persist' });
    expect(wrapped.code).toBe('PERSISTENCE_ERROR');
    expect(wrapped.phase).toBe('persist');
    expect(wrapped.message).toBe('raw failure');
    expect(wrapped.cause).toBe(cause);

    const stringy = toDshError('plain text', { code: 'TOOL_ERROR', phase: 'tool' });
    expect(stringy.message).toBe('plain text');
    expect(stringy.retryable).toBe(false);
  });

  it('类型守卫：isDshError / isDshErrorCode / isDshErrorPhase', () => {
    expect(isDshError(new DshError('RUN_TIMEOUT', 'run', 'x'))).toBe(true);
    expect(isDshError(new Error('x'))).toBe(false);
    expect(isDshErrorCode('RUN_TIMEOUT')).toBe(true);
    expect(isDshErrorCode('NOT_A_CODE')).toBe(false);
    expect(isDshErrorCode(42)).toBe(false);
    expect(isDshErrorPhase('initialize')).toBe(true);
    expect(isDshErrorPhase('not-a-phase')).toBe(false);
  });

  it('fromAcpRpcError：保留 JSON-RPC code 文本且不可重试', () => {
    const mapped = fromAcpRpcError({ code: -32602, message: 'Invalid params: cwd' }, 'initialize');
    expect(mapped).toBeInstanceOf(DshError);
    expect(mapped.code).toBe('SIDECAR_PROTOCOL_ERROR');
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toContain('-32602');
    expect(mapped.message).toContain('Invalid params: cwd');

    const noCode = fromAcpRpcError({ message: 'unknown transport failure' }, 'session');
    expect(noCode.code).toBe('SIDECAR_PROTOCOL_ERROR');
    expect(noCode.phase).toBe('session');
    expect(noCode.message).toBe('unknown transport failure');
  });
});
