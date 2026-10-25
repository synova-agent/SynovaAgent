/**
 * tests/contract/clock-injection.test.ts — Q-6 行为契约：时钟注入 ＋ 同一测试内时间旅行
 *
 * 判据来源：#915 Q-6 规格 v2 §5.1（S1–S4）＋ §4.1 契约 ＋ 裁 365／P1 裁 A
 *   （`createMutableClock` **不进 src**：src 只导出 `Clock`/`MutableClock` 接口，
 *     测试用可变时钟工厂由本文件本地实现 —— 生产代码不得依赖测试专用工厂）。
 *
 * 覆盖：
 *   S1 可变时钟单元：构造即定位 / set 重置 / advance 前移（含 advance(0) 不变）/ 非法输入 fail-fast
 *   S2 联邦链（写面）：`new FederatedPipeline(undefined, clock)` → markShareable；
 *      `advance(60_000)` 后下一条时间戳 == T0+60s —— **同一测试内时间旅行，无全局假时钟**
 *   S3 主干链（计算面）：`new MainAgent(null, null, null, clock)` → `executeLoop('未注册')` 的
 *      startedAt == T0；`advance(30_000)` 后 == T0+30s
 *   S4 默认等价：不传 clock（默认 systemClock）⇒ 时间戳 ≈ 当前 ±1s（生产行为回归）
 *   S5 判别力自证（M4 夹具）：`advance` 不更新内部值 ⇒ S1/S2/S3 的同类断言必红（非恒真）
 *
 * 契约（铁律 47）:
 *   @input    Clock { now(): number; nowIso(): string }；FederatedPipeline(anonymizer?, clock = systemClock)；
 *             MainAgent(auditStore?, taskDecomposer?, conflictArbitrator?, clock = systemClock)
 *   @output   时间值一律来自注入的 clock；非法时钟输入 ⇒ 立即抛 ClockInputError（带 code）
 *   @degraded 无新增降级面：不传 clock 走默认 systemClock，语义不变（S4）
 *   @error    ClockInputError（code=CLOCK_INVALID_INPUT）：空串/NaN/Invalid Date/不可解析/非有限/
 *             负 advance ⇒ fail-fast，且不改动内部状态
 *
 * 设计哲学：一个注入 ＋ 三条承诺 ——
 *   注入：业务链只从 `Clock` 取时间，测试给什么就是什么；
 *   承诺 ① 精确：固定时钟下时间戳逐字符相等（不是"差不多"）；
 *   承诺 ② 可旅行：同一测试内 advance 即前移，**不动全局时钟**（断言真实 Date.now 未被伪造）；
 *   承诺 ③ 默认等价：不注入 = 系统时钟，生产行为不变（S4 回归）。
 *
 * @known-limitations
 *   - 只覆盖两条已注入链（联邦条目时间戳／循环 startedAt）；`src` 其余存量直取不在本文件视野。
 *   - `advance` 不允许回拨（负值 fail-fast）；需要回拨请用 `set`（语义显式）。
 *   - 时刻精度为毫秒整数；`nowIso()` 按 `toISOString` 截断到毫秒（亚毫秒入参不保证往返等值）。
 *   - S2/S3 的"无全局假时钟"用 `Date.now()` 前后窗口证明，不静态扫描 `vi.setSystemTime`。
 */
import { describe, it, expect } from 'vitest';

import type { MutableClock } from '../../src/services/clock';
import { FederatedPipeline } from '../../src/services/federated-pipeline';
import { MainAgent } from '../../src/agent/main-agent';

// ═══ 本地可变时钟工厂（P1 裁 A：不进 src） ═══

/** 非法时钟输入的 typed error code（铁律 32：错误须可分类） */
const CLOCK_INVALID_INPUT = 'CLOCK_INVALID_INPUT';

/** 时钟输入非法（fail-fast，不兜底、不静默忽略） */
class ClockInputError extends Error {
  readonly code = CLOCK_INVALID_INPUT;
  readonly phase = 1;
  readonly retryable = false;

  /**
   * @param message — 人读可定位的失败说明（含非法值的安全渲染）
   */
  constructor(message: string) {
    super(message);
    this.name = 'ClockInputError';
  }
}

/**
 * 把 `set`/构造的入参解析成 epoch 毫秒（ISO 字符串或 epoch 毫秒）。
 * @param at - ISO-8601 字符串或 epoch 毫秒
 * @returns epoch 毫秒（有限数）
 * @throws ClockInputError 空串/空白串/非有限数/不可解析字符串（含 `Invalid Date`）
 */
function toEpochMs(at: string | number): number {
  if (typeof at === 'number') {
    if (Number.isFinite(at) === false) {
      throw new ClockInputError(`时钟起点非法：非有限数 ${String(at)}`);
    }
    return at;
  }
  if (typeof at !== 'string') {
    // 运行时逃逸（如反序列化）也 fail-fast，不静默降级（铁律 11/24）
    throw new ClockInputError(`时钟起点非法：期望 string|number，实得 ${typeof at}`);
  }
  const trimmed = at.trim();
  if (trimmed === '') {
    throw new ClockInputError('时钟起点非法：空字符串');
  }
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms) === false) {
    throw new ClockInputError(`时钟起点非法：不可解析为时刻 ${JSON.stringify(at)}`);
  }
  return ms;
}

/**
 * 测试用可变时钟：内部单个 `nowMs`，`set` 重置、`advance` 前移（负值/非有限 ⇒ fail-fast）。
 * @param start - 起始时刻（ISO-8601 字符串或 epoch 毫秒）
 * @returns MutableClock（`now`/`nowIso` 同源读写同一 `nowMs`）
 * @throws ClockInputError 起始时刻非法（构造即刻抛，不产生半初始化对象）
 */
function createMutableClock(start: string | number): MutableClock {
  let nowMs = toEpochMs(start);

  return {
    now: (): number => nowMs,
    nowIso: (): string => new Date(nowMs).toISOString(),
    set: (at: string | number): void => {
      nowMs = toEpochMs(at);
    },
    advance: (ms: number): void => {
      if (Number.isFinite(ms) === false) {
        throw new ClockInputError(`advance 步长非法：非有限数 ${String(ms)}`);
      }
      if (ms < 0) {
        throw new ClockInputError(`advance 步长非法：不允许回拨（${ms}），回拨请用 set`);
      }
      nowMs += ms;
    },
  };
}

// ═══ 断言工具 ═══

/** 固定基准时刻：2026-01-01T00:00:00Z */
const T0 = Date.parse('2026-01-01T00:00:00Z');
const T0_ISO = '2026-01-01T00:00:00.000Z';

/** 默认等价窗口（S4）：±1000ms */
const MAX_SKEW_MS = 1_000;

/**
 * 断言"调用即刻抛 ClockInputError 且带 code"（S1 非法输入三路径共用）。
 * @param run - 触发非法输入的闭包
 * @param label - 失败时点名用例
 */
function expectClockInputError(run: () => void, label: string): void {
  let caught: unknown = undefined;
  try {
    run();
  } catch (e) {
    caught = e;
  }
  expect(caught, `${label} 应抛错但未抛`).toBeInstanceOf(ClockInputError);
  if (!(caught instanceof ClockInputError)) {
    throw new Error(`${label} 收窄失败：catch 到的不是 ClockInputError`);
  }
  expect(caught.code).toBe(CLOCK_INVALID_INPUT);
  expect(caught.retryable).toBe(false);
  expect(caught.message.length).toBeGreaterThan(0);
}

/**
 * 断言时间戳落在给定真实时间窗内（S4 默认等价共用）。
 * @param iso - 被测时间戳（ISO 字符串）
 * @param before - 调用前真实读数
 * @param after - 调用后真实读数
 * @param label - 失败时点名用例
 */
function expectNearRealTime(iso: string, before: number, after: number, label: string): void {
  const parsed = Date.parse(iso);
  expect(Number.isFinite(parsed), `${label} 时间戳不可解析：${iso}`).toBe(true);
  expect(parsed).toBeGreaterThanOrEqual(before - MAX_SKEW_MS);
  expect(parsed).toBeLessThanOrEqual(after + MAX_SKEW_MS);
}

// ═══ S1 可变时钟单元 ═══

describe('S1 createMutableClock：单元（构造/set/advance/非法输入）', () => {
  it('S1a 构造即定位：now()==Date.parse(start)，nowIso()=="2026-01-01T00:00:00.000Z"（epoch 入参等价）', () => {
    const fromIso = createMutableClock('2026-01-01T00:00:00Z');
    expect(fromIso.now()).toBe(T0);
    expect(fromIso.nowIso()).toBe(T0_ISO);
    expect(fromIso.nowIso()).toBe(new Date(fromIso.now()).toISOString()); // now/nowIso 同源

    // epoch 毫秒入参与 ISO 字符串入参等价（同一时刻，不是"近似"）
    const fromEpoch = createMutableClock(T0);
    expect(fromEpoch.now()).toBe(T0);
    expect(fromEpoch.nowIso()).toBe(T0_ISO);
    // 带时区偏移的 ISO 也解析成同一时刻
    expect(createMutableClock('2026-01-01T08:00:00+08:00').now()).toBe(T0);
  });

  it('S1b set 重置：前移/回拨到指定时刻（ISO 与 epoch 两种入参）', () => {
    const clock = createMutableClock(T0);
    clock.advance(60_000);
    expect(clock.now()).toBe(T0 + 60_000);

    clock.set(T0); // 回拨（set 显式允许）
    expect(clock.now()).toBe(T0);
    expect(clock.nowIso()).toBe(T0_ISO);

    clock.set('2026-06-15T12:34:56.789Z'); // ISO 入参
    expect(clock.now()).toBe(Date.parse('2026-06-15T12:34:56.789Z'));
    expect(clock.nowIso()).toBe('2026-06-15T12:34:56.789Z');
  });

  it('S1c advance 前移：advance(60_000) ⇒ T0+60s；advance(0) 不变；连续 advance 累加', () => {
    const clock = createMutableClock(T0);
    clock.advance(60_000);
    expect(clock.now()).toBe(T0 + 60_000);
    expect(clock.nowIso()).toBe('2026-01-01T00:01:00.000Z');

    clock.advance(0); // 零步长：不变（不抛）
    expect(clock.now()).toBe(T0 + 60_000);

    clock.advance(30_000);
    expect(clock.now()).toBe(T0 + 90_000);
    expect(clock.nowIso()).toBe('2026-01-01T00:01:30.000Z');
  });

  it('S1d 非法输入 fail-fast：空串/空白/NaN/Invalid Date/不可解析/非有限/负 advance 一律 throw 且不改状态', () => {
    // 构造期非法
    expectClockInputError(() => createMutableClock(''), '空串起点');
    expectClockInputError(() => createMutableClock('   '), '空白串起点');
    expectClockInputError(() => createMutableClock(Number.NaN), 'NaN 起点');
    expectClockInputError(() => createMutableClock(Number.POSITIVE_INFINITY), 'Infinity 起点');
    expectClockInputError(() => createMutableClock('not-a-date'), '不可解析字符串起点');
    expectClockInputError(() => createMutableClock('Invalid Date'), 'Invalid Date 起点');

    // set/advance 期非法：抛错且状态不变（fail-fast 不产生半更新）
    const clock = createMutableClock(T0);
    expectClockInputError(() => clock.set(''), 'set 空串');
    expectClockInputError(() => clock.set(Number.NaN), 'set NaN');
    expectClockInputError(() => clock.set('Invalid Date'), 'set Invalid Date');
    expectClockInputError(() => clock.advance(-1), 'advance 负值');
    expectClockInputError(() => clock.advance(Number.NaN), 'advance NaN');
    expectClockInputError(() => clock.advance(Number.NEGATIVE_INFINITY), 'advance -Infinity');

    expect(clock.now()).toBe(T0); // 六次非法调用后内部值未被污染
    expect(clock.nowIso()).toBe(T0_ISO);
  });
});

// ═══ S2 联邦链（写面）· 同一测试内时间旅行 ═══

describe('S2 联邦链：注入 clock ⇒ 条目时间戳 == 注入值（同一测试内时间旅行）', () => {
  it('S2 markShareable ⇒ createdAt==T0；advance(60_000) 后下一条 == T0+60s（无全局假时钟）', () => {
    const realBefore = Date.now();
    const clock = createMutableClock(T0);
    const pipeline = new FederatedPipeline(undefined, clock);

    const first = pipeline.markShareable('chunk-1', '某企业营收 350 万元，联系 admin@corp.com', 'org-a');
    expect(first.createdAt).toBe(T0_ISO);
    expect(first.updatedAt).toBe(T0_ISO);
    expect(first.status).toBe('pending_admin');
    // 时间戳与 id 同源于同一次 clock 读数（id 进日志、不入契约对象 ⇒ 只能间接证：见下方日志外的差分断言）

    clock.advance(60_000); // ← 时间旅行：只改注入时钟，不动全局 Date

    const second = pipeline.markShareable('chunk-2', '另一企业营收 120 万元', 'org-b');
    expect(second.createdAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(second.updatedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(Date.parse(second.createdAt) - Date.parse(first.createdAt)).toBe(60_000);
    // 两条记录互不覆盖（各自持有当时的时钟读数；同一 pipeline 实例内）
    expect(second.createdAt).not.toBe(first.createdAt);
    expect(second.sourceChunkId).not.toBe(first.sourceChunkId);

    // 时间旅行不回溯改写历史条目（各自持有当时的时钟读数）
    expect(first.createdAt).toBe(T0_ISO);
    // 无全局假时钟：测试期间真实系统时钟未被伪造（否则本条会红）
    expect(Math.abs(Date.now() - realBefore)).toBeLessThan(5_000);
  });
});

// ═══ S3 主干链（计算面）· startedAt 时间旅行 ═══

describe('S3 主干链：注入 clock ⇒ 循环 startedAt == 注入值（失败记录路径，零 handler 依赖）', () => {
  it('S3 executeLoop(未注册) ⇒ startedAt==T0；advance(30_000) 后再调 ⇒ T0+30s', async () => {
    const realBefore = Date.now();
    const clock = createMutableClock(T0);
    const agent = new MainAgent(null, null, null, clock);

    const first = await agent.executeLoop('no-such-loop');
    expect(first.status).toBe('failed');
    expect(first.startedAt).toBe(T0_ISO);
    expect(first.durationMs).toBe(0);
    expect(first.degraded).toBe(true);
    expect(first.error).toContain('no-such-loop'); // 失败原因仍点名循环 id（既有语义不变）

    clock.advance(30_000);

    const second = await agent.executeLoop('no-such-loop');
    expect(second.status).toBe('failed');
    expect(second.startedAt).toBe(new Date(T0 + 30_000).toISOString());
    expect(Date.parse(second.startedAt) - Date.parse(first.startedAt)).toBe(30_000);
    // 历史记录不被时间旅行改写
    expect(first.startedAt).toBe(T0_ISO);
    expect(Math.abs(Date.now() - realBefore)).toBeLessThan(5_000);
  });
});

// ═══ S4 默认等价（不传 clock） ═══

describe('S4 默认等价：不传 clock ⇒ systemClock ⇒ 时间戳 ≈ 当前 ±1s', () => {
  it('S4 new FederatedPipeline() / new MainAgent() 的时间戳 ≈ 真实当前时间', async () => {
    // 联邦链默认构造（既有调用点形态：零参）
    const pipeline = new FederatedPipeline();
    const beforeEntry = Date.now();
    const entry = pipeline.markShareable('chunk-default', '默认时钟回归文本 88 万元', 'org-default');
    const afterEntry = Date.now();
    expectNearRealTime(entry.createdAt, beforeEntry, afterEntry, '默认系统时钟 entry.createdAt');
    expect(entry.createdAt).toBe(entry.updatedAt);

    // 主干链默认构造（既有调用点形态：零参）
    const agent = new MainAgent();
    const beforeLoop = Date.now();
    const record = await agent.executeLoop('no-such-loop');
    const afterLoop = Date.now();
    expectNearRealTime(record.startedAt, beforeLoop, afterLoop, '默认系统时钟 record.startedAt');
    expect(record.status).toBe('failed');
  });
});

// ═══ S5 判别力自证（M4 夹具） ═══

describe('S5 判别力自证：改坏必红（M4 夹具）', () => {
  it('S5 advance 不更新内部值（故意做坏）⇒ 时间不前进，S1/S2/S3 同类断言必红', () => {
    const broken: MutableClock = {
      now: (): number => T0,
      nowIso: (): string => T0_ISO,
      set: (): void => {
        /* 故意空操作（M4 改坏形态） */
      },
      advance: (): void => {
        /* 故意空操作（M4 改坏形态） */
      },
    };

    broken.advance(60_000);
    expect(broken.now()).toBe(T0); // 改坏后时间真的不动
    // 这正是 S2/S3 会红的原因：期望值 ≠ 实得值（断言不是恒真）
    expect(broken.nowIso()).not.toBe(new Date(T0 + 60_000).toISOString());
    expect(new Date(T0 + 60_000).toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });
});
