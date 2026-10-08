/**
 * src/deploy/data-directory.ts — 三平台数据目录注册
 *
 * D47: 首次启动检查所用。为 Synova 数据目录提供平台标准路径。
 *
 * 平台映射（约束2: 使用平台标准路径）:
 *   Windows → %LOCALAPPDATA%/Synova/data
 *   macOS   → ~/Library/Application Support/Synova/data
 *   Linux   → $XDG_DATA_HOME/Synova/data (fallback ~/.local/share/Synova/data)
 *
 * 接口:
 *   getDataDirectory(): string — 返回平台数据目录路径(不保证存在)
 *   registerDataDirectory(): { path: string; created: boolean } — 创建目录并返回结果
 */
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '@synova/logger';

const log = createLogger('deploy/data-directory');

/**
 * 获取 Synova 数据目录的平台标准路径。
 * 不创建目录，不抛出异常。
 *
 * @returns 平台数据目录的绝对路径
 */
export function getDataDirectory(): string {
  const appName = 'Synova';

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Local');
    return path.join(localAppData, appName, 'data');
  }

  if (process.platform === 'darwin') {
    const home = process.env.HOME || '/tmp';
    return path.join(home, 'Library', 'Application Support', appName, 'data');
  }

  // Linux / others
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '/tmp', '.local', 'share');
  return path.join(xdgDataHome, appName, 'data');
}

/**
 * 解析**实际运行库**的路径 —— 健康检查与运行时同源（#1454 B4）。
 *
 * 优先级与 `src/config.ts:loadConfig().dbPath` 的取值链同向：
 *   ① `SYNOVA_DB_PATH`（显式指定，最高优先）
 *   ② `SYNOVA_DATA_DIR` ⇒ `<dataDir>/synova.db`
 *   ③ 平台数据目录 ⇒ `<getDataDirectory()>/synova.db`
 *
 * 修前 `src/routes/healthz.ts:84` 直接 `path.join(getDataDirectory(), 'synova.db')`，
 * 不看 `SYNOVA_DB_PATH` ⇒ 用独立库跑进程时健康检查查的是**另一个库** ⇒ 恒假降级。
 *
 * @input  无（自读环境变量）
 * @output 数据库文件的绝对路径（不保证存在）
 * @degraded 无（纯字符串解析，不抛）
 * @invariant 与 `loadConfig().dbPath` 在 `SYNOVA_DB_PATH` / `SYNOVA_DATA_DIR` 两档上同源
 */
export function resolveDbPath(): string {
  const explicit = process.env.SYNOVA_DB_PATH;
  if (explicit && explicit.trim() !== '') return explicit;

  const dataDir = process.env.SYNOVA_DATA_DIR;
  if (dataDir && dataDir.trim() !== '') return path.join(dataDir, 'synova.db');

  return path.join(getDataDirectory(), 'synova.db');
}

/**
 * 注册(创建) Synova 数据目录。
 * 创建目录树 + 写入 .synova-registry 标记文件表示注册完成。
 *
 * @returns { path, created } — 目录路径 + 是否新建(true=刚创建, false=已存在)
 */
export function registerDataDirectory(): { path: string; created: boolean } {
  const dataDir = getDataDirectory();
  const markerFile = path.join(dataDir, '.synova-registry');

  try {
    if (fs.existsSync(dataDir)) {
      log.debug({ path: dataDir }, '数据目录已存在');
      return { path: dataDir, created: false };
    }

    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(markerFile, `registered: ${new Date().toISOString()}\n`, 'utf-8');
    log.info({ path: dataDir }, '数据目录已创建并注册');
    return { path: dataDir, created: true };
  } catch (err: unknown) {
    log.error({ err, path: dataDir }, '数据目录创建失败');
    // 降级: 失败时仍返回路径，启动检查会标记警告
    return { path: dataDir, created: false };
  }
}
