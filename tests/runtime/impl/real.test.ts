/**
 * tests/runtime/impl/real.test.ts — real Provider 配对测试（M5 卡2 / #703）
 *
 * 被测对象: `src/runtime/impl/real.ts`（`createRealPort`）
 *
 * 判据结构（3 条，SPEC §9.6）:
 *   ① dispatch 透传 —— 调用参数不加工、返回值原样透传（`callTool === dispatch`）
 *   ② dispatch 抛错 ⇒ 原样 reject（不吞错；错误文本原样上浮，交既有 SDK 映射）
 *   ③ requestApproval 原样委托 approval-seam（有答批准 ⇒ 准；不新增审批语义）
 *
 * 契约:
 *   @input  — createRealPort({ dispatch })：探针 dispatch 由本文件注入
 *   @output — 断言通过/失败；无 I/O、无子进程
 *   @degraded — 本文件无降级：real Provider 的契约就是"不吞错、不降级"
 */
import { describe, it, expect, vi } from 'vitest';
import { createRealPort } from '../../../src/runtime/impl/real';
import { HIGH_RISK_ACTIONS } from '../../../src/runtime/approval-seam';

describe('real Provider（真宿主）', () => {
  it('① dispatch 透传：callTool === dispatch，参数/返回值一字不改', async () => {
    const dispatch = vi.fn(async (_name: string, _args: Record<string, unknown>) => '{"ok":true,"from":"probe"}');
    const port = createRealPort({ dispatch });
    // 同一函数引用 —— 不包 try/catch、不改写返回值（契约字面要求）
    expect(port.callTool).toBe(dispatch);
    expect(port.providerId).toBe('real');
    const text = await port.callTool('sentinel_list', { nested: { a: 1 } });
    expect(text).toBe('{"ok":true,"from":"probe"}');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('sentinel_list', { nested: { a: 1 } });
  });

  it('② dispatch 抛错 ⇒ 原样 reject（不吞错、不改错误文本）', async () => {
    const dispatch = async (): Promise<string> => {
      throw new Error('DISPATCH_BOOM');
    };
    const port = createRealPort({ dispatch });
    // 不吞错：错误穿透到调用方（既有 MCP SDK 负责映射 JSON-RPC error，行为不变）
    await expect(port.callTool('sentinel_run', { sentinelId: 'F1' })).rejects.toThrow('DISPATCH_BOOM');
  });

  it('③ requestApproval 原样委托 approval-seam（有答批准 ⇒ 准，不新增语义）', async () => {
    const port = createRealPort({ dispatch: async () => '{}' });
    const outcome = await port.requestApproval({
      action: HIGH_RISK_ACTIONS[0],
      actor: 'real.test',
      ask: () => 'approved',
    });
    expect(outcome.decision).toBe('approved');
    expect(outcome.allowed).toBe(true);
    expect(outcome.degraded).toBe(false);
    // 委派证据：留痕动作来自请求本身（说明没有换一套策略/动作名）
    expect(outcome.action).toBe(HIGH_RISK_ACTIONS[0]);
    expect(outcome.audit.code).toBe('APPROVAL_GRANTED');
  });
});
