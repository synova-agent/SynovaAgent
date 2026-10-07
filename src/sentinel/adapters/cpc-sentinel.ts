// @deprecated — 能力被I4+I7覆盖，Phase 3上线时删除
/**
 * sentinel/adapters/cpc-sentinel.ts — 协作协议完备性哨兵 (D2)
 * @state: real
 *
 * 包装 computeCPC()，监测组织协作协议的完备程度。
 * 每周一 9:00 巡检。
 */

import type { Sentinel, SentinelCheckResult, SentinelConfig, SentinelContext, SentinelFinding } from '../types';
import { swapDbForContext, discoverTeams, checkTeam } from './helpers';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/cpc');

const config: SentinelConfig = {
  id: 'sentinel-cpc',
  name: '协作协议完备性 (CPC)',
  description: '检查 6 个协作维度的协议覆盖度——分工、信息流、权限、信任、知识、外部接口。',
  category: 'capability',
  priority: 'P2',
  mode: 'cron',
  cron: '0 9 * * 1',
  requiredDataSources: ['gap_snapshots'],
  confidenceModel: 'deterministic',
  version: '1.0.0',
};

interface CPCDimensionDetail {
  score: number; confidence: 'high' | 'medium' | 'low'; missingCapabilities: string[];
}
interface CPCGap { dimension: string; severity: 'critical' | 'warning' | 'info'; description: string; suggestion: string; }
interface CPCReport {
  completenessScore: number;
  byDimension: Record<string, CPCDimensionDetail>;
  gaps: CPCGap[];
  level: 'minimal' | 'basic' | 'adequate' | 'comprehensive';
  interpretation: string;
}

function extractFindings(report: CPCReport, now: Date): SentinelFinding[] {
  const findings: SentinelFinding[] = [];
  const ts = now.toISOString();

  for (const gap of report.gaps) {
    findings.push({
      id: `cpc-gap-${gap.dimension}-${now.getTime()}`,
      severity: gap.severity,
      title: `${gap.dimension}: ${gap.description}`,
      description: gap.description,
      evidence: [`维度: ${gap.dimension}`, `得分: ${(report.byDimension[gap.dimension]?.score || 0).toFixed(2)}`],
      suggestion: gap.suggestion,
      detectedAt: ts,
    });
  }

  if (report.completenessScore < 0.4) {
    findings.push({
      id: `cpc-low-score-${now.getTime()}`, severity: 'warning',
      title: `协作协议完备性偏低 (${(report.completenessScore * 100).toFixed(0)}%)`,
      description: `整体完备性得分 ${(report.completenessScore * 100).toFixed(0)}%，等级: ${report.level}。${report.interpretation}`,
      evidence: [`完备性得分: ${(report.completenessScore * 100).toFixed(0)}%`, `等级: ${report.level}`, `缺口数: ${report.gaps.length}`],
      suggestion: '优先修补 critical 级别的协议缺口。每个缺口代表一个协作断裂点。',
      detectedAt: ts,
    });
  }

  return findings;
}

export const cpcSentinel: Sentinel = {
  config,
  async check(context: SentinelContext): Promise<SentinelCheckResult> {
    const { now } = context;
    try {
      // CPC 计算已从 engine-core 迁移 — 哨兵功能合并到 I4/I7 新哨兵
      return { sentinelId: config.id, ok: true, findings: [], durationMs: 0, checkedAt: now.toISOString(), degraded: false };
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      log.error({ err: msg, code: 'CPC_SENTINEL_CRASH', phase: 3, retryable: true }, '[CPC] 哨兵崩溃');
      return { sentinelId: config.id, ok: false, findings: [], durationMs: Date.now() - now.getTime(), checkedAt: now.toISOString(), error: msg, degraded: true };
    }
  },
};
