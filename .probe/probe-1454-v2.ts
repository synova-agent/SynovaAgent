/**
 * probe-1454-v2.ts — #1454 B1 判据 V2 的可复跑测量件
 *
 * 口径（必须显式）：本探针**穿过真实构造路径** `new CronScheduler(db)`，
 * 其内部 `restoreJobs()` 对 `cron_jobs` 每一行调用一次 `nextCronTime(row.cron)`
 * —— 与 `src/deploy/bootstrap.ts:531` `getGlobalScheduler(db)` 的 Phase 2e 同一条链。
 *
 * 只测「构造」这一段（把启动期最贵的阻塞面单独拿出来），不测全 6 Phase。
 * 用法：
 *   npx tsx .probe/probe-1454-v2.ts <dbCopyPath> <label>
 * @output stdout 一行 JSON（可被 jq/逐字比对）
 */
import Database from 'better-sqlite3';
import { CronScheduler } from '../src/cron/scheduler';

const dbFile = process.argv[2];
const label = process.argv[3] ?? 'unlabeled';
if (!dbFile) {
  console.error('用法: npx tsx .probe/probe-1454-v2.ts <dbCopyPath> [label]');
  process.exit(2);
}

const db = new Database(dbFile);

// ── 输入口径（显式报出，避免「383 / 1692 / 370」口径混淆）
const rowCount = (db.prepare('SELECT COUNT(*) AS n FROM cron_jobs').get() as { n: number }).n;
const distinctCount = (db.prepare('SELECT COUNT(DISTINCT cron) AS n FROM cron_jobs').get() as { n: number }).n;
// 「退化输入」口径 = 含 `/` 或 `-` 的行（修前这些表达式解析为空集）
const degradedRows = (
  db.prepare("SELECT COUNT(*) AS n FROM cron_jobs WHERE cron LIKE '%/%' OR cron LIKE '%-%'").get() as { n: number }
).n;

const t0 = process.hrtime.bigint();
const scheduler = new CronScheduler(db);
const elapsedNs = Number(process.hrtime.bigint() - t0);
// 立刻停掉内部定时器，避免测量窗口被 tick 污染 / 进程挂住
scheduler.stop();
const elapsedMs = elapsedNs / 1e6;
const jobsRestored = scheduler.listJobs().length;

db.close();

console.log(JSON.stringify({
  probe: 'CronScheduler-ctor(restoreJobs→nextCronTime/row)',
  label,
  inputRows: rowCount,
  distinctCron: distinctCount,
  degradedRows,          // 含 `/` 或 `-` 的行数
  jobsRestored,
  elapsedMs: Number(elapsedMs.toFixed(1)),
}));
