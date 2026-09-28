/**
 * settings.ts — 设置生效面检查入口（D1053，线25 25-8/25-9）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §4.3/§7.1/§7.3
 * 依赖: `src/config/settings-applies.ts` 的 `getSettingsRuntime()`（**同一个** boot 生效边界；
 *   第二消费者 `src/routes/config.ts` 走同一 accessor ⇒ 两面天然同值，不需共享变量/DI 容器）。
 *
 * 契约（铁律 47）:
 *   @input  本模块的**唯一出口** = `export default` 的 Router 实例（无参构造；工厂为模块私有）。
 *           ⚠ D1053-C 收敛登记：spec §4.3 原写 `createSettingsRoutes(runtime?)` 带注入缝，
 *           实测该注入缝**无任何调用方**（本卡 e2e 走真实 `createServer()`、V 走真实进程）
 *           ⇒ 按铁律 37 删除注入参数与命名导出，只留 default 实例（同 `src/routes/config.ts:60` 风格）。
 *   @output 绑定 `GET /api/settings/effective`
 *           200 + `{ok, degraded, reason?, code?, bootId, bootedAt, sourceFiles, undeclared[],
 *                  undeclaredTotal, undeclaredScope, truncated, exceptions[], counts, filters,
 *                  keys[]}`（字段名逐字，spec §7.1）
 *   @degraded 每次请求从 runtime 读 degraded/reason/code 并**透传**响应体；检查表面不成为故障面
 *   @error 无抛出路径：400 只用于 query 形状错（VALIDATION_ERROR）；声明异常/未知异常均收敛为
 *          200 + degraded + code（铁律 24/31），未知异常另打 `log.warn`
 *
 * 零缓存（裁决 D2 / M3 判别点）: 处理器内**每请求**重新解析 accessor、不缓存任何块——
 *   在消费者侧注入模块级缓存必须能让"两消费者同值"断言变红，否则缺判别性夹具。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import {
  getSettingsRuntime,
  getEffectiveRow,
  type SettingsEffectiveRow,
  type SettingsRuntime,
} from '../config/settings-applies';

const log = createLogger('routes/settings');

/** kebab-case 命名空间（与声明表同规则）。 */
const NS_PATTERN = /^[a-z][a-z0-9-]*$/;
/** undeclared 枚举范围的字面量（R8：把边界同时暴露在 HTTP 面，机器可核）。 */
const UNDECLARED_SCOPE = 'settings.yaml';
/** limit 上下界（spec §5.3）：1..500，缺省 100。 */
const LIMIT_MIN = 1;
const LIMIT_MAX = 500;
const LIMIT_DEFAULT = 100;

/** 请求校验结果：ok=false 时带错误说明（→ 400）。 */
interface ParsedQuery {
  ok: boolean;
  error?: string;
  ns?: string;
  key?: string;
  includeUndeclared: boolean;
  limit: number;
}

/** 解析并校验 query（形状错 ⇒ 400，镜像 routes/config.ts 的 VALIDATION_ERROR 先例）。 */
function parseQuery(req: Request): ParsedQuery {
  const raw = (name: string): string | undefined => {
    const value = req.query[name];
    return typeof value === 'string' ? value : undefined;
  };
  const ns = raw('ns');
  if (ns !== undefined && !NS_PATTERN.test(ns)) {
    return { ok: false, error: 'ns 须匹配 ^[a-z][a-z0-9-]*$', includeUndeclared: true, limit: LIMIT_DEFAULT };
  }
  const key = raw('key');
  if (key !== undefined && ns === undefined) {
    return { ok: false, error: 'key 必须与 ns 合用（精确查询单键）', includeUndeclared: true, limit: LIMIT_DEFAULT };
  }
  const includeRaw = raw('includeUndeclared');
  if (includeRaw !== undefined && includeRaw !== '0' && includeRaw !== '1') {
    return { ok: false, error: "includeUndeclared 只能是 '0' 或 '1'", includeUndeclared: true, limit: LIMIT_DEFAULT };
  }
  const limitRaw = raw('limit');
  let limit = LIMIT_DEFAULT;
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < LIMIT_MIN || parsed > LIMIT_MAX) {
      return {
        ok: false,
        error: `limit 须为 ${LIMIT_MIN}..${LIMIT_MAX} 的整数`,
        includeUndeclared: true,
        limit: LIMIT_DEFAULT,
      };
    }
    limit = parsed;
  }
  return {
    ok: true,
    ...(ns === undefined ? {} : { ns }),
    ...(key === undefined ? {} : { key }),
    includeUndeclared: includeRaw !== '0',
    limit,
  };
}

/** 组装 200 响应体（字段名逐字对齐 spec §7.1）。 */
function bodyOf(
  runtime: SettingsRuntime,
  query: ParsedQuery,
  rowOf: (path: string) => SettingsEffectiveRow | null,
): Record<string, unknown> {
  const includeUndeclared = query.includeUndeclared;
  // ns + key 齐备 ⇒ 单键精确查询路径（走 getEffectiveRow/accessor.row，不放行未声明过滤）
  let keys: SettingsEffectiveRow[];
  if (query.ns !== undefined && query.key !== undefined) {
    const precise = rowOf(`${query.ns}.${query.key}`);
    keys = precise !== null && (includeUndeclared || precise.declared) ? [precise] : [];
  } else {
    keys = runtime.rows({
      ...(query.ns === undefined ? {} : { ns: query.ns }),
      includeUndeclared,
      limit: query.limit,
    });
  }
  const undeclaredTotal = runtime.undeclared.length;
  const undeclaredShown = runtime.undeclared.slice(0, query.limit);
  const live = keys.filter((row) => row.applies === 'live').length;
  const restart = keys.filter((row) => row.applies === 'restart').length;
  return {
    ok: true,
    degraded: runtime.degraded,
    ...(runtime.reason === undefined ? {} : { reason: runtime.reason }),
    ...(runtime.code === undefined ? {} : { code: runtime.code }),
    bootId: runtime.bootId,
    bootedAt: runtime.bootedAt,
    sourceFiles: runtime.sourceFiles,
    undeclared: undeclaredShown,
    undeclaredTotal,
    undeclaredScope: UNDECLARED_SCOPE,
    truncated: undeclaredShown.length < undeclaredTotal,
    exceptions: runtime.exceptions,
    counts: {
      declared: keys.filter((row) => row.declared).length,
      live,
      restart,
      undeclared: undeclaredTotal,
    },
    filters: {
      ns: query.ns ?? null,
      key: query.key ?? null,
      includeUndeclared,
      limit: query.limit,
    },
    keys,
  };
}

/**
 * 构造设置生效面路由（D1053 唯一新入口）。

 * @returns express Router（默认导出 = 本函数的无参实例，与既有 configRoutes 风格一致）。
 * @degraded 透传 runtime 的 degraded/reason/code（200 + degraded，不抛）。
 * @error 无（query 形状错 → 400 VALIDATION_ERROR；其余异常兜底 200 + degraded）。
 *
 * 模块私有工厂（D1053-C 收敛，铁律 37）：注入缝 `runtime?` 无任何调用方（本卡 e2e 走真实
 * `createServer()`、V 走真实进程）⇒ 一并删除，避免"双入口/无用参数"死代码；对外只保留
 * `export default` 的 Router 实例（同 `src/routes/config.ts:60` 风格）。
 */
function createSettingsRoutes(): Router {
  const router = Router();

  router.get('/api/settings/effective', (req: Request, res: Response) => {
    const query = parseQuery(req);
    if (!query.ok) {
      res.status(400).json({ ok: false, error: query.error, code: 'VALIDATION_ERROR' });
      return;
    }
    try {
      // 每请求解析同一 accessor（零模块级缓存 —— M3 判别点；force 重建后立即反映）
      const effectiveRuntime = getSettingsRuntime();
      // 单键精确查询走 getEffectiveRow（同一 accessor 的公开读取面）
      res.json(bodyOf(effectiveRuntime, query, getEffectiveRow));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      log.warn({ err: error }, 'settings/effective 未预期异常 — degraded 响应（不抛，铁律 24/31）');
      res.json({
        ok: true,
        degraded: true,
        reason: `设置生效面内部异常: ${detail}`,
        code: 'SETTINGS_ROUTE_INTERNAL',
        keys: [],
        undeclared: [],
        undeclaredTotal: 0,
        undeclaredScope: UNDECLARED_SCOPE,
        truncated: false,
        exceptions: [],
        counts: { declared: 0, live: 0, restart: 0, undeclared: 0 },
      });
    }
  });

  return router;
}

export default createSettingsRoutes();
