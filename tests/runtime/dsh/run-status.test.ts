/**
 * tests/runtime/dsh/run-status.test.ts — #1502 判定表逐条（纯函数层，无 I/O）。
 *
 * 配对对象：`src/runtime/dsh/session.ts` 的 `deriveRunStatuses`
 * 覆盖：票面判定表 9 条 + 优先级链 failed > partial > insufficient_data > invalid_output > no_output > success
 *      ＋ 禁止默认 success（上下文未观察不判成功）＋ 两字段正交（传输位与业务位互不推导）。
 */
import { describe, expect, it } from 'vitest';
import { deriveRunStatuses, type TerminalRunFacts } from '../../../src/runtime/dsh/session';

/** 判定输入的基准事实：一条「域上下文 count>0 且结构化假设成立」的正常轮次。 */
function facts(overrides: Partial<TerminalRunFacts> = {}): TerminalRunFacts {
  return {
    terminal: 'run.completed',
    stopReason: 'end_turn',
    failureCode: null,
    textDeltas: 1,
    toolSuccesses: 1,
    toolFailures: 0,
    hypothesis: 'structured',
    domainContextCount: 2,
    domainContextInsufficient: false,
    ...overrides,
  };
}

describe('#1502 判定表：outcomeStatus 逐条', () => {
  it('域上下文 insufficient／count=0 ⇒ insufficient_data（优先级高于 success）', () => {
    const withInsufficient = deriveRunStatuses(facts({
      domainContextCount: 0,
      domainContextInsufficient: true,
    }));
    expect(withInsufficient.outcomeStatus).toBe('insufficient_data');

    // count=0 但工具没带 insufficient 字段（形状不完整）同样落 insufficient_data
    const countZeroOnly = deriveRunStatuses(facts({ domainContextCount: 0 }));
    expect(countZeroOnly.outcomeStatus).toBe('insufficient_data');
  });

  it('tool.finished.isError=true 且无有效产物 ⇒ failed', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 0,
      toolSuccesses: 0,
      toolFailures: 1,
      hypothesis: 'none',
      domainContextCount: null,
    }));
    expect(bits.outcomeStatus).toBe('failed');
  });

  it('tool.finished.isError=true 但有产物 ⇒ partial', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 1,
      toolFailures: 1,
      hypothesis: 'invalid',
    }));
    expect(bits.outcomeStatus).toBe('partial');
  });

  it('hypothesis.invalid 且文本非空 ⇒ invalid_output', () => {
    const bits = deriveRunStatuses(facts({ hypothesis: 'invalid', toolFailures: 0 }));
    expect(bits.outcomeStatus).toBe('invalid_output');
  });

  it('无文本（textDeltas=0 且无工具产物）⇒ no_output', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 0,
      toolSuccesses: 0,
      hypothesis: 'none',
      domainContextCount: null,
    }));
    expect(bits.outcomeStatus).toBe('no_output');
  });

  it('hypothesis.structured 且上下文 count>0 ⇒ success（唯一判成功的路径）', () => {
    const bits = deriveRunStatuses(facts({ domainContextCount: 3 }));
    expect(bits.outcomeStatus).toBe('success');
  });

  it('stopReason=cancelled ⇒ transportStatus=cancelled，且 outcome 不得为 success', () => {
    // 即便事实齐全（结构化假设＋count>0），取消也不得判成功
    const bits = deriveRunStatuses(facts({
      terminal: 'run.cancelled',
      stopReason: 'cancelled',
      domainContextCount: 3,
    }));
    expect(bits.transportStatus).toBe('cancelled');
    expect(bits.outcomeStatus).not.toBe('success');
    expect(bits.outcomeStatus).toBe('partial');

    // 取消且毫无产出 ⇒ no_output（仍不是 success）
    const empty = deriveRunStatuses(facts({
      terminal: 'run.cancelled',
      stopReason: 'cancelled',
      textDeltas: 0,
      toolSuccesses: 0,
      hypothesis: 'none',
      domainContextCount: null,
    }));
    expect(empty.outcomeStatus).toBe('no_output');
    expect(empty.outcomeStatus).not.toBe('success');
  });

  it('stopReason=refusal ⇒ failed（有文本也不改判）', () => {
    const noText = deriveRunStatuses(facts({
      terminal: 'run.failed',
      stopReason: 'refusal',
      failureCode: 'RUN_FAILED',
      textDeltas: 0,
      toolSuccesses: 0,
      hypothesis: 'none',
      domainContextCount: null,
    }));
    expect(noText.outcomeStatus).toBe('failed');

    const withText = deriveRunStatuses(facts({
      terminal: 'run.failed',
      stopReason: 'refusal',
      failureCode: 'RUN_FAILED',
    }));
    expect(withText.outcomeStatus).toBe('failed');
  });

  it('超时/断连 ⇒ transportStatus=disconnected（超时与断连各一条）', () => {
    for (const failureCode of ['RUN_TIMEOUT', 'SIDECAR_SESSION_LOST']) {
      const bits = deriveRunStatuses(facts({
        terminal: 'run.failed',
        stopReason: null,
        failureCode,
        textDeltas: 0,
        toolSuccesses: 0,
        hypothesis: 'none',
        domainContextCount: null,
      }));
      expect(bits.transportStatus, failureCode).toBe('disconnected');
      expect(bits.outcomeStatus, failureCode).toBe('failed');
    }
  });
});

describe('#1502 优先级：failed > partial > insufficient_data > invalid_output > no_output > success', () => {
  it('failed 高于 insufficient_data：工具失败且无产物 + count=0 ⇒ failed', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 0,
      toolSuccesses: 0,
      toolFailures: 1,
      hypothesis: 'none',
      domainContextCount: 0,
      domainContextInsufficient: true,
    }));
    expect(bits.outcomeStatus).toBe('failed');
  });

  it('partial 高于 insufficient_data：工具失败但有产物 + count=0 ⇒ partial', () => {
    const bits = deriveRunStatuses(facts({
      toolFailures: 1,
      hypothesis: 'invalid',
      domainContextCount: 0,
      domainContextInsufficient: true,
    }));
    expect(bits.outcomeStatus).toBe('partial');
  });

  it('insufficient_data 高于 invalid_output：假设不合格 + count=0 ⇒ insufficient_data', () => {
    const bits = deriveRunStatuses(facts({
      hypothesis: 'invalid',
      domainContextCount: 0,
      domainContextInsufficient: true,
    }));
    expect(bits.outcomeStatus).toBe('insufficient_data');
  });

  it('insufficient_data 高于 success：结构化假设 + count=0 ⇒ insufficient_data', () => {
    const bits = deriveRunStatuses(facts({
      hypothesis: 'structured',
      domainContextCount: 0,
    }));
    expect(bits.outcomeStatus).toBe('insufficient_data');
  });

  it('invalid_output 高于 success：结构化条件不成立时不得判成功', () => {
    const bits = deriveRunStatuses(facts({
      hypothesis: 'invalid',
      domainContextCount: 9,
    }));
    expect(bits.outcomeStatus).toBe('invalid_output');
  });

  it('no_output 高于 success：无文本无工具产物即便 count>0 也不判成功', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 0,
      toolSuccesses: 0,
      hypothesis: 'none',
      domainContextCount: 5,
    }));
    expect(bits.outcomeStatus).toBe('no_output');
    expect(bits.outcomeStatus).not.toBe('success');
  });
});

describe('#1502 禁止默认 success / 两字段正交', () => {
  it('上下文未观察（count=null）时结构化假设不得判 success ⇒ insufficient_data', () => {
    const bits = deriveRunStatuses(facts({ domainContextCount: null }));
    expect(bits.outcomeStatus).toBe('insufficient_data');
    expect(bits.outcomeStatus).not.toBe('success');
  });

  it('有工具产物但无模型文本/假设 ⇒ partial（有产出未完整），不落 success', () => {
    const bits = deriveRunStatuses(facts({
      textDeltas: 0,
      toolSuccesses: 1,
      hypothesis: 'none',
      domainContextCount: 2,
    }));
    expect(bits.outcomeStatus).toBe('partial');
    expect(bits.outcomeStatus).not.toBe('success');
  });

  it('传输位与业务位互不推导：流正常收尾但业务失败 / 断连但业务成功都成立', () => {
    const streamEndedFailed = deriveRunStatuses(facts({
      terminal: 'run.failed',
      stopReason: 'refusal',
      failureCode: 'RUN_FAILED',
    }));
    expect(streamEndedFailed.transportStatus).toBe('stream_ended');
    expect(streamEndedFailed.outcomeStatus).toBe('failed');

    const disconnectedButProduct = deriveRunStatuses(facts({
      terminal: 'run.failed',
      stopReason: null,
      failureCode: 'RUN_TIMEOUT',
    }));
    expect(disconnectedButProduct.transportStatus).toBe('disconnected');
    expect(disconnectedButProduct.outcomeStatus).toBe('partial');
  });

  it('终态 completed 且非超时/断连/取消 ⇒ transportStatus=stream_ended', () => {
    expect(deriveRunStatuses(facts()).transportStatus).toBe('stream_ended');
    // 非断连类失败（协议错误）也是「流已收尾」，不是 disconnected
    expect(deriveRunStatuses(facts({
      terminal: 'run.failed',
      stopReason: null,
      failureCode: 'SIDECAR_PROTOCOL_ERROR',
      textDeltas: 0,
      toolSuccesses: 0,
      hypothesis: 'none',
      domainContextCount: null,
    })).transportStatus).toBe('stream_ended');
  });
});
