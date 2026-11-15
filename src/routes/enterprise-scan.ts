import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import type { JwtPayload } from '../middleware/auth';
import type { EnterpriseScanService } from '../agent/enterprise-scan-service';
import { asEnterpriseScanError, EnterpriseScanError } from '../connectors/enterprise-scan/errors';
import { toScanViewer } from '../connectors/enterprise-scan/visibility';
import type { ScanViewer } from '../connectors/enterprise-scan/types';

const router = Router();
const log = createLogger('routes/enterprise-scan');

type AuthedRequest = Request & { auth?: JwtPayload };

/**
 * #1408：验签身份 → `ScanViewer` 的**唯一**收窄点（`toScanViewer`）。
 *
 * 失败语义：缺 sub/orgId、角色缺失/非枚举、`ga` ⇒ `SCOPE_DENIED`（403）+ 固定 message + 零写入。
 * 旧实现在此处只做真值校验，`role` 直接透传 ⇒ 未知角色到 `canViewSource` 才被拒、且 `ga` 无固定口径。
 */
function viewerOf(req: AuthedRequest): ScanViewer {
  return toScanViewer(req.auth);
}

function serviceOf(req: Request): EnterpriseScanService {
  const service = req.app.locals.container.enterpriseScanService;
  if (!service) throw new EnterpriseScanError('SCAN_STORE_FAILED', 'request', 'enterpriseScanService 未由组合根注入');
  return service;
}

function bodyOf(req: Request): { manifestId: string; clientRequestId: string } {
  if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
    throw new EnterpriseScanError('VALIDATION_ERROR', 'request', '请求体必须为 JSON 对象');
  }
  const body = req.body as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'scan_manifest_id' && key !== 'client_request_id')) {
    throw new EnterpriseScanError('VALIDATION_ERROR', 'request', '请求体只允许 scan_manifest_id 与 client_request_id');
  }
  if (typeof body.scan_manifest_id !== 'string' || body.scan_manifest_id.trim() === ''
    || typeof body.client_request_id !== 'string' || body.client_request_id.trim() === '') {
    throw new EnterpriseScanError('VALIDATION_ERROR', 'request', 'scan_manifest_id 与 client_request_id 必须为非空字符串');
  }
  return { manifestId: body.scan_manifest_id, clientRequestId: body.client_request_id };
}

function respondError(res: Response, error: unknown): void {
  const classified = asEnterpriseScanError(error);
  if (classified.status >= 500) log.error({ code: classified.code, phase: classified.phase, err: classified.message }, '企业扫描失败');
  else log.warn({ code: classified.code, phase: classified.phase }, '企业扫描请求被拒绝');
  res.status(classified.status).json({
    ok: false,
    code: classified.code,
    message: classified.message,
    phase: classified.phase,
    retryable: classified.retryable,
  });
}

router.post('/api/enterprise-scan/runs', async (req: AuthedRequest, res: Response) => {
  try {
    const body = bodyOf(req);
    const result = await serviceOf(req).run(viewerOf(req), body.manifestId, body.clientRequestId);
    res.status(result.replayed ? 200 : 201).json(result.report);
  } catch (error) { respondError(res, error); }
});

router.get('/api/enterprise-scan/runs/:runId', async (req: AuthedRequest, res: Response) => {
  try {
    const runId = req.params.runId;
    if (typeof runId !== 'string' || runId.length === 0) throw new EnterpriseScanError('VALIDATION_ERROR', 'request', 'runId 必须为非空字符串');
    const report = await serviceOf(req).get(viewerOf(req), runId);
    res.status(200).json(report);
  } catch (error) { respondError(res, error); }
});

export default router;
