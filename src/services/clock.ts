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
 * 出生证（裁 407 B 组载体 · 七格）:
 *   ① 拥有什么：把「取当前时间」收成**唯一注入点**（`Clock`），并给出默认实现 `systemClock`。
 *   ② 不拥有什么：不做时区/夏令时/排程（那是排程域的事）；不保证单调；不清理存量直取点。
 *   ③ 为什么这样设计：消费方是**长寿命对象**（`FederatedPipeline`/`MainAgent`）⇒ 走构造注入；
 *      不学"逐函数传 `now` 参数"——我们的两条链要改 30+ 个签名，且漏传即静默回退。
 *   ④ 失败形态：**不抛错**（无 IO、无解析）；消费方传错形状 ⇒ 编译期失败（见上方 @error）。
 *   ⑤ 上限：不适用（无 IO、无重试、无队列、无累积状态）。判据形态＝**测试棘轮**
 *      （`tests/contract/time-injection.test.ts` 冻结直取计数，增/减/新文件/不可读皆判红），
 *      **不新增 checker 脚本或 CI 步** ⇒ 与 A 组 Q-1（入参校验）/Q-12（运行时资源上限）不重叠。
 *   ⑥ 已知限制：见下方 Known Limitations（四条，逐条可达）。
 *   ⑦ 借用边界：
 *      借鉴：`dsh@687f282e86:packages/schedule/schedule/src/domain.ts:843`——域纯函数
 *            `nextMatchingTarget(..., now: number, ...)` 由调用方喂时间；同包
 *            `.../runtime.ts:89` 的 `Date.now()` 只出现在 runtime 边界 ⇒ 时间源头单点化。
 *      不借：其 `Temporal` 时区/夏令时/本地日期全套（`domain.ts:843` 附近的 `localDate(now, timeZone)`）
 *            —— 我们无排程语义，`nowIso()` 一律 UTC，引入时区模型是给空气加锁。
 *      我们改：**构造注入 `Clock` 对象**（DSH 是逐函数传 `now`），因消费方是长寿命对象（见 ③）。
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
