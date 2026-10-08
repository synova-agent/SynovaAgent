/**
 * tests/contract/compute-registry.test.ts — D1048 (W4) compute 契约注册表 测试
 *
 * 覆盖三路径（铁律 48）:
 *   正常路径 — resolve + 静态校验 + 真调用（COMPUTE-HHI-v1）
 *   降级路径 — 未注册 ID / 实现文件缺失 / 导出符号缺失 ⇒ fail-closed 抛错（含 code/phase/retryable 分类）
 *   边界条件 — 契约实现自身的空输入降级 + 注册表覆盖面断言
 */
import { describe, it, expect } from 'vitest';
import {
  COMPUTE_CONTRACTS,
  REQUIRED_COMPUTE_CONTRACT_IDS,
  ComputeContractError,
  assertImplementationExists,
  invokeComputeContract,
  resolveComputeContract,
} from '../../src/contract/compute-registry';
import type { ComputeContractEntry } from '../../src/contract/compute-registry';

const REPO_ROOT = process.cwd();

const ghostEntry = (over: Partial<ComputeContractEntry>): ComputeContractEntry => ({
  contractId: 'COMPUTE-GHOST-v1',
  file: 'extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts',
  exportName: 'computeHHI',
  fixture: [],
  expectedKeys: [],
  declaredBy: [],
  ...over,
});

describe('compute-registry (D1048/W4)', () => {
  // ─── 正常路径 ───
  it('正常路径: COMPUTE-HHI-v1 resolve → 实现文件/符号命中 → 真调用成功', async () => {
    const entry = resolveComputeContract('COMPUTE-HHI-v1');
    expect(entry.file).toBe('extensions/sentinels/shared/computes/l4-competition/compute-hhi.ts');

    const hit = assertImplementationExists(entry, REPO_ROOT);
    expect(hit.exportName).toBe('computeHHI');
    expect(hit.sourceLine).toBeGreaterThan(0);
    expect(hit.declaredAtLine).toBeGreaterThan(0); // 实现文件 JSDoc 里的 `契约ID:` 行

    const res = await invokeComputeContract('COMPUTE-HHI-v1', REPO_ROOT);
    expect(res.hit.relPath).toContain('compute-hhi.ts');
    expect(res.value.degraded).toBe(false);
    expect(res.value.hhi).toBeCloseTo(0.3, 6);
    expect(res.value.firmCount).toBe(4);
  });

  it('正常路径: 三条注册契约全部可 resolve 且实现文件存在', () => {
    expect(COMPUTE_CONTRACTS.length).toBe(3);
    for (const entry of COMPUTE_CONTRACTS) {
      const hit = assertImplementationExists(entry, REPO_ROOT);
      expect(hit.sourceLine).toBeGreaterThan(0);
    }
  });

  // ─── 降级路径（fail-closed：缺失即抛，不返回 degraded 静默通过） ───
  it('降级路径: 未注册契约 ID → ComputeContractError(phase=resolve)', () => {
    expect(() => resolveComputeContract('COMPUTE-NOT-REGISTERED-v9')).toThrowError(ComputeContractError);
    try {
      resolveComputeContract('COMPUTE-NOT-REGISTERED-v9');
      throw new Error('unreachable: 未注册 ID 竟然 resolve 成功');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ComputeContractError);
      const e = err as ComputeContractError;
      expect(e.phase).toBe('resolve');
      expect(e.code).toBe('COMPUTE_CONTRACT_RESOLVE_FAILED');
      expect(e.retryable).toBe(false);
    }
  });

  it('降级路径: 实现文件不存在 → ComputeContractError(phase=file)', () => {
    const ghost = ghostEntry({ file: 'extensions/sentinels/shared/computes/l4-competition/__missing__.ts' });
    expect(() => assertImplementationExists(ghost, REPO_ROOT)).toThrowError(ComputeContractError);
    try {
      assertImplementationExists(ghost, REPO_ROOT);
    } catch (err: unknown) {
      const e = err as ComputeContractError;
      expect(e.phase).toBe('file');
      expect(e.contractId).toBe('COMPUTE-GHOST-v1');
    }
  });

  it('降级路径: 文件存在但导出符号缺失 → ComputeContractError(phase=symbol)', () => {
    const ghost = ghostEntry({ exportName: 'computeSymbolThatDoesNotExist' });
    expect(() => assertImplementationExists(ghost, REPO_ROOT)).toThrowError(ComputeContractError);
    try {
      assertImplementationExists(ghost, REPO_ROOT);
    } catch (err: unknown) {
      const e = err as ComputeContractError;
      expect(e.phase).toBe('symbol');
      expect(e.code).toBe('COMPUTE_CONTRACT_SYMBOL_FAILED');
    }
  });

  // ─── 边界条件 ───
  it('边界: 契约实现自身空输入 → degraded=true（数据不足不伪装成正常）', async () => {
    const mod = (await import('../../extensions/sentinels/shared/computes/l4-competition/compute-hhi')) as {
      computeHHI: (shares: number[]) => { hhi: number; degraded: boolean; warnings: string[] };
    };
    const empty = mod.computeHHI([]);
    expect(empty.degraded).toBe(true);
    expect(empty.hhi).toBe(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });

  it('边界: 卡面指名契约必须在注册表内（覆盖面断言）', () => {
    const registered = COMPUTE_CONTRACTS.map((c) => c.contractId);
    expect(REQUIRED_COMPUTE_CONTRACT_IDS).toContain('COMPUTE-HHI-v1');
    for (const id of REQUIRED_COMPUTE_CONTRACT_IDS) {
      expect(registered).toContain(id);
    }
  });
});
