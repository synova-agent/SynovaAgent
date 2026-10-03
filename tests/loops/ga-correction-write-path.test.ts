/**
 * tests/loops/ga-correction-write-path.test.ts — #976（0-2 总闸·反馈键）端到端判别性夹具
 *
 * 判据（卡面 Done）: 真哨兵键的反馈（feedback_log 3 行）→ getAggregatedSignals（per target_id 聚合）
 *   → processFeedbackSignals → applyEvolutionActions → 行业树出现 `_gaCorrections`。
 *   今天该链路零命中（`grep -rn "_gaCorrections" extensions/ | wc -l` = 0）：聚合键是
 *   `${decision}:${target_type}:${actor_role}`，永远匹配不上 thresholdOverrides 里的真哨兵键 `F1_KZ`
 *   ⇒ applyThresholdAdjust 的 `if (!overrides[sentinelKey]) continue` 恒命中 ⇒ 从不回写。
 *
 * ⚠️ 判别性: 把 getAggregatedSignals 的 `key` 改回复合键 → 本夹具必红（无 `_gaCorrections`）。
 * ⚠️ 写入目标 = 临时目录（`INDUSTRIES_FIXTURE_DIR` 接缝，先例 SENTINELS_FIXTURE_DIR）；
 *    **不污染仓库 tracked 的 extensions 行业文件**。beforeAll 先用「只存在于夹具的探针键」
 *    证明接缝已生效，接缝失效则整文件 fail（防误写仓库）。
 *
 * 覆盖: 正常（同键 3 次 → pending 条目落盘）· 降级（db 未注入 → []，不抛）· 边界（跨键不聚合）
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const FIXTURE_DIR = join(tmpdir(), 'synova-976-industries-fixture');
const SEAM_PROBE_KEY = 'SEAM_PROBE_976_ONLY_IN_FIXTURE';

// ⚠️ 必须在 middle-evolution-engine 被求值前设好（其 EXTENSIONS_DIR 是模块级 const）。
// 本文件对该模块只用动态 import（见各用例），故模块体赋值必定早于其求值。
process.env.INDUSTRIES_FIXTURE_DIR = FIXTURE_DIR;

function writeFixtureTree(): { thresholdPath: string; seamPath: string } {
  const industryDir = join(FIXTURE_DIR, 'general-enterprise');
  mkdirSync(industryDir, { recursive: true });
  const thresholdPath = join(industryDir, 'thresholds.json');
  writeFileSync(thresholdPath, JSON.stringify({
    industry: 'general-enterprise',
    aggregatedAt: '2026-10-04T00:00:00.000Z',
    thresholdOverrides: { F1_KZ: { warning: 1.5, critical: 2.0 } },
  }, null, 2), 'utf-8');

  const seamDir = join(FIXTURE_DIR, 'seam-probe');
  mkdirSync(seamDir, { recursive: true });
  const seamPath = join(seamDir, 'thresholds.json');
  writeFileSync(seamPath, JSON.stringify({
    industry: 'seam-probe',
    aggregatedAt: '2026-10-04T00:00:00.000Z',
    thresholdOverrides: { [SEAM_PROBE_KEY]: { warning: 1.5, critical: 2.0 } },
  }, null, 2), 'utf-8');

  return { thresholdPath, seamPath };
}

function readThresholds(thresholdPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(thresholdPath, 'utf-8')) as Record<string, unknown>;
}

describe('#976 — 反馈键 → _gaCorrections 回写（端到端）', () => {
  let thresholdPath: string;
  let seamPath: string;

  beforeAll(async () => {
    // 接缝守卫: 探针键只存在于夹具 ⇒ 接缝失效时既不会误写仓库，又必然 fail
    const { applyEvolutionActions } = await import('../../src/loops/middle-evolution-engine');
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    const paths = writeFixtureTree();
    applyEvolutionActions([{
      type: 'threshold_adjust',
      reason: 'seam probe',
      parameter: { sentinelKey: SEAM_PROBE_KEY, adjustPercent: 5, direction: 'up' },
      confidence: 0.5,
      triggeredAt: '2026-10-04T00:00:00.000Z',
    }]);
    const probeWritten = readThresholds(paths.seamPath)._gaCorrections;
    if (!Array.isArray(probeWritten) || probeWritten.length === 0) {
      throw new Error('INDUSTRIES_FIXTURE_DIR 接缝未生效 — 拒绝继续（防污染仓库 extensions/industries）');
    }
  });

  beforeEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    const paths = writeFixtureTree();
    thresholdPath = paths.thresholdPath;
    seamPath = paths.seamPath;
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('正常路径: 同一真哨兵键 F1_KZ 的 3 次 reject → thresholds.json 出现 _gaCorrections', async () => {
    const { getFeedbackCollector, FEEDBACK_DDL } = await import('../../src/growth/feedback-collector');
    const { processFeedbackSignals, applyEvolutionActions } = await import('../../src/loops/middle-evolution-engine');

    const db = new Database(':memory:');
    db.exec(FEEDBACK_DDL);
    const collector = getFeedbackCollector();
    collector.setDatabase(db);
    for (let i = 0; i < 3; i++) {
      collector.collectFeedback({
        enterpriseId: 'e1', actorId: 'ga-1', decision: 'reject',
        targetType: 'sentinel_alert', targetId: 'F1_KZ', reason: '误报', actorRole: 'ga',
      });
    }

    const signals = collector.getAggregatedSignals(3);
    expect(signals).toHaveLength(1);
    expect(signals[0].key).toBe('F1_KZ');          // #976: key = 真哨兵 ID（非复合键）
    expect(signals[0].count).toBe(3);
    expect(signals[0].targetIds).toEqual(['F1_KZ']);

    const actions = processFeedbackSignals(signals);
    const adjust = actions.find((a) => a.type === 'threshold_adjust');
    expect(adjust).toBeDefined();
    expect(adjust!.parameter.sentinelKey).toBe('F1_KZ');

    const result = applyEvolutionActions(actions);
    expect(result.errors).toEqual([]);
    expect(result.applied + result.skipped).toBeGreaterThanOrEqual(1);

    const written = readThresholds(thresholdPath);
    const corrections = written._gaCorrections as Array<Record<string, unknown>>;
    expect(Array.isArray(corrections)).toBe(true);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].key).toBe('F1_KZ');
    expect(corrections[0].applied).toBe(false); // 首次 = pending 1/3（MIN_TRIGGER_COUNT=3）

    db.close();
  });

  it('降级路径: db 未注入 → 聚合返回 []（log.warn + degraded，不抛）', async () => {
    const { FeedbackCollector } = await import('../../src/growth/feedback-collector');
    const fresh = new FeedbackCollector(); // 未 setDatabase
    expect(fresh.getAggregatedSignals(3)).toEqual([]);

    const { applyEvolutionActions } = await import('../../src/loops/middle-evolution-engine');
    const result = applyEvolutionActions([]); // 零动作 → 零回写，不抛
    expect(result.applied).toBe(0);
    expect(result.errors).toEqual([]);
    expect(readThresholds(thresholdPath)._gaCorrections).toBeUndefined();
  });

  it('边界: 不同 target_id 各成一信号（per target_id 聚合，不跨键合并）', async () => {
    const { getFeedbackCollector, FEEDBACK_DDL } = await import('../../src/growth/feedback-collector');
    const db = new Database(':memory:');
    db.exec(FEEDBACK_DDL);
    const collector = getFeedbackCollector();
    collector.setDatabase(db);

    for (const key of ['F1_KZ', 'F2_runway', 'F3_revenue_quality']) {
      collector.collectFeedback({
        enterpriseId: 'e1', actorId: 'ga-1', decision: 'reject',
        targetType: 'sentinel_alert', targetId: key, actorRole: 'ga',
      });
    }
    // 每键 1 次 < 阈值 3 → 不聚合
    expect(collector.getAggregatedSignals(3)).toEqual([]);
    // 阈值 1 → 3 条独立信号（键各不相同）
    const signals = collector.getAggregatedSignals(1);
    expect(signals.map((s) => s.key).sort()).toEqual(['F1_KZ', 'F2_runway', 'F3_revenue_quality']);

    db.close();
  });
});
