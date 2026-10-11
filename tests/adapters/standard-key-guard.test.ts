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
  // #1412 (C) 后：**默认已带守卫** ⇒ 本用例显式关守卫以保留"裸语义"对照（审计口径：见 V4-new）
  const raw = new SqliteGraphStore(db, { standardKeyGuard: false });
  const guarded = wrapStandardKeyGuard(new SqliteGraphStore(db, { standardKeyGuard: false }));
  return { db, store: guarded, raw };
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

describe('#1412 (C) 守卫【默认开】（不枚举构造点）', () => {
  it('🔴 V1【行为】**默认构造**的 store（不传任何选项）同键写 2 次 ⇒ **1 行**（证明"默认覆盖"）', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);   // ← 不传选项 = 默认带守卫
    const key = 'default:Financial:2026-Q2:2026-04-01';
    const a = store.createNode('Financial', { standardKey: key, v: 1 }, 'default');
    const b = store.createNode('Financial', { standardKey: key, v: 2 }, 'default');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
    expect(n, '默认带守卫 ⇒ 同键不得重复插入').toBe(1);
    expect(a, '应返回既有节点 id').toBe(b);
  });

  it('🔴 V2【行为】**显式 opt-out** 的 store ⇒ 裸语义（2 行）—— 保证测试可控', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db, { standardKeyGuard: false });
    const key = 'default:Financial:2026-Q2:2026-04-01';
    store.createNode('Financial', { standardKey: key, v: 1 }, 'default');
    store.createNode('Financial', { standardKey: key, v: 2 }, 'default');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
    expect(n, 'opt-out ⇒ 裸写（2 行）').toBe(2);
  });

  it('V3【行为】**不同键** ⇒ 2 行（不误合）', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    store.createNode('Financial', { standardKey: 'default:Financial:2026-Q2:2026-04-01' }, 'default');
    store.createNode('Financial', { standardKey: 'default:Financial:2026-Q3:2026-07-01' }, 'default');
    expect((db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n).toBe(2);
  });

  it('🔴 V4-new【形态扫描·只证明形态】**生产路径没有 opt-out**（`src/**` 里 `standardKeyGuard: false` 必须为零）', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    // 🔴 精度纪律（今天第 4 次踩同型）：**扫"代码" ≠ 扫"注释"** ⇒ 排除注释行再判
    const raw = execSync("grep -rn 'standardKeyGuard: false' src/ --include='*.ts' || true", { encoding: 'utf-8' }).trim();
    const out = raw.split('\n').filter(Boolean).filter((l) => {
      const code = l.split(':', 3)[2] ?? '';
      const trimmed = code.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    }).join('\n');
    expect(out, `生产路径不得关闭守卫（发现：${out}）`).toBe('');
  });
});
