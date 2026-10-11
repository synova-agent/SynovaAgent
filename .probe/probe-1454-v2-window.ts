/**
 * probe-1454-v2-window.ts — #1454 判据 V2 的窗口复刻件（Phase 2c → Phase 2e）
 *
 * 为什么需要它：卡面基线口径是「Phase2c→2e = 143,128ms」，但本机走真实入口
 * `src/index.ts` 会在 **Phase 1** 被 Node v24.19.0 的内部断言打死
 * （`node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr`，
 * 修前/修后**同一位置同一断言**，与本卡改动无关 —— 见交付评论的对照原始输出）。
 *
 * 因此本件**逐语句复刻** `src/deploy/bootstrap.ts` 的 Phase 2c 与 Phase 2e 两段，
 * 在同一进程内量出 `2c 开始 → 2e 结束` 的窗口墙钟：
 *   · Phase 2c = bootstrap.ts:463-491（loadPlaybooks + registerLoadedPlaybooks）
 *   · Phase 2d = bootstrap.ts:500-510（预留桩，0ms）
 *   · Phase 2e = bootstrap.ts:525-545（getGlobalScheduler(db) + LoopScheduler.registerDefaultLoops()）
 *
 * 用法: npx tsx .probe/probe-1454-v2-window.ts <dbCopyPath> <label>
 * @output stdout 一行 JSON
 *
 * 🔴 与 bootstrap.ts 的唯一差异（必须显式声明）：本件用**静态 import** 取代
 * bootstrap.ts 的 `await import(...)`。原因是本机 Node v24.19.0 + tsx 下
 * **动态 import() 会触发 Node 内部断言**（同一条断言也把真实入口打死在 Phase 1）——
 * 见交付评论的对照原始输出。代码语句、入参、执行顺序完全一致，只是加载时机不同。
 */
import Database from 'better-sqlite3';
// 静态 import 取代 bootstrap.ts 的 `await import(...)`（见上方口径声明）
import { loadPlaybooks, registerLoadedPlaybooks } from '../src/playbook/playbook-loader';
import { LoopScheduler } from '../src/loops/loop-scheduler';
import { getGlobalScheduler } from '../src/cron/scheduler';

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const label = process.argv[3] ?? 'unlabeled';
  if (!dbPath) {
    console.error('用法: npx tsx .probe/probe-1454-v2-window.ts <dbCopyPath> [label]');
    process.exit(2);
  }

  const db = new Database(dbPath);
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM cron_jobs').get() as { n: number }).n;

  const t0 = Date.now();

  // ─── Phase 2c（bootstrap.ts:463-491 同语句）───────────────────────────────
  let playbooks = -1;
  let playbookDegraded: string | null = null;
  try {
    const loaded = loadPlaybooks();
    playbooks = loaded.playbooks.length;
    await registerLoadedPlaybooks();
  } catch (err: unknown) {
    playbookDegraded = err instanceof Error ? err.message : String(err);
  }
  const t2c = Date.now();

  // ─── Phase 2d（bootstrap.ts:500-510 预留桩，不实现 ⇒ 0ms）────────────────
  const t2d = Date.now();

  // ─── Phase 2e（bootstrap.ts:525-545 同语句）──────────────────────────────
  let loops = -1;
  let loopDegraded: string | null = null;
  let scheduler: { stop: () => void } | null = null;
  try {
    const sched = getGlobalScheduler(db);
    scheduler = sched;
    const loopScheduler = new LoopScheduler(sched);
    loops = loopScheduler.registerDefaultLoops();
  } catch (err: unknown) {
    loopDegraded = err instanceof Error ? err.message : String(err);
  }
  const t2e = Date.now();

  if (scheduler) scheduler.stop();
  db.close();

  console.log(JSON.stringify({
    probe: 'Phase2c->2e window (bootstrap.ts 同语句复刻·静态 import)',
    label,
    inputRows: rows,
    playbooks,
    playbookDegraded,
    loopDegraded,
    loopsRegistered: loops,
    phase2c_ms: t2c - t0,
    phase2d_ms: t2d - t2c,
    phase2e_ms: t2e - t2d,
    window2c2e_ms: t2e - t0,
  }));
}

void main();
