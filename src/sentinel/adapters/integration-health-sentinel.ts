// @deprecated — 能力被I11覆盖，Phase 3上线时删除
/**
 * sentinel/adapters/integration-health-sentinel.ts — 集成健康度哨兵 (D4)
 * @state: real
 *
 * 检测系统集成的健康状态：MCP 支持度、连接器覆盖率、API 可用性汇总。
 * 每日 9:00 巡检。数据源: SOG 图节点属性。
 */
import type { Sentinel, SentinelCheckResult, SentinelConfig, SentinelContext, SentinelFinding } from '../types';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/integration-health');

const config: SentinelConfig = {
  id: 'sentinel-integration-health', name: '集成健康度',
  description: '检测系统集成的健康状态: MCP支持/连接器覆盖/API可用汇总。数据源: SOG图。',
  category: 'health', priority: 'P1', mode: 'cron', cron: '0 9 * * *',
  requiredDataSources: ['sog_graph'], confidenceModel: 'deterministic', version: '1.0.0',
};

export const integrationHealthSentinel: Sentinel = {
  config,
  async check(context: SentinelContext): Promise<SentinelCheckResult> {
    const { now } = context; const checkedAt = now.toISOString(); const startTime = Date.now();
    try {
      // #1376: **显式取用** raw 能力；缺席 ⇒ 显式降级（warn + degraded）
      const rawDb = context.rawDb ?? null;
      if (!rawDb) log.warn({ sentinelId: config.id }, 'rawDb 能力缺席 ⇒ 降级：跳过集成健康读取');
      const db = rawDb as { prepare(sql: string): { all(): Array<Record<string, unknown>> } } | null;
      if (!db) { return { sentinelId: config.id, ok: true, findings: [], durationMs: 0, checkedAt, degraded: true }; }

      let systems: Array<{ id: string; name: string; mcpSupport: string; apiAccess: string; hasConnector: boolean }> = [];
      try {
        const rows = db.prepare(
          "SELECT id, props FROM graph_nodes WHERE (type = 'TOOL' OR type = 'APP' OR type = 'SOFTWARE') AND props IS NOT NULL"
        ).all();
        for (const r of rows) {
          const props = typeof r.props === 'string' ? JSON.parse(r.props as string) : (r.props || {});
          systems.push({
            id: r.id as string,
            name: (props.name || r.id) as string,
            mcpSupport: (props.mcpSupport || props.mcp || 'none') as string,
            apiAccess: (props.apiAccess || props.api || 'unknown') as string,
            hasConnector: !!(props.connector || props.hasConnector),
          });
        }
      } catch { return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: true }; }

      if (systems.length === 0) {
        return { sentinelId: config.id, ok: true, findings: [], durationMs: Date.now() - startTime, checkedAt, degraded: false };
      }

      const mcpReady = systems.filter(s => s.mcpSupport === 'native' || s.mcpSupport === 'official');
      const apiAccessible = systems.filter(s => s.apiAccess === 'full' || s.apiAccess === 'partial');
      const connectorCovered = systems.filter(s => s.hasConnector);

      const findings: SentinelFinding[] = [];
      const mcpRate = mcpReady.length / systems.length;
      const apiRate = apiAccessible.length / systems.length;

      // MCP 支持度
      if (mcpRate < 0.3 && systems.length >= 3) {
        findings.push({
          id: `ih-mcp-${now.getTime()}`, severity: 'critical',
          title: `MCP 支持度低: 仅 ${mcpReady.length}/${systems.length} 有原生 MCP (${(mcpRate * 100).toFixed(0)}%)`,
          description: `无 MCP 支持的系统: ${systems.filter(s => s.mcpSupport === 'none').map(s => s.name).join(', ')}`,
          evidence: [`MCP原生: ${mcpReady.length}`, `总系统: ${systems.length}`],
          suggestion: '无 MCP 的系统需要自建 MCP Server 或使用 API 桥接。优先覆盖高频使用的系统。',
          detectedAt: checkedAt,
        });
      }

      // API 可达率
      if (apiRate < 0.5 && systems.length >= 3) {
        findings.push({
          id: `ih-api-${now.getTime()}`, severity: 'warning',
          title: `API 可达率低: ${(apiRate * 100).toFixed(0)}% (${apiAccessible.length}/${systems.length})`,
          description: `API 不可达或未知的系统: ${systems.filter(s => s.apiAccess !== 'full' && s.apiAccess !== 'partial').map(s => s.name).join(', ')}`,
          evidence: [`API可达: ${apiAccessible.length}`, `总系统: ${systems.length}`],
          suggestion: '优先为高频系统配置 API 访问。无 API 的系统考虑 RPA 或手动桥接。',
          detectedAt: checkedAt,
        });
      }

      // 连接器覆盖率
      if (systems.length >= 5 && connectorCovered.length < Math.ceil(systems.length * 0.5)) {
        findings.push({
          id: `ih-connector-${now.getTime()}`, severity: 'warning',
          title: `连接器覆盖率不足: ${connectorCovered.length}/${systems.length} (${((connectorCovered.length / systems.length) * 100).toFixed(0)}%)`,
          description: `缺少连接器的系统: ${systems.filter(s => !s.hasConnector).map(s => s.name).join(', ')}`,
          evidence: [`已覆盖: ${connectorCovered.length}`, `未覆盖: ${systems.length - connectorCovered.length}`],
          suggestion: '按优先级列表补齐连接器。先覆盖数据量最大的系统。',
          detectedAt: checkedAt,
        });
      }

      return { sentinelId: config.id, ok: true, findings, durationMs: Date.now() - startTime, checkedAt, degraded: false };
    } catch (err: unknown) {
      return { sentinelId: config.id, ok: false, findings: [], durationMs: Date.now() - startTime, checkedAt, error: (err as Error)?.message || String(err), degraded: true };
    }
  },
};
