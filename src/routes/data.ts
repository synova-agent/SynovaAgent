/**
 * data.ts — 数据上传 API (L1)
 *
 * POST /api/data/upload — 上传结构化数据 → 写入 L4 GraphStore
 *
 * 铁律39: L1 → L2 interfaces only.
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { getPIIScrubber } from '../security/pii-scrubber';
import { getPipelineMonitor, type PipelineMonitor } from '../monitoring/pipeline-monitor';
import { extractAuthFromRequest } from '../middleware/auth';
import { loadConfig } from '../config';
import { assertGraphName, resolveGraph, GraphScopeError } from '../l2/graph-scope';

const log = createLogger('routes/data');
const router = Router();

router.post('/api/data/upload', async (req: Request, res: Response) => {
  // #1211：**不再**从 body 解构 graph —— 图名统一在 try 内由 graph-scope 派生并过白名单
  const { mapping, rows } = req.body as {
    mapping?: string;
    rows?: Array<Record<string, unknown>>;
  };

  if (!mapping) {
    return res.status(400).json({ ok: false, error: 'mapping 必填 (字段映射配置名)' });
  }
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ ok: false, error: 'rows 必填 (至少一行数据)' });
  }

  try {
    // #1211 图名口径（唯一来源 src/l2/graph-scope.ts）：
    //   显式入参 ?? 实例级组织身份（JWT 身份优先，其次 loadConfig().orgId）
    // 🔴 必须在 try 内：express ^4 不捕获 async 拒绝 ⇒ 放到 try 外，非法 graph 会挂起而不是 400。
    const auth = extractAuthFromRequest(req);
    const graph = assertGraphName(
      (req.body as { graph?: unknown })?.graph
        ?? resolveGraph({ orgId: auth?.orgId ?? loadConfig().orgId }),
    );
    const { loadFieldMapping, ingestBatch } = await import('../agent/data-ingest-service');
    const config = loadFieldMapping(mapping);
    if (!config) {
      return res.status(400).json({ ok: false, error: `字段映射配置不存在: ${mapping}` });
    }

    // 从请求上下文获取 GraphStore (通过 server.ts 注入)
    const graphStore = (req.app.locals?.graphStore as { createNode?: Function } | undefined);
    if (!graphStore || typeof graphStore.createNode !== 'function') {
      return res.status(503).json({ ok: false, error: 'GraphStore 不可用' });
    }

    // D35: 管道可观测性 — 记录延迟
    const pipeStart = Date.now();

    // D34: PII S4预检 — 检测密码/Token/私钥，含则拒绝写入
    const scrubber = getPIIScrubber();
    for (const row of rows) {
      for (const val of Object.values(row)) {
        if (typeof val === 'string') {
          const result = scrubber.scrub(val, 'S4');
          if (result.matches.length > 0) {
            log.warn({ s4Type: result.matches[0].type }, '上传含S4敏感信息，拒绝写入');
            return res.status(422).json({
              ok: false, error: `数据包含S4敏感信息(${result.matches[0].type})，拒绝写入`,
            });
          }
        }
      }
    }

    const result = await ingestBatch(
      graphStore as { createNode(type: string, props: Record<string, unknown>, graph: string): string },
      config,
      rows,
      graph,
    );

    // D35: 管道可观测性 — 记录成功
    getPipelineMonitor().recordIngestion('upload', Date.now() - pipeStart, mapping, rows.length);

    log.info({ mapping, rows: rows.length, created: result.nodesCreated }, '数据上传完成');
    res.json(result);
  } catch (err: unknown) {
    // #1211：图名非法是**可捕获的业务拒绝** ⇒ 400（含稳定 code），不是 500
    if (err instanceof GraphScopeError) {
      log.warn({ err }, 'graph 命名空间非法');
      return res.status(400).json({ ok: false, error: '图命名空间非法', code: 'GRAPH_NAME_INVALID' });
    }
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "D35: 管道可观测性 — 记录成功");
    const msg = err instanceof Error ? err.message : String(err);
    // D35: 管道可观测性 — 记录失败
    getPipelineMonitor().recordFailure('upload', mapping || 'unknown', msg);
    log.warn({ err: msg }, '数据上传失败');
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
