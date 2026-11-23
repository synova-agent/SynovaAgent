/**
 * tests/runtime/dsh/domain-context.test.ts — #1426（I-1）真实领域上下文（**本切片只产 ②**）矩阵；
 * #1459 T-A 增 relation/evidence/insufficient 契约。
 *
 * 配对对象：src/runtime/dsh/domain-context.ts
 * 契约（DEV DOC v3 §3/§5/§7 ＋ #1459 T-A）：
 *   @input  ctx（服务端注入身份）＋ problemId（本企业 ② 对象 businessKey 或 $id）
 *   @output ContextSnapshot（synthetic:false、source.api='synova.domain/v1'、items≤200、truncated=count>items.length；
 *           items.relation{type,direction,edgeId}；items.evidence{evidenceStatus,instanceState,sources[].ref}；
 *           count===0 ⇒ insufficient{code,reason,missing[]}）
 *   @degraded 无：未知 problemId ⇒ DOMAIN_EMPTY；DB 异常 ⇒ PERSISTENCE_ERROR（既有码）；不可见企业域 ⇒ FORBIDDEN
 *
 * 数据纪律（DEV DOC v3 §4 硬规则）：
 *   只连 `:memory:`（vitest env 注入 SYNOVA_DB_PATH；本文件 beforeAll 首行 fail-fast 断言），
 *   不读任何真实库；种子节点全部落在本文件内存图里，跨测试用唯一 businessKey 隔离。
 *   #1459 的扫描断言/证据行用直查种子（表格是既有 `scan_*` schema，不新增写入路径）。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { buildContextSnapshot } from '../../../src/runtime/dsh/domain-context';
import { DshError } from '../../../src/runtime/dsh/errors';
import { handleDomainToolCall, type ToolCallContext } from '../../../src/runtime/dsh/tools';

/** 两个**不同**企业图：跨企业隔离断言的 B 侧。 */
const ENT_A = 'ent-1426-a';
const ENT_B = 'ent-1426-b';
const USER_A = 'user-1426-a';
const CTX_A: ToolCallContext = { enterpriseId: ENT_A, userId: USER_A, scope: 'admin', runId: 'run_1426_a' };

let store: SqliteGraphStore;

/** 建节点（真 SqliteGraphStore；id 由 store 生成）。 */
function node(type: string, props: Record<string, unknown>, graph: string = ENT_A): string {
  return store.createNode(type, props, graph);
}

/** 建边（真 SqliteGraphStore；1 跳邻接 = 出边 + 入边）；返回边 id（relation.edgeId 断言用）。 */
function edge(from: string, to: string, graph: string = ENT_A, type = 'edge/team_executes_activity'): string {
  return store.createEdge(type, from, to, 1, {}, graph);
}

/** 合格 ② 节点（props 同时提供 period + defVersion）。 */
function batch(businessKey: string, period: string, defVersion: string, graph: string = ENT_A): string {
  return node('activity/delivery_batch', { businessKey, name: businessKey, period, defVersion, teamBusinessKey: 'team' }, graph);
}

function catchError(fn: () => unknown): unknown {
  try { fn(); return null; } catch (err: unknown) { return err; }
}

/**
 * #1459 T-A 直查种子：一条扫描断言版本 + 该版本的证据行（复用既有 `scan_*` schema，不新增写入路径）。
 * 同一 `assertionId` 再次调用 = 再插一个版本；`createdAt` 可由调用方钉成相同值（验证 rowid tiebreak）。
 */
function seedAssertionEvidence(options: {
  nodeId: string;
  nodeType: string;
  businessKey: string;
  assertionId: string;
  versionId: string;
  createdAt: string;
  evidenceStatus?: string;
  instanceState?: string;
  sources: Array<{ evidenceId: string; sourceRef: string }>;
}): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO scan_ontology_links(graph, subject_kind, type, business_key, object_id)
     VALUES (?, 'node', ?, ?, ?)`,
  ).run(ENT_A, options.nodeType, options.businessKey, options.nodeId);
  db.prepare(
    `INSERT INTO scan_assertions(assertion_id, graph, assertion_key, target_kind, target_object_id, field, assertion_kind, assertion_type, def_version, formula_ref)
     VALUES (?, ?, ?, 'node', ?, 'accepted_count', 'direct', 'fact', 'delivery-v1', NULL)
     ON CONFLICT(graph, assertion_key) DO NOTHING`,
  ).run(options.assertionId, ENT_A, options.assertionId, options.nodeId);
  db.prepare(
    `INSERT INTO scan_assertion_versions(assertion_version_id, graph, assertion_id, source_fingerprint, value_json, unit, denominator, evidence_status, instance_state, valid_from, valid_to, created_at)
     VALUES (?, ?, ?, ?, '{"value":1}', NULL, NULL, ?, ?, NULL, NULL, ?)`,
  ).run(options.versionId, ENT_A, options.assertionId, `fp-${options.versionId}`,
    options.evidenceStatus ?? 'confirmed', options.instanceState ?? 'measured', options.createdAt);
  for (const source of options.sources) {
    const sourceId = `${ENT_A}:src-${source.evidenceId}`;
    const evidenceVersionId = `${source.evidenceId}-v1`;
    db.prepare(
      `INSERT INTO scan_sources(source_id, graph, source_kind, locator, visibility, read_scope_json, egress_scope_json, created_by, created_at)
       VALUES (?, ?, 'csv', ?, 'enterprise', '{}', '{"model":false}', 'seed', '2026-11-23T00:00:00.000Z')`,
    ).run(sourceId, ENT_A, sourceId);
    db.prepare(
      `INSERT INTO scan_evidence(evidence_id, graph, source_id, registered_by, registered_at)
       VALUES (?, ?, ?, 'seed', '2026-11-23T00:00:00.000Z')`,
    ).run(source.evidenceId, ENT_A, sourceId);
    db.prepare(
      `INSERT INTO scan_evidence_versions(evidence_version_id, graph, evidence_id, sha256, size, mtime_ms, observed_at, period, valid_from, valid_to, parse_status, created_at)
       VALUES (?, ?, ?, ?, 1, 0, '2026-11-23T00:00:00.000Z', '2026-10', NULL, NULL, 'confirmed', '2026-11-23T00:00:00.000Z')`,
    ).run(evidenceVersionId, ENT_A, source.evidenceId, `sha-${evidenceVersionId}`);
    db.prepare(
      `INSERT INTO scan_assertion_evidence(graph, assertion_version_id, evidence_version_id, source_ref)
       VALUES (?, ?, ?, ?)`,
    ).run(ENT_A, options.versionId, evidenceVersionId, source.sourceRef);
  }
}

interface SnapshotItemShape {
  layer: string;
  $id: string;
  cycleVersion: string | null;
  sentinelRun: string | null;
  period: string;
  defVersion: string;
  evidenceId: string | null;
  status: string;
  visibility: string;
  source: { kind: string; api: string };
  relation?: { type: string; direction: 'out' | 'in'; edgeId: string };
  evidence?: { evidenceStatus: string; instanceState: string; sources: Array<{ ref: string }> };
}

interface SnapshotShape {
  synthetic: boolean;
  problemId: string;
  count: number;
  truncated: boolean;
  items: SnapshotItemShape[];
  insufficient?: { code: string; reason: string; missing: string[] };
}

beforeAll(() => {
  // 硬规则 fail-fast：本文件只允许 :memory:（误连真库会跑 reconcileSchema，风险最高）
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`domain-context.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  store = new SqliteGraphStore(getDatabase());
});

describe('#1426 ② 真实快照（真 store 直读）', () => {
  it('§7.1 真实节点值：synthetic=false、source.api=synova.domain/v1、period/defVersion 等于库内 props（改库值 ⇒ 输出跟着变）', () => {
    const root = batch('root-1426-real', '2026-07', 'def-2026.07');
    const neighbor = batch('batch-1426-real', '2026-07', 'def-2026.07');
    const relationEdge = edge(root, neighbor);
    // 根对象本身是 0 跳，不产出条目（本切片只取 1 跳邻接节点）
    expect(root).not.toBe(neighbor);

    const first = buildContextSnapshot(CTX_A, 'root-1426-real') as SnapshotShape;
    expect(first.synthetic).toBe(false);
    expect(first.problemId).toBe('root-1426-real');
    expect(first.truncated).toBe(false);
    expect(first.count).toBe(1);
    expect(first.items.map(item => item.$id)).toEqual([neighbor]);
    expect(first.items.map(item => item.$id)).not.toContain(root);
    expect(first.items[0]).toEqual({
      layer: '②',
      $id: neighbor,
      cycleVersion: null,
      sentinelRun: null,
      period: '2026-07',
      defVersion: 'def-2026.07',
      evidenceId: null,
      status: 'observed',
      visibility: 'enterprise',
      source: { kind: 'synova.domain', api: 'synova.domain/v1' },
      relation: { type: 'edge/team_executes_activity', direction: 'out', edgeId: relationEdge },
    });
    // 本夹具无 scan_assertions* ⇒ evidence 字段缺失、evidenceId=null（不补零）
    expect(first.items[0].evidence).toBeUndefined();

    // 改库值 ⇒ 输出跟着变（证明 period/defVersion 不是代码常量）
    store.updateNode(neighbor, { period: '2026-08', defVersion: 'def-2026.08' }, ENT_A);
    const second = buildContextSnapshot(CTX_A, 'root-1426-real') as SnapshotShape;
    expect(second.items[0].period).toBe('2026-08');
    expect(second.items[0].defVersion).toBe('def-2026.08');
  });

  it('§7.1 problemId 也接受 $id（node.id），与 businessKey 等价命中同一根', () => {
    const root = batch('root-1426-byid', '2026-07', 'def-2026.07');
    const neighbor = batch('batch-1426-byid', '2026-07', 'def-2026.07');
    edge(root, neighbor);

    const byBusinessKey = buildContextSnapshot(CTX_A, 'root-1426-byid') as SnapshotShape;
    const byNodeId = buildContextSnapshot(CTX_A, root) as SnapshotShape;
    expect(byNodeId.items).toEqual(byBusinessKey.items);
    expect(byNodeId.count).toBe(byBusinessKey.count);
    expect(byNodeId.problemId).toBe(root);
  });

  it('§7.2 跨企业：ctx=A 时 B 企业 $id 精确集合为空（A 侧有正例对照）', () => {
    const rootA = batch('root-1426-cross', '2026-07', 'def-2026.07', ENT_A);
    const neighborA = batch('batch-1426-cross', '2026-07', 'def-2026.07', ENT_A);
    edge(rootA, neighborA, ENT_A);
    const rootB = batch('root-1426-cross', '2026-07', 'def-2026.07', ENT_B);
    const neighborB = batch('batch-1426-cross', '2026-07', 'def-2026.07', ENT_B);
    edge(rootB, neighborB, ENT_B);

    const snapshot = buildContextSnapshot(CTX_A, 'root-1426-cross') as SnapshotShape;
    const ids = snapshot.items.map(item => item.$id);
    expect(ids).toContain(neighborA);          // 正例对照：A 侧真的有条目
    expect(ids).not.toContain(neighborB);      // 反例：B 企业 $id 精确集合为空
    expect(ids).not.toContain(rootB);
    expect(snapshot.items.every(item => item.$id !== neighborB && item.$id !== rootB)).toBe(true);

    // 反方向：拿 B 的节点 id 在 ctx=A 下解析不到 ⇒ 显式 DOMAIN_EMPTY（不泄露存在性）
    const leaked = catchError(() => buildContextSnapshot(CTX_A, rootB));
    expect(leaked).toBeInstanceOf(DshError);
    expect((leaked as DshError).code).toBe('DOMAIN_EMPTY');
  });

  it('§7.6 ③／④ 恒 0：每个条目 layer 都是 ②（③④ 本切片 NOT DONE）', () => {
    const root = batch('root-1426-layers', '2026-07', 'def-2026.07');
    edge(root, batch('batch-1426-layers-a', '2026-07', 'def-2026.07'));
    edge(root, batch('batch-1426-layers-b', '2026-07', 'def-2026.07'));

    const snapshot = buildContextSnapshot(CTX_A, 'root-1426-layers') as SnapshotShape;
    expect(snapshot.items.every(item => item.layer === '②')).toBe(true);
    expect(snapshot.items.some(item => item.layer === '③' || item.layer === '④')).toBe(false);
    expect(snapshot.count).toBe(2);
    expect(snapshot.items).toHaveLength(2);
  });

  it('§7.7 缺 period／defVersion 的邻接节点不产出（不补零、不编常量）', () => {
    const root = batch('root-1426-partial', '2026-07', 'def-2026.07');
    const qualified = batch('batch-1426-qualified', '2026-07', 'def-2026.07');
    const team = node('resource/delivery_team', { businessKey: 'team-1426-partial', name: '交付一组' });
    const onlyPeriod = node('activity/delivery_batch', { businessKey: 'batch-1426-only-period', period: '2026-07' });
    const onlyDefVersion = node('activity/delivery_batch', { businessKey: 'batch-1426-only-def', defVersion: 'def-2026.07' });
    const blankStrings = node('activity/delivery_batch', { businessKey: 'batch-1426-blank', period: '', defVersion: '' });
    edge(root, qualified);
    edge(root, team);
    edge(root, onlyPeriod);
    edge(root, onlyDefVersion);
    edge(root, blankStrings);

    const snapshot = buildContextSnapshot(CTX_A, 'root-1426-partial') as SnapshotShape;
    expect(snapshot.items.map(item => item.$id)).toEqual([qualified]);
    expect(snapshot.count).toBe(1);
    for (const dropped of [team, onlyPeriod, onlyDefVersion, blankStrings]) {
      expect(snapshot.items.map(item => item.$id)).not.toContain(dropped);
    }
  });

  it('§7.8 截断：201 个合格节点 ⇒ count=201、items.length=200、truncated=true（按 $id 升序取前 200）', () => {
    const root = batch('root-1426-trunc', '2026-07', 'def-2026.07');
    const ids: string[] = [];
    for (let index = 0; index < 201; index += 1) {
      const id = batch(`batch-1426-trunc-${String(index).padStart(3, '0')}`, '2026-07', 'def-2026.07');
      ids.push(id);
      edge(root, id);
    }

    const snapshot = buildContextSnapshot(CTX_A, 'root-1426-trunc') as SnapshotShape;
    expect(snapshot.count).toBe(201);
    expect(snapshot.items).toHaveLength(200);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.truncated).toBe(snapshot.count > snapshot.items.length);
    const expected = [...ids].sort().slice(0, 200);
    expect(snapshot.items.map(item => item.$id)).toEqual(expected);
  });

  it('§7.9 确定性：同输入两次调用 JSON 逐字相等', () => {
    const root = batch('root-1426-deterministic', '2026-07', 'def-2026.07');
    edge(root, batch('batch-1426-det-a', '2026-07', 'def-2026.07'));
    edge(root, batch('batch-1426-det-b', '2026-08', 'def-2026.08'));
    edge(root, batch('batch-1426-det-c', '2026-09', 'def-2026.09'));

    const a = buildContextSnapshot(CTX_A, 'root-1426-deterministic') as SnapshotShape;
    const b = buildContextSnapshot(CTX_A, 'root-1426-deterministic') as SnapshotShape;
    expect(a.items.length).toBe(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.items.map(item => item.$id)).toEqual([...a.items.map(item => item.$id)].sort());
  });

  it('§7.5 未知 problemId ⇒ DOMAIN_EMPTY（显式空，不伪造快照）', () => {
    const error = catchError(() => buildContextSnapshot(CTX_A, 'problem-1426-does-not-exist'));
    expect(error).toBeInstanceOf(DshError);
    expect((error as DshError).code).toBe('DOMAIN_EMPTY');
    expect((error as DshError).retryable).toBe(false);
  });

  it('§3.5 可见性由既有判据函数确认：ga 角色 ⇒ FORBIDDEN 且零查询（不是常量放行）', () => {
    const root = batch('root-1426-ga', '2026-07', 'def-2026.07');
    edge(root, batch('batch-1426-ga', '2026-07', 'def-2026.07'));

    const spy = vi.spyOn(SqliteGraphStore.prototype, 'queryNodes');
    try {
      const error = catchError(() => buildContextSnapshot({ ...CTX_A, scope: 'ga' }, 'root-1426-ga'));
      expect(error).toBeInstanceOf(DshError);
      expect((error as DshError).code).toBe('FORBIDDEN');
      expect((error as DshError).httpStatus).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('#1426 参数校验与零查询（钉死 spy 目标 = SqliteGraphStore.queryNodes）', () => {
  it('§7.3 伪造参数 ⇒ FORGED_*，且 queryNodes 调用次数 = 0（校验先于任何查询）', () => {
    // 该 businessKey 真实存在 ⇒ 若校验被挪到解析之后，就一定会走到 queryNodes
    batch('batch-1426-forged-target', '2026-07', 'def-2026.07');
    const spy = vi.spyOn(SqliteGraphStore.prototype, 'queryNodes');
    try {
      const identityForged = catchError(() =>
        handleDomainToolCall('synova_context_get', { problemId: 'batch-1426-forged-target', enterpriseId: 'ent-forged' }, CTX_A));
      expect(identityForged).toBeInstanceOf(DshError);
      expect((identityForged as DshError).code).toBe('FORGED_IDENTITY');
      expect(spy).not.toHaveBeenCalled();

      const pathForged = catchError(() =>
        handleDomainToolCall('synova_context_get', { problemId: 'batch-1426-forged-target', cwd: '../../etc' }, CTX_A));
      expect(pathForged).toBeInstanceOf(DshError);
      expect((pathForged as DshError).code).toBe('FORGED_PATH');
      expect(spy).not.toHaveBeenCalled();

      // 正例对照：同一目标合法调用 ⇒ queryNodes 真的被走到（证明 spy 有判别力，不是恒零）
      const ok = handleDomainToolCall('synova_context_get', { problemId: 'batch-1426-forged-target' }, CTX_A);
      expect(JSON.parse(ok) as SnapshotShape).toMatchObject({ synthetic: false, problemId: 'batch-1426-forged-target' });
      expect(spy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('§7.4 缺 ctx（token 未绑定）⇒ UNAUTHORIZED（不是 FORGED_IDENTITY）', () => {
    const error = catchError(() =>
      Reflect.apply(handleDomainToolCall, undefined, ['synova_context_get', { problemId: 'batch-1426-no-ctx' }]));
    expect(error).toBeInstanceOf(DshError);
    expect((error as DshError).code).toBe('UNAUTHORIZED');
    expect((error as DshError).httpStatus).toBe(401);
  });

  it('problemId 非字符串／超长 ⇒ VALIDATION_ERROR（不进入查询）', () => {
    const nonString = catchError(() =>
      handleDomainToolCall('synova_context_get', { problemId: 42 }, CTX_A));
    expect(nonString).toMatchObject({ code: 'VALIDATION_ERROR' });

    const tooLong = catchError(() => buildContextSnapshot(CTX_A, 'p'.repeat(257)));
    expect(tooLong).toBeInstanceOf(DshError);
    expect((tooLong as DshError).code).toBe('VALIDATION_ERROR');
  });
});

describe('#1459 T-A relation / evidence / insufficient（真实 store 直读）', () => {
  it('#1459-1 evidence 取最新断言版本：created_at 逐字相同 ⇒ rowid DESC 兜底（后插版本胜）', () => {
    const root = batch('root-1459-evidence', '2026-10', 'delivery-v1');
    const neighbor = batch('batch-1459-evidence', '2026-10', 'delivery-v1');
    edge(root, neighbor);
    const sameCreatedAt = '2026-11-23T13:18:20.404Z';
    seedAssertionEvidence({
      nodeId: neighbor, nodeType: 'activity/delivery_batch', businessKey: 'batch-1459-evidence',
      assertionId: 'assertion-1459-evidence', versionId: 'assertion-version-1459-evidence-v1',
      createdAt: sameCreatedAt,
      sources: [{ evidenceId: 'ev-1459-evidence-a', sourceRef: 'first.csv#L1' }],
    });
    seedAssertionEvidence({
      nodeId: neighbor, nodeType: 'activity/delivery_batch', businessKey: 'batch-1459-evidence',
      assertionId: 'assertion-1459-evidence', versionId: 'assertion-version-1459-evidence-v2',
      createdAt: sameCreatedAt,
      sources: [{ evidenceId: 'ev-1459-evidence-b', sourceRef: 'second.md#L2' }],
    });

    const snapshot = buildContextSnapshot(CTX_A, 'root-1459-evidence') as SnapshotShape;
    expect(snapshot.count).toBe(1);
    const item = snapshot.items[0];
    expect(item.relation?.type).toBe('edge/team_executes_activity');
    expect(item.relation?.direction).toBe('out');
    // v1 与 v2 的 created_at 逐字相同 ⇒ 只靠时间无法定序；rowid DESC 必须选 v2
    expect(item.evidence).toEqual({
      evidenceStatus: 'confirmed',
      instanceState: 'measured',
      sources: [{ ref: 'second.md#L2' }],
    });
    expect(item.evidenceId).toBe('ev-1459-evidence-b');
  });

  it('#1459-2 跨断言择新 + 同版本多来源按 ref 升序 + 两次调用逐字稳定', () => {
    const root = batch('root-1459-multi', '2026-10', 'delivery-v1');
    const neighbor = batch('batch-1459-multi', '2026-10', 'delivery-v1');
    edge(root, neighbor);
    const sameCreatedAt = '2026-11-23T13:18:20.404Z';
    seedAssertionEvidence({
      nodeId: neighbor, nodeType: 'activity/delivery_batch', businessKey: 'batch-1459-multi',
      assertionId: 'assertion-1459-multi-old', versionId: 'assertion-version-1459-multi-old',
      createdAt: sameCreatedAt, evidenceStatus: 'confirmed', instanceState: 'measured',
      sources: [{ evidenceId: 'ev-1459-old', sourceRef: 'z-old.csv#L9' }],
    });
    seedAssertionEvidence({
      nodeId: neighbor, nodeType: 'activity/delivery_batch', businessKey: 'batch-1459-multi',
      assertionId: 'assertion-1459-multi-new', versionId: 'assertion-version-1459-multi-new',
      createdAt: sameCreatedAt, evidenceStatus: 'pending', instanceState: 'estimated',
      sources: [
        { evidenceId: 'ev-1459-new-c', sourceRef: 'c.json' },
        { evidenceId: 'ev-1459-new-a', sourceRef: 'a.csv#L3' },
      ],
    });

    const first = buildContextSnapshot(CTX_A, 'root-1459-multi') as SnapshotShape;
    expect(first.items[0].evidence).toEqual({
      evidenceStatus: 'pending',
      instanceState: 'estimated',
      sources: [{ ref: 'a.csv#L3' }, { ref: 'c.json' }],
    });
    expect(first.items[0].evidenceId).toBe('ev-1459-new-a');

    const second = buildContextSnapshot(CTX_A, 'root-1459-multi') as SnapshotShape;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('#1459-3 count===0 ⇒ insufficient 返回字段（不抛 error、不返回成功空快照）', () => {
    const root = batch('root-1459-insufficient', '2026-10', 'delivery-v1');
    const team = node('resource/delivery_team', { businessKey: 'team-1459-insufficient', name: '交付一组' });
    edge(root, team);

    const snapshot = buildContextSnapshot(CTX_A, 'root-1459-insufficient') as SnapshotShape;
    expect(snapshot.count).toBe(0);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.insufficient).toMatchObject({ code: 'INSUFFICIENT_CONTEXT' });
    expect(snapshot.insufficient?.missing).toEqual(['defVersion', 'period']);
    expect(snapshot.insufficient?.reason).toContain('不足以形成瓶颈假设');
  });

  it('#1459-4 根无任何 1 跳关系 ⇒ insufficient.missing=[neighbors]', () => {
    batch('root-1459-no-neighbor', '2026-10', 'delivery-v1');
    const snapshot = buildContextSnapshot(CTX_A, 'root-1459-no-neighbor') as SnapshotShape;
    expect(snapshot.count).toBe(0);
    expect(snapshot.insufficient?.missing).toEqual(['neighbors']);
  });

  it('#1459-5 in 方向用例：邻接节点→根命中 direction=in；同节点 out/in 并存取 out（确定性规则）', () => {
    const root = batch('root-1459-direction', '2026-10', 'delivery-v1');
    const inOnly = batch('batch-1459-direction-in', '2026-10', 'delivery-v1');
    const inEdgeId = edge(inOnly, root);
    const both = batch('batch-1459-direction-both', '2026-10', 'delivery-v1');
    const outEdgeId = edge(root, both);
    edge(both, root);

    const snapshot = buildContextSnapshot(CTX_A, 'root-1459-direction') as SnapshotShape;
    const byId = new Map(snapshot.items.map(item => [item.$id, item]));
    expect(byId.get(inOnly)?.relation).toEqual({
      type: 'edge/team_executes_activity',
      direction: 'in',
      edgeId: inEdgeId,
    });
    expect(byId.get(both)?.relation).toEqual({
      type: 'edge/team_executes_activity',
      direction: 'out',
      edgeId: outEdgeId,
    });
  });
});

describe('#1426 失败路径：DB 异常复用既有错误码', () => {
  it('DB 不可用 ⇒ PERSISTENCE_ERROR（既有码，不新增错误码）', async () => {
    vi.resetModules();
    vi.doMock('../../../src/init/engine-context', () => ({
      getDatabase: () => { throw new Error('database is not open (模拟 DB 异常)'); },
    }));
    try {
      const mod = await import('../../../src/runtime/dsh/domain-context');
      let caught: unknown = null;
      try {
        mod.buildContextSnapshot(CTX_A, 'batch-1426-db-down');
      } catch (err: unknown) {
        caught = err;
      }
      // 动态导入的模块实例与静态 import 的类不是同一个（跨模块实例），断言稳定形状而非 instanceof
      expect(caught).toMatchObject({ name: 'DshError', code: 'PERSISTENCE_ERROR', phase: 'persist', retryable: true });
      expect((caught as DshError).httpStatus).toBe(500);
    } finally {
      vi.doUnmock('../../../src/init/engine-context');
      vi.resetModules();
    }
  });
});
