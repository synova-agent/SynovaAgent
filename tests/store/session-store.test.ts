/**
 * tests/store/session-store.test.ts — D250 线程重命名测试 ＋ #1257 P0-2a 迁移回归（文件库）
 *
 * 覆盖: renameSession 逻辑 + PATCH 端点接线（D250 原样保留）
 *      ＋ #1257：`source_event_seq` 两路加列 + 重建门改 `tool_call` + **迁移幂等（文件库）**
 *      ＋ #1257：迁移遇 CHECK/数据完整性 ⇒ **fail-closed 上抛**（改坏探针：把 catch 改回吞错 ⇒ 本组红）
 *
 * 为什么用**文件库**（不是 `:memory:`）：迁移是"打开既有库"的行为——文件库才有"重启/二次打开"语义
 * （内存库每次构造都是新库，测不到幂等）。临时库落在 `tmpdir()`，用例后清理。
 *
 * 时钟口径：本文件不直取系统时钟；断言只读 schema/行数据。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SessionStore, SOURCE_EVENT_SEQ_KEY } from '../../src/store/session-store';

const tempDirs: string[] = [];

/** 新建一个隔离的临时目录（每次调用互不干扰；afterEach 统一删除） */
function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `synova-1257-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function openDb(path: string): Database.Database {
  return new Database(path);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 造一个 "D487 之后、#1257 之前" 的旧库（文件库）：
 * - 无 `format_version` 列、无 `source_event_seq` 列
 * - CHECK 含 diagnosis_phase 六类（⇒ 缺 tool_call，重建门应触发）
 * - 预置 3 行（含 1 条 diagnosis_phase，验证重建后数据零丢失）
 */
function createLegacyV1Db(path: string): void {
  const legacy = openDb(path);
  try {
    legacy.exec(`
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
    legacy.prepare("INSERT INTO agent_sessions (id, org_id) VALUES ('sess-legacy-1257','org-1257')").run();
    const insert = legacy.prepare(
      'INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)',
    );
    insert.run('sess-legacy-1257', 1, 'message', JSON.stringify({ role: 'user', content: '旧行1' }));
    insert.run('sess-legacy-1257', 2, 'diagnosis_phase', JSON.stringify({ phase: 2 }));
    insert.run('sess-legacy-1257', 3, 'message', JSON.stringify({ role: 'assistant', content: '旧行3' }));
  } finally {
    legacy.close();
  }
}

/** 该库 session_events 的建表 SQL（读 sqlite_master；缺失 ⇒ 空串） */
function sessionEventsTableSql(db: Database.Database): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='session_events'",
  ).get() as { sql?: string } | undefined;
  return row?.sql ?? '';
}

describe('D250 Thread Rename', () => {
  it('routes/sessions.ts 已包含 PATCH /api/sessions/:id/title', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/routes/sessions.ts', 'utf-8');
    expect(content).toContain('patch');
    expect(content).toContain('/api/sessions/:id/title');
  });

  it('session-store.ts 已包含 renameSession 方法', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/store/session-store.ts', 'utf-8');
    expect(content).toContain('renameSession');
  });

  it('session-store.ts 已包含 ALTER TABLE title 迁移', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/store/session-store.ts', 'utf-8');
    expect(content).toContain('title');
    expect(content).toContain('ALTER');
  });
});

describe('#1257 P0-2a 迁移（文件库）— source_event_seq 两路加列 + 重建门改 tool_call', () => {
  it('旧库打开 ⇒ 补 source_event_seq 列 + 重建 CHECK 含 tool_call + 3 行零丢失（历史行=未配对）', () => {
    const path = join(makeTempDir('migrate'), 'session.db');
    createLegacyV1Db(path);

    const db = openDb(path);
    try {
      const store = new SessionStore(db); // 触发迁移
      const columns = db.prepare('PRAGMA table_info(session_events)').all() as Array<{ name: string }>;
      const columnNames = columns.map((column) => column.name);
      expect(columnNames).toContain('source_event_seq'); // ② PRAGMA 判缺 + ALTER
      expect(columnNames).toContain('format_version');
      expect(sessionEventsTableSql(db)).toContain('tool_call'); // 重建后的 CHECK（门条件已从 diagnosis_phase 改 tool_call）

      const events = store.getEvents('sess-legacy-1257');
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]); // 行零丢失
      expect(events.map((event) => event.eventType)).toEqual(['message', 'diagnosis_phase', 'message']);
      expect(events.map((event) => event.formatVersion)).toEqual([1, 1, 1]); // 历史行按 DEFAULT 1 视作 v1
      expect(events.map((event) => event.sourceEventSeq)).toEqual([null, null, null]); // 历史行未配对

      // 新写入可落 tool_call（旧 CHECK 会拒；迁移成功才可能）
      const call = store.appendEvent('sess-legacy-1257', 'tool_call', { toolCallId: 'call_legacy_1', name: 'probe', round: 0 });
      expect(call.ok).toBe(true);
      if (call.ok) expect(call.seq).toBe(4); // 续写 seq = 旧 MAX(3)+1（AUTOINCREMENT id 亦不重置）
    } finally {
      db.close();
    }
  });

  it('迁移幂等（文件库二次打开）⇒ 不重复重建、行零变化、id/seq 续写、保留键仍落列', () => {
    const path = join(makeTempDir('idempotent'), 'session.db');
    createLegacyV1Db(path);

    const db1 = openDb(path);
    let sqlAfterFirst = '';
    let rowsAfterFirst: unknown[] = [];
    try {
      const store1 = new SessionStore(db1);
      // 第一次迁移后写一对 call/result（保留键 → 列；payload_json 剥离）
      const call = store1.appendEvent('sess-legacy-1257', 'tool_call', { toolCallId: 'call_idem_1', name: 'probe', round: 0 });
      expect(call.ok).toBe(true);
      if (!call.ok) throw new Error('call 写入失败');
      const result = store1.appendEvent('sess-legacy-1257', 'tool_result', {
        toolCallId: 'call_idem_1',
        name: 'probe',
        ok: true,
        durationMs: 0,
        [SOURCE_EVENT_SEQ_KEY]: call.seq,
      });
      expect(result.ok).toBe(true);
      expect(store1.listUnclosedToolCalls('sess-legacy-1257')).toEqual([]); // 配对闭合

      sqlAfterFirst = sessionEventsTableSql(db1);
      rowsAfterFirst = db1.prepare('SELECT * FROM session_events ORDER BY seq').all();
    } finally {
      db1.close();
    }

    const db2 = openDb(path);
    try {
      const store2 = new SessionStore(db2); // 二次打开（幂等）
      expect(sessionEventsTableSql(db2)).toBe(sqlAfterFirst); // 建表 SQL 逐字不变 ⇒ 没重复重建
      expect(db2.prepare('SELECT * FROM session_events ORDER BY seq').all()).toEqual(rowsAfterFirst); // 数据零损失
      const residual = db2.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'session_events%'",
      ).get() as { n: number };
      expect(residual.n).toBe(1); // 无 session_events_new 残留

      // 二次打开后继续写：seq/id 均续写（不重置）
      const next = store2.appendEvent('sess-legacy-1257', 'message', { role: 'user', content: 'after-reopen' });
      expect(next.ok).toBe(true);
      if (next.ok) expect(next.seq).toBe(6); // 1..3 旧行 + 4 call + 5 result
      const tail = store2.getEvents('sess-legacy-1257').at(-1);
      expect(tail?.seq).toBe(6);
      expect(tail?.sourceEventSeq).toBeNull();
      // 保留键不残留：result 行 payload_json 无 sourceEventSeq 字面
      const resultRow = db2.prepare(
        "SELECT payload_json FROM session_events WHERE session_id='sess-legacy-1257' AND event_type='tool_result'",
      ).get() as { payload_json: string };
      expect(resultRow.payload_json).not.toContain(SOURCE_EVENT_SEQ_KEY);
      expect(store2.listUnclosedToolCalls('sess-legacy-1257')).toEqual([]);
    } finally {
      db2.close();
    }
  });

  it('迁移 fail-closed：旧库含 v2 词表外行 ⇒ 重建遇 CHECK 错**上抛**（吞错即本用例红）', () => {
    const path = join(makeTempDir('check-fail'), 'session.db');
    // 旧库 CHECK 允许 'legacy_note'（v2 词表不含）⇒ INSERT SELECT 到新表必触 CHECK constraint failed
    const legacy = openDb(path);
    try {
      legacy.exec(`
        CREATE TABLE agent_sessions (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, phase INTEGER DEFAULT 0,
          state_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE session_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('message','legacy_note')),
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(session_id, seq)
        );
      `);
      legacy.prepare("INSERT INTO agent_sessions (id, org_id) VALUES ('sess-bad','org-1257')").run();
      legacy.prepare('INSERT INTO session_events (session_id, seq, event_type, payload_json) VALUES (?,?,?,?)')
        .run('sess-bad', 1, 'legacy_note', '{}');
    } finally {
      legacy.close();
    }

    const db = openDb(path);
    try {
      // fail-closed：CHECK/数据完整性错误必须上抛（§1.3/§4-6）；若 catch 改回 log.warn 吞错 ⇒ 本断言红
      expect(() => new SessionStore(db)).toThrow(/CHECK constraint failed/i);
      // 回滚后旧表仍在（事务原子性），未留 half-migrated 表
      const residual = db.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='session_events_new'",
      ).get() as { n: number };
      expect(residual.n).toBe(0);
    } finally {
      db.close();
    }
  });
});
