/**
 * src/routes/healthz.ts — GET /api/healthz 健康检查端点 (L1)
 *
 * D49: 6 项独立检查，每项独立 try-catch，单点故障不阻断其他检查。
 *
 * 返回格式:
 *   { status: "healthy|degraded|down", checks: {...}, uptime: number }
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@synova/logger';
import { getDataDirectory, resolveDbPath } from '../deploy/data-directory';

const log = createLogger('routes/healthz');
const router = Router();
const startTime = Date.now();

/** 单项检查状态 — string (文件驱动合规) */
type CheckStatus = string;

/** 单项检查结果 */
interface HealthCheck {
  status: CheckStatus;
  detail: string;
}

/** 健康检查响应 */
interface HealthzResponse {
  status: 'healthy' | 'degraded' | 'down';
  checks: Record<string, HealthCheck>;
  uptime: number;
}

/**
 * 执行全部 6 项健康检查。
 * 每项独立 try-catch，单点失败不阻断其他。
 */
async function runAllChecks(): Promise<HealthzResponse> {
  const checkFns: { name: string; fn: () => Promise<HealthCheck> }[] = [
    { name: 'database', fn: checkDatabase },
    { name: 'llm_connectivity', fn: checkLLMConnectivity },
    { name: 'last_sentinel_run', fn: checkLastSentinelRun },
    { name: 'disk_free_gb', fn: checkDiskFree },
    { name: 'data_freshness', fn: checkDataFreshness },
    { name: 'watchdog_alive', fn: checkWatchdogAlive },
  ];

  const results = await Promise.all(
    checkFns.map(async ({ name, fn }) => {
      try {
        const result = await fn();
        log.debug({ check: name, status: result.status }, '健康检查完成');
        return [name, result] as const;
      } catch (err: unknown) {
        log.error({ err, check: name }, '健康检查异常');
        return [name, { status: 'down' as const, detail: `检查异常: ${(err as Error)?.message || String(err)}` }] as const;
      }
    }),
  );

  const checks: Record<string, HealthCheck> = {};
  let hasDegraded = false;
  let hasDown = false;

  for (const [name, result] of results) {
    checks[name] = result;
    if (result.status === 'down') hasDown = true;
    if (result.status === 'degraded') hasDegraded = true;
  }

  const status: HealthzResponse['status'] = hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy';

  return {
    status,
    checks,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
}

// ─── 检查 1: 数据库 ───

async function checkDatabase(): Promise<HealthCheck> {
  // #1454 B4: 与运行时同源 —— 尊重 SYNOVA_DB_PATH / SYNOVA_DATA_DIR
  //（修前直取平台数据目录 ⇒ 独立库跑进程时恒假降级）
  const dbPath = resolveDbPath();

  if (!fs.existsSync(dbPath)) {
    return { status: 'degraded', detail: '数据库文件不存在(首次启动尚未初始化)' };
  }

  try {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      return { status: 'down', detail: '数据库文件为空(synova.db size=0)' };
    }
    const fd = fs.openSync(dbPath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (!buf.toString('utf-8').startsWith('SQLite format 3')) {
      return { status: 'down', detail: '数据库文件头无效' };
    }
    return { status: 'ok', detail: `SQLite 数据库正常 (${(stat.size / 1024).toFixed(0)}KB)` };
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件系统操作失败");
    return { status: 'down', detail: `数据库检查失败: ${(err as Error)?.message || String(err)}` };
  }
}

// ─── 检查 2: LLM 连接 ───

async function checkLLMConnectivity(): Promise<HealthCheck> {
  // 检查环境变量中 API key 是否存在
  const apiKeys = [
    { key: 'OPENAI_API_KEY', label: 'OpenAI' },
    { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
  ];

  const found = apiKeys.filter(({ key }) => {
    const val = process.env[key];
    return val && val.length > 0 && val !== 'your-api-key-here';
  });

  // 最近1小时内LLM调用成功 — 检查日志文件
  let recentCallFound = false;
  const logDir = path.join(getDataDirectory(), '..', 'logs');
  if (fs.existsSync(logDir)) {
    const logs = fs.readdirSync(logDir).filter(f => f.includes('llm') || f.includes('provider'));
    const oneHourAgo = Date.now() - 3600000;
    for (const logFile of logs) {
      const stat = fs.statSync(path.join(logDir, logFile));
      if (stat.mtimeMs > oneHourAgo) {
        recentCallFound = true;
        break;
      }
    }
  }

  if (found.length > 0 && recentCallFound) {
    return { status: 'ok', detail: `API key 已配置 (${found.map(f => f.label).join(', ')}), 最近1小时有调用记录` };
  }
  if (found.length > 0) {
    return { status: 'degraded', detail: `API key 已配置 (${found.map(f => f.label).join(', ')}), 但最近1小时无调用记录` };
  }
  return { status: 'degraded', detail: '未配置 LLM API key (诊断功能受限)' };
}

// ─── 检查 3: 哨兵执行 ───

async function checkLastSentinelRun(): Promise<HealthCheck> {
  const sentinelLogDir = path.join(getDataDirectory(), '..', 'logs', 'sentinel');
  if (!fs.existsSync(sentinelLogDir)) {
    return { status: 'degraded', detail: '哨兵日志目录不存在(可能尚未执行)' };
  }

  try {
    const logs = fs.readdirSync(sentinelLogDir).filter(f => f.endsWith('.log') || f.endsWith('.json'));
    const last24h = Date.now() - 86400000;
    let recentRun = false;

    for (const logFile of logs) {
      const stat = fs.statSync(path.join(sentinelLogDir, logFile));
      if (stat.mtimeMs > last24h) {
        recentRun = true;
        break;
      }
    }

    if (recentRun) {
      return { status: 'ok', detail: '最近24小时内有哨兵执行' };
    }
    return { status: 'degraded', detail: '最近24小时内无哨兵执行记录' };
  } catch {
    return { status: 'degraded', detail: '无法读取哨兵日志' };
  }
}

// ─── 检查 4: 磁盘空间 ───

async function checkDiskFree(): Promise<HealthCheck> {
  const dataDir = getDataDirectory();

  try {
    // 确保目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (process.platform === 'win32') {
      // #1454 B5: 不经 shell 调用 —— 修前 `execSync('fsutil volume diskfree "C:\\"')` 在 cmd.exe 下
      // 尾反斜杠会转义收尾引号 ⇒ 命令行被截断 ⇒ 抛错 ⇒ 本检查在 Windows 上**恒降级**。
      // execFileSync 直接传 argv，无引号解析层，`C:\` 原样进 argv[3]。
      const { execFileSync } = await import('child_process');
      const drive = path.parse(dataDir).root || 'C:\\';
      const output = execFileSync('fsutil', ['volume', 'diskfree', drive], { timeout: 5000 })
        .toString()
        .toLowerCase();
      const freeMatch = output.match(/[:：]\s*(\d+)\s*/);
      if (freeMatch && freeMatch[1]) {
        const freeGB = parseInt(freeMatch[1], 10) / (1024 * 1024 * 1024);
        if (freeGB > 1) {
          return { status: 'ok', detail: `剩余 ${freeGB.toFixed(1)}GB` };
        }
        return { status: 'degraded', detail: `磁盘空间不足: ${freeGB.toFixed(1)}GB (< 1GB)` };
      }
      return { status: 'degraded', detail: '无法获取磁盘信息(Windows fsutil)' };
    }

    // macOS/Linux: statfs
    const { statfsSync } = tryGetStatFs();
    if (statfsSync) {
      const stats = statfsSync(dataDir);
      const freeGB = (stats.bsize * stats.bavail) / (1024 * 1024 * 1024);
      if (freeGB > 1) {
        return { status: 'ok', detail: `剩余 ${freeGB.toFixed(1)}GB` };
      }
      return { status: 'degraded', detail: `磁盘空间不足: ${freeGB.toFixed(1)}GB (< 1GB)` };
    }

    return { status: 'degraded', detail: '无法检测磁盘空间(当前平台不支持 statfs)' };
  } catch (err: unknown) {
    return { status: 'degraded', detail: `磁盘检查异常: ${(err as Error)?.message || String(err)}` };
  }
}

// ─── 检查 5: 数据新鲜度 ───

async function checkDataFreshness(): Promise<HealthCheck> {
  const dataDir = getDataDirectory();

  try {
    if (!fs.existsSync(dataDir)) {
      return { status: 'degraded', detail: '数据目录不存在(尚无数据)' };
    }

    const entries = fs.readdirSync(dataDir).filter(e => !e.startsWith('_'));
    if (entries.length === 0) {
      return { status: 'degraded', detail: '数据目录为空' };
    }

    const sevenDaysAgo = Date.now() - 7 * 86400000;
    let recentData = false;
    let newestFile = '';
    let newestTime = 0;

    for (const entry of entries) {
      const fullPath = path.join(dataDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > sevenDaysAgo) {
          recentData = true;
        }
        if (stat.mtimeMs > newestTime) {
          newestTime = stat.mtimeMs;
          newestFile = entry;
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "文件系统操作失败");
        // 跳过权限错误
      }
    }

    if (recentData) {
      return { status: 'ok', detail: `最近7天内有数据活动 (最新: ${newestFile})` };
    }
    const daysSinceUpdate = Math.floor((Date.now() - newestTime) / 86400000);
    return { status: 'degraded', detail: `最近7天内无新数据 (${daysSinceUpdate}天前: ${newestFile})` };
  } catch (err: unknown) {
    return { status: 'degraded', detail: `数据新鲜度检查异常: ${(err as Error)?.message || String(err)}` };
  }
}

// ─── 检查 6: 看门狗存活 ───

async function checkWatchdogAlive(): Promise<HealthCheck> {
  const watchdogLogDir = path.join(getDataDirectory(), '..', 'logs');
  let watchdogLogPath: string | null = null;

  // 查找看门狗日志
  if (fs.existsSync(watchdogLogDir)) {
    const logs = fs.readdirSync(watchdogLogDir);
    const wdLog = logs.find(f => f.includes('watchdog'));
    if (wdLog) {
      watchdogLogPath = path.join(watchdogLogDir, wdLog);
    }
  }

  // 也检查用户目录
  const homeWatchdog = path.join(process.env.HOME || '/tmp', '.synova', 'logs', 'watchdog.log');
  if (fs.existsSync(homeWatchdog)) {
    watchdogLogPath = homeWatchdog;
  }

  if (!watchdogLogPath) {
    return { status: 'degraded', detail: '看门狗未运行(无日志文件)' };
  }

  try {
    const stat = fs.statSync(watchdogLogPath);
    const fiveMinAgo = Date.now() - 300000;
    if (stat.mtimeMs > fiveMinAgo) {
      return { status: 'ok', detail: `看门狗活跃 (${Math.floor((Date.now() - stat.mtimeMs) / 1000)}秒前探测)` };
    }
    return { status: 'degraded', detail: `看门狗日志超过5分钟未更新 (${Math.floor((Date.now() - stat.mtimeMs) / 60000)}分钟前)` };
  } catch {
    return { status: 'degraded', detail: '无法读取看门狗日志' };
  }
}

// ─── 工具函数 ───

function tryGetStatFs(): { statfsSync: ((path: string) => { bsize: number; bavail: number }) | null } {
  try {
    const fsModule = fs as typeof fs & {
      statfsSync?: (path: string) => { bsize: number; bavail: number };
    };
    if (typeof fsModule.statfsSync === 'function') {
      return { statfsSync: fsModule.statfsSync };
    }
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "健康检查模块加载");
    // 旧版 Node.js, 不支持 statfsSync
  }
  return { statfsSync: null };
}

// ─── 路由 ───

router.get('/api/healthz', async (_req, res) => {
  try {
    const result = await runAllChecks();
    const httpStatus = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json(result);
  } catch (err: unknown) {
    log.error({ err }, '健康检查完全失败');
    res.status(500).json({
      status: 'down',
      checks: {},
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }
});

export default router;
