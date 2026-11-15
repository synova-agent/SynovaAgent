import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import { EnterpriseScanService } from '../../src/agent/enterprise-scan-service';
import type { ScanViewer } from '../../src/connectors/enterprise-scan/types';

export interface ScanHarness {
  db: Database.Database;
  graphStore: SqliteGraphStore;
  store: EnterpriseScanStore;
  service: EnterpriseScanService;
  close: () => void;
}

export function createScanHarness(): ScanHarness {
  const db = new BetterSqlite3(':memory:');
  const graphStore = new SqliteGraphStore(db);
  const store = new EnterpriseScanStore(db, graphStore);
  const service = new EnterpriseScanService(store);
  return { db, graphStore, store, service, close: () => db.close() };
}

export function viewer(role = 'owner', sub = 'owner-a', orgId = 'org-a'): ScanViewer {
  return { role, sub, orgId, departmentIds: ['dept-delivery'] };
}
