import { writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DELIVERY_DASHBOARD, authorityCounts, seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

const FAILURE_POINTS = {
  evidence_version: 'scan_evidence_versions',
  assertion_version: 'scan_assertion_versions',
  relation: 'graph_triples',
  report: 'scan_reports',
} as const;

describe('#1398 SQLite故障注入零半写', () => {
  for (const [name, table] of Object.entries(FAILURE_POINTS)) {
    it(`${name}写点失败时run/证据/②/断言/报告全部回滚`, async () => {
      const { db, service, close } = createScanHarness();
      try {
        const root = writeFixtureRoot();
        seedManifest(db, { root });
        db.exec(`CREATE TRIGGER fail_1398_${name} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected-${name}'); END;`);
        const before = authorityCounts(db);
        await expect(service.run(viewer(), 'manifest-golden', `failure-${name}`)).rejects.toMatchObject({ code: 'TRANSACTION_ABORTED' });
        expect(authorityCounts(db)).toEqual(before);
        expect(db.pragma('foreign_key_check')).toEqual([]);
      } finally { close(); }
    });
  }

  it('新版本报告写点失败后旧证据版本和报告仍可读', async () => {
    const { db, service, close } = createScanHarness();
    try {
      const root = writeFixtureRoot();
      seedManifest(db, { root });
      const first = await service.run(viewer(), 'manifest-golden', 'old-version');
      const before = authorityCounts(db);
      db.exec("CREATE TRIGGER fail_1398_report_update BEFORE INSERT ON scan_reports BEGIN SELECT RAISE(ABORT, 'injected-report-update'); END;");
      writeFileSync(join(root, 'delivery_dashboard.csv'), DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'));
      await expect(service.run(viewer(), 'manifest-golden', 'new-version')).rejects.toMatchObject({ code: 'TRANSACTION_ABORTED' });
      expect(authorityCounts(db)).toEqual(before);
      const oldReport = db.prepare('SELECT report_json FROM scan_reports WHERE graph = ? AND run_id = ?').get('org-a', first.record.runId) as { report_json: string };
      expect(JSON.parse(oldReport.report_json).run.run_id).toBe(first.record.runId);
      expect(db.prepare('SELECT COUNT(*) AS n FROM scan_evidence_versions').get()).toEqual({ n: 4 });
    } finally { close(); }
  });
});
