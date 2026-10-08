/**
 * probe-1454-b8-config.ts — #1454 B8 的**真实进程**取证（非 vitest 环境）
 *
 * 为什么要单独跑：本卡的 Phase 2e 整段复刻件（`.probe/probe-1454-phase2e.ts`）在
 * 本机 Node v24.19.0 下会触发 Node 内部断言（`RemoveEnvironmentCleanupHook ... (env) != nullptr`）
 * —— 与 `src/index.ts` 真实入口同一个断言（见交付评论）。故至少把 **cron 口径解析**
 * 这一段在真实 tsx 进程里跑出来，证明它不是只在测试环境成立。
 *
 * 用法: npx tsx .probe/probe-1454-b8-config.ts [jobName]
 * @output stdout 一行 JSON（含 6 个循环的解析口径 + loop-3 的下一次触发时延）
 */
import { DEFAULT_LOOP_CRON, resolveLoopCron } from '../src/cron/cron-config';
import { nextCronTime } from '../src/cron/scheduler';

const job = process.argv[2] ?? 'loop-3-ga-evolution';
const from = new Date();

const all = Object.keys(DEFAULT_LOOP_CRON)
  .sort()
  .map((j) => ({ job: j, cron: resolveLoopCron(j) }));

const resolved = resolveLoopCron(job);

console.log(JSON.stringify({
  probe: 'B8 cron 口径解析（真实 tsx 进程）',
  pid: process.pid,
  job,
  resolved,
  nextFireAt: nextCronTime(resolved, from).toISOString(),
  hoursUntilNextFire: Number(((nextCronTime(resolved, from).getTime() - from.getTime()) / 3.6e6).toFixed(2)),
  allLoops: all,
}));
