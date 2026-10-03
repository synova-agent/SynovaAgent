/**
 * tests/growth/feedback-collector.test.ts — D93 反馈收集器测试
 *
 * 覆盖: collect 3(降级/完整字段/持久化) + query 3(全部/过滤/空) + aggregate 3(聚合/阈值/无数据) = 9
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeedbackCollector, FEEDBACK_DDL } from '../../src/growth/feedback-collector';
import type { MiddleFeedbackInput } from '../../src/growth/feedback-collector';

describe('FeedbackCollector', () => {
  let collector: FeedbackCollector;

  beforeEach(() => { collector = new FeedbackCollector(); });

  describe('collectFeedback', () => {
    it('无 SQLite → 降级返回', () => {
      const result = collector.collectFeedback({
        enterpriseId: 'e1', actorId: 'user-1', decision: 'reject',
        targetType: 'sentinel_alert', targetId: 'alert-1', reason: '误报',
      });
      expect(result.id).toBeTruthy();
      expect(result.degraded).toBe(true);
    });

    it('记录包含完整字段', () => {
      const result = collector.collectFeedback({
        enterpriseId: 'e1', actorId: 'user-1', decision: 'modify',
        targetType: 'goal', targetId: 'goal-1', reason: '目标值太高',
        evidenceRefs: ['snapshot-1'],
      });
      expect(result.targetType).toBe('goal');
      expect(result.reason).toBe('目标值太高');
    });

    it('SQLite 持久化 → 可查询', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      collector.collectFeedback({
        enterpriseId: 'e1', actorId: 'user-1', decision: 'reject',
        targetType: 'sentinel_alert', targetId: 'alert-1', reason: '误报',
      });

      const results = collector.queryFeedback({ enterpriseId: 'e1' });
      expect(results.degraded).toBe(false);
      expect(results.entries.length).toBe(1);
      expect(results.entries[0].decision).toBe('reject');

      db.close();
    });
  });

  describe('queryFeedback', () => {
    it('无 SQLite → 降级空结果', () => {
      expect(collector.queryFeedback({ enterpriseId: 'e1' })).toEqual({ entries: [], degraded: true });
    });

    it('按 enterpriseId 过滤', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'reject', targetType: 'sentinel_alert', targetId: 'a1' });
      collector.collectFeedback({ enterpriseId: 'e2', actorId: 'u1', decision: 'modify', targetType: 'goal', targetId: 'g1' });

      const e1 = collector.queryFeedback({ enterpriseId: 'e1' });
      expect(e1.degraded).toBe(false);
      expect(e1.entries.length).toBe(1);

      db.close();
    });

    it('按 decision 过滤', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'reject', targetType: 'sentinel_alert', targetId: 'a1' });
      collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'modify', targetType: 'goal', targetId: 'g1' });

      const rejects = collector.queryFeedback({ enterpriseId: 'e1', decision: 'reject' });
      expect(rejects.degraded).toBe(false);
      expect(rejects.entries.length).toBe(1);
      expect(rejects.entries[0].decision).toBe('reject');

      db.close();
    });
  });

  describe('getAggregatedSignals', () => {
    it('无 SQLite → 空数组', () => {
      expect(collector.getAggregatedSignals()).toEqual([]);
    });

    it('相同真目标键 decision+targetType >= threshold → 聚合（#976: per target_id）', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      for (let i = 0; i < 3; i++) {
        collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'reject', targetType: 'sentinel_alert', targetId: 'F1_KZ' });
      }

      const signals = collector.getAggregatedSignals(3);
      expect(signals.length).toBe(1);
      expect(signals[0].decision).toBe('reject');
      expect(signals[0].count).toBe(3);
      // #976: key = 真哨兵 ID（消费者用它匹配 thresholdOverrides 的真键）
      expect(signals[0].key).toBe('F1_KZ');
      expect(signals[0].targetIds).toEqual(['F1_KZ']);

      db.close();
    });

    it('不同 target_id 不跨键聚合（#976: 旧复合键口径已废）', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      for (let i = 0; i < 3; i++) {
        collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'reject', targetType: 'sentinel_alert', targetId: `a${i}` });
      }

      // 每键仅 1 次 → 阈值 3 下零聚合
      expect(collector.getAggregatedSignals(3).length).toBe(0);
      // 阈值 1 → 3 条独立信号，键 = 各自 target_id
      expect(collector.getAggregatedSignals(1).map(s => s.key).sort()).toEqual(['a0', 'a1', 'a2']);

      db.close();
    });

    it('低于阈值 → 不聚合', () => {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      db.exec(FEEDBACK_DDL);
      collector.setDatabase(db);

      collector.collectFeedback({ enterpriseId: 'e1', actorId: 'u1', decision: 'reject', targetType: 'sentinel_alert', targetId: 'a1' });

      const signals = collector.getAggregatedSignals(3);
      expect(signals.length).toBe(0);

      db.close();
    });
  });
});
