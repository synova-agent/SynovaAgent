/**
 * tests/cron/scheduler.test.ts — D94 CronScheduler Hybrid 测试
 *                              ＋ #1257 S1.5 P0-3b 失败分类 / 有界退避 / 终态 disabled（U-2）
 *
 * 覆盖: cron-only/event/hybrid/degrade = 8 tests ＋ U-2 六例（分类/退避/终态/耐久/迁移/成功清零）
 *
 * 后 6 例（`#1257` 段）的契约（铁律 47/48）:
 *   @input     真 `CronScheduler` ＋ SQLite（`:memory:` 或**文件库**）；假时钟固定 `Date.now()`
 *   @output    失败按 `code`/`retryable` 分流：显式不可重试 ⇒ 一次即 `disabled`；可重试 ⇒
 *              `attempts` 递增 ＋ `nextRun` 退避差值单调增（≤30min）；`attempts>=5` ⇒ `disabled`；
 *              `disabled` 跨重启耐久（文件库新实例 ＋ `schedule(同名)` 认领既有行后仍 disabled）
 *   @degraded  无（纯单测）
 *   @error     无（用例失败即红）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiagnosticAgentError } from '@synova/error-types';
import { CronScheduler, classifyFailure, onEventType, emitEvent } from '../../src/cron/scheduler';

describe('CronScheduler', () => {
  let db: Database.Database;
  let scheduler: CronScheduler;
  let executionLog: string[];

  beforeEach(() => {
    db = new Database(':memory:');
    scheduler = new CronScheduler(db);
    executionLog = [];
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
  });

  describe('cron-only（向后兼容）', () => {
    it('schedule 不传 triggerType → 默认为 cron', () => {
      const id = scheduler.schedule('test-cron', '0 0 * * *', async () => { executionLog.push('cron'); });
      const jobs = scheduler.listJobs();
      const job = jobs.find(j => j.id === id);
      expect(job?.triggerType).toBe('cron');
    });

    it('cron-only 不受事件影响', async () => {
      scheduler.schedule('cron-only', '0 0 * * *', async () => { executionLog.push('cron'); }, 'cron');
      const fired = await scheduler.onEvent('any-event');
      expect(fired.length).toBe(0);
      expect(executionLog.length).toBe(0);
    });

    it('listJobs 包含 triggerType/eventTypes', () => {
      scheduler.schedule('test', '* * * * *', async () => {}, 'cron');
      const jobs = scheduler.listJobs();
      expect(jobs[0]).toHaveProperty('triggerType');
      expect(jobs[0]).toHaveProperty('eventTypes');
    });
  });

  describe('event trigger', () => {
    it('event 类型 → onEvent 触发执行', async () => {
      scheduler.schedule('evt-job', '0 0 * * *', async () => { executionLog.push('event'); }, 'event', ['my-event']);
      const fired = await scheduler.onEvent('my-event');
      expect(fired.length).toBe(1);
      expect(executionLog).toContain('event');
    });

    it('未注册事件 → 不触发', async () => {
      scheduler.schedule('evt-job', '0 0 * * *', async () => { executionLog.push('event'); }, 'event', ['my-event']);
      const fired = await scheduler.onEvent('other-event');
      expect(fired.length).toBe(0);
    });
  });

  describe('hybrid trigger', () => {
    it('hybrid → 事件触发 + 执行', async () => {
      scheduler.schedule('hyb-job', '0 0 1 * *', async () => { executionLog.push('hybrid'); }, 'hybrid', ['alert']);
      const fired = await scheduler.onEvent('alert');
      expect(fired.length).toBe(1);
      expect(executionLog).toContain('hybrid');
    });
  });

  describe('registerEventTrigger', () => {
    it('运行时注册事件 → 可触发', async () => {
      const id = scheduler.schedule('dyn-job', '0 0 * * *', async () => { executionLog.push('dyn'); }, 'event', []);
      scheduler.registerEventTrigger(id, 'dynamic-event');
      const fired = await scheduler.onEvent('dynamic-event');
      expect(fired.length).toBe(1);
    });
  });

  describe('emitEvent 全局函数', () => {
    it('emitEvent → 触发 cron scheduler', async () => {
      scheduler.schedule('emit-test', '0 0 * * *', async () => { executionLog.push('emit'); }, 'event', ['external']);
      emitEvent('external');
      // 异步执行，给一点时间
      await new Promise(r => setTimeout(r, 50));
      expect(executionLog).toContain('emit');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #1257 S1.5 P0-3b · 失败分类 ＋ 有界退避 ＋ 终态 disabled（U-2）
// ═══════════════════════════════════════════════════════════════════════════════

/** 假时钟起点：整分整秒 ⇒ `nextRun` 计算无取整噪声 */
const T0_U2 = new Date('2026-11-01T00:00:00.000Z');
/** 每分钟触发（最小周期，便于用假时钟越过多个边界） */
const CRON_EVERY_MINUTE = '* * * * *';
/** 退避上限（规格 §1.2-2：30min）—— 断言"差值 ≤ 30min"用 */
const BACKOFF_CAP_MS = 30 * 60 * 1000;

describe('#1257 S1.5 P0-3b · 失败分类 ＋ 有界退避 ＋ 终态 disabled（U-2）', () => {
  let db: Database.Database;
  let scheduler: CronScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_U2);
    db = new Database(':memory:');
    scheduler = new CronScheduler(db);
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
    vi.useRealTimers();
  });

  /** 取快照里的单个作业（缺失即抛 —— 夹具缺失不得静默） */
  function jobOf(name: string): ReturnType<CronScheduler['listJobs']>[number] {
    const found = scheduler.listJobs().find((j) => j.name === name);
    if (!found) throw new Error(`夹具缺失：作业 ${name} 未注册`);
    return found;
  }

  it('U-2a 显式不可重试 code ⇒ 一次失败即 disabled、last_error_code 落库、越过 cron 边界也不再自动跑', async () => {
    let calls = 0;
    scheduler.schedule('boom-unretryable', CRON_EVERY_MINUTE, async () => {
      calls++;
      throw new DiagnosticAgentError('CRON_BOOM', '不可重试失败样例', 0, false);
    });

    await scheduler.executeNow('boom-unretryable');

    const job = jobOf('boom-unretryable');
    expect(job.attempts).toBe(1);
    expect(job.failures).toBe(1);
    expect(job.lastErrorCode).toBe('CRON_BOOM');
    expect(job.disabled).toBe(true);

    // 终态：越过两个 cron 边界也不自动跑
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
  });

  it('U-2b 可重试失败 ⇒ attempts 递增、nextRun 退避差值单调增且 ≤30min', async () => {
    scheduler.schedule('flaky', CRON_EVERY_MINUTE, async () => {
      throw new DiagnosticAgentError('CRON_RETRYABLE', '可重试失败样例', 0, true);
    });

    const deltas: number[] = [];
    for (let i = 1; i <= 4; i++) {
      await scheduler.executeNow('flaky');
      const job = jobOf('flaky');
      expect(job.attempts).toBe(i);
      expect(job.disabled).toBe(false);
      deltas.push(job.nextRun - Date.now());
    }

    expect(deltas).toEqual([30_000, 60_000, 120_000, 240_000]);
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeGreaterThan(deltas[i - 1]);
    for (const d of deltas) expect(d).toBeLessThanOrEqual(BACKOFF_CAP_MS);
  });

  it('U-2c 可重试失败达 MAX_ATTEMPTS=5 ⇒ disabled 终态，之后不再自动跑', async () => {
    let calls = 0;
    scheduler.schedule('flaky-five', CRON_EVERY_MINUTE, async () => {
      calls++;
      throw new DiagnosticAgentError('CRON_RETRYABLE', '可重试失败样例', 0, true);
    });

    for (let i = 1; i <= 5; i++) await scheduler.executeNow('flaky-five');

    const job = jobOf('flaky-five');
    expect(job.attempts).toBe(5);
    expect(job.disabled).toBe(true);
    expect(calls).toBe(5);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(5);
  });

  it('U-2d 无 code 的普通 Error ⇒ 按可重试处理（不得一次打死 7×24 作业，规格 §1.2-1 v3）', async () => {
    scheduler.schedule('plain-error', CRON_EVERY_MINUTE, async () => {
      throw new Error('handler 内部普通失败');
    });

    await scheduler.executeNow('plain-error');

    const job = jobOf('plain-error');
    expect(job.lastErrorCode).toBeNull();
    expect(job.attempts).toBe(1);
    expect(job.disabled).toBe(false);
    expect(job.lastError).toContain('handler 内部普通失败');
  });

  it('U-2e 由失败转成功后 ⇒ attempts/failures 清零、lastErrorCode 清空、nextRun 不被成功路径二次改写', async () => {
    let shouldFail = true;
    scheduler.schedule('recover', CRON_EVERY_MINUTE, async () => {
      if (shouldFail) throw new DiagnosticAgentError('CRON_RETRYABLE', '可重试失败样例', 0, true);
    });

    await scheduler.executeNow('recover');
    expect(jobOf('recover').attempts).toBe(1);

    shouldFail = false;
    const nextRunBefore = jobOf('recover').nextRun;
    await scheduler.executeNow('recover');

    const job = jobOf('recover');
    expect(job.attempts).toBe(0);
    expect(job.failures).toBe(0);
    expect(job.lastErrorCode).toBeNull();
    expect(job.runs).toBe(1);
    expect(job.lastRunAt).not.toBeNull();
    // 成功路径**不再**写 nextRun（修前会二次推进 ⇒ 覆盖调度侧派发时已推进的值）
    expect(job.nextRun).toBe(nextRunBefore);
  });

  it('U-2f 文件库重启 ⇒ disabled 耐久：新实例 restore + schedule(同名) 认领既有行后仍 disabled、attempts 保留、不参与 tick', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cron-1257-'));
    const dbFile = path.join(dir, 'cron.db');
    let calls = 0;
    let db1: Database.Database | null = null;
    let s1: CronScheduler | null = null;
    let db2: Database.Database | null = null;
    let s2: CronScheduler | null = null;

    try {
      db1 = new Database(dbFile);
      s1 = new CronScheduler(db1);
      s1.schedule('durable-job', CRON_EVERY_MINUTE, async () => {
        calls++;
        throw new DiagnosticAgentError('CRON_BOOM', '终态耐久样例', 0, false);
      });
      await s1.executeNow('durable-job');

      const before = s1.listJobs()[0];
      expect(before.disabled).toBe(true);
      expect(before.attempts).toBe(1);
      s1.stop();
      db1.close();
      s1 = null;
      db1 = null;

      // 重启：新实例（同一库文件）⇒ restoreJobs 恢复三列；再 schedule(同名) 必须认领既有行（规格 §1.2-7 方案①）
      db2 = new Database(dbFile);
      s2 = new CronScheduler(db2);
      s2.schedule('durable-job', CRON_EVERY_MINUTE, async () => {
        calls++;
      });

      const after = s2.listJobs().find((j) => j.name === 'durable-job');
      if (!after) throw new Error('夹具缺失：重启后作业 durable-job 不在列表');
      expect(s2.listJobs()).toHaveLength(1); // 认领而非新插一行
      expect(after.id).toBe(before.id); // 复用既有行 id
      expect(after.disabled).toBe(true); // 终态跨重启耐久（禁被新 id 复活）
      expect(after.attempts).toBe(1);
      expect(after.lastErrorCode).toBe('CRON_BOOM');

      await vi.advanceTimersByTimeAsync(180_000); // 越过三个 cron 边界
      expect(calls).toBe(1); // 不参与 tick
    } finally {
      // 🔴 原生句柄必须在**断言失败路径**也关闭：否则 GC 时 better-sqlite3 析构 SIGABRT 整个
      //    测试 worker（"Worker exited unexpectedly"），把真实断言失败掩盖成基础设施错误。
      if (s1) s1.stop();
      if (db1) db1.close();
      if (s2) s2.stop();
      if (db2) db2.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('U-2g 旧 schema 库（无三列）⇒ 自迁移补列，旧行按 attempts=0/disabled=0 恢复且列真实存在', () => {
    const legacyDb = new Database(':memory:');
    let schedulerUnderTest: CronScheduler | null = null;
    try {
      legacyDb.exec(`
        CREATE TABLE cron_jobs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, cron TEXT NOT NULL,
          last_run_at TEXT, last_error TEXT, failures INTEGER DEFAULT 0, runs INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
      legacyDb.prepare('INSERT INTO cron_jobs (id, name, cron, failures, runs) VALUES (?,?,?,?,?)')
        .run('legacy_1', 'legacy-job', '0 9 * * 1', 2, 7);

      schedulerUnderTest = new CronScheduler(legacyDb);
      const job = schedulerUnderTest.listJobs()[0];
      expect(job.failures).toBe(2);
      expect(job.runs).toBe(7);
      expect(job.attempts).toBe(0); // 旧行缺列 ⇒ 按 0 恢复
      expect(job.disabled).toBe(false);

      const columns = (legacyDb.prepare('PRAGMA table_info(cron_jobs)').all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(columns).toContain('last_error_code');
      expect(columns).toContain('attempts');
      expect(columns).toContain('disabled');
    } finally {
      if (schedulerUnderTest) schedulerUnderTest.stop();
      legacyDb.close();
    }
  });

  it('U-2h 分类器四形态：显式不可重试 / 带码无声明 / 无码 / 非 Error 抛出值', () => {
    // ① `DiagnosticAgentError` ＋ retryable:false ⇒ **唯一**「显式不可重试」信号
    const typed = classifyFailure(new DiagnosticAgentError('CRON_BOOM', 'boom', 0, false));
    expect(typed.code).toBe('CRON_BOOM');
    expect(typed.retryable).toBe(false);

    // ② 普通对象带 code 但无 retryable 声明 ⇒ 取码 ＋ **按可重试**（不得据"有码"推断不可重试）
    const coded = classifyFailure(Object.assign(new Error('coded'), { code: 'CRON_SOFT' }));
    expect(coded.code).toBe('CRON_SOFT');
    expect(coded.retryable).toBe(true);

    // ③ 无码 Error ⇒ code=null ＋ 可重试（规格 §1.2-1 v3：无码即打死会把 7×24 哨兵一次打死）
    const plain = classifyFailure(new Error('plain'));
    expect(plain.code).toBeNull();
    expect(plain.message).toBe('plain');
    expect(plain.retryable).toBe(true);

    // ④ 非 Error 抛出值（handler 可抛任意值）⇒ 不崩、message 为字符串化结果
    const thrown = classifyFailure('字符串抛出值');
    expect(thrown.code).toBeNull();
    expect(thrown.message).toBe('字符串抛出值');
    expect(thrown.retryable).toBe(true);
  });
});
