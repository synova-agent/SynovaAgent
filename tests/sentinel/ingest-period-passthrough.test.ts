/**
 * tests/sentinel/ingest-period-passthrough.test.ts — #1486 裁定 c：period 透传 + ④a 读路径（现成 reader）。
 *
 * 判据（Issue #1486「四条裁定 c」＋验收 c）：
 *   [正常]   带 `period` 调哨兵 ⇒ **不再出现** `S2_DEGRADED_NO_PERIOD`；`SentinelContext.period` 就位；
 *            `ctx.metricObservations.get()` 读到 `metric_observations` 的**真实行**（值 = 上一轮写入的 findings 条数）
 *   [行为不变] 不带 `period` ⇒ 仍出现 `S2_DEGRADED_NO_PERIOD`；`ctx.period` 未定义、无读路径（与改动前逐字段一致）
 *   [来源]   `resolveLatestMaterialPeriod` 只从 ② 资料取**最新合法** `YYYY-MM`；无资料/非法值/跨分区 ⇒ undefined
 *   [边界]   有 period 但无 teamId ⇒ 透传 period、**不注入**读路径（租户未知 ⇒ 不跨租户读）；并给出既有 `S2_DEGRADED_NO_ORG`
 *   [失败]   资料不可查（表缺失）⇒ `resolveLatestMaterialPeriod` 原样抛出（不静默空）
 *
 * 期望值来源：PERIOD/OBJECT_KEY/FINDINGS_COUNT/CHECKED_AT 全部由本文件构造；读回值断言的是"上一轮写入的值"，
 *   不拿被测实现的自报值当期望。
 * 库口径：`:memory:`（vitest env `SYNOVA_DB_PATH=':memory:'`；beforeAll fail-fast），不碰 `data/synova.db`。
 * 铁律 33/38/48：单元测试 + 零 any 家族断言 + 全用例含 expect()。
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, initEngineContext } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { runSentinelForTeam } from '../../src/sentinel/sentinel-runner';
import {
  destroySentinelRegistry,
  getSentinelRegistry,
} from '../../src/sentinel/registry';
import { createObject, resolveLatestMaterialPeriod } from '../../src/agent/graph-store-service';
import type { Sentinel, SentinelCheckResult, SentinelContext, SentinelFinding } from '../../src/sentinel/types';

// ═══ 测试构造的输入（期望值的唯一来源）═══
const ORG = 'org-1486-c';
const OTHER_ORG = 'org-1486-c-other';
const PERIOD = '2026-10';
const OTHER_PERIOD = '2026-11';
const OBJECT_KEY = 'team-1486-c';
const SENTINEL_ID = 'ingest-period-probe';
const FINDINGS_COUNT = 3;
const CHECKED_AT = '2026-11-24T09:00:00.000Z';

// ═══ log.warn 运行时捕获（判据：降级码必须可见；范式同 tests/sentinel/stage2-s2-producer.test.ts）═══
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; meta?: Record<string, unknown>; msg?: unknown }> = [];
  return { calls };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (meta?: Record<string, unknown>, msg?: unknown) => {
    logCapture.calls.push({ level, meta, msg });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

function warnCodes(): string[] {
  const codes: string[] = [];
  for (const call of logCapture.calls) {
    if (call.level !== 'warn') continue;
    const code = call.meta?.['code'];
    if (typeof code === 'string') codes.push(code);
  }
  return codes;
}

function makeFindings(count: number): SentinelFinding[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${SENTINEL_ID}-finding-${i + 1}`,
    severity: 'warning' as const,
    title: `发现 ${i + 1}`,
    description: '测试构造的发现',
    evidence: [],
    suggestion: '无',
    detectedAt: CHECKED_AT,
  }));
}

/** 探针哨兵：记录本轮上下文（period 是否透传到、读路径是否注入）并尝试读真实观测行。 */
const seen: Array<{ period: string | undefined; hasReader: boolean; readValue: number | null; readError?: string }> = [];
let readObjectId = '';

function makeProbeSentinel(): Sentinel {
  return {
    config: {
      id: SENTINEL_ID,
      name: 'period 透传探针',
      description: '固定 findings；读上一轮 ④a 真实行',
      category: 'growth',
      priority: 'P1',
      mode: 'manual',
      requiredDataSources: [],
      confidenceModel: 'deterministic',
      version: '1.0.0',
    },
    async check(context: SentinelContext): Promise<SentinelCheckResult> {
      const hasReader = context.metricObservations !== undefined;
      let readValue: number | null = null;
      let readError: string | undefined;
      if (context.metricObservations !== undefined && readObjectId !== '') {
        try {
          const row = context.metricObservations.get(readObjectId, `SENTINEL-FINDINGS-${SENTINEL_ID}`);
          readValue = row === null ? null : row.value;
        } catch (err: unknown) {
          readError = err instanceof Error ? err.message : String(err);
        }
      }
      seen.push({ period: context.period, hasReader, readValue, readError });
      return {
        sentinelId: SENTINEL_ID,
        ok: true,
        findings: makeFindings(FINDINGS_COUNT),
        durationMs: 5,
        checkedAt: CHECKED_AT,
      };
    },
  };
}

let store: SqliteGraphStore;

beforeAll(() => {
  if (process.env.SYNOVA_DB_PATH !== ':memory:') {
    throw new Error(`ingest-period-passthrough.test 只允许 :memory: 数据库，实得 ${String(process.env.SYNOVA_DB_PATH)}`);
  }
  initEngineContext();
  store = new SqliteGraphStore(getDatabase());
});

beforeEach(() => {
  destroySentinelRegistry();
  logCapture.calls.length = 0;
  seen.length = 0;
  readObjectId = '';
  getSentinelRegistry().register(makeProbeSentinel());
});

afterEach(() => {
  destroySentinelRegistry();
});

describe('#1486 c · 哨兵 period 透传 + metric_observations 读路径', () => {
  it('[正常] 带 period ⇒ 无 S2_DEGRADED_NO_PERIOD，ctx.period/读路径就位，读到真实行', async () => {
    // 第 1 轮：真实写入 ④a 两行（object_id 指向 resolveOrCreate 建出的 Team 节点）
    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });
    const row = getDatabase().prepare(
      'SELECT object_id, value FROM metric_observations WHERE org_id = ? AND metric_id = ? AND period = ?',
    ).get(ORG, `SENTINEL-FINDINGS-${SENTINEL_ID}`, PERIOD) as { object_id: string; value: number };
    expect(row.value).toBe(FINDINGS_COUNT);
    readObjectId = row.object_id;

    // 第 2 轮：探针读第 1 轮落下的真实行
    logCapture.calls.length = 0;
    seen.length = 0;
    await runSentinelForTeam(ORG, store, { period: PERIOD, objectKey: OBJECT_KEY });

    expect(warnCodes()).not.toContain('S2_DEGRADED_NO_PERIOD');
    expect(seen).toHaveLength(1);
    expect(seen[0].period).toBe(PERIOD);
    expect(seen[0].hasReader).toBe(true);
    expect(seen[0].readError).toBeUndefined();
    expect(seen[0].readValue).toBe(FINDINGS_COUNT);
  });

  it('[行为不变] 不带 period ⇒ 仍有 S2_DEGRADED_NO_PERIOD；ctx 无 period/读路径', async () => {
    await runSentinelForTeam(ORG, store, { objectKey: OBJECT_KEY });

    expect(warnCodes()).toContain('S2_DEGRADED_NO_PERIOD');
    expect(seen).toHaveLength(1);
    expect(seen[0].period).toBeUndefined();
    expect(seen[0].hasReader).toBe(false);
    expect(seen[0].readValue).toBeNull();
  });

  it('[边界] 有 period 但无 teamId ⇒ 透传 period、不注入读路径（不跨租户读）+ 既有 S2_DEGRADED_NO_ORG', async () => {
    await runSentinelForTeam('', store, { period: PERIOD, objectKey: OBJECT_KEY });

    expect(warnCodes()).toContain('S2_DEGRADED_NO_ORG');
    expect(warnCodes()).not.toContain('S2_DEGRADED_NO_PERIOD');
    expect(seen[0].period).toBe(PERIOD);
    expect(seen[0].hasReader).toBe(false);
  });

  it('[来源] resolveLatestMaterialPeriod 只认 ② 资料里的最新合法 YYYY-MM', () => {
    const db = getDatabase();
    createObject(ORG, 'Team', { name: '九月', period: '2026-09' });
    createObject(ORG, 'Team', { name: '十一月', period: OTHER_PERIOD });
    // 绕过服务原语的非法期间历史行（SQL 直写 ② 表；解析侧必须过滤，不得当证据）
    store.createNode('Team', { name: '脏期间', period: '2026-13' }, ORG);
    createObject(OTHER_ORG, 'Team', { name: '别的企业', period: '2026-12' });

    expect(resolveLatestMaterialPeriod(ORG, db)).toBe(OTHER_PERIOD);
    expect(resolveLatestMaterialPeriod(ORG)).toBe(OTHER_PERIOD); // 缺省 db = 引擎库单例
    expect(resolveLatestMaterialPeriod('org-1486-c-empty', db)).toBeUndefined();
    expect(resolveLatestMaterialPeriod('', db)).toBeUndefined();
  });

  it('[失败] 资料不可查（表缺失）⇒ 原样抛出，不静默返回 undefined', () => {
    const bare = new Database(':memory:');
    try {
      expect(() => resolveLatestMaterialPeriod(ORG, bare)).toThrow(/no such table/i);
    } finally {
      bare.close();
    }
  });
});
