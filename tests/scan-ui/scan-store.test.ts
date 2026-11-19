import { describe, expect, it, vi } from 'vitest';
import {
  createScanStore,
  type ScanStoreDependencies,
} from '../../electron-renderer/src/stores/scan-store';
import type {
  ManifestListViewData,
  ScanReport,
  ScanViewData,
} from '../../electron-renderer/src/lib/enterprise-scan-api';

function reportFixture(clientRequestId = 'request-1', runId = 'run-a'): ScanReport {
  return {
    schema_version: 'enterprise-scan/v1',
    run: { run_id: runId, graph: 'org-a', operation: 'enterprise-scan', status: 'completed', manifest_id: 'manifest-a', client_request_id: clientRequestId },
    sources: [],
    checks: { source_internal: [], dashboard: [], cross_source: [] },
    ontology: { objects: [], relations: [] },
    assertions: [], evidence_gaps: [], supplement_requests: [], partial_visibility: false,
  };
}

const manifestList: ManifestListViewData = {
  kind: 'manifests',
  items: [{ manifestId: 'manifest-a', displayName: '清单 A' }, { manifestId: 'manifest-b', displayName: '清单 B' }],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

interface Harness {
  dependencies: ScanStoreDependencies;
  loadManifests: ReturnType<typeof vi.fn>;
  startScan: ReturnType<typeof vi.fn>;
  getScan: ReturnType<typeof vi.fn>;
}

function dependencies(overrides: {
  list?: ManifestListViewData | Promise<ManifestListViewData>;
  start?: ScanViewData | Promise<ScanViewData>;
  get?: ScanViewData | Promise<ScanViewData>;
  ids?: readonly string[];
} = {}): Harness {
  const ids = [...(overrides.ids ?? ['request-1', 'request-2'])];
  const loadManifests = vi.fn(async () => overrides.list === undefined ? manifestList : overrides.list);
  const startScan = vi.fn(async (_manifestId: string, clientRequestId: string) => overrides.start === undefined
    ? { kind: 'report', report: reportFixture(clientRequestId), replayed: false } as ScanViewData
    : overrides.start);
  const getScan = vi.fn(async () => overrides.get === undefined
    ? { kind: 'report', report: reportFixture(), replayed: false } as ScanViewData
    : overrides.get);
  return {
    loadManifests, startScan, getScan,
    dependencies: {
      loadManifests: loadManifests as ScanStoreDependencies['loadManifests'],
      startScan: startScan as ScanStoreDependencies['startScan'],
      getScan: getScan as ScanStoreDependencies['getScan'],
      createRequestId: () => ids.shift() ?? 'request-exhausted',
    },
  };
}

describe('#1413 scan store 清单与零请求守卫', () => {
  it('未 open 零请求；open 只 GET 清单一次，不自动 POST', async () => {
    const harness = dependencies();
    const store = createScanStore(harness.dependencies);
    expect(harness.loadManifests).toHaveBeenCalledTimes(0);
    expect(harness.startScan).toHaveBeenCalledTimes(0);
    await store.getState().open();
    expect(store.getState()).toMatchObject({ status: 'ready', items: manifestList.kind === 'manifests' ? manifestList.items : [], selectedManifestId: null });
    await store.getState().open();
    expect(harness.loadManifests).toHaveBeenCalledTimes(1);
    expect(harness.startScan).toHaveBeenCalledTimes(0);
  });

  it('清单加载中的重复 open 复用 listPromise', async () => {
    const pending = deferred<ManifestListViewData>();
    const harness = dependencies({ list: pending.promise });
    const store = createScanStore(harness.dependencies);
    const first = store.getState().open();
    const second = store.getState().open();
    expect(harness.loadManifests).toHaveBeenCalledTimes(1);
    expect(store.getState().listPromise).not.toBeNull();
    pending.resolve(manifestList);
    await Promise.all([first, second]);
    expect(store.getState().listPromise).toBeNull();
  });

  it('空清单和未选择清单均零 POST', async () => {
    const empty = createScanStore(dependencies({ list: { kind: 'manifests', items: [] } }).dependencies);
    await empty.getState().open();
    await empty.getState().start();
    expect(empty.getState().status).toBe('ready');

    const harness = dependencies();
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    await store.getState().start();
    store.getState().selectManifest('not-authorized-by-server-list');
    expect(store.getState().selectedManifestId).toBeNull();
    expect(harness.startScan).toHaveBeenCalledTimes(0);
  });

  it.each([
    { kind: 'error', httpStatus: 401, code: 'UNAUTHORIZED', phase: 'request', retryable: false, message: '登录' },
    { kind: 'error', httpStatus: 403, code: 'SCOPE_DENIED', phase: 'request', retryable: false, message: '拒绝' },
    { kind: 'degraded', reason: '网络失败', retryable: true },
  ] as const)('清单 $kind 不折成 ready(items=[])', async list => {
    const harness = dependencies({ list });
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    expect(store.getState().status).toBe(list.kind);
    expect(store.getState().items).toEqual([]);
    expect(harness.startScan).toHaveBeenCalledTimes(0);
  });

  it('retryList 只重新读取清单，不创建运行', async () => {
    const harness = dependencies({ list: { kind: 'degraded', reason: 'offline', retryable: true } });
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    await store.getState().retryList();
    expect(harness.loadManifests).toHaveBeenCalledTimes(2);
    expect(harness.startScan).toHaveBeenCalledTimes(0);
  });
});

describe('#1413 scan store 运行、离开恢复与同键幂等', () => {
  it('选择当前服务端 item 后才 POST，并保存 clientRequestId/runId/report', async () => {
    const harness = dependencies();
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    store.getState().selectManifest('manifest-a');
    await store.getState().start();
    expect(harness.startScan).toHaveBeenCalledWith('manifest-a', 'request-1');
    expect(store.getState()).toMatchObject({ status: 'report', clientRequestId: 'request-1', runId: 'run-a', report: reportFixture(), replayed: false });
  });

  it('running 重复 start 与离开／返回 open 均不重复 POST，选择和在途 Promise 保留', async () => {
    const pending = deferred<ScanViewData>();
    const harness = dependencies({ start: pending.promise });
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    store.getState().selectManifest('manifest-a');
    const first = store.getState().start();
    const requestPromise = store.getState().requestPromise;
    expect(requestPromise).not.toBeNull();
    const duplicate = store.getState().start();
    const reopened = store.getState().open();
    expect(harness.startScan).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ status: 'running', selectedManifestId: 'manifest-a', clientRequestId: 'request-1', requestPromise });
    pending.resolve({ kind: 'report', report: reportFixture(), replayed: false });
    await Promise.all([first, duplicate, reopened]);
    expect(store.getState()).toMatchObject({ status: 'report', requestPromise: null, report: reportFixture() });
  });

  it('服务端已提交但客户端未收到 201：原键对账到 200 replay，单报告且不换键', async () => {
    const harness = dependencies();
    harness.startScan
      .mockResolvedValueOnce({ kind: 'degraded', reason: '结果状态未知，将使用原请求编号核对', retryable: true })
      .mockResolvedValueOnce({ kind: 'report', report: reportFixture(), replayed: true });
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    store.getState().selectManifest('manifest-a');
    await store.getState().start();
    expect(store.getState()).toMatchObject({ status: 'degraded', clientRequestId: 'request-1', report: null });
    await store.getState().retryScan();
    expect(harness.startScan.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['manifest-a', 'request-1'], ['manifest-a', 'request-1'],
    ]);
    expect(store.getState()).toMatchObject({ status: 'report', clientRequestId: 'request-1', report: reportFixture(), replayed: true });
    expect(store.getState().newScan).toBeTypeOf('function');
  });

  it('只有对账完成后的明确 newScan 才允许下一键，且不自动 POST', async () => {
    const harness = dependencies();
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    store.getState().selectManifest('manifest-a');
    store.getState().newScan();
    expect(store.getState().clientRequestId).toBeNull();
    await store.getState().start();
    store.getState().newScan();
    expect(store.getState()).toMatchObject({ status: 'ready', clientRequestId: null, runId: null, report: null });
    expect(harness.startScan).toHaveBeenCalledTimes(1);
    await store.getState().start();
    expect(harness.startScan.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['manifest-a', 'request-1'], ['manifest-a', 'request-2'],
    ]);
  });

  it('已知 runId 且无报告时 open 通过 GET 恢复', async () => {
    const harness = dependencies();
    const store = createScanStore(harness.dependencies);
    store.setState({ runId: 'run-a', report: null, status: 'degraded' });
    await store.getState().open();
    expect(harness.getScan).toHaveBeenCalledWith('run-a');
    expect(harness.loadManifests).toHaveBeenCalledTimes(0);
    expect(harness.startScan).toHaveBeenCalledTimes(0);
    expect(store.getState()).toMatchObject({ status: 'report', runId: 'run-a', report: reportFixture() });
  });

  it('旧报告刷新失败同时保留此前报告与刷新失败状态', async () => {
    const harness = dependencies({ get: { kind: 'degraded', reason: '报告刷新失败：offline', retryable: true } });
    const store = createScanStore(harness.dependencies);
    store.setState({ runId: 'run-a', report: reportFixture(), status: 'report' });
    await store.getState().refreshReport();
    expect(store.getState()).toMatchObject({ status: 'degraded', report: reportFixture(), staleReport: true });
    expect(store.getState().degraded?.reason).toContain('刷新失败');
  });

  it('retryable=false 不重试；typed retryable=true 仍复用原键', async () => {
    const harness = dependencies({ start: { kind: 'error', httpStatus: 422, code: 'EMPTY_CONTENT', phase: 'parse', retryable: false, message: '空内容' } });
    const store = createScanStore(harness.dependencies);
    await store.getState().open();
    store.getState().selectManifest('manifest-a');
    await store.getState().start();
    await store.getState().retryScan();
    expect(harness.startScan).toHaveBeenCalledTimes(1);
    expect(store.getState().clientRequestId).toBe('request-1');
  });
});
