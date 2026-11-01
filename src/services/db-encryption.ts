/**
 * services/db-encryption.ts — SQLite 文件级加密 (P0-5.3) ＋ 定期备份（P2 / #1257 P0-6）
 *
 * 数据库文件在磁盘上以 AES-256-GCM 加密存储。
 * 启动时解密到临时文件 → 进程运行期间明文 → 关闭时重新加密。
 *
 * 约束: better-sqlite3 不支持原生加密。sqlcipher 需编译 native addon。
 * 此实现作为应用层加密——不修改任何 SQL 查询。
 *
 * 密钥派生: scrypt(masterSecret, salt) → 32-byte key
 * 加密: AES-256-GCM + random 12-byte IV + 16-byte auth tag
 *
 * 设计哲学（一句）: **快照归 SQLite、加密归应用层** ——
 *   备份先用 `VACUUM INTO` 让 SQLite 产**事务一致快照**（含 WAL 已提交行），再对快照整文件做 AES-256-GCM；
 *   本文件的备份路径**从不读活库字节**（#1257 P0-6 根因：`copyFileSync`/`readFileSync` 活库会漏 WAL）。
 *
 * 契约（铁律 47）:
 *   @input  — `backupDatabase(config: BackupConfig)`：`dbPath`（活库，可带 `-wal`/`-shm`）／
 *             `backupDir`（不存在则递归创建）／`maxBackups`（只数最终备份）／
 *             `encryptBackups` ＋ `masterSecret` ＋ `salt`（生产走加密分支）。
 *             其余导出（encrypt/decrypt/isDatabaseEncrypted/autoDecryptOnStartup/autoEncryptOnShutdown）契约不变。
 *   @output — **同步** `BackupResult`：`{ok:true, path}` 或 `{ok:false, code, error, degraded:true}`。
 *             🔴 签名保持**同步**（调用方 `src/deploy/bootstrap.ts:1301-1310` 同步取返回值，禁改 async）。
 *   @degraded — 不静默：任一失败路径都 `log.warn/error({code, degraded:true})` 并带 `code` 返回，
 *             且**不覆盖旧备份**、**不留临时明文**（try/finally 删除）；`encryptBackups:true` 但缺
 *             `masterSecret`/`salt` ⇒ 直接失败（**禁**静默回落明文备份）。
 *   @authority — 生产唯一调用方 = `src/deploy/bootstrap.ts` 的 cron `db-backup`（`0 3 * * *`）；
 *             测试 = `tests/deploy/backup-verify.test.ts`。其它模块不得复制备份面。
 *   @error  — typed error 带 `code`（铁律 32，经 `BackupResult.code` 传出，**不 throw 出函数**）：
 *             `BACKUP_DB_MISSING`（源库不存在）／`BACKUP_SNAPSHOT_FAILED`（`VACUUM INTO` 失败，
 *             `SQLITE_BUSY`/`SQLITE_LOCKED` ⇒ retryable）／`BACKUP_INTEGRITY_FAILED`（快照 `integrity_check` ≠ ok）／
 *             `BACKUP_ENCRYPT_FAILED`（密钥缺失或加密失败）／`BACKUP_IO_FAILED`（目录/剪枝/落盘 IO）。
 *             内部 `BackupError extends DiagnosticAgentError`（phase=0），只在函数内抛出，由防线边界收敛成 `code`。
 *   @not-here — 不加密活库（生命周期仍归 encryptDatabase/autoEncryptOnShutdown）／不做异步调度／
 *             不迁移源库 `journal_mode`（存储层与配置决定）／不校验调用方密钥来源。
 *
 * Source map（本文件内）:
 *   | 导出 | 角色 |
 *   |---|---|
 *   | `backupDatabase()` | 备份：快照 → 校验 →（加密）→ 剪枝 |
 *   | `encryptDatabase()` / `decryptDatabase()` | 活库加密/解密（本批不改） |
 *   | `isDatabaseEncrypted()` / `autoDecryptOnStartup()` / `autoEncryptOnShutdown()` | 启动/关闭钩子（本批不改） |
 *   内部：`snapshotDatabase()`（`VACUUM INTO` 单语句快照）／`assertSnapshotIntegrity()`（**加密前**校验）／
 *         `encryptSnapshot()`（快照整文件加密）／`pruneBackups()`（只数最终备份）／
 *         `removeSnapshotQuietly()`（临时明文清理，失败告警）／`BackupError`（本批唯一 typed 错误）。
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **L1 · 备份同步阻塞**：`VACUUM INTO` 在调用线程整库复制，大库期间事件循环被占（签名同步是调用方契约，
 *         改异步须先改 `src/deploy/bootstrap.ts`，不在本批写集）。
 *   · **L2 · 加密分支整文件进内存**：快照与密文各占一份 Buffer（与改造前同形，不在本批优化）。
 *   · **L3 · 同名临时件只可能来自崩溃**：临时名由**同一时间戳**派生（复用既有唯一时钟直取，棘轮冻结 0/1）；
 *         上次进程在 `finally` 前崩溃且下次同毫秒窗口调用才会撞名，届时先清理再快照（跨进程同时备份无锁）。
 *   · **L4 · `VACUUM INTO` 要求输出文件不存在**：残留件先 unlink；unlink 失败 ⇒ `BACKUP_IO_FAILED`（fail loud）。
 *   · **L5 · 只读连接依赖 `-shm` 可写**：WAL 库若 `-shm` 不存在且目录只读，只读连接可能失败
 *         ⇒ `BACKUP_SNAPSHOT_FAILED`（生产同进程持有写连接，`-shm` 在）。
 *   · **L6 · `maxBackups` 按文件名排序**（`synova-backup-<ISO 时间戳>.db`）：同毫秒两次备份会同名覆盖，
 *         正常 cron 每日一次不受影响。
 *   · **L7 · `integrity_check` 只证页结构一致**，不证业务语义完整性（本批不扩备份验证面）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { DiagnosticAgentError } from '@synova/error-types';
import { createLogger } from '@synova/logger';

const log = createLogger('services/db-encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** 最终备份文件名前缀（剪枝**只数**这个前缀 ⇒ 临时件不占 `maxBackups` 名额） */
const BACKUP_FILE_PREFIX = 'synova-backup-';

/** 中间快照（**明文**）文件名前缀：**必须**不同于 `synova-backup-`，否则剪枝会把明文当备份数 */
const BACKUP_TEMP_PREFIX = '.tmp-backup-';

export interface EncryptionConfig {
  masterSecret: string;
  salt: string;
  dbPath: string;
}

/**
 * Derive a 256-bit encryption key from master secret + salt.
 */
function deriveKey(masterSecret: string, salt: string): Buffer {
  return crypto.scryptSync(masterSecret, salt, KEY_LENGTH);
}

/**
 * Encrypt a database file.
 * Reads plaintext → encrypts → writes ciphertext → removes plaintext.
 * Output format: [IV:12 bytes][authTag:16 bytes][ciphertext]
 */
export function encryptDatabase(config: EncryptionConfig): boolean {
  const { masterSecret, salt, dbPath } = config;
  if (!fs.existsSync(dbPath)) {
    log.warn({ path: dbPath }, '数据库文件不存在 — 跳过加密');
    return false;
  }

  try {
    const key = deriveKey(masterSecret, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    const plaintext = fs.readFileSync(dbPath);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Write: IV + authTag + ciphertext
    const output = Buffer.concat([iv, authTag, encrypted]);
    const encryptedPath = dbPath + '.enc';
    fs.writeFileSync(encryptedPath, output);

    // Atomically replace plaintext with encrypted version
    fs.renameSync(encryptedPath, dbPath);

    log.info({ path: dbPath, size: plaintext.length }, '数据库已加密');
    return true;
  } catch (err: any) {
    log.error({ err, path: dbPath }, '数据库加密失败');
    return false;
  }
}

/**
 * Decrypt a database file.
 * Reads ciphertext → decrypts → writes plaintext → original is overwritten.
 * Returns false if file is not encrypted (plaintext already).
 */
export function decryptDatabase(config: EncryptionConfig): boolean {
  const { masterSecret, salt, dbPath } = config;
  if (!fs.existsSync(dbPath)) return false;

  try {
    const data = fs.readFileSync(dbPath);
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      // File too short to be encrypted — assume plaintext
      return false;
    }

    const key = deriveKey(masterSecret, salt);
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Write plaintext back (in-place)
    fs.writeFileSync(dbPath, decrypted);

    log.info({ path: dbPath, size: decrypted.length }, '数据库已解密');
    return true;
  } catch (err: any) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "Write plaintext back (in-place)");
    // Decryption failure — file may already be plaintext or is corrupted
    if (err.message?.includes('unsupported state') || err.message?.includes('authentication')) {
      log.warn({ path: dbPath }, '数据库解密失败 — 可能已是明文或密钥不匹配');
      return false;
    }
    log.error({ err, path: dbPath }, '数据库解密异常');
    return false;
  }
}

/**
 * Check if a database file appears to be encrypted.
 * Encrypted files have a recognizable IV + authTag prefix structure
 * with high-entropy content (not ASCII SQL).
 */
export function isDatabaseEncrypted(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  try {
    const header = fs.readFileSync(dbPath).subarray(0, 100);
    // SQLite databases start with "SQLite format 3\0"
    const isSQLite = header.toString('utf8', 0, 16).startsWith('SQLite format 3');
    if (isSQLite) return false; // Plaintext SQLite

    // Encrypted data is high-entropy — not ASCII
    const asciiCount = [...header].filter(b => b >= 0x20 && b <= 0x7e).length;
    return asciiCount < header.length * 0.5;
  } catch (err) {
    log.error({ err }, '数据库加密检测失败');
    return false;
  }
}

/**
 * Auto-detect and decrypt on startup. Returns whether decryption was performed.
 */
export function autoDecryptOnStartup(config: EncryptionConfig): boolean {
  if (isDatabaseEncrypted(config.dbPath)) {
    return decryptDatabase(config);
  }
  return false;
}

/**
 * Encrypt database on graceful shutdown. Should be called in SIGTERM handler.
 */
export function autoEncryptOnShutdown(config: EncryptionConfig): boolean {
  // Only encrypt if db exists and is plaintext
  if (isDatabaseEncrypted(config.dbPath)) return false;
  return encryptDatabase(config);
}

// ═══ P2: SQLite 定期备份 ═══

export interface BackupConfig {
  dbPath: string;
  backupDir: string;
  maxBackups: number;
  encryptBackups: boolean;
  masterSecret?: string;
  salt?: string;
}

/** 备份失败码（铁律 32：调用方按 `code` 路由，**禁解析 message**） */
export type BackupErrorCode =
  | 'BACKUP_DB_MISSING'
  | 'BACKUP_SNAPSHOT_FAILED'
  | 'BACKUP_INTEGRITY_FAILED'
  | 'BACKUP_ENCRYPT_FAILED'
  | 'BACKUP_IO_FAILED';

/**
 * 备份结果（**同步**返回；字段只增不减 —— 调用方 `bootstrap.ts` 只读 `ok/path/error`）。
 */
export interface BackupResult {
  ok: boolean;
  path?: string;
  error?: string;
  /** 失败码（`ok:true` 时不出现） */
  code?: BackupErrorCode;
  /** 失败一律 `true`（铁律 11：显式降级，不静默） */
  degraded?: boolean;
}

/**
 * 备份面唯一 typed 错误（铁律 32）：只在 `backupDatabase` 内部抛出，
 * 由该函数边界收敛成 `BackupResult.code`（**不把异常抛给同步 cron 调用方**）。
 */
class BackupError extends DiagnosticAgentError {
  declare readonly code: BackupErrorCode;

  /**
   * @param code - 备份失败码（见 `BackupErrorCode`）
   * @param message - 人读消息（只用于日志/展示，禁作路由依据）
   * @param retryable - `SQLITE_BUSY`/`SQLITE_LOCKED` 等瞬时失败为 `true`
   */
  constructor(code: BackupErrorCode, message: string, retryable: boolean) {
    super(code, message, 0, retryable);
    this.name = 'BackupError';
  }
}

/** 取异常的人读消息（`unknown` 收窄，禁断言）。 */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 读取异常对象上的 `code` 字段（无则 `undefined`；不做类型断言）。 */
function errorCodeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = Reflect.get(err, 'code');
  return typeof code === 'string' ? code : undefined;
}

/** SQLite 忙/锁 ⇒ 可重试（其它失败按不可重试上报，避免 cron 无限重撞）。 */
function isRetryableSqliteFailure(err: unknown): boolean {
  const text = `${errorCodeOf(err) ?? ''} ${messageOf(err)}`;
  return text.includes('SQLITE_BUSY') || text.includes('SQLITE_LOCKED');
}

/** 从任意异常取备份失败码：内部 typed 错误原样透出，其余折 `BACKUP_IO_FAILED`。 */
function codeOfBackupError(err: unknown): BackupErrorCode {
  return err instanceof BackupError ? err.code : 'BACKUP_IO_FAILED';
}

/**
 * 用 `VACUUM INTO` 产**事务一致快照**（含活库 `-wal` 里已提交但未 checkpoint 的事务）。
 *
 * 设计：只读连接（`readonly:true`）只读源库页；`VACUUM INTO` 是单条同步语句，输出文件必须不存在。
 * @param dbPath - 活库路径（不被修改）
 * @param snapshotPath - 输出快照路径（**必须不存在**）
 * @throws BackupError code=`BACKUP_SNAPSHOT_FAILED`（`SQLITE_BUSY`/`SQLITE_LOCKED` ⇒ retryable）
 */
function snapshotDatabase(dbPath: string, snapshotPath: string): void {
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    // 🔴 exec() 不支持参数绑定（实测 `SQLITE_ERROR: non-text filename`）⇒ 必须 prepare + bind
    db.prepare('VACUUM INTO ?').run(snapshotPath);
  } catch (err: unknown) {
    throw new BackupError(
      'BACKUP_SNAPSHOT_FAILED',
      `快照失败（VACUUM INTO）：${messageOf(err)}`,
      isRetryableSqliteFailure(err),
    );
  } finally {
    db?.close();
  }
}

/**
 * 对**中间快照**跑 `PRAGMA integrity_check`（**加密前**；失败即中止，不覆盖旧备份）。
 * @param snapshotPath - 中间快照路径
 * @throws BackupError code=`BACKUP_INTEGRITY_FAILED`
 */
function assertSnapshotIntegrity(snapshotPath: string): void {
  let db: Database.Database | undefined;
  try {
    db = new Database(snapshotPath, { readonly: true });
    const verdict = db.pragma('integrity_check', { simple: true });
    if (verdict !== 'ok') {
      throw new BackupError('BACKUP_INTEGRITY_FAILED', `快照 integrity_check 未通过：${String(verdict)}`, false);
    }
  } catch (err: unknown) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('BACKUP_INTEGRITY_FAILED', `快照校验无法执行：${messageOf(err)}`, false);
  } finally {
    db?.close();
  }
}

/**
 * 把**中间快照**整文件读入并 AES-256-GCM 加密，落最终备份名（与改造前加密格式一致：
 * `[IV:12][authTag:16][ciphertext]`，密钥 = `scrypt(masterSecret, salt + '-backup')`）。
 * @throws BackupError code=`BACKUP_ENCRYPT_FAILED`
 */
function encryptSnapshot(snapshotPath: string, backupPath: string, masterSecret: string, salt: string): void {
  try {
    const key = crypto.scryptSync(masterSecret, salt + '-backup', 32);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const plaintext = fs.readFileSync(snapshotPath); // 🔴 读的是**快照**，不是活库
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    fs.writeFileSync(backupPath, Buffer.concat([iv, authTag, encrypted]));
  } catch (err: unknown) {
    throw new BackupError('BACKUP_ENCRYPT_FAILED', `快照加密失败：${messageOf(err)}`, false);
  }
}

/**
 * 剪枝：**只数** `synova-backup-` 前缀的最终备份，按文件名（ISO 时间戳）升序删最旧。
 * 临时件前缀 `.tmp-backup-` 不同 ⇒ **天然不占 `maxBackups` 名额**（#1257 P0-6 根因之二）。
 */
function pruneBackups(backupDir: string, maxBackups: number): void {
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(BACKUP_FILE_PREFIX))
    .sort();
  while (files.length > maxBackups) {
    const victim = files.shift();
    if (victim === undefined) break;
    fs.unlinkSync(path.join(backupDir, victim));
  }
}

/** 尽力删除临时明文（`try/finally` 的最后一道）；删不掉只告警（不掩盖主错误，铁律 11 不静默）。 */
function removeSnapshotQuietly(snapshotPath: string): void {
  try {
    fs.unlinkSync(snapshotPath);
  } catch (err: unknown) {
    if (errorCodeOf(err) === 'ENOENT') return; // 从未生成 / 已被 rename 成最终备份
    log.warn(
      { snapshotPath, err: messageOf(err), degraded: true },
      '备份临时明文删除失败 — 需人工清理（备份目录内可能残留全库明文）',
    );
  }
}

/**
 * 前置失败的唯一构造点：**必带 `code` ＋ `degraded:true` ＋ 告警日志**（铁律 11/24/31，不静默）。
 */
function backupPreconditionFailure(code: BackupErrorCode, message: string): BackupResult {
  log.warn({ code, err: message, degraded: true }, '数据库备份未执行 — 前置检查未通过');
  return { ok: false, code, error: message, degraded: true };
}

/**
 * Create a timestamped backup of the database file.
 * If encryptBackups=true, backup is AES-256-GCM encrypted.
 * Old backups beyond maxBackups are pruned.
 *
 * 流程（顺序是判据的一部分）：存在性检查 → 目录 → 同步快照（VACUUM INTO）→ 快照完整性 →
 * 加密或改名落最终备份 → 剪枝；临时明文在 `finally` 必删。
 * @param config - 备份参数（见 `BackupConfig`）
 * @returns `{ok:true, path}` 或 `{ok:false, code, error, degraded:true}`；**不抛错**（同步调用方契约）
 */
export function backupDatabase(config: BackupConfig): BackupResult {
  let snapshotPath: string | undefined;
  try {
    if (!fs.existsSync(config.dbPath)) {
      return backupPreconditionFailure('BACKUP_DB_MISSING', '数据库文件不存在');
    }

    // Ensure backup dir exists
    if (!fs.existsSync(config.backupDir)) {
      fs.mkdirSync(config.backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(config.backupDir, `${BACKUP_FILE_PREFIX}${timestamp}.db`);
    snapshotPath = path.join(config.backupDir, `${BACKUP_TEMP_PREFIX}${timestamp}.db`);

    // VACUUM INTO 要求输出文件不存在 ⇒ 同名残留只可能来自上次崩溃：先清掉（失败即 fail loud）
    if (fs.existsSync(snapshotPath)) {
      log.warn({ snapshotPath, degraded: true }, '清理上次中断残留的备份临时件');
      fs.unlinkSync(snapshotPath);
    }

    snapshotDatabase(config.dbPath, snapshotPath);
    assertSnapshotIntegrity(snapshotPath);

    if (config.encryptBackups && config.masterSecret && config.salt) {
      encryptSnapshot(snapshotPath, backupPath, config.masterSecret, config.salt);
    } else if (config.encryptBackups) {
      // 🔴 生产走加密分支：缺密钥 ⇒ 失败，**绝不**静默回落明文备份（否则全库明文留在备份目录）
      throw new BackupError('BACKUP_ENCRYPT_FAILED', 'encryptBackups=true 但 masterSecret/salt 缺失 — 拒绝明文备份', false);
    } else {
      // 非加密分支：快照直接落最终备份名（同分区 rename，不复制字节）
      fs.renameSync(snapshotPath, backupPath);
      snapshotPath = undefined; // 已改名成最终备份，finally 不再删
    }

    pruneBackups(config.backupDir, config.maxBackups);

    return { ok: true, path: backupPath };
  } catch (err: unknown) {
    const code = codeOfBackupError(err);
    const message = messageOf(err);
    log.error({ code, err: message, degraded: true }, '数据库备份失败 — 旧备份保持不变');
    return { ok: false, code, error: message, degraded: true };
  } finally {
    if (snapshotPath !== undefined) {
      removeSnapshotQuietly(snapshotPath);
    }
  }
}

