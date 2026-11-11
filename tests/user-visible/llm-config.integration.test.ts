import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { llmConfigRoutes } from '../../src/routes/llm-config';
import { fetchLlmConfigStatus, submitLlmConfig } from '../../electron-renderer/src/stores/llm-config';
import { isRecord, listen, request, type RunningHttpServer } from './support/http';
import { installRendererWindow, LLM_ENV_KEYS, saveEnvironment } from './support/environment';

const API_KEY = 'uv-test-key-12345';
const restoreEnv = saveEnvironment(['SYNOVA_DATA_DIR', ...LLM_ENV_KEYS]);
let tempDir = '';
let running: RunningHttpServer;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'synova-uv01-'));
  process.env.SYNOVA_DATA_DIR = tempDir;
  for (const key of LLM_ENV_KEYS) delete process.env[key];
  const app = express();
  app.use(express.json());
  app.use(llmConfigRoutes);
  running = await listen(app);
  installRendererWindow(running.baseUrl);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await running.close();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('UV-01 首启 LLM 配置', () => {
  it('真实保存与桌面状态读取进入 configured，响应和落盘之外的输出不回显明文 Key', async () => {
    const initial = await request(running.baseUrl, 'GET', '/api/llm/config');
    expect(initial.status).toBe(200);
    expect(isRecord(initial.body) && initial.body.configured).toBe(false);

    const saved = await submitLlmConfig({
      provider: 'openai', model: 'uv-local-model', baseUrl: 'http://127.0.0.1:19001', apiKey: API_KEY,
    });
    expect(saved).toEqual({ ok: true, maskedKey: '****2345' });

    const status = await fetchLlmConfigStatus();
    expect(status).not.toBeNull();
    expect(status?.ok).toBe(true);
    expect(status?.configured).toBe(true);
    expect(status?.source).toBe('stored');
    expect(status?.provider).toBe('openai');
    expect(status?.model).toBe('uv-local-model');
    expect(status?.maskedKey).toBe('****2345');
    expect(JSON.stringify(status)).not.toContain(API_KEY);

    const persisted = readFileSync(join(tempDir, 'llm-credentials.json'), 'utf8');
    expect(persisted).toContain(API_KEY);
    expect(persisted).not.toContain('****2345');
  });
});
