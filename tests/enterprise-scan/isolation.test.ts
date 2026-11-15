import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DELIVERY_BATCHES, DELIVERY_DASHBOARD, GOLDEN_FILES, OPERATOR_STATEMENT, authorityCounts, seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

describe('#1398 企业隔离、GET可见范围与源变化', () => {
  it('A/B同type+businessKey+client_request_id均独立成功，A不能读B运行', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const rootA = writeFixtureRoot();
      const rootB = writeFixtureRoot();
      seedManifest(db, { graph: 'org-a', root: rootA });
      seedManifest(db, { graph: 'org-b', root: rootB });
      const a = await service.run(viewer('owner', 'owner-a', 'org-a'), 'manifest-golden', 'same-request');
      const b = await service.run(viewer('owner', 'owner-b', 'org-b'), 'manifest-golden', 'same-request');
      expect(a.record.runId).not.toBe(b.record.runId);
      expect(a.report.ontology.objects.map(item => item.object_id)).not.toEqual(b.report.ontology.objects.map(item => item.object_id));
      expect(authorityCounts(db)).toMatchObject({ scan_runs: 2, graph_nodes: 8, graph_triples: 4, scan_ontology_links: 12 });
      await expect(service.get(viewer('owner', 'owner-a', 'org-a'), b.record.runId)).rejects.toMatchObject({ code: 'RUN_UNAVAILABLE' });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { close(); }
  });

  it('受限GET先过滤再生成报告，完全不可见403；源变化409', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const files = {
        ...GOLDEN_FILES,
        'delivery_batches.csv': DELIVERY_BATCHES.replace('2026-10,10,10,8,', '2026-10,10,10,100,'),
        'operator-statement.json': OPERATOR_STATEMENT.replace('"value":8', '"value":120'),
      };
      const root = writeFixtureRoot(files);
      seedManifest(db, { root, files, restricted: ['operator-statement.json'] });
      const full = await service.run(viewer(), 'manifest-golden', 'visibility-get');
      const before = authorityCounts(db);
      const restricted = await service.get(viewer('responsible', 'responsible-a'), full.record.runId);
      expect(restricted.partial_visibility).toBe(true);
      expect(JSON.stringify(restricted)).not.toContain('120');
      expect(authorityCounts(db)).toMatchObject({
        scan_runs: before.scan_runs,
        scan_evidence: before.scan_evidence,
        scan_evidence_versions: before.scan_evidence_versions,
        graph_nodes: before.graph_nodes,
        graph_triples: before.graph_triples,
        scan_reports: before.scan_reports + 1,
      });
      await expect(service.get(viewer('staff', 'staff-a'), full.record.runId)).rejects.toMatchObject({ code: 'RUN_UNAVAILABLE' });
      writeFileSync(join(root, 'delivery_dashboard.csv'), DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'));
      await expect(service.get(viewer(), full.record.runId)).rejects.toMatchObject({ code: 'SOURCE_CHANGED_RERUN_REQUIRED' });
    } finally { close(); }
  });
});
