/**
 * tests/loops/loop-execution-wiring.test.ts — #975（0-1 总闸·循环点火）判别性夹具
 *
 * 判据（卡面 Done）: 已装配路径上 loop-1..6 不再停留于
 * `[D9] MainAgent 未注入 — 跳过 loop-N (degraded)`（未点火直接 return）。
 *
 * 观测面 = **行为后果**（非日志文本、非 grep）:
 *   - 未点火: MainAgent 该循环 executionCount === 0 且 status === 'pending'
 *   - 已点火: executionCount === 1 且 lastExecution.status ≠ 'pending'
 *
 * ⚠️ 判别性: 装配走**生产函数** `wireLoopExecution()`（src/server.ts）——本文件不复制装配
 * 逻辑。删掉 wireLoopExecution 内的 `bindMainAgent(mainAgent)` 一行 → 本夹具必红（改坏即红；
 * 另见 tests/loops/probes/d9-loop-ignition-probe.ts 的原始 stderr 四步留档）。
 *
 * 覆盖: 正常（已装配点火 · 尺度透传）· 降级（未绑定 → 不点火）· 边界（6 个内置 job 全注册）
 */
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';
import { LoopScheduler, type CronSchedulerLike } from '../../src/loops/loop-scheduler';
import { bindMainAgent, getBoundMainAgent } from '../../src/loops/main-agent-binding';
import { setDiagnosisDeps } from '../../src/agent/loop-handlers';
import { wireLoopExecution } from '../../src/server';
import type { GraphBridgeLike } from '../../src/growth/goal-types';

/** 点火路径会写心跳（recordHeartbeat）——测后自清，避免仓库里留运行产物 */
const HEARTBEAT_FILE = join(process.cwd(), '.codex', 'heartbeat.json');

/** 捕获式 CronScheduler —— 记录 job 名/cron 与 handler，供夹具按需唤起（等价 cron 到点） */
class CaptureScheduler implements CronSchedulerLike {
  readonly jobs = new Map<string, { cron: string; handler: () => Promise<void> }>();

  schedule(name: string, cron: string, handler: () => Promise<void>): string {
    this.jobs.set(name, { cron, handler });
    return name;
  }

  async fire(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`job ${name} 未注册`);
    await job.handler();
  }
}

/** loop-1 依赖注入桩: GOAL 图为空 → handler 走「无 active 目标」降级分支（不触 DB / 不接 LLM） */
function installDiagnosisStub(): void {
  const stubStore: GraphBridgeLike = {
    createNode: () => 'stub-node',
    getNode: () => null,
    updateNode: () => { /* noop */ },
    queryNodes: () => [],
  };
  setDiagnosisDeps({
    getStore: () => stubStore,
    getGoal: () => null,
    callExpert: async () => ({
      suggestedAdjustment: 'adjust_target' as const,
      description: '夹具桩 — GOAL 图为空时不被调用',
      degraded: false,
    }),
  });
}

function loopRecord(agent: { listLoops(): Array<{ config: { loopId: string }; executionCount: number; lastExecution?: { status: string; scale?: string } }> } | null, loopId: string) {
  return agent?.listLoops().find((l) => l.config.loopId === loopId);
}

describe('#975 — 循环点火（生产装配函数 wireLoopExecution）', () => {
  afterEach(() => {
    bindMainAgent(null);   // 复位进程级绑定（避免跨用例串扰）
    setDiagnosisDeps(null); // 恢复 loop-1 生产默认依赖
    try { rmSync(HEARTBEAT_FILE, { force: true }); } catch { /* 清理失败不阻断 */ }
  });

  it('正常路径: 已装配 → loop-1 真被执行（executionCount=1，status≠pending）且尺度透传 slow', async () => {
    installDiagnosisStub();
    const wiring = wireLoopExecution();
    expect(wiring.ok).toBe(true);
    expect(wiring.degraded).toBe(false);
    expect(wiring.mainAgent).not.toBeNull();

    const capture = new CaptureScheduler();
    new LoopScheduler(capture);
    await capture.fire('loop-1-diagnosis');

    const rec = loopRecord(wiring.mainAgent, 'loop-1');
    expect(rec).toBeDefined();
    // 判别性核心: 删掉 wireLoopExecution 内的 bindMainAgent 一行 → 此断言必红（executionCount 停在 0）
    expect(rec!.executionCount).toBe(1);
    expect(rec!.lastExecution?.status).not.toBe('pending');
    // 尺度透传: 走 executeLoopScale → 'slow'（若误走单参 executeLoop 会静默降为 fast）
    expect(rec!.lastExecution?.scale).toBe('slow');
    // 装配侧效确证: 进程级绑定指向同一实例
    expect(getBoundMainAgent()).toBe(wiring.mainAgent);
  });

  it('降级路径: 未绑定 → loop-1 不点火（executionCount 保持 0，不自欺为已执行）', async () => {
    installDiagnosisStub();
    const wiring = wireLoopExecution();
    bindMainAgent(null); // 显式模拟「装配期未写入绑定」

    const capture = new CaptureScheduler();
    new LoopScheduler(capture);
    await capture.fire('loop-1-diagnosis');

    const rec = loopRecord(wiring.mainAgent, 'loop-1');
    expect(rec!.executionCount).toBe(0);
    expect(rec!.lastExecution).toBeUndefined();
  });

  it('边界: 6 个内置循环 job 全部注册且 cron 与原实现逐字一致', () => {
    installDiagnosisStub();
    const capture = new CaptureScheduler();
    new LoopScheduler(capture);

    // 构造期注册 = 6 内置循环 + system-heartbeat-check（D223 停滞检测）
    expect(capture.jobs.size).toBe(7);
    expect(capture.jobs.get('system-heartbeat-check')?.cron).toBe('0 0 * * *');

    const builtin = [...capture.jobs.entries()]
      .filter(([name]) => name.startsWith('loop-'))
      .map(([name, job]) => [name, job.cron] as const);
    expect(builtin).toEqual([
      ['loop-4-self-check', '0 0 * * *'],
      ['loop-5-knowledge', '0 0 * * 0'],
      ['loop-1-diagnosis', '0 9 1 */3 *'],
      ['loop-2-navigation', '0 9 * * 1'],
      ['loop-3-ga-evolution', '0 9 1 */3 *'],
      ['loop-6-overflow', '0 9 1 * *'],
    ]);
  });

  it('显式注入优先于进程绑定（setMainAgent 覆盖绑定路径）', async () => {
    installDiagnosisStub();
    const wiring = wireLoopExecution();
    const explicit = {
      executeLoopScale: async () => ({ status: 'explicit-injected' }),
      executeLoop: async () => ({ status: 'explicit-injected-fallback' }),
    };
    const capture = new CaptureScheduler();
    const scheduler = new LoopScheduler(capture);
    scheduler.setMainAgent(explicit);
    await capture.fire('loop-1-diagnosis');
    // 显式执行器被调用（MainAgent 未被执行）
    const rec = loopRecord(wiring.mainAgent, 'loop-1');
    expect(rec!.executionCount).toBe(0);
  });
});
