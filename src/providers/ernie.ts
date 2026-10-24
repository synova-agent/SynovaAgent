/**
 * providers/ernie.ts — 文心一言 (ERNIE) Provider 适配器
 *
 * 文心一言 API 非 OpenAI 兼容格式:
 *   - 使用 OAuth2 access_token 而非 Bearer token
 *   - 需要 API Key + Secret Key 换取 token
 *   - 请求/响应格式与 OpenAI 不同
 *
 * 参考: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/jlil56u11
 */
import type { LLMProvider, LLMMessage, ChatOptions, ChatResult, StreamCallback, HealthCheckResult, ProviderConfig } from './types';
import { ClassifiedLlmError, ErrorCode, isRetryable } from '../errors/types';
import { createLogger } from '@synova/logger';
const log = createLogger('src.providers.ernie');

const DEFAULT_BASE_URL = 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat';
const DEFAULT_MODEL = 'ernie-4.0-8k';
const AUTH_URL = 'https://aip.baidubce.com/oauth/2.0/token';

// ═══ Token cache ═══

interface TokenCache {
  token: string;
  expiresAt: number;
}

let _tokenCache: TokenCache | null = null;

async function getAccessToken(apiKey: string, secretKey: string): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: secretKey,
  });

  const res = await fetch(`${AUTH_URL}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new ClassifiedLlmError({
      code: ErrorCode.AUTH_FAILED,
      message: `文心一言 token 获取失败 (${res.status})`,
      phase: 0, retryable: false,
    });
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new ClassifiedLlmError({
      code: ErrorCode.AUTH_FAILED,
      message: '文心一言 token 响应缺少 access_token',
      phase: 0, retryable: false,
    });
  }

  _tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 2592000) * 1000,
  };

  return _tokenCache.token;
}

// ═══ Message conversion ═══

function convertMessages(messages: LLMMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
}

// ═══ Provider ═══

export function createErnieProvider(config: ProviderConfig): LLMProvider {
  const apiKey = config.apiKey || process.env.ERNIE_API_KEY || '';
  const secretKey = process.env.ERNIE_SECRET_KEY || '';
  const model = config.model || DEFAULT_MODEL;
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;

  return {
    name: 'ernie',
    baseUrl,

    async chat(messages: LLMMessage[], opts?: ChatOptions): Promise<ChatResult> {
      if (!apiKey || !secretKey) {
        throw new ClassifiedLlmError({
          code: ErrorCode.AUTH_FAILED,
          message: '文心一言 API Key 或 Secret Key 未配置',
          phase: 0, retryable: false,
        });
      }

      const token = await getAccessToken(apiKey, secretKey);
      const url = `${baseUrl}/${opts?.model || model}?access_token=${token}`;

      const body: Record<string, unknown> = {
        messages: convertMessages(messages),
        temperature: opts?.temperature ?? 0.7,
        max_output_tokens: opts?.maxTokens ?? 4000,
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts?.signal ?? AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text().catch((err) => {
          log.warn({ err, status: res.status }, '错误响应体读取失败 — 降级空文本');
          return '';
        });
        const code = res.status === 429 ? ErrorCode.RATE_LIMITED
          : res.status >= 500 ? ErrorCode.SERVER_ERROR
          : ErrorCode.INTERNAL;
        throw new ClassifiedLlmError({
          code, phase: 0, retryable: isRetryable(code),
          message: `文心一言 API ${res.status}: ${text.slice(0, 200)}`,
        });
      }

      const data = await res.json() as { result?: string; error_msg?: string };
      if (data.error_msg) {
        throw new ClassifiedLlmError({
          code: ErrorCode.INTERNAL, phase: 0, retryable: false,
          message: `文心一言: ${data.error_msg}`,
        });
      }

      return {
        content: data.result || '',
        model: opts?.model || model,
      };
    },

    async stream(messages: LLMMessage[], cb: StreamCallback, opts?: ChatOptions): Promise<void> {
      // 文心一言流式端点不同: /chat/ 后加 stream 参数
      // 简化实现: 非流式调用后逐字符推送 (文心一言 SSE 格式与 OpenAI 不兼容)
      try {
        const result = await this.chat(messages, opts);
        for (const ch of result.content) {
          cb.onToken(ch);
        }
        cb.onComplete?.({ content: result.content, model: result.model });
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "ERNIE LLM 对话");
        cb.onError?.(err);
      }
    },

    async healthCheck(): Promise<HealthCheckResult> {
      if (!apiKey || !secretKey) {
        return { healthy: false, error: '文心一言 API Key 或 Secret Key 未配置' };
      }
      try {
        await getAccessToken(apiKey, secretKey);
        return { healthy: true };
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "ERNIE access_token 获取");
        return { healthy: false, error: err.message, latencyMs: 0 };
      }
    },

    listModels(): string[] {
      return [model, 'ernie-4.0-8k', 'ernie-4.0-turbo-8k', 'ernie-3.5-8k'];
    },
  };
}
