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
import type { SentinelFinding, SentinelCheckResult, SentinelThresholdPair } from './types';

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

// ═══ 读侧根身份硬门禁（D1027）═══

/**
 * queryNodes 最小能力面。预检只在 store 暴露该方法时执行；以对象方法调用
 * （而非解构出的函数引用）保持 `this` 绑定 —— SqliteGraphStore.queryNodes 依赖 this.db。
 */
interface NodeQueryCapable {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): unknown;
}

/** store 能力收窄（类型守卫）: queryNodes 存在才执行预检；交叉类型保留原 store 的 this 绑定 */
function hasQueryNodes(store: Record<string, unknown>): store is Record<string, unknown> & NodeQueryCapable {
  return typeof store.queryNodes === 'function';
}

/** 根身份预检结论 */
interface RootIdentityPrecheck {
  /** 预检产出的 finding（仅根身份不匹配时非空；恒 ≤ 1 条以保证 finding id 唯一） */
  findings: SentinelFinding[];
  /** 是否判定「根身份不匹配」（unfiltered > 0 且 filtered === 0） */
  mismatched: boolean;
  /** 是否因前提不足/查询失败跳过预检（store 无 queryNodes / 未声明 nodeTypes / 查询抛错） */
  skipped: boolean;
}

/**
 * rootIdentityPrecheck — 哨兵读侧「根身份」硬门禁（D1027）
 *
 * 背景（物理来历）: 生产 ingest 写入的图节点 props 不含 teamId，而
 * `SqliteGraphStore.queryNodes(type, { teamId })` 以 `json_extract(props,'$.teamId') = ?` 过滤
 * ⇒ 该身份读到 0 行。旧行为把「看不到」当成「空库基线」返回 []，即把安全性失败
 * （租户/身份不匹配）翻译成「无异常通过」（X27 同一形状）。
 *
 * 契约:
 *   @input  — manifest: 本次哨兵清单（读 manifest.dependsOn?.nodeTypes，可缺省/空）；
 *             store: check 包装层传入的 ctx.db（未知形态，可能无 queryNodes）；
 *             teamId: `ctx.teamId || 'default'`（与包装层同一身份口径，不另取来源）。
 *   @output — RootIdentityPrecheck：逐 nodeType 取 unfiltered = queryNodes(type)、
 *             filtered = queryNodes(type, { teamId })；`unfiltered > 0 && filtered === 0`
 *             ⇒ mismatched = true + 1 条 finding（id `sentinel-<manifest.name>-root-identity`、
 *             severity warning、evidence 逐类型记 nodeType/unfiltered/filtered(=0)/teamId）。
 *             finding 每哨兵恒 1 条（log.error 逐类型），以保证 finding id 唯一。
 *   @degraded — store 无 queryNodes / 单类型查询抛错 ⇒ log.warn + 跳过（skipped = true），
 *             不抛异常；**不翻 result.degraded** —— 预检是旁路守卫，「跳过」不等于
 *             「本次检查结果降级」，且须保持既有行为逐位不变（铁律 11 靠日志可见）。
 *   @coverage — manifest 未声明 dependsOn.nodeTypes（当前 45 哨兵中 41 个如此）⇒ log.info 记一行
 *             「覆盖缺口」，skipped = true。**用 info 而非 warn**：未声明依赖是清单数据缺口、
 *             非本次运行异常，按每次 check 打 warn 会淹没真告警（队长 2026-09-27 裁定；
 *             缺口本身进遗留清单另立卡，不在本卡修）。不可静默（X27: 预检自己不得把缺失当通过）。
 *   @error  — 不抛异常（所有失败路径降级返回，铁律 24/31）。
 */
function rootIdentityPrecheck(
  manifest: SentinelManifest,
  store: Record<string, unknown>,
  teamId: string,
): RootIdentityPrecheck {
  const nodeTypes = manifest.dependsOn?.nodeTypes ?? [];
  if (nodeTypes.length === 0) {
    log.info(
      { sentinel: manifest.name, teamId },
      '根身份预检跳过 — manifest 未声明 dependsOn.nodeTypes（覆盖缺口，预检不执行）',
    );
    return { findings: [], mismatched: false, skipped: true };
  }
  if (!hasQueryNodes(store)) {
    log.warn({ sentinel: manifest.name, teamId, nodeTypes }, '根身份预检跳过 — store 无 queryNodes 方法（不静默）');
    return { findings: [], mismatched: false, skipped: true };
  }

  const mismatches: Array<{ nodeType: string; unfiltered: number }> = [];
  for (const nodeType of nodeTypes) {
    try {
      const unfilteredRows = store.queryNodes(nodeType);
      const filteredRows = store.queryNodes(nodeType, { teamId });
      const unfiltered = Array.isArray(unfilteredRows) ? unfilteredRows.length : 0;
      const filtered = Array.isArray(filteredRows) ? filteredRows.length : 0;
      if (unfiltered > 0 && filtered === 0) {
        mismatches.push({ nodeType, unfiltered });
        log.error(
          { sentinel: manifest.name, nodeType, teamId, unfiltered, filtered },
          '根身份不匹配 — 图中有该类型节点但无一属本次身份（按不可见处理，非空库基线）',
        );
      }
    } catch (err: unknown) {
      log.warn(
        {
          sentinel: manifest.name,
          nodeType,
          teamId,
          err: err instanceof Error ? err.message : String(err),
        },
        '根身份预检查询失败 — 跳过该类型（不静默）',
      );
    }
  }

  if (mismatches.length === 0) return { findings: [], mismatched: false, skipped: false };

  const types = mismatches.map(m => m.nodeType).join('、');
  const total = mismatches.reduce((sum, m) => sum + m.unfiltered, 0);
  return {
    mismatched: true,
    skipped: false,
    findings: [{
      id: `sentinel-${manifest.name}-root-identity`,
      severity: 'warning',
      title: `根身份不匹配：图中有 ${total} 个 ${types} 节点，但无一属于身份 ${teamId}`,
      description:
        `哨兵「${manifest.name}」依赖的节点类型（${types}）在图中存在，但本次运行身份「${teamId}」一条都读不到。`
        + '已按「不可见」处理 —— 这不是空库基线，而是根身份（写入身份 vs 读取身份）不匹配；'
        + '禁止把该状态翻译成「无异常通过」。',
      evidence: [
        ...mismatches.map(m => `nodeType=${m.nodeType} unfiltered=${m.unfiltered} filtered=0 teamId=${teamId}`),
        `sentinel=${manifest.name}`,
      ],
      suggestion:
        `核对 ingest 是否为图节点写入 teamId 属性，以及本次运行身份「${teamId}」是否与写入身份一致；`
        + '在 ingest 侧收口前，该类型数据对全部按 teamId 读数的哨兵不可见。',
      detectedAt: new Date().toISOString(),
    }],
  };
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
          const store = (context.db ?? {}) as Record<string, unknown>;
          const teamId = (ctx.teamId as string) || 'default';

          // D1027 读侧根身份硬门禁: 「图里有该类型节点、但本次身份读不到」必须显式可见，
          // 不得静默返回 [] 被下游当成「空库基线通过」（契约见 rootIdentityPrecheck）
          const rootIdentity = rootIdentityPrecheck(manifest, store, teamId);

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
          const checkFn = sentinelObj as {
            check: (store: unknown, teamId: string, traversal?: unknown,
              thresholds?: Record<string, SentinelThresholdPair>) => unknown;
          };
          const raw = await checkFn.check(store, teamId, traversal, thresholds);
          // 兼容两种返回格式: SentinelFinding[] 或 { findings: SentinelFinding[] }
          const findings: SentinelFinding[] = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.findings as SentinelFinding[]) || [];
          // D577 缺陷 C: degraded 传播（aggregate 对象形态返回时），不再硬编码丢失（铁律 31）
          // D1027: 根身份不匹配同样置 degraded（与既有 true 取或，不覆盖既有 true）
          const degraded = (!Array.isArray(raw) && (raw as Record<string, unknown>)?.degraded === true)
            || rootIdentity.mismatched;
          const result: SentinelCheckResult = {
            sentinelId: `sentinel-${manifest.name}`,
            ok: true,
            findings: [...rootIdentity.findings, ...findings],
            durationMs: 0,
            checkedAt: new Date().toISOString(),
          };
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
