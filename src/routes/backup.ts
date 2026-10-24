/**
 * src/routes/backup.ts — 备份 API 路由 (D50, L1)
 *
 * 端点:
 *   POST /api/backup/create    — 手动触发备份
 *   GET  /api/backup/status     — 查询备份状态
 *   POST /api/backup/restore    — 从恢复包恢复(需GA角色)
 *   POST /api/backup/verify     — 验证指定恢复包
 */
import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import { createLogger } from '@synova/logger';
import { RecoveryPackBuilder } from '../deploy/recovery-pack';
import { BackupScheduler } from '../deploy/backup-scheduler';
import { verifyLocalBackup } from '../deploy/backup-verify';

const log = createLogger('routes/backup');
const router = Router();

// 调度器单例
let scheduler: BackupScheduler | null = null;

function getScheduler(): BackupScheduler {
  if (!scheduler) {
    scheduler = new BackupScheduler();
  }
  return scheduler;
}

// ─── 管理员权限保护 ───

/**
 * 检查请求是否来自 GA 管理员。
 * 简化版权限检查 — 实际接入 PolicyEngine(D38) 后可替换。
 */
function requireAdmin(req: Request, res: Response): boolean {
  // 检查 JWT 中的角色 —— **保持 base 行为**（`req.user` 这条分支历史上不可达：jwtAuthMiddleware
  //   注入的是 `req.auth` 而非 `req.user`）。本 PR 严格只做 fail-closed，
  //   「是否开放 JWT 角色通道」属另卡决策 ⇒ 此处不顺手改。
  const user = (req as unknown as Record<string, unknown>).user as Record<string, unknown> | undefined;
  if (user && (user.role === 'ga' || user.role === 'admin')) {
    return true;
  }

  // 备用: x-admin-key header —— #838 E-2 ①（fail-closed）
  //   旧实现 `adminKey === process.env['SYNOVA_ADMIN_KEY']` 在环境变量**未设**时左右两侧都是
  //   `undefined` ⇒ **无头的任意请求**被判为管理员（写操作可覆盖数据目录）。
  //   现口径：① 环境变量未设 ⇒ 备用通道**不可用**（403 ADMIN_KEY_UNSET，绝不因"没配"而放行）；
  //          ② 已配置 ⇒ 必须提供**非空且相等**的头；③ 头缺失/不等 ⇒ 403 FORBIDDEN。
  const expected = (process.env['SYNOVA_ADMIN_KEY'] ?? '').trim();
  const raw = req.headers['x-admin-key'];
  const provided = typeof raw === 'string' ? raw.trim() : '';
  if (!expected) {
    res.status(403).json({
      ok: false,
      error: '管理员密钥未配置，备用管理通道不可用（fail-closed）',
      code: 'ADMIN_KEY_UNSET',
    });
    return false;
  }
  if (provided && provided === expected) {
    return true;
  }

  res.status(403).json({ ok: false, error: '需要 GA 管理员权限', code: 'FORBIDDEN' });
  return false;
}

// ─── POST /api/backup/create ───

router.post('/api/backup/create', async (_req: Request, res: Response) => {
  try {
    const password = process.env['SYNOVA_BACKUP_PASSWORD'] || '';
    const builder = new RecoveryPackBuilder();
    const result = builder.createRecoveryPack(password);

    if (result.created) {
      log.info({ path: result.path, size: result.size }, '手动备份完成');
      res.json({ ok: true, path: result.path, size: result.size, meta: result.meta });
    } else {
      res.status(500).json({ ok: false, error: result.error || '备份创建失败' });
    }
  } catch (err: unknown) {
    log.error({ err }, '手动备份异常');
    res.status(500).json({ ok: false, error: (err as Error)?.message || String(err) });
  }
});

// ─── GET /api/backup/status ───

router.get('/api/backup/status', (_req: Request, res: Response) => {
  try {
    const s = getScheduler();
    const status = s.getStatus();
    res.json({ ok: true, ...status });
  } catch (err: unknown) {
    log.error({ err }, '查询备份状态异常');
    res.status(500).json({ ok: false, error: (err as Error)?.message || String(err) });
  }
});

// ─── POST /api/backup/restore (需管理员权限) ───

router.post('/api/backup/restore', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { packPath, password, targetDir } = req.body as {
      packPath?: string; password?: string; targetDir?: string;
    };

    if (!packPath) {
      res.status(400).json({ ok: false, error: 'packPath 必填' });
      return;
    }

    if (!password) {
      res.status(400).json({ ok: false, error: 'password 必填' });
      return;
    }

    const builder = new RecoveryPackBuilder();
    const result = builder.restoreFromPack(packPath, password, targetDir);

    if (result.success) {
      log.info({ targetDir: result.targetDir, files: result.restoredFiles.length }, '恢复完成');
      res.json({ ok: true, restoredFiles: result.restoredFiles, targetDir: result.targetDir });
    } else {
      res.status(500).json({ ok: false, error: result.error || '恢复失败', warnings: result.warnings });
    }
  } catch (err: unknown) {
    log.error({ err }, '恢复操作异常');
    res.status(500).json({ ok: false, error: (err as Error)?.message || String(err) });
  }
});

// ─── POST /api/backup/verify ───

router.post('/api/backup/verify', async (req: Request, res: Response) => {
  try {
    const { packPath, password } = req.body as { packPath?: string; password?: string };

    if (!packPath) {
      res.status(400).json({ ok: false, error: 'packPath 必填' });
      return;
    }

    if (!fs.existsSync(packPath)) {
      res.status(404).json({ ok: false, error: `恢复包不存在: ${packPath}` });
      return;
    }

    const pwd = password || process.env['SYNOVA_BACKUP_PASSWORD'];
    if (!pwd) {
      res.status(400).json({ ok: false, error: 'password 必填或设置 SYNOVA_BACKUP_PASSWORD 环境变量' });
      return;
    }
    const result = await verifyLocalBackup(packPath, pwd);

    res.json({
      ok: result.valid,
      valid: result.valid,
      checksumMatch: result.checksumMatch,
      meta: result.meta,
      errors: result.errors,
    });
  } catch (err: unknown) {
    log.error({ err }, '验证操作异常');
    res.status(500).json({ ok: false, error: (err as Error)?.message || String(err) });
  }
});

export default router;
