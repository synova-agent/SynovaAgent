import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import actionsRoutes from '../../src/routes/actions-api';
import gaCalibrationRoutes from '../../src/routes/ga-calibration';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import { getFeedbackCollector } from '../../src/growth/feedback-collector';
import { isRecord, listen, request, type RunningHttpServer } from './support/http';
import { saveEnvironment } from './support/environment';

const ORG = 'uv-action-org';
const WORKSPACE = 'uv-workspace';
const restoreEnv = saveEnvironment(['SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR', 'SYNOVA_ORG_ID', 'DEV_MODE', 'JWT_SECRET']);
let tempDir = '';
let db: Database.Database;
let running: RunningHttpServer;

function tokenFor(role: string): string {
  const token = signJwtToken({ sub: `uv-${role}`, role, orgId: ORG });
  expect(token).not.toBeNull();
  return token ?? '';
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'synova-uv-actions-'));
  process.env.SYNOVA_DB_PATH = join(tempDir, 'actions.db');
  process.env.SYNOVA_DATA_DIR = tempDir;
  process.env.SYNOVA_ORG_ID = ORG;
  process.env.DEV_MODE = 'false';
  process.env.JWT_SECRET = 'uv-actions-secret-0123456789abcdef';
  const { initEngineContext, getDatabase } = await import('../../src/init/engine-context');
  initEngineContext();
  db = getDatabase();
  getFeedbackCollector().setDatabase(db);
  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.use(actionsRoutes);
  app.use(gaCalibrationRoutes);
  running = await listen(app);
});

afterAll(async () => {
  await running.close();
  const { closeEngineContext } = await import('../../src/init/engine-context');
  closeEngineContext();
  restoreEnv();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('UV-08 行动闭环', () => {
  it('创建后按 confirmed→executing→completed 流转并读回，匿名纵深守卫拒绝', async () => {
    const token = tokenFor('admin');
    const created = await request(running.baseUrl, 'POST', '/api/actions', {
      token, body: { workspaceId: WORKSPACE, title: '建立每周回款清单', priority: 'high' },
    });
    expect(created.status).toBe(200);
    const action = isRecord(created.body) && isRecord(created.body.action) ? created.body.action : null;
    const actionId = action?.id;
    expect(typeof actionId).toBe('string');
    expect(action?.status).toBe('pending');

    for (const status of ['confirmed', 'executing', 'completed']) {
      const transitioned = await request(running.baseUrl, 'PUT', `/api/actions/${String(actionId)}/status`, {
        token, body: { status },
      });
      expect(transitioned.status).toBe(200);
      expect(isRecord(transitioned.body) && isRecord(transitioned.body.action)
        ? transitioned.body.action.status : null).toBe(status);
    }
    const list = await request(running.baseUrl, 'GET', `/api/actions?workspaceId=${WORKSPACE}`, { token });
    expect(list.status).toBe(200);
    const items = isRecord(list.body) && Array.isArray(list.body.actions) ? list.body.actions : [];
    expect(items).toHaveLength(1);
    expect(isRecord(items[0]) && items[0].status).toBe('completed');
    expect(isRecord(items[0]) && items[0].title).toBe('建立每周回款清单');

    const bare = express();
    bare.use(express.json());
    bare.use(rbacMiddleware);
    bare.use(actionsRoutes);
    const deniedServer = await listen(bare);
    try {
      const denied = await request(deniedServer.baseUrl, 'GET', '/api/actions');
      expect(denied.status).toBe(403);
      expect(isRecord(denied.body) && denied.body.code).toBe('RBAC_DENIED');
    } finally {
      await deniedServer.close();
    }
  });
});

describe('UV-09 GA 校准与反馈回流', () => {
  it('纠错可读回并形成版本链与 feedback_log 互链，非 GA 不得提交', async () => {
    const ga = tokenFor('ga');
    const targetId = 'uv-report-conclusion';
    const first = await request(running.baseUrl, 'POST', '/api/ga/calibration', {
      token: ga,
      body: {
        targetType: 'diagnosis_conclusion', targetId, action: 'mark_error',
        errorType: '归因错误', correctedContent: '主要约束是回款周期而非获客不足',
      },
    });
    expect(first.status).toBe(201);
    const firstId = isRecord(first.body) ? first.body.calibrationId : null;
    expect(typeof firstId).toBe('string');

    const second = await request(running.baseUrl, 'POST', '/api/ga/calibration', {
      token: ga,
      body: {
        targetType: 'diagnosis_conclusion', targetId, action: 'rewrite_logic',
        originalVersion: '获客不足导致增长受限', rewrittenVersion: '回款周期拉长导致现金缺口', supersedes: firstId,
      },
    });
    expect(second.status).toBe(201);
    const secondId = isRecord(second.body) ? second.body.calibrationId : null;
    expect(typeof secondId).toBe('string');

    const latest = await request(running.baseUrl, 'GET', `/api/ga/calibration?targetType=diagnosis_conclusion&targetId=${targetId}`, { token: ga });
    expect(latest.status).toBe(200);
    const visible = isRecord(latest.body) && Array.isArray(latest.body.calibrations) ? latest.body.calibrations : [];
    expect(visible).toHaveLength(1);
    expect(isRecord(visible[0]) && visible[0].calibrationId).toBe(secondId);
    expect(isRecord(visible[0]) && visible[0].rewrittenVersion).toBe('回款周期拉长导致现金缺口');
    expect(isRecord(visible[0]) && visible[0].gaId).toBe('uv-ga');

    const chain = await request(running.baseUrl, 'GET', `/api/ga/calibration?targetType=diagnosis_conclusion&targetId=${targetId}&includeChain=1`, { token: ga });
    const entries = isRecord(chain.body) && Array.isArray(chain.body.calibrations) ? chain.body.calibrations : [];
    expect(entries).toHaveLength(2);
    expect(isRecord(entries[0]) && entries[0].supersededBy).toBe(secondId);
    expect(isRecord(entries[1]) && entries[1].supersedes).toBe(firstId);

    const feedback = db.prepare(
      'SELECT decision, target_type, target_id, actor_id, actor_role, evidence_refs FROM feedback_log WHERE target_id = ? ORDER BY created_at, rowid',
    ).all(targetId) as Array<Record<string, unknown>>;
    expect(feedback).toHaveLength(2);
    expect(feedback.map((row) => row.decision)).toEqual(['reject', 'modify']);
    expect(feedback.every((row) => row.target_type === 'diagnosis_conclusion' && row.actor_role === 'ga')).toBe(true);
    expect(String(feedback[0]?.evidence_refs)).toContain(String(firstId));
    expect(String(feedback[1]?.evidence_refs)).toContain(String(secondId));

    const denied = await request(running.baseUrl, 'POST', '/api/ga/calibration', {
      token: tokenFor('staff'),
      body: { targetType: 'diagnosis_conclusion', targetId, action: 'mark_error', errorType: '事实错误', correctedContent: '越权写入' },
    });
    expect(denied.status).toBe(403);
    expect(isRecord(denied.body) && denied.body.code).toBe('FORBIDDEN');
  });
});
