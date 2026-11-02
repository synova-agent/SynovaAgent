/**
 * tests/cron/s1-5-single-flight.test.ts — #1257 S1.5 P0-3a · cron 单 job 单飞（U-1）
 *
 * 判据来源：`.handbook/派单件/2026-11-01-规格-1257-S1.5-P0快修.md` §1.1（行为）＋ §3 U-1（判据）
 * 现场权威：`src/cron/scheduler.ts` 的 `scheduleNextTick` / `runJob`（同批改造）
 *
 * 契约（铁律 47/48）:
 *   @input     真 `CronScheduler` ＋ `:memory:` SQLite；假时钟（`vi.useFakeTimers()` ＋ `setSystemTime`）
 *              —— 🔴 **不用真时钟**：`schedule()` 把 `nextRun` 设为下一分钟，真等 60s 不可行（U-1 注）
 *   @output    到期 ⇒ handler 执行 **恰一次**；执行期间 `listJobs()[0].inFlight === true`；
 *              结束后（含异常路径）复位为 `false`
 *   @degraded  无（纯单元测试，不降级）
 *   @error     无（用例失败即红，不吞错）
 *
 * 判别力（改坏必红，D4 复用约定）:
 *   把 `scheduleNextTick` 里的 `if (job.inFlight) { log.warn(...); continue; }` 删掉 ⇒ 本文件第一个用例
 *   在 t0+120s 处读到执行次数 **2**（期望 1）⇒ 红。**因为 handler 跨过一个整分边界仍未结束**，
 *   守卫删除后下一轮 tick 会再次派发 —— 这正是 §1.1 描述的线上事故形态（handler >1s 被重复启动）。
 *   🔴 若 handler 结束时才推进 `nextRun`（修前语义），该用例同样红 —— 两种坏法都可被本文件证伪。
 *
 * 已知限制:
 *   - 单飞是**进程内**语义：此处无法证伪「多进程共库」的跨进程重入（S2 处理；规格 §4-1）。
 *   - 用假时钟推进 ⇒ 不校验真实调度延迟（wall-clock jitter 不在视野）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CronScheduler } from '../../src/cron/scheduler';

/** 每分钟触发：假时钟起点定的整分整秒 ⇒ `nextRun` 恰为 t0+60s，无取整噪声 */
const CRON_EVERY_MINUTE = '* * * * *';

/** 假时钟起点（U-1 要求"不用真时钟"，这里由 `vi.setSystemTime` 固定） */
const T0 = new Date('2026-11-01T00:00:00.000Z');

/** 假定时器下的"睡 ms 毫秒"，用于让 handler 跨过 cron 边界 */
function sleeping(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('U-1 · cron 单 job 单飞（进程内不重入）', () => {
  let db: Database.Database;
  let scheduler: CronScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    db = new Database(':memory:');
    scheduler = new CronScheduler(db);
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
    vi.useRealTimers();
  });

  it('给定 handler 跨过一个 cron 周期仍未结束，当 tick 再次到期 则跳过（执行次数恰 1）且 inFlight 保持 true', async () => {
    const starts: number[] = [];
    scheduler.schedule('slow-job', CRON_EVERY_MINUTE, async () => {
      starts.push(Date.now());
      await sleeping(90_000); // 90s > 一个 cron 周期(60s) ⇒ 下一个 tick 到期时仍 inFlight
    });

    // t0+60s：首轮到期 ⇒ 派发一次
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts.length).toBe(1);
    expect(scheduler.listJobs()[0].inFlight).toBe(true);

    // t0+120s：cron 再次到期，handler 仍在执行（t0+150s 才结束）
    //   有守卫 ⇒ 跳过（次数仍 1）；🔴 删守卫 ⇒ 次数 2（判别力见文件头）
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts.length).toBe(1);
    expect(scheduler.listJobs()[0].inFlight).toBe(true);
  });

  it('给定正常结束的 handler，当执行完毕 则 inFlight 复位为 false（finally 复位）', async () => {
    let done = 0;
    scheduler.schedule('fast-job', CRON_EVERY_MINUTE, async () => {
      done++;
      await sleeping(5_000);
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(done).toBe(1);
    expect(scheduler.listJobs()[0].inFlight).toBe(true);

    // 停掉 tick 只为隔离观察（否则下一轮整分会再次派发，观测值被调度语义污染）
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(scheduler.listJobs()[0].inFlight).toBe(false);
    expect(scheduler.listJobs()[0].runs).toBe(1);
  });

  it('给定 handler 抛错，当执行结束 则 inFlight 同样复位（异常路径不得泄漏单飞标记）', async () => {
    scheduler.schedule('boom-job', CRON_EVERY_MINUTE, async () => {
      throw new Error('handler 内部普通失败'); // 无 code ⇒ 按可重试（规格 §1.2-1 v3）
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(1_000); // 让失败记账的微任务收尾

    const job = scheduler.listJobs()[0];
    expect(job.inFlight).toBe(false);
    expect(job.failures).toBe(1);
  });

  it('给定同一 job 正在执行，当显式 executeNow 则跳过（不产生并发重入）', async () => {
    const starts: number[] = [];
    scheduler.schedule('manual-prop', CRON_EVERY_MINUTE, async () => {
      starts.push(Date.now());
      await sleeping(30_000);
    });

    await vi.advanceTimersByTimeAsync(60_000); // 派发第 1 次（inFlight = true）
    expect(starts.length).toBe(1);

    await scheduler.executeNow('manual-prop'); // 显式触发同一 job：单飞 ⇒ 跳过
    expect(starts.length).toBe(1);
  });
});
