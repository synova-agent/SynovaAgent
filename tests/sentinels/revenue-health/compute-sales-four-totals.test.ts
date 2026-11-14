import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeSalesFourTotals,
  type SalesFourTotalsInput,
} from '../../../extensions/sentinels/revenue-health/computes/compute-sales-four-totals';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/sales-four-totals-source.json', import.meta.url),
  'utf8',
)) as SalesFourTotalsInput;

describe('computeSalesFourTotals 契约', () => {
  it('正常路径：按源行独立推导四个总数并精确对账', () => {
    const result = computeSalesFourTotals(fixture);

    expect(result.totals).toEqual({
      orderCount: 3,
      orderAmount: 300.3,
      receivedAmount: 325.25,
      outstandingAmount: -24.95,
    });
    expect(result.differences).toEqual({
      orderCount: 0,
      orderAmount: 0,
      receivedAmount: 0,
      outstandingAmount: 0,
    });
    expect(result.matched).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.sourceOrderIds).toEqual(['SYNTHETIC-001', 'SYNTHETIC-002', 'SYNTHETIC-003']);
  });

  it('边界路径：显式零订单是有效值，不按缺失处理', () => {
    const result = computeSalesFourTotals({
      rows: [{ orderId: 'SYNTHETIC-ZERO', orderAmount: 0, receivedAmount: 0 }],
      baseline: { orderCount: 1, orderAmount: 0, receivedAmount: 0 },
    });

    expect(result.totals).toEqual({
      orderCount: 1,
      orderAmount: 0,
      receivedAmount: 0,
      outstandingAmount: 0,
    });
    expect(result.matched).toBe(true);
    expect(result.degraded).toBe(false);
  });

  it('失败路径（降级）：重复业务键返回稳定 warning 和明确回退值', () => {
    const result = computeSalesFourTotals({
      rows: [
        { orderId: 'SYNTHETIC-DUP', orderAmount: 10, receivedAmount: 5 },
        { orderId: 'SYNTHETIC-DUP', orderAmount: 20, receivedAmount: 10 },
      ],
      baseline: { orderCount: 2, orderAmount: 30, receivedAmount: 15 },
    });

    expect(result.totals).toEqual({
      orderCount: 0,
      orderAmount: 0,
      receivedAmount: 0,
      outstandingAmount: 0,
    });
    expect(result.differences).toEqual({
      orderCount: null,
      orderAmount: null,
      receivedAmount: null,
      outstandingAmount: null,
    });
    expect(result.matched).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toEqual(['SALES_ORDER_ID_DUPLICATE:SYNTHETIC-DUP']);
  });

  it('对账边界：任一差额非零时显式报告，绝不解释为一致', () => {
    const result = computeSalesFourTotals({
      rows: [{ orderId: 'SYNTHETIC-DIFF', orderAmount: 100, receivedAmount: 40 }],
      baseline: { orderCount: 1, orderAmount: 90, receivedAmount: 40 },
    });

    expect(result.differences).toEqual({
      orderCount: 0,
      orderAmount: 10,
      receivedAmount: 0,
      outstandingAmount: 10,
    });
    expect(result.matched).toBe(false);
    expect(result.degraded).toBe(false);
  });

  it('降级路径：缺少独立人工基线时返回计算值但拒绝对账', () => {
    const result = computeSalesFourTotals({ ...fixture, baseline: null });

    expect(result.totals.orderAmount).toBe(300.3);
    expect(result.differences.orderAmount).toBeNull();
    expect(result.matched).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toEqual(['SALES_BASELINE_MISSING']);
  });
});
