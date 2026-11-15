import { Worker } from 'worker_threads';
import { EnterpriseScanError, type EnterpriseScanErrorCode } from './errors';
import type { PreflightSource, ScanAuthorization } from './types';

interface WorkerSuccess { ok: true; preflight: PreflightSource }
interface WorkerFailure { ok: false; error: { name: string; message: string; code?: string } }
type WorkerResult = WorkerSuccess | WorkerFailure;

function isWorkerResult(value: unknown): value is WorkerResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  const result = value as { ok?: unknown; preflight?: unknown; error?: unknown };
  return result.ok === true ? result.preflight !== undefined : result.ok === false && result.error !== undefined;
}

function runWorker(authorization: ScanAuthorization): { worker: Worker; promise: Promise<PreflightSource> } {
  const worker = new Worker(new URL('./preflight-worker.ts', import.meta.url), {
    workerData: authorization,
    execArgv: ['--import', 'tsx'],
  });
  const promise = new Promise<PreflightSource>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', `来源预检超过 2 秒: ${authorization.sourceId}`));
    }, 2000);
    worker.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (!isWorkerResult(message)) {
        reject(new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', '预检 worker 返回非法结果'));
        return;
      }
      if (!message.ok) {
        const allowedCodes: readonly EnterpriseScanErrorCode[] = [
          'UNAUTHORIZED_PATH', 'UNSUPPORTED_FORMAT', 'EMPTY_CONTENT',
          'SOURCE_VALIDATION_FAILED', 'FILE_CHANGED_BEFORE_COMMIT',
        ];
        const rawCode = message.error.code;
        const code = allowedCodes.find(candidate => candidate === rawCode) ?? 'SOURCE_VALIDATION_FAILED';
        reject(new EnterpriseScanError(code, 'preflight', message.error.message));
        return;
      }
      resolve(message.preflight);
    });
    worker.once('error', (error: Error) => {
      clearTimeout(timer);
      reject(new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', error.message));
    });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', `预检 worker 异常退出: ${code}`));
    });
  });
  return { worker, promise };
}

export async function preflightSources(authorizations: ScanAuthorization[]): Promise<PreflightSource[]> {
  if (authorizations.length > 8) throw new EnterpriseScanError('VALIDATION_ERROR', 'preflight', '扫描清单最多 8 个来源');
  const workers = authorizations.map(runWorker);
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const totalTimeout = new Promise<never>((_resolve, reject) => {
    totalTimer = setTimeout(() => reject(new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', '全部来源预检超过 5 秒')), 5000);
  });
  try {
    return await Promise.race([Promise.all(workers.map(item => item.promise)), totalTimeout]);
  } finally {
    if (totalTimer !== undefined) clearTimeout(totalTimer);
    await Promise.all(workers.map(item => item.worker.terminate()));
  }
}
