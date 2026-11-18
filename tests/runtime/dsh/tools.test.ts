/**
 * tests/runtime/dsh/tools.test.ts — 只读领域工具数据面（#1426 真实 ②）与一次性 token 单测。
 *
 * 配对对象：src/runtime/dsh/tools.ts
 * 覆盖：真实 ContextSnapshot 形状/计数、未知 problem 显式空、伪造身份/路径/未知参数拒绝、
 * 缺 ctx ⇒ UNAUTHORIZED、token 签发-解析-撤销-过期、token 绑定身份上下文。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { DshError } from '../../../src/runtime/dsh/errors';
import { ToolTokenStore, handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const PROBLEM = 'batch-1426-tools-root';
const CONTEXT = { enterpriseId: 'ent-tools-1426', userId: 'user-tools-1426', scope: 'admin', runId: 'run_tools_0001' };

/** ② 邻接条目 id（beforeAll 种入真 :memory: 图）。 */
let neighborId: string;

function catchError(fn: () => unknown): unknown {
  try { fn(); return null; } catch (err: unknown) { return err; }
}

interface SnapshotShape {
  synthetic: boolean;
  problemId: string;
  count: number;
  truncated: boolean;
  items: Array<{
    layer: string;
    $id: string;
    period: string;
    defVersion: string;
    source: { kind: string; api: string };
  }>;
}

beforeAll(() => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`tools.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const root = store.createNode(
    'activity/delivery_batch',
    { businessKey: PROBLEM, name: '根批次', period: '2026-07', defVersion: 'def-2026.07' },
    CONTEXT.enterpriseId,
  );
  neighborId = store.createNode(
    'activity/delivery_batch',
    { businessKey: 'batch-1426-tools-neighbor', name: '邻接批次', period: '2026-08', defVersion: 'def-2026.08' },
    CONTEXT.enterpriseId,
  );
  store.createEdge('edge/team_executes_activity', root, neighborId, 1, {}, CONTEXT.enterpriseId);
});

describe('tools: 真实只读 ContextSnapshot（#1426）', () => {
  it('返回真实 ② 条目、synthetic=false、source.api=synova.domain/v1、字段齐全', () => {
    const payload = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: PROBLEM }, CONTEXT)) as SnapshotShape;
    expect(payload.synthetic).toBe(false);
    expect(payload.problemId).toBe(PROBLEM);
    expect(payload.count).toBe(1);
    expect(payload.truncated).toBe(false);
    expect(payload.items.map(item => item.layer)).toEqual(['②']);
    expect(payload.items[0].source.kind).toBe('synova.domain');
    expect(payload.items[0].source.api).toBe('synova.domain/v1');
    expect(payload.items[0].$id).toBe(neighborId);
    expect(payload.items[0].period).toBe('2026-08');
    expect(payload.items[0].defVersion).toBe('def-2026.08');
  });

  it('未知 problemId ⇒ DOMAIN_EMPTY（显式空，不伪造数据）', () => {
    const error = catchError(() => handleDomainToolCall('synova_context_get', { problemId: 'problem-no-such' }, CONTEXT));
    expect(error).toBeInstanceOf(DshError);
    expect((error as DshError).code).toBe('DOMAIN_EMPTY');
    expect((error as DshError).retryable).toBe(false);
  });

  it('缺 ctx（token 未绑定）⇒ UNAUTHORIZED（不是 FORGED_IDENTITY）', () => {
    const error = catchError(() =>
      Reflect.apply(handleDomainToolCall, undefined, ['synova_context_get', { problemId: PROBLEM }]));
    expect(error).toBeInstanceOf(DshError);
    expect((error as DshError).code).toBe('UNAUTHORIZED');
    expect((error as DshError).httpStatus).toBe(401);
  });

  it('伪造身份/路径/未知参数/未登记工具 ⇒ 稳定 code（校验先于 ctx 与查询）', () => {
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, enterpriseId: 'ent-2' }, CONTEXT)))
      .toMatchObject({ code: 'FORGED_IDENTITY' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, userId: 'u2' }, CONTEXT)))
      .toMatchObject({ code: 'FORGED_IDENTITY' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, path: '/etc/passwd' }, CONTEXT)))
      .toMatchObject({ code: 'FORGED_PATH' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, extra: 1 }, CONTEXT)))
      .toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(catchError(() => handleDomainToolCall('decision_write', { problemId: PROBLEM }, CONTEXT)))
      .toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('tools: ToolTokenStore（一次性 token）', () => {
  it('签发后可按 token 解析回同一身份上下文', () => {
    const store = new ToolTokenStore();
    const token = store.issue(CONTEXT);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(store.resolve(token)).toEqual(CONTEXT);
    expect(store.size).toBe(1);
  });

  it('撤销后立即失效；未知 token 返回 null', () => {
    const store = new ToolTokenStore();
    const token = store.issue(CONTEXT);
    store.revoke(token);
    expect(store.resolve(token)).toBeNull();
    expect(store.size).toBe(0);
    expect(store.resolve('f'.repeat(64))).toBeNull();
  });

  it('TTL 过期后拒绝（不静默延长）', async () => {
    const store = new ToolTokenStore(1);
    const token = store.issue(CONTEXT);
    expect(store.resolve(token)).toEqual(CONTEXT);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
    expect(store.resolve(token)).toBeNull();
    expect(store.size).toBe(0);
  });
});
