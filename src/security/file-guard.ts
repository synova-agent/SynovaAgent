/**
 * security/file-guard.ts — 文件安全拒绝列表 (Hermes #6: 三层文件安全防御)
 *
 * 参考 Hermes tool_executor.py 的 FILE_DENYLIST (精确路径 + 前缀匹配)
 * + 跨 profile 保护检测。
 *
 * Synova 的场景不同于 Hermes:
 *  - Hermes 执行任意 shell 命令 + 文件写入
 *  - Synova 主要风险在连接器子进程读取宿主文件
 *
 * 🔴 workDir 语义（#1052 / CTO 2026-10-08 裁定）：**进程工作根**，与
 *   `src/loops/middle-evolution-engine.ts` 的 `EXPERT_DIR`（`join(process.cwd(),'expert')`）
 *   与 `EXTENSIONS_DIR`（`join(process.cwd(),'extensions','industries')`）**同 base**。
 *   ⚠️ 曾踩（#1052 取证）：装配点把 `config.dbPath`（默认 `./data/synova.db`，**文件**路径）
 *   当 workDir 传入 ⇒ `checkBoundary` 的「工作目录内」分支**永不为真** ⇒ 几乎全部写入被拒。
 *   装配必须传 `process.cwd()`（或与之同 base 的目录），**不得**传文件路径。
 *
 * 三层防御:
 *   1. 写入拒绝: 系统关键路径禁止写入
 *   2. 读取拒绝: 凭据文件禁止读取
 *   3. 跨边界保护: 检测访问是否越出工作目录
 */
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '@synova/logger';

const log = createLogger('security/file-guard');

// ═══ Layer 1: 写入拒绝列表 (Hermes FILE_DENYLIST) ═══

const WRITE_DENY_EXACT = new Set([
  // SSH / 密钥
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.ssh', 'authorized_keys'),
  path.join(os.homedir(), '.ssh', 'id_rsa'),
  path.join(os.homedir(), '.ssh', 'id_ed25519'),
  // AWS
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.aws', 'credentials'),
  path.join(os.homedir(), '.aws', 'config'),
  // 系统
  '/etc/passwd', '/etc/shadow', '/etc/sudoers',
  '/etc/hosts', '/etc/resolv.conf',
  'C:\\Windows\\System32',
  'C:\\Windows\\System32\\drivers',
]);

const WRITE_DENY_PREFIXES = [
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.gnupg'),
  '/etc/',
  '/boot/',
  'C:\\Windows\\',
  'C:\\Program Files\\',
  'C:\\Program Files (x86)\\',
];

// ═══ Layer 2: 读取拒绝列表 (凭据/敏感文件) ═══

const READ_DENY_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /credentials\.json$/,
  /auth\.json$/,
  /secret/i,
  /\.pem$/,
  /id_rsa/,
  /id_ed25519/,
  /known_hosts$/,
];

// ═══ File Guard ═══

export interface FileAccessDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * 单次判定事件（#1052）——**供调用点在 FileGuard 之外落审计**。
 *
 * @contract operation 只取 'read' | 'write'；decision 为本次判定的原始结果（含 allow/deny）
 * @degraded 不适用（纯数据；无 IO）
 */
export interface FileDecisionEvent {
  path: string;
  operation: 'read' | 'write';
  decision: FileAccessDecision;
}

/**
 * FileGuard 构造选项（#1052）。
 *
 * @input workDir — **进程工作根**（见文件头 workDir 语义）；缺省 `process.cwd()`
 * @input onDecision — 每次判定后回调（allow 与 deny 都回调）；**本类不触 IO**，
 *   审计落在**调用点**（CTO 2026-10-08 裁定：不把 IO 塞进 FileGuard）
 * @output 无（构造）
 * @degraded **onDecision 抛错 ⇒ 捕获 + log.warn，且不改变本次决策结果**
 *   —— 审计失败不改判、也不放行（铁律 24/31）
 */
export interface FileGuardOptions {
  workDir?: string;
  onDecision?: (event: FileDecisionEvent) => void;
}

export class FileGuard {
  private workDir: string;
  private readonly onDecision?: (event: FileDecisionEvent) => void;

  constructor(workDir: string | FileGuardOptions = process.cwd()) {
    const opts: FileGuardOptions = typeof workDir === 'string' ? { workDir } : workDir;
    this.workDir = path.resolve(opts.workDir ?? process.cwd());
    this.onDecision = opts.onDecision;
  }

  /**
   * 触发 onDecision 回调（若装配）。
   *
   * @contract 回调抛错 ⇒ 捕获 + `log.warn`；**返回值不参与决策**（调用方已定判）
   * @degraded 回调异常 = degraded，但**决策结果不变**（铁律 24/31）
   */
  private fire(event: FileDecisionEvent): void {
    if (!this.onDecision) return;
    try {
      this.onDecision(event);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        { err: msg, path: event.path, operation: event.operation },
        'onDecision 回调异常 — 审计降级，决策结果不变',
      );
    }
  }

  /** Check if a file can be written to */
  canWrite(filePath: string): FileAccessDecision {
    const decision = this.decideWrite(filePath);
    this.fire({ path: path.resolve(filePath), operation: 'write', decision });
    return decision;
  }

  /** 写入判定（纯逻辑；不触发回调）——逐字保留既有语义 */
  private decideWrite(filePath: string): FileAccessDecision {
    const resolved = path.resolve(filePath);

    // Layer 1: exact match
    if (WRITE_DENY_EXACT.has(resolved)) {
      return { allowed: false, reason: `写入被拒绝: ${resolved} 在系统保护列表中` };
    }

    // Layer 1: prefix match
    for (const prefix of WRITE_DENY_PREFIXES) {
      if (resolved.startsWith(prefix + path.sep) || resolved === prefix) {
        return { allowed: false, reason: `写入被拒绝: ${resolved} 在系统保护路径中 (${prefix})` };
      }
    }

    // Layer 3: cross-boundary check
    return this.checkBoundary(resolved, 'write');
  }

  /** Check if a file can be read */
  canRead(filePath: string): FileAccessDecision {
    const decision = this.decideRead(filePath);
    this.fire({ path: path.resolve(filePath), operation: 'read', decision });
    return decision;
  }

  /** 读取判定（纯逻辑；不触发回调）——逐字保留既有语义 */
  private decideRead(filePath: string): FileAccessDecision {
    const resolved = path.resolve(filePath);

    // Layer 2: credential file patterns
    const basename = path.basename(resolved);
    for (const pattern of READ_DENY_PATTERNS) {
      if (pattern.test(basename)) {
        return { allowed: false, reason: `读取被拒绝: ${basename} 匹配凭据文件模式 ${pattern}` };
      }
    }

    // Layer 3: cross-boundary check
    return this.checkBoundary(resolved, 'read');
  }

  /** Layer 3: 检测是否越出工作目录 */
  private checkBoundary(resolved: string, operation: string): FileAccessDecision {
    // 允许工作目录内的所有访问
    if (resolved.startsWith(this.workDir + path.sep) || resolved === this.workDir) {
      return { allowed: true };
    }

    // 允许临时目录
    const tmpDir = os.tmpdir();
    if (resolved.startsWith(tmpDir + path.sep) || resolved === tmpDir) {
      return { allowed: true };
    }

    // 允许用户目录下的应用数据 (synova 数据目录)
    const synovaData = path.join(os.homedir(), '.synova-agent');
    if (resolved.startsWith(synovaData + path.sep) || resolved === synovaData) {
      return { allowed: true };
    }

    // 其他路径: 只读允许, 写入拒绝
    if (operation === 'write') {
      return { allowed: false, reason: `写入被拒绝: ${resolved} 不在工作目录内` };
    }
    return { allowed: true };
  }

  /** Set a different work directory (e.g. for connector sandbox) */
  setWorkDir(dir: string): void {
    this.workDir = path.resolve(dir);
  }
}

// ═══ Singleton ═══

let _instance: FileGuard | null = null;

/**
 * 取 FileGuard 单例（#1052：形参兼容 `string | FileGuardOptions`）。
 *
 * @input workDir — **进程工作根**（见文件头语义）；传文件路径会让边界判定失效
 * @input inject — 测试/装配注入（注入即替换单例）
 * @output FileGuard 单例
 * @degraded 无（纯构造）
 */
export function getFileGuard(
  workDir?: string | FileGuardOptions,
  inject?: FileGuard,
): FileGuard {
  if (inject) { _instance = inject; return inject; }
  if (!_instance) _instance = new FileGuard(workDir);
  return _instance;
}
