/**
 * tests/cron/parse-cron-field.test.ts — #1454 B1 判据 V1
 *
 * 被验对象：`src/cron/scheduler.ts` 的 `parseCronField` / `nextCronTime`
 * 修前（origin/main@5a6591c4a）：只解析 `*` 与整数列表 ⇒ `* /n` 与 `a-b` 落
 * `parseInt('* /3') = NaN` ⇒ **空集** ⇒ `nextCronTime` 退化为 2 年逐分钟全扫
 * （1,052,640 次/调用，实测 ~168ms/行 ⇒ 370 行库启动累加 ~21.8s）。
 *
 * 判据覆盖（卡面 §⑥ V1）：`* /n` · `a-b` · `a-b/n` · 列表混用 · 越界裁剪 · 非法片段
 * 反例（改坏必红）：删掉步进/区间分支 ⇒ 本文件 red（负向对照见交付评论原始输出）。
 */
import { describe, it, expect, vi } from 'vitest';
import { parseCronField, nextCronTime } from '../../src/cron/scheduler';

/**
 * 捕获 cron/scheduler 的 `log.warn`（降级可见性 + 迭代次数的**确定性**判据来源）。
 *
 * 为什么必须捕获日志而不是量墙钟：`expect(elapsedMs).toBeLessThan(50)` 这类负载型断言在
 * 忙碌 CI 上会假红（V-04：本机通过 ≠ CI 通过）。改断**迭代次数**（`iterations` / 有无该字段），
 * 既与机器负载无关，又正好是本卡「有界 + 不静默」的语义本体。
 */
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

/** 集合 → 升序数组（断言可读性） */
const arr = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

describe('#1454 V1 · parseCronField 正常路径', () => {
  it('`*` 恒等于全域（分 0-59 / 周 0-6）', () => {
    expect(arr(parseCronField('*', 0, 59))).toHaveLength(60);
    expect(arr(parseCronField('*', 0, 59))[0]).toBe(0);
    expect(arr(parseCronField('*', 0, 59))[59]).toBe(59);
    expect(arr(parseCronField('*', 0, 6))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(arr(parseCronField('*', 1, 31))[0]).toBe(1);
  });

  it('`* /n` 步进：自 min 起、每 n 个（卡面点名 `* /3`）', () => {
    expect(arr(parseCronField('*/3', 0, 59))).toEqual(
      [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57],
    );
    // min ≠ 0 的字段（日 1-31）步进起于 min 而非 0
    expect(arr(parseCronField('*/10', 1, 31))).toEqual([1, 11, 21, 31]);
    // 月 1-12 的季度步进 —— 修前该形态解析为空集
    expect(arr(parseCronField('*/3', 1, 12))).toEqual([1, 4, 7, 10]);
    expect(arr(parseCronField('*/6', 1, 12))).toEqual([1, 7]);
    // 步长 ≥ 全域宽度 ⇒ 只剩 min
    expect(arr(parseCronField('*/60', 0, 59))).toEqual([0]);
  });

  it('`a-b` 区间', () => {
    expect(arr(parseCronField('9-17', 0, 23))).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(arr(parseCronField('1-5', 0, 59))).toEqual([1, 2, 3, 4, 5]);
    // 单点区间
    expect(arr(parseCronField('7-7', 0, 59))).toEqual([7]);
  });

  it('`a-b/n` 区间步进（卡面点名 `0 9 1 */3 *` 同族）', () => {
    expect(arr(parseCronField('9-17/2', 0, 23))).toEqual([9, 11, 13, 15, 17]);
    expect(arr(parseCronField('0-59/30', 0, 59))).toEqual([0, 30]);
    expect(arr(parseCronField('1-12/3', 1, 12))).toEqual([1, 4, 7, 10]);
  });

  it('`n/m` 起点步进（Vixie 语义：n 起、每 m、上界 max）', () => {
    expect(arr(parseCronField('0/15', 0, 59))).toEqual([0, 15, 30, 45]);
    expect(arr(parseCronField('5/10', 0, 59))).toEqual([5, 15, 25, 35, 45, 55]);
    expect(arr(parseCronField('8/8', 0, 23))).toEqual([8, 16]);
  });

  it('列表混用：单值 / 区间 / 步进 / 起点步进可并列，逗号两侧空白被吃', () => {
    expect(arr(parseCronField('1,5-7,*/20', 0, 59))).toEqual([0, 1, 5, 6, 7, 20, 40]);
    expect(arr(parseCronField(' 2 , 4-6 , 8/4 ', 0, 59))).toEqual([
      2, 4, 5, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56,
    ]);
    // 列表内重复取值去重
    expect(arr(parseCronField('3,3,1-4', 0, 59))).toEqual([1, 2, 3, 4]);
    // 空片段（尾逗号）不引入取值，也不吃掉其他片段
    expect(arr(parseCronField('1,,2,', 0, 59))).toEqual([1, 2]);
  });
});

describe('#1454 V1 · 越界裁剪与越界拒绝', () => {
  it('区间两端**裁剪**到 [min,max]', () => {
    expect(arr(parseCronField('50-70', 0, 59))).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(arr(parseCronField('0-70/30', 0, 59))).toEqual([0, 30]);
    // 日字段下界 1：0-31 裁剪后从 1 起
    expect(arr(parseCronField('0-3', 1, 31))).toEqual([1, 2, 3]);
  });

  it('完全落在域外的区间 ⇒ 不贡献取值（空集）', () => {
    expect(parseCronField('70-80', 0, 59).size).toBe(0);
    expect(parseCronField('0-0', 1, 31).size).toBe(0);
  });

  it('越界**单值**不裁剪、不贡献 —— 静默裁剪会把它变成另一个看似正常的表达式', () => {
    expect(parseCronField('70', 0, 59).size).toBe(0);
    expect(parseCronField('0', 1, 31).size).toBe(0);
    expect(parseCronField('0/5', 1, 31).size).toBe(0);
    // 边界值本身合法
    expect(arr(parseCronField('59', 0, 59))).toEqual([59]);
    expect(arr(parseCronField('31', 1, 31))).toEqual([31]);
  });

  it('不变量：结果恒为 [min,max] 子集（遍历一批含越界/混用的片段）', () => {
    const fields: [string, number, number][] = [
      ['*', 0, 59], ['*/7', 0, 59], ['50-70/3', 0, 59], ['58,59,70', 0, 59],
      ['*/5', 1, 31], ['0-31', 1, 31], ['1-12/3', 1, 12], ['0-6', 0, 6],
    ];
    for (const [f, lo, hi] of fields) {
      for (const v of parseCronField(f, lo, hi)) {
        expect(v, `字段 ${f} 产出越界值 ${v}`).toBeGreaterThanOrEqual(lo);
        expect(v, `字段 ${f} 产出越界值 ${v}`).toBeLessThanOrEqual(hi);
      }
    }
  });
});

describe('#1454 V1 · 非法片段跳过（不抛、不污染同串的合法片段）', () => {
  it('全非法片段 ⇒ 空集', () => {
    const bad = [
      '', ' ', 'abc', '1-', '-', '-5', '5-', '1-2-3', '2.5', '1e3', '+5',
      '*/0', '*/x', '*/-1', '*/', '/3', '1//2', 'a-b', '5/0', '5/-2',
    ];
    for (const f of bad) {
      expect(parseCronField(f, 0, 59).size, `片段 "${f}" 应为空集`).toBe(0);
    }
  });

  it('部分非法：非法片段被跳过，合法片段照常生效', () => {
    expect(arr(parseCronField('abc,5', 0, 59))).toEqual([5]);
    expect(arr(parseCronField('5,75', 0, 59))).toEqual([5]);
    expect(arr(parseCronField('1-2-3,8', 0, 59))).toEqual([8]);
    expect(arr(parseCronField('*/0,*/30', 0, 59))).toEqual([0, 30]);
    expect(arr(parseCronField('-5,9-11', 0, 59))).toEqual([9, 10, 11]);
    // `7` 在周字段（0-6）越界 ⇒ 跳过，不静默折算为 0
    expect(parseCronField('7', 0, 6).size).toBe(0);
  });

  it('反向区间被拒（不是「取绝对值」或空扫）', () => {
    expect(parseCronField('17-9', 0, 23).size).toBe(0);
    expect(arr(parseCronField('17-9,4', 0, 23))).toEqual([4]);
  });
});

describe('#1454 V1 · nextCronTime 消费解析结果（B1 的成本判据在此闭环）', () => {
  const from = new Date(2026, 0, 15, 10, 30, 0); // 2026-01-15 10:30 本地时

  it('步进表达式给出下一次真实触发（修前为 2 年后兜底整点）', () => {
    expect(nextCronTime('*/5 * * * *', from).getTime()).toBe(
      new Date(2026, 0, 15, 10, 35, 0).getTime(),
    );
    expect(nextCronTime('0 9 1 */3 *', from).getTime()).toBe(
      new Date(2026, 3, 1, 9, 0, 0).getTime(), // 1 月 15 日 → 下一个 1/4/7/10 月的 1 日 9 点 = 4/1
    );
    expect(nextCronTime('0 9 1 */6 *', from).getTime()).toBe(
      new Date(2026, 6, 1, 9, 0, 0).getTime(), // → 7/1
    );
    expect(nextCronTime('9-17/2 * * * *', from).getTime()).toBe(
      new Date(2026, 0, 15, 11, 9, 0).getTime(), // 分集合 {9,11,…,17} ⇒ 10:31 之后首个命中 = 11:09
    );
  });

  it('无效表达式 ⇒ 兜底为「下一个整点」，且**零次迭代**（确定性：不看墙钟）', () => {
    logCapture.calls.length = 0;
    const fb = nextCronTime('*/0 * * * *', from);
    expect(fb.getTime()).toBe(new Date(2026, 0, 15, 11, 0, 0).getTime());
    expect(fb.getTime()).toBeGreaterThan(from.getTime());
    expect(fb.getTime() - from.getTime()).toBeLessThanOrEqual(3_600_000);

    // 🔴 确定性判据（原为 `expect(elapsedMs).toBeLessThan(50)` —— 负载型断言在 CI 上会假红，V-04）：
    // 空集路径**根本不进搜索循环** ⇒ 其 warn 里**没有 `iterations` 字段**（区别于「窗内无匹配」那条）。
    // 这是本卡「有界」语义的直接证据，且与机器负载无关。
    expect(logCapture.calls).toHaveLength(1);
    expect(logCapture.calls[0].level).toBe('warn');
    expect(logCapture.calls[0].meta).toMatchObject({ cron: '*/0 * * * *', fields: 5 });
    expect(logCapture.calls[0].meta).not.toHaveProperty('iterations');
  });

  it('字段数 ≠ 5 ⇒ 兜底（不再按缺省字段静默匹配）', () => {
    expect(nextCronTime('0 9 * *', from).getTime()).toBe(
      new Date(2026, 0, 15, 11, 0, 0).getTime(),
    );
    expect(nextCronTime('', from).getTime()).toBe(
      new Date(2026, 0, 15, 11, 0, 0).getTime(),
    );
  });

  it('窗内无匹配（2 月 31 日）⇒ 兜底，且迭代次数**有上界**（确定性：断迭代数，不断墙钟）', () => {
    logCapture.calls.length = 0;
    const fb = nextCronTime('0 0 31 2 *', from);
    expect(fb.getTime()).toBeGreaterThan(from.getTime());
    expect(fb.getTime() - from.getTime()).toBeLessThanOrEqual(3_600_000);

    // 这条路径成本**未变低**（仍扫满窗宽）—— 断言只锁「有界 + 不静默」：
    const meta = logCapture.calls.at(-1)?.meta as { iterations?: number; budget?: number } | undefined;
    expect(meta?.iterations).toBeGreaterThan(1_000_000); // 确实扫了整窗（不是提前退出）
    expect(meta?.iterations).toBeLessThanOrEqual(1_100_000); // SCAN_BUDGET（src/cron/scheduler.ts:24）
    expect(meta?.budget).toBe(1_100_000);
    expect(logCapture.calls.at(-1)?.level).toBe('warn'); // 不静默
  });

  it('深匹配合法表达式不被预算截断：2 月 29 日 ⇒ 命中 2028-02-29（约 2 年后仍在窗内）', () => {
    // 独立复核给的对照表达式（V2 「SCAN_BUDGET 是真上界」判据）：2026-03-01 起，下一个 2/29 是 2028-02-29。
    const fromMar = new Date(2026, 2, 1, 12, 0, 0);
    logCapture.calls.length = 0;
    const hit = nextCronTime('0 0 29 2 *', fromMar);
    expect(hit.getTime()).toBe(new Date(2028, 1, 29, 0, 0, 0).getTime());
    expect(logCapture.calls).toHaveLength(0); // 命中 ⇒ 无 warn（不是兜底）
  });
});
