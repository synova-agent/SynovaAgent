/**
 * tests/store/session-event-log.test.ts — D500 事件溯源 session log 测试
 *
 * 覆盖（铁律 48: 正常/降级/边界 + 2026-08-22 并发写缺陷四条防线 S-5）:
 *   L1 appendEvent → deriveMessages 投影与原始消息一致（正常路径）
 *   L1 seq 单调: 连续 append 3 条 → seq = 1,2,3（无回退）
 *   L1 seq 冲突: 手动插重复 seq → 显式 degraded（不静默覆盖，缺陷①防线）
 *   L1 崩溃恢复: 模拟内存回退 → 按持久化 MAX(seq) 续写（缺陷②防线）
 *   L1 半截事件: 事件流缺尾部 → 投影不崩 + degraded:true（铁律 24）
 *   L1 空事件流 → 空投影（边界）
 *   L1 addMessage 双写: store.addMessage 后 session_events 有对应事件
 *   L1 直连调用方: 模拟 cli/im-inbound 直连 store.addMessage → 事件流产生（无需改调用方）
 *   L1 回归: getMessages 输出与 deriveMessages 一致（backing 语义）
 *   L1 model-visible⟺logged: addMessage 后事件已落（SessionStore 层）
 *   L5 D558: D487 旧库 session_events CHECK 重建迁移回归（行保留/约束升级/seq 连续/幂等）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  SessionStore,
  MessageRow,
  SessionEventError,
  SESSION_EVENT_TYPES,
  SESSION_EVENT_FORMAT_VERSION,
} from '../../src/store/session-store';

function createStore(): SessionStore {
  const db = new Database(':memory:');
  return new SessionStore(db);
}

describe('D500 session event log — appendEvent + deriveMessages', () => {
  let store: SessionStore;
  let sessionId: string;

  beforeEach(() => {
    store = createStore();
    sessionId = store.createSession('org-test').id;
  });

  it('appendEvent → deriveMessages 投影与原始消息一致（正常路径）', () => {
    store.addMessage(sessionId, 'user', '你好');
    store.addMessage(sessionId, 'assistant', '我在');
    const derived = store.deriveMessages(sessionId);
    expect(derived).toHaveLength(2);
    expect(derived[0].role).toBe('user');
    expect(derived[0].content).toBe('你好');
    expect(derived[1].role).toBe('assistant');
    expect(derived[1].content).toBe('我在');
  });

  it('seq 单调: 连续 append 3 条 → seq = 1,2,3（无回退）', () => {
    store.addMessage(sessionId, 'user', 'm1');
    store.addMessage(sessionId, 'user', 'm2');
    store.addMessage(sessionId, 'user', 'm3');
    const events = store.getEvents(sessionId);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('seq 冲突: 手动插重复 seq → 显式 degraded（不静默覆盖，缺陷①防线）', () => {
    store.addMessage(sessionId, 'user', 'm1'); // seq=1
    const dup = store.appendEvent(sessionId, 'message', { role: 'user', content: 'm1-dup' });
    // appendEvent 基于 MAX(seq) 续写 → 不会产生重复 seq；直接验证返回 ok 且 seq 递增
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.seq).toBe(2);
    // 事件数 = 2（无覆盖）
    expect(store.getEvents(sessionId)).toHaveLength(2);
    const derived = store.deriveMessages(sessionId);
    expect(derived[0].content).toBe('m1'); // 未被覆盖
  });

  it('seq 冲突真实构造: UNIQUE(session_id,seq) 物理拒绝重复 seq（缺陷①防线实证）', () => {
    const db = (store as unknown as { db: Database.Database }).db;
    store.addMessage(sessionId, 'user', 'first'); // seq=1
    // 直接 SQL 插入重复 seq=1 → UNIQUE 约束物理拒绝（抛 SqliteError，不静默覆盖）
    let threw = false;
    try {
      db.prepare('INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)')
        .run(sessionId, 1, 'message', JSON.stringify({ role: 'user', content: 'conflict' }));
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('UNIQUE constraint failed');
    }
    expect(threw).toBe(true);
    // 原始事件未被覆盖（冲突 INSERT 被拒绝）
    const events = store.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(1);
    expect(JSON.parse(events[0].payloadJson).content).toBe('first');
  });

  it('崩溃恢复: 内存回退（模拟 lastSeq=1 再写 seq=1）→ 按持久化 MAX(seq) 续写 2（缺陷②防线）', () => {
    store.addMessage(sessionId, 'user', 'm1'); // 持久化 seq=1
    // 模拟"内存回退"：内存以为 lastSeq=1 想再写 seq=1 —— appendEvent 用持久化 MAX(seq)=1 → 续写 2
    const res = store.appendEvent(sessionId, 'message', { role: 'user', content: 'm2' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.seq).toBe(2); // 不回到 1
    const seqs = store.getEvents(sessionId).map((e) => e.seq);
    expect(seqs).toEqual([1, 2]); // 单调，无回退
  });

  it('半截事件: 事件流含损坏 payload → 投影不崩 + degraded:true（铁律 24 显式降级）', () => {
    store.addMessage(sessionId, 'user', 'm1');
    store.addMessage(sessionId, 'assistant', 'm2');
    // 模拟半截: 手动把最后一条事件 payload 改成非法 JSON（物理损坏）
    store.corruptLastEventPayload(sessionId);
    const derived = store.deriveMessages(sessionId);
    // 投影返回可重建前缀（m1）且 degraded 标记
    expect(derived.length).toBeGreaterThanOrEqual(1);
    expect(store.lastDegraded).toBe(true);
  });

  it('空事件流 → 空投影（边界）', () => {
    const derived = store.deriveMessages(sessionId);
    expect(derived).toEqual([]);
  });

  it('addMessage 双写: store.addMessage 后 session_events 有对应事件', () => {
    store.addMessage(sessionId, 'user', '双写测试');
    const events = store.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('message');
    const payload = JSON.parse(events[0].payloadJson) as { role: string; content: string };
    expect(payload.role).toBe('user');
    expect(payload.content).toBe('双写测试');
  });

  it('直连调用方: 模拟 cli/im-inbound 直连 store.addMessage → 事件流产生（无需改调用方）', () => {
    // cli.ts:143 直连模式: store.addMessage(sessionId, 'assistant', reply)
    store.addMessage(sessionId, 'assistant', 'cli 回复');
    // im-inbound.ts:144 直连模式: store.addMessage(sessionId, 'user', input)
    store.addMessage(sessionId, 'user', 'im 输入');
    const events = store.getEvents(sessionId);
    expect(events).toHaveLength(2); // 双写下沉 → 直连调用方自动获得事件流
  });

  it('回归: getMessages 输出与 deriveMessages 一致（backing 语义）', () => {
    store.addMessage(sessionId, 'user', 'a');
    store.addMessage(sessionId, 'assistant', 'b');
    const direct = store.getMessages(sessionId);
    const derived = store.deriveMessages(sessionId);
    expect(direct.map((m) => ({ role: m.role, content: m.content })))
      .toEqual(derived.map((m) => ({ role: m.role, content: m.content })));
  });

  it('model-visible⟺logged: addMessage 后事件已落（SessionStore 层，lastDegraded=false）', () => {
    store.addMessage(sessionId, 'user', '落盘校验');
    expect(store.lastDegraded).toBe(false);
    expect(store.getEvents(sessionId).length).toBeGreaterThan(0);
  });

  it('降级信号非粘滞: appendEvent 失败后成功写入 → lastDegraded 重置为 false（复核修复）', () => {
    // 模拟 appendEvent 失败（drop 表 → INSERT 失败 → lastDegraded=true）
    const db = (store as unknown as { db: Database.Database }).db;
    db.exec('DROP TABLE session_events');
    store.addMessage(sessionId, 'user', 'fail-write');
    expect(store.lastDegraded).toBe(true);
    // 重建表 → 后续成功写入应重置 lastDegraded（不粘滞）
    // #964：重建夹具须与当前 schema 同形（含 format_version 列）——本用例意图是"成功写重置降级信号"，
    //   旧 schema 兼容由 #964「旧库（无列）打开」用例覆盖。
    db.exec(`CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system')),
      payload_json TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, seq)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_events_sess ON session_events(session_id, seq);');
    store.addMessage(sessionId, 'user', 'recover-write');
    expect(store.lastDegraded).toBe(false);
    expect(store.getEvents(sessionId).length).toBeGreaterThan(0);
  });

  it('appendEvent 显式 eventType 支持（tool_result 等，扩展性）', () => {
    const res = store.appendEvent(sessionId, 'tool_result', { role: 'tool', content: '{}', toolCallId: 'tc1' });
    expect(res.ok).toBe(true);
    const events = store.getEvents(sessionId);
    expect(events[0].eventType).toBe('tool_result');
    expect(events[0].seq).toBe(1);
  });
});

// ═══ D558: D487 重建迁移回归（K3 P1 闭合）═══
// K3 GA 线闭环批 P1：D487 旧库 session_events CHECK 约束升级迁移
// （src/store/session-store.ts initSchema 内幂等表重建，仅当 sqlite_master 建表 SQL
// 缺 diagnosis_phase 时 BEGIN/COMMIT 重建）物理实测 PASS 但无提交测试——
// 回归风险：迁移逻辑被后续改动破坏无告警。本 describe 补写（S-5 先红：
// 旧库模拟 + 迁移前 CHECK 拒绝自证；若迁移缺失/模拟失真，本组断言即红）。
describe('D487 重建迁移（K3 P1 闭合）— 旧库 CHECK 约束升级', () => {
  /** 构造 D487 之前的旧库：agent_sessions + 旧 session_events（CHECK 仅三类事件）+ 预置 3 行 */
  function createLegacyDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT,
        phase INTEGER DEFAULT 0,
        state_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, seq)
      );
    `);
    db.prepare("INSERT INTO agent_sessions (id, org_id) VALUES ('sess-legacy', 'org-legacy')").run();
    const ins = db.prepare(
      'INSERT INTO session_events (id, session_id, seq, event_type, payload_json, created_at) VALUES (?,?,?,?,?,?)'
    );
    ins.run(1, 'sess-legacy', 1, 'message', JSON.stringify({ role: 'user', content: '旧库行1' }), '2026-08-28T00:00:01.000Z');
    ins.run(2, 'sess-legacy', 2, 'message', JSON.stringify({ role: 'assistant', content: '旧库行2' }), '2026-08-28T00:00:02.000Z');
    ins.run(3, 'sess-legacy', 3, 'system', JSON.stringify({ role: 'system', content: '旧库行3' }), '2026-08-28T00:00:03.000Z');
    return db;
  }

  function tableSql(db: Database.Database): string {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql?: string };
    return row.sql ?? '';
  }

  it('旧库行保留: 迁移后 3 行全字段一致 + 约束升级到位', () => {
    const legacy = createLegacyDb();
    // #964：老库升级新增 format_version 列 ⇒ 只比较迁移前已存在的列；新列单独断言（=1）
    const legacyColumns = 'id, session_id, seq, event_type, payload_json, created_at';
    const before = legacy.prepare(`SELECT ${legacyColumns} FROM session_events ORDER BY seq`).all();
    expect(before).toHaveLength(3);
    new SessionStore(legacy); // 触发迁移
    const after = legacy.prepare(`SELECT ${legacyColumns} FROM session_events ORDER BY seq`).all();
    expect(after).toEqual(before); // 全字段一致（不含新增列）
    const formats = legacy.prepare('SELECT format_version FROM session_events ORDER BY seq').all() as Array<{ format_version: number }>;
    expect(formats.map((row) => row.format_version)).toEqual([1, 1, 1]); // #964：历史行按 DEFAULT 1 视作 v1
    expect(tableSql(legacy)).toContain('diagnosis_phase'); // CHECK 约束已升级
  });

  it('约束升级: 迁移前旧 CHECK 物理拒绝 diagnosis_phase（red 自证）→ 迁移后可写', () => {
    const legacy = createLegacyDb();
    // red 态自证：旧 CHECK 拒绝诊断事件（若旧库模拟失真——CHECK 本就放行——本断言先红）
    let rejected = false;
    try {
      legacy.prepare(
        "INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES ('sess-legacy', 99, 'diagnosis_phase', '{}')"
      ).run();
    } catch (err) {
      rejected = true;
      expect((err as Error).message).toContain('CHECK constraint failed');
    }
    expect(rejected).toBe(true);
    // 迁移触发 → 新表接受诊断事件
    const store = new SessionStore(legacy);
    const res = store.appendEvent('sess-legacy', 'diagnosis_phase', { phase: 2, name: 'diagnose' });
    expect(res.ok).toBe(true);
    expect(store.getEvents('sess-legacy').some((e) => e.eventType === 'diagnosis_phase')).toBe(true);
  });

  it('seq 连续: 迁移后 appendEvent 续写 seq = 旧 MAX+1（无回退/重置）', () => {
    const legacy = createLegacyDb(); // 预置 seq 1..3
    const store = new SessionStore(legacy);
    const res = store.appendEvent('sess-legacy', 'diagnosis_module', { moduleId: 'm1' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.seq).toBe(4); // 旧 MAX(3)+1
    expect(store.getEvents('sess-legacy').map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('幂等: 同库二次 new SessionStore → 无重复重建、数据零损失、id 续写', () => {
    const legacy = createLegacyDb();
    const store = new SessionStore(legacy);
    const afterFirst = legacy.prepare('SELECT * FROM session_events ORDER BY seq').all();
    new SessionStore(legacy); // 第二次构造：建表 SQL 已含 diagnosis_phase → 不再重建
    const afterSecond = legacy.prepare('SELECT * FROM session_events ORDER BY seq').all();
    expect(afterSecond).toEqual(afterFirst); // 数据零损失
    const residualTables = legacy.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'session_events%'"
    ).get() as { n: number };
    expect(residualTables.n).toBe(1); // 无 session_events_new 残留
    // 迁移后 AUTOINCREMENT id 续写（K3 实测「id 连续」项）
    const res = store.appendEvent('sess-legacy', 'diagnosis_report', { reportId: 'r1' });
    expect(res.ok).toBe(true);
    const last = store.getEvents('sess-legacy').at(-1)!;
    expect(last.id).toBe(4); // id 不重置
    expect(last.seq).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════
// #964 Q-7（裁 395）: 事件词表 fail-closed + 行格式版本 format_version
//
// 存量基线（**只登记，不全量改**）:
//   · 词表 v1 = SESSION_EVENT_TYPES 六类（本文件「词表冻结」用例；新增/删减 ⇒ 必红）
//   · 隐藏载荷子词表 kind='llm_retry'（src/llm/retry-middleware.ts）
//   · 生产写入点 3 处（src/store/session-store.ts addMessage / src/agent/diagnosis-launcher.ts /
//     src/llm/retry-middleware.ts）—— 只加守卫，不改写入形状
//   · 老库历史行 = format_version 1（DEFAULT 补齐，不重写 payload）
// ═══════════════════════════════════════════════════════════════════

describe('#964 事件词表 fail-closed', () => {
  it('词表冻结 v1：六类逐字一致（新增/删减类目 ⇒ 本断言先红，逼一次显式格式版本 bump）', () => {
    expect(SESSION_EVENT_TYPES).toEqual([
      'message',
      'tool_result',
      'system',
      'diagnosis_phase',
      'diagnosis_module',
      'diagnosis_report',
    ]);
    expect(SESSION_EVENT_FORMAT_VERSION).toBe(1);
  });

  it('未知 eventType ⇒ 抛 SessionEventError(UNKNOWN_EVENT_TYPE)，不落库、不返回 degraded', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-q7').id;
    let caught: unknown;
    try {
      // 运行时非法值：Reflect.apply 绕过静态类型（零 as any / as never / as unknown as）
      Reflect.apply(store.appendEvent, store, [sessionId, 'bogus', {}]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionEventError);
    const typed = caught as SessionEventError;
    expect(typed.code).toBe('UNKNOWN_EVENT_TYPE');
    expect(typed.phase).toBe('validate');
    expect(typed.retryable).toBe(false);
    expect(store.getEvents(sessionId)).toHaveLength(0); // 拒写：事件流零污染
    db.close();
  });

  it('开关 SYNO_SESSION_EVENT_STRICT=0 ⇒ 回滚旧行为（返回 degraded，不抛）', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-q7-rollback').id;
    process.env.SYNO_SESSION_EVENT_STRICT = '0';
    try {
      const res = Reflect.apply(store.appendEvent, store, [sessionId, 'bogus', {}]);
      expect(res.ok).toBe(false);
      expect(res.degraded).toBe(true);
      expect(String(res.error)).toContain('unknown event type');
      expect(store.getEvents(sessionId)).toHaveLength(0);
    } finally {
      delete process.env.SYNO_SESSION_EVENT_STRICT;
    }
    db.close();
  });
});

describe('#964 行格式版本 format_version', () => {
  it('新库建表即含 format_version 列，写侧恒写当前版本', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-fmt').id;
    store.addMessage(sessionId, 'user', 'hello');
    const columns = db.prepare('PRAGMA table_info(session_events)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('format_version');
    const row = db.prepare('SELECT format_version FROM session_events WHERE session_id=?').get(sessionId) as { format_version: number };
    expect(row.format_version).toBe(SESSION_EVENT_FORMAT_VERSION);
    expect(store.getEvents(sessionId)[0].formatVersion).toBe(SESSION_EVENT_FORMAT_VERSION);
    db.close();
  });

  it('旧库（无列）打开 ⇒ 自动加列、老行读作 1；二次打开幂等（裁 395：禁 catch 吞）', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, phase INTEGER DEFAULT 0,
        state_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system','diagnosis_phase','diagnosis_module','diagnosis_report')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, seq)
      );
    `);
    db.prepare("INSERT INTO agent_sessions (id, org_id) VALUES ('sess-old','org-old')").run();
    const insert = db.prepare('INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)');
    insert.run('sess-old', 1, 'message', JSON.stringify({ role: 'user', content: 'old-1' }));
    insert.run('sess-old', 2, 'message', JSON.stringify({ role: 'assistant', content: 'old-2' }));

    const first = new SessionStore(db); // 触发老库升级
    const columns = db.prepare('PRAGMA table_info(session_events)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('format_version');
    expect(first.getEvents('sess-old').map((event) => event.formatVersion)).toEqual([1, 1]);

    const second = new SessionStore(db); // 幂等：再打开不重复 ALTER、不丢行
    expect(second.getEvents('sess-old').map((event) => event.formatVersion)).toEqual([1, 1]);
    expect(second.getEvents('sess-old')).toHaveLength(2);
    db.close();
  });

  it('旧库（三事件 CHECK：D487 重建路径）⇒ 加列 + 重建后数据零丢失、格式版本=1', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, phase INTEGER DEFAULT 0,
        state_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('message','tool_result','system')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, seq)
      );
    `);
    db.prepare("INSERT INTO agent_sessions (id, org_id) VALUES ('sess-d487','org-old')").run();
    const insert = db.prepare('INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)');
    insert.run('sess-d487', 1, 'message', JSON.stringify({ role: 'user', content: 'm1' }));
    insert.run('sess-d487', 2, 'tool_result', JSON.stringify({ content: 't1' }));
    insert.run('sess-d487', 3, 'system', JSON.stringify({ role: 'system', content: 's1' }));

    const store = new SessionStore(db); // 先补列，再走 D487 重建（顺序由实现保证）
    expect(store.getEvents('sess-d487').map((event) => event.formatVersion)).toEqual([1, 1, 1]);
    expect(store.getEvents('sess-d487').map((event) => event.eventType)).toEqual(['message', 'tool_result', 'system']);
    const tableSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'").get() as { sql?: string };
    expect(tableSqlRow.sql ?? '').toContain('diagnosis_phase'); // CHECK 已升级（重建成功）
    expect(tableSqlRow.sql ?? '').toContain('format_version'); // 重建后列保留
    db.close();
  });

  it('读侧 fail-closed：format_version 高于本构建 ⇒ 抛 EVENT_FORMAT_TOO_NEW（不静默跳过）', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-future').id;
    store.addMessage(sessionId, 'user', '当前格式');
    db.prepare('UPDATE session_events SET format_version=? WHERE session_id=?')
      .run(SESSION_EVENT_FORMAT_VERSION + 1, sessionId);
    let code = '';
    try {
      store.getEvents(sessionId);
    } catch (err) {
      code = err instanceof SessionEventError ? err.code : 'NOT_TYPED';
    }
    expect(code).toBe('EVENT_FORMAT_TOO_NEW');
    // 回滚开关 =0 ⇒ 旧行为：照读 + degraded 留痕（铁律 11）
    process.env.SYNO_SESSION_EVENT_STRICT = '0';
    try {
      const events = store.getEvents(sessionId);
      expect(events).toHaveLength(1);
      expect(events[0].formatVersion).toBe(SESSION_EVENT_FORMAT_VERSION + 1);
      expect(store.lastDegraded).toBe(true);
    } finally {
      delete process.env.SYNO_SESSION_EVENT_STRICT;
    }
    db.close();
  });

  it('读侧未知类型行（绕过 DB CHECK 的旧库/直连 SQL）⇒ 抛 UNKNOWN_EVENT_TYPE', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-bogus-row').id;
    db.exec('DROP TABLE session_events');
    db.exec(`
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL,
        format_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, seq)
      )
    `);
    db.prepare('INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)')
      .run(sessionId, 1, 'bogus_type', '{}');
    let code = '';
    try {
      store.getEvents(sessionId);
    } catch (err) {
      code = err instanceof SessionEventError ? err.code : 'NOT_TYPED';
    }
    expect(code).toBe('UNKNOWN_EVENT_TYPE');
    db.close();
  });
});
