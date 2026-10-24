/**
 * src/services/clock.ts — 可注入时钟（全仓唯一允许直取系统时钟的模块）
 *
 * Q-6 时间可注入：调用链不再直取系统时钟，一律从注入的 `Clock` 取值。
 * 测试注入固定/可变时钟即可在同一测试内做「时间旅行」，无需全局 `vi.setSystemTime`。
 *
 * 设计哲学：一个分离 ＋ 三条承诺 ——
 *   分离：把「取当前时间」从业务逻辑里抽成**唯一注入点**（`Clock`）；
 *   承诺 ① 默认等价：不传 clock ⇒ `systemClock`，生产行为与改造前逐字节等价；
 *   承诺 ② 唯一入口：本文件是全仓唯一允许直取系统时钟的实现；
 *   承诺 ③ 无隐式降级：本模块不 try/catch、不兜底——拿不到时间就在编译期失败。
 *
 * 契约（铁律 47）:
 *   @input    — 无（模块级导出）。消费方注入 `Clock` 形状：
 *               `{ now(): number; nowIso(): string }`
 *   @output   — `systemClock: Clock`（默认实现，唯一直取系统时钟处）
 *               `Clock` / `MutableClock` 接口类型
 *   @degraded — 不适用：无 IO、无外部依赖、无 catch 分支（不存在可降级的失败面）
 *   @error    — 不适用：本模块不做输入解析、不抛错。`MutableClock.set/advance`
 *               的非法输入 fail-fast 由测试侧工厂承担（P1 裁 A：该工厂落在
 *               `tests/contract/clock-injection.test.ts`，不进 src）。
 *               消费方传入不符合接口的对象 ⇒ TypeScript 编译期失败，不静默兜底。
 *
 * Known Limitations（已知限制，写进 PR 正文）:
 *   - `systemClock` 不做单调性保证：系统时钟回拨/校时会如实反映到 `now()`
 *   - 只覆盖**显式注入**的调用链；`src/**` 其余存量直取系统时钟不在本模块视野（本批不清存量）
 *   - `nowIso()` 一律 UTC（ISO-8601 `toISOString` 语义），不做时区/本地化格式化
 *   - 棘轮（`tests/contract/time-injection.test.ts`）按原文正则计数：`Date.now`／`new Date`
 *     的别名、`performance.now()`、带参 `new Date(x)`（解析既有时间戳）均不在统计内
 */

/** 可注入时钟：所有时间取值的唯一依赖面。 */
export interface Clock {
  /** 当前时间（epoch 毫秒，与系统时钟同口径）。 */
  now(): number;
  /** 当前时间的 ISO-8601 UTC 字符串（与 `now()` 同源、同一时刻）。 */
  nowIso(): string;
}

/**
 * 可变的测试用时钟：`set` 重置到指定时刻，`advance` 前移。
 * 只导出接口；实现由测试侧工厂提供（P1 裁 A）。
 */
export interface MutableClock extends Clock {
  /** 重置到指定时刻（ISO 字符串或 epoch 毫秒）。 */
  set(at: string | number): void;
  /** 前移 `ms` 毫秒（负值/非有限数由实现方 fail-fast）。 */
  advance(ms: number): void;
}

/**
 * 默认时钟 —— 全仓唯一允许直取系统时钟的实现。
 * 生产环境不传 `clock` 时即用它，行为与改造前逐字节等价。
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};
