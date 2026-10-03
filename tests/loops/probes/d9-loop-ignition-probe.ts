/**
 * tests/loops/probes/d9-loop-ignition-probe.ts — #975 L2 原始证据探针（非 vitest 用例）
 *
 * 用途: 以**真实 logger（pino → stderr）**跑一次「生产装配 → 内置循环触发」，把
 *   `[D9] MainAgent 未注入 — 跳过 loop-1 (degraded)` 的有/无 + MainAgent 的真实
 *   executionCount 落成原始输出（stdout=JSON 摘要，stderr=原始日志）。
 *
 * 判据四步（改坏即红留档）:
 *   step1 运行本探针 → stdout executionCount=1 / stderr 无「未注入」        （绿）
 *   step2 注释 src/server.ts:wireLoopExecution 内的 bindMainAgent(mainAgent) → 同上必红
 *   step3 恢复 → 回绿
 *   step4 `git diff --stat src/server.ts` 与 step1 一致（无残留）
 *
 * 运行: node_modules/.bin/tsx tests/loops/probes/d9-loop-ignition-probe.ts 2> /tmp/d9-probe.stderr.log
 * 说明: 不落仓库运行产物；心跳文件写 .codex/heartbeat.json（仓内既有测试同款，测后自清）。
 */
import { rmSync } from 'fs';
import { join } from 'path';
import { LoopScheduler, type CronSchedulerLike } from '../../../src/loops/loop-scheduler';
import { getBoundMainAgent } from '../../../src/loops/main-agent-binding';
import { setDiagnosisDeps } from '../../../src/agent/loop-handlers';
import { wireLoopExecution } from '../../../src/server';

class CaptureScheduler implements CronSchedulerLike {
  readonly jobs = new Map<string, { cron: string; handler: () => Promise<void> }>();

  schedule(name: string, cron: string, handler: () => Promise<void>): string {
    this.jobs.set(name, { cron, handler });
    return name;
  }

  async fire(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`job ${name} 未注册`);
    await job.handler();
  }
}

async function main(): Promise<void> {
  // loop-1 依赖桩: GOAL 图空 → handler 走「无 active 目标」降级分支（不触 DB / 不接 LLM）
  setDiagnosisDeps({
    getStore: () => ({ createNode: () => 'stub', getNode: () => null, updateNode: () => {}, queryNodes: () => [] }),
    getGoal: () => null,
    callExpert: async () => ({ suggestedAdjustment: 'adjust_target' as const, description: 'probe stub', degraded: false }),
  });

  const wiring = wireLoopExecution();
  const capture = new CaptureScheduler();
  new LoopScheduler(capture);            // 与生产同构: 构造即注册 6 个内置 cron 循环
  await capture.fire('loop-1-diagnosis'); // 等价 cron 到点（0 9 1 */3 * 无法等待）

  const rec = wiring.mainAgent?.listLoops().find((l) => l.config.loopId === 'loop-1');
  console.log(JSON.stringify({
    ok: wiring.ok,
    degraded: wiring.degraded,
    bound: getBoundMainAgent() === wiring.mainAgent,
    builtinJobs: [...capture.jobs.keys()],
    loop1ExecutionCount: rec?.executionCount ?? null,
    loop1Status: rec?.lastExecution?.status ?? 'pending',
    loop1Scale: rec?.lastExecution?.scale ?? null,
  }, null, 2));

  setDiagnosisDeps(null);
  // 点火会写 .codex/heartbeat.json（recordHeartbeat）——探针自清，不落仓库运行产物
  try { rmSync(join(process.cwd(), '.codex', 'heartbeat.json'), { force: true }); } catch { /* 清理失败不阻断 */ }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ probeError: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
