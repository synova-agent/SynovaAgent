/**
 * tests/l4/graph-scope.test.ts — #1211 · 图命名空间白名单（U-2 八格）
 *
 * 判据来源：.handbook/派单件/2026-10-31-规格-1211-图命名空间口径统一.md §3 U-2
 *   拒绝格 5：'' ／ 'Default' ／ 'a b' ／ '../x' ／ 'x'.repeat(65)
 *   通过格 3：'default' ／ 'acme-2' ／ 'a'
 * 附加：resolveGraph 三格（与 config.ts:110 同源）＋ typed error 形状（铁律 32）＋ 非 string 入参
 *
 * 铁律 48：每格独立 expect，禁壳；铁律 38：零 as any。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGraph,
  assertGraphName,
  GraphScopeError,
} from '../../src/l2/graph-scope';

/** 与实现同值（HTTP 层 `routes/data.ts` 原样透出的稳定 code；此处按字面断言，不 import 内部常量） */
const GRAPH_NAME_INVALID_CODE = 'GRAPH_NAME_INVALID';

/** 捕获 assertGraphName 抛出的错误；不抛则返回 null（便于断言"必须抛"） */
function thrownByAssert(value: unknown): GraphScopeError | null {
  try {
    assertGraphName(value);
    return null;
  } catch (err: unknown) {
    return err instanceof GraphScopeError ? err : null;
  }
}

describe('U-2 assertGraphName — 拒绝格 5（非法图名必须抛）', () => {
  const rejected: Array<{ label: string; value: unknown }> = [
    { label: '空串', value: '' },
    { label: '大写 Default（不做大小写归一）', value: 'Default' },
    { label: '含空格 a b', value: 'a b' },
    { label: '含路径 ../x', value: '../x' },
    { label: '65 字符越界', value: 'x'.repeat(65) },
  ];

  for (const cell of rejected) {
    it(`${cell.label} ⇒ 抛 GRAPH_NAME_INVALID`, () => {
      const err = thrownByAssert(cell.value);
      expect(err).not.toBeNull();
      expect(err?.code).toBe(GRAPH_NAME_INVALID_CODE);
      expect(err?.phase).toBe('graph-scope');
      expect(err?.retryable).toBe(false);
    });
  }
});

describe('U-2 assertGraphName — 通过格 3（合法图名原样返回）', () => {
  const accepted: Array<{ label: string; value: string }> = [
    { label: 'default（默认装机）', value: 'default' },
    { label: 'acme-2（含连字符数字）', value: 'acme-2' },
    { label: 'a（单字符，下界）', value: 'a' },
    { label: '64 字符（上界）', value: 'x'.repeat(64) },
  ];

  for (const cell of accepted) {
    it(`${cell.label} ⇒ 原样返回`, () => {
      expect(assertGraphName(cell.value)).toBe(cell.value);
    });
  }
});

describe('G4 边界 —— 非 string 入参一律拒绝（不做隐式转换）', () => {
  const nonStrings: Array<{ label: string; value: unknown }> = [
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'number 42', value: 42 },
    { label: 'object', value: { graph: 'acme' } },
    { label: 'array', value: ['acme'] },
  ];

  for (const cell of nonStrings) {
    it(`${cell.label} ⇒ 抛 GRAPH_NAME_INVALID（不得 String() 兜底）`, () => {
      const err = thrownByAssert(cell.value);
      expect(err).not.toBeNull();
      expect(err?.code).toBe(GRAPH_NAME_INVALID_CODE);
    });
  }
});

describe('U-2 resolveGraph — 与 config.ts:110 同源', () => {
  it("orgId='acme' ⇒ 'acme'", () => {
    expect(resolveGraph({ orgId: 'acme' })).toBe('acme');
  });

  it("orgId 未设（undefined）⇒ 'default'", () => {
    expect(resolveGraph({ orgId: undefined })).toBe('default');
    expect(resolveGraph({})).toBe('default');
    expect(resolveGraph()).toBe('default');
  });

  it("orgId=null ⇒ 'default'", () => {
    expect(resolveGraph({ orgId: null })).toBe('default');
  });

  it("orgId='' ⇒ 'default'（空串视为未设置）", () => {
    expect(resolveGraph({ orgId: '' })).toBe('default');
  });

  it('派生结果可直接过白名单（两函数可串联使用）', () => {
    expect(assertGraphName(resolveGraph({ orgId: 'acme_2' }))).toBe('acme_2');
    expect(assertGraphName(resolveGraph({}))).toBe('default');
  });
});

describe('错误形状 —— GraphScopeError 三件齐（铁律 32）', () => {
  it('是 Error 子类且 name/code/phase/retryable 稳定', () => {
    const err = thrownByAssert('../evil');
    expect(err).toBeInstanceOf(Error);
    expect(err?.name).toBe('GraphScopeError');
    expect(err?.code).toBe('GRAPH_NAME_INVALID');
    expect(err?.phase).toBe('graph-scope');
    expect(err?.retryable).toBe(false);
  });

  it('消息含非法值，便于定位（不静默）', () => {
    const err = thrownByAssert('a b');
    expect(err?.message).toContain('a b');
  });
});
