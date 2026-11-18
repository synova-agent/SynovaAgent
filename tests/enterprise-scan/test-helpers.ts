import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import { EnterpriseScanService } from '../../src/agent/enterprise-scan-service';
import type { ScanRole, ScanViewer } from '../../src/connectors/enterprise-scan/types';

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

/**
 * 服务层 viewer 夹具。
 *
 * #1408：角色词表统一为 `WorkspaceRole`，默认身份由旧词表 `owner` 改为 `admin`
 * （`owner` 不再表示权限等级，只保留对象/行动负责人语义）。
 * `departmentIds` 保持 `['dept-delivery']`（1B 夹具形状，见 fixtures.ts）。
 */
export function viewer(role: ScanRole = 'admin', sub = 'owner-a', orgId = 'org-a'): ScanViewer {
  return { role, sub, orgId, departmentIds: ['dept-delivery'] };
}
