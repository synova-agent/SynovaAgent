/**
 * agent/session-storage-service.ts — 会话存储装配服务 (L2)
 * @state: real
 *
 * D603 跨层修复（扫描报告 §三 簇4 存储簇）: SessionStore/SQLite 的「构造」从 L1
 * （routes/sessions、cli.ts、tui-v2/lib/bootstrap）移出到本 L2 服务。
 * L1 只消费本模块返回的实例/类型，不再静态依赖
 * better-sqlite3 / store/session-store / init/engine-context（铁律 39）。
 *
 * 契约（铁律 47）:
 *   @input  createSessionStorage(dbPath) — 独立进程（CLI/TUI）显式 dbPath 装配；
 *           createSystemSessionStore() — 复用 engine-context 全局 db 的兜底装配。
 *   @output SessionStorage{db, store} / SessionStore 实例。
 *   @degraded 无 — 本服务不做降级；构造失败原样抛出，异常语义与修复前 L1 直构逐字节一致
 *           （fail-closed 由调用方既有 catch 语义保留，如 auth.ts 内存 Map 降级）。
 *
 * L1→L2 ✅ | L2→L5(store/init) 装配职责 ✅（check-architecture 仅约束 L1 直触）
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { SessionStore, isSqliteDatabase } from '../store/session-store';
import { getDatabase } from '../init/engine-context';

// L1 类型出口 — L1 不再出现 store/session-store 路径（含 type-position）
export type { SessionStore } from '../store/session-store';

/** 独立进程存储装配结果 */
export interface SessionStorage {
  db: Database.Database;
  store: SessionStore;
}

/**
 * createSessionStorage — CLI / TUI 独立进程的存储装配。
 * 目录创建 + WAL pragma + SessionStore 构造，与修复前 cli.ts:69-73 /
 * tui-v2/lib/bootstrap.ts:120-124 的装配序列等价。
 */
export function createSessionStorage(dbPath: string): SessionStorage {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  const store = new SessionStore(db);
  return { db, store };
}

/**
 * createSystemSessionStore — 路由兜底装配（复用 engine-context 全局 db）。
 * 行为与修复前 routes 内 `new SessionStore(getDatabase())` 一致；
 * 生产路径优先消费 server.ts 注入的 app.locals.sessionStore（Bootstrap Phase 0 单例）。
 */
export function createSystemSessionStore(): SessionStore {
  return new SessionStore(getDatabase());
}

// ═══ #4 基线收紧（段B 未决项）: 补齐 D603 漏扫的两种 L1 形态 ═══
// D603 本已把 SessionStore **构造**移入 L2，但漏了这两条路径：
//   ① 路由**已持有** db 句柄（来自 `app.locals.orchestration.db`，即装配根 DI 注入的句柄）
//      ⇒ 需要「用给定句柄构造」的出口，而非 createSystemSessionStore()（那是全局 db）。
//      （漏扫文件：routes/conversations.ts / routes/diagnosis.ts ×4 —— L1→L5）
//   ② 存储层**谓词**（isSqliteDatabase / isDiagnosisReportArchive）此前仍需 L1 直接
//      `await import('../store/session-store')` 才能拿到 ⇒ L1→L5（铁律 39）。
// 处置：谓词与类型经本 L2 出口再导出，构造经 createSessionStoreFrom —— L1 侧零 L5 路径。

/** L1 谓词出口：SQLite 句柄窄化（D563） */
export { isSqliteDatabase } from '../store/session-store';
/** L1 谓词出口：诊断报告归档形状校验（诚实 404 用，铁律 24） */
export { isDiagnosisReportArchive } from '../store/session-store';

/**
 * createSessionStoreFrom — 用**调用方已持有的 db 句柄**装配 SessionStore。
 *
 * 契约（铁律 47）:
 *   @input  db: unknown —— L1 侧句柄类型各异（`app.locals.orchestration.db` 声明为 unknown、
 *           `SessionStoreLike.db?` 亦为 unknown）。**窄化在 L2 内部做**（复用 D563 谓词），
 *           ⇒ L1 无需写任何类型断言（铁律 38：as-any 家族零容忍）。
 *   @output SessionStore 实例。
 *   @degraded 无 —— 句柄合法时与修复前 L1 直构 `new SessionStore(db)` 行为逐字节一致；
 *           句柄非法时抛 `TypeError`（D563 谓词消息），与修复前「谓词失败 ⇒ 抛 TypeError」
 *           及「构造器对非法句柄抛错」**同走调用方既有 catch 降级通道**（不新增静默路径）。
 *   @error  原样传播（调用方既有 catch/log.warn 语义不变）。
 *
 * 🔴 与 `createSystemSessionStore()` 的区别：本函数**不取全局 db**，
 *    用于「句柄已由装配根注入、只是构造点错在 L1」的形态（D603 漏扫的那一类）。
 */
export function createSessionStoreFrom(db: unknown): SessionStore {
  if (!isSqliteDatabase(db)) {
    throw new TypeError('orchestration.db 非 SQLite 句柄（D563 谓词窄化失败）');
  }
  return new SessionStore(db);
}
