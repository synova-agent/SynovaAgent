/**
 * tests/growth/evolution-writeback-runtime.integration.test.ts — K6/0-2 总闸「运行时回写」复测（真库 + 注入 feedback_log 行）
 *
 * 为什么单开一件（与 tests/growth/evolution-writeback.test.ts 的分工）:
 *   · 既有件用 `collectFeedback()`（生产写入 API）造行 —— 验的是「写入通道 A → 回写」全链；
 *   · 本件按总闸取证口径，**直接向 `feedback_log` 表注入 3 行**（不经写入 API，排除写入侧干扰），
 *     再走 `getAggregatedSignals` → `processFeedbackSignals` → `applyEvolutionActions` 三环，
 *     最后用 SQL 直接对 `agent_memory` 计数：
 *         SELECT COUNT(*) FROM agent_memory WHERE key LIKE '%_gaCorrections%'
 *     断言 > 0（= 「applied 恒 0」的直接反面，issue #976 §⑥ V2）。
 *   · 库形态 = **真实文件库**（mkdtemp 临时目录，非 `:memory:`）；**禁 `data/synova.db`**
 *     （`data/` 被 .gitignore 排除，干净检出下不存在）。
 *
 * 隔离与安全:
 *   · 行业阈值夹具落在 `extensions/industries/_test_k6_runtime/`（引擎的 EXTENSIONS_DIR 是
 *     `join(process.cwd(),'extensions','industries')`，无 env 接缝）；
 *   · 哨兵键用 `ZZ_TEST_K6_RUNTIME`（真行业配置零命中）⇒ 即使清理失败也不会改写真配置；
 *   · afterAll: 关库 → 删夹具目录 → 删临时目录 → 还原 AgentMemoryStore 单例。
 *
 * 契约（铁律 47）
 *   @input   — feedback_log 3 行（同 enterprise_id / decision=reject / target_type=sentinel_alert /
 *              target_id=ZZ_TEST_K6_RUNTIME）+ 夹具 thresholds.json（thresholdOverrides 含该键 +
 *              2 条同键同方向 pending 纠错 ⇒ 第 3 次达 MIN_TRIGGER_COUNT）
 *   @output  — applied=1、阈值文件真变化（warning 1.5 → 1.58）、agent_memory 账本行 +1
 *   @degraded— AgentMemoryStore 未初始化 ⇒ logCorrection 打 log.warn 并跳过（本件不断言该路径；
 *              该降级面由 tests/loops/ga-calibration-evolution.test.ts 覆盖）
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { FEEDBACK_DDL, FeedbackCollector } from '../../src/growth/feedback-collector';
import { processFeedbackSignals, applyEvolutionActions } from '../../src/loops/middle-evolution-engine';
import { getAgentMemoryStore } from '../../src/l4/agent-memory-store';
import type { AggregatedSignal } from '../../src/growth/feedback-collector';

// ═══ 夹具 ═══

const PROJECT_ROOT = process.cwd();
const TEST_INDUSTRY = '_test_k6_runtime';
const TEST_THRESHOLD_DIR = join(PROJECT_ROOT, 'extensions', 'industries', TEST_INDUSTRY);
const TEST_THRESHOLD_PATH = join(TEST_THRESHOLD_DIR, 'thresholds.json');
const TEST_SENTINEL_KEY = 'ZZ_TEST_K6_RUNTIME'; // 唯一键：真行业 thresholds.json 零命中
const TMP_DIR = mkdtempSync(join(tmpdir(), 'k6-0-2-runtime-'));
const MEMORY_DB_PATH = join(TMP_DIR, 'agent-memory.db');

/** 写夹具：pendingCorrections = 预置的 pending 纠错条数（MIN_TRIGGER_COUNT=3 ⇒ 2 条时本次为第 3 次） */
function setupThresholdFixture(pendingCorrections: number): void {
  mkdirSync(TEST_THRESHOLD_DIR, { recursive: true });
  const pending = Array.from({ length: pendingCorrections }, () => ({
    key: TEST_SENTINEL_KEY, direction: 'up', applied: false, reason: 'pending fixture',
  }));
  writeFileSync(TEST_THRESHOLD_PATH, JSON.stringify({
    industry: TEST_INDUSTRY,
    thresholdOverrides: { [TEST_SENTINEL_KEY]: { warning: 1.5, critical: 1.2 } },
    _gaCorrections: pending,
  }, null, 2), 'utf-8');
}

function cleanupThresholdFixture(): void {
  if (existsSync(TEST_THRESHOLD_DIR)) rmSync(TEST_THRESHOLD_DIR, { recursive: true, force: true });
}

/** 直接注入 3 行 feedback_log（不经 collectFeedback 写入 API） */
function injectFeedbackRows(db: Database.Database, targetId: string, enterpriseId = 'org-k6-runtime'): void {
  const stmt = db.prepare(
    `INSERT INTO feedback_log (id, enterprise_id, actor_id, decision, target_type, target_id, reason, evidence_refs, actor_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < 3; i++) {
    stmt.run(
      `rt-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      enterpriseId, 'ga-rt', 'reject', 'sentinel_alert', targetId, '误报（runtime 取证注入）', '[]', 'ga',
      new Date().toISOString(),
    );
  }
}

/** 总闸判据的原样 SQL */
function memoryLedgerCount(): number {
  const row = memoryDb.prepare(
    `SELECT COUNT(*) AS n FROM agent_memory WHERE key LIKE '%_gaCorrections%'`,
  ).get() as { n: number };
  return row.n;
}

let memoryDb: Database.Database;

beforeAll(() => {
  // 真库（文件）+ 生产 store（AgentMemoryStore 自建 agent_memory schema）——logCorrection 才有落点
  memoryDb = new Database(MEMORY_DB_PATH);
  getAgentMemoryStore(memoryDb);
});

beforeEach(() => {
  cleanupThresholdFixture();
});

afterAll(() => {
  cleanupThresholdFixture();
  memoryDb.close();
  rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  // 还原模块级单例，避免跨测试文件污染
  getAgentMemoryStore(new Database(':memory:'));
});

describe('K6/0-2 运行时回写（真库 + 注入 feedback_log 行）', () => {
  it('总闸判据: 注入 3 行 reject ⇒ applied=1 + 阈值真变化 + agent_memory 账本计数 > 0', () => {
    setupThresholdFixture(2); // 已累计 2 条 pending ⇒ 本次为第 3 次，达 MIN_TRIGGER_COUNT
    const ledgerBefore = memoryLedgerCount();

    const db = new Database(join(TMP_DIR, 'feedback-runtime.db'));
    db.exec(FEEDBACK_DDL);
    const collector = new FeedbackCollector();
    collector.setDatabase(db);
    injectFeedbackRows(db, TEST_SENTINEL_KEY);

    // ① 聚合：实体级聚合键必须解出配置实体（复合键病根的直接反面）
    const signals = collector.getAggregatedSignals(3);
    expect(signals.length).toBe(1);
    expect(signals[0].key).toBe('reject:sentinel_alert:ga');
    expect(signals[0].entityKey).toBe(TEST_SENTINEL_KEY);
    expect(signals[0].count).toBe(3);

    // ② 信号 → 动作（穿生产入口，不直接构造 EvolutionAction）
    const actions = processFeedbackSignals(signals);
    const thresholdAction = actions.find(a => a.type === 'threshold_adjust');
    expect(thresholdAction).toBeDefined();
    expect(thresholdAction?.parameter.sentinelKey).toBe(TEST_SENTINEL_KEY); // 禁止复合键

    // ③ 回写：applied 必须 > 0
    const result = applyEvolutionActions(actions);
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(1);

    const updated = JSON.parse(readFileSync(TEST_THRESHOLD_PATH, 'utf-8'));
    expect(updated.thresholdOverrides[TEST_SENTINEL_KEY].warning).toBeCloseTo(1.58, 1);
    const lastCorrection = updated._gaCorrections[updated._gaCorrections.length - 1];
    expect(lastCorrection.applied).toBe(true);

    // ④ 总闸判据：agent_memory 出现 `%_gaCorrections%` 账本行
    const ledgerAfter = memoryLedgerCount();
    console.log(JSON.stringify({
      tag: '[GATE-2] runtime writeback',
      memoryDbPath: MEMORY_DB_PATH,
      feedbackDbPath: join(TMP_DIR, 'feedback-runtime.db'),
      sql: `SELECT COUNT(*) FROM agent_memory WHERE key LIKE '%_gaCorrections%'`,
      ledgerBefore, ledgerAfter,
      applied: result.applied, skipped: result.skipped,
      thresholdWarning: updated.thresholdOverrides[TEST_SENTINEL_KEY].warning,
    }, null, 2));
    expect(ledgerAfter).toBeGreaterThan(ledgerBefore);
    expect(ledgerAfter).toBeGreaterThan(0);

    db.close();
  });

  it('反例(同进程): 旧生产者语义 entityKey=undefined ⇒ 退回复合键 ⇒ 不匹配配置实体 ⇒ applied=0 且无账本行', () => {
    setupThresholdFixture(2);
    const ledgerBefore = memoryLedgerCount();

    // 旧生产者（entityKey 缺省 ⇒ 引擎退回用复合键 sig.key）
    const legacySignals: AggregatedSignal[] = [{
      key: 'reject:sentinel_alert:ga',
      decision: 'reject',
      targetType: 'sentinel_alert',
      actorRoles: ['ga'],
      count: 3,
      latestTimestamp: new Date().toISOString(),
      targetIds: [TEST_SENTINEL_KEY],
    }];

    const actions = processFeedbackSignals(legacySignals);
    expect(actions.some(a => a.type === 'threshold_adjust')).toBe(true);

    const result = applyEvolutionActions(actions);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);

    // 复合键在真配置里无对应实体 ⇒ 夹具文件零改动、agent_memory 零新增
    const untouched = JSON.parse(readFileSync(TEST_THRESHOLD_PATH, 'utf-8'));
    expect(untouched._gaCorrections.length).toBe(2);
    expect(memoryLedgerCount()).toBe(ledgerBefore);
  });
});
