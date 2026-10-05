/**
 * sentinel/builtins.ts — 内置哨兵自动注册
 *
 * 2026-06-18: 从硬编码 25 个模块 → 目录自动扫描。
 * 加新哨兵 = 在 adapters/ 创建 xxx-sentinel.ts 文件 → 自动注册。
 * 不需要改 builtins.ts。
 *
 * 2026-10-04 (#977): 导出键解析从「只认按文件名推导的键」→
 *    「精确键优先 + 哨兵结构遍历兜底」。
 *    历史坏点（实测 registered=0 / scanned=4，4 个内置适配器全部注册失败）——
 *    导出名与文件名推导键不一致：
 *      cash-flow-sentinel.ts          → 推导 cashFlow          ／ 实际 cashFlowSentinel
 *      cpc-sentinel.ts                → 推导 cpc               ／ 实际 cpcSentinel
 *      goal-alignment-sentinel.ts     → 推导 goalAlignment     ／ 实际 goalalignmentSentinel (小写 L)
 *      integration-health-sentinel.ts → 推导 integrationHealth ／ 实际 integrationHealthSentinel
 *    ⇒ 命名约定由「必须记住的规矩」变为「结构上不可能错」：
 *      即使导出名任意，只要模块导出了哨兵结构对象，就会被注册。
 *
 * 架构: L2 (synova-agent.ts) → L3 (builtins.ts) → L3 (adapters/*)
 */

import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSentinelRegistry } from './registry';
import type { Sentinel } from './types';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/builtins');

/**
 * 从文件名推导导出键名（首选键，不是唯一依据）。
 * cost-health-sentinel.ts → costHealthSentinel
 * revenue-health-sentinel.ts → revenueHealthSentinel
 * gap-dynamics: 已删除(V4.2.4)
 */
function filenameToExportKey(filename: string): string {
  const base = filename.replace(/-sentinel\.ts$/, '').replace(/\.ts$/, '');
  return base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 哨兵结构判定（鸭子类型，不依赖导出名）。
 *
 * 契约（铁律 47）：
 * - 输入：任意模块导出值（`await import()` 命名空间里的一个属性值）
 * - 输出：`true` ⇒ 满足 registry.register() 的最小结构 — `config.id` 为非空字符串 且 `check` 为函数
 * - 降级：任何不满足的输入一律返回 `false`，**不抛异常**（调用方据此跳过该导出）
 *
 * 为什么不用导出名判定：命名是「必须记住的规矩」（#977 四个内置适配器全挂的根因）；
 * 结构是编译器/运行时都能物理核验的事实。
 */
function isSentinelShape(value: unknown): value is Sentinel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { config?: unknown; check?: unknown };
  if (typeof candidate.check !== 'function') return false;
  const config = candidate.config;
  if (!config || typeof config !== 'object') return false;
  const id = (config as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0;
}

/** resolveSentinelExport 的命中结果 */
interface SentinelExportMatch {
  /** 命中的导出键（真实键名，不是推导键） */
  exportKey: string;
  /** 命中的哨兵对象 */
  sentinel: Sentinel;
  /** true = 文件名推导键未命中，走了结构遍历兜底（说明命名约定与文件名不一致） */
  viaStructuralScan: boolean;
}

/**
 * 从模块命名空间中解析出哨兵对象。
 *
 * 契约（铁律 47）：
 * - 输入：`mod` = `await import()` 的模块命名空间；`filename` = 磁盘文件名（仅用于推导首选键）
 * - 输出：命中 ⇒ `{ exportKey, sentinel, viaStructuralScan }`；未命中 ⇒ `null`
 * - 降级：未命中返回 `null`（**不抛异常**），由调用方 log.error 并继续扫描下一个文件
 *
 * 解析顺序：
 *   ① 先按 `filenameToExportKey(filename)` 精确取值 — 名字对得上时行为与旧实现完全一致；
 *   ② 未命中 ⇒ 遍历模块全部导出，取第一个哨兵结构值（`Object.entries` 对模块命名空间按规范有序，结果确定）。
 */
function resolveSentinelExport(mod: Record<string, unknown>, filename: string): SentinelExportMatch | null {
  const preferredKey = filenameToExportKey(filename);
  const preferred = mod[preferredKey];
  if (isSentinelShape(preferred)) {
    return { exportKey: preferredKey, sentinel: preferred, viaStructuralScan: false };
  }
  for (const [exportKey, value] of Object.entries(mod)) {
    if (isSentinelShape(value)) {
      return { exportKey, sentinel: value, viaStructuralScan: true };
    }
  }
  return null;
}

/**
 * 扫描 adapters/ 目录，自动发现并注册所有 *-sentinel.ts 文件。
 * 每个模块独立 try/catch——一个加载失败不影响其他。
 *
 * 契约（铁律 47/24/31）：
 * - 输入：无（隐式读 `adapters/` 目录与全局 SentinelRegistry 单例）
 * - 输出：`Promise<void>`；副作用 = 向注册表登记哨兵 + 结构化日志
 * - 降级：目录不可读 / 无文件 / 单文件解析失败 均只 log（error/warn）后继续，**从不抛异常**
 */
export async function registerBuiltinSentinels(): Promise<void> {
  const registry = getSentinelRegistry();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const adaptersDir = join(__dirname, 'adapters');

  let sentinelFiles: string[];
  try {
    sentinelFiles = readdirSync(adaptersDir).filter(f => f.endsWith('-sentinel.ts') || f.endsWith('-sentinel.js'));
  } catch {
    log.error('[builtins] adapters/ 目录不可读 — 哨兵注册失败');
    return;
  }

  if (sentinelFiles.length === 0) {
    log.warn('[builtins] adapters/ 无 *-sentinel 文件 — 零哨兵注册');
    return;
  }

  let registered = 0;

  for (const filename of sentinelFiles) {
    try {
      const mod = await import(join(adaptersDir, filename).replace(/\\/g, '/'));
      const match = resolveSentinelExport(mod as Record<string, unknown>, filename);
      if (match) {
        registry.register(match.sentinel);
        registered++;
        if (match.viaStructuralScan) {
          log.warn({ filename, exportKey: match.exportKey, preferredKey: filenameToExportKey(filename), sentinelId: match.sentinel.config.id },
            `[builtins] ${filename} 文件名推导键未命中 — 已按哨兵结构兜底命中 (${match.exportKey})`);
        } else {
          log.info(`[builtins] ${filename} → ${match.exportKey} 已注册`);
        }
      } else {
        log.error({ filename, exportNames: Object.keys(mod) },
          `[builtins] ${filename} 未导出哨兵结构对象 (导出项: ${Object.keys(mod).join(', ') || '无'})`);
      }
    } catch (err: unknown) {
      log.error({ filename, err: (err as Error)?.message || String(err), code: 'SENTINEL_REGISTER_FAILED', phase: 2, retryable: false },
        `[builtins] ${filename} 注册失败`);
    }
  }

  const total = registry.count();
  const cronCount = registry.listCronSentinels().length;
  log.info({ registered, total, cronCount, scanned: sentinelFiles.length }, '[builtins] 哨兵自动注册完成');
}

// 哨兵注册表: 文件驱动哨兵由 sentinel-loader.ts 自动发现注册 (V3.8)
// 新增哨兵 = extensions/sentinels/{name}/manifest.json + aggregate.ts → 零代码变更
