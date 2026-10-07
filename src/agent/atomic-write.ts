/**
 * agent/atomic-write.ts — 原子写入工具
 *
 * 联邦进化生成的新规则/阈值/基准需要写入文件系统时使用。
 * 协议: .tmp → fs.rename() → 旧版本备份到 versions/
 *
 * 铁律 39: L2 编排层——不直接操作 L5 数据文件。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@synova/logger';
import { getFileGuard } from '../security/file-guard';

const log = createLogger('agent/atomic-write');

// ═══ Types ═══

export interface AtomicWriteResult {
  success: boolean;
  targetPath: string;
  backupPath?: string;
  error?: string;
}

// ═══ AtomicWriter ═══

export class AtomicWriter {
  private rootDir: string;
  private versionsDir: string;
  private maxBackups = 5;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.versionsDir = path.join(rootDir, 'versions');
    if (!fs.existsSync(this.versionsDir)) {
      fs.mkdirSync(this.versionsDir, { recursive: true });
    }
  }

  /**
   * 原子写入: 先写临时文件，校验通过后原子替换。
   *
   * @param relativePath — 相对于项目根的目标路径 (如 "knowledge/benchmarks/manufacturing-kpi.md")
   * @param content — 写入内容
   * @param validate — 可选的内容校验函数，返回 false 则中止写入
   */
  write(
    relativePath: string,
    content: string,
    validate?: (content: string) => boolean,
  ): AtomicWriteResult {
    const targetPath = path.join(this.rootDir, relativePath);

    // #1052（B 项：接口就位）：写入前过 FileGuard 门。
    // 覆盖面声明：本方法只覆盖自身调用方；今日 `write()` 零生产调用 ⇒ **不作穿入口判据**（铁律 4/5）。
    const gate = getFileGuard().canWrite(targetPath);
    if (!gate.allowed) {
      const err = `写入被 FileGuard 拒绝: ${gate.reason ?? 'unknown'}`;
      log.warn({ targetPath, err }, '原子写入被门禁拒绝 — 不落盘');
      return { success: false, targetPath, error: err };
    }
    const tmpPath = targetPath + '.tmp';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.versionsDir,
      `${path.basename(relativePath)}.${timestamp}.bak`,
    );

    // 1. 内容校验
    if (validate && !validate(content)) {
      const err = '内容校验失败——拒绝写入';
      log.error({ targetPath, err }, '原子写入中止');
      return { success: false, targetPath, error: err };
    }

    // 2. 写入临时文件
    try {
      fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      fs.writeFileSync(tmpPath, content, 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ tmpPath, err: msg }, '临时文件写入失败');
      return { success: false, targetPath, error: msg };
    }

    // 3. 备份当前文件（如果存在）
    try {
      if (fs.existsSync(targetPath)) {
        fs.copyFileSync(targetPath, backupPath);
        this.rotateBackups(path.basename(relativePath));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ backupPath, err: msg }, '备份失败——继续写入（degraded）');
    }

    // 4. 原子替换
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ tmpPath, targetPath, err: msg }, '原子替换失败——尝试从备份恢复');
      // 尝试恢复备份
      try {
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, targetPath);
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件系统操作失败");
        /* double-failure — give up */
      }
      return { success: false, targetPath, error: msg };
    }

    // 5. 写入后校验
    try {
      const written = fs.readFileSync(targetPath, 'utf-8');
      if (written !== content) {
        const err = '写入后校验失败——内容不一致';
        log.error({ targetPath, err }, '原子写入异常——已尝试恢复');
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, targetPath);
        }
        return { success: false, targetPath, backupPath, error: err };
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件读取失败");
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, targetPath, backupPath, error: msg };
    }

    log.info({ targetPath, backupPath, size: content.length }, '原子写入成功');
    return { success: true, targetPath, backupPath };
  }

  /** 清理临时文件 */
  cleanup(): void {
    // 清理知识目录下的 .tmp 文件
    const knowledgeDir = path.join(this.rootDir, 'knowledge');
    if (fs.existsSync(knowledgeDir)) {
      this.cleanTmpRecursive(knowledgeDir);
    }
  }

  // ═══ Private ═══

  private rotateBackups(basename: string): void {
    const prefix = basename + '.';
    const backups = fs.readdirSync(this.versionsDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.bak'))
      .sort()
      .reverse();

    // 保留最近 maxBackups 个备份
    for (let i = this.maxBackups; i < backups.length; i++) {
      const oldBackup = path.join(this.versionsDir, backups[i]);
      try {
        fs.unlinkSync(oldBackup);
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件删除失败");
        /* skip */
      }
    }
  }

  private cleanTmpRecursive(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.cleanTmpRecursive(fullPath);
        } else if (entry.name.endsWith('.tmp')) {
          try {
            fs.unlinkSync(fullPath);
            log.debug({ file: fullPath }, '清理临时文件');
          } catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件删除失败");
            /* skip */
          }
        }
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件删除失败");
      /* skip */
    }
  }
}
