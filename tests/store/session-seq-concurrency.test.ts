/**
 * tests/store/session-seq-concurrency.test.ts — R-E1 ② seq 原子分配 ＋ 读侧连续性 ＋ busy_timeout（#1165）
 *
 * 判据（设计稿 §2.2；**改坏必红**承重点逐条注明）:
 *   T2a 20 子进程 ×100 写**同一会话**（真实 `SessionStore.appendEvent`，fixture `fixtures/seq-writer.ts`）
 *       ⇒ `COUNT=2000 ∧ MIN=1 ∧ MAX=2000 ∧ COUNT(DISTINCT)=2000 ∧ 子进程 degraded 合计=0`
 *       🔴 改坏必红点：单语句原子改回"先 SELECT MAX 再 INSERT" ⇒ 实测 1936/2000、64 degraded ⇒ 红
 *          （该变异**不入 CI**，由独立自验员在 /tmp 副本贴改前/改后原始输出）
 *   T2c 人为删 seq2 ⇒ `deriveMessages` 值语义不变（仍 2 条）＋ `lastDegraded=true`；
 *       且**写侧只报不猜**：不填洞、不重置，续写 seq = MAX+1（=4）
 *   T2d 无缺口 ⇒ 不置位；空事件流 ⇒ 不置位（边界，防假绿）
 *   T2e cap=3 ⇒ 第 4 条抛 `SESSION_EVENT_LIMIT`（写库前拒，`COUNT(*)` 抛前/抛后都 =3、seq 无空洞）
 *   T2f `SYNO_SESSION_SEQ_ATOMIC=0` ⇒ 旧"读后写"路径单线程仍得 1..N（开关可用；不要求并发也绿）
 *   T2g **BUSY 路径**（L1 裁定 3）：第二连接 `BEGIN IMMEDIATE` 持写锁 ⇒ `SYNO_SESSION_BUSY_TIMEOUT_MS=50`
 *       的 store 两次等待窗后返回 degraded（error 含 busy/locked）＋ 降级可见；释放锁后同 store 再写成功
 *
 * 契约（铁律 47）:
 *   @input    — 每用例独立库（`:memory:` 或 mkdtemp 文件库）；子进程 env 显式剔除本批开关（判据纪律②）
 *   @output   — vitest 断言；聚合值一律**父进程只读直查 SQL**（不靠子进程自证，判据③）
 *   @degraded — 环境失败（fixture 缺失 / `--import tsx` 失败）⇒ 抛 `ENV:` 前缀错误（三态口径：
 *               环境失败**不得**被当作通过；vitest 无 exit 2，等价物＝前置断言 + 消息前缀）
 *   @serial   — T2a 是重型用例（20 子进程）；`testTimeout=60s`，文件内用例顺序执行
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SessionStore,
  SessionEventError,
  DEFAULT_SESSION_BUSY_TIMEOUT_MS,
  MAX_SESSION_BUSY_TIMEOUT_MS,
  sessionBusyTimeoutMs,
} from '../../src/store/session-store';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(HERE, 'fixtures', 'seq-writer.ts');

/** 子进程必须显式剔除的开关键（防止外层环境/CI 变量把变异开关带进并发用例 ⇒ 假绿） */
const ENV_KEYS = [
  'SYNO_SESSION_TX',
  'SYNO_SESSION_SEQ_ATOMIC',
  'SYNO_MAX_SESSION_EVENTS',
  'SYNO_SESSION_EVENT_STRICT',
  'SYNO_SESSION_BUSY_TIMEOUT_MS',
] as const;

/** 三态口径：环境失败 ⇒ `ENV:` 前缀（vitest 无 exit 2 的等价物） */
function expectEnv(condition: boolean, detail: string): void {
  if (!condition) throw new Error(`ENV: ${detail}`);
}

/** 子进程 env：继承 + 剔除本批开关（判据纪律② 环境隔离） */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ENV_KEYS) delete env[key];
  return env;
}

interface WriterResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 起一个真实写者子进程（与仓内既有 `node --import tsx` 范式同形） */
function runWriter(dbPath: string, sessionId: string, count: number): Promise<WriterResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', FIXTURE, dbPath, sessionId, String(count)],
      { cwd: REPO_ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => resolve({ code: null, stdout, stderr: `${stderr}\n${String(err)}` }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** 直查事件聚合（独立证据链：父进程只读直查，不采信子进程自报） */
function aggregate(db: Database.Database, sessionId: string): { n: number; min: number; max: number; d: number } {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MIN(seq) AS min, MAX(seq) AS max, COUNT(DISTINCT seq) AS d FROM session_events WHERE session_id=?',
    )
    .get(sessionId) as { n: number; min: number; max: number; d: number };
  return { n: row.n, min: row.min, max: row.max, d: row.d };
}

function countEvents(db: Database.Database, sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM session_events WHERE session_id=?').get(sessionId) as { c: number };
  return row.c;
}

describe('R-E1 ② seq 原子分配（跨进程）', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it(
    'T2a 20 子进程 ×100 写同一会话 ⇒ 2000 条、seq 1..2000 连续、0 degraded',
    { timeout: 60_000 },
    async () => {
      expectEnv(existsSync(FIXTURE), `fixture 缺失: ${FIXTURE}`);
      const dir = mkdtempSync(path.join(tmpdir(), 'e1-seq-concurrency-'));
      const dbPath = path.join(dir, 'seq.db');
      try {
        // 父进程先建 schema + 会话（避免 20 个子进程并发做 DDL；WAL 让写者排队而不是互斥失败）
        const setupDb = new Database(dbPath);
        setupDb.pragma('journal_mode = WAL');
        const setupStore = new SessionStore(setupDb);
        const sessionId = setupStore.createSession('org-t2a').id;
        setupDb.close();

        const CHILDREN = 20;
        const PER_CHILD = 100;
        const results = await Promise.all(
          Array.from({ length: CHILDREN }, () => runWriter(dbPath, sessionId, PER_CHILD)),
        );

        // 子进程自身健康（`--import tsx` 失败/参数失败 ⇒ code≠0 ⇒ ENV 口径）
        const bad = results.filter((r) => r.code !== 0);
        expectEnv(
          bad.length === 0,
          `${bad.length} 个子进程非 0 退出；首个 stderr=${(bad[0]?.stderr ?? '').slice(-500)}`,
        );

        let ok = 0;
        let degraded = 0;
        for (const r of results) {
          const parsed = JSON.parse(r.stdout.trim()) as { ok: number; degraded: number };
          ok += parsed.ok;
          degraded += parsed.degraded;
        }
        expect(ok).toBe(CHILDREN * PER_CHILD);
        // 🔴 改坏必红点：改回"读后写" ⇒ degraded>0 且总数 <2000（P5 实测 1936/64）
        expect(degraded).toBe(0);

        // 父进程只读直查（不采信子进程自报）
        const verifyDb = new Database(dbPath);
        const agg = aggregate(verifyDb, sessionId);
        expect(agg).toEqual({ n: 2000, min: 1, max: 2000, d: 2000 });
        verifyDb.close();

        // 读侧：无缺口 ⇒ 投影 2000 条、不置位
        const readDb = new Database(dbPath);
        const readStore = new SessionStore(readDb);
        const events = readStore.getEvents(sessionId);
        expect(events).toHaveLength(2000);
        expect(events.every((ev, i) => ev.seq === i + 1)).toBe(true);
        expect(readStore.deriveMessages(sessionId)).toHaveLength(2000);
        expect(readStore.lastDegraded).toBe(false);
        readDb.close();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('T2c 删 seq2 ⇒ 读侧 degraded（值语义不变）＋ 写侧续 MAX+1（只报不猜/不填洞）', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-t2c').id;
    store.addMessage(sessionId, 'user', 'e1');
    store.addMessage(sessionId, 'assistant', 'e2');
    store.addMessage(sessionId, 'user', 'e3');
    expect(store.deriveMessages(sessionId)).toHaveLength(3);
    expect(store.lastDegraded).toBe(false); // 无缺口边界（先证不假绿）

    db.prepare('DELETE FROM session_events WHERE session_id=? AND seq=?').run(sessionId, 2);
    const derived = store.deriveMessages(sessionId);
    // 返回值语义不变：仍返回全部可投影消息（2 条），只加信号
    expect(derived.map((m) => m.content)).toEqual(['e1', 'e3']);
    expect(store.lastDegraded).toBe(true);

    // 写侧只报不猜：不补 seq2、不重置 seq —— 续写 = MAX(3)+1 = 4
    expect(store.appendEvent(sessionId, 'message', { role: 'user', content: 'e4' })).toEqual({ ok: true, seq: 4 });
    expect(store.getEvents(sessionId).map((e) => e.seq)).toEqual([1, 3, 4]);
    db.close();
  });

  it('T2d 无缺口/空事件流 ⇒ 不置位（边界，防假绿）', () => {
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-t2d').id;
    expect(store.deriveMessages(sessionId)).toEqual([]);
    expect(store.lastDegraded).toBe(false);
    store.addMessage(sessionId, 'user', 'a');
    store.addMessage(sessionId, 'assistant', 'b');
    expect(store.deriveMessages(sessionId)).toHaveLength(2);
    expect(store.lastDegraded).toBe(false);
    db.close();
  });

  it('T2e cap=3 ⇒ 第 4 条抛 SESSION_EVENT_LIMIT，抛前/抛后 COUNT 都 =3、seq 无空洞', () => {
    process.env.SYNO_MAX_SESSION_EVENTS = '3';
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-t2e').id;
    for (let i = 1; i <= 3; i++) {
      expect(store.appendEvent(sessionId, 'system', { n: i })).toEqual({ ok: true, seq: i });
    }
    const before = countEvents(db, sessionId);
    expect(before).toBe(3);

    let caught: unknown;
    try {
      store.appendEvent(sessionId, 'system', { n: 4 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionEventError);
    if (caught instanceof SessionEventError) {
      expect(caught.code).toBe('SESSION_EVENT_LIMIT');
      expect(caught.phase).toBe('validate');
      // 可执行指引保留（既有用例同口径）
      expect(caught.message).toContain('SYNO_MAX_SESSION_EVENTS');
      expect(caught.message).toContain('新开一个会话');
      expect(caught.message).toContain('seq=4'); // 原子路径在错误文案报真实 nextSeq
    }
    // 写库前拒：原子语句 HAVING 过滤 ⇒ 行数不变（不是"先写后删"）
    expect(countEvents(db, sessionId)).toBe(before);
    expect(store.getEvents(sessionId).map((e) => e.seq)).toEqual([1, 2, 3]);
    db.close();
  });

  it('T2f SYNO_SESSION_SEQ_ATOMIC=0 ⇒ 旧"读后写"路径单线程仍得 1..N（开关可用）', () => {
    process.env.SYNO_SESSION_SEQ_ATOMIC = '0';
    const db = new Database(':memory:');
    const store = new SessionStore(db);
    const sessionId = store.createSession('org-t2f').id;
    for (let i = 1; i <= 5; i++) {
      expect(store.appendEvent(sessionId, 'message', { role: 'user', content: `m${i}` })).toEqual({
        ok: true,
        seq: i,
      });
    }
    expect(store.getEvents(sessionId).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    db.close();
  });

  it('T2g BUSY：持锁连接下 appendEvent 两次等待窗后降级（可见），释放锁后可写且无空洞', () => {
    // 构造不出 BUSY 才算"已知限制"；L1 裁定 3 要求必须构造（本用例即构造点）
    const dir = mkdtempSync(path.join(tmpdir(), 'e1-seq-busy-'));
    const dbPath = path.join(dir, 'busy.db');
    process.env.SYNO_SESSION_BUSY_TIMEOUT_MS = '50';
    const storeDb = new Database(dbPath);
    try {
      storeDb.pragma('journal_mode = WAL');
      const store = new SessionStore(storeDb); // 逐构造读取 ⇒ busy_timeout=50
      // pragma 真的落到了连接上（不是只算了变量）
      expect(storeDb.pragma('busy_timeout', { simple: true })).toBe(50);
      const sessionId = store.createSession('org-t2g').id;

      const blocker = new Database(dbPath);
      let res: ReturnType<SessionStore['appendEvent']>;
      let elapsedMs = 0;
      try {
        blocker.exec('BEGIN IMMEDIATE'); // 独占写锁
        const t0 = performance.now();
        res = store.appendEvent(sessionId, 'system', { n: 1 });
        elapsedMs = performance.now() - t0;
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/busy|locked/i);
        // 重试 1 次 ⇒ 至少两次 50ms 等待窗（不是静默卡死，也不是立刻放弃）
        expect(elapsedMs).toBeGreaterThanOrEqual(40);
        // 降级可见（不是静默丢事件）
        expect(store.lastDegraded).toBe(true);
        // 失败未消耗 seq（无空洞）
        expect(countEvents(storeDb, sessionId)).toBe(0);
      } finally {
        blocker.exec('COMMIT');
        blocker.close();
      }

      // 释放锁后同一 store 再写成功，seq 从 1 开始（失败不留洞）
      expect(store.appendEvent(sessionId, 'system', { n: 2 })).toEqual({ ok: true, seq: 1 });
      expect(countEvents(storeDb, sessionId)).toBe(1);
    } finally {
      storeDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T2h busy_timeout 解析 clamp [1,60000]（L1 裁定 3；逐构造读取）', () => {
    const cases: Array<[string | undefined, number]> = [
      [undefined, DEFAULT_SESSION_BUSY_TIMEOUT_MS],
      ['0', DEFAULT_SESSION_BUSY_TIMEOUT_MS],
      ['abc', DEFAULT_SESSION_BUSY_TIMEOUT_MS],
      ['-5', 1],
      ['50', 50],
      [String(MAX_SESSION_BUSY_TIMEOUT_MS + 1), MAX_SESSION_BUSY_TIMEOUT_MS],
    ];
    for (const [raw, expected] of cases) {
      if (raw === undefined) delete process.env.SYNO_SESSION_BUSY_TIMEOUT_MS;
      else process.env.SYNO_SESSION_BUSY_TIMEOUT_MS = raw;
      expect(sessionBusyTimeoutMs()).toBe(expected);
    }
    // 构造期真的按 env 设到连接上（逐构造读取，不是模块加载时算死）
    process.env.SYNO_SESSION_BUSY_TIMEOUT_MS = '1234';
    const db = new Database(':memory:');
    new SessionStore(db);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(1234);
    db.close();
  });
});
