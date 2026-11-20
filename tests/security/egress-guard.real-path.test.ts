/**
 * tests/security/egress-guard.real-path.test.ts — I-3 真实 provider 入口 + fetch spy
 *
 * 判据来源：Gitea #1441 评论 13694（DEV DOC v3 §2/§5）＋ CTO 裁定 R2/R3（PR #1444 评论 13928）。
 * 本文件从 `createProvider`（真实 provider 入口）出发，走 base.ts 的真实出站体形状
 * （`body.messages[*].content`、`body.tools` 参数树），用 fetch spy 断言：
 *   - 正例恰好 1 次请求、body 内容一致；
 *   - 反例 0 次请求（硬禁止先于 fetch 生效）；
 *   - R2：chat 抛 `EgressGuardError`（原始 `EGRESS_*` code），stream 的 `onError`
 *     收到同一类型与 code；两者都不是 `ClassifiedLlmError(INTERNAL)`；上述路径 fetch 0 次；
 *   - R3：真实 3xx 不被跟随（第二端点零请求，断言两端的请求数与目标地址）；
 *   - 非 2xx 错误消息不回显响应体；拦截日志不含被拦值。
 *
 * 铁律 48：每个用例至少 1 条 expect；禁 skip。测试只用本机合成数据，不连外部网络。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const { logMock } = vi.hoisted(() => ({
  logMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('@synova/logger', () => ({
  logger: logMock,
  createLogger: vi.fn(() => logMock),
}));

import { createProvider } from '../../src/providers';
import { EgressGuardError } from '../../src/providers/egress-guard';
import type { EgressCode } from '../../src/providers/egress-guard';
import { ClassifiedLlmError, ErrorCode } from '../../src/errors/types';
import type { ChatOptions, LLMMessage } from '../../src/providers/types';

const BASE_URL = 'http://127.0.0.1:19001/v1';
const MODEL = 'fake-model';

const BUSINESS_MESSAGES: LLMMessage[] = [
  { role: 'system', content: '你是企业诊断专家，只基于事实回答。' },
  { role: 'user', content: '本月营收 1200 万元，环比增长 8%，毛利率 42%。增长瓶颈在哪？' },
];

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** 成功上游 stub：记录每次 fetch 的 url/init，返回合法 chat.completion */
function stubFetchSuccess(): { calls: FetchCall[]; spy: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '已收到，按指标结构继续诊断。' } }],
      model: MODEL,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', spy);
  return { calls, spy };
}

/** 真实 provider 入口（默认 DeepSeek 适配器；`openai` 用于无 beforeSend 的逐字断言） */
function makeProvider(type: 'deepseek' | 'openai' = 'deepseek') {
  return createProvider(type, { apiKey: 'test-key', baseUrl: BASE_URL, model: MODEL });
}

/** 把任意 JSON 参数树塞进 tools schema（真实出站体的一部分；base.ts body.tools） */
function toolsWith(parameters: Record<string, unknown>): ChatOptions['tools'] {
  return [{
    type: 'function',
    function: { name: 'probe', description: '合成探测工具', parameters },
  }];
}

function errorCodeOf(err: unknown): string | undefined {
  return err instanceof EgressGuardError ? err.code : undefined;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err;
  }
}

beforeEach(() => {
  logMock.warn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══ 正例（DEV DOC v3 §5.1–§5.4, §5.12）═══

describe('真实 provider 链 — 正例必须放行（防全拦／防误伤）', () => {
  it('Given 合法中文业务内容, When chat, Then fetch 恰 1 次 + body 内容一致', async () => {
    const provider = makeProvider('openai');
    const { calls, spy } = stubFetchSuccess();

    const result = await provider.chat(BUSINESS_MESSAGES);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE_URL}/chat/completions`);
    expect(calls[0].init.redirect).toBe('error');
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body['model']).toBe(MODEL);
    expect(body['messages']).toEqual(BUSINESS_MESSAGES);
    expect(result.content).toBe('已收到，按指标结构继续诊断。');
  });

  it('Given {token:128000}（数字配额）, When chat, Then fetch 恰 1 次', async () => {
    const { spy } = stubFetchSuccess();
    await makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ token: 128000 }) });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Given {token:0} 与 {token:true}, When chat, Then 各 1 次', async () => {
    const zero = stubFetchSuccess();
    await makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ token: 0 }) });
    expect(zero.spy).toHaveBeenCalledTimes(1);

    const truthy = stubFetchSuccess();
    await makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ token: true }) });
    expect(truthy.spy).toHaveBeenCalledTimes(1);
  });

  it('Given {token_count:32768}（完整键名不匹配）, When chat, Then fetch 恰 1 次', async () => {
    const { spy } = stubFetchSuccess();
    await makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ token_count: 32768 }) });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Given 19 位订单号 orderId, When chat, Then 不误伤（fetch 恰 1 次）', async () => {
    const { spy } = stubFetchSuccess();
    await makeProvider().chat(BUSINESS_MESSAGES, {
      tools: toolsWith({ orderId: '6222021234567890123' }),
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ═══ 反例：零请求（DEV DOC v3 §5.5–§5.11）═══

describe('真实 provider 链 — 敏感键命中 ⇒ 零请求', () => {
  for (const key of ['apiKey', 'password', 'secret', 'private_key']) {
    it(`Given {"${key}":"x"}（嵌套在 tools 参数树）, When chat, Then EGRESS_SECRET + fetch 0 次`, async () => {
      const { spy } = stubFetchSuccess();
      const err = await captureRejection(
        makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ [key]: 'x' }) }),
      );
      expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
      expect(spy).toHaveBeenCalledTimes(0);
    });
  }

  it('Given 嵌套 {"meta":{"password":"x"}}, When chat, Then fetch 0 次', async () => {
    const { spy } = stubFetchSuccess();
    const err = await captureRejection(
      makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ meta: { password: 'x' } }) }),
    );
    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('Given messages[0].content 含 sk-…, When chat, Then fetch 0 次（真实 body 形状）', async () => {
    const { spy } = stubFetchSuccess();
    const messages: LLMMessage[] = [
      { role: 'user', content: '请检查 sk-abcdefghijklmnop123 是否可用' },
    ];
    const err = await captureRejection(makeProvider().chat(messages));
    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('Given messages[0].content 含 AKIA…, When chat, Then fetch 0 次', async () => {
    const { spy } = stubFetchSuccess();
    const err = await captureRejection(
      makeProvider().chat([{ role: 'user', content: 'AKIAIOSFODNN7EXAMPLE' }]),
    );
    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('Given messages[0].content 含 PEM 私钥头, When chat, Then fetch 0 次', async () => {
    const { spy } = stubFetchSuccess();
    const err = await captureRejection(
      makeProvider().chat([{ role: 'user', content: '-----BEGIN RSA PRIVATE KEY-----' }]),
    );
    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('Given tool 参数里 token 为字符串, When chat, Then EGRESS_SECRET + fetch 0 次', async () => {
    const { spy } = stubFetchSuccess();
    const err = await captureRejection(
      makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ token: 'sk-abcdefghijklmnop123' }) }),
    );
    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('Given card_number 键与 18 位身份证值, When chat, Then EGRESS_HIGH_SENSITIVE + fetch 0 次', async () => {
    const card = stubFetchSuccess();
    const err = await captureRejection(
      makeProvider().chat(BUSINESS_MESSAGES, { tools: toolsWith({ card_number: '6222021234567890123' }) }),
    );
    expect(errorCodeOf(err)).toBe('EGRESS_HIGH_SENSITIVE');
    expect(card.spy).toHaveBeenCalledTimes(0);

    const idValue = stubFetchSuccess();
    const err2 = await captureRejection(
      makeProvider().chat([{ role: 'user', content: '110101199003070011' }]),
    );
    expect(errorCodeOf(err2)).toBe('EGRESS_HIGH_SENSITIVE');
    expect(idValue.spy).toHaveBeenCalledTimes(0);
  });
});

// ═══ R2（CTO 裁定，PR #1444 评论 13928）：EgressGuardError 原样透传 ═══

const EGRESS_CODES: readonly EgressCode[] = ['EGRESS_SECRET', 'EGRESS_HIGH_SENSITIVE'];

/** R2 共同判据：原始 EgressGuardError ＋ 原始 code ＋ 不是 ClassifiedLlmError(INTERNAL) */
function assertRawEgressError(err: unknown, expected: EgressCode): void {
  expect(err).toBeInstanceOf(EgressGuardError);
  expect(err).not.toBeInstanceOf(ClassifiedLlmError);
  const guardErr = err as EgressGuardError;
  expect(guardErr.code).toBe(expected);
  expect(guardErr.code).not.toBe(ErrorCode.INTERNAL);
  expect(EGRESS_CODES).toContain(guardErr.code);
}

describe('真实 provider 链 — R2 EgressGuardError 原样透传（chat 与 stream 同型）', () => {
  const CASES: Array<{ name: string; opts: ChatOptions; code: EgressCode }> = [
    {
      name: 'EGRESS_SECRET（敏感键 password）',
      opts: { tools: toolsWith({ password: 'x' }) },
      code: 'EGRESS_SECRET',
    },
    {
      name: 'EGRESS_HIGH_SENSITIVE（高敏键 card_number）',
      opts: { tools: toolsWith({ card_number: '6222021234567890123' }) },
      code: 'EGRESS_HIGH_SENSITIVE',
    },
  ];

  for (const testCase of CASES) {
    it(`Given ${testCase.name}, When chat, Then EgressGuardError 原始 code ＋ 非 INTERNAL ＋ fetch 0 次`, async () => {
      const { spy } = stubFetchSuccess();
      const err = await captureRejection(makeProvider('deepseek').chat(BUSINESS_MESSAGES, testCase.opts));
      assertRawEgressError(err, testCase.code);
      expect(spy).toHaveBeenCalledTimes(0);
    });

    it(`Given ${testCase.name}, When stream, Then onError 收到同一类型与 code ＋ 非 INTERNAL ＋ fetch 0 次`, async () => {
      const { spy } = stubFetchSuccess();
      const onError = vi.fn();
      await makeProvider('deepseek').stream(
        BUSINESS_MESSAGES,
        { onToken: vi.fn(), onError },
        testCase.opts,
      );
      expect(onError).toHaveBeenCalledTimes(1);
      const received: unknown = onError.mock.calls[0]?.[0];
      assertRawEgressError(received, testCase.code);
      expect(spy).toHaveBeenCalledTimes(0);
    });
  }

  it('Given 同一敏感请求, When 分别 chat 与 stream, Then 错误类型与 code 完全一致（同一 head）', async () => {
    const opts: ChatOptions = { tools: toolsWith({ secret: 'x' }) };

    const chatSpy = stubFetchSuccess();
    const chatErr = await captureRejection(makeProvider('deepseek').chat(BUSINESS_MESSAGES, opts));
    expect(chatSpy.spy).toHaveBeenCalledTimes(0);

    const streamSpy = stubFetchSuccess();
    const onError = vi.fn();
    await makeProvider('deepseek').stream(BUSINESS_MESSAGES, { onToken: vi.fn(), onError }, opts);
    expect(streamSpy.spy).toHaveBeenCalledTimes(0);

    const streamErr: unknown = onError.mock.calls[0]?.[0];
    assertRawEgressError(chatErr, 'EGRESS_SECRET');
    assertRawEgressError(streamErr, 'EGRESS_SECRET');
    expect(streamErr instanceof EgressGuardError ? streamErr.constructor : null)
      .toBe(chatErr instanceof EgressGuardError ? chatErr.constructor : null);
    expect((streamErr as EgressGuardError).code).toBe((chatErr as EgressGuardError).code);
  });
});

// ═══ R3（CTO 裁定，PR #1444 评论 13928）：真实 3xx 不跟随重定向 ═══

/** 关闭 HTTP server（含 keep-alive 连接），避免 open handle 拖住测试 */
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

interface RedirectPair {
  firstHits: string[];
  secondHits: string[];
  redirectTarget: string;
  firstPort: number;
  secondPort: number;
  close(): Promise<void>;
}

/** 起两个端点：A 返回 3xx 指向 B（记录两端命中路径，断言请求数/目标地址） */
async function startRedirectPair(status: 302 | 307): Promise<RedirectPair> {
  const secondHits: string[] = [];
  const second = createServer((req, res) => {
    secondHits.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '第二端点不应被访问' } }] }));
  });
  await new Promise<void>((resolve) => { second.listen(0, '127.0.0.1', resolve); });
  const secondPort = (second.address() as AddressInfo).port;
  const redirectTarget = `http://127.0.0.1:${secondPort}/captured`;

  const firstHits: string[] = [];
  const first = createServer((req, res) => {
    firstHits.push(req.url ?? '');
    res.writeHead(status, { Location: redirectTarget });
    res.end();
  });
  await new Promise<void>((resolve) => { first.listen(0, '127.0.0.1', resolve); });
  const firstPort = (first.address() as AddressInfo).port;

  return {
    firstHits,
    secondHits,
    redirectTarget,
    firstPort,
    secondPort,
    async close() {
      await closeServer(first);
      await closeServer(second);
    },
  };
}

describe('真实 provider 链 — R3 真实 3xx 不跟随（第二端点零请求）', () => {
  for (const status of [302, 307] as const) {
    it(`Given 上游 ${status} 指向第二端点, When chat, Then A 恰 1 次 / B 0 次 / 目标地址未被请求`, async () => {
      const pair = await startRedirectPair(status);
      try {
        const provider = createProvider('deepseek', {
          apiKey: 'test-key',
          baseUrl: `http://127.0.0.1:${pair.firstPort}/v1`,
          model: MODEL,
        });

        const err = await captureRejection(provider.chat(BUSINESS_MESSAGES));

        expect(pair.firstHits).toEqual(['/v1/chat/completions']);
        expect(pair.secondHits).toEqual([]);
        expect(err).toBeInstanceOf(Error);
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain('第二端点不应被访问');
        expect(message).not.toContain(String(pair.secondPort));
        expect(pair.redirectTarget).toContain(`:${pair.secondPort}/captured`);
      } finally {
        await pair.close();
      }
    });
  }
});

// ═══ 错误脱敏 + 日志（DEV DOC v3 §5.14–§5.15）═══

describe('真实 provider 链 — 错误脱敏与日志值禁区', () => {
  it('Given 非 2xx 响应体含敏感串, When chat, Then 抛出消息不含响应体/敏感串', async () => {
    const leaked = 'sk-abcdefghijklmnop123';
    const spy = vi.fn(async (): Promise<Response> => new Response(
      `upstream echo ${leaked} and internal detail`,
      { status: 500, headers: { 'Content-Type': 'text/plain' } },
    ));
    vi.stubGlobal('fetch', spy);

    const err = await captureRejection(makeProvider().chat(BUSINESS_MESSAGES));

    expect(err).toBeInstanceOf(Error);
    expect(spy).toHaveBeenCalledTimes(1);
    const message = err instanceof Error ? err.message : '';
    expect(message).toContain('500');
    expect(message).not.toContain(leaked);
    expect(message).not.toContain('upstream echo');
    expect(message).not.toContain('internal detail');
  });

  it('Given 拦截命中, When chat, Then log.warn 仅 code+字段路径，不含被拦值', async () => {
    const { spy } = stubFetchSuccess();
    const secretValue = 'S3cr3t-Value-Must-Not-Be-Logged';

    const err = await captureRejection(
      makeProvider().chat(BUSINESS_MESSAGES, {
        tools: toolsWith({ password: secretValue }),
      }),
    );

    expect(errorCodeOf(err)).toBe('EGRESS_SECRET');
    expect(spy).toHaveBeenCalledTimes(0);
    const guardCalls = logMock.warn.mock.calls.filter((call) => {
      const fields = call[0];
      return typeof fields === 'object' && fields !== null && 'code' in fields;
    });
    expect(guardCalls).toHaveLength(1);
    expect(guardCalls[0][0]).toEqual({
      code: 'EGRESS_SECRET',
      field: 'tools[0].function.parameters.password',
    });
    expect(JSON.stringify(guardCalls[0])).not.toContain(secretValue);
  });
});
