import { createHash } from 'crypto';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { authorityCounts, GOLDEN_FILES, seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

function setup() {
  const harness = createScanHarness();
  const root = writeFixtureRoot();
  seedManifest(harness.db, { root });
  return { ...harness, root };
}

describe('#1398 独立 golden', () => {
  it('4对象/2关系/6自然键关联/11断言及版本/14证据关联，汇总为15/15/13', async () => {
    const { db, service, close } = setup();
    try {
      const result = await service.run(viewer(), 'manifest-golden', 'request-golden');
      expect(result.replayed).toBe(false);
      expect(result.report.schema_version).toBe('enterprise-scan/v1');
      expect(result.report.ontology.objects).toHaveLength(4);
      expect(result.report.ontology.relations).toHaveLength(2);
      expect(result.report.assertions).toHaveLength(11);
      expect(result.report.checks.dashboard.map(check => [check.metric, check.calculated, check.dashboard, check.calculation_match, check.difference])).toEqual([
        ['planned_count', 15, 15, true, 0],
        ['delivered_count', 15, 15, true, 0],
        ['accepted_count', 13, 13, true, 0],
      ]);
      expect(authorityCounts(db)).toEqual({
        scan_runs: 1,
        scan_evidence: 4,
        scan_evidence_versions: 4,
        graph_nodes: 4,
        graph_triples: 2,
        scan_ontology_links: 6,
        scan_assertions: 11,
        scan_assertion_versions: 11,
        scan_assertion_evidence: 14,
        scan_reports: 1,
        scan_report_assertions: 11,
      });
      const policy = result.report.assertions.find(item => item.field === 'acceptance_definition');
      expect(policy).toMatchObject({ assertion_type: 'fact', evidence_status: 'confirmed', instance_state: 'measured' });
      expect(policy?.evidence).toEqual([{ evidenceVersionId: expect.any(String), sourceRef: 'delivery-policy.md#L4' }]);
      const statement = result.report.assertions.find(item => item.field === 'statement:stmt-001');
      expect(statement).toMatchObject({ assertion_type: 'fact', evidence_status: 'confirmed', instance_state: 'measured' });
      const claim = result.report.assertions.find(item => item.assertion_kind === 'statement' && item.field === 'accepted_count');
      expect(claim).toMatchObject({ assertion_type: 'inference', evidence_status: 'pending', instance_state: 'estimated', value: 8 });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { close(); }
  });

  it('同键重放零增长，不同键同文件只新增run/viewer报告及关联', async () => {
    const { db, service, close } = setup();
    try {
      const first = await service.run(viewer(), 'manifest-golden', 'request-golden');
      const initial = authorityCounts(db);
      const replay = await service.run(viewer(), 'manifest-golden', 'request-golden');
      expect(replay.replayed).toBe(true);
      expect(replay.report).toEqual(first.report);
      expect(authorityCounts(db)).toEqual(initial);
      const second = await service.run(viewer(), 'manifest-golden', 'request-second');
      expect(second.replayed).toBe(false);
      expect(authorityCounts(db)).toEqual({
        ...initial,
        scan_runs: initial.scan_runs + 1,
        scan_reports: initial.scan_reports + 1,
        scan_report_assertions: initial.scan_report_assertions + 11,
      });
    } finally { close(); }
  });

  it('原文件哈希/大小/mtime不变，修改后形成新证据版本且②身份不重复', async () => {
    const { db, service, close, root } = setup();
    try {
      const before = Object.keys(GOLDEN_FILES).map(name => {
        const path = join(root, name);
        const stat = statSync(path);
        return { name, sha: createHash('sha256').update(readFileSync(path)).digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs };
      });
      await service.run(viewer(), 'manifest-golden', 'request-golden');
      for (const item of before) {
        const path = join(root, item.name);
        const stat = statSync(path);
        expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(item.sha);
        expect(stat.size).toBe(item.size);
        expect(stat.mtimeMs).toBe(item.mtimeMs);
      }
      const counts = authorityCounts(db);
      const path = join(root, 'delivery_dashboard.csv');
      writeFileSync(path, readFileSync(path, 'utf8').replace('accepted_count,13', 'accepted_count,14'));
      await service.run(viewer(), 'manifest-golden', 'request-changed');
      const changed = authorityCounts(db);
      expect(changed.scan_evidence_versions).toBe(counts.scan_evidence_versions + 1);
      expect(changed.graph_nodes).toBe(counts.graph_nodes);
      expect(changed.graph_triples).toBe(counts.graph_triples);
      expect(changed.scan_ontology_links).toBe(counts.scan_ontology_links);
    } finally { close(); }
  });
});
