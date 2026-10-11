/**
 * tests/sentinel/agent-opportunity-window.test.ts — K3-3-8 AI 化机会窗口哨兵（#37）
 *
 * 铁律 48 三路径: 正常（越增强阈值 ⇒ polarity='positive' 正向发现）/
 * 降级（空图 ⇒ degraded=true）/ 边界（阈值不可达 ⇒ 0 正向发现；score==warning 恰好开启）。
 * 接线（铁律 0-2/5）: 断言生产 loader loadSentinels() 扫描到该哨兵（真实 extensions/sentinels 管线）。
 */
import { describe, it, expect } from 'vitest';
import { loadSentinels } from '../../src/sentinel/sentinel-loader';
import { toImportSpecifier } from '../../src/sentinel/builtins';
import { computeAgentOpportunityWindow } from '../../extensions/sentinels/agent-opportunity-window/computes/compute-agent-opportunity-window';
import type { SentinelFinding, SentinelAggregateResult } from '../../src/sentinel/types';

interface Node { id: string; type: string; props: Record<string, unknown> }
interface GSR { queryNodes(t: string, f?: Record<string, unknown>): Node[] }
interface Checkable {
  check(s: GSR, tid: string, traversal?: unknown, thresholds?: Record<string, { warning: number; critical: number }>): Promise<SentinelFinding[] | SentinelAggregateResult>;
}

function favorableStore(): GSR {
  return {
    queryNodes(t: string): Node[] {
      if (t === 'Tool') {
        return [
          { id: 't1', type: 'Tool', props: { tid: 'org-x', llm: true } },
          { id: 't2', type: 'Tool', props: { tid: 'org-x', protocol: 'http' } },
          { id: 't3', type: 'Tool', props: { tid: 'org-x', agent: true } },
          { id: 't4', type: 'Tool', props: { tid: 'org-x' } },
        ];
      }
      if (t === 'Process') {
        return [
          { id: 'p1', type: 'Process', props: { tid: 'org-x', digitized: true } },
          { id: 'p2', type: 'Process', props: { tid: 'org-x', automated: true } },
          { id: 'p3', type: 'Process', props: { tid: 'org-x', digitized: true } },
          { id: 'p4', type: 'Process', props: { tid: 'org-x' } },
          { id: 'p5', type: 'Process', props: { tid: 'org-x' } },
        ];
      }
      return [];
    },
  };
}
const emptyStore: GSR = { queryNodes: () => [] };

function positiveOf(r: SentinelFinding[] | SentinelAggregateResult): SentinelFinding[] {
  const findings = Array.isArray(r) ? r : r.findings;
  return findings.filter(f => f.polarity === 'positive');
}

describe('compute-agent-opportunity-window（契约三路径）', () => {
  it('正常路径: 各维按比例计算，score ∈ [0,1]', () => {
    const r = computeAgentOpportunityWindow({ agentReadyTools: 3, totalTools: 4, digitizedProcesses: 3, totalProcesses: 5 });
    expect(r.degraded).toBe(false);
    expect(r.score).toBeCloseTo(0.35 * 0.75 + 0.35 * 0.6 + 0.3 * 0.75, 2);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
  it('降级路径: 无工具且无流程 ⇒ degraded=true，score=0', () => {
    const r = computeAgentOpportunityWindow({ agentReadyTools: 0, totalTools: 0, digitizedProcesses: 0, totalProcesses: 0 });
    expect(r.degraded).toBe(true);
    expect(r.score).toBe(0);
  });
  it('边界: 上限截断（超量输入不越界 [0,1]）', () => {
    const r = computeAgentOpportunityWindow({ agentReadyTools: 99, totalTools: 2, digitizedProcesses: 50, totalProcesses: 10 });
    expect(r.toolingReadiness).toBe(1);
    expect(r.processReadiness).toBe(1);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

describe('agent-opportunity-window 哨兵（loader 接线 + 报正向 + 增强阈值门控）', () => {
  it('接线: 生产 loader 扫描到该哨兵，manifest 与 computes 目录一致', async () => {
    const { sentinels } = loadSentinels();
    const found = sentinels.find(s => s.manifest.name === 'agent-opportunity-window');
    expect(found).toBeDefined();
    expect(found?.manifest.computes).toEqual(['compute-agent-opportunity-window']);
    expect(found?.manifest.exportKey).toBe('AgentOpportunityWindowSentinel');
  });

  it('正常路径: 越过增强阈值 ⇒ 恰 1 条 polarity=positive / severity=info / 证据非空', async () => {
    const { sentinels } = loadSentinels();
    const found = sentinels.find(s => s.manifest.name === 'agent-opportunity-window');
    expect(found).toBeDefined();
    const mod = (await import(toImportSpecifier(found!.dir + '/aggregate.ts'))) as Record<string, unknown>;
    const obj = mod.AgentOpportunityWindowSentinel as Checkable & { manifest?: unknown };
    expect(typeof obj.check).toBe('function');
    // 生产接线复刻（loader P0-1）：挂载 manifest，阈值来自声明文件
    if ('manifest' in obj) obj.manifest = found!.manifest;
    const r = await obj.check(favorableStore(), 'org-x');
    const positives = positiveOf(r);
    expect(positives).toHaveLength(1);
    expect(positives[0].severity).toBe('info');
    expect(positives[0].evidence.length).toBeGreaterThan(0);
    expect(positives[0].suggestion.length).toBeGreaterThan(0);
    if (!Array.isArray(r)) expect(Array.isArray(r.findings)).toBe(true);
  });

  it('边界(反例): 增强阈值不可达 ⇒ 正向发现为 0（阈值真实门控，改坏即红）', async () => {
    const { sentinels } = loadSentinels();
    const found = sentinels.find(s => s.manifest.name === 'agent-opportunity-window');
    const mod = (await import(toImportSpecifier(found!.dir + '/aggregate.ts'))) as Record<string, unknown>;
    const obj = mod.AgentOpportunityWindowSentinel as Checkable;
    const r = await obj.check(favorableStore(), 'org-x', undefined, { opportunityScore: { warning: 9, critical: 10 } });
    expect(positiveOf(r)).toHaveLength(0);
  });

  it('降级路径: 空图 ⇒ degraded=true（铁律 24/31）', async () => {
    const { sentinels } = loadSentinels();
    const found = sentinels.find(s => s.manifest.name === 'agent-opportunity-window');
    const mod = (await import(toImportSpecifier(found!.dir + '/aggregate.ts'))) as Record<string, unknown>;
    const obj = mod.AgentOpportunityWindowSentinel as Checkable;
    const r = await obj.check(emptyStore, 'org-x');
    expect(Array.isArray(r)).toBe(false);
    expect((r as SentinelAggregateResult).degraded).toBe(true);
  });
});
