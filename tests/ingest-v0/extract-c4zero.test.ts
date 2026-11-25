/**
 * tests/ingest-v0/extract-c4zero.test.ts — C4 停点（`E_C4_ZERO`）的**端到端**回归（#1500）。
 *
 * 为什么单列一件：`persist.mjs` 在 `count=0` 时必须抛 `E_C4_ZERO` 而不是返回成功（#1493 的假成功陷阱）。
 * 本件直接调 `persistAndVerify`（真实产品 DB + 真实 persistFacts/synova_context_get），
 * 故意让对象缺 `defVersion` —— 若该分支被删掉，本用例会从"rejects"变成"resolves"，必红。
 */
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { persistAndVerify } from '../../scripts/ingest-v0/lib/persist.mjs';

const FIXTURE_ROOT = path.join(os.tmpdir(), 'ingest-v0', `extract-c4zero-${process.pid}-${Date.now()}`);
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('C4 停点 — 缺 defVersion ⇒ E_C4_ZERO（不伪造成功）', () => {
  it('persistAndVerify 抛 E_C4_ZERO，且明细里 count=0 / missing=[defVersion]', async () => {
    let caught: unknown = null;
    try {
      await persistAndVerify({
        dbPath: path.join(FIXTURE_ROOT, 'synova.db'),
        graph: 'c4zero',
        runId: 'c4zero-run',
        objects: [
          { type: 'resource/person', businessKey: 'c4/person', props: { name: '张测试', period: '2026-08' } },
          { type: 'resource/team', businessKey: 'c4/team', props: { name: '测试队', period: '2026-08' } },
        ],
        relations: [
          {
            type: 'edge/member_of_team',
            businessKey: 'c4/rel',
            fromBusinessKey: 'c4/person',
            toBusinessKey: 'c4/team',
            props: { sourceRef: { file: 'c4zero.html', locator: 'table[1]/row[1]', raw: '张测试 | 测试队' } },
          },
        ],
        metrics: [],
        rootBusinessKey: 'c4/person',
        observedAt: new Date().toISOString(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const error = caught as { code?: string; phase?: string; detail?: { context?: { count?: number; insufficient?: { missing?: string[] } } } };
    expect(error.code).toBe('E_C4_ZERO');
    expect(error.phase).toBe('context');
    expect(error.detail?.context?.count).toBe(0);
    expect(error.detail?.context?.insufficient?.missing).toContain('defVersion');
  });
});
