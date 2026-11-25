/**
 * scripts/ingest-v0/lib/errors.mjs — ingest v0 发现层的 typed error（铁律 32：可机器区分的错误码）。
 *
 * 为什么单独一件：发现层要跨 CLI 边界（进程退出码）与调用方边界（report.json 的 error 字段），
 * 调用方必须能区分「参数错」「输入不可读」「超资源上限」「输出写不进」——
 * 这些的处置完全不同，用一条 Error + 文本无法机器判别。
 */

/**
 * 发现层的机器可读错误码（新增码须同步本表与 `discover.mjs` 的 exitCode 映射）。
 *
 * - `E_BAD_ARGS`        入参非法（缺 --source／数值非正整数／未知开关）⇒ 退出码 2（判不了 ≠ 通过）
 * - `E_INPUT_UNREADABLE` --source 不存在／不是目录／无权限 ⇒ 退出码 2
 * - `E_RESOURCE_LIMIT`  超资源上限（文件数／总字节／递归深度／总时长）⇒ 立即停，退出码 1
 * - `E_PATH_TRAVERSAL`  ZIP 条目路径越界（`..`／绝对路径／盘符）⇒ **不作错误**，只作 skipped 原因；
 *                       本码保留给"调用方把 traversal 条目当输入"的场景（当前 CLI 不使用）
 * - `E_UNSUPPORTED`     不支持的类型 ⇒ **不作错误**，只作 unsupported 原因（本码保留同 E_PATH_TRAVERSAL）
 * - `E_OUTPUT_WRITE`    report.json 写不进（目录不可建／磁盘满）⇒ 退出码 2
 * - `E_INTERNAL`        未分类异常（含 zip 解析抛错被归一时）⇒ 退出码 1
 */
export const INGEST_ERROR_CODES = Object.freeze({
  BAD_ARGS: 'E_BAD_ARGS',
  INPUT_UNREADABLE: 'E_INPUT_UNREADABLE',
  RESOURCE_LIMIT: 'E_RESOURCE_LIMIT',
  PATH_TRAVERSAL: 'E_PATH_TRAVERSAL',
  UNSUPPORTED: 'E_UNSUPPORTED',
  OUTPUT_WRITE: 'E_OUTPUT_WRITE',
  INTERNAL: 'E_INTERNAL',
  // ═══ V2 抽取层（#1500）═══
  /** 文件可读但抽不出任何可判定事实（不是成功；由 `INSUFFICIENT_INGEST` 汇总） */
  NO_EXTRACT: 'E_NO_EXTRACT',
  /** 事实缺来源指针（`sourceRef.file/locator`）⇒ 该条不落库（C5） */
  SOURCE_REF_MISSING: 'E_SOURCE_REF_MISSING',
  /** 事实抽不到资料期间 ⇒ 该条不落库并计入 missingPeriod（C2） */
  MISSING_PERIOD: 'E_MISSING_PERIOD',
  /** 抽不到任何可落库事实：合法交付结果，带 `missing[]`（C6；禁止编造） */
  INSUFFICIENT_INGEST: 'E_INSUFFICIENT_INGEST',
  /** 落库后 `synova_context_get` 仍 count=0 ⇒ 判失败（C4；`#1493` 的坑） */
  C4_ZERO: 'E_C4_ZERO',
  /** 产品落库原语抛错（persistFacts / metric_observations / 上下文工具） */
  PERSIST_FAILED: 'E_PERSIST_FAILED',
  /** 运行环境不满足（Node 版本不支持原生 TS 执行等） */
  ENV: 'E_ENV',
});

/**
 * IngestError — 跨边界的 typed error。
 *
 * @input  code —— `INGEST_ERROR_CODES` 之一（机器可读）
 *         phase —— `'args' | 'scan' | 'zip' | 'output' | 'internal'`（出错阶段，便于归因）
 *         message —— 人类可读说明（含违约值与环境，便于复现）
 *         options.detail —— 结构化细节（限额名/实测值等）；`options.retryable` 默认 false
 *         options.partial —— 超限停止时**已扫描到的部分结果**（`{files, skipped, stats}`），用于落盘报告
 * @output IngestError 实例（`.code` / `.phase` / `.retryable` / `.detail` / `.partial` 齐备）
 * @degraded 无：本类是"显式失败"的载体，不降级、不伪造成功
 * @authority 错误码集合由本文件单一真源给出，调用方不得自造码
 * @not-here 不做日志、不决定退出码（退出码由 CLI 依 code 映射）
 * @error 无（构造本身不抛）
 */
export class IngestError extends Error {
  constructor(code, phase, message, options = {}) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
    this.phase = phase;
    this.retryable = options.retryable === true;
    this.detail = options.detail ?? null;
    this.partial = options.partial ?? null;
  }

  /**
   * @input 无
   * @output 可 JSON 化的错误视图（写进 report.json 的 `error` 字段；**不含 partial**，避免报告自嵌套）
   * @degraded 无
   * @authority 本类
   * @not-here 不写文件
   * @error 无
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      phase: this.phase,
      retryable: this.retryable,
      message: this.message,
      detail: this.detail,
    };
  }
}

/**
 * 把任意异常归一为 IngestError（保持既有 code/phase 不变，不吞不改写）。
 *
 * @input  err —— 任意抛出物；phase —— 归一缺省阶段
 * @output IngestError（已是 IngestError ⇒ 原样返回；否则包成 `E_INTERNAL`）
 * @degraded 无：归一后仍向上抛（由调用方决定退出码），不静默吞
 * @authority code 只由本函数补缺省，已带 code 的不覆盖
 * @not-here 不记日志、不落盘
 * @error 无（本函数不抛）
 */
export function toIngestError(err, phase) {
  if (err instanceof IngestError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new IngestError(INGEST_ERROR_CODES.INTERNAL, phase, message, {
    detail: { cause: err instanceof Error ? err.name : typeof err },
  });
}
