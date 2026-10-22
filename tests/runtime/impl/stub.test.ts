/**
 * tests/runtime/impl/stub.test.ts — stub Provider 配对测试（M5 卡2 / #703）
 *
 * 被测对象: `src/runtime/impl/stub.ts`（`createStubPort`）
 *
 * 判据结构（3 条，SPEC §9.6）:
 *   ① 与 listSentinels() 深等 —— 假宿主复用 L2 出口，不做第二套领域逻辑
 *   ② 未支持工具 ⇒ typed `RUNTIME_TOOL_UNSUPPORTED`（不静默吞、不装作成功）
 *   ③ 默认无人应答 ⇒ 拒；注入 approved 应答 ⇒ 准（承诺③：审批语义不随 Provider 变）
 *
 * 契约:
 *   @input  — createStubPort({ ask? })：默认构造 & 注入应答端口两种形态
 *   @output — 断言通过/失败；无 I/O、无子进程、不写文件/不落库
 *   @degraded — 未支持工具是**结构化降级**（degraded:true）而不是异常，本文件正是它的判据
 */
import { describe, it, expect } from 'vitest';
import { createStubPort } from '../../../src/runtime/impl/stub';
import { HIGH_RISK_ACTIONS } from '../../../src/runtime/approval-seam';
import { listSentinels } from '../../../src/agent/sentinel-service';

describe('stub Provider（假宿主）', () => {
  it('① sentinel_list 复用 L2 出口：与 listSentinels() 深等（不是按 manifest 造的第二套清单）', async () => {
    const port = createStubPort();
    const text = await port.callTool('sentinel_list', {});
    const direct = await listSentinels();
    expect(port.providerId).toBe('stub');
    expect(typeof text).toBe('string');
    expect(JSON.parse(text)).toEqual(direct);
  });

  it('② 未支持工具 ⇒ typed RUNTIME_TOOL_UNSUPPORTED（结构化 ok:false，不抛协议崩溃）', async () => {
    const port = createStubPort();
    const runResult = JSON.parse(await port.callTool('sentinel_run', { sentinelId: 'F1' })) as {
      ok: boolean;
      error?: string;
      tool?: string;
      degraded?: boolean;
    };
    expect(runResult).toEqual({
      ok: false,
      error: 'RUNTIME_TOOL_UNSUPPORTED',
      tool: 'sentinel_run',
      degraded: true,
    });
    // 任意未支持工具同形（tool 字段回声请求名，便于定位"假宿主漏了哪个工具"）
    const otherResult = JSON.parse(await port.callTool('diagnose_organization', {})) as { tool?: string };
    expect(otherResult.tool).toBe('diagnose_organization');
  });

  it('③ 审批默认无人应答 ⇒ 拒；注入 approved 应答 ⇒ 准（fail-closed 常开）', async () => {
    const request = { action: HIGH_RISK_ACTIONS[0], actor: 'stub.test' };
    const rejected = await createStubPort().requestApproval(request);
    expect(rejected.decision).toBe('rejected');
    expect(rejected.allowed).toBe(false);
    // 确定结论（政策定义的拒），不是"判不了"的降级
    expect(rejected.degraded).toBe(false);

    const approved = await createStubPort({ ask: () => 'approved' }).requestApproval(request);
    expect(approved.decision).toBe('approved');
    expect(approved.allowed).toBe(true);
    expect(approved.degraded).toBe(false);
  });
});
