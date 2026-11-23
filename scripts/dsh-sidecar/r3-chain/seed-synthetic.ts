/**
 * seed-synthetic.ts — R3 chain evidence script (Issue #1455, T1).
 *
 * Seeds the MINIMAL synthetic ② (ontology) fixture that `synova_context_get` reads,
 * into the task-isolated DB, then verifies it through the PRODUCT tool path
 * (`buildContextSnapshot` — the exact function `handleDomainToolCall` calls).
 *
 * Boundary: synthetic only. No real customer data, no production DB, no ~/.dsh read.
 *
 * 🔴 #1458 改造：可测逻辑走 export（`seedSyntheticFixture`），本文件只在**被直接执行时**
 *    才跑 CLI。理由同 install-profile.ts（`vitest --changed` 需要真实 import 边）。
 *
 * @input  env SYNOVA_DATA_DIR (task-isolated data dir) | SYNTH_ORG_ID | SYNTH_PROBLEM_ID
 * @output stdout: JSON { ok, orgId, problemId, rootId, neighborIds, dbCounts, toolSnapshot }
 * @error  any failure -> non-zero exit with the raw error on stderr (no fake success)
 */
import { pathToFileURL } from 'node:url';
import { initEngineContext, getDatabase } from '../../../src/init/engine-context';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { buildContextSnapshot } from '../../../src/runtime/dsh/domain-context';

/** 种子参数（缺省与 T1 证据件一致）。 */
export interface SeedSyntheticOptions {
  orgId?: string;
  problemId?: string;
  period?: string;
  defVersion?: string;
}

/** T1 证据报告的字段（顺序即 stdout 的键序，勿调整）。 */
export interface SeedSyntheticResult {
  ok: true;
  orgId: string;
  problemId: string;
  foreignGraphProbe: string;
  rootId: string;
  createdThisRun: boolean;
  neighbourIds: string[];
  edgeIds: string[];
  dbCounts: { nodes: number; edges: number };
  toolSnapshot: unknown;
  toolSnapshotInvariant: {
    syntheticIsFalse: boolean;
    problemIdMatches: boolean;
    countAtLeastTwo: boolean;
    allItemsLayer2: boolean;
    allItemsEnterpriseVisibility: boolean;
    allItemsDomainApi: boolean;
    allItemsPeriodDefVersion: boolean;
  };
}

/**
 * 落 ② 合成夹具并用**产品工具路径**自验（幂等：重跑不造重复行）。
 * @input options 缺省从 env 取（SYNTH_ORG_ID / SYNTH_PROBLEM_ID），再缺省为 #1455 的固定值
 * @output SeedSyntheticResult（字段与 T1 证据件一致）
 * @error 任何失败原样抛出（不产出伪造的 ok:true）
 */
export function seedSyntheticFixture(options: SeedSyntheticOptions = {}): SeedSyntheticResult {
  const orgId = options.orgId ?? process.env.SYNTH_ORG_ID ?? 'synth-org-1455';
  const problemId = options.problemId ?? process.env.SYNTH_PROBLEM_ID ?? 'synth-problem-1455-q3';
  const period = options.period ?? '2026-Q3';
  const defVersion = options.defVersion ?? 'v1';

  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const db = getDatabase();

  /** Find the root by businessKey (idempotent re-run). */
  function findRoot(): string | null {
    for (const type of ['problem', 'metric', 'object']) {
      const hits = store.queryNodes(type, { businessKey: problemId }, orgId);
      if (hits.length > 0) return hits.map(hit => hit.id).sort()[0];
      // the root is always typed `problem`; other types are only scanned so a renamed
      // type cannot silently create a duplicate fixture
    }
    return null;
  }

  let rootId = findRoot();
  let created = false;
  if (rootId === null) {
    rootId = store.createNode('problem', {
      businessKey: problemId,
      period,
      defVersion,
      name: 'Synthetic problem object (R3 chain #1455)',
      synthetic: true,
    }, orgId);
    created = true;
  }

  /** Neighbour fixtures (② rows are only emitted when period + defVersion are non-empty strings). */
  const neighbourSpecs = [
    { businessKey: `${problemId}-metric-a`, name: 'Synthetic metric A (R3 chain #1455)' },
    { businessKey: `${problemId}-metric-b`, name: 'Synthetic metric B (R3 chain #1455)' },
  ];
  const neighbourIds: string[] = [];
  for (const spec of neighbourSpecs) {
    const existing = store.queryNodes('metric', { businessKey: spec.businessKey }, orgId);
    const id = existing.length > 0
      ? existing.map(hit => hit.id).sort()[0]
      : store.createNode('metric', {
        businessKey: spec.businessKey,
        period,
        defVersion,
        name: spec.name,
        synthetic: true,
      }, orgId);
    neighbourIds.push(id);
  }

  /** Edges root -> neighbour (idempotent: only when absent). */
  const edgeIds: string[] = [];
  for (const neighbourId of neighbourIds) {
    const out = store.queryEdges(undefined, rootId, undefined, orgId);
    const already = out.some(edge => edge.to === neighbourId);
    edgeIds.push(already ? 'existing' : store.createEdge('relates_to', rootId, neighbourId, 1, {}, orgId));
  }

  /** Candidate edges that must NOT be considered: root edges from a different tenant graph. */
  const foreignGraph = `${orgId}-other-tenant`;

  const snapshot = buildContextSnapshot(
    { enterpriseId: orgId, userId: 'synth-seed-verifier', scope: 'admin', runId: 'seed-verify-1455' },
    problemId,
  );

  const nodeCount = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes WHERE graph = ?').get(orgId) as { n: number }).n;
  const edgeCount = (db.prepare('SELECT COUNT(*) AS n FROM graph_triples WHERE graph = ?').get(orgId) as { n: number }).n;

  return {
    ok: true,
    orgId,
    problemId,
    foreignGraphProbe: foreignGraph,
    rootId,
    createdThisRun: created,
    neighbourIds,
    edgeIds,
    dbCounts: { nodes: nodeCount, edges: edgeCount },
    toolSnapshot: snapshot,
    toolSnapshotInvariant: {
      syntheticIsFalse: snapshot.synthetic === false,
      problemIdMatches: snapshot.problemId === problemId,
      countAtLeastTwo: snapshot.count >= 2,
      allItemsLayer2: snapshot.items.every(item => item.layer === '②'),
      allItemsEnterpriseVisibility: snapshot.items.every(item => item.visibility === 'enterprise'),
      allItemsDomainApi: snapshot.items.every(item => item.source.kind === 'synova.domain' && item.source.api === 'synova.domain/v1'),
      allItemsPeriodDefVersion: snapshot.items.every(item => item.period === period && item.defVersion === defVersion),
    },
  };
}

/** 本模块是否被当作 CLI 直接执行（被 import 时不得产生副作用）。 */
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isInvokedDirectly()) {
  process.stdout.write(`${JSON.stringify(seedSyntheticFixture(), null, 2)}\n`);
}
