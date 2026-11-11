import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import onboardingRoutes from '../../src/routes/onboarding';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { EXPECTED_PIECES } from '../../src/init/preset-loader';
import { isRecord, listen, request, type RunningHttpServer } from './support/http';
import { saveEnvironment } from './support/environment';

const originalCwd = process.cwd();
const restoreEnv = saveEnvironment(['DEV_MODE', 'JWT_SECRET']);
let tempRoot = '';
let running: RunningHttpServer;
let token = '';

function completeRoleSeed(): Record<string, unknown> {
  return {
    roleId: 'finance',
    knowledgeScope: ['finance.reports'],
    capabilities: ['budget-review'],
    acceptanceCriteria: ['结论必须标明报告期'],
    contexts: [
      { id: 'finance.reports-ref', label: '报表口径', source: 'extensions/presets/roles/finance/knowledge-scope.yaml#finance.reports', why: '统一财务口径' },
      { id: 'company.bp', label: '公司业务说明', source: 'profile.business-plan', why: '结论落到业务动作' },
    ],
    systemAddendum: '财务岗：结论必须标明报告期。',
    outputTemplate: { templateId: 'finance.standard', sections: [{ id: 'headline', title: '结论', must: ['结论'] }] },
  };
}

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'synova-uv02-'));
  process.chdir(tempRoot);
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'uv02-onboarding-secret-0123456789';
  token = signJwtToken({ sub: 'uv02-admin', role: 'admin', orgId: 'default' }) ?? '';
  expect(token).not.toBe('');
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(onboardingRoutes);
  running = await listen(app);
});

afterAll(async () => {
  await running.close();
  process.chdir(originalCwd);
  restoreEnv();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('UV-02 客户建档', () => {
  it('dry-run 只预览不落盘，超管确认后六件真实落盘', async () => {
    const preview = await request(running.baseUrl, 'POST', '/api/onboarding/start', {
      body: { dryRun: true, documents: ['roster.md'], roles: [completeRoleSeed()] },
    });
    expect(preview.status).toBe(200);
    expect(isRecord(preview.body) && preview.body.ok).toBe(true);
    expect(existsSync(join(tempRoot, 'extensions'))).toBe(false);
    expect(existsSync(join(tempRoot, '.synova'))).toBe(false);

    const applied = await request(running.baseUrl, 'POST', '/api/onboarding/apply', {
      token,
      body: { documents: ['roster.md'], roles: [completeRoleSeed()], superAdminConfirmed: true },
    });
    expect(applied.status).toBe(200);
    expect(isRecord(applied.body) && applied.body.ok).toBe(true);
    for (const piece of EXPECTED_PIECES) {
      expect(existsSync(join(tempRoot, 'extensions', 'presets', 'roles', 'finance', piece)), piece).toBe(true);
    }
  });

  it('未超管确认拒绝落盘', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'synova-uv02-denied-'));
    process.chdir(isolated);
    try {
      const denied = await request(running.baseUrl, 'POST', '/api/onboarding/apply', {
        token,
        body: { documents: ['roster.md'], roles: [completeRoleSeed()] },
      });
      expect(denied.status).toBe(409);
      expect(isRecord(denied.body) && denied.body.code).toBe('SUPER_ADMIN_CONFIRMATION_REQUIRED');
      expect(existsSync(join(isolated, 'extensions'))).toBe(false);
      expect(existsSync(join(isolated, '.synova'))).toBe(false);
    } finally {
      process.chdir(tempRoot);
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
