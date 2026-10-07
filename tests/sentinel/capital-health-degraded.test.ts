/**
 * tests/sentinel/capital-health-degraded.test.ts — D356 P1-3 缺字段误报修复测试（D358 fixtures 改 snake）
 *
 * 覆盖 K3 全链路审计 (AGENT-CAPABILITY-FULL-CHAIN-AUDIT-20260813) P1-3 / T3-a:
 * capital-health 合并三个 _extinct 退役子哨兵，子哨兵对缺失字段 `Number(x)||0`
 * 兜底成 0 产出假 critical（实测: 注入 {revenue:100} 单 Financial 节点 → 2 critical）。
 *
 * D356 修复方案 (dev doc §4.5 决策): capital-health 入口字段完整性校验 —
 * 调用子哨兵前查 Financial 节点必填字段，缺失即返回 degraded finding 并跳过子哨兵。
 * D358 真实化: 入口校验字段名对齐 erp-standard（camel → snake_case），
 * 校验通过后由自家 computes/ 计算（不再动态 import _extinct 子哨兵）。
 *
 * red 基线: 修复前部分字段注入产 2 critical（icr=0 假 critical + 资产周转率 0 假 critical）→ red。
 */
import { describe, it, expect } from 'vitest';
import { capitalHealthSentinel } from '../../extensions/sentinels/capital-health/aggregate';
import type { SentinelFinding } from '../../src/sentinel/types';

interface MockNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

function storeWith(nodes: MockNode[]) {
  return {
    queryNodes(_type: string, _filters?: Record<string, unknown>): MockNode[] {
      return nodes;
    },
  };
}

/** K3 T3-a 复现 fixture（snake 化）: 只有 total_revenue 的 Financial 节点（其余字段全缺失） */
const partialFinancial = () => storeWith([
  { id: 'f1', type: 'Financial', props: { total_revenue: 100 } },
]);

/** 完整字段 fixture（snake 化）: 入口字段组全齐（D/E=80/20=4 → 真实 critical；ICR=10/30 → 真实 critical） */
const completeFinancial = () => storeWith([
  {
    id: 'f1', type: 'Financial',
    props: {
      total_revenue: 100, total_assets: 50, total_debt: 80, equity: 20,
      operating_cashflow: 10, operating_expense: 40,
      interest_expense: 30,
    },
  },
]);

// #1375 B3b（必要连带）：capital-health 现返回 { findings, metrics }（A2 形态）
//   ⇒ 用包装函数归一化（**只改函数名**，不动既有断言与多行调用结构）
async function checkFindings(
  store: Parameters<typeof capitalHealthSentinel.check>[0],
  tid: string,
): Promise<Awaited<ReturnType<typeof capitalHealthSentinel.check>> extends readonly unknown[] ? unknown[] : unknown[]> {
  const r = await capitalHealthSentinel.check(store, tid);
  return (Array.isArray(r) ? r : (r as { findings: unknown[] }).findings) as unknown[];
}

describe('D356 P1-3: capital-health 缺字段不默认为 0', () => {
  it('部分字段注入不产 critical，改发 degraded 提示（修复前产 2 critical → red）', async () => {
    const findings = await checkFindings(partialFinancial(), 't1');

    // 修复前: ICR ebit=0/interest=0 → icr=0 < 1.5 critical + 资产周转率 totalAssets=0 → 0 < 0.5 critical → red
    expect(findings.filter(f => f.severity === 'critical')).toHaveLength(0);
    expect(findings.some(f => f.id.startsWith('ch-degraded'))).toBe(true);

    const degraded = findings.find(f => f.id.startsWith('ch-degraded')) as SentinelFinding;
    expect(degraded.severity).toBe('warning');
    // degraded finding 必须点名缺失字段，可指导补数（不是静默吞掉）
    expect(degraded.evidence[0]).toContain('total_debt');
    expect(degraded.evidence[0]).toContain('equity');
  });

  it('完整字段仍正常产出 finding（回归: 字段校验不误伤真数据）', async () => {
    const findings = await checkFindings(completeFinancial(), 't1');

    // D/E=4 > 2.5 + ICR=0.33 < 1.5 → 真实 critical（与修复前一致）
    expect(findings.some(f => f.severity === 'critical')).toBe(true);
    expect(findings.some(f => f.id.startsWith('ch-degraded'))).toBe(false);
  });

  it('无 Financial 节点返回空 findings（维持 K3 T2-b 空库基线行为）', async () => {
    const findings = await checkFindings(storeWith([]), 't1');
    expect(findings).toHaveLength(0);
  });

  it('存储查询抛错返回 warning 错误 finding，不误报 critical', async () => {
    const broken = {
      queryNodes(): MockNode[] {
        throw new Error('db connection lost');
      },
    };

    const findings = await checkFindings(broken, 't1');

    expect(findings.filter(f => f.severity === 'critical')).toHaveLength(0);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => f.severity === 'warning')).toBe(true);
  });

  it('字段显式为 0 视为合法数据（缺失≠零，边界态），且不产假 critical（D358 升级）', async () => {
    // 入口校验只判存在性，不得把显式 0 判为"字段缺失"（否则会拦住真数据、误导用户补数）
    const zeroValued = storeWith([
      {
        id: 'f1', type: 'Financial',
        props: {
          total_revenue: 0, total_assets: 0, total_debt: 0, equity: 0,
          operating_cashflow: 0, operating_expense: 0,
        },
      },
    ]);

    const findings = await checkFindings(zeroValued, 't1');

    // 入口校验放行（字段存在）→ 指标层分母 0 全部 degrade → 无 ch-degraded
    expect(findings.some(f => f.id.startsWith('ch-degraded'))).toBe(false);
    // D358 升级: 修复前显式 0 经子哨兵 Number(0)||0 路径产出假 critical（f5-at-crit 等）→ red
    expect(findings.filter(f => f.severity === 'critical')).toHaveLength(0);
  });
});
