/**
 * tests/extensions/threshold-single-source.test.ts — #732 阈值单一来源（裁 425 B1+B2｜L1 裁 B″）
 *
 * 设计哲学一句：**阈值的唯一真源是 manifest（经 loader 的 D577 唯一生产解析点），代码里不许有第二把尺子。**
 *
 * 契约（被本文件钉住的四条）:
 *   ① 单源: capital-health 的 CCC / 债务期限结构两对阈值只来自 loader 第 4 参注入的解析结果
 *      （`sentinel-loader` 内 resolveThresholds → `check(store, teamId, traversal, thresholds)`）；
 *      **manifest 改值 ⇒ 判定结果随之改变**（不许用"手传 thresholds"代替这条）。
 *   ② 加严: compute 的 `thresholds` 缺参 ⇒ **typed error（带 code）**，禁字面回落/默认值。
 *   ③ 加严: 第 4 参缺失 / manifest 缺键 ⇒ check() **fail-loud 点名缺键**（`ch-error` finding + log.error）、
 *      **不调用**那两个 compute（零字面回落），且**不外抛**（保既有 2 参直调契约）。
 *   ④ 防漂移: `DEFAULT_THRESHOLDS`（aggregate 的六键镜像）与 4 件直调测试夹具的 `THRESHOLDS` 常量，
 *      **逐键两档都等于** `manifest.thresholds`（裁 426 (d)(e)｜R-A 假绿#3 / R-B F-3:
 *      休眠的第二、第三把尺子不钉死 ⇒ manifest 改值后"旧尺子测新行为"仍全绿）。
 *
 * 取证路径（沿用既有注入缝，不新建机制）:
 *   · `SENTINELS_FIXTURE_DIR`（`sentinel-loader.ts` 的 D751 注入缝）指向 tmp 夹具根；
 *     夹具内 `capital-health/manifest.json` = **真 manifest 副本 + 受控改动**；
 *     `capital-health/aggregate.ts` = **相对路径 re-export 垫片**（仅 tmp 夹具内，不入库）
 *     —— 实测 ESM/vite-node 不按 realpath 解析 symlink，故用垫片；装载的仍是真实现的**同一模块实例**
 *     ⇒ 走**真** loadSentinels → registerLoadedSentinels → registry.check 管线，解析点就是生产解析点。
 *   · `clearSentinelCache()`（loader 公开 API）在夹具切换前后清模块级缓存。
 *   · `resolveThresholds` 的 `deps.memoryStore` 是 loader 自己的测试注入缝（其 JSDoc 明载）。
 *
 * 边界语义（逐字保留旧算法）: `cccDays > critical` ⇒ critical｜`> warning` ⇒ warning；
 *   `ratio > critical` ⇒ critical｜`> warning` ⇒ warning（**等于线值不越级**）。
 *
 * 已知限制:
 *   · 本文件不断言另外 6 对阈值的**缺键 fail-loud 行为**（④ 只断言其**现值**与 manifest 逐键相等）——
 *     那 6 对仍走 aggregate 自有 `DEFAULT_THRESHOLDS` 回退（队长裁：本批只归一 ccc/debt 两处已实测旁路，
 *     全哨兵字面阈值清算另立卡）。
 *   · 夹具只放 capital-health 一个哨兵目录（其余哨兵与本卡无关，注册 1 个即可）。
 *   · ④ 的两处常量**均未导出**且都属"禁改"对象（被测件 / 被断言夹具）⇒ 只能**只读源文本解析**，无法 import；
 *     若其写法改成跨行或计算式，④ 会**红并点名文件与键**（不会静默放过），届时须同步改本文件的解析器。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { capitalHealthSentinel } from '../../extensions/sentinels/capital-health/aggregate';
import { computeCashConversionCycle } from '../../extensions/sentinels/capital-health/computes/cash-conversion-cycle';
import { computeDebtStructure } from '../../extensions/sentinels/capital-health/computes/debt-structure';
import { clearSentinelCache, registerLoadedSentinels, resolveThresholds } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry, destroySentinelRegistry } from '../../src/sentinel/registry';

// ═══ 常量 ═══

const SENTINEL_DIR = join(process.cwd(), 'extensions', 'sentinels', 'capital-health');
const REAL_MANIFEST = join(SENTINEL_DIR, 'manifest.json');
const REAL_AGGREGATE = join(SENTINEL_DIR, 'aggregate.ts');
const CCC_KEY = 'cash_conversion_cycle_days';
const DEBT_KEY = 'short_term_debt_ratio';

/** capital-health.check 的 store 入参类型（用 Parameters 取，避免手抄引擎类型，也不用断言） */
type CheckStore = Parameters<typeof capitalHealthSentinel.check>[0];

interface ThresholdPair { warning: number; critical: number }
type ThresholdsMap = Record<string, ThresholdPair>;

interface Finding {
  id: string;
  severity: string;
  title: string;
  description: string;
  evidence: string[];
}

/** 读真 manifest 的 thresholds（夹具基线来源 = 磁盘真值，非本文件手写） */
function realManifest(): { version: string; thresholds: ThresholdsMap } {
  return JSON.parse(readFileSync(REAL_MANIFEST, 'utf-8')) as { version: string; thresholds: ThresholdsMap };
}

// ═══ 夹具根（SENTINELS_FIXTURE_DIR 注入缝） ═══

const createdRoots: string[] = [];
let prevFixtureDir: string | undefined;

/** 造一个只含 capital-health 的哨兵根（manifest 受控改动 + aggregate symlink 到真文件） */
function makeFixtureRoot(mutate?: (t: ThresholdsMap) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'p3m7-732-'));
  createdRoots.push(root);
  const dir = join(root, 'capital-health');
  mkdirSync(dir, { recursive: true });
  const manifest = realManifest();
  if (mutate) mutate(manifest.thresholds);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  // ESM/vite-node 不按 realpath 解析 symlink（实测: 夹具内 symlink 的 './computes/x' 解析失败）
  // ⇒ 用**相对路径 re-export 垫片**：垫片只在 tmp 夹具内存在、不入库，装载的仍是真实现的同一模块实例。
  const rel = relative(dir, REAL_AGGREGATE);
  writeFileSync(join(dir, 'aggregate.ts'), `export { capitalHealthSentinel } from '${rel.startsWith('.') ? rel : `./${rel}`}';\n`, 'utf-8');
  return root;
}

/** 切到夹具并清缓存（loadSentinels 有模块级 cache） */
function useFixture(root: string): void {
  process.env.SENTINELS_FIXTURE_DIR = root;
  clearSentinelCache();
}

// ═══ 财务夹具 ═══

/**
 * 单 Financial 节点：cogs = total_revenue − gross_margin = 1000 − 635 = 365
 *   inventory=121 ⇒ DIO = 365 * 121 / 365 = 121；receivables=0 ⇒ DSO=0；accounts_payable=0 ⇒ DPO=0
 *   ⇒ cccDays = 121（整数，无取整歧义）
 *   short_term_debt/total_debt = 70/100 = 0.7（压线：`>0.7` 才 critical）
 *   total_debt/equity = 100/1000 = 0.1（D/E healthy，保证 ccc/ds 是唯一关注点）
 */
function financialStore(opts: { inventory: number; shortTermDebt: number }): CheckStore {
  const node = {
    id: 'f-732',
    type: 'Financial',
    props: {
      total_revenue: 1000,
      gross_margin: 635,
      total_assets: 5000,
      total_debt: 100,
      equity: 1000,
      operating_cashflow: 200,
      operating_expense: 300,
      inventory: opts.inventory,
      receivables: 0,
      accounts_payable: 0,
      short_term_debt: opts.shortTermDebt,
    },
  };
  return {
    queryNodes(_type: string, _filters?: Record<string, unknown>, _graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }> {
      return [node];
    },
    queryEdges(): Array<{ id: string; type: string; from: string; to: string; weight: number; props: Record<string, unknown> }> {
      return [];
    },
    getNode(): Record<string, unknown> | null {
      return null;
    },
  };
}

/**
 * 走**真 loader 管线**取 findings：loadSentinels（夹具）→ registerLoadedSentinels → registry.check。
 * 阈值由此在生产解析点（loader 第 4 参注入）给出 —— 不是本文件手传，故能证"行为随 manifest 变"。
 */
async function checkViaLoader(store: CheckStore, teamId: string): Promise<Finding[]> {
  destroySentinelRegistry();
  clearSentinelCache();
  const { registered, errors } = await registerLoadedSentinels();
  expect(registered, `capital-health 应完成注册（夹具 symlink 聚合件可解析）；errors=${errors.join(' | ')}`).toBeGreaterThan(0);
  const sentinel = getSentinelRegistry().get('sentinel-capital-health');
  expect(sentinel, 'sentinel-capital-health 应在注册表').toBeTruthy();
  const res = await sentinel!.check({ db: store, now: new Date(), teamId });
  expect(res.ok).toBe(true);
  return res.findings as Finding[];
}

/** 直调（绕过 loader）：用于取"第 4 参未注入"与"手传阈值"两条路径的行为 */
async function checkDirect(store: CheckStore, teamId: string, thresholds?: Record<string, ThresholdPair>): Promise<Finding[]> {
  const r = await capitalHealthSentinel.check(store, teamId, undefined, thresholds);
  return Array.isArray(r) ? (r as Finding[]) : (r.findings as Finding[]);
}

const idsOf = (fs: Finding[]): string => fs.map(f => f.id).join(',');

// ═══ 生命周期 ═══

beforeEach(() => {
  prevFixtureDir = process.env.SENTINELS_FIXTURE_DIR;
  clearSentinelCache();
  capitalHealthSentinel.manifest = null; // loader 会往 sentinel 对象挂 manifest；逐例复位，防跨例串味
});

afterEach(() => {
  if (prevFixtureDir === undefined) delete process.env.SENTINELS_FIXTURE_DIR;
  else process.env.SENTINELS_FIXTURE_DIR = prevFixtureDir;
  destroySentinelRegistry();
  clearSentinelCache();
  capitalHealthSentinel.manifest = null;
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

// ═══ ① 单源: 判定随 manifest 变（loader 路径，判据①） ═══

describe('#732 ① 单源: CCC / 债务结构阈值来自 manifest（经 loader 第 4 参）', () => {
  it('真 manifest 基线（键值锚点）: ccc 90/120、债务 0.5/0.7', () => {
    const manifest = realManifest();
    // 数字来自磁盘，不手写
    expect(manifest.thresholds[CCC_KEY]).toEqual({ warning: 90, critical: 120 });
    expect(manifest.thresholds[DEBT_KEY]).toEqual({ warning: 0.5, critical: 0.7 });
  });

  it('基线 ccc=121 且 critical=120 ⇒ critical（走 registry 真管线）', async () => {
    useFixture(makeFixtureRoot());
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    expect(findings.some(f => f.id === 'f5-ccc-crit'), `121 > 120 ⇒ critical；实得: ${idsOf(findings)}`).toBe(true);
    expect(findings.some(f => f.id === 'f5-ccc-warn')).toBe(false);
  });

  it('manifest 改 critical=130 ⇒ 同一 ccc=121 落 warning（行为随 manifest 变）', async () => {
    useFixture(makeFixtureRoot(t => { t[CCC_KEY] = { warning: 90, critical: 130 }; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    expect(findings.some(f => f.id === 'f5-ccc-crit'), `130 > 121 ⇒ 不得 critical；实得: ${idsOf(findings)}`).toBe(false);
    expect(findings.some(f => f.id === 'f5-ccc-warn'), '121 > 90 ⇒ warning').toBe(true);
  });

  it('manifest 改 warning=125 ⇒ 同一 ccc=121 连 warning 也不出（两档都随 manifest）', async () => {
    useFixture(makeFixtureRoot(t => { t[CCC_KEY] = { warning: 125, critical: 130 }; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    expect(findings.some(f => f.id.startsWith('f5-ccc-')), `121 ≤ 125 ⇒ healthy；实得: ${idsOf(findings)}`).toBe(false);
  });

  it('manifest 改 short_term_debt_ratio critical=0.65 ⇒ ratio=0.7 落 critical', async () => {
    useFixture(makeFixtureRoot(t => { t[DEBT_KEY] = { warning: 0.5, critical: 0.65 }; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    expect(findings.some(f => f.id === 'f2-ds-crit'), `0.7 > 0.65 ⇒ critical；实得: ${idsOf(findings)}`).toBe(true);
    expect(findings.some(f => f.id === 'f2-ds-warn')).toBe(false);
  });
});

// ═══ ② 边界: `>` 语义逐字保留（判据②） ═══

describe('#732 ② 边界: 等于线值不越级（`>` 语义逐字保留）', () => {
  it('ccc 恰 =120（manifest critical=120）⇒ warning 而非 critical', async () => {
    useFixture(makeFixtureRoot());
    const findings = await checkViaLoader(financialStore({ inventory: 120, shortTermDebt: 70 }), 'team-b');
    expect(findings.some(f => f.id === 'f5-ccc-crit'), `120 > 120 为假 ⇒ 不得 critical；实得: ${idsOf(findings)}`).toBe(false);
    expect(findings.some(f => f.id === 'f5-ccc-warn'), '120 > 90 ⇒ warning').toBe(true);
  });

  it('debt ratio 恰 =0.7（manifest critical=0.7）⇒ warning 而非 critical', async () => {
    useFixture(makeFixtureRoot());
    const findings = await checkViaLoader(financialStore({ inventory: 120, shortTermDebt: 70 }), 'team-b');
    expect(findings.some(f => f.id === 'f2-ds-crit'), `0.7 > 0.7 为假 ⇒ 不得 critical；实得: ${idsOf(findings)}`).toBe(false);
    expect(findings.some(f => f.id === 'f2-ds-warn'), '0.7 > 0.5 ⇒ warning').toBe(true);
  });

  it('compute 侧同一语义: 恰在 critical 线 ⇒ 不越级（显式传参，不依赖 aggregate）', () => {
    const cccAt120 = computeCashConversionCycle(
      { cogs: 365, inventory: 120, receivables: 0, accounts_payable: 0, total_revenue: 1000 },
      { warning: 90, critical: 120 },
    );
    expect(cccAt120.cccDays).toBe(120);
    expect(cccAt120.signal).toBe('warning');

    const debtAt07 = computeDebtStructure({ short_term_debt: 70, total_debt: 100 }, { warning: 0.5, critical: 0.7 });
    expect(debtAt07.shortTermRatio).toBe(0.7);
    expect(debtAt07.signal).toBe('warning');

    expect(computeDebtStructure({ short_term_debt: 71, total_debt: 100 }, { warning: 0.5, critical: 0.7 }).signal).toBe('critical');
  });
});

// ═══ ③ 两客户槽同值同源（判据③） ═══

describe('#732 ③ 两个 orgKey 解析同值同源（无 memStore 覆写 ⇒ 同 manifest 基线）', () => {
  it('team-a 与 team-b 解析结果逐键相等，且等于磁盘 manifest 真值', async () => {
    const noOverride = { memoryStore: { recall: (): null => null } };
    const a = await resolveThresholds('capital-health', 'team-a', noOverride);
    const b = await resolveThresholds('capital-health', 'team-b', noOverride);
    expect(a.overrideApplied).toBe(false);
    expect(b.overrideApplied).toBe(false);
    expect(a.thresholds).toEqual(b.thresholds);
    // 同源锚点: 解析值 == 磁盘 manifest.thresholds（不是代码里的第二份常量）
    expect(a.thresholds).toEqual(realManifest().thresholds);
    expect(a.thresholds[CCC_KEY]).toEqual({ warning: 90, critical: 120 });
    expect(a.thresholds[DEBT_KEY]).toEqual({ warning: 0.5, critical: 0.7 });
  });

  it('memStore 覆写只打首个 key（roic_wacc_spread），不改 ccc/debt 两键', async () => {
    const override = {
      memoryStore: {
        recall: () => ({ value: JSON.stringify({ newThreshold: { warning: 0.9, critical: 0.99 } }) }),
      },
    };
    const r = await resolveThresholds('capital-health', 'team-a', override);
    expect(r.overrideApplied).toBe(true);
    expect(r.overrideMetric).toBe('roic_wacc_spread');
    expect(r.thresholds[CCC_KEY]).toEqual({ warning: 90, critical: 120 });
    expect(r.thresholds[DEBT_KEY]).toEqual({ warning: 0.5, critical: 0.7 });
  });
});

// ═══ ④ 加严: 缺键 / 缺第 4 参 ⇒ fail-loud 点名（判据②反例 b） ═══

describe('#732 ④ 缺键 ⇒ fail-loud 点名缺键（禁静默取默认）', () => {
  it('manifest 删 ccc 键 ⇒ ch-error 且 description 点名 cash_conversion_cycle_days，且不产 ccc 结论', async () => {
    useFixture(makeFixtureRoot(t => { delete t[CCC_KEY]; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    const err = findings.find(f => f.id === 'ch-error');
    expect(err, `缺键必须 fail-loud；实得: ${idsOf(findings)}`).toBeTruthy();
    expect(err?.description ?? '', '必须点名缺哪个键').toContain(CCC_KEY);
    expect(findings.some(f => f.id === 'f5-ccc-crit'), '缺键时不得用默认值产阈值结论').toBe(false);
  });

  it('manifest 删债务键 ⇒ description 点名 short_term_debt_ratio', async () => {
    useFixture(makeFixtureRoot(t => { delete t[DEBT_KEY]; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    const err = findings.find(f => f.id === 'ch-error');
    expect(err, `缺键必须 fail-loud；实得: ${idsOf(findings)}`).toBeTruthy();
    expect(err?.description ?? '').toContain(DEBT_KEY);
    expect(findings.some(f => f.id === 'f2-ds-crit')).toBe(false);
  });

  it('两键都缺 ⇒ 一次点名两键（不是只报第一个）', async () => {
    useFixture(makeFixtureRoot(t => { delete t[CCC_KEY]; delete t[DEBT_KEY]; }));
    const findings = await checkViaLoader(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a');
    const desc = findings.find(f => f.id === 'ch-error')?.description ?? '';
    expect(desc).toContain(CCC_KEY);
    expect(desc).toContain(DEBT_KEY);
  });

  it('第 4 参未注入（既有 2 参直调）⇒ 点名"第 4 参"、跳过两指标、但不外抛且其余指标照常', async () => {
    // completeFinancial 同款夹具：D/E=4 > 2.5 ⇒ f2-de-crit 必须仍在（证明不是全量中止）
    const store: CheckStore = {
      queryNodes(): Array<{ id: string; type: string; props: Record<string, unknown> }> {
        return [{
          id: 'f1', type: 'Financial',
          props: {
            total_revenue: 100, total_assets: 50, total_debt: 80, equity: 20,
            operating_cashflow: 10, operating_expense: 40, interest_expense: 30,
            gross_margin: 40, inventory: 10, receivables: 5, accounts_payable: 5, short_term_debt: 40,
          },
        }];
      },
      queryEdges: () => [],
      getNode: () => null,
    };
    const findings = await checkDirect(store, 't1'); // ← 不传第 4 参
    const err = findings.find(f => f.id === 'ch-error');
    expect(err, `缺第 4 参必须 fail-loud；实得: ${idsOf(findings)}`).toBeTruthy();
    expect(err?.description ?? '').toContain('第 4 参');
    // 零字面回落: ccc / 债务结构不得出阈值结论
    expect(findings.some(f => f.id.startsWith('f5-ccc-'))).toBe(false);
    expect(findings.some(f => f.id.startsWith('f2-ds-'))).toBe(false);
    // 其余指标照常（不因阈值缺失而全量中止）
    expect(findings.some(f => f.id === 'f2-de-crit'), `D/E=4 应仍产 critical；实得: ${idsOf(findings)}`).toBe(true);
  });

  it('手传空对象 ⇒ 同样 fail-loud 点名两键（判据(b)最小复现，绕开 loader）', async () => {
    const findings = await checkDirect(financialStore({ inventory: 121, shortTermDebt: 70 }), 'team-a', {});
    const desc = findings.find(f => f.id === 'ch-error')?.description ?? '';
    expect(desc).toContain(CCC_KEY);
    expect(desc).toContain(DEBT_KEY);
  });
});

// ═══ ⑤ 加严: compute 缺参 ⇒ typed error（带 code）（判据②反例 c） ═══

/** 取 throw 出来的 error.code（无 throw ⇒ 空串，即"没 fail-loud"） */
function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (err: unknown) {
    return (err as { code?: string }).code ?? '';
  }
}

describe('#732 ⑤ compute 的 thresholds 缺参 ⇒ typed error（带 code），禁回落默认值', () => {
  const CCC_FIN = { cogs: 365, inventory: 121, receivables: 0, accounts_payable: 0, total_revenue: 1000 };

  it('computeCashConversionCycle 缺 thresholds ⇒ 抛 code=CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING', () => {
    expect(errorCodeOf(() => computeCashConversionCycle(CCC_FIN, undefined!))).toBe('CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING');
    // 正常传参不抛（防"恒抛"假绿）
    expect(computeCashConversionCycle(CCC_FIN, { warning: 90, critical: 120 }).signal).toBe('critical');
  });

  it('computeDebtStructure 缺 thresholds ⇒ 抛 code=DEBT_STRUCTURE_THRESHOLDS_MISSING', () => {
    expect(errorCodeOf(() => computeDebtStructure({ short_term_debt: 70, total_debt: 100 }, undefined!))).toBe('DEBT_STRUCTURE_THRESHOLDS_MISSING');
    expect(computeDebtStructure({ short_term_debt: 70, total_debt: 100 }, { warning: 0.5, critical: 0.7 }).signal).toBe('warning');
  });

  it('thresholds 存在但任一档非有限数 ⇒ 同样 typed error（禁"半截默认值"）', () => {
    expect(errorCodeOf(() => computeCashConversionCycle(CCC_FIN, { warning: Number.NaN, critical: 120 }))).toBe('CASH_CONVERSION_CYCLE_THRESHOLDS_MISSING');
    expect(errorCodeOf(() => computeDebtStructure({ short_term_debt: 70, total_debt: 100 }, { warning: 0.5, critical: Number.POSITIVE_INFINITY }))).toBe('DEBT_STRUCTURE_THRESHOLDS_MISSING');
  });
});

// ═══ ⑥ 结构护栏（判据④/⑤ 的机器可判面） ═══

/**
 * 去注释后取代码面（静态取证用）。
 * 为什么必须去注释: 契约注释里会**如实写明**"禁异步／禁 IO"与边界线值（如 >0.7 才 critical），
 * 若直接扫全文，注释本身会把断言打红 —— 那是把文档当违规（同 T8 阈值卫生扫描的既有口径）。
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('#732 ⑥ 结构护栏: 内容面不钻引擎 / compute 保持同步纯函数', () => {
  const computes = [
    join(SENTINEL_DIR, 'computes', 'cash-conversion-cycle.ts'),
    join(SENTINEL_DIR, 'computes', 'debt-structure.ts'),
  ];
  const aggregatePath = join(SENTINEL_DIR, 'aggregate.ts');

  it('aggregate 不再自取阈值：resolveThresholds 出现 0 次、无动态 import', () => {
    const raw = readFileSync(aggregatePath, 'utf-8');
    expect(raw.split('\n').filter(l => l.includes('resolveThresholds')).length, 'aggregate 内不得再出现该标识符（解析点只在 loader）').toBe(0);
    expect(codeOnly(raw), 'aggregate 不得含 await import(').not.toMatch(/\bimport\(/);
  });

  it('aggregate 的 src/sentinel 依赖只剩既有的 import type（无值依赖 = K12-13 CC1 方向）', () => {
    const lines = readFileSync(aggregatePath, 'utf-8').split('\n');
    const offenders = lines
      .filter(l => l.includes('src/sentinel'))
      .filter(l => !/^\s*import\s+type\s/.test(l))
      .map(l => l.trim());
    expect(offenders, `aggregate 出现非 type 的引擎依赖: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('compute 代码面无异步 / 无动态 import / 无 fs', () => {
    for (const path of computes) {
      const code = codeOnly(readFileSync(path, 'utf-8'));
      expect(code, `${path} 不得含 await`).not.toMatch(/\bawait\b/);
      expect(code, `${path} 不得含动态 import(`).not.toMatch(/\bimport\(/);
      expect(code, `${path} 不得含 node:fs`).not.toMatch(/node:fs|from 'fs'/);
    }
  });

  it('两对新键不进 DEFAULT_THRESHOLDS；字面阈值不回到 compute 比较里', () => {
    const aggregateCode = codeOnly(readFileSync(aggregatePath, 'utf-8'));
    const defaultBlock = aggregateCode.split('const DEFAULT_THRESHOLDS')[1]?.split('};')[0] ?? '';
    expect(defaultBlock.length, 'DEFAULT_THRESHOLDS 块应可定位').toBeGreaterThan(0);
    expect(defaultBlock, 'DEFAULT_THRESHOLDS 不得含 ccc 键').not.toContain(CCC_KEY);
    expect(defaultBlock, 'DEFAULT_THRESHOLDS 不得含债务结构键').not.toContain(DEBT_KEY);
    for (const path of computes) {
      const code = codeOnly(readFileSync(path, 'utf-8'));
      const hit = code.match(/[<>]=?\s*(?:120|90|0\.7|0\.5)\b/)?.[0] ?? '';
      expect(hit, `${path} 仍含字面阈值比较: "${hit}"`).toBe('');
    }
  });
});

// ═══ ⑦ 防漂移: 三份阈值拷贝必须同源（裁 426 (d)(e)｜R-A 假绿#3 ＋ R-B F-3） ═══

/**
 * 为什么是"只读源文本解析"而不是 import（两条硬约束，缺一不可）:
 *   · `DEFAULT_THRESHOLDS`（aggregate.ts）与那 4 件直调测试的 `THRESHOLDS` 常量**都未导出**；
 *   · 两者都是本卡**禁改**对象（被测对象 / 被断言夹具）⇒ 不许为测试加 export、不许改那 4 件的行为断言。
 * ⇒ 只能只读源文本；解析不到时**必须红并点名**（禁"没找到就当没事"的静默假绿）。
 *
 * 判别力（改坏必红，原始输出见 PR #1068 正文 b/c 两处突变）:
 *   · b: aggregate.ts `DEFAULT_THRESHOLDS.debt_equity.warning` 1.5→9.9 ⇒ ⑦d 红（改前该文件 22/22 全绿＝假绿#3）
 *   · c: manifest.json 改 ccc 某档、**不动夹具** ⇒ ⑦e 红（夹具＝第三份拷贝，"旧尺子测新行为"）
 */
const DEFAULT_THRESHOLD_KEYS = [
  'roic_wacc_spread',
  'capital_turnover',
  'debt_equity',
  'interest_coverage',
  'asset_turnover',
  'receivable_turnover_days',
];

/** 两档名（具名联合类型，避免"用 `as` 断言换索引"这类类型信任崩溃） */
const THRESHOLD_TIERS: Array<'warning' | 'critical'> = ['warning', 'critical'];

/** DEFAULT_THRESHOLDS 块内单条形态: `键: { warning: X, critical: Y }` */
const DEFAULT_ENTRY_RE = /(\w+)\s*:\s*\{\s*warning:\s*(-?\d+(?:\.\d+)?)\s*,\s*critical:\s*(-?\d+(?:\.\d+)?)\s*\}/g;

/** 4 件直调测试的常量形态: `const THRESHOLDS = { warning: X, critical: Y };` */
const FIXTURE_CONST_RE = /const\s+THRESHOLDS\s*=\s*\{\s*warning:\s*(-?\d+(?:\.\d+)?)\s*,\s*critical:\s*(-?\d+(?:\.\d+)?)\s*\}/;

/** DEFAULT_THRESHOLDS 块源文本（沿用 ⑥ 的 split 定位法: 先去注释，再切到首个 `};`） */
function defaultThresholdsBlock(): string {
  const code = codeOnly(readFileSync(REAL_AGGREGATE, 'utf-8'));
  return code.split('const DEFAULT_THRESHOLDS')[1]?.split('};')[0] ?? '';
}

/** DEFAULT_THRESHOLDS 块内的键值对（键集即"六键，不多不少"的判定对象） */
function defaultThresholdPairs(): ThresholdsMap {
  const out: ThresholdsMap = {};
  for (const m of defaultThresholdsBlock().matchAll(DEFAULT_ENTRY_RE)) {
    out[m[1]] = { warning: Number(m[2]), critical: Number(m[3]) };
  }
  return out;
}

/** 单件夹具常量（读不到/解析不到 ⇒ null，由调用点断言点名，禁静默跳过） */
function fixtureThresholds(relPath: string): ThresholdPair | null {
  const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
  const m = src.match(FIXTURE_CONST_RE);
  return m ? { warning: Number(m[1]), critical: Number(m[2]) } : null;
}

describe('#732 ⑦d 镜像: DEFAULT_THRESHOLDS 六键 ≡ manifest.thresholds（逐对相等｜裁 426 d）', () => {
  it('键集恰为 6 键（不多不少；ccc/债务结构两键严禁混入）', () => {
    const block = defaultThresholdsBlock();
    expect(block.length, 'aggregate.ts 应可定位 DEFAULT_THRESHOLDS 块（源文本解析）').toBeGreaterThan(0);
    const keys = Object.keys(defaultThresholdPairs()).sort();
    expect(keys, `DEFAULT_THRESHOLDS 键集应恰为 6 键；实得 ${keys.length} 键: ${keys.join(',')}`)
      .toEqual([...DEFAULT_THRESHOLD_KEYS].sort());
  });

  it('六键逐对相等（warning/critical 两档都比；镜像漂移必红）', () => {
    const manifest = realManifest();
    const pairs = defaultThresholdPairs();
    for (const key of DEFAULT_THRESHOLD_KEYS) {
      const d = pairs[key];
      expect(d, `DEFAULT_THRESHOLDS 缺键 ${key}（aggregate.ts 源文本解析不到该键）`).toBeTruthy();
      const m = manifest.thresholds[key];
      expect(m, `manifest.thresholds 缺键 ${key}`).toBeTruthy();
      for (const tier of THRESHOLD_TIERS) {
        expect(
          d![tier],
          `镜像漂移 ${key}.${tier}: DEFAULT_THRESHOLDS=${d![tier]} ≠ manifest.thresholds=${m[tier]}（裁 426 (d): 代码里不许有第二把尺子）`,
        ).toBe(m[tier]);
      }
    }
  });
});

describe('#732 ⑦e 夹具: 4 件直调测试 THRESHOLDS ≡ manifest（R-B F-3）', () => {
  const fixtures = [
    { path: 'tests/sentinels/capital-health/cash-conversion-cycle.test.ts', key: CCC_KEY },
    { path: 'tests/sentinels/capital-health/debt-structure.test.ts', key: DEBT_KEY },
    { path: 'tests/sentinels/capital-structure/debt-structure.test.ts', key: DEBT_KEY },
    { path: 'tests/sentinels/capital-turnover/cash-conversion-cycle.test.ts', key: CCC_KEY },
  ];

  fixtures.forEach(({ path, key }) => {
    it(`${path} 的 THRESHOLDS ≡ manifest.thresholds['${key}']（旧尺子测新行为必红）`, () => {
      const got = fixtureThresholds(path);
      expect(got, `${path} 应可定位 \`const THRESHOLDS = { warning: X, critical: Y }\`（只读源文本；本卡禁改该件）`).toBeTruthy();
      const m = realManifest().thresholds[key];
      expect(m, `manifest.thresholds 缺键 ${key}`).toBeTruthy();
      for (const tier of THRESHOLD_TIERS) {
        expect(
          got![tier],
          `夹具漂移 ${path} THRESHOLDS.${tier}=${got![tier]} ≠ manifest.thresholds['${key}'].${tier}=${m[tier]}（R-B F-3: 夹具是第三份拷贝）`,
        ).toBe(m[tier]);
      }
    });
  });
});
