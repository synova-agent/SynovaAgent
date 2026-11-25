/**
 * src/routes/dsh.ts — 1A 真实入口：认证 API ＋ SSE（不提供可见 UI）。
 *
 * 端点（写进 1A 契约）：
 *   POST /api/dsh/runs                    发起一轮运行（服务端注入 enterpriseId/userId/scope）
 *   GET  /api/dsh/runs/:runId/events      SSE 事件流（重放 + 实时；终态即结束）
 *   GET  /api/dsh/runs/:runId             运行快照（turn.ps1 轮询用）
 *   POST /api/dsh/runs/:runId/cancel      取消该轮（不停止 Sidecar）
 *   POST /api/dsh/sessions/:sessionId/close  关闭会话（不停止进程）
 *
 * 安全边界：
 *   · 身份只来自 `req.auth`（jwtAuthMiddleware 验签后注入），**不从 body/query 取**；
 *   · 运行按 runId 全局幂等；跨企业访问同一 runId ⇒ 拒绝（不泄露存在性）；
 *   · SSE 只回该企业自己的 run 事件。
 *
 * 契约（铁律 47）:
 *   @input   HTTP ＋ req.auth（JwtPayload）；body {input, runId?, sessionId?, problemId?}
 *   @output  JSON（{ok, runId, status, transportStatus, outcomeStatus, ...}）｜ text/event-stream
 *            · 终态事件（run.completed/run.failed/run.cancelled）载荷含 transportStatus／outcomeStatus
 *            · run 查询把两字段一并返回（运行中：transportStatus='running'、outcomeStatus=null）
 *   @degraded 无：任何失败都返回稳定 code/phase/retryable（不吞成空 200）；运行中 outcomeStatus=null
 *            （未判定，**不预填 success**），由 UI 显示「暂无法判定」
 *   @authority 身份只来自 req.auth；`problemId` 只作为**结构化入参**流向 run/MCP token 上下文，不拼进 prompt
 *   @not-here 不解析 problemId 指向的对象、不判定企业归属（工具侧 `domain-context` 负责）
 *   @error   UNAUTHORIZED / VALIDATION_ERROR / FORGED_IDENTITY / RUN_NOT_FOUND /
 *            SESSION_NOT_FOUND / RUN_FAILED（运行期失败走 SSE run.failed 事件）
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { JwtPayload } from '../middleware/auth';
import { DshError, toDshError } from '../runtime/dsh/errors';
import { formatSseFrame, formatSseHeartbeat, isTerminalEvent, type AgentEvent } from '../runtime/dsh/events';
import type { ReadonlyMcpServer } from '../mcp/http';
import type { ProposalManager } from '../l2/proposal-manager';
import { persistProposalDraft, type ProposalDraftResult } from '../runtime/dsh/proposals';
import type { DshRunManager, RunRecord } from '../runtime/dsh/session';

/** 校验：输入长度上限（超过即 VALIDATION_ERROR，不截断静默降级）。 */
const MAX_INPUT_CHARS = 100_000;
/** runId / sessionId 允许字符集。 */
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** 路由依赖（测试注入 fake runtime；生产用默认单例）。 */
export interface DshRouterDeps {
  runtime: DshRunManager;
  /** SSE 心跳间隔（缺省 15s；测试可调小）。 */
  heartbeatMs?: number;
  /** 是否把回环只读 MCP 挂到每个 run（缺省 true；离线路由测试可关）。 */
  enableMcp?: boolean;
  /** 覆盖 MCP 启动器（集成测试注入）。 */
  mcpStarter?: () => Promise<ReadonlyMcpServer>;
  /** Proposal 草案落库（生产 = container.proposalManager；缺省不落库）。 */
  proposalManager?: ProposalManager;
}

interface Identity {
  enterpriseId: string;
  userId: string;
  scope: string;
}

/** 从验签后的 req.auth 取身份；缺失返回 null（路由层一律 401）。 */
function identityOf(req: Request): Identity | null {
  const auth = (req as Request & { auth?: JwtPayload }).auth;
  if (auth === undefined || auth === null) return null;
  if (typeof auth.sub !== 'string' || auth.sub.length === 0) return null;
  if (typeof auth.orgId !== 'string' || auth.orgId.length === 0) return null;
  return {
    enterpriseId: auth.orgId,
    userId: auth.sub,
    scope: typeof auth.role === 'string' ? auth.role : 'unknown',
  };
}

/** 统一错误响应（HTTP 状态由 code 决定）。 */
function respondError(res: Response, err: unknown): void {
  const error = toDshError(err, { code: 'RUN_FAILED', phase: 'request' });
  res.status(error.httpStatus).json(error.toPayload());
}

/** 取路径参数（Express 5 类型为 string | string[]；数组形态视为非法输入）。 */
function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === 'string') return value;
  throw new DshError('VALIDATION_ERROR', 'request', `路径参数 ${name} 非法`, { retryable: false });
}

/** 取该企业可见的 run；跨企业/不存在都按 RUN_NOT_FOUND（不泄露存在性）。 */
function visibleRun(runtime: DshRunManager, runId: string, identity: Identity): RunRecord {
  const record = runtime.getRun(runId);
  if (record === undefined || record.enterpriseId !== identity.enterpriseId) {
    throw new DshError('RUN_NOT_FOUND', 'run', `未知 runId: ${runId}`, { retryable: false });
  }
  return record;
}

/** 校验 body 里的 ID 字段（可选）。 */
function optionalId(value: unknown, pattern: RegExp, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new DshError('VALIDATION_ERROR', 'request', `${field} 非法（允许 [A-Za-z0-9_-]，长度受限）`, { retryable: false });
  }
  return value;
}

/** 构造 1A 路由（依赖注入，便于真实路由集成测试）。 */
export function createDshRouter(deps: DshRouterDeps): Router {
  const runtime = deps.runtime;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const enableMcp = deps.enableMcp ?? true;
  const startMcp = deps.mcpStarter ?? (async (): Promise<ReadonlyMcpServer> => {
    // 懒加载 MCP SDK（只在首个 run 时加载，不拖慢进程启动导入面）。
    const { startReadonlyMcpServer } = await import('../mcp/http');
    return startReadonlyMcpServer();
  });
  const router = Router();
  /** 回环 MCP 懒启动：只有真的发起 run 才监听端口（不污染纯领域进程）。 */
  let mcpPromise: Promise<ReadonlyMcpServer> | null = null;
  /** runId → 一次性 token（终态撤销；不写日志）。 */
  const runTokens = new Map<string, string>();
  /** runId → Proposal 草案落库结果（GET /runs/:id 可观察；不泄露其他企业）。 */
  const runDrafts = new Map<string, ProposalDraftResult | { ok: false; code: string; message: string }>();
  const ensureMcp = (): Promise<ReadonlyMcpServer> => {
    if (mcpPromise === null) mcpPromise = startMcp();
    return mcpPromise;
  };
  const attachMcpProvider = (server: ReadonlyMcpServer): void => {
    runtime.setMcpServersProvider(request => {
      const token = runTokens.get(request.runId);
      if (token === undefined) return [];
      return [{
        name: 'synova-sidecar',
        type: 'http',
        url: server.url,
        headers: [{ name: 'authorization', value: `Bearer ${token}` }],
      }];
    });
  };

  /**
   * POST /api/dsh/runs — 发起一轮运行（#1486 裁定 e：body 增可选 `problemId`）。
   *
   * 契约（铁律 47）:
   *   @input  body.input（非空字符串，≤100k）｜body.runId?/sessionId?（ID 形态）｜
   *           body.problemId?（非空字符串；本企业 ② 对象 `businessKey` 或 `$id`；长度上限由工具侧
   *           `domain-context` 的 256 统一执法，本层不复制该常量）
   *   @output 202（新 run）/200（同 runId 重放）＋ `{ok, runId, sessionId, status, eventCount, replayed, mcp}`
   *   @degraded 无：失败一律稳定 code/phase/retryable（不吞成空 200）
   *   @authority 身份只来自 `req.auth`；`problemId` 只经 `RunRequest.problemId` 与 MCP token 上下文流向工具
   *   @not-here 不把 problemId 拼进 `input`/prompt；不解析其领域存在性；不跨企业复用 runId
   *   @error  UNAUTHORIZED / VALIDATION_ERROR / FORGED_IDENTITY / RUN_FAILED / TOOL_ERROR
   */
  router.post('/api/dsh/runs', async (req: Request, res: Response) => {
    const identity = identityOf(req);
    if (identity === null) {
      respondError(res, new DshError('UNAUTHORIZED', 'auth', '缺少验签身份（req.auth）', { retryable: false }));
      return;
    }
    const body = (req.body ?? {}) as { input?: unknown; runId?: unknown; sessionId?: unknown; problemId?: unknown };
    if (typeof body.input !== 'string' || body.input.trim().length === 0) {
      respondError(res, new DshError('VALIDATION_ERROR', 'request', 'input 必须是非空字符串', { retryable: false }));
      return;
    }
    if (body.input.length > MAX_INPUT_CHARS) {
      respondError(res, new DshError('VALIDATION_ERROR', 'request', `input 超过 ${MAX_INPUT_CHARS} 字符上限`, { retryable: false }));
      return;
    }
    let problemId: string | undefined;
    if (body.problemId !== undefined) {
      if (typeof body.problemId !== 'string' || body.problemId.length === 0) {
        respondError(res, new DshError('VALIDATION_ERROR', 'request', 'problemId 必须是非空字符串', { retryable: false }));
        return;
      }
      problemId = body.problemId;
    }
    let runId: string;
    let sessionId: string | undefined;
    try {
      runId = optionalId(body.runId, ID_PATTERN, 'runId') ?? `run_${randomUUID().replaceAll('-', '')}`;
      sessionId = optionalId(body.sessionId, SESSION_PATTERN, 'sessionId');
    } catch (err: unknown) {
      respondError(res, err);
      return;
    }

    const existing = runtime.getRun(runId);
    if (existing !== undefined && existing.enterpriseId !== identity.enterpriseId) {
      respondError(res, new DshError('FORGED_IDENTITY', 'auth', 'runId 已被其他企业使用', { retryable: false }));
      return;
    }
    let mcpServer: ReadonlyMcpServer | null = null;
    if (enableMcp && existing === undefined) {
      try {
        mcpServer = await ensureMcp();
        attachMcpProvider(mcpServer);
        const token = mcpServer.tokens.issue({
          enterpriseId: identity.enterpriseId,
          userId: identity.userId,
          scope: identity.scope,
          runId,
          // #1486 e：显式问题根进 token 上下文（工具侧优先使用）；缺省不写该键（既有形态不变）
          ...(problemId === undefined ? {} : { problemId }),
        });
        runTokens.set(runId, token);
      } catch (err: unknown) {
        respondError(res, toDshError(err, { code: 'TOOL_ERROR', phase: 'tool' }));
        return;
      }
    }

    try {
      const record = await runtime.run({
        runId,
        enterpriseId: identity.enterpriseId,
        userId: identity.userId,
        scope: identity.scope,
        input: body.input,
        sessionId,
        // #1486 e：结构化入参（**不拼进 input**）⇒ run.started 事件可证、token 上下文可读
        problemId,
      });
      // 一次性 token：run 终态即撤销（含「run 已结束才订阅」的快照路径）。
      // T4：`run.completed` 时把本轮产出落成 Proposal **草案**（runId 幂等；不写经营决定）。
      const finalize = (): void => {
        const token = runTokens.get(runId);
        if (token !== undefined) {
          mcpServer?.tokens.revoke(token);
          runTokens.delete(runId);
        }
        if (deps.proposalManager === undefined || runDrafts.has(runId)) return;
        const text = record.stream.snapshot()
          .filter(event => event.type === 'text.delta')
          .map(event => (typeof event.data.text === 'string' ? event.data.text : ''))
          .join('')
          .slice(0, 500);
        try {
          const draft = persistProposalDraft(deps.proposalManager, {
            runId,
            enterpriseId: identity.enterpriseId,
            userId: identity.userId,
            title: `Agent proposal draft (run ${runId})`,
            description: text,
          });
          runDrafts.set(runId, draft);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const code = err instanceof DshError ? err.code : 'PERSISTENCE_ERROR';
          runDrafts.set(runId, { ok: false, code, message });
        }
      };
      record.stream.subscribe(event => { if (isTerminalEvent(event)) finalize(); });
      if (record.stream.terminal !== null) finalize();

      res.status(existing === undefined ? 202 : 200).json({
        ok: true,
        runId: record.runId,
        sessionId: record.sessionId,
        status: record.status,
        // #1502：两个正交状态位（运行中：running／null；终态：一次性判定结果）
        transportStatus: record.transportStatus,
        outcomeStatus: record.outcomeStatus,
        eventCount: record.stream.size,
        replayed: existing !== undefined,
        mcp: mcpServer === null ? null : { registered: true, tool: 'synova_context_get' },
      });
    } catch (err: unknown) {
      respondError(res, err);
    }
  });

  router.get('/api/dsh/runs/:runId/events', (req: Request, res: Response) => {
    const identity = identityOf(req);
    if (identity === null) {
      respondError(res, new DshError('UNAUTHORIZED', 'auth', '缺少验签身份（req.auth）', { retryable: false }));
      return;
    }
    let record: RunRecord;
    try {
      record = visibleRun(runtime, pathParam(req, 'runId'), identity);
    } catch (err: unknown) {
      respondError(res, err);
      return;
    }
    const lastEventIdRaw = req.headers['last-event-id'];
    const lastEventId = typeof lastEventIdRaw === 'string' ? Number(lastEventIdRaw) : 0;
    const afterSeq = Number.isFinite(lastEventId) ? lastEventId : 0;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    const heartbeat = setInterval(() => {
      if (!closed) res.write(formatSseHeartbeat());
    }, heartbeatMs);
    heartbeat.unref?.();

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (unsubscribe !== null) unsubscribe();
    };
    req.on('close', cleanup);
    res.on('error', cleanup);

    const writeEvent = (event: AgentEvent): void => {
      if (closed || event.seq <= afterSeq) return;
      res.write(formatSseFrame(event));
      if (isTerminalEvent(event)) finish();
    };
    const finish = (): void => {
      if (closed) return;
      cleanup();
      res.end();
    };

    const snapshot = record.stream.snapshot();
    for (const event of snapshot) writeEvent(event);
    if (record.stream.terminal !== null) {
      finish();
      return;
    }
    unsubscribe = record.stream.subscribe(writeEvent);
  });

  router.get('/api/dsh/runs/:runId', (req: Request, res: Response) => {
    const identity = identityOf(req);
    if (identity === null) {
      respondError(res, new DshError('UNAUTHORIZED', 'auth', '缺少验签身份（req.auth）', { retryable: false }));
      return;
    }
    try {
      const record = visibleRun(runtime, pathParam(req, 'runId'), identity);
      const terminal = record.stream.terminal;
      res.json({
        ok: true,
        runId: record.runId,
        status: record.status,
        sessionId: record.sessionId,
        // #1502：查询接口一并返回两字段（与终态事件载荷同源，不重算）
        transportStatus: record.transportStatus,
        outcomeStatus: record.outcomeStatus,
        eventCount: record.stream.size,
        terminal: terminal === null ? null : { type: terminal.type, seq: terminal.seq, data: terminal.data },
        stats: record.stats,
        proposalDraft: runDrafts.get(record.runId) ?? null,
      });
    } catch (err: unknown) {
      respondError(res, err);
    }
  });

  router.post('/api/dsh/runs/:runId/cancel', (req: Request, res: Response) => {
    const identity = identityOf(req);
    if (identity === null) {
      respondError(res, new DshError('UNAUTHORIZED', 'auth', '缺少验签身份（req.auth）', { retryable: false }));
      return;
    }
    let record: RunRecord;
    try {
      record = visibleRun(runtime, pathParam(req, 'runId'), identity);
    } catch (err: unknown) {
      respondError(res, err);
      return;
    }
    runtime.cancel(record.runId).then(cancelled => {
      res.json({ ok: true, runId: cancelled.runId, status: cancelled.status, cancelRequested: cancelled.cancelRequested });
    }).catch((err: unknown) => {
      respondError(res, err);
    });
  });

  router.post('/api/dsh/sessions/:sessionId/close', (req: Request, res: Response) => {
    const identity = identityOf(req);
    if (identity === null) {
      respondError(res, new DshError('UNAUTHORIZED', 'auth', '缺少验签身份（req.auth）', { retryable: false }));
      return;
    }
    const sessionId = pathParam(req, 'sessionId');
    const owned = runtime.listRuns().some(record => record.sessionId === sessionId && record.enterpriseId === identity.enterpriseId);
    if (!owned) {
      respondError(res, new DshError('SESSION_NOT_FOUND', 'session', `未知会话: ${sessionId}`, { retryable: false }));
      return;
    }
    runtime.closeSession(sessionId).then(() => {
      res.json({ ok: true, sessionId, closed: true });
    }).catch((err: unknown) => {
      respondError(res, err);
    });
  });

  return router;
}
