/**
 * tests/sentinel/traversal-fallback-b4.test.ts — #1387 **B4 收尾批** 判据（机制③ 全清）
 *
 * 收尾证据（CTO 2026-10-08 要求）：
 *   ① **17/17 逐哨兵点名**（不是"17 个"）
 *   ② **每批判据指针**（B1/B2/B3/B4 的 PR 号 + 判据文件）
 *   ③ **旧形态零残留的【全局】regex 断言**（不只每批文件内）
 * 短路声明（CTO 新规）：`V2①-b`（不编造 metrics）对本批**对象不具备**（本批哨兵未接指标级）
 *   ⇒ 该判据对**已接线批次**（B1 / #1375）有效 —— 别处已接线时有判别力。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';
import { createMetricSink } from '../../src/sentinel/metric-readings-writer';

/** ② 每批判据指针（PR 号 + 判据文件） */
const BATCH_LEDGER = [
  { batch: 'B1', pr: 'https://github.com/synova-agent/SynovaAgent/pull/1388', test: 'tests/sentinel/traversal-fallback-b1.test.ts', sentinels: ['agent-deployment-maturity', 'ai-ecosystem-fit', 'ai-investment-return'] },
  { batch: 'B2', pr: 'https://github.com/synova-agent/SynovaAgent/pull/1389', test: 'tests/sentinel/traversal-fallback-b2.test.ts', sentinels: ['api-coverage', 'data-health', 'explore-exploit-balance', 'human-agent-boundary', 'make-or-buy'] },
  { batch: 'B3', pr: 'https://github.com/synova-agent/SynovaAgent/pull/1390', test: 'tests/sentinel/traversal-fallback-b3.test.ts', sentinels: ['moat-dependency', 'niche-breadth', 'niche-squeeze', 'opportunity-window', 'process-ai-readiness'] },
  { batch: 'B4', pr: '(本 PR)', test: 'tests/sentinel/traversal-fallback-b4.test.ts', sentinels: ['resource-misallocation', 'routine-mutation', 'strategy-capability-fit', 'value-capture'] },
] as const;

const ALL_17 = BATCH_LEDGER.flatMap(b => [...b.sentinels]);
const B4 = BATCH_LEDGER[3].sentinels as readonly string[];

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === '_extinct' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/aggregate\.ts$/.test(p)) out.push(p);
  }
  return out;
}

describe('#1387 B4 · 机制③ 全清（收尾批）', () => {
  it('① 收尾证据：**17/17 逐哨兵点名**（每批 3+5+5+4；每个都含 traversal-no-edge 留痕）', () => {
    expect(ALL_17.length).toBe(17);
    for (const n of ALL_17) {
      const src = readFileSync(`extensions/sentinels/${n}/aggregate.ts`, 'utf-8');
      expect(src, `${n} 应有 traversal-no-edge 留痕`).toMatch(/log\.warn\(\{[^}]*reason: 'traversal-no-edge'/);
    }
  });

  it('② 每批判据指针：4 批的 PR 号 + 判据文件均在册（本批 = B4）', () => {
    expect(BATCH_LEDGER.map(b => b.batch)).toEqual(['B1', 'B2', 'B3', 'B4']);
    for (const b of BATCH_LEDGER) {
      expect(b.pr.length).toBeGreaterThan(0);
      expect(() => readFileSync(b.test, 'utf-8')).not.toThrow();   // 判据文件实存
    }
  });

  it('🔴 ③ 旧形态【全局】零残留：全仓活跃哨兵 aggregate 无 `if (!r.nodes[0]) return [];`', () => {
    const files = walk('extensions/sentinels');
    const offenders = files.filter(f => /if \(!r\.nodes\[0\]\) return \[\];/.test(readFileSync(f, 'utf-8')));
    expect(offenders, `仍存在静默早退的文件：${offenders.join(', ')}`).toEqual([]);
    expect(files.length).toBeGreaterThan(40);   // 防"扫了个空目录"假过（R109）
  });

  it('🔴 V2②【行为探针】B4 四哨兵：无匹配边时仍继续读（对照改前 0 次读）', async () => {
    const db = new Database(':memory:');
    const real = new SqliteGraphStore(db);
    real.createNode('Tool', { orgId: 'org-b4', name: 't1' });
    real.createNode('Process', { orgId: 'org-b4', name: 'p1' });
    real.createNode('Document', { orgId: 'org-b4', name: 'd1' });
    real.createNode('Event', { orgId: 'org-b4', eventType: 'market' });
    real.createNode('Person', { orgId: 'org-b4', name: 'zhang' });
    let reads = 0;
    const counting = { queryNodes: (t: string, f?: Record<string, unknown>, g?: string) => { reads++; return real.queryNodes(t, f, g) as unknown[]; } };
    const sink = createMetricSink(db);
    for (const n of B4) {
      const before = reads;
      const s = getSentinelRegistry().get(`sentinel-${n}`);
      expect(s, `${n} 应在注册表`).toBeTruthy();
      const res = await s!.check({ db: counting, metricSink: sink, teamId: 'org-b4', now: new Date('2026-10-08T00:00:00Z') });
      expect(res.ok).toBe(true);
      expect(reads, `${n} 无匹配边时应继续读（不早退）`).toBeGreaterThan(before);
    }
  });
});
