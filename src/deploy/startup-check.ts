/**
 * src/deploy/startup-check.ts — 首次启动 5 项检查
 *
 * D47: 在 Electron 主进程 app.whenReady() 中执行。
 * 约束1: 仅 SQLite 失败导致退出，其余失败写入 warnings[] 继续启动。
 *
 * 5 项检查:
 *   1. SQLite — integrity_check 确认数据库完整性
 *   2. LLM — 配置可读且 API key 存在
 *   3. 磁盘 — 数据目录所在分区可用空间 >= 500MB
 *   4. 哨兵基线 — sentinel-loader 无降级
 *   5. 权限 — 数据目录可读写
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@synova/logger';
import { getDataDirectory, registerDataDirectory } from './data-directory';
import { checkSchemaCompatibility } from './schema-version';
import { getComputeVersion, compareComputeCompatibility } from './compute-version';
import { rollbackToSnapshot, listSnapshots } from './rollback';

const log = createLogger('deploy/startup-check');

/** 单条检查结果 */
export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

/** 启动检查总体结果 */
export interface StartupCheckResult {
  passed: CheckResult[];
  failed: CheckResult[];
  warnings: CheckResult[];
}

/** 检查分类 */
type CheckCategory = 'sqlite' | 'llm' | 'disk' | 'sentinel' | 'permission';

/** 检查任务描述 */
interface CheckItem {
  name: string;
  category: CheckCategory;
  run: () => Promise<CheckResult>;
}

/**
 * 执行全部 5 项首次启动检查。
 * 约束1: 每项失败独立降级 — SQLite 写入 failed[], 其余写入 warnings[]。
 *
 * @returns StartupCheckResult — passed/failed/warnings
 */
export async function runStartupChecks(): Promise<StartupCheckResult> {
  const checks: CheckItem[] = [
    { name: 'SQLite 数据库完整性', category: 'sqlite', run: checkSQLite },
    { name: 'LLM API 连接配置', category: 'llm', run: checkLLM },
    { name: '磁盘空间 >= 500MB', category: 'disk', run: checkDiskSpace },
    { name: '哨兵工位基线', category: 'sentinel', run: checkSentinelBaseline },
    { name: '数据目录权限', category: 'permission', run: checkPermissions },
  ];

  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        const result = await check.run();
        log.debug({ check: check.name, passed: result.passed }, '检查完成');
        return { ...result, _category: check.category };
      } catch (err: unknown) {
        const msg = `检查异常: ${(err as Error)?.message || String(err)}`;
        log.error({ err, check: check.name }, '检查抛出异常');
        return { name: check.name, passed: false, detail: msg, _category: check.category };
      }
    }),
  );

  const passed: CheckResult[] = [];
  const failed: CheckResult[] = [];
  const warnings: CheckResult[] = [];

  for (const r of results) {
    const { _category, ...checkResult } = r;
    if (r.passed) {
      passed.push(checkResult);
    } else if (_category === 'sqlite') {
      failed.push(checkResult);
    } else {
      warnings.push(checkResult);
    }
  }

  log.info({ totalPassed: passed.length, totalFailed: failed.length, totalWarnings: warnings.length }, '首次启动检查完成');

  // 约束1: 记录降级信号
  if (warnings.length > 0) {
    log.warn({ warnings: warnings.map((w) => w.name) }, '启动检查有警告 — 系统以降级模式运行');
  }

  return { passed, failed, warnings };
}

// ─── 检查 1: SQLite 数据库完整性 ───

async function checkSQLite(): Promise<CheckResult> {
  const dbPath = path.join(getDataDirectory(), 'synova.db');

  // 数据库文件不存在不是错误 — 首次启动还没创建
  if (!fs.existsSync(dbPath)) {
    return { name: 'SQLite 数据库完整性', passed: true, detail: '数据库尚不存在(首次启动) — 将由 server.ts 初始化' };
  }

  // 检查文件是否可以读取（实际 integrity_check 需要 better-sqlite3，
  // 但这里只做文件级验证，避免加载 native 模块）
  try {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      return { name: 'SQLite 数据库完整性', passed: false, detail: '数据库文件为空(synova.db size=0)' };
    }
    // 检查文件头是否为 SQLite 格式
    const fd = fs.openSync(dbPath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const header = buf.toString('utf-8');
    if (!header.startsWith('SQLite format 3')) {
      return { name: 'SQLite 数据库完整性', passed: false, detail: '数据库文件头无效(非 SQLite 格式)' };
    }
    return { name: 'SQLite 数据库完整性', passed: true, detail: '数据库文件可读且格式正确' };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件系统操作失败");
    return { name: 'SQLite 数据库完整性', passed: false, detail: `数据库文件检查失败: ${(err as Error)?.message || String(err)}` };
  }
}

// ─── 检查 2: LLM API 连接配置 ───

async function checkLLM(): Promise<CheckResult> {
  const checks: { label: string; key: string }[] = [
    { label: 'OpenAI', key: 'OPENAI_API_KEY' },
    { label: 'DeepSeek', key: 'DEEPSEEK_API_KEY' },
  ];

  // 检查环境变量或 .env 文件中的 API key
  const found = checks.filter((c) => {
    const envVal = process.env[c.key];
    if (envVal && envVal.length > 0 && envVal !== 'your-api-key-here') {
      return true;
    }
    return false;
  });

  // 也尝试加载 .env 文件检查
  const envFiles = ['.env', '.env.local', '.env.production'];
  let envFileFound = false;
  let envFileDetails: string[] = [];

  for (const ef of envFiles) {
    const efPath = path.resolve(process.cwd(), ef);
    if (fs.existsSync(efPath)) {
      envFileFound = true;
      // 仅检查是否包含 API key 字样（不读取敏感值）
      const content = fs.readFileSync(efPath, 'utf-8');
      const hasApiKey = /api.?key/i.test(content);
      const llmVars = content.split('\n').filter((l) => l.includes('API_KEY') || l.includes('api_key'));
      if (llmVars.length > 0) {
        envFileDetails.push(`${ef}: ${llmVars.length} API key 变量`);
      }
      if (hasApiKey) {
        envFileDetails.push(`${ef}: 包含 API key 配置`);
      }
    }
  }

  if (found.length > 0) {
    return {
      name: 'LLM API 连接配置',
      passed: true,
      detail: `环境变量中找到 ${found.length} 个 API key (${found.map((f) => f.label).join(', ')})`,
    };
  }

  if (envFileFound && envFileDetails.length > 0) {
    return {
      name: 'LLM API 连接配置',
      passed: true,
      detail: `配置文件中发现 API key: ${envFileDetails.join('; ')}`,
    };
  }

  return {
    name: 'LLM API 连接配置',
    passed: false,
    detail: '未找到 LLM API key — 请在环境变量或 .env 文件中设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY',
  };
}

// ─── 检查 3: 磁盘空间 >= 500MB ───

async function checkDiskSpace(): Promise<CheckResult> {
  const dataDir = getDataDirectory();

  try {
    // 确保目录存在以便检查
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件系统操作失败");
    // 创建失败不阻断检查
  }

  try {
    // Windows 下取可用空间
    if (process.platform === 'win32') {
      // #1454 B5（与 src/routes/healthz.ts 同型修）: 不经 shell —— 修前 execSync 的
      // `"C:\"` 在 cmd.exe 下尾反斜杠转义收尾引号 ⇒ 命令行截断 ⇒ Windows 恒降级。
      const { execFileSync } = await import('child_process');
      const drive = path.parse(dataDir).root || 'C:\\';
      const output = execFileSync('fsutil', ['volume', 'diskfree', drive], { timeout: 5000 })
        .toString()
        .toLowerCase();

      // 解析 bytes (fsutil 输出类似: "可用空间: 1234567890 字节")
      const freeMatch = output.match(/[:：]\s*(\d+)\s*/);
      if (freeMatch && freeMatch[1]) {
        const freeBytes = parseInt(freeMatch[1], 10);
        const freeMB = freeBytes / (1024 * 1024);
        if (freeMB >= 500) {
          return { name: '磁盘空间 >= 500MB', passed: true, detail: `可用空间: ${Math.round(freeMB)}MB` };
        }
        return { name: '磁盘空间 >= 500MB', passed: false, detail: `可用空间不足: ${Math.round(freeMB)}MB (< 500MB)` };
      }
    }

    // macOS / Linux: statvfs
    const { statfsSync } = tryGetStatFs();
    if (statfsSync) {
      const stats = statfsSync(dataDir);
      // statvfs 字段: bsize * bavail = 非特权用户可用字节
      const freeBytes = stats.bsize * stats.bavail;
      const freeMB = freeBytes / (1024 * 1024);
      if (freeMB >= 500) {
        return { name: '磁盘空间 >= 500MB', passed: true, detail: `可用空间: ${Math.round(freeMB)}MB` };
      }
      return { name: '磁盘空间 >= 500MB', passed: false, detail: `可用空间不足: ${Math.round(freeMB)}MB (< 500MB)` };
    }

    // 无法检测 — 降级为警告而非阻断
    return { name: '磁盘空间 >= 500MB', passed: false, detail: '无法检测磁盘可用空间(当前平台/运行时不支持 statfs)' };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "无法检测 — 降级为警告而非阻断");
    return { name: '磁盘空间 >= 500MB', passed: false, detail: `磁盘检查异常: ${(err as Error)?.message || String(err)}` };
  }
}

/** 尝试获取平台 statfs 函数(可能不可用) */
function tryGetStatFs(): { statfsSync: ((path: string) => { bsize: number; bavail: number }) | null } {
  try {
    const fsModule = fs as typeof fs & {
      statfsSync?: (path: string) => { bsize: number; bavail: number };
    };
    if (typeof fsModule.statfsSync === 'function') {
      return { statfsSync: fsModule.statfsSync };
    }
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "启动检查模块加载");
    // node:fs 无 statfsSync (旧版本 Node.js)
  }
  return { statfsSync: null };
}

// ─── 检查 4: 哨兵工位基线 ───

async function checkSentinelBaseline(): Promise<CheckResult> {
  try {
    // 动态 import 避免 electron-main 启动时加载全部哨兵
    const { loadSentinels } = await import('../../src/sentinel/sentinel-loader');
    const { sentinels, degraded, errors } = loadSentinels();

    if (degraded) {
      return {
        name: '哨兵工位基线',
        passed: false,
        detail: `哨兵加载降级 — ${errors.length} 个错误: ${errors.join('; ')}`,
      };
    }

    if (sentinels.length < 10) {
      return {
        name: '哨兵工位基线',
        passed: false,
        detail: `哨兵数量异常: ${sentinels.length} 个(预期 >= 10)`,
      };
    }

    return {
      name: '哨兵工位基线',
      passed: true,
      detail: `${sentinels.length} 个哨兵已加载，零降级`,
    };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "动态模块加载失败");
    return {
      name: '哨兵工位基线',
      passed: false,
      detail: `哨兵加载异常: ${(err as Error)?.message || String(err)}`,
    };
  }
}

// ─── 检查 5: 数据目录权限 ───

async function checkPermissions(): Promise<CheckResult> {
  // 使用 registerDataDirectory 统一创建/注册（修复接线: 调用 data-directory 导出的函数）
  const { path: dataDir } = registerDataDirectory();

  try {

    // 测试读写
    const testFile = path.join(dataDir, `.perm-test-${Date.now()}`);
    fs.writeFileSync(testFile, 'permission check', 'utf-8');
    const content = fs.readFileSync(testFile, 'utf-8');
    fs.unlinkSync(testFile);

    if (content === 'permission check') {
      return { name: '数据目录权限', passed: true, detail: `${dataDir} — 可读写` };
    }
    return { name: '数据目录权限', passed: false, detail: '数据目录写入内容与读取不一致' };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "日志路径拼接");
    return { name: '数据目录权限', passed: false, detail: `数据目录不可写: ${(err as Error)?.message || String(err)}` };
  }
}
