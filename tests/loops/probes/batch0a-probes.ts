/**
 * tests/loops/probes/batch0a-probes.ts — 第0批总闸 A 的 L2 原始证据探针（非 vitest 用例）
 *
 * 两个总闸一次跑完（stdout = JSON 摘要；stderr = 真实 pino 日志原样）：
 *   case #975（0-1 循环点火）: 生产装配函数 `wireLoopExecution()` → 捕获式 CronScheduler → 唤起
 *                              `loop-1-diagnosis` handler（cron 到点等价）→ MainAgent 是否真被执行。
 *   case #976（0-2 反馈键）:   feedback_log 3 行 → `getAggregatedSignals` → `processFeedbackSignals`
 *                              → `applyEvolutionActions` → 夹具行业树是否出现 `_gaCorrections`。
 *
 * 判据四步（改坏即红留档；两条总闸各一轮）:
 *   #975: ① 跑探针（绿）→ ② 注释 `src/server.ts` 的 `bindMainAgent(mainAgent)` → 必红（bound=false /
 *         count=0 / stderr 命中 `[D9] MainAgent 未注入 — 跳过 loop-1 (degraded)`）→ ③ 恢复 → 回绿
 *   #976: ① 跑探针（绿）→ ② 把 `key` 改回 `${decision}:${target_type}:${actor_role}` → 必红
 *         （signalKeys 复合键 / gaCorrections=null）→ ③ 恢复 → 回绿
 *
 * 运行: node_modules/.bin/tsx tests/loops/probes/batch0a-probes.ts 2> /tmp/batch0a.stderr.log
 * 说明: 写入目标全部在 /tmp（`INDUSTRIES_FIXTURE_DIR` 接缝 + 心跳自清），不落仓库运行产物。
 */
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
// 类型专用导入（编译期擦除，不影响模块求值时机——本探针的 src 模块一律动态 import）
import type { CronSchedulerLike } from '../../../src/loops/loop-scheduler';

const FIXTURE_DIR = '/tmp/synova-976-probe-industries';
// 必须在 middle-evolution-engine 被求值前设好（其 EXTENSIONS_DIR 是模块级 const）——
// 本探针一律用动态 import，故此赋值先于任何 src 模块求值。
process.env.INDUSTRIES_FIXTURE_DIR = FIXTURE_DIR;

/** #975: 生产装配 → 唤起内置循环 handler → 观察 MainAgent 是否真被执行 */
async function case975(): Promise<Record<string, unknown>> {
  const { LoopScheduler } = await import('../../../src/loops/loop-scheduler');
  const { getBoundMainAgent } = await import('../../../src/loops/main-agent-binding');
  const { setDiagnosisDeps } = await import('../../../src/agent/loop-handlers');
  const { wireLoopExecution } = await import('../../../src/server');

  class Capture implements CronSchedulerLike {
    readonly jobs = new Map<string, () => Promise<void>>();
    schedule(name: string, _cron: string, handler: () => Promise<void>): string {
      this.jobs.set(name, handler);
      return name;
    }
  }

  // loop-1 依赖桩: GOAL 图空 → handler 走「无 active 目标」降级分支（不触 DB / 不接 LLM）
  setDiagnosisDeps({
    getStore: () => ({ createNode: () => 'stub', getNode: () => null, updateNode: () => {}, queryNodes: () => [] }),
    getGoal: () => null,
    callExpert: async () => ({ suggestedAdjustment: 'adjust_target' as const, description: 'probe stub', degraded: false }),
  });

  const wiring = wireLoopExecution();
  const capture = new Capture();
  new LoopScheduler(capture);
  await capture.jobs.get('loop-1-diagnosis')?.();

  const rec = wiring.mainAgent?.listLoops().find((l) => l.config.loopId === 'loop-1');
  const out = {
    probe: '#975',
    ok: wiring.ok,
    degraded: wiring.degraded,
    bound: getBoundMainAgent() === wiring.mainAgent,
    builtinJobs: [...capture.jobs.keys()],
    loop1ExecutionCount: rec?.executionCount ?? null,
    loop1Status: rec?.lastExecution?.status ?? 'pending',
    loop1Scale: rec?.lastExecution?.scale ?? null,
  };
  setDiagnosisDeps(null);
  try { rmSync(join(process.cwd(), '.codex', 'heartbeat.json'), { force: true }); } catch { /* 清理失败不阻断 */ }
  return out;
}

/** #976: feedback_log 3 行 → 聚合 → 进化动作 → 夹具行业树 `_gaCorrections` */
async function case976(): Promise<Record<string, unknown>> {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const industryDir = `${FIXTURE_DIR}/general-enterprise`;
  mkdirSync(industryDir, { recursive: true });
  const thresholdPath = `${industryDir}/thresholds.json`;
  writeFileSync(thresholdPath, JSON.stringify({
    industry: 'general-enterprise',
    thresholdOverrides: { F1_KZ: { warning: 1.5, critical: 2.0 } },
  }, null, 2), 'utf-8');

  const { default: Database } = await import('better-sqlite3');
  const { FeedbackCollector, FEEDBACK_DDL } = await import('../../../src/growth/feedback-collector');
  const { processFeedbackSignals, applyEvolutionActions } = await import('../../../src/loops/middle-evolution-engine');

  const db = new Database(':memory:');
  db.exec(FEEDBACK_DDL);
  const collector = new FeedbackCollector();
  collector.setDatabase(db);
  for (let i = 0; i < 3; i++) {
    collector.collectFeedback({
      enterpriseId: 'e1', actorId: 'ga-1', decision: 'reject',
      targetType: 'sentinel_alert', targetId: 'F1_KZ', reason: '误报', actorRole: 'ga',
    });
  }

  const signals = collector.getAggregatedSignals(3);
  const actions = processFeedbackSignals(signals);
  const applyResult = applyEvolutionActions(actions);
  const written = JSON.parse(readFileSync(thresholdPath, 'utf-8')) as Record<string, unknown>;

  const out = {
    probe: '#976',
    signalKeys: signals.map((s) => s.key),
    signalCounts: signals.map((s) => s.count),
    actionTypes: actions.map((a) => a.type),
    actionSentinelKey: actions[0]?.parameter.sentinelKey ?? null,
    applyResult: { applied: applyResult.applied, skipped: applyResult.skipped, errors: applyResult.errors },
    gaCorrections: written._gaCorrections ?? null,
  };
  db.close();
  return out;
}

async function main(): Promise<void> {
  console.log(JSON.stringify(await case975(), null, 2));
  console.log(JSON.stringify(await case976(), null, 2));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ probeError: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
