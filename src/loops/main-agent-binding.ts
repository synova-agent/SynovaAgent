/**
 * src/loops/main-agent-binding.ts — MainAgent 进程级绑定（#975 / 0-1 循环点火）
 * @state: real
 *
 * 背景（2026-10-04 实测）: LoopScheduler 的 6 个内置 cron 循环（loop-1..6）读
 * `this.mainAgent`，而全仓 `.setMainAgent(` 零调用（LoopScheduler#setMainAgent 从未被调用）
 * ⇒ 每次触发都输出 `[D9] MainAgent 未注入 — 跳过 loop-N (degraded)` 后直接返回，循环从不点火。
 * 创建真 MainAgent 的装配点只有 src/server.ts（createServer），而 LoopScheduler 的两个构造点
 * （src/deploy/bootstrap.ts Phase 2e 先于 Phase 2f 建 agent；src/agent/synova-agent.ts）都不持有它。
 *
 * 机制: L2 装配期写入（server.ts:bindMainAgent）→ 调度器触发时惰性读取（loop-scheduler:getBoundMainAgent）。
 *   惰性 = 装配先后顺序无关（Phase 2e 建调度器在前、MainAgent 建成在后同样生效）。
 *   机制先例: getGlobalScheduler / setGlobalSentinelRunner / routes/loops:setMainAgent（仓内既有全局单例惯例）。
 *
 * 契约（铁律 47）:
 *   @input   bindMainAgent(agent) — L2 装配完成后的真实循环执行器；传 null 清除绑定（停机/测试）
 *   @output  getBoundMainAgent() → 已绑定执行器 | null
 *   @degraded 未绑定 → 返回 null（**不抛**）；调用方必须 log.warn + 显式跳过（铁律 24+31），
 *             禁静默吞掉「未点火」这一事实。
 */

/**
 * 循环执行器最小接口。
 * 与 MainAgent 的结构关系: `executeLoopScale(loopId, scale)`（尺度感知，优先）+
 * `executeLoop(loopId, scale)`（回退）。⚠️ MainAgent#executeLoop 实为单参方法，
 * 第二参会被静默忽略 ⇒ 能走 executeLoopScale 就必须走它。
 */
export interface LoopExecutorLike {
  /** 尺度感知执行（优先路径；MainAgent#executeLoopScale） */
  executeLoopScale?(loopId: string, scale: string): Promise<{ status: string }>;
  /** 无尺度执行（回退路径；MainAgent#executeLoop） */
  executeLoop(loopId: string, scale: string): Promise<{ status: string }>;
}

let boundExecutor: LoopExecutorLike | null = null;

/**
 * 写入进程级绑定（L2 装配期调用；幂等，后写覆盖前写）。
 * @param agent 真实执行器；传 null = 清除绑定（停机/测试复位）
 */
export function bindMainAgent(agent: LoopExecutorLike | null): void {
  boundExecutor = agent;
}

/**
 * 读取进程级绑定。
 * @returns 已绑定执行器；未绑定 → null（调用方负责 log.warn + 跳过，禁静默）
 */
export function getBoundMainAgent(): LoopExecutorLike | null {
  return boundExecutor;
}
