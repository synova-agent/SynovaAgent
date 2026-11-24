/**
 * tests/runtime/dsh/hypothesis-adapter.test.ts — #1459 T-C 适配器契约（真实断言，非空壳）。
 * 覆盖：合格路径 / 围栏剥离 / 非 JSON / 顶层非对象 / 缺字段 / 空数组 / 空串元素 / 类型错 / 文本截断。
 */
import { describe, expect, it } from 'vitest';
import {
  HYPOTHESIS_TEXT_LIMIT,
  parseHypothesis,
  truncateHypothesisText,
} from '../../../src/runtime/dsh/hypothesis-adapter';

const valid = {
  hypothesis: '交付批次积压导致回款延迟，是当期主要瓶颈',
  objects: ['node-batch-001', 'node-team-a'],
  relations: ['edge/team_executes_activity'],
  evidence: ['delivery_batches.csv#L2'],
  uncertainty: ['未纳入财务口径的账期差异'],
};

describe('parseHypothesis — 合格路径', () => {
  it('四要素齐全的 JSON ⇒ ok，并且载荷逐字段等于输入', () => {
    const result = parseHypothesis(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.hypothesis).toBe(valid.hypothesis);
    expect(result.payload.objects).toEqual(valid.objects);
    expect(result.payload.relations).toEqual(valid.relations);
    expect(result.payload.evidence).toEqual(valid.evidence);
    expect(result.payload.uncertainty).toEqual(valid.uncertainty);
  });

  it('markdown 围栏包裹的 JSON ⇒ 仍能解析（围栏被剥离，不改内容）', () => {
    const text = '```json\n' + JSON.stringify(valid) + '\n```';
    const result = parseHypothesis(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.objects).toEqual(valid.objects);
  });

  it('schemaVersion 为数字时透传；非数字时不写入', () => {
    const withVersion = parseHypothesis(JSON.stringify({ ...valid, schemaVersion: 1 }));
    expect(withVersion.ok && withVersion.payload.schemaVersion).toBe(1);
    const withString = parseHypothesis(JSON.stringify({ ...valid, schemaVersion: 'v1' }));
    expect(withString.ok && withString.payload.schemaVersion).toBeUndefined();
  });
});

describe('parseHypothesis — 不合格路径（必须给机器可读原因）', () => {
  it('空文本 ⇒ NOT_JSON', () => {
    const result = parseHypothesis('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('NOT_JSON');
  });

  it('自然语言（非 JSON）⇒ NOT_JSON', () => {
    const result = parseHypothesis('我认为瓶颈在交付环节，因为批次积压。');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('NOT_JSON');
  });

  it('顶层是数组 ⇒ WRONG_TYPE', () => {
    const result = parseHypothesis(JSON.stringify([valid]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('WRONG_TYPE');
  });

  it('缺 uncertainty ⇒ MISSING_FIELDS 且点名该字段', () => {
    const { uncertainty: _dropped, ...rest } = valid;
    const result = parseHypothesis(JSON.stringify(rest));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('MISSING_FIELDS');
    expect(result.reason.missing).toContain('uncertainty');
  });

  it('四要素出现空数组 ⇒ MISSING_FIELDS（不当成"没内容"放过）', () => {
    const result = parseHypothesis(JSON.stringify({ ...valid, relations: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('MISSING_FIELDS');
    expect(result.reason.missing).toContain('relations');
  });

  it('数组里有空字符串元素 ⇒ WRONG_TYPE（不补默认、不静默丢弃）', () => {
    const result = parseHypothesis(JSON.stringify({ ...valid, evidence: ['  '] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('WRONG_TYPE');
    expect(result.reason.missing).toContain('evidence');
  });

  it('字段类型错（objects 是字符串而非数组）⇒ WRONG_TYPE', () => {
    const result = parseHypothesis(JSON.stringify({ ...valid, objects: 'node-1' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe('WRONG_TYPE');
    expect(result.reason.missing).toContain('objects');
  });

  it('hypothesis 为空串 ⇒ MISSING_FIELDS', () => {
    const result = parseHypothesis(JSON.stringify({ ...valid, hypothesis: '   ' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.missing).toContain('hypothesis');
  });
});

describe('truncateHypothesisText — invalid 事件的文本上限', () => {
  it('未超限 ⇒ 原样返回，truncated=false', () => {
    const short = 'x'.repeat(10);
    expect(truncateHypothesisText(short)).toEqual({ text: short, truncated: false });
  });

  it('超限 ⇒ 截到上限，truncated=true', () => {
    const long = 'y'.repeat(HYPOTHESIS_TEXT_LIMIT + 50);
    const result = truncateHypothesisText(long);
    expect(result.text.length).toBe(HYPOTHESIS_TEXT_LIMIT);
    expect(result.truncated).toBe(true);
  });
});
