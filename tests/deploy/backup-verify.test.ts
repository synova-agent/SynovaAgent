/**
 * tests/deploy/backup-verify.test.ts — D50 备份验证 ＋ #1257 P0-6 备份快照一致（U-4）
 *
 * 判据：#1257 §3 U-4（两分支 `encryptBackups` false/true，**真 WAL**）——
 *   活库开 WAL ＋ `wal_autocheckpoint=0` 后写入不 checkpoint，`-wal` 里那行**必须**出现在备份里。
 *   旧实现用 `copyFileSync`/`readFileSync` 读活库 ⇒ 只拷主库 ⇒ 该行丢失（本文件即其拔线判据）。
 *
 * 契约（铁律 47）:
 *   @input  — `backupDatabase({dbPath, backupDir, maxBackups, encryptBackups, masterSecret?, salt?})`
 *             ＋ 既有 `verifyLocalBackup` / `probeRemotePack`（D50 用例原样保留）
 *   @output — 断言：备份库可读且含 WAL 行／`integrity_check = ok`／加密分支无明文临时件／
 *             失败分支旧备份字节不变／剪枝只数最终备份（临时件不占名额）
 *   @degraded — 无：测试失败即红（禁 skip 冒充通过；环境不满足 ⇒ 直接 throw）
 *   @error  — 无自定义错误类型
 *
 * 三态覆盖：正常（WAL 快照两分支）／降级（源库不可快照 ⇒ `ok:false` ＋ `code` ＋ `degraded`，旧备份不变）／
 *          边界（`maxBackups=2` 时不残留 `.tmp-backup-`、不误删最终备份；源库缺失）
 * 拔线（判别力）：把快照改回 `copyFileSync` ⇒ 备份库读不到 WAL 行 ⇒ 本文件红。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyLocalBackup } from '../../src/deploy/backup-verify';
import { backupDatabase } from '../../src/services/db-encryption';

/** 只在 WAL 里（未 checkpoint 进主库）的行 —— 快照一致性判据的唯一锚点 */
const WAL_ONLY_ROW = 'wal-only-row';
/** 加密分支测试密钥（与实现同口径：scrypt(masterSecret, salt + '-backup')） */
const MASTER_SECRET = 'test-master-secret';

/**
 * 建一个**真 WAL** 活库：WAL 模式 ＋ 禁自动 checkpoint ＋ 写一行后**保持连接不关闭**。
 * @param dir - 临时根目录
 * @returns 活库连接、库路径、`-wal` 路径
 */
function createWalDatabase(dir: string): { db: Database.Database; dbPath: string; walPath: string } {
  const dbPath = join(dir, 'live.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE probe_backup (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  db.prepare('INSERT INTO probe_backup (v) VALUES (?)').run(WAL_ONLY_ROW);
  return { db, dbPath, walPath: `${dbPath}-wal` };
}

/**
 * 把加密备份解回明文文件（密钥口径与 `encryptSnapshot` 一致）。
 * @param encryptedPath - 加密备份路径
 * @param masterSecret - 主密钥
 * @param salt - 盐（本实现用 `salt + '-backup'` 派生）
 * @param outPath - 解密输出路径
 * @returns outPath
 */
function decryptBackupToFile(encryptedPath: string, masterSecret: string, salt: string, outPath: string): string {
  const data = readFileSync(encryptedPath);
  const key = crypto.scryptSync(masterSecret, salt + '-backup', 32);
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  writeFileSync(outPath, Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
  return outPath;
}

/**
 * 读备份库：取 `probe_backup` 全部行 ＋ `integrity_check` ＋ `journal_mode`。
 * @param dbFile - 可被 SQLite 打开的备份文件
 * @returns 行数组与两条 pragma 值（`integrity_check` 期望 `'ok'`）
 */
function readBackup(dbFile: string): { rows: unknown[]; integrity: unknown; journalMode: unknown } {
  const db = new Database(dbFile, { readonly: true });
  try {
    return {
      rows: db.prepare('SELECT v FROM probe_backup ORDER BY id').all(),
      integrity: db.pragma('integrity_check', { simple: true }),
      journalMode: db.pragma('journal_mode', { simple: true }),
    };
  } finally {
    db.close();
  }
}

/** 备份目录里的**最终**备份（与实现剪枝同一前缀口径） */
function finalBackups(backupDir: string): string[] {
  return readdirSync(backupDir).filter(f => f.startsWith('synova-backup-'));
}

/** 备份目录里的**明文临时件**（必须恒空） */
function tempSnapshots(backupDir: string): string[] {
  return readdirSync(backupDir).filter(f => f.startsWith('.tmp-backup-'));
}

describe('D50: backup-verify', () => {
  it('verifyLocalBackup 对不存在包返回错误', async () => {
    const result = await verifyLocalBackup('/nonexistent/pack.synova-recovery', 'test');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('probeRemotePack 对不可达 URL 返回 reachable:false', async () => {
    const { probeRemotePack } = await import('../../src/deploy/backup-verify');
    const result = await probeRemotePack('http://localhost:1/nonexistent', '');
    expect(result.reachable).toBe(false);
  });
});

describe('#1257 U-4: backupDatabase 快照一致（真 WAL）', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'synova-backup-1257-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('encryptBackups:false —— WAL 未 checkpoint 的行进快照，integrity_check=ok', () => {
    const { db, dbPath, walPath } = createWalDatabase(root);
    try {
      const backupDir = join(root, 'backups');
      // 前提冻结：行确实还在 -wal 里（否则本用例无法区分"快照一致"与"碰巧已 checkpoint"）
      expect(statSync(walPath).size).toBeGreaterThan(0);

      const result = backupDatabase({ dbPath, backupDir, maxBackups: 7, encryptBackups: false });
      expect(result.ok).toBe(true);
      if (!result.ok || result.path === undefined) throw new Error('备份未产出文件（ok:true 但无 path）');

      const backup = readBackup(result.path);
      expect(backup.rows).toEqual([{ v: WAL_ONLY_ROW }]); // 🔴 拔线点：改回 copyFileSync ⇒ 此断言红
      expect(backup.integrity).toBe('ok');
      expect(backup.journalMode).toBe('delete'); // VACUUM INTO 产物是自包含库，不继承 WAL

      expect(tempSnapshots(backupDir)).toEqual([]); // 非加密分支：中间件已改名成最终备份
      expect(finalBackups(backupDir)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('encryptBackups:true —— 备份目录无明文临时件，解密后含 WAL 行且 integrity_check=ok', () => {
    const { db, dbPath, walPath } = createWalDatabase(root);
    const salt = dbPath;
    try {
      const backupDir = join(root, 'backups');
      expect(statSync(walPath).size).toBeGreaterThan(0);

      const result = backupDatabase({
        dbPath,
        backupDir,
        maxBackups: 7,
        encryptBackups: true,
        masterSecret: MASTER_SECRET,
        salt,
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.path === undefined) throw new Error('加密备份未产出文件（ok:true 但无 path）');

      // ① 备份目录内无明文临时件（加密分支：中间明文必须 delete 掉）
      expect(tempSnapshots(backupDir)).toEqual([]);
      // ② 产物不是明文 SQLite（头 16 字节应是 IV+authTag 的高熵字节，不是 "SQLite format 3"）
      expect(readFileSync(result.path).subarray(0, 16).toString('utf8')).not.toContain('SQLite format 3');

      // ③ 解密后读得到 WAL 行
      const plain = decryptBackupToFile(result.path, MASTER_SECRET, salt, join(root, 'decrypted.db'));
      const backup = readBackup(plain);
      expect(backup.rows).toEqual([{ v: WAL_ONLY_ROW }]);
      expect(backup.integrity).toBe('ok');
    } finally {
      db.close();
    }
  });

  it('maxBackups 只数最终备份 —— 临时件不占名额，目录无 .tmp-backup- 残留', () => {
    const { db, dbPath } = createWalDatabase(root);
    try {
      const backupDir = join(root, 'backups');
      mkdirSync(backupDir, { recursive: true });
      // 预置两个"旧"最终备份（2000 年 ⇒ 必然排在本次备份之前）
      const oldest = join(backupDir, 'synova-backup-2000-01-01T00-00-00-000Z.db');
      const middle = join(backupDir, 'synova-backup-2000-01-02T00-00-00-000Z.db');
      writeFileSync(oldest, 'old-backup-1');
      writeFileSync(middle, 'old-backup-2');

      const result = backupDatabase({
        dbPath,
        backupDir,
        maxBackups: 2,
        encryptBackups: true,
        masterSecret: MASTER_SECRET,
        salt: dbPath,
      });
      expect(result.ok).toBe(true);

      const finals = finalBackups(backupDir);
      expect(finals).toHaveLength(2); // 新备份 ＋ middle；若临时件被计入 ⇒ 这里会变 1（误删保真备份）
      expect(existsSync(oldest)).toBe(false); // 最旧被剪
      expect(existsSync(middle)).toBe(true);
      expect(tempSnapshots(backupDir)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('失败不覆盖旧备份 —— 源库不可快照 ⇒ ok:false ＋ code ＋ degraded，旧备份字节不变', () => {
    const backupDir = join(root, 'backups');
    mkdirSync(backupDir, { recursive: true });
    const existing = join(backupDir, 'synova-backup-2000-01-03T00-00-00-000Z.db');
    writeFileSync(existing, 'old-backup-bytes');

    // 源 = 非 SQLite 文件 ⇒ VACUUM INTO 必失败（真失败路径，不是 mock）
    const badDb = join(root, 'corrupt.db');
    writeFileSync(badDb, 'not a sqlite database');

    const result = backupDatabase({
      dbPath: badDb,
      backupDir,
      maxBackups: 7,
      encryptBackups: true,
      masterSecret: MASTER_SECRET,
      salt: badDb,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('BACKUP_SNAPSHOT_FAILED');
    expect(result.degraded).toBe(true);
    expect(result.error).toBeTruthy();

    // 旧备份原字节不变 ＋ 无临时明文残留
    expect(readFileSync(existing, 'utf8')).toBe('old-backup-bytes');
    expect(finalBackups(backupDir)).toHaveLength(1);
    expect(tempSnapshots(backupDir)).toEqual([]);
  });

  it('源库缺失 ⇒ BACKUP_DB_MISSING（显式降级，不抛错、不建目录内容）', () => {
    const backupDir = join(root, 'backups');
    const result = backupDatabase({
      dbPath: join(root, 'missing.db'),
      backupDir,
      maxBackups: 7,
      encryptBackups: false,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('BACKUP_DB_MISSING');
    expect(result.degraded).toBe(true);
    expect(existsSync(join(root, 'missing.db'))).toBe(false); // 绝不无中生有建库
  });
});
