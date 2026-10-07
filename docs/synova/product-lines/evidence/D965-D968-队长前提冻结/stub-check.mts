import { pathToFileURL } from 'url';
const ROOT = '/Users/wane/SynovaAgent';
for (const [name, key] of [['sentinel-forecast-accuracy', 'forecastAccuracySentinel'], ['sentinel-pricing-strategy', 'pricingStrategySentinel']] as const) {
  const mod = await import(pathToFileURL(`${ROOT}/extensions/sentinels/${name}/aggregate.ts`).href) as Record<string, unknown>;
  const obj = mod[key] as { check: (...a: unknown[]) => unknown };
  // 生产口径：loader 传 (store, teamId, traversal, thresholds) —— 第 1 参不是它期望的 context
  let storeCalls = 0;
  const store = { queryNodes: () => { storeCalls++; return []; }, queryEdges: () => { storeCalls++; return []; } };
  const raw = await obj.check(store, 'probe-team', undefined, {});
  const isArr = Array.isArray(raw);
  const findings = isArr ? raw : ((raw as { findings?: unknown[] })?.findings ?? []);
  console.log(`\n===== ${name} =====`);
  console.log(`原始返回 Array.isArray = ${isArr}`);
  console.log(`返回对象键 = ${raw && typeof raw === 'object' ? Object.keys(raw as object).join(',') : 'n/a'}`);
  console.log(`store 被调用次数 = ${storeCalls}`);
  console.log(`loader 解包后 findings 条数 = ${findings.length}`);
  console.log(`findings 内容 = ${JSON.stringify(findings, null, 1)}`);
}
