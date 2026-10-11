/**
 * tests/cron/cron-config.test.ts — #1454 B8 判据 V4
 *
 * 被验对象：`src/cron/cron-config.ts:resolveLoopCron` / `DEFAULT_LOOP_CRON`
 * 卡面 §③ 约束：「cron 表达式可配置化；反馈回环（loop-3）默认日频——不破坏『想配季度』
 * 的意愿表达」+「🔴 不改变任何循环的业务语义」。
 *
 * 判据口径：
 *   ① 默认**非季度**用**语义**判（下一次触发的时延），不用字符串相等 —— 写死字符串的断言
 *      在换一种等价表达时会假红/假绿；
 *   ② 其余 5 个循环的默认值必须**逐字等于** `origin/main@5a6591c4a` 原值（防未获批的节律变更）；
 *   ③ env 与配置文件两条路都要能配成季度并**真的生效**。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nextCronTime } from '../../src/cron/scheduler';

/** 捕获日志（判据要求「降级必留痕」，不是 grep 型静态断言） */
const logCapture = vi.hoisted(() => {
  const calls: Array<{ level: string; msg?: unknown }> = [];
  return { calls };
});

vi.mock('@synova/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@synova/logger')>();
  const record = (level: string) => (_meta?: unknown, msg?: unknown) => {
    logCapture.calls.push({ level, msg });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'),
    }),
  };
});

import { DEFAULT_LOOP_CRON, resolveLoopCron } from '../../src/cron/cron-config';
import { LoopScheduler, type CronSchedulerLike } from '../../src/loops/loop-scheduler';

const KEYS = [
  'SYNOVA_CRON_CONFIG',
  'SYNOVA_DATA_DIR',
  'SYNOVA_CRON_LOOP_3_GA_EVOLUTION',
  'SYNOVA_CRON_LOOP_6_OVERFLOW', // 用例里会被设置，必须一并复原（否则跨 describe 串味）
] as const;

/** `origin/main@5a6591c4a:src/loops/loop-scheduler.ts:95-120` 的原值（逐字） */
const ORIGIN_MAIN_CRON: Record<string, string> = {
  'loop-1-diagnosis': '0 9 1 */3 *',
  'loop-2-navigation': '0 9 * * 1',
  'loop-3-ga-evolution': '0 9 1 */3 *',
  'loop-4-self-check': '0 0 * * *',
  'loop-5-knowledge': '0 0 * * 0',
  'loop-6-overflow': '0 9 1 * *',
};

/** 距下一次触发的天数（语义判据） */
function daysUntil(expr: string, from: Date): number {
  return (nextCronTime(expr, from).getTime() - from.getTime()) / 86_400_000;
}

describe('#1454 V4 · 默认口径：loop-3 日频，其余节律保持 origin/main 原值', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    logCapture.calls.length = 0;
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('loop-3 默认**非季度**：语义上 ≤2 天内触发（季度会是 ~84 天）', () => {
    const cron = resolveLoopCron('loop-3-ga-evolution');
    const from = new Date(2026, 9, 9, 12, 0, 0); // 2026-10-09 12:00
    expect(daysUntil(cron, from)).toBeLessThanOrEqual(2);
    // 反向锚：确认这个日期下季度口径确实是 ~84 天，证明上面的阈值有判别力
    expect(daysUntil(ORIGIN_MAIN_CRON['loop-3-ga-evolution'], from)).toBeGreaterThan(30);
  });

  it('loop-3 默认值 ≠ origin/main 的季度值（本卡唯一获批的节律变更）', () => {
    expect(resolveLoopCron('loop-3-ga-evolution')).not.toBe(ORIGIN_MAIN_CRON['loop-3-ga-evolution']);
  });

  it('其余 5 个循环默认值逐字等于 origin/main 原值（防未获批的节律变更）', () => {
    for (const job of [
      'loop-1-diagnosis', 'loop-2-navigation', 'loop-4-self-check',
      'loop-5-knowledge', 'loop-6-overflow',
    ]) {
      expect(resolveLoopCron(job), `${job} 默认口径被改动`).toBe(ORIGIN_MAIN_CRON[job]);
    }
  });

  it('默认值是 5 字段、可被 nextCronTime 解析（每个循环都验）', () => {
    for (const job of Object.keys(DEFAULT_LOOP_CRON)) {
      expect(DEFAULT_LOOP_CRON[job].trim().split(/\s+/)).toHaveLength(5);
      const from = new Date(2026, 9, 9, 12, 0, 0);
      expect(daysUntil(resolveLoopCron(job), from)).toBeLessThanOrEqual(95);
    }
  });

  it('未知 job 名 ⇒ 兜底 5 字段表达式（不抛、不返回空）', () => {
    const cron = resolveLoopCron('loop-999-not-exist');
    expect(cron.trim().split(/\s+/)).toHaveLength(5);
  });
});

describe('#1454 V4 · 配置路径 ①：环境变量（配成季度仍生效）', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    logCapture.calls.length = 0;
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('SYNOVA_CRON_LOOP_3_GA_EVOLUTION 覆盖默认值，且语义上真是季度', () => {
    process.env.SYNOVA_CRON_LOOP_3_GA_EVOLUTION = '0 9 1 */3 *';
    const cron = resolveLoopCron('loop-3-ga-evolution');
    expect(cron).toBe('0 9 1 */3 *');
    const from = new Date(2026, 9, 9, 12, 0, 0);
    expect(daysUntil(cron, from)).toBeGreaterThan(30); // 2026-10-09 → 2027-01-01
  });

  it('job 名到 env key 的映射：`-` → `_` 且大写', () => {
    process.env.SYNOVA_CRON_LOOP_6_OVERFLOW = '0 3 2 * *';
    expect(resolveLoopCron('loop-6-overflow')).toBe('0 3 2 * *');
  });

  it('env 值非法（非 5 字段）⇒ 回落默认 + log.warn 留痕', () => {
    process.env.SYNOVA_CRON_LOOP_3_GA_EVOLUTION = '0 9 *'; // 3 字段
    const cron = resolveLoopCron('loop-3-ga-evolution');
    expect(cron).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(true);
  });

  it('env 为空串 ⇒ 视为未配置（走下一档），不产生空表达式', () => {
    process.env.SYNOVA_CRON_LOOP_3_GA_EVOLUTION = '';
    expect(resolveLoopCron('loop-3-ga-evolution')).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(false);
  });
});

describe('#1454 V4 · 配置路径 ②：配置文件（配成季度仍生效）+ 优先级 + 降级', () => {
  let tmpRoot: string;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    logCapture.calls.length = 0;
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'synova-1454-v4-'));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeCfg(content: string): string {
    const p = path.join(tmpRoot, 'cron-loops.json');
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('SYNOVA_CRON_CONFIG 指定的文件生效，可配成季度', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg(JSON.stringify({ 'loop-3-ga-evolution': '0 9 1 */6 *' }));
    const cron = resolveLoopCron('loop-3-ga-evolution');
    expect(cron).toBe('0 9 1 */6 *');
    const from = new Date(2026, 9, 9, 12, 0, 0);
    expect(daysUntil(cron, from)).toBeGreaterThan(30);
  });

  it('opts.dataDir 推导 <dataDir>/cron-loops.json（未设 SYNOVA_CRON_CONFIG 时）', () => {
    fs.writeFileSync(
      path.join(tmpRoot, 'cron-loops.json'),
      JSON.stringify({ 'loop-6-overflow': '0 5 15 * *' }),
      'utf-8',
    );
    expect(resolveLoopCron('loop-6-overflow', { dataDir: tmpRoot })).toBe('0 5 15 * *');
  });

  it('优先级：env 胜过配置文件（同 key 同时存在）', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg(JSON.stringify({ 'loop-3-ga-evolution': '0 9 1 */6 *' }));
    process.env.SYNOVA_CRON_LOOP_3_GA_EVOLUTION = '0 9 * * *';
    expect(resolveLoopCron('loop-3-ga-evolution')).toBe('0 9 * * *');
  });

  it('降级：配置文件坏 JSON ⇒ 回落默认 + log.warn（且不抛）', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg('{ this is not json');
    const cron = resolveLoopCron('loop-3-ga-evolution');
    expect(cron).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(true);
  });

  it('降级：配置项值非法 ⇒ 回落默认 + log.warn', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg(JSON.stringify({ 'loop-3-ga-evolution': 42 }));
    const cron = resolveLoopCron('loop-3-ga-evolution');
    expect(cron).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(true);
  });

  it('降级：配置文件不存在 ⇒ 静默回落默认（不 warn，未配置是正常态）', () => {
    process.env.SYNOVA_CRON_CONFIG = path.join(tmpRoot, 'not-there.json');
    expect(resolveLoopCron('loop-3-ga-evolution')).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(false);
  });

  it('降级：根不是对象（数组/标量）⇒ 忽略配置文件 + 回落默认', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg('[1,2,3]');
    expect(resolveLoopCron('loop-3-ga-evolution')).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(logCapture.calls.some((c) => c.level === 'warn')).toBe(true);
  });

  it('单 key 坏不影响其他 key（isolation）', () => {
    process.env.SYNOVA_CRON_CONFIG = writeCfg(
      JSON.stringify({ 'loop-3-ga-evolution': 'bad', 'loop-6-overflow': '0 5 15 * *' }),
    );
    expect(resolveLoopCron('loop-3-ga-evolution')).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    expect(resolveLoopCron('loop-6-overflow')).toBe('0 5 15 * *');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 接线判据（铁律 0-2 / 4：只写解析函数不算交付 —— 必须证明「被执行」）
// 口径：用 stub CronScheduler 抓 `schedule(name, cron, ...)` 的实参，
//       它不是 mock 掉管线，而是**替换下游边界**；上游 `LoopScheduler` 是真实实例。
// ═══════════════════════════════════════════════════════════════════════════

describe('#1454 V4 · 接线：LoopScheduler 真的把口径送进 CronScheduler', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    logCapture.calls.length = 0;
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** 抓取 schedule() 实参的 stub（含 heartbeat 一路，用名字区分） */
  function makeStub(): { calls: Array<{ name: string; cron: string }>; stub: CronSchedulerLike } {
    const calls: Array<{ name: string; cron: string }> = [];
    const stub: CronSchedulerLike = {
      schedule(name: string, cron: string): string {
        calls.push({ name, cron });
        return `job-${name}`;
      },
    };
    return { calls, stub };
  }

  const BUILTIN_JOBS = [
    'loop-1-diagnosis', 'loop-2-navigation', 'loop-3-ga-evolution',
    'loop-4-self-check', 'loop-5-knowledge', 'loop-6-overflow',
  ];

  it('构造 LoopScheduler(stub) ⇒ 6 个内置循环各以「配置解析出的 cron」注册（真跑通）', () => {
    const { calls, stub } = makeStub();
    new LoopScheduler(stub);

    const builtin = calls.filter((c) => BUILTIN_JOBS.includes(c.name));
    expect(builtin.map((c) => c.name).sort()).toEqual([...BUILTIN_JOBS].sort());

    const byName = Object.fromEntries(builtin.map((c) => [c.name, c.cron]));
    // loop-3 = 日频（卡面 B8）；其余 = origin/main 原值（卡面 §③ 不变更业务语义）
    expect(byName['loop-3-ga-evolution']).toBe(DEFAULT_LOOP_CRON['loop-3-ga-evolution']);
    for (const job of ['loop-1-diagnosis', 'loop-2-navigation', 'loop-4-self-check', 'loop-5-knowledge', 'loop-6-overflow']) {
      expect(byName[job], `${job} 注册口径 ≠ origin/main 原值`).toBe(ORIGIN_MAIN_CRON[job]);
    }
  });

  it('env 覆盖真的抵达 CronScheduler（端到端：env → registerLoop → schedule 实参）', () => {
    process.env.SYNOVA_CRON_LOOP_3_GA_EVOLUTION = '0 9 1 */3 *';
    const { calls, stub } = makeStub();
    new LoopScheduler(stub);

    const loop3 = calls.find((c) => c.name === 'loop-3-ga-evolution');
    expect(loop3?.cron).toBe('0 9 1 */3 *');
    // 语义复核：这条季度表达式在修后能被解析（不再是空集）
    const from = new Date(2026, 9, 9, 12, 0, 0);
    expect(daysUntil(loop3!.cron, from)).toBeGreaterThan(30);
  });

  it('注册的每条表达式都非空且 5 字段（下游 CronScheduler 不会收到坏表达式）', () => {
    const { calls, stub } = makeStub();
    new LoopScheduler(stub);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.cron.trim().split(/\s+/), `${c.name} 的 cron 非法: "${c.cron}"`).toHaveLength(5);
    }
  });
});
