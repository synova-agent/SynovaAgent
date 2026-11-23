/**
 * T0（#1459）隔离扫描落库 —— 真实入口验收件。
 *
 * 入口：`npx vitest run tests/enterprise-scan/t0-scan.test.ts`
 * 产出：固定路径真实 DB `%TEMP%\1459-scan\synova.db`（并用 `EnterpriseScanService.run` 落一次扫描）。
 * 证据件：`docs/synova/product-lines/evidence/1459-probes/T0-scan-report.json`
 *         默认只读校验；重写需显式 `T0_WRITE_EVIDENCE=1`（避免每次跑测试都改仓内文件）。
 *
 * 判据（对应编码指令 T0 §2/§3）：①三个计数 >0 ②节点 id 集合 == report_json.ontology.objects[].object_id 集合
 * ③绝对 DB 路径 ④落库 graph 值 ⑤输出侧零手工 INSERT（跑前输出表全 0，跑后由服务产出）。
 */
import { existsSync, readFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import type { T0Evidence } from './t0-scan-harness';
import {
  assertNodeIdsMatchObjectIds,
  buildT0Evidence,
  readT0Snapshot,
  resolveTempRoot,
  runT0Scan,
  t0DbPath,
  t0EvidencePath,
  T0_GRAPH,
  writeT0Evidence,
} from './t0-scan-harness';

const WRITE_EVIDENCE = process.env.T0_WRITE_EVIDENCE === '1';
const OUTPUT_TABLES = ['graph_nodes', 'graph_triples', 'scan_assertions', 'scan_assertion_versions', 'scan_assertion_evidence', 'scan_reports', 'scan_report_assertions'] as const;

describe('#1459 T0 隔离扫描落库（固定路径 %TEMP%\\1459-scan\\synova.db）', () => {
  it('真实入口跑一次：三计数 >0、节点 id 集合 == objects[].object_id 集合、绝对路径、graph=org-a', async () => {
    const run = await runT0Scan({ fresh: true });
    const { snapshot } = run;

    // ③ 绝对 DB 路径 = 固定规则解析出的路径，且库句柄确实指着它（没有落默认 ./data/synova.db）
    expect(isAbsolute(snapshot.dbPath)).toBe(true);
    expect(snapshot.dbPath).toBe(t0DbPath());
    expect(basename(dirname(snapshot.dbPath))).toBe('1459-scan');
    expect(basename(snapshot.dbPath)).toBe('synova.db');
    expect(existsSync(snapshot.dbPath)).toBe(true);
    expect(snapshot.dbHandleName).toBe(snapshot.dbPath);
    expect(snapshot.schemaVersion).toBeGreaterThanOrEqual(7);
    expect(snapshot.dbPath.split(/[\\/]/).some(part => /^dsh-/.test(part))).toBe(false);

    // ⑤ 输出侧零手工 INSERT 播种：跑之前所有输出表为 0（只种了输入侧 scan_sources/scan_authorizations）
    for (const table of OUTPUT_TABLES) expect({ table, n: run.countsBeforeRun[table] }).toEqual({ table, n: 0 });
    expect(run.inputSeedCounts.scan_sources).toBeGreaterThan(0);
    expect(run.inputSeedCounts.scan_authorizations).toBeGreaterThan(0);

    // ① 三个计数 >0
    expect(snapshot.counts.scan_runs).toBe(1);
    expect(snapshot.counts.graph_nodes).toBeGreaterThan(0);
    expect(snapshot.counts.graph_triples).toBeGreaterThan(0);
    expect(snapshot.counts.scan_assertions).toBeGreaterThan(0);
    expect(snapshot.counts.scan_report_assertions).toBeGreaterThan(0);
    expect(snapshot.scanRunId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // ② 节点 id 集合 == report_json.ontology.objects[].object_id 集合（两边都非空才谈得上相等）
    expect(snapshot.nodeIds.length).toBeGreaterThan(0);
    expect(snapshot.objectIds.length).toBeGreaterThan(0);
    expect([...snapshot.nodeIds].sort()).toEqual([...snapshot.objectIds].sort());
    assertNodeIdsMatchObjectIds(snapshot);
    expect(snapshot.counts.graph_nodes).toBe(snapshot.objectIds.length);
    expect(snapshot.counts.graph_triples).toBe(snapshot.relationObjectIds.length);
    expect(snapshot.counts.scan_assertions).toBe(snapshot.report.assertions.length);

    // ④ 落库时的 graph（下游 SYNOVA_ORG_ID 必须与它同值）
    expect(run.graph).toBe('org-a');
    expect(T0_GRAPH).toBe('org-a');
    expect(snapshot.report.run.graph).toBe(T0_GRAPH);
    expect(snapshot.report.schema_version).toBe('enterprise-scan/v1');
    expect(run.replayed).toBe(false);

    if (WRITE_EVIDENCE) writeT0Evidence(buildT0Evidence(run));
  });

  it('同幂等键重放：replayed=true、计数零增长、报告逐字相同（库可复读；依赖上一条留下的固定库）', async () => {
    if (!existsSync(t0DbPath())) throw new Error(`前置用例未产出固定库，本用例无法重放：${t0DbPath()}`);
    const before = readT0Snapshot();
    const replay = await runT0Scan({ fresh: false });
    expect(replay.replayed).toBe(true);
    expect(replay.snapshot.scanRunId).toBe(before.scanRunId);
    expect(replay.snapshot.counts).toEqual(before.counts);
    expect(replay.snapshot.report).toEqual(before.report);
    expect([...replay.snapshot.nodeIds].sort()).toEqual([...replay.snapshot.objectIds].sort());
    assertNodeIdsMatchObjectIds(replay.snapshot);
  });

  it('证据件自洽：绝对路径 + graph=org-a + 三计数>0 + 节点/对象集合相等（跨平台可复核）', () => {
    const evidencePath = t0EvidencePath();
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as T0Evidence;

    expect(evidence.schema).toBe('synova-t0-scan-evidence/v1');
    expect(evidence.issue).toBe(1459);
    expect(evidence.task).toBe('T0');
    // 证据件是跨平台共读的：只校验"绝对路径形状"（Windows 盘符 或 POSIX 根）与固定两段，
    // 不做 `path.isAbsolute`（POSIX 会把 `C:\...` 判成相对路径）。
    expect(evidence.db.path).toMatch(/^(?:[A-Za-z]:[\\/]|\/)/);
    const segments = evidence.db.path.split(/[\\/]/);
    expect(segments[segments.length - 2]).toBe('1459-scan');
    expect(segments[segments.length - 1]).toBe('synova.db');
    expect(evidence.db.size_bytes).toBeGreaterThan(0);

    expect(evidence.scan.graph).toBe('org-a');
    expect(evidence.scan.report_schema_version).toBe('enterprise-scan/v1');
    expect(evidence.scan.scan_run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(evidence.scan.counts_after_run.graph_nodes).toBeGreaterThan(0);
    expect(evidence.scan.counts_after_run.graph_triples).toBeGreaterThan(0);
    expect(evidence.scan.counts_after_run.scan_assertions).toBeGreaterThan(0);
    for (const table of OUTPUT_TABLES) expect({ table, n: evidence.scan.counts_before_run[table] }).toEqual({ table, n: 0 });

    expect(evidence.evidence.node_id_set_equals_object_ids).toBe(true);
    expect(evidence.evidence.graph_nodes_count_equals_object_ids_count).toBe(true);
    expect(evidence.evidence.graph_triples_count_equals_relation_count).toBe(true);
    expect(evidence.evidence.scan_assertions_count_equals_report_assertions_count).toBe(true);
    expect(evidence.evidence.node_ids.length).toBeGreaterThan(0);
    expect([...evidence.evidence.node_ids].sort()).toEqual([...evidence.evidence.object_ids].sort());

    expect(evidence.downstream.env.SYNOVA_DB_PATH).toBe(evidence.db.path);
    expect(evidence.downstream.env.SYNOVA_ORG_ID).toBe(evidence.scan.graph);
    expect(evidence.fixture.seed_scope).toEqual(['scan_sources', 'scan_authorizations']);
  });

  it('固定路径规则：DSH 会话级 TEMP 被归一、覆盖变量按绝对路径生效', () => {
    // 会话级 TEMP 归一到机器级临时根（换会话不变）
    const machineRoot = resolveTempRoot({});
    expect(resolveTempRoot({ TEMP: join(machineRoot, 'dsh-session-abc123') })).toBe(machineRoot);
    // 固定规则两段
    expect(t0DbPath({})).toBe(join(machineRoot, '1459-scan', 'synova.db'));
    // 显式覆盖（下游钉死同一库时用）
    const override = join(machineRoot, 'other', 'synova.db');
    expect(t0DbPath({ SYNOVA_1459_SCAN_DB: override })).toBe(resolve(override));
  });
});
