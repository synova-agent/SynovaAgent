/**
 * tests/l4/standard-key-guard.test.ts — #1403 判据（标准键写入守卫：一处收口 + 两路径共用）
 *
 * CTO 2026-10-08 裁 (A)：抽**共享守卫**（`src/adapters/standard-key-guard.ts`）+ composition root 包一次；
 *   **不许** ingest 直调 graph-bridge（L2↛L4，门禁 `check-architecture.sh:41-44` 硬阻断）
 * 判据口径（R192）：**行为断言优先**；形态扫描**写明"只证明形态"**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { wrapStandardKeyGuard } from '../../src/adapters/standard-key-guard';
import { ingestBatch, loadFieldMapping } from '../../src/agent/data-ingest-service';

function makeGuarded() {
  const db = new Database(':memory:');
  const store = new SqliteGraphStore(db);
  const guarded = wrapStandardKeyGuard(store);
  return { db, store: guarded, raw: store };
}

describe('#1403 标准键写入守卫', () => {
  it('🔴 V1【行为】同一事实经**守卫**导入 2 次 ⇒ **1 行**（对照：未守卫现状 2 行）', async () => {
    const { db, store } = makeGuarded();
    const mk = () => ({ createNode: (t: string, p: Record<string, unknown>, g: string) => store.createNode(t, p, g) });
    const row = [{ 营业收入: 1000, 期间: '2026-Q2' }];
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, row, 'default');
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, row, 'default');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
    expect(n, '同键 ⇒ 不得重复插入').toBe(1);
    const props = JSON.parse((db.prepare('SELECT props FROM graph_nodes').get() as { props: string }).props);
    expect(props.has_conflict, '冲突应留痕（has_conflict）').toBe(true);
    expect(Array.isArray(props.data_versions) && props.data_versions.length >= 1, '旧值应入 data_versions').toBe(true);
  });

  it('🔴 V2【行为】**不同** standardKey ⇒ **2 行**（**不误合** —— 防"检测过严"）', async () => {
    const { db, store } = makeGuarded();
    const mk = () => ({ createNode: (t: string, p: Record<string, unknown>, g: string) => store.createNode(t, p, g) });
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, [{ 营业收入: 1000, 期间: '2026-Q2' }], 'default');
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, [{ 营业收入: 1000, 期间: '2026-Q3' }], 'default');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
    expect(n, '不同期间 ⇒ 不同键 ⇒ 2 行').toBe(2);
  });

  it('V3【行为】键格式不变：`<graph>:<遗留段>:<period>:<validFrom>`（与 #1395 保守解法一致）', async () => {
    const { db, store } = makeGuarded();
    const mk = () => ({ createNode: (t: string, p: Record<string, unknown>, g: string) => store.createNode(t, p, g) });
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, [{ 营业收入: 1000, 期间: '2026-Q2' }], 'default');
    const k = JSON.parse((db.prepare('SELECT props FROM graph_nodes').get() as { props: string }).props).standardKey as string;
    expect(k).toMatch(/^default:[A-Za-z]+:2026-Q2:\d{4}-\d{2}-\d{2}$/);
  });

  it('V5【形态扫描·只证明形态】共享守卫**被两条路径引用**；且 `src/agent/**` 不 import `src/l4/**`（防越层）', () => {
    expect(readFileSync('src/server.ts', 'utf-8'), 'composition root 应包一次').toContain('wrapStandardKeyGuard(graphStore)');
    expect(readFileSync('src/l4/graph-bridge.ts', 'utf-8'), 'L4 应委托共享守卫').toContain('wrapStandardKeyGuard(');
    const agentFiles = ['src/agent/data-ingest-service.ts'];
    for (const f of agentFiles) {
      expect(readFileSync(f, 'utf-8'), `${f} 不得 import L4`).not.toMatch(/from '.*\/l4\//);
    }
  });
});
