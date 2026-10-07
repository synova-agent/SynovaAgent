/**
 * sentinel/org-registry.ts — 租户注册表**只读**面（#1371）
 *
 * 定位（CTO 2026-10-08 裁）：注册表的**权威写入方 = 建档/开通流程**；本模块**只读**，
 *   **cron 不得自造/自扩租户**；不做强校验（JWT 的 orgId 不必须 ∈ 注册表），
 *   但提供**对账**：谁有数据却不在注册表里（防静默漏采）。
 *
 * 契约（铁律 47）:
 *   @input  db — better-sqlite3 Database（`orgs` 由迁移 003 建；表不存在 ⇒ 空数组 + debug 日志）
 *   @output listActiveOrgs ⇒ string[]（`status='active'`，按 org_id 升序，**确定性序**）
 *           findOrgsWithDataButNotRegistered ⇒ { orgIds: string[]; count: number }（对账）
 *   @degraded 读取失败/表不存在 ⇒ 返回空集 + log.debug（**不抛**；铁律 24/31）——调用方据此 fail-closed（不写）
 *   @invariant ① **只读**（本模块无 INSERT/UPDATE/DELETE）② 结果不含 `'default'`（表 CHECK 已禁入）
 *              ③ 返回顺序确定（ORDER BY org_id）
 *   @not-here 建档/开通写入（属开通流程）；JWT 强校验（CTO 裁定不做）；租户生命周期管理
 *
 * 铁律 39（L3 → 仅经类型依赖 L5 语义）/ 38（零不安全断言）
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/org-registry');

/** 有测量值数据的表（对账用；与 #1053 表定义一致） */
const DATA_TABLE = 'metric_readings';

/** 注册表里 `status='active'` 的 org（**cron 只跑这些**） */
export function listActiveOrgs(db: Database.Database): string[] {
  try {
    const rows = db
      .prepare("SELECT org_id FROM orgs WHERE status = 'active' ORDER BY org_id")
      .all() as Array<{ org_id: string }>;
    return rows.map((r) => r.org_id);
  } catch (err: unknown) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'orgs 表不可读（未迁移/库不可用）⇒ 空集（调用方 fail-closed 不写）',
    );
    return [];
  }
}

/**
 * 对账（CTO 裁 ③「防静默漏采」）：**有数据但不在注册表的 org**。
 * 口径 = org 条目数 + 行数（两者都给，避免"条目数 vs 行数"漂移）。
 */
export function findOrgsWithDataButNotRegistered(db: Database.Database): { orgIds: string[]; count: number } {
  try {
    const rows = db
      .prepare(
        `SELECT org_id, COUNT(*) AS n FROM ${DATA_TABLE}
         WHERE org_id NOT IN (SELECT org_id FROM orgs)
         GROUP BY org_id ORDER BY org_id`,
      )
      .all() as Array<{ org_id: string; n: number }>;
    return { orgIds: rows.map((r) => r.org_id), count: rows.reduce((s, r) => s + r.n, 0) };
  } catch (err: unknown) {
    log.debug(
      { err: err instanceof Error ? err.message : String(err) },
      '对账查询不可用（表缺失等）⇒ 空结果',
    );
    return { orgIds: [], count: 0 };
  }
}

/**
 * 通用编排（#1371，可测）：对注册表中**每个 active org** 顺序执行 `execute(orgId)`。
 * 语义：**无 active org ⇒ 一次都不执行**（fail-closed）；返回本轮执行过的 org 列表（确定性序）。
 */
export async function executeForActiveOrgs(
  db: Database.Database,
  execute: (orgId: string) => Promise<void>,
): Promise<string[]> {
  const orgs = listActiveOrgs(db);
  for (const orgId of orgs) {
    await execute(orgId);
  }
  return orgs;
}
