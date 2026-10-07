/**
 * sentinel/adapters/helpers.ts — 哨兵适配器辅助函数
 * @state: real
 *
 * 提供 DB 上下文切换 + 团队发现 + 报告→Finding 转换工具。
 * 所有引擎模块通过 getEngineContext().database.getDb() 访问 DB，
 * 哨兵通过 context.db 获得 DB 实例——两者需指向同一实例。
 *
 * Iron Law 24: 所有 catch 带 log.warn/error + degraded 标记
 */

import type { SentinelContext, SentinelCheckResult, SentinelFinding } from '../types';
import { getDatabase, initEngineContext } from '../../init/engine-context';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/adapter-helpers');

/**
 * 临时将引擎上下文的 DB 引用替换为 context.db。
 * 返回恢复函数——调用方必须在 finally 块中调用。
 *
 * 生产环境两者指向同一实例（无实际效果）；
 * 测试环境可用此机制注入 mock DB。
 */
export function swapDbForContext(context: SentinelContext): () => void {
  initEngineContext();
  return () => {};
}

/**
 * 从 diagnosis_snapshots 表发现所有已知团队 ID。
 * 空表或无权限时回退到 ['default']。
 */
/**
 * 团队/租户枚举（#1371 V6 处置 = **修**；CTO 2026-10-08 裁）：
 *   · 旧实现读 `diagnosis_snapshots` —— 该表**在真库不存在**（2026-10-08 实测）⇒ 恒走 catch ⇒ 回落 `['default']`
 *     （= 已坏的代码路径，不是"冷启动缺口"）。
 *   · 现实现读 **租户注册表 `orgs`（status='active'）** ⇒ ① 死表依赖消失 ② 与 cron 扇出**共用同一真源**。
 *   · 🔴 **删除 `['default']` 回落**：`'default'` 是回落值不是租户（表 CHECK 已禁入）⇒ 空注册表返回 `[]`，
 *     调用方须自行处理"无租户"（**不得**把回落值当租户）。
 */
export function discoverTeams(context: SentinelContext): string[] {
  try {
    const db = context.db as { prepare(sql: string): { all(): Array<{ team_id: string }> } } | null;
    if (!db || typeof db.prepare !== 'function') {
      log.debug('db 不可用 — 无租户可枚举（空集，不再回落 default）');
      return [];
    }
    const rows = db
      .prepare("SELECT org_id AS team_id FROM orgs WHERE status = 'active' ORDER BY org_id")
      .all();
    if (rows && rows.length > 0) return rows.map((r) => r.team_id);
  } catch (err: unknown) {
    log.warn({ err: (err as Error)?.message || String(err) }, '租户枚举查询失败 — 空集（不再回退 default）');
  }
  // #1371：**不再回落 `'default'`**（回落值不是租户；表 CHECK 亦禁入）⇒ 空集由调用方处理
  return [];
}

/**
 * 对单个团队执行 compute 函数，包装为标准 SentinelCheckResult。
 *
 * @param sentinelId  — 哨兵 ID
 * @param teamId      — 目标团队
 * @param now         — 检查时间
 * @param computeFn   — 实际计算函数 (teamId: string) => report | null
 * @param findingsFn  — 报告 → SentinelFinding[] 转换函数
 * @param label       — 日志标签
 */
export async function checkTeam(
  sentinelId: string,
  teamId: string,
  now: Date,
  computeFn: (teamId: string) => unknown,
  findingsFn: (report: unknown) => SentinelFinding[],
  label: string,
): Promise<SentinelCheckResult> {
  const checkedAt = now.toISOString();
  try {
    const report = await Promise.resolve(computeFn(teamId));
    if (!report) {
      return {
        sentinelId,
        ok: true,
        findings: [],
        durationMs: 0,
        checkedAt,
        degraded: true,
      };
    }
    const findings = findingsFn(report);
    return {
      sentinelId,
      ok: true,
      findings,
      durationMs: 0,
      checkedAt,
      degraded: findings.length === 0,
    };
  } catch (err: unknown) {
    // Iron Law 24: catch 必须打 log.error + 区分错误类型
    const msg = (err as Error)?.message || String(err);
    log.error({ sentinelId, teamId, err: msg, code: 'SENTINEL_CHECK_FAILED', phase: 3, retryable: true },
      `[${label}] 团队 ${teamId} 检查失败`);
    return {
      sentinelId,
      ok: false,
      findings: [],
      durationMs: 0,
      checkedAt,
      error: msg,
      degraded: true,
    };
  }
}
