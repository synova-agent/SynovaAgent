/**
 * tests/runtime/dsh/tools.test.ts — 合成只读领域工具数据面与一次性 token 单测。
 *
 * 配对对象：src/runtime/dsh/tools.ts
 * 覆盖：ContextSnapshot 形状/计数、未知 problem 显式空、伪造身份/路径/未知参数拒绝、
 * token 签发-解析-撤销-过期、token 绑定身份上下文。
 */
import { describe, expect, it } from 'vitest';
import { DshError } from '../../../src/runtime/dsh/errors';
import { ToolTokenStore, handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const PROBLEM = 'problem-revenue-health-2026q3';
const CONTEXT = { enterpriseId: 'ent-1', userId: 'user-1', scope: 'admin', runId: 'run_tools_0001' };

function catchError(fn: () => unknown): unknown {
  try { fn(); return null; } catch (err: unknown) { return err; }
}

interface SnapshotShape {
  synthetic: boolean;
  problemId: string;
  count: number;
  items: Array<{ layer: string; $id: string; source: { kind: string; api: string } }>;
}

describe('tools: 合成只读 ContextSnapshot', () => {
  it('返回 ②/③/④ 三条、count>0、synthetic=true、字段齐全', () => {
    const payload = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: PROBLEM })) as SnapshotShape;
    expect(payload.synthetic).toBe(true);
    expect(payload.problemId).toBe(PROBLEM);
    expect(payload.count).toBe(3);
    expect(payload.items.map(item => item.layer)).toEqual(['②', '③', '④']);
    expect(payload.items[0].source.kind).toBe('synova.domain');
    expect(payload.items[0].source.api).toBe('synthetic-context-v1');
    expect(payload.items[0].$id).toBe('ontology.entity.sales_revenue');
  });

  it('未知 problemId ⇒ DOMAIN_EMPTY（显式空，不伪造数据）', () => {
    const error = catchError(() => handleDomainToolCall('synova_context_get', { problemId: 'problem-no-such' }));
    expect(error).toBeInstanceOf(DshError);
    expect((error as DshError).code).toBe('DOMAIN_EMPTY');
    expect((error as DshError).retryable).toBe(false);
  });

  it('伪造身份/路径/未知参数/未登记工具 ⇒ 稳定 code', () => {
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, enterpriseId: 'ent-2' })))
      .toMatchObject({ code: 'FORGED_IDENTITY' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, userId: 'u2' })))
      .toMatchObject({ code: 'FORGED_IDENTITY' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, path: '/etc/passwd' })))
      .toMatchObject({ code: 'FORGED_PATH' });
    expect(catchError(() => handleDomainToolCall('synova_context_get', { problemId: PROBLEM, extra: 1 })))
      .toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(catchError(() => handleDomainToolCall('decision_write', { problemId: PROBLEM })))
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
