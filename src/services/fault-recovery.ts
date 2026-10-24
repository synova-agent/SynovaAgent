/**
 * services/fault-recovery.ts — 故障恢复模块 (Batch 3: BP 7 场景全覆盖)
 *
 * 铁律 31: 降级信号传播。每个可独立失败的模块必须返回 degraded 标记。
 * 铁律 32: 错误分类强制。每种故障对应具体的 ErrorCode + phase + retryable。
 *
 * BP 7 故障场景:
 *   1. LLM 不可用 → rule-based fallback + DegradedBanner
 *   2. 模块计算失败 → degradedModules[] 聚合
 *   3. Phase 超时 → timeout handler + partial result
 *   4. JSON 解析失败 → retry once → default + log
 *   5. 外部 API 超时 → 8s timeout + degraded
 *   6. 数据文件损坏 → detect ENOENT vs JSON.parse vs checksum
 *   7. 不可恢复错误 → error event + SSE close + user-friendly message
 */
import { createLogger } from '@synova/logger';
import { ClassifiedLlmError, ErrorCode, isRetryable } from '../errors/types';

const log = createLogger('services/fault-recovery');

// ═══ Types ═══

export interface RecoveryResult<T> {
  ok: boolean;
  value?: T;
  error?: ClassifiedLlmError;
  degraded: boolean;
  degradedModules: string[];
  retryAfterMs?: number;
}

export interface FaultConfig {
  /** LLM 调用超时 (ms) */
  llmTimeoutMs: number;
  /** 模块执行超时 (ms) */
  moduleTimeoutMs: number;
  /** 外部 API 超时 (ms) */
  apiTimeoutMs: number;
  /** JSON 解析最大重试次数 */
  jsonParseMaxRetries: number;
  /** Phase 最大持续时长 (ms) */
  phaseMaxDurationMs: number;
  /** 降级时前端展示消息 */
  degradedMessage: string;
}

const DEFAULT_CONFIG: FaultConfig = {
  llmTimeoutMs: 120_000,
  moduleTimeoutMs: 30_000,
  apiTimeoutMs: 8_000,
  jsonParseMaxRetries: 1,
  phaseMaxDurationMs: 600_000,
  degradedMessage: '部分功能暂不可用，系统正在降级运行',
};

// ═══ Fault Recovery ═══

export class FaultRecovery {
  private config: FaultConfig;
  private degradedModules = new Set<string>();

  constructor(config: Partial<FaultConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ═══ 1. LLM 不可用 — rule-based fallback ═══

  async withLLMFallback<T>(
    llmCall: () => Promise<T>,
    fallback: T,
    moduleName: string,
  ): Promise<RecoveryResult<T>> {
    try {
      const result = await withTimeout(llmCall(), this.config.llmTimeoutMs, `LLM timeout: ${moduleName}`);
      return { ok: true, value: result, degraded: false, degradedModules: [] };
    } catch (err: any) {
      log.warn({ err: err.message, module: moduleName }, 'LLM 不可用 — 降级到 rule-based fallback');
      this.degradedModules.add(moduleName);
      return {
        ok: true, value: fallback, degraded: true,
        degradedModules: [moduleName],
        error: new ClassifiedLlmError(ErrorCode.NETWORK, `LLM 不可用: ${err.message}`, 0, true),
      };
    }
  }

  // ═══ 2. 模块计算失败 — degradedModules[] 聚合 ═══

  async runModule<T>(
    fn: () => Promise<T>,
    moduleName: string,
  ): Promise<RecoveryResult<T>> {
    try {
      const result = await withTimeout(fn(), this.config.moduleTimeoutMs, `Module timeout: ${moduleName}`);
      return { ok: true, value: result, degraded: false, degradedModules: [] };
    } catch (err: any) {
      log.warn({ err: err.message, module: moduleName }, '模块计算失败 — degraded');
      this.degradedModules.add(moduleName);
      return {
        ok: false, degraded: true, degradedModules: [moduleName],
        error: new ClassifiedLlmError(ErrorCode.INTERNAL, `模块 ${moduleName} 失败: ${err.message}`, 0, false),
      };
    }
  }

  /**
   * 并行运行多个模块，聚合 degradedModules[]
   * 单个模块失败不影响其他模块
   */
  async runModules<T>(
    modules: Array<{ name: string; fn: () => Promise<T> }>,
  ): Promise<{ results: Array<RecoveryResult<T>>; degradedModules: string[] }> {
    const results = await Promise.all(
      modules.map(m => this.runModule(m.fn, m.name)),
    );
    const degradedModules = results.flatMap(r => r.degradedModules);
    return { results, degradedModules };
  }

  // ═══ 3. Phase 超时 — timeout handler + partial result ═══

  async withPhaseTimeout<T>(
    phaseFn: () => Promise<T>,
    phaseName: string,
    timeoutMs?: number,
  ): Promise<RecoveryResult<T>> {
    const ms = timeoutMs || this.config.phaseMaxDurationMs;
    try {
      const result = await withTimeout(phaseFn(), ms, `Phase timeout: ${phaseName}`);
      return { ok: true, value: result, degraded: false, degradedModules: [] };
    } catch (err: any) {
      log.warn({ err: err.message, phase: phaseName, timeoutMs: ms }, 'Phase 超时 — 返回部分结果');
      this.degradedModules.add(`phase_${phaseName}`);
      return {
        ok: false, degraded: true,
        degradedModules: [`phase_${phaseName}`],
        error: new ClassifiedLlmError(ErrorCode.TIMEOUT, `Phase ${phaseName} 超时 (${ms}ms)`, 0, false),
      };
    }
  }

  // ═══ 4. JSON 解析失败 — retry once → default + log ═══

  async parseJSON<T>(
    content: string,
    defaults: T,
    label: string,
  ): Promise<{ parsed: T; degraded: boolean }> {
    // First attempt
    try {
      return { parsed: JSON.parse(content) as T, degraded: false };
    } catch (err) {
      log.warn({ err, label, contentPreview: content.slice(0, 100) }, 'JSON 解析失败，重试...');
    }

    // Retry: try extracting from markdown code block
    for (let attempt = 0; attempt < this.config.jsonParseMaxRetries; attempt++) {
      try {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) return { parsed: JSON.parse(match[1].trim()) as T, degraded: false };
      } catch (err) { log.debug({ err }, '恢复步骤失败 — 继续'); }
    }

    // All retries failed — return defaults
    log.warn({ label, contentPreview: content.slice(0, 200) }, 'JSON 解析完全失败 — 使用默认值');
    return { parsed: defaults, degraded: true };
  }

  // ═══ 5. 外部 API 超时 — 8s timeout + degraded ═══

  async callExternalAPI<T>(
    apiCall: () => Promise<T>,
    apiName: string,
  ): Promise<RecoveryResult<T>> {
    try {
      const result = await withTimeout(apiCall(), this.config.apiTimeoutMs, `API timeout: ${apiName}`);
      return { ok: true, value: result, degraded: false, degradedModules: [] };
    } catch (err: any) {
      log.warn({ err: err.message, api: apiName }, '外部 API 不可达 — degraded');
      this.degradedModules.add(`api_${apiName}`);
      return {
        ok: false, degraded: true,
        degradedModules: [`api_${apiName}`],
        error: new ClassifiedLlmError(ErrorCode.NETWORK, `API ${apiName} 不可达: ${err.message}`, 0, true),
        retryAfterMs: 30_000,
      };
    }
  }

  // ═══ 6. 数据文件损坏检测 ═══

  /**
   * 区分 ENOENT (文件不存在-正常默认) vs JSON.parse 失败 (打 log + degraded)
   * vs checksum 失败 (严重损坏)
   */
  detectFileError(err: any, filePath: string): 'not_found' | 'parse_error' | 'corrupt' | 'unknown' {
    if (err?.code === 'ENOENT') return 'not_found';
    if (err instanceof SyntaxError || err?.message?.includes('JSON')) return 'parse_error';
    if (err?.message?.includes('checksum') || err?.message?.includes('integrity')) return 'corrupt';
    return 'unknown';
  }

  /**
   * 安全读取 JSON 文件，区分损坏类型
   */
  async readJSONFile<T>(
    readFn: () => Promise<string>,
    filePath: string,
    defaults: T,
  ): Promise<{ data: T; status: 'ok' | 'not_found' | 'parse_error' | 'corrupt'; degraded: boolean }> {
    try {
      const raw = await readFn();
      const data = JSON.parse(raw) as T;
      return { data, status: 'ok', degraded: false };
    } catch (err: any) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "故障恢复配置读取");
      const type = this.detectFileError(err, filePath);
      switch (type) {
        case 'not_found':
          log.debug({ file: filePath }, '文件不存在 — 使用默认值');
          return { data: defaults, status: 'not_found', degraded: false };
        case 'parse_error':
          log.warn({ file: filePath }, 'JSON 文件损坏 — 使用默认值');
          return { data: defaults, status: 'parse_error', degraded: true };
        case 'corrupt':
          log.error({ file: filePath }, '数据文件校验失败 — 可能已损坏');
          return { data: defaults, status: 'corrupt', degraded: true };
        default:
          log.error({ err, file: filePath }, '未知文件错误');
          return { data: defaults, status: 'corrupt', degraded: true };
      }
    }
  }

  // ═══ 7. 不可恢复错误 — error event + SSE close ═══

  unrecoverable(error: Error, context: string): ClassifiedLlmError {
    const diagError = new ClassifiedLlmError(
      ErrorCode.INTERNAL,
      `不可恢复错误 (${context}): ${error.message}`,
      0, false,
    );
    log.error({ err: error, context }, '不可恢复错误');
    return diagError;
  }

  /** 获取当前所有降级模块 */
  getDegradedModules(): string[] {
    return [...this.degradedModules];
  }

  /** 重置降级状态 */
  reset(): void {
    this.degradedModules.clear();
  }

  /** 生成用户友好的降级消息 */
  getDegradedMessage(): string {
    const count = this.degradedModules.size;
    if (count === 0) return '';
    const modules = [...this.degradedModules].slice(0, 3).join('、');
    return `${this.config.degradedMessage}（${count} 个模块: ${modules}${count > 3 ? ' 等' : ''}）`;
  }
}

// ═══ Utility ═══

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ClassifiedLlmError(ErrorCode.TIMEOUT, label, 0, true)), ms)),
  ]);
}

// Singleton
let _instance: FaultRecovery | null = null;
export function getFaultRecovery(config?: Partial<FaultConfig>, inject?: FaultRecovery): FaultRecovery {
  if (inject) { _instance = inject; return inject; }
  if (!_instance) _instance = new FaultRecovery(config);
  return _instance;
}
