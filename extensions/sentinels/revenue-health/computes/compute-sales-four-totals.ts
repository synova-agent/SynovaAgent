/**
 * Deterministically recomputes four sales totals and reconciles them with a baseline.
 *
 * @input rows: synthetic or source-mapped orders with stable orderId and finite,
 *        non-negative orderAmount / receivedAmount; baseline uses the same four
 *        total keys, or null when no independent baseline is available.
 * @output Integer-cent totals for orderCount, orderAmount, receivedAmount and
 *         outstandingAmount; signed differences are computed - baseline.
 *         matched is true only when all four differences are zero.
 * @error Invalid rows, duplicate orderId, empty input, or invalid baseline do not
 *        throw across the sentinel boundary; they return a degraded result.
 * @degraded Invalid/missing input returns zero totals, null differences,
 *        matched=false, and stable machine-readable warnings. No model arithmetic,
 *        zero-filling of missing values, or silent reconciliation is performed.
 */
export interface SalesFourTotalsSourceRow {
  orderId: string;
  orderAmount: number;
  receivedAmount: number;
}

export interface SalesFourTotals {
  orderCount: number;
  orderAmount: number;
  receivedAmount: number;
}

export interface SalesFourTotalsInput {
  rows: SalesFourTotalsSourceRow[];
  baseline: SalesFourTotals | null;
}

export interface SalesFourTotalDifferences {
  orderCount: number | null;
  orderAmount: number | null;
  receivedAmount: number | null;
  outstandingAmount: number | null;
}

export interface SalesFourTotalsResult {
  totals: SalesFourTotals & { outstandingAmount: number };
  differences: SalesFourTotalDifferences;
  matched: boolean;
  degraded: boolean;
  warnings: string[];
  sourceOrderIds: string[];
}

const TOTAL_KEYS = ['orderCount', 'orderAmount', 'receivedAmount', 'outstandingAmount'] as const;

function fromCents(value: number): number {
  return value / 100;
}

function invalidResult(warning: string): SalesFourTotalsResult {
  return {
    totals: { orderCount: 0, orderAmount: 0, receivedAmount: 0, outstandingAmount: 0 },
    differences: { orderCount: null, orderAmount: null, receivedAmount: null, outstandingAmount: null },
    matched: false,
    degraded: true,
    warnings: [warning],
    sourceOrderIds: [],
  };
}

export function computeSalesFourTotals(input: SalesFourTotalsInput): SalesFourTotalsResult {
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return invalidResult('SALES_ROWS_EMPTY');
  }

  const sourceOrderIds: string[] = [];
  const seen = new Set<string>();
  let orderAmountCents = 0;
  let receivedAmountCents = 0;

  for (const [index, row] of input.rows.entries()) {
    if (!row || typeof row.orderId !== 'string' || row.orderId.trim() === '') {
      return invalidResult(`SALES_ROW_${index}_ORDER_ID_INVALID`);
    }
    if (seen.has(row.orderId)) {
      return invalidResult(`SALES_ORDER_ID_DUPLICATE:${row.orderId}`);
    }
    if (!Number.isFinite(row.orderAmount) || row.orderAmount < 0) {
      return invalidResult(`SALES_ROW_${index}_ORDER_AMOUNT_INVALID`);
    }
    if (!Number.isFinite(row.receivedAmount) || row.receivedAmount < 0) {
      return invalidResult(`SALES_ROW_${index}_RECEIVED_AMOUNT_INVALID`);
    }
    seen.add(row.orderId);
    sourceOrderIds.push(row.orderId);
    orderAmountCents += Math.round(row.orderAmount * 100);
    receivedAmountCents += Math.round(row.receivedAmount * 100);
  }

  const totals = {
    orderCount: input.rows.length,
    orderAmount: fromCents(orderAmountCents),
    receivedAmount: fromCents(receivedAmountCents),
    outstandingAmount: fromCents(orderAmountCents - receivedAmountCents),
  };

  if (input.baseline === null) {
    return {
      totals,
      differences: { orderCount: null, orderAmount: null, receivedAmount: null, outstandingAmount: null },
      matched: false,
      degraded: true,
      warnings: ['SALES_BASELINE_MISSING'],
      sourceOrderIds,
    };
  }

  const baselineCents = {
    orderCount: input.baseline.orderCount,
    orderAmount: Math.round(input.baseline.orderAmount * 100),
    receivedAmount: Math.round(input.baseline.receivedAmount * 100),
  };
  for (const key of ['orderCount', 'orderAmount', 'receivedAmount'] as const) {
    if (!Number.isFinite(input.baseline[key]) || input.baseline[key] < 0) {
      return invalidResult(`SALES_BASELINE_${key.toUpperCase()}_INVALID`);
    }
  }
  if (!Number.isInteger(baselineCents.orderCount)) {
    return invalidResult('SALES_BASELINE_ORDERCOUNT_INVALID');
  }

  const differences = {
    orderCount: totals.orderCount - baselineCents.orderCount,
    orderAmount: fromCents(orderAmountCents - baselineCents.orderAmount),
    receivedAmount: fromCents(receivedAmountCents - baselineCents.receivedAmount),
    outstandingAmount: fromCents(
      orderAmountCents - receivedAmountCents
      - baselineCents.orderAmount + baselineCents.receivedAmount,
    ),
  };

  return {
    totals,
    differences,
    matched: TOTAL_KEYS.every(key => differences[key] === 0),
    degraded: false,
    warnings: [],
    sourceOrderIds,
  };
}
