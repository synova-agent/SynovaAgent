/**
 * tests/runtime/dsh/domain-context-scan.test.ts — #1459 T-A：**真实扫描数据**上的上下文契约。
 *
 * 为什么单列：T0 的隔离文件库尚未就绪时，本任务已在测试内直接调 `EnterpriseScanService`
 * 对 `tests/enterprise-scan/fixtures.ts` 跑一次真实扫描（落 `:memory:` 隔离库，不碰 `data/synova.db`），
 * 再以 `team:delivery-a` / `delivery_batch:B-2026-10-001` 为根验证 `buildContextSnapshot` 的新契约。
 *
 * 验收（DEV DOC #1459 §5/§7 T2）：
 *   · 根 `team:delivery-a` ⇒ `count===2`，且**至少一条** item 同时满足
 *     `relation.type==='edge/team_executes_activity'`、`evidence.sources[0].ref` 非空、`period`/`defVersion` 非空；
 *   · 反例：根 `delivery_batch:B-2026-10-001` ⇒ `insufficient.code==='INSUFFICIENT_CONTEXT'`（不得 count:0 成功）；
 *   · 同输入两次调用 JSON 逐字相等（sources 顺序稳定）。
 *
 * 数据纪律：只连 `:memory:`（beforeAll fail-fast 断言）；graph=`org-a` 来自扫描 viewer，不读真实客户数据。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { seedManifest, writeFixtureRoot } from '../../enterprise-scan/fixtures';
import { viewer } from '../../enterprise-scan/test-helpers';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { EnterpriseScanStore } from '../../../src/l4/enterprise-scan-store';
import { EnterpriseScanService } from '../../../src/agent/enterprise-scan-service';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { buildContextSnapshot } from '../../../src/runtime/dsh/domain-context';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';
import type { ContextSnapshot, ToolCallContext } from '../../../src/runtime/dsh/tools';

/** 扫描夹具 viewer 的 orgId（`tests/enterprise-scan/test-helpers.ts` 默认 `org-a`）。 */
const GRAPH = 'org-a';
const CTX: ToolCallContext = { enterpriseId: GRAPH, userId: 'owner-a', scope: 'admin', runId: 'run_1459_t_a' };
const TEAM_ROOT = 'team:delivery-a';
const BATCH_ROOT = 'delivery_batch:B-2026-10-001';

interface AssertionVersionRow {
  assertion_version_id: string;
  evidence_status: string;
  instance_state: string;
}

interface EvidenceRow {
  evidence_id: string;
  source_ref: string;
}

/** 独立直查：某节点最新断言版本（与实现同判据，用于证明输出值来自库内、不是常量）。 */
function readLatestAssertionVersion(nodeId: string): AssertionVersionRow {
  return getDatabase()
    .prepare(
      `SELECT av.assertion_version_id, av.evidence_status, av.instance_state
         FROM scan_assertions a
         JOIN scan_assertion_versions av ON av.graph = a.graph AND av.assertion_id = a.assertion_id
        WHERE a.graph = ? AND a.target_kind = 'node' AND a.target_object_id = ?
        ORDER BY av.created_at DESC, av.rowid DESC
        LIMIT 1`,
    )
    .get(GRAPH, nodeId) as AssertionVersionRow;
}

/** 独立直查：某断言版本的全部证据行（`source_ref` ＋ 逻辑 `evidence_id`）。 */
function readEvidenceRows(assertionVersionId: string): EvidenceRow[] {
  return getDatabase()
    .prepare(
      `SELECT sev.evidence_id AS evidence_id, sae.source_ref AS source_ref
         FROM scan_assertion_evidence sae
         JOIN scan_evidence_versions sev
           ON sev.graph = sae.graph AND sev.evidence_version_id = sae.evidence_version_id
        WHERE sae.graph = ? AND sae.assertion_version_id = ?
        ORDER BY sae.source_ref ASC, sev.evidence_id ASC`,
    )
    .all(GRAPH, assertionVersionId) as EvidenceRow[];
}

beforeAll(async () => {
  // 硬规则 fail-fast：本文件只允许 :memory:（误连真库会写入真实客户库）
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`domain-context-scan.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const db = getDatabase();
  const graphStore = new SqliteGraphStore(db);
  const service = new EnterpriseScanService(new EnterpriseScanStore(db, graphStore));
  const root = writeFixtureRoot();
  seedManifest(db, { root });
  const result = await service.run(viewer(), 'manifest-golden', 'request-1459-t-a');
  // 扫描真产出了 4 对象 / 2 边 / 11 断言（夹具契约；不是手工 INSERT）
  expect(result.report.ontology.objects).toHaveLength(4);
  expect(result.report.ontology.relations).toHaveLength(2);
  expect(result.report.assertions).toHaveLength(11);
});

describe('#1459 T-A 真实扫描数据 → synova_context_get 契约', () => {
  it('根 team:delivery-a ⇒ count=2，每条 item 的 relation/evidence/period/defVersion 都来自库内', () => {
    const snapshot: ContextSnapshot = buildContextSnapshot(CTX, TEAM_ROOT);
    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.count).toBe(2);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.insufficient).toBeUndefined();

    for (const item of snapshot.items) {
      expect(item.period).toBe('2026-10');
      expect(item.defVersion).toBe('delivery-v1');
      expect(item.relation?.type).toBe('edge/team_executes_activity');
      expect(item.relation?.direction).toBe('out');
      expect(typeof item.relation?.edgeId).toBe('string');

      const version = readLatestAssertionVersion(item.$id);
      expect(item.evidence?.evidenceStatus).toBe(version.evidence_status);
      expect(item.evidence?.instanceState).toBe(version.instance_state);

      const rows = readEvidenceRows(version.assertion_version_id);
      const expectedRefs = [...new Set(rows.map(row => row.source_ref))];
      expect(item.evidence?.sources.map(source => source.ref)).toEqual(expectedRefs);
      expect(item.evidence?.sources.length).toBeGreaterThan(0);
      expect(item.evidenceId).toBe(rows[0].evidence_id);
    }

    // 验收原文：至少一条 item 同时有 relation.type + sources[0].ref 非空 + period/defVersion 非空
    expect(snapshot.items.some(item =>
      item.relation?.type === 'edge/team_executes_activity'
      && (item.evidence?.sources[0]?.ref ?? '').length > 0
      && item.period.length > 0
      && item.defVersion.length > 0)).toBe(true);

    // 真实工具入口（tools.ts 分派，不是只测内部函数）返回同一快照
    const viaTool = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: TEAM_ROOT }, CTX)) as ContextSnapshot;
    expect(viaTool).toEqual(snapshot);
  });

  it('反例：根 delivery_batch:B-2026-10-001 ⇒ insufficient（count=0 不冒充成功，不抛 error）', () => {
    const snapshot: ContextSnapshot = buildContextSnapshot(CTX, BATCH_ROOT);
    expect(snapshot.count).toBe(0);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.insufficient).toMatchObject({ code: 'INSUFFICIENT_CONTEXT' });
    // batch 根的 1 跳只有 team（props 无 period/defVersion）⇒ 缺项由实现显式列出
    expect(snapshot.insufficient?.missing).toEqual(['defVersion', 'period']);
    expect(snapshot.insufficient?.reason).toContain('不足以形成瓶颈假设');

    // 工具入口同样返回 insufficient 字段（不抛 error、不是空成功）
    const viaTool = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: BATCH_ROOT }, CTX)) as ContextSnapshot;
    expect(viaTool.insufficient?.code).toBe('INSUFFICIENT_CONTEXT');
  });

  it('同输入两次调用 JSON 逐字相等（sources 顺序稳定）', () => {
    const first = buildContextSnapshot(CTX, TEAM_ROOT);
    const second = buildContextSnapshot(CTX, TEAM_ROOT);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
