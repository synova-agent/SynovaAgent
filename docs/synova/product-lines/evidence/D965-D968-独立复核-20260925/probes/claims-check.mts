/**
 * claims-check.mts — 逐条核验队长 4 条结论（运行时断言，非 grep 静态判据）
 * (a) 抛错=0 → 由 probe-A..E 六次运行 + canary 红绿对照给出（见 probe-*.json）
 * (b) path-dependency 不坏
 * (c) customer-demand-shift 对象形态只出现在设计内降级路径
 * (d) forecast-accuracy / pricing-strategy 硬编码桩
 */
const WT = '/Users/wane/SynovaAgent/.synova-wt-verify-d965';
process.chdir(WT);

const { pathDependencySentinel } = await import(`${WT}/extensions/sentinels/path-dependency/computes/detect.ts`);
const { customerDemandShiftSentinel } = await import(`${WT}/extensions/sentinels/customer-demand-shift/aggregate.ts`);
const { forecastAccuracySentinel } = await import(`${WT}/extensions/sentinels/sentinel-forecast-accuracy/aggregate.ts`);
const { pricingStrategySentinel } = await import(`${WT}/extensions/sentinels/sentinel-pricing-strategy/aggregate.ts`);
const { loadSentinels } = await import(`${WT}/src/sentinel/sentinel-loader.ts`);

const manifestOf = (n: string) => loadSentinels().sentinels.find(s => s.manifest.name === n)!.manifest;

type Row = { id: string; type: string; props: Record<string, unknown> };
type Edge = { id: string; type: string; from: string; to: string; weight: number; props: Record<string, unknown> };

function fakeStore(nodes: Row[], edges: Edge[]) {
  return {
    queryNodes: (type: string, _f?: Record<string, unknown>, _g?: string) => nodes.filter(n => !type || n.type === type),
    queryEdges: (type?: string, from?: string, to?: string, _g?: string) => edges.filter(e => (!type || e.type === type) && (!from || e.from === from) && (!to || e.to === to)),
    getNode: (id: string) => nodes.find(n => n.id === id) ?? null,
  };
}

const DEC = (s: string) => s;

// ══════════ (b) path-dependency ══════════
console.log('══════ (b) path-dependency ══════');
{
  const m = manifestOf('path-dependency');
  console.log('manifest.entryPoint =', m.entryPoint, '| exportKey =', m.exportKey);
  const fs = await import('fs');
  const entry = `${WT}/extensions/sentinels/path-dependency/computes/detect.ts`;
  console.log('entry exists =', fs.existsSync(`${WT}/extensions/sentinels/path-dependency/${m.entryPoint.replace('./', '')}`), '| typeof check =', typeof (pathDependencySentinel as { check?: unknown }).check);

  // 高依赖合成图: 3 条边全部汇聚到同一 hub 且来自同一源 → 期望 critical finding + 非空 evidence
  const hubEdges: Edge[] = [
    { id: 'e1', type: 'USES', from: 'src', to: 'hub', weight: 1, props: {} },
    { id: 'e2', type: 'USES', from: 'src', to: 'hub', weight: 1, props: {} },
    { id: 'e3', type: 'USES', from: 'src', to: 'hub', weight: 1, props: {} },
  ];
  const nodes: Row[] = [{ id: 'hub', type: 'Tool', props: {} }, { id: 'src', type: 'Process', props: {} }];
  (pathDependencySentinel as { manifest?: unknown }).manifest = m;
  const rHigh: unknown = await (pathDependencySentinel as { check: (...a: unknown[]) => unknown }).check(fakeStore(nodes, hubEdges), 'probe-team', undefined);
  const high = Array.isArray(rHigh) ? rHigh as Array<{ id: string; severity: string; evidence: unknown[] }> : [];
  console.log(DEC('高依赖图 → Array?'), Array.isArray(rHigh), '| findings =', high.length, '| ids =', JSON.stringify(high.map(f => f.id)), '| evidenceLens =', JSON.stringify(high.map(f => Array.isArray(f.evidence) ? f.evidence.length : -1)));

  // 空图（对照）: 边为空 → 期望 []（degraded 不误报）
  const rEmpty: unknown = await (pathDependencySentinel as { check: (...a: unknown[]) => unknown }).check(fakeStore(nodes, []), 'probe-team', undefined);
  console.log(DEC('空边图 → Array?'), Array.isArray(rEmpty), '| findings =', Array.isArray(rEmpty) ? rEmpty.length : 'non-array');

  const holds = Array.isArray(rHigh) && high.length >= 1 && high.every(f => Array.isArray(f.evidence) && f.evidence.length > 0) && (high[0].severity === 'critical')
    && Array.isArray(rEmpty) && (rEmpty as unknown[]).length === 0;
  console.log('ASSERT(b) =', holds ? 'HOLDS' : 'VIOLATED');
}

// ══════════ (c) customer-demand-shift ══════════
console.log('\n══════ (c) customer-demand-shift ══════');
{
  const clients: Row[] = [
    { id: 'c1', type: 'Client', props: { name: '客户A', revenue: 900000, status: 'active', teamId: 'probe-team' } },
    { id: 'c2', type: 'Client', props: { name: '客户B', revenue: 100000, status: 'active', teamId: 'probe-team' } },
  ];
  const store = fakeStore(clients, []);
  const th = { churn_rate: { warning: 0.1, critical: 0.2 }, top_customer_concentration: { warning: 0.3, critical: 0.4 } };
  const travNoEdge = { traverse: () => ({ nodes: [], edges: [], path: [], degraded: true, warnings: ['none'] }), getTemporalParams: () => null, scanOutliers: () => [], evaluateEdges: () => [] };
  const travWithNode = { traverse: () => ({ nodes: [{ id: 'probe-team', type: 'Team', props: {} }], edges: [], path: [], degraded: false, warnings: [] }), getTemporalParams: () => null, scanOutliers: () => [], evaluateEdges: () => [] };

  const call = (trav: unknown) => (customerDemandShiftSentinel as { check: (...a: unknown[]) => unknown }).check(store, 'probe-team', trav, th);
  const r1 = await call(travNoEdge);
  const r2 = await call(travWithNode);
  const r3 = await call(undefined);

  const unpack = (raw: unknown) => Array.isArray(raw) ? raw : ((raw as { findings?: unknown[] })?.findings ?? []);
  const degradedOf = (raw: unknown) => !Array.isArray(raw) && (raw as { degraded?: boolean })?.degraded === true;
  console.log(DEC('traversal 有但无 DEPLOYS 节点 → rawKeys ='), JSON.stringify(r1 && typeof r1 === 'object' && !Array.isArray(r1) ? Object.keys(r1) : 'array'), '| unpacked =', unpack(r1).length, '| degraded =', degradedOf(r1));
  console.log(DEC('traversal 有且有 DEPLOYS 节点 → Array? ='), Array.isArray(r2), '| unpacked =', unpack(r2).length, '| ids =', JSON.stringify(unpack(r2).map((f: unknown) => (f as { id: string }).id)));
  console.log(DEC('traversal 未注入 → Array? ='), Array.isArray(r3), '| unpacked =', unpack(r3).length, '| ids =', JSON.stringify(unpack(r3).map((f: unknown) => (f as { id: string }).id)));

  const holds = !Array.isArray(r1) && degradedOf(r1) && unpack(r1).length === 0
    && Array.isArray(r2) && unpack(r2).length >= 1
    && Array.isArray(r3) && unpack(r3).length >= 1;
  console.log('ASSERT(c 对象形态只出现在降级路径) =', holds ? 'HOLDS' : 'VIOLATED');
  const fs = await import('fs');
  const src = fs.readFileSync(`${WT}/extensions/sentinels/customer-demand-shift/aggregate.ts`, 'utf8').split('\n');
  const loaderSrc = fs.readFileSync(`${WT}/src/sentinel/sentinel-loader.ts`, 'utf8').split('\n');
  console.log('aggregate.ts:53 =', JSON.stringify(src[52].trim()));
  console.log('sentinel-loader.ts:288 =', JSON.stringify(loaderSrc[287].trim()));
  console.log('sentinel-loader.ts:290 =', JSON.stringify(loaderSrc[289].trim()));
}

// ══════════ (d) 两个硬编码桩 ══════════
console.log('\n══════ (d) forecast-accuracy / pricing-strategy ══════');
{
  const poisoned = new Proxy({}, { get() { throw new Error('POISONED-STORE-ACCESSED'); } });
  const acall = async (obj: unknown, arg: unknown) => {
    try { return { ok: true, raw: await (obj as { check: (...a: unknown[]) => unknown }).check(arg) }; }
    catch (e) { return { ok: false, err: e instanceof Error ? e.message : String(e) }; }
  };
  for (const [name, obj, expectIds] of [
    ['sentinel-forecast-accuracy', forecastAccuracySentinel, ['forecast-mape', 'forecast-sample', 'forecast-timeseries']],
    ['sentinel-pricing-strategy', pricingStrategySentinel, ['pricing-disc']],
  ] as Array<[string, unknown, string[]]>) {
    const withNull = await acall(obj, null);
    const withPoison = await acall(obj, poisoned);
    const rawN = withNull.ok ? withNull.raw : undefined;
    const rawP = withPoison.ok ? withPoison.raw : undefined;
    const idsN = Array.isArray(rawN) ? [] : ((rawN as { findings?: Array<{ id: string }> })?.findings ?? []).map(f => f.id);
    const idsP = Array.isArray(rawP) ? [] : ((rawP as { findings?: Array<{ id: string }> })?.findings ?? []).map(f => f.id);
    const evN = Array.isArray(rawN) ? [] : ((rawN as { findings?: Array<{ evidence?: unknown[] }> })?.findings ?? []).map(f => Array.isArray(f.evidence) ? f.evidence.length : -1);
    console.log(`${name}:`);
    console.log('  store=null     → threw =', withNull.ok ? 'no' : 'YES:' + withNull.err, '| ids =', JSON.stringify(idsN), '| evidenceLens =', JSON.stringify(evN));
    console.log('  store=poisoned → threw =', withPoison.ok ? 'no' : 'YES:' + withPoison.err, '| ids =', JSON.stringify(idsP));
    console.log('  raw is Array? =', Array.isArray(rawN), '| raw keys =', rawN && typeof rawN === 'object' ? JSON.stringify(Object.keys(rawN as object)) : typeof rawN);
    const same = JSON.stringify(idsN) === JSON.stringify(idsP);
    const expected = JSON.stringify(idsN) === JSON.stringify(expectIds);
    console.log('  ASSERT(与期望 id 集一致) =', expected ? 'HOLDS' : 'VIOLATED', '| ASSERT(两次调用结果与 store 无关) =', same ? 'HOLDS' : 'VIOLATED', '| ASSERT(evidence 全空) =', evN.every(l => l === 0) ? 'HOLDS' : 'VIOLATED');
  }
}
