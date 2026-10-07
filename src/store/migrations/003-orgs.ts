/**
 * src/store/migrations/003-orgs.ts — 租户注册表 `orgs`（#1371）
 *
 * 依据：CTO 2026-10-08 架构面裁定（**schema 归 CTO，逐字实施**）：
 *   · 「系统里只有『逐请求的身份声明』（JWT claim orgId），**没有『租户集合』这个概念** ⇒
 *      cron（无请求）本质上无法知道要给哪些 org 落数据 ⇒ **本表 = 补一个缺失的真源**」
 *   · 载体 = **表**（不是配置文件）：需运行时可查 + 可审计（配置文件查不到「谁改的、何时改的」）
 *   · 权威写入方 = **建档/开通流程**；**cron 只读**（不得自造/自扩）
 *   · 与 JWT **不做强校验**（`orgId` 不必须 ∈ 本表；强校验 ⇒ 漏一行 = 该租户全挂）；
 *     但**必须能对账**「哪些 org 有数据但不在注册表」（见 `src/sentinel/org-registry.ts`）
 *
 * 契约（铁律 47）:
 *   @input    — better-sqlite3 Database（全新库或既有库）
 *   @output   — void；库内含 `orgs`（6 列）+ 1 索引（幂等：`IF NOT EXISTS`）
 *   @degraded — 无（纯 DDL，不触网络/文件；表已存在 ⇒ no-op）
 *   @invariant— 🔴 `CHECK (org_id <> 'default')`：**`'default'` 是回落值，不是租户** ⇒ 结构上禁入
 *                （封死 #1322「绝不回落全局」那一族）；`status ∈ {active,suspended,closed}`（cron 只跑 active）；
 *                `source ∈ {provisioning,manual,migration}` NOT NULL（可审计"租户怎么进来的"）
 *   @not-here — 不建业务主表关系：**不做外键/不做级联**（它只是"租户清单"，引用它只用于**枚举**）；
 *                建档写入方（开通流程）不在本卡；cron **只读**
 *
 * 铁律 39（L5 存储层，仅依赖 better-sqlite3 类型）/ 38（零不安全断言）
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../schema-migration';

/** CTO 2026-10-08 给定的 DDL（逐字；改动须经 CTO 批） */
const ORGS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS orgs (
  org_id       TEXT PRIMARY KEY,
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','suspended','closed')),
  source       TEXT NOT NULL
               CHECK (source IN ('provisioning','manual','migration')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (org_id <> 'default')
)`;

/** 1 个索引（`status` 过滤面：cron 只跑 active） */
const ORGS_INDEX_DDL =
  `CREATE INDEX IF NOT EXISTS ix_orgs_status ON orgs(status)`;

/**
 * 迁移 003：建 `orgs` 表 + 1 索引（幂等）。
 * 失败：任一 DDL 抛错即向上抛 ⇒ `reconcileSchema` 阻断启动（fail-closed，同 001/002 先例）。
 */
export const orgsMigration: Migration = {
  version: 4,
  name: 'orgs',
  up: (db: Database.Database): void => {
    db.exec(ORGS_TABLE_DDL);
    db.exec(ORGS_INDEX_DDL);
  },
};
