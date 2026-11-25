/**
 * lib/words — 客户语言词典（单一真源，B3）
 *
 * 判据源（按权威顺序）：
 *   · `docs/synova/ui-redo/客户语言词典-v1.0.md` **v1.1**：§2.1 角色／§2.2 概念／§2.4 状态词／
 *     §2.6 关系谓词／§2.7 十类补表＋指标名；
 *   · `docs/synova/product-lines/ui/UI-CONTRACT.md` v1.1 §4.3 客户语言词典（下限与句式）。
 * 组件与 lib 一律从这里取客户说法，**不得在调用点再写一份中文映射表**。
 *
 * @input   内部值：枚举原文（`completed`／`mark_error`／`team_executes_activity` 等）、字段值、
 *          句子键（`CUSTOMER_TEXT.*`）。调用方只传值，不做二次拼词。
 * @output  客户说法：命中字典 ⇒ 词典里的词；字典外 ⇒ 显式兜底（`其他状态`／`其他操作`／
 *          `其他目标`／`其他类型`／`一项业务关系`／`对象`／`一项经营指标`），**不回显原始英文枚举**。
 *          原始值由调用方放进 `components/TechnicalDetails`（默认收起，见 §0.3）。
 * @degraded 字典外值不抛错：状态类返回兜底词；`roleLabel` 返回 `null`（调用方省略括号，不渲染空角色）；
 *          证据/对象值的原文若可读则保留（那是客户自己的名字），不可读的原始 id 才替换。
 * @error   不抛；纯函数、无 IO、不读 store。
 * @not-here 不做数据推导、不做业务判断、不改任何数据形状；新增/修改客户说法必须先改词典版本。
 */

/** 固定句式（词典 §2.7-B/E/F/J、§5.2；动词与名词均取词典已裁定的说法） */
export const CUSTOMER_TEXT = {
  /** §5.2 5xx／网络／未知传输错误的主文案 */
  serviceUnavailable: '服务暂时不可用，请稍后重试',
  /** §5.2 认证失效 */
  loginExpired: '登录已失效，请重新登录',
  /** §5.2 403 */
  forbidden: '当前账号无权查看这项内容',
  /** §5.2 404 */
  recordMissing: '这条记录已不存在',
  /** §5.2 409 */
  stateChanged: '状态已变化，请刷新后重试',
  /** 断流（可重连） */
  connectionInterrupted: '连接中断，可重连',
  /** §2.7-E 模块降级 */
  partialFeatureUnavailable: '部分功能暂不可用（结果可能不完整）',
  /** §2.7-E 响应非 JSON */
  dataUnrecognized: '服务返回的数据无法识别',
  /** §2.7-E 数据版本不匹配 */
  dataVersionMismatch: '数据版本不匹配',
  /** §2.7-E 形状非法／应为数组 */
  dataFormatMismatch: '数据格式不符合约定',
  /** §2.7-E 数据加载失败 */
  dataLoadFailed: '数据加载失败',
  /** §2.7-F 运行编号/会话编号缺失：不渲染校验句 */
  analysisStartFailed: '本次分析启动失败，请重试',
  /** §2.7-J＋§2.7-E 数据核对服务不可用 */
  scanServiceUnavailable: '数据核对服务暂时不可用，请稍后重试',
  /** §2.7-D 幂等重放 */
  idempotencyReplay: '该请求已提交过；请用原请求编号核对，或核对完成后重新发起',
  /** §2.7-D 材料变化 */
  materialChanged: '数据已更新；请按原请求编号核对，或核对后重新发起',
  /** §2.7-E 部分内容未能读取（原文进技术详情） */
  partialContentUnreadable: '部分内容未能读取',
  /** 测量值＋趋势降级（不展示推测数据） */
  measurementUnavailable: '测量值与趋势暂时读不到（不展示推测数据）',
  /** 技术详情折叠层的固定标题（§0.3） */
  technicalDetails: '技术详情',
  /** §2.7-H 成本口径：不出现版本号 */
  costBasisNote:
    '已知限制：本区只显示已落库的真实读数（不补数、不猜数）。按当前成本口径计算——上游导出不含营业成本，毛利率/净利率为公式产物，与客户账本可能不一致。',
} as const;

/** §2.4 状态词（枚举 → 中文，统一一套；`confirmed` 取自审计 B 对证据状态的目标词，见回执） */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  completed: '已完成',
  failed: '失败',
  degraded: '部分完成',
  running: '进行中',
  executing: '进行中',
  pending: '待处理',
  estimated: '推算值',
  verified: '已核对',
  confirmed: '已核对',
  conflict: '有冲突',
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已解决',
  dismissed: '已标记为误报',
  critical: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

/** §2.1 角色（字典外 ⇒ null，调用方省略角色括号，不回显原值） */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  ga: '顾问',
  admin: '管理员',
  manager: '负责人',
  liaison: '对接人',
  staff: '成员',
};

/** §2.7-C 校准动作 */
const CALIBRATION_ACTION_LABELS: Readonly<Record<string, string>> = {
  mark_error: '标记错误',
  add_context: '补充背景',
  rewrite_logic: '修正逻辑',
  demote_signal: '调低该预警的优先级',
};

/** §2.7-C 校准目标类型（`signal_relevance` 按目标词「预警信号」落，见回执待确认项） */
const CALIBRATION_TARGET_LABELS: Readonly<Record<string, string>> = {
  diagnosis_conclusion: '诊断结论',
  diagnosis_logic: '诊断逻辑',
  signal: '预警信号',
  signal_relevance: '预警信号',
};

/** §2.6 关系谓词（seed；未登记谓词 ⇒ 一项业务关系，宁可概括不印英文） */
const RELATION_PREDICATE_LABELS: Readonly<Record<string, string>> = {
  team_executes_activity: '负责执行',
  belongs_to: '隶属于',
  supplies: '供应',
  supplied_by: '供应',
};

/**
 * §2.7-I 对象类型值域。
 * 词典只裁定「映射表进 lib/words，表外 ⇒ 对象」，未给值清单 ⇒ **本表按空 seed 落**：
 * 任何类型都走兜底「对象」，不露枚举；CTO 补值清单后只改本表。
 */
const OBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {};

/** 指标名（词典 v1.0 §2.7 指标名表；未登记 ⇒ 一项经营指标） */
const METRIC_LABELS: Readonly<Record<string, string>> = {
  gross_margin: '毛利率',
  net_margin: '净利率',
  revenue: '营业收入',
};

/** 搜索面板类型（R2-18 裸英文枚举的客户说法；`command` 措辞经 CTO 2026-11-25 裁定为「命令」） */
const SEARCH_TYPE_LABELS: Readonly<Record<string, string>> = {
  workspace: '企业',
  conversation: '本次分析',
  command: '命令',
  sentinel: '预警',
};

/** 状态词：字典外 ⇒ 其他状态（§2.4） */
export function statusLabel(value: string | null | undefined): string {
  if (typeof value !== 'string') return '其他状态';
  return STATUS_LABELS[value] ?? '其他状态';
}

/** 角色：字典外 ⇒ null（不渲染原始英文枚举） */
export function roleLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return ROLE_LABELS[value] ?? null;
}

/** 校准动作：字典外 ⇒ 其他操作 */
export function calibrationActionLabel(value: string): string {
  return CALIBRATION_ACTION_LABELS[value] ?? '其他操作';
}

/** 校准目标类型：字典外 ⇒ 其他目标 */
export function calibrationTargetLabel(value: string): string {
  return CALIBRATION_TARGET_LABELS[value] ?? '其他目标';
}

/**
 * 关系谓词：`edge/<name>` 先剥前缀；未登记 ⇒ 一项业务关系（§2.6）。
 * `*_contains_*` 族归「隶属于」（词典 §2.6 的同一行）。
 */
export function relationLabel(value: string): string {
  const raw = value.startsWith('edge/') ? value.slice(5) : value;
  const direct = RELATION_PREDICATE_LABELS[raw];
  if (direct !== undefined) return direct;
  if (/(^|_)contains(_|$)/.test(raw)) return '隶属于';
  return '一项业务关系';
}

/** 对象类型：表外 ⇒ 对象（§2.7-I，不露类型值） */
export function objectTypeLabel(value: string): string {
  return OBJECT_TYPE_LABELS[value] ?? '对象';
}

/** 指标名：字典外 ⇒ 一项经营指标（§2.7 指标名表） */
export function metricLabel(value: string): string {
  return METRIC_LABELS[value] ?? '一项经营指标';
}

/** 搜索面板类型：字典外 ⇒ 其他类型（不露枚举） */
export function searchTypeLabel(value: string): string {
  return SEARCH_TYPE_LABELS[value] ?? '其他类型';
}

/**
 * 依据/来源引用（§3.3）：`文件名#L3` ⇒ `文件名 第 3 行`；文件名保留客户原文，行号转中文。
 * 不含 `#L` 形态的原文原样返回（那是客户自己的名字或服务端已人话化的句子）。
 */
export function evidenceText(value: string): string {
  const match = /^(.*)#L(\d+)$/.exec(value);
  if (match === null) return value;
  return `${match[1]} 第 ${match[2]} 行`;
}

/**
 * 业务对象值（§3.2）：原始节点 id（`node-…`／`run_…`／UUID 片段）⇒「未命名的业务对象」；
 * 其余原文保留（客户自己的对象名）。原始 id 由调用方放进技术详情。
 */
export function objectValueText(value: string): string {
  if (/^(node-|run_)/.test(value)) return '未命名的业务对象';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(value)) return '未命名的业务对象';
  return value;
}

/**
 * 运行时错误消息的客户面处理：命中传输层/解析层技术形态（HTTP 码、非 JSON、不可读等）⇒ 统一客户说法；
 * 其余消息原样返回（服务端已人话化的业务原因不得被吞掉）。原文由调用方放进技术详情。
 */
export function runtimeErrorMessage(message: string): string {
  if (/(^|\b)HTTP\b|\b[45]\d{2}\b|非 JSON|not readable|响应非 JSON/i.test(message)) {
    return CUSTOMER_TEXT.serviceUnavailable;
  }
  return message;
}

/** 工具调用在客户面的统一说法（§2.2 工具调用/工具轨迹 → 核对数据；原名进技术详情） */
export const TOOL_TITLE = '核对数据';

/** 技术详情折叠层标题（固定，不接受调用方改写） */
export const TECHNICAL_DETAILS_TITLE = CUSTOMER_TEXT.technicalDetails;
