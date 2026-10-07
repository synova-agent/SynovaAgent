/**
 * 独立复现探针 — 哨兵体系基线（前提冻结用，非交付物）
 *
 * 口径 A（运行时）：真 SqliteGraphStore + data/synova.db 副本，逐个 await aggregate.check(store,'probe-team')
 * 口径 B（静态）：源码文本中 queryNodes/queryEdges/traverse 出现次数
 *
 * 独立于 CTO 派单件：不复用其任何脚本，自己写、自己跑。
 */
import { createRequire } from 'module';
const require = createRequire('/Users/wane/SynovaAgent/package.json');
const Database = require('better-sqlite3');
import { readdirSync, readFileSync, existsSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const SEN_DIR = join(ROOT, 'extensions', 'sentinels');

// ── 用 data/synova.db 副本（禁止直接动生产库）
const TMP_DB_DIR = '/tmp/sentinel-probe/db';
mkdirSync(TMP_DB_DIR, { recursive: true });
const DBB = join(TMP_DB_DIR, 'probe.db');
for (const suf of ['', '-wal', '-shm']) {
  const src = join(ROOT, 'data', `synova.db${suf}`);
  if (existsSync(src)) copyFileSync(src, join(TMP_DB_DIR, `probe.db${suf}`));
}

const db = new Database(DBB);
const { SqliteGraphStore } = await import(join(ROOT, 'src/adapters/sqlite-graph-store.ts'));
const { createGraphTraversal } = await import(join(ROOT, 'src/l4/graph-traversal.ts'));

// ── 插桩计数 store
const counts = { queryNodes: 0, queryEdges: 0, getNode: 0, traverse: 0 };
const rawStore = new SqliteGraphStore(db);
const store: Record<string, unknown> = {};
for (const m of ['queryNodes', 'queryEdges', 'getNode'] as const) {
  const fn = (rawStore as unknown as Record<string, (...a: unknown[]) => unknown>)[m];
  store[m] = (...args: unknown[]) => { counts[m]++; return fn.apply(rawStore, args); };
}
const traversalRaw = createGraphTraversal(store as never);
const traversal = {
  traverse: (...a: Parameters<typeof traversalRaw.traverse>) => { counts.traverse++; return traversalRaw.traverse(...a); },
};

// ── 扫描 manifest
const dirs = readdirSync(SEN_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'shared' && !e.name.startsWith('_'))
  .map(e => e.name)
  .sort();

const rows: Array<Record<string, unknown>> = [];

for (const name of dirs) {
  const dir = join(SEN_DIR, name);
  const mp = join(dir, 'manifest.json');
  if (!existsSync(mp)) { rows.push({ name, verdict: 'NO_MANIFEST' }); continue; }
  const manifest = JSON.parse(readFileSync(mp, 'utf-8')) as Record<string, unknown>;
  const entryPoint = (manifest.entryPoint as string) || './aggregate.ts';
  const exportKey = (manifest.exportKey as string) || 'default';
  const entryPath = join(dir, entryPoint);

  const before = { ...counts };
  let verdict: string; let detail = ''; let findingsLen = -1; let isArray = false;
  const thresholds = (manifest.thresholds as Record<string, unknown>) || {};

  if (!existsSync(entryPath)) {
    verdict = 'ENTRY_MISSING'; detail = entryPath;
  } else {
    try {
      const mod = await import(pathToFileURL(entryPath).href) as Record<string, unknown>;
      const obj = mod[exportKey] as { check?: (...a: unknown[]) => unknown } | undefined;
      if (!obj || typeof obj.check !== 'function') {
        verdict = 'NO_CHECK_EXPORT'; detail = `exportKey=${exportKey} keys=${Object.keys(mod).join(',')}`;
      } else {
        // 复刻生产包装：manifest 挂载（sentinel-loader.ts:210 守卫逻辑）
        if ('manifest' in obj) (obj as Record<string, unknown>).manifest = manifest;
        const raw = await obj.check(store, 'probe-team', traversal, thresholds);
        isArray = Array.isArray(raw);
        if (isArray) {
          findingsLen = (raw as unknown[]).length;
          verdict = 'OK_ARRAY';
        } else {
          verdict = 'NON_ARRAY';
          detail = `typeof=${typeof raw} keys=${raw && typeof raw === 'object' ? Object.keys(raw).join(',') : 'n/a'}`;
        }
      }
    } catch (err: unknown) {
      verdict = 'THROW';
      detail = err instanceof Error ? `${err.message}`.slice(0, 200) : String(err).slice(0, 200);
    }
  }
  const after = { ...counts };
  const calls = (after.queryNodes - before.queryNodes) + (after.queryEdges - before.queryEdges)
    + (after.getNode - before.getNode) + (after.traverse - before.traverse);
  rows.push({
    name, verdict, detail, isArray, findingsLen,
    calls,
    qn: after.queryNodes - before.queryNodes,
    qe: after.queryEdges - before.queryEdges,
    gn: after.getNode - before.getNode,
    tv: after.traverse - before.traverse,
    expert: manifest.expert, schedule: manifest.schedule, computes: (manifest.computes as unknown[])?.length ?? 0,
  });
}

// ── 静态口径：源码文本中出现 queryNodes/queryEdges/traverse 的次数
const staticRows: Array<Record<string, unknown>> = [];
for (const r of rows) {
  const dir = join(SEN_DIR, String(r.name));
  let text = '';
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) text += readFileSync(p, 'utf-8');
    }
  };
  if (existsSync(dir)) walk(dir);
  staticRows.push({
    name: r.name,
    qn: (text.match(/queryNodes/g) || []).length,
    qe: (text.match(/queryEdges/g) || []).length,
    tv: (text.match(/traverse\s*\(/g) || []).length,
    storeKw: (text.match(/\bstore\b/g) || []).length,
  });
}

// ── 汇总
const total = rows.length;
const arr = rows.filter(r => r.verdict === 'OK_ARRAY');
const nonArr = rows.filter(r => r.verdict === 'NON_ARRAY');
const throws = rows.filter(r => r.verdict === 'THROW');
const other = rows.filter(r => !['OK_ARRAY', 'NON_ARRAY', 'THROW'].includes(String(r.verdict)));
const zeroFind = arr.filter(r => r.findingsLen === 0);
const zeroCalls = rows.filter(r => r.calls === 0);
const staticZeroQN = staticRows.filter(r => r.qn === 0);
const staticZeroQNQE = staticRows.filter(r => r.qn === 0 && r.qe === 0);

console.log('════════ 运行时口径（真 store + 副本库）════════');
console.log(`哨兵总数（manifest 目录）        = ${total}`);
console.log(`✅ check() 返回数组             = ${arr.length}`);
console.log(`❌ 抛错/异常                    = ${throws.length}`);
console.log(`❌ 返回非数组                    = ${nonArr.length}`);
console.log(`其他                            = ${other.length} ${JSON.stringify(other.map(r => [r.name, r.verdict]))}`);
console.log(`⚪ 跑通但零 finding             = ${zeroFind.length}`);
console.log(`调用 store 次数 = 0 的哨兵       = ${zeroCalls.length}  ${JSON.stringify(zeroCalls.map(r => r.name))}`);
console.log(`异常清单:`);
for (const r of [...throws, ...nonArr, ...other]) console.log(`   ${r.name} → [${r.verdict}] ${r.detail}`);
console.log('════════ 静态口径（源码文本计数）════════');
console.log(`queryNodes 文本出现 = 0 的哨兵   = ${staticZeroQN.length}`);
console.log(`queryNodes+queryEdges 皆 0      = ${staticZeroQNQE.length}`);
console.log('  名单(后一组): ' + JSON.stringify(staticZeroQNQE.map(r => r.name)));
console.log('  名单(queryNodes=0): ' + JSON.stringify(staticZeroQN.map(r => r.name)));
console.log('════════ 逐哨兵明细 ════════');
for (const r of rows) console.log(JSON.stringify(r));

import { writeFileSync } from 'fs';
writeFileSync('/tmp/sentinel-probe/runtime-rows.json', JSON.stringify(rows, null, 2));
writeFileSync('/tmp/sentinel-probe/static-rows.json', JSON.stringify(staticRows, null, 2));
db.close();
