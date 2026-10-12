/**
 * src/cycles/cycle-loader.ts — CycleLoader
 *
 * 对标 src/sentinel/sentinel-loader.ts 的文件驱动模式：
 *   目录扫描 → JSON 解析 → 优先级覆盖 → 缓存 → 注册
 *
 * 三目录优先级覆盖: custom/{enterpriseId} > industry/{sector} > builtin
 * 消费 D79 ContextLoader 合并企业循环参数覆盖。
 * 单个文件加载失败仅 errors，不阻断其余文件。
 *
 * 契约:
 *   @input  — 扫描 cycles/{custom,industry,builtin} 目录
 *   @output — { cycles: CycleConfig[], degraded, errors }
 *   @degraded — 部分文件失败仍返回已加载部分
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import type { CycleConfig, ContextLoaderLike } from './cycle-types';
import { VALVE_KEYS, ACTION_EFFECT_LAG_RANGE_MONTHS } from './cycle-types';

const log = createLogger('cycles/loader');

const VALID_LAGS = new Set<string>(Object.keys(ACTION_EFFECT_LAG_RANGE_MONTHS));

/**
 * 校验五阀映射（#239 / K4-06）。
 *
 * 契约:
 *   @input  — `raw`（已解析的循环配置对象）
 *   @output — 违规描述数组；**空数组 = 合规**
 *   @degraded — 不抛错；违规逐条以字符串返回，由调用方计入 `errors` ⇒ `degraded: true`
 *
 * 判据（缺字段即报错）:
 *   ① `valves` 存在且为对象
 *   ② 五个阀键（`acquisitionValve`/`allocationValve`/`conversionValve`/`deliveryValve`/`recycleValve`）**全部存在**且为数组
 *   ③ 每个元素形如 `{ edgeId: string, actionEffectLag: <6 桶之一> }`
 *   ④ 每个阀**至少 1 条边**（空阀 = 该环节无政策杠杆点，视为未配置）
 */
function validateValves(raw: unknown): string[] {
  const violations: string[] = [];
  const cfg = raw as { valves?: unknown };
  const valves = cfg.valves;

  if (valves === undefined || valves === null) {
    violations.push('valves 缺失（五阀映射未配置）');
    return violations;
  }
  if (typeof valves !== 'object' || Array.isArray(valves)) {
    violations.push('valves 形态非法（应为对象）');
    return violations;
  }

  const bag = valves as Record<string, unknown>;
  for (const key of VALVE_KEYS) {
    const arr = bag[key];
    if (arr === undefined || arr === null) {
      violations.push(`valves.${key} 缺失`);
      continue;
    }
    if (!Array.isArray(arr)) {
      violations.push(`valves.${key} 形态非法（应为数组）`);
      continue;
    }
    if (arr.length === 0) {
      violations.push(`valves.${key} 为空（该阀至少需 1 条边）`);
      continue;
    }
    arr.forEach((entry, i) => {
      const e = entry as { edgeId?: unknown; actionEffectLag?: unknown };
      if (typeof e.edgeId !== 'string' || e.edgeId.trim() === '') {
        violations.push(`valves.${key}[${i}].edgeId 缺失或非法`);
      }
      if (typeof e.actionEffectLag !== 'string' || !VALID_LAGS.has(e.actionEffectLag)) {
        violations.push(
          `valves.${key}[${i}].actionEffectLag 非法（须为 ${[...VALID_LAGS].join(' / ')}）`,
        );
      }
    });
  }
  return violations;
}

// ═══ 扫描路径 ═══

const CYCLES_ROOTS = [
  { root: join(process.cwd(), 'cycles', 'custom'), label: 'custom' },
  { root: join(process.cwd(), 'cycles', 'industry'), label: 'industry' },
  { root: join(process.cwd(), 'cycles', 'builtin'), label: 'builtin' },
];

// ═══ Cache ═══

let cache: CycleConfig[] | null = null;

/**
 * 加载所有循环配置。
 *
 * 按 custom > industry > builtin 优先级扫描。
 * 后扫描到的同名 cycleId 覆盖先扫描到的。
 *
 * @param contextLoader — 可选的 D79 ContextLoader 实例（用于合并企业参数）
 * @returns { cycles, degraded, errors }
 */
export function loadCycles(contextLoader?: ContextLoaderLike): { cycles: CycleConfig[]; degraded: boolean; errors: string[] } {
  const errors: string[] = [];

  if (cache) return { cycles: cache, degraded: false, errors: [] };

  const cycles: CycleConfig[] = [];
  const seen = new Set<string>();

  for (const { root, label } of CYCLES_ROOTS) {
    try {
      if (!existsSync(root)) continue;

      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // 递归扫描子目录（industry/{sector}/xxx.cycle.json）
          const subEntries = readdirSync(join(root, entry.name), { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isFile()) continue;
            if (!sub.name.endsWith('.cycle.json')) continue;
            if (sub.name.startsWith('_')) continue;
            loadCycleFile(join(root, entry.name, sub.name), label, cycles, seen, errors, contextLoader);
          }
        } else if (entry.isFile()) {
          if (!entry.name.endsWith('.cycle.json')) continue;
          if (entry.name.startsWith('_')) continue;
          loadCycleFile(join(root, entry.name), label, cycles, seen, errors, contextLoader);
        }
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "循环配置存在检查");
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`循环加载失败 (${label}): ${msg}`);
    }
  }

  log.info({ count: cycles.length, errors: errors.length }, 'Cycle 加载完成');
  cache = cycles;
  return { cycles, degraded: errors.length > 0, errors };
}

/** 加载单个 .cycle.json 文件 */
function loadCycleFile(
  filePath: string,
  label: string,
  cycles: CycleConfig[],
  seen: Set<string>,
  errors: string[],
  contextLoader?: ContextLoaderLike,
): void {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    let cycle = JSON.parse(raw) as CycleConfig;

    // 基本校验
    if (!cycle.cycleId || typeof cycle.cycleId !== 'string') {
      errors.push(`循环文件 ${filePath} cycleId 为空`);
      return;
    }
    if (!cycle.nodes || !Array.isArray(cycle.nodes)) {
      errors.push(`循环 ${cycle.cycleId} nodes 缺失`);
      return;
    }
    if (!cycle.overflowFormula || !cycle.overflowFormula.condition) {
      errors.push(`循环 ${cycle.cycleId} overflowFormula 缺失`);
      return;
    }

    // #239 / K4-06: 五阀映射校验（缺字段即报错 ⇒ errors ⇒ degraded: true，不静默放行）
    const valveViolations = validateValves(cycle);
    if (valveViolations.length > 0) {
      for (const v of valveViolations) errors.push(`循环 ${cycle.cycleId} ${v}`);
      return;
    }

    // D79 ContextLoader: 合并企业参数覆盖
    if (contextLoader?.getCycleOverrides) {
      try {
        const overrides = contextLoader.getCycleOverrides(cycle.cycleId);
        if (overrides) {
          cycle = { ...cycle, ...overrides };
          log.info({ cycleId: cycle.cycleId }, 'ContextLoader 循环参数已合并');
        }
      } catch {
        log.warn({ cycleId: cycle.cycleId }, 'ContextLoader 合并失败 — 降级');
      }
    }

    // 优先级覆盖
    if (seen.has(cycle.cycleId)) {
      const idx = cycles.findIndex(c => c.cycleId === cycle.cycleId);
      if (idx !== -1) cycles[idx] = cycle;
    } else {
      cycles.push(cycle);
      seen.add(cycle.cycleId);
    }
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "循环覆盖配置加载");
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`循环文件 ${filePath} 加载失败: ${msg}`);
  }
}

/**
 * 清除缓存。
 */
export function clearCycleCache(): void {
  cache = null;
  log.info('Cycle 缓存已清除');
}

/**
 * 注册已加载的循环到 CycleRegistry。
 */
export async function registerLoadedCycles(contextLoader?: ContextLoaderLike): Promise<{ registered: number; errors: string[] }> {
  const { cycles, errors: loadErrors } = loadCycles(contextLoader);
  const errors = [...loadErrors];
  let registered = 0;

  for (const cycle of cycles) {
    try {
      const { cycleRegistry } = await import('./cycle-registry');
      cycleRegistry.register(cycle);
      registered++;
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`循环 ${cycle.cycleId} 注册失败: ${msg}`);
    }
  }

  if (registered > 0) log.info({ registered, errors: errors.length }, 'Cycle 已注册');
  return { registered, errors };
}
