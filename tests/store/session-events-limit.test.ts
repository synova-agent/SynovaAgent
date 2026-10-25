/**
 * tests/store/session-events-limit.test.ts — #991 Q-12 会话事件数上限（裁 407 A 组 ／ 裁 411）
 *
 * 判据（配对测试；**两态＋改坏必红**：删掉 `appendEvent` 里的上限判断 ⇒ Q12-2/3/4/5/7/8 必红）:
 *   Q12-1 正常量：默认上限内连续 append ⇒ `{ok:true}` 且 seq 连续（1,2,3）
 *   Q12-2 超限⇒拒：`SYNO_MAX_SESSION_EVENTS=3` ⇒ 第 4 条抛
 *         `SessionEventError{code:'SESSION_EVENT_LIMIT', phase:'validate', retryable:false}`
 *   Q12-3 写库前拒（不是事后丢）：抛前/抛后 **`SELECT COUNT(*)` 直查**相等且 =cap，seq 无空洞
 *   Q12-4 拒单条不断会话：抛后把上限调高，同一 sessionId 可继续写，seq 从 4 续（不回退）
 *   Q12-5 非 degraded 折返：超限是**抛**，不是 `{ok:false,degraded:true}`（静默丢事件＝Q-12 要治的病）
 *   Q12-6 clamp（裁 219 字面模板）：未配/0/非数 ⇒ 回落默认；负数 ⇒ 下界 1；超上界 ⇒ 夹到 CEILING；
 *         正常值 ⇒ 原样
 *   Q12-7 与 STRICT 独立：`SYNO_SESSION_EVENT_STRICT=0` 时上限**照样**生效（两条闸独立）
 *   Q12-8 边界：seq 恰好 = cap ⇒ 成功；cap+1 ⇒ 抛
 *
 * 契约（铁律 47）:
 *   @input  — 无参数；读进程环境 `SYNO_MAX_SESSION_EVENTS`（逐用例注入并还原）＋内存 SQLite
 *   @output — vitest 断言；超限统一由 `expectLimitError()` 校验 code/phase/retryable 三件齐
 *   @degraded — 不适用（夹具全部进程内，无网络/无外部 IO）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  SessionStore,
  SessionEventError,
  DEFAULT_MAX_SESSION_EVENTS,
  MAX_SESSION_EVENTS_CEILING,
  maxSessionEvents,
} from '../../src/store/session-store';

const CAP_KEY = 'SYNO_MAX_SESSION_EVENTS';
const STRICT_KEY = 'SYNO_SESSION_EVENT_STRICT';

function createFixture(): { db: Database.Database; store: SessionStore } {
  // 不用全局单例：每个用例独立 :memory: 库，禁继承外层状态（判据纪律② 环境隔离）
  // 句柄显式持有 ⇒ Q12-3 可直查 `SELECT COUNT(*)`，不靠被测的 getEvents 自证（判据③ 证据链独立）
  const db = new Database(':memory:');
  return { db, store: new SessionStore(db) };
}

/** 直查行数 —— 判据原文「且 `SELECT COUNT(*)` 不变（写库前拒）」的承重点位 */
function countRows(db: Database.Database, sessionId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM session_events WHERE session_id=?')
    .get(sessionId) as { c: number };
  return row.c;
}

/**
 * 断言「抛的是超限 typed error」。
 * 若上限判断被删/被绕过 ⇒ 这里抛普通 Error ⇒ 用例红（这就是"改坏必红"的承载点）。
 */
function expectLimitError(fn: () => unknown): SessionEventError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SessionEventError);
    const e = err as SessionEventError;
    expect(e.code).toBe('SESSION_EVENT_LIMIT');
    expect(e.phase).toBe('validate');
    expect(e.retryable).toBe(false);
    // 可执行指引：报错必须说清怎么调、怎么继续（判据②「超限⇒抛错含可执行指引」）
    expect(e.message).toContain('SYNO_MAX_SESSION_EVENTS');
    expect(e.message).toContain('新开一个会话');
    return e;
  }
  throw new Error('期望抛 SessionEventError{SESSION_EVENT_LIMIT}，实际未抛 —— 上限判断被删或被绕过');
}

describe('#991 Q-12 会话事件数上限（appendEvent 写库前拒单条）', () => {
  let db: Database.Database;
  let store: SessionStore;
  let sessionId: string;
  let savedCap: string | undefined;
  let savedStrict: string | undefined;

  beforeEach(() => {
    savedCap = process.env[CAP_KEY];
    savedStrict = process.env[STRICT_KEY];
    delete process.env[CAP_KEY];
    delete process.env[STRICT_KEY];
    ({ db, store } = createFixture());
    sessionId = store.createSession('org-test').id;
  });

  afterEach(() => {
    db.close();
    if (savedCap === undefined) delete process.env[CAP_KEY];
    else process.env[CAP_KEY] = savedCap;
    if (savedStrict === undefined) delete process.env[STRICT_KEY];
    else process.env[STRICT_KEY] = savedStrict;
  });

  it('Q12-1 正常量：默认上限内连续 append ⇒ ok:true 且 seq 连续', () => {
    expect(store.appendEvent(sessionId, 'system', { n: 1 })).toEqual({ ok: true, seq: 1 });
    expect(store.appendEvent(sessionId, 'system', { n: 2 })).toEqual({ ok: true, seq: 2 });
    expect(store.appendEvent(sessionId, 'system', { n: 3 })).toEqual({ ok: true, seq: 3 });
    expect(store.getEvents(sessionId).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('Q12-8 边界：seq 恰好 = cap 成功，cap+1 抛', () => {
    process.env[CAP_KEY] = '2';
    expect(store.appendEvent(sessionId, 'system', { n: 1 })).toEqual({ ok: true, seq: 1 });
    expect(store.appendEvent(sessionId, 'system', { n: 2 })).toEqual({ ok: true, seq: 2 });
    expectLimitError(() => store.appendEvent(sessionId, 'system', { n: 3 }));
  });

  it('Q12-2 超限⇒拒：第 cap+1 条抛 SESSION_EVENT_LIMIT/validate/retryable=false', () => {
    process.env[CAP_KEY] = '3';
    for (let i = 1; i <= 3; i++) {
      expect(store.appendEvent(sessionId, 'system', { n: i })).toEqual({ ok: true, seq: i });
    }
    const e = expectLimitError(() => store.appendEvent(sessionId, 'message', { role: 'user', content: '溢出' }));
    expect(e.name).toBe('SessionEventError');
  });

  it('Q12-3 写库前拒：抛前/抛后 `SELECT COUNT(*)` 直查相等且 =cap（判据原文承重点）', () => {
    process.env[CAP_KEY] = '2';
    store.appendEvent(sessionId, 'system', { n: 1 });
    store.appendEvent(sessionId, 'system', { n: 2 });
    // 直查真值（绕开被测的 getEvents，形成独立证据）
    const countBefore = countRows(db, sessionId);
    expect(countBefore).toBe(2);
    expectLimitError(() => store.appendEvent(sessionId, 'system', { n: 3 }));
    const countAfter = countRows(db, sessionId);
    // 判据原文：**写库前拒** ⇒ `SELECT COUNT(*)` 不变（不是「先写后删」）
    expect(countAfter).toBe(countBefore);
    // 且恰好 = cap：既没少写一条（cap-1），也没留下 cap+1
    expect(countAfter).toBe(2);
    const events = store.getEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('Q12-4 拒单条不断会话：调高上限后同一 sessionId 续写，seq 从 cap+1 续', () => {
    process.env[CAP_KEY] = '2';
    store.appendEvent(sessionId, 'system', { n: 1 });
    store.appendEvent(sessionId, 'system', { n: 2 });
    expectLimitError(() => store.appendEvent(sessionId, 'system', { n: 3 }));
    // 会话没被破坏：既有事件可读、可投影
    expect(store.getEvents(sessionId)).toHaveLength(2);
    process.env[CAP_KEY] = '10';
    expect(store.appendEvent(sessionId, 'system', { n: 4 })).toEqual({ ok: true, seq: 3 });
  });

  it('Q12-5 非 degraded 折返：超限抛错而非 {ok:false,degraded:true}', () => {
    process.env[CAP_KEY] = '1';
    store.appendEvent(sessionId, 'system', { n: 1 });
    let returned: unknown;
    let threw = false;
    try {
      returned = store.appendEvent(sessionId, 'system', { n: 2 });
    } catch (err) {
      // 显式判形态：抛的必须是 typed error（普通 Error 会被上游当 I/O 失败折成 degraded）
      threw = true;
      expect(err).toBeInstanceOf(SessionEventError);
      expect((err as SessionEventError).code).toBe('SESSION_EVENT_LIMIT');
    }
    expect(threw).toBe(true);
    // 关键承重点：没有返回 degraded 值（返回了就等于静默丢事件，正是 Q-12 要治的形态）
    expect(returned).toBeUndefined();
  });

  it('Q12-6 clamp（裁 219 字面模板）：未配/0/非数⇒默认，负数⇒1，超上界⇒CEILING，正常值⇒原样', () => {
    expect(maxSessionEvents()).toBe(DEFAULT_MAX_SESSION_EVENTS);
    process.env[CAP_KEY] = '0';
    expect(maxSessionEvents()).toBe(DEFAULT_MAX_SESSION_EVENTS);
    process.env[CAP_KEY] = '-5';
    // 裁 219 字面模板的 Math.max(1, …)：负数被夹到下界 1（不是回落默认）
    expect(maxSessionEvents()).toBe(1);
    process.env[CAP_KEY] = 'abc';
    expect(maxSessionEvents()).toBe(DEFAULT_MAX_SESSION_EVENTS);
    process.env[CAP_KEY] = String(MAX_SESSION_EVENTS_CEILING + 1);
    expect(maxSessionEvents()).toBe(MAX_SESSION_EVENTS_CEILING);
    process.env[CAP_KEY] = '7';
    expect(maxSessionEvents()).toBe(7);
  });

  it('Q12-7 与 STRICT 独立：SYNO_SESSION_EVENT_STRICT=0 时上限照样生效', () => {
    process.env[CAP_KEY] = '1';
    process.env[STRICT_KEY] = '0';
    expect(store.appendEvent(sessionId, 'system', { n: 1 })).toEqual({ ok: true, seq: 1 });
    expectLimitError(() => store.appendEvent(sessionId, 'system', { n: 2 }));
  });
});
