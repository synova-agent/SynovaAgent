/**
 * fixture-e2e.mts — D968 Done③ / B2(H1 跨源) 独立验收（自建夹具 + 真实管线 + 红对照）
 * 用法: tsx fixture-e2e.mts --wt=<tree> --mode=single|drift|single-noclear|single-noenv
 *  - single / noclear / noenv : 1 个目录夹具 ⇒ 加载数=1 的三向判别
 *  - drift                    : 2 个目录（1 健康 + 1 entryPoint 缺失）⇒ H1 跨源告警
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=single').slice(7);
process.chdir(WT);
const FIX = join(tmpdir(), `vd968-${MODE}`);
rmSync(FIX, { recursive: true, force: true });

function writeSentinel(name: string, breakEntry: boolean, withFinding: boolean) {
  const dir = join(FIX, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    name, version: '1.0.0', type: 'sentinel', displayName: name, description: 'vd968 fixture',
    schedule: '0 9 * * *', expert: 'fundamental-efficiency', priority: 'P2', computes: [],
    thresholds: { x: { warning: 0.4, critical: 0.7 } }, aggregation: 'worst_first',
    context: { requiredDataSources: [], dataAccess: { allowedDimensions: [], sensitiveAccess: 'read' } },
    entryPoint: './aggregate.ts', exportKey: 'vd968FixtureSentinel',
  }));
  if (!breakEntry) {
    writeFileSync(join(dir, 'aggregate.ts'), withFinding
      ? `export const vd968FixtureSentinel = {\n  async check() {\n    return [{ id: 'vd968-real-finding', severity: 'warning', title: '夹具真产出', description: 'fixture', evidence: ['e'], suggestion: 'n/a', detectedAt: new Date().toISOString() }];\n  },\n};\n`
      : `export const vd968FixtureSentinel = {\n  async check() { return []; },\n};\n`);
  }
}

const { loadSentinels, clearSentinelCache, registerLoadedSentinels } = await import(`${WT}/src/sentinel/sentinel-loader.ts`);
const { getSentinelRegistry, destroySentinelRegistry } = await import(`${WT}/src/sentinel/registry.ts`);
const { reconcileSchema } = await import(`${WT}/src/store/schema-migration.ts`);
const { createSentinelEventsTable } = await import(`${WT}/src/sentinel/sentinel-events.ts`);
const { CronScheduler } = await import(`${WT}/src/cron/scheduler.ts`);
const { SentinelRunner } = await import(`${WT}/src/sentinel/runner.ts`);

const mainCount = (() => { delete process.env.SENTINELS_FIXTURE_DIR; clearSentinelCache(); const n = loadSentinels().sentinels.length; delete process.env.SENTINELS_FIXTURE_DIR; clearSentinelCache(); return n; })();
console.log(`# 主目录加载数（对照）= ${mainCount}`);

if (MODE === 'single' || MODE === 'noclear' || MODE === 'noenv') {
  writeSentinel('vd968-only', false, true);
  destroySentinelRegistry();
  if (MODE === 'noenv') {
    delete process.env.SENTINELS_FIXTURE_DIR;
  } else {
    process.env.SENTINELS_FIXTURE_DIR = FIX;
  }
  // ⚠️ 先制造"主目录已入缓存"，再决定是否 clear —— 这正是 cache 陷阱
  if (MODE === 'noclear') {
    delete process.env.SENTINELS_FIXTURE_DIR; clearSentinelCache(); loadSentinels(); // 主目录进缓存
    process.env.SENTINELS_FIXTURE_DIR = FIX;                                        // 设 env 但不 clear
  } else if (MODE !== 'noenv') {
    clearSentinelCache();
  }
  const load = loadSentinels();
  console.log(`# [${MODE}] loadSentinels().sentinels.length = ${load.sentinels.length}（期望 1） errors=${JSON.stringify(load.errors)}`);
  console.log(`# [${MODE}] ASSERT 加载数=1 → ${load.sentinels.length === 1 ? 'HOLDS' : 'VIOLATED'}`);
  if (MODE === 'single') {
    clearSentinelCache();
    process.env.SENTINELS_FIXTURE_DIR = FIX;
    const reg = await registerLoadedSentinels();
    console.log(`# [single] registerLoadedSentinels = ${JSON.stringify(reg)}`);
    console.log(`# [single] registry.list() = ${JSON.stringify(getSentinelRegistry().list().map(s => s.config.id))}`);
    // 端到端: 真跑一次 → 事件流里必须出现夹具 finding（不是"注册成功"就算）
    const db = new Database(':memory:');
    reconcileSchema(db);
    createSentinelEventsTable(db);
    const runner = new SentinelRunner(new CronScheduler(db), db);
    const SID = `sentinel-vd968-only`;
    await (runner as unknown as { runOnce: (id: string) => Promise<unknown> }).runOnce(SID);
    const evs = db.prepare("SELECT payload FROM sentinel_events WHERE sentinel_id = ? AND event_type='finding'").all(SID) as Array<{ payload: string }>;
    const ids = evs.map(e => (JSON.parse(e.payload) as { finding?: { id: string } }).finding?.id).filter(Boolean) as string[];
    console.log(`# [single] 端到端事件 payload findings = ${JSON.stringify(ids)}`);
    console.log(`# [single] ASSERT 真产出 finding（vd968-real-finding 落事件流）→ ${ids.includes('vd968-real-found')||ids.includes('vd968-real-finding') ? 'HOLDS' : 'VIOLATED'}`);
    console.log(`# [single] ASSERT registry 注册数=1 → ${getSentinelRegistry().count() === 1 ? 'HOLDS' : 'VIOLATED'}`);
    db.close();
  }
}

if (MODE === 'drift') {
  writeSentinel('vd968-good', false, false);
  writeSentinel('vd968-broken', true, false); // manifest 存在但 entryPoint 缺失
  process.env.SENTINELS_FIXTURE_DIR = FIX;
  clearSentinelCache();
  destroySentinelRegistry();
  const load = loadSentinels();
  console.log(`# [drift] 磁盘源 loadSentinels() = ${load.sentinels.length}（期望 2） errors(load)=${JSON.stringify(load.errors)}`);
  const reg = await registerLoadedSentinels();
  console.log(`# [drift] 注册源 registerLoadedSentinels = ${JSON.stringify(reg)}`);
  console.log(`# [drift] registry.count() = ${getSentinelRegistry().count()}（期望 1）`);
  const db = new Database(':memory:');
  reconcileSchema(db);
  createSentinelEventsTable(db);
  const runner = new SentinelRunner(new CronScheduler(db), db);
  await (runner as unknown as { runSelfCheck: () => Promise<void> }).runSelfCheck();
  const rows = db.prepare("SELECT payload FROM sentinel_events WHERE sentinel_id = 'sentinel-self-check' ORDER BY seq DESC LIMIT 5").all() as Array<{ payload: string }>;
  const allIds = rows.flatMap(r => { const p = JSON.parse(r.payload) as { findings?: Array<{ id: string }>; finding?: { id: string } }; return p.findings ? p.findings.map(f => f.id) : p.finding ? [p.finding.id] : []; });
  console.log(`# [drift] runSelfCheck 落事件 finding ids = ${JSON.stringify([...new Set(allIds)])}`);
  const h1 = allIds.filter(i => i.startsWith('self-check-H1-'));
  console.log(`# [drift] ASSERT H1 告警（跨源 ratio<1）→ ${h1.length > 0 ? 'HOLDS' : 'VIOLATED'}`);
  const R = (() => { const m = rows.map(r => JSON.parse(r.payload) as { findings?: Array<{ id: string; description?: string }>; finding?: { id: string; description?: string } }); const fs2 = m.flatMap(x => x.findings ?? (x.finding ? [x.finding] : [])); const f = fs2.find(x => x.id.startsWith('self-check-H1-')); return f?.description ?? '(无)'; })();
  console.log(`# [drift] H1 描述 = ${R}`);
  db.close();
}
rmSync(FIX, { recursive: true, force: true });
process.exit(0);
