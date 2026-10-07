/**
 * src/sentinel/sentinel-loader.ts — 哨兵加载器
 *
 * 从 extensions/sentinels/{name}/ 目录加载哨兵定义。
 * 替代 builtins.ts 的硬编码注册。
 *
 * V3.7 Batch 2 — 哨兵子领域重构
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from '@synova/logger';
import type { MetricRow, SentinelFinding, SentinelCheckResult, SentinelThresholdPair } from './types';

import { withOrgScope } from './org-scope';
const log = createLogger('sentinel/loader');

export interface SentinelManifest {
  name: string;
  version: string;
  type: string;
  displayName: string;
  description: string;
  schedule: string;
  expert: string;
  priority: string;
  computes: string[];
  thresholds: Record<string, { warning: number; critical: number }>;
  aggregation: 'worst_first' | 'weighted_sum' | 'majority_vote';
  context: {
    requiredDataSources: string[];
    dataAccess: { allowedDimensions: string[]; sensitiveAccess: string };
  };
  entryPoint: string;
  exportKey: string;
  // V4.2.5: 增长动力学 8 层模型
  layer?: 'environment' | 'capital' | 'interface' | 'alignment' | 'internal' | 'technology';
  auxiliaryExperts?: string[];
  computeKind?: 'deterministic' | 'heuristic' | 'conditional' | 'inferred' | 'aggregate';
  technoEconomicPhaseCalibration?: boolean;
  dependsOn?: { nodeTypes?: string[]; edgeTypes?: string[]; requiredFields?: string[] };
}

export interface LoadedSentinel {
  manifest: SentinelManifest;
  dir: string;
}

/**
 * 哨兵扫描根目录（D751 注入缝）: 测试可用 SENTINELS_FIXTURE_DIR 指向夹具根
 * （目录结构同 extensions/sentinels），让「新增哨兵生效」断言跑在真实扫描管线上；
 * 生产路径（未设 env）不变 = extensions/sentinels。惰性求值，env 后设即生效。
 */
function sentinelsDir(): string {
  return process.env.SENTINELS_FIXTURE_DIR || join(process.cwd(), 'extensions', 'sentinels');
}

// ═══ Cache ═══
let cache: LoadedSentinel[] | null = null;

/**
 * 扫描 extensions/sentinels/ 目录，加载所有哨兵 manifest。
 */
export function loadSentinels(): { sentinels: LoadedSentinel[]; degraded: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cache) return { sentinels: cache, degraded: false, errors: [] };

  const sentinels: LoadedSentinel[] = [];

  try {
    if (!existsSync(sentinelsDir())) {
      errors.push(`哨兵目录不存在: ${sentinelsDir()}`);
      return { sentinels: [], degraded: true, errors };
    }

    const entries = readdirSync(sentinelsDir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'shared') continue; // 工具库，不是哨兵
      if (entry.name.startsWith('_')) continue; // 模板目录

      const manifestPath = join(sentinelsDir(), entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) {
        errors.push(`哨兵 ${entry.name} 缺少 manifest.json`);
        continue;
      }

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SentinelManifest;
        sentinels.push({ manifest, dir: join(sentinelsDir(), entry.name) });
      } catch (err: any) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "JSON 解析失败");
        errors.push(`哨兵 ${entry.name} manifest 解析失败: ${err.message}`);
      }
    }

    log.info({ count: sentinels.length, errors: errors.length }, '哨兵加载完成');
    cache = sentinels;
    return { sentinels, degraded: errors.length > 0, errors };
  } catch (err: any) {
    log.error({ err }, '哨兵加载失败 — degraded');
    errors.push(`哨兵加载失败: ${err.message}`);
    return { sentinels: [], degraded: true, errors };
  }
}

/**
 * 按专家类型筛选哨兵。
 */
export function getSentinelsByExpert(expert: string): LoadedSentinel[] {
  const { sentinels } = loadSentinels();
  return sentinels.filter(s => s.manifest.expert === expert);
}

/**
 * 清除缓存（用于热加载）。
 */
export function clearSentinelCache(): void {
  cache = null;
  log.info('哨兵缓存已清除');
}

/**
 * resolveThresholds — 哨兵阈值解析（manifest 基线 + L0 memStore 覆写合并，单一解析点）
 * 契约:
 *   @input  — sentinelName: manifest.name（memStore 键兼容双形态: threshold_${name} 与 threshold_sentinel-${name}，
 *             后者兼容 org-adapter 传 config.id 的存量写入）；orgKey: 检查时 teamId || 'default'；
 *             deps?: 测试注入缝 { memoryStore?: { recall(orgId, key): { value: string } | null } }——缺省动态 import
 *             AgentMemoryStore + getDatabase（生产路径）。
 *   @output — { thresholds: Record<string, SentinelThresholdPair>, overrideApplied: boolean, overrideMetric?: string }
 *             基线 = loadSentinels() 中该哨兵 manifest.thresholds 全量；覆写 = memStore recall 命中的
 *             newThreshold，应用于 manifest.thresholds 的首个 key（主指标）。
 *   @degraded — memStore 值 JSON.parse 失败或数值非法 → log.warn + 忽略覆写（基线可用，不 throw，铁律 24）；
 *             loadSentinels 失败/找不到哨兵 → { thresholds: {}, overrideApplied: false }（空表，aggregate 走自有 fallback）。
 *   @error  — 不抛异常（所有失败路径降级返回，铁律 24/31）。
 */
export async function resolveThresholds(
  sentinelName: string,
  orgKey: string,
  deps?: { memoryStore?: { recall(orgId: string, key: string): { value: string } | null } },
): Promise<{ thresholds: Record<string, SentinelThresholdPair>; overrideApplied: boolean; overrideMetric?: string }> {
  const { sentinels } = loadSentinels();
  const found = sentinels.find(s => s.manifest.name === sentinelName);
  const thresholds: Record<string, SentinelThresholdPair> = {};
  for (const [k, v] of Object.entries(found?.manifest.thresholds ?? {})) {
    thresholds[k] = { ...v };
  }
  if (Object.keys(thresholds).length === 0) {
    return { thresholds, overrideApplied: false };
  }
  try {
    const memoryStore = deps?.memoryStore ?? await (async () => {
      const { getAgentMemoryStore } = await import('../l4/agent-memory-store');
      const { getDatabase } = await import('../init/engine-context');
      return getAgentMemoryStore(getDatabase());
    })();
    const primary = Object.keys(thresholds)[0];
    const stored = memoryStore.recall(orgKey, `threshold_${sentinelName}`)
      ?? memoryStore.recall(orgKey, `threshold_sentinel-${sentinelName}`);
    if (stored) {
      const parsed = JSON.parse(stored.value) as { newThreshold?: { warning?: number; critical?: number } };
      const w = parsed.newThreshold?.warning;
      const c = parsed.newThreshold?.critical;
      if (typeof w === 'number' && Number.isFinite(w) && typeof c === 'number' && Number.isFinite(c)) {
        thresholds[primary] = { warning: w, critical: c };
        log.info({ sentinel: sentinelName, orgKey, metric: primary }, 'D577 阈值覆写生效（memStore → check）');
        return { thresholds, overrideApplied: true, overrideMetric: primary };
      }
      log.warn({ sentinel: sentinelName }, 'memStore 阈值非法 — 忽略覆写，使用 manifest 基线');
    }
  } catch (err: unknown) {
    log.warn({
      err: err instanceof Error ? err.message : String(err),
      sentinel: sentinelName,
    }, 'memStore 阈值读取失败 — 使用 manifest 基线（degraded）');
  }
  return { thresholds, overrideApplied: false };
}

// ═══ Registry 注册 ═══

/**
 * 将已加载的文件驱动哨兵注册到全局 SentinelRegistry。
 * 每个哨兵动态 import 其 aggregate.ts，包装为 Sentinel 接口后注册。
 */
export async function registerLoadedSentinels(): Promise<{ registered: number; errors: string[] }> {
  const { sentinels, errors: loadErrors } = loadSentinels();
  const errors = [...loadErrors];
  let registered = 0;

  for (const { manifest, dir } of sentinels) {
    try {
      const entryPath = join(dir, manifest.entryPoint || './aggregate.ts');
      if (!existsSync(entryPath)) {
        errors.push(`哨兵 ${manifest.name} entryPoint 不存在: ${entryPath}`);
        continue;
      }

      const mod = await import(pathToFileURL(entryPath).href);
      const sentinelObj = mod[manifest.exportKey || 'default'];
      if (!sentinelObj || typeof sentinelObj.check !== 'function') {
        errors.push(`哨兵 ${manifest.name} 缺少 check() 方法`);
        continue;
      }

      // P0-1 (K3 20260813): 注册前把 manifest 挂到哨兵对象 — cash-runway/revenue-health
      // 的阈值 finding 依赖 `this.manifest`（aggregate.ts 中 if (this.manifest) 门控）。
      // 修复前从不挂载 → this.manifest 恒 null → 阈值告警死代码（活运行 findings=0）。
      // 守卫: 只挂声明了 manifest 字段的哨兵对象（无 manifest 字段的如 capital-health 不注入）。
      if ('manifest' in sentinelObj) {
        sentinelObj.manifest = manifest;
      }

      // V4.2.9: dependsOn 数据依赖校验
      if (manifest.dependsOn) {
        try {
          const { loadOntology } = await import('../l4/ontology-loader');
          const { ontology } = loadOntology();
          const typeNames = manifest.dependsOn.nodeTypes || [];
          const fields = manifest.dependsOn.requiredFields || [];
          for (const nodeType of typeNames) {
            const found = ontology.nodeTypes.find(n => n.$id === `node-type/${nodeType.toLowerCase()}` || n.label === nodeType);
            if (!found) {
              log.warn({ sentinel: manifest.name, nodeType }, '哨兵依赖的节点类型在本体中不存在 — degraded');
              continue;
            }
            for (const f of fields) {
              const hasField = (found.requiredProps || []).includes(f) ||
                Object.keys(found.optionalProps || {}).includes(f);
              if (!hasField) {
                log.warn({ sentinel: manifest.name, nodeType, field: f }, '哨兵依赖的字段在本体节点类型中不存在 — degraded');
              }
            }
          }
        } catch (err) { log.warn({ err, sentinel: manifest.name }, 'dependsOn 检查失败 — degraded'); }
      }

      // 动态导入 registry 避免循环依赖
      const { getSentinelRegistry } = await import('./registry');
      const registry = getSentinelRegistry();

      registry.register({
        config: {
          id: `sentinel-${manifest.name}`,
          name: manifest.displayName || manifest.name,
          description: manifest.description || '',
          category: 'growth',
          priority: (manifest.priority as 'P0' | 'P1' | 'P2') || 'P1',
          mode: 'cron',
          cron: manifest.schedule || '0 */6 * * *',
          version: manifest.version || '1.0.0',
          confidenceModel: (manifest.computeKind === 'deterministic' ? 'deterministic' : (manifest.computeKind === 'heuristic' ? 'statistical' : 'llm')) as 'deterministic' | 'statistical' | 'llm',
          requiredDataSources: manifest.context?.requiredDataSources || [],
          layer: manifest.layer,
          auxiliaryExperts: manifest.auxiliaryExperts,
          computeKind: manifest.computeKind,
          technoEconomicPhaseCalibration: manifest.technoEconomicPhaseCalibration,
        },
        async check(context) {
          // 将 SentinelContext.db 作为 GraphStore 传给 aggregate
          const ctx = context as unknown as Record<string, unknown>;
          const rawStore = (context.db ?? {}) as Record<string, unknown>;
          // #1374 租户收口：**单点包装** —— 43 个 queryNodes 读路径一次性获得 `props.orgId` 过滤；
          //   注意：用 **ctx.teamId 原值**（不是下面的 'default' 兜底值）作为租户真源 ——
          //   `'default'` 是回落值、不是租户（#1322/#1371 同族）；无值 ⇒ 原样透传 + 计数未隔离。
          const store = withOrgScope(rawStore, ctx.teamId as string | undefined);
          // #1376: 按需路径的读能力注入（`rawDb` 仅在传入句柄确是 raw 时提供；否则**显式缺席**）
          const hasQueryNodes = typeof rawStore.queryNodes === 'function';
          const hasPrepare = typeof (rawStore as { prepare?: unknown }).prepare === 'function';
          const teamId = (ctx.teamId as string) || 'default';

          // D577: 阈值注入（唯一生产解析点）—— manifest 基线 + memStore 覆写
          const { thresholds } = await resolveThresholds(manifest.name, teamId);
          (context as { thresholds?: Record<string, SentinelThresholdPair> }).thresholds = thresholds;

          // V4.3.0: 从 store 构建 GraphTraversal 实例，作为第 3 参注入 aggregate
          let traversal: import('../l4/graph-traversal').GraphTraversal | undefined;
          try {
            const { createGraphTraversal } = await import('../l4/graph-traversal');
            // GraphStore 接口 check: 确保 store 有 queryNodes 方法
            if (typeof (store as { queryNodes?: unknown }).queryNodes === 'function') {
              traversal = createGraphTraversal(store as unknown as import('../l4/graph-traversal').GraphStoreReader);
            }
          } catch (err: unknown) {
            log.warn({ err }, 'GraphTraversal 构建失败 — 降级，不使用图遍历');
          }

          // D577: 第 4 参注入 thresholds（aggregate 可选参，未声明者零影响）
          context.graphStore = hasQueryNodes
            ? (store as { queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): Array<{ id: string; type: string; props: Record<string, unknown> }> })
            : undefined;
          context.rawDb = hasPrepare
            ? (rawStore as { prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): { changes: number } } })
            : undefined;

          const checkFn = sentinelObj as {
            check: (store: unknown, teamId: string, traversal?: unknown,
              thresholds?: Record<string, SentinelThresholdPair>) => unknown;
          };
          const raw = await checkFn.check(store, teamId, traversal, thresholds);
          // 兼容两种返回格式: SentinelFinding[] 或 { findings: SentinelFinding[] }
          const findings: SentinelFinding[] = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.findings as SentinelFinding[]) || [];
          // D577 缺陷 C: degraded 传播（aggregate 对象形态返回时），不再硬编码丢失（铁律 31）
          const degraded = !Array.isArray(raw) && (raw as Record<string, unknown>)?.degraded === true;
          // #1375（A2）：**指标级接线** —— 哨兵只返回结构化 metrics，loader 统一落库
          const metrics: MetricRow[] = Array.isArray(raw)
            ? []
            : ((raw as Record<string, unknown>)?.metrics as MetricRow[] | undefined) ?? [];
          const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const defVersion = `${manifest.name}@${manifest.version || '1.0.0'}`;
          if (metrics.length > 0) {
            const sink = (context as { metricSink?: (row: Record<string, unknown>) => unknown }).metricSink;
            if (!sink) {
              log.warn({ sentinelId: `sentinel-${manifest.name}`, count: metrics.length, degraded: true, reason: 'no-sink' },
                '有 metrics 但无 sink（该路径未注入）⇒ 跳过写入（显式降级，不静默）');
            } else {
              for (const m of metrics) {
                sink({
                  orgId: teamId,
                  metricId: m.metricId,
                  value: m.value,
                  unit: m.unit,
                  entityId: '*',
                  sourceType: 'compute',
                  sourceId: m.sourceId ?? `sentinel-${manifest.name}`,
                  evidenceRef: m.evidenceRef ?? `sentinel:${manifest.name}`,
                  observedAt: new Date().toISOString(),
                  runId,
                  defVersion,
                  inputDigest: m.inputDigest,
                });
              }
            }
          }
          const result: SentinelCheckResult = {
            sentinelId: `sentinel-${manifest.name}`,
            ok: true,
            findings,
            durationMs: 0,
            checkedAt: new Date().toISOString(),
          };
          if (metrics.length > 0) result.metrics = metrics;
          if (degraded) result.degraded = true;
          return result;
        },
      });

      registered++;
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`哨兵 ${manifest.name} 注册失败: ${msg}`);
    }
  }

  if (registered > 0) log.info({ registered, errors: errors.length }, '文件驱动哨兵已注册');
  return { registered, errors };
}
