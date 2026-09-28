// lib/index.js — @synova/dsh-dashboards Host 半（dsh web 进程内运行的 Cordis 插件）
// 契约（铁律 47）：
//   @input  ctx.webServer（webServer 服务）、config.repoRoot（默认 process.cwd()）
//   @output 四条只读 GET 路由：
//     ① GET /synova/dashboards/data → JSON DashboardPayload（三仪表盘数据源；健康区仍走它）
//     ② GET /synova/pm/ledger       → 200 application/json，body = 账本对象 + 顶层元字段：
//          { ...ledger, ok:true, source:"worktree"|"origin/main"[, source_detail] }
//          · source      —— 三级取数的实际来源（见 lib/ledger.js 契约）
//          · source_detail —— 发生了回退时的说明（工作区缺失原因）
//          取数顺序：工作区文件 → git origin/main → 显式降级
//          降级: { ok:false, degraded:true, error:"<两级原因>", attempts:[...] }
//     ③ GET /synova/workbench/data  → D1060 面板 A「Synova 开发工作台」（见 lib/workbench.js 契约）
//     ④ GET /synova/governance/data → D1060 面板 B「治理线」（见 lib/governance.js 契约）
//          ③④ 两块**独立取数、独立降级**：任一块 200 + degraded，绝不影响另一块，绝不 500。
//   @degraded 数据收集/读盘失败 → 200 + degraded JSON（不 500，避免前端误判为断网；
//             不抛异常，避免拖垮宿主进程；铁律 24/31）
//   @caching 四条路由均无缓存，每次请求读盘（沿用现有 data 路由语义）
//   @write   零写入：只 readFile/execFile 只读 git/只读 HTTP GET，不写工作区/仓库（D794 红线）
import { collectDashboards } from "./collect.js";
import { readLedger } from "./ledger.js";
import { collectWorkbench } from "./workbench.js";
import { collectGovernance } from "./governance.js";

export const name = "synova-dashboards";
export const inject = ["webServer"];

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx, config = {}) {
  if (active) return; // standing-scope 预设可能重复触发 apply —— 首个挂载持有路由，其余静默加入
  active = true;
  const repoRoot = (config && config.repoRoot) || process.cwd();
  ctx.effect(() => {
    const disposeData = ctx.webServer.register({
      kind: "exact",
      path: "/synova/dashboards/data",
      handler: async (req, res) => {
        try {
          const payload = await collectDashboards(repoRoot);
          res.writeHead(200, HEADERS);
          res.end(JSON.stringify(payload));
        } catch (err) {
          ctx.logger.warn(`synova-dashboards: ${err?.message ?? err}`);
          res.writeHead(200, HEADERS);
          res.end(JSON.stringify({
            degraded: true,
            error: String(err?.message ?? err),
            meta: { repoRoot, generated_at: new Date().toISOString() }
          }));
        }
      }
    });
    const disposeLedger = ctx.webServer.register({
      kind: "exact",
      path: "/synova/pm/ledger",
      handler: async (req, res) => {
        const result = await readLedger(repoRoot);
        if (!result.ok) {
          // 铁律 24/31：降级必须留痕 + 显式标记，不静默、不抛异常
          ctx.logger.warn(`synova-dashboards/ledger: ${result.error}`);
          res.writeHead(200, HEADERS);
          res.end(JSON.stringify({
            ok: false,
            degraded: true,
            error: result.error,
            attempts: result.attempts,
            path: result.path
          }));
          return;
        }
        // 命中回退时也留痕（可观测：说明为什么没走工作区）
        if (result.fallback_note) ctx.logger.warn(`synova-dashboards/ledger: ${result.fallback_note}`);
        // 账本字段保持在顶层（前端与既有 schema 不变），只追加元字段 ok / source / source_detail。
        // 账本必须是对象才注入；非对象（null/数组）时用 ledger 字段包裹，避免丢数据。
        const p = result.parsed;
        const body = p !== null && typeof p === "object" && !Array.isArray(p)
          ? Object.assign({}, p, { ok: true, source: result.source, ...(result.fallback_note ? { source_detail: result.fallback_note } : {}) })
          : { ok: true, source: result.source, ledger: p };
        res.writeHead(200, HEADERS);
        res.end(JSON.stringify(body));
      }
    });
    const disposeWorkbench = registerReadOnlyRoute(
      ctx,
      "/synova/workbench/data",
      "workbench",
      () => collectWorkbench(repoRoot)
    );
    const disposeGovernance = registerReadOnlyRoute(
      ctx,
      "/synova/governance/data",
      "governance",
      () => collectGovernance(repoRoot)
    );
    return () => {
      active = false;
      disposeData();
      disposeLedger();
      disposeWorkbench();
      disposeGovernance();
    };
  }, "synova-dashboards: read-only routes");
}

/**
 * 注册一条「只读取数」路由：成功与降级都走 200 + JSON。
 * D1060 抽出：四条路由的降级形状必须**逐字一致**（铁律 31），复制四遍必然漂移。
 * @param {object} ctx Cordis 上下文
 * @param {string} path 路由路径
 * @param {string} label 日志前缀标签
 * @param {() => Promise<object>} collect 取数器（约定不抛异常；抛了也在此兜住）
 * @returns {() => void} dispose
 */
function registerReadOnlyRoute(ctx, path, label, collect) {
  return ctx.webServer.register({
    kind: "exact",
    path,
    handler: async (req, res) => {
      try {
        const payload = await collect();
        // 铁律 24/31：降级必须留痕（日志）+ 显式标记（payload.degraded），不静默
        if (payload && payload.degraded === true) {
          const why = Array.isArray(payload.degraded_sources) && payload.degraded_sources.length > 0
            ? payload.degraded_sources.join("；")
            : payload.error ?? "部分数据源降级";
          ctx.logger.warn(`synova-dashboards/${label}: ${why}`);
        }
        res.writeHead(200, HEADERS);
        res.end(JSON.stringify(payload));
      } catch (err) {
        ctx.logger.warn(`synova-dashboards/${label}: ${err?.message ?? err}`);
        res.writeHead(200, HEADERS);
        res.end(JSON.stringify({
          ok: false,
          degraded: true,
          error: String(err?.message ?? err),
          generated_at: new Date().toISOString()
        }));
      }
    }
  });
}

/** 进程级挂载护栏：同一时刻只允许一个挂载持有数据路由（预设 standing scope / 并发挂载安全）。 */
let active = false;
