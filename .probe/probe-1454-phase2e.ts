/**
 * probe-1454-phase2e.ts — #1454 判据 V2/V4 的 Phase 2e 段实测件
 *
 * 口径：逐语句复刻 `src/deploy/bootstrap.ts:525-545`（Phase 2e）：
 *   `getGlobalScheduler(db)` → `new LoopScheduler(scheduler)` → `registerDefaultLoops()`
 * 并列出注册结果（job 名 / cron / nextRun），证明 6 个内置循环**真的**注册到真实
 * CronScheduler 上（不是单测里的 stub），且 loop-3 的口径是配置解析出来的值。
 *
 * 用法: npx tsx .probe/probe-1454-phase2e.ts <dbCopyPath> <label>
 * @output stdout 一行 JSON
 */
import Database from 'better-sqlite3';
import { LoopScheduler } from '../src/loops/loop-scheduler';
import { getGlobalScheduler } from '../src/cron/scheduler';

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const label = process.argv[3] ?? 'unlabeled';
  if (!dbPath) {
    console.error('用法: npx tsx .probe/probe-1454-phase2e.ts <dbCopyPath> [label]');
    process.exit(2);
  }

  const db = new Database(dbPath);
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM cron_jobs').get() as { n: number }).n;

  const t0 = Date.now();
  const scheduler = getGlobalScheduler(db);          // ← Phase 2e 第一句（含 CronScheduler 构造）
  const mid = Date.now();
  const loopScheduler = new LoopScheduler(scheduler); // ← Phase 2e 第二句
  const count = loopScheduler.registerDefaultLoops(); // ← Phase 2e 第三句
  const t1 = Date.now();

  const jobs = scheduler.listJobs()
    .filter((j) => j.name.startsWith('loop-') || j.name.startsWith('system-'))
    .map((j) => ({ name: j.name, cron: j.cron, nextRun: new Date(j.nextRun).toISOString() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  scheduler.stop();
  db.close();

  console.log(JSON.stringify({
    probe: 'Phase2e 段（bootstrap.ts:525-545 同语句）',
    label,
    inputRows: rows,
    cronSchedulerInitMs: mid - t0,
    loopRegisterMs: t1 - mid,
    phase2eMs: t1 - t0,
    loopsRegistered: count,
    registeredJobs: jobs,
  }));
}

void main();
