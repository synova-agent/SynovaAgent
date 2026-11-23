/**
 * T0（#1459）隔离扫描落库 harness —— 固定路径真实 DB，供下游任务 A/B/C 复用。
 *
 * @input 无外部输入；夹具内容取自 `tests/enterprise-scan/fixtures.ts` 的 `GOLDEN_FILES`（与本目录既有用例同一份）。
 * @output 固定路径 `%TEMP%\1459-scan\synova.db` 的真实扫描库 + 证据载荷（run id / 三表计数 / ②节点 id / 落库 graph / 绝对路径）。
 * @degraded 无静默降级：目录不可建、schema 迁移失败、库句柄与目标路径不一致一律抛错并带路径。
 * @authority `graph` 只取 `viewer.orgId`（本夹具钉死 `org-a`）；②写入只经 `EnterpriseScanService.run`。
 * @not-here 不手工 INSERT `graph_nodes`/`graph_triples`/`scan_assertions`/`scan_reports` —— 输出侧只能由服务产出；
 *           只允许复用既有 `fixtures.seedManifest` 种**输入侧**授权（`scan_sources`/`scan_authorizations`）。
 * @error 抛 `Error`，消息含具体路径／表名／计数，不吞异常也不伪造空结果。
 */
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { EnterpriseScanService } from '../../src/agent/enterprise-scan-service';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import type { ScanReport } from '../../src/connectors/enterprise-scan/types';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import { authorityCounts, GOLDEN_FILES, seedManifest } from './fixtures';
import { viewer } from './test-helpers';

/** 落库 graph（= viewer.orgId）。下游 `SYNOVA_ORG_ID` 必须与它同值。 */
export const T0_GRAPH = 'org-a';
/** T0 专用清单 id：与 golden 用例的 `manifest-golden` 分开，便于在库内区分。 */
export const T0_MANIFEST_ID = 'manifest-1459-t0';
/** 幂等键：重放验证靠它（同键同载荷 ⇒ `replayed=true` 且计数零增长）。 */
export const T0_CLIENT_REQUEST_ID = 'request-1459-t0';
/** 固定路径的目录名与文件名（`%TEMP%\1459-scan\synova.db`）。 */
export const T0_DB_DIR = '1459-scan';
export const T0_DB_FILE = 'synova.db';
/** 证据件相对仓根路径（T0 交付件）。 */
export const T0_EVIDENCE_RELATIVE_PATH = 'docs/synova/product-lines/evidence/1459-probes/T0-scan-report.json';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** DSH 会话级临时目录名（`dsh-<id>`）。 */
const DSH_SESSION_DIR_PATTERN = /^dsh-[A-Za-z0-9_-]+$/;

/**
 * `%TEMP%` 的机器级取值。
 *
 * DSH 会把子进程的 `TEMP`/`TMP` 指向**会话级**目录 `.../dsh-xxxx`（本会话实测为
 * `C:\Users\...\Temp\dsh-WmZb08`）。那不是「固定路径」——换会话即变，下游任务找不到库。
 * 因此末段形如 `dsh-<id>` 时一律落到父目录（真临时根：Windows `...\Temp`／POSIX `/tmp`、
 * macOS `.../T`），其余环境原样返回。注意：`SYNOVA_1459_SCAN_DB` 显式覆盖优先于本规则。
 */
export function resolveTempRoot(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.TEMP ?? env.TMP ?? '').trim();
  const resolved = resolve(raw === '' ? tmpdir() : raw);
  return DSH_SESSION_DIR_PATTERN.test(basename(resolved)) ? dirname(resolved) : resolved;
}

/** 固定落库路径：`%TEMP%\1459-scan\synova.db`；可用 `SYNOVA_1459_SCAN_DB` 显式覆盖（下游钉死同一库时用）。 */
export function t0DbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.SYNOVA_1459_SCAN_DB ?? '').trim();
  if (override !== '') return resolve(override);
  return join(resolveTempRoot(env), T0_DB_DIR, T0_DB_FILE);
}

/** 固定夹具根：扫描来源文件放固定处，使库内 `scan_sources.locator` 在后续会话仍可复读（不用 mkdtemp）。 */
export function t0FixtureRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(t0DbPath(env)), 'fixtures');
}

/** 证据件绝对路径。 */
export function t0EvidencePath(): string {
  return join(repoRoot, ...T0_EVIDENCE_RELATIVE_PATH.split('/'));
}

/** 库快照：全部从落库后的 DB **读回**（不复用内存返回值），避免「服务返回什么就信什么」。 */
export interface T0DbSnapshot {
  dbPath: string;
  dbHandleName: string;
  schemaVersion: number;
  journalMode: string;
  graph: string;
  scanRunId: string;
  report: ScanReport;
  counts: Record<string, number>;
  nodeIds: string[];
  edgeIds: string[];
  objectIds: string[];
  relationObjectIds: string[];
}

export interface T0ScanRun {
  snapshot: T0DbSnapshot;
  replayed: boolean;
  countsBeforeRun: Record<string, number>;
  /** 输入侧授权夹具的行数（既有 `fixtures.seedManifest` 产物；不是输出侧）。 */
  inputSeedCounts: { scan_sources: number; scan_authorizations: number };
  graph: string;
  viewerSub: string;
  clientRequestId: string;
  manifestId: string;
  fixtureRoot: string;
}

function inputSeedCounts(db: Database.Database): { scan_sources: number; scan_authorizations: number } {
  const count = (table: 'scan_sources' | 'scan_authorizations'): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE graph = ?`).get(T0_GRAPH) as { n: number }).n;
  return { scan_sources: count('scan_sources'), scan_authorizations: count('scan_authorizations') };
}

function removeIfExists(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`T0 清理旧库失败（${path}）：${message}`);
  }
}

/** 只允许删除固定名 `synova.db` —— 防止 `SYNOVA_1459_SCAN_DB` 误指到别的库。 */
function assertDeletableDbPath(dbPath: string): void {
  if (!isAbsolute(dbPath) || basename(dbPath) !== T0_DB_FILE) {
    throw new Error(`T0 拒绝删除非固定落库文件（需绝对路径且文件名 = ${T0_DB_FILE}）：${dbPath}`);
  }
}

function writeFixedFixtureRoot(root: string): void {
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(GOLDEN_FILES)) {
    writeFileSync(join(root, name), content, { encoding: 'utf8', flag: 'w' });
  }
}

function readSnapshot(db: Database.Database, dbPath: string): T0DbSnapshot {
  const runRow = db.prepare(
    'SELECT run_id FROM scan_runs WHERE graph = ? AND operation = ? AND client_request_id = ?',
  ).get(T0_GRAPH, 'enterprise-scan', T0_CLIENT_REQUEST_ID) as { run_id: string } | undefined;
  if (!runRow) throw new Error(`T0 落库校验失败：scan_runs 中无 graph=${T0_GRAPH} 的 ${T0_CLIENT_REQUEST_ID} 运行`);
  const reportRow = db.prepare(
    'SELECT report_json FROM scan_reports WHERE graph = ? AND run_id = ? ORDER BY rowid DESC LIMIT 1',
  ).get(T0_GRAPH, runRow.run_id) as { report_json: string } | undefined;
  if (!reportRow) throw new Error(`T0 落库校验失败：scan_reports 中无 run_id=${runRow.run_id} 的报告`);
  const report = JSON.parse(reportRow.report_json) as ScanReport;
  const schemaRow = db.prepare(
    "SELECT MAX(version) AS maxVersion FROM schema_version WHERE typeof(version) = 'integer'",
  ).get() as { maxVersion: number | null } | undefined;
  const schemaVersion = typeof schemaRow?.maxVersion === 'number' ? schemaRow.maxVersion : 0;
  const journalMode = String(db.pragma('journal_mode', { simple: true }));
  return {
    dbPath,
    dbHandleName: db.name,
    schemaVersion,
    journalMode,
    graph: T0_GRAPH,
    scanRunId: runRow.run_id,
    report,
    counts: authorityCounts(db),
    nodeIds: (db.prepare('SELECT id FROM graph_nodes WHERE graph = ? ORDER BY id').all(T0_GRAPH) as Array<{ id: string }>).map(row => row.id),
    edgeIds: (db.prepare('SELECT id FROM graph_triples WHERE graph = ? ORDER BY id').all(T0_GRAPH) as Array<{ id: string }>).map(row => row.id),
    objectIds: report.ontology.objects.map(item => item.object_id),
    relationObjectIds: report.ontology.relations.map(item => item.object_id),
  };
}

/**
 * 对固定夹具跑一次真实扫描（`EnterpriseScanService.run`）并落固定路径 DB。
 *
 * `fresh=true` 先删旧库（含 `-wal`/`-shm`）⇒ 全新一次落库；
 * `fresh=false` 复用已有库（同幂等键 ⇒ 服务返回 `replayed=true`，用于证明落库可复读）。
 */
export async function runT0Scan(options: { fresh?: boolean } = {}): Promise<T0ScanRun> {
  const fresh = options.fresh ?? true;
  const dbPath = t0DbPath();
  const fixtureRoot = t0FixtureRoot();
  mkdirSync(dirname(dbPath), { recursive: true });
  if (fresh) {
    assertDeletableDbPath(dbPath);
    removeIfExists(dbPath);
    removeIfExists(`${dbPath}-wal`);
    removeIfExists(`${dbPath}-shm`);
  }
  writeFixedFixtureRoot(fixtureRoot);

  const db = new BetterSqlite3(dbPath);
  try {
    const graphStore = new SqliteGraphStore(db);
    const store = new EnterpriseScanStore(db, graphStore);
    const service = new EnterpriseScanService(store);
    const scanViewer = viewer('admin', 'owner-a', T0_GRAPH);
    if (store.listAuthorizations(T0_GRAPH, T0_MANIFEST_ID).length === 0) {
      // 输入侧授权（既有夹具路径）：只种 scan_sources / scan_authorizations —— 输出侧一行都不预写。
      seedManifest(db, { graph: T0_GRAPH, manifestId: T0_MANIFEST_ID, root: fixtureRoot });
    }
    const countsBeforeRun = authorityCounts(db);
    const seedCounts = inputSeedCounts(db);
    const persisted = await service.run(scanViewer, T0_MANIFEST_ID, T0_CLIENT_REQUEST_ID);
    const snapshot = readSnapshot(db, dbPath);
    return {
      snapshot,
      replayed: persisted.replayed,
      countsBeforeRun,
      inputSeedCounts: seedCounts,
      graph: T0_GRAPH,
      viewerSub: scanViewer.sub,
      clientRequestId: T0_CLIENT_REQUEST_ID,
      manifestId: T0_MANIFEST_ID,
      fixtureRoot,
    };
  } finally {
    db.close();
  }
}

/**
 * 打开固定库读出快照（下游任务复用）。
 * 只执行 SELECT：不种夹具、不跑扫描、不写任何 DML。因库是 WAL 模式（关闭时需 checkpoint），
 * 句柄仍以默认读写模式打开 —— 只保证「无业务写入」，不保证 OS 层只读。
 */
export function readT0Snapshot(dbPath: string = t0DbPath()): T0DbSnapshot {
  const db = new BetterSqlite3(dbPath, { readonly: false });
  try {
    return readSnapshot(db, dbPath);
  } finally {
    db.close();
  }
}

/** 证据件载荷（写到固定目录，供下游任务与 CTO 复核）。 */
export interface T0Evidence {
  schema: 'synova-t0-scan-evidence/v1';
  issue: 1459;
  task: 'T0';
  generated_at: string;
  generated_by: string;
  db: {
    path: string;
    path_rule: string;
    temp_env: { TEMP: string | null; TMP: string | null; os_tmpdir: string; SYNOVA_1459_SCAN_DB: string | null };
    size_bytes: number;
    schema_version: number;
    journal_mode: string;
    db_handle_name: string;
  };
  scan: {
    graph: string;
    manifest_id: string;
    viewer: { role: string; sub: string; orgId: string; departmentIds: string[] };
    scan_run_id: string;
    client_request_id: string;
    replayed: boolean;
    report_schema_version: string;
    counts_before_run: Record<string, number>;
    counts_after_run: Record<string, number>;
  };
  fixture: { root: string; files: string[]; seed_scope: string[]; seed_counts: { scan_sources: number; scan_authorizations: number } };
  evidence: {
    node_ids: string[];
    edge_ids: string[];
    object_ids: string[];
    relation_object_ids: string[];
    node_id_set_equals_object_ids: boolean;
    graph_nodes_count_equals_object_ids_count: boolean;
    graph_triples_count_equals_relation_count: boolean;
    scan_assertions_count_equals_report_assertions_count: boolean;
  };
  downstream: {
    env: { SYNOVA_DB_PATH: string; SYNOVA_ORG_ID: string };
    note: string;
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

/** 断言"节点 id 集合 == report_json.ontology.objects[].object_id 集合"，不成立即抛（带两边差值）。 */
export function assertNodeIdsMatchObjectIds(snapshot: T0DbSnapshot): void {
  const nodeIds = [...snapshot.nodeIds].sort();
  const objectIds = [...snapshot.objectIds].sort();
  const onlyNodes = nodeIds.filter(id => !objectIds.includes(id));
  const onlyObjects = objectIds.filter(id => !nodeIds.includes(id));
  if (onlyNodes.length > 0 || onlyObjects.length > 0) {
    throw new Error(`T0 集合不一致：graph_nodes 独有 ${JSON.stringify(onlyNodes)}；objects[] 独有 ${JSON.stringify(onlyObjects)}`);
  }
}

/** 从一次落库结果生成证据载荷（纯函数，便于测试与复用）。 */
export function buildT0Evidence(run: T0ScanRun, generatedAt: string = new Date().toISOString()): T0Evidence {
  const { snapshot } = run;
  assertNodeIdsMatchObjectIds(snapshot);
  const tempEnv = process.env;
  return {
    schema: 'synova-t0-scan-evidence/v1',
    issue: 1459,
    task: 'T0',
    generated_at: generatedAt,
    generated_by: 'npx vitest run tests/enterprise-scan/t0-scan.test.ts （写证据需 T0_WRITE_EVIDENCE=1）',
    db: {
      path: snapshot.dbPath,
      path_rule: '%TEMP%\\1459-scan\\synova.db（可用 SYNOVA_1459_SCAN_DB 显式覆盖；DSH 会话级 TEMP 已归一）',
      temp_env: {
        TEMP: tempEnv.TEMP ?? null,
        TMP: tempEnv.TMP ?? null,
        os_tmpdir: tmpdir(),
        SYNOVA_1459_SCAN_DB: tempEnv.SYNOVA_1459_SCAN_DB ?? null,
      },
      size_bytes: statSync(snapshot.dbPath).size,
      schema_version: snapshot.schemaVersion,
      journal_mode: snapshot.journalMode,
      db_handle_name: snapshot.dbHandleName,
    },
    scan: {
      graph: run.graph,
      manifest_id: run.manifestId,
      viewer: viewer('admin', run.viewerSub, run.graph),
      scan_run_id: snapshot.scanRunId,
      client_request_id: run.clientRequestId,
      replayed: run.replayed,
      report_schema_version: snapshot.report.schema_version,
      counts_before_run: run.countsBeforeRun,
      counts_after_run: snapshot.counts,
    },
    fixture: {
      root: run.fixtureRoot,
      files: Object.keys(GOLDEN_FILES),
      seed_scope: ['scan_sources', 'scan_authorizations'],
      seed_counts: run.inputSeedCounts,
    },
    evidence: {
      node_ids: snapshot.nodeIds,
      edge_ids: snapshot.edgeIds,
      object_ids: snapshot.objectIds,
      relation_object_ids: snapshot.relationObjectIds,
      node_id_set_equals_object_ids: sameStringSet(snapshot.nodeIds, snapshot.objectIds),
      graph_nodes_count_equals_object_ids_count: snapshot.counts.graph_nodes === snapshot.objectIds.length,
      graph_triples_count_equals_relation_count: snapshot.counts.graph_triples === snapshot.relationObjectIds.length,
      scan_assertions_count_equals_report_assertions_count: snapshot.counts.scan_assertions === snapshot.report.assertions.length,
    },
    downstream: {
      env: { SYNOVA_DB_PATH: snapshot.dbPath, SYNOVA_ORG_ID: run.graph },
      note: '下游按本文件的 db.path 原样传 SYNOVA_DB_PATH，并令 SYNOVA_ORG_ID 与 scan.graph 同值；勿落默认 ./data/synova.db',
    },
  };
}

/** 写出证据件（UTF-8、2 空格、尾随换行）；只在显式开启时调用。 */
export function writeT0Evidence(evidence: T0Evidence): string {
  const target = t0EvidencePath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8' });
  return target;
}
