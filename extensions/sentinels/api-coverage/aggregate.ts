/**
 * api-coverage/aggregate.ts — T2 API可达性与协议覆盖哨兵
 *
 * 综合 computeApiAvailability + computeProtocolCoverage 结果，
 * 按阈值判定输出 SentinelFinding[]。
 * D577: 判定源 = loader 注入 thresholds（manifest 基线 + memStore 覆写，第 4 参）；
 * 未注入（直调/单测）fallback 内置默认 DEFAULT_THRESHOLDS（与 manifest 现值一致，蓝绿基准）。
 */
import type { SentinelFinding, SentinelThresholdPair } from '../../../src/sentinel/types';
import type { GraphTraversal } from '../../../src/l4/graph-traversal';
import { computeApiAvailability } from './computes/api-availability';
import { computeProtocolCoverage } from './computes/protocol-coverage';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/api-coverage');

/** 内置默认阈值 = 改造前硬编码现值（D577 蓝绿基准：注入与默认行为完全一致） */
const DEFAULT_THRESHOLDS = {
  api_availability: { warning: 0.8, critical: 0.6 },
  protocol_coverage: { warning: 0.6, critical: 0.3 },
} as const;

interface GraphStoreReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{
    id: string; type: string; props: Record<string, unknown>;
  }>;
}

export const apiCoverageSentinel = {
  async check(store: GraphStoreReader, teamId: string, traversal?: GraphTraversal,
    thresholds?: Record<string, SentinelThresholdPair>): Promise<SentinelFinding[]> {
    const now = new Date();
    const checkedAt = now.toISOString();
    const findings: SentinelFinding[] = [];

    // D577: 阈值消费契约 — 注入优先；参数在但缺 key → log.warn（真配置缺口）；未注入 → log.debug（直调/单测）
    const th = (key: keyof typeof DEFAULT_THRESHOLDS): SentinelThresholdPair => {
      const injected = thresholds?.[key];
      if (injected) return injected;
      if (thresholds) log.warn({ sentinel: 'api-coverage', key }, 'thresholds 注入缺 key — fallback 内置默认（manifest 配置缺口）');
      else log.debug({ sentinel: 'api-coverage', key }, 'thresholds 未注入（直调/单测）— fallback 内置默认');
      return DEFAULT_THRESHOLDS[key];
    };

    try {
      // @deprecated — 语义迁移由D15处理
            // #1387（机制③ · B2）：**无匹配边 ⇒ 退回旧路径 + 留痕**（照 B1 已验模板）
      //   🔴 留痕粒度边界：① 无匹配边 = 走备用路径（**正常**）⇒ log.warn，**不置 `result.degraded`**
      //                    ② 退回后也读空 = **没有数据**（**降级**）⇒ 归 #1379 V3 ⇒ 【那时才】置 degraded
      if (traversal) {
        try {
          const r = traversal.traverse([teamId], ['DEPLOYS']);
          if (!r.nodes[0]) {
            log.warn({ sentinelId: 'sentinel-api-coverage', degraded: true, reason: 'traversal-no-edge', edge: 'DEPLOYS' },
              '图遍历无匹配边 ⇒ 退回旧路径；退回后若读空 ⇒ 按 #1379 V3 置 degraded');
          }
        } catch (err: unknown) {
          log.warn({ err: err instanceof Error ? err.message : String(err), sentinelId: 'sentinel-api-coverage', degraded: true, reason: 'traversal-error', edge: 'DEPLOYS' },
            '图遍历失败 ⇒ 退回旧路径（不抛、不早退）');
        }
      }
      // 1. 从本体层读取 TOOL 节点
      const toolNodes = store.queryNodes('Tool', { teamId });
      const tools = toolNodes.map(n => ({
        id: n.id,
        name: (n.props.name as string) || n.id,
        url: (n.props.url || n.props.endpoint) as string | undefined,
        protocol: n.props.protocol as string | undefined,
      }));

      // 2. 计算 API 可达率
      const apiResult = await computeApiAvailability(
        tools.filter(t => t.url).map(t => ({ id: t.id, name: t.name, url: t.url }))
      );
      log.debug({ rate: apiResult.rate, total: apiResult.totalTools }, 'API 可达率计算完成');

      if (!apiResult.degraded && apiResult.totalTools > 0) {
        const apPct = (apiResult.rate * 100).toFixed(0);
        if (apiResult.rate < th('api_availability').critical) {
          findings.push({
            id: `t2-api-crit`, severity: 'critical',
            title: `API 可达率过低 (${apPct}%)`,
            description: `${apiResult.totalTools} 个系统中仅 ${apiResult.reachableNames.length} 个可达。`,
            evidence: [`可达率: ${apPct}%`, `不可达: ${apiResult.unreachableDetails.join('; ')}`],
            suggestion: '检查网络策略和服务状态，确保 Agent 可调用企业系统。',
            detectedAt: checkedAt,
          });
        } else if (apiResult.rate < th('api_availability').warning) {
          findings.push({
            id: `t2-api-warn`, severity: 'warning',
            title: `API 可达率偏低 (${apPct}%)`,
            description: `${apiResult.unreachableDetails.length}/${apiResult.totalTools} 个系统不可达。`,
            evidence: [`可达率: ${apPct}%`, `不可达: ${apiResult.unreachableDetails.join('; ')}`],
            suggestion: '排查不可达系统，检查认证和网络配置。',
            detectedAt: checkedAt,
          });
        }
      }

      // 3. 计算协议覆盖率
      const protoResult = computeProtocolCoverage(tools);
      log.debug({ coverage: protoResult.coverage, total: protoResult.totalTools }, '协议覆盖率计算完成');

      if (!protoResult.degraded && protoResult.totalTools > 0) {
        const pcPct = (protoResult.coverage * 100).toFixed(0);
        if (protoResult.coverage < th('protocol_coverage').critical) {
          findings.push({
            id: `t2-proto-crit`, severity: 'critical',
            title: `协议覆盖率过低 (${pcPct}%)`,
            description: `${protoResult.totalTools} 个工具中仅覆盖 ${protoResult.coveredProtocols.length}/6 种标准协议。`,
            evidence: [`覆盖率: ${pcPct}%`, `未覆盖: ${protoResult.uncoveredProtocols.join(', ')}`],
            suggestion: '将高频工具接入 MCP 标准协议，降低 Agent 集成成本。',
            detectedAt: checkedAt,
          });
        } else if (protoResult.coverage < th('protocol_coverage').warning) {
          findings.push({
            id: `t2-proto-warn`, severity: 'warning',
            title: `协议覆盖率不足 (${pcPct}%)`,
            description: `还有 ${protoResult.uncoveredProtocols.length}/6 种标准协议未覆盖。`,
            evidence: [`覆盖率: ${pcPct}%`, `未覆盖: ${protoResult.uncoveredProtocols.join(', ')}`],
            suggestion: '扩展工具协议支持，优先 MCP 和 REST。',
            detectedAt: checkedAt,
          });
        }
      }

      return findings;
    } catch (err: unknown) {
      log.error({ err }, '[api-coverage] check 失败');
      // 铁律24: catch 必须有 log + degraded
      return [{
        id: `t2-error`, severity: 'warning',
        title: 'API 覆盖检测异常',
        description: `检测过程出错: ${(err as Error)?.message || String(err)}`,
        evidence: [],
        suggestion: '检查 SOG 图数据源是否可用。',
        detectedAt: checkedAt,
      }];
    }
  },
};
