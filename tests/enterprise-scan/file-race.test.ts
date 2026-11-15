import { cpSync, readFileSync, renameSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { inspectAuthorizedSource } from '../../src/connectors/enterprise-scan/path-authorizer';
import { buildScanModel } from '../../src/connectors/enterprise-scan/scanner';
import { canViewSource, visibilityFingerprint } from '../../src/connectors/enterprise-scan/visibility';
import { scanRequestFingerprint } from '../../src/connectors/enterprise-scan/request-fingerprint';
import type { PersistScanInput, PreflightSource } from '../../src/connectors/enterprise-scan/types';
import { DELIVERY_DASHBOARD, authorityCounts, seedManifest, writeFixtureRoot } from './fixtures';
import { createScanHarness, viewer } from './test-helpers';

function prepare(restricted = false) {
  const harness = createScanHarness();
  const root = writeFixtureRoot();
  seedManifest(harness.db, { root, restricted: restricted ? ['operator-statement.json'] : [] });
  const authorizations = harness.store.listAuthorizations('org-a', 'manifest-golden');
  const preflights = authorizations.map(inspectAuthorizedSource);
  const currentViewer = restricted ? viewer('responsible', 'responsible-a') : viewer();
  const visible = preflights.filter(item => canViewSource(currentViewer, item.authorization));
  const model = buildScanModel('org-a', visible, visible.length < preflights.length);
  const input: PersistScanInput = {
    record: {
      runId: 'race-run', graph: 'org-a', operation: 'enterprise-scan', createdBy: currentViewer.sub, clientRequestId: 'race-request',
      requestFingerprint: scanRequestFingerprint({
        manifestId: 'manifest-golden', authorizationRevision: 1,
        sourceIds: authorizations.map(item => item.sourceId), sourceContentHashes: preflights.map(item => item.sha256),
      }),
      status: 'completed', manifestId: 'manifest-golden',
    },
    viewer: currentViewer, authorizationRevision: 1, visibilityFingerprint: visibilityFingerprint(visible), preflights, model,
  };
  return { ...harness, root, preflights, input };
}

function expectNonZeroIdentity(preflight: PreflightSource): void {
  expect(preflight.identity.dev).not.toBe('0');
  expect(preflight.identity.ino).not.toBe('0');
  expect(preflight.pathChain.length).toBeGreaterThan(0);
  for (const item of preflight.pathChain) {
    expect(item.dev).not.toBe('0');
    expect(item.ino).not.toBe('0');
  }
}

describe('#1398 Windows文件身份与提交前竞态', () => {
  it('同大小不同内容即使mtime恢复也失败且零新增', async () => {
    const { db, store, close, root, preflights, input } = prepare();
    try {
      preflights.forEach(expectNonZeroIdentity);
      const path = join(root, 'delivery_dashboard.csv');
      const before = statSync(path);
      writeFileSync(path, DELIVERY_DASHBOARD.replace('accepted_count,13', 'accepted_count,14'));
      utimesSync(path, before.atime, before.mtime);
      expect(statSync(path).size).toBe(before.size);
      const counts = authorityCounts(db);
      await expect(Promise.resolve().then(() => store.persistScan(input))).rejects.toMatchObject({ code: 'FILE_CHANGED_BEFORE_COMMIT' });
      expect(authorityCounts(db)).toEqual(counts);
    } finally { close(); }
  });

  it('符号链接替换在提交前被拒绝且零新增', () => {
    const { db, store, close, root, input } = prepare();
    try {
      const path = join(root, 'delivery-policy.md');
      const real = join(root, 'delivery-policy-real.md');
      renameSync(path, real);
      symlinkSync(real, path, 'file');
      const counts = authorityCounts(db);
      expect(() => store.persistScan(input)).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED_PATH' }));
      expect(authorityCounts(db)).toEqual(counts);
    } finally { close(); }
  });

  it('目录junction替换即使内容相同也失败且零新增', () => {
    const { db, store, close, root, input } = prepare();
    try {
      const moved = `${root}-moved`;
      renameSync(root, moved);
      symlinkSync(moved, root, 'junction');
      const counts = authorityCounts(db);
      expect(() => store.persistScan(input)).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED_PATH' }));
      expect(authorityCounts(db)).toEqual(counts);
    } finally { close(); }
  });

  it('不可见来源在提交前变化也整体失败，不只复检可见子集', () => {
    const { db, store, close, root, input } = prepare(true);
    try {
      const path = join(root, 'operator-statement.json');
      writeFileSync(path, `${readFileSync(path, 'utf8').replace('"value":8', '"value":9')}`);
      const counts = authorityCounts(db);
      expect(() => store.persistScan(input)).toThrowError(expect.objectContaining({ code: 'FILE_CHANGED_BEFORE_COMMIT' }));
      expect(authorityCounts(db)).toEqual(counts);
    } finally { close(); }
  });

  it('不同目录替换具有同内容/大小/mtime时仍由路径链身份识别', () => {
    const { db, store, close, root, input } = prepare();
    try {
      const replacement = `${root}-replacement`;
      const moved = `${root}-original`;
      cpSync(root, replacement, { recursive: true, preserveTimestamps: true });
      renameSync(root, moved);
      renameSync(replacement, root);
      const path = join(root, 'delivery_dashboard.csv');
      expect(readFileSync(path, 'utf8')).toBe(DELIVERY_DASHBOARD);
      const counts = authorityCounts(db);
      expect(() => store.persistScan(input)).toThrowError(expect.objectContaining({ code: 'FILE_CHANGED_BEFORE_COMMIT' }));
      expect(authorityCounts(db)).toEqual(counts);
    } finally { close(); }
  });
});
