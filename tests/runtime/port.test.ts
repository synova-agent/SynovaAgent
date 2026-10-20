/**
 * tests/runtime/port.test.ts — 运行时端口契约 ＋ 两 Provider 同套断言（M5 卡2 / #703）
 *
 * 被测对象: `src/runtime/port.ts`（Contract）＋ `src/runtime/impl/{real,stub}.ts`（两个 Provider）
 *
 * 判据结构（恰好 7 条，SPEC §9.6）:
 *   ① 未设 ⇒ 'real'（缺省真宿主）
 *   ② 'real' / 'stub' 原样返回（精确匹配，不归一化）
 *   ③ 非法值（'' / ' smoke' / 'REAL'，表驱动）⇒ RuntimePortError（fail loud，不降级 real）
 *   ④⑤ describe.each 两 Provider：sentinel_list 与 listSentinels() 一致（同套断言跑两遍）
 *   ⑥⑦ describe.each 两 Provider：审批无 ask ⇒ 拒（fail-closed 常开，不随 Provider 变）
 *
 * 为什么两 Provider 用同一套断言：这是承诺①「换宿主不改领域」的可判据面（不是两个文件各测各的）。
 *
 * 契约:
 *   @input  — 端口契约 ＋ 两个 Provider 工厂
 *   @output — 断言通过/失败；不做 I/O、不 spawn 子进程（全链路判据在 tests/mcp/server-smoke.test.ts S8）
 *   @degraded — 本文件无降级路径：非法 provider 值必须抛 typed error（不是"回落到 real"）
 */
import { describe, it, expect } from 'vitest';
import { RuntimePortError, resolveRuntimeProvider, type RuntimePort } from '../../src/runtime/port';
import { createRealPort } from '../../src/runtime/impl/real';
import { createStubPort } from '../../src/runtime/impl/stub';
import { HIGH_RISK_ACTIONS } from '../../src/runtime/approval-seam';
import { listSentinels } from '../../src/agent/sentinel-service';
import { handleToolCall } from '../../src/mcp/tool-definitions';

/** 审批请求者标识（探针/测试侧） */
const ACTOR = 'port.test';

/**
 * 两 Provider 的构造表 —— real 注入**生产同款**派发（`handleToolCall`），
 * 这样"sentinel_list 与 listSentinels 一致"验的是真装配路径，不是测试自己造的第二套逻辑。
 */
const PROVIDERS: ReadonlyArray<{ readonly id: 'real' | 'stub'; readonly make: () => RuntimePort }> = [
  { id: 'real', make: () => createRealPort({ dispatch: handleToolCall }) },
  { id: 'stub', make: () => createStubPort() },
];

// ══════════════════════════════════════════════════════════════════════════════
// ①–③ provider 解析边界
// ══════════════════════════════════════════════════════════════════════════════

describe('①–③ resolveRuntimeProvider（SYNOVA_RUNTIME_PROVIDER 边界）', () => {
  it('① 未设置 ⇒ real（缺省真宿主；不是"没有宿主"）', () => {
    expect(resolveRuntimeProvider(undefined)).toBe('real');
  });

  it('② 合法值原样返回（精确匹配，不 trim、不改大小写）', () => {
    expect(resolveRuntimeProvider('real')).toBe('real');
    expect(resolveRuntimeProvider('stub')).toBe('stub');
  });

  it('③ 非法值表驱动 ⇒ RuntimePortError（code/phase/retryable 齐全；不降级 real）', () => {
    // 表驱动：逐项断言同一错误契约（'' 与 ' smoke' 防 trim、'REAL' 防大小写归一化）
    const INVALID_VALUES: ReadonlyArray<{ readonly label: string; readonly raw: string }> = [
      { label: '空串', raw: '' },
      { label: '前导空格', raw: ' smoke' },
      { label: '大写', raw: 'REAL' },
      { label: '未知值', raw: 'smoke' },
    ];
    for (const { label, raw } of INVALID_VALUES) {
      let caught: unknown;
      try {
        resolveRuntimeProvider(raw);
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught, `非法值「${label}」(${JSON.stringify(raw)}) 必须抛出，而不是静默降级 real`).toBeInstanceOf(RuntimePortError);
      const portError = caught as RuntimePortError;
      expect(portError.code).toBe('RUNTIME_PROVIDER_INVALID');
      expect(portError.phase).toBe('runtime-port');
      expect(portError.retryable).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ④–⑦ 两 Provider 同套断言（承诺①：换宿主不改领域；承诺③：审批语义不变）
// ══════════════════════════════════════════════════════════════════════════════

describe.each(PROVIDERS)('Provider $id（同一套断言，换宿主不改领域）', ({ id, make }) => {
  it(`④ ${id}: sentinel_list 与 listSentinels() 一致（real 走 handleToolCall 真派发；stub 复用 L2 出口）`, async () => {
    const port = make();
    const text = await port.callTool('sentinel_list', {});
    const direct = await listSentinels();
    expect(port.providerId).toBe(id);
    expect(typeof text).toBe('string');
    // 深等：两 Provider 的应答必须与同一 L2 出口逐字段一致（不是"都返回了非空字符串"）
    expect(JSON.parse(text)).toEqual(direct);
  });

  it(`⑤ ${id}: 审批无 ask ⇒ 拒（policy 定义的确定拒：rejected ∧ allowed:false ∧ degraded:false）`, async () => {
    const port = make();
    const outcome = await port.requestApproval({ action: HIGH_RISK_ACTIONS[0], actor: ACTOR });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.degraded).toBe(false);
    expect(outcome.action).toBe(HIGH_RISK_ACTIONS[0]);
  });
});
