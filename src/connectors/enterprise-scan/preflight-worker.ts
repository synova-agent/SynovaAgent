import { parentPort, workerData } from 'worker_threads';
import { inspectAuthorizedSource } from './path-authorizer';
import type { ScanAuthorization } from './types';

if (parentPort === null) throw new Error('preflight worker 缺少 parentPort');
const authorization = workerData as ScanAuthorization;
try {
  parentPort.postMessage({ ok: true, preflight: inspectAuthorizedSource(authorization) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error
      ? { name: error.name, message: error.message, code: 'code' in error ? String(error.code) : undefined }
      : { name: 'Error', message: String(error) },
  });
}
