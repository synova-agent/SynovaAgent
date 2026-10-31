/**
 * l2/graph-scope.ts — 图命名空间口径的**唯一来源**（#1211 · S0-2c）
 *
 * 设计哲学（一句）: **"数据存哪个图分区"只允许有一个定义处** —— 业务层显式声明、
 * 非法值当场拒绝；介质层的默认值不是口径，是兜底，兜底不得替业务做决定。
 *
 * 契约（铁律 47）:
 *   @input   resolveGraph({ orgId })  — orgId: string | null | undefined（实例级组织身份；
 *                                      生产侧来源 = `loadConfig().orgId`（src/config.ts:110）
 *                                      或 `extractAuthFromRequest(req)?.orgId`）
 *            assertGraphName(value)   — value: unknown（**故意 unknown**：来自 HTTP body 的
 *                                      东西在通过校验前不得被当作 string 使用）
 *   @output  resolveGraph  → string（orgId 非空则原样，否则 'default'）
 *            assertGraphName → string（**已确认合法**的图名，可直接下传介质层）
 *   @degraded 无。本模块**没有降级分支**：口径不可用 ⇒ 抛错，不猜、不回退默认值
 *             （"静默降级禁止"铁律 11 的口径面落地）。
 *   @errors  GraphScopeError{ code:'GRAPH_NAME_INVALID', phase:'graph-scope',
 *                             retryable:false } —— 调用方必须显式 catch 并映射为业务响应
 *             （src/routes/data.ts 映射为 400 ＋ 同 code），**不得吞掉**。
 *
 * 与介质层的关系（有意分工，不是遗漏）:
 *   `src/adapters/sqlite-graph-store.ts` 的 `graph: string = "default"` **保留不动**
 *   （本件只读该文件）。介质层默认值服务于"直连 store 的内部工具"；业务层四点
 *   （decision-capture / data-exporter / data-ingest-service / routes/data）必须显式传值。
 *
 * 已知限制（explicit limitations —— 本模块不承诺的事）:
 *   1. **只管业务层四点**：全域仍有 17 处 `orgId ?? 'default'` 各自成文（§4-2），
 *      本件**不宣称"口径全仓统一"**，只新增本处唯一来源。
 *   2. **不校验存量 `SYNOVA_ORG_ID`**：`src/config.ts:110` 只读不改 ⇒ 存量实例若
 *      orgId 不合白名单，`upload`/`export` 会在本模块处 400/500（§4-6 已知限制，
 *      需另立卡做启动期 fail-fast）。
 *   3. **不做历史 `default` 数据归并**：只在 export manifest 里出计数
 *      （`graphCoverage.defaultGraphCount`），归并需显式授权。
 *   4. **不防"绕过"**：直接调 store 且漏传 graph 的调用方仍会静默落 `default`；
 *      本模块提供判据，不提供强制（强制在调用点）。
 */

/** 图名白名单：小写字母/数字起头，后续小写字母/数字/下划线/连字符，总长 1–64 */
const GRAPH_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** 图名非法时的稳定错误码（HTTP 层原样透出，供调用方与审计对账）；不外公开导出 —— 无 src 消费者 */
const GRAPH_NAME_INVALID_CODE = 'GRAPH_NAME_INVALID';

/** 口径面 typed error（铁律 32：`.code` / `.phase` / `.retryable` 三件齐） */
export class GraphScopeError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = 'GraphScopeError';
    this.code = GRAPH_NAME_INVALID_CODE;
    this.phase = 'graph-scope';
    this.retryable = false;
  }
}

/**
 * 解析实例级组织身份 → 图名。
 *
 * 与 `src/config.ts:110`（`process.env.SYNOVA_ORG_ID || 'default'`）**同源同义**：
 * 缺省 `'default'` 即"本实例的唯一 org"（一客户一实例，#1202）。
 *
 * @param input.orgId - 组织身份；空串/null/undefined 均视为未设置
 * @returns 合法图名（**未**做白名单校验 —— 需下传介质层前请再过 `assertGraphName`）
 */
export function resolveGraph(input: { orgId?: string | null } = {}): string {
  return input.orgId || 'default';
}

/**
 * 断言图名合法并返回之（**唯一**的图名校验处）。
 *
 * 合法：`^[a-z0-9][a-z0-9_-]{0,63}$`（1–64 字符；不做大小写归一 —— 归一化会
 * 把两个不同分区悄悄合并，属静默数据搬迁）。
 *
 * @param value - 来自 HTTP body / 函数形参的未知值
 * @returns 已确认合法的图名
 * @throws GraphScopeError code=GRAPH_NAME_INVALID（非 string / 空串 / 越界 / 含路径分隔符等）
 */
export function assertGraphName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GraphScopeError(
      `graph 必须是字符串（实为 ${value === null ? 'null' : typeof value}）`,
    );
  }
  if (!GRAPH_NAME_PATTERN.test(value)) {
    throw new GraphScopeError(
      `graph 命名空间非法: ${JSON.stringify(value)}（须匹配 ${String(GRAPH_NAME_PATTERN)}）`,
    );
  }
  return value;
}
