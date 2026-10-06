/**
 * tests/growth/feedback-channel-unification.test.ts — K6/2-3 反馈两通道归一
 *
 * 判据语义（施工项登记 2-3）：`feedback_log` 中存在 `decision='confirm'` 的行
 * （= GA 的正向值不再被 DDL 拒、且能经两通道合流落库）。
 *
 * 🔴 判据形态说明（CTO §4.5，2026-10-06 预授权）：
 * 登记件原文 `sqlite3 data/synova.db "SELECT COUNT(*) FROM feedback_log WHERE decision='confirm'"` 不可跑 ——
 * `data/` 被 `.gitignore:3` 排除，干净检出下 `data/synova.db` 不存在 ⇒ 那是「平凡红（文件不存在）」
 * 而非「断言红」。按 §4.5：**语义不变 + 可跑 + 不依赖任何 gitignored 路径** ⇒ 本测试用
 * `mkdtempSync` 自建临时库，经生产入口（通道 B `collectFeedback` + 通道 A
 * `createEvolutionChannelSink`，与 `src/routes/chat.ts` 同一工厂）真实写入后断言同一语义。
 * 判据形态待 V4 提案（`V4-判据可跑形态-提案-20261006.md`）定稿后对齐。
 *
 * 三路径：正常（confirm 落库）/ 降级（无 SQLite ⇒ degraded 不抛）/ 边界（旧 CHECK 库迁移后写入成功 + 迁移幂等）
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FeedbackCollector, createEvolutionChannelSink } from '../../src/growth/feedback-collector';
import { collectFeedback } from '@synova/evolution';

const TMP_DIR = mkdtempSync(join(tmpdir(), 'k6-2-3-channel-'));

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

/** 旧库（K6/2-3 修复前）的 feedback_log 形态：decision CHECK 无 'confirm' */
const LEGACY_FEEDBACK_DDL = `
CREATE TABLE feedback_log (
  id            TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK(decision IN ('reject','modify','reject_path','ineffective')),
  target_type   TEXT NOT NULL CHECK(target_type IN ('sentinel_alert','goal','proposal','diagnosis_conclusion')),
  target_id     TEXT NOT NULL,
  reason        TEXT DEFAULT '',
  evidence_refs TEXT DEFAULT '[]',
  actor_role    TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(fileName: string) {
  const Database = require('better-sqlite3');
  return new Database(join(TMP_DIR, fileName));
}

describe('K6/2-3 反馈两通道归一', () => {
  it('正常路径: 通道 B 的 confirm 经通道归一接线落 feedback_log', async () => {
    const db = openDb('normal.db');
    const collector = new FeedbackCollector();
    collector.setDatabase(db);

    const fb = await collectFeedback(
      { orgId: 'org-k6', actionId: 'act-1', decision: 'confirm', reason: 'GA 采纳' },
      undefined,
      createEvolutionChannelSink(collector),
    );

    // 通道 B 语义不变（无 memoryStore ⇒ persisted=false，但记录已生成）
    expect(fb.ok).toBe(true);
    expect(fb.record.decision).toBe('confirm');

    // 判据语义：confirm 行确实落库（原 DDL 会直接拒掉这个判别值）
    const confirmRows = db.prepare(
      `SELECT COUNT(*) AS n FROM feedback_log WHERE decision = 'confirm'`,
    ).get() as { n: number };
    expect(confirmRows.n).toBe(1);

    // 映射契约：actionId → target_id，target_type 归一为 proposal，userId 缺省 'ga'
    const row = db.prepare(`SELECT * FROM feedback_log WHERE decision = 'confirm'`).get() as Record<string, unknown>;
    expect(row.target_id).toBe('act-1');
    expect(row.target_type).toBe('proposal');
    expect(row.actor_id).toBe('ga');
    expect(row.enterprise_id).toBe('org-k6');
    expect(row.reason).toBe('GA 采纳');

    db.close();
  });

  it('降级路径: 无 SQLite ⇒ 通道 A 返回 degraded 且 sink 不抛（不阻断 GA 主流程）', () => {
    const collector = new FeedbackCollector();

    const degraded = collector.collectEvolutionFeedback({
      orgId: 'org-k6', actionId: 'act-2', decision: 'confirm',
    });
    expect(degraded.degraded).toBe(true);
    expect(degraded.id).toBeTruthy();

    const sink = createEvolutionChannelSink(collector);
    expect(() => sink({ orgId: 'org-k6', actionId: 'act-3', decision: 'reject' })).not.toThrow();
  });

  it('边界: 旧 CHECK 库（无 confirm）迁移后写入成功，且二次迁移幂等', () => {
    const db = openDb('legacy.db');
    db.exec(LEGACY_FEEDBACK_DDL);
    db.prepare(
      `INSERT INTO feedback_log (id, enterprise_id, actor_id, decision, target_type, target_id)
       VALUES ('old-1', 'org-k6', 'ga', 'reject', 'sentinel_alert', 'a-1')`,
    ).run();

    const collector = new FeedbackCollector();
    collector.setDatabase(db); // 触发 d551 + k6_confirm_decision 迁移

    const written = collector.collectEvolutionFeedback({
      orgId: 'org-k6', actionId: 'act-4', decision: 'confirm', reason: '迁移后写入',
    });
    expect(written.degraded).toBeUndefined();

    const counts = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM feedback_log) AS total,
         (SELECT COUNT(*) FROM feedback_log WHERE decision = 'confirm') AS confirms,
         (SELECT COUNT(*) FROM schema_version WHERE version = 'k6_confirm_decision') AS markers`,
    ).get() as { total: number; confirms: number; markers: number };
    expect(counts.total).toBe(2); // 存量行零丢失 + 新行
    expect(counts.confirms).toBe(1);
    expect(counts.markers).toBe(1);

    // 二次迁移幂等：不重建、不重复标记、不丢行
    const second = new FeedbackCollector();
    second.setDatabase(db);
    const after = db.prepare(
      `SELECT (SELECT COUNT(*) FROM feedback_log) AS total,
              (SELECT COUNT(*) FROM schema_version WHERE version = 'k6_confirm_decision') AS markers`,
    ).get() as { total: number; markers: number };
    expect(after.total).toBe(2);
    expect(after.markers).toBe(1);

    db.close();
  });
});
