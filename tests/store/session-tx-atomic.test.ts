/**
 * tests/store/session-tx-atomic.test.ts — R-E1 ① `addMessage` 事务化 ＋ C5 per-turn 闩锁（#1165）
 *
 * 判据（设计稿 §2.1；**改坏必红**承重点逐条注明）:
 *   T1a appendEvent **降级** ⇒ `agent_messages` 0 行 / `session_events` 0 行 /
 *       FTS 镜像 0 行 / 返回 `{ok:false,degraded:true}` / `lastDegraded=true`
 *       🔴 改坏必红点 = "`agent_messages` 0 行"：删事务包裹（回三条独立语句）⇒ 这里变 1 行 ⇒ 红
 *   T1b appendEvent 抛 typed（`SESSION_EVENT_LIMIT`）⇒ 0 行 ＋ **原样抛出**（code/phase 保留）
 *   T1c `SYNO_SESSION_TX=0` ⇒ 旧行为（消息行**不**回滚 = 1 行、事件 0 行、返回 degraded）
 *       —— 与 T1a 构成"事务开/关"两态对照（证 T1a 的红是事务带来的，不是夹具假绿）
 *   T1d 正常路径 ⇒ 消息 2 行 ＋ 事件 2 条（seq 1,2）＋ `updated_at` 前进
 *   T1e **C5 同轮**：user 成功（清闩）→ assistant 降级（闩=true）→ 恢复后 assistant 成功
 *       ⇒ `lastDegraded` **仍 true**；system 成功同样不清
 *   T1f **C5 新轮**：本轮降级保持，直到一次**成功的 `role='user'` 写入**才清闩
 *
 * 契约（铁律 47）:
 *   @input    — 每用例独立 `:memory:` DB（禁继承外层状态，判据纪律②）；`process.env` 逐用例注入并还原
 *   @output   — vitest 断言；行数一律**直查 SQL**（不经被测 method ⇒ 判据③ 证据链独立）
 *   @degraded — 注入用 `vi.spyOn(store,'appendEvent')`（真实 `addMessage` 事务路径，不 mock 事务本身，铁律 12）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SessionStore, SessionEventError, type AppendEventResult } from '../../src/store/session-store';

/** 直查消息行数（独立证据链：不经被测方法） */
function countMessages(db: Database.Database, sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM agent_messages WHERE session_id=?').get(sessionId) as { c: number };
  return row.c;
}

/** 直查事件行数 */
function countEvents(db: Database.Database, sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM session_events WHERE session_id=?').get(sessionId) as { c: number };
  return row.c;
}

/** 直查 FTS5 镜像行数（触发器副作用必须同事务回滚，否则搜索面留脏） */
function countFts(db: Database.Database, sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM agent_messages_fts WHERE session_id=?').get(sessionId) as { c: number };
  return row.c;
}

/** 读会话 updated_at（ISO 字符串，字典序 = 时间序） */
function updatedAtOf(db: Database.Database, sessionId: string): string {
  const row = db.prepare('SELECT updated_at FROM agent_sessions WHERE id=?').get(sessionId) as { updated_at: string };
  return row.updated_at;
}

const ENV_KEYS = ['SYNO_SESSION_TX', 'SYNO_SESSION_SEQ_ATOMIC'] as const;

describe('R-E1 ① addMessage 事务化（#1165）', () => {
  let db: Database.Database;
  let store: SessionStore;
  let sessionId: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key]; // 环境隔离：默认走事务/原子路径，禁继承外层 CI 变量
    }
    db = new Database(':memory:');
    store = new SessionStore(db);
    sessionId = store.createSession('org-t1').id;
  });

  afterEach(() => {
    db.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  it('T1a appendEvent 降级 ⇒ 整笔回滚（消息 0 行 / 事件 0 行 / 返回 degraded / 闩=true）', () => {
    // 夹具：把 updated_at 预置为很早，使"未前进"可确定性断言
    const seeded = '2000-01-01T00:00:00.000Z';
    db.prepare('UPDATE agent_sessions SET updated_at=? WHERE id=?').run(seeded, sessionId);

    const spy = vi
      .spyOn(store, 'appendEvent')
      .mockReturnValue({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    const res = store.addMessage(sessionId, 'user', '事务回滚测试');
    spy.mockRestore();

    expect(res).toEqual({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    // 🔴 改坏必红点：删事务包裹 ⇒ agent_messages 残留 1 行 ⇒ 本断言红（P3 原始输出即变异态）
    expect(countMessages(db, sessionId)).toBe(0);
    expect(countEvents(db, sessionId)).toBe(0);
    // 触发器副作用也在事务内 ⇒ FTS 镜像不得留脏
    expect(countFts(db, sessionId)).toBe(0);
    // 第三条语句（UPDATE updated_at）也不得落账
    expect(updatedAtOf(db, sessionId)).toBe(seeded);
    expect(store.lastDegraded).toBe(true);
  });

  it('T1b appendEvent 抛 typed(SESSION_EVENT_LIMIT) ⇒ 回滚 + 原样抛出（code/phase 保留）', () => {
    const spy = vi.spyOn(store, 'appendEvent').mockImplementation((): AppendEventResult => {
      throw new SessionEventError('SESSION_EVENT_LIMIT', 'validate', '注入上限');
    });
    let caught: unknown;
    try {
      store.addMessage(sessionId, 'assistant', 'typed 抛错测试');
    } catch (err) {
      caught = err;
    } finally {
      spy.mockRestore();
    }

    expect(caught).toBeInstanceOf(SessionEventError);
    if (caught instanceof SessionEventError) {
      expect(caught.code).toBe('SESSION_EVENT_LIMIT'); // 原样抛：不折叠成 degraded
      expect(caught.phase).toBe('validate');
      expect(caught.retryable).toBe(false);
    }
    expect(countMessages(db, sessionId)).toBe(0); // 半截行不留（P3 的洞）
    expect(countEvents(db, sessionId)).toBe(0);
    // P3 的第二个洞：抛错路径同样置闩（旧实现抛错时不置位）
    expect(store.lastDegraded).toBe(true);
  });

  it('T1c SYNO_SESSION_TX=0 ⇒ 旧行为（消息行不回滚 = 1 行、事件 0 行、返回 degraded）', () => {
    process.env.SYNO_SESSION_TX = '0';
    const spy = vi
      .spyOn(store, 'appendEvent')
      .mockReturnValue({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    const res = store.addMessage(sessionId, 'user', '旧行为');
    spy.mockRestore();

    expect(res).toEqual({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    // 回滚态 = 改造前逐字同形：消息行留下、事件没落（半截态，正是事务要治的病）
    expect(countMessages(db, sessionId)).toBe(1);
    expect(countEvents(db, sessionId)).toBe(0);
    expect(store.lastDegraded).toBe(true);
  });

  it('T1d 正常路径 ⇒ 消息 2 行 + 事件 2 条(seq 1,2) + updated_at 前进', () => {
    const seeded = '2000-01-01T00:00:00.000Z';
    db.prepare('UPDATE agent_sessions SET updated_at=? WHERE id=?').run(seeded, sessionId);

    const r1 = store.addMessage(sessionId, 'user', 'm1');
    const r2 = store.addMessage(sessionId, 'assistant', 'm2');

    expect(r1).toEqual({ ok: true, seq: 1 });
    expect(r2).toEqual({ ok: true, seq: 2 });
    expect(countMessages(db, sessionId)).toBe(2);
    expect(countEvents(db, sessionId)).toBe(2);
    expect(store.getEvents(sessionId).map((e) => e.seq)).toEqual([1, 2]);
    expect(updatedAtOf(db, sessionId) > seeded).toBe(true); // ISO 字典序 = 时间序
    expect(store.lastDegraded).toBe(false);
    // 投影一致（事务态：模型可见 == 已落账）
    expect(store.deriveMessages(sessionId).map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'm1' },
      { role: 'assistant', content: 'm2' },
    ]);
  });

  it('T1e C5 同轮：assistant 降级后（闩=true），同轮 assistant/system 成功**不得**清闩', () => {
    store.addMessage(sessionId, 'user', '轮起点'); // 成功 user ⇒ 清闩（新轮起点）
    expect(store.lastDegraded).toBe(false);

    const spy = vi
      .spyOn(store, 'appendEvent')
      .mockReturnValue({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    const failed = store.addMessage(sessionId, 'assistant', '失败的回复');
    spy.mockRestore();

    expect(failed.ok).toBe(false);
    expect(store.lastDegraded).toBe(true);
    // 回滚一致性：消息行数 == 事件行数（无半截行）
    expect(countMessages(db, sessionId)).toBe(countEvents(db, sessionId));

    // 🔴 C5 核心：同轮后一次 assistant 成功**不得**抹掉降级（旧语义的洞）
    const recovered = store.addMessage(sessionId, 'assistant', '恢复后的回复');
    expect(recovered.ok).toBe(true);
    expect(store.lastDegraded).toBe(true);

    // system 成功同样不清闩（同轮）
    const system = store.addMessage(sessionId, 'system', '系统提示');
    expect(system.ok).toBe(true);
    expect(store.lastDegraded).toBe(true);
  });

  it('T1f C5 新轮：只有一次成功的 role=user 写入才清闩（跨轮保持）', () => {
    store.addMessage(sessionId, 'user', '旧轮起点');
    const spy = vi
      .spyOn(store, 'appendEvent')
      .mockReturnValue({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    store.addMessage(sessionId, 'assistant', '旧轮失败');
    spy.mockRestore();
    expect(store.lastDegraded).toBe(true);

    // 同轮恢复成功 ⇒ 仍保持
    store.addMessage(sessionId, 'assistant', '旧轮恢复成功');
    expect(store.lastDegraded).toBe(true);

    // 新轮起点（成功 user 写入）⇒ 清闩
    const newTurn = store.addMessage(sessionId, 'user', '新轮开始');
    expect(newTurn.ok).toBe(true);
    expect(store.lastDegraded).toBe(false);
  });

  it('T1g 边界：降级的 user 写入**不算**新轮起点（闩保持 true）', () => {
    store.addMessage(sessionId, 'user', '轮起点');
    const spy = vi
      .spyOn(store, 'appendEvent')
      .mockReturnValue({ ok: false, degraded: true, error: 'INJECTED_DEGRADED' });
    const degradedUser = store.addMessage(sessionId, 'user', '降级的用户消息');
    spy.mockRestore();

    expect(degradedUser.ok).toBe(false);
    expect(store.lastDegraded).toBe(true); // 失败不清闩（只有**成功** user 才是轮边界）
  });
});
