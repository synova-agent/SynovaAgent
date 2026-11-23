/**
 * mcp-probe.ts — R3 chain evidence script (Issue #1455, T2 + T5 negative case).
 *
 * Starts the PRODUCT loopback read-only MCP server (`startReadonlyMcpServer`), issues a
 * one-shot token through the PRODUCT store (`tokens.issue`), and drives the real MCP
 * Streamable-HTTP surface over 127.0.0.1:
 *   initialize -> notifications/initialized -> tools/list -> tools/call x2
 *
 * Two tool calls:
 *   - positive: the seeded synthetic problemId  => real ② payload
 *   - negative: a problemId that does not exist => structured DOMAIN_EMPTY (isError)
 * No model round trip is consumed (this is direct MCP, per DEV DOC §6 T2 note).
 *
 * 🔴 #1458 改造：判定逻辑走 export（`buildProbeAssertions` 纯函数 / `summariseProbe`），
 *    本文件只在**被直接执行时**才起服务跑 CLI。理由同 install-profile.ts
 *    （`vitest --changed` 需要真实 import 边；禁止改名/挪目录规避分类）。
 *
 * @input  env SYNOVA_DATA_DIR | SYNTH_ORG_ID | SYNTH_PROBLEM_ID | SYNTH_MISSING_PROBLEM_ID
 *         argv[2] = output json path
 * @output file: { ok, url, tokenIssued, steps[], assertions{}, passed }
 * @error  any assertion failure -> exit 1 with the same json written (no fake pass)
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { initEngineContext } from '../../../src/init/engine-context';
import { startReadonlyMcpServer } from '../../../src/mcp/http';

export interface StepResult {
  name: string;
  method: string;
  httpStatus: number;
  contentType: string | null;
  bodyText: string;
  bodyJson: unknown;
}

/** T2 的 11 条断言（键名与 T2 证据件逐字一致）。 */
export interface ProbeAssertions {
  initializeHttp200: boolean;
  initializedAccepted: boolean;
  toolsListHttp200: boolean;
  toolsListAdvertisesExactlyOneTool: boolean;
  toolsListAdvertisesSynovaContextGet: boolean;
  toolSchemaOnlyProblemId: boolean;
  positiveIsNotError: boolean;
  positiveSyntheticFalse: boolean;
  positiveCountAtLeastTwo: boolean;
  negativeIsError: boolean;
  negativeCodeDomainEmpty: boolean;
}

export interface McpProbeResult {
  ok: boolean;
  generatedAt: string;
  url: string;
  enterpriseId: string;
  problemId: string;
  missingProblemId: string;
  tokenIssued: boolean;
  tokenLengthNotRecorded: true;
  toolCount: number;
  toolNames: string[];
  toolInputSchema: unknown;
  positivePayload: unknown;
  negativePayload: unknown;
  assertions: ProbeAssertions;
  steps: StepResult[];
  passed: boolean;
}

export interface McpProbeOptions {
  orgId: string;
  problemId: string;
  missingProblemId?: string;
  /** 证据件输出路径；缺省不落盘（纯函数式调用场景）。 */
  outPath?: string;
}

/**
 * 从 5 步真实响应算 11 条断言（**纯函数**，无 I/O —— 便于用既有证据件的 steps 复算）。
 * @input steps 依次为 initialize / notifications\/initialized / tools\/list / tools\/call(positive) / tools\/call(negative)
 * @output ProbeAssertions
 * @error steps 缺项时按“断言为 false”处理（不抛），由 ok/passed 汇总暴露
 */
export function buildProbeAssertions(steps: StepResult[]): ProbeAssertions {
  const toolsListStep = steps[2];
  const toolsList = (toolsListStep?.bodyJson as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }> } } | null)?.result?.tools ?? [];

  const positiveStep = steps[3];
  const positiveContent = (positiveStep?.bodyJson as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } } | null)?.result;
  const positiveText = positiveContent?.content?.[0]?.text ?? '';
  let positivePayload: unknown = null;
  try { positivePayload = JSON.parse(positiveText); } catch { positivePayload = null; }

  const negativeStep = steps[4];
  const negativeContent = (negativeStep?.bodyJson as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } } | null)?.result;
  const negativeText = negativeContent?.content?.[0]?.text ?? '';
  let negativePayload: unknown = null;
  try { negativePayload = JSON.parse(negativeText); } catch { negativePayload = null; }

  return {
    initializeHttp200: steps[0]?.httpStatus === 200,
    initializedAccepted: steps[1]?.httpStatus === 202 || steps[1]?.httpStatus === 200,
    toolsListHttp200: toolsListStep?.httpStatus === 200,
    toolsListAdvertisesExactlyOneTool: toolsList.length === 1,
    toolsListAdvertisesSynovaContextGet: toolsList.length > 0 && toolsList[0].name === 'synova_context_get',
    toolSchemaOnlyProblemId: JSON.stringify(toolsList[0]?.inputSchema?.properties ?? {}) === JSON.stringify({ problemId: (toolsList[0]?.inputSchema?.properties ?? {}).problemId })
      && Object.keys(toolsList[0]?.inputSchema?.properties ?? {}).join(',') === 'problemId',
    positiveIsNotError: positiveContent?.isError !== true,
    positiveSyntheticFalse: (positivePayload as { synthetic?: unknown } | null)?.synthetic === false,
    positiveCountAtLeastTwo: typeof (positivePayload as { count?: unknown } | null)?.count === 'number'
      && ((positivePayload as { count: number }).count >= 2),
    negativeIsError: negativeContent?.isError === true,
    negativeCodeDomainEmpty: (negativePayload as { code?: unknown } | null)?.code === 'DOMAIN_EMPTY',
  };
}

/** stdout 摘要（键序与 T2 证据件一致）。 */
export function summariseProbe(result: McpProbeResult): {
  ok: boolean;
  assertions: ProbeAssertions;
  toolNames: string[];
  positiveCount: number | null;
  negativeCode: string | null;
} {
  return {
    ok: result.ok,
    assertions: result.assertions,
    toolNames: result.toolNames,
    positiveCount: (result.positivePayload as { count?: number } | null)?.count ?? null,
    negativeCode: (result.negativePayload as { code?: string } | null)?.code ?? null,
  };
}

/**
 * 起产品回环只读 MCP 服务、跑完 5 步、算断言并（可选）落证据件。
 * @input options.orgId / problemId 必填；missingProblemId 缺省为 #1455 的负例 id
 * @output McpProbeResult（服务在返回前已 close）
 * @error 网络/服务失败原样抛（不伪造 ok）；断言失败不抛，由 ok=false 表达
 */
export async function runMcpProbe(options: McpProbeOptions): Promise<McpProbeResult> {
  const { orgId, problemId } = options;
  const missingProblemId = options.missingProblemId ?? 'synth-problem-1455-does-not-exist';

  initEngineContext();
  const mcp = await startReadonlyMcpServer();
  const token = mcp.tokens.issue({ enterpriseId: orgId, userId: 'probe-user-1455', scope: 'admin', runId: 'probe-1455' });

  async function post(method: string, payload: Record<string, unknown>): Promise<StepResult> {
    const response = await fetch(mcp.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const bodyText = await response.text();
    let bodyJson: unknown = null;
    if (bodyText.length > 0) {
      try { bodyJson = JSON.parse(bodyText); } catch { bodyJson = { _unparsed: bodyText.slice(0, 400) }; }
    }
    return {
      name: method,
      method,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      bodyText: bodyText.slice(0, 8000),
      bodyJson,
    };
  }

  const steps: StepResult[] = [];
  steps.push(await post('initialize', {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'r3-chain-probe', version: '1.0.0' } },
  }));
  steps.push(await post('notifications/initialized', { jsonrpc: '2.0', method: 'notifications/initialized' }));
  steps.push(await post('tools/list', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  steps.push(await post('tools/call (positive)', {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'synova_context_get', arguments: { problemId } },
  }));
  steps.push(await post('tools/call (negative)', {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'synova_context_get', arguments: { problemId: missingProblemId } },
  }));

  const toolsList = (steps[2].bodyJson as { result?: { tools?: Array<{ name: string; inputSchema?: unknown }> } } | null)?.result?.tools ?? [];
  const positivePayload = (() => {
    const text = (steps[3].bodyJson as { result?: { content?: Array<{ text?: string }> } } | null)?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return null; }
  })();
  const negativePayload = (() => {
    const text = (steps[4].bodyJson as { result?: { content?: Array<{ text?: string }> } } | null)?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return null; }
  })();

  const assertions = buildProbeAssertions(steps);
  const ok = Object.values(assertions).every(Boolean);

  const result: McpProbeResult = {
    ok,
    generatedAt: new Date().toISOString(),
    url: mcp.url,
    enterpriseId: orgId,
    problemId,
    missingProblemId,
    tokenIssued: token.length > 0,
    tokenLengthNotRecorded: true,
    toolCount: toolsList.length,
    toolNames: toolsList.map(tool => tool.name),
    toolInputSchema: toolsList[0]?.inputSchema ?? null,
    positivePayload,
    negativePayload,
    assertions,
    steps,
    passed: ok,
  };

  if (options.outPath !== undefined) {
    writeFileSync(options.outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  // token is never written anywhere; the server is closed before returning
  await mcp.close();
  return result;
}

/** 本模块是否被当作 CLI 直接执行（被 import 时不得起服务）。 */
function isInvokedDirectly(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isInvokedDirectly()) {
  const orgId = process.env.SYNTH_ORG_ID;
  const problemId = process.env.SYNTH_PROBLEM_ID;
  const missingProblemId = process.env.SYNTH_MISSING_PROBLEM_ID ?? 'synth-problem-1455-does-not-exist';
  const outPath = process.argv[2];
  if (orgId === undefined || problemId === undefined || outPath === undefined) {
    throw new Error('mcp-probe: SYNTH_ORG_ID / SYNTH_PROBLEM_ID / argv[2] output path are required');
  }
  const result = await runMcpProbe({ orgId, problemId, missingProblemId, outPath });
  process.stdout.write(`${JSON.stringify(summariseProbe(result), null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
