/**
 * src/loops/loop-trigger-config.ts — 多尺度触发矩阵配置 (D91)
 *
 * Auth Doc A1 LoopEng Amendment — Correction 1: Multi-scale trigger matrix.
 * 6 个循环 × 3 个时间尺度 (fast/medium/slow)，定义每个尺度的触发方式。
 *
 * 契约:
 *   @input  — 无（纯配置定义）
 *   @output — LoopTriggerConfig[] 供 loop-scheduler.ts 消费
 *   @degraded — 不适用（纯数据）
 */
import { createLogger } from '@synova/logger';

const log = createLogger('loops/trigger-config');

// ═══ 类型定义 ═══

/** 触发方式 */
export type TriggerType = 'cron' | 'event' | 'hybrid';

/** 时间尺度 */
export type ScaleName = 'fast' | 'medium' | 'slow';

/** 单个触发器尺度配置 */
export interface TriggerScale {
  name: ScaleName;
  /** Cron 表达式（最小节奏） */
  period: string;
  /** 触发方式 */
  triggerType: TriggerType;
  /** 事件源（event/hybrid 时必填），如 'sentinel:P0' */
  eventSource?: string;
  /** 覆盖的哨兵/边范围 */
  coverage: string;
  /** 触发条件说明 */
  condition: string;
}

/** 循环触发器配置 */
export interface LoopTriggerConfig {
  /** 循环唯一标识 */
  loopId: string;
  /** 循环名称 */
  loopName: string;
  /** 三个时间尺度触发配置 */
  scales: TriggerScale[];
}

// ═══ 6 循环触发矩阵 ═══

/**
 * 6 个循环 × 3 个尺度的触发矩阵。
 * 每循环定义 fast/medium/slow 三种节奏，支持 cron/event/hybrid 触发。
 *
 * 🔴 快照，非事实源；真源 = `resolveLoopCron()`（`src/cron/cron-config.ts` 的 `DEFAULT_LOOP_CRON`）。
 *    本矩阵的 `period` 为历史快照，与 #1454 后的实际注册口径**可能分歧**
 *    （loop-3 已改默认为日频 `0 9 * * *`，本矩阵仍是月/季/半年）。
 *    ⇒ 改「循环节律」请改 `DEFAULT_LOOP_CRON`（或 env `SYNOVA_CRON_<JOB>` / `cron-loops.json`），
 *      不要以本文件的 `period` 为依据；本矩阵不承载事实源（#1454 CTO 裁定：只标注，不改逻辑）。
 */
export const LOOP_TRIGGER_MATRIX: LoopTriggerConfig[] = [
  {
    loopId: 'loop-1',
    loopName: 'Enterprise Diagnosis',
    scales: [
      {
        name: 'fast',
        period: '0 9 * * 1',       // 每周一 9:00
        triggerType: 'hybrid',
        eventSource: 'sentinel:P0',
        coverage: 'P0 sentinel findings across all dimensions',
        condition: 'P0 alert from any sentinel → immediate diagnosis; otherwise weekly cadence',
      },
      {
        name: 'medium',
        period: '0 9 1 * *',       // 每月 1 日 9:00
        triggerType: 'cron',
        coverage: 'P1 sentinel findings + growth health check',
        condition: 'Monthly comprehensive health check of all P1 signals',
      },
      {
        name: 'slow',
        period: '0 9 1 */3 *',     // 每季度首月 1 日
        triggerType: 'cron',
        coverage: 'Full diagnosis: all 42 edges + complete goal audit',
        condition: 'Quarterly full enterprise diagnosis cycle',
      },
    ],
  },
  {
    loopId: 'loop-2',
    loopName: 'Department Navigation',
    scales: [
      {
        name: 'fast',
        period: '0 */2 * * *',     // 每 2 小时
        triggerType: 'event',
        eventSource: 'sentinel:P0',
        coverage: 'Department-level P0 alerts',
        condition: 'P0 sentinel alert in department scope → immediate navigation review',
      },
      {
        name: 'medium',
        period: '0 9 * * 1',       // 每周一 9:00
        triggerType: 'cron',
        coverage: 'Active goals + recent proposals + alerts in department',
        condition: 'Weekly department workspace refresh',
      },
      {
        name: 'slow',
        period: '0 9 1 * *',       // 每月 1 日
        triggerType: 'cron',
        coverage: 'Department goal progress + proposal status + seasonal trends',
        condition: 'Monthly department performance review',
      },
    ],
  },
  {
    loopId: 'loop-3',
    loopName: 'GA Evolution',
    scales: [
      {
        name: 'fast',
        period: '0 9 1 * *',       // 每月 1 日
        triggerType: 'cron',
        coverage: 'Aggregate feedback from all departments + quality metrics',
        condition: 'Monthly GA quality assessment',
      },
      {
        name: 'medium',
        period: '0 9 1 */3 *',     // 每季度
        triggerType: 'cron',
        coverage: 'Cross-department pattern detection + threshold calibration',
        condition: 'Quarterly GA calibration cycle',
      },
      {
        name: 'slow',
        period: '0 9 1 */6 *',     // 每半年
        triggerType: 'cron',
        coverage: 'Full evolution cycle: pattern promotion + rule version management',
        condition: 'Semi-annual evolution cycle',
      },
    ],
  },
  {
    loopId: 'loop-4',
    loopName: 'System Self-Check',
    scales: [
      {
        name: 'fast',
        period: '*/5 * * * *',     // 每 5 分钟
        triggerType: 'cron',
        coverage: 'HTTP health endpoints + database connectivity + queue depth',
        condition: 'Runtime health monitoring (unchanged from D49)',
      },
      {
        name: 'medium',
        period: '0 */4 * * *',     // 每 4 小时
        triggerType: 'cron',
        coverage: 'Sentinel runner health + compute function integrity',
        condition: 'Per-sentinel health check',
      },
      {
        name: 'slow',
        period: '0 3 * * 0',       // 每周日 3:00
        triggerType: 'cron',
        coverage: 'Full system audit: disk usage, log rotation, backup verification',
        condition: 'Weekly full system audit',
      },
    ],
  },
  {
    loopId: 'loop-5',
    loopName: 'Knowledge Accumulation',
    scales: [
      {
        name: 'fast',
        period: '0 0 * * *',       // 每天凌晨
        triggerType: 'event',
        eventSource: 'diagnosis:completed',
        coverage: 'Extract goal execution knowledge from completed diagnoses',
        condition: 'Post-diagnosis knowledge extraction (D76)',
      },
      {
        name: 'medium',
        period: '0 6 1 * *',       // 每月 1 日 6:00
        triggerType: 'cron',
        coverage: 'PKB confidence decay + stale knowledge cleanup',
        condition: 'Monthly PKB maintenance cycle',
      },
      {
        name: 'slow',
        period: '0 6 1 */3 *',     // 每季度
        triggerType: 'cron',
        coverage: 'Industry benchmark summary + cross-enterprise pattern aggregation',
        condition: 'Quarterly knowledge synthesis cycle',
      },
    ],
  },
  {
    loopId: 'loop-6',
    loopName: 'Overflow Monitor',
    scales: [
      {
        name: 'fast',
        period: '0 8 * * 1',       // 每周一 8:00
        triggerType: 'cron',
        eventSource: 'overflow:cash',
        coverage: 'Cash runway + working capital + accounts receivable aging',
        condition: 'Weekly cash flow monitoring',
      },
      {
        name: 'medium',
        period: '0 8 1 * *',       // 每月 1 日 8:00
        triggerType: 'cron',
        eventSource: 'overflow:customer',
        coverage: 'Customer concentration + churn trend + support ticket volume',
        condition: 'Monthly customer health monitoring',
      },
      {
        name: 'slow',
        period: '0 8 1 */3 *',     // 每季度
        triggerType: 'cron',
        eventSource: 'overflow:brand',
        coverage: 'Brand perception + market position + competitive forces',
        condition: 'Quarterly brand & market position review',
      },
    ],
  },
];

// ═══ 验证函数 ═══

/**
 * 验证配置的有效性。
 * - 每循环必须有 3 个 scale（fast/medium/slow）
 * - 每个 scale 必须有有效的 period
 * - event/hybrid 触发必须有 eventSource
 */
export function validateLoopConfig(configs: LoopTriggerConfig[]): string[] {
  const errors: string[] = [];

  for (const loop of configs) {
    if (!loop.loopId) errors.push(`loopId 为空`);
    if (!loop.loopName) errors.push(`${loop.loopId || '?'}: loopName 为空`);
    if (loop.scales.length !== 3) {
      errors.push(`${loop.loopId}: scale 数量应为 3，实际为 ${loop.scales.length}`);
    }

    const scaleNames = loop.scales.map((s) => s.name);
    if (!scaleNames.includes('fast') || !scaleNames.includes('medium') || !scaleNames.includes('slow')) {
      errors.push(`${loop.loopId}: 缺少 fast/medium/slow 中的某些 scale`);
    }

    for (const scale of loop.scales) {
      if (!scale.period) errors.push(`${loop.loopId}/${scale.name}: period 为空`);
      if (!['cron', 'event', 'hybrid'].includes(scale.triggerType)) {
        errors.push(`${loop.loopId}/${scale.name}: triggerType 非法: ${scale.triggerType}`);
      }
      if ((scale.triggerType === 'event' || scale.triggerType === 'hybrid') && !scale.eventSource) {
        errors.push(`${loop.loopId}/${scale.name}: event/hybrid 类型必须指定 eventSource`);
      }
    }
  }

  if (errors.length === 0) {
    log.info({ count: configs.length }, '循环触发矩阵验证通过');
  } else {
    log.warn({ errors }, '循环触发矩阵验证发现错误');
  }

  return errors;
}
