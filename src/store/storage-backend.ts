/**
 * store/storage-backend.ts — 可替换存储后端 (Slice 2.2)
 *
 * 定义 StorageBackend 接口，支持 memory（开发/测试）和 sqlite（生产）。
 * 替换 engine-context 的硬编码内存模式。
 *
 * Iron law #31: 所有操作返回 {value, degraded} 标记。
 */
import Database from 'better-sqlite3';
import { createLogger } from '@synova/logger';

const log = createLogger('store/storage-backend'); // # quality-exempt: 964 declared-only（生产接线另立卡） 2026-12-31

// ═══ Types ═══

/** Storage entry */
export interface StorageEntry {
  key: string;
  value: string;
  namespace: string;
  updatedAt: string;
}

/** Result with degraded signal */
export interface StorageResult<T> {
  value: T;
  degraded: boolean;
  reason?: string;
}

/** Query filter */
export interface StorageQuery {
  namespace?: string;
  keyPrefix?: string;
  limit?: number;
}

// ═══ Interface ═══

/**
 * Pluggable storage backend.
 *
 * engine-core's EngineContext.storage is typed against this interface.
 * Switch between MemoryStorageBackend (dev/test) and SqliteStorageBackend (prod).
 */
export interface StorageBackend {
  /** Get a single value by key */
  get(key: string, namespace?: string): Promise<StorageResult<string | null>>;

  /** Set a key-value pair */
  set(key: string, value: string, namespace?: string): Promise<StorageResult<void>>;

  /** Delete a key */
  delete(key: string, namespace?: string): Promise<StorageResult<boolean>>;

  /** Query entries by namespace / key prefix */
  query(filter: StorageQuery): Promise<StorageResult<StorageEntry[]>>;

  /** Check if backend is healthy */
  healthCheck(): Promise<{ healthy: boolean; error?: string }>;

  /**
   * 能力面声明（可选）：省略 = 未声明 ⇒ `requireStorageCapability` 抛 `STORAGE_CAPABILITY_UNDECLARED`。
   * #964 Q-15 declared-only（生产接线另立卡）。
   */
  capabilities?: ReadonlySet<StorageCapability>;
}

// ═══ Capability surface（#964 Q-15 · declared-only） ═══
// 已知限制：本批只做「声明 + 可解析」，生产消费者 = 0（接线/分层重构另立卡，登记在
//          tests/contract/conformance/registry.ts 的 planned）；能力面是静态声明集合，
//          运行期动态注册能力不在本批契约内。

/** 能力词表（唯一真源；禁第二处手写联合） */
export const STORAGE_CAPABILITIES = [
  'kv',
  'prefix-query',
  'limit-query',
  'health',
  'transactions',
] as const;

export type StorageCapability = (typeof STORAGE_CAPABILITIES)[number];

/** 能力解析错误码（机器可判：调用方按 code 分流，不解析 message） */
export type StorageCapabilityErrorCode =
  | 'STORAGE_CAPABILITY_UNSUPPORTED'
  | 'STORAGE_CAPABILITY_UNDECLARED';

/**
 * 能力解析错误：缺能力/未声明一律 throw（**不是** `{degraded:true}` 返回值）。
 *
 * 与 DSH `storage/backend.ts`「resolution fails loud」同口径；
 * `StorageBackend` 既有 5 方法 I/O 失败折 degraded（铁律 31）的语义不受本类影响。
 */
export class StorageCapabilityError extends Error {
  readonly code: StorageCapabilityErrorCode;
  readonly capability: StorageCapability;
  readonly phase: 'resolve';
  readonly retryable = false;

  /**
   * @param message - 人类可读失败点（含 code 与 capability）
   * @param code - 机器可判错误码（UNSUPPORTED／UNDECLARED）
   * @param capability - 被解析的能力值（回填到错误上，供调用方兜底）
   */
  constructor(message: string, code: StorageCapabilityErrorCode, capability: StorageCapability) {
    super(message);
    this.name = 'StorageCapabilityError';
    this.code = code;
    this.capability = capability;
    this.phase = 'resolve';
  }
}

/**
 * 解析 backend 的能力面：具备 ⇒ true；未声明／已声明但缺失 ⇒ 抛 typed error（可开关降级）。
 *
 * @input  backend — 任一 StorageBackend；capability — 能力枚举值
 * @output true = 已声明且具备（可安全调用该能力）
 * @throws StorageCapabilityError —— 未声明（UNDECLARED）／已声明但缺失（UNSUPPORTED）
 * @degraded 开关 SYNO_STORAGE_CAP_STRICT=0 ⇒ 不抛：log.warn({degraded:true, code, capability}) ＋ 返回 false
 * @exit   不退出
 */
export function requireStorageCapability(
  backend: StorageBackend,
  capability: StorageCapability,
): boolean {
  const declared = backend.capabilities;
  if (declared === undefined) {
    return resolveMissingCapability('STORAGE_CAPABILITY_UNDECLARED', capability);
  }
  if (!declared.has(capability)) {
    return resolveMissingCapability('STORAGE_CAPABILITY_UNSUPPORTED', capability);
  }
  return true;
}

/**
 * 缺能力的单一出口：严格模式抛 typed error；开关 `='0'` ⇒ degraded 日志 + false（不抛）。
 *
 * @input  code — 机器可判错误码；capability — 被解析的能力值
 * @output false（仅降级路径可达；严格路径抛错不返回）
 * @throws StorageCapabilityError —— 开关未设／非 '0'（只认 '0'）
 * @degraded SYNO_STORAGE_CAP_STRICT='0' ⇒ log.warn({degraded:true, …}) ＋ 返回 false
 * @exit   不退出
 */
function resolveMissingCapability(
  code: StorageCapabilityErrorCode,
  capability: StorageCapability,
): boolean {
  if (process.env.SYNO_STORAGE_CAP_STRICT === '0') {
    log.warn(
      {
        degraded: true,
        component: 'store/storage-backend',
        code,
        capability,
        phase: 'resolve',
        retryable: false,
      },
      `存储能力缺失已降级（SYNO_STORAGE_CAP_STRICT=0）：${code} capability=${capability}`,
    );
    return false;
  }
  const reason =
    code === 'STORAGE_CAPABILITY_UNDECLARED'
      ? '未声明能力面（backend.capabilities === undefined）'
      : '已声明能力面但不含该能力';
  throw new StorageCapabilityError(
    `${code}: ${reason} —— capability='${capability}'`,
    code,
    capability,
  );
}

// ═══ Memory Backend (dev/test) ═══

/**
 * In-memory storage backend for development and testing.
 * Data is lost on process exit — no persistence.
 */
export class MemoryStorageBackend implements StorageBackend {
  readonly capabilities: ReadonlySet<StorageCapability> = new Set(['kv', 'prefix-query', 'limit-query', 'health']);

  private store = new Map<string, StorageEntry>();

  private makeKey(key: string, namespace = 'default'): string {
    return `${namespace}:${key}`;
  }

  async get(key: string, namespace?: string): Promise<StorageResult<string | null>> {
    const entry = this.store.get(this.makeKey(key, namespace));
    return { value: entry?.value ?? null, degraded: false };
  }

  async set(key: string, value: string, namespace?: string): Promise<StorageResult<void>> {
    const fullKey = this.makeKey(key, namespace);
    this.store.set(fullKey, {
      key,
      value,
      namespace: namespace || 'default',
      updatedAt: new Date().toISOString(),
    });
    return { value: undefined, degraded: false };
  }

  async delete(key: string, namespace?: string): Promise<StorageResult<boolean>> {
    const existed = this.store.delete(this.makeKey(key, namespace));
    return { value: existed, degraded: false };
  }

  async query(filter: StorageQuery): Promise<StorageResult<StorageEntry[]>> {
    let entries = [...this.store.values()];
    if (filter.namespace) entries = entries.filter(e => e.namespace === filter.namespace);
    if (filter.keyPrefix) entries = entries.filter(e => e.key.startsWith(filter.keyPrefix!));
    if (filter.limit) entries = entries.slice(0, filter.limit);
    return { value: entries, degraded: false };
  }

  async healthCheck(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
}

// ═══ SQLite Backend (production) ═══

/**
 * SQLite-persisted storage backend for production.
 *
 * Uses a simple key-value table, suitable for engine-context
 * global state, feature flags, and small serialized objects.
 * NOT for large binary blobs — use GraphStore for ontology data.
 */
export class SqliteStorageBackend implements StorageBackend {
  readonly capabilities: ReadonlySet<StorageCapability> = new Set(['kv', 'prefix-query', 'limit-query', 'health']);

  private db: Database.Database;
  private degraded = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage_kv (
        full_key TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        namespace TEXT NOT NULL DEFAULT 'default',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_storage_namespace ON storage_kv(namespace);
    `);
  }

  async get(key: string, namespace?: string): Promise<StorageResult<string | null>> {
    try {
      const row = this.db
        .prepare('SELECT value FROM storage_kv WHERE full_key = ?')
        .get(this.makeKey(key, namespace)) as { value: string } | undefined;
      return { value: row?.value ?? null, degraded: this.degraded };
    } catch (err: any) {
      log.warn({ err, key, namespace }, 'StorageBackend.get 失败');
      return { value: null, degraded: true, reason: err.message };
    }
  }

  async set(key: string, value: string, namespace?: string): Promise<StorageResult<void>> {
    try {
      const fullKey = this.makeKey(key, namespace);
      this.db
        .prepare(
          `INSERT OR REPLACE INTO storage_kv (full_key, key, value, namespace, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
        )
        .run(fullKey, key, value, namespace || 'default');
      return { value: undefined, degraded: this.degraded };
    } catch (err: any) {
      log.warn({ err, key, namespace }, 'StorageBackend.set 失败');
      return { value: undefined, degraded: true, reason: err.message };
    }
  }

  async delete(key: string, namespace?: string): Promise<StorageResult<boolean>> {
    try {
      const result = this.db
        .prepare('DELETE FROM storage_kv WHERE full_key = ?')
        .run(this.makeKey(key, namespace));
      return { value: result.changes > 0, degraded: this.degraded };
    } catch (err: any) {
      log.warn({ err, key, namespace }, 'StorageBackend.delete 失败');
      return { value: false, degraded: true, reason: err.message };
    }
  }

  async query(filter: StorageQuery): Promise<StorageResult<StorageEntry[]>> {
    try {
      let sql = 'SELECT key, value, namespace, updated_at AS updatedAt FROM storage_kv WHERE 1=1';
      const params: unknown[] = [];
      if (filter.namespace) {
        sql += ' AND namespace = ?';
        params.push(filter.namespace);
      }
      if (filter.keyPrefix) {
        sql += ' AND key LIKE ?';
        params.push(`${filter.keyPrefix}%`);
      }
      sql += ' ORDER BY updated_at DESC';
      if (filter.limit) {
        sql += ' LIMIT ?';
        params.push(filter.limit);
      }
      const rows = this.db.prepare(sql).all(...params) as StorageEntry[];
      return { value: rows, degraded: this.degraded };
    } catch (err: any) {
      log.warn({ err, filter }, 'StorageBackend.query 失败');
      return { value: [], degraded: true, reason: err.message };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      this.db.prepare('SELECT 1 FROM storage_kv LIMIT 0').run();
      return { healthy: true };
    } catch (err: any) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "数据库操作失败");
      return { healthy: false, error: err.message };
    }
  }

  private makeKey(key: string, namespace = 'default'): string {
    return `${namespace}:${key}`;
  }
}
