/**
 * providers/deepseek.ts — DeepSeek Provider 适配器
 *
 * 使用 BaseLLMProvider 消除 SSE/HTTP/健康检查重复代码 (54→0 行重复)。
 * 保留唯一特性: sanitizeMessages, ClassifiedLlmError, validateResponse, convertTools
 */
import type { LLMProvider, LLMMessage, ChatOptions, ChatResult, ProviderConfig, ChatCompletionResponse } from './types';
import { ClassifiedLlmError, ErrorCode, isRetryable } from '../errors/types';
import { sanitizeMessages } from './message-sanitizer';
import { createOpenAICompatibleProvider } from './base';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';

export function createDeepSeekProvider(config: ProviderConfig): LLMProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const apiKey = config.apiKey || '';
  const model = config.model || DEFAULT_MODEL;

  const provider = createOpenAICompatibleProvider({
    name: 'deepseek',
    baseUrl,
    model,
    apiKey,
    getHeaders: () => ({ Authorization: `Bearer ${apiKey}` }),

    /** P2-5.4: 消息清洗 — 修复 UTF-16 代理项/控制字符/全角/过长 */
    beforeSend: (messages: LLMMessage[]) => sanitizeMessages(messages) as unknown as LLMMessage[],

    /** Hermes #12: 结构化错误码 + 可重试判定 */
    onError: (err: Error, context: string) => {
      // 尝试从原始错误中提取 HTTP 状态码
      const statusMatch = err.message.match(/\((\d{3})\)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const code = status === 429 ? ErrorCode.RATE_LIMITED
        : status >= 500 ? ErrorCode.NETWORK
        : ErrorCode.INTERNAL;
      return new ClassifiedLlmError({
        code, message: `DeepSeek ${context}: ${err.message}`,
        phase: 0, retryable: isRetryable(code),
      });
    },

    /**
     * 丰富返回: usage 信息。D598 四桶 seam — DeepSeek prompt_tokens 含 cache 命中
     * （prompt_tokens = prompt_cache_hit_tokens + miss，DSH translate.js mapUsage 同源口径），
     * 拆出 cacheReadTokens 供 disjoint 计量（cacheWriteTokens DeepSeek 不上报，保持 undefined）。
     */
    afterResponse: (data: ChatCompletionResponse, _opts?: ChatOptions): Partial<ChatResult> => {
      const usage = data.usage;
      if (!usage) return { usage: undefined };
      const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
      return {
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
        },
      };
    },
  });

  // ── DeepSeek 独有特性 ──

  return {
    ...provider,

    // Hermes #12: ProviderTransport 适配器 — 响应格式校验
    validateResponse(raw: unknown): { valid: boolean; error?: string } {
      if (!raw || typeof raw !== 'object') return { valid: false, error: '响应体为空或非 JSON' };
      const r = raw as Record<string, unknown>;
      const choices = r.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        return { valid: false, error: '响应缺少 choices 数组' };
      }
      const msg = (choices[0] as Record<string, unknown>)?.message;
      if (!msg || typeof msg !== 'object') {
        return { valid: false, error: 'choices[0].message 缺失' };
      }
      const content = (msg as Record<string, unknown>).content;
      if (content === undefined || content === null || content === '') {
        const toolCalls = (msg as Record<string, unknown>).tool_calls;
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
          return { valid: false, error: 'content 和 tool_calls 均为空' };
        }
      }
      return { valid: true };
    },

    convertTools(tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>): Array<unknown> {
      return tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: { ...t.parameters, additionalProperties: false },
          strict: true,
        },
      }));
    },

    listModels(): string[] {
      return [model, 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-r1'];
    },

    /** 401 专项检测 */
    async healthCheck() {
      const hc = await provider.healthCheck();
      if (!hc.healthy && hc.error?.includes('401')) {
        return { ...hc, error: 'API Key 无效 (401)，请检查 Key 是否正确' };
      }
      return hc;
    },
  };
}
