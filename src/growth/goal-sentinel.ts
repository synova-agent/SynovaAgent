/**
 * src/growth/goal-sentinel.ts — 方案哨兵核心 (D73)
 *
 * 三因子偏离检测模型（第13份权威文档第三章§3）:
 *   因子1: 阈值偏离 — 实际值 vs 目标值的百分比差异
 *   因子2: 趋势偏离 — 最近N个采样点的斜率 vs 预期斜率
 *   因子3: 基线偏离 — 实际值 vs 基线值
 *
 * 判定规则:
 *   单因子偏离 → 仅记录到Goal.log，不触发告警
 *   双因子偏离 → P2告警（周汇总推送）
 *   三因子偏离 → P1告警（周推1次）。同指标2周期持续→P0告警
 *
 * 基线建立期: Goal创建后2-4周，baselineStatus='collecting'，只采集不告警
 *
 * 铁律 24+31: catch + log + degraded 信号
 * 铁律 38: 零 as any
 */
import { createLogger } from '@synova/logger';
import type { Goal } from './goal-types';
import type { Sentinel, SentinelConfig, SentinelContext, SentinelCheckResult, SentinelRegistry, SentinelFinding } from '../sentinel/types';

const log = createLogger('growth/goal-sentinel');

// ═══ Constants ═══

/** 同时活跃的方案哨兵上限 */
const MAX_ACTIVE_GOAL_SENTINELS = 5;

/** 基线采集期最短天数 */
const BASELINE_COLLECTION_DAYS = 14;

/** 基线采集期最长天数 */
const BASELINE_MAX_DAYS = 28;

/** CRON: P0=每小时, 其他=每4小时 */
const CRON_P0 = '0 * * * *';
const CRON_DEFAULT = '0 */4 * * *';

// ═══ Types ═══

export type BaselineStatus = 'collecting' | 'active';

export interface GoalSentinelState {
  /** 基线状态 */
  baselineStatus: BaselineStatus;
  /** 基线建立日期 */
  baselineEstablishedAt?: string;
  /** 历史采样点 */
  samples: Array<{ value: number; timestamp: string }>;
  /** 上次告警时间 */
  lastAlertAt?: string;
  /** 连续告警周期数 */
  sustainedAlertCycles: number;
}

// ═══ Deviation helpers ═══

interface DeviationResult {
  factor1: { value: number; triggered: boolean }; // 阈值偏离
  factor2: { value: number; triggered: boolean }; // 趋势偏离
  factor3: { value: number; triggered: boolean }; // 基线偏离
  triggeredCount: number;
}

/**
 * 计算三因子偏离值。
 * 纯函数 — 不依赖外部状态。
 */
export function computeDeviations(
  actual: number,
  target: number,
  baseline: number | null,
  samples: number[],
): DeviationResult {
  // 因子1: 阈值偏离
  const thresholdDeviation = target !== 0 ? Math.abs((actual - target) / target) : 0;
  const factor1Triggered = thresholdDeviation > 0.1; // >10%偏离

  // 因子2: 趋势偏离
  let factor2Triggered = false;
  let trendDeviation = 0;
  if (samples.length >= 3) {
    const n = samples.length;
    const xMean = (n - 1) / 2;
    let yMean = 0;
    for (const v of samples) yMean += v;
    yMean /= n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const x = i - xMean;
      num += x * (samples[i] - yMean);
      den += x * x;
    }
    const slope = den !== 0 ? num / den : 0;
    const expectedSlope = target - samples[0];
    const denom = Math.max(Math.abs(expectedSlope), 0.01);
    trendDeviation = Math.abs(slope - expectedSlope) / denom;
    factor2Triggered = trendDeviation > 0.15; // 趋势偏离>15%
  }

  // 因子3: 基线偏离
  let factor3Triggered = false;
  let baselineDeviation = 0;
  if (baseline !== null && baseline !== 0) {
    baselineDeviation = Math.abs((actual - baseline) / baseline);
    factor3Triggered = baselineDeviation > 0.2; // 基线偏离>20%
  }

  const triggeredCount = (factor1Triggered ? 1 : 0) +
    (factor2Triggered ? 1 : 0) +
    (factor3Triggered ? 1 : 0);

  return {
    factor1: { value: thresholdDeviation, triggered: factor1Triggered },
    factor2: { value: trendDeviation, triggered: factor2Triggered },
    factor3: { value: baselineDeviation, triggered: factor3Triggered },
    triggeredCount,
  };
}

// ═══ Sentinel implementation ═══

/**
 * 创建 Goal 方案哨兵实例。
 *
 * @param goal - Goal 对象
 * @param state - 哨兵状态（含基线/采样/告警记录）
 * @returns Sentinel 实例
 */
/**
 * 创建 Goal 方案哨兵。
 *
 * @param goal         — 关联的 Goal
 * @param state        — 哨兵运行状态（基线/采样/告警周期）
 * @param onEmergency  — 可选。检测到 emergency 告警时触发（D75 轻量级再诊断集成）
 */
export function createGoalSentinel(
  goal: Goal,
  state: GoalSentinelState,
  onEmergency?: (goalId: string, findings: Array<{ severity: string; title: string; description: string }>) => void,
): Sentinel {
  const priority = goal.priority || 'P1';
  const config: SentinelConfig = {
    id: `goal-${goal.goalId}`,
    name: `方案哨兵: ${goal.title.slice(0, 30)}`,
    description: `监控 Goal "${goal.title}" 的指标偏离`,
    category: 'growth',
    priority,
    mode: 'cron',
    cron: priority === 'P0' ? CRON_P0 : CRON_DEFAULT,
    requiredDataSources: [],
    confidenceModel: 'deterministic',
    version: '1.0.0',
    computeKind: 'aggregate',
  };

  return {
    config,
    async check(context: SentinelContext): Promise<SentinelCheckResult> {
      const startTime = Date.now();
      const findings: SentinelFinding[] = [];

      try {
        // 基线建立期: 只采集不告警
        if (state.baselineStatus === 'collecting') {
          const createdAt = new Date(goal.createdAt).getTime();
          const daysSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);

          if (daysSinceCreation >= BASELINE_COLLECTION_DAYS) {
            state.baselineStatus = 'active';
            state.baselineEstablishedAt = new Date().toISOString();
            log.info({ goalId: goal.goalId, daysSinceCreation }, '方案哨兵基线已建立');
          }

          // 采集期不产生发现
          return {
            sentinelId: config.id,
            ok: true,
            findings: [],
            durationMs: Date.now() - startTime,
            checkedAt: new Date().toISOString(),
            degraded: false,
          };
        }

        // 活跃期: 对每个指标执行三因子偏离检测
        for (const metric of goal.metrics) {
          // 因子3 基线（#979 修复）: 基线 = 采集期历史样本均值。
          //  原实现 `metric.baselinePeriod ? 0 : null` 与 computeDeviations 的 `baseline !== null && baseline !== 0`
          //  判据互斥 ⇒ 基线恒为 0/null ⇒ 因子3 恒 false（自相矛盾一行，已删）。
          //  契约: metric 未声明 baselinePeriod（无基线语义）或采集期无样本 → null（因子3 不判定，不猜值）。
          const baseline = metric.baselinePeriod && state.samples.length > 0
            ? state.samples.reduce((sum, s) => sum + s.value, 0) / state.samples.length
            : null;
          const sampleValues = state.samples.map(s => s.value);
          const deviation = computeDeviations(
            metric.currentValue,
            metric.targetValue,
            baseline,
            sampleValues,
          );

          if (deviation.triggeredCount === 0) continue;

          // 记录采样
          state.samples.push({ value: metric.currentValue, timestamp: new Date().toISOString() });

          const severity = deviation.triggeredCount >= 3 ? 'critical' :
            deviation.triggeredCount >= 2 ? 'warning' : 'info';

          const finding: SentinelFinding = {
            id: `goal-${goal.goalId}-${metric.metricName}-${Date.now()}`,
            severity,
            title: `[${'↑'.repeat(deviation.triggeredCount)}] ${metric.metricName} ${deviation.triggeredCount >= 3 ? '严重偏离' : deviation.triggeredCount >= 2 ? '偏离' : '轻微偏离'}`,
            description: `${metric.metricName}: 实际=${metric.currentValue}, 目标=${metric.targetValue}` +
              (deviation.factor1.triggered ? `, 阈值偏离=${(deviation.factor1.value * 100).toFixed(1)}%` : '') +
              (deviation.factor2.triggered ? `, 趋势偏离=${(deviation.factor2.value * 100).toFixed(1)}%` : '') +
              (deviation.factor3.triggered ? `, 基线偏离=${(deviation.factor3.value * 100).toFixed(1)}%` : ''),
            evidence: [],
            suggestion: deviation.triggeredCount >= 3
              ? `立即审查 "${metric.metricName}" 指标，考虑触发再诊断流程`
              : `关注 "${metric.metricName}" 指标变化趋势`,
            detectedAt: new Date().toISOString(),
            relatedNodeId: goal.goalId,
          };

          findings.push(finding);

          // 同指标2周期持续 P1→P0 升级
          if (deviation.triggeredCount >= 3 && state.sustainedAlertCycles >= 2) {
            findings.push({
              id: `goal-${goal.goalId}-${metric.metricName}-escalated-${Date.now()}`,
              severity: 'emergency',
              title: `[升级] ${metric.metricName} 持续严重偏离`,
              description: `${metric.metricName} 已连续 ${state.sustainedAlertCycles + 1} 个周期严重偏离，触发 P0 告警`,
              evidence: [],
              suggestion: '立即触发再诊断流程',
              detectedAt: new Date().toISOString(),
              relatedNodeId: goal.goalId,
            });

            // D75: emergency 告警 → 触发轻量级再诊断（fire-and-forget）
            if (onEmergency) {
              try {
                const emergencyFindings = findings
                  .filter((f) => f.severity === 'emergency')
                  .map((f) => ({ severity: f.severity, title: f.title, description: f.description }));
                // 非阻塞触发，不等待再诊断完成
                setImmediate(async () => {
                  try {
                    await onEmergency(goal.goalId, emergencyFindings);
                  } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    log.warn({ err: errMsg, goalId: goal.goalId }, '轻量级再诊断触发失败');
                  }
                });
              } catch (triggerErr: unknown) {
                const triggerMsg = triggerErr instanceof Error ? triggerErr.message : String(triggerErr);
                log.warn({ err: triggerMsg, goalId: goal.goalId }, '轻量级再诊断触发异常');
              }
            }
          }
        }

        state.lastAlertAt = new Date().toISOString();
        if (findings.length > 0) state.sustainedAlertCycles++;
        else state.sustainedAlertCycles = 0;

      } catch (err) {
        log.error({ err, goalId: goal.goalId }, '方案哨兵检查异常 — degraded');
        return {
          sentinelId: config.id,
          ok: false,
          findings: [],
          durationMs: Date.now() - startTime,
          checkedAt: new Date().toISOString(),
          degraded: true,
        };
      }

      return {
        sentinelId: config.id,
        ok: true,
        findings,
        durationMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
        degraded: false,
      };
    },
  };
}

// ═══ Registration ═══

/**
 * 注册 Goal 方案哨兵。
 *
 * 检查:
 * - 活跃方案哨兵上限 ≤5
 * - 使用命名空间 goal-{goalId}-
 *
 * @param goal     - Goal 对象
 * @param registry - SentinelRegistry 实例
 * @throws Error — 超过上限时抛出
 */
export function registerGoalSentinel(
  goal: Goal,
  registry: SentinelRegistry,
): void {
  // 检查上限
  const existing = registry.list().filter(s => s.config.id.startsWith('goal-'));
  if (existing.length >= MAX_ACTIVE_GOAL_SENTINELS) {
    throw new Error(`活跃方案哨兵已达上限 (${MAX_ACTIVE_GOAL_SENTINELS})`);
  }

  const state: GoalSentinelState = {
    baselineStatus: 'collecting',
    samples: [],
    sustainedAlertCycles: 0,
  };

  const sentinel = createGoalSentinel(goal, state);
  registry.register(sentinel);
  log.info({ goalId: goal.goalId, sentinelId: sentinel.config.id }, '方案哨兵已注册');
}

/**
 * 注销 Goal 方案哨兵。
 */
export function unregisterGoalSentinel(
  goalId: string,
  registry: SentinelRegistry,
): void {
  const sentinelId = `goal-${goalId}`;
  registry.unregister(sentinelId);
  log.info({ goalId, sentinelId }, '方案哨兵已注销');
}
