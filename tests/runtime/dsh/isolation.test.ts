/**
 * T4 验收：领域与 DSH 隔离（DSH 停止后领域测试仍通过；AI 能力不可用必须显式）。
 *
 * 断言语义：领域计算/事实/结果**不经过 DSH**；DSH 不可用时 run 以稳定 code 失败，
 * 而不是空回答，也不影响领域侧调用。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../../src/adapters/sqlite-graph-store';
import { getDatabase, initEngineContext } from '../../../src/init/engine-context';
import { ProposalManager } from '../../../src/l2/proposal-manager';
import { DshError } from '../../../src/runtime/dsh/errors';
import { persistProposalDraft } from '../../../src/runtime/dsh/proposals';
import { DshRunManager } from '../../../src/runtime/dsh/session';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

const ISOLATION_CONTEXT = { enterpriseId: 'ent-isolation-1426', userId: 'user-isolation-1426', scope: 'admin', runId: 'run_isolation_ctx' };
const ISOLATION_PROBLEM = 'batch-1426-isolation-root';
/** ② 邻接条目 id（真 :memory: 图种子）。 */
let isolationNeighborId: string;

beforeAll(() => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`isolation.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  const store = new SqliteGraphStore(getDatabase());
  const root = store.createNode(
    'activity/delivery_batch',
    { businessKey: ISOLATION_PROBLEM, name: '隔离根批次', period: '2026-07', defVersion: 'def-2026.07' },
    ISOLATION_CONTEXT.enterpriseId,
  );
  isolationNeighborId = store.createNode(
    'activity/delivery_batch',
    { businessKey: 'batch-1426-isolation-neighbor', name: '隔离邻接批次', period: '2026-08', defVersion: 'def-2026.08' },
    ISOLATION_CONTEXT.enterpriseId,
  );
  store.createEdge('edge/team_executes_activity', root, isolationNeighborId, 1, {}, ISOLATION_CONTEXT.enterpriseId);
});

describe('T4 DSH 停止后的领域隔离', () => {
  it('没有任何 DSH 进程时：领域 ContextSnapshot 与 Proposal 草案仍可用', () => {
    const context = JSON.parse(handleDomainToolCall('synova_context_get', { problemId: ISOLATION_PROBLEM }, ISOLATION_CONTEXT)) as { count: number; items: Array<{ $id: string }> };
    expect(context.count).toBe(1);
    expect(context.items[0].$id).toBe(isolationNeighborId);

    const db = new Database(':memory:');
    const manager = new ProposalManager(db);
    const draft = persistProposalDraft(manager, {
      runId: 'run_isolation_0001',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      title: '隔离测试草案',
      description: 'domain-only',
    });
    expect(draft.ok).toBe(true);
    const count = db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?').get('run_isolation_0001') as { n: number };
    expect(count.n).toBe(1);
    db.close();
  }, 30_000);

  it('DSH 不可用：run 以 SIDECAR_NOT_RUNNING 失败（不空成功），领域调用不受影响', async () => {
    const manager = new DshRunManager({
      instanceDir: process.cwd(),
      createClient: () => { throw new DshError('SIDECAR_NOT_RUNNING', 'session', 'DSH 已停止（模拟）', { retryable: false }); },
      runTimeoutMs: 1_000,
    });
    const record = await manager.run({
      runId: 'run_isolation_0002',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      scope: 'admin',
      input: 'DSH 不可用时提问',
    });
    const deadline = Date.now() + 3_000;
    while (record.stream.terminal === null && Date.now() < deadline) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    const terminal = record.stream.terminal;
    expect(terminal).not.toBeNull();
    expect(terminal?.type).toBe('run.failed');
    expect(terminal?.data.code).toBe('SIDECAR_NOT_RUNNING');
    expect(terminal?.data.retryable).toBe(false);

    // 同一时刻领域调用仍然成功
    expect((JSON.parse(handleDomainToolCall('synova_context_get', { problemId: ISOLATION_PROBLEM }, ISOLATION_CONTEXT)) as { count: number }).count).toBe(1);
    await manager.dispose();
  });

  it('DSH 不可用不产生空的 run.completed（零对象不算成功）', async () => {
    const manager = new DshRunManager({
      instanceDir: process.cwd(),
      createClient: () => { throw new DshError('SIDECAR_SPAWN_FAILED', 'spawn', 'DSH 未安装（模拟）', { retryable: true }); },
      runTimeoutMs: 1_000,
    });
    const record = await manager.run({
      runId: 'run_isolation_0003',
      enterpriseId: 'ent-1',
      userId: 'user-1',
      scope: 'admin',
      input: 'x',
    });
    const deadline = Date.now() + 3_000;
    while (record.stream.terminal === null && Date.now() < deadline) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    expect(record.stream.terminal?.type).toBe('run.failed');
    expect(record.stream.snapshot().some(event => event.type === 'run.completed')).toBe(false);
    await manager.dispose();
  });
});
