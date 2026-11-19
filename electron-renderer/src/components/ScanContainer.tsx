import React, { useEffect } from 'react';
import { useScanStore } from '../stores/scan-store';
import { ScanPanel } from './ScanPanel';

const ScanContainer: React.FC = () => {
  const state = useScanStore();
  const { open, start, retryList, retryScan, newScan } = state;

  useEffect(() => {
    void open();
  }, [open]);

  return (
    <ScanPanel
      status={state.status}
      items={state.items}
      selectedManifestId={state.selectedManifestId}
      clientRequestId={state.clientRequestId}
      runId={state.runId}
      report={state.report}
      replayed={state.replayed}
      error={state.error}
      degraded={state.degraded}
      staleReport={state.staleReport}
      onSelectManifest={state.selectManifest}
      onStart={() => { void start(); }}
      onRetryList={() => { void retryList(); }}
      onRetryScan={() => { void retryScan(); }}
      onNewScan={newScan}
    />
  );
};

export default ScanContainer;
