/**
 * tests/security/egress-guard.real-path.test.ts — I-3 真实 provider 入口 + fetch spy
 *
 * 判据来源：Gitea #1441 评论 13694（DEV DOC v3 §2/§5）。本文件从 `createProvider`（真实
 * provider 入口）出发，走 base.ts 的真实出站体形状（`body.messages[*].content`、`body.tools`
 * 参数树），用 fetch spy 断言：
 *   - 正例恰好 1 次请求、body 内容一致；
 *   - 反例 0 次请求（硬禁止先于 fetch 生效）；
 *   - `redirect:'error'` 真实生效（302 不被跟随，目标端点零请求）；
 *   - 非 2xx 错误消息不回显响应体；拦截日志不含被拦值。
 *
 * 铁律 48：每个用例至少 1 条 expect；禁 skip。测试只用本机合成数据，不连外部网络。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
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
import { guardEgress, EgressGuardError } from '../../src/providers/egress-guard';
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

/** 把任意 JSON 参数树塞进 tools schema（真实出站体的一部分；base.ts:167 body.tools） */
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

// ═══ 端点（DEV DOC v3 §5.13）═══

describe('真实 provider 链 — 端点守卫与 3xx 不跟随', () => {
  it('Given baseUrl !== allowedBaseUrl, When guardEgress, Then EGRESS_ENDPOINT', () => {
    const verdict = guardEgress({
      body: { messages: BUSINESS_MESSAGES },
      baseUrl: 'https://evil.example.com/v1',
      allowedBaseUrl: BASE_URL,
    });
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_ENDPOINT' });
  });

  it('Given 上游返回 302, When chat, Then redirect:\'error\' 不跟随（目标端点点零请求）', async () => {
    let firstHits = 0;
    let followedHits = 0;
    const server = createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        firstHits += 1;
        res.writeHead(302, { Location: '/followed' });
        res.end();
        return;
      }
      followedHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '不该到这里' } }] }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address() as AddressInfo;
    const provider = createProvider('deepseek', {
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: MODEL,
    });

    const err = await captureRejection(provider.chat(BUSINESS_MESSAGES));
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });

    expect(err).toBeInstanceOf(Error);
    expect(firstHits).toBe(1);
    expect(followedHits).toBe(0);
  });
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
