import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import type { JwtPayload } from '../middleware/auth';
import type { EnterpriseScanService } from '../agent/enterprise-scan-service';
import { asEnterpriseScanError, EnterpriseScanError } from '../connectors/enterprise-scan/errors';
import type { ScanViewer } from '../connectors/enterprise-scan/types';

const router = Router();
const log = createLogger('routes/enterprise-scan');

type AuthedRequest = Request & { auth?: JwtPayload };

function viewerOf(req: AuthedRequest): ScanViewer {
  const auth = req.auth;
  if (!auth?.sub || !auth.orgId || !auth.role) throw new EnterpriseScanError('SCOPE_DENIED', 'request', '缺少验签企业身份');
  return { sub: auth.sub, role: auth.role, orgId: auth.orgId, departmentIds: auth.departmentIds };
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
