import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

describe('#1398 DSH停止或不存在时的领域运行', () => {
  it('DSH_HOME指向不存在目录仍完成真实SQLite扫描', async () => {
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = join(tmpdir(), 'synova-1398-dsh-does-not-exist');
    const { db, service, close } = createScanHarness();
    try {
      const root = writeFixtureRoot();
      seedManifest(db, { root });
      const { report } = await service.run(viewer(), 'manifest-golden', 'without-dsh');
      expect(report.ontology.objects).toHaveLength(4);
      expect(report.ontology.relations).toHaveLength(2);
      expect(report.assertions).toHaveLength(11);
    } finally {
      close();
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    }
  });
});
