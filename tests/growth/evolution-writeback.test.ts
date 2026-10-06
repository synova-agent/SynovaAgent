/**
 * tests/growth/evolution-writeback.test.ts — K6/0-2 进化回写真实性（总闸）
 *
 * 判据语义（施工项登记 0-2）：
 *   ① 修好后进化回写**真实发生**：`getAggregatedSignals` → `processFeedbackSignals` →
 *      `applyEvolutionActions` 三环全走，`applied > 0` 且阈值文件真的变化；
 *   ② `agent_memory` 存在 `_gaCorrections` 账本行（= applied 恒 0 的直接反面）。
 *
 * 🔴 判据形态说明（CTO §4.5，2026-10-06 预授权）：
 * 登记件原文 `sqlite3 data/synova.db "SELECT COUNT(*) FROM agent_memory WHERE key LIKE '%_gaCorrections%'"`
 * 不可跑 —— `data/` 被 `.gitignore:3` 排除，干净检出下该文件不存在 ⇒ 「平凡红」而非「断言红」。
 * 按 §4.5：**语义不变 + 可跑 + 不依赖任何 gitignored 路径** ⇒ 本测试自建临时库（feedback_log 与
 * agent_memory 各一）+ 临时行业阈值夹具（`extensions/industries/_test_k6/`），把同一断言跑起来。
 * 判据形态待 V4 提案（`V4-判据可跑形态-提案-20261006.md`）定稿后对齐。
 *
 * 三路径：正常（同实体 3 次 reject ⇒ applied=1 + 阈值变化 + 账本行）/ 降级（实体不在任何
 * thresholds.json ⇒ skipped 且不抛）/ 边界（<3 次 ⇒ 不聚合；组内实体不唯一 ⇒ 不猜实体）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FeedbackCollector } from '../../src/growth/feedback-collector';
import { processFeedbackSignals, applyEvolutionActions } from '../../src/loops/middle-evolution-engine';
import { getAgentMemoryStore } from '../../src/l4/agent-memory-store';

// ═══ 夹具 ═══

const TEST_INDUSTRY = '_test_k6';
const PROJECT_ROOT = process.cwd();
const TEST_THRESHOLD_DIR = join(PROJECT_ROOT, 'extensions', 'industries', TEST_INDUSTRY);
const TEST_THRESHOLD_PATH = join(TEST_THRESHOLD_DIR, 'thresholds.json');
const TEST_SENTINEL_KEY = 'ZZ_TEST_K6';
const TMP_DIR = mkdtempSync(join(tmpdir(), 'k6-0-2-writeback-'));

/** 写行业阈值夹具；pendingCorrections = 预先累计的 pending 条数（MIN_TRIGGER_COUNT=3） */
function setupThresholdFixture(pendingCorrections: number): void {
  mkdirSync(TEST_THRESHOLD_DIR, { recursive: true });
  const pending = Array.from({ length: pendingCorrections }, () => ({
    key: TEST_SENTINEL_KEY, direction: 'up', applied: false, reason: 'pending fixture',
  }));
  writeFileSync(TEST_THRESHOLD_PATH, JSON.stringify({
    industry: TEST_INDUSTRY,
    aggregatedAt: '2026-10-06T00:00:00.000Z',
    thresholdOverrides: { [TEST_SENTINEL_KEY]: { warning: 1.5, critical: 1.1 } },
    _gaCorrections: pending,
  }, null, 2), 'utf-8');
}

function cleanupThresholdFixture(): void {
  if (existsSync(TEST_THRESHOLD_DIR)) rmSync(TEST_THRESHOLD_DIR, { recursive: true, force: true });
}

function openDb(fileName: string) {
  const Database = require('better-sqlite3');
  return new Database(join(TMP_DIR, fileName));
}

/** 造 n 条同实体反馈（穿生产入口 collectFeedback，不手写 INSERT） */
function seedRejects(collector: FeedbackCollector, targetIds: string[]): void {
  for (const targetId of targetIds) {
    collector.collectFeedback({
      enterpriseId: 'org-k6', actorId: 'ga', decision: 'reject',
      targetType: 'sentinel_alert', targetId, reason: '误报',
    });
  }
}

let memoryDb: ReturnType<typeof openDb>;

beforeAll(() => {
  // agent_memory 走生产 store（自建临时库），logCorrection 才有落点
  memoryDb = openDb('agent-memory.db');
  getAgentMemoryStore(memoryDb);
});

afterAll(() => {
  cleanupThresholdFixture();
  // 先关库句柄再删目录（Windows 下未关闭的 SQLite 句柄会锁住目录 ⇒ rmSync EPERM）
  memoryDb.close();
  rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  // 还原模块级单例，避免跨测试文件污染（指向临时内存库）
  const Database = require('better-sqlite3');
  getAgentMemoryStore(new Database(':memory:'));
});

function memoryLedgerCount(): number {
  const rows = memoryDb.prepare(
    `SELECT COUNT(*) AS n FROM agent_memory WHERE key LIKE '%_gaCorrections%'`,
  ).get() as { n: number };
  return rows.n;
}

describe('K6/0-2 进化回写（总闸）', () => {
  it('正常路径: 同实体 3 次 reject → applied=1 + 阈值真变化 + agent_memory 账本行', () => {
    cleanupThresholdFixture();
    setupThresholdFixture(2); // 已累计 2 次 pending ⇒ 本次为第 3 次，达 MIN_TRIGGER_COUNT
    const ledgerBefore = memoryLedgerCount();

    const db = openDb('feedback-normal.db');
    const collector = new FeedbackCollector();
    collector.setDatabase(db);
    seedRejects(collector, [TEST_SENTINEL_KEY, TEST_SENTINEL_KEY, TEST_SENTINEL_KEY]);

    // ① 聚合：实体级聚合键必须解出配置实体
    const signals = collector.getAggregatedSignals(3);
    expect(signals.length).toBe(1);
    expect(signals[0].entityKey).toBe(TEST_SENTINEL_KEY);
    expect(signals[0].count).toBe(3);

    // ② 信号 → 动作（穿生产入口，不直接构造 EvolutionAction）
    const actions = processFeedbackSignals(signals);
    expect(actions.some(a => a.type === 'threshold_adjust')).toBe(true);

    // ③ 回写：applied 必须 > 0（0-2 的直接反面：applied 恒 0）
    const result = applyEvolutionActions(actions);
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(1);

    const updated = JSON.parse(readFileSync(TEST_THRESHOLD_PATH, 'utf-8'));
    expect(updated.thresholdOverrides[TEST_SENTINEL_KEY].warning).toBeCloseTo(1.58, 1);
    const lastCorrection = updated._gaCorrections[updated._gaCorrections.length - 1];
    expect(lastCorrection.applied).toBe(true);

    // ④ 判据语义：agent_memory 出现 _gaCorrections 账本行
    expect(memoryLedgerCount()).toBeGreaterThan(ledgerBefore);

    db.close();
  });

  it('降级路径: 实体不在任何 thresholds.json ⇒ skipped（applied=0）且不抛', () => {
    cleanupThresholdFixture();
    setupThresholdFixture(2);

    const db = openDb('feedback-missing.db');
    const collector = new FeedbackCollector();
    collector.setDatabase(db);
    seedRejects(collector, ['ZZ_UNKNOWN_SENTINEL', 'ZZ_UNKNOWN_SENTINEL', 'ZZ_UNKNOWN_SENTINEL']);

    const signals = collector.getAggregatedSignals(3);
    expect(signals[0].entityKey).toBe('ZZ_UNKNOWN_SENTINEL');
    const actions = processFeedbackSignals(signals);
    const result = applyEvolutionActions(actions);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    db.close();
  });

  it('边界: <3 次不聚合（未达阈值）', () => {
    cleanupThresholdFixture();
    setupThresholdFixture(2);

    const db = openDb('feedback-under.db');
    const collector = new FeedbackCollector();
    collector.setDatabase(db);
    seedRejects(collector, [TEST_SENTINEL_KEY, TEST_SENTINEL_KEY]);

    const signals = collector.getAggregatedSignals(3);
    expect(signals).toEqual([]);

    const result = applyEvolutionActions(processFeedbackSignals(signals));
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);

    db.close();
  });

  it('边界: 组内实体不唯一（类别级聚合）⇒ entityKey=null，回写侧不猜实体', () => {
    cleanupThresholdFixture();
    setupThresholdFixture(2);

    const db = openDb('feedback-mixed.db');
    const collector = new FeedbackCollector();
    collector.setDatabase(db);
    seedRejects(collector, ['a-1', 'a-2', 'a-3']);

    const signals = collector.getAggregatedSignals(3);
    expect(signals.length).toBe(1);
    expect(signals[0].entityKey).toBeNull();
    expect(signals[0].entityKeys).toEqual(['a-1', 'a-2', 'a-3']);

    const actions = processFeedbackSignals(signals);
    expect(actions.some(a => a.type === 'threshold_adjust')).toBe(false);

    db.close();
  });
});
