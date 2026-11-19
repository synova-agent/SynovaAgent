import { create } from 'zustand';
import {
  getScan,
  loadManifests,
  startScan,
  type ManifestListViewData,
  type ScanDegradedView,
  type ScanErrorView,
  type ScanManifestItem,
  type ScanReport,
  type ScanViewData,
} from '../lib/enterprise-scan-api';

export type ScanStatus = 'idle' | 'loading-list' | 'ready' | 'running' | 'report' | 'error' | 'degraded';

export interface ScanStoreDependencies {
  loadManifests: () => Promise<ManifestListViewData>;
  startScan: (manifestId: string, clientRequestId: string) => Promise<ScanViewData>;
  getScan: (runId: string) => Promise<ScanViewData>;
  createRequestId: () => string;
}

export interface ScanState {
  status: ScanStatus;
  items: ScanManifestItem[];
  selectedManifestId: string | null;
  clientRequestId: string | null;
  runId: string | null;
  report: ScanReport | null;
  replayed: boolean;
  error: ScanErrorView | null;
  degraded: ScanDegradedView | null;
  staleReport: boolean;
  requestPromise: Promise<void> | null;
  listPromise: Promise<void> | null;
  open: () => Promise<void>;
  retryList: () => Promise<void>;
  selectManifest: (manifestId: string) => void;
  start: () => Promise<void>;
  retryScan: () => Promise<void>;
  refreshReport: () => Promise<void>;
  newScan: () => void;
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function unexpected(error: unknown, phase: string): ScanDegradedView {
  const reason = `${phase}：${error instanceof Error ? error.message : String(error)}`;
  console.warn(`[scan-store] ${reason}`);
  return { kind: 'degraded', reason, retryable: true };
}

export function createScanStore(dependencies: ScanStoreDependencies = {
  loadManifests: () => loadManifests(),
  startScan: (manifestId, clientRequestId) => startScan(manifestId, clientRequestId),
  getScan: runId => getScan(runId),
  createRequestId: requestId,
}) {
  return create<ScanState>()((set, get) => ({
    status: 'idle',
    items: [],
    selectedManifestId: null,
    clientRequestId: null,
    runId: null,
    report: null,
    replayed: false,
    error: null,
    degraded: null,
    staleReport: false,
    requestPromise: null,
    listPromise: null,

    open: () => {
      const current = get();
      if (current.requestPromise) return current.requestPromise;
      if (current.listPromise) return current.listPromise;
      if (current.runId && current.report === null) return current.refreshReport();
      if (current.status !== 'idle') return Promise.resolve();
      return current.retryList();
    },

    retryList: () => {
      const existing = get().listPromise;
      if (existing) return existing;
      set({ status: 'loading-list', error: null, degraded: null, staleReport: false });
      let promise!: Promise<void>;
      promise = (async () => {
        try {
          const result = await dependencies.loadManifests();
          if (result.kind === 'manifests') {
            set(state => ({
              status: 'ready',
              items: result.items,
              selectedManifestId: result.items.some(item => item.manifestId === state.selectedManifestId)
                ? state.selectedManifestId
                : null,
              error: null,
              degraded: null,
            }));
          } else if (result.kind === 'error') {
            set({ status: 'error', error: result, degraded: null });
          } else {
            set({ status: 'degraded', error: null, degraded: result });
          }
        } catch (error) {
          set({ status: 'degraded', error: null, degraded: unexpected(error, '清单读取失败') });
        } finally {
          if (get().listPromise === promise) set({ listPromise: null });
        }
      })();
      set({ listPromise: promise });
      return promise;
    },

    selectManifest: manifestId => {
      if (get().items.some(item => item.manifestId === manifestId)) set({ selectedManifestId: manifestId });
    },

    start: () => {
      const current = get();
      if (current.requestPromise) return current.requestPromise;
      if (current.status === 'running' || current.status === 'report') return Promise.resolve();
      const selected = current.selectedManifestId;
      if (!selected || !current.items.some(item => item.manifestId === selected)) return Promise.resolve();
      const clientRequestId = current.clientRequestId ?? dependencies.createRequestId();
      set({ status: 'running', clientRequestId, error: null, degraded: null, staleReport: false });
      let promise!: Promise<void>;
      promise = (async () => {
        try {
          const result = await dependencies.startScan(selected, clientRequestId);
          if (result.kind === 'report') {
            set({
              status: 'report', runId: result.report.run.run_id, report: result.report,
              replayed: result.replayed, error: null, degraded: null, staleReport: false,
            });
          } else if (result.kind === 'error') {
            set({ status: 'error', error: result, degraded: null });
          } else {
            set({ status: 'degraded', error: null, degraded: result });
          }
        } catch (error) {
          set({ status: 'degraded', error: null, degraded: unexpected(error, '结果状态未知，将使用原请求编号核对') });
        } finally {
          if (get().requestPromise === promise) set({ requestPromise: null });
        }
      })();
      set({ requestPromise: promise });
      return promise;
    },

    retryScan: () => {
      const current = get();
      if (current.requestPromise) return current.requestPromise;
      if (current.error && !current.error.retryable) return Promise.resolve();
      if (current.degraded?.retryable === false) return Promise.resolve();
      if (current.runId) return current.refreshReport();
      return current.start();
    },

    refreshReport: () => {
      const current = get();
      if (current.requestPromise) return current.requestPromise;
      if (!current.runId) return Promise.resolve();
      const runId = current.runId;
      let promise!: Promise<void>;
      promise = (async () => {
        try {
          const result = await dependencies.getScan(runId);
          if (result.kind === 'report') {
            set({ status: 'report', report: result.report, replayed: false, error: null, degraded: null, staleReport: false });
          } else if (result.kind === 'error') {
            set(state => ({ status: 'error', error: result, degraded: null, staleReport: state.report !== null }));
          } else {
            set(state => ({ status: 'degraded', error: null, degraded: result, staleReport: state.report !== null }));
          }
        } catch (error) {
          set(state => ({ status: 'degraded', error: null, degraded: unexpected(error, '报告刷新失败'), staleReport: state.report !== null }));
        } finally {
          if (get().requestPromise === promise) set({ requestPromise: null });
        }
      })();
      set({ requestPromise: promise });
      return promise;
    },

    newScan: () => {
      if (get().status !== 'report') return;
      set({
        status: 'ready', clientRequestId: null, runId: null, report: null, replayed: false,
        error: null, degraded: null, staleReport: false,
      });
    },
  }));
}

export const useScanStore = createScanStore();
