import { vi } from 'vitest';
import type { StreamingHost } from '../../../electron-renderer/src/hooks/useStreaming';

export const LLM_ENV_KEYS = [
  'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'OPENAI_API_KEY',
  'QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'GLM_API_KEY', 'ZHIPAO_API_KEY', 'ZHIPU_API_KEY',
  'MOONSHOT_API_KEY', 'KIMI_API_KEY', 'YI_API_KEY', 'LINGYI_API_KEY', 'MINIMAX_API_KEY',
  'STEP_API_KEY', 'ERNIE_API_KEY', 'ERNIE_SECRET_KEY', 'OPENCLAW_GATEWAY_HOST',
] as const;

export function saveEnvironment(keys: readonly string[]): () => void {
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function installRendererWindow(baseUrl: string): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => values.clear(),
    },
    electronAPI: { getServerUrl: () => baseUrl },
  });
  return values;
}

export function createStreamingHost(): {
  state: { streaming: boolean; text: string; experts: string[] };
  host: StreamingHost;
} {
  const state = { streaming: false, text: '', experts: [] as string[] };
  return {
    state,
    host: {
      setStreaming: (value) => { state.streaming = value; },
      appendStreaming: (text) => { state.text += text; },
      resetStreaming: () => { state.text = ''; },
      setExperts: (experts) => { state.experts = experts; },
    },
  };
}
