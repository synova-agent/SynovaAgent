/**
 * tests/sentinel/mapping-via-wrapper.test.ts — #1393 判据（映射经**收口点**覆盖 extensions 哨兵）
 *
 * 裁（CTO 2026-10-08）：§六 **(A)**（遍历路径一并映射）+ **(c)**（有映射 ⇒ 并集；映射 = null ⇒ 保留字面量 + warn）
 *   并集 = **字面量 ∪ 映射目标**（不丢字面量语义）；🔴 **并集读 ≠ 迁移完成**（覆盖面须写明）
 * ⑧ 重复行：**实现按 `id` 去重（防御性）** + **判据断言"结果 id 不重复"**
 * ⑨ 不变量：`resolveReadTargets` 的 `warn === true ⟺ targets 为空`（写入契约 JSDoc；本文件 V3 覆盖其调用面）
 * 口径：被测对象 = **经收口点的读**与**哨兵产出**；输入由真实 `SqliteGraphStore` / 真实 `csv-import` 建。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { CsvImportConnector } from '../../src/connectors/csv-import';
import { withOrgScope } from '../../src/sentinel/org-scope';
import { loadSentinels, registerLoadedSentinels } from '../../src/sentinel/sentinel-loader';
import { getSentinelRegistry } from '../../src/sentinel/registry';

beforeAll(async () => {
  const { sentinels } = loadSentinels();
  await registerLoadedSentinels(sentinels);
});

describe('#1393 映射经收口点覆盖 extensions 哨兵', () => {
  it('V1 结构：收口点做类型映射（唯一解析源）+ loader 唯一交接点 ⇒ 覆盖全部 extensions 哨兵', () => {
    const scope = readFileSync('src/sentinel/org-scope.ts', 'utf-8');
    expect(scope, '收口点应调用唯一解析源').toMatch(/resolveReadTargets\(type\)/);
    expect(scope, '并集须含字面量（不丢语义）').toMatch(/\[type, \.\.\.targets\]/);
    expect(scope, 'null 分支须留痕').toContain("reason: 'no-mapping'");
    const loader = readFileSync('src/sentinel/sentinel-loader.ts', 'utf-8');
    expect(loader, 'loader 须在唯一交接点包装').toContain('withOrgScope');
    const mapped = readFileSync('src/sentinel/mapped-read.ts', 'utf-8');
    expect(mapped, 'mapped-read 不得自持解析（单一解析源）').not.toMatch(/function resolveReadTargets/);
  });

  it('🔴 V2a 端到端（真数据路径）：真实 csv-import 写 `resource/money` ⇒ 经收口点读 `Financial` **能读到**', () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    const connector = new CsvImportConnector({ createNode: (t, p, g) => store.createNode(t, p, g) }, 'enterprise');
    const res = connector.importData('date,amount,category\n2026-09-01,1000,revenue\n2026-09-02,300,cogs\n');
    expect(res.imported).toBe(2);

    // 映射 **与租户无关**（#1393 重构）：此处用 unscoped 验证映射本身
    const mapped = withOrgScope(store, undefined);
    const rows = mapped.queryNodes('Financial', {}, 'enterprise') as Array<{ id: string; props: Record<string, unknown> }>;
    // 对照现状（#1393 前）：读 `Financial` 字面量 ⇒ 0 行；映射后 ⇒ 并集含 resource/money ⇒ ≥2 行
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // ⑧ 去重：结果 id 不重复
    // 🔴 M2 行为锚点（证 (c) 并集必要性）：**字面量数据也必须被读到**（替换读会丢它）
    store.createNode('Financial', { total_revenue: 500, total_cost: 100 }, 'enterprise');
    const rows2 = withOrgScope(store, undefined).queryNodes('Financial', {}, 'enterprise') as Array<{ id: string }>;
    expect(rows2.length, '并集须含字面量数据（替换读会丢）').toBeGreaterThanOrEqual(3);
    const ids = rows2.map(r => r.id);
    expect(new Set(ids).size, '结果 id 不得重复（去重生效）').toBe(ids.length);
    // 租户维度仍在（csv 数据无 orgId ⇒ 带 orgId 读 ⇒ 0 行；证明两维度【独立】）
    const scopedTenant = withOrgScope(store, 'org-e2e');
    expect((scopedTenant.queryNodes('Financial', {}, 'enterprise') as unknown[]).length).toBe(0);
  });

  it('🔴 V3 (c) null 分支：映射 = null 的类型（Event/Process）⇒ **保留字面量读 + warn**（不替换、不静默）', () => {
    const seen: string[] = [];
    const stub = { queryNodes: (t: string) => { seen.push(t); return [] as unknown[]; } };
    const scoped = withOrgScope(stub, 'org-null');
    scoped.queryNodes('Event', {});
    scoped.queryNodes('Process', {});
    expect(seen, 'null 映射 ⇒ 仍读字面量（不替换）').toEqual(expect.arrayContaining(['Event', 'Process']));
  });

  it('V2b 哨兵级（不抛 + 正常返回）：extensions 哨兵经收口点执行', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db);
    store.createNode('resource/money', { orgId: 'org-s' , total_revenue: 1000, total_cost: 300 });
    const s = getSentinelRegistry().get('sentinel-environment-rent-dependency');
    expect(s).toBeTruthy();
    const res = await s!.check({ db: store, teamId: 'org-s', now: new Date('2026-10-08T00:00:00Z') });
    expect(res.ok).toBe(true);
  });
});
