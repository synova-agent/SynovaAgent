/**
 * tests/loops/probes/feedback-key-write-probe.ts — #976 L2 原始证据探针（非 vitest 用例）
 *
 * 用途: 直接量出「反馈键 → _gaCorrections 落盘」这一条链的真实产物（stdout=JSON），
 *   供 #976 改坏即红四步留档:
 *     step1 运行 → signalKeys=["F1_KZ"] + gaCorrections 非空（绿）
 *     step2 把 feedback-collector.ts 的 key 改回 `${decision}:${target_type}:${actor_role}` → 必红
 *     step3 恢复 → 回绿
 *     step4 残留检查（grep RED-FIXTURE = 0）
 *
 * 写入目标 = /tmp 夹具树（INDUSTRIES_FIXTURE_DIR），不落仓库。
 * 运行: node_modules/.bin/tsx tests/loops/probes/feedback-key-write-probe.ts
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';

const FIXTURE_DIR = '/tmp/synova-976-probe-industries';
process.env.INDUSTRIES_FIXTURE_DIR = FIXTURE_DIR;

async function main(): Promise<void> {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  const industryDir = `${FIXTURE_DIR}/general-enterprise`;
  mkdirSync(industryDir, { recursive: true });
  const thresholdPath = `${industryDir}/thresholds.json`;
  writeFileSync(thresholdPath, JSON.stringify({
    industry: 'general-enterprise',
    thresholdOverrides: { F1_KZ: { warning: 1.5, critical: 2.0 } },
  }, null, 2), 'utf-8');

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

  console.log(JSON.stringify({
    signalKeys: signals.map((s) => s.key),
    signalCounts: signals.map((s) => s.count),
    actionTypes: actions.map((a) => a.type),
    actionSentinelKey: actions[0]?.parameter.sentinelKey ?? null,
    applyResult: { applied: applyResult.applied, skipped: applyResult.skipped, errors: applyResult.errors },
    gaCorrections: written._gaCorrections ?? null,
  }, null, 2));

  db.close();
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ probeError: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
