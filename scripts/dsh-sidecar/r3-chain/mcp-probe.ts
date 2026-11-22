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
 * @input  env SYNOVA_DATA_DIR | SYNTH_ORG_ID | SYNTH_PROBLEM_ID | SYNTH_MISSING_PROBLEM_ID
 *         argv[2] = output json path
 * @output file: { ok, url, tokenIssued, steps[], assertions{}, passed }
 * @error  any assertion failure -> exit 1 with the same json written (no fake pass)
 */
import { writeFileSync } from 'node:fs';
import { initEngineContext } from '../../../src/init/engine-context';
import { startReadonlyMcpServer } from '../../../src/mcp/http';

const orgId = process.env.SYNTH_ORG_ID;
const problemId = process.env.SYNTH_PROBLEM_ID;
const missingProblemId = process.env.SYNTH_MISSING_PROBLEM_ID ?? 'synth-problem-1455-does-not-exist';
const outPath = process.argv[2];
if (orgId === undefined || problemId === undefined || outPath === undefined) {
  throw new Error('mcp-probe: SYNTH_ORG_ID / SYNTH_PROBLEM_ID / argv[2] output path are required');
}

initEngineContext();
const mcp = await startReadonlyMcpServer();
const token = mcp.tokens.issue({ enterpriseId: orgId, userId: 'probe-user-1455', scope: 'admin', runId: 'probe-1455' });

interface StepResult {
  name: string;
  method: string;
  httpStatus: number;
  contentType: string | null;
  bodyText: string;
  bodyJson: unknown;
}

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

const toolsListStep = steps[2];
const toolsList = (toolsListStep.bodyJson as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }> } } | null)?.result?.tools ?? [];

const positiveStep = steps[3];
const positiveContent = (positiveStep.bodyJson as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } } | null)?.result;
const positiveText = positiveContent?.content?.[0]?.text ?? '';
let positivePayload: unknown = null;
try { positivePayload = JSON.parse(positiveText); } catch { positivePayload = null; }

const negativeStep = steps[4];
const negativeContent = (negativeStep.bodyJson as { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } } | null)?.result;
const negativeText = negativeContent?.content?.[0]?.text ?? '';
let negativePayload: unknown = null;
try { negativePayload = JSON.parse(negativeText); } catch { negativePayload = null; }

const assertions = {
  initializeHttp200: steps[0].httpStatus === 200,
  initializedAccepted: steps[1].httpStatus === 202 || steps[1].httpStatus === 200,
  toolsListHttp200: toolsListStep.httpStatus === 200,
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

const result = {
  ok: Object.values(assertions).every(Boolean),
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
  passed: Object.values(assertions).every(Boolean),
};

writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
// token is never written anywhere; the server is closed before exit
await mcp.close();
process.stdout.write(`${JSON.stringify({ ok: result.ok, assertions, toolNames: result.toolNames, positiveCount: (positivePayload as { count?: number } | null)?.count ?? null, negativeCode: (negativePayload as { code?: string } | null)?.code ?? null }, null, 2)}\n`);
if (!result.ok) process.exit(1);
