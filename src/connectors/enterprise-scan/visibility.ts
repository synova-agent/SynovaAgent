import { fingerprint } from './canonical';
import type { ScanAuthorization, ScanViewer } from './types';

export function canViewSource(viewer: ScanViewer, source: ScanAuthorization): boolean {
  if (!viewer.sub || !viewer.orgId || viewer.orgId !== source.graph) return false;
  if (viewer.role === 'owner') return true;
  if (viewer.role !== 'operator' && viewer.role !== 'responsible') return false;
  if (source.visibility === 'enterprise') return true;
  if (source.visibility !== 'restricted') return false;
  if (source.allowedUsers.includes(viewer.sub)) return true;
  if (!source.allowedRoles.includes(viewer.role)) return false;
  const departments = viewer.departmentIds ?? [];
  return departments.some(department => source.allowedDepartments.includes(department));
}

export function visibilityFingerprint(sources: Array<{ authorization: ScanAuthorization; sha256: string }>): string {
  return fingerprint(sources.map(source => ({
    sourceId: source.authorization.sourceId,
    sha256: source.sha256,
    revision: source.authorization.revision,
  })).sort((a, b) => a.sourceId.localeCompare(b.sourceId)));
}
